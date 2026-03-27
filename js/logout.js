/**
 * Logout functionality for EduCore
 * Handles session timeout and manual logout
 */

(function() {
    'use strict';

    // Configuration
    const LOGOUT_CONFIG = {
        sessionCheckInterval: 500,
        loginPageUrl: 'index.html',
        logoutEndpoint: 'php/logout.php',
        sessionCheckEndpoint: 'php/check-session.php',
        debug: true
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

        setTimeout(() => checkSession(), 1000);
        startSessionChecker();

        ['click', 'mousemove', 'keypress', 'scroll', 'touchstart'].forEach(event => {
            document.addEventListener(event, () => {
                lastValidSession = Date.now();
            });
        });
    }

    function startSessionChecker() {
        if (sessionChecker) {
            clearInterval(sessionChecker);
        }
        sessionChecker = setInterval(() => checkSession(), LOGOUT_CONFIG.sessionCheckInterval);
    }

    function showLogoutConfirmation() {
        const logoutModalEl = document.getElementById('logoutModal');
        const logoutModal = new bootstrap.Modal(logoutModalEl);
        logoutModal.show();
    }

    async function handleLogout() {
        // DEBUG: Check value at the VERY START
        console.log('🔥 LOGOUT STARTED - default_account:', localStorage.getItem('default_account'));
        console.log('🔥 LOGOUT STARTED - last_used_account:', localStorage.getItem('last_used_account'));
        
        if (isLoggingOut) return;
        isLoggingOut = true;

        try {
            // Properly dispose of the logout modal
            const logoutModalEl = document.getElementById('logoutModal');
            const logoutModal = bootstrap.Modal.getInstance(logoutModalEl);
            
            if (logoutModal) {
                const backdrop = document.querySelector('.modal-backdrop');
                if (backdrop) backdrop.remove();
                
                document.body.classList.remove('modal-open');
                document.body.style.overflow = '';
                document.body.style.paddingRight = '';
                
                logoutModal.hide();
                logoutModal.dispose();
            }

            showLoadingOverlay();

            // Call logout endpoint
            const response = await fetch(LOGOUT_CONFIG.logoutEndpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'same-origin'
            });

            if (!response.ok) throw new Error(`Logout failed: ${response.status}`);

            const data = await response.json();
            
            if (data.success) {
                // Clear client storage BUT PRESERVE PREFERENCES
                await clearClientStoragePreservePreferences();
                
                if (sessionChecker) {
                    clearInterval(sessionChecker);
                    sessionChecker = null;
                }
                
                window.location.href = LOGOUT_CONFIG.loginPageUrl;
            } else {
                throw new Error(data.message || 'Logout failed');
            }
        } catch (error) {
            console.error('Logout error:', error);
            await clearClientStoragePreservePreferences();
            window.location.href = LOGOUT_CONFIG.loginPageUrl;
        } finally {
            isLoggingOut = false;
            hideLoadingOverlay();
        }
    }

    // FIXED FUNCTION: Clear storage but KEEP preferences
    async function clearClientStoragePreservePreferences() {
        try {
            // DEBUG: Check value BEFORE saving
            console.log('📥 BEFORE SAVING - default_account:', localStorage.getItem('default_account'));
            
            // SAVE PREFERENCES
            const preferences = {
                default_account: localStorage.getItem('default_account'),
                last_used_account: localStorage.getItem('last_used_account'),
                available_accounts: localStorage.getItem('available_accounts'),
                officer_position: localStorage.getItem('officer_position'),
                officer_org_name: localStorage.getItem('officer_org_name'),
                officer_org_abbreviation: localStorage.getItem('officer_org_abbreviation'),
                is_officer: localStorage.getItem('is_officer'),
                role: localStorage.getItem('role'),
                program: localStorage.getItem('program')
            };

            console.log('📦 SAVED preferences:', preferences);

            // DEBUG: Check if we have the value
            if (preferences.default_account) {
                console.log('✅ Found default_account to save:', preferences.default_account);
            } else {
                console.warn('⚠️ default_account is NULL before clearing!');
            }

            // Clear everything
            console.log('🧹 Clearing localStorage...');
            localStorage.clear();
            sessionStorage.clear();
            console.log('✅ localStorage cleared');

            // RESTORE PREFERENCES
            console.log('🔄 Restoring preferences...');
            let restoredCount = 0;
            Object.entries(preferences).forEach(([key, value]) => {
                if (value !== null && value !== undefined) {
                    localStorage.setItem(key, value);
                    restoredCount++;
                    console.log(`✅ Restored ${key}:`, value);
                }
            });

            console.log(`✅ Restored ${restoredCount} preferences`);

            // Delete cookies
            document.cookie.split(';').forEach(cookie => {
                document.cookie = cookie
                    .replace(/^ +/, '')
                    .replace(/=.*/, `=;expires=${new Date(0).toUTCString()};path=/`);
            });

            // FINAL CHECK
            console.log('🔍 FINAL CHECK - default_account:', localStorage.getItem('default_account'));
            console.log('🔍 FINAL CHECK - last_used_account:', localStorage.getItem('last_used_account'));

        } catch (e) {
            console.warn('Error clearing client storage:', e);
        }
    }

    function showLoadingOverlay() {
        const intro = document.getElementById('intro');
        if (intro) intro.style.display = 'flex';
    }

    function hideLoadingOverlay() {
        const intro = document.getElementById('intro');
        if (intro) intro.style.display = 'none';
    }

    async function checkSession() {
        if (window.location.pathname.includes('login.html') || 
            window.location.pathname.includes('index.html') || 
            isLoggingOut) {
            return;
        }

        try {
            const response = await fetch(LOGOUT_CONFIG.sessionCheckEndpoint, {
                method: 'GET',
                credentials: 'same-origin',
                headers: { 'Cache-Control': 'no-cache', 'Pragma': 'no-cache' }
            });

            if (!response.ok) throw new Error(`Session check failed: ${response.status}`);

            const data = await response.json();

            if (LOGOUT_CONFIG.debug) console.log('Session check:', data);

            if (data.logged_in && data.user_id) {
                consecutiveFailures = 0;
                lastValidSession = Date.now();
                return;
            }

            if (data.logged_in === false) {
                console.log('Session expired - logged_in is false');
                consecutiveFailures++;
                
                if (consecutiveFailures >= MAX_FAILURES) {
                    redirectToLogin('Your session has expired. Please log in again.');
                }
            }
        } catch (error) {
            console.error('Session check error:', error);
            consecutiveFailures++;
            
            if (consecutiveFailures >= MAX_FAILURES) {
                console.log('Multiple session check failures, redirecting to login...');
                redirectToLogin('Unable to verify session. Please log in again.');
            }
        }
    }

    function redirectToLogin(message = null) {
        if (isLoggingOut) return;
        
        const currentPage = window.location.pathname;
        
        if (currentPage.includes('login.html') || currentPage.includes('index.html')) return;

        console.log('Redirecting to login. Reason:', message);
        
        if (message) sessionStorage.setItem('logout_message', message);

        const backdrops = document.querySelectorAll('.modal-backdrop');
        backdrops.forEach(backdrop => backdrop.remove());
        document.body.classList.remove('modal-open');
        document.body.style.overflow = '';
        document.body.style.paddingRight = '';

        window.location.href = LOGOUT_CONFIG.loginPageUrl;
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initLogout);
    } else {
        initLogout();
    }

})();