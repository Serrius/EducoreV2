<?php
declare(strict_types=1);

// Start session if not already started
if (session_status() === PHP_SESSION_NONE) {
    session_start();
}

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-cache, must-revalidate, private');
header('Pragma: no-cache');
header('Expires: 0');

$response = [
    'success' => false,
    'message' => 'Logout failed',
    'timestamp' => time()
];

try {
    // Log logout attempt for debugging (optional - remove in production)
    error_log('Logout initiated for user: ' . ($_SESSION['user_id'] ?? 'unknown'));
    
    // Clear all session variables
    $_SESSION = [];
    
    // Delete session cookie if cookies are used
    if (ini_get('session.use_cookies')) {
        $params = session_get_cookie_params();
        setcookie(
            session_name(),
            '',
            time() - 42000, // Set in the past to expire
            $params['path'],
            $params['domain'],
            $params['secure'],
            $params['httponly']
        );
        
        // Also clear any custom cookies if needed
        setcookie('remember_token', '', time() - 42000, '/');
        setcookie('user_id', '', time() - 42000, '/');
    }
    
    // Destroy the session
    if (session_destroy()) {
        $response['success'] = true;
        $response['message'] = 'Logout successful';
        
        // Log successful logout
        error_log('Logout successful');
    } else {
        // If session_destroy fails, at least try to unset
        session_unset();
        $response['success'] = true;
        $response['message'] = 'Logout completed (session cleanup)';
        error_log('Logout completed with session_unset fallback');
    }
    
    // Additional security: regenerate session ID one last time
    if (session_status() === PHP_SESSION_ACTIVE) {
        session_regenerate_id(true);
    }
    
    // Add response headers to prevent caching
    header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
    header('Pragma: no-cache');
    
} catch (Exception $e) {
    error_log('Logout error: ' . $e->getMessage());
    $response['message'] = 'Error during logout: ' . $e->getMessage();
    $response['error_details'] = $e->getMessage();
    http_response_code(500);
}

// Output JSON response
echo json_encode($response, JSON_UNESCAPED_SLASHES);
exit;
?>