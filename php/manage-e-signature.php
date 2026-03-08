<?php
declare(strict_types=1);

session_start();
header('Content-Type: application/json; charset=utf-8');

/**
 * GUARD:
 * Prevent "Cannot redeclare ..." if this file is included twice by accident.
 */
if (defined('MANAGE_ESIGNATURE_LOADED')) {
  return;
}
define('MANAGE_ESIGNATURE_LOADED', true);

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
      'message' => 'Fatal server error in manage-e-signature.php.',
      'debug' => $err['message'] . ' @ ' . $err['file'] . ':' . $err['line'],
    ], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
  }
});

/** -------------------------
 * Auth + input helpers
 * ------------------------ */
function require_login(): int {
  $uid = (int)($_SESSION['user_id'] ?? 0);
  if ($uid <= 0) {
    http_response_code(401);
    out(false, 'Unauthorized. Please login again.');
  }
  return $uid;
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
 * File helpers
 * ------------------------ */
function ensure_dir(string $dir): void {
  if (is_dir($dir)) return;
  if (!mkdir($dir, 0775, true) && !is_dir($dir)) {
    throw new RuntimeException("Failed to create dir: {$dir}");
  }
}

function pick_ext_from_mime(string $mime): string {
  // Keep this tight; transparency best on png
  return match ($mime) {
    'image/png'  => 'png',
    'image/jpeg' => 'jpg',
    'image/webp' => 'webp',
    default      => '',
  };
}

function validate_uploaded_image(array $file, int $maxBytes = 3_000_000): array {
  // returns [tmpPath, mime, ext, size]
  if (!isset($file['error']) || !isset($file['tmp_name'])) {
    out(false, 'Invalid upload payload.');
  }
  if ($file['error'] !== UPLOAD_ERR_OK) {
    out(false, 'Upload failed. Error code: ' . (string)$file['error']);
  }

  $tmp = (string)$file['tmp_name'];
  $size = (int)($file['size'] ?? 0);

  if ($size <= 0) out(false, 'Uploaded file is empty.');
  if ($size > $maxBytes) out(false, 'File too large. Max is 3MB.');

  $fi = new finfo(FILEINFO_MIME_TYPE);
  $mime = (string)$fi->file($tmp);

  $ext = pick_ext_from_mime($mime);
  if ($ext === '') out(false, 'Invalid file type. Allowed: PNG, JPG, WEBP.');

  return [$tmp, $mime, $ext, $size];
}

function decode_data_url_png(string $dataUrl, int $maxBytes = 3_000_000): string {
  // returns raw binary bytes
  $dataUrl = trim($dataUrl);
  if ($dataUrl === '') out(false, 'Missing signature data.');

  // expected: data:image/png;base64,....
  if (!str_starts_with($dataUrl, 'data:image/png;base64,')) {
    out(false, 'Drawn signature must be a PNG data URL.');
  }

  $b64 = substr($dataUrl, strlen('data:image/png;base64,'));
  $bin = base64_decode($b64, true);
  if ($bin === false) out(false, 'Invalid base64 signature data.');

  if (strlen($bin) <= 0) out(false, 'Signature data is empty.');
  if (strlen($bin) > $maxBytes) out(false, 'Signature too large. Max is 3MB.');

  return $bin;
}

/** -------------------------
 * DB helpers
 * ------------------------ */
function get_user(PDO $pdo, int $userId): ?array {
  $stmt = $pdo->prepare("
    SELECT id, id_number, first_name, middle_name, last_name, suffix, email, role, status
    FROM users
    WHERE id = :id
    LIMIT 1
  ");
  $stmt->execute(['id' => $userId]);
  $u = $stmt->fetch(PDO::FETCH_ASSOC);
  return $u ?: null;
}

function get_signature_row(PDO $pdo, int $userId): ?array {
  $stmt = $pdo->prepare("
    SELECT id, user_id, signature_file, status, updated_at
    FROM e_signatures
    WHERE user_id = :uid
    LIMIT 1
  ");
  $stmt->execute(['uid' => $userId]);
  $row = $stmt->fetch(PDO::FETCH_ASSOC);
  return $row ?: null;
}

/**
 * UPSERT (because user_id is UNIQUE):
 * - if row exists => update signature_file/status/updated_at
 * - else => insert
 */
function upsert_signature(PDO $pdo, int $userId, ?string $filePath, string $status = 'Active'): void {
  $stmt = $pdo->prepare("
    INSERT INTO e_signatures (user_id, signature_file, status, updated_at)
    VALUES (:uid, :file, :status, NOW())
    ON DUPLICATE KEY UPDATE
      signature_file = VALUES(signature_file),
      status = VALUES(status),
      updated_at = NOW()
  ");
  $stmt->execute([
    'uid' => $userId,
    'file' => $filePath,
    'status' => $status,
  ]);
}

function mark_removed(PDO $pdo, int $userId): void {
  $stmt = $pdo->prepare("
    UPDATE e_signatures
    SET status = 'Removed',
        signature_file = NULL,
        updated_at = NOW()
    WHERE user_id = :uid
    LIMIT 1
  ");
  $stmt->execute(['uid' => $userId]);
}

/** -------------------------
 * Controller
 * ------------------------ */
$uid = require_login();
$data = read_input();
$action = (string)($data['action'] ?? '');

if ($action === '') out(false, 'Missing action.');

try {
  // Build base upload directory (inside your project)
  // You can change this folder to match your project style.
  $uploadRootFs = realpath(__DIR__ . '/../') ?: (__DIR__ . '/../');
  $uploadDirFs  = rtrim($uploadRootFs, '/\\') . '/assets/uploads/e-signatures/' . $uid;
  $uploadDirRel = 'assets/uploads/e-signatures/' . $uid; // for frontend display

  if ($action === 'get_current') {
    $user = get_user($pdo, $uid);
    if (!$user) out(false, 'User not found.');

    $sig = get_signature_row($pdo, $uid);

    out(true, 'OK', [
      'user' => [
        'id' => (int)$user['id'],
        'id_number' => (string)$user['id_number'],
        'role' => (string)$user['role'],
        'status' => (string)$user['status'],
        'full_name' => full_name($user),
        'email' => $user['email'],
      ],
      'signature' => $sig ? [
        'id' => (int)$sig['id'],
        'user_id' => (int)$sig['user_id'],
        'signature_file' => $sig['signature_file'],
        'signature_url' => ($sig['signature_file'] ? $sig['signature_file'] : null),
        'status' => (string)$sig['status'],
        'updated_at' => $sig['updated_at'],
      ] : null,
    ]);
  }

  if ($action === 'save') {
    $user = get_user($pdo, $uid);
    if (!$user) out(false, 'User not found.');

    // Accept either:
    // 1) multipart file: $_FILES['signature'] or $_FILES['sigFile']
    // 2) base64 PNG data URL: data['signature_data_url']
    $file = $_FILES['signature'] ?? ($_FILES['sigFile'] ?? null);
    $dataUrl = (string)($data['signature_data_url'] ?? '');

    ensure_dir($uploadDirFs);

    $finalRel = null;

    // CASE A: multipart upload file (works for BOTH upload mode and canvas blob if you send it as a File)
    if (is_array($file) && isset($file['tmp_name'])) {
      [$tmp, $mime, $ext] = validate_uploaded_image($file);

      // Keep names unique
      $name = 'signature_' . date('Ymd_His') . '_' . bin2hex(random_bytes(4)) . '.' . $ext;
      $finalFs = $uploadDirFs . '/' . $name;
      $finalRel = $uploadDirRel . '/' . $name;

      if (!move_uploaded_file($tmp, $finalFs)) {
        out(false, 'Failed to save uploaded signature.');
      }

      // Optional: if you only want PNG, you can reject non-png here:
      // if ($ext !== 'png') out(false, 'Please upload PNG for best results.');
    }
    // CASE B: base64 dataURL from canvas (PNG only)
    else if ($dataUrl !== '') {
      $bin = decode_data_url_png($dataUrl);

      $name = 'signature_' . date('Ymd_His') . '_' . bin2hex(random_bytes(4)) . '.png';
      $finalFs = $uploadDirFs . '/' . $name;
      $finalRel = $uploadDirRel . '/' . $name;

      if (file_put_contents($finalFs, $bin) === false) {
        out(false, 'Failed to save drawn signature.');
      }
    } else {
      out(false, 'No signature provided. Upload a file or provide signature_data_url.');
    }

    // Upsert DB row
    upsert_signature($pdo, $uid, $finalRel, 'Active');

    $sig = get_signature_row($pdo, $uid);

    out(true, 'Signature saved.', [
      'signature' => $sig ? [
        'id' => (int)$sig['id'],
        'user_id' => (int)$sig['user_id'],
        'signature_file' => $sig['signature_file'],
        'signature_url' => ($sig['signature_file'] ? $sig['signature_file'] : null),
        'status' => (string)$sig['status'],
        'updated_at' => $sig['updated_at'],
      ] : null,
    ]);
  }

  if ($action === 'remove') {
    $user = get_user($pdo, $uid);
    if (!$user) out(false, 'User not found.');

    // Soft-remove in DB (keeps audit-friendly behavior)
    // Also clears signature_file
    // If there's no row yet, we can upsert a Removed row if you want:
    $sig = get_signature_row($pdo, $uid);

    if ($sig) {
      mark_removed($pdo, $uid);
    } else {
      // create row in Removed state (optional)
      upsert_signature($pdo, $uid, null, 'Removed');
    }

    out(true, 'Signature removed.');
  }

  out(false, 'Unknown action.');

} catch (Throwable $e) {
  http_response_code(500);
  out(false, 'Server error in manage-e-signature.php.', [
    'debug' => $e->getMessage(),
  ]);
}
