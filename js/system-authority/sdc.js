/* js/system-authority/sdc.js */
/* global bootstrap, showSuccess, showError */

(function () {
  "use strict";

  let S;

  function setValue(id, val) {
    const el = S.qs(id);
    if (el) el.value = val ?? "";
  }
  function setText(id, val) {
    const el = S.qs(id);
    if (el) el.textContent = val ?? "—";
  }

  async function fetchCurrentSDC() {
    const data = await S.postJSON({ action: "view_by_role", role: "special_admin" });
    return data.user;
  }

  // -----------------------------
  // Reset Password (SDC)
  // -----------------------------

  function resetModalClear() {
    const result = S.qs("#resetPwdResult");
    if (result) result.classList.add("d-none");
    setValue("#resetPwdTemp", "");
  }

  function bindResetPasswordButton() {
    const btn = S.qs("#btnResetSDCPassword");
    if (!btn) return;

    btn.addEventListener("click", async () => {
      try {
        const u = await fetchCurrentSDC();

        // Paint modal details
        setText("#resetPwdRole", "Student Development Coordinator");
        setText(
          "#resetPwdName",
          u.full_name || [u.first_name, u.middle_name, u.last_name, u.suffix].filter(Boolean).join(" ")
        );
        setText("#resetPwdIdNum", u.id_number || "—");
        setValue("#resetPwdRoleValue", "special_admin");

        // store expected id for backend guard
        const confirmBtn = S.qs("#btnConfirmResetPwd");
        if (confirmBtn) {
          confirmBtn.dataset.role = "special_admin";
          confirmBtn.dataset.expectedId = String(u.id ?? "");
        }

        resetModalClear();
      } catch (e) {
        S.safeShowError(e?.message || "Failed to load SDC for reset.");
      }
    });
  }

  // Note: the confirm + copy handlers are bound ONCE in super.js (window.__SystemAuthorityResetBound).
  // If you remove super.js or load sdc.js first, you can move that modal binding here as well.
  // In your current setup, system-authority.js initializes Super first, then SDC.

  function bindViewModal() {
    const modalEl = S.qs("#modalViewSDC");
    if (!modalEl) return;

    modalEl.addEventListener("show.bs.modal", async () => {
      try {
        const u = await fetchCurrentSDC();

        setText("#view_sdc_first", u.first_name);
        setText("#view_sdc_middle", u.middle_name || "—");
        setText("#view_sdc_last", u.last_name);
        setText("#view_sdc_suffix", u.suffix || "—");
        setText("#view_sdc_idnum", u.id_number);
        setText("#view_sdc_email", u.email || "—");
        setText("#view_sdc_status", u.status || "—");
        setText("#view_sdc_created", u.created_at || "—");
        setText("#view_sdc_lastlogin", u.last_login_at || "—");
      } catch (e) {
        S.safeShowError(e?.message || "Failed to load SDC.");
      }
    });
  }

  function bindEditModalPrefill() {
    const modalEl = S.qs("#modalEditSDC");
    if (!modalEl) return;

    modalEl.addEventListener("show.bs.modal", async () => {
      try {
        const u = await fetchCurrentSDC();

        setValue("#edit_sdc_id", u.id);
        setValue("#edit_sdc_first", u.first_name);
        setValue("#edit_sdc_middle", u.middle_name || "");
        setValue("#edit_sdc_last", u.last_name);
        setValue("#edit_sdc_suffix", u.suffix || "");
        setValue("#edit_sdc_idnum", u.id_number);
        setValue("#edit_sdc_email", u.email || "");
      } catch (e) {
        S.safeShowError(e?.message || "Failed to load edit form.");
      }
    });
  }

  function bindEditSubmit() {
    const form = S.qs("#formEditSDC");
    if (!form) return;

    form.addEventListener("submit", async (ev) => {
      ev.preventDefault();

      try {
        const payload = {
          action: "edit_user",
          role: "special_admin",
          id: S.qs("#edit_sdc_id")?.value,
          first_name: S.qs("#edit_sdc_first")?.value?.trim(),
          middle_name: S.qs("#edit_sdc_middle")?.value?.trim() || "",
          last_name: S.qs("#edit_sdc_last")?.value?.trim(),
          suffix: S.qs("#edit_sdc_suffix")?.value?.trim() || "",
          id_number: S.qs("#edit_sdc_idnum")?.value?.trim(),
          email: S.qs("#edit_sdc_email")?.value?.trim() || "",
        };

        await S.postJSON(payload);

        const modalEl = S.qs("#modalEditSDC");
        if (modalEl) bootstrap.Modal.getOrCreateInstance(modalEl).hide();

        S.safeShowSuccess("SDC updated.");
        window.SystemAuthority?.refresh?.();
      } catch (e) {
        S.safeShowError(e?.message || "Failed to update SDC.");
      }
    });
  }

  function bindReplaceSubmit() {
    const form = S.qs("#formReplaceSDC");
    if (!form) return;

    form.addEventListener("submit", async (ev) => {
      ev.preventDefault();

      try {
        const payload = {
          action: "replace_role",
          role: "special_admin",
          current_user_id: S.qs("#replace_sdc_current_id")?.value || "",
          first_name: S.qs("#replace_sdc_first")?.value?.trim(),
          middle_name: S.qs("#replace_sdc_middle")?.value?.trim() || "",
          last_name: S.qs("#replace_sdc_last")?.value?.trim(),
          suffix: S.qs("#replace_sdc_suffix")?.value?.trim() || "",
          id_number: S.qs("#replace_sdc_idnum")?.value?.trim(),
          email: S.qs("#replace_sdc_email")?.value?.trim() || "",
          reason: S.qs("#replace_sdc_reason")?.value?.trim() || "",
        };

        await S.postJSON(payload);

        const modalEl = S.qs("#modalReplaceSDC");
        if (modalEl) bootstrap.Modal.getOrCreateInstance(modalEl).hide();

        form.reset();

        S.safeShowSuccess("SDC replaced successfully.");
        window.SystemAuthority?.refresh?.();
        window.SystemAuthorityAudit?.refresh?.();
      } catch (e) {
        S.safeShowError(e?.message || "Failed to replace SDC.");
      }
    });
  }

  function init(shared) {
    S = shared;

    bindViewModal();
    bindEditModalPrefill();
    bindEditSubmit();
    bindReplaceSubmit();

    // ✅ Reset Password handler lives here (SDC module)
    bindResetPasswordButton();
  }

  window.SystemAuthoritySDC = { init };
})();
