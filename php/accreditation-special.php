<?php
declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');

session_start();

/**
 * IMPORTANT:
 * - We store file paths in DB as relative paths (NO leading slash)
 * - We RETURN public URLs as "/<appbase>/<relative>" so they work from any page depth
 * - This endpoint supports JSON (application/json) AND multipart/form-data
 *
 * ✅ ACCREDITATION IS ONCE PER SCHOOL YEAR (NOT PER SEMESTER)
 * - We keep academic_terms as-is (1st/2nd/Summer) for other modules.
 * - But this endpoint "MERGES" 1st+2nd for accreditation views by using ONLY at.school_year:
 *    - list_terms returns unique school_year options (terms_years)
 *    - list_requests filters by at.school_year (semester ignored)
 *    - term_label shown everywhere is school_year only
 * - semester input is accepted but ignored (backward compat).
 */
define('UPLOAD_BASE', 'assets/uploads');
define('TEMPLATES_DIR', UPLOAD_BASE . '/accreditation/templates');
define('RECOMMEND_DIR', UPLOAD_BASE . '/accreditation/recommendations');

/* =============================
   Response helpers (JS expects ok/error)
   ============================= */
function out(array $payload, int $code = 200): void {
  http_response_code($code);
  echo json_encode($payload, JSON_UNESCAPED_SLASHES);
  exit;
}
function ok(array $data = []): void {
  out(array_merge(['ok' => true], $data), 200);
}
function fail(string $msg, int $code = 400, array $extra = []): void {
  out(array_merge(['ok' => false, 'error' => $msg], $extra), $code);
}

/* =============================
   Input helpers (JSON + POST + GET)
   ============================= */
function read_json_body(): array {
  $ct = $_SERVER['CONTENT_TYPE'] ?? $_SERVER['HTTP_CONTENT_TYPE'] ?? '';
  if (stripos($ct, 'application/json') === false) return [];
  $raw = file_get_contents('php://input');
  if ($raw === false || $raw === '') return [];
  $data = json_decode($raw, true);
  return is_array($data) ? $data : [];
}
$GLOBALS['__json_body'] = read_json_body();

function inp(string $key, $default = null) {
  $j = $GLOBALS['__json_body'] ?? [];
  if (is_array($j) && array_key_exists($key, $j)) return $j[$key];
  if (array_key_exists($key, $_POST)) return $_POST[$key];
  if (array_key_exists($key, $_GET)) return $_GET[$key];
  return $default;
}

function clamp_int($v, int $min, int $max, int $fallback): int {
  $n = (int)$v;
  if ($n < $min) return $fallback;
  if ($n > $max) return $max;
  return $n;
}

/** Escape term for LIKE and wrap with %...% */
function like_escape(string $q): string {
  $q = str_replace('\\', '\\\\', $q);
  $q = str_replace(['%', '_'], ['\%', '\_'], $q);
  return '%' . $q . '%';
}

function file_ext(string $name): string {
  $pos = strrpos($name, '.');
  return $pos === false ? '' : strtolower(substr($name, $pos + 1));
}
function safe_filename(string $name): string {
  $name = preg_replace('/[^A-Za-z0-9._-]+/', '_', $name);
  $name = trim((string)$name, '._-');
  return $name !== '' ? $name : 'file';
}
function ensure_dir(string $dir): void {
  if (!is_dir($dir)) {
    if (!mkdir($dir, 0775, true) && !is_dir($dir)) {
      fail('Failed to create upload directory: ' . $dir, 500);
    }
  }
}

/**
 * ✅ Robust app base URL:
 * If SCRIPT_NAME contains "/php/", we take everything BEFORE that as the app base.
 *
 * Examples:
 *  - /EduOrg/php/accreditation/special.php  => /EduOrg/
 *  - /php/accreditation/special.php         => /
 */
function app_base_url(): string {
  static $base = null;
  if (is_string($base)) return $base;

  $sn = (string)($_SERVER['SCRIPT_NAME'] ?? '');
  $sn = str_replace('\\', '/', $sn);

  $pos = strpos($sn, '/php/');
  if ($pos !== false) {
    $p = substr($sn, 0, $pos); // "/EduOrg" or ""
    $p = rtrim($p, '/');
    $base = ($p === '') ? '/' : ($p . '/');
    return $base;
  }

  // fallback: old behavior (best-effort)
  $p = dirname(dirname(dirname($sn)));
  $p = str_replace('\\', '/', $p);
  $p = rtrim($p, '/');
  $base = ($p === '' || $p === '.' || $p === '/') ? '/' : ($p . '/');
  return $base;
}

/**
 * Return a PUBLIC URL valid from ANY page depth.
 * We store rel paths like: assets/uploads/...
 * We return: /EduOrg/assets/uploads/... (or /assets/uploads/... if app at root)
 */
function public_url(string $relPath): string {
  $rel = ltrim($relPath, "/\\");
  return app_base_url() . $rel;
}

/**
 * ✅ Fix: Resolve project root based on DOCUMENT_ROOT + app_base_url().
 */
function project_root(): string {
  static $root = null;
  if (is_string($root) && $root !== '') return $root;

  $doc = (string)($_SERVER['DOCUMENT_ROOT'] ?? '');
  $docRoot = $doc !== '' ? realpath($doc) : false;
  if ($docRoot === false) {
    // last fallback to relative path from this script
    $cand = realpath(__DIR__ . '/../../');
    if ($cand === false) fail('Project root not found (check folder structure).', 500);
    $root = $cand;
    return $root;
  }

  $base = trim(app_base_url(), '/'); // "EduOrg" or ""
  if ($base === '') {
    $root = $docRoot;
    return $root;
  }

  $cand = $docRoot . DIRECTORY_SEPARATOR . str_replace('/', DIRECTORY_SEPARATOR, $base);
  $real = realpath($cand);
  $root = ($real !== false) ? $real : $cand;

  return $root;
}

/** Secure unlink for files under UPLOAD_BASE only */
function safe_unlink_upload(string $relPath): bool {
  $rel = ltrim($relPath, "/\\");
  $base = realpath(project_root() . '/' . UPLOAD_BASE);
  if ($base === false) return false;

  $abs = realpath(project_root() . '/' . $rel);
  if ($abs === false) return false;

  if (strpos($abs, $base) !== 0) return false;
  if (!is_file($abs)) return false;
  return @unlink($abs);
}

/* =============================
   DB + auth
   ============================= */
function db(): mysqli {
  static $conn = null;
  if ($conn instanceof mysqli) return $conn;

  $candidates = [
    __DIR__ . '/../db.php',
    __DIR__ . '/../config/db.php',
    __DIR__ . '/../config.php',
    __DIR__ . '/db.php',
    __DIR__ . '/config/db.php',
    __DIR__ . '/config.php',
    __DIR__ . '/../../php/db.php',
    __DIR__ . '/../../php/config/db.php',
    __DIR__ . '/../../php/config.php',
  ];

  foreach ($candidates as $f) {
    if (file_exists($f)) {
      require_once $f;
      if (isset($mysqli) && $mysqli instanceof mysqli) {
        $conn = $mysqli;
        break;
      }
      if (isset($conn) && $conn instanceof mysqli) {
        break;
      }
    }
  }

  if (!($conn instanceof mysqli)) {
    $conn = new mysqli('localhost', 'root', '', 'educorev2');
    if ($conn->connect_error) fail('Database connection failed: ' . $conn->connect_error, 500);
  }

  $conn->set_charset('utf8mb4');
  return $conn;
}

function current_user_id(): ?int {
  if (!empty($_SESSION['user_id'])) return (int)$_SESSION['user_id'];
  if (!empty($_SESSION['user']['id'])) return (int)$_SESSION['user']['id'];
  return null;
}

function current_user_role(mysqli $db, int $uid): ?string {
  if (!empty($_SESSION['role'])) return (string)$_SESSION['role'];
  if (!empty($_SESSION['user']['role'])) return (string)$_SESSION['user']['role'];

  $stmt = $db->prepare('SELECT role FROM users WHERE id=? LIMIT 1');
  if (!$stmt) fail('DB error preparing role lookup.', 500);
  $stmt->bind_param('i', $uid);
  $stmt->execute();
  $row = $stmt->get_result()->fetch_assoc();
  $stmt->close();

  return $row['role'] ?? null;
}

function require_special_admin(mysqli $db): int {
  $uid = current_user_id();
  if (!$uid) fail('Unauthorized. Please login.', 401);

  $role = current_user_role($db, $uid);
  if ($role !== 'special_admin') fail('Forbidden. Special admin only.', 403);
  return $uid;
}

/**
 * "Active term" is still per semester in DB, but accreditation is per YEAR.
 * We use active_term to derive active_school_year.
 */
function active_term_row(mysqli $db): ?array {
  $res = $db->query("SELECT id, school_year, semester, status FROM academic_terms WHERE status='Active' ORDER BY id DESC LIMIT 1");
  if (!$res) return null;
  $row = $res->fetch_assoc();
  return $row ?: null;
}

function active_term_id(mysqli $db): ?int {
  $t = active_term_row($db);
  return $t ? (int)$t['id'] : null;
}

function active_school_year(mysqli $db): ?string {
  $t = active_term_row($db);
  $sy = $t ? trim((string)($t['school_year'] ?? '')) : '';
  return $sy !== '' ? $sy : null;
}

/**
 * ✅ Accreditation "term label" is school_year ONLY.
 */
function accreditation_label(string $schoolYear): string {
  $sy = trim($schoolYear);
  return $sy !== '' ? $sy : '—';
}

/**
 * bind_param helper that works reliably (bind_param requires references).
 */
function bind_stmt(mysqli_stmt $stmt, string $types, array $params): void {
  if ($types === '' || empty($params)) return;

  $refs = [];
  foreach ($params as $k => $v) $refs[$k] = $params[$k];

  $args = [];
  $args[] = $types;
  foreach ($refs as $k => &$val) $args[] = &$val;

  if (!call_user_func_array([$stmt, 'bind_param'], $args)) {
    fail('DB error binding parameters.', 500);
  }
}

// Helper function to add notification
function add_notification(mysqli $db, int $recipient_id, ?int $actor_id, string $title, string $message, string $notif_type = 'accreditation', ?int $payload_id = null): int {
  $stmt = $db->prepare("
    INSERT INTO notifications (recipient_id, actor_id, title, message, notif_type, status, payload_id, created_at)
    VALUES (?, ?, ?, ?, ?, 'unread', ?, NOW())
  ");
  if (!$stmt) return 0;

  $actor  = $actor_id;    // may be null
  $payload = $payload_id; // may be null

  $stmt->bind_param('iisssi', $recipient_id, $actor, $title, $message, $notif_type, $payload);
  $stmt->execute();
  $id = (int)$stmt->insert_id;
  $stmt->close();
  return $id;
}

/**
 * ✅ "Current active super_admin":
 * - role = super_admin
 * - status = Active
 * If multiple are active, we pick the most recently logged-in one (fallback: newest id).
 */
function current_active_super_admin_id(mysqli $db): ?int {
  $sql = "
    SELECT id
    FROM users
    WHERE role='super_admin' AND status='Active'
    ORDER BY
      (last_login_at IS NULL) ASC,
      last_login_at DESC,
      id DESC
    LIMIT 1
  ";
  $res = $db->query($sql);
  if (!$res) return null;
  $row = $res->fetch_assoc();
  $id = (int)($row['id'] ?? 0);
  return $id > 0 ? $id : null;
}

function notify_current_super_admin(mysqli $db, int $actor_id, string $title, string $message, ?int $payload_id = null): bool {
  $sid = current_active_super_admin_id($db);
  if (!$sid) return false;
  add_notification($db, $sid, $actor_id, $title, $message, 'accreditation', $payload_id);
  return true;
}

/**
 * ✅ Fetch full request/org context
 * ✅ UPDATED: term_label is school_year only (accreditation once a year)
 */
function get_request_context(mysqli $db, int $requestId): ?array {
  $stmt = $db->prepare("
    SELECT
      ar.id AS request_id,
      ar.coordinator_user_id,
      u.first_name,
      u.last_name,
      o.org_name,
      o.abbreviation AS org_abbr,
      o.scope,
      o.description AS org_description,
      COALESCE(p.abbreviation,'') AS program,
      at.school_year AS term_label
    FROM accreditation_requests ar
    JOIN users u ON u.id = ar.coordinator_user_id
    JOIN organizations o ON o.id = ar.org_id
    JOIN academic_terms at ON at.id = ar.academic_term_id
    LEFT JOIN programs p ON p.id = o.program_id
    WHERE ar.id = ?
    LIMIT 1
  ");
  if (!$stmt) return null;

  $stmt->bind_param('i', $requestId);
  $stmt->execute();
  $result = $stmt->get_result();
  $row = $result->fetch_assoc();
  $stmt->close();

  if (!$row) return null;
  $row['term_label'] = accreditation_label((string)($row['term_label'] ?? ''));
  return $row;
}

/* =============================
   Boot
   ============================= */
$db = db();
$special_uid = require_special_admin($db);

$action = (string)inp('action', '');
if ($action === '') fail('Missing action.');

/* =============================
   TERMS
   ✅ UPDATED: merged view by school_year
   ============================= */
if ($action === 'list_terms') {
  $rows = [];
  $res = $db->query('SELECT id, school_year, semester, status FROM academic_terms ORDER BY id DESC');
  if ($res) $rows = $res->fetch_all(MYSQLI_ASSOC);

  $asy = active_school_year($db) ?? '';

  // build year options
  $yearsMap = []; // school_year => option
  foreach ($rows as $t) {
    $sy = trim((string)($t['school_year'] ?? ''));
    if ($sy === '') continue;

    if (!isset($yearsMap[$sy])) {
      $yearsMap[$sy] = [
        'school_year' => $sy,
        'label' => accreditation_label($sy),
        // pick newest term id for that year as representative
        'representative_term_id' => (int)($t['id'] ?? 0),
        'is_active_year' => ($asy !== '' && $sy === $asy),
      ];
    } else {
      $yearsMap[$sy]['representative_term_id'] = max((int)$yearsMap[$sy]['representative_term_id'], (int)($t['id'] ?? 0));
    }
  }

  $yearsList = array_values($yearsMap);
  usort($yearsList, function ($a, $b) {
    return strcmp((string)$b['school_year'], (string)$a['school_year']);
  });

  // backward compat: keep original terms with old label
  foreach ($rows as &$t) {
    $sy = (string)($t['school_year'] ?? '');
    $sm = (string)($t['semester'] ?? '');
    $t['label'] = ($sy !== '' ? $sy : '—') . ' • ' . ($sm !== '' ? $sm : '—');
  }

  ok([
    'terms' => $rows,
    'terms_years' => $yearsList,
    'active_term_id' => active_term_id($db),
    'active_school_year' => ($asy !== '' ? $asy : null),
    'years' => array_map(fn($y) => $y['school_year'], $yearsList),
    'semesters' => [], // deprecated for accreditation
  ]);
}

/* =============================
   REQUESTS LIST (pending/active/recommended)
   ✅ UPDATED: filter/label by SCHOOL YEAR only (semester ignored)
   ============================= */
if ($action === 'list_requests') {
  $mode   = strtolower((string)inp('mode', 'pending'));
  $q      = trim((string)inp('q', ''));

  // still accepted if UI sends them:
  $termId = (int)inp('term_id', 0);
  $schoolYear = trim((string)inp('school_year', ''));
  $semester   = trim((string)inp('semester', '')); // ignored

  $page  = clamp_int(inp('page', 1), 1, 1000000, 1);
  $per   = clamp_int(inp('per_page', 10), 1, 100, 10);
  $off   = ($page - 1) * $per;

  // default school_year to ACTIVE school_year
  if ($schoolYear === '') {
    $asy = active_school_year($db);
    if ($asy) $schoolYear = $asy;
  }

  $where = [];
  $types = '';
  $params = [];

  if ($mode === 'pending') {
    $status = (string)inp('status', 'Pending');
    $allowed = ['Draft','Pending','Returned','Recommended','Approved','Rejected','Active'];
    if (!in_array($status, $allowed, true)) $status = 'Pending';
    $where[] = 'ar.status=?';
    $types .= 's';
    $params[] = $status;
  } elseif ($mode === 'recommended') {
    $where[] = 'ar.status=?';
    $types .= 's';
    $params[] = 'Recommended';
  } else {
    $where[] = "ar.status='Active'";
  }

  // school-year first
  if ($schoolYear !== '') { $where[] = 'at.school_year=?'; $types .= 's'; $params[] = $schoolYear; }

  // optional explicit term filter (only if passed)
  if ($termId > 0) { $where[] = 'ar.academic_term_id=?'; $types .= 'i'; $params[] = $termId; }

  // include o.description in search
  if ($q !== '') {
    $where[] = '(o.org_name LIKE ? OR o.abbreviation LIKE ? OR o.description LIKE ?)';
    $like = like_escape($q);
    $types .= 'sss';
    $params[] = $like;
    $params[] = $like;
    $params[] = $like;
  }

  $whereSql = $where ? ('WHERE ' . implode(' AND ', $where)) : '';

  $join = "
    FROM accreditation_requests ar
    JOIN organizations o ON o.id = ar.org_id
    JOIN academic_terms at ON at.id = ar.academic_term_id
    LEFT JOIN programs p ON p.id = o.program_id
    JOIN users c ON c.id = ar.coordinator_user_id
    LEFT JOIN users m ON m.id = ar.moderator_user_id
  ";

  $stmt = $db->prepare('SELECT COUNT(*) AS cnt ' . $join . ' ' . $whereSql);
  if (!$stmt) fail('DB error preparing request count.', 500);
  if ($types !== '') bind_stmt($stmt, $types, $params);
  $stmt->execute();
  $totalRow = $stmt->get_result()->fetch_assoc();
  $total = (int)($totalRow['cnt'] ?? 0);
  $stmt->close();

  $sql = "
    SELECT
      ar.id,
      ar.status,
      o.org_name,
      o.abbreviation AS org_abbr,
      o.scope,
      COALESCE(p.abbreviation,'') AS program,
      at.school_year AS term_label,
      CONCAT(c.first_name,' ',c.last_name) AS coordinator_name,
      CONCAT(m.first_name,' ',m.last_name) AS moderator_name,
      ar.updated_at
    $join
    $whereSql
    ORDER BY ar.updated_at DESC
    LIMIT ? OFFSET ?
  ";

  $stmt = $db->prepare($sql);
  if (!$stmt) fail('DB error preparing request list.', 500);

  if ($types !== '') {
    $types2 = $types . 'ii';
    $params2 = array_merge($params, [$per, $off]);
    bind_stmt($stmt, $types2, $params2);
  } else {
    $stmt->bind_param('ii', $per, $off);
  }

  $stmt->execute();
  $items = $stmt->get_result()->fetch_all(MYSQLI_ASSOC);
  $stmt->close();

  foreach ($items as &$it) {
    $it['term_label'] = accreditation_label((string)($it['term_label'] ?? ''));
  }

  // counts (same school_year filter so badges match what you see)
  $counts = ['pending' => 0, 'active' => 0, 'recommended' => 0];
  $countWhere = [];
  $countTypes = '';
  $countParams = [];
  if ($schoolYear !== '') { $countWhere[] = 'at.school_year=?'; $countTypes .= 's'; $countParams[] = $schoolYear; }
  if ($termId > 0)        { $countWhere[] = 'ar.academic_term_id=?'; $countTypes .= 'i'; $countParams[] = $termId; }
  $countWhereSql = $countWhere ? ('WHERE ' . implode(' AND ', $countWhere)) : '';

  $countSql = "
    SELECT
      SUM(CASE WHEN ar.status='Pending' THEN 1 ELSE 0 END) AS pending,
      SUM(CASE WHEN ar.status='Active' THEN 1 ELSE 0 END) AS active,
      SUM(CASE WHEN ar.status='Recommended' THEN 1 ELSE 0 END) AS recommended
    FROM accreditation_requests ar
    JOIN academic_terms at ON at.id = ar.academic_term_id
    $countWhereSql
  ";
  $stmt = $db->prepare($countSql);
  if ($stmt) {
    if ($countTypes !== '') bind_stmt($stmt, $countTypes, $countParams);
    $stmt->execute();
    $c = $stmt->get_result()->fetch_assoc();
    $stmt->close();

    $counts['pending'] = (int)($c['pending'] ?? 0);
    $counts['active']  = (int)($c['active'] ?? 0);
    $counts['recommended'] = (int)($c['recommended'] ?? 0);
  }

  ok([
    'items' => $items,
    'page' => $page,
    'per_page' => $per,
    'total' => $total,
    'counts' => $counts,
    'school_year' => $schoolYear,
    'semester' => null, // merged
    'term_id' => $termId,
    'note' => ($semester !== '' ? 'semester filter ignored (accreditation is per school_year).' : null),
  ]);
}

/* =============================
   Request details + docs
   ============================= */
function officers_for(mysqli $db, int $orgId, int $termId): array {
  $exists = $db->query("SHOW TABLES LIKE 'organization_officers'");
  if (!$exists || $exists->num_rows === 0) return [];

  $stmt = $db->prepare("SELECT position, user_id, full_name, course_year, status
                        FROM organization_officers
                        WHERE org_id=? AND academic_term_id=?
                        ORDER BY position ASC");
  if (!$stmt) return [];
  $stmt->bind_param('ii', $orgId, $termId);
  $stmt->execute();
  $rows = $stmt->get_result()->fetch_all(MYSQLI_ASSOC);
  $stmt->close();
  return $rows;
}

function docs_for(mysqli $db, int $requestId, int $page, int $per): array {
  $page = max(1, $page);
  $per  = max(1, min(50, $per));
  $off  = ($page - 1) * $per;

  $stmt = $db->prepare('SELECT COUNT(*) AS cnt FROM accreditation_request_documents WHERE request_id=?');
  if (!$stmt) fail('DB error preparing docs count.', 500);
  $stmt->bind_param('i', $requestId);
  $stmt->execute();
  $row = $stmt->get_result()->fetch_assoc();
  $total = (int)($row['cnt'] ?? 0);
  $stmt->close();

  $stmt = $db->prepare("SELECT
      d.id,
      d.requirement_id,
      r.requirement_name,
      d.file_path,
      d.file_name,
      d.status,
      d.reviewed_by,
      d.reviewed_at,
      d.return_reason,
      d.uploaded_at
    FROM accreditation_request_documents d
    JOIN accreditation_requirements r ON r.id = d.requirement_id
    WHERE d.request_id=?
    ORDER BY r.sort_order ASC, r.requirement_name ASC
    LIMIT ? OFFSET ?");
  if (!$stmt) fail('DB error preparing docs list.', 500);

  $stmt->bind_param('iii', $requestId, $per, $off);
  $stmt->execute();
  $items = $stmt->get_result()->fetch_all(MYSQLI_ASSOC);
  $stmt->close();

  foreach ($items as &$d) {
    $d['file_url'] = ($d['file_path'] ?? '') ? public_url((string)$d['file_path']) : '';
  }

  return ['items' => $items, 'page' => $page, 'per' => $per, 'total' => $total];
}

if ($action === 'get_request') {
  $requestId = (int)inp('request_id', 0);
  if ($requestId <= 0) fail('Invalid request_id.');

  $stmt = $db->prepare("SELECT
      ar.id,
      ar.status,
      ar.submitted_at,
      ar.updated_at,
      ar.special_admin_notes,
      ar.super_admin_notes,
      o.id AS org_id,
      o.org_name,
      o.abbreviation AS org_abbr,
      o.logo_path,
      o.description,
      o.mission, o.vision, o.objectives, o.advocacy,
      o.scope,
      COALESCE(p.abbreviation,'') AS program,
      at.id AS term_id,
      at.school_year AS term_label,
      CONCAT(c.first_name,' ',c.last_name) AS coordinator_name,
      CONCAT(m.first_name,' ',m.last_name) AS moderator_name
    FROM accreditation_requests ar
    JOIN organizations o ON o.id = ar.org_id
    JOIN academic_terms at ON at.id = ar.academic_term_id
    LEFT JOIN programs p ON p.id = o.program_id
    JOIN users c ON c.id = ar.coordinator_user_id
    LEFT JOIN users m ON m.id = ar.moderator_user_id
    WHERE ar.id=?
    LIMIT 1");
  if (!$stmt) fail('DB error preparing request details.', 500);

  $stmt->bind_param('i', $requestId);
  $stmt->execute();
  $req = $stmt->get_result()->fetch_assoc();
  $stmt->close();

  if (!$req) fail('Request not found.', 404);

  $req['logo_url'] = ($req['logo_path'] ?? '') ? public_url((string)$req['logo_path']) : '';
  $req['term_label'] = accreditation_label((string)($req['term_label'] ?? ''));

  $orgId = (int)($req['org_id'] ?? 0);
  $termId = (int)($req['term_id'] ?? 0);

  $docsPage = clamp_int(inp('docs_page', inp('page', 1)), 1, 1000000, 1);
  $docsPer  = clamp_int(inp('docs_per_page', inp('per_page', 10)), 1, 50, 10);

  ok([
    'request' => $req,
    'officers' => ($orgId > 0 && $termId > 0) ? officers_for($db, $orgId, $termId) : [],
    'docs' => docs_for($db, $requestId, $docsPage, $docsPer),
  ]);
}

if ($action === 'get_request_docs') {
  $requestId = (int)inp('request_id', 0);
  if ($requestId <= 0) fail('Invalid request_id.');
  $page = clamp_int(inp('page', 1), 1, 1000000, 1);
  $per  = clamp_int(inp('per_page', 10), 1, 50, 10);
  ok(['docs' => docs_for($db, $requestId, $page, $per)]);
}

/* =============================
   Review document + moderator
   ============================= */
if ($action === 'return_document') {
  $GLOBALS['__json_body']['decision'] = 'return';
  $GLOBALS['__json_body']['return_reason'] = (string)inp('reason', inp('return_reason', ''));
  $action = 'review_document';
}

if ($action === 'review_document') {
  $docId = (int)inp('doc_id', 0);
  $decision = strtolower((string)inp('decision', ''));
  $reason = trim((string)inp('return_reason', ''));

  if ($docId <= 0) fail('Invalid doc_id.');
  if (!in_array($decision, ['accept','return'], true)) fail('Invalid decision.');
  if ($decision === 'return' && $reason === '') fail('Return reason is required.');

  $newStatus = ($decision === 'accept') ? 'Accepted' : 'Returned';
  $reasonToStore = ($decision === 'return') ? $reason : null;

  $stmt = $db->prepare("UPDATE accreditation_request_documents
                        SET status=?, reviewed_by=?, reviewed_at=NOW(), return_reason=?
                        WHERE id=?
                        LIMIT 1");
  if (!$stmt) fail('DB error preparing doc review.', 500);

  bind_stmt($stmt, 'sisi', [$newStatus, $special_uid, $reasonToStore, $docId]);

  if (!$stmt->execute()) {
    $e = $stmt->error;
    $stmt->close();
    fail('Failed to review document: ' . $e, 500);
  }
  $stmt->close();

  // notify coordinator about doc review
  $stmt = $db->prepare("
    SELECT d.request_id, ar.coordinator_user_id, o.org_name, r.requirement_name
    FROM accreditation_request_documents d
    JOIN accreditation_requests ar ON ar.id = d.request_id
    JOIN organizations o ON o.id = ar.org_id
    JOIN accreditation_requirements r ON r.id = d.requirement_id
    WHERE d.id = ?
    LIMIT 1
  ");
  if ($stmt) {
    $stmt->bind_param('i', $docId);
    $stmt->execute();
    $result = $stmt->get_result();
    if ($docInfo = $result->fetch_assoc()) {
      $coordinatorId = (int)$docInfo['coordinator_user_id'];
      $requestId = (int)$docInfo['request_id'];
      $orgName = $docInfo['org_name'] ?? 'Organization';
      $requirementName = $docInfo['requirement_name'] ?? 'document';

      if ($decision === 'accept') {
        $title = "Document Accepted";
        $message = "Your document for requirement '{$requirementName}' in organization '{$orgName}' has been accepted by the Special Admin.";
      } else {
        $title = "Document Returned - Needs Revision";
        $message = "Your document for requirement '{$requirementName}' in organization '{$orgName}' has been returned by the Special Admin. Reason: {$reason}";
      }

      add_notification($db, $coordinatorId, $special_uid, $title, $message, 'accreditation', $requestId);
    }
    $stmt->close();
  }

  ok([]);
}

/* =============================
   Bulk Review Documents
   ============================= */
if ($action === 'bulk_review_documents') {
  $docIds = inp('doc_ids', []);
  $decision = strtolower((string)inp('decision', ''));
  $reason = trim((string)inp('reason', ''));

  if (!is_array($docIds)) $docIds = explode(',', (string)$docIds);

  $docIds = array_filter(array_map('intval', $docIds), function($id) { return $id > 0; });

  if (empty($docIds)) fail('No valid document IDs provided.');
  if (!in_array($decision, ['accept','return'], true)) fail('Invalid decision.');
  if ($decision === 'return' && $reason === '') fail('Return reason is required.');

  $newStatus = ($decision === 'accept') ? 'Accepted' : 'Returned';
  $reasonToStore = ($decision === 'return') ? $reason : null;

  $idsPlaceholder = implode(',', array_fill(0, count($docIds), '?'));
  $types = str_repeat('i', count($docIds));

  $db->begin_transaction();
  try {
    $sql = "UPDATE accreditation_request_documents
            SET status=?, reviewed_by=?, reviewed_at=NOW(), return_reason=?
            WHERE id IN ($idsPlaceholder)";
    $stmt = $db->prepare($sql);
    if (!$stmt) throw new Exception('Prepare failed.');

    $params = [$newStatus, $special_uid, $reasonToStore];
    foreach ($docIds as $id) $params[] = $id;

    $paramTypes = 'sis' . $types;

    $bindParams = [$paramTypes];
    foreach ($params as &$param) $bindParams[] = &$param;

    if (!call_user_func_array([$stmt, 'bind_param'], $bindParams)) {
      throw new Exception('Failed to bind parameters.');
    }

    if (!$stmt->execute()) {
      $e = $stmt->error;
      $stmt->close();
      throw new Exception($e);
    }

    $affected = $stmt->affected_rows;
    $stmt->close();

    $sql = "SELECT DISTINCT d.request_id, ar.coordinator_user_id, o.org_name
            FROM accreditation_request_documents d
            JOIN accreditation_requests ar ON ar.id = d.request_id
            JOIN organizations o ON o.id = ar.org_id
            WHERE d.id IN ($idsPlaceholder)";
    $stmt = $db->prepare($sql);
    if ($stmt) {
      $bindParams2 = [$types];
      foreach ($docIds as &$id2) $bindParams2[] = &$id2;

      if (!call_user_func_array([$stmt, 'bind_param'], $bindParams2)) {
        throw new Exception('Failed to bind parameters for notification query.');
      }

      $stmt->execute();
      $result = $stmt->get_result();
      $requestsInfo = $result->fetch_all(MYSQLI_ASSOC);
      $stmt->close();

      foreach ($requestsInfo as $info) {
        $coordinatorId = (int)$info['coordinator_user_id'];
        $requestId = (int)$info['request_id'];
        $orgName = $info['org_name'] ?? 'Organization';

        if ($decision === 'accept') {
          $title = "Documents Accepted";
          $message = "{$affected} of your documents for organization '{$orgName}' have been accepted by the Special Admin.";
        } else {
          $title = "Documents Returned - Needs Revision";
          $message = "{$affected} of your documents for organization '{$orgName}' have been returned by the Special Admin. Reason: {$reason}";
        }

        add_notification($db, $coordinatorId, $special_uid, $title, $message, 'accreditation', $requestId);
      }
    }

    $db->commit();
    ok(['message' => "{$affected} document(s) {$decision}ed successfully."]);
  } catch (Throwable $e) {
    $db->rollback();
    fail('Failed to process bulk review: ' . $e->getMessage(), 500);
  }
}

if ($action === 'assign_moderator') {
  $requestId = (int)inp('request_id', 0);
  $moderatorId = (int)inp('moderator_id', (int)inp('moderator_user_id', 0));

  if ($requestId <= 0) fail('Invalid request_id.');
  if ($moderatorId <= 0) fail('Invalid moderator id.');

  $stmt = $db->prepare('SELECT id, role, status FROM users WHERE id=? LIMIT 1');
  if (!$stmt) fail('DB error preparing moderator lookup.', 500);

  $stmt->bind_param('i', $moderatorId);
  $stmt->execute();
  $u = $stmt->get_result()->fetch_assoc();
  $stmt->close();

  if (!$u) fail('Moderator user not found.', 404);
  if (($u['role'] ?? '') !== 'moderator') fail('Selected user is not a moderator.');
  if (($u['status'] ?? '') !== 'Active') fail('Selected moderator is not Active.');

  $stmt = $db->prepare('UPDATE accreditation_requests SET moderator_user_id=? WHERE id=? LIMIT 1');
  if (!$stmt) fail('DB error preparing moderator assign.', 500);

  $stmt->bind_param('ii', $moderatorId, $requestId);
  if (!$stmt->execute()) {
    $e = $stmt->error;
    $stmt->close();
    fail('Failed to assign moderator: ' . $e, 500);
  }
  $stmt->close();

  // notify coordinator
  $ctx = get_request_context($db, $requestId);
  if ($ctx) {
    $coordinatorId = (int)$ctx['coordinator_user_id'];
    $orgName = $ctx['org_name'] ?? 'Organization';

    $stmt = $db->prepare("SELECT CONCAT(first_name, ' ', last_name) as moderator_name FROM users WHERE id = ? LIMIT 1");
    if ($stmt) {
      $stmt->bind_param('i', $moderatorId);
      $stmt->execute();
      $result = $stmt->get_result();
      if ($moderatorInfo = $result->fetch_assoc()) {
        $moderatorName = $moderatorInfo['moderator_name'];

        $title = "Moderator Assigned";
        $message = "A moderator ({$moderatorName}) has been assigned to review your accreditation request for organization '{$orgName}'.";

        add_notification($db, $coordinatorId, $special_uid, $title, $message, 'accreditation', $requestId);
      }
      $stmt->close();
    }
  }

  ok([]);
}

if ($action === 'list_moderators') {
  $items = [];
  $res = $db->query("SELECT id, CONCAT(first_name,' ',last_name) AS name
                     FROM users
                     WHERE role='moderator' AND status='Active'
                     ORDER BY last_name ASC, first_name ASC");
  if ($res) $items = $res->fetch_all(MYSQLI_ASSOC);
  ok(['items' => $items]);
}

/* =============================
   Manage Files: Requirements
   FIXES:
   - Treat blank/NULL applies_to as 'All' everywhere (so requirements never "disappear")
   - Use correct allowed applies_to values: General/Exclusive/Club/All (no more 'Both')
   ============================= */
if ($action === 'list_requirements') {
  $status = (string)inp('status', 'Active');
  $allowedStatus = ['Active','Archived','All'];
  if (!in_array($status, $allowedStatus, true)) $status = 'Active';

  $q = trim((string)inp('q', ''));
  $page = clamp_int(inp('page', 1), 1, 1000000, 1);
  $per  = clamp_int(inp('per_page', 10), 1, 100, 10);
  $off  = ($page - 1) * $per;

  $where = [];
  $types = '';
  $params = [];

  if ($status !== 'All') { $where[] = 'r.status=?'; $types .= 's'; $params[] = $status; }
  if ($q !== '') { $where[] = 'r.requirement_name LIKE ?'; $types .= 's'; $params[] = like_escape($q); }

  $whereSql = $where ? ('WHERE ' . implode(' AND ', $where)) : '';

  $stmt = $db->prepare("SELECT COUNT(*) AS cnt FROM accreditation_requirements r $whereSql");
  if (!$stmt) fail('DB error preparing requirements count.', 500);
  if ($types !== '') bind_stmt($stmt, $types, $params);
  $stmt->execute();
  $totalRow = $stmt->get_result()->fetch_assoc();
  $total = (int)($totalRow['cnt'] ?? 0);
  $stmt->close();

  $sql = "
    SELECT
      r.id,
      r.requirement_name,
      COALESCE(NULLIF(TRIM(r.applies_to), ''), 'All') AS applies_to,
      r.sort_order,
      r.status,
      r.created_at,
      (SELECT t.file_name FROM accreditation_requirement_templates t
        WHERE t.requirement_id=r.id AND t.is_active=1
        ORDER BY t.uploaded_at DESC LIMIT 1) AS active_template_name
    FROM accreditation_requirements r
    $whereSql
    ORDER BY r.sort_order ASC, r.requirement_name ASC
    LIMIT ? OFFSET ?
  ";
  $stmt = $db->prepare($sql);
  if (!$stmt) fail('DB error preparing requirements list.', 500);

  if ($types !== '') {
    $types2 = $types . 'ii';
    $params2 = array_merge($params, [$per, $off]);
    bind_stmt($stmt, $types2, $params2);
  } else {
    $stmt->bind_param('ii', $per, $off);
  }

  $stmt->execute();
  $items = $stmt->get_result()->fetch_all(MYSQLI_ASSOC);
  $stmt->close();

  ok(['items' => $items, 'page' => $page, 'per_page' => $per, 'total' => $total]);
}

if ($action === 'get_requirement') {
  $reqId = (int)inp('requirement_id', inp('id', 0));
  if ($reqId <= 0) fail('Invalid requirement_id.');

  $stmt = $db->prepare("
    SELECT
      id,
      requirement_name,
      COALESCE(NULLIF(TRIM(applies_to), ''), 'All') AS applies_to,
      sort_order,
      status,
      created_at
    FROM accreditation_requirements
    WHERE id=? LIMIT 1
  ");
  if (!$stmt) fail('DB error preparing requirement read.', 500);

  $stmt->bind_param('i', $reqId);
  $stmt->execute();
  $item = $stmt->get_result()->fetch_assoc();
  $stmt->close();

  if (!$item) fail('Requirement not found.', 404);
  ok(['item' => $item]);
}

if ($action === 'create_requirement') {
  $name = trim((string)inp('requirement_name', ''));
  $applies = trim((string)inp('applies_to', 'All'));
  $sort = (int)inp('sort_order', 0);

  if ($name === '') fail('Requirement name is required.');

  $allowedApplies = ['General','Exclusive','Club','All'];
  if ($applies === '') $applies = 'All';
  if (!in_array($applies, $allowedApplies, true)) $applies = 'All';

  $stmt = $db->prepare("
    INSERT INTO accreditation_requirements (requirement_name, applies_to, sort_order, status, created_by)
    VALUES (?, ?, ?, 'Active', ?)
  ");
  if (!$stmt) fail('DB error preparing requirement create.', 500);

  $stmt->bind_param('ssii', $name, $applies, $sort, $special_uid);
  if (!$stmt->execute()) {
    $e = $stmt->error;
    $stmt->close();
    fail('Failed to add requirement: ' . $e, 500);
  }
  $id = (int)$stmt->insert_id;
  $stmt->close();

  ok(['id' => $id]);
}

if ($action === 'update_requirement') {
  $id = (int)inp('id', 0);
  $name = trim((string)inp('requirement_name', ''));
  $applies = trim((string)inp('applies_to', 'All'));
  $sort = (int)inp('sort_order', 0);

  if ($id <= 0) fail('Invalid id.');
  if ($name === '') fail('Requirement name is required.');

  $allowedApplies = ['General','Exclusive','Club','All'];
  if ($applies === '') $applies = 'All';
  if (!in_array($applies, $allowedApplies, true)) $applies = 'All';

  $stmt = $db->prepare('UPDATE accreditation_requirements SET requirement_name=?, applies_to=?, sort_order=? WHERE id=? LIMIT 1');
  if (!$stmt) fail('DB error preparing requirement update.', 500);

  $stmt->bind_param('ssii', $name, $applies, $sort, $id);
  if (!$stmt->execute()) {
    $e = $stmt->error;
    $stmt->close();
    fail('Failed to update requirement: ' . $e, 500);
  }
  $stmt->close();

  ok([]);
}

if ($action === 'archive_requirement') {
  $id = (int)inp('requirement_id', 0);
  if ($id <= 0) fail('Invalid requirement_id.');

  $stmt = $db->prepare("UPDATE accreditation_requirements SET status='Archived' WHERE id=? LIMIT 1");
  if (!$stmt) fail('DB error preparing requirement archive.', 500);

  $stmt->bind_param('i', $id);
  if (!$stmt->execute()) {
    $e = $stmt->error;
    $stmt->close();
    fail('Failed to archive requirement: ' . $e, 500);
  }
  $stmt->close();

  ok([]);
}

/* =============================
   Manage Files: Templates
   ============================= */
if ($action === 'list_templates') {
  $reqId = (int)inp('requirement_id', 0);
  if ($reqId <= 0) fail('Invalid requirement_id.');

  $page = clamp_int(inp('page', 1), 1, 1000000, 1);
  $per  = clamp_int(inp('per_page', 5), 1, 50, 5);
  $off  = ($page - 1) * $per;

  $stmt = $db->prepare('SELECT COUNT(*) AS cnt FROM accreditation_requirement_templates WHERE requirement_id=?');
  if (!$stmt) fail('DB error preparing templates count.', 500);

  $stmt->bind_param('i', $reqId);
  $stmt->execute();
  $row = $stmt->get_result()->fetch_assoc();
  $total = (int)($row['cnt'] ?? 0);
  $stmt->close();

  $stmt = $db->prepare('SELECT id, requirement_id, file_path, file_name, file_type, version, is_active, uploaded_at
                        FROM accreditation_requirement_templates
                        WHERE requirement_id=?
                        ORDER BY is_active DESC, uploaded_at DESC
                        LIMIT ? OFFSET ?');
  if (!$stmt) fail('DB error preparing templates list.', 500);

  $stmt->bind_param('iii', $reqId, $per, $off);
  $stmt->execute();
  $items = $stmt->get_result()->fetch_all(MYSQLI_ASSOC);
  $stmt->close();

  foreach ($items as &$t) {
    $t['file_url'] = ($t['file_path'] ?? '') ? public_url((string)$t['file_path']) : '';
  }

  ok(['items' => $items, 'page' => $page, 'per' => $per, 'total' => $total]);
}

/** Multipart upload: requirement_id + template_file (pdf/docx) */
if ($action === 'upload_template') {
  $reqId = (int)($_POST['requirement_id'] ?? 0);
  if ($reqId <= 0) fail('Invalid requirement_id.');
  if (!isset($_FILES['template_file'])) fail('Missing template_file upload.');

  $f = $_FILES['template_file'];
  if (($f['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK) {
    fail('Upload failed (code ' . (int)$f['error'] . ').', 400);
  }

  $orig = (string)($f['name'] ?? 'template');
  $ext = file_ext($orig);
  if (!in_array($ext, ['pdf','docx'], true)) fail('Template must be PDF or DOCX.');
  $type = ($ext === 'pdf') ? 'PDF' : 'DOCX';

  $relDir = TEMPLATES_DIR . '/' . $reqId;

  $absDir = rtrim(project_root(), "/\\") . DIRECTORY_SEPARATOR . str_replace(['/', '\\'], DIRECTORY_SEPARATOR, $relDir);
  ensure_dir($absDir);

  $base = safe_filename(pathinfo($orig, PATHINFO_FILENAME));
  $stamp = date('Ymd_His');
  $rand = bin2hex(random_bytes(4));
  $filename = "{$base}_{$stamp}_{$rand}.{$ext}";

  $destAbs = $absDir . DIRECTORY_SEPARATOR . $filename;

  $destRel = $relDir . '/' . $filename;
  $destRel = ltrim($destRel, "/\\");

  if (!move_uploaded_file((string)$f['tmp_name'], $destAbs)) fail('Failed to save uploaded template.', 500);

  $db->begin_transaction();
  try {
    $stmt = $db->prepare('UPDATE accreditation_requirement_templates SET is_active=0 WHERE requirement_id=?');
    if (!$stmt) throw new Exception('Prepare failed (deactivate templates).');
    $stmt->bind_param('i', $reqId);
    $stmt->execute();
    $stmt->close();

    $stmt = $db->prepare('SELECT COALESCE(MAX(version),0)+1 AS v FROM accreditation_requirement_templates WHERE requirement_id=?');
    if (!$stmt) throw new Exception('Prepare failed (version).');
    $stmt->bind_param('i', $reqId);
    $stmt->execute();
    $vRow = $stmt->get_result()->fetch_assoc();
    $version = (int)($vRow['v'] ?? 1);
    $stmt->close();

    $stmt = $db->prepare('INSERT INTO accreditation_requirement_templates
                          (requirement_id, file_path, file_name, file_type, version, is_active, uploaded_by)
                          VALUES (?, ?, ?, ?, ?, 1, ?)');
    if (!$stmt) throw new Exception('Prepare failed (insert template).');

    $stmt->bind_param('isssii', $reqId, $destRel, $orig, $type, $version, $special_uid);
    if (!$stmt->execute()) {
      $e = $stmt->error;
      $stmt->close();
      throw new Exception($e);
    }
    $tplId = (int)$stmt->insert_id;
    $stmt->close();

    $db->commit();
    ok([
      'template_id' => $tplId,
      'file_path' => $destRel,
      'file_url' => public_url($destRel),
      'file_type' => $type,
      'version' => $version
    ]);
  } catch (Throwable $e) {
    $db->rollback();
    fail('Failed to upload template: ' . $e->getMessage(), 500);
  }
}

if ($action === 'set_active_template') {
  $reqId = (int)inp('requirement_id', 0);
  $tplId = (int)inp('template_id', 0);
  if ($reqId <= 0) fail('Invalid requirement_id.');
  if ($tplId <= 0) fail('Invalid template_id.');

  $db->begin_transaction();
  try {
    $stmt = $db->prepare('UPDATE accreditation_requirement_templates SET is_active=0 WHERE requirement_id=?');
    if (!$stmt) throw new Exception('Prepare failed.');
    $stmt->bind_param('i', $reqId);
    $stmt->execute();
    $stmt->close();

    $stmt = $db->prepare('UPDATE accreditation_requirement_templates SET is_active=1 WHERE id=? AND requirement_id=? LIMIT 1');
    if (!$stmt) throw new Exception('Prepare failed.');
    $stmt->bind_param('ii', $tplId, $reqId);
    $stmt->execute();
    if ($stmt->affected_rows <= 0) {
      $stmt->close();
      throw new Exception('Template not found for this requirement.');
    }
    $stmt->close();

    $db->commit();
    ok([]);
  } catch (Throwable $e) {
    $db->rollback();
    fail('Failed to set active template: ' . $e->getMessage(), 500);
  }
}

if ($action === 'delete_template') {
  $reqId = (int)inp('requirement_id', 0);
  $tplId = (int)inp('template_id', 0);
  if ($reqId <= 0) fail('Invalid requirement_id.');
  if ($tplId <= 0) fail('Invalid template_id.');

  $stmt = $db->prepare('SELECT file_path, is_active FROM accreditation_requirement_templates WHERE id=? AND requirement_id=? LIMIT 1');
  if (!$stmt) fail('DB error preparing template lookup.', 500);
  $stmt->bind_param('ii', $tplId, $reqId);
  $stmt->execute();
  $row = $stmt->get_result()->fetch_assoc();
  $stmt->close();
  if (!$row) fail('Template not found.', 404);

  $filePath = (string)($row['file_path'] ?? '');
  $wasActive = ((int)($row['is_active'] ?? 0)) === 1;

  $db->begin_transaction();
  try {
    $stmt = $db->prepare('DELETE FROM accreditation_requirement_templates WHERE id=? AND requirement_id=? LIMIT 1');
    if (!$stmt) throw new Exception('Prepare failed.');
    $stmt->bind_param('ii', $tplId, $reqId);
    if (!$stmt->execute()) {
      $e = $stmt->error;
      $stmt->close();
      throw new Exception($e);
    }
    $stmt->close();

    if ($wasActive) {
      $stmt = $db->prepare('UPDATE accreditation_requirement_templates
                            SET is_active=1
                            WHERE requirement_id=?
                            ORDER BY uploaded_at DESC
                            LIMIT 1');
      if ($stmt) {
        $stmt->bind_param('i', $reqId);
        $stmt->execute();
        $stmt->close();
      }
    }

    $db->commit();
  } catch (Throwable $e) {
    $db->rollback();
    fail('Failed to delete template: ' . $e->getMessage(), 500);
  }

  if ($filePath) safe_unlink_upload($filePath);
  ok([]);
}

/* =============================
   Generate Recommendation PDF (mPDF)
   ============================= */
if ($action === 'submit_recommendation') {
  $requestId = (int)inp('request_id', 0);
  $notes = trim((string)inp('notes', ''));
  if ($requestId <= 0) fail('Invalid request_id.');

  $specialUid = (int)($_SESSION['user_id'] ?? 0);
  if ($specialUid <= 0) fail('Unauthorized.', 401);

  $autoload = project_root() . '/vendor/autoload.php';
  if (!is_file($autoload)) fail('mPDF not found. Run composer install (vendor/autoload.php missing).', 500);
  require_once $autoload;

  $db = db();

  $ctx = get_request_context($db, $requestId);
  if (!$ctx) fail('Request not found.', 404);

  $orgName = (string)($ctx['org_name'] ?? 'Organization');
  $orgAbbr = (string)($ctx['org_abbr'] ?? '');
  $scope   = (string)($ctx['scope'] ?? '');
  $program = (string)($ctx['program'] ?? '');
  $termLbl = (string)($ctx['term_label'] ?? '');
  $orgDesc = (string)($ctx['org_description'] ?? '');

  $headerPath = realpath(project_root() . '/assets/templates/letterhead-header.png');
  $footerPath = realpath(project_root() . '/assets/templates/letterhead-footer.png');

  if (!$headerPath || !is_file($headerPath)) {
    fail('Letterhead header not found. Put it at assets/templates/letterhead-header.png', 500);
  }
  if (!$footerPath || !is_file($footerPath)) {
    fail('Letterhead footer not found. Put it at assets/templates/letterhead-footer.png', 500);
  }

  // Active signature
  $sigRel = '';
  $stmt = $db->prepare("SELECT signature_file
                        FROM e_signatures
                        WHERE user_id = ? AND status = 'Active'
                        ORDER BY id DESC
                        LIMIT 1");
  if (!$stmt) fail('Failed to read e-signature (prepare failed): ' . $db->error, 500);

  $stmt->bind_param('i', $specialUid);
  if (!$stmt->execute()) {
    $err = $stmt->error;
    $stmt->close();
    fail('Failed to read e-signature: ' . $err, 500);
  }
  $stmt->bind_result($sigRel);
  $stmt->fetch();
  $stmt->close();

  $sigRel = trim((string)$sigRel);
  if ($sigRel === '') {
    fail('No active e-signature found for the current Special Admin. Please upload/set one as Active.', 400);
  }

  $signaturePath = realpath(project_root() . '/' . ltrim($sigRel, "/\\"));
  if (!$signaturePath || !is_file($signaturePath)) {
    fail('Active e-signature file not found on disk: ' . $sigRel, 500);
  }

  // Special Admin name
  $specialName = '';
  $stmt2 = $db->prepare("SELECT first_name, middle_name, last_name, suffix
                         FROM users
                         WHERE id = ?
                         LIMIT 1");
  if ($stmt2) {
    $fn = $mn = $ln = $sx = null;
    $stmt2->bind_param('i', $specialUid);
    if ($stmt2->execute()) {
      $stmt2->bind_result($fn, $mn, $ln, $sx);
      $stmt2->fetch();

      $fn = trim((string)$fn);
      $mn = trim((string)$mn);
      $ln = trim((string)$ln);
      $sx = trim((string)$sx);

      $parts = [];
      if ($fn !== '') $parts[] = $fn;
      if ($mn !== '') $parts[] = $mn;
      if ($ln !== '') $parts[] = $ln;

      $specialName = trim(implode(' ', $parts));
      if ($sx !== '') $specialName .= ' ' . $sx;
    }
    $stmt2->close();
  }
  $specialName = trim((string)$specialName);

  // output dir
  $relDir = RECOMMEND_DIR . '/' . $requestId;
  $absDir = rtrim(project_root(), "/\\") . DIRECTORY_SEPARATOR . str_replace(['/', '\\'], DIRECTORY_SEPARATOR, $relDir);
  ensure_dir($absDir);

  $stamp = date('Ymd_His');
  $rand  = bin2hex(random_bytes(4));
  $filename = "recommendation_{$requestId}_{$stamp}_{$rand}.pdf";

  $destRel = ltrim($relDir . '/' . $filename, "/\\");
  $destAbs = $absDir . DIRECTORY_SEPARATOR . $filename;

  $tmpDir = project_root() . '/tmp';
  if (!is_dir($tmpDir)) @mkdir($tmpDir, 0775, true);

  try {
    $mpdf = new \Mpdf\Mpdf([
      'format'        => 'A4',
      'margin_left'   => 22,
      'margin_right'  => 22,
      'margin_top'    => 58,
      'margin_bottom' => 38,
      'margin_header' => 0,
      'margin_footer' => 0,
      'tempDir'       => $tmpDir,
    ]);
    $mpdf->showImageErrors = true;
  } catch (\Throwable $e) {
    fail('Failed to init PDF engine: ' . $e->getMessage(), 500);
  }

  $headerHtml = '
    <div style="text-align:center;">
      <img src="' . $headerPath . '" style="width:100%; height:auto;" />
    </div>
  ';
  $footerHtml = '
    <div style="text-align:center;">
      <img src="' . $footerPath . '" style="width:100%; height:auto;" />
    </div>
  ';
  $mpdf->SetHTMLHeader($headerHtml);
  $mpdf->SetHTMLFooter($footerHtml);

  $css = <<<CSS
body { font-family: Arial, sans-serif; font-size: 11.5pt; color: #111; }
.letter-date { margin: 0 0 14pt 0; }
.recipient   { margin: 0 0 10pt 0; }
.subject {
  margin: 10pt 0 12pt 0;
  font-weight: bold;
  text-transform: uppercase;
  letter-spacing: 0.35pt;
}
.p { text-align: justify; line-height: 1.65; margin: 0 0 10.5pt 0; }
.meta { margin: 0 0 12pt 0; font-size: 10pt; color: #333; }

.sig-block { margin-top: 26pt; text-align: center; page-break-inside: avoid; }
.sig-img { width: 260px; height: auto; display: block; margin: 6pt auto -10pt auto; }
.sig-line { width: 260px; border-top: 1px solid #111; margin: 0 auto 5pt auto; }
.sig-name { font-weight: bold; margin: 0; padding: 0; line-height: 1.2; }
.sig-title { margin-top: 2pt; font-size: 10.5pt; }
.small-note { margin-top: 18pt; font-size: 8.8pt; color: #666; font-style: italic; text-align: center; }
CSS;

  $esc = fn($s) => htmlspecialchars((string)$s, ENT_QUOTES, 'UTF-8');
  $dateStr = date('F j, Y');

  $signName  = ($specialName !== '') ? $specialName : '__________________________';
  $signTitle = 'Student Development Coordinator';
  $subjectLine = 'RECOMMENDATION FOR ACCREDITATION';

  $metaBits = [];
  if ($orgAbbr !== '') $metaBits[] = 'Abbreviation: ' . $esc($orgAbbr);
  if ($scope   !== '') $metaBits[] = 'Scope: ' . $esc($scope);
  if ($program !== '') $metaBits[] = 'Program: ' . $esc($program);
  if ($termLbl !== '') $metaBits[] = 'Academic Year: ' . $esc($termLbl);
  $metaHtml = $metaBits ? ('<div class="meta">' . implode(' &nbsp; • &nbsp; ', $metaBits) . '</div>') : '';

  $descHtml = '';
  $cleanDesc = trim($orgDesc);
  if ($cleanDesc !== '') {
    $descHtml = '<p class="p"><b>Organization Description:</b> ' . $esc($cleanDesc) . '</p>';
  }

  $html = '
    <div class="letter-date">' . $esc($dateStr) . '</div>
    <div class="recipient">To Whom It May Concern:</div>

    <div class="subject">' . $esc($subjectLine) . '</div>

    ' . $metaHtml . '

    <p class="p">
      This letter is respectfully submitted to recommend <b>' . $esc($orgName) . '</b> for accreditation
      under the Student Development Office, subject to the evaluation and approval of the Head of the Office of Students Affair.
    </p>

    ' . $descHtml . '

    <p class="p">
      Following a thorough review of the organization’s submitted requirements and supporting documents, it is our finding
      that the organization has satisfactorily complied with the prescribed standards and guidelines for accreditation.
    </p>

    <p class="p">
      In view of the foregoing, we hereby strongly endorse the approval of the accreditation request of
      <b>' . $esc($orgName) . '</b>.
    </p>

    <div style="margin-top: 10pt;">Respectfully submitted,</div>

    <div class="sig-block">
      <img class="sig-img" src="' . $signaturePath . '" alt="Signature" />
      <div class="sig-line"></div>
      <div class="sig-name">' . $esc($signName) . '</div>
      <div class="sig-title">' . $esc($signTitle) . '</div>
    </div>
    <br><br><br>
    <div class="small-note">This is a system-generated document issued through Educore accreditation.</div>
  ';

  try {
    $mpdf->SetTitle('Recommendation - ' . $orgName);
    $mpdf->WriteHTML($css, \Mpdf\HTMLParserMode::HEADER_CSS);
    $mpdf->WriteHTML($html, \Mpdf\HTMLParserMode::HTML_BODY);
    $mpdf->Output($destAbs, \Mpdf\Output\Destination::FILE);
  } catch (\Throwable $e) {
    fail('Failed to generate PDF: ' . $e->getMessage(), 500);
  }

  $tag = 'RECOMMENDATION_FILE=' . $destRel;
  $finalNotes = $tag . ($notes !== '' ? ("\n" . $notes) : '');

  $db->begin_transaction();
  try {
    $stmt = $db->prepare("UPDATE accreditation_requests
                          SET status='Recommended',
                              special_admin_notes=?,
                              submitted_at = COALESCE(submitted_at, CURRENT_TIMESTAMP),
                              updated_at = CURRENT_TIMESTAMP
                          WHERE id=? LIMIT 1");
    if (!$stmt) throw new Exception('Prepare failed: ' . $db->error);

    $stmt->bind_param('si', $finalNotes, $requestId);
    if (!$stmt->execute()) throw new Exception($stmt->error);
    $stmt->close();

    // notify coordinator
    $ctx2 = get_request_context($db, $requestId);
    if ($ctx2) {
      $coordinatorId = (int)$ctx2['coordinator_user_id'];
      $orgName2 = (string)($ctx2['org_name'] ?? 'Organization');
      $termLbl2 = (string)($ctx2['term_label'] ?? '');

      add_notification(
        $db,
        $coordinatorId,
        $special_uid,
        "Recommendation Submitted",
        "A recommendation letter for '{$orgName2}' has been generated and your request is now marked as Recommended.",
        'accreditation',
        $requestId
      );

      $title = "Accreditation Ready for Activation";
      $msg = "Recommendation submitted for '{$orgName2}'"
           . ($termLbl2 !== '' ? " ({$termLbl2})" : "")
           . ". Request #{$requestId} is now Recommended and pending your activation.";
      notify_current_super_admin($db, $special_uid, $title, $msg, $requestId);
    } else {
      notify_current_super_admin(
        $db,
        $special_uid,
        "Accreditation Ready for Activation",
        "A recommendation was submitted. Request #{$requestId} is now Recommended and pending your activation.",
        $requestId
      );
    }

    $db->commit();

    ok([
      'recommendation_path' => $destRel,
      'recommendation_url'  => public_url($destRel),
    ]);
  } catch (\Throwable $e) {
    $db->rollback();
    fail('Failed to save recommendation: ' . $e->getMessage(), 500);
  }
}

// Approve request
if ($action === 'approve_request') {
  $requestId = (int)inp('request_id', 0);
  $notes = trim((string)inp('notes', ''));
  if ($requestId <= 0) fail('Invalid request_id.');

  $db->begin_transaction();
  try {
    $stmt = $db->prepare("UPDATE accreditation_requests
                          SET status='Approved',
                              special_admin_notes=?,
                              updated_at=CURRENT_TIMESTAMP
                          WHERE id=?
                          LIMIT 1");
    if (!$stmt) throw new Exception('Prepare failed.');
    $stmt->bind_param('si', $notes, $requestId);
    if (!$stmt->execute()) {
      $e = $stmt->error;
      $stmt->close();
      throw new Exception($e);
    }
    $stmt->close();

    $ctx = get_request_context($db, $requestId);
    if ($ctx) {
      $coordinatorId = (int)$ctx['coordinator_user_id'];
      $orgName = (string)($ctx['org_name'] ?? 'Organization');

      $title = "Accreditation Approved";
      $message = "Your accreditation request for organization '{$orgName}' has been approved by the Special Admin!";

      add_notification($db, $coordinatorId, $special_uid, $title, $message, 'accreditation', $requestId);
    }

    $db->commit();
    ok(['message' => 'Request approved successfully.']);
  } catch (Throwable $e) {
    $db->rollback();
    fail('Failed to approve request: ' . $e->getMessage(), 500);
  }
}

// Reject request
if ($action === 'reject_request') {
  $requestId = (int)inp('request_id', 0);
  $reason = trim((string)inp('reason', ''));
  if ($requestId <= 0) fail('Invalid request_id.');
  if ($reason === '') fail('Rejection reason is required.');

  $db->begin_transaction();
  try {
    $stmt = $db->prepare("UPDATE accreditation_requests
                          SET status='Rejected',
                              special_admin_notes=?,
                              updated_at=CURRENT_TIMESTAMP
                          WHERE id=?
                          LIMIT 1");
    if (!$stmt) throw new Exception('Prepare failed.');
    $stmt->bind_param('si', $reason, $requestId);
    if (!$stmt->execute()) {
      $e = $stmt->error;
      $stmt->close();
      throw new Exception($e);
    }
    $stmt->close();

    $ctx = get_request_context($db, $requestId);
    if ($ctx) {
      $coordinatorId = (int)$ctx['coordinator_user_id'];
      $orgName = (string)($ctx['org_name'] ?? 'Organization');

      $title = "Accreditation Rejected";
      $message = "Your accreditation request for organization '{$orgName}' has been rejected by the Special Admin. Reason: {$reason}";

      add_notification($db, $coordinatorId, $special_uid, $title, $message, 'accreditation', $requestId);
    }

    $db->commit();
    ok(['message' => 'Request rejected.']);
  } catch (Throwable $e) {
    $db->rollback();
    fail('Failed to reject request: ' . $e->getMessage(), 500);
  }
}

fail('Unknown action: ' . $action, 404);
//$applies
