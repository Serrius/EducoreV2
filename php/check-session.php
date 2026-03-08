<?php
declare(strict_types=1);

// Start session properly
if (session_status() === PHP_SESSION_NONE) {
    session_start();
}

// Set headers
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-cache, must-revalidate');

$response = [
    'logged_in' => false,
    'user_id' => null,
    'role' => null,
    'is_officer' => false,
    'timestamp' => time()
];

// Check if session exists and has user data
if (isset($_SESSION['user_id']) && !empty($_SESSION['user_id'])) {
    $response['logged_in'] = true;
    $response['user_id'] = $_SESSION['user_id'];
    $response['role'] = $_SESSION['role'] ?? null;
    $response['is_officer'] = $_SESSION['is_officer'] ?? false;
    
    // Refresh session last activity time
    $_SESSION['last_activity'] = time();
}

// Add debug info if requested
if (isset($_GET['debug'])) {
    $response['session_id'] = session_id();
    $response['session_data'] = $_SESSION;
    $response['session_status'] = session_status();
}

echo json_encode($response);
exit;
?>