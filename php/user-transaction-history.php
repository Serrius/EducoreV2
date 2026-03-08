<?php
// php/user-transaction-history.php
// Student Transaction History (Org Fees + Membership Receipts)
//
// actions:
//  - ?action=meta
//  - ?action=list&school_year=2026-2027&semester=2nd&kind=all&q=...&page=1&page_size=10
//
// Debug:
//  - add &debug=1 to return the actual error + hint

declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');

ini_set('display_errors', '0');
ini_set('log_errors', '1');
error_reporting(E_ALL);

session_start();

require_once __DIR__ . '/db.php'; // expects $pdo

function out(array $payload, int $code = 200): void {
  http_response_code($code);
  echo json_encode($payload, JSON_UNESCAPED_SLASHES);
  exit;
}
function ok(array $data = []): void { out(['success' => true] + $data, 200); }
function fail(string $message, int $code = 400, array $extra = []): void {
  out(['success' => false, 'message' => $message] + $extra, $code);
}
function session_user_id(): int {
  if (isset($_SESSION['user_id'])) return (int)$_SESSION['user_id'];
  if (isset($_SESSION['id'])) return (int)$_SESSION['id'];
  if (isset($_SESSION['user']) && is_array($_SESSION['user']) && isset($_SESSION['user']['id'])) return (int)$_SESSION['user']['id'];
  return 0;
}
function clamp_int($v, int $min, int $max, int $default): int {
  $n = is_numeric($v) ? (int)$v : $default;
  if ($n < $min) $n = $min;
  if ($n > $max) $n = $max;
  return $n;
}

/**
 * Build term + search filters with SUFFIXED params (PDO-safe for UNION).
 * Returns [sqlFragment, paramsArray]
 */
function build_filters(string $suffix, int $uid, string $schoolYear, string $semester, string $q): array {
  $sql = "";
  $params = [];

  // required viewer/student id param
  $params[":uid{$suffix}"] = $uid;

  if ($schoolYear !== '') {
    $sql .= " AND t.school_year = :sy{$suffix} ";
    $params[":sy{$suffix}"] = $schoolYear;
  }
  if ($semester !== '') {
    $sql .= " AND t.semester = :sem{$suffix} ";
    $params[":sem{$suffix}"] = $semester;
  }

  if ($q !== '') {
    $sql .= " AND (
      r.receipt_no LIKE :q{$suffix}
      OR o.org_name LIKE :q{$suffix}
      OR o.abbreviation LIKE :q{$suffix}
    ) ";
    $params[":q{$suffix}"] = '%' . $q . '%';
  }

  return [$sql, $params];
}

$debug = isset($_GET['debug']) && (string)$_GET['debug'] === '1';

if (!isset($pdo) || !($pdo instanceof PDO)) {
  fail('PDO not initialized. Check php/db.php (expected $pdo).', 500);
}
try { $pdo->exec("SET NAMES utf8mb4"); } catch (\Throwable $e) {}

$viewerId = session_user_id();
if ($viewerId <= 0) fail('Not authenticated.', 401);

$action = strtolower(trim((string)($_GET['action'] ?? 'meta')));

try {
  if ($action === 'meta') {
    $terms = [];
    $st = $pdo->query("
      SELECT id, school_year, semester, status
      FROM academic_terms
      ORDER BY school_year DESC,
        FIELD(semester, '1st','2nd','Summer') ASC,
        id DESC
    ");
    while ($r = $st->fetch(PDO::FETCH_ASSOC)) $terms[] = $r;

    $active = null;
    $st2 = $pdo->query("
      SELECT id, school_year, semester, status
      FROM academic_terms
      WHERE status = 'Active'
      ORDER BY id DESC
      LIMIT 1
    ");
    $a = $st2->fetch(PDO::FETCH_ASSOC);
    if ($a) $active = $a;

    ok([
      'terms' => $terms,
      'active_term' => $active,
    ]);
  }

  if ($action !== 'list') {
    fail('Unknown action.', 400);
  }

  $schoolYear = trim((string)($_GET['school_year'] ?? ''));
  $semester   = trim((string)($_GET['semester'] ?? '')); // '1st' | '2nd' | 'Summer' | '' (all)
  $kind       = strtolower(trim((string)($_GET['kind'] ?? 'all'))); // all | org_fee | membership
  $q          = trim((string)($_GET['q'] ?? ''));

  $page     = clamp_int($_GET['page'] ?? 1, 1, 999999, 1);
  $pageSize = clamp_int($_GET['page_size'] ?? 10, 1, 50, 10);
  $offset   = ($page - 1) * $pageSize;

  if (!in_array($kind, ['all', 'org_fee', 'membership'], true)) $kind = 'all';

  // Build per-query filters (suffix 1 and 2 so UNION won't reuse named params)
  [$f1, $p1] = build_filters("1", $viewerId, $schoolYear, $semester, $q);
  [$f2, $p2] = build_filters("2", $viewerId, $schoolYear, $semester, $q);

  // Org Fees query (uses :uid1, :sy1, :sem1, :q1)
  $orgFeeSelect = "
    SELECT
      'org_fee' AS kind,
      r.id AS receipt_id,
      r.receipt_no,
      r.paid_at,
      r.amount,
      'Paid' AS status,
      o.org_name,
      'Organization Fee' AS label,
      CONCAT('php/print-organization-fee-receipt.php?receipt_id=', r.id) AS print_url
    FROM organization_fee_receipts r
    INNER JOIN organization_fee_payments p ON p.id = r.payment_id
    INNER JOIN organizations o ON o.id = p.org_id
    INNER JOIN academic_terms t ON t.id = p.academic_term_id
    WHERE p.student_user_id = :uid1
    {$f1}
  ";

  // Membership query (uses :uid2, :sy2, :sem2, :q2)
  $membershipSelect = "
    SELECT
      'membership' AS kind,
      r.id AS receipt_id,
      r.receipt_no,
      r.paid_at,
      r.amount,
      COALESCE(NULLIF(m.status,''), 'Approved') AS status,
      o.org_name,
      'Membership Fee' AS label,
      CONCAT('php/print-membership-receipt.php?receipt_id=', r.id) AS print_url
    FROM organization_membership_receipts r
    INNER JOIN organization_memberships m ON m.id = r.membership_id
    INNER JOIN organizations o ON o.id = m.org_id
    INNER JOIN academic_terms t ON t.id = m.academic_term_id
    WHERE m.student_user_id = :uid2
    {$f2}
  ";

  // Decide which base SQL + which params to bind
  if ($kind === 'org_fee') {
    $baseSql = $orgFeeSelect;
    $params = $p1;
  } else if ($kind === 'membership') {
    $baseSql = $membershipSelect;
    $params = $p2;
  } else {
    $baseSql = "({$orgFeeSelect}) UNION ALL ({$membershipSelect})";
    $params = $p1 + $p2; // merge arrays; keys are unique (uid1/uid2 etc)
  }

  // Count
  $countSql = "SELECT COUNT(*) FROM ({$baseSql}) x";
  $stCount = $pdo->prepare($countSql);
  foreach ($params as $k => $v) $stCount->bindValue($k, $v);
  $stCount->execute();
  $total = (int)$stCount->fetchColumn();
  $totalPages = (int)max(1, (int)ceil($total / $pageSize));

  // List
  $listSql = "
    SELECT *
    FROM ({$baseSql}) x
    ORDER BY x.paid_at DESC, x.receipt_id DESC
    LIMIT :lim OFFSET :off
  ";
  $stList = $pdo->prepare($listSql);
  foreach ($params as $k => $v) $stList->bindValue($k, $v);
  $stList->bindValue(':lim', $pageSize, PDO::PARAM_INT);
  $stList->bindValue(':off', $offset, PDO::PARAM_INT);
  $stList->execute();

  $items = $stList->fetchAll(PDO::FETCH_ASSOC);

  ok([
    'items' => $items,
    'total' => $total,
    'page' => $page,
    'page_size' => $pageSize,
    'total_pages' => $totalPages,
  ]);

} catch (\Throwable $e) {
  error_log("[user-transaction-history.php] " . $e->getMessage());

  if ($debug) {
    fail("Server error (debug).", 500, [
      'error' => $e->getMessage(),
      'hint'  => 'HY093 usually means duplicated named params in UNION or mismatched placeholders.',
    ]);
  }

  fail("Server error.", 500);
}