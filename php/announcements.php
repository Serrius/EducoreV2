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
  return in_array($role, ['super_admin', 'special_admin', 'overseer'], true);
}

function getActiveTermId(PDO $pdo): ?int {
  $st = $pdo->query("SELECT id FROM academic_terms WHERE status='Active' ORDER BY id DESC LIMIT 1");
  $row = $st ? $st->fetch(PDO::FETCH_ASSOC) : null;
  return $row ? (int)$row['id'] : null;
}

function getUser(PDO $pdo, int $userId): array {
  $st = $pdo->prepare("
    SELECT id, id_number, first_name, last_name, role, status, program 
    FROM users 
    WHERE id=? 
    LIMIT 1
  ");
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
  if ($raw === null || $raw === '') return null;

  if (is_int($raw)) {
    if ($raw <= 0) return null;
    $st = $pdo->prepare("SELECT id FROM users WHERE id=? LIMIT 1");
    $st->execute([$raw]);
    $r = $st->fetch(PDO::FETCH_ASSOC);
    if (!$r) err('Target user not found.', 404);
    return (int)$r['id'];
  }

  if (is_string($raw)) {
    $q = trim($raw);
    if ($q === '') return null;

    if (ctype_digit($q)) {
      $st = $pdo->prepare("SELECT id FROM users WHERE id = ? LIMIT 1");
      $st->execute([(int)$q]);
      $r = $st->fetch(PDO::FETCH_ASSOC);
      if ($r) return (int)$r['id'];
    }

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

/**
 * Get organization members for a specific org and term
 * Works for both clubs and organizations
 */
function getOrganizationMembers(PDO $pdo, int $orgId, int $termId): array {
  $st = $pdo->prepare("
    SELECT DISTINCT student_user_id AS uid
    FROM organization_memberships
    WHERE org_id = ?
      AND academic_term_id = ?
      AND status = 'Approved'
  ");
  $st->execute([$orgId, $termId]);
  return array_map('intval', array_column($st->fetchAll(PDO::FETCH_ASSOC), 'uid'));
}

/**
 * Get users by program
 */
function getUsersByProgram(PDO $pdo, string $program): array {
  $st = $pdo->prepare("
    SELECT id FROM users 
    WHERE program = ? 
      AND status = 'Active'
  ");
  $st->execute([$program]);
  return array_map('intval', array_column($st->fetchAll(PDO::FETCH_ASSOC), 'id'));
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
  $userProgram = (string)($me['program'] ?? '');

  // Privileged can see all
  if (isPrivilegedRole($role) || $role === 'super_admin') return true;

  $termId = (int)$a['academic_term_id'];
  $orgId  = $a['org_id'] !== null ? (int)$a['org_id'] : null;
  $target = $a['target_user_id'] !== null ? (int)$a['target_user_id'] : null;
  $targetProgram = $a['target_program'] ?? null;

  // Creator should always see their own announcement
  if ((int)$a['created_by'] === $userId) return true;

  // GENERAL ANNOUNCEMENTS (no org) - ALL ACTIVE STUDENTS CAN SEE THEM
  if ($orgId === null) {
    // Only show active announcements to students
    if ($role === 'student') {
      return (string)$a['status'] === 'Active';
    }
    return true;
  }

  // Targeted announcements: only the target user can see
  if ($target !== null && $target !== $userId) return false;

  // Program-targeted announcements
  if ($targetProgram !== null && $targetProgram !== $userProgram) return false;

  // For non-active term, only show to privileged users
  if ($termId !== $activeTermId && !isPrivilegedRole($role) && $role !== 'super_admin') return false;

  // Get organization details to check if it's exclusive and what program it's tied to
  $st = $pdo->prepare("
    SELECT scope, program_id, org_type 
    FROM organizations 
    WHERE id = ? 
    LIMIT 1
  ");
  $st->execute([$orgId]);
  $org = $st->fetch(PDO::FETCH_ASSOC);
  
  if ($org) {
    // For EXCLUSIVE organizations, check if student's program matches
    if ($org['scope'] === 'Exclusive' && $org['program_id'] !== null) {
      // Get program abbreviation to compare with student's program
      $stProg = $pdo->prepare("SELECT abbreviation FROM programs WHERE id = ? LIMIT 1");
      $stProg->execute([$org['program_id']]);
      $program = $stProg->fetch(PDO::FETCH_ASSOC);
      
      // If student's program matches the exclusive organization's program, they can see it
      if ($program && $userProgram === $program['abbreviation']) {
        return true;
      }
    }
    
    // For clubs (org_type = 'Club'), all students can see announcements
    if ($org['org_type'] === 'Club') {
      return true;
    }
  }

  // Check if user is a member of the organization
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
  if ($st->fetchColumn()) return true;

  // Check if user is an officer of the organization
  $st = $pdo->prepare("
    SELECT 1
    FROM organization_officers
    WHERE user_id = ?
      AND academic_term_id = ?
      AND org_id = ?
      AND status = 'Active'
    LIMIT 1
  ");
  $st->execute([$userId, $termId, $orgId]);
  if ($st->fetchColumn()) return true;

  return false;
}

function canManageAnnouncement(PDO $pdo, array $a, array $me, int $activeTermId): bool {
  $role   = (string)$me['role'];
  $userId = (int)$me['id'];

  $orgId = $a['org_id'] !== null ? (int)$a['org_id'] : null;

  // SUPER ADMIN can manage ALL announcements
  if ($role === 'super_admin') return true;

  // GENERAL announcements remain privileged-only (excluding super_admin handled above)
  if ($orgId === null) {
    return in_array($role, ['special_admin', 'overseer'], true);
  }

  // If the org announcement was posted by the President/Chairperson
  // only faculty_admin may manage it
  if (isAnnouncementPostedByPresident($pdo, $a)) {
    if ($role !== 'faculty_admin') {
      return false;
    }

    $adminOrgIds = getAdminOrgIds($pdo, $userId);
    return in_array($orgId, $adminOrgIds, true);
  }

  // Non-president org announcements:
  if (in_array($role, ['special_admin', 'overseer'], true)) return true;

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

  if (isPrivilegedRole($role) || $role === 'super_admin') return true;

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
  $st = $pdo->prepare("
    SELECT id, org_id, academic_term_id, target_user_id, target_program, 
           title, body, created_by 
    FROM announcements 
    WHERE id=? LIMIT 1
  ");
  $st->execute([$announcementId]);
  $a = $st->fetch(PDO::FETCH_ASSOC);
  if (!$a) return;

  $title = (string)$a['title'];
  $msg   = (string)$a['body'];
  $actor = (int)$a['created_by'];
  $orgId = $a['org_id'] !== null ? (int)$a['org_id'] : null;
  $termId = (int)$a['academic_term_id'];
  $target = $a['target_user_id'] !== null ? (int)$a['target_user_id'] : null;
  $targetProgram = $a['target_program'] ?? null;

  $recipientIds = [];

  if ($target !== null) {
    $recipientIds = [$target];
  } elseif ($targetProgram !== null) {
    // Target by program
    $recipientIds = getUsersByProgram($pdo, $targetProgram);
  } elseif ($orgId !== null) {
    // Get organization members (works for both clubs and orgs)
    $recipientIds = getOrganizationMembers($pdo, $orgId, $termId);
    
    // Also get officers
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
    // General announcement to all active users
    $st3 = $pdo->query("SELECT id FROM users WHERE status='Active'");
    $recipientIds = array_map('intval', array_column($st3->fetchAll(PDO::FETCH_ASSOC), 'id'));
  }

  $recipientIds = array_values(array_unique(array_filter($recipientIds, fn($v) => $v > 0 && $v !== $actor)));
  if (!$recipientIds) return;

  $ins = $pdo->prepare("
    INSERT INTO notifications (recipient_id, actor_id, title, message, notif_type, status, payload_id)
    VALUES (?, ?, ?, ?, 'announcement', 'unread', ?)
  ");

  foreach ($recipientIds as $rid) {
    $ins->execute([$rid, $actor, $title, $msg, $announcementId]);
  }
}

// ... (keep all your existing helper functions like pushNotification, getSpecialAdminIds, etc.)

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

// ... (keep your accreditation_reupload_doc action)

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
    $role === 'super_admin' ||
    isPrivilegedRole($role) ||
    $role === 'faculty_admin' ||
    count($officerOrgIds) > 0 ||
    count($adminOrgIds) > 0;

  // Determine if user should see limited view (only active announcements)
  // TRUE only for regular students with no officer/admin roles
  $isStudentOnly = ($role === 'student' && count($officerOrgIds) === 0 && count($adminOrgIds) === 0);

  ok([
    'user' => [
      'id' => (int)$user['id'],
      'id_number' => (string)$user['id_number'],
      'name' => trim($user['first_name'] . ' ' . $user['last_name']),
      'role' => $role,
      'program' => (string)($user['program'] ?? ''),
    ],
    'active_term_id' => $activeTermId,
    'is_privileged' => isPrivilegedRole($role) || $role === 'super_admin',
    'officer_org_ids' => $officerOrgIds,
    'admin_org_ids' => $adminOrgIds,
    'can_post_announcements' => $canPostAnnouncements,
    'is_student_only' => $isStudentOnly // Add this flag
  ]);
}

/* =========================
   ORG OPTIONS for dropdown
   ========================= */
if ($action === 'org_options') {
  $officerOrgIds = getOfficerOrgIdsAllTerms($pdo, $userId);
  $adminOrgIds   = getAdminOrgIds($pdo, $userId);

  $canGeneral = isPrivilegedRole($role) || $role === 'super_admin';

  if ($canGeneral) {
    $st = $pdo->query("
      SELECT id, org_name, org_type
      FROM organizations
      WHERE status = 'Active'
      ORDER BY org_name ASC
    ");
    $rows = $st ? $st->fetchAll(PDO::FETCH_ASSOC) : [];

    $options = array_map(function ($r) {
      return [
        'id' => (int)$r['id'],
        'name' => (string)$r['org_name'],
        'type' => (string)$r['org_type']
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
    SELECT id, org_name, org_type
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
      'type' => (string)$r['org_type']
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
    SELECT id, id_number, first_name, last_name, program
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
      'name' => $name,
      'program' => (string)($r['program'] ?? '')
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
      o.org_name,
      o.org_type
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
   LIST - FIXED VISIBILITY FOR STUDENTS AND OFFICERS
   ========================= */
if ($action === 'list') {
  $status = (string)($payload['status'] ?? 'Active');
  $termId = (int)($payload['academic_term_id'] ?? $activeTermId);
  
  // Get user's officer and admin orgs
  $officerOrgIds = getOfficerOrgIdsAllTerms($pdo, $userId);
  $adminOrgIds = getAdminOrgIds($pdo, $userId);
  $visibleOrgIds = array_values(array_unique(array_merge($officerOrgIds, $adminOrgIds)));
  
  // Check if user is a regular student (no officer/admin roles)
  $isRegularStudent = ($role === 'student' && empty($visibleOrgIds));

  // For regular students, only show active announcements
  if ($isRegularStudent) {
    $status = 'Active';
  }

  $where = [];
  $bind  = [];

  $where[] = "a.academic_term_id = ?";
  $bind[]  = $termId;

  $where[] = "a.status = ?";
  $bind[]  = $status;

  // Build visibility conditions based on user role
  $visibilityConditions = [];
  
  // Condition 1: User is the creator
  $visibilityConditions[] = "(a.created_by = ?)";
  $bind[] = $userId;
  
  // Condition 2: User is the target (for targeted announcements)
  $visibilityConditions[] = "(a.target_user_id = ?)";
  $bind[] = $userId;
  
  // Condition 3: General announcements (no org)
  $visibilityConditions[] = "(a.org_id IS NULL AND a.target_user_id IS NULL)";
  
  // Condition 4: Organization announcements (for org members/officers)
  if (!empty($visibleOrgIds)) {
    $in = implode(',', array_fill(0, count($visibleOrgIds), '?'));
    $visibilityConditions[] = "(a.org_id IN ($in) AND a.target_user_id IS NULL)";
    foreach ($visibleOrgIds as $oid) $bind[] = $oid;
  }
  
  // For regular students only - add program-based visibility
  if ($isRegularStudent && !empty($user['program'])) {
    // EXCLUSIVE ORGANIZATIONS - students from matching program
    $visibilityConditions[] = "(a.org_id IN (SELECT o.id FROM organizations o LEFT JOIN programs p ON p.id = o.program_id WHERE o.scope = 'Exclusive' AND p.abbreviation = ?) AND a.target_user_id IS NULL)";
    $bind[] = $user['program'];
    
    // Program-targeted announcements
    $visibilityConditions[] = "(a.target_program = ?)";
    $bind[] = $user['program'];
  }
  
  // For regular students only - club announcements (all students can see)
  if ($isRegularStudent) {
    $visibilityConditions[] = "(a.org_id IN (SELECT id FROM organizations WHERE org_type = 'Club') AND a.target_user_id IS NULL)";
  }
  
  // For privileged roles - they can see all non-targeted announcements
  if (isPrivilegedRole($role) || $role === 'super_admin') {
    // Remove the "target_user_id IS NULL" restriction for privileged users?
    // Actually, we should still respect targeting for privileged users too
    // But add a condition for all non-targeted org announcements
    $visibilityConditions[] = "(a.org_id IS NOT NULL AND a.target_user_id IS NULL)";
  }

  // Combine all visibility conditions with OR
  $where[] = "(" . implode(" OR ", array_unique($visibilityConditions)) . ")";

  $sql = "
    SELECT
      a.id, a.org_id, a.academic_term_id, a.target_user_id, a.target_program,
      a.title, a.body, a.status,
      a.created_by, a.created_at,
      a.reviewed_by, a.reviewed_at, a.review_note,
      o.org_name, o.org_type, o.scope, o.program_id
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

  ok(['items' => $rows, 'term_id' => $termId, 'status' => $status]);
}

/* =========================
   CREATE - ADD PROGRAM TARGETING
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
  
  $targetProgram = $payload['target_program'] ?? null;
  if ($targetProgram === '') $targetProgram = null;

  // Validate targeting
  if ($targetUserId !== null && $targetProgram !== null) {
    err('Cannot target both specific user and program.', 400);
  }

  if ($orgId === null) {
    if (!isPrivilegedRole($role) && $role !== 'super_admin') {
      err('Only super_admin / special_admin / overseer can create GENERAL announcements.', 403);
    }
    $status = 'Active';
  } else {
    if (!isPrivilegedRole($role) && $role !== 'super_admin') {
      $officerOrgIds = getOfficerOrgIdsAllTerms($pdo, $userId);
      $adminOrgIds = getAdminOrgIds($pdo, $userId);

      if (!in_array($orgId, $officerOrgIds, true) && !in_array($orgId, $adminOrgIds, true)) {
        err('You can only post announcements for your assigned organization.', 403);
      }
    }
    $status = 'Pending';
  }

  $st = $pdo->prepare("
    INSERT INTO announcements (org_id, academic_term_id, target_user_id, target_program, title, body, status, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  ");
  $st->execute([$orgId, $termId, $targetUserId, $targetProgram, $title, $body, $status, $userId]);
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

// ... (keep your UPDATE and SET_STATUS actions)

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
// Add database schema update to support program targeting
// Run this SQL in your database:
/*
ALTER TABLE announcements 
ADD COLUMN target_program varchar(50) DEFAULT NULL AFTER target_user_id,
ADD INDEX idx_target_program (target_program);
*/

err('Unknown action.');