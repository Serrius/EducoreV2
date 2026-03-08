<?php
// php/register.php (JSON API ONLY)
// GET  ?action=get_programs
// GET  ?action=get_active_term
// POST => registration

declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');

// prevent PHP warnings/notices from breaking JSON
ini_set('display_errors', '0');
ini_set('html_errors', '0');
error_reporting(E_ALL);

function out(array $payload, int $code = 200): void {
  http_response_code($code);
  echo json_encode($payload, JSON_UNESCAPED_SLASHES);
  exit;
}

// ✅ IMPORTANT: use __DIR__ so path is correct no matter where called from
$dbFile = __DIR__ . '/db.php';
if (!is_file($dbFile)) {
  out(['success' => false, 'message' => "Missing database.php in php/ folder. Expected: {$dbFile}"], 500);
}
require $dbFile; // must create $pdo

if (!isset($pdo) || !($pdo instanceof PDO)) {
  out(['success' => false, 'message' => 'PDO not initialized. Check php/database.php (expected $pdo).'], 500);
}

try { $pdo->exec("SET NAMES utf8mb4"); } catch (Throwable $e) {}

function getActiveTerm(PDO $pdo): ?array {
  $stmt = $pdo->query("
    SELECT id, school_year, semester, status, created_at
    FROM academic_terms
    WHERE status = 'Active'
    ORDER BY created_at DESC, id DESC
    LIMIT 1
  ");
  $row = $stmt->fetch(PDO::FETCH_ASSOC);
  return $row ?: null;
}

try {
  $action = isset($_GET['action']) ? (string)$_GET['action'] : '';

  // =========================
  // GET: programs
  // =========================
  if ($_SERVER['REQUEST_METHOD'] === 'GET' && $action === 'get_programs') {
    $stmt = $pdo->query("
      SELECT id, program_name, abbreviation, status
      FROM programs
      WHERE status = 'Active'
      ORDER BY program_name ASC
    ");
    $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);

    out(['success' => true, 'programs' => $rows]);
  }

  // =========================
  // GET: active term
  // =========================
  if ($_SERVER['REQUEST_METHOD'] === 'GET' && $action === 'get_active_term') {
    $term = getActiveTerm($pdo);
    if (!$term) out(['success' => false, 'message' => 'No Active academic term found.'], 404);

    out([
      'success' => true,
      'term' => [
        'id' => (int)$term['id'],
        'school_year' => (string)$term['school_year'],
        'semester' => (string)$term['semester'],
        'status' => (string)$term['status'],
      ],
    ]);
  }

  // =========================
  // POST: registration
  // =========================
  if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    out(['success' => false, 'message' => 'Unsupported method.'], 405);
  }

  // Accept JSON or form-data
  $raw  = file_get_contents('php://input');
  $json = json_decode($raw, true);
  $in   = is_array($json) ? $json : $_POST;

  $id_number   = isset($in['idNumber']) ? trim((string)$in['idNumber']) : '';
  $first_name  = isset($in['firstName']) ? trim((string)$in['firstName']) : '';
  $middle_name = isset($in['middleName']) ? trim((string)$in['middleName']) : '';
  $last_name   = isset($in['lastName']) ? trim((string)$in['lastName']) : '';
  $suffix      = isset($in['suffix']) ? trim((string)$in['suffix']) : '';
  $email       = isset($in['email']) ? strtolower(trim((string)$in['email'])) : '';

  // UI field "course" is actually program abbreviation
  $programAbbrevInput = isset($in['course']) ? trim((string)$in['course']) : '';
  $yearLevel   = isset($in['yearLevel']) ? trim((string)$in['yearLevel']) : '';
  $password    = isset($in['password']) ? (string)$in['password'] : '';
  $confirm     = isset($in['confirmPassword']) ? (string)$in['confirmPassword'] : '';

  if ($id_number === '' || $first_name === '' || $last_name === '' || $email === '' ||
      $programAbbrevInput === '' || $yearLevel === '' || $password === '' || $confirm === '') {
    out(['success' => false, 'message' => 'Please complete all required fields.'], 400);
  }

  if (!preg_match('/^\d+$/', $id_number)) out(['success' => false, 'message' => 'ID Number must contain digits only.'], 400);
  if (!filter_var($email, FILTER_VALIDATE_EMAIL)) out(['success' => false, 'message' => 'Invalid email address.'], 400);
  if ($password !== $confirm) out(['success' => false, 'message' => 'Passwords do not match.'], 400);

  $yearMap = ['1'=>'1st Year','2'=>'2nd Year','3'=>'3rd Year','4'=>'4th Year','5'=>'5th Year'];
  $yearText = $yearMap[$yearLevel] ?? null;
  if ($yearText === null) out(['success' => false, 'message' => 'Invalid year level.'], 400);

  // ✅ school_year comes from ACTIVE academic term
  $term = getActiveTerm($pdo);
  if (!$term) out(['success' => false, 'message' => 'Registration unavailable: no Active academic term.'], 400);
  $schoolYear = (string)$term['school_year'];

  // ✅ program must exist (Active)
  $stmt = $pdo->prepare("
    SELECT abbreviation
    FROM programs
    WHERE abbreviation = ?
      AND status = 'Active'
    LIMIT 1
  ");
  $stmt->execute([$programAbbrevInput]);
  $progRow = $stmt->fetch(PDO::FETCH_ASSOC);
  if (!$progRow) out(['success' => false, 'message' => 'Invalid program.'], 400);
  $programAbbrev = (string)$progRow['abbreviation'];

  $passwordHash = password_hash($password, PASSWORD_DEFAULT);
  if ($passwordHash === false) out(['success' => false, 'message' => 'Failed to process password.'], 500);

  $role = 'student';
  $status = 'Pending';

  // Uniqueness
  $chk = $pdo->prepare("SELECT id FROM users WHERE id_number = ? LIMIT 1");
  $chk->execute([$id_number]);
  if ($chk->fetch()) out(['success' => false, 'message' => 'ID Number already exists.'], 409);

  $chk2 = $pdo->prepare("SELECT id FROM users WHERE email = ? LIMIT 1");
  $chk2->execute([$email]);
  if ($chk2->fetch()) out(['success' => false, 'message' => 'Email is already registered.'], 409);

  // name for notif
  $displayName = trim(preg_replace('/\s+/', ' ', implode(' ', array_filter([$first_name,$middle_name,$last_name,$suffix]))));
  if ($displayName === '') $displayName = $id_number;

  $pdo->beginTransaction();

  $insUser = $pdo->prepare("
    INSERT INTO users
      (id_number, first_name, middle_name, last_name, suffix,
       email, program, year_level, school_year,
       password_hash, role, status)
    VALUES
      (:id_number, :first_name, :middle_name, :last_name, :suffix,
       :email, :program, :year_level, :school_year,
       :password_hash, :role, :status)
  ");

  $insUser->execute([
    ':id_number' => $id_number,
    ':first_name' => $first_name,
    ':middle_name' => ($middle_name !== '' ? $middle_name : null),
    ':last_name' => $last_name,
    ':suffix' => ($suffix !== '' ? $suffix : null),
    ':email' => $email,
    ':program' => $programAbbrev,
    ':year_level' => $yearText,
    ':school_year' => $schoolYear,
    ':password_hash' => $passwordHash,
    ':role' => $role,
    ':status' => $status,
  ]);

  $newUserId = (int)$pdo->lastInsertId();

  // notify Active super_admin
  $saStmt = $pdo->query("SELECT id FROM users WHERE role='super_admin' AND status='Active'");
  $superAdminIds = $saStmt->fetchAll(PDO::FETCH_COLUMN);

  $notifCount = 0;
  if (!empty($superAdminIds)) {
    $insN = $pdo->prepare("
      INSERT INTO notifications
        (recipient_id, actor_id, title, message, notif_type, status, created_at)
      VALUES
        (:recipient_id, :actor_id, :title, :message, :notif_type, 'unread', NOW())
    ");

    $title = 'New registration pending approval';
    $message = "User {$id_number} ({$displayName}) has registered and is pending approval.";
    $type = 'registration';

    foreach ($superAdminIds as $saId) {
      $insN->execute([
        ':recipient_id' => (int)$saId,
        ':actor_id' => $newUserId,
        ':title' => $title,
        ':message' => $message,
        ':notif_type' => $type,
      ]);
      $notifCount += $insN->rowCount();
    }
  }

  $pdo->commit();

  out([
    'success' => true,
    'message' => 'Registration successful. Your account is pending approval.',
    'notifications_sent' => $notifCount,
  ]);

} catch (PDOException $e) {
  if ($pdo->inTransaction()) $pdo->rollBack();
  out(['success' => false, 'message' => 'Database error: '.$e->getMessage()], 500);
} catch (Throwable $e) {
  if ($pdo->inTransaction()) $pdo->rollBack();
  out(['success' => false, 'message' => 'Server error: '.$e->getMessage()], 500);
}