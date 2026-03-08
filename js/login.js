document.addEventListener('DOMContentLoaded', () => {
  const usernameField = document.getElementById('username');
  const passwordField = document.getElementById('password');
  const rememberMeCheckbox = document.getElementById('rememberMe');

  // Load saved credentials if cookies exist
  if (document.cookie) {
    const cookies = document.cookie.split('; ').reduce((acc, cookie) => {
      const [name, value] = cookie.split('=');
      acc[name] = decodeURIComponent(value);
      return acc;
    }, {});

    if (cookies.username && cookies.password) {
      usernameField.value = cookies.username;
      passwordField.value = cookies.password;
      rememberMeCheckbox.checked = true;
    }
  }

  // Save credentials if "Remember Me" is checked
  document.getElementById('loginForm').addEventListener('submit', () => {
    if (rememberMeCheckbox.checked) {
      document.cookie = `username=${encodeURIComponent(usernameField.value)}; path=/; max-age=2592000`; // 30 days
      document.cookie = `password=${encodeURIComponent(passwordField.value)}; path=/; max-age=2592000`; // 30 days
    } else {
      // Clear cookies if "Remember Me" is unchecked
      document.cookie = 'username=; path=/; max-age=0';
      document.cookie = 'password=; path=/; max-age=0';
    }
  });

  var modal = document.getElementById("intro");

  // Show the modal when the page loads
  modal.style.display = "block";
  console.log("Modal loaded successfully!");

  // Function to close the modal with a fade-out effect
  function closeModal() {
    modal.style.animation = "fadeOut 3s";
    setTimeout(function () {
      modal.style.display = "none";
    }, 3000); // Match this to the duration of the fade-out animation
    console.log("Modal faded and closed!");
  }
  // Close the modal automatically after 2 seconds
  setTimeout(closeModal, 4000);

  // blurring the ustp logo before showing the hd on
  const blurDivs = document.querySelectorAll(".blur-load");
  blurDivs.forEach(div => {
    const img = div.querySelector("img");

    function loaded() {
      div.classList.add("loaded");
    }

    if (img.complete) {
      loaded();
    } else {
      img.addEventListener("load", loaded);
    }
  });

  document.getElementById('loginForm').addEventListener('submit', function (e) {
    e.preventDefault();

    const username = document.getElementById('username').value;
    const password = document.getElementById('password').value;

    fetch('php/login.php', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ username, password })
    })
      .then(response => response.json())
      .then(data => {
        if (data.success) {
          // Debug log
          console.log("Storing in localStorage:", data);

          // core user
          localStorage.setItem('id', data.id);
          localStorage.setItem('username', data.full_name); // not just the input username

          // roles: keep both raw_role + role (role may be elevated to "Officer")
          localStorage.setItem('role', data.role || '');
          localStorage.setItem('raw_role', data.raw_role || '');

          localStorage.setItem('currentUserRole', data.role || '');

          // program display (was department before)
          localStorage.setItem('program', data.program || '');
          localStorage.setItem('currentUserDepartment', data.program || ''); // keep your existing key so other pages won't break

          localStorage.setItem('firstName', data.first_name || '');

          // officer display fields
          localStorage.setItem('is_officer', data.is_officer ? '1' : '0');
          localStorage.setItem('officer_term_id', data.officer_term_id ? String(data.officer_term_id) : '');
          localStorage.setItem('officer_position', data.officer_position || '');

          // e-signature file (only set when NOT officer, based on your backend)
          localStorage.setItem('signature_file', data.signature_file || '');

          // In the login response handler (login.js)
          localStorage.setItem('officer_org_name', data.officer_org_name || '');
          localStorage.setItem('officer_org_abbreviation', data.officer_org_abbreviation || '');

          if (data.profile_picture) {
            localStorage.setItem('profile_picture', data.profile_picture);
          }

          // Normalize redirect role:
          // - backend role may be "Officer" (capitalized) when elevated
          // - otherwise backend role is typically lowercase like "student"
          const redirectRole = String(data.role || '').toLowerCase();

          switch (redirectRole) {
            case 'overseer':
              window.location.href = 'overseer.html';
              break;
            case 'super_admin':
              window.location.href = 'super-admin.html';
              break;
            case 'faculty_admin':
              window.location.href = 'faculty-admin.html';
              break;
            case 'moderator':
              window.location.href = 'moderator.html';
              break;
            case 'special_admin':
              window.location.href = 'special-admin.html';
              break;

            // If you still have these legacy roles in DB, keep them:
            case 'org_president':
              window.location.href = 'org-president.html';
              break;
            case 'org_officer':
              window.location.href = 'org-officer.html';
              break;
            case 'treasurer':
              window.location.href = 'treasurer.html';
              break;

            // NEW: officer elevated role
            case 'officer':
              // If you don't have a separate officer dashboard, send them to student.html
              // (sidebar will show: Student | <position>)
              window.location.href = 'student.html';
              break;

            case 'student':
              window.location.href = 'student.html';
              break;

            default:
              alert("Unknown role");
          }
        } else {
          alert(data.message || 'Login failed.');
        }
      })
      .catch(error => {
        console.error('Error:', error);
      });
  });

});
