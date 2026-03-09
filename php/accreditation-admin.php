<?php
/**
 * php/accreditation-admin.php
 *
 * Admin Accreditation Endpoint (JSON only)
 *
 * Supports the Admin injected page JS modules:
 * - list_terms
 * - list_programs
 * - admin_can_submit
 * - list_requests (mode: pending|active|returned)
 * - list_requirements_for_upload
 * - submit_request (multipart)
 * - get_request (with docs pagination)
 * - replace_document (multipart)
 * - update_organization (JSON)
 * - search_students (JSON)
 * - add_officer (JSON)
 * - check_accreditation_status (NEW)
 * - start_renewal (NEW)
 *
 * NOTE:
 * - This file intentionally outputs JSON ONLY (no HTML).
 * - It is designed to be robust to different db include styles:
 *   - If php/db.php exists and provides $pdo (PDO), it will use it.
 *   - Otherwise it will attempt to create a PDO connection using XAMPP defaults.
 */

// -----------------------------
// JSON output helpers
// -----------------------------
header("Content-Type: application/json; charset=utf-8");

function out($arr, $status = 200) {
  http_response_code($status);
  echo json_encode($arr, JSON_UNESCAPED_SLASHES);
  exit;
}

function fail($msg, $status = 400, $extra = []) {
  out(array_merge(["ok" => false, "error" => $msg], $extra), $status);
}

// -----------------------------
// Session / auth (adjust to your system if needed)
// -----------------------------
if (session_status() === PHP_SESSION_NONE) session_start();

/**
 * Try common session keys:
 * - $_SESSION['user_id']
 * - $_SESSION['user']['id']
 */
function current_user_id() {
  if (!empty($_SESSION["user_id"])) return (int)$_SESSION["user_id"];
  if (!empty($_SESSION["user"]) && !empty($_SESSION["user"]["id"])) return (int)$_SESSION["user"]["id"];
  return 0;
}

function require_login() {
  $uid = current_user_id();
  if ($uid <= 0) fail("Unauthorized. Please login again.", 401);
  return $uid;
}

// -----------------------------
// DB bootstrap (PDO preferred)
// -----------------------------
$pdo = null;

// If you already have a db bootstrap file, keep it here:
$tryDb = __DIR__ . "/db.php";
if (file_exists($tryDb)) {
  require_once $tryDb;
  if (isset($pdo) && $pdo instanceof PDO) {
    // ok
  }
}

if (!($pdo instanceof PDO)) {
  // fallback connection (XAMPP defaults)
  $DB_HOST = "127.0.0.1";
  $DB_NAME = "educorev2";
  $DB_USER = "root";
  $DB_PASS = "";

  try {
    $pdo = new PDO(
      "mysql:host={$DB_HOST};dbname={$DB_NAME};charset=utf8mb4",
      $DB_USER,
      $DB_PASS,
      [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
      ]
    );
  } catch (Throwable $e) {
    fail("Database connection failed: " . $e->getMessage(), 500);
  }
}

// -----------------------------
// Small helpers
// -----------------------------
function read_json_body() {
  $raw = file_get_contents("php://input");
  if (!$raw) return [];
  $data = json_decode($raw, true);
  if (!is_array($data)) return [];
  return $data;
}

function is_assoc($arr) {
  if (!is_array($arr)) return false;
  return array_keys($arr) !== range(0, count($arr) - 1);
}

function safe_filename($name) {
  $name = preg_replace('/[^\w\-. ]+/u', "_", (string)$name);
  $name = trim($name);
  if ($name === "") $name = "file";
  return $name;
}

function ensure_dir($path) {
  if (!is_dir($path)) {
    if (!mkdir($path, 0775, true)) return false;
  }
  return true;
}

function now_dt() {
  return date("Y-m-d H:i:s");
}

// URL/path: keep RELATIVE (no leading slash) to avoid your "/assets/..." issue
function to_public_path($relative) {
  $relative = ltrim((string)$relative, "/");
  return $relative;
}

// -----------------------------
// Business helpers
// -----------------------------
function get_user($pdo, $uid) {
  $st = $pdo->prepare("SELECT id, id_number, role, status, first_name, last_name FROM users WHERE id = ?");
  $st->execute([(int)$uid]);
  return $st->fetch();
}

function require_admin_role($user) {
  // Adjust this list if your "admin" role name differs.
  $allowed = ["faculty_admin"];
  if (!$user || !in_array((string)$user["role"], $allowed, true)) {
    fail("Forbidden: admin role required.", 403);
  }
  if (strcasecmp((string)$user["status"], "Active") !== 0) {
    fail("Forbidden: account not active.", 403);
  }
}

function active_term($pdo) {
  $st = $pdo->query("SELECT * FROM academic_terms ORDER BY (status='Active') DESC, id DESC LIMIT 1");
  $t = $st->fetch();
  return $t ?: null;
}

function term_label($t) {
  if (!$t) return "—";
  $sy = $t["school_year"] ?? "";
  $sem = $t["semester"] ?? "";
  $label = trim((string)$sy . " • " . (string)$sem);
  return $label ?: ("Term #" . ($t["id"] ?? ""));
}

/**
 * IMPORTANT: users.program stores ABBREVIATION (e.g. "BSIT"), not programs.id
 * So for student search filters we must filter using abbreviation.
 */
function program_abbr_by_id($pdo, $programId) {
  $programId = (int)$programId;
  if ($programId <= 0) return null;
  $st = $pdo->prepare("SELECT abbreviation FROM programs WHERE id = ? LIMIT 1");
  $st->execute([$programId]);
  $abbr = $st->fetchColumn();
  $abbr = $abbr ? trim((string)$abbr) : null;
  return $abbr ?: null;
}

function map_scope_for_db($uiScope, $orgType) {
  // organizations.scope enum is (General, Exclusive).
  // Clubs are always stored as scope='General' in DB.
  $uiScope = (string)$uiScope;
  $orgType = (string)$orgType;

  if (strcasecmp($orgType, "Club") === 0) return "General";
  if (strcasecmp($uiScope, "Exclusive") === 0) return "Exclusive";
  return "General";
}

function scope_label_for_ui($orgType, $orgScope) {
  if (strcasecmp((string)$orgType, "Club") === 0) return "Club";
  return (string)$orgScope;
}

// requirement filter mapping using accreditation_requirements.applies_to enum('General','Exclusive','Club','All')
function requirement_applies_filter($uiScope, $orgType) {
  $uiScope = (string)$uiScope;
  $orgType = (string)$orgType;

  if (strcasecmp($orgType, "Club") === 0) return ["Club", "All"];
  if (strcasecmp($uiScope, "Club") === 0) return ["Club", "All"];

  if (strcasecmp($uiScope, "Exclusive") === 0) return ["Exclusive", "All"];
  return ["General", "All"];
}

// Check if organization can be edited (based on request status)
function can_edit_organization($requestStatus) {
  $editableStatuses = ['Active', 'Returned', 'Recommended', 'Pending', 'Draft'];
  return in_array((string)$requestStatus, $editableStatuses, true);
}

// Helper function to get active Special Admin (handles missing last_login_at)
function get_active_special_admin($pdo) {
  try {
    $st = $pdo->prepare("SELECT id FROM users WHERE role = 'special_admin' AND status = 'Active' ORDER BY last_login_at DESC LIMIT 1");
    $st->execute();
    $admin = $st->fetch();
    if ($admin) return (int)$admin["id"];
  } catch (Throwable $e) {
    // ignore and fallback
  }
  $st = $pdo->prepare("SELECT id FROM users WHERE role = 'special_admin' AND status = 'Active' ORDER BY id DESC LIMIT 1");
  $st->execute();
  $admin = $st->fetch();
  return $admin ? (int)$admin["id"] : null;
}

// Helper function to add notification
function add_notification($pdo, $recipient_id, $actor_id, $title, $message, $notif_type = 'accreditation', $payload_id = null) {
  $st = $pdo->prepare("
    INSERT INTO notifications (recipient_id, actor_id, title, message, notif_type, status, payload_id, created_at)
    VALUES (?, ?, ?, ?, ?, 'unread', ?, NOW())
  ");
  $st->execute([(int)$recipient_id, (int)$actor_id, (string)$title, (string)$message, (string)$notif_type, $payload_id]);
  return (int)$pdo->lastInsertId();
}

// -----------------------------
// Renewal-specific helpers (SCHOOL_YEAR based)
// -----------------------------
function active_term_info($pdo) {
  $t = active_term($pdo);
  if (!$t) return null;
  return [
    "id" => (int)($t["id"] ?? 0),
    "school_year" => (string)($t["school_year"] ?? ""),
    "semester" => (string)($t["semester"] ?? ""),
    "raw" => $t,
  ];
}

function get_request_in_school_year($pdo, $uid, $schoolYear) {
  $st = $pdo->prepare("
    SELECT ar.id, ar.status, ar.org_id, ar.is_renewal, ar.previous_request_id
    FROM accreditation_requests ar
    JOIN academic_terms t ON t.id = ar.academic_term_id
    WHERE ar.coordinator_user_id = ?
      AND t.school_year = ?
    ORDER BY ar.id DESC
    LIMIT 1
  ");
  $st->execute([(int)$uid, (string)$schoolYear]);
  return $st->fetch() ?: null;
}

function check_pending_renewals_school_year($pdo, $uid, $schoolYear) {
  $st = $pdo->prepare("
    SELECT COUNT(*) as count
    FROM accreditation_requests ar
    JOIN academic_terms t ON t.id = ar.academic_term_id
    WHERE ar.coordinator_user_id = ?
      AND t.school_year = ?
      AND ar.status IN ('Draft', 'Pending')
      AND ar.is_renewal = 1
  ");
  $st->execute([(int)$uid, (string)$schoolYear]);
  return ((int)$st->fetchColumn()) > 0;
}

function get_accreditation_in_school_year($pdo, $uid, $schoolYear, $excludeTermId = 0) {
  $excludeTermId = (int)$excludeTermId;

  $sql = "
    SELECT ar.id, ar.status, ar.org_id, ar.submitted_at,
           o.org_name, o.org_type, o.abbreviation,
           at.id AS academic_term_id, at.school_year, at.semester
    FROM accreditation_requests ar
    JOIN organizations o ON o.id = ar.org_id
    JOIN academic_terms at ON at.id = ar.academic_term_id
    WHERE ar.coordinator_user_id = ?
      AND at.school_year = ?
      AND ar.status IN ('Active', 'Approved')
  ";
  $params = [(int)$uid, (string)$schoolYear];

  if ($excludeTermId > 0) {
    $sql .= " AND ar.academic_term_id <> ? ";
    $params[] = $excludeTermId;
  }

  $sql .= " ORDER BY ar.id DESC LIMIT 1 ";

  $st = $pdo->prepare($sql);
  $st->execute($params);
  return $st->fetch() ?: null;
}

function get_latest_accredited_request_any_year($pdo, $uid, $excludeTermId = 0) {
  $excludeTermId = (int)$excludeTermId;

  $sql = "
    SELECT ar.id, ar.status, ar.org_id, ar.submitted_at,
           o.org_name, o.org_type, o.abbreviation,
           at.id AS academic_term_id, at.school_year, at.semester
    FROM accreditation_requests ar
    JOIN organizations o ON o.id = ar.org_id
    JOIN academic_terms at ON at.id = ar.academic_term_id
    WHERE ar.coordinator_user_id = ?
      AND ar.status IN ('Active', 'Approved')
  ";
  $params = [(int)$uid];

  if ($excludeTermId > 0) {
    $sql .= " AND ar.academic_term_id <> ? ";
    $params[] = $excludeTermId;
  }

  $sql .= " ORDER BY at.school_year DESC, at.id DESC, ar.id DESC LIMIT 1 ";

  $st = $pdo->prepare($sql);
  $st->execute($params);
  return $st->fetch() ?: null;
}

// -----------------------------
// Read action (JSON or multipart)
// -----------------------------
$payload = [];
$action = "";

if ($_SERVER["REQUEST_METHOD"] === "POST") {
  if (!empty($_POST["action"])) {
    $action = (string)$_POST["action"];
    $payload = $_POST;
  } else {
    $payload = read_json_body();
    $action = (string)($payload["action"] ?? "");
  }
} else {
  fail("Method not allowed.", 405);
}

$uid = require_login();
$user = get_user($pdo, $uid);
require_admin_role($user);

// -----------------------------
// ROUTER
// -----------------------------
try {
  switch ($action) {

    // -----------------------------------------
    // 1) Terms
    // -----------------------------------------
    case "list_terms": {
      $terms = $pdo->query("SELECT id, school_year, semester, status, created_at FROM academic_terms ORDER BY id DESC")->fetchAll();
      $active = null;
      foreach ($terms as $t) {
        if (strcasecmp((string)$t["status"], "Active") === 0) { $active = $t; break; }
      }
      if (!$active) $active = active_term($pdo);

      foreach ($terms as &$t) {
        $t["label"] = term_label($t);
      }

      out([
        "ok" => true,
        "terms" => $terms,
        "active_term_id" => $active ? (int)$active["id"] : null,
        "active_term" => $active ? array_merge($active, ["label" => term_label($active)]) : null,
      ]);
    }

    // -----------------------------------------
    // 2) Programs
    // -----------------------------------------
    case "list_programs": {
      $st = $pdo->query("SELECT id, program_name, abbreviation AS program_abbr, status FROM programs WHERE status <> 'Archived' ORDER BY program_name ASC");
      out(["ok" => true, "items" => $st->fetchAll()]);
    }

    // -----------------------------------------
    // 3) One-org rule check (SCHOOL_YEAR based)
    // -----------------------------------------
    case "admin_can_submit":
    case "can_submit":
    case "my_request":
    case "get_my_request": {
      $currentTerm = active_term($pdo);
      if (!$currentTerm) fail("No active academic term found.");

      $schoolYear = (string)($currentTerm["school_year"] ?? "");
      if ($schoolYear === "") fail("Active term missing school_year.", 500);

      $existing = get_request_in_school_year($pdo, $uid, $schoolYear);
      if ($existing) {
        out([
          "ok" => true,
          "can_submit" => false,
          "my_request_id" => (int)$existing["id"],
          "request" => [
            "id" => (int)$existing["id"],
            "status" => (string)$existing["status"],
            "is_renewal" => (bool)$existing["is_renewal"],
            "previous_request_id" => $existing["previous_request_id"],
            "org_id" => (int)$existing["org_id"],
          ],
          "has_current_school_year_request" => true,
          "school_year" => $schoolYear
        ]);
      }

      $pendingRenewals = check_pending_renewals_school_year($pdo, $uid, $schoolYear);

      out([
        "ok" => true,
        "can_submit" => !$pendingRenewals,
        "my_request_id" => null,
        "request" => null,
        "has_current_school_year_request" => false,
        "has_pending_renewal" => $pendingRenewals,
        "school_year" => $schoolYear
      ]);
    }

    // -----------------------------------------
    // NEW: Check accreditation status for renewal (SCHOOL_YEAR-BASED)
    // -----------------------------------------
    case "check_accreditation_status": {
      $info = active_term_info($pdo);
      if (!$info) fail("No active academic term found.");

      $termId = (int)$info["id"];
      $schoolYear = (string)$info["school_year"];

      // 1) If user already has a request in CURRENT school year, no renewal prompt.
      $currentRequest = get_request_in_school_year($pdo, $uid, $schoolYear);
      if ($currentRequest) {
        out([
          "ok" => true,
          "has_current_term_request" => true,
          "current_request" => $currentRequest,
          "active_term" => $info["raw"],
          "needs_renewal" => false,
          "reason" => "Has request for active school year."
        ]);
      }

      // 2) If user has an accredited request (Active/Approved) within SAME school_year, do NOT prompt renewal.
      if ($schoolYear !== "") {
        $sameYearAcc = get_accreditation_in_school_year($pdo, $uid, $schoolYear, $termId);
        if ($sameYearAcc) {
          out([
            "ok" => true,
            "has_current_term_request" => false,
            "active_term" => $info["raw"],
            "needs_renewal" => false,
            "has_accreditation_same_school_year" => true,
            "accredited_request_same_school_year" => $sameYearAcc,
            "reason" => "Already accredited within the active school year (no renewal needed just because semester/term changed)."
          ]);
        }
      }

      // 3) Otherwise: look for latest accredited request in any previous school year → renewal needed.
      $previousRequest = get_latest_accredited_request_any_year($pdo, $uid, $termId);
      if ($previousRequest) {
        out([
          "ok" => true,
          "has_current_term_request" => false,
          "previous_request" => $previousRequest,
          "active_term" => $info["raw"],
          "needs_renewal" => true
        ]);
      }

      // 4) No previous accreditation at all
      out([
        "ok" => true,
        "has_current_term_request" => false,
        "needs_renewal" => false,
        "active_term" => $info["raw"]
      ]);
    }

    // -----------------------------------------
    // NEW: Start renewal process
    // -----------------------------------------
    case "start_renewal": {
      $previousRequestId = (int)($payload["previous_request_id"] ?? 0);
      $newTermId = (int)($payload["new_term_id"] ?? 0);

      if ($previousRequestId <= 0 || $newTermId <= 0) fail("Invalid request or term.");

      // Verify user owns the previous request
      $st = $pdo->prepare("
        SELECT ar.*, o.*
        FROM accreditation_requests ar
        JOIN organizations o ON o.id = ar.org_id
        WHERE ar.id = ? AND ar.coordinator_user_id = ?
        LIMIT 1
      ");
      $st->execute([$previousRequestId, $uid]);
      $previous = $st->fetch();

      if (!$previous) fail("Previous accreditation not found.", 404);

      // Prevent renewal within the same school year
      $st = $pdo->prepare("
        SELECT t.school_year
        FROM accreditation_requests ar
        JOIN academic_terms t ON t.id = ar.academic_term_id
        WHERE ar.id = ?
        LIMIT 1
      ");
      $st->execute([$previousRequestId]);
      $prevSY = (string)($st->fetchColumn() ?? "");

      $st = $pdo->prepare("SELECT school_year FROM academic_terms WHERE id = ? LIMIT 1");
      $st->execute([$newTermId]);
      $newSY = (string)($st->fetchColumn() ?? "");

      if ($prevSY !== "" && $newSY !== "" && $prevSY === $newSY) {
        fail("Renewal is only allowed when the school year changes. You already have accreditation for {$prevSY}.", 400);
      }

      // Check if renewal already exists for new school year
      $st = $pdo->prepare("
        SELECT ar.id
        FROM accreditation_requests ar
        JOIN academic_terms t ON t.id = ar.academic_term_id
        WHERE ar.coordinator_user_id = ?
          AND t.school_year = (SELECT school_year FROM academic_terms WHERE id = ?)
          AND ar.previous_request_id = ?
        LIMIT 1
      ");
      $st->execute([$uid, $newTermId, $previousRequestId]);
      if ($st->fetch()) fail("Renewal already in progress for this term.", 400);

      // Check if user already has a request for this school year
      $st = $pdo->prepare("
        SELECT ar.id
        FROM accreditation_requests ar
        JOIN academic_terms t ON t.id = ar.academic_term_id
        WHERE ar.coordinator_user_id = ?
          AND t.school_year = (SELECT school_year FROM academic_terms WHERE id = ?)
        LIMIT 1
      ");
      $st->execute([$uid, $newTermId]);
      if ($st->fetch()) fail("You already have an accreditation request for this term.", 400);

      $pdo->beginTransaction();
      try {
        $orgId = (int)$previous["org_id"];
        $previousTermId = (int)$previous["academic_term_id"];

        // 1. Create new accreditation request as renewal (Draft)
        $reqSql = "
          INSERT INTO accreditation_requests
            (org_id, academic_term_id, coordinator_user_id,
             previous_request_id, is_renewal, status, submitted_at, updated_at)
          VALUES (?, ?, ?, ?, 1, 'Draft', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        ";
        $st = $pdo->prepare($reqSql);
        $st->execute([$orgId, $newTermId, $uid, $previousRequestId]);
        $newRequestId = (int)$pdo->lastInsertId();

        // 2. Copy officers from previous term
        $offSql = "
          INSERT INTO organization_officers
            (org_id, academic_term_id, user_id, position,
             full_name, course_year, status, created_at)
          SELECT org_id, ?, user_id, position,
                 full_name, course_year, 'Active', CURRENT_TIMESTAMP
          FROM organization_officers
          WHERE org_id = ?
            AND academic_term_id = ?
            AND status = 'Active'
        ";
        $st = $pdo->prepare($offSql);
        $st->execute([$newTermId, $orgId, $previousTermId]);

        // 3. Get requirements for new term
        $requirementsSql = "
          SELECT r.id, r.requirement_name, r.applies_to,
                 art.file_path, art.file_name
          FROM accreditation_requirements r
          LEFT JOIN accreditation_requirement_templates art
              ON art.requirement_id = r.id AND art.is_active = 1
          WHERE r.status = 'Active'
          ORDER BY r.sort_order ASC, r.id ASC
        ";
        $requirements = $pdo->query($requirementsSql)->fetchAll();

        foreach ($requirements as $req) {
          $rid = (int)$req["id"];

          $st = $pdo->prepare("
            SELECT id, file_path, file_name, status
            FROM accreditation_request_documents
            WHERE request_id = ? AND requirement_id = ?
            LIMIT 1
          ");
          $st->execute([$previousRequestId, $rid]);
          $previousDoc = $st->fetch();

          if ($previousDoc && !empty($previousDoc["file_path"])) {
            $docSql = "
              INSERT INTO accreditation_request_documents
                (request_id, requirement_id, file_path, file_name,
                status, copied_from_doc_id, uploaded_at)
              VALUES (?, ?, ?, ?, 'Draft', ?, CURRENT_TIMESTAMP)
            ";
            $st = $pdo->prepare($docSql);
            $st->execute([
              $newRequestId,
              $rid,
              (string)$previousDoc["file_path"],
              (string)$previousDoc["file_name"],
              (int)$previousDoc["id"]
            ]);
          } else {
            $docSql = "
              INSERT INTO accreditation_request_documents
                (request_id, requirement_id, file_path, file_name,
                status, copied_from_doc_id, uploaded_at)
              VALUES (?, ?, 'pending', 'Not Submitted Yet', 'Pending', NULL, CURRENT_TIMESTAMP)
            ";
            $st = $pdo->prepare($docSql);
            $st->execute([$newRequestId, $rid]);
          }
        }

        $pdo->commit();

        out([
          "ok" => true,
          "message" => "Renewal started. Please review and update requirements for the new term.",
          "new_request_id" => $newRequestId,
          "organization_id" => $orgId,
          "term_id" => $newTermId,
          "is_renewal" => true
        ]);
      } catch (Throwable $e) {
        $pdo->rollBack();
        throw $e;
      }
    }

    // -----------------------------------------
    // 4) List requests (Admin tabs) - filter by CURRENT SCHOOL YEAR
    // -----------------------------------------
    case "list_requests": {
      $mode = (string)($payload["mode"] ?? "pending");
      $q = trim((string)($payload["q"] ?? ""));
      $page = max(1, (int)($payload["page"] ?? 1));
      $per = max(1, min(50, (int)($payload["per_page"] ?? 10)));
      $offset = ($page - 1) * $per;

      $currentTerm = active_term($pdo);
      if (!$currentTerm) {
        out(["ok" => true, "items" => [], "page" => $page, "per_page" => $per, "total" => 0]);
      }

      $currentTermId = (int)$currentTerm["id"];
      $currentSchoolYear = (string)($currentTerm["school_year"] ?? "");
      if ($currentSchoolYear === "") {
        out(["ok" => true, "items" => [], "page" => $page, "per_page" => $per, "total" => 0]);
      }

      $statuses = [];
      if ($mode === "active") $statuses = ["Active"];
      elseif ($mode === "returned") $statuses = ["Returned"];
      else $statuses = ["Pending", "Draft", "Recommended", "Approved"];

      $like = "%" . $q . "%";
      $in = implode(",", array_fill(0, count($statuses), "?"));

      $sqlCount = "
        SELECT COUNT(*) AS c
        FROM accreditation_requests ar
        JOIN organizations o ON o.id = ar.org_id
        JOIN academic_terms t ON t.id = ar.academic_term_id
        WHERE ar.coordinator_user_id = ?
          AND t.school_year = ?
          AND ar.status IN ($in)
          AND (
            o.org_name LIKE ?
            OR o.abbreviation LIKE ?
            OR t.school_year LIKE ?
            OR t.semester LIKE ?
          )
      ";
      $params = array_merge([$uid, $currentSchoolYear], $statuses, [$like, $like, $like, $like]);
      $st = $pdo->prepare($sqlCount);
      $st->execute($params);
      $total = (int)($st->fetch()["c"] ?? 0);

      $sql = "
        SELECT
          ar.id,
          ar.status,
          ar.academic_term_id,
          ar.is_renewal,
          ar.previous_request_id,
          o.id AS org_id,
          o.org_name,
          o.abbreviation AS org_abbr,
          o.org_type,
          o.scope AS org_scope,
          o.program_id,
          p.abbreviation AS program,
          p.program_name AS program_name,
          CONCAT(t.school_year, ' • ', t.semester) AS term_label
        FROM accreditation_requests ar
        JOIN organizations o ON o.id = ar.org_id
        JOIN academic_terms t ON t.id = ar.academic_term_id
        LEFT JOIN programs p ON p.id = o.program_id
        WHERE ar.coordinator_user_id = ?
          AND t.school_year = ?
          AND ar.status IN ($in)
          AND (
            o.org_name LIKE ?
            OR o.abbreviation LIKE ?
            OR t.school_year LIKE ?
            OR t.semester LIKE ?
          )
        ORDER BY ar.id DESC
        LIMIT $per OFFSET $offset
      ";
      $st = $pdo->prepare($sql);
      $st->execute($params);
      $items = $st->fetchAll();

      foreach ($items as &$it) {
        $it["scope"] = scope_label_for_ui($it["org_type"], $it["org_scope"]);
        $it["type"] = $it["org_type"];
        $it["can_edit"] = can_edit_organization($it["status"]);
        $it["is_renewal"] = (bool)($it["is_renewal"] ?? false);
      }

      out([
        "ok" => true,
        "items" => $items,
        "page" => $page,
        "per_page" => $per,
        "total" => $total,
        "current_term_id" => $currentTermId,
        "current_school_year" => $currentSchoolYear,
        "current_term_label" => term_label($currentTerm),
      ]);
    }

    // -----------------------------------------
    // 5) Requirements for upload table (with active template)
    // -----------------------------------------
    case "list_requirements_for_upload":
    case "list_requirements": {
      $orgType = (string)($payload["org_type"] ?? "Organization");
      $uiScope = (string)($payload["scope"] ?? ($payload["applies_to"] ?? "General"));
      $isRenewal = (bool)($payload["is_renewal"] ?? false);
      $previousRequestId = (int)($payload["previous_request_id"] ?? 0);
      $currentRequestId = (int)($payload["request_id"] ?? 0);

      $applies = requirement_applies_filter($uiScope, $orgType);
      $in = implode(",", array_fill(0, count($applies), "?"));

      $sql = "
        SELECT r.id, r.requirement_name, r.applies_to, r.sort_order, r.status
        FROM accreditation_requirements r
        WHERE r.status = 'Active'
          AND r.applies_to IN ($in)
        ORDER BY r.sort_order ASC, r.id ASC
      ";
      $st = $pdo->prepare($sql);
      $st->execute($applies);
      $reqs = $st->fetchAll();
      if (!$reqs) out(["ok" => true, "items" => []]);

      $reqIds = array_map(function ($x) { return (int)$x["id"]; }, $reqs);
      $in2 = implode(",", array_fill(0, count($reqIds), "?"));

      $tplSql = "
        SELECT requirement_id, file_path, file_name, file_type, version, uploaded_at
        FROM accreditation_requirement_templates
        WHERE is_active = 1
          AND requirement_id IN ($in2)
      ";
      $st = $pdo->prepare($tplSql);
      $st->execute($reqIds);
      $tpls = $st->fetchAll();

      $tplByReq = [];
      foreach ($tpls as $t) $tplByReq[(int)$t["requirement_id"]] = $t;

      // Current docs map (editing)
      $curByReq = [];
      if ($currentRequestId > 0) {
        $st = $pdo->prepare("
          SELECT requirement_id, file_path, file_name, status
          FROM accreditation_request_documents
          WHERE request_id = ?
        ");
        $st->execute([$currentRequestId]);
        foreach ($st->fetchAll() as $cd) $curByReq[(int)$cd["requirement_id"]] = $cd;
      }

      // Previous docs map (renewal compare)
      $prevByReq = [];
      if ($isRenewal && $previousRequestId > 0) {
        $st = $pdo->prepare("
          SELECT requirement_id, file_path, file_name, status
          FROM accreditation_request_documents
          WHERE request_id = ?
        ");
        $st->execute([$previousRequestId]);
        foreach ($st->fetchAll() as $pd) $prevByReq[(int)$pd["requirement_id"]] = $pd;
      }

      $items = [];
      foreach ($reqs as $r) {
        $rid = (int)$r["id"];
        $tpl = $tplByReq[$rid] ?? null;

        $currentDoc = $curByReq[$rid] ?? null;
        $previousDoc = $prevByReq[$rid] ?? null;

        $hasCurrentDoc = (bool)$currentDoc;
        $hasPreviousDoc = (bool)$previousDoc;

        $items[] = [
          "id" => $rid,
          "requirement_name" => $r["requirement_name"],
          "applies_to" => $r["applies_to"],
          "sort_order" => (int)$r["sort_order"],
          "is_required" => true,

          "template_name" => $tpl ? (($tpl["file_name"] ?: basename($tpl["file_path"]))) : null,
          "template_url" => $tpl ? to_public_path($tpl["file_path"]) : null,
          "template_meta" => $tpl ? [
            "file_type" => $tpl["file_type"],
            "version" => (int)$tpl["version"],
            "uploaded_at" => $tpl["uploaded_at"],
          ] : null,

          "has_current_document" => $hasCurrentDoc,
          "current_document" => $currentDoc ? [
            "file_path" => $currentDoc["file_path"],
            "file_name" => $currentDoc["file_name"],
            "file_url" => $currentDoc["file_path"] ? to_public_path($currentDoc["file_path"]) : null,
            "status" => $currentDoc["status"],
          ] : null,

          "has_previous_document" => $hasPreviousDoc,
          "previous_document" => $previousDoc ? [
            "file_path" => $previousDoc["file_path"],
            "file_name" => $previousDoc["file_name"],
            "file_url" => $previousDoc["file_path"] ? to_public_path($previousDoc["file_path"]) : null,
            "status" => $previousDoc["status"],
          ] : null,

          "is_new_requirement" => ($isRenewal && !$hasPreviousDoc),
        ];
      }

      out(["ok" => true, "items" => $items]);
    }

  // -----------------------------------------
  // 6) Submit new accreditation (multipart)
  // -----------------------------------------
  case "submit_request": {
    $isRenewal = (bool)($_POST["is_renewal"] ?? false);
    $previousRequestId = (int)($_POST["previous_request_id"] ?? 0);

    $term = active_term($pdo);
    if (!$term) fail("No academic term found.", 500);
    $termId = (int)$term["id"];
    $schoolYear = (string)($term["school_year"] ?? "");
    if ($schoolYear === "") fail("Active term missing school_year.", 500);

    if (!$isRenewal) {
      $st = $pdo->prepare("
        SELECT ar.id
        FROM accreditation_requests ar
        JOIN academic_terms t ON t.id = ar.academic_term_id
        WHERE ar.coordinator_user_id = ?
          AND t.school_year = ?
        LIMIT 1
      ");
      $st->execute([$uid, $schoolYear]);
      if ($st->fetch()) fail("You already submitted an accreditation request for this term.", 403);
    } else {
      $st = $pdo->prepare("
        SELECT ar.id
        FROM accreditation_requests ar
        JOIN academic_terms t ON t.id = ar.academic_term_id
        WHERE ar.coordinator_user_id = ?
          AND t.school_year = ?
          AND ar.previous_request_id = ?
        LIMIT 1
      ");
      $st->execute([$uid, $schoolYear, $previousRequestId]);
      if ($st->fetch()) fail("Renewal already submitted for this term.", 403);
    }

    $orgName = trim((string)($_POST["org_name"] ?? ""));
    $orgAbbr = trim((string)($_POST["org_abbr"] ?? ""));
    $description = trim((string)($_POST["description"] ?? ""));
    $mission = trim((string)($_POST["mission"] ?? ""));
    $vision = trim((string)($_POST["vision"] ?? ""));
    $objectives = trim((string)($_POST["objectives"] ?? ""));
    $advocacy = trim((string)($_POST["advocacy"] ?? ""));

    if ($orgName === "" || $orgAbbr === "" || $description === "" || $mission === "" || $vision === "" || $objectives === "" || $advocacy === "") {
      fail("Please complete organization details including description.");
    }

    $orgType = (string)($_POST["org_type"] ?? "Organization");
    $uiScope = (string)($_POST["scope"] ?? "General");
    $programId = (int)($_POST["program_id"] ?? 0);

    // Fees support
    $membershipFee = (float)($_POST["membership_fee"] ?? 0);
    $feeRequiredRaw = trim((string)($_POST["fee_required"] ?? ""));
    $feeRequired = ($feeRequiredRaw === "") ? 0.00 : (float)$feeRequiredRaw;
    if ($feeRequired < 0) fail("Fee required must be 0 or greater.");

    // DB scope mapping (clubs forced to General)
    $dbScope = map_scope_for_db($uiScope, $orgType);

    if (strcasecmp($orgType, "Club") === 0) {
      $programId = 0;
      $feeRequired = 0.00;
    } else {
      if (strcasecmp($uiScope, "Exclusive") === 0 && $programId <= 0) {
        fail("Program is required for Exclusive scope.");
      }
      if (strcasecmp($uiScope, "Exclusive") !== 0) {
        $programId = 0;
      }
    }

    $reqIds = [];
    if (!empty($_POST["requirement_ids"])) {
      $tmp = json_decode((string)$_POST["requirement_ids"], true);
      if (is_array($tmp)) {
        foreach ($tmp as $v) {
          $iv = (int)$v;
          if ($iv > 0) $reqIds[] = $iv;
        }
      }
    }

    if (!$reqIds && !empty($_FILES["files"]) && is_array($_FILES["files"]["name"])) {
      foreach ($_FILES["files"]["name"] as $k => $_n) {
        $iv = (int)$k;
        if ($iv > 0) $reqIds[] = $iv;
      }
    }

    if (!$reqIds) fail("No requirements selected.", 400);

    $pdo->beginTransaction();
    try {
      $logoPath = null;
      $orgId = 0;

      if ($isRenewal && $previousRequestId > 0) {
        $st = $pdo->prepare("
          SELECT o.*
          FROM accreditation_requests ar
          JOIN organizations o ON o.id = ar.org_id
          WHERE ar.id = ? AND ar.coordinator_user_id = ?
          LIMIT 1
        ");
        $st->execute([$previousRequestId, $uid]);
        $previousOrg = $st->fetch();
        if (!$previousOrg) throw new Exception("Previous organization not found.");

        $orgId = (int)$previousOrg["id"];

        $orgSql = "
          UPDATE organizations
          SET org_type = ?, org_name = ?, abbreviation = ?, description = ?,
              mission = ?, vision = ?, objectives = ?, advocacy = ?,
              scope = ?, program_id = ?,
              membership_fee = ?, fee_required = ?, updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        ";
        $st = $pdo->prepare($orgSql);
        $st->execute([
          $orgType,
          $orgName,
          $orgAbbr,
          $description,
          $mission,
          $vision,
          $objectives,
          $advocacy,
          $dbScope,
          ($programId > 0 ? $programId : null),
          $membershipFee,
          $feeRequired,
          $orgId
        ]);

        if (!empty($_FILES["org_logo"]) && is_uploaded_file($_FILES["org_logo"]["tmp_name"])) {
          $f = $_FILES["org_logo"];
          if ($f["error"] !== UPLOAD_ERR_OK) throw new Exception("Logo upload failed.");
          $ext = strtolower(pathinfo((string)$f["name"], PATHINFO_EXTENSION));
          if (!in_array($ext, ["png", "jpg", "jpeg", "webp"], true)) throw new Exception("Logo must be an image (png/jpg/webp).");

          $dirFs = __DIR__ . "/../assets/uploads/org-logos";
          if (!ensure_dir($dirFs)) throw new Exception("Cannot create upload directory.");

          $fname = "org_" . date("Ymd_His") . "_" . bin2hex(random_bytes(4)) . "." . $ext;
          $destFs = $dirFs . "/" . $fname;

          if (!move_uploaded_file((string)$f["tmp_name"], $destFs)) throw new Exception("Failed to save logo.");
          $logoPath = to_public_path("assets/uploads/org-logos/" . $fname);

          $updateLogoSt = $pdo->prepare("UPDATE organizations SET logo_path = ? WHERE id = ?");
          $updateLogoSt->execute([$logoPath, $orgId]);
        }
      } else {
        if (!empty($_FILES["org_logo"]) && is_uploaded_file($_FILES["org_logo"]["tmp_name"])) {
          $f = $_FILES["org_logo"];
          if ($f["error"] !== UPLOAD_ERR_OK) throw new Exception("Logo upload failed.");
          $ext = strtolower(pathinfo((string)$f["name"], PATHINFO_EXTENSION));
          if (!in_array($ext, ["png", "jpg", "jpeg", "webp"], true)) throw new Exception("Logo must be an image (png/jpg/webp).");

          $dirFs = __DIR__ . "/../assets/uploads/org-logos";
          if (!ensure_dir($dirFs)) throw new Exception("Cannot create upload directory.");

          $fname = "org_" . date("Ymd_His") . "_" . bin2hex(random_bytes(4)) . "." . $ext;
          $destFs = $dirFs . "/" . $fname;

          if (!move_uploaded_file((string)$f["tmp_name"], $destFs)) throw new Exception("Failed to save logo.");
          $logoPath = to_public_path("assets/uploads/org-logos/" . $fname);
        }

        $orgSql = "
          INSERT INTO organizations
            (org_type, org_name, abbreviation, description, logo_path, mission, vision, objectives, advocacy, scope, program_id,
            membership_fee, fee_required, status, created_by, created_at)
          VALUES
            (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Active', ?, CURRENT_TIMESTAMP)
        ";
        $st = $pdo->prepare($orgSql);
        $st->execute([
          $orgType,
          $orgName,
          $orgAbbr,
          $description,
          $logoPath,
          $mission,
          $vision,
          $objectives,
          $advocacy,
          $dbScope,
          ($programId > 0 ? $programId : null),
          $membershipFee,
          $feeRequired,
          $uid,
        ]);
        $orgId = (int)$pdo->lastInsertId();
      }

      $reqSql = "
        INSERT INTO accreditation_requests
          (org_id, academic_term_id, coordinator_user_id, moderator_user_id,
          previous_request_id, is_renewal, status, submitted_at, updated_at)
        VALUES
          (?, ?, ?, NULL, ?, ?, 'Pending', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      ";
      $st = $pdo->prepare($reqSql);
      $st->execute([
        $orgId,
        $termId,
        $uid,
        ($isRenewal && $previousRequestId > 0) ? $previousRequestId : null,
        $isRenewal ? 1 : 0
      ]);
      $requestId = (int)$pdo->lastInsertId();

      // ================= OFFICER VALIDATION AND INSERTION =================
      // Get school year for validation
      $st = $pdo->prepare("SELECT school_year FROM academic_terms WHERE id = ?");
      $st->execute([$termId]);
      $schoolYear = $st->fetchColumn();

      // Hardcoded positions in order
      $hardcodedPositions = [
          'President / Chairperson',
          'Vice President',
          'Secretary',
          'Treasurer',
          'Auditor'
      ];

      // First, collect all officer student IDs to check for duplicates
      $officerStudentIds = [];
      $officerData = [];

      for ($i = 0; $i < 5; $i++) {
          $studentId = (int)($_POST["officers"][$i]["student_id"] ?? 0);
          
          if ($studentId <= 0) {
              throw new Exception("Please select a student for {$hardcodedPositions[$i]} position.");
          }
          
          // Check for duplicates within the same organization submission
          if (in_array($studentId, $officerStudentIds)) {
              throw new Exception("Duplicate officer detected. A student cannot hold multiple officer positions in the same organization.");
          }
          
          $officerStudentIds[] = $studentId;
          $officerData[$i] = [
              'student_id' => $studentId,
              'position' => $hardcodedPositions[$i],
              'full_name' => trim((string)($_POST["officers"][$i]["full_name"] ?? "")),
              'course_year' => trim((string)($_POST["officers"][$i]["course_year"] ?? "")),
              'status' => trim((string)($_POST["officers"][$i]["status"] ?? "Active"))
          ];
      }

      // Now check if any of these students are already officers in OTHER organizations for the SAME school year
      $placeholders = implode(',', array_fill(0, count($officerStudentIds), '?'));
      $params = array_merge([$schoolYear, $orgId], $officerStudentIds);

      $checkOtherOrgSql = "
          SELECT 
              oo.user_id,
              o.org_name,
              oo.position,
              CONCAT(u.first_name, ' ', u.last_name) as student_name
          FROM organization_officers oo
          JOIN organizations o ON o.id = oo.org_id
          JOIN academic_terms t ON t.id = oo.academic_term_id
          JOIN users u ON u.id = oo.user_id
          WHERE t.school_year = ?
              AND oo.org_id != ?
              AND oo.user_id IN ($placeholders)
          LIMIT 1
      ";

      $st = $pdo->prepare($checkOtherOrgSql);
      $st->execute($params);
      $existingOfficerOtherOrg = $st->fetch();

      if ($existingOfficerOtherOrg) {
          // Get the student's name for the error message
          $studentName = $existingOfficerOtherOrg['student_name'];
          $otherOrg = $existingOfficerOtherOrg['org_name'];
          $otherPosition = $existingOfficerOtherOrg['position'];
          
          throw new Exception(
              "Student {$studentName} is already an officer in '{$otherOrg}' " .
              "as {$otherPosition} for school year {$schoolYear}. " .
              "A student can only be an officer in ONE organization per academic year."
          );
      }

      // If all validation passes, proceed with inserting/updating officers
      for ($i = 0; $i < 5; $i++) {
          $data = $officerData[$i];
          $position = $data['position'];
          $studentId = $data['student_id'];
          $fullName = $data['full_name'];
          $courseYear = $data['course_year'];
          $status = $data['status'];

          // Verify the student exists and is active
          $st = $pdo->prepare("SELECT id, role, status FROM users WHERE id = ?");
          $st->execute([$studentId]);
          $student = $st->fetch();
          
          if (!$student || $student['role'] !== 'student' || $student['status'] !== 'Active') {
              throw new Exception("Invalid or inactive student selected for {$position} position.");
          }

          // Check if officer already exists for this organization and term
          $checkOffSt = $pdo->prepare("
              SELECT id FROM organization_officers
              WHERE org_id = ? AND academic_term_id = ? AND position = ?
              LIMIT 1
          ");
          $checkOffSt->execute([$orgId, $termId, $position]);
          $existingOfficer = $checkOffSt->fetch();

          if ($existingOfficer) {
              // Update existing officer
              $offSql = "
                  UPDATE organization_officers
                  SET user_id = ?, full_name = ?, course_year = ?, status = ?
                  WHERE org_id = ? AND academic_term_id = ? AND position = ?
              ";
              $st = $pdo->prepare($offSql);
              $st->execute([
                  $studentId,
                  $fullName,
                  $courseYear,
                  $status,
                  $orgId,
                  $termId,
                  $position
              ]);
          } else {
              // Insert new officer
              $offSql = "
                  INSERT INTO organization_officers
                  (org_id, academic_term_id, user_id, position, full_name, course_year, status, created_at)
                  VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
              ";
              $st = $pdo->prepare($offSql);
              $st->execute([
                  $orgId,
                  $termId,
                  $studentId,
                  $position,
                  $fullName,
                  $courseYear,
                  $status
              ]);
          }
      }

      // ================= DOCUMENT UPLOADS =================
      if (empty($_FILES["files"])) throw new Exception("No documents uploaded.");

      $files = $_FILES["files"];
      if (!is_array($files["name"])) throw new Exception("Invalid files payload.");

      $baseDirRel = "assets/uploads/accreditation/{$requestId}";
      $baseDirFs = __DIR__ . "/../" . $baseDirRel;
      if (!ensure_dir($baseDirFs)) throw new Exception("Cannot create request upload directory.");

      foreach ($reqIds as $rid) {
        $key = (string)$rid;
        if (!isset($files["tmp_name"][$key])) continue;

        $tmpName = $files["tmp_name"][$key];
        $err = $files["error"][$key] ?? UPLOAD_ERR_NO_FILE;
        $orig = $files["name"][$key] ?? "file";
        if ($err === UPLOAD_ERR_NO_FILE) throw new Exception("Missing upload for requirement #{$rid}.");
        if ($err !== UPLOAD_ERR_OK) throw new Exception("Upload error for requirement #{$rid}.");
        if (!is_uploaded_file($tmpName)) throw new Exception("Invalid upload for requirement #{$rid}.");

        $ext = strtolower(pathinfo((string)$orig, PATHINFO_EXTENSION));
        $allowed = ["pdf"];
        if (!in_array($ext, $allowed, true)) throw new Exception("Invalid file type for requirement #{$rid}.");

        $safe = safe_filename(pathinfo((string)$orig, PATHINFO_FILENAME));
        $fname = "req{$rid}_" . date("Ymd_His") . "_" . bin2hex(random_bytes(4)) . "_" . $safe . "." . $ext;

        $subFs = $baseDirFs . "/req_" . $rid;
        if (!ensure_dir($subFs)) throw new Exception("Cannot create requirement folder.");

        $destFs = $subFs . "/" . $fname;
        if (!move_uploaded_file((string)$tmpName, $destFs)) throw new Exception("Failed to save uploaded file for requirement #{$rid}.");

        $relPath = $baseDirRel . "/req_{$rid}/" . $fname;
        $publicPath = to_public_path($relPath);

        $checkDocSt = $pdo->prepare("
          SELECT id FROM accreditation_request_documents
          WHERE request_id = ? AND requirement_id = ?
          LIMIT 1
        ");
        $checkDocSt->execute([$requestId, $rid]);

        if ($checkDocSt->fetch()) {
          $docSql = "
            UPDATE accreditation_request_documents
            SET file_path = ?, file_name = ?, status = 'Submitted',
                reviewed_by = NULL, reviewed_at = NULL, return_reason = NULL,
                uploaded_at = CURRENT_TIMESTAMP
            WHERE request_id = ? AND requirement_id = ?
          ";
          $st = $pdo->prepare($docSql);
          $st->execute([$publicPath, $orig, $requestId, $rid]);
        } else {
          $docSql = "
            INSERT INTO accreditation_request_documents
              (request_id, requirement_id, file_path, file_name, status, reviewed_by, reviewed_at, return_reason, uploaded_at)
            VALUES
              (?, ?, ?, ?, 'Submitted', NULL, NULL, NULL, CURRENT_TIMESTAMP)
          ";
          $st = $pdo->prepare($docSql);
          $st->execute([$requestId, $rid, $publicPath, $orig]);
        }
      }

      // ================= NOTIFICATIONS =================
      $specialAdminId = get_active_special_admin($pdo);
      if ($specialAdminId) {
        $message = $isRenewal
          ? "A renewal accreditation request for organization '{$orgName}' has been submitted by {$user['first_name']} {$user['last_name']}."
          : "A new accreditation request for organization '{$orgName}' has been submitted by {$user['first_name']} {$user['last_name']}.";

        add_notification(
          $pdo,
          $specialAdminId,
          $uid,
          $isRenewal ? "Renewal Accreditation Request Submitted" : "New Accreditation Request Submitted",
          $message,
          'accreditation',
          $requestId
        );
      }

      add_notification(
        $pdo,
        $uid,
        $uid,
        $isRenewal ? "Renewal Accreditation Request Submitted" : "Accreditation Request Submitted",
        $isRenewal
          ? "Your renewal accreditation request for '{$orgName}' has been submitted successfully and is now pending review."
          : "Your accreditation request for '{$orgName}' has been submitted successfully and is now pending review.",
        'accreditation',
        $requestId
      );

      $pdo->commit();

      out([
        "ok" => true,
        "message" => $isRenewal ? "Renewal submitted." : "Accreditation submitted.",
        "request_id" => $requestId,
        "org_id" => $orgId,
        "term_id" => $termId,
        "is_renewal" => $isRenewal
      ]);
    } catch (Throwable $e) {
      $pdo->rollBack();
      fail($e->getMessage(), 500);
    }
  }

    // -----------------------------------------
    // 7) Get request details + documents paging
    // -----------------------------------------
    case "get_request": {
      $requestId = (int)($payload["request_id"] ?? 0);
      if ($requestId <= 0) fail("Invalid request id.");

      $docsPage = max(1, (int)($payload["docs_page"] ?? 1));
      $docsPer = max(1, min(50, (int)($payload["docs_per_page"] ?? 8)));
      $docsOff = ($docsPage - 1) * $docsPer;

      $sql = "
        SELECT
          ar.id, ar.status, ar.submitted_at, ar.updated_at, ar.is_renewal, ar.previous_request_id,
          o.id AS org_id, o.org_name, o.abbreviation AS org_abbr, o.org_type, o.scope AS org_scope,
          o.program_id, o.logo_path, o.mission, o.vision, o.objectives, o.advocacy,
          o.description,  -- ← ADD THIS LINE
          o.membership_fee, o.fee_required,
          p.abbreviation AS program,
          t.id AS term_id, CONCAT(t.school_year, ' • ', t.semester) AS term_label
        FROM accreditation_requests ar
        JOIN organizations o ON o.id = ar.org_id
        JOIN academic_terms t ON t.id = ar.academic_term_id
        LEFT JOIN programs p ON p.id = o.program_id
        WHERE ar.id = ?
          AND ar.coordinator_user_id = ?
        LIMIT 1
      ";
      $st = $pdo->prepare($sql);
      $st->execute([$requestId, $uid]);
      $req = $st->fetch();
      if (!$req) fail("Request not found.", 404);

      $req["scope"] = scope_label_for_ui($req["org_type"], $req["org_scope"]);
      $req["logo_url"] = $req["logo_path"] ? to_public_path($req["logo_path"]) : null;
      $req["can_edit"] = can_edit_organization($req["status"]);
      $req["is_renewal"] = (bool)($req["is_renewal"] ?? false);

      $st = $pdo->prepare("SELECT COUNT(*) AS c FROM accreditation_request_documents WHERE request_id = ?");
      $st->execute([$requestId]);
      $docsTotal = (int)($st->fetch()["c"] ?? 0);

      $docsSql = "
        SELECT
          d.id,
          d.requirement_id,
          r.requirement_name,
          d.file_path,
          d.file_name,
          d.status,
          d.return_reason,
          d.reviewed_at,
          d.copied_from_doc_id
        FROM accreditation_request_documents d
        JOIN accreditation_requirements r ON r.id = d.requirement_id
        WHERE d.request_id = ?
        ORDER BY r.sort_order ASC, d.id ASC
        LIMIT $docsPer OFFSET $docsOff
      ";
      $st = $pdo->prepare($docsSql);
      $st->execute([$requestId]);
      $docs = $st->fetchAll();

      foreach ($docs as &$d) {
        $d["file_url"] = $d["file_path"] ? to_public_path($d["file_path"]) : null;
        $canReplace = (strcasecmp((string)$d["status"], "Returned") === 0) || (strcasecmp((string)$req["status"], "Returned") === 0);
        $d["can_replace"] = $canReplace;
        $d["is_copied"] = !empty($d["copied_from_doc_id"]);
      }

      $st = $pdo->prepare("SELECT requirement_id, status FROM accreditation_request_documents WHERE request_id = ?");
      $st->execute([$requestId]);
      $docsAll = $st->fetchAll();

      $offSql = "
        SELECT
          oo.id, oo.position, oo.status,
          oo.user_id,
          TRIM(REPLACE(CONCAT(
            COALESCE(u.first_name, ''), ' ',
            COALESCE(u.middle_name, ''), ' ',
            COALESCE(u.last_name, ''), ' ',
            COALESCE(u.suffix, '')
          ), '  ', ' ')) AS full_name,
          COALESCE(
            oo.course_year,
            CONCAT(COALESCE(u.program, ''), ' ',
              CASE
                WHEN u.year_level = '1' THEN '1st Year'
                WHEN u.year_level = '2' THEN '2nd Year'
                WHEN u.year_level = '3' THEN '3rd Year'
                WHEN u.year_level = '4' THEN '4th Year'
                WHEN u.year_level = '5' THEN '5th Year'
                ELSE COALESCE(u.year_level, '')
              END
            )
          ) AS course_year
        FROM organization_officers oo
        LEFT JOIN users u ON u.id = oo.user_id
        WHERE oo.org_id = ?
          AND oo.academic_term_id = ?
        ORDER BY oo.status DESC, oo.position ASC, oo.id ASC
      ";
      $st = $pdo->prepare($offSql);
      $st->execute([(int)$req["org_id"], (int)$req["term_id"]]);
      $officers = $st->fetchAll();

      out([
        "ok" => true,
        "request" => [
          "id" => (int)$req["id"],
          "status" => $req["status"],
          "org_id" => (int)$req["org_id"],
          "org_name" => $req["org_name"],
          "org_abbr" => $req["org_abbr"],
          "org_type" => $req["org_type"],
          "scope" => $req["scope"],
          "program_id" => $req["program_id"] ? (int)$req["program_id"] : null,
          "program" => $req["program"] ?: "—",

          "term_id" => (int)$req["term_id"],
          "term_label" => $req["term_label"],

          "logo_url" => $req["logo_url"],
          "is_renewal" => $req["is_renewal"],
          "previous_request_id" => $req["previous_request_id"],

          "membership_fee" => (float)$req["membership_fee"],
          "fee_required" => (float)$req["fee_required"],

          "description" => $req["description"],
          "mission" => $req["mission"],
          "vision" => $req["vision"],
          "objectives" => $req["objectives"],
          "advocacy" => $req["advocacy"],

          "officers" => $officers,
          "docs_all" => $docsAll,
          "docs" => $docs,
          "can_edit" => $req["can_edit"],
        ],
        "docs_paging" => [
          "page" => $docsPage,
          "per_page" => $docsPer,
          "total" => $docsTotal,
        ],
        "docs_meta" => (($docsTotal > 0)
          ? ("Showing " . ($docsOff + 1) . "–" . min($docsOff + $docsPer, $docsTotal) . " of " . $docsTotal)
          : "No documents"),
      ]);
    }

  // -----------------------------------------
  // 7b) Update organization info (JSON) - SCHOOL YEAR BASED VALIDATION (FIXED)
  // -----------------------------------------
  case "update_organization": {
    $orgId = (int)($payload["org_id"] ?? 0);
    $requestId = (int)($payload["request_id"] ?? 0);

    if ($orgId <= 0 && $requestId <= 0) fail("Invalid organization id or request id.");

    if ($orgId <= 0 && $requestId > 0) {
      $st = $pdo->prepare("SELECT org_id FROM accreditation_requests WHERE id = ? AND coordinator_user_id = ? LIMIT 1");
      $st->execute([$requestId, $uid]);
      $row = $st->fetch();
      if (!$row) fail("Request not found or access denied.", 404);
      $orgId = (int)$row["org_id"];
    }

    if ($requestId > 0) {
      $st = $pdo->prepare("
        SELECT ar.*, o.*
        FROM accreditation_requests ar
        JOIN organizations o ON o.id = ar.org_id
        WHERE ar.id = ?
          AND ar.coordinator_user_id = ?
        LIMIT 1
      ");
      $st->execute([$requestId, $uid]);
      $org = $st->fetch();

      if (!$org) fail("Request not found or access denied.", 404);
      if (!can_edit_organization($org['status'])) fail("This request cannot be edited in its current status.", 403);

      $currentTermId = (int)$org['academic_term_id'];
      $currentStatus = (string)$org['status'];
    } else {
      $st = $pdo->prepare("
        SELECT o.*
        FROM organizations o
        WHERE o.id = ?
          AND (o.created_by = ? OR EXISTS (
            SELECT 1 FROM accreditation_requests ar2
            WHERE ar2.org_id = o.id AND ar2.coordinator_user_id = ?
          ))
        LIMIT 1
      ");
      $st->execute([$orgId, $uid, $uid]);
      $org = $st->fetch();

      if (!$org) fail("Organization not found or access denied.", 404);

      $st = $pdo->prepare("
        SELECT ar.*
        FROM accreditation_requests ar
        WHERE ar.org_id = ?
          AND ar.coordinator_user_id = ?
        ORDER BY ar.id DESC
        LIMIT 1
      ");
      $st->execute([$orgId, $uid]);
      $latestRequest = $st->fetch();

      if (!$latestRequest || !can_edit_organization($latestRequest['status'])) {
        fail("Organization cannot be edited in its current status.", 403);
      }

      $requestId = (int)$latestRequest['id'];
      $currentTermId = (int)$latestRequest['academic_term_id'];
      $currentStatus = (string)$latestRequest['status'];
    }

    $orgName = trim((string)($payload["org_name"] ?? ($org["org_name"] ?? "")));
    $abbr = trim((string)($payload["abbreviation"] ?? ($org["abbreviation"] ?? "")));
    $orgType = (string)($payload["org_type"] ?? ($org["org_type"] ?? "Organization"));
    $uiScope = (string)($payload["scope"] ?? scope_label_for_ui(($org["org_type"] ?? "Organization"), ($org["scope"] ?? "General")));
    $programId = (int)($payload["program_id"] ?? ($org["program_id"] ?? 0));

    if ($orgName === "" || $abbr === "") fail("Organization name and abbreviation are required.");

    $mission = trim((string)($payload["mission"] ?? ($org["mission"] ?? "")));
    $vision = trim((string)($payload["vision"] ?? ($org["vision"] ?? "")));
    $objectives = trim((string)($payload["objectives"] ?? ($org["objectives"] ?? "")));
    $advocacy = trim((string)($payload["advocacy"] ?? ($org["advocacy"] ?? "")));
    $description = trim((string)($payload["description"] ?? ($org["description"] ?? "")));

    $membershipFee = (float)($payload["membership_fee"] ?? ($org["membership_fee"] ?? 0));

    $feeRequiredRaw = trim((string)($payload["fee_required"] ?? ($org["fee_required"] ?? "")));
    $feeRequired = ($feeRequiredRaw === "") ? 0.00 : (float)$feeRequiredRaw;
    if ($feeRequired < 0) fail("Fee required must be 0 or greater.");

    $dbScope = map_scope_for_db($uiScope, $orgType);

    if (strcasecmp($orgType, "Club") === 0) {
      $programId = null;
      $dbScope = "General";
      $feeRequired = 0.00;
    } else {
      if (strcasecmp($dbScope, "Exclusive") === 0) {
        if ($programId <= 0) fail("Program is required for Exclusive scope.");
      } else {
        $programId = null;
      }
    }

    $st = $pdo->prepare("
      SELECT COUNT(*) as count
      FROM organizations
      WHERE (org_name = ? OR abbreviation = ?)
        AND id != ?
        AND status = 'Active'
    ");
    $st->execute([$orgName, $abbr, $orgId]);
    $duplicate = $st->fetch();

    if (!empty($duplicate['count']) && (int)$duplicate['count'] > 0) {
      fail("Organization name or abbreviation already exists.");
    }

    $pdo->beginTransaction();
    try {
      $st = $pdo->prepare("
        UPDATE organizations
        SET
          org_type = ?,
          org_name = ?,
          abbreviation = ?,
          description = ?,
          scope = ?,
          program_id = ?,
          membership_fee = ?,
          fee_required = ?,
          mission = ?,
          vision = ?,
          objectives = ?,
          advocacy = ?
        WHERE id = ?
        LIMIT 1
      ");
      $st->execute([
        $orgType,
        $orgName,
        $abbr,
        $description,
        $dbScope,
        $programId,
        $membershipFee,
        $feeRequired,
        $mission,
        $vision,
        $objectives,
        $advocacy,
        $orgId
      ]);

      // Handle logo upload on update
      if (!empty($_FILES["org_logo"]) && is_uploaded_file($_FILES["org_logo"]["tmp_name"])) {
        $f = $_FILES["org_logo"];
        if (($f["error"] ?? UPLOAD_ERR_OK) !== UPLOAD_ERR_OK) {
          throw new Exception("Logo upload failed.");
        }

        $ext = strtolower(pathinfo((string)($f["name"] ?? ""), PATHINFO_EXTENSION));
        if (!in_array($ext, ["png", "jpg", "jpeg", "webp"], true)) {
          throw new Exception("Logo must be an image.");
        }

        $dirFs = __DIR__ . "/../assets/uploads/org-logos";
        if (!ensure_dir($dirFs)) {
          throw new Exception("Cannot create upload directory.");
        }

        $fname = "org_" . date("Ymd_His") . "_" . bin2hex(random_bytes(4)) . "." . $ext;
        $destFs = $dirFs . "/" . $fname;

        if (!move_uploaded_file((string)$f["tmp_name"], $destFs)) {
          throw new Exception("Failed to save logo.");
        }

        $logoPath = to_public_path("assets/uploads/org-logos/" . $fname);
        $updateLogoSt = $pdo->prepare("UPDATE organizations SET logo_path = ? WHERE id = ? LIMIT 1");
        $updateLogoSt->execute([$logoPath, $orgId]);
      }

    // ============= OFFICER VALIDATION AND UPDATE (SCHOOL YEAR BASED - FIXED) =============
    $hardcodedPositions = [
        'President / Chairperson',
        'Vice President',
        'Secretary',
        'Treasurer',
        'Auditor'
    ];

    if (isset($payload["edit_officers"]) && is_array($payload["edit_officers"])) {
        $termId = $currentTermId;
        
        // Get the school year for this term
        $st = $pdo->prepare("SELECT school_year FROM academic_terms WHERE id = ?");
        $st->execute([$termId]);
        $schoolYear = $st->fetchColumn();

        if ($termId > 0 && $schoolYear) {
            // Fetch existing officers for this organization and term
            $existingOfficersSt = $pdo->prepare("
                SELECT id, position, user_id, full_name, course_year, status
                FROM organization_officers
                WHERE org_id = ? AND academic_term_id = ?
            ");
            $existingOfficersSt->execute([$orgId, $termId]);
            $existingOfficers = $existingOfficersSt->fetchAll();
            
            // Create maps for easy lookup
            $existingOfficersById = [];
            $existingOfficersByPosition = [];
            foreach ($existingOfficers as $existing) {
                $existingOfficersById[$existing["id"]] = $existing;
                $existingOfficersByPosition[$existing["position"]] = $existing;
            }

            // Track validation errors and officers to update
            $validationErrors = [];
            $officersToUpdate = [];
            $processedPositions = [];

            foreach ($payload["edit_officers"] as $index => $officerData) {
                if (!is_array($officerData)) continue;

                $position = trim((string)($officerData["position"] ?? ""));
                $studentId = (int)($officerData["student_id"] ?? 0);
                $officerId = isset($officerData['id']) ? (int)$officerData['id'] : 0;
                $status = trim((string)($officerData["status"] ?? "Active"));

                // Skip empty positions
                if ($position === "") continue;
                
                // Check if position is valid
                if (!in_array($position, $hardcodedPositions, true)) {
                    $validationErrors[] = "Invalid position '{$position}'.";
                    continue;
                }

                // Skip if position already processed in this update
                if (in_array($position, $processedPositions)) {
                    $validationErrors[] = "Duplicate position '{$position}' in the same update.";
                    continue;
                }
                $processedPositions[] = $position;

                // If no student assigned, this is an error
                if ($studentId <= 0) {
                    $validationErrors[] = "{$position} has no student assigned.";
                    continue;
                }

                // Check if this position is already taken in THIS organization for THIS TERM
                if (isset($existingOfficersByPosition[$position])) {
                    $existingOfficer = $existingOfficersByPosition[$position];
                    
                    // CASE 1: This is the EXACT SAME OFFICER (same ID or same user_id)
                    // Let it pass without validation - this is the case where you're just resubmitting the same data
                    if (($officerId > 0 && $existingOfficer['id'] == $officerId) || 
                        ($existingOfficer['user_id'] == $studentId)) {
                        
                        // This is the same officer - no validation needed
                        // Add to update list but mark as same officer
                        $officersToUpdate[] = [
                            'id' => $officerId > 0 ? $officerId : $existingOfficer['id'],
                            'position' => $position,
                            'user_id' => $studentId,
                            'full_name' => $officerData["full_name"] ?? $existingOfficer['full_name'],
                            'course_year' => $officerData["course_year"] ?? $existingOfficer['course_year'],
                            'status' => $status,
                            'is_same_officer' => true
                        ];
                        continue;
                    }
                    
                    // CASE 2: Different officer trying to take the position - THIS IS AN ERROR
                    // Get the name of the current holder
                    $st = $pdo->prepare("SELECT CONCAT(first_name, ' ', last_name) as name FROM users WHERE id = ?");
                    $st->execute([$existingOfficer['user_id']]);
                    $holderName = $st->fetchColumn() ?: 'another officer';
                    $validationErrors[] = "{$position}: Already held by {$holderName} in this term. You cannot assign a different student to this position while the current officer is still active.";
                    continue;
                }

                // Validate that the student exists and is active
                $st = $pdo->prepare("SELECT id, role, status, first_name, last_name FROM users WHERE id = ?");
                $st->execute([$studentId]);
                $student = $st->fetch();
                
                if (!$student) {
                    $validationErrors[] = "{$position}: Student not found.";
                    continue;
                }
                
                if ($student['role'] !== 'student') {
                    $validationErrors[] = "{$position}: Not a student.";
                    continue;
                }
                
                if ($student['status'] !== 'Active') {
                    $validationErrors[] = "{$position}: Student not active.";
                    continue;
                }

                // Check if student is already an officer in a DIFFERENT organization in THIS SCHOOL YEAR
                $checkSql = "
                    SELECT o.org_name, oo.position, t.semester
                    FROM organization_officers oo
                    JOIN organizations o ON o.id = oo.org_id
                    JOIN academic_terms t ON t.id = oo.academic_term_id
                    WHERE t.school_year = ? 
                      AND oo.user_id = ?
                      AND oo.org_id != ?
                    LIMIT 1
                ";
                $st = $pdo->prepare($checkSql);
                $st->execute([$schoolYear, $studentId, $orgId]);
                $existingOfficerOtherOrg = $st->fetch();
                
                if ($existingOfficerOtherOrg) {
                    $validationErrors[] = 
                        "{$position}: Student already officer in {$existingOfficerOtherOrg['org_name']} " .
                        "({$existingOfficerOtherOrg['semester']} sem).";
                    continue;
                }

                // Get fresh student data for course_year and full_name if needed
                $fullName = trim((string)($officerData["full_name"] ?? ""));
                if (empty($fullName)) {
                    $fullName = trim($student['first_name'] . ' ' . ($student['last_name'] ?? ''));
                }

                $courseYear = trim((string)($officerData["course_year"] ?? ""));
                if (empty($courseYear)) {
                    $st = $pdo->prepare("SELECT program, year_level FROM users WHERE id = ?");
                    $st->execute([$studentId]);
                    $sData = $st->fetch();
                    
                    $yearText = "";
                    if (!empty($sData['year_level'])) {
                        $year = $sData['year_level'];
                        if ($year === "1") $yearText = "1st Year";
                        else if ($year === "2") $yearText = "2nd Year";
                        else if ($year === "3") $yearText = "3rd Year";
                        else if ($year === "4") $yearText = "4th Year";
                        else if ($year === "5") $yearText = "5th Year";
                        else $yearText = $year;
                    }
                    $courseYear = trim(($sData['program'] ?? '') . ' ' . $yearText);
                }

                // Add to officers to update list (new officer)
                $officersToUpdate[] = [
                    'id' => 0,
                    'position' => $position,
                    'user_id' => $studentId,
                    'full_name' => $fullName,
                    'course_year' => $courseYear,
                    'status' => $status,
                    'is_same_officer' => false
                ];
            }

            // If there are validation errors, fail
            if (!empty($validationErrors)) {
                throw new Exception("Officer validation failed:\n- " . implode("\n- ", $validationErrors));
            }

            // Process the officers to update
            foreach ($officersToUpdate as $officer) {
                $position = $officer['position'];
                $studentId = $officer['user_id'];
                $fullName = $officer['full_name'];
                $courseYear = $officer['course_year'];
                $status = $officer['status'];
                $officerId = $officer['id'];

                if ($officer['is_same_officer']) {
                    // This is the same officer - we can skip the update if nothing changed
                    // Or do a lightweight update if needed
                    if ($officerId > 0) {
                        // Optional: update only if something actually changed
                        // For now, we'll skip updates for same officers to save queries
                        // Uncomment below if you want to update anyway
                        /*
                        $updateSt = $pdo->prepare("
                            UPDATE organization_officers
                            SET full_name = ?, course_year = ?, status = ?
                            WHERE id = ? AND org_id = ? AND academic_term_id = ?
                        ");
                        $updateSt->execute([
                            $fullName,
                            $courseYear,
                            $status,
                            $officerId,
                            $orgId,
                            $termId
                        ]);
                        */
                    }
                } else if ($officerId > 0) {
                    // Update existing officer with new data
                    $updateSt = $pdo->prepare("
                        UPDATE organization_officers
                        SET user_id = ?, full_name = ?, course_year = ?, status = ?
                        WHERE id = ? AND org_id = ? AND academic_term_id = ?
                    ");
                    $updateSt->execute([
                        $studentId,
                        $fullName,
                        $courseYear,
                        $status,
                        $officerId,
                        $orgId,
                        $termId
                    ]);
                } else {
                    // Insert new officer
                    $insertSt = $pdo->prepare("
                        INSERT INTO organization_officers
                            (org_id, academic_term_id, user_id, position, full_name, course_year, status, created_at)
                        VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
                    ");
                    $insertSt->execute([
                        $orgId,
                        $termId,
                        $studentId,
                        $position,
                        $fullName,
                        $courseYear,
                        $status
                    ]);
                }
            }
        }
    }

      // Handle file uploads
      if (!empty($_FILES["files"]) && is_array($_FILES["files"]["name"])) {
        $baseDirRel = "assets/uploads/accreditation/{$requestId}";
        $baseDirFs = __DIR__ . "/../" . $baseDirRel;

        if (!ensure_dir($baseDirFs)) {
          throw new Exception("Cannot create request upload directory.");
        }

        foreach ($_FILES["files"]["name"] as $reqIdStr => $fileName) {
          $reqId = (int)$reqIdStr;
          if ($reqId <= 0) continue;

          $tmpName = $_FILES["files"]["tmp_name"][$reqIdStr] ?? null;
          $error = $_FILES["files"]["error"][$reqIdStr] ?? UPLOAD_ERR_NO_FILE;

          if ($error === UPLOAD_ERR_NO_FILE || !$tmpName || !is_uploaded_file($tmpName)) continue;
          if ($error !== UPLOAD_ERR_OK) throw new Exception("Upload error for requirement #{$reqId}.");

          $origName = (string)$fileName;
          $ext = strtolower(pathinfo($origName, PATHINFO_EXTENSION));
          $allowed = ["pdf"];
          if (!in_array($ext, $allowed, true)) throw new Exception("Invalid file type.");

          $safe = safe_filename(pathinfo($origName, PATHINFO_FILENAME));
          $fname = "req{$reqId}_" . date("Ymd_His") . "_" . bin2hex(random_bytes(4)) . "_" . $safe . "." . $ext;

          $subFs = $baseDirFs . "/req_" . $reqId;
          if (!ensure_dir($subFs)) throw new Exception("Cannot create requirement folder.");

          $destFs = $subFs . "/" . $fname;
          if (!move_uploaded_file($tmpName, $destFs)) throw new Exception("Failed to save file.");

          $relPath = $baseDirRel . "/req_{$reqId}/" . $fname;
          $publicPath = to_public_path($relPath);

          $checkSt = $pdo->prepare("
            SELECT id FROM accreditation_request_documents
            WHERE request_id = ? AND requirement_id = ?
            LIMIT 1
          ");
          $checkSt->execute([$requestId, $reqId]);

          if ($checkSt->fetch()) {
            $docSql = "
              UPDATE accreditation_request_documents
              SET file_path = ?, file_name = ?, status = 'Submitted',
                  reviewed_by = NULL, reviewed_at = NULL, return_reason = NULL,
                  uploaded_at = CURRENT_TIMESTAMP
              WHERE request_id = ? AND requirement_id = ?
            ";
            $st = $pdo->prepare($docSql);
            $st->execute([$publicPath, $origName, $requestId, $reqId]);
          } else {
            $docSql = "
              INSERT INTO accreditation_request_documents
                (request_id, requirement_id, file_path, file_name, status, uploaded_at)
              VALUES
                (?, ?, ?, ?, 'Submitted', CURRENT_TIMESTAMP)
            ";
            $st = $pdo->prepare($docSql);
            $st->execute([$requestId, $reqId, $publicPath, $origName]);
          }
        }
      }

      // Update request status
      $newStatus = $currentStatus;
      if ($requestId > 0) {
        if (in_array($currentStatus, ['Draft', 'Returned', 'Active', 'Recommended'], true)) {
          $newStatus = 'Pending';
        }

        $st = $pdo->prepare("
          UPDATE accreditation_requests
          SET status = ?,
              submitted_at = IF(submitted_at IS NULL AND ? = 'Pending', CURRENT_TIMESTAMP, submitted_at),
              updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
            AND coordinator_user_id = ?
        ");
        $st->execute([$newStatus, $newStatus, $requestId, $uid]);
      }

      // Notifications
      $specialAdminId = get_active_special_admin($pdo);
      if ($specialAdminId) {
        add_notification(
          $pdo,
          $specialAdminId,
          $uid,
          "Organization Updated",
          "Organization '{$orgName}' updated by {$user['first_name']} {$user['last_name']}.",
          'reaccreditation',
          $requestId
        );
      }

      add_notification(
        $pdo,
        $uid,
        $uid,
        "Organization Updated",
        "Your organization '{$orgName}' has been updated successfully.",
        'reaccreditation',
        $requestId
      );

      $pdo->commit();

      // Fetch updated organization data
      $st = $pdo->prepare("
        SELECT
          o.*,
          p.abbreviation as program,
          p.program_name as program_name
        FROM organizations o
        LEFT JOIN programs p ON p.id = o.program_id
        WHERE o.id = ?
      ");
      $st->execute([$orgId]);
      $updatedOrg = $st->fetch();

      // Fetch updated officers
      $st = $pdo->prepare("
        SELECT
          oo.id, oo.position, oo.status,
          oo.user_id,
          oo.full_name,
          oo.course_year,
          u.id_number,
          u.program,
          u.year_level
        FROM organization_officers oo
        LEFT JOIN users u ON u.id = oo.user_id
        WHERE oo.org_id = ?
          AND oo.academic_term_id = ?
        ORDER BY FIELD(oo.position, 
          'President / Chairperson',
          'Vice President',
          'Secretary',
          'Treasurer',
          'Auditor'
        ), oo.id ASC
      ");
      $st->execute([$orgId, $currentTermId]);
      $officers = $st->fetchAll();

      $updatedOrg["scope"] = scope_label_for_ui(($updatedOrg["org_type"] ?? "Organization"), ($updatedOrg["scope"] ?? "General"));
      $updatedOrg["logo_url"] = $updatedOrg["logo_path"] ? to_public_path($updatedOrg["logo_path"]) : null;

      out([
        "ok" => true,
        "message" => "Organization updated successfully.",
        "request_id" => $requestId,
        "new_status" => $newStatus ?? $currentStatus,
        "organization" => [
          "id" => (int)$updatedOrg["id"],
          "org_name" => $updatedOrg["org_name"],
          "org_abbr" => $updatedOrg["abbreviation"],
          "org_type" => $updatedOrg["org_type"],
          "scope" => $updatedOrg["scope"],
          "program_id" => $updatedOrg["program_id"] ? (int)$updatedOrg["program_id"] : null,
          "program" => $updatedOrg["program"] ?: "—",
          "program_name" => $updatedOrg["program_name"] ?: null,
          "membership_fee" => (float)$updatedOrg["membership_fee"],
          "fee_required" => (float)$updatedOrg["fee_required"],
          "mission" => $updatedOrg["mission"],
          "vision" => $updatedOrg["vision"],
          "objectives" => $updatedOrg["objectives"],
          "advocacy" => $updatedOrg["advocacy"],
          "logo_url" => $updatedOrg["logo_url"],
          "officers" => $officers
        ]
      ]);
    } catch (Throwable $e) {
      $pdo->rollBack();
      fail("Update failed: " . $e->getMessage(), 500);
    }
  }

  // -----------------------------------------
  // 7c) Search active students (JSON) - WITH SCHOOL YEAR OFFICER CHECK
  // -----------------------------------------
  case "search_students": {
    $q = trim((string)($payload["q"] ?? ""));
    $programId = (int)($payload["program_id"] ?? 0);
    $limit = max(1, min(50, (int)($payload["limit"] ?? 25)));
    $orgId = (int)($payload["org_id"] ?? 0);
    $termId = (int)($payload["term_id"] ?? 0);
    $excludeCurrentOfficers = (bool)($payload["exclude_current"] ?? true);

    if (mb_strlen($q) < 2) out(["ok" => true, "items" => []]);

    $like = "%" . $q . "%";

    $filterAbbr = null;
    if ($programId > 0) {
      $filterAbbr = program_abbr_by_id($pdo, $programId);
      if (!$filterAbbr) out(["ok" => true, "items" => []]);
    }

    // Get school year if term_id is provided
    $schoolYear = null;
    if ($termId > 0) {
      $st = $pdo->prepare("SELECT school_year FROM academic_terms WHERE id = ?");
      $st->execute([$termId]);
      $schoolYear = $st->fetchColumn();
    }

    $sql = "
      SELECT
        u.id,
        u.id_number,
        TRIM(REPLACE(CONCAT(
          COALESCE(u.first_name, ''), ' ',
          COALESCE(u.middle_name, ''), ' ',
          COALESCE(u.last_name, ''), ' ',
          COALESCE(u.suffix, '')
        ), '  ', ' ')) AS full_name,
        u.year_level,
        u.program AS program
      FROM users u
      WHERE u.role = 'student'
        AND u.status = 'Active'
        AND (
          u.id_number LIKE ?
          OR u.first_name LIKE ?
          OR u.middle_name LIKE ?
          OR u.last_name LIKE ?
          OR CONCAT(u.first_name, ' ', u.last_name) LIKE ?
        )
    ";
    $params = [$like, $like, $like, $like, $like];

    // Exclude students who are already officers in ANY organization for this SCHOOL YEAR
    if ($excludeCurrentOfficers && $schoolYear) {
      $sql .= " AND u.id NOT IN (
        SELECT DISTINCT oo.user_id 
        FROM organization_officers oo
        JOIN academic_terms t ON t.id = oo.academic_term_id
        WHERE t.school_year = ? AND oo.user_id IS NOT NULL
      )";
      $params[] = $schoolYear;
    }

    if ($filterAbbr) {
      $sql .= " AND u.program = ? ";
      $params[] = $filterAbbr;
    }

    $sql .= " ORDER BY u.last_name ASC, u.first_name ASC LIMIT $limit ";

    $st = $pdo->prepare($sql);
    $st->execute($params);
    $items = $st->fetchAll();

    foreach ($items as &$it) {
      $year = (string)($it["year_level"] ?? "");
      $yearText = $year;
      if ($year === "1") $yearText = "1st Year";
      else if ($year === "2") $yearText = "2nd Year";
      else if ($year === "3") $yearText = "3rd Year";
      else if ($year === "4") $yearText = "4th Year";
      else if ($year === "5") $yearText = "5th Year";

      $abbr = trim((string)($it["program"] ?? ""));
      $it["course_year"] = $abbr && $yearText ? ($abbr . " " . $yearText) : ($abbr ?: $yearText);
      
      // Add a note if this student was an officer in previous years
      if ($schoolYear) {
        $st = $pdo->prepare("
          SELECT COUNT(*) FROM organization_officers oo
          JOIN academic_terms t ON t.id = oo.academic_term_id
          WHERE t.school_year < ? AND oo.user_id = ?
        ");
        $st->execute([$schoolYear, $it['id']]);
        $prevYears = $st->fetchColumn();
        $it["previous_officer"] = ($prevYears > 0);
      } else {
        $it["previous_officer"] = false;
      }
    }

    out([
      "ok" => true, 
      "items" => $items,
      "school_year" => $schoolYear
    ]);
  }

  // -----------------------------------------
  // 7d) Add officer (JSON) - SCHOOL YEAR BASED VALIDATION (FIXED)
  // -----------------------------------------
  case "add_officer": {
    $orgId = (int)($payload["org_id"] ?? 0);
    $termId = (int)($payload["academic_term_id"] ?? 0);
    $userId = (int)($payload["user_id"] ?? 0);
    $position = trim((string)($payload["position"] ?? ""));

    if ($orgId <= 0 || $termId <= 0) fail("Invalid org/term id.");
    if ($userId <= 0) fail("Invalid student.");
    if ($position === "") fail("Position is required.");

    // Define allowed positions
    $allowedPositions = [
      'President / Chairperson',
      'Vice President',
      'Secretary',
      'Treasurer',
      'Auditor'
    ];
    
    if (!in_array($position, $allowedPositions, true)) {
      fail("Invalid position. Must be one of: " . implode(", ", $allowedPositions), 400);
    }

    // Check if student exists and is active
    $st = $pdo->prepare("SELECT id, role, status, first_name, last_name FROM users WHERE id = ? LIMIT 1");
    $st->execute([$userId]);
    $u = $st->fetch();
    if (!$u) fail("Selected user not found.", 404);
    if ($u["role"] !== "student") fail("Selected user is not a student.", 400);
    if ($u["status"] !== "Active") fail("Selected student is not active.", 400);

    // Get the school year for this term
    $st = $pdo->prepare("SELECT school_year FROM academic_terms WHERE id = ?");
    $st->execute([$termId]);
    $schoolYear = $st->fetchColumn();
    if (!$schoolYear) fail("Invalid academic term.", 400);

    // FIXED: Check if student is already an officer in a DIFFERENT organization in THIS SCHOOL YEAR
    $st = $pdo->prepare("
      SELECT 
        oo.id, 
        oo.position, 
        o.org_name, 
        t.semester,
        CONCAT(u.first_name, ' ', u.last_name) as current_officer_name
      FROM organization_officers oo
      JOIN organizations o ON o.id = oo.org_id
      JOIN academic_terms t ON t.id = oo.academic_term_id
      LEFT JOIN users u ON u.id = oo.user_id
      WHERE t.school_year = ? 
        AND oo.user_id = ?
        AND oo.org_id != ?  -- Only block if it's a DIFFERENT organization
      LIMIT 1
    ");
    $st->execute([$schoolYear, $userId, $orgId]);
    $existingOfficer = $st->fetch();
    
    if ($existingOfficer) {
      fail(
        "Student " . htmlspecialchars($u['first_name'] . ' ' . $u['last_name']) . 
        " is already an officer in a DIFFERENT organization '" . $existingOfficer['org_name'] . 
        "' as " . $existingOfficer["position"] . " for " . $existingOfficer['semester'] . " semester " . $schoolYear . ". " .
        "A student can only be an officer in ONE organization per academic year.", 
        400
      );
    }

    // Check if position is already taken in THIS organization for THIS TERM
    $st = $pdo->prepare("
      SELECT oo.id, CONCAT(u.first_name, ' ', u.last_name) as officer_name
      FROM organization_officers oo
      LEFT JOIN users u ON u.id = oo.user_id
      WHERE oo.org_id = ? AND oo.academic_term_id = ? AND oo.position = ?
      LIMIT 1
    ");
    $st->execute([$orgId, $termId, $position]);
    $positionTaken = $st->fetch();
    
    if ($positionTaken) {
      fail(
        "Position '" . $position . "' is already held by " . 
        htmlspecialchars($positionTaken['officer_name']) . " in this organization for this term.", 
        400
      );
    }

    // Get student's course and year for course_year field
    $st = $pdo->prepare("SELECT program, year_level FROM users WHERE id = ?");
    $st->execute([$userId]);
    $studentData = $st->fetch();
    
    $yearText = "";
    if (!empty($studentData['year_level'])) {
      $year = $studentData['year_level'];
      if ($year === "1") $yearText = "1st Year";
      else if ($year === "2") $yearText = "2nd Year";
      else if ($year === "3") $yearText = "3rd Year";
      else if ($year === "4") $yearText = "4th Year";
      else if ($year === "5") $yearText = "5th Year";
      else $yearText = $year;
    }
    
    $courseYear = trim(($studentData['program'] ?? '') . ' ' . $yearText);
    if (empty(trim($courseYear))) {
      $courseYear = null;
    }

    // Insert the new officer
    $st = $pdo->prepare("
      INSERT INTO organization_officers 
        (org_id, academic_term_id, user_id, position, full_name, course_year, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, 'Active', CURRENT_TIMESTAMP)
    ");
    
    $fullName = trim($u['first_name'] . ' ' . ($u['middle_name'] ?? '') . ' ' . $u['last_name']);
    $fullName = preg_replace('/\s+/', ' ', $fullName);
    
    $st->execute([
      $orgId, 
      $termId, 
      $userId, 
      $position, 
      $fullName, 
      $courseYear
    ]);
    
    $officerId = (int)$pdo->lastInsertId();

    // Fetch the newly created officer to return
    $st = $pdo->prepare("
      SELECT 
        oo.id,
        oo.position,
        oo.status,
        oo.user_id,
        oo.full_name,
        oo.course_year,
        u.id_number,
        u.program,
        u.year_level
      FROM organization_officers oo
      LEFT JOIN users u ON u.id = oo.user_id
      WHERE oo.id = ?
    ");
    $st->execute([$officerId]);
    $newOfficer = $st->fetch();

    out([
      "ok" => true, 
      "message" => "Officer added successfully.",
      "officer_id" => $officerId,
      "officer" => $newOfficer
    ]);
  }

    // -----------------------------------------
    // 8) Replace a returned document (multipart)
    // -----------------------------------------
    case "replace_document": {
      $docId = (int)($_POST["doc_id"] ?? 0);
      if ($docId <= 0) fail("Invalid document id.");

      if (empty($_FILES["file"]) || !is_uploaded_file($_FILES["file"]["tmp_name"])) {
        fail("No file uploaded.");
      }

      $sql = "
        SELECT d.id, d.request_id, d.requirement_id, d.status AS doc_status,
               ar.status AS req_status, ar.coordinator_user_id
        FROM accreditation_request_documents d
        JOIN accreditation_requests ar ON ar.id = d.request_id
        WHERE d.id = ?
        LIMIT 1
      ";
      $st = $pdo->prepare($sql);
      $st->execute([$docId]);
      $row = $st->fetch();
      if (!$row) fail("Document not found.", 404);
      if ((int)$row["coordinator_user_id"] !== $uid) fail("Forbidden.", 403);

      $docReturned = strcasecmp((string)$row["doc_status"], "Returned") === 0;
      $reqReturned = strcasecmp((string)$row["req_status"], "Returned") === 0;
      if (!$docReturned && !$reqReturned) {
        fail("This document is not marked as Returned.", 403);
      }

      $f = $_FILES["file"];
      if ($f["error"] !== UPLOAD_ERR_OK) fail("Upload failed.");

      $orig = (string)($f["name"] ?? "file");
      $ext = strtolower(pathinfo($orig, PATHINFO_EXTENSION));
      $allowed = ["pdf", "docx", "png", "jpg", "jpeg", "webp"];
      if (!in_array($ext, $allowed, true)) fail("Invalid file type.");

      $requestId = (int)$row["request_id"];
      $rid = (int)$row["requirement_id"];

      $baseDirRel = "assets/uploads/accreditation/{$requestId}/req_{$rid}";
      $baseDirFs = __DIR__ . "/../" . $baseDirRel;
      if (!ensure_dir($baseDirFs)) fail("Cannot create upload directory.", 500);

      $safe = safe_filename(pathinfo($orig, PATHINFO_FILENAME));
      $fname = "replace_req{$rid}_" . date("Ymd_His") . "_" . bin2hex(random_bytes(4)) . "_" . $safe . "." . $ext;
      $destFs = $baseDirFs . "/" . $fname;

      if (!move_uploaded_file((string)$f["tmp_name"], $destFs)) fail("Failed to save file.", 500);

      $publicPath = to_public_path($baseDirRel . "/" . $fname);

      $upd = "
        UPDATE accreditation_request_documents
        SET file_path = ?, file_name = ?, status = 'Submitted',
            reviewed_by = NULL, reviewed_at = NULL, return_reason = NULL,
            uploaded_at = CURRENT_TIMESTAMP
        WHERE id = ?
      ";
      $st = $pdo->prepare($upd);
      $st->execute([$publicPath, $orig, $docId]);

      $pdo->prepare("UPDATE accreditation_requests SET updated_at = CURRENT_TIMESTAMP, status='Pending' WHERE id = ?")
        ->execute([$requestId]);

      $specialAdminId = get_active_special_admin($pdo);
      if ($specialAdminId) {
        add_notification(
          $pdo,
          $specialAdminId,
          $uid,
          "Document Replaced - Requires Review",
          "A document has been replaced for accreditation request #{$requestId} by {$user['first_name']} {$user['last_name']}. The request status has been reset to Pending.",
          'accreditation',
          $requestId
        );
      }

      add_notification(
        $pdo,
        $uid,
        $uid,
        "Document Replaced",
        "You have successfully replaced the document for requirement #{$rid}. The request status has been reset to Pending.",
        'accreditation',
        $requestId
      );

      out(["ok" => true, "message" => "Document replaced."]);
    }

    default:
      fail("Unknown action: " . $action, 400);
  }
} catch (Throwable $e) {
  fail($e->getMessage(), 500);
}
