<?php
// php/print-organization-fee-receipt.php
// Organization Fee Receipt (PDF)
//
// Accepts:
//  - ?receipt_id=123
//  - ?receipt_no=...
//  - ?payment_id=123 (auto-creates receipt row if missing)
//
// FIXES:
// - Officers are YEAR-based (Option B): fallback from term_id -> same school_year
// - Signature lookup is schema-resilient (signature_file/signature_path/path/etc.)

declare(strict_types=1);

// DO NOT output PHP errors into PDF response
ini_set('display_errors', '0');
ini_set('log_errors', '1');
error_reporting(E_ALL);

session_start();

/* =========================
   DB (PDO)
   ========================= */
require_once __DIR__ . '/db.php';

$autoload = __DIR__ . '/../vendor/autoload.php';
if (!is_file($autoload)) {
  http_response_code(500);
  header('Content-Type: text/plain; charset=utf-8');
  echo "Missing vendor/autoload.php. Run: composer install\nExpected path: " . $autoload;
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
function format_full_name(array $uRow): string {
  $fn = (string)($uRow['first_name'] ?? '');
  $mn = (string)($uRow['middle_name'] ?? '');
  $ln = (string)($uRow['last_name'] ?? '');
  $sx = (string)($uRow['suffix'] ?? '');

  $full = trim(
    $fn . ' ' .
    ($mn !== '' ? mb_substr($mn, 0, 1) . '. ' : '') .
    $ln . ' ' . $sx
  );
  return $full !== '' ? $full : '—';
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

/* =========================
   YEAR helpers (Option B)
   ========================= */
function school_year_for_term(PDO $pdo, int $termId): string {
  if ($termId <= 0) return '';
  $st = $pdo->prepare("SELECT school_year FROM academic_terms WHERE id = :id LIMIT 1");
  $st->execute([':id' => $termId]);
  $r = $st->fetch(PDO::FETCH_ASSOC);
  return trim((string)($r['school_year'] ?? ''));
}

/**
 * Officer lookup (Option B): exact term first, then same school_year fallback.
 */
function get_officer(PDO $pdo, int $orgId, int $termId, string $roleLike): ?array {
  $pos = '%' . mb_strtolower($roleLike) . '%';

  // 1) exact term match
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

  // 2) school_year fallback
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
      oo.position,
      t.school_year,
      oo.academic_term_id
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

/**
 * Signature lookup (resilient to column names).
 */
function get_active_signature_file(PDO $pdo, int $userId): ?string {
  if ($userId <= 0) return null;

  try {
    $cols = [];
    $st = $pdo->query("SHOW COLUMNS FROM e_signatures");
    while ($r = $st->fetch(PDO::FETCH_ASSOC)) {
      $cols[strtolower((string)$r['Field'])] = true;
    }

    $pickFirst = function(array $candidates) use ($cols): ?string {
      foreach ($candidates as $c) {
        if (isset($cols[strtolower($c)])) return $c;
      }
      return null;
    };

    $sigCol = $pickFirst(['signature_file', 'signature_path', 'file_path', 'path', 'file']);
    if (!$sigCol) return null;

    $hasUpdated = isset($cols['updated_at']);
    $hasCreated = isset($cols['created_at']);

    $order = "id DESC";
    if ($hasUpdated) $order = "updated_at DESC, id DESC";
    else if ($hasCreated) $order = "created_at DESC, id DESC";

    $sql = "
      SELECT {$sigCol}
      FROM e_signatures
      WHERE user_id = :uid
        AND status = 'Active'
      ORDER BY {$order}
      LIMIT 1
    ";
    $q = $pdo->prepare($sql);
    $q->execute([':uid' => $userId]);
    $f = $q->fetchColumn();

    $val = is_string($f) ? trim($f) : '';
    return $val !== '' ? $val : null;

  } catch (\Throwable $e) {
    return null;
  }
}

/* =========================
   Auth guard
   ========================= */
$viewerId = session_user_id();
if ($viewerId <= 0) {
  http_response_code(401);
  header('Content-Type: text/plain; charset=utf-8');
  echo 'Not authenticated.';
  exit;
}

/* =========================
   Input
   ========================= */
$receiptId = isset($_GET['receipt_id']) ? (int)$_GET['receipt_id'] : 0;
if ($receiptId <= 0 && isset($_GET['id'])) $receiptId = (int)$_GET['id'];

$receiptNoParam = isset($_GET['receipt_no']) ? trim((string)$_GET['receipt_no']) : '';
$paymentId = isset($_GET['payment_id']) ? (int)$_GET['payment_id'] : 0;

$debug = isset($_GET['debug']) && (string)$_GET['debug'] === '1';

if ($receiptId <= 0 && $receiptNoParam === '' && $paymentId <= 0) {
  http_response_code(400);
  header('Content-Type: text/plain; charset=utf-8');
  echo 'Missing receipt_id / id / receipt_no / payment_id.';
  exit;
}

/* =========================
   Ensure receipt row exists if payment_id is used
   ========================= */
try {
  if ($paymentId > 0) {
    $chk = $pdo->prepare("SELECT id FROM organization_fee_receipts WHERE payment_id = :pid LIMIT 1");
    $chk->execute([':pid' => $paymentId]);
    $existingReceiptId = (int)($chk->fetchColumn() ?: 0);

    if ($existingReceiptId <= 0) {
      $p = $pdo->prepare("
        SELECT id, receipt_no, amount, paid_at, paid_by_user_id
        FROM organization_fee_payments
        WHERE id = :pid
        LIMIT 1
      ");
      $p->execute([':pid' => $paymentId]);
      $pay = $p->fetch(PDO::FETCH_ASSOC);

      if (!$pay) {
        http_response_code(404);
        header('Content-Type: text/plain; charset=utf-8');
        echo 'Payment record not found.';
        exit;
      }

      $ins = $pdo->prepare("
        INSERT INTO organization_fee_receipts
          (payment_id, receipt_no, amount, paid_at, paid_by_user_id)
        VALUES
          (:pid, :rno, :amt, :paid_at, :paid_by)
      ");
      $ins->execute([
        ':pid' => (int)$pay['id'],
        ':rno' => (string)$pay['receipt_no'],
        ':amt' => (string)$pay['amount'],
        ':paid_at' => (string)$pay['paid_at'],
        ':paid_by' => (int)$pay['paid_by_user_id'],
      ]);

      $existingReceiptId = (int)$pdo->lastInsertId();
    }

    if ($receiptId <= 0 && $receiptNoParam === '') {
      $receiptId = $existingReceiptId;
    }
  }
} catch (\Throwable $e) {
  http_response_code(500);
  header('Content-Type: text/plain; charset=utf-8');
  if ($debug) echo "Failed ensuring receipt row:\n" . $e->getMessage();
  else echo "Server error.";
  exit;
}

/* =========================
   Fetch receipt + payment + org + term + student
   ========================= */
$sql = "
  SELECT
    r.id AS receipt_id,
    r.receipt_no,
    r.amount,
    r.paid_at,
    r.paid_by_user_id,
    r.created_at AS receipt_created_at,

    p.id AS payment_id,
    p.org_id,
    p.student_user_id,
    p.academic_term_id,

    o.org_name,
    o.abbreviation,
    o.logo_path,

    t.school_year,
    t.semester,

    u.id_number AS student_id_number,
    u.first_name AS student_first_name,
    u.middle_name AS student_middle_name,
    u.last_name AS student_last_name,
    u.suffix AS student_suffix
  FROM organization_fee_receipts r
  INNER JOIN organization_fee_payments p ON p.id = r.payment_id
  INNER JOIN organizations o ON o.id = p.org_id
  INNER JOIN academic_terms t ON t.id = p.academic_term_id
  LEFT JOIN users u ON u.id = p.student_user_id
  WHERE 1=1
";

$params = [];
if ($receiptId > 0) {
  $sql .= " AND r.id = :rid";
  $params[':rid'] = $receiptId;
} else {
  $sql .= " AND r.receipt_no = :rno";
  $params[':rno'] = $receiptNoParam;
}

try {
  $st = $pdo->prepare($sql);
  $st->execute($params);
  $row = $st->fetch(PDO::FETCH_ASSOC);
} catch (\Throwable $e) {
  http_response_code(500);
  header('Content-Type: text/plain; charset=utf-8');
  if ($debug) echo "Query failed:\n" . $e->getMessage();
  else echo "Server error.";
  exit;
}

if (!$row) {
  http_response_code(404);
  header('Content-Type: text/plain; charset=utf-8');
  echo 'Receipt record not found.';
  exit;
}

$orgId  = (int)$row['org_id'];
$termId = (int)$row['academic_term_id'];

/* =========================
   Treasurer + Auditor (YEAR-based) + signatures
   ========================= */
$treasurer = get_officer($pdo, $orgId, $termId, 'treasurer');
$auditor   = get_officer($pdo, $orgId, $termId, 'auditor');

$treasurerName = $treasurer ? (string)($treasurer['full_name'] ?? '') : '';
$auditorName   = $auditor ? (string)($auditor['full_name'] ?? '') : '';

$treasurerSigHtml = '';
$auditorSigHtml   = '';

if ($treasurer && !empty($treasurer['user_id'])) {
  $sig = get_active_signature_file($pdo, (int)$treasurer['user_id']);
  if ($sig) $treasurerSigHtml = img_tag_base64($sig, 'sig-img', 'Treasurer Signature');
}
if ($auditor && !empty($auditor['user_id'])) {
  $sig = get_active_signature_file($pdo, (int)$auditor['user_id']);
  if ($sig) $auditorSigHtml = img_tag_base64($sig, 'sig-img', 'Auditor Signature');
}

/* =========================
   Map / format
   ========================= */
$orgName     = (string)($row['org_name'] ?? 'Organization');
$orgAbbr     = (string)($row['abbreviation'] ?? '');
$orgLogoPath = (string)($row['logo_path'] ?? '');

$receiptNo = (string)($row['receipt_no'] ?? '—');
$amount    = (float)($row['amount'] ?? 0);
$amountStr = peso($amount);

$paidAtRaw = (string)($row['paid_at'] ?? '');
$paidOnText = $paidAtRaw !== '' ? $paidAtRaw : date('Y-m-d');
try {
  $dt = new DateTime($paidOnText);
  $paidOnText = $dt->format('F j, Y');
} catch (\Throwable $e) {}

$termText = term_label((string)($row['school_year'] ?? ''), (string)($row['semester'] ?? ''));

$student = [
  'first_name' => $row['student_first_name'] ?? '',
  'middle_name' => $row['student_middle_name'] ?? '',
  'last_name' => $row['student_last_name'] ?? '',
  'suffix' => $row['student_suffix'] ?? '',
];
$studentName = format_full_name($student);
$studentIdNo = (string)($row['student_id_number'] ?? '—');

$generatedText = date('F j, Y');

$orgLogoHtml = $orgLogoPath !== '' ? img_tag_base64($orgLogoPath, 'org-logo', 'Logo') : '';

/* =========================
   Escape
   ========================= */
$orgNameEsc       = h($orgName);
$orgAbbrEsc       = h($orgAbbr);
$termTextEsc      = h($termText);
$receiptNoEsc     = h($receiptNo);
$studentNameEsc   = h($studentName);
$studentIdNoEsc   = h($studentIdNo);
$paidOnTextEsc    = h($paidOnText);
$amountStrEsc     = h($amountStr);
$generatedTextEsc = h($generatedText);

$treasurerNameEsc = h($treasurerName !== '' ? $treasurerName : '—');
$auditorNameEsc   = h($auditorName !== '' ? $auditorName : '—');

/* =========================
   HTML
   ========================= */
$html = <<<HTML
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Receipt #{$receiptNoEsc}</title>
  <style>
    @page { margin: 5mm; }
    * { box-sizing: border-box; }
    body { font-family: Arial, sans-serif; margin: 0; font-size: 13px; color: #222; }
    .receipt-wrapper { width: 100%; border: 1px solid #ccc; padding: 12px 16px; }

    .header-table { width: 100%; border-collapse: collapse; margin-bottom: 10px; border-bottom: 1px solid #ddd; padding-bottom: 6px; }
    .header-table td { vertical-align: top; padding: 0; }
    .header-left { width: 65%; }
    .header-right { width: 35%; text-align: right; }

    .header-org-table { width: 100%; border-collapse: collapse; }
    .header-org-table td { vertical-align: top; padding: 0; }
    .logo-cell { width: 50px; text-align: left; }
    .org-logo { max-width: 45px; max-height: 45px; object-fit: contain; display: block; }
    .org-text-cell { padding-left: 6px; }
    .org-name { font-size: 14px; font-weight: 600; margin: 0; }
    .org-sub { font-size: 10px; color: #666; margin-top: 2px; margin-bottom: 0; line-height: 1.3; }

    .receipt-title { font-size: 14px; font-weight: 600; margin: 0; }
    .receipt-meta { font-size: 10px; color: #555; margin-top: 3px; line-height: 1.3; }

    .meta-table { width: 100%; border-collapse: collapse; margin-top: 8px; margin-bottom: 6px; }
    .meta-table td { padding: 2px 0; vertical-align: top; font-size: 11px; }
    .meta-label { width: 120px; font-weight: 600; }

    .amount-box { margin-top: 10px; border-top: 1px dashed #ccc; padding-top: 8px; display: table; width: 100%; }
    .amount-label { font-size: 12px; font-weight: 600; display: table-cell; vertical-align: middle; }
    .amount-value { font-size: 15px; font-weight: 700; display: table-cell; text-align: right; vertical-align: middle; }

    .sign-table { width: 100%; margin-top: 18px; border-collapse: collapse; }
    .sign-table td { text-align: center; vertical-align: bottom; padding-top: 6px; width: 50%; }
    .sig-img { max-width: 160px; max-height: 45px; display: block; margin: 0 auto 4px auto; object-fit: contain; }
    .sign-line { width: 160px; margin: 0 auto 4px auto; font-size: 13px; letter-spacing: 1px; font-family: "Courier New", monospace; }
    .sign-name { font-size: 11px; font-weight: 600; margin-top: 2px; }
    .sign-label { font-size: 11px; }

    .footer-note { margin-top: 10px; font-size: 10px; color: #666; text-align: center; }
  </style>
</head>
<body>
  <div class="receipt-wrapper">
    <table class="header-table">
      <tr>
        <td class="header-left">
          <table class="header-org-table">
            <tr>
              <td class="logo-cell">{$orgLogoHtml}</td>
              <td class="org-text-cell">
                <p class="org-name">{$orgNameEsc}</p>
                <p class="org-sub">{$orgAbbrEsc}<br/>{$termTextEsc}</p>
              </td>
            </tr>
          </table>
        </td>
        <td class="header-right">
          <div class="receipt-title">OFFICIAL RECEIPT</div>
          <div class="receipt-meta">
            No.: {$receiptNoEsc}<br/>
            Generated: {$generatedTextEsc}
          </div>
        </td>
      </tr>
    </table>

    <table class="meta-table">
      <tr><td class="meta-label">Student Name:</td><td>{$studentNameEsc}</td></tr>
      <tr><td class="meta-label">Student ID:</td><td>{$studentIdNoEsc}</td></tr>
      <tr><td class="meta-label">Receipt For:</td><td>Organization Fee</td></tr>
      <tr><td class="meta-label">Academic Term:</td><td>{$termTextEsc}</td></tr>
      <tr><td class="meta-label">Date Paid:</td><td>{$paidOnTextEsc}</td></tr>
      <tr><td class="meta-label">Status:</td><td>Paid</td></tr>
    </table>

    <div class="amount-box">
      <div class="amount-label">Amount Paid</div>
      <div class="amount-value">{$amountStrEsc}</div>
    </div>

    <table class="sign-table">
      <tr>
        <td>
          {$treasurerSigHtml}
          <div class="sign-line">__________________________</div>
          <div class="sign-name">{$treasurerNameEsc}</div>
          <div class="sign-label">Treasurer</div>
        </td>
        <td>
          {$auditorSigHtml}
          <div class="sign-line">__________________________</div>
          <div class="sign-name">{$auditorNameEsc}</div>
          <div class="sign-label">Auditor</div>
        </td>
      </tr>
    </table>

    <div class="footer-note">This receipt is generated from the official portal.</div>
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

  $mpdf = new Mpdf([
    'format'        => [140, 110],
    'margin_top'    => 5,
    'margin_right'  => 5,
    'margin_bottom' => 5,
    'margin_left'   => 5,
    'margin_header' => 0,
    'margin_footer' => 0,
    'tempDir'       => $tmpDir,
  ]);

  $mpdf->WriteHTML($html);

  $downloadName = 'OrgFeeReceipt_' . preg_replace('/[^0-9A-Za-z_-]+/', '_', $receiptNo) . '.pdf';
  $mpdf->Output($downloadName, 'I');
  exit;

} catch (\Throwable $e) {
  http_response_code(500);
  header('Content-Type: text/plain; charset=utf-8');
  if ($debug) echo "PDF generation failed:\n\n" . $e->getMessage();
  else echo "Server error.";
  exit;
}