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

/* =========================
   Input
   ========================= */
$raw = file_get_contents('php://input') ?: '';
$in = json_decode($raw, true);
if (!is_array($in)) $in = [];

$action = (string)($in['action'] ?? 'get');

/* =========================
   Auth
   =========================
   Accept common session keys since your project varies per page.
*/
$userId =
  (int)($_SESSION['user_id'] ?? 0) ? (int)$_SESSION['user_id'] :
  ((int)($_SESSION['id'] ?? 0) ? (int)$_SESSION['id'] : 0);

if ($userId <= 0) {
  fail('Unauthorized. Please log in again.', 401);
}

/* =========================
   Helpers
   ========================= */
function roleLabel(string $role): string {
  $map = [
    'overseer' => 'Overseer',
    'super_admin' => 'Super Admin',
    'special_admin' => 'Special Admin',
    'faculty_admin' => 'Faculty Admin',
    'moderator' => 'Moderator',
    'org_president' => 'Org President',
    'treasurer' => 'Treasurer',
    'org_officer' => 'Organization Officer',
    'student' => 'Student',
  ];
  return $map[$role] ?? $role;
}

function userTypeLabel(string $role): string {
  // simple grouping
  if ($role === 'student') return 'Student';
  if ($role === 'org_president' || $role === 'treasurer' || $role === 'org_officer') return 'Organization Officer';
  return 'Administrator';
}

function buildDepartment(?string $program, ?string $yearLevel): string {
  $p = trim((string)($program ?? ''));
  $y = trim((string)($yearLevel ?? ''));
  if ($p !== '' && $y !== '') return $p . ' • ' . $y;
  if ($p !== '') return $p;
  if ($y !== '') return $y;
  return '';
}

function loadProfile(PDO $pdo, int $userId): array {
  $st = $pdo->prepare("
    SELECT
      id, id_number, first_name, middle_name, last_name, suffix,
      email, program, year_level, school_year,
      role, status, created_at, last_login_at
    FROM users
    WHERE id = ?
    LIMIT 1
  ");
  $st->execute([$userId]);
  $u = $st->fetch(PDO::FETCH_ASSOC);
  if (!$u) fail('User not found.', 404);

  $role = (string)($u['role'] ?? '');
  $profile = [
    'id' => (int)$u['id'],
    'id_number' => (string)($u['id_number'] ?? ''),
    'first_name' => (string)($u['first_name'] ?? ''),
    'middle_name' => (string)($u['middle_name'] ?? ''),
    'last_name' => (string)($u['last_name'] ?? ''),
    'suffix' => (string)($u['suffix'] ?? ''),
    'email' => (string)($u['email'] ?? ''),
    'school_year' => (string)($u['school_year'] ?? ''),
    'department' => buildDepartment($u['program'] ?? null, $u['year_level'] ?? null),

    'role' => $role,
    'role_label' => roleLabel($role),
    'user_type_label' => userTypeLabel($role),

    'status' => (string)($u['status'] ?? ''),
    'created_at' => (string)($u['created_at'] ?? ''),
    'last_login_at' => $u['last_login_at'] !== null ? (string)$u['last_login_at'] : null,
  ];

  return $profile;
}

/* =========================
   Actions
   ========================= */
try {
  if ($action === 'get') {
    $profile = loadProfile($pdo, $userId);
    ok(['profile' => $profile]);
  }

  if ($action === 'update') {
    $email = trim((string)($in['email'] ?? ''));

    if ($email === '') fail('Email is required.', 422);
    if (!filter_var($email, FILTER_VALIDATE_EMAIL)) fail('Please enter a valid email address.', 422);

    // Check uniqueness (users.email is UNIQUE)
    $st = $pdo->prepare("SELECT id FROM users WHERE email = ? AND id <> ? LIMIT 1");
    $st->execute([$email, $userId]);
    if ($st->fetch()) {
      fail('That email is already in use.', 409);
    }

    $st = $pdo->prepare("UPDATE users SET email = ? WHERE id = ? LIMIT 1");
    $st->execute([$email, $userId]);

    $profile = loadProfile($pdo, $userId);
    ok([
      'message' => 'Profile updated successfully.',
      'profile' => $profile
    ]);
  }

  fail('Invalid action.', 400);
} catch (Throwable $e) {
  fail('Server error: ' . $e->getMessage(), 500);
}