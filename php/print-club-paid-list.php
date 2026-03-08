<?php
// php/print-club-paid-list.php
// Print ALL PAID / APPROVED membership receipts for an organization/club (org_id + term_id optional)
// - Data: organization_memberships + organization_membership_receipts + users + organizations + academic_terms
// - Signatures: Treasurer + Auditor (YEAR-based Option B) + ACTIVE e_signatures
//
// Fixes:
// - term_id optional: picks latest term that HAS membership receipts for this org; fallback Active term; fallback latest term
// - Permission updated to YEAR-based officers (Option B)
// - Officer lookup updated for YEAR-based fallback + users name fallback
// - Signature lookup resilient to different column names
// - display_errors OFF to avoid corrupting PDF
// - safe PDF output (cleans buffers)

declare(strict_types=1);

ini_set('display_errors', '0');
ini_set('log_errors', '1');
error_reporting(E_ALL);

session_start();

require_once __DIR__ . '/db.php'; // expects $pdo

$autoload = __DIR__ . '/../vendor/autoload.php';
if (!is_file($autoload)) {
  http_response_code(500);
  header('Content-Type: text/plain; charset=utf-8');
  echo "Missing vendor/autoload.php. Run composer install.\nExpected: {$autoload}\n";
  exit;
}
require_once $autoload;

use Mpdf\Mpdf;

if (!isset($pdo) || !($pdo instanceof PDO)) {
  http_response_code(500);
  header('Content-Type: text/plain; charset=utf-8');
  echo 'PDO not initialized. Check php/db.php (expected $pdo).';
  exit;
}
try { $pdo->exec("SET NAMES utf8mb4"); } catch (\Throwable $e) {}

/* =========================
   Helpers
   ========================= */
function h($s): string {
  return htmlspecialchars((string)($s ?? ''), ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
}
function peso($n): string {
  return '₱' . number_format((float)$n, 2, '.', ',');
}
function session_user_id(): int {
  if (isset($_SESSION['user_id'])) return (int)$_SESSION['user_id'];
  if (isset($_SESSION['id'])) return (int)$_SESSION['id'];
  if (isset($_SESSION['user']) && is_array($_SESSION['user']) && isset($_SESSION['user']['id'])) return (int)$_SESSION['user']['id'];
  return 0;
}
function img_tag_base64(string $relativePath, string $className = '', string $alt = ''): string {
  $p = trim($relativePath);
  if ($p === '') return '';
  if (preg_match('~^https?://~i', $p)) return '';

  $p = str_replace('\\', '/', $p);

  $fsPath = realpath(__DIR__ . '/../' . ltrim($p, '/'));
  if (!$fsPath || !is_file($fsPath)) return '';

  $ext = strtolower(pathinfo($fsPath, PATHINFO_EXTENSION));
  if ($ext === 'jpg') $ext = 'jpeg';
  if (!in_array($ext, ['png', 'jpeg', 'gif', 'webp'], true)) return '';

  $mime = 'image/' . $ext;
  $data = base64_encode((string)file_get_contents($fsPath));

  $cls = $className !== '' ? ' class="' . h($className) . '"' : '';
  $altEsc = h($alt);

  return '<img src="data:' . $mime . ';base64,' . $data . '"' . $cls . ' alt="' . $altEsc . '">';
}
function format_full_name_row(array $r): string {
  $parts = [];
  if (!empty($r['first_name'])) $parts[] = $r['first_name'];
  if (!empty($r['middle_name'])) $parts[] = mb_substr((string)$r['middle_name'], 0, 1) . '.';
  if (!empty($r['last_name'])) $parts[] = $r['last_name'];
  if (!empty($r['suffix'])) $parts[] = $r['suffix'];
  $name = trim(preg_replace('/\s+/', ' ', implode(' ', $parts)));
  return $name !== '' ? $name : '—';
}
function term_label(?string $schoolYear, ?string $semester): string {
  $sy = trim((string)($schoolYear ?? ''));
  $sem = trim((string)($semester ?? ''));

  $semLabel = $sem;
  if (strcasecmp($sem, '1st') === 0) $semLabel = '1st Semester';
  else if (strcasecmp($sem, '2nd') === 0) $semLabel = '2nd Semester';
  else if ($sem !== '' && stripos($sem, 'semester') === false) $semLabel = $sem . ' Semester';

  if ($sy !== '' && $semLabel !== '') return $semLabel . ', AY ' . $sy;
  if ($sy !== '') return 'AY ' . $sy;
  return '—';
}

/* =========================
   Option B helpers (YEAR-based)
   ========================= */
function school_year_for_term(PDO $pdo, int $termId): string {
  if ($termId <= 0) return '';
  $st = $pdo->prepare("SELECT school_year FROM academic_terms WHERE id = :id LIMIT 1");
  $st->execute([':id' => $termId]);
  $r = $st->fetch(PDO::FETCH_ASSOC);
  return trim((string)($r['school_year'] ?? ''));
}
function is_officer_for_year(PDO $pdo, int $userId, int $orgId, int $termId): bool {
  if ($userId <= 0 || $orgId <= 0 || $termId <= 0) return false;
  $sy = school_year_for_term($pdo, $termId);
  if ($sy === '') return false;

  $st = $pdo->prepare("
    SELECT 1
    FROM organization_officers oo
    INNER JOIN academic_terms t ON t.id = oo.academic_term_id
    WHERE oo.org_id = :org_id
      AND oo.user_id = :uid
      AND oo.status = 'Active'
      AND t.school_year = :sy
    LIMIT 1
  ");
  $st->execute([
    ':org_id' => $orgId,
    ':uid' => $userId,
    ':sy' => $sy,
  ]);
  return (bool)$st->fetchColumn();
}
function get_officer(PDO $pdo, int $orgId, int $termId, string $roleLike): ?array {
  $pos = '%' . mb_strtolower($roleLike) . '%';

  // 1) exact term
  $st = $pdo->prepare("
    SELECT
      oo.user_id,
      COALESCE(NULLIF(oo.full_name, ''), CONCAT_WS(' ',
        NULLIF(u.first_name, ''),
        CASE WHEN u.middle_name IS NULL OR u.middle_name = '' THEN NULL ELSE CONCAT(LEFT(u.middle_name, 1), '.') END,
        NULLIF(u.last_name, ''),
        NULLIF(u.suffix, '')
      )) AS full_name,
      oo.position
    FROM organization_officers oo
    LEFT JOIN users u ON u.id = oo.user_id
    WHERE oo.org_id = :org_id
      AND oo.academic_term_id = :term_id
      AND oo.status = 'Active'
      AND LOWER(oo.position) LIKE :pos
    ORDER BY oo.id DESC
    LIMIT 1
  ");
  $st->execute([
    ':org_id' => $orgId,
    ':term_id' => $termId,
    ':pos' => $pos,
  ]);
  $r = $st->fetch(PDO::FETCH_ASSOC);
  if ($r) return $r;

  // 2) year fallback
  $sy = school_year_for_term($pdo, $termId);
  if ($sy === '') return null;

  $st2 = $pdo->prepare("
    SELECT
      oo.user_id,
      COALESCE(NULLIF(oo.full_name, ''), CONCAT_WS(' ',
        NULLIF(u.first_name, ''),
        CASE WHEN u.middle_name IS NULL OR u.middle_name = '' THEN NULL ELSE CONCAT(LEFT(u.middle_name, 1), '.') END,
        NULLIF(u.last_name, ''),
        NULLIF(u.suffix, '')
      )) AS full_name,
      oo.position
    FROM organization_officers oo
    INNER JOIN academic_terms t ON t.id = oo.academic_term_id
    LEFT JOIN users u ON u.id = oo.user_id
    WHERE oo.org_id = :org_id
      AND oo.status = 'Active'
      AND t.school_year = :sy
      AND LOWER(oo.position) LIKE :pos
    ORDER BY oo.academic_term_id DESC, oo.id DESC
    LIMIT 1
  ");
  $st2->execute([
    ':org_id' => $orgId,
    ':sy' => $sy,
    ':pos' => $pos,
  ]);
  $r2 = $st2->fetch(PDO::FETCH_ASSOC);
  return $r2 ?: null;
}
function get_active_signature_file(PDO $pdo, int $userId): ?string {
  if ($userId <= 0) return null;

  try {
    $cols = [];
    $st = $pdo->query("SHOW COLUMNS FROM e_signatures");
    while ($r = $st->fetch(PDO::FETCH_ASSOC)) {
      $cols[strtolower((string)$r['Field'])] = true;
    }

    $sigCol = null;
    foreach (['signature_file', 'signature_path', 'file_path', 'path', 'file'] as $c) {
      if (isset($cols[strtolower($c)])) { $sigCol = $c; break; }
    }
    if (!$sigCol) return null;

    $order = "id DESC";
    if (isset($cols['updated_at'])) $order = "updated_at DESC, id DESC";
    else if (isset($cols['created_at'])) $order = "created_at DESC, id DESC";

    $q = $pdo->prepare("
      SELECT {$sigCol}
      FROM e_signatures
      WHERE user_id = :uid
        AND status = 'Active'
      ORDER BY {$order}
      LIMIT 1
    ");
    $q->execute([':uid' => $userId]);
    $f = $q->fetchColumn();

    $val = is_string($f) ? trim($f) : '';
    return $val !== '' ? $val : null;
  } catch (\Throwable $e) {
    return null;
  }
}

/* =========================
   Auth
   ========================= */
$viewerId = session_user_id();
if ($viewerId <= 0) {
  http_response_code(401);
  header('Content-Type: text/plain; charset=utf-8');
  echo 'Not authenticated.';
  exit;
}

/* =========================
   Input (term optional)
   ========================= */
$orgId  = isset($_GET['org_id']) ? (int)$_GET['org_id'] : 0;
if ($orgId <= 0 && isset($_GET['id'])) $orgId = (int)$_GET['id'];

$termId = isset($_GET['term_id']) ? (int)$_GET['term_id'] : 0;
if ($termId <= 0 && isset($_GET['academic_term_id'])) $termId = (int)$_GET['academic_term_id'];

if ($orgId <= 0) {
  http_response_code(400);
  header('Content-Type: text/plain; charset=utf-8');
  echo 'Missing or invalid org_id.';
  exit;
}

/* =========================
   term_id optional (SMART pick)
   ========================= */
if ($termId <= 0) {
  // 1) latest term that actually has membership receipts for this org
  $stLast = $pdo->prepare("
    SELECT m.academic_term_id
    FROM organization_membership_receipts r
    INNER JOIN organization_memberships m ON m.id = r.membership_id
    WHERE m.org_id = :org_id
      AND m.status = 'Approved'
    ORDER BY r.paid_at DESC, r.id DESC
    LIMIT 1
  ");
  $stLast->execute([':org_id' => $orgId]);
  $termId = (int)($stLast->fetchColumn() ?: 0);

  // 2) fallback to Active term
  if ($termId <= 0) {
    $stActive = $pdo->query("SELECT id FROM academic_terms WHERE status='Active' ORDER BY id DESC LIMIT 1");
    $termId = (int)($stActive ? $stActive->fetchColumn() : 0);
  }

  // 3) fallback to latest term by id
  if ($termId <= 0) {
    $stLatest = $pdo->query("SELECT id FROM academic_terms ORDER BY id DESC LIMIT 1");
    $termId = (int)($stLatest ? $stLatest->fetchColumn() : 0);
  }
}

if ($termId <= 0) {
  http_response_code(400);
  header('Content-Type: text/plain; charset=utf-8');
  echo 'Missing or invalid term_id, and no terms found to auto-select.';
  exit;
}

/* =========================
   Permission: must be ACTIVE officer for SAME SCHOOL YEAR (Option B)
   ========================= */
if (!is_officer_for_year($pdo, $viewerId, $orgId, $termId)) {
  http_response_code(403);
  header('Content-Type: text/plain; charset=utf-8');
  echo 'Forbidden.';
  exit;
}

/* =========================
   Fetch org + term
   ========================= */
$stOrg = $pdo->prepare("
  SELECT id, org_type, org_name, abbreviation, logo_path, membership_fee, fee_required, status
  FROM organizations
  WHERE id = :id
  LIMIT 1
");
$stOrg->execute([':id' => $orgId]);
$org = $stOrg->fetch(PDO::FETCH_ASSOC);
if (!$org) {
  http_response_code(404);
  header('Content-Type: text/plain; charset=utf-8');
  echo 'Organization not found.';
  exit;
}

$stTerm = $pdo->prepare("
  SELECT id, school_year, semester, status
  FROM academic_terms
  WHERE id = :id
  LIMIT 1
");
$stTerm->execute([':id' => $termId]);
$term = $stTerm->fetch(PDO::FETCH_ASSOC);
if (!$term) {
  http_response_code(404);
  header('Content-Type: text/plain; charset=utf-8');
  echo 'Academic term not found.';
  exit;
}

/* =========================
   Treasurer + Auditor + signatures (YEAR-based)
   ========================= */
$treasurer = get_officer($pdo, $orgId, $termId, 'treasurer');
$auditor   = get_officer($pdo, $orgId, $termId, 'auditor');

$treasurerName = $treasurer ? (string)($treasurer['full_name'] ?? '') : '';
$auditorName   = $auditor ? (string)($auditor['full_name'] ?? '') : '';

$treasurerSigHtml = '';
$auditorSigHtml = '';

if ($treasurer && !empty($treasurer['user_id'])) {
  $sig = get_active_signature_file($pdo, (int)$treasurer['user_id']);
  if ($sig) $treasurerSigHtml = img_tag_base64($sig, 'sig-img', 'Treasurer Signature');
}
if ($auditor && !empty($auditor['user_id'])) {
  $sig = get_active_signature_file($pdo, (int)$auditor['user_id']);
  if ($sig) $auditorSigHtml = img_tag_base64($sig, 'sig-img', 'Auditor Signature');
}

/* =========================
   Fetch paid list
   ========================= */
$stRows = $pdo->prepare("
  SELECT
    u.id_number,
    u.first_name, u.middle_name, u.last_name, u.suffix,
    m.id AS membership_id,
    r.id AS receipt_id,
    r.receipt_no,
    r.amount,
    r.paid_at
  FROM organization_memberships m
  INNER JOIN users u ON u.id = m.student_user_id
  INNER JOIN organization_membership_receipts r ON r.membership_id = m.id
  WHERE m.org_id = :org_id
    AND m.academic_term_id = :term_id
    AND m.status = 'Approved'
  ORDER BY r.paid_at DESC, r.id DESC
");
$stRows->execute([':org_id' => $orgId, ':term_id' => $termId]);
$rows = $stRows->fetchAll(PDO::FETCH_ASSOC) ?: [];

$totalAmt = 0.0;
foreach ($rows as $r) $totalAmt += (float)($r['amount'] ?? 0);

/* =========================
   Header values
   ========================= */
$orgName = (string)($org['org_name'] ?? '—');
$orgAbbr = (string)($org['abbreviation'] ?? '');
$orgType = (string)($org['org_type'] ?? '');
$termText = term_label((string)($term['school_year'] ?? ''), (string)($term['semester'] ?? ''));

$logoHtml = '';
$logoPath = (string)($org['logo_path'] ?? '');
if ($logoPath !== '') $logoHtml = img_tag_base64($logoPath, 'org-logo', 'Logo');

$generatedText = date('F j, Y');

/* =========================
   Build table rows
   ========================= */
$tableHtml = '';
if (count($rows) <= 0) {
  $tableHtml = '<tr><td colspan="5" class="muted" style="text-align:center; padding:14px;">No paid members found.</td></tr>';
} else {
  $i = 0;
  foreach ($rows as $r) {
    $i++;

    $name = format_full_name_row($r);
    $idno = (string)($r['id_number'] ?? '—');
    $rno  = (string)($r['receipt_no'] ?? '—');

    $amt = (float)($r['amount'] ?? 0);
    $amtStr = peso($amt);

    $paidAt = (string)($r['paid_at'] ?? '');
    $paidText = $paidAt !== '' ? $paidAt : '—';
    try {
      $dt = new DateTime($paidAt);
      $paidText = $dt->format('M j, Y');
    } catch (\Throwable $e) {}

    $tableHtml .= '
      <tr>
        <td class="td-n">' . h((string)$i) . '</td>
        <td class="td-id">' . h($idno) . '</td>
        <td class="td-name">' . h($name) . '</td>
        <td class="td-rno">' . h($rno) . '</td>
        <td class="td-amt">' . h($amtStr) . '<div class="muted small">' . h($paidText) . '</div></td>
      </tr>
    ';
  }
}

/* =========================
   HTML
   ========================= */
$orgNameEsc = h($orgName);
$orgAbbrEsc = h($orgAbbr);
$orgTypeEsc = h($orgType);
$termTextEsc = h($termText);
$generatedTextEsc = h($generatedText);
$totalAmtEsc = h(peso($totalAmt));

$treasurerNameEsc = h($treasurerName !== '' ? $treasurerName : '—');
$auditorNameEsc   = h($auditorName !== '' ? $auditorName : '—');

$html = <<<HTML
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Paid Members List</title>
  <style>
    @page { margin: 8mm; }
    body { font-family: Arial, sans-serif; font-size: 11px; color: #222; }
    .wrap { border: 1px solid #ccc; padding: 10px 12px; }

    .header { width: 100%; border-collapse: collapse; margin-bottom: 8px; }
    .header td { vertical-align: top; padding: 0; }
    .h-left { width: 70%; }
    .h-right { width: 30%; text-align: right; }

    .orgbox { width: 100%; border-collapse: collapse; }
    .orgbox td { padding: 0; vertical-align: top; }
    .org-logo { max-width: 46px; max-height: 46px; object-fit: contain; display:block; }
    .orgname { font-size: 13px; font-weight: 700; margin: 0; }
    .orgmeta { font-size: 10px; color: #666; margin-top: 2px; line-height: 1.3; }

    .title { font-size: 13px; font-weight: 700; margin: 0; }
    .meta { font-size: 10px; color: #555; margin-top: 3px; line-height: 1.3; }

    table.list { width: 100%; border-collapse: collapse; margin-top: 10px; }
    table.list th, table.list td { border: 1px solid #ddd; padding: 6px 6px; }
    table.list th { background: #f3f3f3; font-weight: 700; text-align: left; }
    .td-n { width: 28px; text-align: center; }
    .td-id { width: 110px; font-weight: 600; }
    .td-name { width: auto; }
    .td-rno { width: 210px; font-family: "Courier New", monospace; font-size: 10px; }
    .td-amt { width: 110px; text-align: right; font-weight: 700; }

    .muted { color: #777; }
    .small { font-size: 10px; font-weight: 400; margin-top: 2px; }

    .totals { margin-top: 10px; border-top: 1px dashed #ccc; padding-top: 8px; display: table; width: 100%; }
    .totals .l { display: table-cell; font-weight: 700; }
    .totals .r { display: table-cell; text-align: right; font-weight: 800; font-size: 12px; }

    .sign-table { width: 100%; margin-top: 16px; border-collapse: collapse; }
    .sign-table td { width: 50%; text-align: center; vertical-align: bottom; padding-top: 6px; }
    .sig-img { max-width: 160px; max-height: 45px; display: block; margin: 0 auto 4px auto; object-fit: contain; }
    .sign-line { width: 180px; margin: 0 auto 4px auto; font-family: "Courier New", monospace; letter-spacing: 1px; }
    .sign-name { font-size: 11px; font-weight: 700; }
    .sign-label { font-size: 11px; }

    .footer-note { margin-top: 8px; font-size: 10px; color: #666; text-align: center; }
  </style>
</head>
<body>
  <div class="wrap">
    <table class="header">
      <tr>
        <td class="h-left">
          <table class="orgbox">
            <tr>
              <td style="width:54px;">{$logoHtml}</td>
              <td style="padding-left:6px;">
                <div class="orgname">{$orgNameEsc}</div>
                <div class="orgmeta">
                  {$orgTypeEsc} {$orgAbbrEsc}<br/>
                  {$termTextEsc}
                </div>
              </td>
            </tr>
          </table>
        </td>
        <td class="h-right">
          <div class="title">PAID MEMBERS LIST</div>
          <div class="meta">
            Generated: {$generatedTextEsc}<br/>
            Org ID: {$orgId} • Term ID: {$termId}
          </div>
        </td>
      </tr>
    </table>

    <table class="list">
      <thead>
        <tr>
          <th style="text-align:center;">#</th>
          <th>Student ID</th>
          <th>Student Name</th>
          <th>Receipt No.</th>
          <th style="text-align:right;">Amount / Date</th>
        </tr>
      </thead>
      <tbody>
        {$tableHtml}
      </tbody>
    </table>

    <div class="totals">
      <div class="l">Total Paid</div>
      <div class="r">{$totalAmtEsc}</div>
    </div>

    <table class="sign-table">
      <tr>
        <td>
          {$treasurerSigHtml}
          <div class="sign-line">____________________________</div>
          <div class="sign-name">{$treasurerNameEsc}</div>
          <div class="sign-label">Treasurer</div>
        </td>
        <td>
          {$auditorSigHtml}
          <div class="sign-line">____________________________</div>
          <div class="sign-name">{$auditorNameEsc}</div>
          <div class="sign-label">Auditor</div>
        </td>
      </tr>
    </table>

    <div class="footer-note">This list is generated from the official portal.</div>
  </div>
</body>
</html>
HTML;

/* =========================
   Render PDF safely
   ========================= */
try {
  while (ob_get_level() > 0) { @ob_end_clean(); }

  $tmpDir = __DIR__ . '/../tmp';
  if (!is_dir($tmpDir)) @mkdir($tmpDir, 0775, true);
  if (!is_dir($tmpDir) || !is_writable($tmpDir)) $tmpDir = sys_get_temp_dir();

  header('Content-Type: application/pdf');

  $mpdf = new Mpdf([
    'format'        => 'A4',
    'margin_top'    => 8,
    'margin_right'  => 8,
    'margin_bottom' => 8,
    'margin_left'   => 8,
    'tempDir'       => $tmpDir,
  ]);

  $mpdf->WriteHTML($html);

  $dlName = 'PaidMembers_' . preg_replace('/[^0-9A-Za-z_-]+/', '_', (string)$orgName) . "_T{$termId}.pdf";
  $mpdf->Output($dlName, 'I');
  exit;
} catch (\Throwable $e) {
  http_response_code(500);
  header('Content-Type: text/plain; charset=utf-8');
  echo "PDF generation failed.\n\n" . $e->getMessage();
  exit;
}