<?php
declare(strict_types=1);

session_start();
header('Content-Type: application/json; charset=utf-8');

/**
 * GUARD:
 * Prevent "Cannot redeclare ..." if this file is included twice by accident.
 */
if (defined('SYSTEM_AUTHORITY_LOADED')) {
  // If it was included again, just stop. (No output to avoid double JSON)
  return;
}
define('SYSTEM_AUTHORITY_LOADED', true);

require_once __DIR__ . '/db.php'; // provides $pdo (PDO)

/** -------------------------
 * JSON-safe error handling
 * ------------------------ */
ini_set('display_errors', '0');
ini_set('log_errors', '1');
error_reporting(E_ALL);

/**
 * Always output JSON and exit.
 */
function out(bool $ok, string $msg = '', array $extra = []): void {
  echo json_encode(array_merge([
    'success' => $ok,
    'message' => $msg,
  ], $extra), JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
  exit;
}

/**
 * Convert PHP warnings/notices into exceptions (prevents HTML output breaking fetch).
 */
set_error_handler(function(int $severity, string $message, string $file, int $line): bool {
  throw new ErrorException($message, 0, $severity, $file, $line);
});

/**
 * Catch fatal errors and return JSON.
 */
register_shutdown_function(function(): void {
  $err = error_get_last();
  if ($err && in_array($err['type'], [E_ERROR, E_PARSE, E_CORE_ERROR, E_COMPILE_ERROR], true)) {
    http_response_code(500);
    echo json_encode([
      'success' => false,
      'message' => 'Fatal server error in system-authority.php.',
      // comment this line if you don't want detail:
      'debug' => $err['message'] . ' @ ' . $err['file'] . ':' . $err['line'],
    ], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
  }
});

/** -------------------------
 * Auth + input helpers
 * ------------------------ */
function require_overseer(): void {
  $role = (string)($_SESSION['role'] ?? '');
  if ($role !== 'overseer') {
    http_response_code(403);
    out(false, 'Forbidden: overseer only.');
  }
}

/**
 * Reads JSON body OR falls back to POST (form-data).
 */
function read_input(): array {
  $raw = file_get_contents('php://input');
  if ($raw !== false && trim($raw) !== '') {
    $json = json_decode($raw, true);
    if (is_array($json)) return $json;
  }
  return $_POST ?? [];
}

function normalize_role(string $role): string {
  $role = trim($role);
  if (!in_array($role, ['super_admin', 'special_admin'], true)) {
    out(false, 'Invalid role. Allowed: super_admin, special_admin');
  }
  return $role;
}

function full_name(array $u): string {
  $first  = trim((string)($u['first_name'] ?? ''));
  $middle = trim((string)($u['middle_name'] ?? ''));
  $last   = trim((string)($u['last_name'] ?? ''));
  $suffix = trim((string)($u['suffix'] ?? ''));

  $name = $first;
  if ($middle !== '') { $name .= ' ' . $middle; }
  if ($last !== '')   { $name .= ' ' . $last; }
  if ($suffix !== '') { $name .= ' ' . $suffix; }

  return trim($name);
}

/** -------------------------
 * DB helpers
 * ------------------------ */

/**
 * IMPORTANT:
 * Do NOT name this "get_current_user" because PHP already has a built-in function.
 */
function get_current_holder(PDO $pdo, string $role): ?array {
  $stmt = $pdo->prepare("
    SELECT id, id_number, first_name, middle_name, last_name, suffix, email,
           role, status, created_at, last_login_at
    FROM users
    WHERE role = :role AND status = 'Active'
    ORDER BY id DESC
    LIMIT 1
  ");
  $stmt->execute(['role' => $role]);
  $u = $stmt->fetch(PDO::FETCH_ASSOC);
  return $u ?: null;
}

function get_user_by_id_number(PDO $pdo, string $idNumber): ?array {
  $stmt = $pdo->prepare("
    SELECT id, id_number, first_name, middle_name, last_name, suffix, email,
           role, status, created_at, last_login_at
    FROM users
    WHERE id_number = :idnum
    LIMIT 1
  ");
  $stmt->execute(['idnum' => $idNumber]);
  $u = $stmt->fetch(PDO::FETCH_ASSOC);
  return $u ?: null;
}

/**
 * users table has UNIQUE(id_number) and UNIQUE(email)
 * email can be NULL
 */
function assert_unique_identifiers(PDO $pdo, int $userId, string $idNumber, ?string $email): void {
  $stmt = $pdo->prepare("SELECT id FROM users WHERE id_number = :idnum AND id <> :id LIMIT 1");
  $stmt->execute(['idnum' => $idNumber, 'id' => $userId]);
  if ($stmt->fetch(PDO::FETCH_ASSOC)) out(false, 'ID number is already in use.');

  if ($email !== null && $email !== '') {
    $stmt2 = $pdo->prepare("SELECT id FROM users WHERE email = :email AND id <> :id LIMIT 1");
    $stmt2->execute(['email' => $email, 'id' => $userId]);
    if ($stmt2->fetch(PDO::FETCH_ASSOC)) out(false, 'Email is already in use.');
  }
}

/**
 * Default password for NEW user = id_number
 * Returns [$user, $tempPassword]
 */
function create_user(PDO $pdo, array $data, string $role): array {
  $idNumber = trim((string)($data['id_number'] ?? ''));
  if ($idNumber === '') out(false, 'Missing id_number.');

  $tempPassword = $idNumber; // requested behavior
  $hash = password_hash($tempPassword, PASSWORD_DEFAULT);

  $stmt = $pdo->prepare("
    INSERT INTO users (
      id_number, first_name, middle_name, last_name, suffix, email,
      program, year_level, school_year,
      password_hash, role, status, created_at
    )
    VALUES (
      :id_number, :first_name, :middle_name, :last_name, :suffix, :email,
      NULL, NULL, NULL,
      :password_hash, :role, 'Active', NOW()
    )
  ");

  $stmt->execute([
    'id_number' => $idNumber,
    'first_name' => (string)$data['first_name'],
    'middle_name' => $data['middle_name'] ?? null,
    'last_name' => (string)$data['last_name'],
    'suffix' => $data['suffix'] ?? null,
    'email' => $data['email'] ?? null,
    'password_hash' => $hash,
    'role' => $role,
  ]);

  $id = (int)$pdo->lastInsertId();

  $created = $pdo->prepare("
    SELECT id, id_number, first_name, middle_name, last_name, suffix, email,
           role, status, created_at, last_login_at
    FROM users
    WHERE id = :id
    LIMIT 1
  ");
  $created->execute(['id' => $id]);
  $user = $created->fetch(PDO::FETCH_ASSOC);

  return [$user, $tempPassword];
}

/**
 * Insert an admin_role_history row.
 * - If $revokedAtNow === true => revoked_at = NOW()
 * - Else revoked_at = NULL (open row)
 *
 * NOTE: You asked to record the REPLACED user; for that we use revokedAtNow=true.
 */
function insert_role_history(PDO $pdo, array $user, string $role, ?string $reason, bool $revokedAtNow = false): void {
  $stmt = $pdo->prepare("
    INSERT INTO admin_role_history
      (user_id, role, id_number, first_name, middle_name, last_name, suffix, email, assigned_at, revoked_at, reason)
    VALUES
      (:user_id, :role, :id_number, :first_name, :middle_name, :last_name, :suffix, :email, NOW(),
       " . ($revokedAtNow ? "NOW()" : "NULL") . ",
       :reason)
  ");
  $stmt->execute([
    'user_id' => (int)$user['id'],
    'role' => $role,
    'id_number' => (string)$user['id_number'],
    'first_name' => (string)$user['first_name'],
    'middle_name' => $user['middle_name'] ?? null,
    'last_name' => (string)$user['last_name'],
    'suffix' => $user['suffix'] ?? null,
    'email' => $user['email'] ?? null,
    'reason' => $reason,
  ]);
}

function revoke_open_history(PDO $pdo, string $role): void {
  $pdo->prepare("
    UPDATE admin_role_history
    SET revoked_at = NOW()
    WHERE role = :role AND revoked_at IS NULL
  ")->execute(['role' => $role]);
}

function deactivate_old_holders(PDO $pdo, string $role, int $keepUserId): void {
  $pdo->prepare("
    UPDATE users
    SET status = 'Inactive'
    WHERE role = :role AND status = 'Active' AND id <> :keep
  ")->execute(['role' => $role, 'keep' => $keepUserId]);
}

function activate_as_role(PDO $pdo, int $userId, string $role): void {
  $pdo->prepare("
    UPDATE users
    SET role = :role, status = 'Active'
    WHERE id = :id
  ")->execute(['role' => $role, 'id' => $userId]);
}

function get_audit_history(PDO $pdo, string $role, int $limit = 200): array {
  $limit = max(1, min($limit, 500));
  $sql = "
    SELECT id, user_id, role, id_number, first_name, middle_name, last_name, suffix, email,
           assigned_at, revoked_at, reason
    FROM admin_role_history
    WHERE role = :role
    ORDER BY assigned_at DESC
    LIMIT {$limit}
  ";
  $stmt = $pdo->prepare($sql);
  $stmt->execute(['role' => $role]);
  return $stmt->fetchAll(PDO::FETCH_ASSOC);
}

function get_current_history_row(PDO $pdo, string $role): ?array {
  $stmt = $pdo->prepare("
    SELECT id, user_id, assigned_at
    FROM admin_role_history
    WHERE role = :role AND revoked_at IS NULL
    ORDER BY assigned_at DESC
    LIMIT 1
  ");
  $stmt->execute(['role' => $role]);
  $row = $stmt->fetch(PDO::FETCH_ASSOC);
  return $row ?: null;
}

/**
 * ✅ UPDATED: simplified signature table
 * e_signatures columns now:
 *  - id, user_id, signature_file, status, updated_at
 *
 * We return the user's single row if active.
 */
function get_latest_signature(PDO $pdo, int $userId): ?array {
  $stmt = $pdo->prepare("
    SELECT id, user_id, signature_file, status, updated_at
    FROM e_signatures
    WHERE user_id = :uid AND status = 'Active'
    LIMIT 1
  ");
  $stmt->execute(['uid' => $userId]);
  $row = $stmt->fetch(PDO::FETCH_ASSOC);
  return $row ?: null;
}

/** -------------------------
 * Controller
 * ------------------------ */
require_overseer();

$data = read_input();
$action = (string)($data['action'] ?? '');
if ($action === '') out(false, 'Missing action.');

try {
  if ($action === 'get_current') {
    $super = get_current_holder($pdo, 'super_admin');
    $sdc   = get_current_holder($pdo, 'special_admin');

    $superSig = $super ? get_latest_signature($pdo, (int)$super['id']) : null;
    $sdcSig   = $sdc ? get_latest_signature($pdo, (int)$sdc['id']) : null;

    out(true, 'OK', [
      'super_admin' => $super ? [
        'id' => (int)$super['id'],
        'id_number' => (string)$super['id_number'],
        'first_name' => (string)$super['first_name'],
        'middle_name' => $super['middle_name'],
        'last_name' => (string)$super['last_name'],
        'suffix' => $super['suffix'],
        'email' => $super['email'],
        'role' => (string)$super['role'],
        'status' => (string)$super['status'],
        'created_at' => $super['created_at'],
        'last_login_at' => $super['last_login_at'],
        'full_name' => full_name($super),
        'signature' => $superSig,
      ] : null,
      'special_admin' => $sdc ? [
        'id' => (int)$sdc['id'],
        'id_number' => (string)$sdc['id_number'],
        'first_name' => (string)$sdc['first_name'],
        'middle_name' => $sdc['middle_name'],
        'last_name' => (string)$sdc['last_name'],
        'suffix' => $sdc['suffix'],
        'email' => $sdc['email'],
        'role' => (string)$sdc['role'],
        'status' => (string)$sdc['status'],
        'created_at' => $sdc['created_at'],
        'last_login_at' => $sdc['last_login_at'],
        'full_name' => full_name($sdc),
        'signature' => $sdcSig,
      ] : null,
      'current_history' => [
        'super_admin' => get_current_history_row($pdo, 'super_admin'),
        'special_admin' => get_current_history_row($pdo, 'special_admin'),
      ],
    ]);
  }

  if ($action === 'view_by_role') {
    $role = normalize_role((string)($data['role'] ?? ''));
    $u = get_current_holder($pdo, $role);
    if (!$u) out(false, 'No active user for this role.');

    $sig = get_latest_signature($pdo, (int)$u['id']);

    out(true, 'OK', [
      'user' => [
        'id' => (int)$u['id'],
        'id_number' => (string)$u['id_number'],
        'first_name' => (string)$u['first_name'],
        'middle_name' => $u['middle_name'],
        'last_name' => (string)$u['last_name'],
        'suffix' => $u['suffix'],
        'email' => $u['email'],
        'role' => (string)$u['role'],
        'status' => (string)$u['status'],
        'created_at' => $u['created_at'],
        'last_login_at' => $u['last_login_at'],
        'full_name' => full_name($u),
        'signature' => $sig,
      ],
    ]);
  }

  if ($action === 'edit_user') {
    $role = normalize_role((string)($data['role'] ?? ''));
    $userId = (int)($data['id'] ?? 0);
    if ($userId <= 0) out(false, 'Missing user id.');

    $current = get_current_holder($pdo, $role);
    if (!$current) out(false, 'No active user for this role.');
    if ((int)$current['id'] !== $userId) out(false, 'You can only edit the current active holder for this role.');

    $first  = trim((string)($data['first_name'] ?? ''));
    $middle = trim((string)($data['middle_name'] ?? ''));
    $last   = trim((string)($data['last_name'] ?? ''));
    $suffix = trim((string)($data['suffix'] ?? ''));
    $idNumber = trim((string)($data['id_number'] ?? ''));
    $email  = trim((string)($data['email'] ?? ''));

    if ($first === '' || $last === '' || $idNumber === '') out(false, 'first_name, last_name, and id_number are required.');

    assert_unique_identifiers($pdo, $userId, $idNumber, ($email === '' ? null : $email));

    $stmt = $pdo->prepare("
      UPDATE users
      SET first_name = :first,
          middle_name = :middle,
          last_name = :last,
          suffix = :suffix,
          id_number = :idnum,
          email = :email
      WHERE id = :id
      LIMIT 1
    ");
    $stmt->execute([
      'first' => $first,
      'middle' => ($middle === '' ? null : $middle),
      'last' => $last,
      'suffix' => ($suffix === '' ? null : $suffix),
      'idnum' => $idNumber,
      'email' => ($email === '' ? null : $email),
      'id' => $userId,
    ]);

    out(true, 'Updated.');
  }

  if ($action === 'get_audit') {
    $role = normalize_role((string)($data['role'] ?? ''));
    $limit = (int)($data['limit'] ?? 200);

    $rows = get_audit_history($pdo, $role, $limit);
    out(true, 'OK', ['rows' => $rows]);
  }

  if ($action === 'replace_role') {
    $role = normalize_role((string)($data['role'] ?? ''));
    $reason = trim((string)($data['reason'] ?? ''));

    $payload = [
      'first_name' => trim((string)($data['first_name'] ?? '')),
      'middle_name' => trim((string)($data['middle_name'] ?? '')),
      'last_name' => trim((string)($data['last_name'] ?? '')),
      'suffix' => trim((string)($data['suffix'] ?? '')),
      'id_number' => trim((string)($data['id_number'] ?? '')),
      'email' => trim((string)($data['email'] ?? '')),
    ];

    if ($payload['first_name'] === '' || $payload['last_name'] === '' || $payload['id_number'] === '') {
      out(false, 'first_name, last_name, and id_number are required.');
    }

    $pdo->beginTransaction();

    try {
      // 1) Snapshot the previous active holder (THIS is the one we will record in history)
      $prev = get_current_holder($pdo, $role); // may be null if none yet

      // 2) Prepare/Upsert the incoming user
      $user = get_user_by_id_number($pdo, $payload['id_number']);
      $tempPassword = null;

      if ($user) {
        $uid = (int)$user['id'];
        assert_unique_identifiers($pdo, $uid, $payload['id_number'], ($payload['email'] === '' ? null : $payload['email']));

        $upd = $pdo->prepare("
          UPDATE users
          SET first_name = :first,
              middle_name = :middle,
              last_name = :last,
              suffix = :suffix,
              email = :email
          WHERE id = :id
          LIMIT 1
        ");
        $upd->execute([
          'first' => $payload['first_name'],
          'middle' => ($payload['middle_name'] === '' ? null : $payload['middle_name']),
          'last' => $payload['last_name'],
          'suffix' => ($payload['suffix'] === '' ? null : $payload['suffix']),
          'email' => ($payload['email'] === '' ? null : $payload['email']),
          'id' => $uid,
        ]);

        // 3) Close any open history rows (if your table uses them elsewhere)
        revoke_open_history($pdo, $role);

        // 4) Activate the new holder & deactivate others
        activate_as_role($pdo, $uid, $role);
        deactivate_old_holders($pdo, $role, $uid);

        $user = get_user_by_id_number($pdo, $payload['id_number']);
      } else {
        // NEW USER: default password = id_number
        [$user, $tempPassword] = create_user($pdo, [
          'id_number' => $payload['id_number'],
          'first_name' => $payload['first_name'],
          'middle_name' => ($payload['middle_name'] === '' ? null : $payload['middle_name']),
          'last_name' => $payload['last_name'],
          'suffix' => ($payload['suffix'] === '' ? null : $payload['suffix']),
          'email' => ($payload['email'] === '' ? null : $payload['email']),
        ], $role);

        $uid = (int)$user['id'];

        // 3) Close any open history rows (if your table uses them elsewhere)
        revoke_open_history($pdo, $role);

        // 4) Activate the new holder & deactivate others
        activate_as_role($pdo, $uid, $role);
        deactivate_old_holders($pdo, $role, $uid);
      }

      // 5) Record the PREVIOUS holder as "revoked" in admin_role_history
      if ($prev) {
        insert_role_history($pdo, $prev, $role, ($reason === '' ? null : $reason), true);
      }

      $pdo->commit();

      out(true, 'Replaced successfully.', [
        'replaced_user' => $prev ? [
          'id' => (int)$prev['id'],
          'id_number' => (string)$prev['id_number'],
          'first_name' => (string)$prev['first_name'],
          'middle_name' => $prev['middle_name'],
          'last_name' => (string)$prev['last_name'],
          'suffix' => $prev['suffix'],
          'email' => $prev['email'],
          'role' => (string)$prev['role'],
          'status' => (string)$prev['status'],
          'full_name' => full_name($prev),
        ] : null,
        'user' => [
          'id' => (int)$user['id'],
          'id_number' => (string)$user['id_number'],
          'first_name' => (string)$user['first_name'],
          'middle_name' => $user['middle_name'],
          'last_name' => (string)$user['last_name'],
          'suffix' => $user['suffix'],
          'email' => $user['email'],
          'role' => (string)$user['role'],
          'status' => (string)$user['status'],
          'full_name' => full_name($user),
        ],
        'temp_password' => $tempPassword,
      ]);

    } catch (Throwable $e) {
      $pdo->rollBack();
      throw $e;
    }
  }

  if ($action === 'restore_from_history') {
    $role = normalize_role((string)($data['role'] ?? ''));
    $historyId = (int)($data['history_id'] ?? 0);
    $reason = trim((string)($data['reason'] ?? 'Restored from audit history'));

    if ($historyId <= 0) out(false, 'Missing history_id.');

    $pdo->beginTransaction();

    try {
      $stmt = $pdo->prepare("
        SELECT id, user_id, role
        FROM admin_role_history
        WHERE id = :id AND role = :role
        LIMIT 1
      ");
      $stmt->execute(['id' => $historyId, 'role' => $role]);
      $h = $stmt->fetch(PDO::FETCH_ASSOC);
      if (!$h) out(false, 'History record not found.');

      $userId = (int)$h['user_id'];

      $chk = $pdo->prepare("SELECT id FROM users WHERE id = :id LIMIT 1");
      $chk->execute(['id' => $userId]);
      if (!$chk->fetch(PDO::FETCH_ASSOC)) out(false, 'User no longer exists.');

      // snapshot current holder before switching (so we can record who got replaced)
      $prev = get_current_holder($pdo, $role);

      revoke_open_history($pdo, $role);
      activate_as_role($pdo, $userId, $role);
      deactivate_old_holders($pdo, $role, $userId);

      $u = $pdo->prepare("
        SELECT id, id_number, first_name, middle_name, last_name, suffix, email,
               role, status, created_at, last_login_at
        FROM users
        WHERE id = :id
        LIMIT 1
      ");
      $u->execute(['id' => $userId]);
      $user = $u->fetch(PDO::FETCH_ASSOC);

      // record the previous holder (the one replaced) as revoked
      if ($prev && (int)$prev['id'] !== $userId) {
        insert_role_history($pdo, $prev, $role, ($reason === '' ? null : $reason), true);
      }

      $pdo->commit();

      out(true, 'Restored successfully.', [
        'replaced_user' => $prev ? [
          'id' => (int)$prev['id'],
          'id_number' => (string)$prev['id_number'],
          'first_name' => (string)$prev['first_name'],
          'middle_name' => $prev['middle_name'],
          'last_name' => (string)$prev['last_name'],
          'suffix' => $prev['suffix'],
          'email' => $prev['email'],
          'role' => (string)$prev['role'],
          'status' => (string)$prev['status'],
          'full_name' => full_name($prev),
        ] : null,
        'user' => [
          'id' => (int)$user['id'],
          'id_number' => (string)$user['id_number'],
          'first_name' => (string)$user['first_name'],
          'middle_name' => $user['middle_name'],
          'last_name' => (string)$user['last_name'],
          'suffix' => $user['suffix'],
          'email' => $user['email'],
          'role' => (string)$user['role'],
          'status' => (string)$user['status'],
          'full_name' => full_name($user),
        ],
      ]);

    } catch (Throwable $e) {
      $pdo->rollBack();
      throw $e;
    }
  }

  /**
   * ✅ reset_password
   */
  if ($action === 'reset_password') {
    $role = normalize_role((string)($data['role'] ?? ''));

    $current = get_current_holder($pdo, $role);
    if (!$current) out(false, 'No active user for this role.');

    $expectedId = (int)($data['id'] ?? 0);
    if ($expectedId > 0 && (int)$current['id'] !== $expectedId) {
      out(false, 'You can only reset the password of the current active holder.');
    }

    $idNumber = trim((string)($current['id_number'] ?? ''));
    if ($idNumber === '') out(false, 'Cannot reset password: missing id_number.');

    $hash = password_hash($idNumber, PASSWORD_DEFAULT);

    $upd = $pdo->prepare("
      UPDATE users
      SET password_hash = :hash
      WHERE id = :id
      LIMIT 1
    ");
    $upd->execute([
      'hash' => $hash,
      'id' => (int)$current['id'],
    ]);

    out(true, 'Password reset successfully.', [
      'user' => [
        'id' => (int)$current['id'],
        'id_number' => (string)$current['id_number'],
        'full_name' => full_name($current),
        'role' => $role,
      ],
      'temp_password' => $idNumber,
    ]);
  }

  out(false, 'Unknown action.');

} catch (Throwable $e) {
  http_response_code(500);
  out(false, 'Server error in system-authority.php.', [
    // comment this out in production if you want:
    'debug' => $e->getMessage(),
  ]);
}