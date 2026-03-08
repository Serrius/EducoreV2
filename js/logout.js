/**
 * Logout functionality for EduCore
 * Handles session timeout and manual logout
 */

(function() {
    'use strict';

    // Configuration
    const LOGOUT_CONFIG = {
        sessionCheckInterval: 500, // Check session every 0.5 sec (500 ms)
        loginPageUrl: 'index.html',
        logoutEndpoint: 'php/logout.php',
        sessionCheckEndpoint: 'php/check-session.php',
        debug: true // Set to false in production
    };

    let sessionChecker = null;
    let isLoggingOut = false;
    let consecutiveFailures = 0;
    const MAX_FAILURES = 3;
    let lastValidSession = Date.now();

    // Initialize logout functionality
    function initLogout() {
        console.log('Logout system initialized');
        
        // Add logout button event listener
        const logoutBtn = document.getElementById('logOutBtn');
        if (logoutBtn) {
            logoutBtn.addEventListener('click', handleLogout);
        }

        // Add logout links from dropdown
        document.querySelectorAll('.logout-link').forEach(link => {
            link.addEventListener('click', (e) => {
                e.preventDefault();
                showLogoutConfirmation();
            });
        });

        // Check session on page load (with delay)
        setTimeout(() => checkSession(), 1000);

        // Start periodic session checker
        startSessionChecker();

        // Add activity listeners to reset on user interaction
        ['click', 'mousemove', 'keypress', 'scroll', 'touchstart'].forEach(event => {
            document.addEventListener(event, () => {
                lastValidSession = Date.now();
            });
        });
    }

    // Start periodic session checker
    function startSessionChecker() {
        if (sessionChecker) {
            clearInterval(sessionChecker);
        }
        sessionChecker = setInterval(() => checkSession(), LOGOUT_CONFIG.sessionCheckInterval);
    }

    // Show logout confirmation modal
    function showLogoutConfirmation() {
        const logoutModal = new bootstrap.Modal(document.getElementById('logoutModal'));
        logoutModal.show();
    }

    // Handle logout action
    async function handleLogout() {
        if (isLoggingOut) return;
        isLoggingOut = true;

        try {
            // Close any open modals
            const logoutModal = bootstrap.Modal.getInstance(document.getElementById('logoutModal'));
            if (logoutModal) {
                logoutModal.hide();
            }

            // Show loading state
            showLoadingOverlay();

            // Call logout endpoint
            const response = await fetch(LOGOUT_CONFIG.logoutEndpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                credentials: 'same-origin'
            });

            if (!response.ok) {
                throw new Error(`Logout failed: ${response.status}`);
            }

            const data = await response.json();
            
            if (data.success) {
                // Clear any client-side storage
                clearClientStorage();
                
                // Stop session checker
                if (sessionChecker) {
                    clearInterval(sessionChecker);
                    sessionChecker = null;
                }
                
                // Redirect to login page
                window.location.href = LOGOUT_CONFIG.loginPageUrl;
            } else {
                throw new Error(data.message || 'Logout failed');
            }
        } catch (error) {
            console.error('Logout error:', error);
            
            // Even if server logout fails, clear client-side and redirect
            clearClientStorage();
            window.location.href = LOGOUT_CONFIG.loginPageUrl;
        } finally {
            isLoggingOut = false;
            hideLoadingOverlay();
        }
    }

    // Clear all client-side storage
    function clearClientStorage() {
        try {
            // Clear localStorage
            localStorage.clear();
            
            // Clear sessionStorage
            sessionStorage.clear();
            
            // Delete all cookies
            document.cookie.split(';').forEach(cookie => {
                document.cookie = cookie
                    .replace(/^ +/, '')
                    .replace(/=.*/, `=;expires=${new Date(0).toUTCString()};path=/`);
            });
        } catch (e) {
            console.warn('Error clearing client storage:', e);
        }
    }

    // Show loading overlay
    function showLoadingOverlay() {
        const intro = document.getElementById('intro');
        if (intro) {
            intro.style.display = 'flex';
        }
    }

    // Hide loading overlay
    function hideLoadingOverlay() {
        const intro = document.getElementById('intro');
        if (intro) {
            intro.style.display = 'none';
        }
    }

    // Check if user is still logged in
    async function checkSession() {
        // Skip check on login page or if already logging out
        if (window.location.pathname.includes('login.html') || 
            window.location.pathname.includes('index.html') || 
            isLoggingOut) {
            return;
        }

        try {
            const response = await fetch(LOGOUT_CONFIG.sessionCheckEndpoint, {
                method: 'GET',
                credentials: 'same-origin',
                headers: {
                    'Cache-Control': 'no-cache',
                    'Pragma': 'no-cache'
                }
            });

            if (!response.ok) {
                throw new Error(`Session check failed: ${response.status}`);
            }

            const data = await response.json();

            if (LOGOUT_CONFIG.debug) {
                console.log('Session check:', data);
            }

            // Reset consecutive failures on success
            if (data.logged_in && data.user_id) {
                consecutiveFailures = 0;
                lastValidSession = Date.now();
                return;
            }

            // Only redirect if we have a definitive "not logged in" response
            if (data.logged_in === false) {
                console.log('Session expired - logged_in is false');
                consecutiveFailures++;
                
                // Check if we've had multiple failures or this is a clear not logged in
                if (consecutiveFailures >= MAX_FAILURES) {
                    redirectToLogin('Your session has expired. Please log in again.');
                }
            }
        } catch (error) {
            console.error('Session check error:', error);
            
            // Count consecutive failures for network errors too
            consecutiveFailures++;
            
            // Only redirect after multiple failures to avoid false positives
            if (consecutiveFailures >= MAX_FAILURES) {
                console.log('Multiple session check failures, redirecting to login...');
                redirectToLogin('Unable to verify session. Please log in again.');
            }
        }
    }

    // Redirect to login with optional message
    function redirectToLogin(message = null) {
        // Don't redirect if already logging out
        if (isLoggingOut) return;
        
        const currentPage = window.location.pathname;
        
        // Don't redirect if already on login page
        if (currentPage.includes('login.html') || currentPage.includes('index.html')) {
            return;
        }

        console.log('Redirecting to login. Reason:', message);
        
        if (message) {
            sessionStorage.setItem('logout_message', message);
        }

        window.location.href = LOGOUT_CONFIG.loginPageUrl;
    }

    // Initialize when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initLogout);
    } else {
        initLogout();
    }

})();