<?php
declare(strict_types=1);

/**
 * Shared helpers for Event Expenses PDF printing (mPDF).
 * Place this file in: php/_mpdf_common.php
 *
 * Includes:
 * - Autoload discovery for mPDF
 * - Letterhead support (header/footer images)
 * - Permission helpers
 * - Event fetch helpers
 * - Signature helpers (schema-resilient + base64 embedding)
 */

if (session_status() === PHP_SESSION_NONE) {
  session_start();
}

/* -------------------------
   DB bootstrap (PDO)
------------------------- */
require_once __DIR__ . '/db.php'; // expects $pdo (PDO)

if (!isset($pdo) || !($pdo instanceof PDO)) {
  http_response_code(500);
  header('Content-Type: text/plain; charset=utf-8');
  echo 'PDO not initialized. Check php/db.php (expected $pdo).';
  exit;
}

if (!defined('APP_ROOT')) {
  // APP_ROOT => project root (folder that contains assets/, vendor/, php/, etc.)
  define('APP_ROOT', realpath(__DIR__ . '/..') ?: (__DIR__ . '/..'));
}

/* -------------------------
   Composer autoload (mPDF)
------------------------- */
$autoloadCandidates = [
  APP_ROOT . '/vendor/autoload.php',
  __DIR__ . '/../vendor/autoload.php',
  APP_ROOT . '/../vendor/autoload.php',
];

$autoload = null;
foreach ($autoloadCandidates as $p) {
  if (is_file($p)) { $autoload = $p; break; }
}

if (!$autoload) {
  http_response_code(500);
  header('Content-Type: text/plain; charset=utf-8');
  echo "Composer autoload.php not found.\n\nChecked:\n- " . implode("\n- ", $autoloadCandidates) . "\n\n";
  echo "Fix:\n1) Go to your project root (APP_ROOT): " . APP_ROOT . "\n2) Run: composer install\n";
  exit;
}

require_once $autoload;

if (!class_exists(\Mpdf\Mpdf::class)) {
  http_response_code(500);
  header('Content-Type: text/plain; charset=utf-8');
  echo "mPDF not installed or not autoloadable.\nRun:\n  composer require mpdf/mpdf\n";
  exit;
}

use Mpdf\Mpdf;

/* -------------------------
   Small helpers
------------------------- */
function ee_html_escape(string $s): string {
  return htmlspecialchars($s, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
}
function ee_h($s): string {
  return ee_html_escape((string)($s ?? ''));
}

/* -------------------------
   App path helpers
------------------------- */
function ee_app_base(): string {
  $script = (string)($_SERVER['SCRIPT_NAME'] ?? '');
  $dir = rtrim(str_replace('\\', '/', dirname($script)), '/');
  if (preg_match('~/php$~', $dir)) $dir = preg_replace('~/php$~', '', $dir) ?: '';
  return $dir === '' ? '' : $dir;
}

/** Convert stored rel path -> browser URL */
function ee_public_url(?string $relPath): ?string {
  $rel = trim((string)($relPath ?? ''));
  if ($rel === '') return null;
  $rel = ltrim($rel, '/');
  $base = ee_app_base();
  return ($base === '' ? '' : $base) . '/' . $rel;
}

/* -------------------------
   Auth
------------------------- */
function ee_current_user_id(): int {
  if (!empty($_SESSION['user_id'])) return (int)$_SESSION['user_id'];
  if (!empty($_SESSION['id'])) return (int)$_SESSION['id'];
  if (!empty($_SESSION['user']['id'])) return (int)$_SESSION['user']['id'];
  return 0;
}
function ee_current_role(): string {
  return strtolower((string)($_SESSION['role'] ?? ($_SESSION['user']['role'] ?? '')));
}
function ee_require_login(): void {
  if (ee_current_user_id() <= 0) {
    http_response_code(401);
    header('Content-Type: text/plain; charset=utf-8');
    echo 'Not authenticated.';
    exit;
  }
}

/* -------------------------
   Role rules (match event-expenses.php)
------------------------- */
function ee_can_review_events_role(string $role): bool {
  $role = strtolower($role);
  return in_array($role, ['super_admin', 'overseer', 'special_admin', 'faculty_admin', 'moderator'], true);
}
function ee_is_officer_role(string $role): bool {
  $role = strtolower($role);
  return in_array($role, ['org_president', 'treasurer', 'org_officer', 'officer'], true);
}

/**
 * Map event term (start/end/active_year) -> academic_terms.id
 * Uses same matching rules you used elsewhere.
 */
function ee_event_term_id(PDO $pdo, array $event): int {
  $eid = (int)($event['id'] ?? 0);
  if ($eid <= 0) return 0;

  $st = $pdo->prepare("
    SELECT t.id
    FROM event_events e
    INNER JOIN academic_terms t
      ON t.school_year = CONCAT(e.start_year,'-',e.end_year)
     AND (
          (LOWER(t.semester) IN ('1st','1st semester','first','first semester') AND e.active_year=1)
       OR (LOWER(t.semester) IN ('2nd','2nd semester','second','second semester') AND e.active_year=2)
       OR (LOWER(t.semester)='summer' AND e.active_year=3)
       OR (CAST(t.semester AS CHAR) = CAST(e.active_year AS CHAR))
     )
    WHERE e.id=:eid
    LIMIT 1
  ");
  $st->execute([':eid' => $eid]);
  return (int)($st->fetchColumn() ?: 0);
}

/**
 * Student officer check is term-specific in your schema.
 */
function ee_is_student_officer_for_event_term(PDO $pdo, int $orgId, int $userId, int $eventId): bool {
  if ($orgId <= 0 || $userId <= 0 || $eventId <= 0) return false;

  $st = $pdo->prepare("
    SELECT t.id
    FROM event_events e
    INNER JOIN academic_terms t
      ON t.school_year = CONCAT(e.start_year,'-',e.end_year)
     AND (
          (LOWER(t.semester) IN ('1st','1st semester','first','first semester') AND e.active_year=1)
       OR (LOWER(t.semester) IN ('2nd','2nd semester','second','second semester') AND e.active_year=2)
       OR (LOWER(t.semester)='summer' AND e.active_year=3)
       OR (CAST(t.semester AS CHAR) = CAST(e.active_year AS CHAR))
     )
    WHERE e.id=:eid
    LIMIT 1
  ");
  $st->execute([':eid' => $eventId]);
  $termId = (int)($st->fetchColumn() ?: 0);
  if ($termId <= 0) return false;

  $st2 = $pdo->prepare("
    SELECT 1
    FROM organization_officers oo
    WHERE oo.org_id=:org
      AND oo.academic_term_id=:tid
      AND oo.user_id=:uid
      AND oo.status='Active'
    LIMIT 1
  ");
  $st2->execute([':org'=>$orgId, ':tid'=>$termId, ':uid'=>$userId]);
  return (bool)$st2->fetchColumn();
}

function ee_can_view_event(PDO $pdo, array $event): bool {
  $uid = ee_current_user_id();
  $role = ee_current_role();

  if ($uid <= 0) return false;

  if (ee_can_review_events_role($role)) return true;

  if (ee_is_officer_role($role)) return true;

  if ($role === 'student') {
    $orgId = (int)($event['org_id'] ?? 0);
    return ee_is_student_officer_for_event_term($pdo, $orgId, $uid, (int)($event['id'] ?? 0));
  }

  return false;
}

/* -------------------------
   Data fetch helpers
------------------------- */
function ee_fetch_event(PDO $pdo, int $eventId): ?array {
  $st = $pdo->prepare("
    SELECT e.*,
           o.org_name, o.abbreviation
    FROM event_events e
    LEFT JOIN organizations o ON o.id=e.org_id
    WHERE e.id=:id
    LIMIT 1
  ");
  $st->execute([':id'=>$eventId]);
  $e = $st->fetch(PDO::FETCH_ASSOC);
  if (!$e) return null;

  $e['id'] = (int)$e['id'];
  $e['org_id'] = $e['org_id'] !== null ? (int)$e['org_id'] : 0;
  $e['active_year'] = (int)($e['active_year'] ?? 1);
  $e['start_year'] = (int)($e['start_year'] ?? 0);
  $e['end_year'] = (int)($e['end_year'] ?? 0);

  $orgLabel = '';
  if (!empty($e['org_name'])) {
    $orgLabel = trim((string)$e['org_name'] . (!empty($e['abbreviation']) ? ' (' . (string)$e['abbreviation'] . ')' : ''));
  }
  $e['org_label'] = $orgLabel;

  return $e;
}

function ee_money(float $n): string {
  return '₱' . number_format($n, 2);
}
function ee_semester_label_from_active_year(int $ay): string {
  if ($ay === 2) return '2nd Semester';
  if ($ay === 3) return 'Summer';
  return '1st Semester';
}

function ee_fetch_credits(PDO $pdo, int $eventId): array {
  $st = $pdo->prepare("
    SELECT id, credit_date, source, notes, amount, recorded_by_user_id, created_at
    FROM event_credits
    WHERE event_id=:eid
    ORDER BY credit_date ASC, id ASC
  ");
  $st->execute([':eid'=>$eventId]);
  return $st->fetchAll(PDO::FETCH_ASSOC) ?: [];
}

function ee_fetch_debits(PDO $pdo, int $eventId): array {
  $st = $pdo->prepare("
    SELECT id, debit_date, category, notes, amount, unit_price, quantity, receipt_number, receipt_path, recorded_by_user_id, created_at
    FROM event_debits
    WHERE event_id=:eid
    ORDER BY debit_date ASC, id ASC
  ");
  $st->execute([':eid'=>$eventId]);
  return $st->fetchAll(PDO::FETCH_ASSOC) ?: [];
}

function ee_fetch_ledger(PDO $pdo, int $eventId): array {
  $st = $pdo->prepare("
    SELECT id, txn_date, txn_type, title, notes, amount_in, amount_out, balance_after, ref_table, ref_id
    FROM passbook_logs
    WHERE event_id=:eid
    ORDER BY txn_date ASC, id ASC
    LIMIT 5000
  ");
  $st->execute([':eid'=>$eventId]);
  return $st->fetchAll(PDO::FETCH_ASSOC) ?: [];
}

function ee_totals(PDO $pdo, int $eventId): array {
  $stC = $pdo->prepare("SELECT COALESCE(SUM(amount),0) s FROM event_credits WHERE event_id=:eid");
  $stC->execute([':eid'=>$eventId]);
  $credits = (float)($stC->fetchColumn() ?: 0);

  $stD = $pdo->prepare("SELECT COALESCE(SUM(amount),0) s FROM event_debits WHERE event_id=:eid");
  $stD->execute([':eid'=>$eventId]);
  $debits = (float)($stD->fetchColumn() ?: 0);

  return ['credits'=>$credits, 'debits'=>$debits, 'balance'=>$credits-$debits];
}

/* -------------------------
   Signature helpers (like your receipt)
------------------------- */

/** Base64 image tag for stored relative paths (assets/uploads/...) */
function ee_img_tag_base64(string $relativePath, string $className = '', string $alt = ''): string {
  $p = trim($relativePath);
  if ($p === '') return '';
  if (preg_match('~^https?://~i', $p)) return '';

  $p = str_replace('\\', '/', $p);
  $fsPath = realpath(APP_ROOT . '/' . ltrim($p, '/'));
  if (!$fsPath || !is_file($fsPath)) return '';

  $ext = strtolower(pathinfo($fsPath, PATHINFO_EXTENSION));
  if ($ext === 'jpg') $ext = 'jpeg';
  if (!in_array($ext, ['png', 'jpeg', 'gif', 'webp'], true)) return '';

  $mime = 'image/' . $ext;
  $data = base64_encode((string)file_get_contents($fsPath));

  $cls = $className !== '' ? ' class="' . ee_h($className) . '"' : '';
  $altEsc = ee_h($alt);

  return '<img src="data:' . $mime . ';base64,' . $data . '"' . $cls . ' alt="' . $altEsc . '">';
}

function ee_school_year_for_term(PDO $pdo, int $termId): string {
  if ($termId <= 0) return '';
  $st = $pdo->prepare("SELECT school_year FROM academic_terms WHERE id = :id LIMIT 1");
  $st->execute([':id' => $termId]);
  $r = $st->fetch(PDO::FETCH_ASSOC);
  return trim((string)($r['school_year'] ?? ''));
}

/**
 * Officer lookup: exact term first, then same school_year fallback
 * (same logic you showed).
 */
function ee_get_officer(PDO $pdo, int $orgId, int $termId, string $roleLike): ?array {
  $pos = '%' . mb_strtolower($roleLike) . '%';

  // 1) exact term match
  $st = $pdo->prepare("
    SELECT
      oo.user_id,
      COALESCE(NULLIF(oo.full_name, ''), CONCAT_WS(' ',
        NULLIF(u.first_name, ''),
        CASE WHEN u.middle_name IS NULL OR u.middle_name = '' THEN NULL ELSE CONCAT(LEFT(u.middle_name, 1), '.') END,
        NULLIF(u.last_name, ''),
        NULLIF(u.suffix, '')
      )) AS full_name,
      oo.position
    FROM organization_officers oo
    LEFT JOIN users u ON u.id = oo.user_id
    WHERE oo.org_id = :org_id
      AND oo.academic_term_id = :term_id
      AND oo.status = 'Active'
      AND LOWER(oo.position) LIKE :pos
    ORDER BY oo.id DESC
    LIMIT 1
  ");
  $st->execute([
    ':org_id' => $orgId,
    ':term_id' => $termId,
    ':pos' => $pos,
  ]);
  $r = $st->fetch(PDO::FETCH_ASSOC);
  if ($r) return $r;

  // 2) school_year fallback
  $sy = ee_school_year_for_term($pdo, $termId);
  if ($sy === '') return null;

  $st2 = $pdo->prepare("
    SELECT
      oo.user_id,
      COALESCE(NULLIF(oo.full_name, ''), CONCAT_WS(' ',
        NULLIF(u.first_name, ''),
        CASE WHEN u.middle_name IS NULL OR u.middle_name = '' THEN NULL ELSE CONCAT(LEFT(u.middle_name, 1), '.') END,
        NULLIF(u.last_name, ''),
        NULLIF(u.suffix, '')
      )) AS full_name,
      oo.position,
      t.school_year,
      oo.academic_term_id
    FROM organization_officers oo
    INNER JOIN academic_terms t ON t.id = oo.academic_term_id
    LEFT JOIN users u ON u.id = oo.user_id
    WHERE oo.org_id = :org_id
      AND oo.status = 'Active'
      AND t.school_year = :sy
      AND LOWER(oo.position) LIKE :pos
    ORDER BY oo.academic_term_id DESC, oo.id DESC
    LIMIT 1
  ");
  $st2->execute([
    ':org_id' => $orgId,
    ':sy' => $sy,
    ':pos' => $pos,
  ]);
  $r2 = $st2->fetch(PDO::FETCH_ASSOC);
  return $r2 ?: null;
}

/**
 * Signature lookup (schema-resilient).
 * Picks first existing column among: signature_file, signature_path, file_path, path, file
 */
function ee_get_active_signature_file(PDO $pdo, int $userId): ?string {
  if ($userId <= 0) return null;

  try {
    $cols = [];
    $st = $pdo->query("SHOW COLUMNS FROM e_signatures");
    while ($r = $st->fetch(PDO::FETCH_ASSOC)) {
      $cols[strtolower((string)$r['Field'])] = true;
    }

    $pickFirst = function(array $candidates) use ($cols): ?string {
      foreach ($candidates as $c) {
        if (isset($cols[strtolower($c)])) return $c;
      }
      return null;
    };

    $sigCol = $pickFirst(['signature_file', 'signature_path', 'file_path', 'path', 'file']);
    if (!$sigCol) return null;

    $hasUpdated = isset($cols['updated_at']);
    $hasCreated = isset($cols['created_at']);

    $order = "id DESC";
    if ($hasUpdated) $order = "updated_at DESC, id DESC";
    else if ($hasCreated) $order = "created_at DESC, id DESC";

    $sql = "
      SELECT {$sigCol}
      FROM e_signatures
      WHERE user_id = :uid
        AND status = 'Active'
      ORDER BY {$order}
      LIMIT 1
    ";
    $q = $pdo->prepare($sql);
    $q->execute([':uid' => $userId]);
    $f = $q->fetchColumn();

    $val = is_string($f) ? trim($f) : '';
    return $val !== '' ? $val : null;

  } catch (\Throwable $e) {
    return null;
  }
}

/* -------------------------
   Letterhead support
------------------------- */
function ee_letterhead_assets(): array {
  $candidatesHeader = [
    APP_ROOT . '/assets/templates/letterhead-header.png',
    APP_ROOT . '/assets/templates/letterhead-header.jpg',
    APP_ROOT . '/assets/templates/letterhead-header.jpeg',
  ];
  $candidatesFooter = [
    APP_ROOT . '/assets/templates/letterhead-footer.png',
    APP_ROOT . '/assets/templates/letterhead-footer.jpg',
    APP_ROOT . '/assets/templates/letterhead-footer.jpeg',
  ];
  $candidatesSingle = [
    APP_ROOT . '/assets/img/letterhead.png',
    APP_ROOT . '/assets/img/letterhead.jpg',
    APP_ROOT . '/assets/img/letterhead.jpeg',
  ];

  $header = null;
  foreach ($candidatesHeader as $p) { if (is_file($p)) { $header = $p; break; } }

  $footer = null;
  foreach ($candidatesFooter as $p) { if (is_file($p)) { $footer = $p; break; } }

  $single = null;
  foreach ($candidatesSingle as $p) { if (is_file($p)) { $single = $p; break; } }

  return ['header'=>$header, 'footer'=>$footer, 'single'=>$single];
}

function ee_apply_letterhead(Mpdf $mpdf): void {
  $a = ee_letterhead_assets();
  $header = $a['header'];
  $footer = $a['footer'];
  $single = $a['single'];

  if ($header) {
    $mpdf->SetHTMLHeader(
      "<div style=\"text-align:center;\"><img src=\"{$header}\" style=\"width:100%; height:auto;\" /></div>"
    );
  } elseif ($single) {
    $mpdf->SetHTMLHeader(
      "<div style=\"text-align:center;\"><img src=\"{$single}\" style=\"width:100%; height:auto;\" /></div>"
    );
  }

  if ($footer) {
    $mpdf->SetHTMLFooter(
      "<div style=\"text-align:center;\"><img src=\"{$footer}\" style=\"width:100%; height:auto;\" /></div>"
    );
  }
}

function ee_mpdf(bool $withLetterhead = false): Mpdf {
  $left = 14;
  $right = 14;

  // Reserve space for letterhead images when enabled.
  $top = $withLetterhead ? 60 : 18;
  $bottom = $withLetterhead ? 40 : 18;

  $mpdf = new Mpdf([
    'format'        => 'A4',
    'margin_left'   => $left,
    'margin_right'  => $right,
    'margin_top'    => $top,
    'margin_bottom' => $bottom,
    'margin_header' => 0,
    'margin_footer' => 0,
    'default_font'  => 'dejavusans',
  ]);

  if ($withLetterhead) ee_apply_letterhead($mpdf);

  return $mpdf;
}

/* -------------------------
   Styling
------------------------- */
function ee_base_css(): string {
  return "
    <style>
      * { font-family: dejavusans, sans-serif; }
      .muted { color: #666; }
      .h1 { font-size: 16px; font-weight: 700; margin: 0 0 8px 0; }
      .h2 { font-size: 13px; font-weight: 700; margin: 16px 0 8px 0; }
      .meta { font-size: 11px; margin: 0 0 10px 0; }
      .badge { display:inline-block; padding:2px 6px; border-radius: 4px; font-size: 10px; border:1px solid #999; }
      table { width: 100%; border-collapse: collapse; font-size: 10.5px; }
      th, td { border: 1px solid #bbb; padding: 6px 6px; vertical-align: top; }
      th { background: #f2f2f2; font-weight: 700; }
      .text-right { text-align: right; }
      .text-center { text-align: center; }
      .no-border td, .no-border th { border: 0 !important; }
      .totals td { font-weight: 700; }
      .hr { border-top: 1px solid #bbb; margin: 10px 0; }
      .small { font-size: 10px; }
      .footer { font-size: 9px; color: #777; }

      /* Signature styles (receipt-style) */
      .sig-img { max-width: 160px; max-height: 45px; display: block; margin: 0 auto 4px auto; object-fit: contain; }
      .sign-line { width: 170px; margin: 0 auto 4px auto; font-size: 12px; letter-spacing: 1px; font-family: \"Courier New\", monospace; }
      .sign-name { font-size: 11px; font-weight: 600; margin-top: 2px; }
      .sign-label { font-size: 11px; }
    </style>
  ";
}

function ee_stamp_line(): string {
  $now = date('Y-m-d H:i');
  return "Generated: " . ee_html_escape($now);
}