window.addEventListener('load', () => {
  const intro = document.getElementById('intro');

  // Apply fade-out transition
  intro.style.transition = 'opacity 0.5s ease-out';
  intro.style.opacity = '0';

  // After transition, remove it completely from the DOM
  setTimeout(() => {
    if (intro && intro.parentNode) {
      intro.parentNode.removeChild(intro);
    }
  }, 500); // Match transition time
});

document.addEventListener('DOMContentLoaded', function () {

  // Toggle sidebar visibility
  const toggler = document.querySelector(".toggler-btn");
  if (toggler) {
    toggler.addEventListener("click", function () {
      document.querySelector("#sidebar").classList.toggle("collapsed");
    });
  }

  // Set the default section to be visible
  showSection('home');

  document.querySelectorAll('.sidebar-link').forEach(link => {
    link.addEventListener('click', function (event) {
      // Skip dropdown toggle links
      if (this.classList.contains('has-dropdown')) {
        return;
      }

      event.preventDefault();

      // Remove 'selected' class from all sidebar links
      document.querySelectorAll('.sidebar-link').forEach(link => {
        link.classList.remove('selected');
      });

      // Add 'selected' class to the clicked link
      this.classList.add('selected');

      // Get the text of the span inside the clicked link
      const section = this.textContent.trim().toLowerCase().replace(/\s+/g, '-');
      console.log(section);

      // Show the corresponding section
      showSection(section);
    });
  });

  function showSection(section) {
    const contentArea = document.getElementById('content-area');

    // Map section keys to HTML file paths
    const sectionMap = {
      'home': 'pages/super-admin/home.html',
      'manage-users': 'pages/super-admin/manage-users.html',
      'manage-e-signature': 'pages/super-admin/manage-e-signature.html',

      // Content Management
      'manage-programs': 'pages/super-admin/manage-programs.html',
      'manage-announcement': 'pages/super-admin/manage-announcement.html',
      'manage-accreditation': 'pages/super-admin/manage-accreditation.html',
      'event-expenses': 'pages/super-admin/event-expenses.html',

      // Organization
      'org-fees': 'pages/super-admin/organization-fees.html',
      'membership-fee': 'pages/super-admin/membership-fee.html',
      'records': 'pages/super-admin/records.html',
      'clubs': 'pages/super-admin/clubs.html',

      // Others
      'academic-terms': 'pages/super-admin/manage-academic-terms.html',

      //'e-voting': 'pages/super-admin/e-voting.html' --remove comment if you want to add this function
    };

    const fileName = sectionMap[section];
    if (!fileName) {
      console.warn(`No mapping found for section: ${section}`);
      return;
    }

    // Fetch and load HTML
    fetch(fileName)
      .then(response => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.text();
      })
      .then(html => {
        contentArea.innerHTML = html;

        // ✅ INIT JS FOR INJECTED PAGES
        if (section === 'manage-programs' && window.ManagePrograms?.init) {
          window.ManagePrograms.init();
        }

        if (section === 'academic-terms' && window.ManageAcademicTerms?.init) {
          window.ManageAcademicTerms.init();
        }

        if (section === 'manage-users' && window.ManageUsers?.init) {
          window.ManageUsers.init();
        }

        if (section === 'manage-e-signature' && window.ManageESignature?.init) {
          window.ManageESignature.init(contentArea);
        }

        if (section === "manage-accreditation" && window.SUAccreditation?.init) {
          window.SUAccreditation.init(contentArea);
        }

        if (section === 'clubs' && window.Clubs?.init) {
          window.Clubs.init();
        }

        if (section === 'org-fees' && window.OrgPayments?.init) {
          window.OrgPayments.init();
        }

        if (section === 'event-expenses' && window.EventExpenses?.init) {
          window.EventExpenses.init();
        }

        if (section === 'manage-announcement' && window.ManageAnnouncement?.init) {
        window.ManageAnnouncement.init(contentArea);
        }

        if (section === 'home' && window.HomeDashboard?.init) {
          window.HomeDashboard.init(contentArea);
        }

        if (section === 'records' && window.RecordsManagement?.init) {
          window.RecordsManagement.init(contentArea);
        }        

        contentArea.classList.add('fade-in');
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

  document.addEventListener('click', function (e) {
    if (e.target.closest('.logout-link, .logout-link a')) {
      e.preventDefault();
      const logoutModal = new bootstrap.Modal(document.getElementById('logoutModal'));
      logoutModal.show();
      console.log('logout modal triggered');
    }
  });

  const logOutBtn = document.getElementById("logOutBtn");

  if (logOutBtn) {
    logOutBtn.addEventListener("click", () => {
      logoutUser(); // call your function
    });
  }

  //logout clears user info
  function logoutUser() {
    fetch('php/logout.php', {
      method: 'GET',
      credentials: 'include'
    })
      .then(() => {
        // The PHP already redirected the session,
        // so we do the front-end redirect manually.

        localStorage.removeItem('username');
        localStorage.removeItem('role');
        localStorage.removeItem('profile_picture');
        localStorage.removeItem('user_id');
        localStorage.removeItem('id_number');

        // Force navigation to login page
        window.location.href = 'login.html';
      })
      .catch(err => console.error('Logout failed:', err));
  }

  const fullName = localStorage.getItem('username');
  const role = localStorage.getItem('role');
  const profilePic = localStorage.getItem('profile_picture');

  // ✅ role display mapping (super_admin -> Office of Students Affair)
  const roleLabel = (role ?? '').toLowerCase() === 'super_admin'
    ? 'Office of Students Affair'
    : (role ?? 'Unknown');

  document.querySelector('.username').textContent = fullName ?? 'Unknown';
  document.querySelector('.rank').textContent = roleLabel;

  if (profilePic) {
    document.querySelector('.profile-picture').src = `assets/uploads/${profilePic}` ?? 'assets/profile.png';
    document.querySelector('.profile-icon').src = `assets/uploads/${profilePic}` ?? 'assets/profile.png';
  }
});

console.log(localStorage.getItem('department'));
//toggler-btn
