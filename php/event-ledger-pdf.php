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
$tot = ee_totals($pdo, $eventId);

$sy = (string)($event['start_year'] . '-' . $event['end_year']);
$sem = ee_semester_label_from_active_year((int)$event['active_year']);

$mpdf = ee_mpdf(true);
$mpdf->SetTitle('Event Ledger');

$h = ee_html_escape((string)($event['title'] ?? 'Event'));
$org = ee_html_escape((string)($event['org_label'] ?? ''));
$status = ee_html_escape((string)($event['status'] ?? ''));
$meta = "{$org} · {$sy} · {$sem}";

$html = ee_base_css();
$html .= "<div class='h1'>Event Ledger</div>";
$html .= "<div class='meta'><span class='muted'>{$meta}</span> &nbsp; <span class='badge'>{$status}</span><br><span class='muted'>{$h}</span></div>";
$html .= "<div class='hr'></div>";

$html .= "<table>
  <thead>
    <tr>
      <th style='width:12%'>Date</th>
      <th style='width:10%'>Type</th>
      <th>Description</th>
      <th style='width:12%' class='text-right'>Credit</th>
      <th style='width:12%' class='text-right'>Debit</th>
      <th style='width:14%' class='text-right'>Balance</th>
      <th style='width:14%'>Ref</th>
    </tr>
  </thead>
  <tbody>";

if (!$rows) {
  $html .= "<tr><td colspan='7' class='text-center muted'>No ledger entries.</td></tr>";
} else {
  foreach ($rows as $r) {
    $d = ee_html_escape((string)($r['txn_date'] ?? ''));
    $t = ee_html_escape((string)($r['txn_type'] ?? ''));
    $desc = trim((string)($r['title'] ?? '') . (empty($r['notes']) ? '' : ' - ' . (string)$r['notes']));
    $desc = ee_html_escape($desc);
    $cr = (float)($r['amount_in'] ?? 0);
    $dr = (float)($r['amount_out'] ?? 0);
    $bal = (float)($r['balance_after'] ?? 0);
    $ref = ee_html_escape((string)($r['ref_table'] ?? '') . '#' . (string)($r['ref_id'] ?? ''));
    $html .= "<tr>
      <td>{$d}</td>
      <td>{$t}</td>
      <td>{$desc}</td>
      <td class='text-right'>".($cr>0?ee_money($cr):'')."</td>
      <td class='text-right'>".($dr>0?ee_money($dr):'')."</td>
      <td class='text-right'>".ee_money($bal)."</td>
      <td>{$ref}</td>
    </tr>";
  }
}

$html .= "</tbody>
  <tfoot class='totals'>
    <tr>
      <td colspan='3' class='text-right'>Totals</td>
      <td class='text-right'>".ee_money((float)$tot['credits'])."</td>
      <td class='text-right'>".ee_money((float)$tot['debits'])."</td>
      <td class='text-right'>".ee_money((float)$tot['balance'])."</td>
      <td></td>
    </tr>
  </tfoot>
</table>";

$html .= "<div class='hr'></div>";
$html .= "<div class='footer'>".ee_stamp_line()."</div>";

$mpdf->WriteHTML($html);
$mpdf->Output('event-ledger.pdf', 'I');