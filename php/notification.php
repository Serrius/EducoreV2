<?php
declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
session_start();

require_once __DIR__ . '/db.php'; // must provide $pdo (PDO)

if (!isset($pdo) || !($pdo instanceof PDO)) {
  http_response_code(500);
  echo json_encode(['success' => false, 'message' => 'PDO not initialized (expected $pdo from db.php).'], JSON_UNESCAPED_SLASHES);
  exit;
}
try { $pdo->exec("SET NAMES utf8mb4"); } catch (Throwable $e) {}

/* =========================
   Local dev helper (show real error on localhost)
   ========================= */
function is_local_dev(): bool {
  $h = strtolower((string)($_SERVER['HTTP_HOST'] ?? ''));
  $ra = (string)($_SERVER['REMOTE_ADDR'] ?? '');
  return (strpos($h, 'localhost') !== false)
      || (strpos($h, '127.0.0.1') !== false)
      || ($ra === '127.0.0.1')
      || ($ra === '::1');
}

/* =========================
   Response helpers
   ========================= */
function out(array $payload, int $code = 200): void {
  http_response_code($code);
  echo json_encode($payload, JSON_UNESCAPED_SLASHES);
  exit;
}
function ok(array $data = []): void { out(['success' => true] + $data); }
function fail(string $message, int $code = 400, array $extra = []): void {
  out(['success' => false, 'message' => $message] + $extra, $code);
}

/* =========================
   Constants (match accreditation-special.php)
   ========================= */
define('UPLOAD_BASE', 'assets/uploads');
define('RECOMMEND_DIR', UPLOAD_BASE . '/accreditation/recommendations');

/* =========================
   Small helpers
   ========================= */
function normalize_role($role): string {
  $r = strtolower(trim((string)$role));
  $r = str_replace(['-', ' '], '_', $r);
  return $r;
}
function is_role(string $role, array $allowed): bool {
  return in_array($role, $allowed, true);
}
function now_mysql(): string { return date('Y-m-d H:i:s'); }

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
      fail('Failed to create directory: ' . $dir, 500);
    }
  }
}

/**
 * Robust app base URL:
 * If SCRIPT_NAME contains "/php/", we take everything BEFORE that as the app base.
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

  $p = dirname(dirname($sn));
  $p = str_replace('\\', '/', $p);
  $p = rtrim($p, '/');
  $base = ($p === '' || $p === '.' || $p === '/') ? '/' : ($p . '/');
  return $base;
}

function public_url(string $relPath): string {
  $rel = ltrim($relPath, "/\\");
  return app_base_url() . $rel;
}

/**
 * ✅ Fix: Resolve project root based on DOCUMENT_ROOT + app_base_url().
 * (Copied behavior from accreditation-special.php)
 */
function project_root(): string {
  static $root = null;
  if (is_string($root) && $root !== '') return $root;

  $doc = (string)($_SERVER['DOCUMENT_ROOT'] ?? '');
  $docRoot = $doc !== '' ? realpath($doc) : false;
  if ($docRoot === false) {
    // last fallback to relative path from this script
    $cand = realpath(__DIR__ . '/../'); // php/ -> project root guess
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

/**
 * Parse a tag like "RECOMMENDATION_FILE=assets/uploads/....pdf" from notes.
 */
function extract_note_tag(string $notes, string $key): ?string {
  $notes = (string)$notes;
  $key = trim($key);
  if ($key === '') return null;

  $pattern = '/(?:^|\R)' . preg_quote($key, '/') . '\s*=\s*(.+)$/mi';
  if (preg_match($pattern, $notes, $m)) {
    $v = trim((string)($m[1] ?? ''));
    return $v !== '' ? $v : null;
  }
  return null;
}

/**
 * Add / replace a top-level tag line "KEY=value" at the start of notes.
 * Keeps existing notes after it.
 */
function upsert_note_tag(string $notes, string $key, string $value): string {
  $notes = (string)$notes;
  $key = trim($key);
  $value = trim($value);

  $lines = preg_split("/\R/u", $notes) ?: [];
  $out = [];
  $replaced = false;

  foreach ($lines as $line) {
    if (!$replaced && preg_match('/^\s*' . preg_quote($key, '/') . '\s*=/i', (string)$line)) {
      $out[] = $key . '=' . $value;
      $replaced = true;
    } else {
      $out[] = (string)$line;
    }
  }

  if (!$replaced) {
    array_unshift($out, $key . '=' . $value);
  }

  return trim(implode("\n", $out));
}

/**
 * Central notification insert (PDO).
 * Matches DB format: status='unread', created_at CURRENT_TIMESTAMP.
 */
function add_notification(PDO $pdo, int $recipientId, ?int $actorId, string $title, ?string $message, string $notifType, ?int $payloadId): int {
  $title = trim($title);
  if ($recipientId <= 0 || $title === '') return 0;

  $stmt = $pdo->prepare("
    INSERT INTO notifications
      (recipient_id, actor_id, title, message, notif_type, status, payload_id, created_at)
    VALUES
      (:recipient_id, :actor_id, :title, :message, :notif_type, 'unread', :payload_id, CURRENT_TIMESTAMP)
  ");

  $stmt->bindValue(':recipient_id', $recipientId, PDO::PARAM_INT);

  if ($actorId !== null && $actorId > 0) $stmt->bindValue(':actor_id', $actorId, PDO::PARAM_INT);
  else $stmt->bindValue(':actor_id', null, PDO::PARAM_NULL);

  $stmt->bindValue(':title', $title, PDO::PARAM_STR);

  $msg = trim((string)$message);
  if ($msg !== '') $stmt->bindValue(':message', $msg, PDO::PARAM_STR);
  else $stmt->bindValue(':message', null, PDO::PARAM_NULL);

  $stmt->bindValue(':notif_type', $notifType, PDO::PARAM_STR);

  if ($payloadId !== null && $payloadId > 0) $stmt->bindValue(':payload_id', $payloadId, PDO::PARAM_INT);
  else $stmt->bindValue(':payload_id', null, PDO::PARAM_NULL);

  $stmt->execute();
  return (int)$pdo->lastInsertId();
}

/**
 * Same logic as accreditation-special.php:
 * role='super_admin' AND status='Active'
 * most recently logged in (fallback: newest id)
 */
function current_active_super_admin_id(PDO $pdo): ?int {
  try {
    $stmt = $pdo->query("
      SELECT id
      FROM users
      WHERE role='super_admin' AND status='Active'
      ORDER BY
        (last_login_at IS NULL) ASC,
        last_login_at DESC,
        id DESC
      LIMIT 1
    ");
    if ($stmt) {
      $row = $stmt->fetch(PDO::FETCH_ASSOC);
      $id = (int)($row['id'] ?? 0);
      return $id > 0 ? $id : null;
    }
  } catch (Throwable $e) {
    // fallback below
  }

  // ✅ Fallback if last_login_at doesn't exist
  $stmt2 = $pdo->query("
    SELECT id
    FROM users
    WHERE role='super_admin' AND status='Active'
    ORDER BY id DESC
    LIMIT 1
  ");
  if (!$stmt2) return null;
  $row2 = $stmt2->fetch(PDO::FETCH_ASSOC);
  $id2 = (int)($row2['id'] ?? 0);
  return $id2 > 0 ? $id2 : null;
}

function notify_current_super_admin(PDO $pdo, int $actorId, string $title, string $message, ?int $payloadId = null): bool {
  $sid = current_active_super_admin_id($pdo);
  if (!$sid) return false;
  return add_notification($pdo, $sid, $actorId > 0 ? $actorId : null, $title, $message, 'accreditation', $payloadId) > 0;
}

/**
 * Fetch accreditation context (for messages + PDF content).
 */
function get_accred_context(PDO $pdo, int $requestId): ?array {
  $stmt = $pdo->prepare("
    SELECT
      ar.id AS request_id,
      ar.status,
      ar.special_admin_notes,
      ar.super_admin_notes,
      ar.coordinator_user_id,
      ar.moderator_user_id,
      ar.academic_term_id,
      o.id AS _unused_org_id, /* ✅ FIX: don't reference o.org_id (often doesn't exist) */
      o.id AS org_id,
      o.org_name,
      o.abbreviation AS org_abbr,
      o.scope,
      o.description AS org_description,
      o.program_id,
      COALESCE(p.abbreviation,'') AS program,
      CONCAT(at.school_year,' • ',at.semester) AS term_label
    FROM accreditation_requests ar
    JOIN organizations o ON o.id = ar.org_id
    JOIN academic_terms at ON at.id = ar.academic_term_id
    LEFT JOIN programs p ON p.id = o.program_id
    WHERE ar.id = :rid
    LIMIT 1
  ");
  $stmt->execute([':rid' => $requestId]);
  $row = $stmt->fetch(PDO::FETCH_ASSOC);
  return $row ?: null;
}

/**
 * Build the Special Admin display name (same behavior as accreditation-special.php).
 */
function user_full_name(PDO $pdo, int $uid): string {
  $stmt = $pdo->prepare("SELECT first_name, middle_name, last_name, suffix FROM users WHERE id = :id LIMIT 1");
  $stmt->execute([':id' => $uid]);
  $u = $stmt->fetch(PDO::FETCH_ASSOC);
  if (!$u) return '';

  $fn = trim((string)($u['first_name'] ?? ''));
  $mn = trim((string)($u['middle_name'] ?? ''));
  $ln = trim((string)($u['last_name'] ?? ''));
  $sx = trim((string)($u['suffix'] ?? ''));

  $parts = [];
  if ($fn !== '') $parts[] = $fn;
  if ($mn !== '') $parts[] = $mn;
  if ($ln !== '') $parts[] = $ln;

  $name = trim(implode(' ', $parts));
  if ($sx !== '') $name .= ' ' . $sx;

  return trim($name);
}

/**
 * ✅ Generate recommendation PDF (copied behavior from accreditation-special.php),
 * returning ['path' => <relative>, 'url' => <public>]
 */
function generate_recommendation_pdf(PDO $pdo, int $requestId, int $specialUid, array $ctx): array {
  // composer autoload
  $autoload = rtrim(project_root(), "/\\") . '/vendor/autoload.php';
  if (!is_file($autoload)) fail('mPDF not found. Run composer install (vendor/autoload.php missing).', 500);
  require_once $autoload;

  $orgName = (string)($ctx['org_name'] ?? 'Organization');
  $orgAbbr = (string)($ctx['org_abbr'] ?? '');
  $scope   = (string)($ctx['scope'] ?? '');
  $program = (string)($ctx['program'] ?? '');
  $termLbl = (string)($ctx['term_label'] ?? '');
  $orgDesc = (string)($ctx['org_description'] ?? '');

  $headerPath = realpath(rtrim(project_root(), "/\\") . '/assets/templates/letterhead-header.png');
  $footerPath = realpath(rtrim(project_root(), "/\\") . '/assets/templates/letterhead-footer.png');

  if (!$headerPath || !is_file($headerPath)) {
    fail('Letterhead header not found. Put it at assets/templates/letterhead-header.png', 500);
  }
  if (!$footerPath || !is_file($footerPath)) {
    fail('Letterhead footer not found. Put it at assets/templates/letterhead-footer.png', 500);
  }

  // Active signature
  $sigRel = '';
  $stmt = $pdo->prepare("
    SELECT signature_file
    FROM e_signatures
    WHERE user_id = :uid AND status = 'Active'
    ORDER BY id DESC
    LIMIT 1
  ");
  $stmt->execute([':uid' => $specialUid]);
  $sigRel = trim((string)($stmt->fetchColumn() ?: ''));

  if ($sigRel === '') {
    fail('No active e-signature found for the current Special Admin. Please upload/set one as Active.', 400);
  }

  $signaturePath = realpath(rtrim(project_root(), "/\\") . '/' . ltrim($sigRel, "/\\"));
  if (!$signaturePath || !is_file($signaturePath)) {
    fail('Active e-signature file not found on disk: ' . $sigRel, 500);
  }

  $specialName = user_full_name($pdo, $specialUid);
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

  $tmpDir = rtrim(project_root(), "/\\") . '/tmp';
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
  if ($termLbl !== '') $metaBits[] = 'Term: ' . $esc($termLbl);
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

  return [
    'path' => $destRel,
    'url'  => public_url($destRel),
  ];
}

/* =========================
   Auth + caps
   ========================= */
$userId = $_SESSION['user_id'] ?? null;
$role   = normalize_role($_SESSION['role'] ?? '');

if (!$userId) fail('Unauthorized', 401);

$action = $_GET['action'] ?? $_POST['action'] ?? '';
$action = strtolower(trim((string)$action));

$canCreate = is_role($role, ['super_admin', 'special_admin', 'faculty_admin', 'moderator', 'overseer']);

$canAccredReviewDocs   = is_role($role, ['special_admin', 'moderator', 'super_admin']);
$canAccredRecommend    = is_role($role, ['special_admin', 'moderator']);
$canAccredSuperActions = is_role($role, ['super_admin']);

/* =========================
   Main
   ========================= */
try {
  switch ($action) {

    case 'list': {
      $limit  = isset($_GET['limit']) ? (int)$_GET['limit'] : 20;
      $limit  = max(1, min(100, $limit));

      $status = $_GET['status'] ?? 'all';
      $status = strtolower(trim((string)$status));

      $type = $_GET['type'] ?? 'all';
      $type = strtolower(trim((string)$type));

      $beforeId = isset($_GET['before_id']) ? (int)$_GET['before_id'] : 0;
      $afterId  = isset($_GET['after_id']) ? (int)$_GET['after_id'] : 0;

      $where = "recipient_id = :uid";
      $params = [':uid' => (int)$userId];

      if ($status === 'unread' || $status === 'read') {
        $where .= " AND status = :status";
        $params[':status'] = $status;
      }

      if ($type !== 'all' && $type !== '') {
        $where .= " AND notif_type = :type";
        $params[':type'] = $type;
      }

      if ($beforeId > 0) {
        $where .= " AND id < :before_id";
        $params[':before_id'] = $beforeId;
      }

      if ($afterId > 0) {
        $where .= " AND id > :after_id";
        $params[':after_id'] = $afterId;
      }

      $sql = "
        SELECT id, recipient_id, actor_id, title, message, notif_type, status, payload_id, created_at
        FROM notifications
        WHERE $where
        ORDER BY id DESC
        LIMIT $limit
      ";
      $stmt = $pdo->prepare($sql);
      $stmt->execute($params);
      $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);

      $cStmt = $pdo->prepare("SELECT COUNT(*) AS c FROM notifications WHERE recipient_id = :uid AND status = 'unread'");
      $cStmt->execute([':uid' => (int)$userId]);
      $unread = (int)($cStmt->fetch(PDO::FETCH_ASSOC)['c'] ?? 0);

      ok([
        'unread_count' => $unread,
        'notifications' => $rows,
        'meta' => [
          'limit' => $limit,
          'status' => $status,
          'type' => $type,
          'before_id' => $beforeId,
          'after_id' => $afterId,
        ]
      ]);
    }

    case 'unread_count': {
      $stmt = $pdo->prepare("SELECT COUNT(*) AS c FROM notifications WHERE recipient_id = :uid AND status = 'unread'");
      $stmt->execute([':uid' => (int)$userId]);
      $count = (int)($stmt->fetch(PDO::FETCH_ASSOC)['c'] ?? 0);
      ok(['unread_count' => $count]);
    }

    case 'mark_read': {
      $id = isset($_POST['id']) ? (int)$_POST['id'] : 0;
      if ($id <= 0) fail('Invalid id');

      $stmt = $pdo->prepare("
        UPDATE notifications
        SET status = 'read'
        WHERE id = :id AND recipient_id = :uid
      ");
      $stmt->execute([':id' => $id, ':uid' => (int)$userId]);

      ok(['updated' => $stmt->rowCount()]);
    }

    case 'mark_all_read': {
      $stmt = $pdo->prepare("
        UPDATE notifications
        SET status = 'read'
        WHERE recipient_id = :uid AND status = 'unread'
      ");
      $stmt->execute([':uid' => (int)$userId]);

      ok(['updated' => $stmt->rowCount()]);
    }

    case 'delete': {
      $id = isset($_POST['id']) ? (int)$_POST['id'] : 0;
      if ($id <= 0) fail('Invalid id');

      $stmt = $pdo->prepare("DELETE FROM notifications WHERE id = :id AND recipient_id = :uid");
      $stmt->execute([':id' => $id, ':uid' => (int)$userId]);

      ok(['deleted' => $stmt->rowCount()]);
    }

    case 'clear': {
      $mode = $_POST['mode'] ?? 'all';
      $mode = strtolower(trim((string)$mode));

      $where = "recipient_id = :uid";
      $params = [':uid' => (int)$userId];

      if ($mode === 'read' || $mode === 'unread') {
        $where .= " AND status = :status";
        $params[':status'] = $mode;
      } elseif ($mode !== 'all') {
        fail('Invalid mode');
      }

      $stmt = $pdo->prepare("DELETE FROM notifications WHERE $where");
      $stmt->execute($params);

      ok(['deleted' => $stmt->rowCount()]);
    }

    case 'get_payload': {
          $type = strtolower(trim((string)($_GET['type'] ?? '')));
          $payloadId = isset($_GET['payload_id']) ? (int)$_GET['payload_id'] : 0;

          if ($payloadId <= 0) fail('Invalid payload_id');
          if ($type === '') fail('Missing type');

          if ($type === 'accreditation' || $type === 'reaccreditation') {
            $stmt = $pdo->prepare("
              SELECT
                ar.id,
                ar.org_id,
                o.org_name,
                o.abbreviation,
                o.org_type,
                o.scope,
                o.description,
                o.mission,
                o.vision,
                o.objectives,
                o.advocacy,
                o.program_id,
                ar.academic_term_id,
                at.school_year,
                at.semester,
                ar.coordinator_user_id,
                ar.moderator_user_id,
                ar.status,
                ar.submitted_at,
                ar.updated_at,
                ar.special_admin_notes,
                ar.super_admin_notes,
                ar.is_renewal,
                ar.previous_request_id,
                uc.first_name AS coord_first_name,
                uc.middle_name AS coord_middle_name,
                uc.last_name AS coord_last_name,
                um.first_name AS mod_first_name,
                um.middle_name AS mod_middle_name,
                um.last_name AS mod_last_name,
                p.program_name,
                p.abbreviation AS program_abbr
              FROM accreditation_requests ar
              JOIN organizations o ON o.id = ar.org_id
              JOIN academic_terms at ON at.id = ar.academic_term_id
              JOIN users uc ON uc.id = ar.coordinator_user_id
              LEFT JOIN users um ON um.id = ar.moderator_user_id
              LEFT JOIN programs p ON p.id = o.program_id
              WHERE ar.id = :rid
              LIMIT 1
            ");
            $stmt->execute([':rid' => $payloadId]);
            $req = $stmt->fetch(PDO::FETCH_ASSOC);
            if (!$req) fail('Accreditation request not found', 404);

            // Recommendation PDF support (from special_admin_notes tag)
            $specialNotes = (string)($req['special_admin_notes'] ?? '');
            $recPath = extract_note_tag($specialNotes, 'RECOMMENDATION_FILE');
            $req['recommendation_file_path'] = $recPath;
            $req['recommendation_file_url']  = ($recPath && trim($recPath) !== '') ? public_url($recPath) : '';

            // Only get documents for ACTIVE requirements - archived requirements are completely excluded
            $dStmt = $pdo->prepare("
              SELECT
                d.id,
                d.request_id,
                d.requirement_id,
                r.requirement_name,
                d.file_path,
                d.file_name,
                d.status AS document_status,
                d.reviewed_by,
                d.reviewed_at,
                d.return_reason,
                d.uploaded_at,
                ur.first_name AS reviewed_first_name,
                ur.middle_name AS reviewed_middle_name,
                ur.last_name AS reviewed_last_name
              FROM accreditation_request_documents d
              INNER JOIN accreditation_requirements r ON r.id = d.requirement_id AND r.status = 'Active'
              LEFT JOIN users ur ON ur.id = d.reviewed_by
              WHERE d.request_id = :rid
              ORDER BY r.sort_order ASC, d.id ASC
            ");
            $dStmt->execute([':rid' => $payloadId]);
            $docs = $dStmt->fetchAll(PDO::FETCH_ASSOC);

            foreach ($docs as &$d) {
              $fp = trim((string)($d['file_path'] ?? ''));
              $d['file_url'] = ($fp !== '') ? public_url($fp) : '';
            }
            unset($d);

            $total = count($docs);
            $accepted = 0;
            $returned = 0;
            $other = 0;

            foreach ($docs as $d) {
              $st = strtolower((string)($d['document_status'] ?? ''));
              if ($st === 'accepted') $accepted++;
              else if ($st === 'returned') $returned++;
              else $other++;
            }

            ok([
              'type' => 'accreditation',
              'payload_id' => $payloadId,
              'capabilities' => [
                'role' => $role,
                'can_review_docs' => $canAccredReviewDocs,
                'can_recommend' => $canAccredRecommend,
                'can_super_actions' => $canAccredSuperActions,
                'can_reupload_docs' => is_role($role, ['coordinator', 'moderator', 'special_admin']), // Add this capability
              ],
              'request' => $req,
              'documents' => $docs,
              'summary' => [
                'total' => $total,
                'accepted' => $accepted,
                'returned' => $returned,
                'other' => $other,
              ]
            ]);
          }
          // ... rest of your cases ...
    }

    case 'review_doc': {
      if (!$canAccredReviewDocs) fail('Forbidden', 403);

      $docId = isset($_POST['doc_id']) ? (int)$_POST['doc_id'] : 0;
      $decision = strtolower(trim((string)($_POST['decision'] ?? '')));
      $reason = trim((string)($_POST['reason'] ?? ''));

      if ($docId <= 0) fail('Invalid doc_id');
      if ($decision !== 'accept' && $decision !== 'return') fail('Invalid decision');
      if ($decision === 'return' && $reason === '') fail('Return reason is required');

      $pdo->beginTransaction();

      $stmt = $pdo->prepare("
        SELECT d.id, d.request_id, ar.coordinator_user_id, o.org_name, r.requirement_name
        FROM accreditation_request_documents d
        JOIN accreditation_requests ar ON ar.id = d.request_id
        JOIN organizations o ON o.id = ar.org_id
        JOIN accreditation_requirements r ON r.id = d.requirement_id
        WHERE d.id = :did
        LIMIT 1
      ");
      $stmt->execute([':did' => $docId]);
      $row = $stmt->fetch(PDO::FETCH_ASSOC);
      if (!$row) {
        $pdo->rollBack();
        fail('Document not found', 404);
      }

      $newStatus = ($decision === 'accept') ? 'Accepted' : 'Returned';

      $uStmt = $pdo->prepare("
        UPDATE accreditation_request_documents
        SET status = :st,
            reviewed_by = :uid,
            reviewed_at = NOW(),
            return_reason = :rr
        WHERE id = :did
      ");
      $uStmt->bindValue(':st', $newStatus, PDO::PARAM_STR);
      $uStmt->bindValue(':uid', (int)$userId, PDO::PARAM_INT);
      $uStmt->bindValue(':rr', $decision === 'return' ? $reason : null, $decision === 'return' ? PDO::PARAM_STR : PDO::PARAM_NULL);
      $uStmt->bindValue(':did', $docId, PDO::PARAM_INT);
      $uStmt->execute();

      $cntStmt = $pdo->prepare("
        SELECT
          COUNT(*) AS total,
          SUM(CASE WHEN status = 'Accepted' THEN 1 ELSE 0 END) AS accepted,
          SUM(CASE WHEN status = 'Returned' THEN 1 ELSE 0 END) AS returned
        FROM accreditation_request_documents
        WHERE request_id = :rid
      ");
      $cntStmt->execute([':rid' => (int)$row['request_id']]);
      $cnt = $cntStmt->fetch(PDO::FETCH_ASSOC) ?: ['total' => 0, 'accepted' => 0, 'returned' => 0];

      $total = (int)($cnt['total'] ?? 0);
      $accepted = (int)($cnt['accepted'] ?? 0);
      $returned = (int)($cnt['returned'] ?? 0);

      // update request status
      if ($returned > 0) {
        $pdo->prepare("UPDATE accreditation_requests SET status = 'Returned' WHERE id = :rid")
            ->execute([':rid' => (int)$row['request_id']]);
      } else {
        if ($total > 0 && $accepted === $total) {
          $pdo->prepare("UPDATE accreditation_requests SET status = 'Pending' WHERE id = :rid")
              ->execute([':rid' => (int)$row['request_id']]);
        }
      }

      // ✅ notification to coordinator
      $coordinatorId = (int)($row['coordinator_user_id'] ?? 0);
      $orgName = (string)($row['org_name'] ?? 'Organization');
      $reqName = (string)($row['requirement_name'] ?? 'document');

      if ($coordinatorId > 0) {
        if ($decision === 'accept') {
          $title = "Document Accepted";
          $msg = "Your document for requirement '{$reqName}' in organization '{$orgName}' has been accepted.";
        } else {
          $title = "Document Returned - Needs Revision";
          $msg = "Your document for requirement '{$reqName}' in organization '{$orgName}' has been returned. Reason: {$reason}";
        }
        add_notification($pdo, $coordinatorId, (int)$userId, $title, $msg, 'accreditation', (int)$row['request_id']);
      }

      $pdo->commit();

      ok([
        'doc_id' => $docId,
        'request_id' => (int)$row['request_id'],
        'doc_status' => $newStatus,
        'summary' => [
          'total' => $total,
          'accepted' => $accepted,
          'returned' => $returned
        ]
      ]);
    }

    case 'bulk_review_docs': {
      if (!$canAccredReviewDocs) fail('Forbidden', 403);

      $decision = strtolower(trim((string)($_POST['decision'] ?? '')));
      if ($decision !== 'accept' && $decision !== 'return') fail('Invalid decision');

      $reason = trim((string)($_POST['reason'] ?? ''));
      if ($decision === 'return' && $reason === '') fail('Return reason is required');

      $docIdsRaw = $_POST['doc_ids'] ?? [];
      $docIds = [];

      if (is_array($docIdsRaw)) {
        foreach ($docIdsRaw as $v) {
          $n = (int)$v;
          if ($n > 0) $docIds[] = $n;
        }
      } else {
        $parts = preg_split('/[,\s]+/', (string)$docIdsRaw);
        foreach ($parts as $v) {
          $n = (int)$v;
          if ($n > 0) $docIds[] = $n;
        }
      }

      $docIds = array_values(array_unique($docIds));
      if (!$docIds) fail('No doc_ids provided');

      $pdo->beginTransaction();

      $placeholders = implode(',', array_fill(0, count($docIds), '?'));
      $s = $pdo->prepare("
        SELECT
          d.id,
          d.request_id,
          ar.coordinator_user_id,
          o.org_name
        FROM accreditation_request_documents d
        JOIN accreditation_requests ar ON ar.id = d.request_id
        JOIN organizations o ON o.id = ar.org_id
        WHERE d.id IN ($placeholders)
        FOR UPDATE
      ");
      $s->execute($docIds);
      $rows = $s->fetchAll(PDO::FETCH_ASSOC);

      if (!$rows) {
        $pdo->rollBack();
        fail('Documents not found', 404);
      }

      $foundIds = array_map(fn($r) => (int)$r['id'], $rows);
      $missing = array_values(array_diff($docIds, $foundIds));
      $requestIds = array_values(array_unique(array_map(fn($r) => (int)$r['request_id'], $rows)));

      $newStatus = ($decision === 'accept') ? 'Accepted' : 'Returned';

      $u = $pdo->prepare("
        UPDATE accreditation_request_documents
        SET status = :st,
            reviewed_by = :uid,
            reviewed_at = NOW(),
            return_reason = :rr
        WHERE id = :did
      ");

      $updated = 0;
      foreach ($foundIds as $did) {
        $u->bindValue(':st', $newStatus, PDO::PARAM_STR);
        $u->bindValue(':uid', (int)$userId, PDO::PARAM_INT);
        $u->bindValue(':rr', $decision === 'return' ? $reason : null, $decision === 'return' ? PDO::PARAM_STR : PDO::PARAM_NULL);
        $u->bindValue(':did', (int)$did, PDO::PARAM_INT);
        $u->execute();
        $updated += (int)$u->rowCount();
      }

      // for each request, update status and notify coordinator
      $cntStmt = $pdo->prepare("
        SELECT
          COUNT(*) AS total,
          SUM(CASE WHEN status = 'Accepted' THEN 1 ELSE 0 END) AS accepted,
          SUM(CASE WHEN status = 'Returned' THEN 1 ELSE 0 END) AS returned
        FROM accreditation_request_documents
        WHERE request_id = :rid
      ");
      $setReq = $pdo->prepare("UPDATE accreditation_requests SET status = :st WHERE id = :rid");

      $ctxStmt = $pdo->prepare("
        SELECT ar.coordinator_user_id, o.org_name
        FROM accreditation_requests ar
        JOIN organizations o ON o.id = ar.org_id
        WHERE ar.id = :rid
        LIMIT 1
      ");

      $request_updates = [];
      foreach ($requestIds as $rid) {
        $cntStmt->execute([':rid' => (int)$rid]);
        $cnt = $cntStmt->fetch(PDO::FETCH_ASSOC) ?: ['total' => 0, 'accepted' => 0, 'returned' => 0];

        $total = (int)($cnt['total'] ?? 0);
        $accepted = (int)($cnt['accepted'] ?? 0);
        $returned = (int)($cnt['returned'] ?? 0);

        $reqStatus = ($returned > 0) ? 'Returned' : 'Pending';
        if ($total > 0 && $accepted === $total && $returned === 0) $reqStatus = 'Pending';

        $setReq->execute([':st' => $reqStatus, ':rid' => (int)$rid]);

        // notify coordinator
        $ctxStmt->execute([':rid' => (int)$rid]);
        $ctx = $ctxStmt->fetch(PDO::FETCH_ASSOC) ?: null;
        if ($ctx) {
          $coordinatorId = (int)($ctx['coordinator_user_id'] ?? 0);
          $orgName = (string)($ctx['org_name'] ?? 'Organization');

          if ($coordinatorId > 0) {
            if ($decision === 'accept') {
              $title = "Documents Accepted";
              $msg = "Your submitted documents for organization '{$orgName}' have been accepted.";
            } else {
              $title = "Documents Returned - Needs Revision";
              $msg = "Some of your documents for organization '{$orgName}' have been returned. Reason: {$reason}";
            }
            add_notification($pdo, $coordinatorId, (int)$userId, $title, $msg, 'accreditation', (int)$rid);
          }
        }

        $request_updates[] = [
          'request_id' => (int)$rid,
          'status' => $reqStatus,
          'summary' => [
            'total' => $total,
            'accepted' => $accepted,
            'returned' => $returned,
          ]
        ];
      }

      $pdo->commit();

      ok([
        'decision' => $decision,
        'doc_status' => $newStatus,
        'requested' => count($docIds),
        'found' => count($foundIds),
        'updated' => $updated,
        'missing' => $missing,
        'request_updates' => $request_updates,
      ]);
    }

    case 'request_action': {
      $requestId = isset($_POST['request_id']) ? (int)$_POST['request_id'] : 0;
      $do = strtolower(trim((string)($_POST['do'] ?? '')));
      $note = trim((string)($_POST['note'] ?? ''));

      if ($requestId <= 0) fail('Invalid request_id');
      if (!in_array($do, ['recommend', 'return', 'approve', 'activate', 'reject'], true)) fail('Invalid do');

      if (in_array($do, ['recommend', 'return'], true) && !$canAccredRecommend) fail('Forbidden', 403);
      if (in_array($do, ['approve', 'activate', 'reject'], true) && !$canAccredSuperActions) fail('Forbidden', 403);

      $pdo->beginTransaction();

      $stmt = $pdo->prepare("
        SELECT id, status, special_admin_notes, super_admin_notes, coordinator_user_id, submitted_at
        FROM accreditation_requests
        WHERE id = :rid
        LIMIT 1
        FOR UPDATE
      ");
      $stmt->execute([':rid' => $requestId]);
      $req = $stmt->fetch(PDO::FETCH_ASSOC);
      if (!$req) {
        $pdo->rollBack();
        fail('Request not found', 404);
      }

      $ctx = get_accred_context($pdo, $requestId); // includes org_name + term_label
      $coordId = (int)($ctx['coordinator_user_id'] ?? ($req['coordinator_user_id'] ?? 0));
      $orgName = (string)($ctx['org_name'] ?? 'Organization');
      $termLbl = (string)($ctx['term_label'] ?? '');

      $newStatus = (string)($req['status'] ?? '');
      if ($do === 'recommend') $newStatus = 'Recommended';
      if ($do === 'return')    $newStatus = 'Returned';
      if ($do === 'approve')   $newStatus = 'Approved';
      if ($do === 'activate')  $newStatus = 'Active';
      if ($do === 'reject')    $newStatus = 'Rejected';

      $noteLine = "[" . now_mysql() . " user_id=" . (int)$userId . "] " . ($note !== '' ? $note : strtoupper($do));

      $recommendationRel = '';
      $recommendationUrl = '';

      // ✅ If recommend AND user is special_admin, generate PDF
      if ($do === 'recommend' && $role === 'special_admin') {
        if (!$ctx) {
          $pdo->rollBack();
          fail('Request context not found (cannot generate PDF).', 404);
        }
        $pdf = generate_recommendation_pdf($pdo, $requestId, (int)$userId, $ctx);
        $recommendationRel = (string)($pdf['path'] ?? '');
        $recommendationUrl = (string)($pdf['url'] ?? '');
      }

      // update notes field depending on actor type
      if (in_array($do, ['recommend', 'return'], true)) {
        $old = (string)($req['special_admin_notes'] ?? '');
        $merged = trim($old . "\n" . $noteLine);

        if ($do === 'recommend' && $recommendationRel !== '') {
          $merged = upsert_note_tag($merged, 'RECOMMENDATION_FILE', ltrim($recommendationRel, "/\\"));
        }

        if ($do === 'recommend') {
          $u = $pdo->prepare("
            UPDATE accreditation_requests
            SET status = :st,
                special_admin_notes = :notes,
                submitted_at = COALESCE(submitted_at, CURRENT_TIMESTAMP),
                updated_at = CURRENT_TIMESTAMP
            WHERE id = :rid
          ");
          $u->execute([':st' => $newStatus, ':notes' => $merged, ':rid' => $requestId]);
        } else {
          $u = $pdo->prepare("
            UPDATE accreditation_requests
            SET status = :st,
                special_admin_notes = :notes,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = :rid
          ");
          $u->execute([':st' => $newStatus, ':notes' => $merged, ':rid' => $requestId]);
        }
      } else {
        $old = (string)($req['super_admin_notes'] ?? '');
        $merged = trim($old . "\n" . $noteLine);

        $u = $pdo->prepare("
          UPDATE accreditation_requests
          SET status = :st,
              super_admin_notes = :notes,
              updated_at = CURRENT_TIMESTAMP
          WHERE id = :rid
        ");
        $u->execute([':st' => $newStatus, ':notes' => $merged, ':rid' => $requestId]);
      }

      /* ✅ Notifications */
      if ($do === 'recommend') {
        if ($coordId > 0) {
          add_notification(
            $pdo,
            $coordId,
            (int)$userId,
            "Recommendation Submitted",
            "A recommendation letter for '{$orgName}' has been generated and your request is now marked as Recommended.",
            'accreditation',
            $requestId
          );
        }

        $title = "Accreditation Ready for Activation";
        $msg = "Recommendation submitted for '{$orgName}'"
             . ($termLbl !== '' ? " ({$termLbl})" : "")
             . ". Request #{$requestId} is now Recommended and pending your activation.";
        notify_current_super_admin($pdo, (int)$userId, $title, $msg, $requestId);
      }

      if ($do === 'return') {
        if ($coordId > 0) {
          add_notification(
            $pdo,
            $coordId,
            (int)$userId,
            "Accreditation Returned",
            "Your accreditation request for organization '{$orgName}' has been returned for revisions."
              . ($note !== '' ? " Notes: {$note}" : ""),
            'accreditation',
            $requestId
          );
        }
      }

      if ($do === 'approve') {
        if ($coordId > 0) {
          add_notification(
            $pdo,
            $coordId,
            (int)$userId,
            "Accreditation Approved",
            "Your accreditation request for organization '{$orgName}' has been approved.",
            'accreditation',
            $requestId
          );
        }
      }

      if ($do === 'activate') {
        if ($coordId > 0) {
          add_notification(
            $pdo,
            $coordId,
            (int)$userId,
            "Accreditation Activated",
            "Your accreditation request for organization '{$orgName}' is now Active.",
            'accreditation',
            $requestId
          );
        }
      }

      if ($do === 'reject') {
        if ($coordId > 0) {
          add_notification(
            $pdo,
            $coordId,
            (int)$userId,
            "Accreditation Rejected",
            "Your accreditation request for organization '{$orgName}' has been rejected."
              . ($note !== '' ? " Reason: {$note}" : ""),
            'accreditation',
            $requestId
          );
        }
      }

      $pdo->commit();

      ok([
        'request_id' => $requestId,
        'status' => $newStatus,
        'recommendation_path' => ($recommendationRel !== '' ? $recommendationRel : null),
        'recommendation_url'  => ($recommendationUrl !== '' ? $recommendationUrl : null),
        'pdf_generated' => ($recommendationRel !== ''),
      ]);
    }

    case 'create': {
      if (!$canCreate) fail('Forbidden', 403);

      $recipientId = isset($_POST['recipient_id']) ? (int)$_POST['recipient_id'] : 0;
      $actorId     = isset($_POST['actor_id']) ? (int)$_POST['actor_id'] : (int)$userId;

      $title   = trim((string)($_POST['title'] ?? ''));
      $message = trim((string)($_POST['message'] ?? ''));

      $notifType = strtolower(trim((string)($_POST['notif_type'] ?? 'general')));
      $allowedTypes = ['registration','academic-year','general','announcement','accreditation','payment','reaccreditation','club'];
      if (!in_array($notifType, $allowedTypes, true)) $notifType = 'general';

      $payloadId = isset($_POST['payload_id']) && $_POST['payload_id'] !== '' ? (int)$_POST['payload_id'] : null;

      if ($recipientId <= 0) fail('Invalid recipient_id');
      if ($title === '') fail('Title is required');

      $id = add_notification(
        $pdo,
        $recipientId,
        $actorId > 0 ? $actorId : null,
        $title,
        $message !== '' ? $message : null,
        $notifType,
        $payloadId
      );

      ok(['id' => $id]);
    }

    default:
      fail('Invalid action', 400, ['action' => $action]);
  }

} catch (Throwable $e) {
  try {
    if (isset($pdo) && $pdo instanceof PDO && $pdo->inTransaction()) $pdo->rollBack();
  } catch (Throwable $ignored) {}

  if (is_local_dev()) {
    fail('Server error: ' . $e->getMessage(), 500, ['error' => $e->getMessage()]);
  }
  fail('Server error', 500, ['error' => $e->getMessage()]);
}