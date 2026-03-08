document.addEventListener("DOMContentLoaded", () => {
  const form = document.getElementById('registrationForm');
  const steps = document.querySelectorAll('.form-step');
  const prevBtn = document.getElementById('prevBtn');
  const nextBtn = document.getElementById('nextBtn');
  const progressBar = document.querySelector('.progress-bar');
  let currentStep = 0;

  const emailInput = document.getElementById("email");

  // --- Email: force lowercase + validate ---
  if (emailInput) {
    emailInput.addEventListener("input", () => {
      emailInput.value = emailInput.value.toLowerCase();

      const valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailInput.value);
      if (!valid) emailInput.classList.add("is-invalid");
      else emailInput.classList.remove("is-invalid");
    });
  }

  // --- Name fields: auto-capitalize each word ---
  ["firstName", "middleName", "lastName", "suffix"].forEach(id => {
    const field = document.getElementById(id);
    if (field) {
      field.addEventListener("input", () => {
        let value = field.value;
        value = value.replace(/\b\w/g, char => char.toUpperCase());
        field.value = value;
      });
    }
  });

  // ----- ID Number: allow digits only -----
  const idInput = document.getElementById("idNumber");
  if (idInput) {
    idInput.addEventListener("input", () => {
      idInput.value = idInput.value.replace(/\D+/g, "");
    });

    idInput.addEventListener("paste", (e) => {
      e.preventDefault();
      const text = (e.clipboardData || window.clipboardData).getData("text") || "";
      const digits = text.replace(/\D+/g, "");
      if (document.execCommand) {
        document.execCommand("insertText", false, digits);
      } else {
        const start = idInput.selectionStart || idInput.value.length;
        const end = idInput.selectionEnd || idInput.value.length;
        idInput.value = idInput.value.slice(0, start) + digits + idInput.value.slice(end);
        idInput.selectionStart = idInput.selectionEnd = start + digits.length;
      }
    });
  }

  // ===== Dynamic Program & Academic Term Loading (educorev2) =====
  function loadPrograms() {
    const courseSelect = document.getElementById("course"); // UI name kept as "course"
    if (!courseSelect) return;

    fetch(`php/register.php?action=get_programs&t=${Date.now()}`)
      .then(res => res.json())
      .then(data => {
        const list = (data && data.success && Array.isArray(data.programs)) ? data.programs : [];

        courseSelect.innerHTML = `<option value="" disabled selected>Select program</option>`;

        if (!list.length) {
          courseSelect.innerHTML = `<option value="" disabled selected>No active programs found</option>`;
          return;
        }

        list.forEach(p => {
          const abbr = (p.abbreviation || "").trim();
          if (!abbr) return;

          const opt = document.createElement("option");
          opt.value = abbr;       // IMPORTANT: submit abbreviation (e.g., BSIT)
          opt.textContent = abbr; // show abbreviation
          courseSelect.appendChild(opt);
        });
      })
      .catch(err => {
        console.error("Failed to load programs:", err);
        courseSelect.innerHTML = `<option value="" disabled selected>Unable to load programs</option>`;
      });
  }

  function loadActiveTerm() {
    const schoolYearInput = document.getElementById("schoolYear");
    if (!schoolYearInput) return;

    fetch(`php/register.php?action=get_active_term&t=${Date.now()}`)
      .then(res => res.json())
      .then(data => {
        const term = data && data.success ? data.term : null;
        if (!term || !term.school_year) {
          schoolYearInput.value = "Unavailable";
          schoolYearInput.classList.add("is-invalid");
          return;
        }

        schoolYearInput.classList.remove("is-invalid");
        schoolYearInput.value = term.school_year;      // from academic_terms.school_year
        schoolYearInput.dataset.termId = term.id || ""; // optional, if you want it later
        schoolYearInput.dataset.semester = term.semester || "";
      })
      .catch(err => {
        console.error("Failed to load active term:", err);
        schoolYearInput.value = "Unavailable";
        schoolYearInput.classList.add("is-invalid");
      });
  }

  // Initial load
  loadPrograms();
  loadActiveTerm();

  // ===== Multi-step logic (no CAPTCHA) =====
  function showStep(stepIndex, direction = 'next') {
    const current = steps[currentStep];
    const next = steps[stepIndex];

    if (direction === 'next') {
      current.classList.add('slide-left');
      next.classList.add('slide-right');
    } else {
      current.classList.add('slide-right');
      next.classList.add('slide-left');
    }

    current.style.opacity = '0';
    setTimeout(() => {
      steps.forEach((step) => {
        step.classList.remove('active', 'slide-left', 'slide-right');
        step.style.display = 'none';
        step.style.opacity = '0';
      });
      next.style.display = 'block';
      setTimeout(() => {
        next.classList.add('active');
        next.style.opacity = '1';
      }, 10);
    }, 300);

    prevBtn.disabled = stepIndex === 0;
    nextBtn.textContent = stepIndex === steps.length - 1 ? 'Submit' : 'Next';
    progressBar.style.width = `${((stepIndex + 1) / steps.length) * 100}%`;
    progressBar.textContent = `Step ${stepIndex + 1} of ${steps.length}`;

    updateNextButton();
  }

  function validateStep(stepIndex) {
    const inputs = steps[stepIndex].querySelectorAll('input[required], select[required]');
    let isValid = true;

    inputs.forEach(input => {
      if (!input.value.trim()) {
        isValid = false;
        input.classList.add('is-invalid');
      } else {
        input.classList.remove('is-invalid');
      }
    });

    if (stepIndex === steps.length - 1) {
      const pw = document.getElementById('password').value.trim();
      const confirm = document.getElementById('confirmPassword').value.trim();
      if (pw !== confirm) {
        isValid = false;
        document.getElementById('confirmPassword').classList.add('is-invalid');
      } else {
        document.getElementById('confirmPassword').classList.remove('is-invalid');
      }
    }

    return isValid;
  }

  function updateNextButton() {
    nextBtn.disabled = !validateStep(currentStep);
  }

  steps.forEach(step => {
    step.querySelectorAll('input, select').forEach(input => {
      input.addEventListener('input', updateNextButton);
      input.addEventListener('change', updateNextButton);
    });
  });

  prevBtn.addEventListener('click', () => {
    if (currentStep > 0) {
      currentStep--;
      showStep(currentStep, 'prev');
    }
  });

  nextBtn.addEventListener('click', () => {
    if (!validateStep(currentStep)) return;

    if (currentStep < steps.length - 1) {
      currentStep++;
      showStep(currentStep, 'next');
    } else {
      const formData = new FormData(form);

      fetch("php/register.php", {
        method: "POST",
        body: formData
      })
        .then(res => res.json())
        .then(data => {
          if (data.success) {
            const progressWrap = document.querySelector('.progress');
            const successCard = document.getElementById('registerSuccess');

            if (progressWrap) progressWrap.classList.add('d-none');
            form.classList.add('d-none');

            const fn = document.getElementById('firstName')?.value?.trim() || '';
            const ln = document.getElementById('lastName')?.value?.trim() || '';
            const displayName = `${fn} ${ln}`.trim();

            const successText = document.getElementById('successText');
            if (successText) {
              successText.textContent = displayName
                ? `Welcome aboard, ${displayName}! Your account has been created.`
                : `Your account has been created.`;
            }

            if (successCard) {
              successCard.classList.remove('d-none');
              successCard.classList.add('fade-in');
            }

            form.reset();
            currentStep = 0;
          } else {
            alert(data.message || "Registration failed. Please try again.");
          }
        })
        .catch(err => {
          console.error("Registration error:", err);
          alert("A server error occurred. Please try again later.");
        });
    }
  });

  showStep(currentStep);

  // ===== Intro "Modal" Logic =====
  const modal = document.getElementById("intro");
  if (modal) {
    modal.style.display = "block";
    function closeModal() {
      modal.style.animation = "fadeOut 3s";
      setTimeout(() => { modal.style.display = "none"; }, 3000);
    }
    setTimeout(closeModal, 4000);
  }

  const blurDivs = document.querySelectorAll(".blur-load");
  blurDivs.forEach(div => {
    const img = div.querySelector("img");
    function loaded() { div.classList.add("loaded"); }
    if (img && img.complete) loaded();
    else if (img) img.addEventListener("load", loaded);
  });
});