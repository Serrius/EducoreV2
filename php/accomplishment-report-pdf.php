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
if ($eventId <= 0) { http_response_code(400); header('Content-Type:text/plain; charset=utf-8'); echo 'Missing event_id.'; exit; }

$event = ee_fetch_event($pdo, $eventId);
if (!$event) { http_response_code(404); header('Content-Type:text/plain; charset=utf-8'); echo 'Event not found.'; exit; }

if (!ee_can_view_event($pdo, $event)) { http_response_code(403); header('Content-Type:text/plain; charset=utf-8'); echo 'Forbidden.'; exit; }

if ((string)($event['accomplishment_status'] ?? '') === 'Locked') {
  http_response_code(403);
  header('Content-Type:text/plain; charset=utf-8');
  echo 'No accomplishment report submitted yet.';
  exit;
}

/* ============================================================
   HELPERS
   ============================================================ */
function h2($s): string {
  return htmlspecialchars((string)($s ?? ''), ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
}

function img_tag_base64_local(string $relativePath, string $className = '', string $alt = ''): string {
  $p = trim($relativePath);
  if ($p === '' || preg_match('~^https?://~i', $p)) return '';
  $p      = str_replace('\\', '/', $p);
  $fsPath = realpath(__DIR__ . '/../' . ltrim($p, '/'));
  if (!$fsPath || !is_file($fsPath)) return '';
  $ext = strtolower(pathinfo($fsPath, PATHINFO_EXTENSION));
  if ($ext === 'jpg') $ext = 'jpeg';
  if (!in_array($ext, ['png','jpeg','gif','webp'], true)) return '';
  $mime = 'image/' . $ext;
  $data = base64_encode((string)file_get_contents($fsPath));
  $cls  = $className !== '' ? ' class="' . h2($className) . '"' : '';
  return '<img src="data:' . $mime . ';base64,' . $data . '"' . $cls . ' alt="' . h2($alt) . '">';
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

function school_year_for_term(PDO $pdo, int $termId): string {
  if ($termId <= 0) return '';
  $st = $pdo->prepare("SELECT school_year FROM academic_terms WHERE id=:id LIMIT 1");
  $st->execute([':id' => $termId]);
  $r = $st->fetch(PDO::FETCH_ASSOC);
  return trim((string)($r['school_year'] ?? ''));
}

function get_org_treasurer(PDO $pdo, int $orgId, int $currentTermId): ?array {
  if ($orgId <= 0 || $currentTermId <= 0) return null;
  $ne = "COALESCE(NULLIF(oo.full_name,''),CONCAT_WS(' ',NULLIF(u.first_name,''),CASE WHEN u.middle_name IS NULL OR u.middle_name='' THEN NULL ELSE CONCAT(LEFT(u.middle_name,1),'.') END,NULLIF(u.last_name,''),NULLIF(u.suffix,'')))";
  // current term
  $st = $pdo->prepare("SELECT oo.user_id,{$ne} AS full_name,oo.position,oo.academic_term_id FROM organization_officers oo LEFT JOIN users u ON u.id=oo.user_id WHERE oo.org_id=:org AND oo.academic_term_id=:term AND oo.status='Active' AND LOWER(oo.position) LIKE '%treasurer%' ORDER BY oo.id DESC LIMIT 1");
  $st->execute([':org'=>$orgId,':term'=>$currentTermId]);
  $r = $st->fetch(PDO::FETCH_ASSOC);
  if ($r && !empty($r['user_id'])) return $r;
  // same school year
  $sy = school_year_for_term($pdo, $currentTermId);
  if ($sy !== '') {
    $st = $pdo->prepare("SELECT oo.user_id,{$ne} AS full_name,oo.position,oo.academic_term_id FROM organization_officers oo INNER JOIN academic_terms t ON t.id=oo.academic_term_id LEFT JOIN users u ON u.id=oo.user_id WHERE oo.org_id=:org AND t.school_year=:sy AND oo.status='Active' AND LOWER(oo.position) LIKE '%treasurer%' ORDER BY oo.academic_term_id DESC,oo.id DESC LIMIT 1");
    $st->execute([':org'=>$orgId,':sy'=>$sy]);
    $r = $st->fetch(PDO::FETCH_ASSOC);
    if ($r && !empty($r['user_id'])) return $r;
  }
  // any term
  $st = $pdo->prepare("SELECT oo.user_id,{$ne} AS full_name,oo.position,oo.academic_term_id FROM organization_officers oo LEFT JOIN users u ON u.id=oo.user_id WHERE oo.org_id=:org AND oo.status='Active' AND LOWER(oo.position) LIKE '%treasurer%' ORDER BY oo.academic_term_id DESC,oo.id DESC LIMIT 1");
  $st->execute([':org'=>$orgId]);
  $r = $st->fetch(PDO::FETCH_ASSOC);
  return $r ?: null;
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

function get_org_coordinator(PDO $pdo, int $orgId): ?array {
  if ($orgId <= 0) return null;
  $buildName = function(array $row): string {
    $fn = trim((string)($row['first_name']  ?? ''));
    $mn = trim((string)($row['middle_name'] ?? ''));
    $ln = trim((string)($row['last_name']   ?? ''));
    $sx = trim((string)($row['suffix']      ?? ''));
    $n  = trim($fn . ' ' . ($mn !== '' ? mb_substr($mn,0,1).'. ' : '') . $ln . ($sx !== '' ? ' '.$sx : ''));
    return $n !== '' ? $n : '—';
  };
  $st = $pdo->prepare("SELECT u.id,u.first_name,u.middle_name,u.last_name,u.suffix FROM organizations o INNER JOIN users u ON u.id=o.created_by WHERE o.id=:org AND u.role='faculty_admin' AND u.status='Active' LIMIT 1");
  $st->execute([':org'=>$orgId]);
  $row = $st->fetch(PDO::FETCH_ASSOC);
  if ($row) return ['id'=>(int)$row['id'],'name'=>$buildName($row)];
  $st = $pdo->prepare("SELECT id,first_name,middle_name,last_name,suffix FROM users WHERE role='faculty_admin' AND status='Active' ORDER BY last_login_at DESC,id DESC LIMIT 1");
  $st->execute();
  $row = $st->fetch(PDO::FETCH_ASSOC);
  if ($row) return ['id'=>(int)$row['id'],'name'=>$buildName($row)];
  return null;
}

function get_accomplishment_data(PDO $pdo, int $eventId): ?array {
  $chk = $pdo->query("SHOW TABLES LIKE 'event_accomplishments'");
  if (!$chk || $chk->rowCount() === 0) return null;
  $st = $pdo->prepare("SELECT objectives,outcomes,challenges,status,submitted_by,submitted_at,approved_by,approved_at,declined_reason,generated_pdf FROM event_accomplishments WHERE event_id=:eid LIMIT 1");
  $st->execute([':eid'=>$eventId]);
  $row = $st->fetch(PDO::FETCH_ASSOC);
  return $row ?: null;
}

/* ============================================================
   DATA FETCH
   ============================================================ */
$orgId  = (int)($event['org_id'] ?? 0);
$termId = ee_event_term_id($pdo, $event);

$schoolYear  = (string)($event['start_year'] . '–' . $event['end_year']);
$semester    = ee_semester_label_from_active_year((int)$event['active_year']);
$title       = trim((string)($event['title']       ?? ''));
$orgName     = trim((string)($event['org_label']   ?? ($event['org_name'] ?? '')));
$venue       = trim((string)($event['location']    ?? ''));
$eventDate   = trim((string)($event['event_date']  ?? ''));
$description = trim((string)($event['description'] ?? ''));

// Proposed expenses
$proposedItems = [];
$proposedTotal = 0.00;
try {
  $chk = $pdo->query("SHOW TABLES LIKE 'event_proposed_expenses'");
  if ($chk && $chk->rowCount() > 0) {
    $st = $pdo->prepare("SELECT description,quantity,estimated_cost,notes FROM event_proposed_expenses WHERE event_id=:eid ORDER BY id ASC");
    $st->execute([':eid'=>$eventId]);
    $proposedItems = $st->fetchAll(PDO::FETCH_ASSOC) ?: [];
    $stT = $pdo->prepare("SELECT COALESCE(SUM(quantity*estimated_cost),0) FROM event_proposed_expenses WHERE event_id=:eid");
    $stT->execute([':eid'=>$eventId]);
    $proposedTotal = (float)($stT->fetchColumn() ?: 0);
  }
} catch (\Throwable $e) {}

// Proposed funds (credits)
$proposedFundsItems = [];
$proposedFundsTotal = 0.00;
try {
  $chk = $pdo->query("SHOW TABLES LIKE 'event_proposed_credits'");
  if ($chk && $chk->rowCount() > 0) {
    $st = $pdo->prepare("SELECT description,amount,notes FROM event_proposed_credits WHERE event_id=:eid ORDER BY id ASC");
    $st->execute([':eid'=>$eventId]);
    $proposedFundsItems = $st->fetchAll(PDO::FETCH_ASSOC) ?: [];
    $stT = $pdo->prepare("SELECT COALESCE(SUM(amount),0) FROM event_proposed_credits WHERE event_id=:eid");
    $stT->execute([':eid'=>$eventId]);
    $proposedFundsTotal = (float)($stT->fetchColumn() ?: 0);
  }
} catch (\Throwable $e) {}

// Actuals
$debits       = ee_fetch_debits($pdo, $eventId);
$actualTotal  = 0.00;
foreach ($debits as $d) $actualTotal += (float)($d['amount'] ?? 0);

$credits      = ee_fetch_credits($pdo, $eventId);
$creditsTotal = 0.00;
foreach ($credits as $c) $creditsTotal += (float)($c['amount'] ?? 0);
$balance = $creditsTotal - $actualTotal;

// Accomplishment narrative
$accomplishment    = get_accomplishment_data($pdo, $eventId);
$objectivesText    = trim((string)($accomplishment['objectives']  ?? ''));
$outcomesText      = trim((string)($accomplishment['outcomes']    ?? ''));
$challengesText    = trim((string)($accomplishment['challenges']  ?? ''));

if ($objectivesText  === '') $objectivesText  = 'No objectives recorded.';
if ($outcomesText    === '') $outcomesText    = 'No outcomes recorded.';
if ($challengesText  === '') $challengesText  = 'No challenges recorded.';

/* ============================================================
   SIGNERS
   ============================================================ */
$treasurer   = ($orgId > 0 && $termId > 0) ? get_org_treasurer($pdo, $orgId, $termId)  : null;
$president   = ($orgId > 0 && $termId > 0) ? get_org_president($pdo, $orgId, $termId)  : null;
$coordinator = get_org_coordinator($pdo, $orgId);

$treasurerName   = $treasurer   ? trim((string)($treasurer['full_name']  ?? '')) : '';
$presidentName   = $president   ? trim((string)($president['full_name']  ?? '')) : '';
$coordinatorName = $coordinator ? (string)$coordinator['name'] : '—';

$treasurerSigHtml = $presidentSigHtml = $coordinatorSigHtml = '';
if ($treasurer   && !empty($treasurer['user_id']))   { $sig = get_active_signature_file($pdo,(int)$treasurer['user_id']);   if ($sig) $treasurerSigHtml   = img_tag_base64_local($sig,'sig-img','Treasurer Signature'); }
if ($president   && !empty($president['user_id']))   { $sig = get_active_signature_file($pdo,(int)$president['user_id']);   if ($sig) $presidentSigHtml   = img_tag_base64_local($sig,'sig-img','President Signature'); }
if ($coordinator && !empty($coordinator['id']))      { $sig = get_active_signature_file($pdo,(int)$coordinator['id']);      if ($sig) $coordinatorSigHtml = img_tag_base64_local($sig,'sig-img','Coordinator Signature'); }

/* ============================================================
   PDF RENDER
   ============================================================ */
try {
  while (ob_get_level() > 0) { @ob_end_clean(); }

  $mpdf = ee_mpdf(true);
  $mpdf->SetTitle('Accomplishment Report');

  $peso = fn(float $n): string => '₱' . number_format($n, 2, '.', ',');

  /* ---- Proposed expenses rows ---- */
  $proposedRowsHtml = '';
  if (!$proposedItems) {
    $proposedRowsHtml = '<tr><td colspan="4" class="empty-row">No proposed expenses submitted.</td></tr>';
  } else {
    $i = 1;
    foreach ($proposedItems as $item) {
      $desc  = h2((string)($item['description']   ?? ''));
      $notes = h2(trim((string)($item['notes']     ?? '')));
      $qty   = (int)($item['quantity']             ?? 1);
      $cost  = (float)($item['estimated_cost']     ?? 0);
      $total = $qty * $cost;
      $stripe = ($i % 2 === 0) ? ' class="stripe"' : '';
      $proposedRowsHtml .= '<tr' . $stripe . '>';
      $proposedRowsHtml .= '<td class="cell-num">' . $i . '</td>';
      $proposedRowsHtml .= '<td>' . $desc . ($notes !== '' ? '<br><span class="sub-note">' . $notes . '</span>' : '') . '</td>';
      $proposedRowsHtml .= '<td class="cell-center">' . $qty . '</td>';
      $proposedRowsHtml .= '<td class="cell-money">' . h2($peso($cost)) . '</td>';
      $proposedRowsHtml .= '<td class="cell-money">' . h2($peso($total)) . '</td>';
      $proposedRowsHtml .= '</tr>';
      $i++;
    }
  }

  /* ---- Narrative bullet builder ---- */
  $toBullets = function(string $text): string {
    $lines = array_filter(array_map('trim', explode("\n", $text)));
    if (!$lines) return '<li>—</li>';
    return implode('', array_map(fn($l) => '<li>' . h2($l) . '</li>', $lines));
  };

  /* ---- Proposed funds rows ---- */
  $proposedFundsRowsHtml = '';
  if (!$proposedFundsItems) {
    $proposedFundsRowsHtml = '<tr><td colspan="3" class="empty-row">No proposed fund sources submitted.</td></tr>';
  } else {
    $i = 1;
    foreach ($proposedFundsItems as $item) {
      $desc  = h2((string)($item['description'] ?? ''));
      $notes = h2(trim((string)($item['notes']   ?? '')));
      $amt   = (float)($item['amount']            ?? 0);
      $stripe = ($i % 2 === 0) ? ' class="stripe"' : '';
      $proposedFundsRowsHtml .= '<tr' . $stripe . '>';
      $proposedFundsRowsHtml .= '<td class="cell-num">' . $i . '</td>';
      $proposedFundsRowsHtml .= '<td>' . $desc . ($notes !== '' ? '<br><span class="sub-note">' . $notes . '</span>' : '') . '</td>';
      $proposedFundsRowsHtml .= '<td class="cell-money">' . h2($peso($amt)) . '</td>';
      $proposedFundsRowsHtml .= '</tr>';
      $i++;
    }
  }

  /* ---- Variance ---- */
  $variance      = $actualTotal - $proposedTotal;
  $varianceClass = $variance <= 0 ? 'var-pos' : 'var-neg';
  $balanceClass  = $balance  >= 0 ? 'surplus'  : 'deficit';

  /* ============================================================
     CSS
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

/* ── Info grid (Part A) ─── */
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

/* ── Narrative content box ─── */
.content-box {
  border-left: 3pt solid #1a3a5c;
  background: #f3f7fb;
  padding: 3mm 5mm;
  margin-bottom: 1.5mm;
  font-size: 10.5pt;
  line-height: 1.7;
}
.content-box ul {
  margin: 0;
  padding-left: 5mm;
}
.content-box ul li {
  margin-bottom: 1.5mm;
}

/* ── Financial summary cards ─── */
table.fin-cards {
  width: 100%;
  border-collapse: collapse;
  margin: 2mm 0 1.5mm 0;
}
table.fin-cards td {
  width: 20%;
  text-align: center;
  padding: 3mm 2mm;
  border: 1pt solid #c0d0e0;
  vertical-align: middle;
}
.fin-label {
  font-family: Arial, sans-serif;
  font-size: 7.5pt;
  color: #5a7a9a;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  display: block;
  margin-bottom: 1.5mm;
}
.fin-value {
  font-family: "Courier New", Courier, monospace;
  font-size: 12pt;
  font-weight: 700;
  color: #1a1a2e;
}
.surplus { color: #1a6b3a; }
.deficit { color: #9b1a1a; }
.var-pos { color: #1a6b3a; }
.var-neg { color: #9b1a1a; }

/* ── Generic data grid ─── */
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

/* ── Cell helpers ─── */
.cell-num    { text-align:center; color:#7a9ab8; font-size:8pt; width:4%; }
.cell-center { text-align:center; }
.cell-money  { text-align:right; white-space:nowrap; font-family:"Courier New",Courier,monospace; font-size:9.5pt; }
.empty-row   { text-align:center; color:#aaa; font-style:italic; padding:6mm; }
.sub-note    { font-size:8pt; color:#777; font-style:italic; }

/* ── Certification box ─── */
.cert-box {
  border-left: 4pt solid #1a3a5c;
  background: #f3f7fb;
  padding: 4mm 6mm;
  margin: 1.5mm 0 2mm 0;
  font-size: 10.5pt;
  line-height: 1.7;
}

/* ── Signatures ─── */
table.sign-tbl {
  width: 100%;
  border-collapse: collapse;
  margin-top: 6mm;
}
table.sign-tbl td {
  width: 33.333%;
  text-align: center;
  vertical-align: bottom;
  padding: 0 6mm;
}
.sig-img {
  max-width: 150px; max-height: 50px;
  display: block; margin: 0 auto 1mm auto;
  object-fit: contain;
}
.sig-line {
  border-top: 1.5pt solid #1a3a5c;
  width: 80%; margin: 0 auto 2.5mm auto;
}
.sig-name {
  font-family: Arial, sans-serif;
  font-size: 10pt; font-weight: 700;
  text-transform: uppercase; margin-bottom: 1mm;
}
.sig-pos {
  font-family: Arial, sans-serif;
  font-size: 8.5pt; color: #1a3a5c; font-weight: 700; margin-bottom: 0.5mm;
}
.sig-role {
  font-family: Arial, sans-serif;
  font-size: 7.5pt; color: #999;
  text-transform: uppercase; letter-spacing: 0.5px;
}
.sig-date {
  font-family: Arial, sans-serif;
  font-size: 8pt; color: #555; margin-top: 3.5mm;
}

/* ── Footer ─── */
hr.footer-hr {
  border: none; border-top: 1.5pt solid #c0d0e0;
  margin-top: 6mm; margin-bottom: 0;
}
</style>
CSS;

  /* ============================================================
     ESCAPED VALUES
     ============================================================ */
  $titleEsc          = h2($title      !== '' ? $title      : '—');
  $orgEsc            = h2($orgName    !== '' ? $orgName    : '—');
  $venueEsc          = h2($venue      !== '' ? $venue      : '—');
  $dateEsc           = h2($eventDate  !== '' ? date('F j, Y', strtotime($eventDate)) : '—');
  $syEsc             = h2('SY ' . $schoolYear);
  $semEsc            = h2($semester);
  $descEsc           = nl2br(h2($description !== '' ? $description : 'No description provided.'));
  $preparedDateEsc   = h2(date('F j, Y'));

  $treasurerNameEsc  = h2($treasurerName   !== '' ? strtoupper($treasurerName)   : '—');
  $presidentNameEsc  = h2($presidentName   !== '' ? strtoupper($presidentName)   : '—');
  $coordinatorNameEsc = h2($coordinatorName !== '' ? strtoupper($coordinatorName) : '—');

  /* ============================================================
     HTML
     ============================================================ */
  $html = $css . '

  <!-- ══════════════ TITLE ══════════════ -->
  <div class="doc-title-wrap">
    <div class="doc-title">Accomplishment Report</div>
    <div class="doc-subtitle">Post-Activity Report &mdash; Organization Event</div>
  </div>

  <!-- ══════════════ PART A — BASIC INFO ══════════════ -->
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
      <td class="lbl">Date of Activity</td>
      <td class="val">' . $dateEsc . '</td>
    </tr>
    <tr>
      <td class="lbl">Date Prepared</td>
      <td class="val" colspan="3">' . $preparedDateEsc . '</td>
    </tr>
  </table>

  <!-- ══════════════ PART B — EVENT DESCRIPTION ══════════════ -->
  <div class="part-heading">Part B &mdash; Event Description</div>
  <div class="content-box">' . $descEsc . '</div>

  <!-- ══════════════ PART C — OBJECTIVES ══════════════ -->
  <div class="part-heading">Part C &mdash; Objectives Achieved</div>
  <div class="content-box">
    <ul>' . $toBullets($objectivesText) . '</ul>
  </div>

  <!-- ══════════════ PART D — OUTCOMES ══════════════ -->
  <div class="part-heading">Part D &mdash; Outcomes and Accomplishments</div>
  <div class="content-box">
    <ul>' . $toBullets($outcomesText) . '</ul>
  </div>

  <!-- ══════════════ PART E — CHALLENGES ══════════════ -->
  <div class="part-heading">Part E &mdash; Challenges and Recommendations</div>
  <div class="content-box">' . nl2br(h2($challengesText)) . '</div>

  <!-- ══════════════ PART F — FINANCIAL SUMMARY ══════════════ -->
  <div class="part-heading">Part F &mdash; Financial Summary</div>
  <div class="part-note">Summary of proposed vs. actual funds and expenses for this activity.</div>
  <table class="fin-cards">
    <tr>
      <td>
        <span class="fin-label">Proposed Funds</span>
        <span class="fin-value">' . h2($peso($proposedFundsTotal)) . '</span>
      </td>
      <td>
        <span class="fin-label">Proposed Expenses</span>
        <span class="fin-value">' . h2($peso($proposedTotal)) . '</span>
      </td>
      <td>
        <span class="fin-label">Actual Expenses</span>
        <span class="fin-value">' . h2($peso($actualTotal)) . '</span>
      </td>
      <td>
        <span class="fin-label">Variance (Actual &minus; Proposed)</span>
        <span class="fin-value ' . $varianceClass . '">'
          . ($variance > 0 ? '+' : '') . h2($peso($variance)) . '</span>
      </td>
      <td>
        <span class="fin-label">Net Balance</span>
        <span class="fin-value ' . $balanceClass . '">' . h2($peso($balance)) . '</span>
      </td>
    </tr>
  </table>

  <!-- ══════════════ PART G — PROPOSED FUNDS BREAKDOWN ══════════════ -->
  <div class="part-heading">Part G &mdash; Proposed Funds Breakdown</div>
  <div class="part-note">Fund sources as submitted in the Activity Proposal.</div>
  <table class="grid">
    <thead>
      <tr>
        <th style="width:5%;">#</th>
        <th style="width:75%; text-align:left; padding-left:5px;">Source / Description</th>
        <th style="width:20%;">Proposed Amount</th>
      </tr>
    </thead>
    <tbody>' . $proposedFundsRowsHtml . '</tbody>
    <tfoot>
      <tr>
        <td colspan="2" style="text-align:right; padding-right:8px;">Total Proposed Funds</td>
        <td class="cell-money">' . h2($peso($proposedFundsTotal)) . '</td>
      </tr>
    </tfoot>
  </table>

  <!-- ══════════════ PART H — PROPOSED EXPENSES BREAKDOWN ══════════════ -->
  <div class="part-heading">Part H &mdash; Proposed Expenses Breakdown</div>
  <div class="part-note">Expense items as submitted in the Activity Proposal.</div>
  <table class="grid">
    <thead>
      <tr>
        <th style="width:5%;">#</th>
        <th style="width:54%; text-align:left; padding-left:5px;">Item Description</th>
        <th style="width:9%;">Qty</th>
        <th style="width:16%;">Unit Cost</th>
        <th style="width:16%;">Proposed Amount</th>
      </tr>
    </thead>
    <tbody>' . $proposedRowsHtml . '</tbody>
    <tfoot>
      <tr>
        <td colspan="4" style="text-align:right; padding-right:8px;">Total Proposed Expenses</td>
        <td class="cell-money">' . h2($peso($proposedTotal)) . '</td>
      </tr>
    </tfoot>
  </table>

  <!-- ══════════════ PART I — CERTIFICATION ══════════════ -->
  <div class="part-heading">Part I &mdash; Certification</div>
  <div class="cert-box">
    This is to certify that the above information is true and correct to the best of our knowledge
    and belief. The activities described herein were actually conducted as planned, and the expenses
    listed were actually incurred for the conduct of the said event. Supporting documents are
    attached for verification.
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
        ' . ($coordinatorSigHtml !== '' ? $coordinatorSigHtml : '<div style="height:50px;"></div>') . '
        <div class="sig-line"></div>
        <div class="sig-name">' . $coordinatorNameEsc . '</div>
        <div class="sig-pos">Organization Coordinator</div>
        <div class="sig-role">Noted by</div>
        <div class="sig-date">Date: _____________________</div>
      </td>
    </tr>
  </table>

  <hr class="footer-hr">
  ';

  $mpdf->WriteHTML($html);
  $mpdf->Output('accomplishment-report.pdf', 'I');
  exit;

} catch (\Throwable $e) {
  http_response_code(500);
  header('Content-Type:text/plain; charset=utf-8');
  echo "PDF generation failed.\n" . $e->getMessage();
  exit;
}
