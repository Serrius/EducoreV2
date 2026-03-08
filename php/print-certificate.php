<?php
declare(strict_types=1);

/**
 * php/print-certificate.php
 * Generates an accreditation "Certificate of Recognition" (mPDF).
 *
 * - Uses letterhead header/footer images (assets/templates)
 * - Uses ACTIVE e-signatures from DB:
 *    - Special Admin: prefer coordinator_user_id IF active special_admin, else fallback latest active special_admin
 *    - Super Admin: latest ACTIVE super_admin (users.status='Active')
 * - Does NOT save the certificate in DB; it is generated dynamically.
 */

session_start();

/* =========================
   DB (PDO) - SAME FOLDER
   ========================= */
require_once __DIR__ . '/db.php'; // ✅ php/db.php provides $pdo

if (!isset($pdo) || !($pdo instanceof PDO)) {
  http_response_code(500);
  echo 'PDO not initialized. Check php/db.php (expected $pdo).';
  exit;
}
try { $pdo->exec("SET NAMES utf8mb4"); } catch (\Throwable $e) {}

/* =========================
   Helpers
   ========================= */
function h(string $s): string {
  return htmlspecialchars($s, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
}

function project_root(): string {
  // EDUORG/php -> EDUORG
  $root = realpath(__DIR__ . '/..');
  return $root !== false ? $root : dirname(__DIR__);
}

function abs_path_from_rel(string $rel): ?string {
  $rel = ltrim($rel, "/\\");
  if ($rel === '') return null;
  $abs = rtrim(project_root(), "/\\") . DIRECTORY_SEPARATOR . str_replace(['/', '\\'], DIRECTORY_SEPARATOR, $rel);
  $real = realpath($abs);
  return $real !== false ? $real : (file_exists($abs) ? $abs : null);
}

/* =========================
   Auth helpers
   ========================= */
function current_user_id(): ?int {
  foreach (['user_id', 'uid', 'id'] as $k) {
    if (!empty($_SESSION[$k])) return (int)$_SESSION[$k];
  }
  if (!empty($_SESSION['user']) && is_array($_SESSION['user']) && !empty($_SESSION['user']['id'])) {
    return (int)$_SESSION['user']['id'];
  }
  return null;
}

function current_user_role(PDO $db, int $uid): ?string {
  $st = $db->prepare("SELECT role FROM users WHERE id=? LIMIT 1");
  $st->execute([$uid]);
  $row = $st->fetch(PDO::FETCH_ASSOC);
  return $row['role'] ?? null;
}

function require_any_role(PDO $db, array $roles): int {
  $uid = current_user_id();
  if (!$uid) {
    http_response_code(401);
    echo 'Unauthorized. Please login.';
    exit;
  }
  $role = current_user_role($db, $uid);
  if (!$role || !in_array($role, $roles, true)) {
    http_response_code(403);
    echo 'Forbidden.';
    exit;
  }
  return $uid;
}

/* =========================
   mPDF bootstrap
   ========================= */
function require_mpdf(): void {
  $autoload = project_root() . '/vendor/autoload.php';
  if (!is_file($autoload)) {
    http_response_code(500);
    echo 'mPDF not found. Run composer install (vendor/autoload.php missing).';
    exit;
  }
  require_once $autoload;
}

/* =========================
   DB helpers: names + signatures
   ========================= */
function user_print_name(PDO $db, int $uid): string {
  $st = $db->prepare("SELECT first_name, middle_name, last_name, suffix FROM users WHERE id=? LIMIT 1");
  $st->execute([$uid]);
  $u = $st->fetch(PDO::FETCH_ASSOC);
  if (!$u) return '—';

  $fn = trim((string)($u['first_name'] ?? ''));
  $mn = trim((string)($u['middle_name'] ?? ''));
  $ln = trim((string)($u['last_name'] ?? ''));
  $sx = trim((string)($u['suffix'] ?? ''));

  $parts = [];
  if ($fn !== '') $parts[] = $fn;
  if ($mn !== '') $parts[] = $mn;
  if ($ln !== '') $parts[] = $ln;

  $name = trim(implode(' ', $parts));
  if ($sx !== '') $name = trim($name . ' ' . $sx);

  return $name !== '' ? $name : '—';
}

function active_signature_abs(PDO $db, int $uid): ?string {
  $st = $db->prepare("
    SELECT signature_file
    FROM e_signatures
    WHERE user_id = ?
      AND status = 'Active'
    ORDER BY id DESC
    LIMIT 1
  ");
  $st->execute([$uid]);
  $row = $st->fetch(PDO::FETCH_ASSOC);
  if (!$row || empty($row['signature_file'])) return null;

  return abs_path_from_rel((string)$row['signature_file']);
}

function current_active_super_admin_id(PDO $db): ?int {
  // choose latest ACTIVE super_admin as “Head”
  $st = $db->query("
    SELECT id
    FROM users
    WHERE role='super_admin' AND status='Active'
    ORDER BY id DESC
    LIMIT 1
  ");
  $row = $st ? $st->fetch(PDO::FETCH_ASSOC) : false;
  return $row ? (int)$row['id'] : null;
}

/**
 * ✅ COPY YOUR LOGIC:
 * Special Admin signer logic:
 * - Prefer coordinator_user_id IF that user is role=special_admin and status=Active
 * - Else fallback to latest Active special_admin
 */
function resolve_active_special_admin_id(PDO $db, int $coordinatorUserId): int {
  if ($coordinatorUserId > 0) {
    $st = $db->prepare("SELECT id FROM users WHERE id=? AND role='special_admin' AND status='Active' LIMIT 1");
    $st->execute([$coordinatorUserId]);
    $r = $st->fetch(PDO::FETCH_ASSOC);
    if ($r && !empty($r['id'])) return (int)$r['id'];
  }

  $st = $db->query("SELECT id FROM users WHERE role='special_admin' AND status='Active' ORDER BY id DESC LIMIT 1");
  $row = $st ? $st->fetch(PDO::FETCH_ASSOC) : false;
  return $row ? (int)$row['id'] : 0;
}

/* =========================
   Main
   ========================= */
require_mpdf();

require_any_role($pdo, ['super_admin', 'special_admin', 'moderator']);

$requestId = isset($_GET['request_id']) ? (int)$_GET['request_id'] : 0;
if ($requestId <= 0) {
  http_response_code(400);
  echo 'Missing request_id.';
  exit;
}

// Request + org + term + program
$sql = "
  SELECT
    ar.id,
    ar.status,
    ar.updated_at,
    ar.coordinator_user_id,
    o.org_name,
    o.abbreviation,
    o.description,
    o.scope,
    p.program_name,
    t.school_year,
    t.semester
  FROM accreditation_requests ar
  JOIN organizations o ON o.id = ar.org_id
  LEFT JOIN programs p ON p.id = o.program_id
  JOIN academic_terms t ON t.id = ar.academic_term_id
  WHERE ar.id = ?
  LIMIT 1
";
$st = $pdo->prepare($sql);
$st->execute([$requestId]);
$row = $st->fetch(PDO::FETCH_ASSOC);

if (!$row) {
  http_response_code(404);
  echo 'Request not found.';
  exit;
}
if (($row['status'] ?? '') !== 'Active') {
  http_response_code(400);
  echo 'Certificate can only be printed for Active requests.';
  exit;
}

$orgName = (string)($row['org_name'] ?? 'Organization');
$abbr = (string)($row['abbreviation'] ?? '');
$orgDesc = trim((string)($row['description'] ?? ''));
$scope = (string)($row['scope'] ?? '');
$program = (string)($row['program_name'] ?? '');
$schoolYear = (string)($row['school_year'] ?? '');
$semester = (string)($row['semester'] ?? '');
$issuedDate = date('F j, Y');
$orgLine = $abbr !== '' ? ($orgName . ' (' . $abbr . ')') : $orgName;

/* =========================
   ✅ Special Admin signer selection
   ========================= */
$coordinatorId = (int)($row['coordinator_user_id'] ?? 0);

$specialAdminId = resolve_active_special_admin_id($pdo, $coordinatorId);
$specialName = $specialAdminId > 0 ? user_print_name($pdo, $specialAdminId) : '—';
$specialSigAbs = $specialAdminId > 0 ? active_signature_abs($pdo, $specialAdminId) : null;

// ✅ Super Admin = current active super_admin (Head)
$superAdminId = current_active_super_admin_id($pdo);
$superName = $superAdminId ? user_print_name($pdo, $superAdminId) : '—';
$superSigAbs = $superAdminId ? active_signature_abs($pdo, $superAdminId) : null;

/* =========================
   Letterhead assets (same design)
   ========================= */
$headerPath = realpath(project_root() . '/assets/templates/letterhead-header.png');
$footerPath = realpath(project_root() . '/assets/templates/letterhead-footer.png');

if (!$headerPath || !is_file($headerPath)) {
  http_response_code(500);
  echo 'Letterhead header not found. Put it at assets/templates/letterhead-header.png';
  exit;
}
if (!$footerPath || !is_file($footerPath)) {
  http_response_code(500);
  echo 'Letterhead footer not found. Put it at assets/templates/letterhead-footer.png';
  exit;
}

/* =========================
   Build PDF (match your design margins)
   ========================= */
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
  http_response_code(500);
  echo 'Failed to init PDF engine: ' . $e->getMessage();
  exit;
}

$mpdf->SetHTMLHeader('
  <div style="text-align:center;">
    <img src="' . $headerPath . '" style="width:100%; height:auto;" />
  </div>
');
$mpdf->SetHTMLFooter('
  <div style="text-align:center;">
    <img src="' . $footerPath . '" style="width:100%; height:auto;" />
  </div>
');

/* =========================
   CSS (signature touches line)
   ========================= */
$css = <<<CSS
body {
  font-family: Arial, sans-serif;
  font-size: 11.5pt;
  color: #111;
}
.center { text-align: center; }
.p {
  text-align: justify;
  line-height: 1.65;
  margin: 0 0 10.5pt 0;
}
.title {
  text-align: center;
  font-size: 20pt;
  font-weight: 700;
  letter-spacing: 0.6pt;
  margin: 6pt 0 2pt 0;
}
.subtitle {
  text-align: center;
  font-size: 10.8pt;
  color: #333;
  margin: 0 0 14pt 0;
}
.org {
  text-align: center;
  font-size: 16pt;
  font-weight: 700;
  margin: 10pt 0 12pt 0;
}
.meta {
  text-align: center;
  font-size: 10pt;
  color: #333;
  margin: 0 0 14pt 0;
}
.sig-wrap {
  margin-top: 22pt;
  width: 100%;
  page-break-inside: avoid;
}

/* ✅ mPDF-friendly, perfectly aligned 2-column signature layout */
.sig-table {
  width: 100%;
  border-collapse: collapse;
  margin-top: 0;
}
.sig-td {
  width: 50%;
  text-align: center;
  vertical-align: top;
}

/* keep your exact signature positioning */
.sig-img {
  width: 240px;
  height: auto;
  display: block;
  margin: 8pt auto -20pt auto; /* touches the underscore */
}

/* ✅ restore the underscore style line (like ____), not border-top */
.sig-underline {
  width: 200px;
  margin: 0 auto 5pt auto;
  font-size: 12pt;
  line-height: 12pt;
  height: 14pt;
  overflow: hidden;
  white-space: nowrap;
  letter-spacing: 0;
}
.sig-name {
  font-weight: bold;
  margin: 0;
  padding: 0;
  line-height: 1.2;
}
.sig-title {
  margin-top: 2pt;
  font-size: 10.5pt;
}
.small-note {
  margin-top: 18pt;
  font-size: 8.8pt;
  color: #666;
  font-style: italic;
  text-align: center;
}
CSS;

/* =========================
   Build HTML
   ========================= */
$esc = fn($s) => htmlspecialchars((string)$s, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');

$metaBits = [];
if ($abbr !== '') $metaBits[] = 'Abbreviation: ' . $esc($abbr);
if ($scope !== '') $metaBits[] = 'Scope: ' . $esc($scope);
if ($program !== '') $metaBits[] = 'Program: ' . $esc($program);
if ($semester !== '' || $schoolYear !== '') {
  $metaBits[] = 'Term: ' . $esc(trim($semester . ' ' . $schoolYear));
}
$metaHtml = $metaBits ? ('<div class="meta">' . implode(' &nbsp; • &nbsp; ', $metaBits) . '</div>') : '';

$descHtml = '';
if ($orgDesc !== '') {
  $descHtml = '<p class="p"><b>Organization Description:</b> ' . $esc($orgDesc) . '</p>';
}

/* underscore string for the signature line */
$underscore = str_repeat('_', 32);

$html = '
  <div class="title">CERTIFICATE OF RECOGNITION</div>
  <div class="subtitle">Official Recognition of a Duly Accredited Student Organization</div>

  <div class="org">' . $esc($orgLine) . '</div>

  ' . $metaHtml . '

  <p class="p">
    This is to certify that <b>' . $esc($orgName) . '</b> is hereby recognized as a <b>duly accredited student organization</b>
    of the <b>University of Science and Technology of Southern Philippines (USTP) – Jasaan Campus</b>,
    pursuant to the accreditation process administered by the Office of Student Affairs.
  </p>

  ' . $descHtml . '

  <p class="p">
    This recognition is valid for <b>' . $esc($semester) . '</b>, Academic Year <b>' . $esc($schoolYear) . '</b>,
    unless earlier revoked for cause under applicable university policies.
  </p>

  <p class="p">
    Issued this <b>' . $esc($issuedDate) . '</b> at USTP – Jasaan Campus.
  </p>

  <div class="sig-wrap">
    <table class="sig-table">
      <tr>
        <td class="sig-td">
          ' . ($specialSigAbs ? ('<img class="sig-img" src="' . $specialSigAbs . '" alt="Signature" />') : '<div style="height:78px;"></div>') . '
          <div class="sig-underline">' . $underscore . '</div>
          <div class="sig-name">' . $esc($specialName) . '</div>
          <div class="sig-title">Student Development Coordinator</div>
        </td>
        <td class="sig-td">
          ' . ($superSigAbs ? ('<img class="sig-img" src="' . $superSigAbs . '" alt="Signature" />') : '<div style="height:78px;"></div>') . '
          <div class="sig-underline">' . $underscore . '</div>
          <div class="sig-name">' . $esc($superName) . '</div>
          <div class="sig-title">Head, Office of Student Affairs</div>
        </td>
      </tr>
    </table>
  </div>
';

$mpdf->SetTitle('Certificate - ' . $orgName);
$mpdf->WriteHTML($css, \Mpdf\HTMLParserMode::HEADER_CSS);
$mpdf->WriteHTML($html, \Mpdf\HTMLParserMode::HTML_BODY);

// Output inline (temporary)
header('Content-Type: application/pdf');
header('Content-Disposition: inline; filename="certificate_request_' . $requestId . '.pdf"');
$mpdf->Output('certificate_request_' . $requestId . '.pdf', \Mpdf\Output\Destination::INLINE);
