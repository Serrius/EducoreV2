<?php
declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');

session_start();

require_once __DIR__ . '/db.php'; // expects $pdo (PDO)

if (!isset($pdo) || !($pdo instanceof PDO)) {
  http_response_code(500);
  echo json_encode(['ok' => false, 'message' => 'PDO not initialized. Check php/db.php (expected $pdo).'], JSON_UNESCAPED_SLASHES);
  exit;
}
try { $pdo->exec("SET NAMES utf8mb4"); } catch (\Throwable $e) {}

/* =========================
   Helpers
   ========================= */
   
function out(array $payload, int $code = 200): void {
  http_response_code($code);
  echo json_encode($payload, JSON_UNESCAPED_SLASHES);
  exit;
}
function ok(array $data = []): void { out(array_merge(['ok' => true], $data), 200); }
function err(string $message, int $code = 400, array $extra = []): void { out(array_merge(['ok' => false, 'message' => $message], $extra), $code); }

function readJson(): array {
  $raw = file_get_contents('php://input');
  if (!$raw) return [];
  $j = json_decode($raw, true);
  return is_array($j) ? $j : [];
}

function requireLogin(): array {
  $uid = $_SESSION['user_id'] ?? null;
  if (!$uid) err('Unauthorized. Please login again.', 401);
  return ['user_id' => (int)$uid];
}

function isPrivilegedRole(string $role): bool {
  return in_array($role, ['super_admin','special_admin','overseer'], true);
}

function getActiveTermId(PDO $pdo): ?int {
  $st = $pdo->query("SELECT id FROM academic_terms WHERE status='Active' ORDER BY id DESC LIMIT 1");
  $row = $st ? $st->fetch(PDO::FETCH_ASSOC) : null;
  return $row ? (int)$row['id'] : null;
}

function getUser(PDO $pdo, int $userId): array {
  $st = $pdo->prepare("SELECT id, id_number, first_name, last_name, role, status FROM users WHERE id=? LIMIT 1");
  $st->execute([$userId]);
  $u = $st->fetch(PDO::FETCH_ASSOC);
  if (!$u) err('User not found.', 404);
  return $u;
}

function getOfficerOrgIds(PDO $pdo, int $userId, int $termId): array {
  $st = $pdo->prepare("
    SELECT DISTINCT org_id
    FROM organization_officers
    WHERE academic_term_id = ?
      AND user_id = ?
      AND status = 'Active'
  ");
  $st->execute([$termId, $userId]);
  return array_map('intval', array_column($st->fetchAll(PDO::FETCH_ASSOC), 'org_id'));
}

function getAdminOrgIds(PDO $pdo, int $userId): array {
  // Using organizations.created_by as “org admin assignment” / faculty_admin assignment source in this implementation.
  $st = $pdo->prepare("SELECT id FROM organizations WHERE created_by = ? AND status='Active'");
  $st->execute([$userId]);
  return array_map('intval', array_column($st->fetchAll(PDO::FETCH_ASSOC), 'id'));
}

function getUserLabel(PDO $pdo, int $uid): ?string {
  $st = $pdo->prepare("SELECT id, id_number, first_name, last_name FROM users WHERE id=? LIMIT 1");
  $st->execute([$uid]);
  $u = $st->fetch(PDO::FETCH_ASSOC);
  if (!$u) return null;
  $name = trim((string)$u['first_name'] . ' ' . (string)$u['last_name']);
  $idn = trim((string)$u['id_number']);
  if ($name !== '' && $idn !== '') return $name . ' (' . $idn . ')';
  if ($name !== '') return $name;
  if ($idn !== '') return '(' . $idn . ')';
  return null;
}

function resolveTargetUserId(PDO $pdo, $raw): ?int {
  // accept integer user_id directly
  if ($raw === null || $raw === '') return null;

  if (is_int($raw)) {
    if ($raw <= 0) return null;
    $st = $pdo->prepare("SELECT id FROM users WHERE id=? LIMIT 1");
    $st->execute([$raw]);
    $r = $st->fetch(PDO::FETCH_ASSOC);
    if (!$r) err('Target user not found.', 404);
    return (int)$r['id'];
  }

  // Also allow numeric string of user_id or id_number
  if (is_string($raw)) {
    $q = trim($raw);
    if ($q === '') return null;

    if (ctype_digit($q)) {
      $st = $pdo->prepare("SELECT id FROM users WHERE id = ? LIMIT 1");
      $st->execute([(int)$q]);
      $r = $st->fetch(PDO::FETCH_ASSOC);
      if ($r) return (int)$r['id'];
    }

    // or id_number
    $st = $pdo->prepare("SELECT id FROM users WHERE id_number = ? LIMIT 1");
    $st->execute([$q]);
    $r = $st->fetch(PDO::FETCH_ASSOC);
    if (!$r) err('Target user not found.', 404);
    return (int)$r['id'];
  }

  return null;
}

function getOfficerOrgIdsAllTerms(PDO $pdo, int $userId): array {
  $st = $pdo->prepare("
    SELECT DISTINCT org_id
    FROM organization_officers
    WHERE user_id = ?
      AND status = 'Active'
  ");
  $st->execute([$userId]);
  return array_map('intval', array_column($st->fetchAll(PDO::FETCH_ASSOC), 'org_id'));
}

/* =========================
   Announcement approval helpers
   ========================= */
function isAnnouncementPostedByPresident(PDO $pdo, array $a): bool {
  $orgId = $a['org_id'] !== null ? (int)$a['org_id'] : 0;
  $createdBy = (int)($a['created_by'] ?? 0);
  $termId = (int)($a['academic_term_id'] ?? 0);

  if ($orgId <= 0 || $createdBy <= 0 || $termId <= 0) {
    return false;
  }

  $st = $pdo->prepare("
    SELECT 1
    FROM organization_officers oo
    INNER JOIN academic_terms at_posted
      ON at_posted.id = ?
    INNER JOIN academic_terms at_officer
      ON at_officer.id = oo.academic_term_id
    WHERE oo.user_id = ?
      AND oo.org_id = ?
      AND oo.status = 'Active'
      AND at_officer.school_year = at_posted.school_year
      AND (
        LOWER(oo.position) LIKE '%president%'
        OR LOWER(oo.position) LIKE '%chairperson%'
      )
    LIMIT 1
  ");
  $st->execute([$termId, $createdBy, $orgId]);

  return (bool)$st->fetchColumn();
}

function announcementIsVisibleToUser(PDO $pdo, array $a, array $me, int $activeTermId): bool {
  $role = (string)$me['role'];
  $userId = (int)$me['id'];

  // privileged can see all
  if (isPrivilegedRole($role)) return true;

  $termId = (int)$a['academic_term_id'];
  $orgId  = $a['org_id'] !== null ? (int)$a['org_id'] : null;
  $target = $a['target_user_id'] !== null ? (int)$a['target_user_id'] : null;

  // creator should always see their own announcement (even if targeted to someone else)
  if ((int)$a['created_by'] === $userId) return true;

  // Targeted announcements: only the target user can see (plus privileged handled above)
  if ($target !== null && $target !== $userId) return false;

  $officerOrgIds = getOfficerOrgIdsAllTerms($pdo, $userId);
  $isOfficer = count($officerOrgIds) > 0;
  $isStudentOnly = ($role === 'student' && !$isOfficer);

  // Student-only must only see Active announcements for ACTIVE term
  if ($isStudentOnly) {
    if ((string)$a['status'] !== 'Active') return false;
    if ($termId !== $activeTermId) return false;

    if ($orgId === null) return true;

    $st = $pdo->prepare("
      SELECT 1
      FROM organization_memberships
      WHERE student_user_id = ?
        AND academic_term_id = ?
        AND org_id = ?
        AND status = 'Approved'
      LIMIT 1
    ");
    $st->execute([$userId, $termId, $orgId]);
    return (bool)$st->fetchColumn();
  }

  // Officer/admin visibility:
  if ($orgId === null) return true;

  $adminOrgIds = getAdminOrgIds($pdo, $userId);
  $visibleOrgIds = array_values(array_unique(array_merge($officerOrgIds, $adminOrgIds)));

  return in_array($orgId, $visibleOrgIds, true);
}

function canManageAnnouncement(PDO $pdo, array $a, array $me, int $activeTermId): bool {
  $role   = (string)$me['role'];
  $userId = (int)$me['id'];

  $orgId = $a['org_id'] !== null ? (int)$a['org_id'] : null;

  // GENERAL announcements remain privileged-only
  if ($orgId === null) {
    return isPrivilegedRole($role);
  }

  // If the org announcement was posted by the President/Chairperson
  // for the same school year, only faculty_admin may manage it.
  if (isAnnouncementPostedByPresident($pdo, $a)) {
    if ($role !== 'faculty_admin') {
      return false;
    }

    $adminOrgIds = getAdminOrgIds($pdo, $userId);
    return in_array($orgId, $adminOrgIds, true);
  }

  // Non-president org announcements:
  // privileged roles may still manage
  if (isPrivilegedRole($role)) return true;

  // faculty_admin may manage their assigned org announcements
  if ($role === 'faculty_admin') {
    $adminOrgIds = getAdminOrgIds($pdo, $userId);
    return in_array($orgId, $adminOrgIds, true);
  }

  return false;
}

function canEditAnnouncement(PDO $pdo, array $a, array $me, int $activeTermId): bool {
  $role = (string)$me['role'];
  $userId = (int)$me['id'];

  if (isPrivilegedRole($role)) return true;

  // creator can edit while Pending
  if ((int)$a['created_by'] === $userId && (string)$a['status'] === 'Pending') return true;

  // faculty_admin/org admin can edit org announcements (Pending only)
  $orgId = $a['org_id'] !== null ? (int)$a['org_id'] : null;
  if ($orgId !== null && (string)$a['status'] === 'Pending') {
    $adminOrgIds = getAdminOrgIds($pdo, $userId);
    if (in_array($orgId, $adminOrgIds, true)) return true;
  }

  return false;
}

function pushAnnouncementNotifications(PDO $pdo, int $announcementId): void {
  $st = $pdo->prepare("SELECT id, org_id, academic_term_id, target_user_id, title, body, created_by FROM announcements WHERE id=? LIMIT 1");
  $st->execute([$announcementId]);
  $a = $st->fetch(PDO::FETCH_ASSOC);
  if (!$a) return;

  $title = (string)$a['title'];
  $msg   = (string)$a['body'];
  $actor = (int)$a['created_by'];
  $orgId = $a['org_id'] !== null ? (int)$a['org_id'] : null;
  $termId = (int)$a['academic_term_id'];
  $target = $a['target_user_id'] !== null ? (int)$a['target_user_id'] : null;

  $recipientIds = [];

  if ($target !== null) {
    $recipientIds = [$target];
  } elseif ($orgId !== null) {
    $st1 = $pdo->prepare("
      SELECT DISTINCT student_user_id AS uid
      FROM organization_memberships
      WHERE org_id = ?
        AND academic_term_id = ?
        AND status = 'Approved'
    ");
    $st1->execute([$orgId, $termId]);
    $recipientIds = array_merge($recipientIds, array_map('intval', array_column($st1->fetchAll(PDO::FETCH_ASSOC), 'uid')));

    $st2 = $pdo->prepare("
      SELECT DISTINCT user_id AS uid
      FROM organization_officers
      WHERE org_id = ?
        AND academic_term_id = ?
        AND status = 'Active'
        AND user_id IS NOT NULL
    ");
    $st2->execute([$orgId, $termId]);
    $recipientIds = array_merge($recipientIds, array_map('intval', array_column($st2->fetchAll(PDO::FETCH_ASSOC), 'uid')));
  } else {
    $st3 = $pdo->query("SELECT id FROM users WHERE status='Active'");
    $recipientIds = array_map('intval', array_column($st3->fetchAll(PDO::FETCH_ASSOC), 'id'));
  }

  $recipientIds = array_values(array_unique(array_filter($recipientIds, fn($v) => $v > 0)));
  if (!$recipientIds) return;

  $ins = $pdo->prepare("
    INSERT INTO notifications (recipient_id, actor_id, title, message, notif_type, status, payload_id)
    VALUES (?, ?, ?, ?, 'announcement', 'unread', ?)
  ");

  foreach ($recipientIds as $rid) {
    $ins->execute([$rid, $actor, $title, $msg, $announcementId]);
  }
}


/* =========================
   Accreditation: returned-doc reupload support (coordinator/faculty_admin)
   ========================= */
function pushNotification(PDO $pdo, int $recipientId, ?int $actorId, string $title, string $message, string $type, int $payloadId): void {
  $st = $pdo->prepare("
    INSERT INTO notifications (recipient_id, actor_id, title, message, notif_type, status, payload_id)
    VALUES (?, ?, ?, ?, ?, 'unread', ?)
  ");
  $st->execute([$recipientId, $actorId, $title, $message, $type, $payloadId]);
}

function getSpecialAdminIds(PDO $pdo): array {
  $st = $pdo->query("SELECT id FROM users WHERE role='special_admin' AND status='Active'");
  if (!$st) return [];
  return array_map('intval', array_column($st->fetchAll(PDO::FETCH_ASSOC), 'id'));
}

function ensureDir(string $dir): void {
  if (!is_dir($dir)) {
    if (!@mkdir($dir, 0775, true) && !is_dir($dir)) {
      err('Failed to create upload directory.', 500);
    }
  }
}

function sanitizeFileName(string $name): string {
  $name = trim($name);
  $name = preg_replace('/[^\w.\- ]+/u', '_', $name) ?? 'file';
  $name = preg_replace('/\s+/', '-', $name) ?? $name;
  return $name === '' ? 'file' : $name;
}

function handleUploadedFile(string $field, string $destDir, array $allowedExt, int $maxBytes): array {
  if (!isset($_FILES[$field])) err("Missing file field '$field'.");
  $f = $_FILES[$field];

  if (!is_array($f) || !isset($f['error'], $f['tmp_name'], $f['name'], $f['size'])) {
    err('Invalid upload payload.');
  }
  if ((int)$f['error'] !== UPLOAD_ERR_OK) {
    $code = (int)$f['error'];
    $msg = match ($code) {
      UPLOAD_ERR_INI_SIZE, UPLOAD_ERR_FORM_SIZE => 'File too large.',
      UPLOAD_ERR_PARTIAL => 'Upload incomplete.',
      UPLOAD_ERR_NO_FILE => 'No file uploaded.',
      default => 'Upload failed.'
    };
    err($msg);
  }
  if (!is_uploaded_file($f['tmp_name'])) err('Invalid uploaded file.');
  $size = (int)$f['size'];
  if ($size <= 0) err('Empty file.');
  if ($size > $maxBytes) err('File too large. Max ' . (int)floor($maxBytes / 1024 / 1024) . 'MB.');

  $origName = (string)$f['name'];
  $ext = strtolower(pathinfo($origName, PATHINFO_EXTENSION));
  if ($ext === '' || !in_array($ext, $allowedExt, true)) {
    err('Invalid file type. Allowed: ' . implode(', ', $allowedExt) . '.');
  }

  ensureDir($destDir);

  $ts = date('Ymd_His');
  $rand = bin2hex(random_bytes(4));
  $safeBase = sanitizeFileName(pathinfo($origName, PATHINFO_FILENAME));
  $finalName = $safeBase . '_' . $ts . '_' . $rand . '.' . $ext;

  $destPath = rtrim($destDir, '/\\') . DIRECTORY_SEPARATOR . $finalName;

  if (!@move_uploaded_file($f['tmp_name'], $destPath)) {
    err('Failed to save uploaded file.', 500);
  }

  // Return web path (assuming project root is one level above /php)
  $webPath = str_replace('\\', '/', $destPath);
  $root = realpath(__DIR__ . '/..');
  $real = realpath($destPath);
  if ($root && $real && str_starts_with($real, $root)) {
    $webPath = ltrim(str_replace('\\', '/', substr($real, strlen($root))), '/');
  } else {
    $webPath = ltrim(str_replace('\\', '/', $destPath), '/');
  }

  return [
    'file_path' => $webPath,
    'file_name' => basename($webPath),
    'orig_name' => $origName,
    'ext' => $ext,
    'bytes' => $size,
  ];
}

/* =========================
   Routing
   ========================= */
$payload = $_POST ?: readJson();
$action  = $payload['action'] ?? $_GET['action'] ?? '';

$auth = requireLogin();
$userId = (int)$auth['user_id'];
$user = getUser($pdo, $userId);
$role = (string)$user['role'];

$activeTermId = getActiveTermId($pdo);
if (!$activeTermId) err('No active academic term found. Please set academic_terms.status=Active.', 500);

/* =========================
   Accreditation: REUPLOAD returned doc
   =========================
   - Intended for coordinator_user_id (often faculty_admin) to replace a Returned document.
   - Accepts multipart/form-data with:
       action=accreditation_reupload_doc
       request_id
       requirement_id
       file (uploaded file)
   - Resets doc to Submitted + clears reviewed fields + clears return_reason
   - Resets request status to Pending
   - Notifies special_admin(s) + moderator (if assigned) + coordinator confirmation
*/
if ($action === 'accreditation_reupload_doc') {
  // Only coordinator (request owner) or privileged roles can reupload/replace docs
  $requestId = (int)($_POST['request_id'] ?? $payload['request_id'] ?? 0);
  $requirementId = (int)($_POST['requirement_id'] ?? $payload['requirement_id'] ?? 0);
  if ($requestId <= 0 || $requirementId <= 0) err('Invalid request_id or requirement_id.');

  $st = $pdo->prepare("
    SELECT r.id, r.org_id, r.academic_term_id, r.coordinator_user_id, r.moderator_user_id, r.status,
           o.org_name
    FROM accreditation_requests r
    JOIN organizations o ON o.id = r.org_id
    WHERE r.id = ?
    LIMIT 1
  ");
  $st->execute([$requestId]);
  $req = $st->fetch(PDO::FETCH_ASSOC);
  if (!$req) err('Accreditation request not found.', 404);

  $isOwner = ((int)$req['coordinator_user_id'] === $userId);
  if (!$isOwner && !isPrivilegedRole($role)) {
    err('Not allowed to reupload documents for this request.', 403);
  }

  $st = $pdo->prepare("
    SELECT d.*
    FROM accreditation_request_documents d
    WHERE d.request_id = ? AND d.requirement_id = ?
    LIMIT 1
  ");
  $st->execute([$requestId, $requirementId]);
  $doc = $st->fetch(PDO::FETCH_ASSOC);
  if (!$doc) err('Document record not found for this requirement.', 404);

  $curDocStatus = (string)$doc['status'];
  if ($curDocStatus !== 'Returned' && !isPrivilegedRole($role)) {
    err('You can only reupload a document that was Returned.', 403, ['current_status' => $curDocStatus]);
  }

  $allowedExt = ['pdf', 'doc', 'docx'];
  $maxBytes = 15 * 1024 * 1024; // 15MB

  $destDir = realpath(__DIR__ . '/..');
  if ($destDir === false) err('Server path error.', 500);

  $destDir = $destDir . DIRECTORY_SEPARATOR . 'assets' . DIRECTORY_SEPARATOR . 'uploads'
    . DIRECTORY_SEPARATOR . 'accreditation'
    . DIRECTORY_SEPARATOR . (string)$requestId
    . DIRECTORY_SEPARATOR . 'req_' . (string)$requirementId;

  $upload = handleUploadedFile('file', $destDir, $allowedExt, $maxBytes);

  try {
    $pdo->beginTransaction();

    $upd = $pdo->prepare("
      UPDATE accreditation_request_documents
      SET file_path = ?,
          file_name = ?,
          status = 'Submitted',
          reviewed_by = NULL,
          reviewed_at = NULL,
          return_reason = NULL,
          uploaded_at = CURRENT_TIMESTAMP()
      WHERE id = ?
      LIMIT 1
    ");
    $upd->execute([$upload['file_path'], $upload['orig_name'], (int)$doc['id']]);

    $upd2 = $pdo->prepare("
      UPDATE accreditation_requests
      SET status = 'Pending',
          submitted_at = COALESCE(submitted_at, CURRENT_TIMESTAMP())
      WHERE id = ?
      LIMIT 1
    ");
    $upd2->execute([$requestId]);

    $stReq = $pdo->prepare("SELECT requirement_name FROM accreditation_requirements WHERE id=? LIMIT 1");
    $stReq->execute([$requirementId]);
    $reqName = (string)($stReq->fetchColumn() ?: ('Requirement #' . $requirementId));

    $orgName = (string)$req['org_name'];

    $specialAdmins = getSpecialAdminIds($pdo);
    $title = 'Document Replaced - Requires Review';
    $msg = "A document has been replaced for accreditation request #{$requestId} by "
      . trim((string)$user['first_name'] . ' ' . (string)$user['last_name'])
      . ". Requirement: '{$reqName}'. Organization: '{$orgName}'. The request status has been reset to Pending.";

    foreach ($specialAdmins as $sid) {
      pushNotification($pdo, $sid, $userId, $title, $msg, 'accreditation', $requestId);
    }

    $modId = $req['moderator_user_id'] !== null ? (int)$req['moderator_user_id'] : null;
    if ($modId) {
      pushNotification($pdo, $modId, $userId, $title, $msg, 'accreditation', $requestId);
    }

    $title2 = 'Document Replaced';
    $msg2 = "You have successfully replaced the document for requirement '{$reqName}'. The request status has been reset to Pending.";
    pushNotification($pdo, (int)$req['coordinator_user_id'], $userId, $title2, $msg2, 'accreditation', $requestId);

    $pdo->commit();
  } catch (\Throwable $e) {
    if ($pdo->inTransaction()) $pdo->rollBack();
    err('Server error while saving reupload: ' . $e->getMessage(), 500);
  }

  ok([
    'request_id' => $requestId,
    'requirement_id' => $requirementId,
    'doc_id' => (int)$doc['id'],
    'new_file_path' => $upload['file_path'],
    'new_file_name' => $upload['orig_name'],
    'status' => 'Submitted'
  ]);
}

/* =========================
   TERMS (for dropdowns)
   ========================= */
if ($action === 'terms') {
  $officerOrgIds = getOfficerOrgIds($pdo, $userId, $activeTermId);
  $isOfficer = count($officerOrgIds) > 0;
  $isStudentOnly = ($role === 'student' && !$isOfficer);

  if ($isStudentOnly) {
    $st = $pdo->prepare("
      SELECT id, school_year, semester, status
      FROM academic_terms
      WHERE id = ?
      LIMIT 1
    ");
    $st->execute([$activeTermId]);
    $row = $st->fetch(PDO::FETCH_ASSOC);
    ok(['active_term_id' => $activeTermId, 'terms' => $row ? [$row] : []]);
  }

  $st = $pdo->query("
    SELECT id, school_year, semester, status
    FROM academic_terms
    ORDER BY id DESC
  ");
  $rows = $st ? $st->fetchAll(PDO::FETCH_ASSOC) : [];
  ok(['active_term_id' => $activeTermId, 'terms' => $rows]);
}

/* =========================
   ME
   ========================= */
if ($action === 'me') {
  $officerOrgIds = getOfficerOrgIdsAllTerms($pdo, $userId);
  $adminOrgIds   = getAdminOrgIds($pdo, $userId);

  $canPostAnnouncements =
    isPrivilegedRole($role) ||
    $role === 'faculty_admin' ||
    count($officerOrgIds) > 0 ||
    count($adminOrgIds) > 0;

  ok([
    'user' => [
      'id' => (int)$user['id'],
      'id_number' => (string)$user['id_number'],
      'name' => trim($user['first_name'] . ' ' . $user['last_name']),
      'role' => $role,
    ],
    'active_term_id' => $activeTermId,
    'is_privileged' => isPrivilegedRole($role),
    'officer_org_ids' => $officerOrgIds,
    'admin_org_ids' => $adminOrgIds,
    'can_post_announcements' => $canPostAnnouncements
  ]);
}

/* =========================
   ORG OPTIONS for dropdown
   ========================= */
if ($action === 'org_options') {
  // IMPORTANT:
  // Use ALL active officer assignments, not only the current active term,
  // so presidents/officers from same school year setup still get their orgs.
  $officerOrgIds = getOfficerOrgIdsAllTerms($pdo, $userId);
  $adminOrgIds   = getAdminOrgIds($pdo, $userId);

  $canGeneral = isPrivilegedRole($role);

  if ($canGeneral) {
    $st = $pdo->query("
      SELECT id, org_name
      FROM organizations
      WHERE status = 'Active'
      ORDER BY org_name ASC
    ");
    $rows = $st ? $st->fetchAll(PDO::FETCH_ASSOC) : [];

    $options = array_map(function ($r) {
      return [
        'id' => (int)$r['id'],
        'name' => (string)$r['org_name'],
      ];
    }, $rows);

    ok([
      'can_post_general' => true,
      'options' => $options
    ]);
  }

  $orgIds = array_values(array_unique(array_merge($adminOrgIds, $officerOrgIds)));

  if (!$orgIds) {
    ok([
      'can_post_general' => false,
      'options' => []
    ]);
  }

  $in = implode(',', array_fill(0, count($orgIds), '?'));
  $st = $pdo->prepare("
    SELECT id, org_name
    FROM organizations
    WHERE status = 'Active'
      AND id IN ($in)
    ORDER BY org_name ASC
  ");
  $st->execute($orgIds);
  $rows = $st->fetchAll(PDO::FETCH_ASSOC);

  $options = array_map(function ($r) {
    return [
      'id' => (int)$r['id'],
      'name' => (string)$r['org_name'],
    ];
  }, $rows);

  ok([
    'can_post_general' => false,
    'options' => $options
  ]);
}

/* =========================
   USER SEARCH for target picker
   ========================= */
if ($action === 'user_search') {
  $officerOrgIds = getOfficerOrgIds($pdo, $userId, $activeTermId);
  $isOfficer = count($officerOrgIds) > 0;
  $isStudentOnly = ($role === 'student' && !$isOfficer);
  if ($isStudentOnly) err('Not allowed.', 403);

  $q = trim((string)($payload['q'] ?? ''));
  $limit = (int)($payload['limit'] ?? 12);
  if ($limit < 1) $limit = 12;
  if ($limit > 25) $limit = 25;

  if ($q === '' || mb_strlen($q) < 2) ok(['users' => []]);

  $like = '%' . $q . '%';

  $st = $pdo->prepare("
    SELECT id, id_number, first_name, last_name
    FROM users
    WHERE status = 'Active'
      AND (
        id_number LIKE ?
        OR CONCAT(first_name, ' ', last_name) LIKE ?
        OR CONCAT(last_name, ', ', first_name) LIKE ?
      )
    ORDER BY last_name ASC, first_name ASC
    LIMIT $limit
  ");
  $st->execute([$like, $like, $like]);
  $rows = $st->fetchAll(PDO::FETCH_ASSOC);

  $users = array_map(function($r) {
    $name = trim((string)$r['first_name'] . ' ' . (string)$r['last_name']);
    return [
      'id' => (int)$r['id'],
      'id_number' => (string)$r['id_number'],
      'name' => $name
    ];
  }, $rows);

  ok(['users' => $users]);
}

/* =========================
   GET ONE (view)
   ========================= */
if ($action === 'get') {
  $id = (int)($payload['id'] ?? 0);
  if ($id <= 0) err('Invalid announcement id.');

  $st = $pdo->prepare("
    SELECT
      a.*,
      o.org_name
    FROM announcements a
    LEFT JOIN organizations o ON o.id = a.org_id
    WHERE a.id = ?
    LIMIT 1
  ");
  $st->execute([$id]);
  $a = $st->fetch(PDO::FETCH_ASSOC);
  if (!$a) err('Announcement not found.', 404);

  if (!announcementIsVisibleToUser($pdo, $a, $user, $activeTermId)) {
    err('Not allowed to view this announcement.', 403);
  }

  $targetId = $a['target_user_id'] !== null ? (int)$a['target_user_id'] : null;
  $a['target_user_label'] = $targetId ? getUserLabel($pdo, $targetId) : null;
  $a['posted_by_president'] = isAnnouncementPostedByPresident($pdo, $a);

  $canEdit = canEditAnnouncement($pdo, $a, $user, $activeTermId);
  $canManage = canManageAnnouncement($pdo, $a, $user, $activeTermId);

  ok([
    'item' => $a,
    'can_edit' => $canEdit,
    'can_manage' => $canManage
  ]);
}

/* =========================
   LIST
   ========================= */
if ($action === 'list') {
  $status = (string)($payload['status'] ?? 'Active');
  $termId = (int)($payload['academic_term_id'] ?? $activeTermId);

  $officerOrgIds = getOfficerOrgIdsAllTerms($pdo, $userId);
  $isOfficer = count($officerOrgIds) > 0;
  $isStudentOnly = ($role === 'student' && !$isOfficer);

  if ($isStudentOnly) {
    $status = 'Active';
    $termId = $activeTermId;
  }

  $where = [];
  $bind  = [];

  $where[] = "a.academic_term_id = ?";
  $bind[]  = $termId;

  $where[] = "a.status = ?";
  $bind[]  = $status;

  if (!isPrivilegedRole($role)) {
    $adminOrgIds = getAdminOrgIds($pdo, $userId);

    if ($role === 'student' && !$isOfficer) {
      $where[] = "(a.org_id IS NULL OR a.org_id IN (
          SELECT org_id FROM organization_memberships
          WHERE student_user_id = ? AND academic_term_id = ? AND status='Approved'
        ))";
      $bind[] = $userId;
      $bind[] = $termId;
    } else {
      $visibleOrgIds = array_values(array_unique(array_merge($officerOrgIds, $adminOrgIds)));
      if ($visibleOrgIds) {
        $in = implode(',', array_fill(0, count($visibleOrgIds), '?'));
        $where[] = "(a.org_id IS NULL OR a.org_id IN ($in))";
        foreach ($visibleOrgIds as $oid) $bind[] = $oid;
      } else {
        $where[] = "(a.org_id IS NULL)";
      }
    }
  }

  if (!isPrivilegedRole($role)) {
    $where[] = "(a.target_user_id IS NULL OR a.target_user_id = ? OR a.created_by = ?)";
    $bind[] = $userId;
    $bind[] = $userId;
  }

  $sql = "
    SELECT
      a.id, a.org_id, a.academic_term_id, a.target_user_id,
      a.title, a.body, a.status,
      a.created_by, a.created_at,
      a.reviewed_by, a.reviewed_at, a.review_note,
      o.org_name
    FROM announcements a
    LEFT JOIN organizations o ON o.id = a.org_id
    WHERE " . implode(" AND ", $where) . "
    ORDER BY a.created_at DESC, a.id DESC
    LIMIT 200
  ";

  $st = $pdo->prepare($sql);
  $st->execute($bind);
  $rows = $st->fetchAll(PDO::FETCH_ASSOC);

  $rows = array_map(function(array $row) use ($pdo, $user, $activeTermId) {
    $row['can_manage'] = canManageAnnouncement($pdo, $row, $user, $activeTermId);
    $row['can_edit'] = canEditAnnouncement($pdo, $row, $user, $activeTermId);
    $row['posted_by_president'] = isAnnouncementPostedByPresident($pdo, $row);
    return $row;
  }, $rows);

  ok(['items' => $rows, 'term_id' => $termId, 'status' => $status, 'student_only' => $isStudentOnly]);
}

/* =========================
   CREATE
   ========================= */
if ($action === 'create') {
  $title = trim((string)($payload['title'] ?? ''));
  $body  = trim((string)($payload['body'] ?? ''));
  $termId = (int)($payload['academic_term_id'] ?? $activeTermId);

  if ($title === '' || $body === '') err('Title and body are required.');

  $orgId = $payload['org_id'] ?? null;
  $orgId = ($orgId === '' || $orgId === null) ? null : (int)$orgId;

  $targetUserId = null;
  if (array_key_exists('target_user_id', $payload)) {
    $targetUserId = resolveTargetUserId($pdo, $payload['target_user_id']);
  } else {
    $targetUserId = resolveTargetUserId($pdo, $payload['target_user'] ?? null);
  }

  if ($orgId === null) {
  if (!isPrivilegedRole($role)) {
    err('Only super_admin / special_admin / overseer can create GENERAL announcements.', 403);
    }
    $status = 'Active';
  } else {
    if (!isPrivilegedRole($role)) {
      // IMPORTANT: use all active officer assignments, not only active term
      $officerOrgIds = getOfficerOrgIdsAllTerms($pdo, $userId);

      if (!in_array($orgId, $officerOrgIds, true)) {
        $adminOrgIds = getAdminOrgIds($pdo, $userId);

        if (!in_array($orgId, $adminOrgIds, true)) {
          err('You can only post announcements for your assigned organization.', 403);
        }
      }
    }

    $status = 'Pending';
  }

  $st = $pdo->prepare("
    INSERT INTO announcements (org_id, academic_term_id, target_user_id, title, body, status, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  ");
  $st->execute([$orgId, $termId, $targetUserId, $title, $body, $status, $userId]);
  $newId = (int)$pdo->lastInsertId();

  if ($status === 'Active') {
    pushAnnouncementNotifications($pdo, $newId);
  }

  $createdRow = [
    'org_id' => $orgId,
    'academic_term_id' => $termId,
    'created_by' => $userId,
  ];

  ok([
    'id' => $newId,
    'status' => $status,
    'posted_by_president' => ($orgId !== null ? isAnnouncementPostedByPresident($pdo, $createdRow) : false)
  ]);
}

/* =========================
   UPDATE (edit)
   ========================= */
if ($action === 'update') {
  $id = (int)($payload['id'] ?? 0);
  if ($id <= 0) err('Invalid announcement id.');

  $st = $pdo->prepare("SELECT * FROM announcements WHERE id=? LIMIT 1");
  $st->execute([$id]);
  $a = $st->fetch(PDO::FETCH_ASSOC);
  if (!$a) err('Announcement not found.', 404);

  if (!announcementIsVisibleToUser($pdo, $a, $user, $activeTermId)) {
    err('Not allowed to view this announcement.', 403);
  }

  if (!canEditAnnouncement($pdo, $a, $user, $activeTermId)) {
    err('Not allowed to edit this announcement.', 403);
  }

  $title = trim((string)($payload['title'] ?? $a['title']));
  $body  = trim((string)($payload['body'] ?? $a['body']));
  if ($title === '' || $body === '') err('Title and body are required.');

  $targetUserId = null;
  if (array_key_exists('target_user_id', $payload)) {
    $targetUserId = resolveTargetUserId($pdo, $payload['target_user_id']);
  } else {
    $targetUserId = resolveTargetUserId($pdo, $payload['target_user'] ?? null);
  }

  $upd = $pdo->prepare("
    UPDATE announcements
    SET title = ?, body = ?, target_user_id = ?
    WHERE id = ?
  ");
  $upd->execute([$title, $body, $targetUserId, $id]);

  ok(['id' => $id]);
}

/* =========================
   SET STATUS (accept/decline/archive)
   ========================= */
if ($action === 'set_status') {
  $id = (int)($payload['id'] ?? 0);
  $newStatus = (string)($payload['status'] ?? '');

  if ($id <= 0) err('Invalid announcement id.');
  if (!in_array($newStatus, ['Active','Declined','Archived'], true)) err('Invalid status.');

  $st = $pdo->prepare("SELECT id, org_id, status, academic_term_id, target_user_id, title, body, created_by FROM announcements WHERE id=? LIMIT 1");
  $st->execute([$id]);
  $a = $st->fetch(PDO::FETCH_ASSOC);
  if (!$a) err('Announcement not found.', 404);

  if (!announcementIsVisibleToUser($pdo, $a, $user, $activeTermId)) {
    err('Not allowed to view this announcement.', 403);
  }

  $orgId = $a['org_id'] !== null ? (int)$a['org_id'] : null;
  $oldStatus = (string)$a['status'];

  if (!canManageAnnouncement($pdo, $a, $user, $activeTermId)) {
    if ($orgId === null) {
      err('Only privileged roles can manage GENERAL announcements.', 403);
    }

    if (isAnnouncementPostedByPresident($pdo, $a)) {
      err('This announcement requires faculty_admin approval only.', 403);
    }

    err('You are not allowed to manage this announcement.', 403);
  }

  $note = trim((string)($payload['note'] ?? ''));

  $upd = $pdo->prepare("
    UPDATE announcements
    SET status = ?, reviewed_by = ?, reviewed_at = NOW(), review_note = ?
    WHERE id = ?
  ");
  $upd->execute([$newStatus, $userId, ($note !== '' ? $note : null), $id]);

  if ($newStatus === 'Active' && $oldStatus !== 'Active') {
    pushAnnouncementNotifications($pdo, $id);
  }

  ok(['id' => $id, 'status' => $newStatus]);
}

err('Unknown action.');