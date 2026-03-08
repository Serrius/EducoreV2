<?php
declare(strict_types=1);

session_start();
require_once __DIR__ . '/_mpdf_common.php';

ee_require_login();

$orgId = (int)($_GET['org_id'] ?? 0);
$schoolYear = trim((string)($_GET['school_year'] ?? ''));
$semester = trim((string)($_GET['semester'] ?? ''));

if ($orgId <= 0) { http_response_code(400); echo 'Missing org_id.'; exit; }
if ($schoolYear === '' || $semester === '') {
  // Optional: you can default these on your JS by passing selected filters
  http_response_code(400);
  echo 'Missing school_year/semester.';
  exit;
}

// Permission: admin reviewers can print any org; otherwise must be officer-like.
// We reuse your list rules by checking event existence is not needed, but we can still enforce "officer role or student officer in current year".
// Keep it simple:
$uid = ee_current_user_id();
$role = ee_current_role();
if (!ee_can_review_events_role($role)) {
  if (!ee_is_officer_role($role) && $role !== 'student') {
    http_response_code(403); echo 'Forbidden.'; exit;
  }
  // If student, require they are an active officer in ANY term of the school year for this org
  if ($role === 'student') {
    $st = $pdo->prepare("
      SELECT 1
      FROM organization_officers oo
      INNER JOIN academic_terms t ON t.id = oo.academic_term_id
      WHERE oo.user_id=:uid
        AND oo.org_id=:org
        AND oo.status='Active'
        AND t.school_year=:sy
      LIMIT 1
    ");
    $st->execute([':uid'=>$uid, ':org'=>$orgId, ':sy'=>$schoolYear]);
    if (!(bool)$st->fetchColumn()) { http_response_code(403); echo 'Forbidden.'; exit; }
  }
}

// Get org label
$stO = $pdo->prepare("SELECT org_name, abbreviation FROM organizations WHERE id=:id LIMIT 1");
$stO->execute([':id'=>$orgId]);
$o = $stO->fetch(PDO::FETCH_ASSOC);
if (!$o) { http_response_code(404); echo 'Organization not found.'; exit; }
$orgLabel = trim((string)$o['org_name'] . (!empty($o['abbreviation']) ? ' (' . (string)$o['abbreviation'] . ')' : ''));

// Passbook rows (org-level running balance) - same logic as your API fetch_passbook()
preg_match('/^(\d{4})\s*-\s*(\d{4})$/', $schoolYear, $m);
$sy1 = isset($m[1]) ? (int)$m[1] : 0;
$sy2 = isset($m[2]) ? (int)$m[2] : 0;
if ($sy1<=0 || $sy2<=0) { http_response_code(400); echo 'Invalid school_year.'; exit; }

$ay = 1;
$semLc = strtolower($semester);
if (str_contains($semLc,'2')) $ay = 2;
elseif (str_contains($semLc,'summer')) $ay = 3;

$st = $pdo->prepare("
  SELECT p.id, p.txn_date, p.txn_type, p.title, p.notes, p.amount_in, p.amount_out, p.balance_after, p.ref_table, p.ref_id
  FROM passbook_logs p
  INNER JOIN event_events e ON e.id = p.event_id
  WHERE p.org_id = :org
    AND e.start_year = :sy1 AND e.end_year = :sy2 AND e.active_year = :ay
  ORDER BY p.txn_date ASC, p.id ASC
  LIMIT 5000
");
$st->execute([':org'=>$orgId, ':sy1'=>$sy1, ':sy2'=>$sy2, ':ay'=>$ay]);
$rows = $st->fetchAll(PDO::FETCH_ASSOC) ?: [];

$mpdf = ee_mpdf(false);
$mpdf->SetTitle('Organization Passbook');

$html = ee_base_css();
$html .= "<div class='h1'>Organization Passbook</div>";
$html .= "<div class='meta'><span class='muted'>".ee_html_escape($orgLabel)." · ".ee_html_escape($schoolYear)." · ".ee_html_escape($semester)."</span></div>";
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
  $html .= "<tr><td colspan='7' class='text-center muted'>No passbook logs.</td></tr>";
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

$html .= "</tbody></table>";
$html .= "<div class='hr'></div>";
$html .= "<div class='footer'>".ee_stamp_line()."</div>";

$mpdf->WriteHTML($html);
$mpdf->Output('org-passbook.pdf', 'I');
