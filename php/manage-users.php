<?php
declare(strict_types=1);

session_start();
header('Content-Type: application/json');

require_once __DIR__ . '/db.php'; // must provide $pdo (PDO)

/** =========================
 *  Helpers
 *  ========================= */
function out(bool $ok, string $msg = '', array $extra = []): void {
  echo json_encode(array_merge([
    'success' => $ok,
    'message' => $msg,
  ], $extra));
  exit;
}

function read_input(): array {
  // Supports JSON and form-data
  $raw = file_get_contents('php://input');
  $json = json_decode($raw ?: '', true);
  if (is_array($json)) return $json;
  return $_POST ?? [];
}

function qs(string $k, array $src, string $default = ''): string {
  if (!isset($src[$k])) return $default;
  $v = $src[$k];
  if (is_string($v) || is_numeric($v)) return trim((string)$v);
  return $default;
}

function qi(string $k, array $src, int $default = 0): int {
  if (!isset($src[$k])) return $default;
  $v = $src[$k];
  if (is_numeric($v)) return (int)$v;
  return $default;
}

function clean_like(string $s): string {
  // escape % and _ for LIKE
  $s = str_replace(['\\', '%', '_'], ['\\\\', '\%', '\_'], $s);
  return $s;
}

function normalize_status(string $s): string {
  $s = trim($s);
  // enforce exact casing used by ENUM
  $map = [
    'active' => 'Active',
    'inactive' => 'Inactive',
    'pending' => 'Pending',
    'archived' => 'Archived',
  ];
  $k = strtolower($s);
  return $map[$k] ?? $s;
}

function random_password(int $len = 10): string {
  // simple, good-enough for temp password; you can replace later
  $chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%';
  $out = '';
  $max = strlen($chars) - 1;
  for ($i = 0; $i < $len; $i++) {
    $out .= $chars[random_int(0, $max)];
  }
  return $out;
}

/** =========================
 *  Validation Helpers
 *  ========================= */
function check_duplicate_email(PDO $pdo, string $email, int $excludeId = 0): bool {
  if ($email === '') return false;

  $sql = "SELECT COUNT(*) as count FROM users WHERE email = ?";
  $params = [$email];

  if ($excludeId > 0) {
    $sql .= " AND id != ?";
    $params[] = $excludeId;
  }

  $st = $pdo->prepare($sql);
  $st->execute($params);
  $result = $st->fetch(PDO::FETCH_ASSOC);

  return ($result['count'] ?? 0) > 0;
}

function check_duplicate_id_number(PDO $pdo, string $id_number, int $excludeId = 0): bool {
  if ($id_number === '') return false;

  $sql = "SELECT COUNT(*) as count FROM users WHERE id_number = ?";
  $params = [$id_number];

  if ($excludeId > 0) {
    $sql .= " AND id != ?";
    $params[] = $excludeId;
  }

  $st = $pdo->prepare($sql);
  $st->execute($params);
  $result = $st->fetch(PDO::FETCH_ASSOC);

  return ($result['count'] ?? 0) > 0;
}

/**
 * Validate program value against programs table (Active only).
 * Accepts either abbreviation OR program_name.
 * If empty -> allowed (stored as NULL).
 */
function validate_program_or_null(PDO $pdo, string $program): ?string {
  $program = trim($program);
  if ($program === '') return null;

  $st = $pdo->prepare("
    SELECT abbreviation, program_name
    FROM programs
    WHERE status = 'Active'
      AND (abbreviation = ? OR program_name = ?)
    LIMIT 1
  ");
  $st->execute([$program, $program]);
  $row = $st->fetch(PDO::FETCH_ASSOC);

  if (!$row) {
    out(false, "Invalid program. Please select an Active program.");
  }

  // Prefer storing abbreviation (your users.program stores abbreviation in students.js logic)
  $abbr = trim((string)($row['abbreviation'] ?? ''));
  return $abbr !== '' ? $abbr : trim((string)($row['program_name'] ?? $program));
}

/** =========================
 *  Auth: overseer OR active super_admin
 *  ========================= */
function require_overseer_or_active_super(PDO $pdo): array {
  $role = (string)($_SESSION['role'] ?? '');
  if ($role === 'overseer') {
    return ['role' => 'overseer', 'status' => (string)($_SESSION['status'] ?? '')];
  }

  if ($role !== 'super_admin') {
    http_response_code(403);
    out(false, 'Forbidden: overseer or active super_admin only.');
  }

  // super_admin must be Active
  $sessStatus = (string)($_SESSION['status'] ?? '');
  if ($sessStatus === 'Active') {
    return ['role' => 'super_admin', 'status' => 'Active'];
  }

  // If session doesn't store status, try fetch from DB using session identifiers.
  $userId = $_SESSION['user_id'] ?? null;       // recommended
  $idNo   = $_SESSION['id_number'] ?? null;     // optional
  $email  = $_SESSION['email'] ?? null;         // optional

  $sql = '';
  $params = [];

  if (is_numeric($userId)) {
    $sql = "SELECT role, status FROM users WHERE id = ? LIMIT 1";
    $params = [(int)$userId];
  } elseif (is_string($idNo) && $idNo !== '') {
    $sql = "SELECT role, status FROM users WHERE id_number = ? LIMIT 1";
    $params = [$idNo];
  } elseif (is_string($email) && $email !== '') {
    $sql = "SELECT role, status FROM users WHERE email = ? LIMIT 1";
    $params = [$email];
  } else {
    http_response_code(403);
    out(false, 'Forbidden: cannot verify super_admin status (missing session identifiers).');
  }

  $st = $pdo->prepare($sql);
  $st->execute($params);
  $u = $st->fetch(PDO::FETCH_ASSOC);

  if (!$u || (string)$u['role'] !== 'super_admin') {
    http_response_code(403);
    out(false, 'Forbidden: not a super_admin.');
  }
  if ((string)$u['status'] !== 'Active') {
    http_response_code(403);
    out(false, 'Forbidden: super_admin must be Active.');
  }

  // refresh session to avoid requery every time
  $_SESSION['status'] = 'Active';

  return ['role' => 'super_admin', 'status' => 'Active'];
}

/** =========================
 *  Meta queries
 *  ========================= */
function get_active_term(PDO $pdo): ?array {
  $st = $pdo->prepare("
    SELECT id, school_year, semester, status, created_at
    FROM academic_terms
    WHERE status = 'Active'
    ORDER BY created_at DESC, id DESC
    LIMIT 1
  ");
  $st->execute();
  $row = $st->fetch(PDO::FETCH_ASSOC);
  return $row ?: null;
}

function get_active_programs(PDO $pdo): array {
  $st = $pdo->prepare("
    SELECT id, program_name, abbreviation, image_path, status, created_at
    FROM programs
    WHERE status = 'Active'
    ORDER BY program_name ASC
  ");
  $st->execute();
  return $st->fetchAll(PDO::FETCH_ASSOC) ?: [];
}

/** =========================
 *  Validation rules
 *  ========================= */
function allowed_status_for_group(string $group): array {
  // group: students | faculty | moderators | presidents
  if ($group === 'students' || $group === 'presidents') return ['Active','Inactive','Pending','Archived'];
  // staff doesn't need Pending by default
  return ['Active','Inactive','Archived'];
}

function require_allowed_status(string $status, array $allowed, string $label = 'status'): string {
  $status = normalize_status($status);
  if (!in_array($status, $allowed, true)) {
    out(false, "Invalid {$label}. Allowed: " . implode(', ', $allowed));
  }
  return $status;
}

function require_staff_role(string $role): string {
  $role = trim($role);
  if ($role !== 'faculty_admin' && $role !== 'moderator' && $role !== 'org_president') {
    out(false, 'Invalid role for staff. Allowed: Coordinator and President are only');
  }
  return $role;
}

/** =========================
 *  Actions
 *  ========================= */
$in = read_input();
$action = qs('action', $in, '');

try {
  // Gate everything
  require_overseer_or_active_super($pdo);

  if ($action === 'meta') {
    $term = get_active_term($pdo);
    $programs = get_active_programs($pdo);
    out(true, 'OK', [
      'active_term' => $term,
      'programs' => $programs,
    ]);
  }

  if ($action === 'list_users') {
    $group  = qs('group', $in, 'students'); // students | faculty | moderators | presidents
    $status = normalize_status(qs('status', $in, '')); // optional
    $search = qs('search', $in, '');
    $page   = max(1, qi('page', $in, 1));
    $limit  = qi('limit', $in, 10);
    if ($limit < 5) $limit = 5;
    if ($limit > 100) $limit = 100;
    $offset = ($page - 1) * $limit;

    $where = [];
    $params = [];

    // roles by group
    if ($group === 'students') {
      $where[] = "role = 'student'";
    } elseif ($group === 'faculty') {
      $where[] = "role = 'faculty_admin'";
    } elseif ($group === 'moderators') {
      $where[] = "role = 'moderator'";
    } elseif ($group === 'presidents') {
      $where[] = "role = 'org_president'";
    } else {
      out(false, 'Invalid group. Use: students, faculty, moderators, presidents');
    }

    // status filter
    if ($status !== '') {
      $allowed = allowed_status_for_group($group);
      $status = require_allowed_status($status, $allowed);
      $where[] = "status = ?";
      $params[] = $status;
    }

    // search
    if ($search !== '') {
      $s = '%' . clean_like($search) . '%';
      $where[] = "(id_number LIKE ? OR first_name LIKE ? OR last_name LIKE ? OR email LIKE ? OR program LIKE ?)";
      array_push($params, $s, $s, $s, $s, $s);
    }

    $whereSql = $where ? ('WHERE ' . implode(' AND ', $where)) : '';

    // count
    $stCount = $pdo->prepare("SELECT COUNT(*) AS c FROM users {$whereSql}");
    $stCount->execute($params);
    $total = (int)($stCount->fetch(PDO::FETCH_ASSOC)['c'] ?? 0);

    // list
    $sql = "
      SELECT
        id, id_number, first_name, middle_name, last_name, suffix, email,
        program, year_level, school_year,
        role, status, created_at, last_login_at
      FROM users
      {$whereSql}
      ORDER BY id DESC
      LIMIT {$limit} OFFSET {$offset}
    ";
    $st = $pdo->prepare($sql);
    $st->execute($params);
    $rows = $st->fetchAll(PDO::FETCH_ASSOC) ?: [];

    out(true, 'OK', [
      'rows' => $rows,
      'page' => $page,
      'limit' => $limit,
      'total' => $total,
    ]);
  }

  // Get single user for editing
  if ($action === 'get_user') {
    $id = qi('id', $in, 0);
    if ($id <= 0) out(false, 'Invalid user ID.');

    $st = $pdo->prepare("
      SELECT id, id_number, first_name, middle_name, last_name, suffix,
             email, program, year_level, school_year, role, status, created_at, last_login_at
      FROM users
      WHERE id = ?
      LIMIT 1
    ");
    $st->execute([$id]);
    $user = $st->fetch(PDO::FETCH_ASSOC);

    if (!$user) out(false, 'User not found.');
    out(true, 'OK', ['user' => $user]);
  }

  if ($action === 'create_student') {
    $id_number   = qs('id_number', $in);
    $first_name  = qs('first_name', $in);
    $middle_name = qs('middle_name', $in);
    $last_name   = qs('last_name', $in);
    $suffix      = qs('suffix', $in);
    $email       = qs('email', $in);
    $program     = qs('program', $in);
    $year_level  = qs('year_level', $in);
    $school_year = qs('school_year', $in);
    $status      = require_allowed_status(qs('status', $in, 'Pending'), allowed_status_for_group('students'));

    // Required field validation
    $requiredErrors = [];
    if ($id_number === '') $requiredErrors[] = 'ID Number is required';
    if ($first_name === '') $requiredErrors[] = 'First Name is required';
    if ($last_name === '') $requiredErrors[] = 'Last Name is required';
    if ($program === '') $requiredErrors[] = 'Program is required for students';
    if ($year_level === '') $requiredErrors[] = 'Year Level is required for students';

    if (!empty($requiredErrors)) {
      out(false, 'Missing required fields: ' . implode(', ', $requiredErrors));
    }

    // Auto-fill school_year from active term if not provided
    if ($school_year === '') {
      $term = get_active_term($pdo);
      if ($term) {
        $school_year = (string)$term['school_year'];
      }
    }

    // Check for duplicates
    if (check_duplicate_id_number($pdo, $id_number)) {
      out(false, "ID Number '{$id_number}' is already registered to another user.");
    }

    if ($email !== '' && check_duplicate_email($pdo, $email)) {
      out(false, "Email '{$email}' is already registered to another user.");
    }

    // Password is now hashed ID number by default
    $hash = password_hash($id_number, PASSWORD_DEFAULT);

    $st = $pdo->prepare("
      INSERT INTO users (
        id_number, first_name, middle_name, last_name, suffix,
        email, program, year_level, school_year,
        password_hash, role, status, created_at
      ) VALUES (
        :id_number, :first_name, :middle_name, :last_name, :suffix,
        :email, :program, :year_level, :school_year,
        :password_hash, 'student', :status, NOW()
      )
    ");

    try {
      $st->execute([
        ':id_number' => $id_number,
        ':first_name' => $first_name,
        ':middle_name' => ($middle_name !== '' ? $middle_name : null),
        ':last_name' => $last_name,
        ':suffix' => ($suffix !== '' ? $suffix : null),
        ':email' => ($email !== '' ? $email : null),
        ':program' => $program,
        ':year_level' => $year_level,
        ':school_year' => $school_year,
        ':password_hash' => $hash,
        ':status' => $status,
      ]);
    } catch (PDOException $e) {
      if (str_contains($e->getMessage(), 'Duplicate entry')) {
        if (str_contains($e->getMessage(), 'id_number')) {
          out(false, "ID Number '{$id_number}' is already registered to another user.");
        } elseif (str_contains($e->getMessage(), 'email')) {
          out(false, "Email '{$email}' is already registered to another user.");
        }
      }
      throw $e;
    }

    out(true, 'Student created successfully.', [
      'id' => (int)$pdo->lastInsertId(),
      'note' => 'Password set to ID Number by default',
    ]);
  }

  if ($action === 'update_student') {
    $id          = qi('id', $in, 0);
    $id_number   = qs('id_number', $in);
    $first_name  = qs('first_name', $in);
    $middle_name = qs('middle_name', $in);
    $last_name   = qs('last_name', $in);
    $suffix      = qs('suffix', $in);
    $email       = qs('email', $in);
    $program     = qs('program', $in);
    $year_level  = qs('year_level', $in);
    $school_year = qs('school_year', $in);
    $status      = require_allowed_status(qs('status', $in, 'Pending'), allowed_status_for_group('students'));

    if ($id <= 0) out(false, 'Missing/invalid id.');

    $requiredErrors = [];
    if ($id_number === '') $requiredErrors[] = 'ID Number is required';
    if ($first_name === '') $requiredErrors[] = 'First Name is required';
    if ($last_name === '') $requiredErrors[] = 'Last Name is required';
    if ($program === '') $requiredErrors[] = 'Program is required for students';
    if ($year_level === '') $requiredErrors[] = 'Year Level is required for students';

    if (!empty($requiredErrors)) {
      out(false, 'Missing required fields: ' . implode(', ', $requiredErrors));
    }

    // Auto-fill school_year from active term if not provided OR if it's empty
    if ($school_year === '') {
      $term = get_active_term($pdo);
      if ($term) {
        $school_year = (string)$term['school_year'];
      }
    }

    if (check_duplicate_id_number($pdo, $id_number, $id)) {
      out(false, "ID Number '{$id_number}' is already registered to another user.");
    }

    if ($email !== '' && check_duplicate_email($pdo, $email, $id)) {
      out(false, "Email '{$email}' is already registered to another user.");
    }

    $stChk = $pdo->prepare("SELECT id, role FROM users WHERE id = ? LIMIT 1");
    $stChk->execute([$id]);
    $u = $stChk->fetch(PDO::FETCH_ASSOC);
    if (!$u) out(false, 'User not found.');
    if ((string)$u['role'] !== 'student' && (string)$u['role'] !== 'org_president') out(false, 'This endpoint only edits students or presidents.');

    $st = $pdo->prepare("
      UPDATE users
      SET
        id_number = :id_number,
        first_name = :first_name,
        middle_name = :middle_name,
        last_name = :last_name,
        suffix = :suffix,
        email = :email,
        program = :program,
        year_level = :year_level,
        school_year = :school_year,
        status = :status
      WHERE id = :id
      LIMIT 1
    ");

    try {
      $st->execute([
        ':id_number' => $id_number,
        ':first_name' => $first_name,
        ':middle_name' => ($middle_name !== '' ? $middle_name : null),
        ':last_name' => $last_name,
        ':suffix' => ($suffix !== '' ? $suffix : null),
        ':email' => ($email !== '' ? $email : null),
        ':program' => $program,
        ':year_level' => $year_level,
        ':school_year' => $school_year,
        ':status' => $status,
        ':id' => $id,
      ]);
    } catch (PDOException $e) {
      if (str_contains($e->getMessage(), 'Duplicate entry')) {
        if (str_contains($e->getMessage(), 'id_number')) {
          out(false, "ID Number '{$id_number}' is already registered to another user.");
        } elseif (str_contains($e->getMessage(), 'email')) {
          out(false, "Email '{$email}' is already registered to another user.");
        }
      }
      throw $e;
    }

    out(true, 'Student updated successfully.');
  }

  // NEW ACTION: Update user role (promote/demote)
  if ($action === 'update_user_role') {
    $id = qi('id', $in, 0);
    $newRole = qs('role', $in, '');

    if ($id <= 0) out(false, 'Invalid user ID.');
    if (!in_array($newRole, ['student', 'org_president'], true)) {
      out(false, 'Invalid role. Allowed: student, org_president');
    }

    $stChk = $pdo->prepare("SELECT id, role FROM users WHERE id = ? LIMIT 1");
    $stChk->execute([$id]);
    $u = $stChk->fetch(PDO::FETCH_ASSOC);
    if (!$u) out(false, 'User not found.');

    $st = $pdo->prepare("UPDATE users SET role = ? WHERE id = ? LIMIT 1");
    $st->execute([$newRole, $id]);

    out(true, 'User role updated successfully.');
  }

  /**
   * STAFF: now supports "program" submission (stored in users.program).
   * - program is OPTIONAL here; pass it to store (or send "" to clear).
   * - validated against Active programs (abbr or name).
   */
  if ($action === 'create_staff') {
    $role        = require_staff_role(qs('role', $in, ''));
    $id_number   = qs('id_number', $in);
    $first_name  = qs('first_name', $in);
    $middle_name = qs('middle_name', $in);
    $last_name   = qs('last_name', $in);
    $suffix      = qs('suffix', $in);
    $email       = qs('email', $in);
    $programIn   = qs('program', $in);
    $program     = validate_program_or_null($pdo, $programIn);
    $year_level  = qs('year_level', $in);      // Added for presidents
    $school_year = qs('school_year', $in);     // Added for presidents
    $status      = require_allowed_status(qs('status', $in, 'Active'), allowed_status_for_group('faculty'));

    $requiredErrors = [];
    if ($id_number === '') $requiredErrors[] = 'ID Number is required';
    if ($first_name === '') $requiredErrors[] = 'First Name is required';
    if ($last_name === '') $requiredErrors[] = 'Last Name is required';

    if (!empty($requiredErrors)) {
      out(false, 'Missing required fields: ' . implode(', ', $requiredErrors));
    }

    // Auto-fill school_year from active term if not provided
    if ($school_year === '') {
      $term = get_active_term($pdo);
      if ($term) {
        $school_year = (string)$term['school_year'];
      }
    }

    if (check_duplicate_id_number($pdo, $id_number)) {
      out(false, "ID Number '{$id_number}' is already registered to another user.");
    }

    if ($email !== '' && check_duplicate_email($pdo, $email)) {
      out(false, "Email '{$email}' is already registered to another user.");
    }

    $hash = password_hash($id_number, PASSWORD_DEFAULT);

    $st = $pdo->prepare("
      INSERT INTO users (
        id_number, first_name, middle_name, last_name, suffix,
        email, program, year_level, school_year,
        password_hash, role, status, created_at
      ) VALUES (
        :id_number, :first_name, :middle_name, :last_name, :suffix,
        :email, :program, :year_level, :school_year,
        :password_hash, :role, :status, NOW()
      )
    ");

    try {
      $st->execute([
        ':id_number' => $id_number,
        ':first_name' => $first_name,
        ':middle_name' => ($middle_name !== '' ? $middle_name : null),
        ':last_name' => $last_name,
        ':suffix' => ($suffix !== '' ? $suffix : null),
        ':email' => ($email !== '' ? $email : null),
        ':program' => $program,
        ':year_level' => ($year_level !== '' ? $year_level : null),
        ':school_year' => ($school_year !== '' ? $school_year : null),
        ':password_hash' => $hash,
        ':role' => $role,
        ':status' => $status,
      ]);
    } catch (PDOException $e) {
      if (str_contains($e->getMessage(), 'Duplicate entry')) {
        if (str_contains($e->getMessage(), 'id_number')) {
          out(false, "ID Number '{$id_number}' is already registered to another user.");
        } elseif (str_contains($e->getMessage(), 'email')) {
          out(false, "Email '{$email}' is already registered to another user.");
        }
      }
      throw $e;
    }

    out(true, 'Staff created successfully.', [
      'id' => (int)$pdo->lastInsertId(),
      'note' => 'Password set to ID Number by default',
    ]);
  }

  if ($action === 'update_staff') {
    $id          = qi('id', $in, 0);
    $role        = require_staff_role(qs('role', $in, ''));
    $id_number   = qs('id_number', $in);
    $first_name  = qs('first_name', $in);
    $middle_name = qs('middle_name', $in);
    $last_name   = qs('last_name', $in);
    $suffix      = qs('suffix', $in);
    $email       = qs('email', $in);
    $programIn   = qs('program', $in);
    $program     = validate_program_or_null($pdo, $programIn);
    $year_level  = qs('year_level', $in);      // Added for presidents
    $school_year = qs('school_year', $in);     // Added for presidents
    $status      = require_allowed_status(qs('status', $in, 'Active'), allowed_status_for_group('faculty'));

    if ($id <= 0) out(false, 'Missing/invalid id.');

    $requiredErrors = [];
    if ($id_number === '') $requiredErrors[] = 'ID Number is required';
    if ($first_name === '') $requiredErrors[] = 'First Name is required';
    if ($last_name === '') $requiredErrors[] = 'Last Name is required';

    if (!empty($requiredErrors)) {
      out(false, 'Missing required fields: ' . implode(', ', $requiredErrors));
    }

    // Auto-fill school_year from active term if not provided
    if ($school_year === '') {
      $term = get_active_term($pdo);
      if ($term) {
        $school_year = (string)$term['school_year'];
      }
    }

    if (check_duplicate_id_number($pdo, $id_number, $id)) {
      out(false, "ID Number '{$id_number}' is already registered to another user.");
    }

    if ($email !== '' && check_duplicate_email($pdo, $email, $id)) {
      out(false, "Email '{$email}' is already registered to another user.");
    }

    $stChk = $pdo->prepare("SELECT id, role FROM users WHERE id = ? LIMIT 1");
    $stChk->execute([$id]);
    $u = $stChk->fetch(PDO::FETCH_ASSOC);
    if (!$u) out(false, 'User not found.');
    $oldRole = (string)$u['role'];
    if ($oldRole !== 'faculty_admin' && $oldRole !== 'moderator' && $oldRole !== 'org_president') {
      out(false, 'This endpoint only edits staff (faculty_admin/moderator/org_president).');
    }

    $st = $pdo->prepare("
      UPDATE users
      SET
        id_number = :id_number,
        email = :email,
        first_name = :first_name,
        middle_name = :middle_name,
        last_name = :last_name,
        suffix = :suffix,
        program = :program,
        year_level = :year_level,
        school_year = :school_year,
        role = :role,
        status = :status
      WHERE id = :id
      LIMIT 1
    ");

    try {
      $st->execute([
        ':id_number' => $id_number,
        ':email' => ($email !== '' ? $email : null),
        ':first_name' => $first_name,
        ':middle_name' => ($middle_name !== '' ? $middle_name : null),
        ':last_name' => $last_name,
        ':suffix' => ($suffix !== '' ? $suffix : null),
        ':program' => $program,
        ':year_level' => ($year_level !== '' ? $year_level : null),
        ':school_year' => ($school_year !== '' ? $school_year : null),
        ':role' => $role,
        ':status' => $status,
        ':id' => $id,
      ]);
    } catch (PDOException $e) {
      if (str_contains($e->getMessage(), 'Duplicate entry')) {
        if (str_contains($e->getMessage(), 'id_number')) {
          out(false, "ID Number '{$id_number}' is already registered to another user.");
        } elseif (str_contains($e->getMessage(), 'email')) {
          out(false, "Email '{$email}' is already registered to another user.");
        }
      }
      throw $e;
    }

    out(true, 'Staff updated successfully.');
  }

  // Generic update_user action that handles all user types
  if ($action === 'update_user') {
    $id          = qi('id', $in, 0);
    $group       = qs('group', $in, 'students');
    $email       = qs('email', $in);
    $first_name  = qs('first_name', $in);
    $middle_name = qs('middle_name', $in);
    $last_name   = qs('last_name', $in);
    $suffix      = qs('suffix', $in);

    if ($id <= 0) out(false, 'Missing/invalid id.');

    $stChk = $pdo->prepare("SELECT id, role, id_number FROM users WHERE id = ? LIMIT 1");
    $stChk->execute([$id]);
    $u = $stChk->fetch(PDO::FETCH_ASSOC);
    if (!$u) out(false, 'User not found.');

    $role = (string)$u['role'];
    $currentIdNumber = (string)($u['id_number'] ?? '');

    $updateFields = [];
    $params = [];

    $updateFields[] = "email = :email";
    $updateFields[] = "first_name = :first_name";
    $updateFields[] = "middle_name = :middle_name";
    $updateFields[] = "last_name = :last_name";
    $updateFields[] = "suffix = :suffix";

    $params[':email'] = ($email !== '' ? $email : null);
    $params[':first_name'] = ($first_name !== '' ? $first_name : null);
    $params[':middle_name'] = ($middle_name !== '' ? $middle_name : null);
    $params[':last_name'] = ($last_name !== '' ? $last_name : null);
    $params[':suffix'] = ($suffix !== '' ? $suffix : null);

    if ($email !== '' && check_duplicate_email($pdo, $email, $id)) {
      out(false, "Email '{$email}' is already registered to another user.");
    }

    if ($role === 'student' || $role === 'org_president') {
      $id_number   = qs('id_number', $in);
      $program     = qs('program', $in);
      $year_level  = qs('year_level', $in);
      $school_year = qs('school_year', $in);
      $status      = require_allowed_status(qs('status', $in, 'Active'), allowed_status_for_group('students'));

      if ($id_number !== $currentIdNumber && check_duplicate_id_number($pdo, $id_number, $id)) {
        out(false, "ID Number '{$id_number}' is already registered to another user.");
      }

      $studentRequiredErrors = [];
      if ($id_number === '') $studentRequiredErrors[] = 'ID Number is required';
      if ($program === '') $studentRequiredErrors[] = 'Program is required for students';
      if ($year_level === '') $studentRequiredErrors[] = 'Year Level is required for students';

      if (!empty($studentRequiredErrors)) {
        out(false, 'Missing required fields: ' . implode(', ', $studentRequiredErrors));
      }

      // Auto-fill school_year from active term if not provided
      if ($school_year === '') {
        $term = get_active_term($pdo);
        if ($term) {
          $school_year = (string)$term['school_year'];
        }
      }

      $updateFields[] = "id_number = :id_number";
      $updateFields[] = "program = :program";
      $updateFields[] = "year_level = :year_level";
      $updateFields[] = "school_year = :school_year";
      $updateFields[] = "status = :status";

      $params[':id_number'] = $id_number;
      $params[':program'] = $program;
      $params[':year_level'] = $year_level;
      $params[':school_year'] = $school_year;
      $params[':status'] = $status;
    }

    if ($role === 'faculty_admin' || $role === 'moderator') {
      $id_number = qs('id_number', $in);
      $newRole = qs('role', $in, $role);
      if ($newRole !== $role) {
        $newRole = require_staff_role($newRole);
      }
      $status = require_allowed_status(qs('status', $in, 'Active'), allowed_status_for_group('faculty'));

      $programIn = qs('program', $in, '');
      $program = validate_program_or_null($pdo, $programIn);
      
      // Added for presidents if they go through update_user
      $year_level = qs('year_level', $in);
      $school_year = qs('school_year', $in);

      if ($id_number !== $currentIdNumber && check_duplicate_id_number($pdo, $id_number, $id)) {
        out(false, "ID Number '{$id_number}' is already registered to another user.");
      }

      $staffRequiredErrors = [];
      if ($id_number === '') $staffRequiredErrors[] = 'ID Number is required';
      if (!empty($staffRequiredErrors)) {
        out(false, 'Missing required fields: ' . implode(', ', $staffRequiredErrors));
      }

      // Auto-fill school_year from active term if not provided
      if ($school_year === '') {
        $term = get_active_term($pdo);
        if ($term) {
          $school_year = (string)$term['school_year'];
        }
      }

      $updateFields[] = "id_number = :id_number";
      $updateFields[] = "program = :program";
      $updateFields[] = "year_level = :year_level";      // Added
      $updateFields[] = "school_year = :school_year";    // Added
      $updateFields[] = "role = :role";
      $updateFields[] = "status = :status";

      $params[':id_number'] = $id_number;
      $params[':program'] = $program;
      $params[':year_level'] = ($year_level !== '' ? $year_level : null);
      $params[':school_year'] = ($school_year !== '' ? $school_year : null);
      $params[':role'] = $newRole;
      $params[':status'] = $status;
    }

    $params[':id'] = $id;

    $sql = "UPDATE users SET " . implode(', ', $updateFields) . " WHERE id = :id LIMIT 1";

    try {
      $st = $pdo->prepare($sql);
      $st->execute($params);
    } catch (PDOException $e) {
      if (str_contains($e->getMessage(), 'Duplicate entry')) {
        if (str_contains($e->getMessage(), 'id_number')) {
          out(false, "ID Number is already registered to another user.");
        } elseif (str_contains($e->getMessage(), 'email')) {
          out(false, "Email '{$email}' is already registered to another user.");
        }
      }
      throw $e;
    }

    out(true, 'User updated successfully.');
  }

  if ($action === 'set_status') {
    $id = qi('id', $in, 0);
    $group = qs('group', $in, 'students');
    $status = require_allowed_status(qs('status', $in, ''), allowed_status_for_group($group));

    if ($id <= 0) out(false, 'Missing/invalid id.');

    // When reactivating a student or org_president, update school_year to
    // the current active term's school_year if it differs (or is outdated).
    if ($status === 'Active' && in_array($group, ['students', 'presidents'], true)) {
      $stUser = $pdo->prepare("SELECT role, school_year FROM users WHERE id = ? LIMIT 1");
      $stUser->execute([$id]);
      $userRow = $stUser->fetch(PDO::FETCH_ASSOC);

      if ($userRow && in_array((string)$userRow['role'], ['student', 'org_president'], true)) {
        $activeTerm = get_active_term($pdo);
        $activeSchoolYear = $activeTerm ? (string)$activeTerm['school_year'] : '';
        $userSchoolYear   = (string)($userRow['school_year'] ?? '');

        if ($activeSchoolYear !== '' && $activeSchoolYear !== $userSchoolYear) {
          $stUpd = $pdo->prepare("UPDATE users SET status = ?, school_year = ? WHERE id = ? LIMIT 1");
          $stUpd->execute([$status, $activeSchoolYear, $id]);
          out(true, 'Status updated and school year set to current term.', [
            'school_year_updated' => true,
            'school_year' => $activeSchoolYear,
          ]);
        }
      }
    }

    $st = $pdo->prepare("UPDATE users SET status = ? WHERE id = ? LIMIT 1");
    $st->execute([$status, $id]);

    out(true, 'Status updated successfully.');
  }

  if ($action === 'bulk_set_status') {
    $group  = qs('group', $in, 'students');
    $status = require_allowed_status(qs('status', $in, ''), allowed_status_for_group($group));

    $ids = $in['ids'] ?? null;
    if (!is_array($ids) || count($ids) < 1) out(false, 'Missing ids array.');

    $clean = [];
    foreach ($ids as $v) {
      if (is_numeric($v)) {
        $iv = (int)$v;
        if ($iv > 0) $clean[] = $iv;
      }
    }
    $clean = array_values(array_unique($clean));
    if (count($clean) < 1) out(false, 'No valid ids provided.');

    $placeholders = implode(',', array_fill(0, count($clean), '?'));

    $roleWhere = "";
    if ($group === 'students') $roleWhere = " AND role IN ('student', 'org_president')";
    if ($group === 'faculty') $roleWhere = " AND role = 'faculty_admin'";
    if ($group === 'moderators') $roleWhere = " AND role = 'moderator'";

    // When bulk-reactivating students or org_presidents, also update school_year
    // to the active term's school_year for those whose school_year differs.
    if ($status === 'Active' && in_array($group, ['students', 'presidents'], true)) {
      $activeTerm = get_active_term($pdo);
      $activeSchoolYear = $activeTerm ? (string)$activeTerm['school_year'] : '';

      if ($activeSchoolYear !== '') {
        $sqlBulkSY = "UPDATE users SET status = ?, school_year = ?
                      WHERE id IN ($placeholders)
                        AND role IN ('student', 'org_president')
                        AND (school_year IS NULL OR school_year != ?)";
        $paramsSY = array_merge([$status, $activeSchoolYear], $clean, [$activeSchoolYear]);
        $stBulkSY = $pdo->prepare($sqlBulkSY);
        $stBulkSY->execute($paramsSY);

        // Also update any remaining rows (same role filter) that already have current school_year
        $sql = "UPDATE users SET status = ? WHERE id IN ($placeholders) $roleWhere";
        $params = array_merge([$status], $clean);
        $st = $pdo->prepare($sql);
        $st->execute($params);

        out(true, 'Bulk status updated successfully.', [
          'updated' => $st->rowCount() + $stBulkSY->rowCount(),
          'school_year_updated' => true,
          'school_year' => $activeSchoolYear,
        ]);
      }
    }

    $sql = "UPDATE users SET status = ? WHERE id IN ($placeholders) $roleWhere";
    $params = array_merge([$status], $clean);

    $st = $pdo->prepare($sql);
    $st->execute($params);

    out(true, 'Bulk status updated successfully.', [
      'updated' => $st->rowCount(),
    ]);
  }

  /** =========================
   *  Password Reset
   *  ========================= */
  if ($action === 'reset_password') {
    $id = qi('id', $in, 0);
    if ($id <= 0) out(false, 'Invalid user id.');

    $st = $pdo->prepare("SELECT id_number FROM users WHERE id = ? LIMIT 1");
    $st->execute([$id]);
    $u = $st->fetch(PDO::FETCH_ASSOC);
    if (!$u) out(false, 'User not found.');

    $idNumber = (string)($u['id_number'] ?? '');
    if ($idNumber === '') out(false, 'User has no id_number.');

    $hash = password_hash($idNumber, PASSWORD_DEFAULT);

    $st2 = $pdo->prepare("UPDATE users SET password_hash = ? WHERE id = ? LIMIT 1");
    $st2->execute([$hash, $id]);

    out(true, 'Password reset to ID Number successfully.');
  }

  if ($action === 'bulk_reset_password') {
    $ids = $in['ids'] ?? null;
    if (!is_array($ids) || count($ids) < 1) out(false, 'Missing ids array.');

    $clean = [];
    foreach ($ids as $v) {
      if (is_numeric($v)) {
        $iv = (int)$v;
        if ($iv > 0) $clean[] = $iv;
      }
    }
    $clean = array_values(array_unique($clean));
    if (count($clean) < 1) out(false, 'No valid ids provided.');

    $placeholders = implode(',', array_fill(0, count($clean), '?'));

    $st = $pdo->prepare("SELECT id, id_number FROM users WHERE id IN ($placeholders)");
    $st->execute($clean);
    $rows = $st->fetchAll(PDO::FETCH_ASSOC) ?: [];
    if (!$rows) out(false, 'No users found for given ids.');

    $upd = $pdo->prepare("UPDATE users SET password_hash = ? WHERE id = ? LIMIT 1");
    $count = 0;

    foreach ($rows as $r) {
      $uid = (int)$r['id'];
      $idNumber = (string)($r['id_number'] ?? '');
      if ($uid <= 0 || $idNumber === '') continue;

      $hash = password_hash($idNumber, PASSWORD_DEFAULT);
      $upd->execute([$hash, $uid]);
      $count += $upd->rowCount();
    }

    out(true, 'Bulk password reset completed successfully.', ['updated' => $count]);
  }

  if ($action === 'set_password') {
    $id = qi('id', $in, 0);
    $password = qs('password', $in, '');

    if ($id <= 0) out(false, 'Invalid user id.');
    if (strlen($password) < 6) out(false, 'Password must be at least 6 characters.');

    $hash = password_hash($password, PASSWORD_DEFAULT);

    $st = $pdo->prepare("UPDATE users SET password_hash = ? WHERE id = ? LIMIT 1");
    $st->execute([$hash, $id]);

    out(true, 'Password updated successfully.');
  }

  function findUserByIdOrIdNumber(PDO $pdo, $raw, bool $mustBeStudent = true): ?array {
  $raw = trim((string)$raw);
  if ($raw === '') return null;

  // If numeric, treat as users.id first
  if (ctype_digit($raw)) {
    $id = (int)$raw;
    if ($id > 0) {
      $sql = "SELECT id, id_number, first_name, middle_name, last_name, suffix, role, status
              FROM users
              WHERE id = :id" . ($mustBeStudent ? " AND role IN ('student', 'org_president')" : "") . "
              LIMIT 1";
      $st = $pdo->prepare($sql);
      $st->execute([':id' => $id]);
      $u = $st->fetch(PDO::FETCH_ASSOC);
      if ($u) return $u;
    }
  }

  // Fallback: treat as users.id_number
  $sql = "SELECT id, id_number, first_name, middle_name, last_name, suffix, role, status
          FROM users
          WHERE id_number = :idno" . ($mustBeStudent ? " AND role IN ('student', 'org_president')" : "") . "
          LIMIT 1";
  $st = $pdo->prepare($sql);
  $st->execute([':idno' => $raw]);
  $u = $st->fetch(PDO::FETCH_ASSOC);

  return $u ?: null;
}

  if ($action === 'get_user') {

    $group = (string)($in['group'] ?? '');
    if ($group !== 'students') {
      fail('Unsupported group.', 400);
    }

    $id = (int)($in['id'] ?? 0);
    $idNumber = trim((string)($in['id_number'] ?? ''));

    if ($id <= 0 && $idNumber === '') {
      fail('Missing id or id_number.', 400);
    }

    if ($id > 0) {
      $st = $pdo->prepare("SELECT * FROM users WHERE id = :id AND role IN ('student', 'org_president') LIMIT 1");
      $st->execute([':id' => $id]);
    } else {
      $st = $pdo->prepare("SELECT * FROM users WHERE id_number = :idn AND role IN ('student', 'org_president') LIMIT 1");
      $st->execute([':idn' => $idNumber]);
    }

    $row = $st->fetch(PDO::FETCH_ASSOC);
    if (!$row) {
      fail('Student not found. ID Number: ' . $idNumber, 404);
    }

    ok(['row' => $row]);
  }

  out(false, 'Unknown action.');
} catch (PDOException $e) {
  $errorCode = $e->errorInfo[1] ?? 0;
  $errorMsg = $e->getMessage();

  if ($errorCode === 1062) {
    if (str_contains($errorMsg, 'id_number')) {
      out(false, 'ID Number is already registered to another user.');
    } elseif (str_contains($errorMsg, 'email')) {
      out(false, 'Email address is already registered to another user.');
    } else {
      out(false, 'Duplicate entry detected. The data you are trying to save already exists.');
    }
  } else {
    error_log("Database error: " . $e->getMessage());
    out(false, 'A database error occurred. Please try again or contact support.');
  }
} catch (Throwable $e) {
  error_log("Server error: " . $e->getMessage());
  out(false, 'A server error occurred. Please try again or contact support.');
}
//invalid user