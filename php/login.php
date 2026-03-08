<?php
declare(strict_types=1);

session_start();
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');

require_once __DIR__ . '/db.php'; // expects $pdo

function out(bool $ok, string $msg = '', array $extra = []): void {
  http_response_code($ok ? 200 : 400);
  echo json_encode(array_merge([
    'success' => $ok,
    'message' => $msg
  ], $extra), JSON_UNESCAPED_SLASHES);
  exit;
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
  out(false, 'Invalid request method.');
}

$raw = file_get_contents('php://input');
$data = json_decode($raw, true);

if (!is_array($data)) {
  out(false, 'Invalid JSON payload.');
}

$idNumber = trim((string)($data['username'] ?? '')); // username = ID number
$password = (string)($data['password'] ?? '');

if ($idNumber === '' || $password === '') {
  out(false, 'Please enter your ID number and password.');
}

try {
  // ensure utf8mb4 (ignore failure)
  try { $pdo->exec("SET NAMES utf8mb4"); } catch (Throwable $e) {}

  $stmt = $pdo->prepare("
    SELECT id, id_number, first_name, middle_name, last_name, suffix,
           email, program, year_level, school_year,
           password_hash, role, status
    FROM users
    WHERE id_number = :idnum
    LIMIT 1
  ");
  $stmt->execute(['idnum' => $idNumber]);
  $user = $stmt->fetch(PDO::FETCH_ASSOC);

  if (!$user) out(false, 'Invalid ID number or password.');
  if ((string)$user['status'] !== 'Active') out(false, 'Account is inactive.');

  if (!password_verify($password, (string)$user['password_hash'])) {
    out(false, 'Invalid ID number or password.');
  }

  // -----------------------------
  // Officer detection (SAME school_year as ACTIVE term)
  // Goal: if user is an officer in 1st OR 2nd (or Summer) of the active school year,
  // treat them as officer regardless of which semester is currently Active.
  // -----------------------------
  $effectiveRole = (string)$user['role'];
  $roleLower = strtolower($effectiveRole);

  $isOfficer = false;
  $officerTermId = null;
  $officerPosition = null;
  $officerSchoolYear = null;

  // get ACTIVE academic term (id + school_year)
  $stTerm = $pdo->prepare("
    SELECT id, school_year
    FROM academic_terms
    WHERE status = 'Active'
    ORDER BY id DESC
    LIMIT 1
  ");
  $stTerm->execute();
  $activeTerm = $stTerm->fetch(PDO::FETCH_ASSOC);

  $activeTermId = (int)($activeTerm['id'] ?? 0);
  $activeSchoolYear = (string)($activeTerm['school_year'] ?? '');

  if ($activeTermId > 0 && $activeSchoolYear !== '') {
    // Find officer record for THIS USER in ANY term under the SAME school_year
    // (so officers from 1st/2nd remain officers even when the other semester is active)
    $stOff = $pdo->prepare("
      SELECT oo.academic_term_id, oo.position, at.school_year
      FROM organization_officers oo
      INNER JOIN academic_terms at ON at.id = oo.academic_term_id
      WHERE oo.user_id = :uid
        AND oo.status = 'Active'
        AND at.school_year = :sy
      ORDER BY oo.created_at DESC, oo.id DESC
      LIMIT 1
    ");
    $stOff->execute([
      ':uid' => (int)$user['id'],
      ':sy'  => $activeSchoolYear
    ]);

    $offRow = $stOff->fetch(PDO::FETCH_ASSOC);
    $orgName = '';
    $orgAbbr = '';

    if ($offRow && !empty($offRow['position'])) {
        // Get organization details for this officer
        $stOrg = $pdo->prepare("
            SELECT o.org_name, o.abbreviation 
            FROM organization_officers oo
            JOIN organizations o ON o.id = oo.org_id
            WHERE oo.user_id = :uid 
              AND oo.academic_term_id = :term_id
            LIMIT 1
        ");
        $stOrg->execute([
            ':uid' => (int)$user['id'],
            ':term_id' => (int)$offRow['academic_term_id']
        ]);
        $orgData = $stOrg->fetch(PDO::FETCH_ASSOC);
        
        if ($orgData) {
            $orgName = $orgData['org_name'];
            $orgAbbr = $orgData['abbreviation'];
        }
        
        $isOfficer = true;
        $officerTermId = (int)$offRow['academic_term_id'];
        $officerPosition = (string)$offRow['position'];
        $officerSchoolYear = (string)$offRow['school_year'];
        
        // Add org info to session
        $_SESSION['officer_org_name'] = $orgName;
        $_SESSION['officer_org_abbreviation'] = $orgAbbr;
        
        // Only elevate STUDENTS to Officer
        if ($roleLower === 'student') {
            $effectiveRole = 'Officer';
        }
    }
  }

  // -----------------------------
  // E-signature: set ONLY when user is NOT an officer
  // -----------------------------
  $signatureFile = null;

  if (!$isOfficer) {
    $stSig = $pdo->prepare("
      SELECT signature_file
      FROM e_signatures
      WHERE user_id = :uid
        AND status = 'Active'
      ORDER BY updated_at DESC, id DESC
      LIMIT 1
    ");
    $stSig->execute([':uid' => (int)$user['id']]);
    $signatureFile = $stSig->fetchColumn() ?: null;

    $_SESSION['signature_file'] = $signatureFile;
  } else {
    unset($_SESSION['signature_file']);
  }

  // -----------------------------
  // Session set
  // -----------------------------
  $_SESSION['user_id'] = (int)$user['id'];
  $_SESSION['role'] = $effectiveRole;
  $_SESSION['is_officer'] = $isOfficer ? 1 : 0;

  // keep these for UI/display/filters
  $_SESSION['active_term_id'] = $activeTermId;
  $_SESSION['active_school_year'] = $activeSchoolYear;

  $_SESSION['officer_term_id'] = $officerTermId;           // may be 1st/2nd term id
  $_SESSION['officer_position'] = $officerPosition;
  $_SESSION['officer_school_year'] = $officerSchoolYear;

  // update last login (ignore if column doesn't exist)
  try {
    $pdo->prepare("UPDATE users SET last_login_at = NOW() WHERE id = :id")
        ->execute(['id' => (int)$user['id']]);
  } catch (Throwable $e) {
    // ignore
  }

  $fullName = trim(
    (string)$user['first_name'] . ' ' .
    (!empty($user['middle_name']) ? (string)$user['middle_name'] . ' ' : '') .
    (string)$user['last_name'] .
    (!empty($user['suffix']) ? ' ' . (string)$user['suffix'] : '')
  );

  out(true, 'Login successful.', [
    'id' => (int)$user['id'],
    'full_name' => $fullName,

    'role' => $effectiveRole,               // "Officer" only if elevated
    'raw_role' => (string)$user['role'],    // original DB role

    'is_officer' => $isOfficer,
    'active_term_id' => $activeTermId,
    'active_school_year' => $activeSchoolYear,

    // officer details (can come from 1st or 2nd sem as long as school_year matches active school_year)
    'officer_term_id' => $officerTermId,
    'officer_position' => $officerPosition,
    'officer_school_year' => $officerSchoolYear,

    'officer_org_name' => $orgName,
    'officer_org_abbreviation' => $orgAbbr,

    // only if NOT officer
    'signature_file' => $signatureFile,

    'first_name' => (string)$user['first_name'],
    'program' => $user['program'],
    'year_level' => $user['year_level'],
    'school_year' => $user['school_year'],
    'email' => $user['email']
  ]);

} catch (Throwable $e) {
  out(false, 'Server error in login.php.');
}