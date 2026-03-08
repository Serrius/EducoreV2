<?php
declare(strict_types=1);

ini_set('display_errors', '0');
ini_set('log_errors', '1');
error_reporting(E_ALL);

session_start();
require_once __DIR__ . '/_mpdf_common.php'; // provides $pdo + ee_mpdf() + helpers

ee_require_login();

$eventId = (int)($_GET['event_id'] ?? 0);
if ($eventId <= 0) { http_response_code(400); header('Content-Type:text/plain; charset=utf-8'); echo 'Missing event_id.'; exit; }

$event = ee_fetch_event($pdo, $eventId);
if (!$event) { http_response_code(404); header('Content-Type:text/plain; charset=utf-8'); echo 'Event not found.'; exit; }

if (!ee_can_view_event($pdo, $event)) { http_response_code(403); header('Content-Type:text/plain; charset=utf-8'); echo 'Forbidden.'; exit; }

// Allow viewing accomplishment report if it exists (even if not approved yet)
if ((string)($event['accomplishment_status'] ?? '') === 'Locked') {
  http_response_code(403);
  header('Content-Type:text/plain; charset=utf-8');
  echo 'No accomplishment report submitted yet.';
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

/* =========================
   School year helper
   ========================= */
function school_year_for_term(PDO $pdo, int $termId): string {
  if ($termId <= 0) return '';
  $st = $pdo->prepare("SELECT school_year FROM academic_terms WHERE id = :id LIMIT 1");
  $st->execute([':id' => $termId]);
  $r = $st->fetch(PDO::FETCH_ASSOC);
  return trim((string)($r['school_year'] ?? ''));
}

/* =========================
   Get org president (STRICT: not VP)
   ========================= */
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

  // school_year fallback
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
   Get faculty_admin (org coordinator/creator)
   ========================= */
function get_org_coordinator(PDO $pdo, int $orgId): ?array {
  if ($orgId <= 0) return null;

  // First, try to get the faculty_admin who created the org
  $st = $pdo->prepare("
    SELECT u.id, u.first_name, u.middle_name, u.last_name, u.suffix
    FROM organizations o
    INNER JOIN users u ON u.id = o.created_by
    WHERE o.id = :org_id
      AND u.role = 'faculty_admin'
      AND u.status = 'Active'
    LIMIT 1
  ");
  $st->execute([':org_id' => $orgId]);
  $row = $st->fetch(PDO::FETCH_ASSOC);
  
  if ($row) {
    $id = (int)($row['id'] ?? 0);
    $fn = trim((string)($row['first_name'] ?? ''));
    $mn = trim((string)($row['middle_name'] ?? ''));
    $ln = trim((string)($row['last_name'] ?? ''));
    $sx = trim((string)($row['suffix'] ?? ''));
    
    $name = trim($fn . ' ' . ($mn !== '' ? mb_substr($mn, 0, 1) . '. ' : '') . $ln . ($sx !== '' ? ' ' . $sx : ''));
    if ($name === '') $name = '—';
    
    return ['id' => $id, 'name' => $name];
  }
  
  // Fallback: find any active faculty_admin
  $st = $pdo->prepare("
    SELECT id, first_name, middle_name, last_name, suffix
    FROM users
    WHERE role = 'faculty_admin' AND status = 'Active'
    ORDER BY last_login_at DESC, id DESC
    LIMIT 1
  ");
  $st->execute();
  $row = $st->fetch(PDO::FETCH_ASSOC);
  
  if ($row) {
    $id = (int)($row['id'] ?? 0);
    $fn = trim((string)($row['first_name'] ?? ''));
    $mn = trim((string)($row['middle_name'] ?? ''));
    $ln = trim((string)($row['last_name'] ?? ''));
    $sx = trim((string)($row['suffix'] ?? ''));
    
    $name = trim($fn . ' ' . ($mn !== '' ? mb_substr($mn, 0, 1) . '. ' : '') . $ln . ($sx !== '' ? ' ' . $sx : ''));
    if ($name === '') $name = '—';
    
    return ['id' => $id, 'name' => $name];
  }
  
  return null;
}

/* =========================
   Fetch data
   ========================= */
$orgId  = (int)($event['org_id'] ?? 0);
$termId = ee_event_term_id($pdo, $event);

$schoolYear = (string)($event['start_year'] . '-' . $event['end_year']);
$semester   = ee_semester_label_from_active_year((int)$event['active_year']);

$title   = trim((string)($event['title'] ?? ''));
$orgName = trim((string)($event['org_label'] ?? ($event['org_name'] ?? '')));
$venue   = trim((string)($event['location'] ?? ''));
$eventDate = trim((string)($event['event_date'] ?? ''));
$description = trim((string)($event['description'] ?? ''));

// Get proposed expenses if any
$proposedItems = [];
$proposedTotal = 0.00;
try {
  $stCheck = $pdo->query("SHOW TABLES LIKE 'event_proposed_expenses'");
  if ($stCheck && $stCheck->rowCount() > 0) {
    $st = $pdo->prepare("
      SELECT description, quantity, estimated_cost
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

// Get actual expenses (for Proposed vs Actual comparison)
$debits = ee_fetch_debits($pdo, $eventId);
$actualTotal = 0.00;
foreach ($debits as $d) {
  $actualTotal += (float)($d['amount'] ?? 0);
}

/* =========================
   Signers
   Prepared by: Treasurer
   Checked by: Org President
   Noted by: Org Coordinator (faculty_admin)
   ========================= */
$treasurer = ($orgId > 0 && $termId > 0) ? ee_get_officer($pdo, $orgId, $termId, 'treasurer') : null;
$president = ($orgId > 0 && $termId > 0) ? get_org_president($pdo, $orgId, $termId) : null;
$coordinator = get_org_coordinator($pdo, $orgId);

$treasurerName = $treasurer ? trim((string)($treasurer['full_name'] ?? '')) : '';
$presidentName = $president ? trim((string)($president['full_name'] ?? '')) : '';
$coordinatorName = $coordinator ? (string)$coordinator['name'] : '—';

$treasurerSigHtml = '';
$presidentSigHtml = '';
$coordinatorSigHtml = '';

if ($treasurer && !empty($treasurer['user_id'])) {
  $sig = get_active_signature_file($pdo, (int)$treasurer['user_id']);
  if ($sig) $treasurerSigHtml = img_tag_base64_local($sig, 'sig-img', 'Treasurer Signature');
}
if ($president && !empty($president['user_id'])) {
  $sig = get_active_signature_file($pdo, (int)$president['user_id']);
  if ($sig) $presidentSigHtml = img_tag_base64_local($sig, 'sig-img', 'President Signature');
}
if ($coordinator && !empty($coordinator['id'])) {
  $sig = get_active_signature_file($pdo, (int)$coordinator['id']);
  if ($sig) $coordinatorSigHtml = img_tag_base64_local($sig, 'sig-img', 'Coordinator Signature');
}

/* =========================
   Render PDF (letterhead ON)
   ========================= */
try {
  while (ob_get_level() > 0) { @ob_end_clean(); }

  $mpdf = ee_mpdf(true);
  $mpdf->SetTitle('Accomplishment Report');

  $peso = function(float $n): string {
    return '₱' . number_format($n, 2, '.', ',');
  };

  // Build proposed expenses table
  $proposedRowsHtml = '';
  if (!$proposedItems) {
    $proposedRowsHtml .= '<tr><td colspan="4" class="center muted">No proposed expenses submitted.</td></tr>';
  } else {
    $i = 1;
    foreach ($proposedItems as $item) {
      $desc = h2((string)($item['description'] ?? ''));
      $qty = (int)($item['quantity'] ?? 1);
      $cost = (float)($item['estimated_cost'] ?? 0);
      
      $proposedRowsHtml .= '<tr>';
      $proposedRowsHtml .= '<td class="center">' . $i . '</td>';
      $proposedRowsHtml .= '<td>' . $desc . '</td>';
      $proposedRowsHtml .= '<td class="center">' . $qty . '</td>';
      $proposedRowsHtml .= '<td class="money">' . h2($peso($cost)) . '</td>';
      $proposedRowsHtml .= '</tr>';
      $i++;
    }
  }

  // Build Proposed vs Actual comparison table
  $variance = $proposedTotal - $actualTotal;
  $varianceStatus = $variance >= 0 ? 'within' : 'above';
  
  $comparisonRowsHtml = '';
  $comparisonRowsHtml .= '<tr>';
  $comparisonRowsHtml .= '<td class="label-cell">Total Proposed Budget</td>';
  $comparisonRowsHtml .= '<td class="money">' . h2($peso($proposedTotal)) . '</td>';
  $comparisonRowsHtml .= '</tr>';
  $comparisonRowsHtml .= '<tr>';
  $comparisonRowsHtml .= '<td class="label-cell">Total Actual Expenses</td>';
  $comparisonRowsHtml .= '<td class="money">' . h2($peso($actualTotal)) . '</td>';
  $comparisonRowsHtml .= '</tr>';
  $comparisonRowsHtml .= '<tr class="highlight">';
  $comparisonRowsHtml .= '<td class="label-cell fw-bold">Variance (Proposed - Actual)</td>';
  $comparisonRowsHtml .= '<td class="money fw-bold">' . h2($peso($variance)) . '</td>';
  $comparisonRowsHtml .= '</tr>';

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

  .sec { font-weight: 700; font-size: 12.5pt; margin: 6mm 0 3mm; letter-spacing: 0.3px; border-bottom: 1px solid #999; padding-bottom: 2mm; }

  .desc-box { 
    border: 1px solid #999; 
    padding: 4mm; 
    margin: 3mm 0 5mm 0; 
    background: #fcfcfc;
    font-size: 11pt;
    line-height: 1.5;
  }
  .desc-label {
    font-weight: 700;
    margin-bottom: 2mm;
    font-size: 11.5pt;
  }

  table.grid { width: 100%; border-collapse: collapse; table-layout: fixed; }
  table.grid th, table.grid td { border: 1px solid #999; padding: 6px 7px; font-size: 10.5pt; }
  table.grid th { background: #f2f2f2; font-weight: 700; }

  .money { text-align: right; white-space: nowrap; font-family: 'Courier New', monospace; }
  .center { text-align: center; }
  .nowrap { white-space: nowrap; }
  .fw-bold { font-weight: 700; }
  .highlight { background: #f9f9f9; }

  table.compact { width: 60%; margin: 3mm auto 5mm auto; border-collapse: collapse; }
  table.compact td { padding: 4mm 2mm; border: 1px solid #999; }
  .label-cell { font-weight: 700; width: 70%; padding-left: 4mm; }

  .objectives-list {
    margin: 0 0 5mm 0;
    padding-left: 5mm;
  }
  .objectives-list li {
    margin-bottom: 2mm;
    line-height: 1.5;
  }

  .sign-row { width: 100%; margin-top: 10mm; border-collapse: collapse; table-layout: fixed; }
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

  .objectives-title {
    font-weight: 700;
    margin: 4mm 0 2mm 0;
    font-size: 11.5pt;
  }
</style>
CSS;

  $titleEsc = h2($title !== '' ? $title : '—');
  $orgEsc   = h2($orgName !== '' ? $orgName : '—');
  $venueEsc = h2($venue !== '' ? $venue : '—');
  $dateEsc  = h2($eventDate !== '' ? date('F j, Y', strtotime($eventDate)) : '—');
  $syEsc    = h2('SY ' . $schoolYear);
  $semEsc   = h2($semester);
  $descEsc  = nl2br(h2($description !== '' ? $description : 'No description provided.'));

  $treasurerNameEsc = h2($treasurerName !== '' ? $treasurerName : '—');
  $presidentNameEsc = h2($presidentName !== '' ? $presidentName : '—');
  $coordinatorNameEsc = h2($coordinatorName !== '' ? $coordinatorName : '—');

  $unders = '__________________________';

  $html = $css . '
    <div class="title">ACCOMPLISHMENT REPORT</div>

    <div class="meta-wrap">
      <table class="meta-table">
        <tr>
          <td class="meta-left">
            <div class="meta-line"><b>Event:</b> ' . $titleEsc . '</div>
            <div class="meta-line"><b>Organization:</b> ' . $orgEsc . '</div>
            <div class="meta-line"><b>Venue:</b> ' . $venueEsc . '</div>
          </td>
          <td class="meta-right">
            <div class="meta-line"><b>Date of Event:</b> ' . $dateEsc . '</div>
            <div class="meta-line"><b>School Year:</b> ' . $syEsc . '</div>
            <div class="meta-line"><b>Semester:</b> ' . $semEsc . '</div>
          </td>
        </tr>
      </table>
    </div>

    <div class="sec">I. EVENT OBJECTIVES AND DESCRIPTION</div>
    <div class="desc-box">
      <div class="desc-label">Event Description:</div>
      <div>' . $descEsc . '</div>
      
      <div class="objectives-title">Objectives:</div>
      <ul class="objectives-list">
        <li>To successfully conduct the ' . $titleEsc . ' as planned</li>
        <li>To ensure proper utilization of allocated funds (Proposed: ' . h2($peso($proposedTotal)) . ')</li>
        <li>To document all expenses and activities for transparency and accountability</li>
        <li>To achieve the expected outcomes and objectives of the activity</li>
      </ul>
      
      <div class="objectives-title">Expected Outcomes:</div>
      <ul class="objectives-list">
        <li>Successful execution of all event activities</li>
        <li>Proper documentation of all financial transactions</li>
        <li>Accurate liquidation report matching actual expenses</li>
        <li>Submission of complete requirements for administrative review</li>
      </ul>
    </div>

    <div class="sec">II. PROPOSED BUDGET BREAKDOWN</div>
    <table class="grid">
      <thead>
        <tr>
          <th style="width:8%;">#</th>
          <th style="width:57%;">Item Description</th>
          <th style="width:10%;">Qty</th>
          <th style="width:25%;">Estimated Cost</th>
        </tr>
      </thead>
      <tbody>
        ' . $proposedRowsHtml . '
      </tbody>
      <tfoot>
        <tr>
          <th colspan="3" style="text-align:right;">TOTAL PROPOSED BUDGET:</th>
          <th class="money">' . h2($peso($proposedTotal)) . '</th>
        </tr>
      </tfoot>
    </table>

    <div class="sec">III. PROPOSED vs. ACTUAL EXPENSES</div>
    <table class="compact">
      ' . $comparisonRowsHtml . '
    </table>

    <div class="sec">IV. OUTCOMES AND ACCOMPLISHMENTS</div>
    <div class="desc-box">
      <p>The event was successfully conducted on ' . $dateEsc . ' at ' . $venueEsc . '. 
      All planned activities were executed according to schedule. The organization has complied with 
      the financial documentation requirements, including the submission of receipts and supporting 
      documents for all expenses incurred.</p>
      
      <p>The expenses listed in this accomplishment report are fully supported by the attached 
      liquidation report and official receipts. The actual expenses amounted to ' . h2($peso($actualTotal)) . ', 
      which is <strong>' . $varianceStatus . '</strong> the proposed budget of ' . h2($peso($proposedTotal)) . ' (variance: ' . h2($peso($variance)) . ').</p>
      
      <p>This report serves as the official basis for verifying the expenses incurred during the activity,
      in accordance with USTP financial policies and procedures.</p>
    </div>

    <div class="sec">V. CERTIFICATION</div>
    <div class="desc-box">
      <p>This is to certify that the above information is true and correct to the best of my knowledge and belief.
      The expenses listed herein were actually incurred for the conduct of the said event, and the supporting
      documents are attached for verification.</p>
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
          ' . $coordinatorSigHtml . '
          <div class="sign-unders">' . $unders . '</div>
          <div class="sig-name">' . $coordinatorNameEsc . '</div>
          <div class="sig-role">Noted by:<br/>Organization Coordinator</div>
        </td>
      </tr>
    </table>
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