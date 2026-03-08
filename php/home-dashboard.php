<?php
declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');

session_start();

require_once __DIR__ . '/db.php'; // expects $pdo (PDO)

if (!isset($pdo) || !($pdo instanceof PDO)) {
  http_response_code(500);
  echo json_encode(['success' => false, 'message' => 'PDO not initialized. Check php/db.php (expected $pdo).'], JSON_UNESCAPED_SLASHES);
  exit;
}
try { $pdo->exec("SET NAMES utf8mb4"); } catch (\Throwable $e) {}

function out(array $payload, int $code = 200): void {
  http_response_code($code);
  echo json_encode($payload, JSON_UNESCAPED_SLASHES);
  exit;
}
function ok(array $data = []): void { out(['success' => true] + $data); }
function fail(string $message, int $code = 400, array $extra = []): void {
  out(['success' => false, 'message' => $message] + $extra, $code);
}

/* =========================
   Auth (super_admin, special_admin, overseer only)
   ========================= */
$userId = (int)($_SESSION['user_id'] ?? 0);
$role   = (string)($_SESSION['role'] ?? '');
if ($userId <= 0) fail('Not logged in.', 401);
if ($role !== 'super_admin' && $role !== 'overseer' && $role !== 'special_admin' ) fail('Forbidden.', 403);

/* =========================
   Load ACTIVE academic term
   ========================= */
$stmt = $pdo->query("
  SELECT id, school_year, semester, status, created_at
  FROM academic_terms
  WHERE status='Active'
  ORDER BY created_at DESC, id DESC
  LIMIT 1
");
$term = $stmt->fetch(PDO::FETCH_ASSOC);

if (!$term) {
  ok([
    'user' => ['id' => $userId, 'role' => $role],
    'term' => null,
    'kpis' => [
      'active_orgs' => 0,
      'org_fees_total' => 0,
      'event_credits' => 0,
      'event_debits' => 0,
    ],
    'charts' => [
      'org_fees' => ['labels' => [], 'values' => []],
      'event_funds' => ['labels' => [], 'credits' => [], 'debits' => []],
    ],
    'top_events' => [],
  ]);
}

$termId     = (int)$term['id'];
$schoolYear = (string)$term['school_year'];
$semester   = (string)$term['semester'];

/* =========================
   Canonical term for the school_year
   Prefer 2nd semester term_id if it exists.
   (This matches your "record on 2nd semester entry" idea)
   ========================= */
$canonicalTermId = $termId;
$canonicalSemester = $semester;

$stmt = $pdo->prepare("
  SELECT id, semester
  FROM academic_terms
  WHERE school_year = ?
    AND semester = '2nd'
  ORDER BY id DESC
  LIMIT 1
");
$stmt->execute([$schoolYear]);
$secondTerm = $stmt->fetch(PDO::FETCH_ASSOC);

if ($secondTerm && isset($secondTerm['id'])) {
  $canonicalTermId = (int)$secondTerm['id'];
  $canonicalSemester = (string)$secondTerm['semester'];
}

/* =========================
   KPI 1: Active Organizations (School-Year logic)
   - Take the latest accreditation request per org WITHIN the same school_year
   - Count those whose latest status is Active
   This makes orgs accredited in 1st sem still count as Active in 2nd sem.
   ========================= */
$stmt = $pdo->prepare("
  SELECT COUNT(*) AS cnt
  FROM (
    SELECT ar.org_id, MAX(ar.id) AS latest_req_id
    FROM accreditation_requests ar
    JOIN academic_terms t ON t.id = ar.academic_term_id
    WHERE t.school_year = ?
    GROUP BY ar.org_id
  ) x
  JOIN accreditation_requests ar2 ON ar2.id = x.latest_req_id
  WHERE ar2.status = 'Active'
");
$stmt->execute([$schoolYear]);
$kpiActiveOrgs = (int)$stmt->fetchColumn();

/* =========================
   KPI 2: Total Org Fees collected (Canonical term)
   - Uses 2nd semester term row if present for the school_year
   ========================= */
$stmt = $pdo->prepare("
  SELECT COALESCE(SUM(amount),0)
  FROM organization_fee_payments
  WHERE academic_term_id = ?
");
$stmt->execute([$canonicalTermId]);
$kpiOrgFeesTotal = (float)$stmt->fetchColumn();

/* =========================
   Events totals (school_year mapped to start/end year)
   ========================= */
$startYear = 0;
$endYear = 0;
if (preg_match('/^(\d{4})-(\d{4})$/', $schoolYear, $m)) {
  $startYear = (int)$m[1];
  $endYear = (int)$m[2];
}

$kpiEventCredits = 0.0;
$kpiEventDebits  = 0.0;

if ($startYear && $endYear) {
  $stmt = $pdo->prepare("
    SELECT COALESCE(SUM(ec.amount),0)
    FROM event_credits ec
    JOIN event_events e ON e.id = ec.event_id
    WHERE e.start_year = ?
      AND e.end_year = ?
  ");
  $stmt->execute([$startYear, $endYear]);
  $kpiEventCredits = (float)$stmt->fetchColumn();

  $stmt = $pdo->prepare("
    SELECT COALESCE(SUM(ed.amount),0)
    FROM event_debits ed
    JOIN event_events e ON e.id = ed.event_id
    WHERE e.start_year = ?
      AND e.end_year = ?
  ");
  $stmt->execute([$startYear, $endYear]);
  $kpiEventDebits = (float)$stmt->fetchColumn();
}

/* =========================
   Chart A: Org fees per org (Canonical term)
   ========================= */
$stmt = $pdo->prepare("
  SELECT o.org_name, COALESCE(SUM(p.amount),0) AS total_amount
  FROM organizations o
  LEFT JOIN organization_fee_payments p
    ON p.org_id = o.id AND p.academic_term_id = ?
  WHERE o.status <> 'Archived'
  GROUP BY o.id
  ORDER BY total_amount DESC, o.org_name ASC
  LIMIT 10
");
$stmt->execute([$canonicalTermId]);
$orgFeeRows = $stmt->fetchAll(PDO::FETCH_ASSOC);

$orgFeeLabels = [];
$orgFeeValues = [];
foreach ($orgFeeRows as $r) {
  $orgFeeLabels[] = (string)$r['org_name'];
  $orgFeeValues[] = (float)$r['total_amount'];
}

/* =========================
   Chart B + Top list: top events by activity (credits + debits)
   ========================= */
$topEvents = [];
$eventLabels = [];
$eventCredits = [];
$eventDebits = [];

if ($startYear && $endYear) {
  $stmt = $pdo->prepare("
    SELECT
      e.id,
      e.title,
      e.event_date,
      COALESCE(SUM(ec.amount),0) AS total_credits,
      COALESCE(SUM(ed.amount),0) AS total_debits,
      (COALESCE(SUM(ec.amount),0) + COALESCE(SUM(ed.amount),0)) AS activity
    FROM event_events e
    LEFT JOIN event_credits ec ON ec.event_id = e.id
    LEFT JOIN event_debits  ed ON ed.event_id = e.id
    WHERE e.start_year = ?
      AND e.end_year = ?
    GROUP BY e.id
    HAVING activity > 0
    ORDER BY activity DESC, e.event_date DESC, e.id DESC
    LIMIT 8
  ");
  $stmt->execute([$startYear, $endYear]);
  $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);

  foreach ($rows as $r) {
    $title = (string)$r['title'];
    $eventLabels[] = $title;
    $eventCredits[] = (float)$r['total_credits'];
    $eventDebits[]  = (float)$r['total_debits'];

    $topEvents[] = [
      'id' => (int)$r['id'],
      'title' => $title,
      'event_date' => (string)$r['event_date'],
      'credits' => (float)$r['total_credits'],
      'debits' => (float)$r['total_debits'],
    ];
  }
}

ok([
  'user' => ['id' => $userId, 'role' => $role],

  // Active term (what the system says is "Active")
  'term' => [
    'id' => $termId,
    'school_year' => $schoolYear,
    'semester' => $semester,
    'status' => (string)$term['status'],
    'start_year' => $startYear ?: null,
    'end_year' => $endYear ?: null,
  ],

  // Canonical term (what you want to use for fee/membership recording)
  'canonical_term' => [
    'id' => $canonicalTermId,
    'school_year' => $schoolYear,
    'semester' => $canonicalSemester,
  ],

  'kpis' => [
    'active_orgs' => $kpiActiveOrgs,
    'org_fees_total' => $kpiOrgFeesTotal,
    'event_credits' => $kpiEventCredits,
    'event_debits' => $kpiEventDebits,
  ],

  'charts' => [
    'org_fees' => ['labels' => $orgFeeLabels, 'values' => $orgFeeValues],
    'event_funds' => ['labels' => $eventLabels, 'credits' => $eventCredits, 'debits' => $eventDebits],
  ],

  'top_events' => $topEvents,
]);