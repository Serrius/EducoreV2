<?php
declare(strict_types=1);

session_start();
header('Content-Type: application/json');

require_once __DIR__ . '/db.php';

/* =========================================================
   Helpers
========================================================= */

function get_user_full_name(PDO $pdo, int $uid): string {
  if ($uid <= 0) return '';
  $st = $pdo->prepare("
    SELECT TRIM(CONCAT_WS(' ',
      COALESCE(first_name,''),
      NULLIF(COALESCE(middle_name,''),''),
      COALESCE(last_name,''),
      NULLIF(COALESCE(suffix,''),'')
    )) AS full_name
    FROM users
    WHERE id = :id
    LIMIT 1
  ");
  $st->execute([':id' => $uid]);
  return trim((string)($st->fetchColumn() ?: ''));
}

function out(bool $ok, string $msg = '', array $extra = []): void {
  echo json_encode(array_merge([
    'success' => $ok,
    'message' => $msg,
  ], $extra));
  exit;
}

function require_admin(): void {
  $role = (string)($_SESSION['role'] ?? '');
  if (!in_array($role, ['overseer', 'super_admin'], true)) {
    http_response_code(403);
    out(false, 'Forbidden: insufficient privileges.');
  }
}

/** Reads JSON body OR falls back to POST */
function read_input(): array {
  $raw = file_get_contents('php://input');
  $json = json_decode($raw, true);
  if (is_array($json)) return $json;
  return $_POST ?? [];
}

function clean(string $v): string {
  return trim($v);
}

/**
 * Enforce school_year to be YYYY-YYYY and end = start + 1
 * Returns array [startYear, endYear]
 */
function validate_school_year(string $schoolYear): array {
  if (!preg_match('/^\d{4}-\d{4}$/', $schoolYear)) {
    out(false, 'Invalid school year format. Use YYYY-YYYY (e.g., 2025-2026).');
  }

  [$startStr, $endStr] = explode('-', $schoolYear, 2);
  $start = (int)$startStr;
  $end = (int)$endStr;

  if ($start < 1900 || $start > 3000 || $end < 1900 || $end > 3001) {
    out(false, 'Invalid school year range.');
  }

  if ($end !== $start + 1) {
    out(false, 'Invalid school year span. End year must be start year + 1 (e.g., 2025-2026).');
  }

  return [$start, $end];
}

/**
 * PDO error handling: translate duplicate key errors nicely
 */
function handle_pdo_exception(Throwable $e): void {
  $msg = $e->getMessage();

  if ($e instanceof PDOException) {
    $sqlState = $e->getCode(); // often "23000"
    if ($sqlState === '23000' || str_contains($msg, 'Duplicate entry')) {
      out(false, 'Duplicate academic term: that School Year + Semester already exists.');
    }
  }

  out(false, 'Database error.');
}

/**
 * Get term by id
 */
function fetch_term(PDO $pdo, int $id): ?array {
  $stmt = $pdo->prepare("SELECT * FROM academic_terms WHERE id = :id");
  $stmt->execute(['id' => $id]);
  $row = $stmt->fetch(PDO::FETCH_ASSOC);
  return $row ?: null;
}

/**
 * Ensure a term row exists for (school_year, semester).
 * Returns the row id.
 */
function ensure_term(PDO $pdo, string $schoolYear, string $semester, string $statusIfNew = 'Closed'): int {
  $stmt = $pdo->prepare("SELECT id FROM academic_terms WHERE school_year = :sy AND semester = :sem LIMIT 1");
  $stmt->execute(['sy' => $schoolYear, 'sem' => $semester]);
  $id = (int)$stmt->fetchColumn();
  if ($id > 0) return $id;

  $ins = $pdo->prepare("
    INSERT INTO academic_terms (school_year, semester, status)
    VALUES (:sy, :sem, :st)
  ");
  $ins->execute([
    'sy' => $schoolYear,
    'sem' => $semester,
    'st' => $statusIfNew,
  ]);

  return (int)$pdo->lastInsertId();
}

/**
 * When switching academic terms (setting a term Active),
 * deactivate all students except Archived ones.
 * Returns affected row count.
 */
function deactivate_students_for_new_term(PDO $pdo): int {
  // users.status enum: Active/Inactive/Pending/Archived
  $stmt = $pdo->prepare("
    UPDATE users
    SET status = 'Inactive'
    WHERE role = 'student'
      AND status <> 'Archived'
  ");
  $stmt->execute();
  return (int)$stmt->rowCount();
}

/* =========================================================
   Bootstrap
========================================================= */

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
  out(false, 'Invalid request method.');
}

require_admin();
$in = read_input();
$action = (string)($in['action'] ?? '');
$debug = !empty($in['debug']); // set debug:1 from JS to get error details

/* =========================================================
   Actions
========================================================= */

try {

  /* -------------------------
     LIST ACTIVE
  ------------------------- */
  if ($action === 'list_active') {

    $search = clean((string)($in['search'] ?? ''));

    $sql = "
      SELECT *
      FROM academic_terms
      WHERE status = 'Active'
    ";
    $params = [];

    if ($search !== '') {
      $sql .= " AND (school_year LIKE :q OR semester LIKE :q)";
      $params['q'] = "%{$search}%";
    }

    $sql .= " ORDER BY created_at DESC";

    $stmt = $pdo->prepare($sql);
    $stmt->execute($params);
    $items = $stmt->fetchAll(PDO::FETCH_ASSOC);

    out(true, 'OK', [
      'items' => $items,
      'total' => count($items),
      'totalPages' => 1,
    ]);
  }

  /* -------------------------
     LIST CLOSED (PAGINATED)
  ------------------------- */
  if ($action === 'list_closed') {

    $search = clean((string)($in['search'] ?? ''));
    $page = max(1, (int)($in['page'] ?? 1));
    $pageSize = max(1, min(200, (int)($in['pageSize'] ?? 50)));
    $offset = ($page - 1) * $pageSize;

    $where = "status = 'Closed'";
    $params = [];

    if ($search !== '') {
      $where .= " AND (school_year LIKE :q OR semester LIKE :q)";
      $params['q'] = "%{$search}%";
    }

    $stmtCount = $pdo->prepare("SELECT COUNT(*) FROM academic_terms WHERE {$where}");
    $stmtCount->execute($params);
    $total = (int)$stmtCount->fetchColumn();

    $stmt = $pdo->prepare("
      SELECT *
      FROM academic_terms
      WHERE {$where}
      ORDER BY created_at DESC
      LIMIT {$pageSize} OFFSET {$offset}
    ");
    $stmt->execute($params);
    $items = $stmt->fetchAll(PDO::FETCH_ASSOC);

    out(true, 'OK', [
      'items' => $items,
      'page' => $page,
      'pageSize' => $pageSize,
      'total' => $total,
      'totalPages' => max(1, (int)ceil($total / $pageSize)),
    ]);
  }

  /* -------------------------
     GET ONE
  ------------------------- */
  if ($action === 'get_one') {

    $id = (int)($in['id'] ?? 0);
    if (!$id) out(false, 'Invalid term id.');

    $term = fetch_term($pdo, $id);
    if (!$term) out(false, 'Academic term not found.');

    out(true, 'OK', ['term' => $term]);
  }

  /* -------------------------
     CREATE
     NEW RULE:
     - Creating a term for SY will ensure BOTH 1st+2nd rows exist (frozen meaning)
     - Only selected semester gets chosen status (Active/Closed)
     - Other semester is created (if missing) as Closed
  ------------------------- */
  if ($action === 'create') {

    $schoolYear = clean((string)($in['school_year'] ?? ''));
    $semester = clean((string)($in['semester'] ?? ''));
    $status = clean((string)($in['status'] ?? 'Closed'));

    if ($schoolYear === '' || $semester === '') {
      out(false, 'School year and semester are required.');
    }

    validate_school_year($schoolYear);

    if (!in_array($semester, ['1st', '2nd', 'Summer'], true)) {
      out(false, 'Invalid semester.');
    }

    if (!in_array($status, ['Active', 'Closed'], true)) {
      out(false, 'Invalid status.');
    }

    // If you select Summer, we won't auto-create 1st/2nd
    $autoCreatePair = in_array($semester, ['1st', '2nd'], true);

    $pdo->beginTransaction();

    // If setting to Active, close current Active first
    if ($status === 'Active') {
      $pdo->exec("UPDATE academic_terms SET status = 'Closed' WHERE status = 'Active'");
    }

    try {
      // Ensure selected term exists (create if missing)
      $selectedId = ensure_term($pdo, $schoolYear, $semester, $status);

      // Update selected term status (in case it already existed)
      $stmtUp = $pdo->prepare("UPDATE academic_terms SET status = :st WHERE id = :id");
      $stmtUp->execute(['st' => $status, 'id' => $selectedId]);

      // Ensure the “other semester” exists (Closed) for frozen history
      if ($autoCreatePair) {
        $other = ($semester === '1st') ? '2nd' : '1st';
        ensure_term($pdo, $schoolYear, $other, 'Closed');
      }

      // NEW: deactivate students when switching to an Active term
      $studentsDeactivated = 0;
      if ($status === 'Active') {
        $studentsDeactivated = deactivate_students_for_new_term($pdo);
      }

      $pdo->commit();

      out(true, 'Academic term saved (school year frozen with separate semester rows).', [
        'selected_id' => $selectedId,
        'students_deactivated' => $studentsDeactivated,
      ]);

    } catch (Throwable $e) {
      if ($pdo->inTransaction()) $pdo->rollBack();
      handle_pdo_exception($e);
    }
  }

  /* -------------------------
     UPDATE
     NEW RULE:
     - DO NOT allow changing school_year/semester
     - Only allow status updates
  ------------------------- */
  if ($action === 'update') {

    $id = (int)($in['id'] ?? 0);
    if (!$id) out(false, 'Invalid term id.');

    $status = clean((string)($in['status'] ?? 'Closed'));
    if (!in_array($status, ['Active', 'Closed'], true)) {
      out(false, 'Invalid status.');
    }

    $existing = fetch_term($pdo, $id);
    if (!$existing) out(false, 'Academic term not found.');

    // If client sends school_year/semester and tries to change them, reject (freeze meaning)
    $reqSY = clean((string)($in['school_year'] ?? ''));
    $reqSem = clean((string)($in['semester'] ?? ''));
    if (($reqSY !== '' && $reqSY !== (string)$existing['school_year']) ||
        ($reqSem !== '' && $reqSem !== (string)$existing['semester'])) {
      out(false, 'You cannot change school year/semester of an existing term. Create a new term instead.');
    }

    $pdo->beginTransaction();

    // If setting to Active, close current Active first
    if ($status === 'Active') {
      $pdo->exec("UPDATE academic_terms SET status = 'Closed' WHERE status = 'Active'");
    }

    try {
      $stmt = $pdo->prepare("
        UPDATE academic_terms
        SET status = :st
        WHERE id = :id
      ");
      $stmt->execute([
        'st' => $status,
        'id' => $id,
      ]);

      // NEW: deactivate students when switching to an Active term
      $studentsDeactivated = 0;
      if ($status === 'Active') {
        $studentsDeactivated = deactivate_students_for_new_term($pdo);
      }

      $pdo->commit();
      out(true, 'Academic term status updated.', [
        'students_deactivated' => $studentsDeactivated,
      ]);

    } catch (Throwable $e) {
      if ($pdo->inTransaction()) $pdo->rollBack();
      handle_pdo_exception($e);
    }
  }

  /* -------------------------
     CLOSE TERM
  ------------------------- */
  if ($action === 'close') {

    $id = (int)($in['id'] ?? 0);
    if (!$id) out(false, 'Invalid term id.');

    $stmt = $pdo->prepare("
      UPDATE academic_terms
      SET status = 'Closed'
      WHERE id = :id
    ");
    $stmt->execute(['id' => $id]);

    out(true, 'Academic term closed.');
  }

  /* -------------------------
     RESTORE (SET ACTIVE)
  ------------------------- */
  if ($action === 'restore') {

    $id = (int)($in['id'] ?? 0);
    if (!$id) out(false, 'Invalid term id.');

    $pdo->beginTransaction();

    // Close any existing active term, then activate this one
    $pdo->exec("UPDATE academic_terms SET status = 'Closed' WHERE status = 'Active'");

    $stmt = $pdo->prepare("
      UPDATE academic_terms
      SET status = 'Active'
      WHERE id = :id
    ");
    $stmt->execute(['id' => $id]);

    // NEW: deactivate students when switching to an Active term
    $studentsDeactivated = deactivate_students_for_new_term($pdo);

    $pdo->commit();
    out(true, 'Academic term set as Active.', [
      'students_deactivated' => $studentsDeactivated,
    ]);
  }

  out(false, 'Unknown action.');

} catch (Throwable $e) {
  if ($pdo->inTransaction()) $pdo->rollBack();

  error_log('[manage-academic-terms] ' . $e->getMessage());
  error_log($e->getTraceAsString());

  if (!empty($debug)) {
    out(false, 'Server error in manage-academic-terms.php.', [
      'debug_error' => $e->getMessage(),
      'debug_where' => $action,
    ]);
  }

  out(false, 'Server error in manage-academic-terms.php.');
}