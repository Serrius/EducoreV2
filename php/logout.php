<?php
declare(strict_types=1);

// Start session
if (session_status() === PHP_SESSION_NONE) {
    session_start();
}

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-cache, must-revalidate');

$response = [
    'success' => false,
    'message' => 'Logout failed'
];

try {
    // Clear all session variables
    $_SESSION = [];
    
    // Delete session cookie
    if (ini_get('session.use_cookies')) {
        $params = session_get_cookie_params();
        setcookie(
            session_name(),
            '',
            time() - 42000,
            $params['path'],
            $params['domain'],
            $params['secure'],
            $params['httponly']
        );
    }
    
    // Destroy session
    if (session_destroy()) {
        $response['success'] = true;
        $response['message'] = 'Logout successful';
    }
    
    // Also unset all session variables
    session_unset();
    
} catch (Exception $e) {
    $response['message'] = 'Error during logout: ' . $e->getMessage();
}

echo json_encode($response);
exit;
?>