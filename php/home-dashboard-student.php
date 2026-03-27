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
    'organizations' => [],
    'kpis' => [
      'org_fees_total' => 0, 
      'club_fees_total' => 0,
      'event_credits' => 0, 
      'event_debits' => 0
    ],
    'charts' => [
      'org_fees' => ['labels' => [], 'values' => []],
      'club_fees' => ['labels' => [], 'values' => []],
      'event_funds' => ['labels' => [], 'credits' => [], 'debits' => []],
    ],
    'org_fees_paid' => [],
    'org_fees_unpaid' => [],
    'club_fees_paid' => [],
    'club_fees_unpaid' => [],
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
   Get ACTIVE/APPROVED organizations for this school year
   ========================= */
$activeOrgIds = [];
try {
  $stmt = $pdo->prepare("
    SELECT DISTINCT ar.org_id
    FROM accreditation_requests ar
    JOIN academic_terms t ON t.id = ar.academic_term_id
    WHERE t.school_year = ?
      AND ar.status IN ('Active', 'Approved')
  ");
  $stmt->execute([$schoolYear]);
  $activeOrgIds = $stmt->fetchAll(PDO::FETCH_COLUMN);
} catch (\Throwable $e) {
  error_log("Active orgs query error: " . $e->getMessage());
}

/* =========================
   Officer orgs (AY-wide) - ONLY those with Active/Approved accreditation
   INCLUDING USER ROLE/POSITION
   ========================= */
$officerOrgs = [];
$officerOrgIds = [];
if (!empty($activeOrgIds)) {
  $activePlaceholders = implode(',', array_fill(0, count($activeOrgIds), '?'));
  
  try {
    $sql = "
      SELECT
        o.id AS org_id,
        o.org_name,
        o.abbreviation,
        o.org_type,
        o.scope,
        o.status AS org_status,
        o.fee_required,
        o.membership_fee,
        oo.position AS user_role,
        MAX(oo.created_at) AS last_assigned_at
      FROM organization_officers oo
      JOIN organizations o ON o.id = oo.org_id
      WHERE oo.user_id = ?
        AND oo.status = 'Active'
        AND oo.academic_term_id IN ($placeholders)
        AND o.id IN ($activePlaceholders)
        AND o.status <> 'Archived'
      GROUP BY o.id, oo.position
      ORDER BY o.org_type DESC, last_assigned_at DESC, o.id DESC
    ";
    $params = array_merge([$userId], $yearTermIds, $activeOrgIds);
    $stmt = $pdo->prepare($sql);
    $stmt->execute($params);
    $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);

    foreach ($rows as $r) {
      $orgId = (int)$r['org_id'];
      $officerOrgs[] = [
        'id' => $orgId,
        'org_name' => (string)$r['org_name'],
        'abbreviation' => (string)($r['abbreviation'] ?? ''),
        'org_type' => (string)($r['org_type'] ?? ''),
        'scope' => (string)($r['scope'] ?? ''),
        'status' => (string)($r['org_status'] ?? ''),
        'fee_required' => (float)($r['fee_required'] ?? 0),
        'membership_fee' => (float)($r['membership_fee'] ?? 0),
        'user_role' => (string)($r['user_role'] ?? 'Officer'), // User's position in this organization
      ];
      $officerOrgIds[] = $orgId;
    }
  } catch (\Throwable $e) {
    error_log("Officer orgs query error: " . $e->getMessage());
  }
}

$isOfficer = count($officerOrgs) > 0;

/* =========================
   Officer-only KPIs + charts (for ALL handled orgs that are active/approved)
   ========================= */
$kpiOrgFeesTotal = 0.0;
$kpiClubFeesTotal = 0.0;
$kpiEventCredits = 0.0;
$kpiEventDebits  = 0.0;

$orgFeeLabels = [];
$orgFeeValues = [];
$clubFeeLabels = [];
$clubFeeValues = [];
$eventLabels = [];
$eventCredits = [];
$eventDebits = [];

$startYear = 0;
$endYear = 0;
if (preg_match('/^(\d{4})-(\d{4})$/', $schoolYear, $m)) {
  $startYear = (int)$m[1];
  $endYear = (int)$m[2];
}

if ($isOfficer && !empty($officerOrgIds)) {
  $orgPlaceholders = implode(',', array_fill(0, count($officerOrgIds), '?'));

  // Total Organization fees collected (for ALL handled orgs)
  try {
    $stmt = $pdo->prepare("
      SELECT COALESCE(SUM(amount),0)
      FROM organization_fee_payments
      WHERE academic_term_id = ?
        AND org_id IN ($orgPlaceholders)
    ");
    $params = array_merge([$canonicalTermId], $officerOrgIds);
    $stmt->execute($params);
    $kpiOrgFeesTotal = (float)$stmt->fetchColumn();
  } catch (\Throwable $e) {}

  // Total Club membership fees collected (for ALL handled clubs)
  try {
    $clubIds = array_filter($officerOrgIds, function($id) use ($officerOrgs) {
      foreach ($officerOrgs as $org) {
        if ($org['id'] == $id && $org['org_type'] === 'Club') return true;
      }
      return false;
    });
    
    if (!empty($clubIds)) {
      $clubPlaceholders = implode(',', array_fill(0, count($clubIds), '?'));
      $stmt = $pdo->prepare("
        SELECT COALESCE(SUM(fee_amount),0)
        FROM organization_memberships
        WHERE academic_term_id IN ($placeholders)
          AND org_id IN ($clubPlaceholders)
          AND fee_paid = 1
      ");
      $params = array_merge($yearTermIds, $clubIds);
      $stmt->execute($params);
      $kpiClubFeesTotal = (float)$stmt->fetchColumn();
    }
  } catch (\Throwable $e) {}

  // Event totals (AY) for ALL handled orgs
  if ($startYear && $endYear) {
    try {
      $stmt = $pdo->prepare("
        SELECT COALESCE(SUM(ec.amount),0)
        FROM event_credits ec
        JOIN event_events e ON e.id = ec.event_id
        WHERE e.org_id IN ($orgPlaceholders)
          AND e.start_year = ?
          AND e.end_year = ?
      ");
      $params = array_merge($officerOrgIds, [$startYear, $endYear]);
      $stmt->execute($params);
      $kpiEventCredits = (float)$stmt->fetchColumn();
    } catch (\Throwable $e) {}

    try {
      $stmt = $pdo->prepare("
        SELECT COALESCE(SUM(ed.amount),0)
        FROM event_debits ed
        JOIN event_events e ON e.id = ed.event_id
        WHERE e.org_id IN ($orgPlaceholders)
          AND e.start_year = ?
          AND e.end_year = ?
      ");
      $params = array_merge($officerOrgIds, [$startYear, $endYear]);
      $stmt->execute($params);
      $kpiEventDebits = (float)$stmt->fetchColumn();
    } catch (\Throwable $e) {}
  }

  // Chart A: Organization Fees by Org (ONLY ACTIVE/APPROVED)
  foreach ($officerOrgs as $org) {
    if ($org['org_type'] === 'Organization') {
      try {
        $stmt = $pdo->prepare("
          SELECT COALESCE(SUM(amount),0)
          FROM organization_fee_payments
          WHERE academic_term_id = ?
            AND org_id = ?
        ");
        $stmt->execute([$canonicalTermId, $org['id']]);
        $total = (float)$stmt->fetchColumn();
        
        $orgFeeLabels[] = $org['abbreviation'] ?: $org['org_name'];
        $orgFeeValues[] = $total;
      } catch (\Throwable $e) {}
    }
  }

  // Chart B: Club Fees by Club (ONLY ACTIVE/APPROVED)
  foreach ($officerOrgs as $org) {
    if ($org['org_type'] === 'Club') {
      try {
        $stmt = $pdo->prepare("
          SELECT COALESCE(SUM(fee_amount),0)
          FROM organization_memberships
          WHERE academic_term_id IN ($placeholders)
            AND org_id = ?
            AND fee_paid = 1
        ");
        $params = array_merge($yearTermIds, [$org['id']]);
        $stmt->execute($params);
        $total = (float)$stmt->fetchColumn();
        
        $clubFeeLabels[] = $org['abbreviation'] ?: $org['org_name'];
        $clubFeeValues[] = $total;
      } catch (\Throwable $e) {}
    }
  }

  // Chart C: top events by activity (ALL orgs)
  if ($startYear && $endYear && !empty($officerOrgIds)) {
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
        WHERE e.org_id IN ($orgPlaceholders)
          AND e.start_year = ?
          AND e.end_year = ?
        GROUP BY e.id
        HAVING activity > 0
        ORDER BY activity DESC, e.event_date DESC, e.id DESC
        LIMIT 8
      ");
      $params = array_merge($officerOrgIds, [$startYear, $endYear]);
      $stmt->execute($params);
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
   Student lists - ONLY organizations with Active/Approved accreditation
   ========================= */

// PAID org fees (active term) - ONLY from active orgs
$paid = [];
if (!empty($activeOrgIds)) {
  $activePlaceholders = implode(',', array_fill(0, count($activeOrgIds), '?'));
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
        AND p.org_id IN ($activePlaceholders)
      ORDER BY p.paid_at DESC, p.id DESC
    ");
    $params = array_merge([$userId, $termId], $activeOrgIds);
    $stmt->execute($params);
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
}

// PAID club fees (AY-wide) - ONLY from active clubs
$clubPaid = [];
if (!empty($activeOrgIds)) {
  $activePlaceholders = implode(',', array_fill(0, count($activeOrgIds), '?'));
  try {
    $stmt = $pdo->prepare("
      SELECT
        m.org_id,
        o.org_name,
        o.abbreviation,
        o.org_type,
        m.fee_amount AS amount,
        m.fee_paid_at AS paid_at,
        r.receipt_no
      FROM organization_memberships m
      JOIN organizations o ON o.id = m.org_id
      LEFT JOIN organization_membership_receipts r ON r.membership_id = m.id
      WHERE m.student_user_id = ?
        AND m.academic_term_id IN ($placeholders)
        AND m.org_id IN ($activePlaceholders)
        AND m.fee_paid = 1
      ORDER BY m.fee_paid_at DESC, m.id DESC
    ");
    $params = array_merge([$userId], $yearTermIds, $activeOrgIds);
    $stmt->execute($params);
    
    $seen = [];
    foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $r) {
      $oid = (int)$r['org_id'];
      if (isset($seen[$oid])) continue;
      $seen[$oid] = true;
      
      $clubPaid[] = [
        'org_id' => $oid,
        'org_name' => (string)$r['org_name'],
        'abbreviation' => (string)($r['abbreviation'] ?? ''),
        'org_type' => (string)($r['org_type'] ?? ''),
        'amount' => (float)($r['amount'] ?? 0),
        'paid_at' => (string)($r['paid_at'] ?? ''),
        'receipt_no' => (string)($r['receipt_no'] ?? ''),
      ];
    }
  } catch (\Throwable $e) {}
}

// UNPAID org fees (active term) - ONLY from active orgs
$unpaid = [];
if (!empty($activeOrgIds)) {
  $activePlaceholders = implode(',', array_fill(0, count($activeOrgIds), '?'));
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
        AND o.org_type = 'Organization'
        AND o.fee_required > 0
        AND o.id IN ($activePlaceholders)
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
    $params = array_merge($activeOrgIds, [$studentProgramAbbr, $studentProgramAbbr, $userId, $termId]);
    $stmt->execute($params);
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
}

// UNPAID club fees (AY-wide) - ONLY from active clubs
$clubUnpaid = [];
if (!empty($activeOrgIds)) {
  $activePlaceholders = implode(',', array_fill(0, count($activeOrgIds), '?'));
  try {
    $stmt = $pdo->prepare("
      SELECT DISTINCT
        o.id AS org_id,
        o.org_name,
        o.abbreviation,
        o.org_type,
        o.membership_fee AS fee_required
      FROM organization_memberships m
      JOIN organizations o ON o.id = m.org_id
      WHERE m.student_user_id = ?
        AND m.academic_term_id IN ($placeholders)
        AND m.org_id IN ($activePlaceholders)
        AND m.fee_paid = 0
        AND o.membership_fee > 0
      ORDER BY o.org_name ASC
    ");
    $params = array_merge([$userId], $yearTermIds, $activeOrgIds);
    $stmt->execute($params);
    
    $seen = [];
    foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $r) {
      $oid = (int)$r['org_id'];
      if (isset($seen[$oid])) continue;
      $seen[$oid] = true;
      
      $clubUnpaid[] = [
        'org_id' => $oid,
        'org_name' => (string)$r['org_name'],
        'abbreviation' => (string)($r['abbreviation'] ?? ''),
        'org_type' => (string)($r['org_type'] ?? ''),
        'fee_required' => (float)($r['fee_required'] ?? 0),
      ];
    }
  } catch (\Throwable $e) {}
}

// Clubs joined (AY-wide persistence) - ONLY from active clubs
$clubs = [];
if (!empty($activeOrgIds)) {
  $activePlaceholders = implode(',', array_fill(0, count($activeOrgIds), '?'));
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
        AND m.org_id IN ($activePlaceholders)
        AND o.org_type = 'Club'
        AND o.status <> 'Archived'
        AND m.status IN ('Approved','Pending')
      ORDER BY o.org_name ASC, m.academic_term_id DESC, m.id DESC
    ";
    $params = array_merge([$userId], $yearTermIds, $activeOrgIds);
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
}

/* =========================
   Add count badges
   ========================= */
$orgCount = count($officerOrgs);
$unpaidOrgCount = count($unpaid);
$paidOrgCount = count($paid);
$unpaidClubCount = count($clubUnpaid);
$paidClubCount = count($clubPaid);
$clubsCount = count($clubs);

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
  'organizations' => $officerOrgs,
  
  // Add count badges
  'counts' => [
    'organizations' => $orgCount,
    'unpaid_org' => $unpaidOrgCount,
    'paid_org' => $paidOrgCount,
    'unpaid_club' => $unpaidClubCount,
    'paid_club' => $paidClubCount,
    'clubs' => $clubsCount,
  ],

  'kpis' => [
    'org_fees_total' => $kpiOrgFeesTotal,
    'club_fees_total' => $kpiClubFeesTotal,
    'event_credits' => $kpiEventCredits,
    'event_debits' => $kpiEventDebits,
  ],

  'charts' => [
    'org_fees' => ['labels' => $orgFeeLabels, 'values' => $orgFeeValues],
    'club_fees' => ['labels' => $clubFeeLabels, 'values' => $clubFeeValues],
    'event_funds' => ['labels' => $eventLabels, 'credits' => $eventCredits, 'debits' => $eventDebits],
  ],

  'org_fees_paid' => $paid,
  'org_fees_unpaid' => $unpaid,
  'club_fees_paid' => $clubPaid,
  'club_fees_unpaid' => $clubUnpaid,
  'clubs_joined' => $clubs,
]);