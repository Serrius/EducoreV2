/* js/update-profile.js */
/* global bootstrap, showSuccess, showError */

(function () {
  "use strict";
  if (window.__ProfileModuleBooted) return;
  window.__ProfileModuleBooted = true;

  const API_URL = "php/profile.php";

  function qs(sel, root = document) { return root.querySelector(sel); }

  function safeShowError(msg) {
    if (typeof window.showError === "function") return window.showError(msg);
    alert(msg || "Something went wrong.");
  }
  function safeShowSuccess(msg) {
    if (typeof window.showSuccess === "function") return window.showSuccess(msg);
    alert(msg || "Success.");
  }

  async function postJSON(payload) {
    const res = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify(payload || {})
    });

    let data;
    try { data = await res.json(); }
    catch (e) { data = { success: false, message: "Invalid JSON response." }; }

    if (!res.ok || !data?.success) {
      const msg = data?.message || `Request failed (${res.status}).`;
      throw new Error(msg);
    }
    return data;
  }

  function setText(id, value) {
    const el = qs(id);
    if (!el) return;
    el.textContent = value ?? "";
  }

  function setInput(id, value) {
    const el = qs(id);
    if (!el) return;
    el.value = value ?? "";
  }

  function computeAccountAge(createdAt) {
    if (!createdAt) return "--";
    const d = new Date(createdAt.replace(" ", "T"));
    if (isNaN(d.getTime())) return "--";

    const now = new Date();
    const diffMs = Math.max(0, now.getTime() - d.getTime());
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays < 1) return "Today";
    if (diffDays === 1) return "1 day";
    if (diffDays < 30) return `${diffDays} days`;

    const months = Math.floor(diffDays / 30);
    if (months === 1) return "1 month";
    if (months < 12) return `${months} months`;

    const years = Math.floor(months / 12);
    return years === 1 ? "1 year" : `${years} years`;
  }

  function setStatusBadge(status) {
    const el = qs("#statusBadge");
    if (!el) return;

    const s = String(status || "Unknown");
    el.textContent = s;

    // reset
    el.classList.remove("bg-success", "bg-secondary", "bg-warning", "bg-danger", "bg-info", "text-dark");

    if (s === "Active") el.classList.add("bg-success");
    else if (s === "Inactive") el.classList.add("bg-secondary");
    else if (s === "Pending") el.classList.add("bg-warning", "text-dark");
    else if (s === "Archived") el.classList.add("bg-danger");
    else el.classList.add("bg-info");
  }

  function fillProfile(profile) {
    // Picture upload is disabled: always show default
    const img = qs("#profilePreview");
    if (img) img.src = "assets/images/profile.png";

    setInput("#id_number", profile.id_number);
    setInput("#school_year", profile.school_year);
    setInput("#first_name", profile.first_name);
    setInput("#last_name", profile.last_name);
    setInput("#middle_name", profile.middle_name);
    setInput("#suffix", profile.suffix);
    setInput("#department", profile.department);
    setInput("#email", profile.email);

    setText("#userTypeBadge", profile.user_type_label);
    setText("#roleBadge", profile.role_label);
    setText("#accountAge", `Account age: ${computeAccountAge(profile.created_at)}`);

    setStatusBadge(profile.status);
  }

  async function loadProfile() {
    const data = await postJSON({ action: "get" });
    fillProfile(data.profile || {});
    return data.profile;
  }

  async function saveProfile() {
    const emailEl = qs("#email");
    const firstNameEl = qs("#first_name");
    const middleNameEl = qs("#middle_name");
    const lastNameEl = qs("#last_name");
    const suffixEl = qs("#suffix");

    const email = String(emailEl?.value || "").trim();
    const first_name = String(firstNameEl?.value || "").trim();
    const middle_name = String(middleNameEl?.value || "").trim();
    const last_name = String(lastNameEl?.value || "").trim();
    const suffix = String(suffixEl?.value || "").trim();

    // Basic client-side validation
    if (!email) {
      safeShowError("Email is required.");
      return;
    }
    if (!first_name) {
      safeShowError("First name is required.");
      return;
    }
    if (!last_name) {
      safeShowError("Last name is required.");
      return;
    }

    const data = await postJSON({ 
      action: "update", 
      email,
      first_name,
      middle_name,
      last_name,
      suffix
    });
    fillProfile(data.profile || {});
    safeShowSuccess(data.message || "Profile updated.");
  }

  async function changePassword() {
    const currentPasswordEl = qs("#current_password");
    const newPasswordEl = qs("#new_password");
    const confirmPasswordEl = qs("#confirm_password");

    const current_password = currentPasswordEl?.value || "";
    const new_password = newPasswordEl?.value || "";
    const confirm_password = confirmPasswordEl?.value || "";

    if (!current_password || !new_password || !confirm_password) {
      safeShowError("All password fields are required.");
      return;
    }

    if (new_password !== confirm_password) {
      safeShowError("New password and confirm password do not match.");
      return;
    }

    if (new_password.length < 8) {
      safeShowError("Password must be at least 8 characters long.");
      return;
    }

    await postJSON({ 
      action: "change_password", 
      current_password,
      new_password,
      confirm_password
    });

    // Clear password fields
    currentPasswordEl.value = "";
    newPasswordEl.value = "";
    confirmPasswordEl.value = "";

    safeShowSuccess("Password changed successfully.");
  }

  function hookProfileMenu() {
    // Profile dropdown -> open modal
    document.addEventListener("click", async (e) => {
      const a = e.target.closest(".profile-link");
      if (!a) return;
      e.preventDefault();

      const modalEl = qs("#profileModal");
      if (!modalEl) return safeShowError("Profile modal not found.");

      const modal = bootstrap.Modal.getOrCreateInstance(modalEl);

      // Load data before showing (so no "flash" of empty)
      try {
        await loadProfile();
        modal.show();
      } catch (err) {
        safeShowError(err?.message || "Failed to load profile.");
      }
    });
  }

  function hookButtons() {
    const refreshBtn = qs("#refreshProfileBtn");
    if (refreshBtn) {
      refreshBtn.addEventListener("click", async () => {
        try {
          refreshBtn.disabled = true;
          await loadProfile();
          safeShowSuccess("Profile refreshed.");
        } catch (err) {
          safeShowError(err?.message || "Failed to refresh profile.");
        } finally {
          refreshBtn.disabled = false;
        }
      });
    }

    const saveBtn = qs("#saveProfileBtn");
    if (saveBtn) {
      saveBtn.addEventListener("click", async () => {
        try {
          saveBtn.disabled = true;
          await saveProfile();
        } catch (err) {
          safeShowError(err?.message || "Failed to save changes.");
        } finally {
          saveBtn.disabled = false;
        }
      });
    }

    const changePasswordBtn = qs("#changePasswordBtn");
    if (changePasswordBtn) {
      changePasswordBtn.addEventListener("click", async () => {
        try {
          changePasswordBtn.disabled = true;
          await changePassword();
        } catch (err) {
          safeShowError(err?.message || "Failed to change password.");
        } finally {
          changePasswordBtn.disabled = false;
        }
      });
    }
  }

  // Boot
  hookProfileMenu();
  hookButtons();
})();