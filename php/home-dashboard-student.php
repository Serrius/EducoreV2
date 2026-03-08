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
   Auth (NO role checks)
   ========================= */
$userId = (int)($_SESSION['user_id'] ?? 0);
if ($userId <= 0) fail('Not logged in.', 401);

/* =========================
   Active term
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
    'user' => ['id' => $userId, 'name' => 'Student'],
    'term' => null,
    'is_officer' => false,
    'organization' => null,
    'kpis' => ['org_fees_total' => 0, 'event_credits' => 0, 'event_debits' => 0],
    'charts' => [
      'org_fees' => ['labels' => [], 'values' => []],
      'event_funds' => ['labels' => [], 'credits' => [], 'debits' => []],
    ],
    'org_fees_paid' => [],
    'org_fees_unpaid' => [],
    'clubs_joined' => [],
  ]);
}

$termId     = (int)$term['id'];
$schoolYear = (string)$term['school_year'];
$semester   = (string)$term['semester'];

/* =========================
   Try get student name + program (safe if missing columns)
   ========================= */
$studentName = 'Student';
$studentProgramAbbr = '';
try {
  $stmt = $pdo->prepare("SELECT first_name, last_name, program FROM users WHERE id=? LIMIT 1");
  $stmt->execute([$userId]);
  $u = $stmt->fetch(PDO::FETCH_ASSOC) ?: [];
  $studentName = trim((string)($u['first_name'] ?? '') . ' ' . (string)($u['last_name'] ?? '')) ?: 'Student';
  $studentProgramAbbr = (string)($u['program'] ?? '');
} catch (\Throwable $e) {
  // ignore (keeps defaults)
}

/* =========================
   AY-wide term ids (same school_year)
   ========================= */
$stmt = $pdo->prepare("SELECT id, semester, created_at FROM academic_terms WHERE school_year=? ORDER BY created_at ASC, id ASC");
$stmt->execute([$schoolYear]);
$yearTerms = $stmt->fetchAll(PDO::FETCH_ASSOC);

$yearTermIds = [];
foreach ($yearTerms as $t) {
  if (isset($t['id'])) $yearTermIds[] = (int)$t['id'];
}
if (!$yearTermIds) $yearTermIds = [$termId];

$placeholders = implode(',', array_fill(0, count($yearTermIds), '?'));

/* =========================
   Canonical term (prefer 2nd semester term for this school_year)
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
   Officer orgs (AY-wide). If none => non-officer
   ========================= */
$officerOrgs = [];
try {
  $sql = "
    SELECT
      o.id AS org_id,
      o.org_name,
      o.abbreviation,
      o.org_type,
      o.scope,
      o.status AS org_status,
      MAX(oo.created_at) AS last_assigned_at
    FROM organization_officers oo
    JOIN organizations o ON o.id = oo.org_id
    WHERE oo.user_id = ?
      AND oo.status = 'Active'
      AND oo.academic_term_id IN ($placeholders)
      AND o.status <> 'Archived'
    GROUP BY o.id
    ORDER BY last_assigned_at DESC, o.id DESC
  ";
  $params = array_merge([$userId], $yearTermIds);
  $stmt = $pdo->prepare($sql);
  $stmt->execute($params);
  $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);

  foreach ($rows as $r) {
    $officerOrgs[] = [
      'id' => (int)$r['org_id'],
      'org_name' => (string)$r['org_name'],
      'abbreviation' => (string)($r['abbreviation'] ?? ''),
      'org_type' => (string)($r['org_type'] ?? ''),
      'scope' => (string)($r['scope'] ?? ''),
      'status' => (string)($r['org_status'] ?? ''),
    ];
  }
} catch (\Throwable $e) {}

$isOfficer = count($officerOrgs) > 0;
$org = $isOfficer ? $officerOrgs[0] : null; // primary handled org
$orgId = $org ? (int)$org['id'] : 0;

/* =========================
   Officer-only KPIs + charts (same logic as admin)
   ========================= */
$kpiOrgFeesTotal = 0.0;
$kpiEventCredits = 0.0;
$kpiEventDebits  = 0.0;

$orgFeeLabels = [];
$orgFeeValues = [];
$eventLabels = [];
$eventCredits = [];
$eventDebits = [];

$startYear = 0;
$endYear = 0;
if (preg_match('/^(\d{4})-(\d{4})$/', $schoolYear, $m)) {
  $startYear = (int)$m[1];
  $endYear = (int)$m[2];
}

if ($isOfficer && $orgId > 0) {
  // Total Org fees collected for the handled org (canonical term)
  try {
    $stmt = $pdo->prepare("
      SELECT COALESCE(SUM(amount),0)
      FROM organization_fee_payments
      WHERE academic_term_id = ?
        AND org_id = ?
    ");
    $stmt->execute([$canonicalTermId, $orgId]);
    $kpiOrgFeesTotal = (float)$stmt->fetchColumn();
  } catch (\Throwable $e) {}

  // Event totals (AY)
  if ($startYear && $endYear) {
    try {
      $stmt = $pdo->prepare("
        SELECT COALESCE(SUM(ec.amount),0)
        FROM event_credits ec
        JOIN event_events e ON e.id = ec.event_id
        WHERE e.org_id = ?
          AND e.start_year = ?
          AND e.end_year = ?
      ");
      $stmt->execute([$orgId, $startYear, $endYear]);
      $kpiEventCredits = (float)$stmt->fetchColumn();
    } catch (\Throwable $e) {}

    try {
      $stmt = $pdo->prepare("
        SELECT COALESCE(SUM(ed.amount),0)
        FROM event_debits ed
        JOIN event_events e ON e.id = ed.event_id
        WHERE e.org_id = ?
          AND e.start_year = ?
          AND e.end_year = ?
      ");
      $stmt->execute([$orgId, $startYear, $endYear]);
      $kpiEventDebits = (float)$stmt->fetchColumn();
    } catch (\Throwable $e) {}
  }

  // Chart A (single bar)
  $orgFeeLabels = [$org['org_name']];
  $orgFeeValues = [$kpiOrgFeesTotal];

  // Chart B: top events by activity
  if ($startYear && $endYear) {
    try {
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
        WHERE e.org_id = ?
          AND e.start_year = ?
          AND e.end_year = ?
        GROUP BY e.id
        HAVING activity > 0
        ORDER BY activity DESC, e.event_date DESC, e.id DESC
        LIMIT 8
      ");
      $stmt->execute([$orgId, $startYear, $endYear]);
      $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);

      foreach ($rows as $r) {
        $eventLabels[] = (string)$r['title'];
        $eventCredits[] = (float)$r['total_credits'];
        $eventDebits[]  = (float)$r['total_debits'];
      }
    } catch (\Throwable $e) {}
  }
}

/* =========================
   Student lists (always)
   ========================= */

// PAID org fees (active term)
$paid = [];
try {
  $stmt = $pdo->prepare("
    SELECT
      p.org_id,
      o.org_name,
      o.abbreviation,
      o.scope,
      o.org_type,
      p.amount,
      p.paid_at,
      p.receipt_no
    FROM organization_fee_payments p
    JOIN organizations o ON o.id = p.org_id
    WHERE p.student_user_id = ?
      AND p.academic_term_id = ?
    ORDER BY p.paid_at DESC, p.id DESC
  ");
  $stmt->execute([$userId, $termId]);
  foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $r) {
    $paid[] = [
      'org_id' => (int)$r['org_id'],
      'org_name' => (string)$r['org_name'],
      'abbreviation' => (string)($r['abbreviation'] ?? ''),
      'scope' => (string)($r['scope'] ?? ''),
      'org_type' => (string)($r['org_type'] ?? ''),
      'amount' => (float)($r['amount'] ?? 0),
      'paid_at' => (string)($r['paid_at'] ?? ''),
      'receipt_no' => (string)($r['receipt_no'] ?? ''),
    ];
  }
} catch (\Throwable $e) {}

// UNPAID org fees (active term). Exclusive filtered by user program when available.
$unpaid = [];
try {
  $stmt = $pdo->prepare("
    SELECT
      o.id AS org_id,
      o.org_name,
      o.abbreviation,
      o.org_type,
      o.scope,
      o.fee_required,
      pr.abbreviation AS program_abbr
    FROM organizations o
    LEFT JOIN programs pr ON pr.id = o.program_id
    WHERE o.status = 'Active'
      AND o.fee_required > 0
      AND (
        o.scope = 'General'
        OR (
          o.scope = 'Exclusive'
          AND ? <> ''
          AND pr.abbreviation = ?
        )
      )
      AND NOT EXISTS (
        SELECT 1
        FROM organization_fee_payments p
        WHERE p.org_id = o.id
          AND p.student_user_id = ?
          AND p.academic_term_id = ?
      )
    ORDER BY o.scope ASC, o.org_name ASC
  ");
  $stmt->execute([$studentProgramAbbr, $studentProgramAbbr, $userId, $termId]);
  foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $r) {
    $unpaid[] = [
      'org_id' => (int)$r['org_id'],
      'org_name' => (string)$r['org_name'],
      'abbreviation' => (string)($r['abbreviation'] ?? ''),
      'org_type' => (string)($r['org_type'] ?? ''),
      'scope' => (string)($r['scope'] ?? ''),
      'fee_required' => (float)($r['fee_required'] ?? 0),
    ];
  }
} catch (\Throwable $e) {}

// Clubs joined (AY-wide persistence)
$clubs = [];
try {
  $sql = "
    SELECT
      o.id AS org_id,
      o.org_name,
      o.abbreviation,
      m.status,
      m.fee_amount,
      m.fee_paid,
      m.fee_paid_at,
      m.requested_at,
      m.academic_term_id
    FROM organization_memberships m
    JOIN organizations o ON o.id = m.org_id
    WHERE m.student_user_id = ?
      AND m.academic_term_id IN ($placeholders)
      AND o.org_type = 'Club'
      AND o.status <> 'Archived'
      AND m.status IN ('Approved','Pending')
    ORDER BY o.org_name ASC, m.academic_term_id DESC, m.id DESC
  ";
  $params = array_merge([$userId], $yearTermIds);
  $stmt = $pdo->prepare($sql);
  $stmt->execute($params);

  $seen = [];
  foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $r) {
    $oid = (int)$r['org_id'];
    if (isset($seen[$oid])) continue; // dedupe AY-wide
    $seen[$oid] = true;

    $clubs[] = [
      'org_id' => $oid,
      'org_name' => (string)$r['org_name'],
      'abbreviation' => (string)($r['abbreviation'] ?? ''),
      'status' => (string)($r['status'] ?? ''),
      'fee_amount' => (float)($r['fee_amount'] ?? 0),
      'fee_paid' => (int)($r['fee_paid'] ?? 0) === 1,
      'fee_paid_at' => (string)($r['fee_paid_at'] ?? ''),
      'requested_at' => (string)($r['requested_at'] ?? ''),
    ];
  }
} catch (\Throwable $e) {}

/* =========================
   Response
   ========================= */
ok([
  'user' => [
    'id' => $userId,
    'name' => $studentName,
  ],
  'term' => [
    'id' => $termId,
    'school_year' => $schoolYear,
    'semester' => $semester,
    'status' => (string)$term['status'],
  ],
  'canonical_term' => [
    'id' => $canonicalTermId,
    'school_year' => $schoolYear,
    'semester' => $canonicalSemester,
  ],

  'is_officer' => $isOfficer,
  'organization' => $org ? [
    'id' => (int)$org['id'],
    'org_name' => (string)$org['org_name'],
    'abbreviation' => (string)($org['abbreviation'] ?? ''),
    'org_type' => (string)($org['org_type'] ?? ''),
    'scope' => (string)($org['scope'] ?? ''),
    'status' => (string)($org['status'] ?? ''),
  ] : null,

  'kpis' => [
    'org_fees_total' => $kpiOrgFeesTotal,
    'event_credits' => $kpiEventCredits,
    'event_debits' => $kpiEventDebits,
  ],

  'charts' => [
    'org_fees' => ['labels' => $orgFeeLabels, 'values' => $orgFeeValues],
    'event_funds' => ['labels' => $eventLabels, 'credits' => $eventCredits, 'debits' => $eventDebits],
  ],

  'org_fees_paid' => $paid,
  'org_fees_unpaid' => $unpaid,
  'clubs_joined' => $clubs,
]);