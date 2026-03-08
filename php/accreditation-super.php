<?php
declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');

session_start();

require_once __DIR__ . '/db.php'; // ✅ same as login.php; provides $pdo (PDO)

define('UPLOAD_BASE', 'assets/uploads');

/* =============================
   Response helpers
   ============================= */
function out(array $payload, int $code = 200): void {
  http_response_code($code);
  echo json_encode($payload, JSON_UNESCAPED_SLASHES);
  exit;
}
function ok(array $data = []): void { out(array_merge(['ok' => true], $data), 200); }
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

/** Escape for LIKE (supports % and _ safely) */
function like_escape(string $q): string {
  $q = str_replace("\0", '', $q);
  $q = str_replace('\\', '\\\\', $q);
  $q = str_replace(['%', '_'], ['\%', '\_'], $q);
  return '%' . $q . '%';
}

/* =============================
   URL helpers
   ============================= */
function app_base_url(): string {
  static $base = null;
  if (is_string($base)) return $base;

  $sn = (string)($_SERVER['SCRIPT_NAME'] ?? '');
  $sn = str_replace('\\', '/', $sn);

  $pos = strpos($sn, '/php/');
  if ($pos !== false) {
    $p = substr($sn, 0, $pos);
    $p = rtrim($p, '/');
    $base = ($p === '') ? '/' : ($p . '/');
    return $base;
  }

  $p = dirname(dirname(dirname($sn)));
  $p = str_replace('\\', '/', $p);
  $p = rtrim($p, '/');
  $base = ($p === '' || $p === '.' || $p === '/') ? '/' : ($p . '/');
  return $base;
}

function public_url(string $relPath): string {
  $rel = ltrim($relPath, "/\\");
  return app_base_url() . $rel;
}

/* =============================
   Auth (SESSION-BASED like your login.php)
   ============================= */
function current_user_id(): ?int {
  $uid = $_SESSION['user_id'] ?? $_SESSION['id'] ?? null;
  return $uid ? (int)$uid : null;
}

function require_super_admin(): int {
  $uid = current_user_id();
  if (!$uid) fail('Unauthorized. Please login.', 401);

  $role = (string)($_SESSION['role'] ?? '');
  if ($role !== 'super_admin') fail('Forbidden. Super admin only.', 403);

  return $uid;
}

/* =============================
   Term helpers
   ============================= */
function active_term_row(PDO $pdo): ?array {
  $st = $pdo->query("SELECT id, school_year, semester, status FROM academic_terms WHERE status='Active' ORDER BY id DESC LIMIT 1");
  $row = $st ? $st->fetch(PDO::FETCH_ASSOC) : false;
  return $row ? $row : null;
}

function active_term_id(PDO $pdo): ?int {
  $t = active_term_row($pdo);
  return $t ? (int)$t['id'] : null;
}

function active_school_year(PDO $pdo): ?string {
  $t = active_term_row($pdo);
  $sy = $t ? trim((string)($t['school_year'] ?? '')) : '';
  return $sy !== '' ? $sy : null;
}

/* =============================
   Notifications
   ============================= */
function add_notification(PDO $pdo, int $recipient_id, ?int $actor_id, string $title, string $message, string $notif_type = 'accreditation', ?int $payload_id = null): int {
  try {
    $stmt = $pdo->prepare("
      INSERT INTO notifications
        (recipient_id, actor_id, title, message, notif_type, status, payload_id, created_at)
      VALUES
        (:recipient_id, :actor_id, :title, :message, :notif_type, 'unread', :payload_id, NOW())
    ");
    $stmt->execute([
      ':recipient_id' => $recipient_id,
      ':actor_id' => $actor_id,
      ':title' => $title,
      ':message' => $message,
      ':notif_type' => $notif_type,
      ':payload_id' => $payload_id,
    ]);
    return (int)$pdo->lastInsertId();
  } catch (Throwable $e) {
    return 0;
  }
}

/* =============================
   Parse recommendation file path from notes
   ============================= */
function parse_recommendation_file(?string $notes): ?string {
  if (!$notes) return null;
  if (preg_match('/RECOMMENDATION_FILE\s*=\s*([^\s\r\n]+)/i', $notes, $m)) {
    return trim((string)$m[1]);
  }
  return null;
}

/* =============================
   ✅ accept request_id / id / requestId
   ============================= */
function request_id_from_input(): int {
  $rid = (int)inp('request_id', 0);
  if ($rid > 0) return $rid;
  $id = (int)inp('id', 0);
  if ($id > 0) return $id;
  $rid2 = (int)inp('requestId', 0);
  if ($rid2 > 0) return $rid2;
  return 0;
}

/* =============================
   Boot
   ============================= */
if (!isset($pdo) || !($pdo instanceof PDO)) {
  fail('PDO not initialized. Check db.php.', 500);
}

$super_uid = require_super_admin();

$action = (string)inp('action', '');
if ($action === '') fail('Missing action.');

/* =============================
   TERMS (for year filter dropdown)
   ============================= */
if ($action === 'list_terms') {
  $rows = [];
  $st = $pdo->query('SELECT id, school_year, semester, status FROM academic_terms ORDER BY id DESC');
  if ($st) $rows = $st->fetchAll(PDO::FETCH_ASSOC);

  $years = [];
  $semesters = [];

  foreach ($rows as &$t) {
    $sy = (string)($t['school_year'] ?? '');
    $sm = (string)($t['semester'] ?? '');
    $t['label'] = ($sy !== '' ? $sy : '—') . ' • ' . ($sm !== '' ? $sm : '—');
    if ($sy !== '') $years[$sy] = true;
    if ($sm !== '') $semesters[$sm] = true;
  }
  unset($t);

  $yearsList = array_keys($years);
  rsort($yearsList);

  $semList = array_keys($semesters);
  $order = ['1st', '2nd', 'Summer'];
  usort($semList, function ($a, $b) use ($order) {
    $ia = array_search($a, $order, true);
    $ib = array_search($b, $order, true);
    $ia = ($ia === false) ? 999 : $ia;
    $ib = ($ib === false) ? 999 : $ib;
    if ($ia === $ib) return strcmp((string)$a, (string)$b);
    return $ia <=> $ib;
  });

  ok([
    'terms' => $rows,
    'years' => $yearsList,
    'semesters' => $semList,
    'active_term_id' => active_term_id($pdo),
    'active_school_year' => active_school_year($pdo),
  ]);
}

/* =============================
   LIST REQUESTS (recommended / active)
   ✅ UPDATED:
   - defaults to ACTIVE school_year (not term_id)
   - counts follow the same filters
   - generates certificate_url for Active items
   ============================= */
if ($action === 'list_requests') {
  $mode = (string)inp('mode', '');
  $status = (string)inp('status', '');

  if ($mode === '') $mode = ($status === 'Active') ? 'active' : 'recommended';
  if ($status === '') $status = ($mode === 'active') ? 'Active' : 'Recommended';

  if (!in_array($status, ['Recommended','Active'], true)) fail('Invalid status.');

  $q = trim((string)inp('q', ''));

  // ✅ default school_year to ACTIVE
  $year = trim((string)inp('school_year', ''));
  if ($year === '') {
    $asy = active_school_year($pdo);
    if ($asy) $year = $asy;
  }

  $semester = trim((string)inp('semester', ''));
  $termIdRaw = trim((string)inp('term_id', ''));

  $page = clamp_int(inp('page', 1), 1, 5000, 1);
  $perPage = clamp_int(inp('per_page', 10), 1, 100, 10);
  $offset = ($page - 1) * $perPage;

  $where = ['ar.status = :status'];
  $bind = [':status' => $status];

  if ($q !== '') {
    $where[] = '(o.org_name LIKE :q ESCAPE \'\\\\\' OR o.abbreviation LIKE :q2 ESCAPE \'\\\\\' OR o.description LIKE :q3 ESCAPE \'\\\\\')';
    $like = like_escape($q);
    $bind[':q']  = $like;
    $bind[':q2'] = $like;
    $bind[':q3'] = $like;
  }

  if ($year !== '') {
    $where[] = 't.school_year = :year';
    $bind[':year'] = $year;
  }

  if ($semester !== '') {
    $where[] = 't.semester = :semester';
    $bind[':semester'] = $semester;
  }

  if ($termIdRaw !== '' && ctype_digit($termIdRaw)) {
    $where[] = 'ar.academic_term_id = :term_id';
    $bind[':term_id'] = (int)$termIdRaw;
  }

  $whereSql = implode(' AND ', $where);

  $sqlCount = "SELECT COUNT(*) AS c
               FROM accreditation_requests ar
               JOIN organizations o ON o.id = ar.org_id
               JOIN academic_terms t ON t.id = ar.academic_term_id
               WHERE $whereSql";
  $stmt = $pdo->prepare($sqlCount);
  $stmt->execute($bind);
  $totalRow = $stmt->fetch(PDO::FETCH_ASSOC);
  $total = (int)($totalRow['c'] ?? 0);

  $sql = "SELECT
            ar.id,
            ar.status,
            ar.submitted_at,
            ar.updated_at,
            ar.org_id,
            o.org_name,
            o.abbreviation AS org_abbr,
            o.description AS org_description,
            o.scope,
            p.program_name AS program,
            t.school_year,
            t.semester,
            CONCAT(t.school_year, ' • ', t.semester) AS term_label,
            CONCAT(c.first_name,' ',c.last_name) AS coordinator_name,
            CONCAT(m.first_name,' ',m.last_name) AS moderator_name
          FROM accreditation_requests ar
          JOIN organizations o ON o.id = ar.org_id
          LEFT JOIN programs p ON p.id = o.program_id
          JOIN academic_terms t ON t.id = ar.academic_term_id
          JOIN users c ON c.id = ar.coordinator_user_id
          LEFT JOIN users m ON m.id = ar.moderator_user_id
          WHERE $whereSql
          ORDER BY ar.updated_at DESC, ar.id DESC
          LIMIT :limit OFFSET :offset";
  $stmt = $pdo->prepare($sql);

  foreach ($bind as $k => $v) {
    $stmt->bindValue($k, $v, is_int($v) ? PDO::PARAM_INT : PDO::PARAM_STR);
  }
  $stmt->bindValue(':limit', $perPage, PDO::PARAM_INT);
  $stmt->bindValue(':offset', $offset, PDO::PARAM_INT);

  $stmt->execute();
  $items = $stmt->fetchAll(PDO::FETCH_ASSOC);

  // ✅ Generate certificate_url dynamically for Active rows (not saved in DB)
  if ($status === 'Active') {
    foreach ($items as &$it) {
      $rid = (int)($it['id'] ?? 0);
      $it['certificate_url'] = $rid > 0
        ? public_url('php/print-certificate.php?request_id=' . $rid)
        : null;
    }
    unset($it);
  } else {
    foreach ($items as &$it) {
      $it['certificate_url'] = null;
    }
    unset($it);
  }

  // ✅ counts follow same school_year/semester/term_id filters (so badges match what you see)
  $countWhere = [];
  $countBind = [];

  if ($year !== '') { $countWhere[] = 't.school_year = :cy'; $countBind[':cy'] = $year; }
  if ($semester !== '') { $countWhere[] = 't.semester = :cs'; $countBind[':cs'] = $semester; }
  if ($termIdRaw !== '' && ctype_digit($termIdRaw)) { $countWhere[] = 'ar.academic_term_id = :ct'; $countBind[':ct'] = (int)$termIdRaw; }

  $countWhereSql = $countWhere ? ('WHERE ' . implode(' AND ', $countWhere)) : '';

  $counts = ['recommended' => 0, 'active' => 0];
  $countSql = "SELECT ar.status, COUNT(*) AS c
               FROM accreditation_requests ar
               JOIN academic_terms t ON t.id = ar.academic_term_id
               $countWhereSql
               AND ar.status IN ('Recommended','Active')";
  // If no WHERE, we must not start with AND
  if ($countWhereSql === '') {
    $countSql = "SELECT ar.status, COUNT(*) AS c
                 FROM accreditation_requests ar
                 JOIN academic_terms t ON t.id = ar.academic_term_id
                 WHERE ar.status IN ('Recommended','Active')";
  } else {
    $countSql = "SELECT ar.status, COUNT(*) AS c
                 FROM accreditation_requests ar
                 JOIN academic_terms t ON t.id = ar.academic_term_id
                 $countWhereSql
                 AND ar.status IN ('Recommended','Active')";
  }

  $st = $pdo->prepare($countSql);
  $st->execute($countBind);

  while ($row = $st->fetch(PDO::FETCH_ASSOC)) {
    if (($row['status'] ?? '') === 'Recommended') $counts['recommended'] = (int)$row['c'];
    if (($row['status'] ?? '') === 'Active') $counts['active'] = (int)$row['c'];
  }

  ok([
    'items' => $items,
    'page' => $page,
    'per_page' => $perPage,
    'total' => $total,
    'counts' => $counts,
    'school_year' => $year,
    'semester' => $semester,
    'term_id' => ($termIdRaw !== '' && ctype_digit($termIdRaw)) ? (int)$termIdRaw : null,
  ]);
}

/* =============================
   GET REQUEST (details + recommendation file URL)
   ✅ UPDATED: also include certificate_url when Active
   ============================= */
if ($action === 'get_request') {
  $id = request_id_from_input();
  if ($id <= 0) fail('Invalid request id.', 400, [
    'hint' => 'Send request_id (preferred) or id.'
  ]);

  $stmt = $pdo->prepare(
    "SELECT
        ar.id, ar.status, ar.submitted_at, ar.updated_at, ar.org_id, ar.academic_term_id,
        ar.coordinator_user_id, ar.moderator_user_id,
        ar.special_admin_notes, ar.super_admin_notes,
        o.org_name, o.abbreviation AS org_abbr, o.description AS org_description, o.scope,
        p.program_name AS program,
        CONCAT(t.school_year, ' • ', t.semester) AS term_label,
        t.school_year, t.semester,
        CONCAT(c.first_name,' ',c.last_name) AS coordinator_name,
        CONCAT(m.first_name,' ',m.last_name) AS moderator_name
     FROM accreditation_requests ar
     JOIN organizations o ON o.id = ar.org_id
     LEFT JOIN programs p ON p.id = o.program_id
     JOIN academic_terms t ON t.id = ar.academic_term_id
     JOIN users c ON c.id = ar.coordinator_user_id
     LEFT JOIN users m ON m.id = ar.moderator_user_id
     WHERE ar.id = :id
     LIMIT 1"
  );
  $stmt->execute([':id' => $id]);
  $row = $stmt->fetch(PDO::FETCH_ASSOC);
  if (!$row) fail('Request not found.', 404);

  $recRel = parse_recommendation_file($row['special_admin_notes'] ?? null);
  $row['recommendation_file'] = $recRel;
  $row['recommendation_url'] = $recRel ? public_url($recRel) : null;

  if (($row['status'] ?? '') === 'Active') {
    $row['certificate_url'] = public_url('php/print-certificate.php?request_id=' . (int)$row['id']);
  } else {
    $row['certificate_url'] = null;
  }

  ok(['item' => $row]);
}

/* =============================
   ACTIVATE REQUEST
   ============================= */
if ($action === 'activate_request') {
  $id = request_id_from_input();
  if ($id <= 0) fail('Invalid request id.', 400, [
    'hint' => 'Send request_id (preferred) or id.'
  ]);

  $stmt = $pdo->prepare(
    "SELECT ar.id, ar.status, ar.org_id, ar.coordinator_user_id, ar.moderator_user_id,
            o.org_name
     FROM accreditation_requests ar
     JOIN organizations o ON o.id = ar.org_id
     WHERE ar.id = :id
     LIMIT 1"
  );
  $stmt->execute([':id' => $id]);
  $row = $stmt->fetch(PDO::FETCH_ASSOC);
  if (!$row) fail('Request not found.', 404);
  if (($row['status'] ?? '') !== 'Recommended') fail('Only Recommended requests can be activated.');

  try {
    $pdo->beginTransaction();

    $note = 'Activated by Super Admin (user_id=' . $super_uid . ') on ' . date('Y-m-d H:i:s');

    $stmt = $pdo->prepare("
      UPDATE accreditation_requests
      SET status='Active',
          super_admin_notes = CONCAT(
            IFNULL(super_admin_notes,''),
            CASE
              WHEN super_admin_notes IS NULL OR super_admin_notes = '' THEN ''
              ELSE '\n'
            END,
            :note
          ),
          updated_at = NOW()
      WHERE id = :id
    ");
    $stmt->execute([':note' => $note, ':id' => $id]);

    $orgId = (int)$row['org_id'];
    $stmt = $pdo->prepare("UPDATE organizations SET status='Active' WHERE id = :org_id");
    $stmt->execute([':org_id' => $orgId]);

    $orgName = (string)($row['org_name'] ?? 'the organization');
    $payloadId = (int)$row['id'];

    $coordId = (int)$row['coordinator_user_id'];
    if ($coordId > 0) {
      add_notification(
        $pdo,
        $coordId,
        $super_uid,
        'Accreditation Activated',
        "Your accreditation request for organization '{$orgName}' has been activated and is now officially recognized.",
        'accreditation',
        $payloadId
      );
    }

    $modId = (int)($row['moderator_user_id'] ?? 0);
    if ($modId > 0) {
      add_notification(
        $pdo,
        $modId,
        $super_uid,
        'Accreditation Activated',
        "Accreditation for '{$orgName}' is now Active.",
        'accreditation',
        $payloadId
      );
    }

    // all active special_admin
    $st = $pdo->query("SELECT id FROM users WHERE role='special_admin' AND status='Active'");
    if ($st) {
      while ($u = $st->fetch(PDO::FETCH_ASSOC)) {
        $sid = (int)$u['id'];
        if ($sid > 0) {
          add_notification(
            $pdo,
            $sid,
            $super_uid,
            'Accreditation Activated',
            "Accreditation for '{$orgName}' is now Active.",
            'accreditation',
            $payloadId
          );
        }
      }
    }

    $pdo->commit();
  } catch (Throwable $e) {
    if ($pdo->inTransaction()) $pdo->rollBack();
    fail('Activation failed.', 500, ['detail' => $e->getMessage()]);
  }

  ok(['message' => 'Organization activated successfully.']);
}

fail('Unknown action.', 400);