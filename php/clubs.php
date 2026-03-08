<?php

declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');

session_start();

/* =========================
   DB (PDO) - SAME FOLDER
   ========================= */
require_once __DIR__ . '/db.php'; // expects $pdo

if (!isset($pdo) || !($pdo instanceof PDO)) {
  http_response_code(500);
  echo json_encode(['success' => false, 'message' => 'PDO not initialized. Check php/db.php (expected $pdo).'], JSON_UNESCAPED_SLASHES);
  exit;
}
try { $pdo->exec("SET NAMES utf8mb4"); } catch (\Throwable $e) {}

/* =========================
   Response helpers
   ========================= */
function out(array $payload, int $code = 200): void {
  http_response_code($code);
  echo json_encode($payload, JSON_UNESCAPED_SLASHES);
  exit;
}
function ok(array $data = []): void {
  out(array_merge(['success' => true], $data), 200);
}
function err(string $message, int $code = 400, array $extra = []): void {
  out(array_merge(['success' => false, 'message' => $message], $extra), $code);
}

/* =========================
   Input parsing (JSON + form)
   ========================= */
$raw = file_get_contents('php://input');
$input = [];
if (is_string($raw) && trim($raw) !== '') {
  $decoded = json_decode($raw, true);
  if (is_array($decoded)) $input = $decoded;
}
if (!$input && !empty($_POST)) $input = $_POST;

$action = trim((string)($input['action'] ?? ''));

/* =========================
   Session helpers
   ========================= */
function session_user_id(): int {
  if (isset($_SESSION['user_id'])) return (int)$_SESSION['user_id'];
  if (isset($_SESSION['id'])) return (int)$_SESSION['id'];
  if (isset($_SESSION['user']) && is_array($_SESSION['user']) && isset($_SESSION['user']['id'])) return (int)$_SESSION['user']['id'];
  return 0;
}

/* =========================
   SQL helpers
   ========================= */
function build_in_qmarks(array $values): array {
  $vals = array_values(array_filter($values, fn($v) => (int)$v > 0));
  if (!$vals) return ['(?)', [0]];
  $marks = implode(',', array_fill(0, count($vals), '?'));
  return ["($marks)", array_map('intval', $vals)];
}

/* =========================
   DB helpers
   ========================= */
function get_active_term(PDO $pdo): ?array {
  $st = $pdo->prepare("
    SELECT id, school_year, semester, status, created_at
    FROM academic_terms
    WHERE status = 'Active'
    ORDER BY id DESC
    LIMIT 1
  ");
  $st->execute();
  $row = $st->fetch(PDO::FETCH_ASSOC);
  return $row ?: null;
}

/**
 * Merge terms by TRIM(school_year) so it matches across semesters and ignores trailing spaces.
 * (No DB change required.)
 */
function get_active_term_group(PDO $pdo): ?array {
  $active = get_active_term($pdo);
  if (!$active) return null;

  $syRaw = (string)($active['school_year'] ?? '');
  $sy = trim($syRaw);
  if ($sy === '') return null;

  $st = $pdo->prepare("
    SELECT id, school_year, semester, status, created_at
    FROM academic_terms
    WHERE TRIM(school_year) = :sy
    ORDER BY id ASC
  ");
  $st->execute([':sy' => $sy]);
  $rows = $st->fetchAll(PDO::FETCH_ASSOC) ?: [];
  if (!$rows) return null;

  $ids = [];
  foreach ($rows as $r) {
    $id = (int)($r['id'] ?? 0);
    if ($id > 0) $ids[] = $id;
  }
  if (!$ids) return null;

  return [
    'active_term' => $active,
    'school_year' => $sy,          // trimmed canonical
    'school_year_raw' => $syRaw,   // raw (debug)
    'term_ids' => $ids,
    'canonical_term_id' => min($ids),
    'term_rows' => $rows,
  ];
}

function get_club(PDO $pdo, int $orgId): ?array {
  $st = $pdo->prepare("
    SELECT
      id,
      org_type,
      org_name,
      abbreviation,
      logo_path,
      description,
      mission,
      vision,
      objectives,
      advocacy,
      scope,
      program_id,
      membership_fee,
      fee_required,
      status,
      created_by,
      created_at
    FROM organizations
    WHERE id = :id
      AND org_type = 'Club'
    LIMIT 1
  ");
  $st->execute([':id' => $orgId]);
  $row = $st->fetch(PDO::FETCH_ASSOC);
  return $row ?: null;
}

/* =========================
   ROLE helpers
   ========================= */
function get_user_role(PDO $pdo, int $userId): string {
  $st = $pdo->prepare("SELECT role FROM users WHERE id = :id LIMIT 1");
  $st->execute([':id' => $userId]);
  $r = $st->fetchColumn();
  return $r ? (string)$r : 'student';
}

function is_role_based_officer(string $role): bool {
  // based on your users.role enum in the SQL dump
  return in_array($role, ['org_president', 'treasurer', 'org_officer'], true);
}

function officer_label_from_role(string $role): string {
  return match ($role) {
    'org_president' => 'President',
    'treasurer' => 'Treasurer',
    'org_officer' => 'Officer',
    default => 'Officer',
  };
}

/**
 * Approved member check within merged school year (termIds)
 */
function is_approved_member_for_year(PDO $pdo, int $orgId, array $termIds, int $userId): bool {
  if ($orgId <= 0 || $userId <= 0) return false;
  [$inSql, $inParams] = build_in_qmarks($termIds);

  $sql = "
    SELECT 1
    FROM organization_memberships
    WHERE org_id = ?
      AND student_user_id = ?
      AND academic_term_id IN $inSql
      AND status = 'Approved'
    LIMIT 1
  ";
  $st = $pdo->prepare($sql);
  $st->execute(array_merge([(int)$orgId, (int)$userId], $inParams));
  return (bool)$st->fetchColumn();
}

/* =========================
   Officer checks (SCHOOL YEAR JOIN + ROLE fallback)
   ========================= */

/**
 * Officer row counts if its academic_term_id belongs to ANY academic_terms row
 * whose TRIM(school_year) matches the active school_year.
 *
 * termIds is still passed for membership-scoped role fallback.
 */
function is_officer_for_year(PDO $pdo, int $orgId, string $schoolYear, array $termIds, int $userId): bool {
  if ($orgId <= 0 || $userId <= 0) return false;

  $sy = trim($schoolYear);

  // 1) Primary: organization_officers joined to academic_terms by school_year match
  if ($sy !== '') {
    $st = $pdo->prepare("
      SELECT 1
      FROM organization_officers o
      JOIN academic_terms t ON t.id = o.academic_term_id
      WHERE o.org_id = :org_id
        AND o.user_id = :uid
        AND o.status = 'Active'
        AND TRIM(t.school_year) = :sy
      LIMIT 1
    ");
    $st->execute([
      ':org_id' => $orgId,
      ':uid' => $userId,
      ':sy' => $sy,
    ]);
    if ((bool)$st->fetchColumn()) return true;
  }

  // 2) Fallback: role-based officer, but only if approved member of this club within merged year
  $role = get_user_role($pdo, $userId);
  if (is_role_based_officer($role) && is_approved_member_for_year($pdo, $orgId, $termIds, $userId)) {
    return true;
  }

  return false;
}

function officer_position_year(PDO $pdo, int $orgId, string $schoolYear, array $termIds, int $userId): ?string {
  if ($orgId <= 0 || $userId <= 0) return null;

  $sy = trim($schoolYear);

  // Prefer organization_officers.position (joined by school_year)
  if ($sy !== '') {
    $st = $pdo->prepare("
      SELECT o.position
      FROM organization_officers o
      JOIN academic_terms t ON t.id = o.academic_term_id
      WHERE o.org_id = :org_id
        AND o.user_id = :uid
        AND o.status = 'Active'
        AND TRIM(t.school_year) = :sy
      ORDER BY o.academic_term_id DESC, o.id DESC
      LIMIT 1
    ");
    $st->execute([
      ':org_id' => $orgId,
      ':uid' => $userId,
      ':sy' => $sy,
    ]);
    $pos = $st->fetchColumn();
    if ($pos) return (string)$pos;
  }

  // Role fallback label (only if truly officer for this org/year)
  $role = get_user_role($pdo, $userId);
  if (is_role_based_officer($role) && is_approved_member_for_year($pdo, $orgId, $termIds, $userId)) {
    return officer_label_from_role($role);
  }

  return null;
}

function get_any_active_officer_row_year(PDO $pdo, int $orgId, string $schoolYear, int $userId): ?array {
  if ($orgId <= 0 || $userId <= 0) return null;

  $sy = trim($schoolYear);
  if ($sy === '') return null;

  $st = $pdo->prepare("
    SELECT o.id, o.org_id, o.academic_term_id, o.position, o.status, o.created_at
    FROM organization_officers o
    JOIN academic_terms t ON t.id = o.academic_term_id
    WHERE o.org_id = :org_id
      AND o.user_id = :uid
      AND o.status = 'Active'
      AND TRIM(t.school_year) = :sy
    ORDER BY o.academic_term_id DESC, o.id DESC
    LIMIT 1
  ");
  $st->execute([
    ':org_id' => $orgId,
    ':uid' => $userId,
    ':sy' => $sy,
  ]);
  $row = $st->fetch(PDO::FETCH_ASSOC);
  return $row ?: null;
}

function generate_receipt_no(int $orgId, int $canonicalTermId): string {
  $date = date('Ymd');
  $rand = strtoupper(substr(bin2hex(random_bytes(4)), 0, 8));
  return "CLUB{$orgId}-T{$canonicalTermId}-{$date}-{$rand}";
}

function normalize_paid_at(string $paidAt): string {
  $paidAtNorm = trim($paidAt);
  if ($paidAtNorm === '') return '';
  if (preg_match('/^\d{4}-\d{2}-\d{2}$/', $paidAtNorm)) return $paidAtNorm . ' 00:00:00';
  return $paidAtNorm;
}

function ensure_membership_for_user_year(PDO $pdo, int $orgId, array $termIds, int $canonicalTermId, int $userId): int {
  [$inSql, $inParams] = build_in_qmarks($termIds);

  $sql = "
    SELECT id
    FROM organization_memberships
    WHERE org_id = ?
      AND student_user_id = ?
      AND academic_term_id IN $inSql
    ORDER BY academic_term_id DESC, id DESC
    LIMIT 1
  ";
  $st = $pdo->prepare($sql);
  $st->execute(array_merge([(int)$orgId, (int)$userId], $inParams));
  $mid = (int)($st->fetchColumn() ?: 0);
  if ($mid > 0) return $mid;

  $ins = $pdo->prepare("
    INSERT INTO organization_memberships
      (org_id, student_user_id, academic_term_id, status, fee_amount, fee_paid, fee_paid_at, requested_at, reviewed_by, reviewed_at)
    VALUES
      (:org_id, :uid, :term_id, 'Approved', 0.00, 0, NULL, CURRENT_TIMESTAMP, NULL, NULL)
  ");
  $ins->execute([':org_id' => $orgId, ':uid' => $userId, ':term_id' => $canonicalTermId]);

  return (int)$pdo->lastInsertId();
}

/* =========================
   Notifications helpers (notif_type = 'club')
   ========================= */
function user_brief(PDO $pdo, int $userId): array {
  if ($userId <= 0) return ['id' => 0, 'id_number' => '', 'name' => ''];
  $st = $pdo->prepare("
    SELECT id, id_number, first_name, middle_name, last_name, suffix
    FROM users
    WHERE id = :id
    LIMIT 1
  ");
  $st->execute([':id' => $userId]);
  $u = $st->fetch(PDO::FETCH_ASSOC);
  if (!$u) return ['id' => $userId, 'id_number' => '', 'name' => ''];

  $name = trim(
    (string)($u['first_name'] ?? '') . ' ' .
    (string)($u['middle_name'] ?? '') . ' ' .
    (string)($u['last_name'] ?? '') . ' ' .
    (string)($u['suffix'] ?? '')
  );
  $name = preg_replace('/\s+/', ' ', $name ?: '') ?: '';
  return [
    'id' => (int)($u['id'] ?? $userId),
    'id_number' => (string)($u['id_number'] ?? ''),
    'name' => $name,
  ];
}

function insert_notification(PDO $pdo, int $recipientId, ?int $actorId, string $title, ?string $message, string $notifType = 'club', ?int $payloadId = null): void {
  if ($recipientId <= 0) return;
  $title = trim($title);
  if ($title === '') $title = 'Notification';

  $st = $pdo->prepare("
    INSERT INTO notifications
      (recipient_id, actor_id, title, message, notif_type, status, payload_id)
    VALUES
      (:rid, :aid, :title, :msg, :ntype, 'unread', :pid)
  ");
  $st->execute([
    ':rid' => $recipientId,
    ':aid' => ($actorId && $actorId > 0) ? $actorId : null,
    ':title' => $title,
    ':msg' => ($message !== null && trim($message) !== '') ? $message : null,
    ':ntype' => $notifType,
    ':pid' => ($payloadId && $payloadId > 0) ? $payloadId : null,
  ]);
}

function club_manage_recipients_year(PDO $pdo, int $orgId, array $termIds, ?array $clubRow = null): array {
  $ids = [];
  [$inSql, $inParams] = build_in_qmarks($termIds);

  // officers across merged terms
  $sqlO = "
    SELECT DISTINCT user_id
    FROM organization_officers
    WHERE org_id = ?
      AND academic_term_id IN $inSql
      AND status = 'Active'
      AND user_id IS NOT NULL
  ";
  $stO = $pdo->prepare($sqlO);
  $stO->execute(array_merge([(int)$orgId], $inParams));
  while ($r = $stO->fetch(PDO::FETCH_ASSOC)) {
    $u = (int)($r['user_id'] ?? 0);
    if ($u > 0) $ids[$u] = true;
  }

  // club creator
  $club = $clubRow ?: get_club($pdo, $orgId);
  if ($club && isset($club['created_by'])) {
    $c = (int)$club['created_by'];
    if ($c > 0) $ids[$c] = true;
  }

  // accreditation assigned users across merged terms (best effort)
  try {
    $sqlA = "
      SELECT moderator_user_id, coordinator_user_id
      FROM accreditation_requests
      WHERE org_id = ?
        AND academic_term_id IN $inSql
      ORDER BY id DESC
      LIMIT 1
    ";
    $stA = $pdo->prepare($sqlA);
    $stA->execute(array_merge([(int)$orgId], $inParams));
    $ar = $stA->fetch(PDO::FETCH_ASSOC);
    if ($ar) {
      $m1 = (int)($ar['moderator_user_id'] ?? 0);
      $m2 = (int)($ar['coordinator_user_id'] ?? 0);
      if ($m1 > 0) $ids[$m1] = true;
      if ($m2 > 0) $ids[$m2] = true;
    }
  } catch (\Throwable $e) {
    // ignore if schema mismatch
  }

  return array_keys($ids);
}

function try_notify(callable $fn): void {
  try { $fn(); } catch (\Throwable $e) {}
}

/* =========================
   ACCESS HELPERS
   ========================= */
function has_officer_like_access_year(PDO $pdo, int $orgId, string $schoolYear, array $termIds, int $userId): array {
  if (is_officer_for_year($pdo, $orgId, $schoolYear, $termIds, $userId)) {
    return [true, 'Officer'];
  }

  $role = get_user_role($pdo, $userId);

  // Global access
  if ($role === 'super_admin') return [true, 'Super Admin'];
  if ($role === 'special_admin') return [true, 'Special Admin'];
  if ($role === 'overseer') return [true, 'Overseer'];

  // Role-based officer (scoped by approved membership in this club this merged school year)
  if (is_role_based_officer($role) && is_approved_member_for_year($pdo, $orgId, $termIds, $userId)) {
    return [true, officer_label_from_role($role)];
  }

  // Club-scoped access (moderator/faculty_admin assigned/creator)
  if ($role === 'moderator' || $role === 'faculty_admin') {

    $stC = $pdo->prepare("
      SELECT 1
      FROM organizations
      WHERE id = :org_id
        AND org_type = 'Club'
        AND created_by = :uid
      LIMIT 1
    ");
    $stC->execute([':org_id' => $orgId, ':uid' => $userId]);
    if ((bool)$stC->fetchColumn()) {
      return [true, ($role === 'moderator') ? 'Moderator (Club Creator)' : 'Admin (Club Creator)'];
    }

    try {
      [$inSql, $inParams] = build_in_qmarks($termIds);
      $sqlA = "
        SELECT 1
        FROM accreditation_requests
        WHERE org_id = ?
          AND academic_term_id IN $inSql
          AND (moderator_user_id = ? OR coordinator_user_id = ?)
        ORDER BY id DESC
        LIMIT 1
      ";
      $stA = $pdo->prepare($sqlA);
      $stA->execute(array_merge([(int)$orgId], $inParams, [(int)$userId, (int)$userId]));
      if ((bool)$stA->fetchColumn()) {
        return [true, ($role === 'moderator') ? 'Moderator (Assigned)' : 'Admin (Assigned)'];
      }
    } catch (\Throwable $e) {
      // ignore
    }
  }

  return [false, ''];
}

function require_officer_like_access_year(PDO $pdo, int $orgId, string $schoolYear, array $termIds, int $userId): string {
  [$ok, $as] = has_officer_like_access_year($pdo, $orgId, $schoolYear, $termIds, $userId);
  if (!$ok) err('Forbidden.', 403);
  return $as;
}

/* =========================
   Auth guard
   ========================= */
$uid = session_user_id();
if ($uid <= 0) err('Unauthorized. Please login again.', 401);
if ($action === '') err('Missing action.', 400);

/* =========================
   Router
   ========================= */
try {

  switch ($action) {

    /**
     * ✅ FIXED: get_clubs now LEFT JOINs the current user's membership (latest within merged school year).
     * This prevents "no Join button" for non-members because the row still returns with membership_id = NULL.
     */
    case 'get_clubs': {
    $tg = get_active_term_group($pdo);
    if (!$tg) err('No active academic term found.', 409);

    $q = trim((string)($input['q'] ?? ''));
    $status = trim((string)($input['status'] ?? 'Active'));
    if ($status === '') $status = 'Active';

    $termIds = $tg['term_ids'];
    [$inSql, $inParams] = build_in_qmarks($termIds);

    $accreditation_status = trim((string)($input['accreditation_status'] ?? 'Active'));

    // First, get all clubs with their basic info
    $sql = "
        SELECT
            o.id,
            o.org_type,
            o.org_name,
            o.abbreviation,
            o.logo_path,
            o.description,
            o.scope,
            o.membership_fee,
            o.fee_required,
            o.status,
            o.created_at,
            ar.status AS accreditation_status,
            
            mem.id        AS membership_id,
            mem.status    AS membership_status,
            mem.fee_paid  AS membership_fee_paid,
            mem.fee_paid_at AS membership_fee_paid_at,
            mem.fee_amount AS membership_fee_amount

        FROM organizations o
        INNER JOIN accreditation_requests ar 
            ON ar.org_id = o.id 
            AND ar.academic_term_id IN $inSql
            AND ar.status = ?

        LEFT JOIN (
            SELECT m.*
            FROM organization_memberships m
            JOIN (
                SELECT org_id, MAX(academic_term_id) AS max_term
                FROM organization_memberships
                WHERE student_user_id = ?
                  AND academic_term_id IN $inSql
                GROUP BY org_id
            ) pick
                ON pick.org_id = m.org_id
               AND pick.max_term = m.academic_term_id
            WHERE m.student_user_id = ?
              AND m.academic_term_id IN $inSql
        ) mem
            ON mem.org_id = o.id

        WHERE o.org_type = 'Club'
          AND o.status = ?
    ";

    $params = [];
    
    // term IDs for accreditation_requests join
    foreach ($inParams as $p) {
        $params[] = $p;
    }
    
    // accreditation status
    $params[] = $accreditation_status;
    
    // first uid for membership subquery
    $params[] = (int)$uid;
    
    // term IDs for membership subquery (first occurrence)
    foreach ($inParams as $p) {
        $params[] = $p;
    }
    
    // second uid for membership subquery
    $params[] = (int)$uid;
    
    // term IDs for membership subquery (second occurrence)
    foreach ($inParams as $p) {
        $params[] = $p;
    }
    
    // organization status
    $params[] = $status;

    if ($q !== '') {
        $sql .= " AND (o.org_name LIKE ? OR o.abbreviation LIKE ?)";
        $params[] = '%' . $q . '%';
        $params[] = '%' . $q . '%';
    }

    $sql .= " ORDER BY o.org_name ASC";

    $st = $pdo->prepare($sql);
    $st->execute($params);
    $clubs = $st->fetchAll(PDO::FETCH_ASSOC) ?: [];

    // Build a simple array of term IDs for the count query
    $termList = implode(',', array_fill(0, count($termIds), '?'));
    
    // Now, for each club, calculate the member count separately using positional parameters
    foreach ($clubs as &$club) {
        $orgId = $club['id'];
        
        // Count unique members (approved members + active officers)
        $countSql = "
            SELECT COUNT(DISTINCT user_id) as total
            FROM (
                SELECT student_user_id AS user_id
                FROM organization_memberships
                WHERE org_id = ?
                    AND academic_term_id IN ($termList)
                    AND status = 'Approved'
                
                UNION
                
                SELECT user_id
                FROM organization_officers
                WHERE org_id = ?
                    AND academic_term_id IN ($termList)
                    AND status = 'Active'
                    AND user_id IS NOT NULL
            ) AS combined
        ";
        
        $countSt = $pdo->prepare($countSql);
        
        // Build parameters for count query: org_id (twice) + term IDs (twice)
        $countParams = [];
        
        // First org_id for memberships
        $countParams[] = $orgId;
        
        // Term IDs for memberships
        foreach ($termIds as $termId) {
            $countParams[] = $termId;
        }
        
        // Second org_id for officers
        $countParams[] = $orgId;
        
        // Term IDs for officers
        foreach ($termIds as $termId) {
            $countParams[] = $termId;
        }
        
        $countSt->execute($countParams);
        
        $club['member_count'] = (int)($countSt->fetchColumn() ?: 0);
    }

    ok([
        'term' => $tg['active_term'],
        'term_group' => [
            'school_year' => $tg['school_year'],
            'term_ids' => $tg['term_ids'],
            'canonical_term_id' => $tg['canonical_term_id'],
        ],
        'clubs' => $clubs,
    ]);
    }

    case 'get_club_details': {
      $orgId = (int)($input['org_id'] ?? 0);
      if ($orgId <= 0) err('Invalid org_id.', 400);

      $tg = get_active_term_group($pdo);
      if (!$tg) err('No active academic term found.', 409);

      $termIds = $tg['term_ids'];
      $canonicalTermId = (int)$tg['canonical_term_id'];
      $schoolYear = (string)$tg['school_year'];

      $club = get_club($pdo, $orgId);
      if (!$club) err('Club not found.', 404);

      [$inSql, $inParams] = build_in_qmarks($termIds);

      $stCount = $pdo->prepare("
        SELECT COUNT(DISTINCT x.user_id) AS cnt
        FROM (
          SELECT m.student_user_id AS user_id
          FROM organization_memberships m
          WHERE m.org_id = ?
            AND m.academic_term_id IN $inSql
            AND m.status = 'Approved'
          UNION
          SELECT o.user_id AS user_id
          FROM organization_officers o
          WHERE o.org_id = ?
            AND o.academic_term_id IN $inSql
            AND o.status = 'Active'
            AND o.user_id IS NOT NULL
        ) x
      ");
      $stCount->execute(array_merge([(int)$orgId], $inParams, [(int)$orgId], $inParams));
      $memberCnt = (int)($stCount->fetchColumn() ?: 0);

      $stMem = $pdo->prepare("
        SELECT id, academic_term_id, status, fee_amount, fee_paid, fee_paid_at, requested_at, reviewed_by, reviewed_at
        FROM organization_memberships
        WHERE org_id = ?
          AND student_user_id = ?
          AND academic_term_id IN $inSql
        ORDER BY academic_term_id DESC, id DESC
        LIMIT 1
      ");
      $stMem->execute(array_merge([(int)$orgId, (int)$uid], $inParams));
      $membership = $stMem->fetch(PDO::FETCH_ASSOC) ?: null;

      $isOfficer = is_officer_for_year($pdo, $orgId, $schoolYear, $termIds, $uid);
      $pos = $isOfficer ? officer_position_year($pdo, $orgId, $schoolYear, $termIds, $uid) : null;

      $officerTermId = null;
      if ($isOfficer) {
        $offAny = get_any_active_officer_row_year($pdo, $orgId, $schoolYear, $uid);
        if ($offAny) $officerTermId = (int)($offAny['academic_term_id'] ?? 0);
      }

      [$canManage, $manageAs] = has_officer_like_access_year($pdo, $orgId, $schoolYear, $termIds, $uid);

      ok([
        'term' => $tg['active_term'],
        'term_group' => [
          'school_year' => $tg['school_year'],
          'term_ids' => $termIds,
          'canonical_term_id' => $canonicalTermId,
        ],
        'club' => $club,
        'active_member_count' => $memberCnt,
        'membership' => $membership,
        'is_officer' => $isOfficer,
        'officer_position' => $pos,
        'officer_term_id' => $officerTermId,
        'can_manage' => $canManage,
        'manage_as' => $manageAs,
        'user_role' => get_user_role($pdo, $uid),
      ]);
    }

    case 'list_club_members': {
      $orgId = (int)($input['org_id'] ?? 0);
      if ($orgId <= 0) err('Invalid org_id.', 400);

      $tg = get_active_term_group($pdo);
      if (!$tg) err('No active academic term found.', 409);

      $termIds = $tg['term_ids'];
      $club = get_club($pdo, $orgId);
      if (!$club) err('Club not found.', 404);

      [$inSql, $inParams] = build_in_qmarks($termIds);

      // Members = Approved memberships + active officers (for the current school year)
      $st = $pdo->prepare("
        SELECT
          u.id_number,
          u.first_name,
          u.middle_name,
          u.last_name,
          u.suffix,
          u.program,
          COALESCE(off.position, 'Member') AS role_label
        FROM (
          SELECT m.student_user_id AS user_id
          FROM organization_memberships m
          WHERE m.org_id = ?
            AND m.academic_term_id IN $inSql
            AND m.status = 'Approved'
          UNION
          SELECT o.user_id AS user_id
          FROM organization_officers o
          WHERE o.org_id = ?
            AND o.academic_term_id IN $inSql
            AND o.status = 'Active'
            AND o.user_id IS NOT NULL
        ) x
        INNER JOIN users u ON u.id = x.user_id
        LEFT JOIN (
          SELECT user_id, MAX(position) AS position
          FROM organization_officers
          WHERE org_id = ?
            AND academic_term_id IN $inSql
            AND status = 'Active'
            AND user_id IS NOT NULL
          GROUP BY user_id
        ) off ON off.user_id = x.user_id
        ORDER BY u.last_name ASC, u.first_name ASC, u.id_number ASC
      ");

      $st->execute(array_merge(
        [(int)$orgId], $inParams,
        [(int)$orgId], $inParams,
        [(int)$orgId], $inParams
      ));

      $members = $st->fetchAll(PDO::FETCH_ASSOC) ?: [];

      ok([
        'term' => $tg['active_term'],
        'org_id' => $orgId,
        'members' => $members,
      ]);
    }

    case 'request_join': {
      $orgId = (int)($input['org_id'] ?? 0);
      if ($orgId <= 0) err('Invalid org_id.', 400);

      $tg = get_active_term_group($pdo);
      if (!$tg) err('No active academic term found.', 409);

      $termIds = $tg['term_ids'];
      $canonicalTermId = (int)$tg['canonical_term_id'];
      $schoolYear = (string)$tg['school_year'];

      $club = get_club($pdo, $orgId);
      if (!$club) err('Club not found.', 404);
      if (($club['status'] ?? '') !== 'Active') err('This club is not active.', 409);

      [$canManage, $manageAs] = has_officer_like_access_year($pdo, $orgId, $schoolYear, $termIds, $uid);
      if ($canManage) {
        err("You cannot submit join requests. You have manage access as {$manageAs}. Use Manage instead.", 409);
      }

      $offAny = get_any_active_officer_row_year($pdo, $orgId, $schoolYear, $uid);
      if ($offAny) {
        err('Officers cannot submit join requests. Use Manage instead.', 409, [
          'officer_term_id' => (int)($offAny['academic_term_id'] ?? 0),
          'active_term_id' => (int)($tg['active_term']['id'] ?? 0),
          'school_year' => $tg['school_year'],
        ]);
      }

      [$inSql, $inParams] = build_in_qmarks($termIds);

      $st = $pdo->prepare("
        SELECT id, status, academic_term_id
        FROM organization_memberships
        WHERE org_id = ?
          AND student_user_id = ?
          AND academic_term_id IN $inSql
        ORDER BY academic_term_id DESC, id DESC
        LIMIT 1
      ");
      $st->execute(array_merge([(int)$orgId, (int)$uid], $inParams));
      $existing = $st->fetch(PDO::FETCH_ASSOC);

      if ($existing) {
        ok([
          'term' => $tg['active_term'],
          'term_group' => [
            'school_year' => $tg['school_year'],
            'term_ids' => $termIds,
            'canonical_term_id' => $canonicalTermId,
          ],
          'membership' => $existing,
          'message' => 'Membership already exists for this school year (merged).',
        ]);
      }

      $ins = $pdo->prepare("
        INSERT INTO organization_memberships
          (org_id, student_user_id, academic_term_id, status, fee_amount, fee_paid, fee_paid_at, requested_at)
        VALUES
          (:org_id, :uid, :term_id, 'Pending', 0.00, 0, NULL, CURRENT_TIMESTAMP)
      ");
      $ins->execute([':org_id' => $orgId, ':uid' => $uid, ':term_id' => $canonicalTermId]);

      $membershipId = (int)$pdo->lastInsertId();

      try_notify(function () use ($pdo, $orgId, $termIds, $uid, $club, $membershipId) {
        $student = user_brief($pdo, $uid);
        $clubName = (string)($club['org_name'] ?? 'Club');
        $who = trim(($student['name'] ?: 'A student') . ($student['id_number'] !== '' ? " ({$student['id_number']})" : ''));
        $title = "New join request: {$clubName}";
        $msg = "{$who} submitted a join request.";
        $recipients = club_manage_recipients_year($pdo, $orgId, $termIds, $club);
        foreach ($recipients as $rid) {
          $rid = (int)$rid;
          if ($rid <= 0) continue;
          if ($rid === $uid) continue;
          insert_notification($pdo, $rid, $uid, $title, $msg, 'club', $membershipId);
        }
      });

      ok([
        'term' => $tg['active_term'],
        'term_group' => [
          'school_year' => $tg['school_year'],
          'term_ids' => $termIds,
          'canonical_term_id' => $canonicalTermId,
        ],
        'membership' => ['id' => $membershipId, 'status' => 'Pending', 'academic_term_id' => $canonicalTermId],
        'message' => 'Join request submitted (merged by school year).',
      ]);
    }

    case 'get_pending_members': {
      $orgId = (int)($input['org_id'] ?? 0);
      if ($orgId <= 0) err('Invalid org_id.', 400);

      $tg = get_active_term_group($pdo);
      if (!$tg) err('No active academic term found.', 409);

      $termIds = $tg['term_ids'];
      $schoolYear = (string)$tg['school_year'];

      if (!get_club($pdo, $orgId)) err('Club not found.', 404);

      require_officer_like_access_year($pdo, $orgId, $schoolYear, $termIds, $uid);

      [$inSql, $inParams] = build_in_qmarks($termIds);

      $st = $pdo->prepare("
        SELECT
          m.id AS membership_id,
          m.academic_term_id,
          u.id AS student_user_id,
          u.id_number,
          u.first_name, u.middle_name, u.last_name, u.suffix,
          m.status,
          m.requested_at
        FROM organization_memberships m
        JOIN users u ON u.id = m.student_user_id
        WHERE m.org_id = ?
          AND m.academic_term_id IN $inSql
          AND m.status = 'Pending'
        ORDER BY m.requested_at DESC, m.id DESC
      ");
      $st->execute(array_merge([(int)$orgId], $inParams));

      ok([
        'term' => $tg['active_term'],
        'term_group' => [
          'school_year' => $tg['school_year'],
          'term_ids' => $termIds,
          'canonical_term_id' => (int)$tg['canonical_term_id'],
        ],
        'rows' => $st->fetchAll(PDO::FETCH_ASSOC) ?: [],
      ]);
    }

    /**
     * JS calls action="activate_member" when confirming member activation.
     * This also sends a notification to the student that they were accepted/approved.
     */
    case 'activate_member': {
      // payload: { action:"activate_member", membership_id, amount, paid_at, receipt_no? }
      $membershipId = (int)($input['membership_id'] ?? 0);
      $amountRaw = trim((string)($input['amount'] ?? ''));
      $paidAtRaw = trim((string)($input['paid_at'] ?? ''));

      // user-provided OR/Reference number (optional)
      $receiptNoInput = trim((string)($input['receipt_no'] ?? ''));

      if ($membershipId <= 0) err('Invalid membership_id.', 400);
      if ($amountRaw === '' || !is_numeric($amountRaw)) err('Invalid amount.', 400);

      $amount = (float)$amountRaw;
      if ($amount < 0) err('Amount cannot be negative.', 400);

      if ($paidAtRaw === '') err('Missing paid_at.', 400);
      $paidAt = normalize_paid_at($paidAtRaw);

      // validate receipt_no length if provided (your DB column is 50)
      if ($receiptNoInput !== '' && mb_strlen($receiptNoInput) > 50) {
        err('Receipt/Ref no is too long (max 50 chars).', 400);
      }

      // Find membership -> org + student + term group
      $stM = $pdo->prepare("
        SELECT id, org_id, student_user_id, academic_term_id, status
        FROM organization_memberships
        WHERE id = :id
        LIMIT 1
      ");
      $stM->execute([':id' => $membershipId]);
      $m = $stM->fetch(PDO::FETCH_ASSOC);
      if (!$m) err('Membership not found.', 404);

      $orgId = (int)($m['org_id'] ?? 0);
      $studentId = (int)($m['student_user_id'] ?? 0);
      if ($orgId <= 0 || $studentId <= 0) err('Membership record is invalid.', 409);

      $tg = get_active_term_group($pdo);
      if (!$tg) err('No active academic term found.', 409);

      $termIds = $tg['term_ids'];
      $canonicalTermId = (int)$tg['canonical_term_id'];
      $schoolYear = (string)$tg['school_year'];

      if (!get_club($pdo, $orgId)) err('Club not found.', 404);

      // must have manage access for this club/year
      require_officer_like_access_year($pdo, $orgId, $schoolYear, $termIds, $uid);

      // Ensure the membership being activated belongs to same merged school year
      [$inSql, $inParams] = build_in_qmarks($termIds);
      $stChk = $pdo->prepare("
        SELECT 1
        FROM organization_memberships
        WHERE id = ?
          AND org_id = ?
          AND academic_term_id IN $inSql
        LIMIT 1
      ");
      $stChk->execute(array_merge([(int)$membershipId, (int)$orgId], $inParams));
      if (!(bool)$stChk->fetchColumn()) {
        err('This membership is not part of the current school year group.', 409);
      }

      // block double activation
      if ((string)($m['status'] ?? '') === 'Approved') {
        err('This member is already active/approved.', 409);
      }

      // use user receipt no if provided, else auto-generate
      $receiptNo = ($receiptNoInput !== '') ? $receiptNoInput : generate_receipt_no($orgId, $canonicalTermId);

      // duplicate check (unique receipt_no)
      $stDup = $pdo->prepare("
        SELECT 1
        FROM organization_membership_receipts
        WHERE receipt_no = :rno
        LIMIT 1
      ");
      $stDup->execute([':rno' => $receiptNo]);
      if ((bool)$stDup->fetchColumn()) {
        err('Receipt/Ref no already exists. Please use a different one.', 409, ['receipt_no' => $receiptNo]);
      }

      // Transaction: approve membership + mark fee paid + add receipt
      $pdo->beginTransaction();
      try {
        // Approve the membership row we were given
        $stUp = $pdo->prepare("
          UPDATE organization_memberships
          SET status = 'Approved',
              fee_amount = :amt,
              fee_paid = 1,
              fee_paid_at = :paid_at,
              reviewed_by = :by,
              reviewed_at = CURRENT_TIMESTAMP
          WHERE id = :id
          LIMIT 1
        ");
        $stUp->execute([
          ':amt' => $amount,
          ':paid_at' => $paidAt,
          ':by' => $uid,
          ':id' => $membershipId,
        ]);

        // Ensure a membership exists for the student in the canonical term too
        $canonicalMembershipId = ensure_membership_for_user_year($pdo, $orgId, $termIds, $canonicalTermId, $studentId);

        // If ensure_membership created a different membership row, sync it too
        if ($canonicalMembershipId !== $membershipId) {
          $stUp2 = $pdo->prepare("
            UPDATE organization_memberships
            SET status = 'Approved',
                fee_amount = :amt,
                fee_paid = 1,
                fee_paid_at = :paid_at,
                reviewed_by = :by,
                reviewed_at = CURRENT_TIMESTAMP
            WHERE id = :id
            LIMIT 1
          ");
          $stUp2->execute([
            ':amt' => $amount,
            ':paid_at' => $paidAt,
            ':by' => $uid,
            ':id' => $canonicalMembershipId,
          ]);
        }

        // Create receipt (unique receipt_no enforced)
        $stR = $pdo->prepare("
          INSERT INTO organization_membership_receipts
            (membership_id, receipt_no, amount, paid_at, paid_by_user_id, created_at)
          VALUES
            (:mid, :rno, :amt, :paid_at, :by, CURRENT_TIMESTAMP)
        ");
        $stR->execute([
          ':mid' => $membershipId, // keep receipt tied to the activated request row
          ':rno' => $receiptNo,
          ':amt' => $amount,
          ':paid_at' => $paidAt,
          ':by' => $uid,
        ]);
        $receiptId = (int)$pdo->lastInsertId();

        $pdo->commit();

        // ✅ Notify the student that they were ACCEPTED/APPROVED (best effort)
        try_notify(function () use ($pdo, $orgId, $uid, $studentId, $receiptId, $receiptNo) {
          $actor = user_brief($pdo, $uid);
          $club = get_club($pdo, $orgId);
          $clubName = (string)($club['org_name'] ?? 'Club');
          $who = trim(($actor['name'] ?: 'An officer') . ($actor['id_number'] !== '' ? " ({$actor['id_number']})" : ''));
          $title = "Club membership approved: {$clubName}";
          $msg = "You have been accepted to {$clubName}. Approved by {$who}. Receipt/Ref: {$receiptNo}.";
          insert_notification($pdo, (int)$studentId, (int)$uid, $title, $msg, 'club', $receiptId);
        });

        ok([
          'membership_id' => $membershipId,
          'receipt_id' => $receiptId,
          'receipt_no' => $receiptNo,
          'print_receipt_url' => "php/print-membership-receipt.php?receipt_id={$receiptId}",
          'message' => 'Member activated.',
        ]);

      } catch (\Throwable $e) {
        try { $pdo->rollBack(); } catch (\Throwable $ignored) {}
        err('Failed to activate member: ' . $e->getMessage(), 500);
      }
    }

    case 'get_active_members': {
      $orgId = (int)($input['org_id'] ?? 0);
      if ($orgId <= 0) err('Invalid org_id.', 400);

      $tg = get_active_term_group($pdo);
      if (!$tg) err('No active academic term found.', 409);

      $termIds = $tg['term_ids'];
      $schoolYear = (string)$tg['school_year'];

      if (!get_club($pdo, $orgId)) err('Club not found.', 404);

      require_officer_like_access_year($pdo, $orgId, $schoolYear, $termIds, $uid);

      [$inSql, $inParams] = build_in_qmarks($termIds);

      // A) Officers from organization_officers (latest per user inside termIds for list display)
      $stOff = $pdo->prepare("
        SELECT o.user_id, o.position, o.academic_term_id, o.created_at
        FROM organization_officers o
        JOIN (
          SELECT user_id, MAX(academic_term_id) AS max_term
          FROM organization_officers
          WHERE org_id = ?
            AND academic_term_id IN $inSql
            AND status = 'Active'
            AND user_id IS NOT NULL
          GROUP BY user_id
        ) pick
          ON pick.user_id = o.user_id
         AND pick.max_term = o.academic_term_id
        WHERE o.org_id = ?
          AND o.academic_term_id IN $inSql
          AND o.status = 'Active'
          AND o.user_id IS NOT NULL
      ");
      $stOff->execute(array_merge([(int)$orgId], $inParams, [(int)$orgId], $inParams));
      $officers = $stOff->fetchAll(PDO::FETCH_ASSOC) ?: [];

      $officerIds = [];
      foreach ($officers as $o) {
        $oid = (int)($o['user_id'] ?? 0);
        if ($oid > 0) $officerIds[$oid] = true;
      }

      // B) Latest membership per user in the merged year
      $stMem = $pdo->prepare("
        SELECT m.*
        FROM organization_memberships m
        JOIN (
          SELECT student_user_id, MAX(academic_term_id) AS max_term
          FROM organization_memberships
          WHERE org_id = ?
            AND academic_term_id IN $inSql
          GROUP BY student_user_id
        ) pick
          ON pick.student_user_id = m.student_user_id
         AND pick.max_term = m.academic_term_id
        WHERE m.org_id = ?
          AND m.academic_term_id IN $inSql
      ");
      $stMem->execute(array_merge([(int)$orgId], $inParams, [(int)$orgId], $inParams));
      $memRows = $stMem->fetchAll(PDO::FETCH_ASSOC) ?: [];

      $memByUser = [];
      foreach ($memRows as $m) {
        $sid = (int)($m['student_user_id'] ?? 0);
        if ($sid > 0) $memByUser[$sid] = $m;
      }

      // C) Role-based officers (users.role) who are APPROVED members; add if not in officers list
      $allMemberIds = array_keys($memByUser);

      if ($allMemberIds) {
        [$uInSql, $uInParams] = build_in_qmarks($allMemberIds);
        $stRoles = $pdo->prepare("
          SELECT id, role
          FROM users
          WHERE id IN $uInSql
        ");
        $stRoles->execute($uInParams);
        $roleRows = $stRoles->fetchAll(PDO::FETCH_ASSOC) ?: [];

        foreach ($roleRows as $rr) {
          $rid = (int)($rr['id'] ?? 0);
          $role = (string)($rr['role'] ?? '');
          if ($rid <= 0) continue;
          if (!is_role_based_officer($role)) continue;

          $m = $memByUser[$rid] ?? null;
          if (!$m || ((string)($m['status'] ?? '') !== 'Approved')) continue;

          if (!isset($officerIds[$rid])) {
            $officerIds[$rid] = true;
            $officers[] = [
              'user_id' => $rid,
              'position' => officer_label_from_role($role),
              'academic_term_id' => (int)($m['academic_term_id'] ?? 0),
              'created_at' => $m['reviewed_at'] ?? $m['requested_at'] ?? null,
            ];
          }
        }
      }

      // Fetch user info
      $allUserIds = array_keys($officerIds + array_fill_keys(array_keys($memByUser), true));
      if (!$allUserIds) {
        ok([
          'term' => $tg['active_term'],
          'term_group' => [
            'school_year' => $tg['school_year'],
            'term_ids' => $termIds,
            'canonical_term_id' => (int)$tg['canonical_term_id'],
          ],
          'rows' => [],
        ]);
      }

      [$allInSql, $allInParams] = build_in_qmarks($allUserIds);
      $stU = $pdo->prepare("
        SELECT id, id_number, first_name, middle_name, last_name, suffix, role
        FROM users
        WHERE id IN $allInSql
      ");
      $stU->execute($allInParams);
      $users = $stU->fetchAll(PDO::FETCH_ASSOC) ?: [];
      $uMap = [];
      foreach ($users as $u) {
        $uMap[(int)$u['id']] = $u;
      }

      $rows = [];

      // Members (Approved) excluding officers
      foreach ($memByUser as $studentId => $m) {
        if (isset($officerIds[$studentId])) continue;
        if (($m['status'] ?? '') !== 'Approved') continue;

        $u = $uMap[$studentId] ?? null;
        if (!$u) continue;

        $rows[] = [
          'membership_id' => (int)($m['id'] ?? 0),
          'student_user_id' => $studentId,
          'id_number' => (string)($u['id_number'] ?? ''),
          'first_name' => (string)($u['first_name'] ?? ''),
          'middle_name' => (string)($u['middle_name'] ?? ''),
          'last_name' => (string)($u['last_name'] ?? ''),
          'suffix' => (string)($u['suffix'] ?? ''),
          'status' => (string)($m['status'] ?? ''),
          'fee_amount' => (float)($m['fee_amount'] ?? 0),
          'fee_paid' => (int)($m['fee_paid'] ?? 0),
          'fee_paid_at' => $m['fee_paid_at'] ?? null,
          'reviewed_by' => $m['reviewed_by'] ?? null,
          'reviewed_at' => $m['reviewed_at'] ?? null,
          'role' => 'Member',
          'position' => null,
          'academic_term_id' => (int)($m['academic_term_id'] ?? 0),
        ];
      }

      // Officers
      foreach ($officers as $o) {
        $oid = (int)($o['user_id'] ?? 0);
        if ($oid <= 0) continue;

        $u = $uMap[$oid] ?? null;
        if (!$u) continue;

        $m = $memByUser[$oid] ?? null;

        $pos = (string)($o['position'] ?? '');
        if ($pos === '') {
          $r = (string)($u['role'] ?? '');
          $pos = is_role_based_officer($r) ? officer_label_from_role($r) : 'Officer';
        }

        $rows[] = [
          'membership_id' => $m ? (int)($m['id'] ?? 0) : 0,
          'student_user_id' => $oid,
          'id_number' => (string)($u['id_number'] ?? ''),
          'first_name' => (string)($u['first_name'] ?? ''),
          'middle_name' => (string)($u['middle_name'] ?? ''),
          'last_name' => (string)($u['last_name'] ?? ''),
          'suffix' => (string)($u['suffix'] ?? ''),
          'status' => $m ? (string)($m['status'] ?? 'Approved') : 'Approved',
          'fee_amount' => $m ? (float)($m['fee_amount'] ?? 0) : 0.00,
          'fee_paid' => $m ? (int)($m['fee_paid'] ?? 0) : 0,
          'fee_paid_at' => $m['fee_paid_at'] ?? null,
          'reviewed_by' => $m['reviewed_by'] ?? null,
          'reviewed_at' => $m['reviewed_at'] ?? ($o['created_at'] ?? null),
          'role' => 'Officer',
          'position' => $pos,
          'academic_term_id' => (int)($o['academic_term_id'] ?? 0),
        ];
      }

      usort($rows, function($a, $b) {
        $ra = (string)($a['reviewed_at'] ?? '');
        $rb = (string)($b['reviewed_at'] ?? '');
        if ($ra !== $rb) return ($ra < $rb) ? 1 : -1;
        $pa = (string)($a['fee_paid_at'] ?? '');
        $pb = (string)($b['fee_paid_at'] ?? '');
        if ($pa !== $pb) return ($pa < $pb) ? 1 : -1;
        return 0;
      });

      ok([
        'term' => $tg['active_term'],
        'term_group' => [
          'school_year' => $tg['school_year'],
          'term_ids' => $termIds,
          'canonical_term_id' => (int)$tg['canonical_term_id'],
        ],
        'rows' => $rows,
      ]);
    }

    case 'get_fee_records': {
      $orgId = (int)($input['org_id'] ?? 0);
      if ($orgId <= 0) err('Invalid org_id.', 400);

      $tg = get_active_term_group($pdo);
      if (!$tg) err('No active academic term found.', 409);

      $termIds = $tg['term_ids'];
      $canonicalTermId = (int)$tg['canonical_term_id'];
      $schoolYear = (string)$tg['school_year'];

      if (!get_club($pdo, $orgId)) err('Club not found.', 404);

      require_officer_like_access_year($pdo, $orgId, $schoolYear, $termIds, $uid);

      [$inSql, $inParams] = build_in_qmarks($termIds);

      $st = $pdo->prepare("
        SELECT
          r.id AS receipt_id,
          r.receipt_no,
          r.amount,
          r.paid_at,
          r.paid_by_user_id,
          r.created_at,
          m.id AS membership_id,
          m.academic_term_id,
          u.id AS student_user_id,
          u.id_number,
          u.first_name, u.middle_name, u.last_name, u.suffix
        FROM organization_membership_receipts r
        JOIN organization_memberships m ON m.id = r.membership_id
        JOIN users u ON u.id = m.student_user_id
        WHERE m.org_id = ?
          AND m.academic_term_id IN $inSql
          AND m.status = 'Approved'
        ORDER BY r.paid_at DESC, r.id DESC
      ");
      $st->execute(array_merge([(int)$orgId], $inParams));

      ok([
        'term' => $tg['active_term'],
        'term_group' => [
          'school_year' => $tg['school_year'],
          'term_ids' => $termIds,
          'canonical_term_id' => $canonicalTermId,
        ],
        'rows' => $st->fetchAll(PDO::FETCH_ASSOC) ?: [],
        'print_all_paid_url' => "php/print-club-paid-list.php?org_id={$orgId}&term_id={$canonicalTermId}&school_year=" . urlencode($tg['school_year']),
      ]);
    }

    case 'search_officers': {
      $orgId = (int)($input['org_id'] ?? 0);
      $q = trim((string)($input['q'] ?? ''));
      if ($orgId <= 0) err('Invalid org_id.', 400);

      $tg = get_active_term_group($pdo);
      if (!$tg) err('No active academic term found.', 409);

      $termIds = $tg['term_ids'];
      $schoolYear = (string)$tg['school_year'];

      if (!get_club($pdo, $orgId)) err('Club not found.', 404);

      require_officer_like_access_year($pdo, $orgId, $schoolYear, $termIds, $uid);

      // search officers by school_year join (not just termIds),
      // so you can find officers stored on the "other semester" term_id.
      $sy = trim($schoolYear);

      $sql = "
        SELECT
          o.user_id,
          o.position,
          o.academic_term_id,
          u.id_number,
          u.first_name, u.middle_name, u.last_name, u.suffix
        FROM organization_officers o
        JOIN users u ON u.id = o.user_id
        JOIN academic_terms t ON t.id = o.academic_term_id
        WHERE o.org_id = :org_id
          AND o.status = 'Active'
          AND o.user_id IS NOT NULL
          AND TRIM(t.school_year) = :sy
      ";
      $params = [
        ':org_id' => $orgId,
        ':sy' => $sy,
      ];

      if ($q !== '') {
        $sql .= " AND (
          u.id_number LIKE :lk
          OR u.first_name LIKE :lk
          OR u.middle_name LIKE :lk
          OR u.last_name LIKE :lk
          OR CONCAT_WS(' ', u.first_name, u.middle_name, u.last_name, u.suffix) LIKE :lk
          OR o.position LIKE :lk
        )";
        $params[':lk'] = '%' . $q . '%';
      }

      $sql .= " ORDER BY o.position ASC, u.last_name ASC, u.first_name ASC LIMIT 50";

      $st = $pdo->prepare($sql);
      $st->execute($params);

      ok([
        'term' => $tg['active_term'],
        'term_group' => [
          'school_year' => $tg['school_year'],
          'term_ids' => $termIds,
          'canonical_term_id' => (int)$tg['canonical_term_id'],
        ],
        'rows' => $st->fetchAll(PDO::FETCH_ASSOC) ?: [],
      ]);
    }

    default:
      err('Unknown action.', 400);
  }

} catch (\Throwable $e) {
  err('Server error: ' . $e->getMessage(), 500);
}
