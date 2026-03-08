<?php
declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');

session_start();
require_once __DIR__ . '/db.php'; // expects $pdo

function out(array $payload, int $code = 200): void {
  http_response_code($code);
  echo json_encode($payload, JSON_UNESCAPED_SLASHES);
  exit;
}

$uid = (int)($_SESSION['user_id'] ?? 0);
if ($uid <= 0) out(['success' => false, 'message' => 'Not logged in.'], 401);

try {
  $st = $pdo->prepare("
    SELECT id, id_number, first_name, middle_name, last_name, suffix,
           email, program, year_level, school_year, role AS raw_role, status
    FROM users
    WHERE id = :id
    LIMIT 1
  ");
  $st->execute([':id' => $uid]);
  $u = $st->fetch(PDO::FETCH_ASSOC);

  if (!$u) out(['success' => false, 'message' => 'User not found.'], 404);

  $fullName = trim(
    (string)$u['first_name'] . ' ' .
    (!empty($u['middle_name']) ? (string)$u['middle_name'] . ' ' : '') .
    (string)$u['last_name'] .
    (!empty($u['suffix']) ? ' ' . (string)$u['suffix'] : '')
  );

  out([
    'success' => true,
    'id' => (int)$u['id'],
    'id_number' => (string)$u['id_number'],
    'full_name' => $fullName,
    'first_name' => (string)$u['first_name'],
    'email' => $u['email'],
    'program' => $u['program'],
    'year_level' => $u['year_level'],
    'school_year' => $u['school_year'],

    // IMPORTANT: display role comes from session (effective)
    'role' => (string)($_SESSION['role'] ?? (string)$u['raw_role']),
    'raw_role' => (string)$u['raw_role'],

    'is_officer' => (int)($_SESSION['is_officer'] ?? 0) === 1,
    'officer_term_id' => $_SESSION['officer_term_id'] ?? null,
    'officer_position' => $_SESSION['officer_position'] ?? null,

    // only set for non-officers in your login.php
    'signature_file' => $_SESSION['signature_file'] ?? null,
  ]);

} catch (Throwable $e) {
  out(['success' => false, 'message' => 'Server error in me.php.'], 500);
}
