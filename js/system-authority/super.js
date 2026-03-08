/* js/system-authority/super.js */
/* global bootstrap, showSuccess, showError */

(function () {
  "use strict";

  let S; // Shared injected from system-authority.js

  function setValue(id, val) {
    const el = S.qs(id);
    if (el) el.value = val ?? "";
  }

  function setText(id, val) {
    const el = S.qs(id);
    if (el) el.textContent = val ?? "—";
  }

  async function fetchCurrentSuper() {
    const data = await S.postJSON({ action: "view_by_role", role: "super_admin" });
    return data.user;
  }

  // -----------------------------
  // Reset Password (Super Admin)
  // -----------------------------

  function resetModalClear() {
    const result = S.qs("#resetPwdResult");
    if (result) result.classList.add("d-none");
    setValue("#resetPwdTemp", "");
  }

  function bindResetPasswordButton() {
    const btn = S.qs("#btnResetSuperPassword");
    if (!btn) return;

    btn.addEventListener("click", async () => {
      try {
        const u = await fetchCurrentSuper();

        // Paint modal details
        setText("#resetPwdRole", "Super Admin");
        setText(
          "#resetPwdName",
          u.full_name || [u.first_name, u.middle_name, u.last_name, u.suffix].filter(Boolean).join(" ")
        );
        setText("#resetPwdIdNum", u.id_number || "—");
        setValue("#resetPwdRoleValue", "super_admin");

        // store expected id for backend guard
        const confirmBtn = S.qs("#btnConfirmResetPwd");
        if (confirmBtn) {
          confirmBtn.dataset.role = "super_admin";
          confirmBtn.dataset.expectedId = String(u.id ?? "");
        }

        resetModalClear();
      } catch (e) {
        S.safeShowError(e?.message || "Failed to load Super Admin for reset.");
      }
    });
  }

  // Bind the shared confirm + copy handlers ONCE (used by both Super + SDC)
  function bindResetPasswordModalOnce() {
    if (window.__SystemAuthorityResetBound) return;
    window.__SystemAuthorityResetBound = true;

    const confirmBtn = document.querySelector("#btnConfirmResetPwd");
    const copyBtn = document.querySelector("#btnCopyResetPwd");
    const tempInput = document.querySelector("#resetPwdTemp");

    if (copyBtn && tempInput) {
      copyBtn.addEventListener("click", async () => {
        try {
          const val = tempInput.value || "";
          if (!val) return;
          await navigator.clipboard.writeText(val);
          if (typeof window.showSuccess === "function") window.showSuccess("Copied.");
        } catch {
          // fallback
          tempInput.select?.();
          document.execCommand?.("copy");
        }
      });
    }

    if (!confirmBtn) return;

    confirmBtn.addEventListener("click", async () => {
      const role = confirmBtn.dataset.role || document.querySelector("#resetPwdRoleValue")?.value || "";
      const expectedId = parseInt(confirmBtn.dataset.expectedId || "0", 10) || 0;

      if (!role) {
        if (typeof window.showError === "function") window.showError("Missing role for reset.");
        return;
      }

      const textSpan = confirmBtn.querySelector(".resetpwd-btn-text");
      const loadSpan = confirmBtn.querySelector(".resetpwd-btn-loading");

      confirmBtn.disabled = true;
      if (textSpan) textSpan.classList.add("d-none");
      if (loadSpan) loadSpan.classList.remove("d-none");

      try {
        const data = await S.postJSON({
          action: "reset_password",
          role,
          id: expectedId > 0 ? expectedId : undefined,
        });

        // Show temp password result
        const result = document.querySelector("#resetPwdResult");
        const temp = document.querySelector("#resetPwdTemp");
        if (temp) temp.value = data.temp_password || "";
        if (result) result.classList.remove("d-none");

        S.safeShowSuccess("Password reset successfully.");
      } catch (e) {
        S.safeShowError(e?.message || "Failed to reset password.");
      } finally {
        confirmBtn.disabled = false;
        if (textSpan) textSpan.classList.remove("d-none");
        if (loadSpan) loadSpan.classList.add("d-none");
      }
    });

    // When modal is hidden, clear the result for cleanliness
    const modalEl = document.querySelector("#modalResetAdminPassword");
    if (modalEl) {
      modalEl.addEventListener("hidden.bs.modal", () => {
        resetModalClear();
        // also remove expected id/role to avoid accidental reuse
        if (confirmBtn) {
          delete confirmBtn.dataset.role;
          delete confirmBtn.dataset.expectedId;
        }
        setValue("#resetPwdRoleValue", "");
        setText("#resetPwdRole", "—");
        setText("#resetPwdName", "—");
        setText("#resetPwdIdNum", "—");
      });
    }
  }

  // -----------------------------
  // Existing Super Admin handlers
  // -----------------------------

  function bindViewModal() {
    const modalEl = S.qs("#modalViewSuper");
    if (!modalEl) return;

    modalEl.addEventListener("show.bs.modal", async () => {
      try {
        const u = await fetchCurrentSuper();

        setText("#view_super_first", u.first_name);
        setText("#view_super_middle", u.middle_name || "—");
        setText("#view_super_last", u.last_name);
        setText("#view_super_suffix", u.suffix || "—");
        setText("#view_super_idnum", u.id_number);
        setText("#view_super_email", u.email || "—");
        setText("#view_super_status", u.status || "—");
        setText("#view_super_created", u.created_at || "—");
        setText("#view_super_lastlogin", u.last_login_at || "—");
      } catch (e) {
        S.safeShowError(e?.message || "Failed to load Super Admin.");
      }
    });
  }

  function bindEditModalPrefill() {
    const modalEl = S.qs("#modalEditSuper");
    if (!modalEl) return;

    modalEl.addEventListener("show.bs.modal", async () => {
      try {
        const u = await fetchCurrentSuper();

        setValue("#edit_super_id", u.id);
        setValue("#edit_super_first", u.first_name);
        setValue("#edit_super_middle", u.middle_name || "");
        setValue("#edit_super_last", u.last_name);
        setValue("#edit_super_suffix", u.suffix || "");
        setValue("#edit_super_idnum", u.id_number);
        setValue("#edit_super_email", u.email || "");
      } catch (e) {
        S.safeShowError(e?.message || "Failed to load edit form.");
      }
    });
  }

  function bindEditSubmit() {
    const form = S.qs("#formEditSuper");
    if (!form) return;

    form.addEventListener("submit", async (ev) => {
      ev.preventDefault();

      try {
        const payload = {
          action: "edit_user",
          role: "super_admin",
          id: S.qs("#edit_super_id")?.value,
          first_name: S.qs("#edit_super_first")?.value?.trim(),
          middle_name: S.qs("#edit_super_middle")?.value?.trim() || "",
          last_name: S.qs("#edit_super_last")?.value?.trim(),
          suffix: S.qs("#edit_super_suffix")?.value?.trim() || "",
          id_number: S.qs("#edit_super_idnum")?.value?.trim(),
          email: S.qs("#edit_super_email")?.value?.trim() || "",
          // status intentionally not sent (automatic backend rules)
        };

        await S.postJSON(payload);

        // close modal
        const modalEl = S.qs("#modalEditSuper");
        if (modalEl) bootstrap.Modal.getOrCreateInstance(modalEl).hide();

        S.safeShowSuccess("Super Admin updated.");
        window.SystemAuthority?.refresh?.();
      } catch (e) {
        S.safeShowError(e?.message || "Failed to update Super Admin.");
      }
    });
  }

  function bindReplaceSubmit() {
    const form = S.qs("#formReplaceSuper");
    if (!form) return;

    form.addEventListener("submit", async (ev) => {
      ev.preventDefault();

      try {
        const payload = {
          action: "replace_role",
          role: "super_admin",
          current_user_id: S.qs("#replace_super_current_id")?.value || "",
          first_name: S.qs("#replace_super_first")?.value?.trim(),
          middle_name: S.qs("#replace_super_middle")?.value?.trim() || "",
          last_name: S.qs("#replace_super_last")?.value?.trim(),
          suffix: S.qs("#replace_super_suffix")?.value?.trim() || "",
          id_number: S.qs("#replace_super_idnum")?.value?.trim(),
          email: S.qs("#replace_super_email")?.value?.trim() || "",
          reason: S.qs("#replace_super_reason")?.value?.trim() || "",
          // status intentionally not sent (new=Active, old=Inactive in backend)
        };

        await S.postJSON(payload);

        const modalEl = S.qs("#modalReplaceSuper");
        if (modalEl) bootstrap.Modal.getOrCreateInstance(modalEl).hide();

        // optional: reset form inputs
        form.reset();

        S.safeShowSuccess("Super Admin replaced successfully.");
        window.SystemAuthority?.refresh?.();
        window.SystemAuthorityAudit?.refresh?.(); // refresh logs if audit modal open
      } catch (e) {
        S.safeShowError(e?.message || "Failed to replace Super Admin.");
      }
    });
  }

  function init(shared) {
    S = shared;

    bindViewModal();
    bindEditModalPrefill();
    bindEditSubmit();
    bindReplaceSubmit();

    // ✅ Reset Password handler lives here (Super module)
    bindResetPasswordModalOnce();
    bindResetPasswordButton();
  }

  window.SystemAuthoritySuper = { init };
})();
