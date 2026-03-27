<?php
declare(strict_types=1);

session_start();
require_once __DIR__ . '/_mpdf_common.php';

ee_require_login();

$eventId = (int)($_GET['event_id'] ?? 0);
if ($eventId <= 0) { http_response_code(400); echo 'Missing event_id.'; exit; }

$event = ee_fetch_event($pdo, $eventId);
if (!$event) { http_response_code(404); echo 'Event not found.'; exit; }

if (!ee_can_view_event($pdo, $event)) { http_response_code(403); echo 'Forbidden.'; exit; }

$rows = ee_fetch_ledger($pdo, $eventId);
$tot  = ee_totals($pdo, $eventId);

// Fallback: ee_fetch_ledger queries passbook_logs but the actual entries live in
// event_credits and event_debits. Build a unified ledger from those tables directly.
if (empty($rows)) {
  try {
    $merged = [];

    // Pull credits
    $st = $pdo->prepare("
      SELECT id, credit_date AS txn_date, 'credit' AS txn_type,
             source AS title, notes, amount AS amount_in, 0 AS amount_out,
             'credit' AS ref_table
      FROM event_credits
      WHERE event_id = :eid
      ORDER BY credit_date ASC, id ASC
    ");
    $st->execute([':eid' => $eventId]);
    $merged = array_merge($merged, $st->fetchAll(PDO::FETCH_ASSOC) ?: []);

    // Pull debits
    $st = $pdo->prepare("
      SELECT id, debit_date AS txn_date, 'debit' AS txn_type,
             category AS title, notes, 0 AS amount_in, amount AS amount_out,
             'debit' AS ref_table
      FROM event_debits
      WHERE event_id = :eid
      ORDER BY debit_date ASC, id ASC
    ");
    $st->execute([':eid' => $eventId]);
    $merged = array_merge($merged, $st->fetchAll(PDO::FETCH_ASSOC) ?: []);

    if (!empty($merged)) {
      // Sort by date then type (credits before debits on same day)
      usort($merged, function($a, $b) {
        $dc = strcmp((string)($a['txn_date'] ?? ''), (string)($b['txn_date'] ?? ''));
        if ($dc !== 0) return $dc;
        // credits first
        if ($a['txn_type'] === 'credit' && $b['txn_type'] !== 'credit') return -1;
        if ($b['txn_type'] === 'credit' && $a['txn_type'] !== 'credit') return 1;
        return ($a['id'] ?? 0) - ($b['id'] ?? 0);
      });

      // Compute running balance_after for each row
      $running = 0.0;
      foreach ($merged as &$row) {
        $running += (float)($row['amount_in'] ?? 0) - (float)($row['amount_out'] ?? 0);
        $row['balance_after'] = $running;
        $row['ref_id']        = $row['id'];
      }
      unset($row);

      $rows = $merged;
      $tot['credits'] = array_sum(array_column($rows, 'amount_in'));
      $tot['debits']  = array_sum(array_column($rows, 'amount_out'));
      $tot['balance'] = (float)$tot['credits'] - (float)$tot['debits'];
    }
  } catch (\Throwable $e) {}
}

$sy      = (string)($event['start_year'] . '–' . $event['end_year']);
$sem     = ee_semester_label_from_active_year((int)$event['active_year']);
$title   = trim((string)($event['title']     ?? ''));
$org     = trim((string)($event['org_label'] ?? ($event['org_name'] ?? '')));
$status  = trim((string)($event['status']    ?? ''));
$venue   = trim((string)($event['location']  ?? ''));

function h2($s): string {
  return htmlspecialchars((string)($s ?? ''), ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
}

$peso = fn(float $n): string => '₱' . number_format($n, 2, '.', ',');

/* ── Row builder ── */
$rowsHtml = '';
if (!$rows) {
  $rowsHtml = '<tr><td colspan="7" class="empty-row">No ledger entries found.</td></tr>';
} else {
  $i = 1;
  foreach ($rows as $r) {
    $d    = h2((string)($r['txn_date']  ?? ''));
    $type = strtoupper(trim((string)($r['txn_type'] ?? '')));
    $typeClass = $type === 'CREDIT' ? 'badge-dep' : 'badge-with';

    $lTitle = h2(trim((string)($r['title'] ?? '')));
    $notes  = trim((string)($r['notes']   ?? ''));
    $desc   = $notes !== '' ? $lTitle . ' — ' . h2($notes) : $lTitle;
    if ($desc === '') $desc = '—';

    $cr  = (float)($r['amount_in']    ?? 0);
    $dr  = (float)($r['amount_out']   ?? 0);
    $bal = (float)($r['balance_after'] ?? 0);

    $refTable = trim((string)($r['ref_table'] ?? ''));
    $refId    = trim((string)($r['ref_id']    ?? ''));
    $ref      = ($refTable !== '' && $refId !== '') ? h2($refTable . '#' . $refId) : '—';

    $balClass = $bal >= 0 ? 'color-in' : 'color-out';
    $stripe   = ($i % 2 === 0) ? ' class="stripe"' : '';

    $rowsHtml .= '<tr' . $stripe . '>';
    $rowsHtml .= '<td class="cell-num">'    . $i . '</td>';
    $rowsHtml .= '<td class="cell-date">'   . $d . '</td>';
    $rowsHtml .= '<td class="cell-center"><span class="' . $typeClass . '">' . $type . '</span></td>';
    $rowsHtml .= '<td>'                     . $desc . '</td>';
    $rowsHtml .= '<td class="cell-money color-in">'  . ($cr > 0 ? h2($peso($cr)) : '—') . '</td>';
    $rowsHtml .= '<td class="cell-money color-out">' . ($dr > 0 ? h2($peso($dr)) : '—') . '</td>';
    $rowsHtml .= '<td class="cell-money ' . $balClass . '">' . h2($peso($bal)) . '</td>';
    $rowsHtml .= '<td class="cell-ref">'   . $ref . '</td>';
    $rowsHtml .= '</tr>';
    $i++;
  }
}

$totalCredits = (float)($tot['credits'] ?? 0);
$totalDebits  = (float)($tot['debits']  ?? 0);
$totalBalance = (float)($tot['balance'] ?? 0);
$balTotClass  = $totalBalance >= 0 ? 'color-in' : 'color-out';

$statusColor = match(strtolower($status)) {
  'approved'  => '#1a6b3a',
  'declined'  => '#9b1a1a',
  'submitted' => '#7a5c00',
  default     => '#1a3a5c',
};

/* ── CSS ── */
$css = <<<CSS
<style>
* { margin:0; padding:0; }

body {
  font-family: "Times New Roman", Times, serif;
  font-size: 10.5pt;
  color: #1a1a2e;
  background: #fff;
  line-height: 1.5;
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

/* ── Info grid ─── */
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

/* ── Status badge ─── */
.status-badge {
  font-family: Arial, sans-serif;
  font-size: 8pt;
  font-weight: 700;
  letter-spacing: 1px;
  text-transform: uppercase;
  color: {$statusColor};
  border: 1pt solid {$statusColor};
  padding: 0.5mm 3mm;
}

/* ── Summary cards ─── */
table.sum-cards {
  width: 100%;
  border-collapse: collapse;
  margin: 2mm 0 1.5mm 0;
}
table.sum-cards td {
  width: 33.333%;
  text-align: center;
  padding: 3mm 2mm;
  border: 1pt solid #c0d0e0;
  vertical-align: middle;
}
.sum-label {
  font-family: Arial, sans-serif;
  font-size: 7.5pt;
  color: #5a7a9a;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  display: block;
  margin-bottom: 1.5mm;
}
.sum-value {
  font-family: "Courier New", Courier, monospace;
  font-size: 12pt;
  font-weight: 700;
}

/* ── Part heading ─── */
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

/* ── Ledger table ─── */
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
  padding: 2.5mm 5px;
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
  padding: 2.5mm 5px;
}

/* ── Cell helpers ─── */
.cell-num    { text-align:center; color:#7a9ab8; font-size:8pt; width:4%; }
.cell-date   { white-space:nowrap; font-family:"Courier New",Courier,monospace; font-size:9pt; }
.cell-center { text-align:center; }
.cell-ref    { text-align:center; font-family:"Courier New",Courier,monospace; font-size:8pt; }
.cell-money  { text-align:right; white-space:nowrap; font-family:"Courier New",Courier,monospace; font-size:9.5pt; }
.color-in    { color:#1a6b3a; }
.color-out   { color:#9b1a1a; }
.empty-row   { text-align:center; color:#aaa; font-style:italic; padding:7mm; }

/* ── Type badges ─── */
.badge-dep {
  font-family:Arial,sans-serif; font-size:7pt; font-weight:700;
  color:#1a6b3a; border:1pt solid #1a6b3a; padding:0.5mm 2mm;
}
.badge-with {
  font-family:Arial,sans-serif; font-size:7pt; font-weight:700;
  color:#9b1a1a; border:1pt solid #9b1a1a; padding:0.5mm 2mm;
}

/* ── Footer ─── */
hr.footer-hr {
  border:none; border-top:1.5pt solid #c0d0e0;
  margin-top:5mm; margin-bottom:0;
}
</style>
CSS;

$titleEsc  = h2($title  !== '' ? $title  : '—');
$orgEsc    = h2($org    !== '' ? $org    : '—');
$venueEsc  = h2($venue  !== '' ? $venue  : '—');
$statusEsc = h2($status !== '' ? strtoupper($status) : '—');
$syEsc     = h2('SY ' . $sy);
$semEsc    = h2($sem);
$dateEsc   = h2(date('F j, Y'));

$mpdf = ee_mpdf(true);
$mpdf->SetTitle('Event Ledger');

$html = $css . '

  <!-- ══════════════ TITLE ══════════════ -->
  <div class="doc-title-wrap">
    <div class="doc-title">Event Ledger</div>
    <div class="doc-subtitle">Treasury Transaction Record &mdash; Organization Event</div>
  </div>

  <!-- ══════════════ EVENT INFO ══════════════ -->
  <table class="info-grid">
    <tr>
      <td class="lbl">Event</td>
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
      <td class="lbl">Date Printed</td>
      <td class="val">' . $dateEsc . '</td>
    </tr>
    <tr>
      <td class="lbl">Event Status</td>
      <td class="val" colspan="3"><span class="status-badge">' . $statusEsc . '</span></td>
    </tr>
  </table>

  <!-- ══════════════ SUMMARY CARDS ══════════════ -->
  <table class="sum-cards">
    <tr>
      <td>
        <span class="sum-label">Total Credits (Deposits)</span>
        <span class="sum-value color-in">' . h2($peso($totalCredits)) . '</span>
      </td>
      <td>
        <span class="sum-label">Total Debits (Withdrawals)</span>
        <span class="sum-value color-out">' . h2($peso($totalDebits)) . '</span>
      </td>
      <td>
        <span class="sum-label">Net Balance</span>
        <span class="sum-value ' . $balTotClass . '">' . h2($peso($totalBalance)) . '</span>
      </td>
    </tr>
  </table>

  <!-- ══════════════ LEDGER TABLE ══════════════ -->
  <div class="part-heading">Transaction Log</div>
  <div class="part-note">All deposits and withdrawals recorded for this event, in chronological order.</div>
  <table class="grid">
    <thead>
      <tr>
        <th style="width:4%;">#</th>
        <th style="width:10%;">Date</th>
        <th style="width:10%;">Type</th>
        <th style="width:34%; text-align:left; padding-left:5px;">Description</th>
        <th style="width:11%;">Credit (+)</th>
        <th style="width:11%;">Debit (&minus;)</th>
        <th style="width:12%;">Balance</th>
        <th style="width:8%;">Reference</th>
      </tr>
    </thead>
    <tbody>' . $rowsHtml . '</tbody>
    <tfoot>
      <tr>
        <td colspan="4" style="text-align:right; padding-right:8px;">Totals</td>
        <td class="cell-money color-in">'  . h2($peso($totalCredits))  . '</td>
        <td class="cell-money color-out">' . h2($peso($totalDebits))   . '</td>
        <td class="cell-money ' . $balTotClass . '">' . h2($peso($totalBalance)) . '</td>
        <td></td>
      </tr>
    </tfoot>
  </table>

  <hr class="footer-hr">
';

$mpdf->WriteHTML($html);
$mpdf->Output('event-ledger.pdf', 'I');
