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
function fail(string $msg, int $code = 400, array $extra = []): void {
  out(array_merge(['success' => false, 'message' => $msg], $extra), $code);
}
function read_json(): array {
  $raw = file_get_contents('php://input');
  $data = json_decode($raw ?: '[]', true);
  return is_array($data) ? $data : [];
}

/* =========================
   Input utils
   ========================= */
function clamp_int($v, int $min, int $max, int $fallback): int {
  $n = (int)$v;
  if ($n < $min) return $fallback;
  if ($n > $max) return $max;
  return $n;
}
/** Escape for LIKE and wrap with %...% */
function like_escape(string $q): string {
  $q = str_replace("\0", '', $q);
  $q = str_replace('\\', '\\\\', $q);
  $q = str_replace(['%', '_'], ['\%', '\_'], $q);
  return '%' . $q . '%';
}

/* =========================
   Auth helpers
   ========================= */
function current_user_id(): int {
  return (int)($_SESSION['user_id'] ?? $_SESSION['id'] ?? 0);
}

/**
 * ✅ CHANGE APPLIED:
 * Normalize role for ALL comparisons (fixes "Officer", "Faculty_Admin", etc).
 */
function current_role(): string {
  $r = (string)($_SESSION['role'] ?? '');
  $r = strtolower(trim($r));
  // normalize common variants
  if ($r === 'officer') $r = 'org_officer';
  if ($r === 'faculty-admin') $r = 'faculty_admin';
  if ($r === 'superadmin') $r = 'super_admin';
  if ($r === 'specialadmin') $r = 'special_admin';
  return $r;
}

function is_bypass_activation_role(string $role): bool {
  // These roles can bypass "org must be activated" visibility for this module.
  return in_array($role, ['super_admin', 'overseer', 'special_admin'], true);
}

/**
 * ✅ CHANGE APPLIED:
 * student-like role check uses normalized (lowercase) roles.
 */
function is_student_like_role(string $role): bool {
  return in_array($role, ['student', 'org_officer', 'org_president', 'treasurer'], true);
}

/**
 * Permission rules:
 * - Non-officer student: can only see their OWN status (paid/unpaid) and print their OWN receipt if paid.
 * - super_admin, overseer, special_admin, faculty_admin, admin: can VIEW lists + print receipts (subject to handling & activation rules), but CANNOT set payments.
 * - Officer students (organization_officers) for ACTIVE term & selected org: can VIEW lists AND set payments,
 *   BUT payment-module access is blocked if org is NOT activated yet (unless bypass role, which officers are not).
 */

/* =========================
   Term helpers
   ========================= */
function get_active_term(PDO $pdo): ?array {
  $st = $pdo->query("
    SELECT id, school_year, semester
    FROM academic_terms
    WHERE status='Active'
    ORDER BY id DESC
    LIMIT 1
  ");
  $t = $st ? $st->fetch(PDO::FETCH_ASSOC) : false;
  if (!$t) return null;

  return [
    'id' => (int)$t['id'],
    'school_year' => (string)$t['school_year'],
    'semester' => (string)$t['semester'],
    'label' => (string)$t['school_year'] . ' ' . $t['semester'],
  ];
}
function active_school_year(PDO $pdo): ?string {
  $t = get_active_term($pdo);
  if (!$t) return null;
  $sy = trim((string)($t['school_year'] ?? ''));
  return $sy !== '' ? $sy : null;
}

/**
 * ✅ Helper: school_year for a given term_id
 */
function school_year_for_term(PDO $pdo, int $termId): string {
  if ($termId <= 0) return '';
  $st = $pdo->prepare("SELECT school_year FROM academic_terms WHERE id = :id LIMIT 1");
  $st->execute([':id' => $termId]);
  $r = $st->fetch(PDO::FETCH_ASSOC);
  return trim((string)($r['school_year'] ?? ''));
}

/* =========================
   Core role helpers
   ========================= */
/**
 * ✅ Option B: OFFICERS ARE YEAR-BASED
 * 1) exact term match
 * 2) fallback: any officer record within SAME school_year
 */
function is_officer_for_org(PDO $pdo, int $orgId, int $termId, int $userId): bool {
  if ($orgId <= 0 || $termId <= 0 || $userId <= 0) return false;

  // 1) exact term match
  $st = $pdo->prepare("
    SELECT 1
    FROM organization_officers oo
    WHERE oo.org_id = :org_id
      AND oo.academic_term_id = :term_id
      AND oo.user_id = :uid
      AND oo.status = 'Active'
    LIMIT 1
  ");
  $st->execute([
    ':org_id' => $orgId,
    ':term_id' => $termId,
    ':uid' => $userId,
  ]);
  if ($st->fetchColumn()) return true;

  // 2) school_year fallback
  $sy = school_year_for_term($pdo, $termId);
  if ($sy === '') return false;

  $st2 = $pdo->prepare("
    SELECT 1
    FROM organization_officers oo
    INNER JOIN academic_terms t ON t.id = oo.academic_term_id
    WHERE oo.org_id = :org_id
      AND oo.user_id = :uid
      AND oo.status = 'Active'
      AND t.school_year = :sy
    ORDER BY oo.academic_term_id DESC, oo.id DESC
    LIMIT 1
  ");
  $st2->execute([
    ':org_id' => $orgId,
    ':uid' => $userId,
    ':sy' => $sy,
  ]);
  return (bool)$st2->fetchColumn();
}

function is_viewer_role(string $role): bool {
  // Includes roles that can view lists (subject to org-handling + activation gates)
  return in_array($role, ['super_admin', 'overseer', 'special_admin', 'faculty_admin', 'admin'], true);
}

function norm_program(?string $s): string {
  $s = (string)($s ?? '');
  $s = trim(preg_replace('/\s+/', ' ', $s));
  return strtoupper($s);
}

function get_user_program(PDO $pdo, int $uid): string {
  if ($uid <= 0) return '';
  $st = $pdo->prepare("SELECT program FROM users WHERE id = :id LIMIT 1");
  $st->execute([':id' => $uid]);
  $r = $st->fetch(PDO::FETCH_ASSOC);
  return isset($r['program']) ? (string)$r['program'] : '';
}

/**
 * Determines whether a viewer-admin "handles" an organization.
 * Priority:
 * 1) super_admin handles all
 * 2) org.created_by = user
 * 3) optional assignment tables
 * 4) fallback: Exclusive org + program match
 */
function handles_org(PDO $pdo, array $org, int $uid, string $role): bool {
  if ($uid <= 0) return false;
  if ($role === 'super_admin') return true;

  if (!is_viewer_role($role)) return false;

  if (isset($org['created_by']) && (int)$org['created_by'] === $uid) return true;

  $tablesToTry = [
    ['table' => 'organization_admins', 'where' => 'org_id = :org_id AND user_id = :uid'],
    ['table' => 'organization_admin_assignments', 'where' => 'org_id = :org_id AND user_id = :uid'],
    ['table' => 'organization_handlers', 'where' => 'org_id = :org_id AND user_id = :uid'],
  ];
  foreach ($tablesToTry as $t) {
    try {
      $sql = "SELECT 1 FROM `{$t['table']}` WHERE {$t['where']} LIMIT 1";
      $st = $pdo->prepare($sql);
      $st->execute([':org_id' => (int)$org['id'], ':uid' => $uid]);
      if ($st->fetchColumn()) return true;
    } catch (Throwable $e) {
      // ignore missing tables/columns
    }
  }

  $scope = (string)($org['scope'] ?? '');
  if ($scope === 'Exclusive') {
    $uProg = norm_program(get_user_program($pdo, $uid));
    $oAbbr = norm_program($org['program_abbr'] ?? '');
    $oName = norm_program($org['program_name'] ?? '');
    if ($uProg !== '' && ($uProg === $oAbbr || $uProg === $oName)) return true;
  }

  return false;
}

/* =========================
   Activation (Accreditation) helpers
   ========================= */
/**
 * ✅ FIX: Accreditation is YEARLY.
 * Treat org as "activated" for the whole school_year if ANY term in that school_year
 * has an Active accreditation_request.
 *
 * 1) fast path: exact term_id match
 * 2) fallback: match by school_year
 */
function is_org_activated(PDO $pdo, int $orgId, int $termId): bool {
  if ($orgId <= 0 || $termId <= 0) return false;

  // 1) exact term match
  $st = $pdo->prepare("
    SELECT 1
    FROM accreditation_requests ar
    WHERE ar.org_id = :org_id
      AND ar.academic_term_id = :term_id
      AND ar.status = 'Active'
    ORDER BY ar.id DESC
    LIMIT 1
  ");
  $st->execute([
    ':org_id' => $orgId,
    ':term_id' => $termId,
  ]);
  if ($st->fetchColumn()) return true;

  // 2) school_year fallback
  $sy = school_year_for_term($pdo, $termId);
  if ($sy === '') return false;

  $st2 = $pdo->prepare("
    SELECT 1
    FROM accreditation_requests ar
    JOIN academic_terms t ON t.id = ar.academic_term_id
    WHERE ar.org_id = :org_id
      AND ar.status = 'Active'
      AND t.school_year = :sy
    ORDER BY ar.id DESC
    LIMIT 1
  ");
  $st2->execute([
    ':org_id' => $orgId,
    ':sy' => $sy,
  ]);
  return (bool)$st2->fetchColumn();
}

/**
 * Gate for this payments module based on org activation, with your requested behavior:
 * - super_admin / overseer / special_admin bypass
 * - student-like roles: if not activated => 404 (don’t leak org existence)
 * - admin/faculty_admin:
 *     - if NOT handling and not activated => 404
 *     - if handling and not activated => 403 ("not activated yet")
 * - officers: if not activated => 403 ("not activated yet") for payment actions/list actions
 */
function enforce_activation_gate(PDO $pdo, int $orgId, int $termId, ?array $orgRow = null): void {
  $role = current_role();
  if (is_bypass_activation_role($role)) return;

  $activated = is_org_activated($pdo, $orgId, $termId);
  if ($activated) return;

  $uid = current_user_id();

  // ✅ student-like: hide non-activated
  if (is_student_like_role($role)) {
    fail('Organization not found.', 404);
  }

  // admin/faculty_admin:
  if ($role === 'admin' || $role === 'faculty_admin') {
    $org = $orgRow;
    if (!$org) {
      $org = org_with_program_raw($pdo, $orgId); // raw fetch (no gate)
    }
    if (!$org) fail('Organization not found.', 404);

    $isHandling = handles_org($pdo, $org, $uid, $role);
    if (!$isHandling) {
      fail('Organization not found.', 404);
    }

    fail('Organization is not activated yet.', 403, ['reason' => 'not_activated']);
  }

  // other roles: default restrict
  fail('Organization is not activated yet.', 403, ['reason' => 'not_activated']);
}

/* =========================
   Org fetch helpers
   ========================= */

/**
 * Raw org fetch (NO activation gate) used internally for checks.
 */
function org_with_program_raw(PDO $pdo, int $orgId): ?array {
  $st = $pdo->prepare("
    SELECT o.*,
           p.abbreviation AS program_abbr,
           p.program_name AS program_name
    FROM organizations o
    LEFT JOIN programs p ON p.id = o.program_id
    WHERE o.id = :id AND o.org_type='Organization' AND o.status='Active'
    LIMIT 1
  ");
  $st->execute([':id' => $orgId]);
  $o = $st->fetch(PDO::FETCH_ASSOC);
  if (!$o) return null;

  $o['id'] = (int)$o['id'];
  $o['program_id'] = $o['program_id'] !== null ? (int)$o['program_id'] : null;
  $o['fee_required'] = (float)($o['fee_required'] ?? 0);
  $o['program_abbr'] = (string)($o['program_abbr'] ?? '');
  $o['program_name'] = (string)($o['program_name'] ?? '');
  return $o;
}

/**
 * Public org fetch used by endpoints.
 * For students: also hides non-activated orgs.
 * For admin/faculty_admin: hides non-activated orgs ONLY if they don't handle.
 */
function org_with_program(PDO $pdo, int $orgId, int $termId): ?array {
  $org = org_with_program_raw($pdo, $orgId);
  if (!$org) return null;

  enforce_activation_gate($pdo, $orgId, $termId, $org);

  return $org;
}

/* =========================
   Notifications helper
   ========================= */
function create_payment_notification(PDO $pdo, int $recipientId, int $actorId, int $orgId, int $termId, int $paymentId, string $receiptNo, float $amount): void {
  if ($recipientId <= 0 || $paymentId <= 0) return;

  $title = 'Organization Fee Payment Recorded';
  $msg = "Your organization fee payment has been recorded. Receipt: {$receiptNo}. Amount: " . number_format($amount, 2);

  try {
    $cols = [];
    $st = $pdo->query("SHOW COLUMNS FROM notifications");
    while ($r = $st->fetch(PDO::FETCH_ASSOC)) {
      $cols[strtolower((string)$r['Field'])] = true;
    }

    $has = function (string $c) use ($cols): bool {
      return isset($cols[strtolower($c)]);
    };

    $nowExpr = 'NOW()';

    // ✅ CHANGE APPLIED: your schema notif_type enum includes "payment" (NOT "org_fee_payment")
    $notifType = 'payments';

    if ($has('recipient_id') && $has('title') && $has('message')) {
      $fields = ['recipient_id', 'title', 'message'];
      $params = [':recipient_id' => $recipientId, ':title' => $title, ':message' => $msg];

      if ($has('actor_id')) { $fields[] = 'actor_id'; $params[':actor_id'] = ($actorId > 0 ? $actorId : null); }
      if ($has('notif_type')) { $fields[] = 'notif_type'; $params[':notif_type'] = $notifType; }
      if ($has('type')) { $fields[] = 'type'; $params[':type'] = $notifType; }
      if ($has('status')) { $fields[] = 'status'; $params[':status'] = 'unread'; }
      if ($has('is_read')) { $fields[] = 'is_read'; $params[':is_read'] = 0; }
      if ($has('payload_id')) { $fields[] = 'payload_id'; $params[':payload_id'] = $paymentId; }
      if ($has('reference_id')) { $fields[] = 'reference_id'; $params[':reference_id'] = $paymentId; }

      if ($has('org_id')) { $fields[] = 'org_id'; $params[':org_id'] = $orgId; }
      if ($has('academic_term_id')) { $fields[] = 'academic_term_id'; $params[':academic_term_id'] = $termId; }
      if ($has('term_id')) { $fields[] = 'term_id'; $params[':term_id'] = $termId; }

      if ($has('created_at')) {
        $fields[] = 'created_at';
        $sql = "INSERT INTO notifications (" . implode(',', $fields) . ")
                VALUES (" . implode(',', array_map(fn($f) => ($f === 'created_at' ? $nowExpr : ':' . $f), $fields)) . ")";
        $stIns = $pdo->prepare($sql);
        $stIns->execute($params);
        return;
      }

      $sql = "INSERT INTO notifications (" . implode(',', $fields) . ")
              VALUES (" . implode(',', array_map(fn($f) => ':' . $f, $fields)) . ")";
      $stIns = $pdo->prepare($sql);
      $stIns->execute($params);
      return;
    }

    if ($has('user_id') && $has('content')) {
      $fields = ['user_id', 'content'];
      $params = [':user_id' => $recipientId, ':content' => $title . ' - ' . $msg];

      if ($has('type')) { $fields[] = 'type'; $params[':type'] = $notifType; }
      if ($has('status')) { $fields[] = 'status'; $params[':status'] = 'unread'; }
      if ($has('is_read')) { $fields[] = 'is_read'; $params[':is_read'] = 0; }
      if ($has('link')) { $fields[] = 'link'; $params[':link'] = "php/print-organization-fee-receipt.php?payment_id={$paymentId}"; }

      if ($has('created_at')) {
        $fields[] = 'created_at';
        $sql = "INSERT INTO notifications (" . implode(',', $fields) . ")
                VALUES (" . implode(',', array_map(fn($f) => ($f === 'created_at' ? $nowExpr : ':' . $f), $fields)) . ")";
        $stIns = $pdo->prepare($sql);
        $stIns->execute($params);
        return;
      }

      $sql = "INSERT INTO notifications (" . implode(',', $fields) . ")
              VALUES (" . implode(',', array_map(fn($f) => ':' . $f, $fields)) . ")";
      $stIns = $pdo->prepare($sql);
      $stIns->execute($params);
      return;
    }
  } catch (\Throwable $e) {
    return;
  }
}

/* =========================
   Eligibility + pagination
   ========================= */
function eligible_students_where(array $org): array {
  $where = "u.status='Active' AND u.role='student'";
  $params = [];

  if (($org['scope'] ?? 'General') === 'Exclusive') {
    $abbr = (string)($org['program_abbr'] ?? '');
    $pname = (string)($org['program_name'] ?? '');
    $where .= " AND (u.program = :abbr OR u.program = :pname)";
    $params[':abbr'] = $abbr;
    $params[':pname'] = $pname;
  }

  return [$where, $params];
}

function read_pager(array $in, int $defaultPerPage = 10, int $maxPerPage = 100): array {
  $page = (int)($in['page'] ?? 1);
  $per = (int)($in['per_page'] ?? $defaultPerPage);
  if ($page < 1) $page = 1;
  if ($per < 1) $per = $defaultPerPage;
  if ($per > $maxPerPage) $per = $maxPerPage;
  $offset = ($page - 1) * $per;
  return [$page, $per, $offset];
}

/* =========================
   Utilities
   ========================= */
function receipt_no(int $orgId, int $termId): string {
  $date = date('Ymd');
  $rand = strtoupper(bin2hex(random_bytes(4)));
  return "ORG{$orgId}-T{$termId}-{$date}-{$rand}";
}

/* =========================
   Permissions (with activation gate)
   ========================= */
function can_view_list_for_org(PDO $pdo, int $orgId, int $termId): bool {
  $uid = current_user_id();
  if ($uid <= 0) return false;

  $role = current_role();

  // bypass roles can view regardless of activation gate
  if (is_bypass_activation_role($role)) {
    return true;
  }

  // If not activated (YEAR-based now): block view-list for everyone else
  if (!is_org_activated($pdo, $orgId, $termId)) return false;

  // student-like roles: officers can view
  if (is_student_like_role($role) && is_officer_for_org($pdo, $orgId, $termId, $uid)) return true;

  if ($role === 'super_admin') return true;

  // admin/faculty_admin must handle org to view lists
  if ($role === 'admin' || $role === 'faculty_admin') {
    $org = org_with_program_raw($pdo, $orgId);
    if (!$org) return false;
    return handles_org($pdo, $org, $uid, $role);
  }

  return false;
}

function can_set_payment_for_org(PDO $pdo, int $orgId, int $termId): bool {
  $uid = current_user_id();
  if ($uid <= 0) return false;

  // only officers can set payment (ever) - officer is YEAR-based due to is_officer_for_org fallback
  if (!is_officer_for_org($pdo, $orgId, $termId, $uid)) return false;

  // activation gate (YEAR-based now)
  if (!is_org_activated($pdo, $orgId, $termId)) return false;

  return true;
}

function my_role_summary(PDO $pdo, int $orgId, int $termId, array $org): array {
  $uid = current_user_id();
  $role = current_role();

  $isOfficer = ($uid > 0) ? is_officer_for_org($pdo, $orgId, $termId, $uid) : false;
  $isViewer = ($uid > 0) ? is_viewer_role($role) : false;
  $isActivated = is_org_activated($pdo, $orgId, $termId);

  $isOrgAdmin = false;
  $blockReason = '';

  if ($uid > 0 && ($role === 'admin' || $role === 'faculty_admin') && !$isOfficer) {
    $isOrgAdmin = handles_org($pdo, $org, $uid, $role);
    if (!$isOrgAdmin) $blockReason = 'not_handling';
  } elseif ($role === 'super_admin') {
    $isOrgAdmin = true;
  } elseif (is_bypass_activation_role($role)) {
    $isOrgAdmin = true;
  }

  if (!is_bypass_activation_role($role) && !$isActivated) {
    $blockReason = $blockReason ?: 'not_activated';
  }

  $canView = ($uid > 0) ? can_view_list_for_org($pdo, $orgId, $termId) : false;

  return [
    'user_id' => $uid,
    'role' => $role,
    'is_viewer_role' => $isViewer,
    'is_officer' => $isOfficer,
    'is_org_admin' => $isOrgAdmin,
    'is_activated' => $isActivated,
    'block_reason' => $blockReason,
    'can_view_list' => $canView,
    'can_set_payment' => ($uid > 0) ? can_set_payment_for_org($pdo, $orgId, $termId) : false,
  ];
}

/* =========================
   Router
   ========================= */
$in = read_json();
$action = (string)($in['action'] ?? '');

try {
  if ($action === 'get_organizations') {
    $term = get_active_term($pdo);
    if (!$term) fail('No active academic term found.', 400);

    $role = current_role();
    $uid = current_user_id();
    $termId = (int)$term['id'];

    $st = $pdo->query("
      SELECT o.id, o.org_name, o.abbreviation, o.scope, o.program_id, o.fee_required, o.created_by
      FROM organizations o
      WHERE o.org_type='Organization' AND o.status='Active'
      ORDER BY o.org_name ASC
    ");

    $orgs = [];
    while ($r = $st->fetch(PDO::FETCH_ASSOC)) {
      $orgId = (int)$r['id'];
      $activated = is_org_activated($pdo, $orgId, $termId); // ✅ year-based

      // ✅ Student-like roles: only see activated OR officer-bypass (officer is year-based now)
      if (is_student_like_role($role)) {
        $isOfficer = ($uid > 0) ? is_officer_for_org($pdo, $orgId, $termId, $uid) : false;
        if (!$activated && !$isOfficer) continue;
      }

      // admin/faculty_admin: can see handled orgs even if not activated;
      // but for orgs they don't handle, only show if activated.
      if ($role === 'admin' || $role === 'faculty_admin') {
        $orgRaw = org_with_program_raw($pdo, $orgId);
        $isHandling = $orgRaw ? handles_org($pdo, $orgRaw, $uid, $role) : false;
        if (!$isHandling && !$activated) continue;
      }

      // bypass roles see all
      $orgs[] = [
        'id' => $orgId,
        'org_name' => (string)$r['org_name'],
        'abbreviation' => (string)$r['abbreviation'],
        'scope' => (string)$r['scope'],
        'program_id' => $r['program_id'] !== null ? (int)$r['program_id'] : null,
        'fee_required' => (float)$r['fee_required'],
        'is_activated' => $activated,
      ];
    }

    ok(['term' => $term, 'organizations' => $orgs]);
  }

  if ($action === 'get_org_details') {
    $orgId = (int)($in['org_id'] ?? 0);
    if (!$orgId) fail('Missing org_id.');

    $term = get_active_term($pdo);
    if (!$term) fail('No active academic term found.', 400);
    $termId = (int)$term['id'];

    $org = org_with_program($pdo, $orgId, $termId);
    if (!$org) fail('Organization not found.', 404);

    ok([
      'term' => $term,
      'org' => $org,
      'permissions' => my_role_summary($pdo, $orgId, $termId, $org),
      'can_pay' => can_set_payment_for_org($pdo, $orgId, $termId), // legacy
    ]);
  }

  if ($action === 'get_my_status') {
    $orgId = (int)($in['org_id'] ?? 0);
    if (!$orgId) fail('Missing org_id.');

    $uid = current_user_id();
    if ($uid <= 0) fail('Not authenticated.', 401);

    $term = get_active_term($pdo);
    if (!$term) fail('No active academic term found.', 400);
    $termId = (int)$term['id'];

    $org = org_with_program($pdo, $orgId, $termId);
    if (!$org) fail('Organization not found.', 404);

    $stU = $pdo->prepare("
      SELECT id, id_number, first_name, middle_name, last_name, program, year_level, role, status
      FROM users
      WHERE id = :uid
      LIMIT 1
    ");
    $stU->execute([':uid' => $uid]);
    $u = $stU->fetch(PDO::FETCH_ASSOC);
    if (!$u) fail('User not found.', 404);

    $fullName = trim((string)($u['first_name'] ?? '') . ' ' . (string)($u['last_name'] ?? ''));
    $eligible = ((string)($u['status'] ?? '') === 'Active' && (string)($u['role'] ?? '') === 'student');

    if ($eligible && (($org['scope'] ?? 'General') === 'Exclusive')) {
      $abbr = (string)($org['program_abbr'] ?? '');
      $pname = (string)($org['program_name'] ?? '');
      $prog = (string)($u['program'] ?? '');
      $eligible = ($prog === $abbr || $prog === $pname);
    }

    if (!$eligible) {
      ok([
        'eligible' => false,
        'status' => 'Not Eligible',
        'student' => [
          'user_id' => (int)$u['id'],
          'id_number' => (string)($u['id_number'] ?? ''),
          'full_name' => $fullName,
          'program' => (string)($u['program'] ?? ''),
          'year_level' => (string)($u['year_level'] ?? ''),
        ],
        'term' => $term,
        'org' => $org,
      ]);
    }

    $stP = $pdo->prepare("
      SELECT id, amount, DATE_FORMAT(paid_at, '%Y-%m-%d %H:%i:%s') AS paid_at, receipt_no
      FROM organization_fee_payments
      WHERE org_id = :org_id
        AND student_user_id = :uid
        AND academic_term_id = :term_id
      ORDER BY id DESC
      LIMIT 1
    ");
    $stP->execute([
      ':org_id' => $orgId,
      ':uid' => $uid,
      ':term_id' => $termId,
    ]);
    $p = $stP->fetch(PDO::FETCH_ASSOC);

    if ($p) {
      $pid = (int)$p['id'];
      ok([
        'eligible' => true,
        'status' => 'Paid',
        'payment' => [
          'payment_id' => $pid,
          'amount' => (float)$p['amount'],
          'paid_at' => (string)$p['paid_at'],
          'receipt_no' => (string)$p['receipt_no'],
          'print_receipt_url' => "php/print-organization-fee-receipt.php?payment_id={$pid}",
        ],
        'student' => [
          'user_id' => (int)$u['id'],
          'id_number' => (string)($u['id_number'] ?? ''),
          'full_name' => $fullName,
          'program' => (string)($u['program'] ?? ''),
          'year_level' => (string)($u['year_level'] ?? ''),
        ],
        'term' => $term,
        'org' => $org,
      ]);
    }

    ok([
      'eligible' => true,
      'status' => 'Unpaid',
      'student' => [
        'user_id' => (int)$u['id'],
        'id_number' => (string)($u['id_number'] ?? ''),
        'full_name' => $fullName,
        'program' => (string)($u['program'] ?? ''),
        'year_level' => (string)($u['year_level'] ?? ''),
      ],
      'term' => $term,
      'org' => $org,
    ]);
  }

  if ($action === 'get_counts') {
    $orgId = (int)($in['org_id'] ?? 0);
    if (!$orgId) fail('Missing org_id.');

    $term = get_active_term($pdo);
    if (!$term) fail('No active academic term found.', 400);
    $termId = (int)$term['id'];

    $org = org_with_program($pdo, $orgId, $termId);
    if (!$org) fail('Organization not found.', 404);

    if (!can_view_list_for_org($pdo, $orgId, $termId)) {
      $role = current_role();
      if (!is_bypass_activation_role($role) && !is_org_activated($pdo, $orgId, $termId) && !is_student_like_role($role)) {
        fail('Organization is not activated yet.', 403, ['reason' => 'not_activated']);
      }
      fail('Forbidden.', 403);
    }

    [$where, $params] = eligible_students_where($org);

    $stPaid = $pdo->prepare("
      SELECT COUNT(*) AS c
      FROM users u
      INNER JOIN organization_fee_payments p
        ON p.student_user_id = u.id
       AND p.org_id = :org_id
       AND p.academic_term_id = :term_id
      WHERE $where
    ");
    $stPaid->execute(array_merge($params, [':org_id' => $orgId, ':term_id' => $termId]));
    $paid = (int)($stPaid->fetch(PDO::FETCH_ASSOC)['c'] ?? 0);

    $stUnpaid = $pdo->prepare("
      SELECT COUNT(*) AS c
      FROM users u
      LEFT JOIN organization_fee_payments p
        ON p.student_user_id = u.id
       AND p.org_id = :org_id
       AND p.academic_term_id = :term_id
      WHERE $where
        AND p.id IS NULL
    ");
    $stUnpaid->execute(array_merge($params, [':org_id' => $orgId, ':term_id' => $termId]));
    $unpaid = (int)($stUnpaid->fetch(PDO::FETCH_ASSOC)['c'] ?? 0);

    ok(['paid_count' => $paid, 'unpaid_count' => $unpaid]);
  }

  if ($action === 'list_paid') {
    $orgId = (int)($in['org_id'] ?? 0);
    $q = trim((string)($in['q'] ?? ''));
    if (!$orgId) fail('Missing org_id.');

    [$page, $perPage, $offset] = read_pager($in, 10, 100);

    $term = get_active_term($pdo);
    if (!$term) fail('No active academic term found.', 400);
    $termId = (int)$term['id'];

    $org = org_with_program($pdo, $orgId, $termId);
    if (!$org) fail('Organization not found.', 404);

    if (!can_view_list_for_org($pdo, $orgId, $termId)) {
      $role = current_role();
      if (!is_bypass_activation_role($role) && !is_org_activated($pdo, $orgId, $termId) && !is_student_like_role($role)) {
        fail('Organization is not activated yet.', 403, ['reason' => 'not_activated']);
      }
      fail('Forbidden.', 403);
    }

    [$where, $params] = eligible_students_where($org);

    $search = "";
    $searchParams = [];
    if ($q !== '') {
      $search = " AND (
        u.id_number LIKE :q ESCAPE '\\\\' OR
        u.first_name LIKE :q ESCAPE '\\\\' OR
        u.last_name LIKE :q ESCAPE '\\\\' OR
        CONCAT(u.first_name,' ',u.last_name) LIKE :q ESCAPE '\\\\' OR
        CONCAT(u.last_name,' ',u.first_name) LIKE :q ESCAPE '\\\\'
      )";
      $searchParams[':q'] = like_escape($q);
    }

    $stCount = $pdo->prepare("
      SELECT COUNT(*) AS c
      FROM organization_fee_payments p
      INNER JOIN users u ON u.id = p.student_user_id
      WHERE p.org_id = :org_id
        AND p.academic_term_id = :term_id
        AND $where
        $search
    ");
    $stCount->execute(array_merge(
      $params,
      $searchParams,
      [':org_id' => $orgId, ':term_id' => $termId]
    ));
    $total = (int)($stCount->fetch(PDO::FETCH_ASSOC)['c'] ?? 0);
    $totalPages = $perPage > 0 ? (int)ceil($total / $perPage) : 1;
    if ($totalPages < 1) $totalPages = 1;
    if ($page > $totalPages) { $page = $totalPages; $offset = ($page - 1) * $perPage; }

    $sql = "
      SELECT
        p.id AS payment_id,
        p.amount,
        DATE_FORMAT(p.paid_at, '%Y-%m-%d %H:%i:%s') AS paid_at,
        p.receipt_no,
        u.id AS user_id,
        u.id_number,
        u.first_name, u.middle_name, u.last_name,
        u.program, u.year_level
      FROM organization_fee_payments p
      INNER JOIN users u ON u.id = p.student_user_id
      WHERE p.org_id = :org_id
        AND p.academic_term_id = :term_id
        AND $where
        $search
      ORDER BY p.paid_at DESC, p.id DESC
      LIMIT :lim OFFSET :off
    ";
    $st = $pdo->prepare($sql);
    foreach (array_merge($params, $searchParams) as $k => $v) $st->bindValue($k, $v);
    $st->bindValue(':org_id', $orgId, PDO::PARAM_INT);
    $st->bindValue(':term_id', $termId, PDO::PARAM_INT);
    $st->bindValue(':lim', $perPage, PDO::PARAM_INT);
    $st->bindValue(':off', $offset, PDO::PARAM_INT);
    $st->execute();

    $rows = [];
    while ($r = $st->fetch(PDO::FETCH_ASSOC)) {
      $rows[] = [
        'payment_id' => (int)$r['payment_id'],
        'amount' => (float)$r['amount'],
        'paid_at' => (string)$r['paid_at'],
        'receipt_no' => (string)$r['receipt_no'],
        'user_id' => (int)$r['user_id'],
        'id_number' => (string)$r['id_number'],
        'first_name' => (string)$r['first_name'],
        'middle_name' => (string)$r['middle_name'],
        'last_name' => (string)$r['last_name'],
        'program' => (string)$r['program'],
        'year_level' => (string)$r['year_level'],
      ];
    }

    ok([
      'rows' => $rows,
      'page' => $page,
      'per_page' => $perPage,
      'total' => $total,
      'total_pages' => $totalPages,
    ]);
  }

  if ($action === 'list_unpaid') {
    $orgId = (int)($in['org_id'] ?? 0);
    $q = trim((string)($in['q'] ?? ''));
    if (!$orgId) fail('Missing org_id.');

    [$page, $perPage, $offset] = read_pager($in, 10, 100);

    $term = get_active_term($pdo);
    if (!$term) fail('No active academic term found.', 400);
    $termId = (int)$term['id'];

    $org = org_with_program($pdo, $orgId, $termId);
    if (!$org) fail('Organization not found.', 404);

    if (!can_view_list_for_org($pdo, $orgId, $termId)) {
      $role = current_role();
      if (!is_bypass_activation_role($role) && !is_org_activated($pdo, $orgId, $termId) && !is_student_like_role($role)) {
        fail('Organization is not activated yet.', 403, ['reason' => 'not_activated']);
      }
      fail('Forbidden.', 403);
    }

    [$where, $params] = eligible_students_where($org);

    $search = "";
    $searchParams = [];
    if ($q !== '') {
      $search = " AND (
        u.id_number LIKE :q ESCAPE '\\\\' OR
        u.first_name LIKE :q ESCAPE '\\\\' OR
        u.last_name LIKE :q ESCAPE '\\\\' OR
        CONCAT(u.first_name,' ',u.last_name) LIKE :q ESCAPE '\\\\' OR
        CONCAT(u.last_name,' ',u.first_name) LIKE :q ESCAPE '\\\\'
      )";
      $searchParams[':q'] = like_escape($q);
    }

    $stCount = $pdo->prepare("
      SELECT COUNT(*) AS c
      FROM users u
      LEFT JOIN organization_fee_payments p
        ON p.student_user_id = u.id
       AND p.org_id = :org_id
       AND p.academic_term_id = :term_id
      WHERE $where
        AND p.id IS NULL
        $search
    ");
    $stCount->execute(array_merge(
      $params,
      $searchParams,
      [':org_id' => $orgId, ':term_id' => $termId]
    ));
    $total = (int)($stCount->fetch(PDO::FETCH_ASSOC)['c'] ?? 0);
    $totalPages = $perPage > 0 ? (int)ceil($total / $perPage) : 1;
    if ($totalPages < 1) $totalPages = 1;
    if ($page > $totalPages) { $page = $totalPages; $offset = ($page - 1) * $perPage; }

    $st = $pdo->prepare("
      SELECT u.id AS user_id, u.id_number, u.first_name, u.middle_name, u.last_name, u.program, u.year_level
      FROM users u
      LEFT JOIN organization_fee_payments p
        ON p.student_user_id = u.id
       AND p.org_id = :org_id
       AND p.academic_term_id = :term_id
      WHERE $where
        AND p.id IS NULL
        $search
      ORDER BY u.last_name ASC, u.first_name ASC
      LIMIT :lim OFFSET :off
    ");
    foreach (array_merge($params, $searchParams) as $k => $v) $st->bindValue($k, $v);
    $st->bindValue(':org_id', $orgId, PDO::PARAM_INT);
    $st->bindValue(':term_id', $termId, PDO::PARAM_INT);
    $st->bindValue(':lim', $perPage, PDO::PARAM_INT);
    $st->bindValue(':off', $offset, PDO::PARAM_INT);
    $st->execute();

    $rows = [];
    while ($r = $st->fetch(PDO::FETCH_ASSOC)) {
      $rows[] = [
        'user_id' => (int)$r['user_id'],
        'id_number' => (string)$r['id_number'],
        'first_name' => (string)$r['first_name'],
        'middle_name' => (string)$r['middle_name'],
        'last_name' => (string)$r['last_name'],
        'program' => (string)$r['program'],
        'year_level' => (string)$r['year_level'],
      ];
    }

    ok([
      'rows' => $rows,
      'page' => $page,
      'per_page' => $perPage,
      'total' => $total,
      'total_pages' => $totalPages,
    ]);
  }

  if ($action === 'search_eligible_students') {
    $orgId = (int)($in['org_id'] ?? 0);
    $q = trim((string)($in['q'] ?? ''));
    if (!$orgId) fail('Missing org_id.');
    if ($q === '') ok(['rows' => []]);

    $term = get_active_term($pdo);
    if (!$term) fail('No active academic term found.', 400);
    $termId = (int)$term['id'];

    $org = org_with_program($pdo, $orgId, $termId);
    if (!$org) fail('Organization not found.', 404);

    if (!can_set_payment_for_org($pdo, $orgId, $termId)) {
      if (!is_org_activated($pdo, $orgId, $termId)) fail('Organization is not activated yet.', 403, ['reason' => 'not_activated']);
      fail('Forbidden.', 403);
    }

    [$where, $params] = eligible_students_where($org);

    $like = like_escape($q);

    $st = $pdo->prepare("
      SELECT
        u.id AS user_id,
        u.id_number,
        u.first_name, u.middle_name, u.last_name
      FROM users u
      WHERE $where
        AND (
          u.id_number LIKE :q1 ESCAPE '\\\\' OR
          u.first_name LIKE :q2 ESCAPE '\\\\' OR
          u.last_name LIKE :q3 ESCAPE '\\\\' OR
          CONCAT(u.first_name,' ',u.last_name) LIKE :q4 ESCAPE '\\\\' OR
          CONCAT(u.last_name,' ',u.first_name) LIKE :q5 ESCAPE '\\\\'
        )
      ORDER BY u.last_name ASC, u.first_name ASC
      LIMIT 30
    ");
    foreach ($params as $k => $v) $st->bindValue($k, $v);
    $st->bindValue(':q1', $like);
    $st->bindValue(':q2', $like);
    $st->bindValue(':q3', $like);
    $st->bindValue(':q4', $like);
    $st->bindValue(':q5', $like);
    $st->execute();

    $rows = [];
    while ($r = $st->fetch(PDO::FETCH_ASSOC)) {
      $name = trim((string)$r['last_name'] . ", " . (string)$r['first_name'] . " " . (string)$r['middle_name']);
      $rows[] = [
        'user_id' => (int)$r['user_id'],
        'id_number' => (string)$r['id_number'],
        'name' => preg_replace('/\s+/', ' ', $name) ?: $name,
      ];
    }

    ok(['rows' => $rows]);
  }

  if ($action === 'set_payment') {
    $orgId = (int)($in['org_id'] ?? 0);
    $studentId = (int)($in['student_id'] ?? 0);
    $amount = (float)($in['amount'] ?? 0);
    $paidAt = (string)($in['paid_at'] ?? '');

    // ✅ NEW: accept optional manual receipt
    $manualReceipt = trim((string)($in['receipt_no'] ?? ''));

    if (!$orgId || !$studentId) fail('Missing org_id or student_id.');
    if ($amount < 0) fail('Invalid amount.');
    if ($paidAt === '') fail('Missing paid_at.');

    $term = get_active_term($pdo);
    if (!$term) fail('No active academic term found.', 400);
    $termId = (int)$term['id'];

    $org = org_with_program($pdo, $orgId, $termId);
    if (!$org) fail('Organization not found.', 404);

    if (!can_set_payment_for_org($pdo, $orgId, $termId)) {
      if (!is_org_activated($pdo, $orgId, $termId)) fail('Organization is not activated yet.', 403, ['reason' => 'not_activated']);
      fail('Forbidden.', 403);
    }

    [$where, $params] = eligible_students_where($org);

    $stEligible = $pdo->prepare("
      SELECT 1
      FROM users u
      WHERE u.id = :sid AND $where
      LIMIT 1
    ");
    $stEligible->execute(array_merge($params, [':sid' => $studentId]));
    if (!$stEligible->fetchColumn()) fail('Student is not eligible for this organization fee.', 400);

    $stDup = $pdo->prepare("
      SELECT 1
      FROM organization_fee_payments
      WHERE org_id = :org_id
        AND student_user_id = :sid
        AND academic_term_id = :term_id
      LIMIT 1
    ");
    $stDup->execute([
      ':org_id' => $orgId,
      ':sid' => $studentId,
      ':term_id' => $termId,
    ]);
    if ($stDup->fetchColumn()) fail('This student already has a paid record for this term.', 400);

    // ✅ Choose receipt:
    // - if user provided receipt_no => use it
    // - else generate
    $receipt = $manualReceipt !== '' ? $manualReceipt : receipt_no($orgId, $termId);

    // ✅ If manual receipt provided, ensure it's not already used
    if ($manualReceipt !== '') {
      $stR = $pdo->prepare("SELECT 1 FROM organization_fee_payments WHERE receipt_no = :r LIMIT 1");
      $stR->execute([':r' => $receipt]);
      if ($stR->fetchColumn()) fail('Receipt number already exists.', 400);
    }

    $pdo->beginTransaction();
    try {
      $paidBy = current_user_id();
      if (!$paidBy) $paidBy = $studentId;

      $ins = $pdo->prepare("
        INSERT INTO organization_fee_payments
          (org_id, student_user_id, academic_term_id, amount, paid_at, receipt_no, paid_by_user_id)
        VALUES
          (:org_id, :sid, :term_id, :amount, :paid_at, :receipt_no, :paid_by)
      ");
      $ins->execute([
        ':org_id' => $orgId,
        ':sid' => $studentId,
        ':term_id' => $termId,
        ':amount' => $amount,
        ':paid_at' => $paidAt,
        ':receipt_no' => $receipt,
        ':paid_by' => $paidBy,
      ]);

      $paymentId = (int)$pdo->lastInsertId();

      create_payment_notification(
        $pdo,
        $studentId,
        $paidBy,
        $orgId,
        $termId,
        $paymentId,
        $receipt,
        $amount
      );

      $pdo->commit();

      ok([
        'payment_id' => $paymentId,
        'receipt_no' => $receipt,
        'print_receipt_url' => "php/print-organization-fee-receipt.php?payment_id={$paymentId}",
      ]);
    } catch (\Throwable $e) {
      if ($pdo->inTransaction()) $pdo->rollBack();

      // optional: nicer message for duplicate receipt collisions on auto-gen (rare)
      if (stripos($e->getMessage(), 'Duplicate') !== false) {
        fail('Duplicate receipt number. Please try again.', 409);
      }
      throw $e;
    }
  }

  if ($action === 'notify_unpaid_student') {

  $orgId = (int)($in['org_id'] ?? 0);
  $studentId = (int)($in['student_id'] ?? 0);

  if (!$orgId || !$studentId) fail('Missing org_id or student_id.');

  $term = get_active_term($pdo);
  if (!$term) fail('No active academic term found.', 400);
  $termId = (int)$term['id'];

  $org = org_with_program($pdo, $orgId, $termId);
  if (!$org) fail('Organization not found.', 404);

  // Permission: only those who can view list can send reminders
  if (!can_view_list_for_org($pdo, $orgId, $termId)) {
    fail('Forbidden.', 403);
  }

  // Optional: ensure student is currently UNPAID (prevents trolling)
  $stPaid = $pdo->prepare("
    SELECT 1
    FROM organization_fee_payments
    WHERE org_id = :org_id
      AND student_user_id = :sid
      AND academic_term_id = :term_id
    LIMIT 1
  ");
  $stPaid->execute([':org_id' => $orgId, ':sid' => $studentId, ':term_id' => $termId]);
  if ($stPaid->fetchColumn()) {
    fail('Student is already marked as paid.', 400);
  }

  $actorId = current_user_id();

  $title = "Unpaid Organization Fee Reminder";
  $msg = "You still have an unpaid organization fee for " . (string)($org['org_name'] ?? 'this organization') . ". Please settle it with your organization officer.";

  // ✅ Column-safe insert (matches your schema variations)
  try {
    $cols = [];
    $st = $pdo->query("SHOW COLUMNS FROM notifications");
    while ($r = $st->fetch(PDO::FETCH_ASSOC)) {
      $cols[strtolower((string)$r['Field'])] = true;
    }

    $has = function (string $c) use ($cols): bool {
      return isset($cols[strtolower($c)]);
    };

    // Preferred schema: recipient_id/title/message
    if ($has('recipient_id') && $has('title') && $has('message')) {
      $fields = ['recipient_id', 'title', 'message'];
      $params = [
        ':recipient_id' => $studentId,
        ':title' => $title,
        ':message' => $msg,
      ];

      if ($has('actor_id')) { $fields[] = 'actor_id'; $params[':actor_id'] = ($actorId > 0 ? $actorId : null); }
      if ($has('notif_type')) { $fields[] = 'notif_type'; $params[':notif_type'] = 'general'; }
      if ($has('type')) { $fields[] = 'type'; $params[':type'] = 'general'; }
      if ($has('status')) { $fields[] = 'status'; $params[':status'] = 'unread'; }
      if ($has('is_read')) { $fields[] = 'is_read'; $params[':is_read'] = 0; }

      // These might NOT exist in your table (and caused your error)
      if ($has('org_id')) { $fields[] = 'org_id'; $params[':org_id'] = $orgId; }
      if ($has('academic_term_id')) { $fields[] = 'academic_term_id'; $params[':academic_term_id'] = $termId; }
      if ($has('term_id')) { $fields[] = 'term_id'; $params[':term_id'] = $termId; }

      if ($has('created_at')) {
        $fields[] = 'created_at';
        $sql = "INSERT INTO notifications (" . implode(',', $fields) . ")
                VALUES (" . implode(',', array_map(fn($f) => ($f === 'created_at' ? 'NOW()' : ':' . $f), $fields)) . ")";
        $ins = $pdo->prepare($sql);
        $ins->execute($params);
      } else {
        $sql = "INSERT INTO notifications (" . implode(',', $fields) . ")
                VALUES (" . implode(',', array_map(fn($f) => ':' . $f, $fields)) . ")";
        $ins = $pdo->prepare($sql);
        $ins->execute($params);
      }

      ok(['message' => 'Notification sent.']);
    }

    // Fallback schema: user_id/content
    if ($has('user_id') && $has('content')) {
      $fields = ['user_id', 'content'];
      $params = [
        ':user_id' => $studentId,
        ':content' => $title . ' - ' . $msg,
      ];

      if ($has('notif_type')) { $fields[] = 'notif_type'; $params[':notif_type'] = 'general'; }
      if ($has('type')) { $fields[] = 'type'; $params[':type'] = 'general'; }
      if ($has('status')) { $fields[] = 'status'; $params[':status'] = 'unread'; }
      if ($has('is_read')) { $fields[] = 'is_read'; $params[':is_read'] = 0; }
      if ($has('created_at')) {
        $fields[] = 'created_at';
        $sql = "INSERT INTO notifications (" . implode(',', $fields) . ")
                VALUES (" . implode(',', array_map(fn($f) => ($f === 'created_at' ? 'NOW()' : ':' . $f), $fields)) . ")";
        $ins = $pdo->prepare($sql);
        $ins->execute($params);
      } else {
        $sql = "INSERT INTO notifications (" . implode(',', $fields) . ")
                VALUES (" . implode(',', array_map(fn($f) => ':' . $f, $fields)) . ")";
        $ins = $pdo->prepare($sql);
        $ins->execute($params);
      }

      ok(['message' => 'Notification sent.']);
    }

    // If schema doesn't match either pattern
    fail('Notifications table schema not supported (missing recipient/title/message or user_id/content).', 500);

  } catch (\Throwable $e) {
    fail('Server error: ' . $e->getMessage(), 500);
  }
}

  fail('Unknown action.', 400);

} catch (\Throwable $e) {
  fail('Server error: ' . $e->getMessage(), 500);
}
//set_payment