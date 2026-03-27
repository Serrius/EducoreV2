// js/user-script.js

// Universal loader function (can be used by both user and treasurer)
function fadeOutIntroLoader() {
  const intro = document.getElementById('intro');

  if (!intro) return;

  intro.style.transition = 'opacity 0.5s ease-out';
  intro.style.opacity = '0';

  setTimeout(() => {
    if (intro && intro.parentNode) {
      intro.parentNode.removeChild(intro);
    }
  }, 500);
}

// Fade-out intro loader (same behavior as super-admin)
window.addEventListener('load', fadeOutIntroLoader);

document.addEventListener('DOMContentLoaded', function () {
  // ================== CHECK ACTIVE ACCOUNT ==================
  const activeAccount = localStorage.getItem('active_account');
  const hasDualAccount = localStorage.getItem('available_accounts') !== null;
  const isOfficer = localStorage.getItem('is_officer') === '1' || localStorage.getItem('is_officer') === 'true';
  
  // If this is an officer page but user wants student view, or vice versa
  if (hasDualAccount && isOfficer) {
    const currentPage = window.location.pathname.split('/').pop();
    const isOfficerPage = currentPage === 'officer.html';
    const isStudentPage = currentPage === 'student.html';
    
    // Check if we're on the wrong page for the active account
    if (isOfficerPage && activeAccount === 'student') {
      console.log('[UserScript] Redirecting to student.html (active account: student)');
      window.location.href = 'student.html';
      return;
    } else if (isStudentPage && activeAccount === 'officer') {
      console.log('[UserScript] Redirecting to officer.html (active account: officer)');
      window.location.href = 'officer.html';
      return;
    }
  }

  // ================== SIDEBAR TOGGLER ==================
  const toggler = document.querySelector('.toggler-btn');
  if (toggler) {
    toggler.addEventListener('click', function () {
      document.querySelector('#sidebar')?.classList.toggle('collapsed');
    });
  }

  // ================== SECTION NAVIGATION ==================
  // Default section
  showSection('home');

  document.querySelectorAll('.sidebar-link').forEach(link => {
    link.addEventListener('click', function (event) {
      // Skip dropdown toggle links (like ORGANIZATION parent)
      if (this.classList.contains('has-dropdown')) {
        return;
      }

      event.preventDefault();

      // Remove 'selected' class from all sidebar links
      document.querySelectorAll('.sidebar-link').forEach(l => {
        l.classList.remove('selected');
      });

      // Add 'selected' class to clicked link
      this.classList.add('selected');

      // Prefer data-section attribute; fallback to slug from text
      const attrSection = this.getAttribute('data-section');
      const section =
        attrSection ||
        this.textContent.trim().toLowerCase().replace(/\s+/g, '-');

      console.log('Switching section to:', section);

      showSection(section);
    });
  });

  // ================== QUICK LINKS HANDLING ==================
  // Add event listener for Quick Links (dashboard shortcut buttons)
  document.addEventListener('click', function (e) {
    // Check if clicked element is a Quick Link
    const quickLink = e.target.closest('a[href^="#"]');
    if (!quickLink) return;

    const href = quickLink.getAttribute('href');

    // Map of Quick Link hrefs to sections (from dashboard to actual pages)
    const quickLinkMap = {
      '#announcements': 'announcements',
      '#organizations': 'organization-fees',
      '#dues': 'transact-history',
      '#profile': 'dept-event-expenses'
    };

    const section = quickLinkMap[href];
    if (section) {
      e.preventDefault();
      e.stopPropagation();

      console.log('Quick Link clicked:', href, '->', section);

      // Remove 'selected' class from all sidebar links
      document.querySelectorAll('.sidebar-link').forEach(l => {
        l.classList.remove('selected');
      });

      // Try multiple ways to find the corresponding sidebar link
      let sidebarLink = null;

      // First try: Exact data-section match
      sidebarLink = document.querySelector(`.sidebar-link[data-section="${section}"]`);

      // Second try: Partial match in data-section
      if (!sidebarLink) {
        sidebarLink = document.querySelector(`.sidebar-link[data-section*="${section}"]`);
      }

      // Third try: Match by text content (case insensitive)
      if (!sidebarLink) {
        const allSidebarLinks = document.querySelectorAll('.sidebar-link');
        allSidebarLinks.forEach(link => {
          const linkText = link.textContent.trim().toLowerCase().replace(/\s+/g, '-');
          if (linkText === section || linkText.includes(section)) {
            sidebarLink = link;
          }
        });
      }

      // If we found a matching sidebar link, select it
      if (sidebarLink) {
        sidebarLink.classList.add('selected');
        console.log('Found and selected sidebar link:', sidebarLink);
      } else {
        console.log('Could not find matching sidebar link for section:', section);
      }

      // Show the section
      showSection(section);
    }
  });

  // Store original showSection function for overriding
  const originalShowSection = showSection;
  
  window.showSection = function(section) {
    // Check if trying to access officer section in student mode
    const activeAccount = localStorage.getItem('active_account');
    const officerOnlySections = ['manage-accreditation', 'manage-e-signature'];
    
    if (activeAccount === 'student' && officerOnlySections.includes(section)) {
      console.warn('[UserScript] Cannot access officer section in student mode.');
      showSection('home');
      
      // Update selected link
      document.querySelectorAll('.sidebar-link').forEach(l => {
        l.classList.remove('selected');
      });
      const homeLink = document.querySelector('.sidebar-link[data-section="home"]');
      if (homeLink) homeLink.classList.add('selected');
      
      return;
    }
    
    // Call original showSection
    if (typeof originalShowSection === 'function') {
      originalShowSection(section);
    }
  };

  function showSection(section) {
    const contentArea = document.getElementById('content-area');
    if (!contentArea) return;

    // Get isOfficer from localStorage - SIMPLIFIED
    const isOfficer = localStorage.getItem('is_officer') === '1' || localStorage.getItem('is_officer') === 'true';

    // Guard: If user is not an officer, block the manage-e-signature section
    if (section === 'manage-e-signature' && !isOfficer) {
      console.warn('[UserScript] Blocked access to manage-e-signature (not an officer).');
      // Kick back to home
      showSection('home');
      return;
    }

    // Guard: If user is not an org_president, block the manage-accreditation section
    const userRole = localStorage.getItem('role');
    const isOrgPresident = userRole === 'org_president';
    
    if (section === 'manage-accreditation' && !isOrgPresident) {
      console.warn('[UserScript] Blocked access to manage-accreditation (not an org president).');
      // Kick back to home
      showSection('home');
      return;
    }

    // Map section keys to user HTML file paths
    const sectionMap = {
      // Top-level
      home: 'pages/student/home.html',
      announcements: 'pages/student/announcements.html',
      'manage-e-signature': 'pages/super-admin/manage-e-signature.html',
      'org-fee': 'pages/student/organization-fees.html',
      'manage-accreditation': 'pages/admin/accreditation.html',
      'transact-history': 'pages/student/transact-history.html',
      'dept-event-expenses': 'pages/student/event-expenses.html',
      'clubs': 'pages/student/clubs.html',
      // Organization
      'membership-fee': 'pages/student/membership-fees.html',
    };

    const fileName = sectionMap[section];
    if (!fileName) {
      console.warn(`No mapping found for section: ${section}`);
      return;
    }

    // Fetch and load HTML (same style as super-admin)
    fetch(fileName, { cache: 'no-store' })
      .then(response => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.text();
      })
      .then(html => {
        contentArea.innerHTML = html;
        contentArea.classList.add('fade-in');

        if (section === 'manage-e-signature' && window.ManageESignature?.init) {
          window.ManageESignature.init(contentArea);
        }

        if (section === "manage-accreditation" && window.SAAccreditation?.init) {
          window.SAAccreditation.init(contentArea);
        }

        if (section === 'clubs' && window.Clubs?.init) {
          window.Clubs.init();
        }

        if (section === 'org-fee' && window.OrgPayments?.init) {
          window.OrgPayments.init();
        }

        if (section === 'dept-event-expenses' && window.EventExpenses?.init) {
          window.EventExpenses.init();
        }

        if (section === 'announcements' && window.ManageAnnouncement?.init) {
          window.ManageAnnouncement.init(contentArea);
        }

        if (section === 'home' && window.HomeStudent?.init) {
          window.HomeStudent.init(contentArea);
        }

        if (section === 'transact-history' && window.UserTransactionHistory?.init) {
          window.UserTransactionHistory.init(contentArea);
        }

        setTimeout(() => contentArea.classList.remove('fade-in'), 300);
      })
      .catch(err => {
        console.error(`Error loading section ${section}:`, err);
        contentArea.innerHTML = `
          <div style="
              display: flex;
              align-items: center;
              justify-content: space-between;
              background-color: #fff;
              box-shadow: 0 4px 10px rgba(0,0,0,0.15);
              padding-left: 50px;
              border-radius: 8px;
              min-height: 250px;
          ">
              <div style="flex: 1; padding-right: 20px;">
                  <h2 class="text-warning">Page Under Maintenance</h2>
                  <p class="text-muted mb-0">
                      This section is currently being updated. Please check back later.
                  </p>
                  <small class="text-danger">[Error loading: ${section}]</small>
              </div>
              <div style="flex: 1; display: flex; justify-content: flex-end;">
                  <img src="assets/images/maintenance.gif" alt="Maintenance" style="height: 100%; object-fit: contain;">
              </div>
          </div>
        `;
      });
  }

  // ================== LOGOUT HANDLING (same as super-admin) ==================
  document.addEventListener('click', function (e) {
    if (e.target.closest('.logout-link, .logout-link a')) {
      e.preventDefault();
      const logoutModalEl = document.getElementById('logoutModal');
      if (!logoutModalEl) return;
      const logoutModal = new bootstrap.Modal(logoutModalEl);
      logoutModal.show();
      console.log('logout modal triggered');
    }
  });

  const logOutBtn = document.getElementById('logOutBtn');
  if (logOutBtn) {
    logOutBtn.addEventListener('click', () => {
      logoutUser();
    });
  }

  function logoutUser() {
    fetch('php/logout.php', {
      method: 'GET',
      credentials: 'include',
    })
      .then(() => {
        // Clear all stored user info including account preferences
        localStorage.clear();
        sessionStorage.clear();
        
        // Redirect to login
        window.location.href = 'login.html';
      })
      .catch(err => console.error('Logout failed:', err));
  }

  // ================== USER INFO (NAME, ROLE, PROFILE PIC) ==================
  const fullName = localStorage.getItem('username');
  const role = localStorage.getItem('role');
  const profilePic = localStorage.getItem('profile_picture');
  
  // USE the isOfficer from the top - DON'T redeclare!
  // const isOfficer = ... // REMOVED - already declared at the top

  // program line
  const program =
    localStorage.getItem('program') ||
    localStorage.getItem('currentUserDepartment');

  // officer line
  const officerPosition = localStorage.getItem('officer_position');

  // ================== HIDE MANAGE E-SIGNATURE IF NOT OFFICER ==================
  (function hideManageESignatureIfNotOfficer() {
    const link = document.querySelector('.sidebar-link[data-section="manage-e-signature"]');
    if (!link) return;

    const li = link.closest('li.sidebar-item') || link.closest('li');
    if (!li) return;

    if (!isOfficer) {
      li.style.display = 'none';
      link.classList.remove('selected');
      console.log('[UserScript] manage-e-signature sidebar item hidden (not an officer).');
    } else {
      li.style.display = '';
    }
  })();

  // ================== HIDE MANAGE ACCREDITATION IF NOT ORG PRESIDENT ==================
  (function hideManageAccreditationIfNotOrgPresident() {
    const link = document.querySelector('.sidebar-link[data-section="manage-accreditation"]');
    if (!link) return;

    const li = link.closest('li.sidebar-item') || link.closest('li');
    if (!li) return;

    const isOrgPresident = role === 'org_president';
    
    if (!isOrgPresident) {
      li.style.display = 'none';
      link.classList.remove('selected');
      console.log('[UserScript] manage-accreditation sidebar item hidden (not an org president). Role:', role);
    } else {
      li.style.display = '';
      console.log('[UserScript] manage-accreditation sidebar item shown for org president.');
    }
  })();

  const usernameEl = document.querySelector('.username');
  const rankEl = document.querySelector('.rank');
  const departmentEl = document.querySelector('.department');
  const sidebarProfilePic = document.querySelector('.profile-picture');
  const navbarProfilePic = document.querySelector('.profile-icon');

  // Update role if it's "non-admin"
  let displayRole = role;
  if (role === "non-admin") {
    localStorage.setItem('role', 'student');
    displayRole = 'student';
  }

  // ===== UPDATED RANK DISPLAY - SHOW "Officer" FOR ANY OFFICER =====
  // Build role display
  let rankText = displayRole
    ? displayRole.charAt(0).toUpperCase() + displayRole.slice(1)
    : 'Unknown';

  // SIMPLIFIED: For ANY officer, display "Officer" instead of specific position
  if (isOfficer) {
    rankText = 'Officer';
  }

  if (usernameEl) usernameEl.textContent = fullName ?? 'Unknown';
  if (rankEl) rankEl.textContent = rankText;

  // department line should show program like "BSIT"
  if (departmentEl) {
    departmentEl.textContent = program ? String(program).toUpperCase() : 'Unknown';
  }

  console.log('User program:', program);
  console.log('Is officer:', isOfficer);
  console.log('Officer position (raw):', officerPosition);
  console.log('Displayed role:', rankText);
  console.log('User role:', role);

  if (profilePic) {
    const path = `assets/uploads/${profilePic}`;
    if (sidebarProfilePic) sidebarProfilePic.src = path;
    if (navbarProfilePic) navbarProfilePic.src = path;
  }
});