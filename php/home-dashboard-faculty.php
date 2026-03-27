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
   Auth (faculty_admin only)
   ========================= */
$userId = (int)($_SESSION['user_id'] ?? 0);
$role   = (string)($_SESSION['role'] ?? '');
if ($userId <= 0) fail('Not logged in.', 401);
if ($role !== 'faculty_admin') fail('Forbidden.', 403);

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
    'organization' => null,
    'kpis' => [
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
   Canonical term (same as your super_admin logic)
   Prefer 2nd semester term_id if it exists for this school_year
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
   Find ALL organizations handled by this faculty_admin
   ========================= */
$stmt = $pdo->prepare("
  SELECT id, org_name, abbreviation, org_type, scope, program_id, membership_fee, fee_required, status
  FROM organizations
  WHERE created_by = ?
    AND status <> 'Archived'
  ORDER BY org_name ASC
");
$stmt->execute([$userId]);
$orgs = $stmt->fetchAll(PDO::FETCH_ASSOC);

/* Parse school year range once */
$startYear = 0;
$endYear   = 0;
if (preg_match('/^(\d{4})-(\d{4})$/', $schoolYear, $m)) {
  $startYear = (int)$m[1];
  $endYear   = (int)$m[2];
}

if (empty($orgs)) {
  ok([
    'user' => [
      'id' => $userId,
      'role' => $role,
      'name' => trim((string)($_SESSION['first_name'] ?? '') . ' ' . (string)($_SESSION['last_name'] ?? '')) ?: 'Faculty Admin'
    ],
    'term' => [
      'id' => $termId,
      'school_year' => $schoolYear,
      'semester' => $semester,
      'status' => (string)$term['status'],
      'start_year' => $startYear ?: null,
      'end_year' => $endYear ?: null,
    ],
    'canonical_term' => [
      'id' => $canonicalTermId,
      'school_year' => $schoolYear,
      'semester' => $canonicalSemester,
    ],
    'organizations' => [],
    'kpis' => ['org_fees_total' => 0, 'event_credits' => 0, 'event_debits' => 0],
    'charts' => [
      'org_fees' => ['labels' => [], 'values' => []],
      'event_funds' => ['labels' => [], 'credits' => [], 'debits' => []],
    ],
    'top_events' => [],
    'note' => 'No organizations assigned/created by this faculty_admin.',
  ]);
}

$orgIds       = array_map(fn($o) => (int)$o['id'], $orgs);
$placeholders = implode(',', array_fill(0, count($orgIds), '?'));

/* =========================
   KPI: Total Org Fees across ALL handled orgs (Canonical term)
   ========================= */
$stmt = $pdo->prepare("
  SELECT COALESCE(SUM(amount),0)
  FROM organization_fee_payments
  WHERE academic_term_id = ?
    AND org_id IN ($placeholders)
");
$stmt->execute(array_merge([$canonicalTermId], $orgIds));
$kpiOrgFeesTotal = (float)$stmt->fetchColumn();

/* =========================
   KPI: Event totals across ALL handled orgs within school_year range
   ========================= */
$kpiEventCredits = 0.0;
$kpiEventDebits  = 0.0;

if ($startYear && $endYear) {
  $stmt = $pdo->prepare("
    SELECT COALESCE(SUM(ec.amount),0)
    FROM event_credits ec
    JOIN event_events e ON e.id = ec.event_id
    WHERE e.org_id IN ($placeholders)
      AND e.start_year = ?
      AND e.end_year = ?
  ");
  $stmt->execute(array_merge($orgIds, [$startYear, $endYear]));
  $kpiEventCredits = (float)$stmt->fetchColumn();

  $stmt = $pdo->prepare("
    SELECT COALESCE(SUM(ed.amount),0)
    FROM event_debits ed
    JOIN event_events e ON e.id = ed.event_id
    WHERE e.org_id IN ($placeholders)
      AND e.start_year = ?
      AND e.end_year = ?
  ");
  $stmt->execute(array_merge($orgIds, [$startYear, $endYear]));
  $kpiEventDebits = (float)$stmt->fetchColumn();
}

/* =========================
   Chart A: Org fees per org (one bar per org)
   ========================= */
$orgFeeLabels = [];
$orgFeeValues = [];

foreach ($orgIds as $i => $oid) {
  $stmt = $pdo->prepare("
    SELECT COALESCE(SUM(amount),0)
    FROM organization_fee_payments
    WHERE academic_term_id = ? AND org_id = ?
  ");
  $stmt->execute([$canonicalTermId, $oid]);
  $orgFeeLabels[] = (string)$orgs[$i]['org_name'];
  $orgFeeValues[] = (float)$stmt->fetchColumn();
}

/* =========================
   Chart B + Top list: top events across ALL handled orgs
   ========================= */
$topEvents   = [];
$eventLabels = [];
$eventCredits = [];
$eventDebits  = [];

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
    WHERE e.org_id IN ($placeholders)
      AND e.start_year = ?
      AND e.end_year = ?
    GROUP BY e.id
    HAVING activity > 0
    ORDER BY activity DESC, e.event_date DESC, e.id DESC
    LIMIT 8
  ");
  $stmt->execute(array_merge($orgIds, [$startYear, $endYear]));
  $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);

  foreach ($rows as $r) {
    $title          = (string)$r['title'];
    $eventLabels[]  = $title;
    $eventCredits[] = (float)$r['total_credits'];
    $eventDebits[]  = (float)$r['total_debits'];
    $topEvents[]    = [
      'id'         => (int)$r['id'],
      'title'      => $title,
      'event_date' => (string)$r['event_date'],
      'credits'    => (float)$r['total_credits'],
      'debits'     => (float)$r['total_debits'],
    ];
  }
}

/* Build organizations array for response */
$organizationsOut = array_map(fn($o) => [
  'id'          => (int)$o['id'],
  'org_name'    => (string)$o['org_name'],
  'abbreviation'=> (string)($o['abbreviation'] ?? ''),
  'org_type'    => (string)($o['org_type'] ?? ''),
  'scope'       => (string)($o['scope'] ?? ''),
  'status'      => (string)($o['status'] ?? ''),
], $orgs);

ok([
  'user' => [
    'id'   => $userId,
    'role' => $role,
    'name' => trim((string)($_SESSION['first_name'] ?? '') . ' ' . (string)($_SESSION['last_name'] ?? '')) ?: 'Faculty Admin'
  ],

  'term' => [
    'id'         => $termId,
    'school_year'=> $schoolYear,
    'semester'   => $semester,
    'status'     => (string)$term['status'],
    'start_year' => $startYear ?: null,
    'end_year'   => $endYear ?: null,
  ],

  'canonical_term' => [
    'id'         => $canonicalTermId,
    'school_year'=> $schoolYear,
    'semester'   => $canonicalSemester,
  ],

  'organizations' => $organizationsOut,

  'kpis' => [
    'org_fees_total' => $kpiOrgFeesTotal,
    'event_credits'  => $kpiEventCredits,
    'event_debits'   => $kpiEventDebits,
  ],

  'charts' => [
    'org_fees'    => ['labels' => $orgFeeLabels, 'values' => $orgFeeValues],
    'event_funds' => ['labels' => $eventLabels, 'credits' => $eventCredits, 'debits' => $eventDebits],
  ],

  'top_events' => $topEvents,
]);