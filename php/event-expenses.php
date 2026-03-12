<?php
declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');

session_start();

require_once __DIR__ . '/db.php'; // expects $pdo

if (!isset($pdo) || !($pdo instanceof PDO)) {
  http_response_code(500);
  echo json_encode(['success' => false, 'message' => 'PDO not initialized. Check php/db.php (expected $pdo).'], JSON_UNESCAPED_SLASHES);
  exit;
}
try { $pdo->exec("SET NAMES utf8mb4"); } catch (\Throwable $e) {}

/* =========================
   Upload config
   ========================= */
define('UPLOAD_BASE', 'assets/uploads');
define('EE_DIR', UPLOAD_BASE . '/event-expenses');
define('EE_RECEIPTS_DIR', EE_DIR . '/receipts');
define('EE_ACCOMP_DIR', EE_DIR . '/accomplishments');

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
function fail(string $msg, int $code = 400, array $extra = []): void {
  out(array_merge(['success' => false, 'message' => $msg], $extra), $code);
}

/* =========================
   Input helpers (JSON + multipart + QUERYSTRING)
   ✅ FIX: support GET query params too
   ========================= */
function read_json(): array {
  $raw = file_get_contents('php://input');
  $data = json_decode($raw ?: '[]', true);
  return is_array($data) ? $data : [];
}
function read_input(): array {
  $in = [];
  foreach ($_GET as $k => $v) $in[$k] = $v;

  $ct = (string)($_SERVER['CONTENT_TYPE'] ?? $_SERVER['HTTP_CONTENT_TYPE'] ?? '');

  if (stripos($ct, 'multipart/form-data') !== false) {
    foreach ($_POST as $k => $v) $in[$k] = $v;
    return $in;
  }

  $json = read_json();
  if ($json) {
    foreach ($json as $k => $v) $in[$k] = $v;
    return $in;
  }

  foreach ($_POST as $k => $v) $in[$k] = $v;
  return $in;
}

/* =========================
   Tiny getters with aliases
   ========================= */
function pick(array $in, array $keys, $default = null) {
  foreach ($keys as $k) {
    if (array_key_exists($k, $in)) return $in[$k];
  }
  return $default;
}
function s(array $in, array $keys, string $default = ''): string {
  return trim((string)pick($in, $keys, $default));
}
function i(array $in, array $keys, int $default = 0): int {
  $v = pick($in, $keys, $default);
  return (int)$v;
}
function f(array $in, array $keys, float $default = 0.0): float {
  $v = pick($in, $keys, $default);
  return (float)$v;
}

/* =========================
   Auth helpers
   ========================= */
function current_user_id(): int {
  return (int)($_SESSION['user_id'] ?? $_SESSION['id'] ?? 0);
}
function current_role(): string {
  return strtolower((string)($_SESSION['role'] ?? ''));
}
function is_logged_in(): bool {
  return current_user_id() > 0;
}

/* =========================
   Role rules
   ========================= */
function is_admin_like(string $role): bool {
  $role = strtolower($role);
  return in_array($role, ['moderator', 'super_admin', 'overseer', 'special_admin', 'faculty_admin'], true);
}
function can_review_events_role(string $role): bool {
  $role = strtolower($role);
  return in_array($role, ['super_admin', 'overseer', 'special_admin', 'faculty_admin', 'moderator'], true);
}
function is_officer_role(string $role): bool {
  $role = strtolower($role);
  return in_array($role, ['org_president', 'treasurer', 'org_officer', 'officer'], true);
}
function is_super_viewer(string $role): bool {
  $role = strtolower($role);
  return in_array($role, ['overseer', 'super_admin', 'special_admin'], true);
}

/* =========================
   Schema helpers
   ========================= */
function has_column(PDO $pdo, string $table, string $col): bool {
  static $cache = [];
  $key = strtolower($table . '.' . $col);
  if (array_key_exists($key, $cache)) return $cache[$key];

  $st = $pdo->prepare("
    SELECT 1
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = :t
      AND COLUMN_NAME = :c
    LIMIT 1
  ");
  $st->execute([':t' => $table, ':c' => $col]);
  $cache[$key] = (bool)$st->fetchColumn();
  return $cache[$key];
}

function is_valid_ymd(string $d): bool {
  if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $d)) return false;
  [$y,$m,$day] = array_map('intval', explode('-', $d));
  return checkdate($m, $day, $y);
}

/* =========================
   Handling admin
   ========================= */
function is_handling_admin_for_org(PDO $pdo, int $orgId, int $uid): bool {
  if ($orgId <= 0 || $uid <= 0) return false;
  if (!has_column($pdo, 'organizations', 'created_by')) return false;

  $st = $pdo->prepare("SELECT 1 FROM organizations WHERE id=:org AND created_by=:uid LIMIT 1");
  $st->execute([':org' => $orgId, ':uid' => $uid]);
  return (bool)$st->fetchColumn();
}

/* =========================
   Term helpers
   ========================= */

function get_term_by_id(PDO $pdo, int $termId): ?array {
  if ($termId <= 0) return null;
  $st = $pdo->prepare("
    SELECT id, school_year, semester, status
    FROM academic_terms
    WHERE id = :id
    LIMIT 1
  ");
  $st->execute([':id' => $termId]);
  $t = $st->fetch();
  if (!$t) return null;

  return [
    'id' => (int)$t['id'],
    'school_year' => (string)$t['school_year'],
    'semester' => (string)$t['semester'],
    'status' => (string)$t['status'],
    'label' => (string)$t['school_year'] . ' ' . (string)$t['semester'],
  ];
}
   
function get_active_term(PDO $pdo): ?array {
  $st = $pdo->query("
    SELECT id, school_year, semester
    FROM academic_terms
    WHERE status='Active'
    ORDER BY id DESC
    LIMIT 1
  ");
  $t = $st->fetch();
  if (!$t) return null;

  return [
    'id' => (int)$t['id'],
    'school_year' => (string)$t['school_year'],
    'semester' => (string)$t['semester'],
    'label' => (string)$t['school_year'] . ' ' . (string)$t['semester'],
  ];
}

/* =========================
   Program helpers
   ✅ In educorev2: users.program stores abbreviation like "BSIT"
   ========================= */
function get_user_full_name(PDO $pdo, int $uid): string {
  if ($uid <= 0) return '';
  $st = $pdo->prepare("
    SELECT TRIM(CONCAT_WS(' ',
      COALESCE(first_name,''),
      NULLIF(COALESCE(middle_name,''),''),
      COALESCE(last_name,''),
      NULLIF(COALESCE(suffix,''),'')
    )) AS full_name
    FROM users
    WHERE id = :id
    LIMIT 1
  ");
  $st->execute([':id' => $uid]);
  return trim((string)($st->fetchColumn() ?: ''));
}

/**
 * Officer-match WHERE snippet:
 * - matches by oo.user_id = :uid
 * - OR if oo.user_id is NULL, matches oo.full_name to the user's computed full name
 */
function officer_match_where(string $alias = 'oo'): string {
  $a = preg_replace('/[^a-zA-Z0-9_]/', '', $alias);
  if ($a === '') $a = 'oo';
  return "
    (
      {$a}.user_id = :uid
      OR (
        {$a}.user_id IS NULL
        AND TRIM(COALESCE({$a}.full_name,'')) <> ''
        AND UPPER(TRIM({$a}.full_name)) = UPPER(TRIM(:uname))
      )
    )
  ";
}
   
function get_user_program_abbr(PDO $pdo, int $uid): ?string {
  if ($uid <= 0) return null;

  // Preferred: users.program (e.g., "BSIT")
  if (has_column($pdo, 'users', 'program')) {
    $st = $pdo->prepare("SELECT program FROM users WHERE id=:id LIMIT 1");
    $st->execute([':id' => $uid]);
    $abbr = trim((string)($st->fetchColumn() ?: ''));
    return $abbr !== '' ? $abbr : null;
  }

  // Fallback: users.program_id -> programs.abbreviation
  if (has_column($pdo, 'users', 'program_id') && has_column($pdo, 'programs', 'abbreviation')) {
    $st = $pdo->prepare("
      SELECT p.abbreviation
      FROM users u
      LEFT JOIN programs p ON p.id = u.program_id
      WHERE u.id=:id
      LIMIT 1
    ");
    $st->execute([':id' => $uid]);
    $abbr = trim((string)($st->fetchColumn() ?: ''));
    return $abbr !== '' ? $abbr : null;
  }

  return null;
}

/* =========================
   Financial helpers
   ========================= */
function calculate_current_balance(PDO $pdo, int $eventId): float {
  $stCredits = $pdo->prepare("SELECT COALESCE(SUM(amount), 0) FROM event_credits WHERE event_id = :eid");
  $stCredits->execute([':eid' => $eventId]);
  $totalCredits = (float)$stCredits->fetchColumn();
  
  $stDebits = $pdo->prepare("SELECT COALESCE(SUM(amount), 0) FROM event_debits WHERE event_id = :eid");
  $stDebits->execute([':eid' => $eventId]);
  $totalDebits = (float)$stDebits->fetchColumn();
  
  return $totalCredits - $totalDebits;
}

function check_sufficient_funds(PDO $pdo, int $eventId, float $proposedDebit): bool {
  $currentBalance = calculate_current_balance($pdo, $eventId);
  return ($currentBalance - $proposedDebit) >= -500; // Allow small negative (-500) but warn
}


/* =========================
   Accomplishment helpers
   ========================= */

/**
 * Get the term ID for an event
 */
function ee_event_term_id(PDO $pdo, array $event): int {
  // Extract school year and active year from event
  $startYear = (int)($event['start_year'] ?? 0);
  $endYear = (int)($event['end_year'] ?? 0);
  $activeYear = (int)($event['active_year'] ?? 1);
  
  if ($startYear <= 0 || $endYear <= 0) {
    return 0;
  }
  
  $schoolYear = $startYear . '-' . $endYear;
  $semester = active_year_to_semester($activeYear);
  
  // Find the term ID
  $st = $pdo->prepare("
    SELECT id FROM academic_terms 
    WHERE school_year = :sy AND semester = :sem 
    LIMIT 1
  ");
  $st->execute([':sy' => $schoolYear, ':sem' => $semester]);
  
  return (int)($st->fetchColumn() ?: 0);
}

/**
 * Get officer by position
 */
function ee_get_officer(PDO $pdo, int $orgId, int $termId, string $position): ?array {
  if ($orgId <= 0 || $termId <= 0) return null;
  
  $st = $pdo->prepare("
    SELECT oo.*, 
           TRIM(CONCAT_WS(' ',
             COALESCE(u.first_name, ''),
             NULLIF(COALESCE(u.middle_name, ''), ''),
             COALESCE(u.last_name, ''),
             NULLIF(COALESCE(u.suffix, ''), '')
           )) AS user_full_name
    FROM organization_officers oo
    LEFT JOIN users u ON u.id = oo.user_id
    WHERE oo.org_id = :org_id 
      AND oo.academic_term_id = :term_id
      AND LOWER(oo.position) LIKE :position
      AND oo.status = 'Active'
    LIMIT 1
  ");
  
  $st->execute([
    ':org_id' => $orgId,
    ':term_id' => $termId,
    ':position' => '%' . strtolower($position) . '%'
  ]);
  
  $row = $st->fetch(PDO::FETCH_ASSOC);
  if (!$row) return null;
  
  return [
    'user_id' => (int)($row['user_id'] ?? 0),
    'full_name' => (string)($row['user_full_name'] ?? $row['full_name'] ?? ''),
    'position' => (string)($row['position'] ?? ''),
  ];
}

/**
 * Get organization president
 */
function get_org_president(PDO $pdo, int $orgId, int $termId): ?array {
  return ee_get_officer($pdo, $orgId, $termId, 'president');
}

/**
 * Get active signature file for a user
 */
function ee_get_active_signature_file(PDO $pdo, int $userId): ?string {
  if ($userId <= 0) return null;
  
  $st = $pdo->prepare("
    SELECT signature_file 
    FROM e_signatures 
    WHERE user_id = :uid AND status = 'Active'
    ORDER BY updated_at DESC
    LIMIT 1
  ");
  $st->execute([':uid' => $userId]);
  
  return $st->fetchColumn() ?: null;
}

/**
 * Visible org list for current user's "cards / dropdown"
 * - Students: officer orgs (SY-based) + memberships (SY-based) + program-wired orgs + ✅ ALL GENERAL NON-CLUB ORGS
 * - Admin reviewers: only handled orgs (created_by) if column exists
 * - Super viewers: all orgs
 * Note: clubs remain members/officers-only (unless handling admin / super viewer)
 */


function fetch_visible_orgs_for_active_term(PDO $pdo, int $uid, string $role): array {
  if ($uid <= 0) return [];
  $term = get_active_term($pdo);
  if (!$term) return [];

  $sy = trim((string)$term['school_year']);
  if ($sy === '') return [];

  $hasCreatedBy = has_column($pdo, 'organizations', 'created_by');
  $hasScope     = has_column($pdo, 'organizations', 'scope');
  $hasOrgType   = has_column($pdo, 'organizations', 'org_type');

  $uname = get_user_full_name($pdo, $uid);

  // ✅ Officer org picker - use school year, not specific term
  if (is_officer_role($role)) {
    $st = $pdo->prepare("
      SELECT DISTINCT o.id, o.org_name, o.abbreviation, COALESCE(o.org_type,'') AS org_type
      FROM organizations o
      INNER JOIN organization_officers oo ON oo.org_id = o.id
      INNER JOIN academic_terms t ON t.id = oo.academic_term_id
      WHERE " . officer_match_where('oo') . "
        AND oo.status = 'Active'
        AND t.school_year = :sy
        AND (LOWER(COALESCE(o.status,'')) IN ('active','approved') OR COALESCE(o.status,'') = '')
      ORDER BY o.org_name ASC, o.id ASC
    ");
    $st->execute([':uid' => $uid, ':uname' => $uname, ':sy' => $sy]);

    $out = [];
    while ($r = $st->fetch()) {
      $out[] = [
        'id' => (int)$r['id'],
        'org_name' => (string)$r['org_name'],
        'abbreviation' => (string)$r['abbreviation'],
        'org_type' => strtolower((string)($r['org_type'] ?? '')),
        'label' => trim((string)$r['org_name'] . (!empty($r['abbreviation']) ? ' (' . (string)$r['abbreviation'] . ')' : '')),
      ];
    }
    return $out;
  }

  // org.program_id exists + programs.abbreviation exists + user has program (or program_id)
  $hasOrgProgram = has_column($pdo, 'organizations', 'program_id') && has_column($pdo, 'programs', 'abbreviation');
  $userProgAbbr = null;
  if ($hasOrgProgram) $userProgAbbr = get_user_program_abbr($pdo, $uid);

  if (is_super_viewer($role)) {
    $st = $pdo->query("
      SELECT id, org_name, abbreviation, COALESCE(org_type,'') AS org_type
      FROM organizations
      WHERE (LOWER(COALESCE(status,'')) IN ('active','approved') OR COALESCE(status,'') = '')
      ORDER BY org_name ASC, id ASC
    ");
    $out = [];
    while ($r = $st->fetch()) {
      $out[] = [
        'id' => (int)$r['id'],
        'org_name' => (string)$r['org_name'],
        'abbreviation' => (string)$r['abbreviation'],
        'org_type' => strtolower((string)($r['org_type'] ?? '')),
        'label' => trim((string)$r['org_name'] . (!empty($r['abbreviation']) ? ' (' . (string)$r['abbreviation'] . ')' : '')),
      ];
    }
    return $out;
  }

  if (can_review_events_role($role) && $hasCreatedBy) {
    $st = $pdo->prepare("
      SELECT id, org_name, abbreviation, COALESCE(org_type,'') AS org_type
      FROM organizations
      WHERE created_by = :uid
        AND (LOWER(COALESCE(status,'')) IN ('active','approved') OR COALESCE(status,'') = '')
      ORDER BY org_name ASC, id ASC
    ");
    $st->execute([':uid' => $uid]);
    $out = [];
    while ($r = $st->fetch()) {
      $out[] = [
        'id' => (int)$r['id'],
        'org_name' => (string)$r['org_name'],
        'abbreviation' => (string)$r['abbreviation'],
        'org_type' => strtolower((string)($r['org_type'] ?? '')),
        'label' => trim((string)$r['org_name'] . (!empty($r['abbreviation']) ? ' (' . (string)$r['abbreviation'] . ')' : '')),
      ];
    }
    return $out;
  }

  $union = [];

  // ✅ officer orgs (SY-based) with fallback match
  $union[] = "
    SELECT DISTINCT o.id, o.org_name, o.abbreviation, COALESCE(o.org_type,'') AS org_type
    FROM organization_officers oo
    INNER JOIN academic_terms t ON t.id = oo.academic_term_id
    INNER JOIN organizations o ON o.id = oo.org_id
    WHERE " . officer_match_where('oo') . "
      AND oo.status = 'Active'
      AND t.school_year = :sy_off
  ";

  $union[] = "
    SELECT DISTINCT o.id, o.org_name, o.abbreviation, COALESCE(o.org_type,'') AS org_type
    FROM organization_memberships om
    INNER JOIN academic_terms t ON t.id = om.academic_term_id
    INNER JOIN organizations o ON o.id = om.org_id
    WHERE om.student_user_id = :u_mem
      AND t.school_year = :sy_mem
  ";

  if ($hasOrgProgram && $userProgAbbr !== null) {
    $union[] = "
      SELECT DISTINCT o.id, o.org_name, o.abbreviation, COALESCE(o.org_type,'') AS org_type
      FROM organizations o
      INNER JOIN programs p ON p.id = o.program_id
      WHERE p.abbreviation = :u_prog_abbr
        AND LOWER(COALESCE(o.org_type,'')) <> 'club'
    ";
  }

  // ✅ include ALL GENERAL (public) NON-CLUB organizations
  if ($hasScope && $hasOrgType) {
    $union[] = "
      SELECT DISTINCT o.id, o.org_name, o.abbreviation, COALESCE(o.org_type,'') AS org_type
      FROM organizations o
      WHERE LOWER(COALESCE(o.org_type,'')) <> 'club'
        AND LOWER(COALESCE(o.scope,'')) = 'general'
    ";
  } elseif ($hasScope) {
    $union[] = "
      SELECT DISTINCT o.id, o.org_name, o.abbreviation, '' AS org_type
      FROM organizations o
      WHERE LOWER(COALESCE(o.scope,'')) = 'general'
    ";
  }

  $sql = "
    SELECT DISTINCT x.id, x.org_name, x.abbreviation, x.org_type
    FROM (
      " . implode("\nUNION\n", $union) . "
    ) x
    INNER JOIN organizations o2 ON o2.id = x.id
    WHERE (LOWER(COALESCE(o2.status,'')) IN ('active','approved') OR COALESCE(o2.status,'') = '')
    ORDER BY x.org_name ASC, x.id ASC
  ";

  $st = $pdo->prepare($sql);
  $params = [
    ':uid' => $uid,
    ':uname' => $uname,
    ':sy_off' => $sy,
    ':u_mem' => $uid,
    ':sy_mem' => $sy,
  ];
  if ($hasOrgProgram && $userProgAbbr !== null) $params[':u_prog_abbr'] = $userProgAbbr;

  $st->execute($params);

  $out = [];
  while ($r = $st->fetch()) {
    $out[] = [
      'id' => (int)$r['id'],
      'org_name' => (string)$r['org_name'],
      'abbreviation' => (string)$r['abbreviation'],
      'org_type' => strtolower((string)($r['org_type'] ?? '')),
      'label' => trim((string)$r['org_name'] . (!empty($r['abbreviation']) ? ' (' . (string)$r['abbreviation'] . ')' : '')),
    ];
  }
  return $out;
}

/**
 * Fetch passbook entries for a specific event (treasurer's manual entries only)
 */
function fetch_passbook_for_event(PDO $pdo, int $eventId): array {
  try {
    $st = $pdo->prepare("
      SELECT 
        p.id,
        p.txn_date,
        p.txn_type,
        p.title,
        p.notes,
        p.amount_in,
        p.amount_out,
        p.balance_after,
        p.recorded_by_user_id,
        p.created_at,
        p.event_id,
        p.ref_table,
        p.ref_id,
        CASE WHEN p.ref_table = 'manual' THEN 1 ELSE 0 END as is_manual,
        TRIM(CONCAT_WS(' ',
          COALESCE(u.first_name, ''),
          NULLIF(COALESCE(u.middle_name, ''), ''),
          COALESCE(u.last_name, ''),
          NULLIF(COALESCE(u.suffix, ''), '')
        )) AS recorded_by_name
      FROM passbook_logs p
      LEFT JOIN users u ON u.id = p.recorded_by_user_id
      WHERE p.event_id = :eid
      ORDER BY p.txn_date ASC, p.created_at ASC
    ");
    $st->execute([':eid' => $eventId]);
    
    $rows = [];
    while ($r = $st->fetch(PDO::FETCH_ASSOC)) {
      $rows[] = [
        'id' => (int)($r['id'] ?? 0),
        'event_id' => (int)($r['event_id'] ?? 0),
        'date' => (string)($r['txn_date'] ?? ''),
        'txn_date' => (string)($r['txn_date'] ?? ''),
        'type' => (string)($r['txn_type'] ?? ''),
        'txn_type' => (string)($r['txn_type'] ?? ''),
        'title' => (string)($r['title'] ?? ''),
        'notes' => (string)($r['notes'] ?? ''),
        'description' => trim((string)($r['title'] ?? '') . (empty($r['notes'] ?? '') ? '' : ' - ' . (string)($r['notes'] ?? ''))),
        'amount_in' => (float)($r['amount_in'] ?? 0),
        'amount_out' => (float)($r['amount_out'] ?? 0),
        'balance_after' => (float)($r['balance_after'] ?? 0),
        'recorded_by_user_id' => (int)($r['recorded_by_user_id'] ?? 0),
        'recorded_by_name' => (string)($r['recorded_by_name'] ?? ''),
        'ref_table' => (string)($r['ref_table'] ?? ''),
        'ref_id' => (int)($r['ref_id'] ?? 0),
        'is_manual' => (bool)($r['is_manual'] ?? false),
        'created_at' => (string)($r['created_at'] ?? ''),
      ];
    }
    return $rows;
    
  } catch (PDOException $e) {
    error_log("fetch_passbook_for_event error: " . $e->getMessage());
    return [];
  }
}

function fetch_visible_orgs_for_school_year(PDO $pdo, int $uid, string $role, string $schoolYear): array {
  if ($uid <= 0) return [];
  $sy = trim($schoolYear);
  if ($sy === '') return [];

  $hasCreatedBy = has_column($pdo, 'organizations', 'created_by');
  $hasScope     = has_column($pdo, 'organizations', 'scope');
  $hasOrgType   = has_column($pdo, 'organizations', 'org_type');

  $uname = get_user_full_name($pdo, $uid);

  // Super viewers: all orgs
  if (is_super_viewer($role)) {
    $st = $pdo->query("
      SELECT id, org_name, abbreviation, COALESCE(org_type,'') AS org_type
      FROM organizations
      WHERE (LOWER(COALESCE(status,'')) IN ('active','approved') OR COALESCE(status,'') = '')
      ORDER BY org_name ASC, id ASC
    ");
    $out = [];
    while ($r = $st->fetch()) {
      $out[] = [
        'id' => (int)$r['id'],
        'org_name' => (string)$r['org_name'],
        'abbreviation' => (string)$r['abbreviation'],
        'org_type' => strtolower((string)($r['org_type'] ?? '')),
        'label' => trim((string)$r['org_name'] . (!empty($r['abbreviation']) ? ' (' . (string)$r['abbreviation'] . ')' : '')),
      ];
    }
    return $out;
  }

  // Admin reviewers: handled orgs (created_by)
  if (can_review_events_role($role) && $hasCreatedBy) {
    $st = $pdo->prepare("
      SELECT id, org_name, abbreviation, COALESCE(org_type,'') AS org_type
      FROM organizations
      WHERE created_by = :uid
        AND (LOWER(COALESCE(status,'')) IN ('active','approved') OR COALESCE(status,'') = '')
      ORDER BY org_name ASC, id ASC
    ");
    $st->execute([':uid' => $uid]);
    $out = [];
    while ($r = $st->fetch()) {
      $out[] = [
        'id' => (int)$r['id'],
        'org_name' => (string)$r['org_name'],
        'abbreviation' => (string)$r['abbreviation'],
        'org_type' => strtolower((string)($r['org_type'] ?? '')),
        'label' => trim((string)$r['org_name'] . (!empty($r['abbreviation']) ? ' (' . (string)$r['abbreviation'] . ')' : '')),
      ];
    }
    return $out;
  }

  // Students: officer orgs + memberships for that SY + general orgs
  $union = [];

  $union[] = "
    SELECT DISTINCT o.id, o.org_name, o.abbreviation, COALESCE(o.org_type,'') AS org_type
    FROM organization_officers oo
    INNER JOIN academic_terms t ON t.id = oo.academic_term_id
    INNER JOIN organizations o ON o.id = oo.org_id
    WHERE " . officer_match_where('oo') . "
      AND oo.status = 'Active'
      AND t.school_year = :sy
  ";

  $union[] = "
    SELECT DISTINCT o.id, o.org_name, o.abbreviation, COALESCE(o.org_type,'') AS org_type
    FROM organization_memberships om
    INNER JOIN academic_terms t ON t.id = om.academic_term_id
    INNER JOIN organizations o ON o.id = om.org_id
    WHERE om.student_user_id = :uid_mem
      AND t.school_year = :sy
  ";

  if ($hasScope && $hasOrgType) {
    $union[] = "
      SELECT DISTINCT o.id, o.org_name, o.abbreviation, COALESCE(o.org_type,'') AS org_type
      FROM organizations o
      WHERE LOWER(COALESCE(o.org_type,'')) <> 'club'
        AND LOWER(COALESCE(o.scope,'')) = 'general'
    ";
  } elseif ($hasScope) {
    $union[] = "
      SELECT DISTINCT o.id, o.org_name, o.abbreviation, '' AS org_type
      FROM organizations o
      WHERE LOWER(COALESCE(o.scope,'')) = 'general'
    ";
  }

  $sql = "
    SELECT DISTINCT x.id, x.org_name, x.abbreviation, x.org_type
    FROM (
      " . implode("\nUNION\n", $union) . "
    ) x
    INNER JOIN organizations o2 ON o2.id = x.id
    WHERE (LOWER(COALESCE(o2.status,'')) IN ('active','approved') OR COALESCE(o2.status,'') = '')
    ORDER BY x.org_name ASC, x.id ASC
  ";

  $st = $pdo->prepare($sql);
  $st->execute([
    ':uid' => $uid,
    ':uname' => $uname,
    ':uid_mem' => $uid,
    ':sy' => $sy,
  ]);

  $out = [];
  while ($r = $st->fetch()) {
    $out[] = [
      'id' => (int)$r['id'],
      'org_name' => (string)$r['org_name'],
      'abbreviation' => (string)$r['abbreviation'],
      'org_type' => strtolower((string)($r['org_type'] ?? '')),
      'label' => trim((string)$r['org_name'] . (!empty($r['abbreviation']) ? ' (' . (string)$r['abbreviation'] . ')' : '')),
    ];
  }
  return $out;
}

function parse_school_year(string $sy): array {
  $sy = trim($sy);
  if (!preg_match('/^(\d{4})\s*-\s*(\d{4})$/', $sy, $m)) return [0, 0];
  return [(int)$m[1], (int)$m[2]];
}

function school_year_from_years(int $syStart, int $syEnd): string {
  if ($syStart <= 0 || $syEnd <= 0) return '';
  return $syStart . '-' . $syEnd;
}

/* =========================
   Semester <-> active_year
   ========================= */
function semester_to_active_year(string $sem): int {
  $x = strtolower(trim($sem));
  if ($x === '1st' || $x === 'first' || str_contains($x, '1st') || preg_match('/\b1\b/', $x)) return 1;
  if ($x === '2nd' || $x === 'second' || str_contains($x, '2nd') || preg_match('/\b2\b/', $x)) return 2;
  if ($x === 'summer' || str_contains($x, 'summer')) return 3;
  if (is_numeric($x)) return (int)$x;
  return 1;
}

function active_year_to_semester(int $ay): string {
  if ($ay === 2) return '2nd';
  if ($ay === 3) return 'Summer';
  return '1st';
}

/* =========================
   URL helper
   ========================= */
function app_base(): string {
  $script = (string)($_SERVER['SCRIPT_NAME'] ?? '');
  $dir = rtrim(str_replace('\\', '/', dirname($script)), '/');
  if (preg_match('~/php$~', $dir)) $dir = preg_replace('~/php$~', '', $dir) ?: '';
  return $dir === '' ? '' : $dir;
}

function public_url(?string $relPath): ?string {
  $rel = trim((string)($relPath ?? ''));
  if ($rel === '') return null;
  $rel = ltrim($rel, '/');
  $base = app_base();
  return ($base === '' ? '' : $base) . '/' . $rel;
}

/* =========================
   Draft visibility gate
   ✅ Drafts are officers-only (no faculty_admin / special_admin / super_admin / overseer)
   ✅ Implementation:
      - Draft is visible only to:
        * the author_user_id, OR
        * an active officer of that org in that event's school year
   ========================= */
function can_view_draft_event(PDO $pdo, array $e, int $uid, string $role): bool {
  if ($uid <= 0) return false;

  $authorId = (int)($e['author_user_id'] ?? 0);
  if ($authorId > 0 && $authorId === $uid) return true;

  $orgId = (int)($e['org_id'] ?? 0);
  if ($orgId <= 0) {
    // general drafts: only the author can see
    return false;
  }

  $sy = school_year_from_years((int)($e['start_year'] ?? 0), (int)($e['end_year'] ?? 0));
  if ($sy === '') return false;

  $uname = get_user_full_name($pdo, $uid);

  $st = $pdo->prepare("
    SELECT 1
    FROM organization_officers oo
    INNER JOIN academic_terms t ON t.id = oo.academic_term_id
    WHERE oo.org_id = :org
      AND " . officer_match_where('oo') . "
      AND oo.status = 'Active'
      AND t.school_year = :sy
    LIMIT 1
  ");
  $st->execute([':org' => $orgId, ':uid' => $uid, ':uname' => $uname, ':sy' => $sy]);
  return (bool)$st->fetchColumn();
}

/* =========================
   Org + officer checks
   ========================= */
function org_exists(PDO $pdo, int $orgId): bool {
  if ($orgId <= 0) return false;
  $st = $pdo->prepare("SELECT 1 FROM organizations WHERE id=:id LIMIT 1");
  $st->execute([':id' => $orgId]);
  return (bool)$st->fetchColumn();
}

function is_student_officer_for_org_active_term(PDO $pdo, int $orgId, int $userId): bool {
  if ($orgId <= 0 || $userId <= 0) return false;

  $term = get_active_term($pdo);
  if (!$term) return false;

  $sy = trim((string)$term['school_year']);
  if ($sy === '') return false;

  $uname = get_user_full_name($pdo, $userId);

  $st = $pdo->prepare("
    SELECT 1
    FROM organization_officers oo
    INNER JOIN academic_terms t ON t.id = oo.academic_term_id
    WHERE oo.org_id = :org_id
      AND " . officer_match_where('oo') . "
      AND oo.status = 'Active'
      AND t.school_year = :sy
    LIMIT 1
  ");
  $st->execute([
    ':org_id' => $orgId,
    ':uid' => $userId,
    ':uname' => $uname,
    ':sy' => $sy,
  ]);
  return (bool)$st->fetchColumn();
}

function is_org_officer_for_org_active_sy(PDO $pdo, int $orgId, int $userId): bool {
  if ($orgId <= 0 || $userId <= 0) return false;

  $term = get_active_term($pdo);
  if (!$term) return false;

  $sy = trim((string)$term['school_year']);
  if ($sy === '') return false;

  $uname = get_user_full_name($pdo, $userId);

  $st = $pdo->prepare("
    SELECT 1
    FROM organization_officers oo
    INNER JOIN academic_terms t ON t.id = oo.academic_term_id
    WHERE oo.org_id = :org_id
      AND " . officer_match_where('oo') . "
      AND oo.status = 'Active'
      AND t.school_year = :sy
    LIMIT 1
  ");
  $st->execute([
    ':org_id' => $orgId,
    ':uid' => $userId,
    ':uname' => $uname,
    ':sy' => $sy,
  ]);
  return (bool)$st->fetchColumn();
}

function is_student_officer_any_org_active_sy(PDO $pdo, int $userId): bool {
  if ($userId <= 0) return false;

  $term = get_active_term($pdo);
  if (!$term) return false;

  $sy = trim((string)$term['school_year']);
  if ($sy === '') return false;

  $uname = get_user_full_name($pdo, $userId);

  $st = $pdo->prepare("
    SELECT 1
    FROM organization_officers oo
    INNER JOIN academic_terms t ON t.id = oo.academic_term_id
    WHERE " . officer_match_where('oo') . "
      AND oo.status = 'Active'
      AND t.school_year = :sy
    LIMIT 1
  ");
  $st->execute([
    ':uid' => $userId,
    ':uname' => $uname,
    ':sy' => $sy,
  ]);
  return (bool)$st->fetchColumn();
}

function is_user_club_member_or_officer_for_sy(PDO $pdo, int $orgId, int $uid, string $schoolYear): bool {
  if ($orgId <= 0 || $uid <= 0 || trim($schoolYear) === '') return false;

  $uname = get_user_full_name($pdo, $uid);

  $stO = $pdo->prepare("
    SELECT 1
    FROM organization_officers oo
    INNER JOIN academic_terms t ON t.id = oo.academic_term_id
    WHERE oo.org_id = :org
      AND " . officer_match_where('oo') . "
      AND oo.status = 'Active'
      AND t.school_year = :sy
    LIMIT 1
  ");
  $stO->execute([':org' => $orgId, ':uid' => $uid, ':uname' => $uname, ':sy' => $schoolYear]);
  if ((bool)$stO->fetchColumn()) return true;

  $stM = $pdo->prepare("
    SELECT 1
    FROM organization_memberships om
    INNER JOIN academic_terms t ON t.id = om.academic_term_id
    INNER JOIN organizations o ON o.id = om.org_id
    WHERE om.org_id = :org
      AND om.student_user_id = :uid
      AND t.school_year = :sy
    LIMIT 1
  ");
  $stM->execute([':org' => $orgId, ':uid' => $uid, ':sy' => $schoolYear]);
  return (bool)$stM->fetchColumn();
}

function can_officer_manage_org(PDO $pdo, ?int $orgId, int $uid, string $role): bool {
  if ($uid <= 0) return false;

  if (!$orgId || $orgId <= 0) {
    if ($role === 'student') return is_student_officer_any_org_active_sy($pdo, $uid);
    return false;
  }

  if ($role === 'student') {
    return is_student_officer_for_org_active_term($pdo, (int)$orgId, $uid);
  }

  if (is_officer_role($role)) {
    return is_org_officer_for_org_active_sy($pdo, (int)$orgId, $uid);
  }

  return false;
}

function require_login(): void {
  if (!is_logged_in()) fail('Not authenticated.', 401);
}

function require_officer_for_expenses(PDO $pdo, int $orgId): void {
  require_login();
  $uid = current_user_id();
  $role = current_role();

  if ($orgId <= 0) {
    fail('Missing org_id.', 400, ['reason' => 'missing_org_id']);
  }

  if (!can_officer_manage_org($pdo, $orgId, $uid, $role)) {
    fail('Only organization officers can add event expenses.', 403, [
      'reason' => 'not_officer_for_org',
      'org_id' => $orgId,
    ]);
  }
}

/* =========================
   Read-only gating by term filter
   ========================= */
function normalize_school_year(string $sy): string {
  $sy = trim($sy);
  if (preg_match('/^(\d{4})\s*-\s*(\d{4})$/', $sy, $m)) {
    return $m[1] . '-' . $m[2];
  }
  return $sy;
}
function normalize_semester_to_ay(string $sem): int {
  $x = strtolower(trim($sem));
  if ($x === '1' || $x === '1st' || str_contains($x, 'first')) return 1;
  if ($x === '2' || $x === '2nd' || str_contains($x, 'second')) return 2;
  if ($x === 'summer' || str_contains($x, 'summer')) return 3;
  return semester_to_active_year($sem);
}
function is_active_filter(PDO $pdo, string $schoolYear, string $semester): bool {
  $term = get_active_term($pdo);
  if (!$term) return true;

  $syA = normalize_school_year((string)$term['school_year']);
  $syB = normalize_school_year($schoolYear);

  $ayA = normalize_semester_to_ay((string)$term['semester']);
  $ayB = normalize_semester_to_ay($semester);

  return ($syA === $syB) && ($ayA === $ayB);
}
function can_mutate_in_filter(PDO $pdo, string $sy, string $sem): bool {
  return is_active_filter($pdo, $sy, $sem);
}

/* =========================
   Event visibility gates
   ✅ Uses organizations.scope (General/Exclusive)
   ✅ Uses users.program (abbr) vs organizations.program_id -> programs.abbreviation
   ✅ Super viewers (overseer, super_admin, special_admin) can ONLY see fully approved events
   ✅ Normal students can ONLY see fully approved events
   ========================= */
function can_view_event(PDO $pdo, array $e, int $uid, string $role): bool {
  $role = strtolower($role);

  // ✅ DRAFTS are officers-only (author/officers) even if super viewer/admin
  if ((string)($e['status'] ?? '') === 'Draft') {
    return can_view_draft_event($pdo, $e, $uid, $role);
  }

  // ✅ SUPER VIEWERS (overseer, super_admin, special_admin) - strict filtering
  // They can ONLY see events with BOTH proposal AND accomplishment approved
  if (is_super_viewer($role)) {
    $proposalApproved = ((string)($e['status'] ?? '') === 'Approved');
    $accomplishmentApproved = ((string)($e['accomplishment_status'] ?? '') === 'Approved');
    return $proposalApproved && $accomplishmentApproved;
  }

  // ✅ NORMAL STUDENTS - can ONLY see fully approved events
  if ($role === 'student') {
    $proposalApproved = ((string)($e['status'] ?? '') === 'Approved');
    $accomplishmentApproved = ((string)($e['accomplishment_status'] ?? '') === 'Approved');
    
    // If not fully approved, student cannot see it
    if (!$proposalApproved || !$accomplishmentApproved) {
      return false;
    }
    
    // Even if fully approved, students still need org-based access rights
    // Continue with normal org-based visibility checks for students
  }

  // For all other roles, continue with normal visibility logic
  $orgId = (int)($e['org_id'] ?? 0);
  if ($orgId <= 0) return true;

  $hasOrgScope  = has_column($pdo, 'organizations', 'scope');
  $hasOrgProgId = has_column($pdo, 'organizations', 'program_id');
  $hasOrgType   = has_column($pdo, 'organizations', 'org_type');

  $select = "SELECT ";
  $select .= $hasOrgType ? "COALESCE(org_type,'') AS org_type" : "'' AS org_type";
  $select .= ", ";
  $select .= $hasOrgScope ? "COALESCE(scope,'') AS scope" : "'' AS scope";
  $select .= ", ";
  $select .= $hasOrgProgId ? "program_id" : "NULL AS program_id";
  $select .= " FROM organizations WHERE id=:id LIMIT 1";

  $st = $pdo->prepare($select);
  $st->execute([':id' => $orgId]);
  $org = $st->fetch() ?: [];

  $orgType  = strtolower((string)($org['org_type'] ?? ''));
  $orgScope = strtolower((string)($org['scope'] ?? ''));
  $orgPid   = ($org['program_id'] ?? null);
  $orgPid   = ($orgPid === null || $orgPid === '' ? 0 : (int)$orgPid);

  $isClub = ($orgType === 'club');

  if ($isClub) {
    $sy = school_year_from_years((int)($e['start_year'] ?? 0), (int)($e['end_year'] ?? 0));
    if ($sy === '') return false;

    if (is_user_club_member_or_officer_for_sy($pdo, $orgId, $uid, $sy)) return true;
    if (is_handling_admin_for_org($pdo, $orgId, $uid)) return true;

    return false;
  }

  // Officers can see their orgs regardless of approval status
  if (is_officer_role($role)) return true;

  // Faculty/admin roles handled earlier
  if (can_review_events_role($role)) return true;

  // For students, we already checked approval status above
  // Now check org-based access
  if ($orgScope === 'general') return true;

  $sy = school_year_from_years((int)($e['start_year'] ?? 0), (int)($e['end_year'] ?? 0));
  if ($sy === '') return false;

  $uname = get_user_full_name($pdo, $uid);

  $stO = $pdo->prepare("
    SELECT 1
    FROM organization_officers oo
    INNER JOIN academic_terms t ON t.id = oo.academic_term_id
    WHERE oo.org_id = :org
      AND " . officer_match_where('oo') . "
      AND oo.status = 'Active'
      AND t.school_year = :sy
    LIMIT 1
  ");
  $stO->execute([':org' => $orgId, ':uid' => $uid, ':uname' => $uname, ':sy' => $sy]);
  if ((bool)$stO->fetchColumn()) return true;

  if (is_handling_admin_for_org($pdo, $orgId, $uid)) return true;

  if ($role === 'student' && $orgPid > 0 && has_column($pdo, 'programs', 'abbreviation')) {
    $uAbbr = get_user_program_abbr($pdo, $uid);
    if ($uAbbr !== null) {
      $stP = $pdo->prepare("
        SELECT 1
        FROM programs p
        WHERE p.id = :pid AND p.abbreviation = :abbr
        LIMIT 1
      ");
      $stP->execute([':pid' => $orgPid, ':abbr' => $uAbbr]);
      if ((bool)$stP->fetchColumn()) return true;
    }
  }

  return false;
}

  /* =========================
   Get faculty_admin (org coordinator/creator)
   ========================= */
function get_org_coordinator(PDO $pdo, int $orgId): ?array {
  if ($orgId <= 0) return null;

  // First, try to get the faculty_admin who created the org
  $st = $pdo->prepare("
    SELECT u.id, u.first_name, u.middle_name, u.last_name, u.suffix
    FROM organizations o
    INNER JOIN users u ON u.id = o.created_by
    WHERE o.id = :org_id
      AND u.role = 'faculty_admin'
      AND u.status = 'Active'
    LIMIT 1
  ");
  $st->execute([':org_id' => $orgId]);
  $row = $st->fetch(PDO::FETCH_ASSOC);
  
  if ($row) {
    $id = (int)($row['id'] ?? 0);
    $fn = trim((string)($row['first_name'] ?? ''));
    $mn = trim((string)($row['middle_name'] ?? ''));
    $ln = trim((string)($row['last_name'] ?? ''));
    $sx = trim((string)($row['suffix'] ?? ''));
    
    $name = trim($fn . ' ' . ($mn !== '' ? mb_substr($mn, 0, 1) . '. ' : '') . $ln . ($sx !== '' ? ' ' . $sx : ''));
    if ($name === '') $name = '—';
    
    return ['id' => $id, 'name' => $name];
  }
  
  // Fallback: find any active faculty_admin (though this is less accurate)
  $st = $pdo->prepare("
    SELECT id, first_name, middle_name, last_name, suffix
    FROM users
    WHERE role = 'faculty_admin' AND status = 'Active'
    ORDER BY last_login_at DESC, id DESC
    LIMIT 1
  ");
  $st->execute();
  $row = $st->fetch(PDO::FETCH_ASSOC);
  
  if ($row) {
    $id = (int)($row['id'] ?? 0);
    $fn = trim((string)($row['first_name'] ?? ''));
    $mn = trim((string)($row['middle_name'] ?? ''));
    $ln = trim((string)($row['last_name'] ?? ''));
    $sx = trim((string)($row['suffix'] ?? ''));
    
    $name = trim($fn . ' ' . ($mn !== '' ? mb_substr($mn, 0, 1) . '. ' : '') . $ln . ($sx !== '' ? ' ' . $sx : ''));
    if ($name === '') $name = '—';
    
    return ['id' => $id, 'name' => $name];
  }
  
  return null;
}

/* =========================
   Event fetch + totals
   ========================= */
function fetch_event(PDO $pdo, int $eventId): ?array {
  $st = $pdo->prepare("
    SELECT e.*
    FROM event_events e
    WHERE e.id = :id
    LIMIT 1
  ");
  $st->execute([':id' => $eventId]);
  $e = $st->fetch();
  if (!$e) return null;

  $e['id'] = (int)$e['id'];
  $e['org_id'] = $e['org_id'] !== null ? (int)$e['org_id'] : null;
  $e['active_year'] = (int)($e['active_year'] ?? 1);
  $e['start_year'] = (int)($e['start_year'] ?? 0);
  $e['end_year'] = (int)($e['end_year'] ?? 0);
  $e['author_user_id'] = (int)($e['author_user_id'] ?? 0);

  if (!array_key_exists('event_date', $e)) $e['event_date'] = '';
  if (!array_key_exists('description', $e)) $e['description'] = '';

  return $e;
}

// MODIFIED: event_totals now ONLY uses credits and debits, NOT passbook
function event_totals(PDO $pdo, int $eventId): array {
  $stC = $pdo->prepare("SELECT COALESCE(SUM(amount),0) AS s FROM event_credits WHERE event_id=:eid");
  $stC->execute([':eid' => $eventId]);
  $credits = (float)($stC->fetch()['s'] ?? 0);

  $stD = $pdo->prepare("SELECT COALESCE(SUM(amount),0) AS s FROM event_debits WHERE event_id=:eid");
  $stD->execute([':eid' => $eventId]);
  $debits = (float)($stD->fetch()['s'] ?? 0);

  return [
    'credits' => $credits,
    'debits' => $debits,
    'balance' => $credits - $debits, // Pure event financials
  ];
}

/* =========================
   Upload helpers
   ========================= */
function ensure_dir(string $dir): void {
  if (is_dir($dir)) return;
  if (!mkdir($dir, 0775, true) && !is_dir($dir)) {
    fail('Failed to create upload directory.', 500);
  }
}

function save_uploaded_file(string $fileKey, string $destDirRel, array $allowedExts, int $maxBytes): string {
  if (!isset($_FILES[$fileKey]) || !is_array($_FILES[$fileKey])) {
    fail("Missing upload file: {$fileKey}.", 400);
  }
  $f = $_FILES[$fileKey];
  if (($f['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK) {
    fail('Upload failed.', 400, ['upload_error' => (int)($f['error'] ?? -1)]);
  }
  $tmp = (string)($f['tmp_name'] ?? '');
  $name = (string)($f['name'] ?? 'file');
  $size = (int)($f['size'] ?? 0);

  if ($size <= 0) fail('Empty upload.', 400);
  if ($size > $maxBytes) fail('File too large.', 400);

  $ext = strtolower(pathinfo($name, PATHINFO_EXTENSION));
  if ($ext === '') $ext = 'bin';
  if (!in_array($ext, $allowedExts, true)) {
    fail('Invalid file type.', 400, ['ext' => $ext]);
  }

  $destRelDir = trim($destDirRel, '/');
  $destAbsDir = rtrim(__DIR__ . '/../' . $destRelDir, '/');

  ensure_dir($destAbsDir);

  $stamp = date('Ymd_His');
  $rand = bin2hex(random_bytes(4));
  $safe = preg_replace('/[^a-zA-Z0-9_\-\.]+/', '_', pathinfo($name, PATHINFO_FILENAME));
  $filename = "{$safe}_{$stamp}_{$rand}.{$ext}";

  $destAbs = $destAbsDir . '/' . $filename;

  if (!move_uploaded_file($tmp, $destAbs)) {
    fail('Failed to save uploaded file.', 500);
  }

  return $destRelDir . '/' . $filename;
}

/* =========================
   Gates
   ========================= */
function must_be_admin_reviewer(): void {
  require_login();
  $role = current_role();
  if (!can_review_events_role($role)) fail('Forbidden.', 403);
}

function must_be_officer_for_event(PDO $pdo, array $event): void {
  require_login();
  $uid = current_user_id();
  $role = current_role();

  $orgId = (int)($event['org_id'] ?? 0);
  if (!can_officer_manage_org($pdo, $orgId > 0 ? $orgId : null, $uid, $role)) {
    fail('Forbidden.', 403);
  }
}


function require_event_submitted(array $event): void {
  $st = (string)($event['status'] ?? '');
  $ac = (string)($event['accomplishment_status'] ?? '');

  // 🔒 Once accomplishment is approved, NOTHING should be editable
  if ($ac === 'Approved') {
    fail('This event is already finalized and is locked.', 403, [
      'reason' => 'event_locked',
      'status' => $st,
      'accomplishment_status' => $ac,
    ]);
  }

  // ✅ Allow entries when:
  // - Proposal is Approved (can add credits/debits/passbook)
  // - OR still in Draft/Submitted (for editing)
  // ❌ Only block if proposal is Declined or other invalid states
  $allowedStatuses = ['Draft', 'Submitted', 'Approved'];
  
  if (!in_array($st, $allowedStatuses, true)) {
    fail('Entries can only be added when the event status is Draft, Submitted, or Approved.', 403, [
      'reason' => 'event_not_editable',
      'status' => $st,
      'accomplishment_status' => $ac,
    ]);
  }
}

function require_proposal_approved(array $event): void {
  if ((string)($event['status'] ?? '') !== 'Approved') {
    fail('Proposal not approved yet.', 403, ['reason' => 'proposal_not_approved']);
  }
}

/* =========================
   Idempotency helpers
   ========================= */
function idem_key_from_input(array $in): string {
  $rid = trim((string)($in['request_id'] ?? $in['client_request_id'] ?? $in['nonce'] ?? ''));
  if ($rid !== '' && strlen($rid) > 120) $rid = substr($rid, 0, 120);
  return $rid;
}
function idem_get(string $bucket, int $uid, string $rid): ?int {
  if ($uid <= 0 || $rid === '') return null;
  if (!isset($_SESSION[$bucket]) || !is_array($_SESSION[$bucket])) return null;

  $entry = $_SESSION[$bucket]["{$uid}:{$rid}"] ?? null;
  if (!is_array($entry)) return null;

  $ts = (int)($entry['ts'] ?? 0);
  $eid = (int)($entry['event_id'] ?? 0);

  if ($ts > 0 && (time() - $ts) > 600) {
    unset($_SESSION[$bucket]["{$uid}:{$rid}"]);
    return null;
  }
  return $eid > 0 ? $eid : null;
}
function idem_set(string $bucket, int $uid, string $rid, int $eventId): void {
  if ($uid <= 0 || $rid === '' || $eventId <= 0) return;
  if (!isset($_SESSION[$bucket]) || !is_array($_SESSION[$bucket])) $_SESSION[$bucket] = [];
  $_SESSION[$bucket]["{$uid}:{$rid}"] = ['ts' => time(), 'event_id' => $eventId];

  if (count($_SESSION[$bucket]) > 300) {
    $cut = time() - 600;
    foreach ($_SESSION[$bucket] as $k => $v) {
      $ts = (int)($v['ts'] ?? 0);
      if ($ts > 0 && $ts < $cut) unset($_SESSION[$bucket][$k]);
    }
  }
}

/* =========================
   Lists
   ========================= */
function fetch_credits(PDO $pdo, int $eventId): array {
  $st = $pdo->prepare("
    SELECT id, credit_date, source, notes, amount, recorded_by_user_id, created_at
    FROM event_credits
    WHERE event_id = :eid
    ORDER BY credit_date DESC, id DESC
    LIMIT 500
  ");
  $st->execute([':eid' => $eventId]);

  $rows = [];
  while ($r = $st->fetch()) {
    $rows[] = [
      'id' => (int)$r['id'],
      'date' => (string)$r['credit_date'],
      'source' => (string)$r['source'],
      'notes' => (string)($r['notes'] ?? ''),
      'amount' => (float)$r['amount'],
      'recorded_by' => (int)$r['recorded_by_user_id'],
      'created_at' => (string)$r['created_at'],
    ];
  }
  return $rows;
}

function fetch_debits(PDO $pdo, int $eventId): array {
  $st = $pdo->prepare("
    SELECT id, debit_date, category, notes, amount, unit_price, quantity,
           receipt_path, receipt_number, recorded_by_user_id, created_at
    FROM event_debits
    WHERE event_id = :eid
    ORDER BY debit_date DESC, id DESC
    LIMIT 500
  ");
  $st->execute([':eid' => $eventId]);

  $rows = [];
  while ($r = $st->fetch()) {
    $rows[] = [
      'id' => (int)$r['id'],
      'date' => (string)$r['debit_date'],
      'category' => (string)$r['category'],
      'notes' => (string)($r['notes'] ?? ''),
      'amount' => (float)$r['amount'],
      'unit_price' => $r['unit_price'] !== null ? (float)$r['unit_price'] : null,
      'qty' => (int)$r['quantity'],
      'quantity' => (int)$r['quantity'],
      'receipt_no' => (string)($r['receipt_number'] ?? ''),
      'receipt_number' => (string)($r['receipt_number'] ?? ''),
      'receipt_url' => public_url($r['receipt_path'] ?? null),
      'receipt_path' => $r['receipt_path'] ?? null,
      'recorded_by' => (int)$r['recorded_by_user_id'],
      'created_at' => (string)$r['created_at'],
    ];
  }
  return $rows;
}

// MODIFIED: Ledger now ONLY uses credits and debits, NOT passbook
function fetch_ledger(PDO $pdo, int $eventId): array {
  error_log("fetch_ledger called for event_id: " . $eventId);
  
  try {
    // Get all credits and debits in chronological order
    $sql = "
      SELECT 
        'credit' as source_type,
        id as source_id,
        credit_date as txn_date,
        source as title,
        COALESCE(notes, '') as notes,
        amount as amount_in,
        0 as amount_out,
        recorded_by_user_id,
        created_at
      FROM event_credits 
      WHERE event_id = :eid
      
      UNION ALL
      
      SELECT 
        'debit' as source_type,
        id as source_id,
        debit_date as txn_date,
        category as title,
        COALESCE(notes, '') as notes,
        0 as amount_in,
        amount as amount_out,
        recorded_by_user_id,
        created_at
      FROM event_debits 
      WHERE event_id = :eid
      
      ORDER BY txn_date ASC, created_at ASC
    ";
    
    $st = $pdo->prepare($sql);
    $st->execute([':eid' => $eventId]);
    
    $rows = [];
    $runningBalance = 0;
    
    while ($r = $st->fetch(PDO::FETCH_ASSOC)) {
      $amountIn = (float)$r['amount_in'];
      $amountOut = (float)$r['amount_out'];
      
      $runningBalance = $runningBalance + $amountIn - $amountOut;
      
      // Get recorded by name
      $recordedByName = '';
      if (!empty($r['recorded_by_user_id'])) {
        $stUser = $pdo->prepare("
          SELECT TRIM(CONCAT_WS(' ',
            COALESCE(first_name,''),
            NULLIF(COALESCE(middle_name,''),''),
            COALESCE(last_name,''),
            NULLIF(COALESCE(suffix,''),'')
          )) AS full_name
          FROM users
          WHERE id = :id
          LIMIT 1
        ");
        $stUser->execute([':id' => $r['recorded_by_user_id']]);
        $recordedByName = trim((string)($stUser->fetchColumn() ?: ''));
        if (empty($recordedByName)) {
          $recordedByName = "User #" . $r['recorded_by_user_id'];
        }
      }
      
      $rows[] = [
        'id' => (int)$r['source_id'],
        'date' => (string)$r['txn_date'],
        'type' => $r['source_type'] === 'credit' ? 'CREDIT' : 'DEBIT',
        'title' => (string)($r['title'] ?? ''),
        'notes' => (string)($r['notes'] ?? ''),
        'description' => trim((string)$r['title'] . (empty($r['notes']) ? '' : ' - ' . (string)$r['notes'])),
        'credit' => $amountIn,
        'debit' => $amountOut,
        'amount_in' => $amountIn,
        'amount_out' => $amountOut,
        'balance' => $runningBalance,
        'balance_after' => $runningBalance,
        'recorded_by_user_id' => (int)($r['recorded_by_user_id'] ?? 0),
        'recorded_by_name' => $recordedByName,
      ];
    }
    
    error_log("fetch_ledger returning " . count($rows) . " rows for event $eventId");
    if (count($rows) > 0) {
      error_log("First row: " . json_encode($rows[0]));
    }
    
    return $rows;
    
  } catch (PDOException $e) {
    error_log("fetch_ledger error: " . $e->getMessage());
    return [];
  }
}

/* =========================
   Passbook helpers (manual entries)
   ========================= */
function recompute_event_passbook_balances(PDO $pdo, int $eventId): void {
  if ($eventId <= 0) return;

  $st = $pdo->prepare("
    SELECT id, COALESCE(amount_in,0) AS amount_in, COALESCE(amount_out,0) AS amount_out
    FROM passbook_logs
    WHERE event_id = :eid
    ORDER BY txn_date ASC, id ASC
  ");
  $st->execute([':eid' => $eventId]);

  $bal = 0.0;
  $rows = $st->fetchAll();
  if (!$rows) return;

  $upd = $pdo->prepare("UPDATE passbook_logs SET balance_after = :b WHERE id = :id");
  foreach ($rows as $r) {
    $bal += ((float)$r['amount_in']) - ((float)$r['amount_out']);
    $upd->execute([':b' => $bal, ':id' => (int)$r['id']]);
  }
}

/* =========================
   Proposed Expenses Helpers
   ========================= */
function fetch_proposed_expenses(PDO $pdo, int $eventId): array {
  $st = $pdo->prepare("
    SELECT id, description, quantity, estimated_cost, 
           (quantity * estimated_cost) AS total
    FROM event_proposed_expenses
    WHERE event_id = :eid
    ORDER BY id ASC
  ");
  $st->execute([':eid' => $eventId]);
  
  $rows = [];
  while ($r = $st->fetch()) {
    $rows[] = [
      'id' => (int)$r['id'],
      'description' => (string)$r['description'],
      'quantity' => (int)$r['quantity'],
      'estimated_cost' => (float)$r['estimated_cost'],
      'total' => (float)$r['total'],
    ];
  }
  return $rows;
}

function calculate_proposed_total(PDO $pdo, int $eventId): float {
  $st = $pdo->prepare("
    SELECT COALESCE(SUM(quantity * estimated_cost), 0) AS total
    FROM event_proposed_expenses
    WHERE event_id = :eid
  ");
  $st->execute([':eid' => $eventId]);
  return (float)$st->fetchColumn();
}



function is_passbook_locked(array $event): bool {
  return ((string)($event['accomplishment_status'] ?? '') === 'Approved');
}
/* =========================
   Router
   ========================= */
$in = read_input();
$action = (string)($in['action'] ?? '');

try {

  if ($action === 'get_terms') {
    require_login();

    $st = $pdo->query("
      SELECT id, school_year, semester, status
      FROM academic_terms
      ORDER BY id DESC
    ");
    $rows = [];
    while ($r = $st->fetch()) {
      $rows[] = [
        'id' => (int)$r['id'],
        'school_year' => (string)$r['school_year'],
        'semester' => (string)$r['semester'],
        'status' => (string)$r['status'],
        'label' => (string)$r['school_year'] . ' ' . (string)$r['semester'],
      ];
    }

    $active = get_active_term($pdo);
    $uid = current_user_id();
    $role = current_role();

    ok([
      'active_term' => $active,
      'active_term_id' => $active ? (int)$active['id'] : 0,
      'terms' => $rows,
      'my_orgs' => fetch_visible_orgs_for_active_term($pdo, $uid, $role),
    ]);
  }

  if ($action === 'list_events') {
    require_login();

    $q          = s($in, ['q'], '');
    $schoolYear = s($in, ['school_year'], '');
    $semester   = s($in, ['semester'], '');
    $termId     = i($in, ['term_id', 'academic_term_id'], 0);

    $uid   = current_user_id();
    $role  = current_role();
    $uname = get_user_full_name($pdo, $uid);

    // ----------------------------
    // ✅ Resolve term consistently
    // Priority:
    //  1) term_id from JS
    //  2) school_year + semester (if provided)
    //  3) active term
    // ----------------------------
    $active = get_active_term($pdo);

    // If JS passed term_id, resolve filters for consistency
    if ($termId > 0 && ($schoolYear === '' || $semester === '')) {
      $t = get_term_by_id($pdo, $termId);
      if ($t) {
        $schoolYear = (string)$t['school_year'];
        $semester   = (string)$t['semester'];
      }
    }

    // If termId missing but filters provided, resolve termId from academic_terms
    if ($termId <= 0 && $schoolYear !== '' && $semester !== '') {
      $syNorm = normalize_school_year($schoolYear);
      $stTerm = $pdo->prepare("
        SELECT id, school_year, semester
        FROM academic_terms
        WHERE school_year = :sy AND semester = :sem
        LIMIT 1
      ");
      $stTerm->execute([':sy' => $syNorm, ':sem' => $semester]);
      $t = $stTerm->fetch(PDO::FETCH_ASSOC);
      if ($t) {
        $termId     = (int)$t['id'];
        $schoolYear = (string)$t['school_year'];
        $semester   = (string)$t['semester'];
      }
    }

    // If still missing filters, fall back to active term (and its id)
    if ($schoolYear === '' || $semester === '') {
      if (!$active) fail('No active academic term found.', 400);
      $schoolYear = (string)$active['school_year'];
      $semester   = (string)$active['semester'];
      if (!empty($active['id'])) $termId = (int)$active['id'];
    }

    // If we still don't have termId, resolve again (best-effort)
    if ($termId <= 0) {
      $syNorm = normalize_school_year($schoolYear);
      $stTerm = $pdo->prepare("SELECT id FROM academic_terms WHERE school_year = :sy AND semester = :sem LIMIT 1");
      $stTerm->execute([':sy' => $syNorm, ':sem' => $semester]);
      $termId = (int)($stTerm->fetchColumn() ?: 0);
    }

    // Optional mode (kept for compatibility)
    $mode = strtolower(trim((string)($in['mode'] ?? $in['save_mode'] ?? $in['status_mode'] ?? 'draft')));
    if (!in_array($mode, ['draft', 'submit'], true)) $mode = 'draft';

    [$syStart, $syEnd] = parse_school_year($schoolYear);
    if ($syStart <= 0 || $syEnd <= 0) fail('Invalid school_year.', 400);

    $syStr = normalize_school_year($schoolYear);
    $ay    = semester_to_active_year($semester);

    // ----------------------------
    // ✅ Officer orgs for the ENTIRE SCHOOL YEAR (not just selected term)
    // ✅ Fix: Officers persist across semesters within same school year
    // ----------------------------
    $myOrgs = [];

    $ooHasUserId   = has_column($pdo, 'organization_officers', 'user_id');
    $ooHasFullName = has_column($pdo, 'organization_officers', 'full_name');
    $ooHasStatus   = has_column($pdo, 'organization_officers', 'status');

    if ($termId > 0) {
      // Get the school year for this term
      $stYear = $pdo->prepare("SELECT school_year FROM academic_terms WHERE id = :tid LIMIT 1");
      $stYear->execute([':tid' => $termId]);
      $schoolYearForTerm = $stYear->fetchColumn();
      
      if ($schoolYearForTerm) {
        // Look for officers in ANY term with this school year
        $ooWhere = "t.school_year = :school_year";
        $bind = [':school_year' => $schoolYearForTerm];

        $matchParts = [];

        if ($ooHasUserId) {
          $matchParts[] = "oo.user_id = :uid";
          $bind[':uid'] = $uid;
        }

        if ($ooHasFullName) {
          // loose name match (helps if officer rows were imported w/ string names)
          $matchParts[] = "(
            oo.user_id IS NULL
            AND TRIM(COALESCE(oo.full_name,'')) <> ''
            AND UPPER(TRIM(oo.full_name)) LIKE UPPER(:uname_like)
          )";
          $bind[':uname_like'] = '%' . trim($uname) . '%';
        }

        // If we cannot match by anything, do not query
        if (!empty($matchParts)) {
          $ooWhere .= " AND (" . implode(" OR ", $matchParts) . ")";

          if ($ooHasStatus) {
            // accept common variants
            $ooWhere .= " AND (oo.status = 'Active' OR oo.status = 'ACTIVE' OR oo.status = 'active')";
          }

          $stMy = $pdo->prepare("
            SELECT DISTINCT
              o.id,
              o.org_name,
              o.abbreviation,
              CONCAT(
                o.org_name,
                CASE
                  WHEN COALESCE(o.abbreviation,'') <> '' THEN CONCAT(' (', o.abbreviation, ')')
                  ELSE ''
                END
              ) AS label
            FROM organization_officers oo
            INNER JOIN academic_terms t ON t.id = oo.academic_term_id
            INNER JOIN organizations o ON o.id = oo.org_id
            WHERE {$ooWhere}
            GROUP BY o.id, o.org_name, o.abbreviation
            ORDER BY o.org_name ASC
          ");
          $stMy->execute($bind);

          while ($row = $stMy->fetch(PDO::FETCH_ASSOC)) {
            $myOrgs[] = [
              'id' => (int)$row['id'],
              'org_name' => (string)$row['org_name'],
              'abbreviation' => (string)($row['abbreviation'] ?? ''),
              'label' => (string)$row['label'],
            ];
          }
        }
      }
    }

    // ✅ Treat "student" as officer when they have officer orgs in this school year
    $isOfficerThisTerm = is_officer_role($role) || ($role === 'student' && !empty($myOrgs));

    // ----------------------------
    // ✅ columns
    // ----------------------------
    $hasEventDate = has_column($pdo, 'event_events', 'event_date');
    $hasDesc      = has_column($pdo, 'event_events', 'description');

    $selectEventDate = $hasEventDate ? "e.event_date" : "'' AS event_date";
    $selectDesc      = $hasDesc ? "e.description" : "'' AS description";

    // ----------------------------
    // ✅ base where (term filter)
    // ----------------------------
    $where  = "e.start_year = :sy1 AND e.end_year = :sy2 AND e.active_year = :ay";
    $params = [':sy1' => $syStart, ':sy2' => $syEnd, ':ay' => $ay];

    if ($q !== '') {
      $where .= " AND (e.title LIKE :q1 OR e.location LIKE :q2 OR o.org_name LIKE :q3)";
      $like = "%{$q}%";
      $params[':q1'] = $like;
      $params[':q2'] = $like;
      $params[':q3'] = $like;
    }

    // ----------------------------
    // ✅ DRAFT VISIBILITY RULE (GLOBAL) — robust column checks
    // Drafts visible only to:
    //  - author_user_id
    //  - officers of the event's org for THIS term (by user_id OR full_name if exists)
    // IMPORTANT: only apply status/full_name checks if those columns exist.
    // ----------------------------
    $draftOfficerMatch = [];
    $draftBinds = [];

    $ooDHasUserId   = $ooHasUserId;
    $ooDHasFullName = $ooHasFullName;
    $ooDHasStatus   = $ooHasStatus;

    if ($ooDHasUserId) {
      $draftOfficerMatch[] = "oo_d.user_id = :v_uid_draft_officer";
      $draftBinds[':v_uid_draft_officer'] = $uid;
    }
    if ($ooDHasFullName) {
      $draftOfficerMatch[] = "(
        oo_d.user_id IS NULL
        AND TRIM(COALESCE(oo_d.full_name,'')) <> ''
        AND UPPER(TRIM(oo_d.full_name)) = UPPER(TRIM(:v_uname_draft_officer))
      )";
      $draftBinds[':v_uname_draft_officer'] = $uname;
    }
    if (empty($draftOfficerMatch)) {
      // if we can't match officer identity, disable the EXISTS by making it false
      $draftOfficerMatch[] = "0=1";
    }

    $draftStatusSql = "";
    if ($ooDHasStatus) {
      $draftStatusSql = " AND (oo_d.status = 'Active' OR oo_d.status = 'ACTIVE' OR oo_d.status = 'active') ";
    }

    $where .= "
      AND (
        e.status <> 'Draft'
        OR (
          e.status = 'Draft'
          AND (
            e.author_user_id = :v_uid_draft_author
            OR EXISTS (
              SELECT 1
              FROM organization_officers oo_d
              WHERE oo_d.org_id = e.org_id
                AND oo_d.academic_term_id = :v_tid_draft
                AND (" . implode(" OR ", $draftOfficerMatch) . ")
                {$draftStatusSql}
              LIMIT 1
            )
          )
        )
      )
    ";
    $params[':v_uid_draft_author'] = $uid;
    $params[':v_tid_draft']        = $termId;
    foreach ($draftBinds as $k => $v) $params[$k] = $v;

    // ----------------------------
    // ✅ MODIFIED: Audience visibility rules with role-based restrictions
    // ✅ Super viewers (overseer, super_admin, special_admin) only see fully approved events
    // ✅ Normal students only see fully approved events they have access to
    // ✅ Officers can see all events for their orgs (including drafts)
    // ✅ Faculty_admin can see events for orgs they created
    // ----------------------------
    
    // Get org access for the user (used in student visibility)
    $hasCreatedBy = has_column($pdo, 'organizations', 'created_by');
    $hasOrgScope  = has_column($pdo, 'organizations', 'scope');
    $hasOrgProgId = has_column($pdo, 'organizations', 'program_id');
    $hasPrograms  = has_column($pdo, 'programs', 'abbreviation');

    // SUPER VIEWER SPECIAL HANDLING - strict approval filters
    if (is_super_viewer($role)) {
      // Super viewers can ONLY see events with BOTH proposal AND accomplishment approved
      $where .= " AND e.status = 'Approved' AND e.accomplishment_status = 'Approved'";
      // No org restrictions - they can see all orgs, but only fully approved events
    } 
    // NORMAL STUDENT HANDLING - strict approval filters + org-based access
    else if ($role === 'student' && !$isOfficerThisTerm) {
      // Students can ONLY see events with BOTH proposal AND accomplishment approved
      $where .= " AND e.status = 'Approved' AND e.accomplishment_status = 'Approved'";
      
      // AND they must have org-based access (general, program-matched, etc.)
      $orgGeneralSql = $hasOrgScope
        ? "LOWER(COALESCE(o.scope,'')) = 'general'"
        : "LOWER(COALESCE(e.scope,'')) = 'general'";

      $programSql = "";
      if ($hasOrgScope && $hasOrgProgId && $hasPrograms) {
        $userProgramAbbr = get_user_program_abbr($pdo, $uid);
        if ($userProgramAbbr !== null) {
          $programSql = "
            OR (
              LOWER(COALESCE(o.scope,'')) <> 'general'
              AND EXISTS (
                SELECT 1
                FROM programs p
                WHERE p.id = o.program_id
                  AND UPPER(TRIM(p.abbreviation)) = UPPER(TRIM(:v_user_program_abbr))
                LIMIT 1
              )
            )
          ";
          $params[':v_user_program_abbr'] = $userProgramAbbr;
        }
      }

      // Add org-based access conditions
      $where .= "
        AND (
          e.org_id IS NULL 
          OR e.org_id = 0
          OR (
            LOWER(COALESCE(o.org_type,'')) <> 'club'
            AND (
              {$orgGeneralSql}
              {$programSql}
            )
          )
          OR (
            LOWER(COALESCE(o.org_type,'')) = 'club'
            AND EXISTS (
              SELECT 1
              FROM organization_memberships m
              WHERE m.org_id = e.org_id
                AND m.academic_term_id = :v_tid_club_member_student
                AND m.student_user_id = :v_uid_club_member_student
              LIMIT 1
            )
          )
        )
      ";
      
      $params[':v_tid_club_member_student'] = $termId;
      $params[':v_uid_club_member_student'] = $uid;
    }
    // OFFICERS AND OTHER ROLES - use the normal complex visibility logic
    else {
      $handleOrgSql  = $hasCreatedBy ? " OR o.created_by = :v_uid_handle_org "  : "";
      $handleClubSql = $hasCreatedBy ? " OR o.created_by = :v_uid_handle_club " : "";

      $orgGeneralSql = $hasOrgScope
        ? "LOWER(COALESCE(o.scope,'')) = 'general'"
        : "LOWER(COALESCE(e.scope,'')) = 'general'";

      $programSql = "";
      if (($role === 'student' || is_officer_role($role)) && $hasOrgScope && $hasOrgProgId && $hasPrograms) {
        $userProgramAbbr = get_user_program_abbr($pdo, $uid);
        if ($userProgramAbbr !== null) {
          $programSql = "
            OR (
              LOWER(COALESCE(o.scope,'')) <> 'general'
              AND EXISTS (
                SELECT 1
                FROM programs p
                WHERE p.id = o.program_id
                  AND UPPER(TRIM(p.abbreviation)) = UPPER(TRIM(:v_user_program_abbr))
                LIMIT 1
              )
            )
          ";
          $params[':v_user_program_abbr'] = $userProgramAbbr;
        }
      }

      // Officer EXISTS (non-club)
      $ooOfficerMatch = [];
      if ($ooHasUserId) {
        $ooOfficerMatch[] = "oo.user_id = :v_uid_org_officer";
        $params[':v_uid_org_officer'] = $uid;
      }
      if ($ooHasFullName) {
        $ooOfficerMatch[] = "(
          oo.user_id IS NULL
          AND TRIM(COALESCE(oo.full_name,'')) <> ''
          AND UPPER(TRIM(oo.full_name)) = UPPER(TRIM(:v_uname_org_officer))
        )";
        $params[':v_uname_org_officer'] = $uname;
      }
      if (empty($ooOfficerMatch)) $ooOfficerMatch[] = "0=1";

      $ooOfficerStatusSql = "";
      if ($ooHasStatus) {
        $ooOfficerStatusSql = " AND (oo.status = 'Active' OR oo.status = 'ACTIVE' OR oo.status = 'active') ";
      }

      // Club officer EXISTS
      $oo2Match = [];
      if ($ooHasUserId) {
        $oo2Match[] = "oo2.user_id = :v_uid_club_officer";
        $params[':v_uid_club_officer'] = $uid;
      }
      if ($ooHasFullName) {
        $oo2Match[] = "(
          oo2.user_id IS NULL
          AND TRIM(COALESCE(oo2.full_name,'')) <> ''
          AND UPPER(TRIM(oo2.full_name)) = UPPER(TRIM(:v_uname_club_officer))
        )";
        $params[':v_uname_club_officer'] = $uname;
      }
      if (empty($oo2Match)) $oo2Match[] = "0=1";

      $oo2StatusSql = "";
      if ($ooHasStatus) {
        $oo2StatusSql = " AND (oo2.status = 'Active' OR oo2.status = 'ACTIVE' OR oo2.status = 'active') ";
      }

      $where .= "
        AND (
          (e.org_id IS NULL OR e.org_id = 0)

          OR (
            LOWER(COALESCE(o.org_type,'')) <> 'club'
            AND :v_officer_view_nonclub = 1
          )

          OR (
            LOWER(COALESCE(o.org_type,'')) <> 'club'
            AND (
              {$orgGeneralSql}

              OR EXISTS (
                SELECT 1
                FROM organization_officers oo
                WHERE oo.org_id = e.org_id
                  AND oo.academic_term_id = :v_tid_org_officer
                  AND (" . implode(" OR ", $ooOfficerMatch) . ")
                  {$ooOfficerStatusSql}
                LIMIT 1
              )

              {$handleOrgSql}

              {$programSql}
            )
          )

          OR (
            LOWER(COALESCE(o.org_type,'')) = 'club'
            AND (
              EXISTS (
                SELECT 1
                FROM organization_officers oo2
                WHERE oo2.org_id = e.org_id
                  AND oo2.academic_term_id = :v_tid_club_officer
                  AND (" . implode(" OR ", $oo2Match) . ")
                  {$oo2StatusSql}
                LIMIT 1
              )
              OR EXISTS (
                SELECT 1
                FROM organization_memberships m
                WHERE m.org_id = e.org_id
                  AND m.academic_term_id = :v_tid_club_member
                  AND m.student_user_id = :v_uid_club_member
                LIMIT 1
              )
              {$handleClubSql}
            )
          )
        )
      ";

      $params[':v_officer_view_nonclub'] = ($isOfficerThisTerm ? 1 : 0);

      // term binds
      $params[':v_tid_org_officer']  = $termId;
      $params[':v_tid_club_officer'] = $termId;

      // club member binds
      $params[':v_uid_club_member'] = $uid;
      $params[':v_tid_club_member'] = $termId;

      if ($hasCreatedBy) {
        $params[':v_uid_handle_org']  = $uid;
        $params[':v_uid_handle_club'] = $uid;
      }
    }

    // ----------------------------
    // ✅ fetch events
    // ----------------------------
    $st = $pdo->prepare("
      SELECT e.id, e.org_id, e.title, e.location, e.scope, e.active_year, e.start_year, e.end_year,
            e.status, e.accomplishment_status,
            {$selectEventDate},
            {$selectDesc},
            e.created_at,
            o.org_name, o.abbreviation, o.org_type
      FROM event_events e
      LEFT JOIN organizations o ON o.id = e.org_id
      WHERE {$where}
      ORDER BY e.created_at DESC, e.id DESC
      LIMIT 200
    ");
    $st->execute($params);

    $events = [];
    while ($r = $st->fetch(PDO::FETCH_ASSOC)) {
      $orgLabel = null;
      if (!empty($r['org_name'])) {
        $orgLabel = trim((string)$r['org_name'] . (!empty($r['abbreviation']) ? ' (' . (string)$r['abbreviation'] . ')' : ''));
      }

      $events[] = [
        'id' => (int)$r['id'],
        'org_id' => $r['org_id'] !== null ? (int)$r['org_id'] : null,
        'org_name' => $orgLabel,
        'org_label' => $orgLabel,
        'title' => (string)$r['title'],
        'location' => (string)$r['location'],
        'scope' => (string)$r['scope'],
        'school_year' => "{$r['start_year']}-{$r['end_year']}",
        'semester' => active_year_to_semester((int)$r['active_year']),
        'status' => (string)$r['status'],
        'accomplishment_status' => (string)$r['accomplishment_status'],
        'event_date' => (string)($r['event_date'] ?? ''),
        'description' => (string)($r['description'] ?? ''),
        'created_at' => (string)$r['created_at'],
      ];
    }

    // ----------------------------
    // ✅ permissions / flags
    // ----------------------------
    $readOnly  = !is_active_filter($pdo, $schoolYear, $semester);
    $canReview = (!$readOnly && can_review_events_role($role));

    $canPrint = false;
    if (can_review_events_role($role)) {
      $canPrint = true;
    } elseif ($isOfficerThisTerm || $role === 'student') {
      $canPrint = true;
    }

    // ✅ can add event:
    // - officers in this school year
    // - or student who is an officer in this school year (myOrgs not empty)
    $canAddEvent = false;
    if (!$readOnly) {
      $canAddEvent = $isOfficerThisTerm;
    }

    ok([
      'filter' => [
        'school_year' => $schoolYear,
        'semester' => $semester,
        'term_id' => $termId,
      ],
      'read_only' => $readOnly,
      'events' => $events,

      // ✅ what your JS needs
      'my_orgs' => $myOrgs,

      'active_term' => $active,
      'permissions' => [
        'user_id' => $uid,
        'role' => $role,
        'can_view' => true,
        'is_readonly' => $readOnly,
        'can_add_event' => $canAddEvent,
        'can_add_credit' => false,
        'can_add_debit' => false,
        'can_review_event' => $canReview,
        'can_print' => $canPrint,
        'can_print_ledger' => $canPrint,
        'can_print_passbook' => $canPrint,
        'can_print_liquidation' => $canPrint,
      ],
    ]);
  }
  
  if ($action === 'get_event') {
  require_login();

  $eventId = i($in, ['event_id'], 0);
  if ($eventId <= 0) fail('Missing event_id.', 400);

  $e = fetch_event($pdo, $eventId);
  if (!$e) fail('Event not found.', 404);

  $uid = current_user_id();
  $role = current_role();
  if (!can_view_event($pdo, $e, $uid, $role)) {
    fail('Forbidden.', 403, ['reason' => 'not_allowed_to_view_event']);
  }

  $sy  = "{$e['start_year']}-{$e['end_year']}";
  $sem = active_year_to_semester((int)$e['active_year']);

  // Get event totals
  $tot = event_totals($pdo, $eventId);

  $orgName = null;
  if (!empty($e['org_id'])) {
    $stO = $pdo->prepare("SELECT org_name, abbreviation FROM organizations WHERE id=:id LIMIT 1");
    $stO->execute([':id' => (int)$e['org_id']]);
    $o = $stO->fetch();
    if ($o) $orgName = trim((string)$o['org_name'] . (!empty($o['abbreviation']) ? ' (' . (string)$o['abbreviation'] . ')' : ''));
  }

  $isOfficer = can_officer_manage_org($pdo, (int)($e['org_id'] ?? 0) ?: null, $uid, $role);
  $readOnly  = !is_active_filter($pdo, $sy, $sem);

  $status = (string)($e['status'] ?? '');
  $cs     = (string)($e['accomplishment_status'] ?? '');

  $proposalApproved = ($status === 'Approved');
  $accompApproved   = ($cs === 'Approved');

  // 🔒 FIXED PERMISSIONS:
  // When accomplishment is approved, EVERYTHING is locked
  $isLocked = $accompApproved;
  
  // Credits/Debits can be added ONLY when:
  // 1. NOT locked (accomplishment not approved)
  // 2. Proposal is APPROVED
  // 3. User is officer
  // 4. Not in read-only mode
  $canAddEntries = false;
  if (!$isLocked && !$readOnly && $proposalApproved && $isOfficer) {
    $canAddEntries = true;
  }

  // Passbook follows same rules
  $canManagePassbook = (!$isLocked && !$readOnly && $proposalApproved && $isOfficer);

  // Submit for approval button - only shows in DRAFT or DECLINED (and not locked)
  $canSubmitForApproval = (!$isLocked && !$readOnly && $isOfficer && in_array($status, ['Draft', 'Declined'], true));

  // Delete permissions - only allowed when NOT locked
  $canDelete = !$isLocked && !$readOnly && $canAddEntries;

  // Review permissions (for faculty_admin, etc.)
  $canReview = (!$readOnly && can_review_events_role($role));

  // Check if current user is the org coordinator
  $orgId = (int)($e['org_id'] ?? 0);
  $isCoordinator = false;
  if ($orgId > 0) {
    $coordinator = get_org_coordinator($pdo, $orgId);
    if ($coordinator && !empty($coordinator['id']) && $coordinator['id'] == $uid) {
      $isCoordinator = true;
    }
  }

  // Accomplishment permissions - also locked when accomplishment approved
  $canSubmitAccomplishment = (!$isLocked && !$readOnly && $isOfficer && $proposalApproved && in_array($cs, ['Draft','Declined'], true));
  $canApproveAccomplishment = (!$isLocked && !$readOnly && ($canReview || $isCoordinator) && ($cs === 'Submitted'));
  $canDeclineAccomplishment = $canApproveAccomplishment;

  // Debug logging
  error_log("Event ID: $eventId, Status: $status, Proposal Approved: " . ($proposalApproved ? 'yes' : 'no') . 
            ", Accomplishment Approved: " . ($accompApproved ? 'yes' : 'no') . 
            ", Is Locked: " . ($isLocked ? 'yes' : 'no') . 
            ", Is Officer: " . ($isOfficer ? 'yes' : 'no') . 
            ", Read Only: " . ($readOnly ? 'yes' : 'no') . 
            ", Can Add Entries: " . ($canAddEntries ? 'yes' : 'no'));

  // FETCH PROPOSED EXPENSES
  $proposedItems = [];
  $proposedTotal = 0.00;
  
  $stCheck = $pdo->query("SHOW TABLES LIKE 'event_proposed_expenses'");
  if ($stCheck && $stCheck->rowCount() > 0) {
    $proposedItems = fetch_proposed_expenses($pdo, $eventId);
    $proposedTotal = calculate_proposed_total($pdo, $eventId);
  }

  // FETCH ACCOMPLISHMENT DATA
  $accomplishmentData = null;
  $stAccCheck = $pdo->query("SHOW TABLES LIKE 'event_accomplishments'");
  if ($stAccCheck && $stAccCheck->rowCount() > 0) {
    $stAcc = $pdo->prepare("
      SELECT objectives, outcomes, challenges, status, 
             submitted_by, submitted_at, 
             approved_by, approved_at, 
             declined_reason, generated_pdf
      FROM event_accomplishments
      WHERE event_id = :eid
      LIMIT 1
    ");
    $stAcc->execute([':eid' => $eventId]);
    $accRow = $stAcc->fetch(PDO::FETCH_ASSOC);
    
    if ($accRow) {
      $accomplishmentData = [
        'objectives' => (string)($accRow['objectives'] ?? ''),
        'outcomes' => (string)($accRow['outcomes'] ?? ''),
        'challenges' => (string)($accRow['challenges'] ?? ''),
        'status' => (string)($accRow['status'] ?? 'Draft'),
        'submitted_by' => (int)($accRow['submitted_by'] ?? 0),
        'submitted_at' => $accRow['submitted_at'] ?? null,
        'approved_by' => (int)($accRow['approved_by'] ?? 0),
        'approved_at' => $accRow['approved_at'] ?? null,
        'declined_reason' => (string)($accRow['declined_reason'] ?? ''),
        'generated_pdf' => $accRow['generated_pdf'] ?? null
      ];
    }
  }

  // FETCH LEDGER (credits and debits only)
  $ledger = fetch_ledger($pdo, $eventId);

  // FETCH PASSBOOK
  $passbook = fetch_passbook_for_event($pdo, $eventId);

  // FETCH CREDITS AND DEBITS for display
  $credits = fetch_credits($pdo, $eventId);
  $debits = fetch_debits($pdo, $eventId);

  ok([
    'event' => [
      'id' => (int)$e['id'],
      'org_id' => $e['org_id'],
      'org_name' => $orgName,
      'org_label' => $orgName,
      'title' => (string)($e['title'] ?? ''),
      'location' => (string)($e['location'] ?? ''),
      'scope' => (string)($e['scope'] ?? ''),
      'school_year' => $sy,
      'semester' => $sem,
      'status' => $status,
      'accomplishment_status' => $cs,
      'event_date' => (string)($e['event_date'] ?? ''),
      'description' => (string)($e['description'] ?? ''),
      'total_credits' => (float)$tot['credits'],
      'total_debits' => (float)$tot['debits'],
      'accomplishment_file_url' => public_url($e['accomplishment_file'] ?? null),
      'accomplishment_notes' => (string)($e['accomplishment_notes'] ?? ''),
    ],
    'totals' => $tot,
    'gates' => [
      'proposal_approved' => $proposalApproved,
      'accomplishment_approved' => $accompApproved,
    ],
    'permissions' => [
      'user_id' => $uid,
      'role' => $role,
      'can_view' => true,
      'is_readonly' => $readOnly,
      'is_locked' => $isLocked,
      'can_add_event' => (!$readOnly && $isOfficer),
      'can_add_credit' => $canAddEntries,
      'can_add_debit' => $canAddEntries,
      'can_manage_passbook' => $canManagePassbook,
      'can_delete' => $canDelete,
      'can_submit_for_approval' => $canSubmitForApproval,
      'passbook_locked' => $isLocked,
      'can_review_event' => $canReview,
      'can_submit_accomplishment' => $canSubmitAccomplishment,
      'can_approve_accomplishment' => $canApproveAccomplishment,
      'can_decline_accomplishment' => $canDeclineAccomplishment,
      'can_print_accomplishment' => true,
    ],
    'credits' => $credits,
    'debits' => $debits,
    'ledger' => $ledger,
    'passbook' => $passbook,
    'proposed_expenses' => $proposedItems,
    'proposed_total' => $proposedTotal,
    'accomplishment' => $accomplishmentData,
    'filter' => ['school_year' => $sy, 'semester' => $sem],
  ]);
  }

  if ($action === 'get_passbook') {
    require_login();

    $orgId = i($in, ['org_id'], 0);
    $schoolYear = s($in, ['school_year'], '');
    $semester = s($in, ['semester'], '');

    $mode = strtolower(trim((string)($in['mode'] ?? $in['save_mode'] ?? $in['status_mode'] ?? 'draft')));
    if (!in_array($mode, ['draft','submit'], true)) $mode = 'draft';

    $active = get_active_term($pdo);
    if ($schoolYear === '' || $semester === '') {
      if (!$active) fail('No active academic term found.', 400);
      $schoolYear = $active['school_year'];
      $semester = $active['semester'];
    }

    if ($orgId <= 0) {
      ok(['passbook' => []]);
    }

    $uid = current_user_id();
    $role = current_role();

    if (!can_review_events_role($role)) {
      if (!can_officer_manage_org($pdo, $orgId, $uid, $role)) {
        fail('Forbidden.', 403);
      }
    }

    ok([
      'filter' => ['school_year' => $schoolYear, 'semester' => $semester],
      'org_id' => $orgId,
      'passbook' => fetch_passbook($pdo, $orgId, $schoolYear, $semester),
    ]);
  }

  if ($action === 'add_event') {
    require_login();

    $title = s($in, ['title', 'event_name', 'name'], '');
    $location = s($in, ['location'], '');
    $scope = s($in, ['scope'], 'general');
    $orgId = i($in, ['org_id'], 0);

    $eventDate = s($in, ['event_date', 'date'], '');
    $description = s($in, ['description', 'event_description'], '');

    $schoolYear = s($in, ['school_year'], '');
    $semester = s($in, ['semester'], '');

    $mode = strtolower(trim((string)($in['mode'] ?? $in['save_mode'] ?? $in['status_mode'] ?? 'draft')));
    if (!in_array($mode, ['draft','submit'], true)) $mode = 'draft';


    $active = get_active_term($pdo);
    if ($schoolYear === '' || $semester === '') {
      if (!$active) fail('No active academic term found.', 400);
      $schoolYear = $active['school_year'];
      $semester = $active['semester'];
    }

    if (!can_mutate_in_filter($pdo, $schoolYear, $semester)) {
      fail('Read-only mode for this term.', 403, ['reason' => 'read_only_term']);
    }

    if ($title === '' || $location === '') fail('Missing title/location.', 400);
    if (!in_array($scope, ['general', 'organization'], true)) fail('Invalid scope.', 400);

    if ($scope === 'organization') {
      if ($orgId <= 0) fail('Missing org_id for organization scope.', 400);
      if (!org_exists($pdo, $orgId)) fail('Organization not found.', 404);
    } else {
      $orgId = 0;
    }

    $uid = current_user_id();
    $role = current_role();

    if (!can_officer_manage_org($pdo, $orgId > 0 ? $orgId : null, $uid, $role)) {
      fail('Forbidden.', 403);
    }

    [$syStart, $syEnd] = parse_school_year($schoolYear);
    if ($syStart <= 0 || $syEnd <= 0) fail('Invalid school_year.', 400);

    $ay = semester_to_active_year($semester);

    $hasEventDate = has_column($pdo, 'event_events', 'event_date');
    $hasDesc = has_column($pdo, 'event_events', 'description');

    if ($hasEventDate) {
      if ($eventDate === '') $eventDate = date('Y-m-d');
      if (!is_valid_ymd($eventDate)) fail('Invalid event_date (expected YYYY-MM-DD).', 400);
    }

    $rid = idem_key_from_input($in);
    if ($rid !== '') {
      $existing = idem_get('idem_add_event', $uid, $rid);
      if ($existing) {
        ok([
          'message' => 'Event already added.',
          'event_id' => (int)$existing,
          'deduped' => true,
          'request_id' => $rid,
        ]);
      }
    }

    $dupParams = [
      ':uid' => $uid,
      ':scope' => $scope,
      ':org' => (int)$orgId,
      ':title' => $title,
      ':location' => $location,
      ':sy1' => $syStart,
      ':sy2' => $syEnd,
      ':ay' => $ay,
    ];

    $dupSql = "
      SELECT id
      FROM event_events
      WHERE author_user_id = :uid
        AND scope = :scope
        AND COALESCE(org_id,0) = :org
        AND title = :title
        AND location = :location
        AND start_year = :sy1
        AND end_year = :sy2
        AND active_year = :ay
        AND created_at >= (NOW() - INTERVAL 20 SECOND)
      ORDER BY id DESC
      LIMIT 1
    ";
    $stDup = $pdo->prepare($dupSql);
    $stDup->execute($dupParams);
    $dupId = (int)($stDup->fetchColumn() ?: 0);
    if ($dupId > 0) {
      if ($rid !== '') idem_set('idem_add_event', $uid, $rid, $dupId);
      ok([
        'message' => 'Event already added.',
        'event_id' => $dupId,
        'deduped' => true,
        'request_id' => ($rid !== '' ? $rid : null),
      ]);
    }

    $cols = "(org_id, title, location, scope, active_year, start_year, end_year, status, author_user_id, accomplishment_status";
    $status = ($mode === 'submit') ? 'Submitted' : 'Draft';

    $vals = "(:org_id, :title, :location, :scope, :ay, :sy1, :sy2, '{$status}', :uid, 'Locked'";
    $params = [
      ':org_id' => ($orgId > 0 ? $orgId : null),
      ':title' => $title,
      ':location' => $location,
      ':scope' => $scope,
      ':ay' => $ay,
      ':sy1' => $syStart,
      ':sy2' => $syEnd,
      ':uid' => $uid,
    ];

    if ($hasEventDate) {
      $cols .= ", event_date";
      $vals .= ", :event_date";
      $params[':event_date'] = $eventDate;
    }
    if ($hasDesc) {
      $cols .= ", description";
      $vals .= ", :descr";
      $params[':descr'] = ($description !== '' ? $description : null);
    }


    // optional submitted tracking fields
    if ($mode === 'submit') {
      if (has_column($pdo, 'event_events', 'submitted_at')) {
        $cols .= ", submitted_at";
        $vals .= ", NOW()";
      }
      if (has_column($pdo, 'event_events', 'submitted_by')) {
        $cols .= ", submitted_by";
        $vals .= ", :uid";
      }
      if (has_column($pdo, 'event_events', 'submitted_by_user_id')) {
        $cols .= ", submitted_by_user_id";
        $vals .= ", :uid";
      }
    }

    $cols .= ")";
    $vals .= ")";

    $st = $pdo->prepare("INSERT INTO event_events {$cols} VALUES {$vals}");
    $st->execute($params);

    $newId = (int)$pdo->lastInsertId();
    if ($rid !== '') idem_set('idem_add_event', $uid, $rid, $newId);

    ok([
      'message' => 'Event added.',
      'event_id' => $newId,
      'request_id' => ($rid !== '' ? $rid : null),
    ]);
  }

  
  if ($action === 'submit_event_for_approval') {
    require_login();

    $eventId = i($in, ['event_id'], 0);
    if ($eventId <= 0) fail('Missing event_id.', 400);

    $e = fetch_event($pdo, $eventId);
    if (!$e) fail('Event not found.', 404);

    $uid = current_user_id();
    $role = current_role();

    if (!can_view_event($pdo, $e, $uid, $role)) {
      fail('Forbidden.', 403, ['reason' => 'not_allowed_to_view_event']);
    }

    $eventOrgId = (int)($e['org_id'] ?? 0);
    if (!can_officer_manage_org($pdo, $eventOrgId > 0 ? $eventOrgId : null, $uid, $role)) {
      fail('Forbidden.', 403);
    }

    $sy = "{$e['start_year']}-{$e['end_year']}";
    $sem = active_year_to_semester((int)$e['active_year']);
    if (!can_mutate_in_filter($pdo, $sy, $sem)) {
      fail('Read-only mode for this term.', 403, ['reason' => 'read_only_term']);
    }

    $curStatus = (string)($e['status'] ?? '');
    if ($curStatus !== 'Draft' && $curStatus !== 'Declined') {
      fail('Only Draft/Declined events can be submitted.', 400, ['status' => $curStatus]);
    }

    $set = "status='Submitted'";
    if (has_column($pdo, 'event_events', 'submitted_at')) $set .= ", submitted_at=NOW()";
    if (has_column($pdo, 'event_events', 'submitted_by')) $set .= ", submitted_by=:uid";
    if (has_column($pdo, 'event_events', 'submitted_by_user_id')) $set .= ", submitted_by_user_id=:uid";

    $st = $pdo->prepare("UPDATE event_events SET {$set} WHERE id=:id LIMIT 1");
    $params = [':id' => $eventId];
    if (strpos($set, ':uid') !== false) $params[':uid'] = $uid;
    $st->execute($params);
ok(['message' => 'Event submitted for approval.']);
  }


  if ($action === 'add_credit') {
  require_login();

  $eventId = i($in, ['event_id'], 0);
  $date = s($in, ['date'], '');
  $source = s($in, ['source'], '');
  $notes = s($in, ['notes', 'description'], '');
  $amount = f($in, ['amount'], 0.0);

  if ($eventId <= 0) fail('Missing event_id.', 400);
  if ($date === '') fail('Missing date.', 400);
  if ($source === '') fail('Missing source.', 400);
  if ($amount <= 0) fail('Invalid amount.', 400);

  $e = fetch_event($pdo, $eventId);
  if (!$e) fail('Event not found.', 404);

  $uid = current_user_id();
  $role = current_role();
  if (!can_view_event($pdo, $e, $uid, $role)) {
    fail('Forbidden.', 403, ['reason' => 'not_allowed_to_view_event']);
  }

  $eventOrgId = (int)($e['org_id'] ?? 0);
  if ($eventOrgId <= 0) {
    fail('This event is not tied to an organization.', 400, ['reason' => 'missing_org_id']);
  }

  $sy = "{$e['start_year']}-{$e['end_year']}";
  $sem = active_year_to_semester((int)$e['active_year']);
  if (!can_mutate_in_filter($pdo, $sy, $sem)) {
    fail('Read-only mode for this term.', 403, ['reason' => 'read_only_term']);
  }

  require_officer_for_expenses($pdo, $eventOrgId);
  must_be_officer_for_event($pdo, $e);

  if (((string)($e['accomplishment_status'] ?? '')) === 'Approved') {
    fail('Locked: event expenses already approved.', 403, ['reason' => 'locked_after_approval']);
  }

  if (!is_valid_ymd($date)) fail('Invalid date (expected YYYY-MM-DD).', 400);

  // ✅ INSERT ONLY INTO event_credits - NO PASSBOOK AUTO-INSERT
  $st = $pdo->prepare("
    INSERT INTO event_credits (event_id, credit_date, source, notes, amount, recorded_by_user_id)
    VALUES (:eid, :d, :src, :n, :amt, :uid)
  ");
  $st->execute([
    ':eid' => $eventId,
    ':d' => $date,
    ':src' => $source,
    ':n' => ($notes !== '' ? $notes : null),
    ':amt' => $amount,
    ':uid' => $uid,
  ]);

  $creditId = (int)$pdo->lastInsertId();

  ok(['message' => 'Credit added.', 'credit_id' => $creditId]);
  }

  if ($action === 'add_debit') {
  require_login();

  $eventId = i($in, ['event_id'], 0);
  $date = s($in, ['date'], '');
  $category = s($in, ['category'], '');
  $notes = s($in, ['notes'], '');

  $quantity = i($in, ['qty', 'quantity'], 1);
  if ($quantity < 1) $quantity = 1;

  $unitPriceRaw = pick($in, ['unit_price', 'unitPrice'], null);
  $unitPriceF = null;
  if ($unitPriceRaw !== null && $unitPriceRaw !== '' && is_numeric($unitPriceRaw)) {
    $unitPriceF = (float)$unitPriceRaw;
    if ($unitPriceF < 0) $unitPriceF = 0.0;
  }

  $amount = f($in, ['amount'], 0.0);
  if ($unitPriceF !== null && $amount <= 0) $amount = $unitPriceF * $quantity;

  $receiptNumber = s($in, ['receipt_no', 'receipt_number'], '');

  if ($eventId <= 0) fail('Missing event_id.', 400);
  if ($date === '') fail('Missing date.', 400);
  if ($category === '') fail('Missing category.', 400);
  if ($amount <= 0) fail('Invalid amount.', 400);

  $e = fetch_event($pdo, $eventId);
  if (!$e) fail('Event not found.', 404);

  $uid = current_user_id();
  $role = current_role();
  if (!can_view_event($pdo, $e, $uid, $role)) {
    fail('Forbidden.', 403, ['reason' => 'not_allowed_to_view_event']);
  }

  $eventOrgId = (int)($e['org_id'] ?? 0);
  if ($eventOrgId <= 0) {
    fail('This event is not tied to an organization.', 400, ['reason' => 'missing_org_id']);
  }

  $sy = "{$e['start_year']}-{$e['end_year']}";
  $sem = active_year_to_semester((int)$e['active_year']);
  if (!can_mutate_in_filter($pdo, $sy, $sem)) {
    fail('Read-only mode for this term.', 403, ['reason' => 'read_only_term']);
  }

  require_officer_for_expenses($pdo, $eventOrgId);
  must_be_officer_for_event($pdo, $e);

  if (((string)($e['accomplishment_status'] ?? '')) === 'Approved') {
    fail('Locked: event expenses already approved.', 403, ['reason' => 'locked_after_approval']);
  }

  // Optional: Check for sufficient funds (remove if you don't want this validation)
  $stCredits = $pdo->prepare("SELECT COALESCE(SUM(amount), 0) FROM event_credits WHERE event_id = :eid");
  $stCredits->execute([':eid' => $eventId]);
  $totalCredits = (float)$stCredits->fetchColumn();
  
  $stDebits = $pdo->prepare("SELECT COALESCE(SUM(amount), 0) FROM event_debits WHERE event_id = :eid");
  $stDebits->execute([':eid' => $eventId]);
  $totalDebits = (float)$stDebits->fetchColumn();
  
  $currentBalance = $totalCredits - $totalDebits;
  
  if ($amount > $currentBalance) {
    // You can either block or just warn - uncomment to block
    // fail("Insufficient funds. Current balance: ₱" . number_format($currentBalance, 2) . 
    //      ", Attempted expense: ₱" . number_format($amount, 2), 400);
    
    // Or just log a warning
    error_log("WARNING: Expense of ₱$amount exceeds current balance of ₱$currentBalance for event $eventId");
  }

  if (!is_valid_ymd($date)) fail('Invalid date (expected YYYY-MM-DD).', 400);

  $fileKey = isset($_FILES['receipt_file']) ? 'receipt_file' : 'receipt';

  $receiptRel = save_uploaded_file(
    $fileKey,
    EE_RECEIPTS_DIR,
    ['png','jpg','jpeg','webp','pdf'],
    8 * 1024 * 1024
  );

  // ✅ INSERT ONLY INTO event_debits - NO PASSBOOK AUTO-INSERT
  $st = $pdo->prepare("
    INSERT INTO event_debits
      (event_id, debit_date, category, notes, amount, unit_price, quantity, receipt_path, receipt_number, recorded_by_user_id)
    VALUES
      (:eid, :d, :cat, :n, :amt, :up, :qty, :rp, :rn, :uid)
  ");
  $st->execute([
    ':eid' => $eventId,
    ':d' => $date,
    ':cat' => $category,
    ':n' => ($notes !== '' ? $notes : null),
    ':amt' => $amount,
    ':up' => $unitPriceF,
    ':qty' => $quantity,
    ':rp' => $receiptRel,
    ':rn' => ($receiptNumber !== '' ? $receiptNumber : null),
    ':uid' => $uid,
  ]);

  $debitId = (int)$pdo->lastInsertId();

  ok([
    'message' => 'Expense added.',
    'debit_id' => $debitId,
    'receipt_url' => public_url($receiptRel),
  ]);
  }

  if ($action === 'submit_accomplishment') {
    require_login();

    $eventId = i($in, ['event_id'], 0);
    $notes = s($in, ['notes'], '');

    if ($eventId <= 0) fail('Missing event_id.', 400);

    $e = fetch_event($pdo, $eventId);
    if (!$e) fail('Event not found.', 404);

    $uid = current_user_id();
    $role = current_role();
    if (!can_view_event($pdo, $e, $uid, $role)) {
      fail('Forbidden.', 403, ['reason' => 'not_allowed_to_view_event']);
    }

    $eventOrgId = (int)($e['org_id'] ?? 0);
    if ($eventOrgId <= 0) {
      fail('This event is not tied to an organization.', 400, ['reason' => 'missing_org_id']);
    }

    $sy = "{$e['start_year']}-{$e['end_year']}";
    $sem = active_year_to_semester((int)$e['active_year']);
    if (!can_mutate_in_filter($pdo, $sy, $sem)) {
      fail('Read-only mode for this term.', 403, ['reason' => 'read_only_term']);
    }

    require_officer_for_expenses($pdo, $eventOrgId);
    must_be_officer_for_event($pdo, $e);
    require_proposal_approved($e);

    $cs = (string)($e['accomplishment_status'] ?? 'Locked');
    if (!in_array($cs, ['Draft','Declined'], true)) {
      fail('Cannot submit accomplishment from current status.', 400, ['accomplishment_status' => $cs]);
    }

    $fileRel = save_uploaded_file(
      'accomplishment_file',
      EE_ACCOMP_DIR,
      ['pdf','png','jpg','jpeg','webp'],
      12 * 1024 * 1024
    );

    $st = $pdo->prepare("
      UPDATE event_events
      SET accomplishment_status='Submitted',
          accomplishment_file=:f,
          accomplishment_notes=:n,
          accomplishment_submitted_at=NOW()
      WHERE id=:id
      LIMIT 1
    ");
    $st->execute([
      ':f' => $fileRel,
      ':n' => ($notes !== '' ? $notes : null),
      ':id' => $eventId,
    ]);

    ok(['message' => 'Accomplishment submitted.', 'accomplishment_file_url' => public_url($fileRel)]);
  }

  if ($action === 'approve_proposal' || $action === 'decline_proposal') {
    must_be_admin_reviewer();

    $eventId = i($in, ['event_id'], 0);
    if ($eventId <= 0) fail('Missing event_id.', 400);

    $e = fetch_event($pdo, $eventId);
    if (!$e) fail('Event not found.', 404);

    $sy = "{$e['start_year']}-{$e['end_year']}";
    $sem = active_year_to_semester((int)$e['active_year']);
    if (!can_mutate_in_filter($pdo, $sy, $sem)) {
      fail('Read-only mode for this term.', 403, ['reason' => 'read_only_term']);
    }

    $cur = (string)($e['status'] ?? '');
    if (!in_array($cur, ['Draft','Submitted'], true)) {
      fail('Event cannot be reviewed in its current status.', 400, ['status' => $cur]);
    }

    $uid = current_user_id();

    if ($action === 'approve_proposal') {
      $st = $pdo->prepare("
        UPDATE event_events
        SET status='Approved',
            proposal_approved_at=NOW(),
            proposal_approved_by=:uid,
            accomplishment_status=IF(accomplishment_status='Locked','Draft',accomplishment_status)
        WHERE id=:id
        LIMIT 1
      ");
      $st->execute([':uid' => $uid, ':id' => $eventId]);
      ok(['message' => 'Proposal approved.']);
    } else {
      $remarks = s($in, ['remarks','notes'], '');
      $hasRemarks = has_column($pdo, 'event_events', 'proposal_remarks');

      if ($hasRemarks) {
        $st = $pdo->prepare("
          UPDATE event_events
          SET status='Declined',
              proposal_remarks=:r
          WHERE id=:id
          LIMIT 1
        ");
        $st->execute([':r' => ($remarks !== '' ? $remarks : null), ':id' => $eventId]);
      } else {
        $st = $pdo->prepare("UPDATE event_events SET status='Declined' WHERE id=:id LIMIT 1");
        $st->execute([':id' => $eventId]);
      }

      ok(['message' => 'Proposal declined.']);
    }
  }

  if ($action === 'approve_accomplishment' || $action === 'decline_accomplishment') {
    must_be_admin_reviewer();

    $eventId = i($in, ['event_id'], 0);
    if ($eventId <= 0) fail('Missing event_id.', 400);

    $e = fetch_event($pdo, $eventId);
    if (!$e) fail('Event not found.', 404);

    $sy = "{$e['start_year']}-{$e['end_year']}";
    $sem = active_year_to_semester((int)$e['active_year']);
    if (!can_mutate_in_filter($pdo, $sy, $sem)) {
      fail('Read-only mode for this term.', 403, ['reason' => 'read_only_term']);
    }

    $cs = (string)($e['accomplishment_status'] ?? '');
    if (!in_array($cs, ['Submitted', 'Draft'], true)) {
      fail('Accomplishment is not submitted.', 400, ['accomplishment_status' => $cs]);
    }

    $uid = current_user_id();

    if ($action === 'approve_accomplishment') {
      $st = $pdo->prepare("
        UPDATE event_events
        SET accomplishment_status='Approved',
            accomplishment_approved_at=NOW(),
            accomplishment_approved_by=:uid
        WHERE id=:id
        LIMIT 1
      ");
      $st->execute([':uid' => $uid, ':id' => $eventId]);
      ok(['message' => 'Accomplishment approved.']);
    } else {
      $remarks = s($in, ['remarks','notes'], '');
      $hasRemarks = has_column($pdo, 'event_events', 'accomplishment_remarks');

      if ($hasRemarks) {
        $st = $pdo->prepare("
          UPDATE event_events
          SET accomplishment_status='Declined',
              accomplishment_remarks=:r
          WHERE id=:id
          LIMIT 1
        ");
        $st->execute([':r' => ($remarks !== '' ? $remarks : null), ':id' => $eventId]);
      } else {
        $st = $pdo->prepare("
          UPDATE event_events
          SET accomplishment_status='Declined'
          WHERE id=:id
          LIMIT 1
        ");
        $st->execute([':id' => $eventId]);
      }

      ok(['message' => 'Accomplishment declined.']);
    }
  }

  if ($action === 'review_event') {
    must_be_admin_reviewer();

    $eventId = i($in, ['event_id'], 0);
    $decision = strtolower(s($in, ['decision'], ''));
    $remarks = s($in, ['remarks','notes'], '');

    if ($eventId <= 0) fail('Missing event_id.', 400);
    if (!in_array($decision, ['approve', 'decline'], true)) fail('Invalid decision.', 400);

    $e = fetch_event($pdo, $eventId);
    if (!$e) fail('Event not found.', 404);

    $sy = "{$e['start_year']}-{$e['end_year']}";
    $sem = active_year_to_semester((int)$e['active_year']);
    if (!can_mutate_in_filter($pdo, $sy, $sem)) {
      fail('Read-only mode for this term.', 403, ['reason' => 'read_only_term']);
    }

    $cur = (string)($e['status'] ?? '');
    if (!in_array($cur, ['Draft','Submitted'], true)) {
      fail('Event cannot be reviewed in its current status.', 400, ['status' => $cur]);
    }

    $uid = current_user_id();

    if ($decision === 'approve') {
      $st = $pdo->prepare("
        UPDATE event_events
        SET status='Approved',
            proposal_approved_at=NOW(),
            proposal_approved_by=:uid,
            accomplishment_status=IF(accomplishment_status='Locked','Draft',accomplishment_status)
        WHERE id=:id
        LIMIT 1
      ");
      $st->execute([':uid' => $uid, ':id' => $eventId]);
      ok(['message' => 'Event proposal approved.']);
    } else {
      $hasRemarks = has_column($pdo, 'event_events', 'proposal_remarks');
      if ($hasRemarks) {
        $st = $pdo->prepare("
          UPDATE event_events
          SET status='Declined',
              proposal_remarks=:r
          WHERE id=:id
          LIMIT 1
        ");
        $st->execute([':r' => ($remarks !== '' ? $remarks : null), ':id' => $eventId]);
      } else {
        $st = $pdo->prepare("UPDATE event_events SET status='Declined' WHERE id=:id LIMIT 1");
        $st->execute([':id' => $eventId]);
      }
      ok(['message' => 'Event proposal declined.']);
    }
  }


  if ($action === 'add_passbook_txn') {
    require_login();

    $eventId = i($in, ['event_id'], 0);
    $date = s($in, ['date','txn_date'], '');
    $title = s($in, ['type','title'], 'Bank Withdrawal');
    $descr = s($in, ['description','purpose','notes'], '');

    $withdraw = f($in, ['withdrawal','debit','amount_out'], 0.0);
    $deposit  = f($in, ['deposit','credit','amount_in'], 0.0);

    if ($eventId <= 0) fail('Missing event_id.', 400);
    if ($date === '') fail('Missing date.', 400);
    if (!is_valid_ymd($date)) fail('Invalid date (expected YYYY-MM-DD).', 400);

    if ($withdraw < 0) $withdraw = 0.0;
    if ($deposit < 0) $deposit = 0.0;

    if ($withdraw <= 0 && $deposit <= 0) {
      fail('Enter a withdrawal or deposit amount.', 400);
    }
    if ($withdraw > 0 && $deposit > 0) {
      fail('Enter either Withdrawal OR Deposit (not both).', 400);
    }

    $e = fetch_event($pdo, $eventId);
    if (!$e) fail('Event not found.', 404);

    $uid = current_user_id();
    $role = current_role();
    if (!can_view_event($pdo, $e, $uid, $role)) {
      fail('Forbidden.', 403);
    }

    $sy = "{$e['start_year']}-{$e['end_year']}";
    $sem = active_year_to_semester((int)$e['active_year']);
    if (!can_mutate_in_filter($pdo, $sy, $sem)) {
      fail('Read-only mode for this term.', 403, ['reason' => 'read_only_term']);
    }



    require_event_submitted($e);

    if (((string)($e['accomplishment_status'] ?? '')) === 'Approved') {
      fail('Locked: event expenses already approved.', 403, ['reason' => 'locked_after_approval']);
    }

    if (is_passbook_locked($e)) {
      fail('Passbook is locked (event expenses already approved).', 403, ['reason' => 'passbook_locked']);
    }

    // officers only
    must_be_officer_for_event($pdo, $e);

    $orgId = (int)($e['org_id'] ?? 0);
    if ($orgId <= 0) fail('This event is not tied to an organization.', 400);

    $txnType = ($deposit > 0) ? 'credit' : 'debit';
    $amountIn = ($deposit > 0) ? $deposit : 0.0;
    $amountOut = ($withdraw > 0) ? $withdraw : 0.0;

    $rid = idem_key_from_input($in);
    if ($rid !== '') {
      $existing = idem_get('idem_add_passbook', $uid, $rid);
      if ($existing) {
        ok([
          'message' => 'Transaction already added.',
          'passbook_id' => (int)$existing,
          'deduped' => true,
          'request_id' => $rid,
        ]);
      }
    }

    // DB-side dedupe: same payload already exists (most recent)
    $stDup = $pdo->prepare("
      SELECT id
      FROM passbook_logs
      WHERE event_id = :eid
        AND txn_date = :d
        AND txn_type = :tt
        AND COALESCE(title,'') = :t
        AND COALESCE(notes,'') = :n
        AND COALESCE(amount_in,0) = :ain
        AND COALESCE(amount_out,0) = :aout
        AND recorded_by_user_id = :uid
      ORDER BY id DESC
      LIMIT 1
    ");
    $stDup->execute([
      ':eid' => $eventId,
      ':d' => $date,
      ':tt' => $txnType,
      ':t' => $title,
      ':n' => $descr,
      ':ain' => $amountIn,
      ':aout' => $amountOut,
      ':uid' => $uid,
    ]);
    $dupId = (int)($stDup->fetchColumn() ?: 0);
    if ($dupId > 0) {
      if ($rid !== '') idem_set('idem_add_passbook', $uid, $rid, $dupId);
      ok([
        'message' => 'Transaction already added.',
        'passbook_id' => $dupId,
        'deduped' => true,
        'request_id' => ($rid !== '' ? $rid : null),
      ]);
    }

    $stLast = $pdo->prepare("SELECT COALESCE(balance_after,0) FROM passbook_logs WHERE event_id=:eid ORDER BY id DESC LIMIT 1");
    $stLast->execute([':eid' => $eventId]);
    $lastBal = (float)($stLast->fetchColumn() ?: 0);

    $newBal = $lastBal + $amountIn - $amountOut;

    $st = $pdo->prepare("
      INSERT INTO passbook_logs
        (org_id, event_id, txn_date, txn_type, title, notes, amount_in, amount_out, balance_after, ref_table, ref_id, recorded_by_user_id)
      VALUES
        (:org, :eid, :d, :tt, :t, :n, :ain, :aout, :bal, 'manual', 0, :uid)
    ");
    $st->execute([
      ':org' => $orgId,
      ':eid' => $eventId,
      ':d' => $date,
      ':tt' => $txnType,
      ':t' => $title,
      ':n' => ($descr !== '' ? $descr : null),
      ':ain' => $amountIn,
      ':aout' => $amountOut,
      ':bal' => $newBal,
      ':uid' => $uid,
    ]);

    $pid = (int)$pdo->lastInsertId();
    if ($rid !== '') idem_set('idem_add_passbook', $uid, $rid, $pid);

    ok([
      'message' => 'Transaction added.',
      'passbook_id' => $pid,
      'balance_after' => $newBal,
      'request_id' => ($rid !== '' ? $rid : null),
    ]);
  }
  

  if ($action === 'delete_passbook_txn') {
    require_login();

    $pid = i($in, ['passbook_id','id'], 0);
    if ($pid <= 0) fail('Missing passbook_id.', 400);

    $stRow = $pdo->prepare("SELECT id, event_id, COALESCE(ref_table,'') AS ref_table FROM passbook_logs WHERE id=:id LIMIT 1");
    $stRow->execute([':id' => $pid]);
    $row = $stRow->fetch();
    if (!$row) fail('Transaction not found.', 404);

    if (strtolower((string)$row['ref_table']) !== 'manual') {
      fail('Only manual transactions can be deleted.', 403, ['reason' => 'not_manual']);
    }

    $eventId = (int)$row['event_id'];
    $e = fetch_event($pdo, $eventId);
    if (!$e) fail('Event not found.', 404);

    $uid = current_user_id();
    $role = current_role();
    if (!can_view_event($pdo, $e, $uid, $role)) {
      fail('Forbidden.', 403);
    }

    $sy = "{$e['start_year']}-{$e['end_year']}";
    $sem = active_year_to_semester((int)$e['active_year']);
    if (!can_mutate_in_filter($pdo, $sy, $sem)) {
      fail('Read-only mode for this term.', 403, ['reason' => 'read_only_term']);
    }



    require_event_submitted($e);

    if (((string)($e['accomplishment_status'] ?? '')) === 'Approved') {
      fail('Locked: event expenses already approved.', 403, ['reason' => 'locked_after_approval']);
    }

    // ✅ Only allow deleting manual passbook entries while event is Submitted
    require_event_submitted($e);


    if (is_passbook_locked($e)) {
      fail('Passbook is locked (event expenses already approved).', 403, ['reason' => 'passbook_locked']);
    }

    must_be_officer_for_event($pdo, $e);

    $stDel = $pdo->prepare("DELETE FROM passbook_logs WHERE id=:id LIMIT 1");
    $stDel->execute([':id' => $pid]);

    recompute_event_passbook_balances($pdo, $eventId);

    ok(['message' => 'Transaction deleted.']);
  }

  if ($action === 'delete_credit') {
  require_login();
  
  $creditId = i($in, ['credit_id', 'id'], 0);
  if ($creditId <= 0) fail('Missing credit_id.', 400);
  
  // Get credit details first
  $stCredit = $pdo->prepare("
    SELECT c.*, e.org_id, e.start_year, e.end_year, e.active_year, e.status, e.accomplishment_status
    FROM event_credits c
    INNER JOIN event_events e ON e.id = c.event_id
    WHERE c.id = :id
    LIMIT 1
  ");
  $stCredit->execute([':id' => $creditId]);
  $credit = $stCredit->fetch(PDO::FETCH_ASSOC);
  
  if (!$credit) fail('Credit not found.', 404);
  
  $eventId = (int)$credit['event_id'];
  $orgId = (int)$credit['org_id'];
  $uid = current_user_id();
  $role = current_role();
  
  // Check permissions
  $sy = "{$credit['start_year']}-{$credit['end_year']}";
  $sem = active_year_to_semester((int)$credit['active_year']);
  
  if (!can_mutate_in_filter($pdo, $sy, $sem)) {
    fail('Read-only mode for this term.', 403, ['reason' => 'read_only_term']);
  }
  
  if (((string)($credit['accomplishment_status'] ?? '')) === 'Approved') {
    fail('Locked: event expenses already approved.', 403, ['reason' => 'locked_after_approval']);
  }
  
  $eventOrgId = (int)($credit['org_id'] ?? 0);
  if (!can_officer_manage_org($pdo, $eventOrgId > 0 ? $eventOrgId : null, $uid, $role)) {
    fail('Forbidden. Only officers can delete credits.', 403);
  }
  
  // Begin transaction
  $pdo->beginTransaction();
  
  try {
    // ✅ REMOVED: Delete associated passbook entry
    // We no longer auto-create passbook entries, so nothing to delete there
    
    // Delete the credit
    $stDel = $pdo->prepare("DELETE FROM event_credits WHERE id = :id LIMIT 1");
    $stDel->execute([':id' => $creditId]);
    
    $pdo->commit();
    ok(['message' => 'Credit deleted successfully.']);
  } catch (\Throwable $e) {
    $pdo->rollBack();
    fail('Failed to delete credit: ' . $e->getMessage(), 500);
  }
  }

  if ($action === 'delete_debit') {
  require_login();
  
  $debitId = i($in, ['debit_id', 'id'], 0);
  if ($debitId <= 0) fail('Missing debit_id.', 400);
  
  // Get debit details first
  $stDebit = $pdo->prepare("
    SELECT d.*, e.org_id, e.start_year, e.end_year, e.active_year, e.status, e.accomplishment_status
    FROM event_debits d
    INNER JOIN event_events e ON e.id = d.event_id
    WHERE d.id = :id
    LIMIT 1
  ");
  $stDebit->execute([':id' => $debitId]);
  $debit = $stDebit->fetch(PDO::FETCH_ASSOC);
  
  if (!$debit) fail('Debit not found.', 404);
  
  $eventId = (int)$debit['event_id'];
  $orgId = (int)$debit['org_id'];
  $uid = current_user_id();
  $role = current_role();
  
  // Check permissions
  $sy = "{$debit['start_year']}-{$debit['end_year']}";
  $sem = active_year_to_semester((int)$debit['active_year']);
  
  if (!can_mutate_in_filter($pdo, $sy, $sem)) {
    fail('Read-only mode for this term.', 403, ['reason' => 'read_only_term']);
  }
  
  if (((string)($debit['accomplishment_status'] ?? '')) === 'Approved') {
    fail('Locked: event expenses already approved.', 403, ['reason' => 'locked_after_approval']);
  }
  
  $eventOrgId = (int)($debit['org_id'] ?? 0);
  if (!can_officer_manage_org($pdo, $eventOrgId > 0 ? $eventOrgId : null, $uid, $role)) {
    fail('Forbidden. Only officers can delete expenses.', 403);
  }
  
  // Begin transaction
  $pdo->beginTransaction();
  
  try {
    // ✅ REMOVED: Delete associated passbook entry
    // We no longer auto-create passbook entries, so nothing to delete there
    
    // Delete the debit
    $stDel = $pdo->prepare("DELETE FROM event_debits WHERE id = :id LIMIT 1");
    $stDel->execute([':id' => $debitId]);
    
    $pdo->commit();
    ok(['message' => 'Expense deleted successfully.']);
  } catch (\Throwable $e) {
    $pdo->rollBack();
    fail('Failed to delete expense: ' . $e->getMessage(), 500);
  }
  }

  if ($action === 'save_proposed_expenses') {
  require_login();
  
  $eventId = i($in, ['event_id'], 0);
  $items = $in['items'] ?? [];
  
  if ($eventId <= 0) fail('Missing event_id.', 400);
  if (!is_array($items)) fail('Invalid items format.', 400);
  
  $e = fetch_event($pdo, $eventId);
  if (!$e) fail('Event not found.', 404);
  
  $uid = current_user_id();
  $role = current_role();
  
  // Check permissions
  $eventOrgId = (int)($e['org_id'] ?? 0);
  if (!can_officer_manage_org($pdo, $eventOrgId > 0 ? $eventOrgId : null, $uid, $role)) {
    fail('Forbidden.', 403);
  }
  
  // Check if event is editable
  $status = (string)($e['status'] ?? '');
  if (!in_array($status, ['Draft', 'Submitted'], true)) {
    fail('Cannot modify proposed expenses at this stage.', 403);
  }
  
  // Begin transaction
  $pdo->beginTransaction();
  
  try {
    // Delete existing proposed expenses
    $stDel = $pdo->prepare("DELETE FROM event_proposed_expenses WHERE event_id = :eid");
    $stDel->execute([':eid' => $eventId]);
    
    // Insert new items
    $stIns = $pdo->prepare("
      INSERT INTO event_proposed_expenses (event_id, description, quantity, estimated_cost)
      VALUES (:eid, :desc, :qty, :cost)
    ");
    
    foreach ($items as $item) {
      $desc = trim($item['description'] ?? '');
      $qty = (int)($item['quantity'] ?? 1);
      $cost = (float)($item['estimated_cost'] ?? 0);
      
      if ($desc === '' || $qty < 1 || $cost <= 0) continue;
      
      $stIns->execute([
        ':eid' => $eventId,
        ':desc' => $desc,
        ':qty' => $qty,
        ':cost' => $cost,
      ]);
    }
    
    $pdo->commit();
    ok(['message' => 'Proposed expenses saved.', 'total' => calculate_proposed_total($pdo, $eventId)]);
  } catch (\Throwable $e) {
    $pdo->rollBack();
    fail('Failed to save proposed expenses: ' . $e->getMessage(), 500);
  }
}

if ($action === 'get_proposed_expenses') {
  require_login();
  
  $eventId = i($in, ['event_id'], 0);
  if ($eventId <= 0) fail('Missing event_id.', 400);
  
  $e = fetch_event($pdo, $eventId);
  if (!$e) fail('Event not found.', 404);
  
  $uid = current_user_id();
  $role = current_role();
  
  if (!can_view_event($pdo, $e, $uid, $role)) {
    fail('Forbidden.', 403);
  }
  
  $items = fetch_proposed_expenses($pdo, $eventId);
  $total = calculate_proposed_total($pdo, $eventId);
  
  ok([
    'items' => $items,
    'total' => $total,
  ]);
}

if ($action === 'get_accomplishment_signers') {
  require_login();
  
  $eventId = i($in, ['event_id'], 0);
  if ($eventId <= 0) fail('Missing event_id.', 400);
  
  $e = fetch_event($pdo, $eventId);
  if (!$e) fail('Event not found.', 404);
  
  $uid = current_user_id();
  $role = current_role();
  if (!can_view_event($pdo, $e, $uid, $role)) {
    fail('Forbidden.', 403);
  }
  
  $orgId = (int)($e['org_id'] ?? 0);
  $termId = ee_event_term_id($pdo, $e);
  
  $signers = [
    'treasurer' => '—',
    'president' => '—',
    'coordinator' => '—'
  ];
  
  $signatures = [
    'treasurer' => null,
    'president' => null,
    'coordinator' => null
  ];
  
  if ($orgId > 0 && $termId > 0) {
    // Get treasurer
    $treasurer = ee_get_officer($pdo, $orgId, $termId, 'treasurer');
    if ($treasurer) {
      $signers['treasurer'] = trim((string)($treasurer['full_name'] ?? '—'));
      if (!empty($treasurer['user_id'])) {
        $sig = ee_get_active_signature_file($pdo, (int)$treasurer['user_id']);
        if ($sig) $signatures['treasurer'] = public_url($sig);
      }
    }
    
    // Get president
    $president = get_org_president($pdo, $orgId, $termId);
    if ($president) {
      $signers['president'] = trim((string)($president['full_name'] ?? '—'));
      if (!empty($president['user_id'])) {
        $sig = ee_get_active_signature_file($pdo, (int)$president['user_id']);
        if ($sig) $signatures['president'] = public_url($sig);
      }
    }
    
    // Get coordinator (faculty_admin who created org)
    $coordinator = get_org_coordinator($pdo, $orgId);
    if ($coordinator) {
      $signers['coordinator'] = (string)$coordinator['name'];
      if (!empty($coordinator['id'])) {
        $sig = ee_get_active_signature_file($pdo, (int)$coordinator['id']);
        if ($sig) $signatures['coordinator'] = public_url($sig);
      }
    }
  }
  
  ok([
    'signers' => $signers,
    'signatures' => $signatures
  ]);
}

if ($action === 'submit_accomplishment_report') {
  require_login();
  
  $eventId = i($in, ['event_id'], 0);
  $objectives = s($in, ['objectives'], '');
  $outcomes = s($in, ['outcomes'], '');
  $challenges = s($in, ['challenges'], '');
  
  if ($eventId <= 0) fail('Missing event_id.', 400);
  if ($objectives === '') fail('Objectives are required.', 400);
  if ($outcomes === '') fail('Outcomes are required.', 400);
  
  $e = fetch_event($pdo, $eventId);
  if (!$e) fail('Event not found.', 404);
  
  $uid = current_user_id();
  $role = current_role();
  
  // Check if user is officer of the org
  $orgId = (int)($e['org_id'] ?? 0);
  if (!can_officer_manage_org($pdo, $orgId > 0 ? $orgId : null, $uid, $role)) {
    fail('Forbidden. Only organization officers can submit accomplishment reports.', 403);
  }
  
  // Check if proposal is approved
  if ((string)($e['status'] ?? '') !== 'Approved') {
    fail('Proposal must be approved first before submitting accomplishment report. Current proposal status: ' . ($e['status'] ?? 'NULL'), 403);
  }
  
  // Check current accomplishment status - MORE FLEXIBLE CONDITIONS
  $currentStatus = (string)($e['accomplishment_status'] ?? '');
  
  // Log for debugging
  error_log("submit_accomplishment_report - Event ID: $eventId, Current Status: $currentStatus");
  
  // Allow submission from Draft, Declined, OR if the table doesn't exist yet
  $allowed = ['Draft', 'Declined'];
  
  // If status is empty or 'Locked', also allow (treat as Draft)
  if ($currentStatus === '' || $currentStatus === 'Locked') {
    $currentStatus = 'Draft'; // Treat as Draft
  }
  
  if (!in_array($currentStatus, $allowed, true)) {
    fail('Accomplishment report cannot be submitted from current status. Current: "' . $currentStatus . '". Allowed: Draft, Declined', 400, ['status' => $currentStatus]);
  }
  
  // Check if table exists, create if not
  $hasAccompTable = false;
  $stCheck = $pdo->query("SHOW TABLES LIKE 'event_accomplishments'");
  if ($stCheck && $stCheck->rowCount() > 0) {
    $hasAccompTable = true;
  } else {
    // Create table with correct structure
    $pdo->exec("
      CREATE TABLE IF NOT EXISTS `event_accomplishments` (
        `id` int(10) UNSIGNED NOT NULL AUTO_INCREMENT,
        `event_id` int(10) UNSIGNED NOT NULL,
        `objectives` text NOT NULL,
        `outcomes` text NOT NULL,
        `challenges` text DEFAULT NULL,
        `status` enum('Draft','Submitted','Approved','Declined') NOT NULL DEFAULT 'Draft',
        `submitted_by` int(10) UNSIGNED DEFAULT NULL,
        `submitted_at` datetime DEFAULT NULL,
        `approved_by` int(10) UNSIGNED DEFAULT NULL,
        `approved_at` datetime DEFAULT NULL,
        `declined_reason` text DEFAULT NULL,
        `generated_pdf` varchar(255) DEFAULT NULL,
        `created_at` datetime NOT NULL DEFAULT current_timestamp(),
        `updated_at` datetime DEFAULT NULL ON UPDATE current_timestamp(),
        PRIMARY KEY (`id`),
        UNIQUE KEY `uq_event_accomplishment` (`event_id`),
        KEY `idx_status` (`status`),
        KEY `idx_submitted_by` (`submitted_by`),
        KEY `idx_approved_by` (`approved_by`),
        CONSTRAINT `fk_accomp_event` FOREIGN KEY (`event_id`) REFERENCES `event_events` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT `fk_accomp_submitted_by` FOREIGN KEY (`submitted_by`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
        CONSTRAINT `fk_accomp_approved_by` FOREIGN KEY (`approved_by`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
    ");
    $hasAccompTable = true;
  }
  
  // Check if columns exist (in case table was created with old structure)
  if ($hasAccompTable) {
    try {
      // Verify the accomplishment table has the right columns
      $colCheck = $pdo->query("SHOW COLUMNS FROM event_accomplishments LIKE 'status'");
      if ($colCheck->rowCount() === 0) {
        // Add missing columns if they don't exist
        $pdo->exec("ALTER TABLE `event_accomplishments` 
                    ADD COLUMN `status` ENUM('Draft','Submitted','Approved','Declined') NOT NULL DEFAULT 'Draft' AFTER `challenges`,
                    ADD COLUMN `submitted_by` INT(10) UNSIGNED DEFAULT NULL AFTER `status`,
                    ADD COLUMN `submitted_at` DATETIME DEFAULT NULL AFTER `submitted_by`,
                    ADD COLUMN `approved_by` INT(10) UNSIGNED DEFAULT NULL AFTER `submitted_at`,
                    ADD COLUMN `approved_at` DATETIME DEFAULT NULL AFTER `approved_by`,
                    ADD COLUMN `declined_reason` TEXT DEFAULT NULL AFTER `approved_at`");
      }
    } catch (\Throwable $e) {
      // Ignore errors, table might already have columns
    }
  }
  
  // Save/Update accomplishment data
  if ($hasAccompTable) {
    // Check if record exists
    $checkSt = $pdo->prepare("SELECT id FROM event_accomplishments WHERE event_id = :eid LIMIT 1");
    $checkSt->execute([':eid' => $eventId]);
    $exists = $checkSt->fetch();
    
    if ($exists) {
      // Update existing
      $st = $pdo->prepare("
        UPDATE event_accomplishments 
        SET objectives = :obj,
            outcomes = :out,
            challenges = :ch,
            status = 'Submitted',
            submitted_by = :uid,
            submitted_at = NOW(),
            approved_by = NULL,
            approved_at = NULL,
            declined_reason = NULL
        WHERE event_id = :eid
      ");
      $st->execute([
        ':eid' => $eventId,
        ':obj' => $objectives,
        ':out' => $outcomes,
        ':ch' => $challenges !== '' ? $challenges : null,
        ':uid' => $uid
      ]);
    } else {
      // Insert new
      $st = $pdo->prepare("
        INSERT INTO event_accomplishments 
          (event_id, objectives, outcomes, challenges, status, submitted_by, submitted_at)
        VALUES 
          (:eid, :obj, :out, :ch, 'Submitted', :uid, NOW())
      ");
      $st->execute([
        ':eid' => $eventId,
        ':obj' => $objectives,
        ':out' => $outcomes,
        ':ch' => $challenges !== '' ? $challenges : null,
        ':uid' => $uid
      ]);
    }
  }
  
  // Update event status
  $stUpd = $pdo->prepare("
    UPDATE event_events 
    SET accomplishment_status = 'Submitted'
    WHERE id = :eid
    LIMIT 1
  ");
  $stUpd->execute([':eid' => $eventId]);
  
  // Create notification for faculty_admin/coordinator
  $coordinator = get_org_coordinator($pdo, $orgId);
  if ($coordinator && !empty($coordinator['id'])) {
    $officerName = get_user_full_name($pdo, $uid);
    $eventTitle = (string)($e['title'] ?? 'Event');
    
    // Check if notifications table exists
    try {
      $notifSt = $pdo->prepare("
        INSERT INTO notifications 
          (recipient_id, actor_id, title, message, notif_type, payload_id)
        VALUES 
          (:recipient, :actor, :title, :message, 'accomplishment', :payload)
      ");
      $notifSt->execute([
        ':recipient' => $coordinator['id'],
        ':actor' => $uid,
        ':title' => 'Accomplishment Report Submitted',
        ':message' => "Accomplishment report for event '{$eventTitle}' has been submitted for review by {$officerName}.",
        ':payload' => $eventId
      ]);
    } catch (\Throwable $e) {
      // Notifications table might not exist, ignore
      error_log("Failed to create notification: " . $e->getMessage());
    }
  }
  
  ok(['message' => 'Accomplishment report submitted for review.']);
}

if ($action === 'approve_accomplishment_report') {
  require_login();
  
  $eventId = i($in, ['event_id'], 0);
  if ($eventId <= 0) fail('Missing event_id.', 400);
  
  $e = fetch_event($pdo, $eventId);
  if (!$e) fail('Event not found.', 404);
  
  $uid = current_user_id();
  $role = current_role();
  
  // Check if user is faculty_admin/coordinator or has review role
  $orgId = (int)($e['org_id'] ?? 0);
  $isCoordinator = false;
  $coordinator = get_org_coordinator($pdo, $orgId);
  if ($coordinator && !empty($coordinator['id']) && $coordinator['id'] == $uid) {
    $isCoordinator = true;
  }
  
  if (!can_review_events_role($role) && !$isCoordinator) {
    fail('Forbidden. Only coordinators and admins can approve accomplishment reports.', 403);
  }
  
  // Check current status
  $currentStatus = (string)($e['accomplishment_status'] ?? '');
  if ($currentStatus !== 'Submitted') {
    fail('Accomplishment report must be in Submitted status to approve.', 400, ['status' => $currentStatus]);
  }
  
  // Update accomplishment table
  $stCheck = $pdo->query("SHOW TABLES LIKE 'event_accomplishments'");
  if ($stCheck && $stCheck->rowCount() > 0) {
    $st = $pdo->prepare("
      UPDATE event_accomplishments 
      SET status = 'Approved', approved_by = :uid, approved_at = NOW()
      WHERE event_id = :eid
      LIMIT 1
    ");
    $st->execute([':uid' => $uid, ':eid' => $eventId]);
  }
  
  // Update event status
  $stUpd = $pdo->prepare("
    UPDATE event_events 
    SET accomplishment_status = 'Approved',
        accomplishment_approved_at = NOW(),
        accomplishment_approved_by = :uid
    WHERE id = :eid
    LIMIT 1
  ");
  $stUpd->execute([':uid' => $uid, ':eid' => $eventId]);
  
  // Notify officers
  $officers = get_org_officers_for_notification($pdo, $orgId, $eventId);
  $approverName = get_user_full_name($pdo, $uid);
  $eventTitle = (string)($e['title'] ?? 'Event');
  
  foreach ($officers as $officerId) {
    if ($officerId > 0 && $officerId != $uid) {
      $notifSt = $pdo->prepare("
        INSERT INTO notifications 
          (recipient_id, actor_id, title, message, notif_type, payload_id)
        VALUES 
          (:recipient, :actor, :title, :message, 'accomplishment', :payload)
      ");
      $notifSt->execute([
        ':recipient' => $officerId,
        ':actor' => $uid,
        ':title' => 'Accomplishment Report Approved',
        ':message' => "Accomplishment report for event '{$eventTitle}' has been approved by {$approverName}.",
        ':payload' => $eventId
      ]);
    }
  }
  
  ok(['message' => 'Accomplishment report approved successfully.']);
}

if ($action === 'decline_accomplishment_report') {
  require_login();
  
  $eventId = i($in, ['event_id'], 0);
  $reason = s($in, ['reason', 'notes'], '');
  
  if ($eventId <= 0) fail('Missing event_id.', 400);
  if ($reason === '') fail('Decline reason is required.', 400);
  
  $e = fetch_event($pdo, $eventId);
  if (!$e) fail('Event not found.', 404);
  
  $uid = current_user_id();
  $role = current_role();
  
  // Check if user is faculty_admin/coordinator or has review role
  $orgId = (int)($e['org_id'] ?? 0);
  $isCoordinator = false;
  $coordinator = get_org_coordinator($pdo, $orgId);
  if ($coordinator && !empty($coordinator['id']) && $coordinator['id'] == $uid) {
    $isCoordinator = true;
  }
  
  if (!can_review_events_role($role) && !$isCoordinator) {
    fail('Forbidden. Only coordinators and admins can decline accomplishment reports.', 403);
  }
  
  // Check current status
  $currentStatus = (string)($e['accomplishment_status'] ?? '');
  if ($currentStatus !== 'Submitted') {
    fail('Accomplishment report must be in Submitted status to decline.', 400, ['status' => $currentStatus]);
  }
  
  // Update accomplishment table
  $stCheck = $pdo->query("SHOW TABLES LIKE 'event_accomplishments'");
  if ($stCheck && $stCheck->rowCount() > 0) {
    $st = $pdo->prepare("
      UPDATE event_accomplishments 
      SET status = 'Declined', declined_reason = :reason
      WHERE event_id = :eid
      LIMIT 1
    ");
    $st->execute([':reason' => $reason, ':eid' => $eventId]);
  }
  
  // Update event status
  $stUpd = $pdo->prepare("
    UPDATE event_events 
    SET accomplishment_status = 'Declined'
    WHERE id = :eid
    LIMIT 1
  ");
  $stUpd->execute([':eid' => $eventId]);
  
  // Notify officers
  $officers = get_org_officers_for_notification($pdo, $orgId, $eventId);
  $declinerName = get_user_full_name($pdo, $uid);
  $eventTitle = (string)($e['title'] ?? 'Event');
  
  foreach ($officers as $officerId) {
    if ($officerId > 0 && $officerId != $uid) {
      $notifSt = $pdo->prepare("
        INSERT INTO notifications 
          (recipient_id, actor_id, title, message, notif_type, payload_id)
        VALUES 
          (:recipient, :actor, :title, :message, 'accomplishment', :payload)
      ");
      $notifSt->execute([
        ':recipient' => $officerId,
        ':actor' => $uid,
        ':title' => 'Accomplishment Report Declined',
        ':message' => "Accomplishment report for event '{$eventTitle}' has been declined by {$declinerName}. Reason: {$reason}",
        ':payload' => $eventId
      ]);
    }
  }
  
  ok(['message' => 'Accomplishment report declined.']);
}

// Helper function to get officers for notifications
function get_org_officers_for_notification(PDO $pdo, int $orgId, int $eventId): array {
  $officers = [];
  if ($orgId <= 0 || $eventId <= 0) return $officers;
  
  $termId = ee_event_term_id($pdo, ['id' => $eventId]);
  if ($termId <= 0) return $officers;
  
  $st = $pdo->prepare("
    SELECT DISTINCT oo.user_id
    FROM organization_officers oo
    WHERE oo.org_id = :org_id
      AND oo.academic_term_id = :term_id
      AND oo.status = 'Active'
      AND oo.user_id IS NOT NULL
  ");
  $st->execute([':org_id' => $orgId, ':term_id' => $termId]);
  
  while ($row = $st->fetch(PDO::FETCH_ASSOC)) {
    $officers[] = (int)$row['user_id'];
  }
  
  return $officers;
}


  fail('Unknown action.', 400);

} catch (\Throwable $e) {
  fail('Server error: ' . $e->getMessage(), 500);
}
//isOfficer