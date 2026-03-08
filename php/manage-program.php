<?php
declare(strict_types=1);

session_start();
header('Content-Type: application/json; charset=utf-8');

/**
 * GUARD: Prevent "Cannot redeclare ..." if included twice by accident
 */
if (defined('MANAGE_PROGRAM_LOADED')) {
  return;
}
define('MANAGE_PROGRAM_LOADED', true);

require_once __DIR__ . '/db.php'; // provides $pdo (PDO)

/** -------------------------
 * JSON-safe error handling
 * ------------------------ */
ini_set('display_errors', '0');
ini_set('log_errors', '1');
error_reporting(E_ALL);

function out(bool $ok, string $msg = '', array $extra = []): void {
  echo json_encode(array_merge([
    'success' => $ok,
    'message' => $msg,
  ], $extra), JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
  exit;
}

set_error_handler(function(int $severity, string $message, string $file, int $line): bool {
  throw new ErrorException($message, 0, $severity, $file, $line);
});

register_shutdown_function(function(): void {
  $err = error_get_last();
  if ($err && in_array($err['type'], [E_ERROR, E_PARSE, E_CORE_ERROR, E_COMPILE_ERROR], true)) {
    http_response_code(500);
    echo json_encode([
      'success' => false,
      'message' => 'Fatal server error in manage-program.php.',
      'debug' => $err['message'] . ' @ ' . $err['file'] . ':' . $err['line'],
    ], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
  }
});

/** -------------------------
 * Auth + input helpers
 * ------------------------ */
function require_overseer_or_super_admin(): void {
  $role = (string)($_SESSION['role'] ?? '');
  if ($role !== 'overseer' && $role !== 'super_admin') {
    http_response_code(403);
    out(false, 'Forbidden: overseer or super_admin only.');
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

function s(?string $v): string {
  return trim((string)$v);
}

function clamp_int($v, int $min, int $max, int $fallback): int {
  $n = (int)$v;
  if ($n < $min) return $fallback;
  if ($n > $max) return $max;
  return $n;
}

function normalize_status(?string $status): string {
  $st = strtolower(trim((string)$status));
  // Active + Archived only for your manage-program UI
  if ($st === 'archived') return 'Archived';
  return 'Active';
}

/** -------------------------
 * Upload helpers
 * ------------------------ */
/**
 * Store uploads under: /public/uploads/programs/
 * Adjust if your public root differs.
 *
 * Returned path is stored in DB and should be web-accessible.
 */
function handle_image_upload(string $fieldName = 'image'): ?string {
  if (!isset($_FILES[$fieldName]) || !is_array($_FILES[$fieldName])) return null;

  $f = $_FILES[$fieldName];
  if (($f['error'] ?? UPLOAD_ERR_NO_FILE) === UPLOAD_ERR_NO_FILE) return null;
  if (($f['error'] ?? UPLOAD_ERR_OK) !== UPLOAD_ERR_OK) out(false, 'Image upload failed.');

  $tmp = (string)($f['tmp_name'] ?? '');
  if ($tmp === '' || !is_uploaded_file($tmp)) out(false, 'Invalid upload.');

  $size = (int)($f['size'] ?? 0);
  if ($size <= 0) out(false, 'Empty image file.');
  if ($size > 2_500_000) out(false, 'Image too large. Max 2.5MB.');

  $origName = (string)($f['name'] ?? 'upload');
  $ext = strtolower(pathinfo($origName, PATHINFO_EXTENSION));

  // Allow common icon/image formats
  $allowed = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg'];
  if (!in_array($ext, $allowed, true)) out(false, 'Invalid image type. Use PNG/JPG/WEBP/GIF/SVG.');

  // Optional MIME check (best-effort)
  $mime = '';
  if (function_exists('mime_content_type')) {
    $mime = (string)@mime_content_type($tmp);
  }
  // Allow SVG which may appear as text/xml or image/svg+xml
  if ($ext !== 'svg' && $mime !== '' && !str_starts_with($mime, 'image/')) {
    out(false, 'Invalid image file (mime check failed).');
  }

  // Put uploads here (relative to this PHP folder)
  // If your php folder is /public/php/, this becomes /public/uploads/programs/
  $uploadDirFs = realpath(__DIR__ . '/..') . '/uploads/programs';
  if ($uploadDirFs === false) {
    out(false, 'Upload directory base not found.');
  }
  if (!is_dir($uploadDirFs)) {
    @mkdir($uploadDirFs, 0755, true);
  }

  $safeName = 'program_' . date('Ymd_His') . '_' . bin2hex(random_bytes(6)) . '.' . $ext;
  $destFs = $uploadDirFs . '/' . $safeName;

  if (!move_uploaded_file($tmp, $destFs)) out(false, 'Failed to save image.');

  // Web path (what you store in DB)
  // Adjust if your public URL base is different
  $webPath = 'uploads/programs/' . $safeName;

  return $webPath;
}

/** -------------------------
 * DB helpers (programs)
 * ------------------------ */
/**
 * Expected table (example):
 * programs (
 *  id INT AUTO_INCREMENT PRIMARY KEY,
 *  program_name VARCHAR(255) UNIQUE NOT NULL,
 *  abbreviation VARCHAR(50) UNIQUE NOT NULL,
 *  image_path VARCHAR(255) NULL,
 *  status ENUM('Active','Archived') NOT NULL DEFAULT 'Active',
 *  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
 * )
 */

function assert_unique_program(PDO $pdo, string $name, string $abbr, ?int $excludeId = null): void {
  // program_name unique
  $sql1 = "SELECT id FROM programs WHERE program_name = :n";
  $params1 = ['n' => $name];
  if ($excludeId !== null) {
    $sql1 .= " AND id <> :id";
    $params1['id'] = $excludeId;
  }
  $sql1 .= " LIMIT 1";
  $st1 = $pdo->prepare($sql1);
  $st1->execute($params1);
  if ($st1->fetch(PDO::FETCH_ASSOC)) out(false, 'Program name already exists.');

  // abbreviation unique
  $sql2 = "SELECT id FROM programs WHERE abbreviation = :a";
  $params2 = ['a' => $abbr];
  if ($excludeId !== null) {
    $sql2 .= " AND id <> :id";
    $params2['id'] = $excludeId;
  }
  $sql2 .= " LIMIT 1";
  $st2 = $pdo->prepare($sql2);
  $st2->execute($params2);
  if ($st2->fetch(PDO::FETCH_ASSOC)) out(false, 'Abbreviation already exists.');
}

function fetch_program(PDO $pdo, int $id): ?array {
  $st = $pdo->prepare("
    SELECT id, program_name, abbreviation, image_path, status, created_at
    FROM programs
    WHERE id = :id
    LIMIT 1
  ");
  $st->execute(['id' => $id]);
  $row = $st->fetch(PDO::FETCH_ASSOC);
  return $row ?: null;
}

function list_programs(PDO $pdo, string $status, string $search, int $page, int $pageSize): array {
  $offset = ($page - 1) * $pageSize;

  $where = "WHERE status = :status";
  $params = ['status' => $status];

  if ($search !== '') {
    $where .= " AND (program_name LIKE :q OR abbreviation LIKE :q)";
    $params['q'] = '%' . $search . '%';
  }

  $count = $pdo->prepare("SELECT COUNT(*) AS c FROM programs $where");
  $count->execute($params);
  $total = (int)($count->fetch(PDO::FETCH_ASSOC)['c'] ?? 0);

  $sql = "
    SELECT id, program_name, abbreviation, image_path, status, created_at
    FROM programs
    $where
    ORDER BY created_at DESC, id DESC
    LIMIT :lim OFFSET :off
  ";
  $st = $pdo->prepare($sql);

  // bindValue needed for LIMIT/OFFSET ints
  foreach ($params as $k => $v) {
    $st->bindValue(':' . $k, $v);
  }
  $st->bindValue(':lim', $pageSize, PDO::PARAM_INT);
  $st->bindValue(':off', $offset, PDO::PARAM_INT);

  $st->execute();
  $rows = $st->fetchAll(PDO::FETCH_ASSOC);

  return [
    'items' => $rows,
    'page' => $page,
    'pageSize' => $pageSize,
    'total' => $total,
    'totalPages' => $pageSize > 0 ? (int)ceil($total / $pageSize) : 1,
  ];
}

/** -------------------------
 * Routing
 * ------------------------ */
try {
  require_overseer_or_super_admin();

  $in = read_input();
  $action = s($in['action'] ?? '');

  if ($action === '') out(false, 'Missing action.');

  switch ($action) {

    case 'list_active': {
      $search = s($in['search'] ?? '');
      $page = clamp_int($in['page'] ?? 1, 1, 999999, 1);
      $pageSize = clamp_int($in['pageSize'] ?? 10, 1, 200, 10);

      $data = list_programs($pdo, 'Active', $search, $page, $pageSize);
      out(true, 'OK', $data);
    }

    case 'list_archived': {
      $search = s($in['search'] ?? '');
      $page = clamp_int($in['page'] ?? 1, 1, 999999, 1);
      $pageSize = clamp_int($in['pageSize'] ?? 10, 1, 200, 10);

      $data = list_programs($pdo, 'Archived', $search, $page, $pageSize);
      out(true, 'OK', $data);
    }

    case 'get_one': {
      $id = (int)($in['id'] ?? 0);
      if ($id <= 0) out(false, 'Invalid id.');

      $p = fetch_program($pdo, $id);
      if (!$p) out(false, 'Program not found.');

      out(true, 'OK', ['program' => $p]);
    }

    case 'create': {
      $name = s($in['program_name'] ?? '');
      $abbr = s($in['abbreviation'] ?? '');

      if ($name === '') out(false, 'Program name is required.');
      if ($abbr === '') out(false, 'Abbreviation is required.');

      $imagePath = handle_image_upload('image');

      assert_unique_program($pdo, $name, $abbr, null);

      $st = $pdo->prepare("
        INSERT INTO programs (program_name, abbreviation, image_path, status, created_at)
        VALUES (:n, :a, :img, 'Active', NOW())
      ");
      $st->execute([
        'n' => $name,
        'a' => $abbr,
        'img' => $imagePath,
      ]);

      $newId = (int)$pdo->lastInsertId();
      $p = fetch_program($pdo, $newId);

      out(true, 'Program created.', ['program' => $p]);
    }

    case 'update': {
      $id = (int)($in['id'] ?? 0);
      if ($id <= 0) out(false, 'Invalid id.');

      $existing = fetch_program($pdo, $id);
      if (!$existing) out(false, 'Program not found.');

      $name = s($in['program_name'] ?? $existing['program_name'] ?? '');
      $abbr = s($in['abbreviation'] ?? $existing['abbreviation'] ?? '');

      if ($name === '') out(false, 'Program name is required.');
      if ($abbr === '') out(false, 'Abbreviation is required.');

      $newImagePath = handle_image_upload('image');
      $finalImagePath = $newImagePath !== null ? $newImagePath : ($existing['image_path'] ?? null);

      assert_unique_program($pdo, $name, $abbr, $id);

      $st = $pdo->prepare("
        UPDATE programs
        SET program_name = :n,
            abbreviation = :a,
            image_path = :img
        WHERE id = :id
        LIMIT 1
      ");
      $st->execute([
        'n' => $name,
        'a' => $abbr,
        'img' => $finalImagePath,
        'id' => $id,
      ]);

      $p = fetch_program($pdo, $id);
      out(true, 'Program updated.', ['program' => $p]);
    }

    case 'archive': {
      $id = (int)($in['id'] ?? 0);
      if ($id <= 0) out(false, 'Invalid id.');

      $existing = fetch_program($pdo, $id);
      if (!$existing) out(false, 'Program not found.');

      $st = $pdo->prepare("UPDATE programs SET status = 'Archived' WHERE id = :id LIMIT 1");
      $st->execute(['id' => $id]);

      out(true, 'Program archived.', ['id' => $id]);
    }

    case 'restore': {
      $id = (int)($in['id'] ?? 0);
      if ($id <= 0) out(false, 'Invalid id.');

      $existing = fetch_program($pdo, $id);
      if (!$existing) out(false, 'Program not found.');

      $st = $pdo->prepare("UPDATE programs SET status = 'Active' WHERE id = :id LIMIT 1");
      $st->execute(['id' => $id]);

      out(true, 'Program restored.', ['id' => $id]);
    }

    default:
      out(false, 'Unknown action: ' . $action);
  }

} catch (Throwable $e) {
  http_response_code(500);
  out(false, 'Server error.', [
    'debug' => $e->getMessage(),
  ]);
}
