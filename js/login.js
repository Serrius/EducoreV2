document.addEventListener('DOMContentLoaded', () => {
  const usernameField = document.getElementById('username');
  const passwordField = document.getElementById('password');
  const rememberMeCheckbox = document.getElementById('rememberMe');
  
  // Debug logs
  console.log('🚨 LOGIN.JS STARTED - default_account:', localStorage.getItem('default_account'));
  console.log('🚨 LOGIN.JS STARTED - all keys:', Object.keys(localStorage));

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
    }, 3000);
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
          localStorage.setItem('username', data.full_name);
          localStorage.setItem('role', data.role || '');
          localStorage.setItem('raw_role', data.raw_role || '');
          localStorage.setItem('original_role', data.original_role || '');
          localStorage.setItem('currentUserRole', data.role || '');
          localStorage.setItem('program', data.program || '');
          localStorage.setItem('currentUserDepartment', data.program || '');
          localStorage.setItem('firstName', data.first_name || '');
          localStorage.setItem('is_officer', data.is_officer ? '1' : '0');
          localStorage.setItem('officer_term_id', data.officer_term_id ? String(data.officer_term_id) : '');
          localStorage.setItem('officer_position', data.officer_position || '');
          localStorage.setItem('signature_file', data.signature_file || '');
          localStorage.setItem('officer_org_name', data.officer_org_name || '');
          localStorage.setItem('officer_org_abbreviation', data.officer_org_abbreviation || '');

          if (data.profile_picture) {
            localStorage.setItem('profile_picture', data.profile_picture);
          }

          // SIMPLIFIED: Just redirect based on role - no modal, no preferences
          console.log('🔄 Redirecting based on role:', data.role);
          
          // If user is an officer (org_president, treasurer, org_officer, or elevated officer)
          if (data.is_officer) {
            console.log('👔 User is an officer - sending to officer.html');
            window.location.href = 'officer.html';
          } else {
            // Regular redirect based on role
            redirectBasedOnRole(data.role);
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

function redirectBasedOnRole(role) {
  const redirectRole = String(role || '').toLowerCase();

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
    case 'org_president':
    case 'org_officer':
    case 'treasurer':
    case 'officer':
      window.location.href = 'officer.html';
      break;
    case 'student':
      window.location.href = 'student.html';
      break;
    default:
      console.log('Unknown role:', role);
      alert("Unknown role. Please contact administrator.");
  }
}