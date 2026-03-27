<?php
declare(strict_types=1);

ini_set('display_errors', '0');
ini_set('log_errors', '1');
error_reporting(E_ALL);

session_start();
require_once __DIR__ . '/_mpdf_common.php';

/** @var PDO $pdo */

ee_require_login();

$eventId = (int)($_GET['event_id'] ?? 0);
if ($eventId <= 0) {
  http_response_code(400); header('Content-Type:text/plain; charset=utf-8');
  echo 'Missing event_id.'; exit;
}

$event = ee_fetch_event($pdo, $eventId);
if (!$event) {
  http_response_code(404); header('Content-Type:text/plain; charset=utf-8');
  echo 'Event not found.'; exit;
}

if (!ee_can_view_event($pdo, $event)) {
  http_response_code(403); header('Content-Type:text/plain; charset=utf-8');
  echo 'Forbidden.'; exit;
}

if ((string)($event['accomplishment_status'] ?? '') !== 'Approved') {
  http_response_code(403); header('Content-Type:text/plain; charset=utf-8');
  echo 'Locked: accomplishment not approved.'; exit;
}

/* ============================================================
   HELPERS
   ============================================================ */
function h2($s): string {
  return htmlspecialchars((string)($s ?? ''), ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
}

/**
 * Converts a relative server path to a base64 inline <img> tag.
 * Used for both signatures and receipt images.
 */
function img_base64(string $relativePath, string $class = '', string $alt = '', string $style = ''): string {
  $p = trim($relativePath);
  if ($p === '' || preg_match('~^https?://~i', $p)) return '';
  $p      = str_replace('\\', '/', $p);
  $fsPath = realpath(__DIR__ . '/../' . ltrim($p, '/'));
  if (!$fsPath || !is_file($fsPath)) return '';
  $ext = strtolower(pathinfo($fsPath, PATHINFO_EXTENSION));
  if ($ext === 'jpg') $ext = 'jpeg';
  if (!in_array($ext, ['png', 'jpeg', 'gif', 'webp'], true)) return '';
  $mime = 'image/' . $ext;
  $data = base64_encode((string)file_get_contents($fsPath));
  $cls  = $class !== '' ? ' class="' . h2($class) . '"' : '';
  $sty  = $style !== '' ? ' style="' . $style . '"'    : '';
  return '<img src="data:' . $mime . ';base64,' . $data . '"' . $cls . $sty . ' alt="' . h2($alt) . '">';
}

// Alias kept for existing signature calls
function img_tag_base64_local(string $relativePath, string $className = '', string $alt = ''): string {
  return img_base64($relativePath, $className, $alt);
}

function get_active_signature_file(PDO $pdo, int $userId): ?string {
  if ($userId <= 0) return null;
  try {
    $cols = [];
    $st   = $pdo->query("SHOW COLUMNS FROM e_signatures");
    while ($r = $st->fetch(PDO::FETCH_ASSOC)) $cols[strtolower((string)$r['Field'])] = true;
    $pick = function(array $c) use ($cols): ?string {
      foreach ($c as $k) { if (isset($cols[strtolower($k)])) return $k; }
      return null;
    };
    $col = $pick(['signature_file','signature_path','file_path','path','file']);
    if (!$col) return null;
    $ord = isset($cols['updated_at']) ? 'updated_at DESC, id DESC'
         : (isset($cols['created_at']) ? 'created_at DESC, id DESC' : 'id DESC');
    $q = $pdo->prepare("SELECT {$col} FROM e_signatures WHERE user_id=:uid AND status='Active' ORDER BY {$ord} LIMIT 1");
    $q->execute([':uid' => $userId]);
    $f = $q->fetchColumn();
    $v = is_string($f) ? trim($f) : '';
    return $v !== '' ? $v : null;
  } catch (\Throwable $e) { return null; }
}

function current_active_super_admin(PDO $pdo): ?array {
  try {
    $cols = [];
    $st   = $pdo->query("SHOW COLUMNS FROM users");
    while ($r = $st->fetch(PDO::FETCH_ASSOC)) $cols[strtolower((string)$r['Field'])] = true;
    $ord = isset($cols['last_login_at'])
      ? "CASE WHEN last_login_at IS NULL THEN 1 ELSE 0 END ASC, last_login_at DESC, id DESC"
      : "id DESC";
    $q   = $pdo->query("SELECT id,first_name,middle_name,last_name,suffix FROM users WHERE role='super_admin' AND status='Active' ORDER BY {$ord} LIMIT 1");
    $row = $q ? $q->fetch(PDO::FETCH_ASSOC) : null;
    if (!$row) return null;
    $id = (int)($row['id'] ?? 0);
    if ($id <= 0) return null;
    $fn   = trim((string)($row['first_name']  ?? ''));
    $mn   = trim((string)($row['middle_name'] ?? ''));
    $ln   = trim((string)($row['last_name']   ?? ''));
    $sx   = trim((string)($row['suffix']      ?? ''));
    $name = trim($fn . ' ' . ($mn !== '' ? mb_substr($mn,0,1).'. ' : '') . $ln . ($sx !== '' ? ' '.$sx : ''));
    return ['id' => $id, 'name' => ($name !== '' ? $name : '—')];
  } catch (\Throwable $e) { return null; }
}

function school_year_for_term(PDO $pdo, int $termId): string {
  if ($termId <= 0) return '';
  $st = $pdo->prepare("SELECT school_year FROM academic_terms WHERE id=:id LIMIT 1");
  $st->execute([':id' => $termId]);
  $r = $st->fetch(PDO::FETCH_ASSOC);
  return trim((string)($r['school_year'] ?? ''));
}

function get_org_president(PDO $pdo, int $orgId, int $termId): ?array {
  if ($orgId <= 0 || $termId <= 0) return null;
  $ne = "COALESCE(NULLIF(oo.full_name,''),CONCAT_WS(' ',NULLIF(u.first_name,''),CASE WHEN u.middle_name IS NULL OR u.middle_name='' THEN NULL ELSE CONCAT(LEFT(u.middle_name,1),'.') END,NULLIF(u.last_name,''),NULLIF(u.suffix,'')))";
  foreach ([
    "oo.org_id=:org AND oo.academic_term_id=:term AND oo.status='Active' AND LOWER(oo.position) NOT LIKE '%vice%' AND (LOWER(TRIM(oo.position)) IN ('president','organization president','org president') OR LOWER(oo.position) LIKE 'president%')",
    "oo.org_id=:org AND oo.academic_term_id=:term AND oo.status='Active' AND LOWER(oo.position) LIKE '%president%' AND LOWER(oo.position) NOT LIKE '%vice%'",
  ] as $w) {
    $st = $pdo->prepare("SELECT oo.user_id,{$ne} AS full_name,oo.position,oo.academic_term_id FROM organization_officers oo LEFT JOIN users u ON u.id=oo.user_id WHERE {$w} ORDER BY oo.id DESC LIMIT 1");
    $st->execute([':org'=>$orgId,':term'=>$termId]);
    $r = $st->fetch(PDO::FETCH_ASSOC);
    if ($r) return $r;
  }
  $sy = school_year_for_term($pdo, $termId);
  if ($sy === '') return null;
  $st = $pdo->prepare("SELECT oo.user_id,{$ne} AS full_name,oo.position,oo.academic_term_id FROM organization_officers oo INNER JOIN academic_terms t ON t.id=oo.academic_term_id LEFT JOIN users u ON u.id=oo.user_id WHERE oo.org_id=:org AND oo.status='Active' AND t.school_year=:sy AND LOWER(oo.position) NOT LIKE '%vice%' AND (LOWER(TRIM(oo.position)) IN ('president','organization president','org president') OR LOWER(oo.position) LIKE 'president%' OR (LOWER(oo.position) LIKE '%president%' AND LOWER(oo.position) NOT LIKE '%vice%')) ORDER BY oo.academic_term_id DESC,oo.id DESC LIMIT 1");
  $st->execute([':org'=>$orgId,':sy'=>$sy]);
  $r = $st->fetch(PDO::FETCH_ASSOC);
  return $r ?: null;
}

function get_org_treasurer_for_school_year(PDO $pdo, int $orgId, int $termId): ?array {
  if ($orgId <= 0 || $termId <= 0) return null;
  $sy = school_year_for_term($pdo, $termId);
  if ($sy === '') return null;
  $ne = "COALESCE(NULLIF(oo.full_name,''),CONCAT_WS(' ',NULLIF(u.first_name,''),CASE WHEN u.middle_name IS NULL OR u.middle_name='' THEN NULL ELSE CONCAT(LEFT(u.middle_name,1),'.') END,NULLIF(u.last_name,''),NULLIF(u.suffix,'')))";
  foreach ([
    "LOWER(oo.position) IN ('treasurer','org treasurer','organization treasurer')",
    "LOWER(oo.position) LIKE '%treasurer%' AND LOWER(oo.position) NOT LIKE '%vice%'",
  ] as $pw) {
    $st = $pdo->prepare("SELECT oo.user_id,{$ne} AS full_name,oo.position,oo.academic_term_id FROM organization_officers oo INNER JOIN academic_terms t ON t.id=oo.academic_term_id LEFT JOIN users u ON u.id=oo.user_id WHERE oo.org_id=:org AND oo.status='Active' AND t.school_year=:sy AND {$pw} ORDER BY oo.academic_term_id DESC,oo.id DESC LIMIT 1");
    $st->execute([':org'=>$orgId,':sy'=>$sy]);
    $r = $st->fetch(PDO::FETCH_ASSOC);
    if ($r) return $r;
  }
  return null;
}

/* ============================================================
   DATA FETCH
   ============================================================ */
$debits  = ee_fetch_debits($pdo, $eventId);
$credits = ee_fetch_credits($pdo, $eventId);
$ledger  = ee_fetch_ledger($pdo, $eventId);
$tot     = ee_totals($pdo, $eventId);

$proposedItems        = [];
$proposedExpensesTotal = 0.00;
try {
  $chk = $pdo->query("SHOW TABLES LIKE 'event_proposed_expenses'");
  if ($chk && $chk->rowCount() > 0) {
    $st = $pdo->prepare("SELECT id,description,quantity,estimated_cost,notes FROM event_proposed_expenses WHERE event_id=:eid ORDER BY id ASC");
    $st->execute([':eid'=>$eventId]);
    $proposedItems = $st->fetchAll(PDO::FETCH_ASSOC) ?: [];
    $stT = $pdo->prepare("SELECT COALESCE(SUM(quantity*estimated_cost),0) FROM event_proposed_expenses WHERE event_id=:eid");
    $stT->execute([':eid'=>$eventId]);
    $proposedExpensesTotal = (float)($stT->fetchColumn() ?: 0);
  }
} catch (\Throwable $e) {}

$proposedCreditsItems = [];
$proposedCreditsTotal = 0.00;
try {
  $chk = $pdo->query("SHOW TABLES LIKE 'event_proposed_credits'");
  if ($chk && $chk->rowCount() > 0) {
    $st = $pdo->prepare("SELECT id,description,amount,notes FROM event_proposed_credits WHERE event_id=:eid ORDER BY id ASC");
    $st->execute([':eid'=>$eventId]);
    $proposedCreditsItems = $st->fetchAll(PDO::FETCH_ASSOC) ?: [];
    $stT = $pdo->prepare("SELECT COALESCE(SUM(amount),0) FROM event_proposed_credits WHERE event_id=:eid");
    $stT->execute([':eid'=>$eventId]);
    $proposedCreditsTotal = (float)($stT->fetchColumn() ?: 0);
  }
} catch (\Throwable $e) {}

$orgId  = (int)($event['org_id'] ?? 0);
$termId = ee_event_term_id($pdo, $event);

$schoolYear = (string)($event['start_year'] . '–' . $event['end_year']);
$semester   = ee_semester_label_from_active_year((int)$event['active_year']);
$title      = trim((string)($event['title']    ?? ''));
$orgName    = trim((string)($event['org_label'] ?? ($event['org_name'] ?? '')));
$venue      = trim((string)($event['location'] ?? ''));
$dateStr    = date('F j, Y');

/* ============================================================
   SIGNERS
   ============================================================ */
$treasurer     = ($orgId > 0 && $termId > 0) ? get_org_treasurer_for_school_year($pdo, $orgId, $termId) : null;
$president     = ($orgId > 0 && $termId > 0) ? get_org_president($pdo, $orgId, $termId)                 : null;
$sa            = current_active_super_admin($pdo);

$treasurerName  = $treasurer ? trim((string)($treasurer['full_name'] ?? '')) : '';
$presidentName  = $president ? trim((string)($president['full_name'] ?? '')) : '';
$superAdminName = $sa        ? (string)$sa['name'] : '—';

$treasurerSigHtml = $presidentSigHtml = $superAdminSigHtml = '';
if ($treasurer && !empty($treasurer['user_id'])) {
  $sig = get_active_signature_file($pdo, (int)$treasurer['user_id']);
  if ($sig) $treasurerSigHtml = img_tag_base64_local($sig, 'sig-img', 'Treasurer Signature');
}
if ($president && !empty($president['user_id'])) {
  $sig = get_active_signature_file($pdo, (int)$president['user_id']);
  if ($sig) $presidentSigHtml = img_tag_base64_local($sig, 'sig-img', 'President Signature');
}
if ($sa && !empty($sa['id'])) {
  $sig = get_active_signature_file($pdo, (int)$sa['id']);
  if ($sig) $superAdminSigHtml = img_tag_base64_local($sig, 'sig-img', 'SAO Signature');
}

/* ============================================================
   PDF RENDER
   ============================================================ */
try {
  while (ob_get_level() > 0) { @ob_end_clean(); }

  $mpdf = ee_mpdf(true);
  $mpdf->SetTitle('Liquidation Report');

  $peso = fn(float $n): string => '₱' . number_format($n, 2, '.', ',');

  $actualFunds    = (float)($tot['credits'] ?? 0);
  $actualExpenses = (float)($tot['debits']  ?? 0);
  $actualBalance  = (float)($tot['balance'] ?? 0);

  $proposedBalance = $proposedCreditsTotal - $proposedExpensesTotal;
  $fundsVariance   = $actualFunds    - $proposedCreditsTotal;
  $expenseVariance = $actualExpenses - $proposedExpensesTotal;
  $netVariance     = $actualBalance  - $proposedBalance;

  /* ============================================================
     ROW BUILDERS
     ============================================================ */

  // Part C — Disbursements (with receipt thumbnails)
  $disbRowsHtml     = '';
  $receiptAnnexHtml = '';
  $hasReceipts      = false;

  if (!$debits) {
    $disbRowsHtml = '<tr><td colspan="8" class="empty-row">No disbursements recorded.</td></tr>';
  } else {
    $i = 1;
    foreach ($debits as $d) {
      $dt    = h2((string)($d['debit_date'] ?? ''));
      $cat   = h2((string)($d['category']   ?? ''));
      $notes = trim((string)($d['notes']    ?? ''));
      $desc  = $cat . ($notes !== '' ? ' — ' . h2($notes) : '');
      if ($desc === '') $desc = '—';

      $payee = h2(trim((string)($d['payee'] ?? $d['category'] ?? '')));
      if ($payee === '') $payee = '—';

      $qty  = max(1, (int)($d['quantity']  ?? 1));
      $unit = (float)($d['unit_price']     ?? 0);
      $amt  = (float)($d['amount']         ?? 0);
      $orNo = trim((string)($d['receipt_number'] ?? ''));
      $orNo = $orNo !== '' ? h2($orNo) : '—';

      // Receipt image from receipt_path column
      $rPath = trim((string)($d['receipt_path'] ?? ''));
      $rThumb = '';
      if ($rPath !== '') {
        $thumb = img_base64(
          $rPath, 'receipt-thumb',
          'Receipt #' . $i,
          'max-width:58px;max-height:44px;display:block;margin:1mm auto;border:0.5pt solid #c0d0e0;'
        );
        if ($thumb !== '') {
          $rThumb      = $thumb;
          $hasReceipts = true;
          $large = img_base64(
            $rPath, 'receipt-large',
            'Receipt #' . $i,
            'max-width:155mm;max-height:195mm;display:block;margin:4mm auto;border:1pt solid #c0d0e0;'
          );
          $receiptAnnexHtml .=
            '<div class="annex-block">' .
            '<div class="annex-label">Receipt #' . $i . ' &nbsp;&mdash;&nbsp; ' . $dt .
            ' &nbsp;&mdash;&nbsp; ' . $desc . ' &nbsp;&mdash;&nbsp; ' . h2($peso($amt)) . '</div>' .
            $large .
            '</div>';
        }
      }

      $unitCell = ($unit > 0 && $qty > 1)
        ? $qty . ' &times; ' . h2($peso($unit))
        : ($qty > 1 ? $qty . ' pcs' : '—');

      $stripe = ($i % 2 === 0) ? ' class="stripe"' : '';
      $disbRowsHtml .= '<tr' . $stripe . '>';
      $disbRowsHtml .= '<td class="cell-num">'     . $i      . '</td>';
      $disbRowsHtml .= '<td class="cell-date">'    . $dt     . '</td>';
      $disbRowsHtml .= '<td>'                      . $desc   . '</td>';
      $disbRowsHtml .= '<td>'                      . $payee  . '</td>';
      $disbRowsHtml .= '<td class="cell-ref">'     . $orNo   . '</td>';
      $disbRowsHtml .= '<td class="cell-center">'  . $unitCell . '</td>';
      $disbRowsHtml .= '<td class="cell-money">'   . h2($peso($amt)) . '</td>';
      $disbRowsHtml .= '<td class="cell-receipt">' . ($rThumb !== '' ? $rThumb : '<span class="no-receipt">—</span>') . '</td>';
      $disbRowsHtml .= '</tr>';
      $i++;
    }
  }

  // Approved budget breakdown
  $budgetRowsHtml = '';
  if (!$proposedItems) {
    $budgetRowsHtml = '<tr><td colspan="4" class="empty-row">No proposed budget items submitted.</td></tr>';
  } else {
    $i = 1;
    foreach ($proposedItems as $item) {
      $desc  = h2((string)($item['description']   ?? ''));
      $qty   = (int)($item['quantity']             ?? 1);
      $cost  = (float)($item['estimated_cost']     ?? 0);
      $total = $qty * $cost;
      $notes = h2(trim((string)($item['notes']     ?? '')));
      $stripe = ($i % 2 === 0) ? ' class="stripe"' : '';
      $budgetRowsHtml .= '<tr' . $stripe . '>';
      $budgetRowsHtml .= '<td class="cell-num">' . $i . '</td>';
      $budgetRowsHtml .= '<td>' . $desc . ($notes !== '' ? '<br><span class="sub-note">' . $notes . '</span>' : '') . '</td>';
      $budgetRowsHtml .= '<td class="cell-center">' . $qty . ($cost > 0 ? ' &times; ' . h2($peso($cost)) : '') . '</td>';
      $budgetRowsHtml .= '<td class="cell-money">' . h2($peso($total)) . '</td>';
      $budgetRowsHtml .= '</tr>';
      $i++;
    }
  }

  // Approved fund sources
  $fundsRowsHtml = '';
  if (!$proposedCreditsItems) {
    $fundsRowsHtml = '<tr><td colspan="3" class="empty-row">No proposed fund sources submitted.</td></tr>';
  } else {
    $i = 1;
    foreach ($proposedCreditsItems as $item) {
      $desc   = h2((string)($item['description'] ?? ''));
      $amount = (float)($item['amount']           ?? 0);
      $notes  = h2(trim((string)($item['notes']   ?? '')));
      $stripe = ($i % 2 === 0) ? ' class="stripe"' : '';
      $fundsRowsHtml .= '<tr' . $stripe . '>';
      $fundsRowsHtml .= '<td class="cell-num">' . $i . '</td>';
      $fundsRowsHtml .= '<td>' . $desc . ($notes !== '' ? '<br><span class="sub-note">' . $notes . '</span>' : '') . '</td>';
      $fundsRowsHtml .= '<td class="cell-money">' . h2($peso($amount)) . '</td>';
      $fundsRowsHtml .= '</tr>';
      $i++;
    }
  }

  // Passbook / ledger
  $passbookRowsHtml = '';
  if (!$ledger) {
    $passbookRowsHtml = '<tr><td colspan="7" class="empty-row">No passbook transactions recorded.</td></tr>';
  } else {
    usort($ledger, function($a, $b) {
      $dA = $a['txn_date'] ?? $a['date'] ?? '';
      $dB = $b['txn_date'] ?? $b['date'] ?? '';
      return $dA !== $dB ? strcmp($dA, $dB) : (($a['id'] ?? 0) - ($b['id'] ?? 0));
    });
    $j = 1; $running = 0.0;
    foreach ($ledger as $l) {
      $txnDate   = h2((string)($l['txn_date']  ?? $l['date'] ?? ''));
      $txnType   = (string)($l['txn_type']     ?? $l['type'] ?? '');
      $typeLabel = $txnType === 'credit' ? 'DEPOSIT' : 'WITHDRAWAL';
      $typeClass = $txnType === 'credit' ? 'badge-dep' : 'badge-with';
      $lTitle    = h2((string)($l['title']      ?? ''));
      $lNotes    = trim((string)($l['notes']    ?? $l['description'] ?? ''));
      $desc      = $lNotes !== '' ? $lTitle . ' — ' . h2($lNotes) : $lTitle;
      if ($desc === '') $desc = '—';
      $amIn  = (float)($l['amount_in']  ?? $l['credit'] ?? 0);
      $amOut = (float)($l['amount_out'] ?? $l['debit']  ?? 0);
      $running += $amIn - $amOut;
      $stripe = ($j % 2 === 0) ? ' class="stripe"' : '';
      $passbookRowsHtml .= '<tr' . $stripe . '>';
      $passbookRowsHtml .= '<td class="cell-num">'     . $j . '</td>';
      $passbookRowsHtml .= '<td class="cell-date">'    . $txnDate . '</td>';
      $passbookRowsHtml .= '<td class="cell-center"><span class="' . $typeClass . '">' . $typeLabel . '</span></td>';
      $passbookRowsHtml .= '<td>'                      . $desc . '</td>';
      $passbookRowsHtml .= '<td class="cell-money color-in">'  . ($amIn  > 0 ? h2($peso($amIn))  : '—') . '</td>';
      $passbookRowsHtml .= '<td class="cell-money color-out">' . ($amOut > 0 ? h2($peso($amOut)) : '—') . '</td>';
      $passbookRowsHtml .= '<td class="cell-money">'   . h2($peso($running)) . '</td>';
      $passbookRowsHtml .= '</tr>';
      $j++;
    }
  }

  /* ============================================================
     CSS  (mPDF-safe — no flexbox, no CSS variables)
     ============================================================ */
  $css = <<<CSS
<style>
* { margin:0; padding:0; }

body {
  font-family: "Times New Roman", Times, serif;
  font-size: 10.5pt;
  color: #1a1a2e;
  background: #fff;
  line-height: 1.55;
}

/* ── Title ─── */
.doc-title-wrap {
  text-align: center;
  padding-bottom: 2mm;
  margin-bottom: 3mm;
  border-bottom: 2pt double #1a3a5c;
}
.doc-title {
  font-family: Arial, sans-serif;
  font-size: 17pt;
  font-weight: 700;
  letter-spacing: 3px;
  text-transform: uppercase;
  color: #1a3a5c;
  margin-bottom: 1mm;
}
.doc-subtitle {
  font-family: Arial, sans-serif;
  font-size: 8pt;
  letter-spacing: 1px;
  color: #6b8cae;
}

/* ── Part headings ─── */
.part-heading {
  font-family: Arial, sans-serif;
  font-size: 8pt;
  font-weight: 700;
  letter-spacing: 2px;
  text-transform: uppercase;
  color: #fff;
  background: #1a3a5c;
  padding: 2mm 5mm;
  margin-top: 3mm;
  margin-bottom: 0;
}
.part-note {
  font-family: Arial, sans-serif;
  font-size: 7.5pt;
  font-style: italic;
  color: #4a6a8a;
  background: #eef4fb;
  padding: 1.5mm 5mm;
  border-left: 3pt solid #1a3a5c;
  border-bottom: 1pt solid #cad8e8;
  margin-bottom: 1.5mm;
}

/* ── Part A info grid ─── */
table.info-grid {
  width: 100%;
  border-collapse: collapse;
  margin-bottom: 2mm;
  border: 1pt solid #b8cce0;
}
table.info-grid td {
  padding: 2mm 4mm;
  border: 1pt solid #b8cce0;
  font-size: 10pt;
  vertical-align: top;
}
table.info-grid td.lbl {
  font-family: Arial, sans-serif;
  font-size: 7.5pt;
  font-weight: 700;
  letter-spacing: 0.5px;
  text-transform: uppercase;
  color: #1a3a5c;
  background: #eef4fb;
  width: 18%;
  white-space: nowrap;
}
table.info-grid td.val {
  font-size: 10pt;
  font-weight: 700;
  color: #111;
  width: 32%;
}

/* ── Part B statement ─── */
table.stmt {
  width: 56%;
  border-collapse: collapse;
  margin: 1.5mm auto 2mm auto;
  border: 1.5pt solid #1a3a5c;
}
table.stmt tr.stmt-hdr td {
  background: #1a3a5c;
  color: #fff;
  font-family: Arial, sans-serif;
  font-size: 8pt;
  font-weight: 700;
  letter-spacing: 1px;
  text-transform: uppercase;
  padding: 2mm 6mm;
}
table.stmt td {
  padding: 2.5mm 6mm;
  border-bottom: 1pt solid #c0d0e0;
  font-size: 10.5pt;
}
table.stmt td.amt {
  text-align: right;
  font-family: "Courier New", Courier, monospace;
  font-weight: 700;
  width: 36%;
}
table.stmt tr.stmt-total td {
  background: #eef4fb;
  border-top: 2pt solid #1a3a5c;
  font-weight: 700;
  font-size: 11.5pt;
}
.surplus { color: #1a6b3a; }
.deficit { color: #9b1a1a; }

/* ── Generic grid ─── */
table.grid {
  width: 100%;
  border-collapse: collapse;
  font-size: 9.5pt;
  margin-bottom: 1.5mm;
}
table.grid th {
  background: #2c5282;
  color: #fff;
  font-family: Arial, sans-serif;
  font-size: 7.5pt;
  font-weight: 700;
  letter-spacing: 0.5px;
  text-transform: uppercase;
  padding: 2mm 5px;
  text-align: center;
  border: 1pt solid #1a3a5c;
}
table.grid td {
  padding: 2mm 5px;
  border: 1pt solid #c0d0e0;
  vertical-align: middle;
}
table.grid tr.stripe td { background: #f2f7fc; }
table.grid tfoot td {
  background: #dce8f4;
  font-family: Arial, sans-serif;
  font-size: 9.5pt;
  font-weight: 700;
  color: #1a3a5c;
  border: 1pt solid #b0c4d8;
  padding: 2mm 5px;
}

/* ── Comparison table ─── */
table.compare {
  width: 76%;
  border-collapse: collapse;
  margin: 1.5mm auto 1.5mm auto;
  font-size: 10pt;
}
table.compare th {
  background: #1a3a5c;
  color: #fff;
  font-family: Arial, sans-serif;
  font-size: 8.5pt;
  padding: 2mm 5mm;
  border: 1pt solid #1a3a5c;
  text-align: center;
}
table.compare td {
  padding: 2mm 5mm;
  border: 1pt solid #c0d0e0;
}
table.compare tr.stripe td { background: #f2f7fc; }
table.compare tfoot td {
  background: #dce8f4;
  font-family: Arial, sans-serif;
  font-size: 9pt;
  font-weight: 700;
  color: #1a3a5c;
  border: 1pt solid #b0c4d8;
  padding: 2mm 5mm;
}
td.cmp-lbl { font-weight:700; width:28%; }
td.cmp-num { text-align:right; font-family:"Courier New",Courier,monospace; width:24%; }
.var-pos   { color:#1a6b3a; font-weight:700; }
.var-neg   { color:#9b1a1a; font-weight:700; }
.status-ok  { color:#1a6b3a; font-weight:700; font-family:Arial,sans-serif; font-size:9pt; }
.status-bad { color:#9b1a1a; font-weight:700; font-family:Arial,sans-serif; font-size:9pt; }

/* ── Cell helpers ─── */
.cell-num     { text-align:center; color:#7a9ab8; font-size:8pt; width:4%; }
.cell-date    { white-space:nowrap; font-family:"Courier New",Courier,monospace; font-size:9pt; }
.cell-center  { text-align:center; }
.cell-ref     { text-align:center; font-family:"Courier New",Courier,monospace; font-size:8.5pt; }
.cell-money   { text-align:right; white-space:nowrap; font-family:"Courier New",Courier,monospace; font-size:9.5pt; }
.cell-receipt { text-align:center; width:68px; }
.color-in     { color:#1a6b3a; }
.color-out    { color:#9b1a1a; }
.empty-row    { text-align:center; color:#aaa; font-style:italic; padding:7mm; }
.sub-note     { font-size:8pt; color:#777; font-style:italic; }
.no-receipt   { color:#ccc; font-size:8pt; }

/* ── Badges ─── */
.badge-dep {
  font-family:Arial,sans-serif; font-size:7pt; font-weight:700;
  color:#1a6b3a; border:1pt solid #1a6b3a; padding:0.5mm 2mm;
}
.badge-with {
  font-family:Arial,sans-serif; font-size:7pt; font-weight:700;
  color:#9b1a1a; border:1pt solid #9b1a1a; padding:0.5mm 2mm;
}

/* ── Certification ─── */
.cert-box {
  border-left: 4pt solid #1a3a5c;
  background: #f3f7fb;
  padding: 3mm 6mm;
  margin: 2mm 0 4mm 0;
  font-size: 10pt;
  line-height: 1.65;
}

/* ── Signatures ─── */
table.sign-tbl {
  width:100%; border-collapse:collapse; margin-top:6mm;
}
table.sign-tbl td {
  width:33.333%; text-align:center; vertical-align:bottom; padding:0 5mm;
}
.sig-img {
  max-width:150px; max-height:50px;
  display:block; margin:0 auto 1mm auto; object-fit:contain;
}
.sig-line {
  border-top:1.5pt solid #1a3a5c; width:80%; margin:0 auto 2mm auto;
}
.sig-name {
  font-family:Arial,sans-serif; font-size:10pt; font-weight:700;
  text-transform:uppercase; margin-bottom:0.5mm;
}
.sig-pos {
  font-family:Arial,sans-serif; font-size:8.5pt; color:#1a3a5c;
  font-weight:700; margin-bottom:0.5mm;
}
.sig-role {
  font-family:Arial,sans-serif; font-size:7.5pt; color:#999;
  text-transform:uppercase; letter-spacing:0.5px;
}
.sig-date {
  font-family:Arial,sans-serif; font-size:8pt; color:#555; margin-top:2.5mm;
}

/* ── Footer ─── */
hr.footer-hr {
  border:none; border-top:1.5pt solid #c0d0e0; margin-top:6mm; margin-bottom:0;
}

/* ── Annex receipts ─── */
.annex-block { margin-bottom:4mm; text-align:center; page-break-inside:avoid; }
.annex-label {
  font-family:Arial,sans-serif; font-size:9pt; font-weight:700;
  color:#1a3a5c; margin-bottom:2mm;
  border-bottom:1pt solid #c0d0e0; padding-bottom:1.5mm;
}
</style>
CSS;

  /* ============================================================
     ESCAPED VALUES
     ============================================================ */
  $titleEsc          = h2($title    !== '' ? $title    : '—');
  $orgEsc            = h2($orgName  !== '' ? $orgName  : '—');
  $venueEsc          = h2($venue    !== '' ? $venue    : '—');
  $dateEsc           = h2($dateStr);
  $syEsc             = h2('SY ' . $schoolYear);
  $semEsc            = h2($semester);
  $treasurerNameEsc  = h2($treasurerName  !== '' ? strtoupper($treasurerName)  : '—');
  $presidentNameEsc  = h2($presidentName  !== '' ? strtoupper($presidentName)  : '—');
  $superAdminNameEsc = h2($superAdminName !== '' ? strtoupper($superAdminName) : '—');

  $balClass   = $actualBalance >= 0 ? 'surplus' : 'deficit';
  $statusTxt  = $netVariance >= 0
    ? '<span class="status-ok">&#10003; WITHIN BUDGET &mdash; Surplus of ' . h2($peso(abs($netVariance))) . '</span>'
    : '<span class="status-bad">&#9888; OVER BUDGET &mdash; Deficit of '  . h2($peso(abs($netVariance))) . '</span>';

  $certBalTxt = $actualBalance >= 0
    ? 'a remaining balance of <strong>' . h2($peso($actualBalance)) . '</strong>, which shall be returned or deposited accordingly'
    : 'a deficit of <strong>' . h2($peso(abs($actualBalance))) . '</strong>, which shall be settled accordingly';

  /* ============================================================
     HTML
     ============================================================ */
  $html = $css . '

  <!-- ══════════════ TITLE ══════════════ -->
  <div class="doc-title-wrap">
    <div class="doc-title">Liquidation Report</div>
    <div class="doc-subtitle">Statement of Receipts and Disbursements &mdash; Activity / Event Fund</div>
  </div>

  <!-- ══════════════ PART A ══════════════ -->
  <div class="part-heading">Part A &mdash; Basic Information</div>
  <table class="info-grid">
    <tr>
      <td class="lbl">Name of Activity</td>
      <td class="val" colspan="3">' . $titleEsc . '</td>
    </tr>
    <tr>
      <td class="lbl">Organization</td>
      <td class="val">' . $orgEsc . '</td>
      <td class="lbl">School Year</td>
      <td class="val">' . $syEsc . ' &mdash; ' . $semEsc . '</td>
    </tr>
    <tr>
      <td class="lbl">Venue</td>
      <td class="val">' . $venueEsc . '</td>
      <td class="lbl">Date Prepared</td>
      <td class="val">' . $dateEsc . '</td>
    </tr>
    <tr>
      <td class="lbl">Funds Received</td>
      <td class="val">' . h2($peso($actualFunds)) . '</td>
      <td class="lbl">Total Disbursements</td>
      <td class="val">' . h2($peso($actualExpenses)) . '</td>
    </tr>
  </table>

  <!-- ══════════════ PART B ══════════════ -->
  <div class="part-heading">Part B &mdash; Statement of Receipts and Disbursements</div>
  <div class="part-note">Summary of all funds received and disbursed for this activity.</div>
  <table class="stmt">
    <tr class="stmt-hdr"><td>Particulars</td><td class="amt">Amount</td></tr>
    <tr>
      <td>Total Funds / Cash Advance Received</td>
      <td class="amt">' . h2($peso($actualFunds)) . '</td>
    </tr>
    <tr>
      <td>Less: Total Disbursements / Expenses</td>
      <td class="amt">( ' . h2($peso($actualExpenses)) . ' )</td>
    </tr>
    <tr class="stmt-total">
      <td><strong>Balance / Refund to be Returned</strong></td>
      <td class="amt ' . $balClass . '"><strong>' . h2($peso($actualBalance)) . '</strong></td>
    </tr>
  </table>

  <!-- ══════════════ PART C ══════════════ -->
  <div class="part-heading">Part C &mdash; Breakdown of Disbursements (Actual Expenses)</div>
  <div class="part-note">All disbursements must be supported by official receipts or valid documents. Thumbnails shown below; full-size images in Annex B.</div>
  <table class="grid">
    <thead>
      <tr>
        <th style="width:4%;">#</th>
        <th style="width:9%;">Date</th>
        <th style="width:27%; text-align:left; padding-left:5px;">Particulars</th>
        <th style="width:16%; text-align:left; padding-left:5px;">Payee</th>
        <th style="width:12%;">OR / Invoice No.</th>
        <th style="width:12%;">Qty / Unit</th>
        <th style="width:11%;">Amount</th>
        <th style="width:9%;">Receipt</th>
      </tr>
    </thead>
    <tbody>' . $disbRowsHtml . '</tbody>
    <tfoot>
      <tr>
        <td colspan="6" style="text-align:right; padding-right:8px;">Total Disbursements</td>
        <td class="cell-money">' . h2($peso($actualExpenses)) . '</td>
        <td></td>
      </tr>
    </tfoot>
  </table>

  <!-- ══════════════ PART D ══════════════ -->
  <div class="part-heading">Part D &mdash; Proposal vs. Actual Comparison</div>
  <div class="part-note">Proposed figures are from the approved Activity Proposal. Variance = Actual &minus; Proposed.</div>

  <table class="compare">
    <thead>
      <tr>
        <th style="width:28%; text-align:left; padding-left:6px;">Category</th>
        <th style="width:24%;">Proposed</th>
        <th style="width:24%;">Actual</th>
        <th style="width:24%;">Variance</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td class="cmp-lbl">Funds / Income</td>
        <td class="cmp-num">' . h2($peso($proposedCreditsTotal)) . '</td>
        <td class="cmp-num">' . h2($peso($actualFunds)) . '</td>
        <td class="cmp-num ' . ($fundsVariance >= 0 ? 'var-pos' : 'var-neg') . '">'
          . ($fundsVariance > 0 ? '+' : '') . h2($peso($fundsVariance)) . '</td>
      </tr>
      <tr class="stripe">
        <td class="cmp-lbl">Expenses</td>
        <td class="cmp-num">' . h2($peso($proposedExpensesTotal)) . '</td>
        <td class="cmp-num">' . h2($peso($actualExpenses)) . '</td>
        <td class="cmp-num ' . ($expenseVariance <= 0 ? 'var-pos' : 'var-neg') . '">'
          . ($expenseVariance > 0 ? '+' : '') . h2($peso($expenseVariance)) . '</td>
      </tr>
      <tr>
        <td class="cmp-lbl">Net Balance</td>
        <td class="cmp-num">' . h2($peso($proposedBalance)) . '</td>
        <td class="cmp-num">' . h2($peso($actualBalance)) . '</td>
        <td class="cmp-num ' . ($netVariance >= 0 ? 'var-pos' : 'var-neg') . '">'
          . ($netVariance > 0 ? '+' : '') . h2($peso($netVariance)) . '</td>
      </tr>
    </tbody>
    <tfoot>
      <tr>
        <td colspan="3" style="text-align:right; padding-right:8px;">Overall Status</td>
        <td style="text-align:center;">' . $statusTxt . '</td>
      </tr>
    </tfoot>
  </table>

  <div class="part-note" style="margin-top:3mm;">Proposed Expenses Breakdown (from Activity Proposal)</div>
  <table class="grid">
    <thead>
      <tr>
        <th style="width:5%;">#</th>
        <th style="width:60%; text-align:left; padding-left:5px;">Description</th>
        <th style="width:20%;">Qty / Unit Cost</th>
        <th style="width:15%;">Proposed Amount</th>
      </tr>
    </thead>
    <tbody>' . $budgetRowsHtml . '</tbody>
    <tfoot>
      <tr>
        <td colspan="3" style="text-align:right; padding-right:8px;">Total Proposed Expenses</td>
        <td class="cell-money">' . h2($peso($proposedExpensesTotal)) . '</td>
      </tr>
    </tfoot>
  </table>

  <div class="part-note" style="margin-top:3mm;">Proposed Fund Sources (from Activity Proposal)</div>
  <table class="grid">
    <thead>
      <tr>
        <th style="width:5%;">#</th>
        <th style="width:75%; text-align:left; padding-left:5px;">Source / Description</th>
        <th style="width:20%;">Proposed Amount</th>
      </tr>
    </thead>
    <tbody>' . $fundsRowsHtml . '</tbody>
    <tfoot>
      <tr>
        <td colspan="2" style="text-align:right; padding-right:8px;">Total Proposed Funds</td>
        <td class="cell-money">' . h2($peso($proposedCreditsTotal)) . '</td>
      </tr>
    </tfoot>
  </table>

  <!-- ══════════════ PART E ══════════════ -->
  <div class="part-heading">Part E &mdash; Certification and Signatories</div>
  <div class="cert-box">
    I hereby certify that the above statement of receipts and disbursements is true, correct, and complete,
    and that all expenditures were made in accordance with the approved Activity Proposal and applicable
    USTP financial policies. All disbursements are supported by valid official receipts and other documentary
    evidence attached hereto. This activity resulted in ' . $certBalTxt . '.
  </div>

  <table class="sign-tbl">
    <tr>
      <td>
        ' . ($treasurerSigHtml !== '' ? $treasurerSigHtml : '<div style="height:50px;"></div>') . '
        <div class="sig-line"></div>
        <div class="sig-name">' . $treasurerNameEsc . '</div>
        <div class="sig-pos">Treasurer</div>
        <div class="sig-role">Prepared by</div>
        <div class="sig-date">Date: _____________________</div>
      </td>
      <td>
        ' . ($presidentSigHtml !== '' ? $presidentSigHtml : '<div style="height:50px;"></div>') . '
        <div class="sig-line"></div>
        <div class="sig-name">' . $presidentNameEsc . '</div>
        <div class="sig-pos">Organization President</div>
        <div class="sig-role">Certified Correct</div>
        <div class="sig-date">Date: _____________________</div>
      </td>
      <td>
        ' . ($superAdminSigHtml !== '' ? $superAdminSigHtml : '<div style="height:50px;"></div>') . '
        <div class="sig-line"></div>
        <div class="sig-name">' . $superAdminNameEsc . '</div>
        <div class="sig-pos">Student Affairs Office</div>
        <div class="sig-role">Approved / Noted by</div>
        <div class="sig-date">Date: _____________________</div>
      </td>
    </tr>
  </table>

  <hr class="footer-hr">

  <!-- ══════════════ ANNEX A — PASSBOOK ══════════════ -->
  <div class="part-heading" style="margin-top:4mm; page-break-before:always;">
    Annex A &mdash; Treasurer\'s Passbook / Transaction Log
  </div>
  <div class="part-note">Running record of all deposits and withdrawals from the organization\'s fund for this event.</div>
  <table class="grid">
    <thead>
      <tr>
        <th style="width:4%;">#</th>
        <th style="width:10%;">Date</th>
        <th style="width:11%;">Type</th>
        <th style="width:35%; text-align:left; padding-left:5px;">Description / Purpose</th>
        <th style="width:13%;">Deposit (+)</th>
        <th style="width:13%;">Withdrawal (&minus;)</th>
        <th style="width:14%;">Running Balance</th>
      </tr>
    </thead>
    <tbody>' . $passbookRowsHtml . '</tbody>
    <tfoot>
      <tr>
        <td colspan="4" style="text-align:right; padding-right:8px;">Totals</td>
        <td class="cell-money color-in">'  . h2($peso($actualFunds))    . '</td>
        <td class="cell-money color-out">' . h2($peso($actualExpenses)) . '</td>
        <td class="cell-money">'           . h2($peso($actualBalance))  . '</td>
      </tr>
    </tfoot>
  </table>

  ' . ($hasReceipts ? '
  <!-- ══════════════ ANNEX B — RECEIPTS ══════════════ -->
  <div class="part-heading" style="margin-top:4mm;">
    Annex B &mdash; Official Receipts / Supporting Documents
  </div>
  <div class="part-note">Full-size scanned copies of official receipts and invoices attached to this liquidation report.</div>
  ' . $receiptAnnexHtml : '') . '
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
