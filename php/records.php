<?php
declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
session_start();

/* =========================
   DB (PDO) - SAME FOLDER
   ========================= */
require_once __DIR__ . '/db.php'; // expects $pdo

if (!isset($pdo) || !($pdo instanceof PDO)) {
  http_response_code(500);
  echo json_encode(['success' => false, 'message' => 'PDO not initialized. Check php/db.php (expected $pdo).'], JSON_UNESCAPED_SLASHES);
  exit;
}
try { $pdo->exec("SET NAMES utf8mb4"); } catch (\Throwable $e) {}

/* =========================
   Response helpers
   ========================= */
function out(array $payload, int $code = 200): void {
  http_response_code($code);
  echo json_encode($payload, JSON_UNESCAPED_SLASHES);
  exit;
}
function ok(array $data = []): void { out(['success' => true] + $data); }
function fail(string $message, int $code = 400, array $extra = []): void {
  out(['success' => false, 'message' => $message] + $extra, $code);
}

function session_user_id(): int {
  if (isset($_SESSION['user_id'])) return (int)$_SESSION['user_id'];
  if (isset($_SESSION['id'])) return (int)$_SESSION['id'];
  if (isset($_SESSION['user']) && is_array($_SESSION['user']) && isset($_SESSION['user']['id'])) return (int)$_SESSION['user']['id'];
  return 0;
}

function require_login(PDO $pdo): array {
  $uid = session_user_id();
  if ($uid <= 0) fail('Not authenticated.', 401);

  $st = $pdo->prepare("SELECT id, id_number, email, role, status FROM users WHERE id = :id LIMIT 1");
  $st->execute([':id' => $uid]);
  $me = $st->fetch(PDO::FETCH_ASSOC);
  if (!$me) fail('User not found.', 401);
  if (strcasecmp((string)($me['status'] ?? ''), 'Active') !== 0) fail('Account inactive.', 403);
  return $me;
}

function is_admin_all_orgs(string $role): bool {
  $r = strtolower(trim($role));
  return in_array($r, ['super_admin', 'special_admin', 'overseer'], true);
}

function normalize_semester_key(?string $sem): string {
  $s = strtolower(trim((string)$sem));
  if ($s === '1st' || $s === '1st semester') return '1st';
  if ($s === '2nd' || $s === '2nd semester') return '2nd';
  if ($s === 'summer') return 'Summer';
  return $sem ? trim((string)$sem) : '';
}

function semester_to_active_year(?string $sem): int {
  $s = normalize_semester_key($sem);
  if (strcasecmp($s, '1st') === 0) return 1;
  if (strcasecmp($s, '2nd') === 0) return 2;
  if (strcasecmp($s, 'Summer') === 0) return 3;
  return 0; // unknown -> don't filter by active_year
}

function parse_json_body(): array {
  $raw = file_get_contents('php://input');
  if ($raw === false || trim($raw) === '') return [];
  $data = json_decode($raw, true);
  return is_array($data) ? $data : [];
}

function csv_escape(string $s): string {
  if (strpbrk($s, ",\"\n\r") !== false) {
    return '"' . str_replace('"', '""', $s) . '"';
  }
  return $s;
}

function money(float $n): string {
  return number_format($n, 2, '.', '');
}

function has_column(PDO $pdo, string $table, string $col): bool {
  try {
    $st = $pdo->query("SHOW COLUMNS FROM `{$table}`");
    while ($r = $st->fetch(PDO::FETCH_ASSOC)) {
      if (strcasecmp((string)($r['Field'] ?? ''), $col) === 0) return true;
    }
    return false;
  } catch (\Throwable $e) {
    return false;
  }
}

function sql_in_placeholders(array $ids, string $prefix = ':id'): array {
  $ph = [];
  $params = [];
  $i = 0;
  foreach ($ids as $id) {
    $k = $prefix . $i;
    $ph[] = $k;
    $params[$k] = (int)$id;
    $i++;
  }
  if (!$ph) return ['(NULL)', []];
  return ['(' . implode(',', $ph) . ')', $params];
}

/**
 * Allowed org IDs resolver (updated):
 * - super_admin / special_admin / overseer: unrestricted (return null)
 * - faculty_admin: based on organizations.created_by if column exists
 *   fallback: accreditation_requests.coordinator_user_id (ANY term, NOT term-strict)
 */
function allowed_org_ids(PDO $pdo, array $me): ?array {
  $role = strtolower((string)($me['role'] ?? ''));
  if (is_admin_all_orgs($role)) return null;

  if ($role === 'faculty_admin') {
    $uid = (int)($me['id'] ?? 0);
    if ($uid <= 0) return [];

    // ✅ Preferred: organizations.created_by
    if (has_column($pdo, 'organizations', 'created_by')) {
      $q = $pdo->prepare("
        SELECT o.id
        FROM organizations o
        WHERE o.created_by = :uid
          AND o.status <> 'Archived'
        ORDER BY o.org_type ASC, o.org_name ASC
      ");
      $q->execute([':uid' => $uid]);
      $ids = [];
      while ($r = $q->fetch(PDO::FETCH_ASSOC)) $ids[] = (int)$r['id'];
      return $ids;
    }

    // Fallback: coordinator_user_id across ANY term (so semester mismatch won’t hide records)
    if (has_column($pdo, 'accreditation_requests', 'coordinator_user_id')) {
      $q = $pdo->prepare("
        SELECT ar.org_id
        FROM accreditation_requests ar
        WHERE ar.coordinator_user_id = :uid
        GROUP BY ar.org_id
        ORDER BY ar.org_id ASC
      ");
      $q->execute([':uid' => $uid]);
      $ids = [];
      while ($r = $q->fetch(PDO::FETCH_ASSOC)) $ids[] = (int)$r['org_id'];
      return $ids;
    }

    return [];
  }

  // other roles default deny (adjust if you want)
  return [];
}

/* =========================
   Data fetchers
   ========================= */

function boot_data(PDO $pdo, array $me): array {
  $terms = [];
  $st = $pdo->query("SELECT id, school_year, semester, status FROM academic_terms ORDER BY school_year DESC, FIELD(semester,'1st','2nd','Summer'), id DESC");
  while ($r = $st->fetch(PDO::FETCH_ASSOC)) $terms[] = $r;

  $allowed = allowed_org_ids($pdo, $me);

  $orgs = [];
  if (is_array($allowed)) {
    if (!$allowed) {
      $orgs = [];
    } else {
      [$inSql, $inParams] = sql_in_placeholders($allowed, ':oid');
      $q = $pdo->prepare("
        SELECT id, org_name, abbreviation, org_type, scope, status
        FROM organizations
        WHERE id IN {$inSql}
          AND status <> 'Archived'
        ORDER BY org_type ASC, org_name ASC
      ");
      $q->execute($inParams);
      $orgs = $q->fetchAll(PDO::FETCH_ASSOC) ?: [];
    }
  } else {
    $q = $pdo->query("
      SELECT id, org_name, abbreviation, org_type, scope, status
      FROM organizations
      WHERE status <> 'Archived'
      ORDER BY org_type ASC, org_name ASC
    ");
    $orgs = $q->fetchAll(PDO::FETCH_ASSOC) ?: [];
  }

  return [
    'me' => [
      'id' => (int)$me['id'],
      'role' => (string)$me['role'],
      'id_number' => (string)($me['id_number'] ?? ''),
      'email' => (string)($me['email'] ?? ''),
    ],
    'terms' => $terms,
    'orgs' => $orgs,
  ];
}

function fetch_org_fees(PDO $pdo, string $schoolYear, string $semester, int $orgId, string $search, int $page, int $pageSize, ?array $allowedOrgIds): array {
  $page = max(1, $page);
  $pageSize = max(1, min(100, $pageSize));
  $offset = ($page - 1) * $pageSize;

  $where = " WHERE t.school_year = :sy AND t.semester = :sem ";
  $params = [':sy' => $schoolYear, ':sem' => $semester];

  if (is_array($allowedOrgIds)) {
    if ($orgId > 0) {
      if (!in_array($orgId, $allowedOrgIds, true)) {
        return ['rows' => [], 'total_rows' => 0, 'total_pages' => 1, 'summary' => ['total_rows' => 0, 'total_amount' => 0, 'paid_count' => 0]];
      }
      $where .= " AND o.id = :org_id ";
      $params[':org_id'] = $orgId;
    } else {
      if (!$allowedOrgIds) {
        return ['rows' => [], 'total_rows' => 0, 'total_pages' => 1, 'summary' => ['total_rows' => 0, 'total_amount' => 0, 'paid_count' => 0]];
      }
      [$inSql, $inParams] = sql_in_placeholders($allowedOrgIds, ':ao');
      $where .= " AND o.id IN {$inSql} ";
      $params += $inParams;
    }
  } else {
    if ($orgId > 0) {
      $where .= " AND o.id = :org_id ";
      $params[':org_id'] = $orgId;
    }
  }

  if ($search !== '') {
    $where .= " AND (
      r.receipt_no LIKE :q OR
      u.id_number LIKE :q OR
      CONCAT_WS(' ', u.first_name, u.middle_name, u.last_name, u.suffix) LIKE :q
    ) ";
    $params[':q'] = '%' . $search . '%';
  }

  $countSql = "
    SELECT COUNT(*)
    FROM organization_fee_receipts r
    INNER JOIN organization_fee_payments p ON p.id = r.payment_id
    INNER JOIN organizations o ON o.id = p.org_id
    INNER JOIN academic_terms t ON t.id = p.academic_term_id
    LEFT JOIN users u ON u.id = p.student_user_id
    {$where}
  ";
  $st = $pdo->prepare($countSql);
  $st->execute($params);
  $totalRows = (int)($st->fetchColumn() ?: 0);
  $totalPages = max(1, (int)ceil($totalRows / $pageSize));

  $sql = "
    SELECT
      r.id AS receipt_id,
      r.receipt_no,
      r.amount,
      r.paid_at,
      DATE_FORMAT(r.paid_at, '%Y-%m-%d') AS paid_at_label,
      p.org_id,
      o.org_name,
      o.abbreviation,
      CONCAT(o.org_name, IF(o.abbreviation IS NULL OR o.abbreviation='', '', CONCAT(' (', o.abbreviation, ')'))) AS org_label,
      u.id_number AS student_id_number,
      CONCAT_WS(' ',
        NULLIF(u.first_name,''),
        CASE WHEN u.middle_name IS NULL OR u.middle_name='' THEN NULL ELSE CONCAT(LEFT(u.middle_name,1),'.') END,
        NULLIF(u.last_name,''),
        NULLIF(u.suffix,'')
      ) AS student_name
    FROM organization_fee_receipts r
    INNER JOIN organization_fee_payments p ON p.id = r.payment_id
    INNER JOIN organizations o ON o.id = p.org_id
    INNER JOIN academic_terms t ON t.id = p.academic_term_id
    LEFT JOIN users u ON u.id = p.student_user_id
    {$where}
    ORDER BY r.paid_at DESC, r.id DESC
    LIMIT {$pageSize} OFFSET {$offset}
  ";
  $q = $pdo->prepare($sql);
  $q->execute($params);
  $rows = $q->fetchAll(PDO::FETCH_ASSOC) ?: [];

  $sumSql = "
    SELECT
      COUNT(*) AS total_rows,
      COALESCE(SUM(r.amount),0) AS total_amount
    FROM organization_fee_receipts r
    INNER JOIN organization_fee_payments p ON p.id = r.payment_id
    INNER JOIN organizations o ON o.id = p.org_id
    INNER JOIN academic_terms t ON t.id = p.academic_term_id
    LEFT JOIN users u ON u.id = p.student_user_id
    {$where}
  ";
  $s = $pdo->prepare($sumSql);
  $s->execute($params);
  $summary = $s->fetch(PDO::FETCH_ASSOC) ?: ['total_rows' => 0, 'total_amount' => 0];
  $summary['paid_count'] = (int)($summary['total_rows'] ?? 0);

  foreach ($rows as &$r) { $r['status_label'] = 'Paid'; }
  unset($r);

  return [
    'rows' => $rows,
    'total_rows' => $totalRows,
    'total_pages' => $totalPages,
    'summary' => [
      'total_rows' => (int)($summary['total_rows'] ?? 0),
      'total_amount' => (float)($summary['total_amount'] ?? 0),
      'paid_count' => (int)($summary['paid_count'] ?? 0),
    ]
  ];
}

function fetch_membership(PDO $pdo, string $schoolYear, string $semester, int $orgId, string $search, int $page, int $pageSize, ?array $allowedOrgIds): array {
  $page = max(1, $page);
  $pageSize = max(1, min(100, $pageSize));
  $offset = ($page - 1) * $pageSize;

  $where = " WHERE t.school_year = :sy AND t.semester = :sem ";
  $params = [':sy' => $schoolYear, ':sem' => $semester];

  if (is_array($allowedOrgIds)) {
    if ($orgId > 0) {
      if (!in_array($orgId, $allowedOrgIds, true)) {
        return ['rows' => [], 'total_rows' => 0, 'total_pages' => 1, 'summary' => ['total_rows' => 0, 'total_amount' => 0, 'paid_count' => 0]];
      }
      $where .= " AND o.id = :org_id ";
      $params[':org_id'] = $orgId;
    } else {
      if (!$allowedOrgIds) {
        return ['rows' => [], 'total_rows' => 0, 'total_pages' => 1, 'summary' => ['total_rows' => 0, 'total_amount' => 0, 'paid_count' => 0]];
      }
      [$inSql, $inParams] = sql_in_placeholders($allowedOrgIds, ':ao');
      $where .= " AND o.id IN {$inSql} ";
      $params += $inParams;
    }
  } else {
    if ($orgId > 0) {
      $where .= " AND o.id = :org_id ";
      $params[':org_id'] = $orgId;
    }
  }

  if ($search !== '') {
    $where .= " AND (
      r.receipt_no LIKE :q OR
      u.id_number LIKE :q OR
      CONCAT_WS(' ', u.first_name, u.middle_name, u.last_name, u.suffix) LIKE :q
    ) ";
    $params[':q'] = '%' . $search . '%';
  }

  $countSql = "
    SELECT COUNT(*)
    FROM organization_membership_receipts r
    INNER JOIN organization_memberships m ON m.id = r.membership_id
    INNER JOIN organizations o ON o.id = m.org_id
    INNER JOIN academic_terms t ON t.id = m.academic_term_id
    LEFT JOIN users u ON u.id = m.student_user_id
    {$where}
  ";
  $st = $pdo->prepare($countSql);
  $st->execute($params);
  $totalRows = (int)($st->fetchColumn() ?: 0);
  $totalPages = max(1, (int)ceil($totalRows / $pageSize));

  $sql = "
    SELECT
      r.id AS receipt_id,
      r.receipt_no,
      r.amount,
      r.paid_at,
      DATE_FORMAT(r.paid_at, '%Y-%m-%d') AS paid_at_label,
      m.org_id,
      o.org_name,
      o.abbreviation,
      CONCAT(o.org_name, IF(o.abbreviation IS NULL OR o.abbreviation='', '', CONCAT(' (', o.abbreviation, ')'))) AS org_label,
      m.status,
      u.id_number AS student_id_number,
      CONCAT_WS(' ',
        NULLIF(u.first_name,''),
        CASE WHEN u.middle_name IS NULL OR u.middle_name='' THEN NULL ELSE CONCAT(LEFT(u.middle_name,1),'.') END,
        NULLIF(u.last_name,''),
        NULLIF(u.suffix,'')
      ) AS student_name
    FROM organization_membership_receipts r
    INNER JOIN organization_memberships m ON m.id = r.membership_id
    INNER JOIN organizations o ON o.id = m.org_id
    INNER JOIN academic_terms t ON t.id = m.academic_term_id
    LEFT JOIN users u ON u.id = m.student_user_id
    {$where}
    ORDER BY r.paid_at DESC, r.id DESC
    LIMIT {$pageSize} OFFSET {$offset}
  ";
  $q = $pdo->prepare($sql);
  $q->execute($params);
  $rows = $q->fetchAll(PDO::FETCH_ASSOC) ?: [];

  $sumSql = "
    SELECT
      COUNT(*) AS total_rows,
      COALESCE(SUM(r.amount),0) AS total_amount
    FROM organization_membership_receipts r
    INNER JOIN organization_memberships m ON m.id = r.membership_id
    INNER JOIN organizations o ON o.id = m.org_id
    INNER JOIN academic_terms t ON t.id = m.academic_term_id
    LEFT JOIN users u ON u.id = m.student_user_id
    {$where}
  ";
  $s = $pdo->prepare($sumSql);
  $s->execute($params);
  $summary = $s->fetch(PDO::FETCH_ASSOC) ?: ['total_rows' => 0, 'total_amount' => 0];
  $summary['paid_count'] = (int)($summary['total_rows'] ?? 0);

  foreach ($rows as &$r) { $r['status_label'] = (string)($r['status'] ?? 'Paid'); }
  unset($r);

  return [
    'rows' => $rows,
    'total_rows' => $totalRows,
    'total_pages' => $totalPages,
    'summary' => [
      'total_rows' => (int)($summary['total_rows'] ?? 0),
      'total_amount' => (float)($summary['total_amount'] ?? 0),
      'paid_count' => (int)($summary['paid_count'] ?? 0),
    ]
  ];
}

function fetch_events(PDO $pdo, string $schoolYear, string $semester, int $orgId, string $search, int $page, int $pageSize, ?array $allowedOrgIds): array {
  $page = max(1, $page);
  $pageSize = max(1, min(100, $pageSize));
  $offset = ($page - 1) * $pageSize;

  $where = " WHERE CONCAT(e.start_year, '-', e.end_year) = :sy ";
  $params = [':sy' => $schoolYear];

  $ay = semester_to_active_year($semester);
  if ($ay > 0) {
    $where .= " AND e.active_year = :ay ";
    $params[':ay'] = $ay;
  }

  if (is_array($allowedOrgIds)) {
    if ($orgId > 0) {
      if (!in_array($orgId, $allowedOrgIds, true)) {
        return ['rows' => [], 'total_rows' => 0, 'total_pages' => 1, 'summary' => ['total_events' => 0, 'total_credits' => 0, 'total_debits' => 0, 'total_balance' => 0]];
      }
      $where .= " AND e.org_id = :org_id ";
      $params[':org_id'] = $orgId;
    } else {
      if (!$allowedOrgIds) {
        return ['rows' => [], 'total_rows' => 0, 'total_pages' => 1, 'summary' => ['total_events' => 0, 'total_credits' => 0, 'total_debits' => 0, 'total_balance' => 0]];
      }
      [$inSql, $inParams] = sql_in_placeholders($allowedOrgIds, ':ao');
      $where .= " AND e.org_id IN {$inSql} ";
      $params += $inParams;
    }
  } else {
    if ($orgId > 0) {
      $where .= " AND e.org_id = :org_id ";
      $params[':org_id'] = $orgId;
    }
  }

  if ($search !== '') {
    $where .= " AND (e.title LIKE :q OR o.org_name LIKE :q OR o.abbreviation LIKE :q) ";
    $params[':q'] = '%' . $search . '%';
  }

  $countSql = "
    SELECT COUNT(*)
    FROM event_events e
    INNER JOIN organizations o ON o.id = e.org_id
    {$where}
      AND e.accomplishment_status = 'Approved'
  ";
  $st = $pdo->prepare($countSql);
  $st->execute($params);
  $totalRows = (int)($st->fetchColumn() ?: 0);
  $totalPages = max(1, (int)ceil($totalRows / $pageSize));

  $sql = "
    SELECT
      e.id,
      e.org_id,
      e.title,
      e.event_date,
      e.status,
      e.accomplishment_status,
      o.org_name,
      o.abbreviation,
      CONCAT(o.org_name, IF(o.abbreviation IS NULL OR o.abbreviation='', '', CONCAT(' (', o.abbreviation, ')'))) AS org_label,
      COALESCE((SELECT SUM(ec.amount) FROM event_credits ec WHERE ec.event_id = e.id), 0) AS total_credits,
      COALESCE((SELECT SUM(ed.amount) FROM event_debits ed WHERE ed.event_id = e.id), 0) AS total_debits,
      COALESCE((SELECT SUM(ec.amount) FROM event_credits ec WHERE ec.event_id = e.id), 0)
        - COALESCE((SELECT SUM(ed.amount) FROM event_debits ed WHERE ed.event_id = e.id), 0) AS balance
    FROM event_events e
    INNER JOIN organizations o ON o.id = e.org_id
    {$where}
      AND e.accomplishment_status = 'Approved'
    GROUP BY e.id
    ORDER BY e.event_date DESC, e.id DESC
    LIMIT {$pageSize} OFFSET {$offset}
  ";
  $q = $pdo->prepare($sql);
  $q->execute($params);
  $rows = $q->fetchAll(PDO::FETCH_ASSOC) ?: [];

  $sumSql = "
    SELECT
      COUNT(DISTINCT e.id) AS total_events,
      COALESCE(SUM((SELECT SUM(ec.amount) FROM event_credits ec WHERE ec.event_id = e.id)), 0) AS total_credits,
      COALESCE(SUM((SELECT SUM(ed.amount) FROM event_debits ed WHERE ed.event_id = e.id)), 0) AS total_debits
    FROM event_events e
    INNER JOIN organizations o ON o.id = e.org_id
    {$where}
      AND e.accomplishment_status = 'Approved'
  ";
  $s = $pdo->prepare($sumSql);
  $s->execute($params);
  $summary = $s->fetch(PDO::FETCH_ASSOC) ?: ['total_events' => 0, 'total_credits' => 0, 'total_debits' => 0];
  $summary['total_balance'] = (float)($summary['total_credits'] ?? 0) - (float)($summary['total_debits'] ?? 0);

  return [
    'rows' => $rows,
    'total_rows' => $totalRows,
    'total_pages' => $totalPages,
    'summary' => [
      'total_events' => (int)($summary['total_events'] ?? 0),
      'total_credits' => (float)($summary['total_credits'] ?? 0),
      'total_debits' => (float)($summary['total_debits'] ?? 0),
      'total_balance' => (float)($summary['total_balance'] ?? 0),
    ]
  ];
}

/* =========================
   Routes
   ========================= */
$method = strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET');
$me = require_login($pdo);

if ($method === 'GET') {
  $action = trim((string)($_GET['action'] ?? ''));
  if ($action === '') fail('Missing action.', 400);

  $schoolYear = trim((string)($_GET['school_year'] ?? ''));
  $semester   = trim((string)($_GET['semester'] ?? ''));
  $orgId      = (int)($_GET['org_id'] ?? 0);
  $search     = trim((string)($_GET['search'] ?? ''));

  $allowed = allowed_org_ids($pdo, $me);

  if ($action === 'export_org_fees_csv') {
    header('Content-Type: text/csv; charset=utf-8');
    header('Content-Disposition: attachment; filename="org_fees.csv"');

    $res = fetch_org_fees($pdo, $schoolYear, $semester, $orgId, $search, 1, 50000, $allowed);
    echo "Date,Receipt No,Student ID,Student Name,Organization,Amount,Status\n";
    foreach ($res['rows'] as $r) {
      echo implode(",", [
        csv_escape((string)($r['paid_at_label'] ?? $r['paid_at'] ?? '')),
        csv_escape((string)($r['receipt_no'] ?? '')),
        csv_escape((string)($r['student_id_number'] ?? '')),
        csv_escape((string)($r['student_name'] ?? '')),
        csv_escape((string)($r['org_label'] ?? $r['org_name'] ?? '')),
        csv_escape(money((float)($r['amount'] ?? 0))),
        csv_escape((string)($r['status_label'] ?? 'Paid')),
      ]) . "\n";
    }
    exit;
  }

  if ($action === 'export_membership_csv') {
    header('Content-Type: text/csv; charset=utf-8');
    header('Content-Disposition: attachment; filename="membership_fees.csv"');

    $res = fetch_membership($pdo, $schoolYear, $semester, $orgId, $search, 1, 50000, $allowed);
    echo "Date,Receipt No,Student ID,Student Name,Organization,Amount,Status\n";
    foreach ($res['rows'] as $r) {
      echo implode(",", [
        csv_escape((string)($r['paid_at_label'] ?? $r['paid_at'] ?? '')),
        csv_escape((string)($r['receipt_no'] ?? '')),
        csv_escape((string)($r['student_id_number'] ?? '')),
        csv_escape((string)($r['student_name'] ?? '')),
        csv_escape((string)($r['org_label'] ?? $r['org_name'] ?? '')),
        csv_escape(money((float)($r['amount'] ?? 0))),
        csv_escape((string)($r['status_label'] ?? $r['status'] ?? 'Paid')),
      ]) . "\n";
    }
    exit;
  }

  if ($action === 'export_events_csv') {
    header('Content-Type: text/csv; charset=utf-8');
    header('Content-Disposition: attachment; filename="event_expenses.csv"');

    $res = fetch_events($pdo, $schoolYear, $semester, $orgId, $search, 1, 50000, $allowed);
    echo "Event,Organization,Date,Credits,Debits,Balance,Status,Accomplishment\n";
    foreach ($res['rows'] as $r) {
      echo implode(",", [
        csv_escape((string)($r['title'] ?? '')),
        csv_escape((string)($r['org_label'] ?? $r['org_name'] ?? '')),
        csv_escape((string)($r['event_date'] ?? '')),
        csv_escape(money((float)($r['total_credits'] ?? 0))),
        csv_escape(money((float)($r['total_debits'] ?? 0))),
        csv_escape(money((float)($r['balance'] ?? 0))),
        csv_escape((string)($r['status'] ?? '')),
        csv_escape((string)($r['accomplishment_status'] ?? '')),
      ]) . "\n";
    }
    exit;
  }

  fail('Unknown action.', 400);
}

/* =========================
   POST JSON API
   ========================= */
$body = parse_json_body();
$action = trim((string)($body['action'] ?? ''));
if ($action === '') fail('Missing action.', 400);

if ($action === 'boot') {
  ok(boot_data($pdo, $me));
}

$schoolYear = trim((string)($body['school_year'] ?? ''));
$semester   = trim((string)($body['semester'] ?? ''));
$orgId      = (int)($body['org_id'] ?? 0);
$search     = trim((string)($body['search'] ?? ''));
$page       = (int)($body['page'] ?? 1);
$pageSize   = (int)($body['page_size'] ?? 10);

if ($schoolYear === '' || $semester === '') {
  fail('Missing school_year or semester.', 400);
}

$allowed = allowed_org_ids($pdo, $me);

if ($action === 'list_org_fees') {
  $res = fetch_org_fees($pdo, $schoolYear, $semester, $orgId, $search, $page, $pageSize, $allowed);
  ok([
    'rows' => $res['rows'],
    'total_rows' => $res['total_rows'],
    'total_pages' => $res['total_pages'],
    'summary' => $res['summary'],
  ]);
}

if ($action === 'list_membership') {
  $res = fetch_membership($pdo, $schoolYear, $semester, $orgId, $search, $page, $pageSize, $allowed);
  ok([
    'rows' => $res['rows'],
    'total_rows' => $res['total_rows'],
    'total_pages' => $res['total_pages'],
    'summary' => $res['summary'],
  ]);
}

if ($action === 'list_events') {
  $res = fetch_events($pdo, $schoolYear, $semester, $orgId, $search, $page, $pageSize, $allowed);
  ok([
    'rows' => $res['rows'],
    'total_rows' => $res['total_rows'],
    'total_pages' => $res['total_pages'],
    'summary' => $res['summary'],
  ]);
}

fail('Unknown action.', 400);