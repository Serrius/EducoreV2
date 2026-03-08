<?php
declare(strict_types=1);

$host = "localhost";
$db   = "educorev2";
$user = "karl";
$pass = "bedB.MraSDI^";
$charset = "utf8mb4";

/* =========================
   PDO (preferred)
   ========================= */
$dsn = "mysql:host=$host;dbname=$db;charset=$charset";
$options = [
  PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
  PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
  PDO::ATTR_EMULATE_PREPARES   => false,
];

try {
  $pdo = new PDO($dsn, $user, $pass, $options);
} catch (PDOException $e) {
  // Avoid leaking details in production
  die("Database connection failed.");
}

/* =========================
   mysqli (compat for older endpoints)
   - accreditation-special.php expects $mysqli
   ========================= */
$mysqli = @new mysqli($host, $user, $pass, $db);
if ($mysqli->connect_error) {
  die("Database connection failed.");
}
$mysqli->set_charset($charset);
