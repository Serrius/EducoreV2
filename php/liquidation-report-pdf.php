<?php
declare(strict_types=1);

ini_set('display_errors', '0');
ini_set('log_errors', '1');
error_reporting(E_ALL);

session_start();
require_once __DIR__ . '/_mpdf_common.php'; // provides $pdo + ee_mpdf() + ee_fetch_event() + ee_get_officer() etc.

/** @var PDO $pdo */

ee_require_login();

$eventId = (int)($_GET['event_id'] ?? 0);
if ($eventId <= 0) { http_response_code(400); header('Content-Type:text/plain; charset=utf-8'); echo 'Missing event_id.'; exit; }

$event = ee_fetch_event($pdo, $eventId);
if (!$event) { http_response_code(404); header('Content-Type:text/plain; charset=utf-8'); echo 'Event not found.'; exit; }

if (!ee_can_view_event($pdo, $event)) { http_response_code(403); header('Content-Type:text/plain; charset=utf-8'); echo 'Forbidden.'; exit; }

// Only allow printing liquidation when accomplishment is approved
if ((string)($event['accomplishment_status'] ?? '') !== 'Approved') {
  http_response_code(403);
  header('Content-Type:text/plain; charset=utf-8');
  echo 'Locked: accomplishment not approved.';
  exit;
}

/* =========================
   Local helpers
   ========================= */
function h2($s): string { return htmlspecialchars((string)($s ?? ''), ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8'); }

function img_tag_base64_local(string $relativePath, string $className = '', string $alt = ''): string {
  $p = trim($relativePath);
  if ($p === '' || preg_match('~^https?://~i', $p)) return '';

  $p = str_replace('\\', '/', $p);
  $fsPath = realpath(__DIR__ . '/../' . ltrim($p, '/'));
  if (!$fsPath || !is_file($fsPath)) return '';

  $ext = strtolower(pathinfo($fsPath, PATHINFO_EXTENSION));
  if ($ext === 'jpg') $ext = 'jpeg';
  if (!in_array($ext, ['png','jpeg','gif','webp'], true)) return '';

  $mime = 'image/' . $ext;
  $data = base64_encode((string)file_get_contents($fsPath));

  $cls = $className !== '' ? ' class="' . h2($className) . '"' : '';
  $altEsc = h2($alt);

  return '<img src="data:' . $mime . ';base64,' . $data . '"' . $cls . ' alt="' . $altEsc . '">';
}

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

function current_active_super_admin(PDO $pdo): ?array {
  try {
    $cols = [];
    $st = $pdo->query("SHOW COLUMNS FROM users");
    while ($r = $st->fetch(PDO::FETCH_ASSOC)) {
      $cols[strtolower((string)$r['Field'])] = true;
    }
    $hasLastLogin = isset($cols['last_login_at']);

    $order = $hasLastLogin
      ? "CASE WHEN last_login_at IS NULL THEN 1 ELSE 0 END ASC, last_login_at DESC, id DESC"
      : "id DESC";

    $sql = "
      SELECT id, first_name, middle_name, last_name, suffix
      FROM users
      WHERE role='super_admin' AND status='Active'
      ORDER BY {$order}
      LIMIT 1
    ";
    $q = $pdo->query($sql);
    $row = $q ? $q->fetch(PDO::FETCH_ASSOC) : null;
    if (!$row) return null;

    $id = (int)($row['id'] ?? 0);
    if ($id <= 0) return null;

    $fn = trim((string)($row['first_name'] ?? ''));
    $mn = trim((string)($row['middle_name'] ?? ''));
    $ln = trim((string)($row['last_name'] ?? ''));
    $sx = trim((string)($row['suffix'] ?? ''));

    $name = trim($fn . ' ' . ($mn !== '' ? mb_substr($mn, 0, 1) . '. ' : '') . $ln . ($sx !== '' ? ' ' . $sx : ''));
    if ($name === '') $name = '—';

    return ['id' => $id, 'name' => $name];
  } catch (\Throwable $e) {
    return null;
  }
}

/* =========================
   President lookup that WON'T match Vice President
   ========================= */
function school_year_for_term(PDO $pdo, int $termId): string {
  if ($termId <= 0) return '';
  $st = $pdo->prepare("SELECT school_year FROM academic_terms WHERE id = :id LIMIT 1");
  $st->execute([':id' => $termId]);
  $r = $st->fetch(PDO::FETCH_ASSOC);
  return trim((string)($r['school_year'] ?? ''));
}

function get_org_president(PDO $pdo, int $orgId, int $termId): ?array {
  if ($orgId <= 0 || $termId <= 0) return null;

  // strict: exclude vice; prefer starts-with president / exact common variants
  $sql1 = "
    SELECT
      oo.user_id,
      COALESCE(NULLIF(oo.full_name, ''), CONCAT_WS(' ',
        NULLIF(u.first_name, ''),
        CASE WHEN u.middle_name IS NULL OR u.middle_name = '' THEN NULL ELSE CONCAT(LEFT(u.middle_name, 1), '.') END,
        NULLIF(u.last_name, ''),
        NULLIF(u.suffix, '')
      )) AS full_name,
      oo.position,
      oo.academic_term_id
    FROM organization_officers oo
    LEFT JOIN users u ON u.id = oo.user_id
    WHERE oo.org_id = :org_id
      AND oo.academic_term_id = :term_id
      AND oo.status = 'Active'
      AND LOWER(oo.position) NOT LIKE '%vice%'
      AND (
        LOWER(TRIM(oo.position)) = 'president'
        OR LOWER(TRIM(oo.position)) = 'organization president'
        OR LOWER(TRIM(oo.position)) = 'org president'
        OR LOWER(oo.position) LIKE 'president%'
      )
    ORDER BY oo.id DESC
    LIMIT 1
  ";
  $st = $pdo->prepare($sql1);
  $st->execute([':org_id' => $orgId, ':term_id' => $termId]);
  $r = $st->fetch(PDO::FETCH_ASSOC);
  if ($r) return $r;

  // fallback: still exclude vice, but allow contains 'president' if naming is weird
  $sql1b = "
    SELECT
      oo.user_id,
      COALESCE(NULLIF(oo.full_name, ''), CONCAT_WS(' ',
        NULLIF(u.first_name, ''),
        CASE WHEN u.middle_name IS NULL OR u.middle_name = '' THEN NULL ELSE CONCAT(LEFT(u.middle_name, 1), '.') END,
        NULLIF(u.last_name, ''),
        NULLIF(u.suffix, '')
      )) AS full_name,
      oo.position,
      oo.academic_term_id
    FROM organization_officers oo
    LEFT JOIN users u ON u.id = oo.user_id
    WHERE oo.org_id = :org_id
      AND oo.academic_term_id = :term_id
      AND oo.status = 'Active'
      AND LOWER(oo.position) LIKE '%president%'
      AND LOWER(oo.position) NOT LIKE '%vice%'
    ORDER BY oo.id DESC
    LIMIT 1
  ";
  $st = $pdo->prepare($sql1b);
  $st->execute([':org_id' => $orgId, ':term_id' => $termId]);
  $r = $st->fetch(PDO::FETCH_ASSOC);
  if ($r) return $r;

  // school_year fallback (Option B)
  $sy = school_year_for_term($pdo, $termId);
  if ($sy === '') return null;

  $sql2 = "
    SELECT
      oo.user_id,
      COALESCE(NULLIF(oo.full_name, ''), CONCAT_WS(' ',
        NULLIF(u.first_name, ''),
        CASE WHEN u.middle_name IS NULL OR u.middle_name = '' THEN NULL ELSE CONCAT(LEFT(u.middle_name, 1), '.') END,
        NULLIF(u.last_name, ''),
        NULLIF(u.suffix, '')
      )) AS full_name,
      oo.position,
      oo.academic_term_id
    FROM organization_officers oo
    INNER JOIN academic_terms t ON t.id = oo.academic_term_id
    LEFT JOIN users u ON u.id = oo.user_id
    WHERE oo.org_id = :org_id
      AND oo.status = 'Active'
      AND t.school_year = :sy
      AND LOWER(oo.position) NOT LIKE '%vice%'
      AND (
        LOWER(TRIM(oo.position)) = 'president'
        OR LOWER(TRIM(oo.position)) = 'organization president'
        OR LOWER(TRIM(oo.position)) = 'org president'
        OR LOWER(oo.position) LIKE 'president%'
        OR (LOWER(oo.position) LIKE '%president%' AND LOWER(oo.position) NOT LIKE '%vice%')
      )
    ORDER BY oo.academic_term_id DESC, oo.id DESC
    LIMIT 1
  ";
  $st = $pdo->prepare($sql2);
  $st->execute([':org_id' => $orgId, ':sy' => $sy]);
  $r = $st->fetch(PDO::FETCH_ASSOC);
  return $r ?: null;
}

/* =========================
   Fetch data
   ========================= */
$debits = ee_fetch_debits($pdo, $eventId);
$credits = ee_fetch_credits($pdo, $eventId);
$ledger = ee_fetch_ledger($pdo, $eventId); // This is the passbook log
$tot    = ee_totals($pdo, $eventId);

$orgId  = (int)($event['org_id'] ?? 0);
$termId = ee_event_term_id($pdo, $event);

$schoolYear = (string)($event['start_year'] . '-' . $event['end_year']);
$semester   = ee_semester_label_from_active_year((int)$event['active_year']);

$title   = trim((string)($event['title'] ?? ''));
$orgName = trim((string)($event['org_label'] ?? ($event['org_name'] ?? '')));
$venue   = trim((string)($event['location'] ?? ''));

// Get proposed expenses if any
$proposedItems = [];
$proposedTotal = 0.00;
try {
  $stCheck = $pdo->query("SHOW TABLES LIKE 'event_proposed_expenses'");
  if ($stCheck && $stCheck->rowCount() > 0) {
    $st = $pdo->prepare("
      SELECT description, quantity, estimated_cost, (quantity * estimated_cost) AS total
      FROM event_proposed_expenses
      WHERE event_id = :eid
      ORDER BY id ASC
    ");
    $st->execute([':eid' => $eventId]);
    $proposedItems = $st->fetchAll(PDO::FETCH_ASSOC) ?: [];
    
    $stTotal = $pdo->prepare("
      SELECT COALESCE(SUM(quantity * estimated_cost), 0) AS total
      FROM event_proposed_expenses
      WHERE event_id = :eid
    ");
    $stTotal->execute([':eid' => $eventId]);
    $proposedTotal = (float)($stTotal->fetchColumn() ?: 0);
  }
} catch (\Throwable $e) {
  // Table might not exist yet, ignore
}

// sample style date
$dateStr = date('Y-m-d');

/* =========================
   Signers
   Prepared by: Treasurer
   Checked by: Org President (STRICT: not VP)
   Approved by: Super Admin (Student Affairs Office)
   ========================= */
$treasurer = ($orgId > 0 && $termId > 0) ? ee_get_officer($pdo, $orgId, $termId, 'treasurer') : null;
$president = ($orgId > 0 && $termId > 0) ? get_org_president($pdo, $orgId, $termId) : null;

$treasurerName = $treasurer ? trim((string)($treasurer['full_name'] ?? '')) : '';
$presidentName = $president ? trim((string)($president['full_name'] ?? '')) : '';

$treasurerSigHtml = '';
$presidentSigHtml = '';

if ($treasurer && !empty($treasurer['user_id'])) {
  $sig = get_active_signature_file($pdo, (int)$treasurer['user_id']);
  if ($sig) $treasurerSigHtml = img_tag_base64_local($sig, 'sig-img', 'Treasurer Signature');
}
if ($president && !empty($president['user_id'])) {
  $sig = get_active_signature_file($pdo, (int)$president['user_id']);
  if ($sig) $presidentSigHtml = img_tag_base64_local($sig, 'sig-img', 'President Signature');
}

$sa = current_active_super_admin($pdo);
$superAdminName = $sa ? (string)$sa['name'] : '—';
$superAdminSigHtml = '';
if ($sa && !empty($sa['id'])) {
  $sig = get_active_signature_file($pdo, (int)$sa['id']);
  if ($sig) $superAdminSigHtml = img_tag_base64_local($sig, 'sig-img', 'Super Admin Signature');
}

/* =========================
   Render PDF (letterhead ON)
   ========================= */
try {
  while (ob_get_level() > 0) { @ob_end_clean(); }

  $mpdf = ee_mpdf(true);
  $mpdf->SetTitle('Liquidation Report');

  $peso = function(float $n): string {
    return '₱' . number_format($n, 2, '.', ',');
  };

  $funds    = (float)($tot['credits'] ?? 0);
  $expenses = (float)($tot['debits'] ?? 0);
  $balance  = (float)($tot['balance'] ?? 0);

  // Build expense rows
  $expenseRowsHtml = '';
  if (!$debits) {
    $expenseRowsHtml .= '<tr><td colspan="8" class="center muted">No expenses recorded.</td></tr>';
  } else {
    $i = 1;
    foreach ($debits as $d) {
      $dt   = h2((string)($d['debit_date'] ?? ''));
      $cat  = h2((string)($d['category'] ?? ''));
      $desc = trim((string)($d['notes'] ?? ''));
      $desc = $desc !== '' ? h2($desc) : '—';

      $qty = (int)($d['quantity'] ?? 1);
      if ($qty <= 0) $qty = 1;

      $unit = (float)($d['unit_price'] ?? 0);
      $amt  = (float)($d['amount'] ?? 0);

      $orNo = trim((string)($d['receipt_number'] ?? ''));
      $orNo = $orNo !== '' ? h2($orNo) : '—';

      $expenseRowsHtml .= '<tr>';
      $expenseRowsHtml .= '<td class="center">' . $i . '</td>';
      $expenseRowsHtml .= '<td class="nowrap">' . $dt . '</td>';
      $expenseRowsHtml .= '<td>' . $cat . '</td>';
      $expenseRowsHtml .= '<td>' . $desc . '</td>';
      $expenseRowsHtml .= '<td class="center">' . $qty . '</td>';
      $expenseRowsHtml .= '<td class="money">' . ($unit > 0 ? h2($peso($unit)) : '—') . '</td>';
      $expenseRowsHtml .= '<td class="money">' . h2($peso($amt)) . '</td>';
      $expenseRowsHtml .= '<td>' . $orNo . '</td>';
      $expenseRowsHtml .= '</tr>';
      $i++;
    }
  }

  // Build proposed vs actual comparison
  $proposedVsActualRows = '';
  $proposedVsActualRows .= '<tr>';
  $proposedVsActualRows .= '<td class="label-cell">Total Proposed Budget</td>';
  $proposedVsActualRows .= '<td class="money">' . h2($peso($proposedTotal)) . '</td>';
  $proposedVsActualRows .= '</tr>';
  $proposedVsActualRows .= '<tr>';
  $proposedVsActualRows .= '<td class="label-cell">Total Actual Expenses</td>';
  $proposedVsActualRows .= '<td class="money">' . h2($peso($expenses)) . '</td>';
  $proposedVsActualRows .= '</tr>';
  $proposedVsActualRows .= '<tr class="highlight">';
  $proposedVsActualRows .= '<td class="label-cell fw-bold">Variance (Proposed - Actual)</td>';
  $proposedVsActualRows .= '<td class="money fw-bold">' . h2($peso($proposedTotal - $expenses)) . '</td>';
  $proposedVsActualRows .= '</tr>';

  // Build passbook/ledger rows with CORRECT running balance (ignore DB values)
  $passbookRowsHtml = '';
  if (!$ledger) {
    $passbookRowsHtml .= '<tr><td colspan="8" class="center muted">No passbook transactions recorded.</td></tr>';
  } else {
    // Sort by date and ID to ensure chronological order
    usort($ledger, function($a, $b) {
      $dateA = $a['txn_date'] ?? $a['date'] ?? '';
      $dateB = $b['txn_date'] ?? $b['date'] ?? '';
      if ($dateA < $dateB) return -1;
      if ($dateA > $dateB) return 1;
      return ($a['id'] ?? 0) - ($b['id'] ?? 0);
    });
    
    $j = 1;
    $runningBal = 0;
    
    foreach ($ledger as $l) {
      $txnDate = h2((string)($l['txn_date'] ?? $l['date'] ?? ''));
      $txnType = h2((string)($l['txn_type'] ?? $l['type'] ?? ''));
      $txnTypeLabel = $txnType === 'credit' ? 'DEPOSIT' : 'WITHDRAWAL';
      
      $title = h2((string)($l['title'] ?? ''));
      $notes = trim((string)($l['notes'] ?? $l['description'] ?? ''));
      $desc = $notes !== '' ? $title . ' - ' . h2($notes) : $title;
      if ($desc === '') $desc = '—';
      
      $amountIn = (float)($l['amount_in'] ?? $l['credit'] ?? 0);
      $amountOut = (float)($l['amount_out'] ?? $l['debit'] ?? 0);
      
      // Calculate running balance correctly (ignore DB balance_after)
      $runningBal += $amountIn - $amountOut;
      
      $refTable = (string)($l['ref_table'] ?? '');
      $refId = (string)($l['ref_id'] ?? '');
      $ref = ($refTable !== '' && $refId !== '') ? h2($refTable . '#' . $refId) : '—';
      
      $passbookRowsHtml .= '<tr>';
      $passbookRowsHtml .= '<td class="center">' . $j . '</td>';
      $passbookRowsHtml .= '<td class="nowrap">' . $txnDate . '</td>';
      $passbookRowsHtml .= '<td>' . $txnTypeLabel . '</td>';
      $passbookRowsHtml .= '<td>' . $desc . '</td>';
      $passbookRowsHtml .= '<td class="money">' . ($amountIn > 0 ? h2($peso($amountIn)) : '—') . '</td>';
      $passbookRowsHtml .= '<td class="money">' . ($amountOut > 0 ? h2($peso($amountOut)) : '—') . '</td>';
      $passbookRowsHtml .= '<td class="money">' . h2($peso($runningBal)) . '</td>';
      $passbookRowsHtml .= '<td>' . $ref . '</td>';
      $passbookRowsHtml .= '</tr>';
      $j++;
    }
  }

  $css = <<<CSS
<style>
  body { font-family: Arial, sans-serif; font-size: 11pt; color: #111; }
  .muted { color:#666; }

  .title { text-align: center; font-size: 18pt; font-weight: 700; letter-spacing: 1px; margin: 6mm 0 4mm; }

  .meta-wrap { width: 100%; margin: 0 0 6mm 0; }
  .meta-table { width: 100%; border-collapse: collapse; }
  .meta-table td { vertical-align: top; font-size: 11pt; padding: 2mm 0; }
  .meta-left { width: 62%; }
  .meta-right { width: 38%; text-align: right; }
  .meta-line { margin: 1mm 0; }
  .meta-line b { font-weight:700; }

  .sec { font-weight: 700; font-size: 12.5pt; margin: 8mm 0 3mm; letter-spacing: 0.3px; border-bottom: 1px solid #999; padding-bottom: 2mm; }

  table.grid { width: 100%; border-collapse: collapse; table-layout: fixed; font-size: 10pt; }
  table.grid th, table.grid td { border: 1px solid #999; padding: 6px 4px; vertical-align: middle; }
  table.grid th { background: #f2f2f2; font-weight: 700; text-align: center; }

  .money { text-align: right; white-space: nowrap; font-family: 'Courier New', monospace; }
  .center { text-align: center; }
  .nowrap { white-space: nowrap; }
  .fw-bold { font-weight: 700; }
  .highlight { background: #f9f9f9; }

  table.compact { width: 60%; margin: 3mm auto 5mm auto; border-collapse: collapse; }
  table.compact td { padding: 4mm 2mm; border: 1px solid #999; }
  .label-cell { font-weight: 700; width: 70%; padding-left: 4mm; }

  .sign-row { width: 100%; margin-top: 12mm; border-collapse: collapse; table-layout: fixed; }
  .sign-row td { width: 33.333%; text-align: center; vertical-align: bottom; padding: 0 4mm; }

  .sig-img {
    max-width: 170px;
    max-height: 55px;
    display: block;
    margin: 0 auto -6px auto;
    object-fit: contain;
  }

  .sign-unders {
    width: 85%;
    margin: 0 auto 2mm auto;
    font-family: "Courier New", monospace;
    font-size: 12px;
    letter-spacing: 0.5px;
    line-height: 1;
  }

  .sig-name { font-weight: 700; margin-top: 1mm; font-size: 11pt; }
  .sig-role { margin-top: 1mm; font-size: 10.5pt; line-height: 1.25; }

  .page-break { page-break-before: always; }
</style>
CSS;

  $titleEsc = h2($title !== '' ? $title : '—');
  $orgEsc   = h2($orgName !== '' ? $orgName : '—');
  $venueEsc = h2($venue !== '' ? $venue : '—');

  $dateEsc  = h2($dateStr);
  $syEsc    = h2('SY ' . $schoolYear);
  $semEsc   = h2($semester);

  $treasurerNameEsc = h2($treasurerName !== '' ? $treasurerName : '—');
  $presidentNameEsc = h2($presidentName !== '' ? $presidentName : '—');
  $superAdminNameEsc = h2($superAdminName !== '' ? $superAdminName : '—');

  $unders = '__________________________';

  $html = $css . '
    <div class="title">LIQUIDATION REPORT</div>

    <div class="meta-wrap">
      <table class="meta-table">
        <tr>
          <td class="meta-left">
            <div class="meta-line"><b>Event:</b> ' . $titleEsc . '</div>
            <div class="meta-line"><b>Organization:</b> ' . $orgEsc . '</div>
            <div class="meta-line"><b>Venue:</b> ' . $venueEsc . '</div>
          </td>
          <td class="meta-right">
            <div class="meta-line"><b>Date:</b> ' . $dateEsc . '</div>
            <div class="meta-line"><b>School Year:</b> ' . $syEsc . '</div>
            <div class="meta-line"><b>Semester:</b> ' . $semEsc . '</div>
          </td>
        </tr>
      </table>
    </div>

    <div class="sec">I. PROPOSED vs. ACTUAL EXPENSES</div>
    <table class="compact">
      ' . $proposedVsActualRows . '
    </table>

    <div class="sec">II. DETAILED EXPENSES</div>
    <table class="grid">
      <thead>
        <tr>
          <th style="width:4%;">#</th>
          <th style="width:11%;">Date</th>
          <th style="width:16%;">Category</th>
          <th style="width:28%;">Description</th>
          <th style="width:6%;">Qty</th>
          <th style="width:12%;">Unit Price</th>
          <th style="width:12%;">Amount</th>
          <th style="width:11%;">OR / Ref</th>
        </tr>
      </thead>
      <tbody>
        ' . $expenseRowsHtml . '
      </tbody>
    </table>

    <div class="sec">III. TREASURER\'S LOG / PASSBOOK TRANSACTIONS</div>
    <table class="grid">
      <thead>
        <tr>
          <th style="width:4%;">#</th>
          <th style="width:10%;">Date</th>
          <th style="width:12%;">Type</th>
          <th style="width:30%;">Description / Purpose</th>
          <th style="width:12%;">Deposit (+)</th>
          <th style="width:12%;">Withdrawal (-)</th>
          <th style="width:12%;">Balance</th>
          <th style="width:8%;">Reference</th>
        </tr>
      </thead>
      <tbody>
        ' . $passbookRowsHtml . '
      </tbody>
      <tfoot>
        <tr>
          <th colspan="4" style="text-align:right;">SUMMARY:</th>
          <th class="money">' . h2($peso($funds)) . '</th>
          <th class="money">' . h2($peso($expenses)) . '</th>
          <th class="money">' . h2($peso($balance)) . '</th>
          <th></th>
        </tr>
      </tfoot>
    </table>

    <div class="sec">IV. CERTIFICATION</div>
    <div class="desc-box" style="border:1px solid #999; padding:4mm; margin:3mm 0 5mm 0; background:#fcfcfc;">
      <p>This is to certify that the above liquidation report is true and correct to the best of my knowledge and belief. All transactions recorded in the Treasurer\'s Log are supported by official receipts and other documentary evidence.</p>
      <p style="margin-top:3mm;">The passbook transactions above reflect all deposits and withdrawals related to this event, ensuring transparency and proper tracking of funds in accordance with USTP financial policies.</p>
    </div>

    <table class="sign-row">
      <tr>
        <td>
          ' . $treasurerSigHtml . '
          <div class="sign-unders">' . $unders . '</div>
          <div class="sig-name">' . $treasurerNameEsc . '</div>
          <div class="sig-role">Prepared by:<br/>Treasurer</div>
        </td>
        <td>
          ' . $presidentSigHtml . '
          <div class="sign-unders">' . $unders . '</div>
          <div class="sig-name">' . $presidentNameEsc . '</div>
          <div class="sig-role">Checked by:<br/>Organization President</div>
        </td>
        <td>
          ' . $superAdminSigHtml . '
          <div class="sign-unders">' . $unders . '</div>
          <div class="sig-name">' . $superAdminNameEsc . '</div>
          <div class="sig-role">Approved by:<br/>Student Affairs Office</div>
        </td>
      </tr>
    </table>
  ';

  $mpdf->WriteHTML($html);
  $mpdf->Output('liquidation-report.pdf', 'I');
  exit;

} catch (\Throwable $e) {
  http_response_code(500);
  header('Content-Type:text/plain; charset=utf-8');
  echo "PDF generation failed.\n" . $e->getMessage();
  exit;
}