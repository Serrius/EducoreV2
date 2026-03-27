/* js/manage-users/manage-users.js */
/* global bootstrap, showSuccess, showError */

(function () {
  "use strict";

  console.log("User Student:", window.UsersStudent);
  console.log("User Faculty Admin:", window.UsersFacultyAdmin);
  console.log("User Moderator:", window.UsersModerator);
  console.log("User President:", window.UsersPresident);

  const API_URL = "php/manage-users.php";

  // -------------------------
  // Tiny DOM helpers
  // -------------------------
  function qs(sel, root = document) {
    return root.querySelector(sel);
  }
  function qsa(sel, root = document) {
    return Array.from(root.querySelectorAll(sel));
  }

  function escapeHtml(s) {
    return String(s ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function safeShowError(msg) {
    if (typeof window.showError === "function") return window.showError(msg);
    alert(msg || "Something went wrong.");
  }

  function safeShowSuccess(msg) {
    if (typeof window.showSuccess === "function") return window.showSuccess(msg);
    alert(msg || "Success.");
  }

  // -------------------------
  // Modal backdrop stack fix (Bootstrap)
  // -------------------------
  function cleanupModalBackdrops() {
    const openModals = document.querySelectorAll(".modal.show");
    const backdrops = document.querySelectorAll(".modal-backdrop");

    if (openModals.length === 0) {
      backdrops.forEach((b) => b.remove());
      document.body.classList.remove("modal-open");
      document.body.style.removeProperty("padding-right");
      document.body.style.removeProperty("overflow");
    } else if (backdrops.length > 1) {
      for (let i = 0; i < backdrops.length - 1; i++) backdrops[i].remove();
    }
  }

  document.addEventListener("hidden.bs.modal", cleanupModalBackdrops);
  document.addEventListener("shown.bs.modal", cleanupModalBackdrops);

  // -------------------------
  // Safe modal helpers
  // -------------------------
  function getModalEl(idOrSelector) {
    if (!idOrSelector) return null;
    if (typeof idOrSelector !== "string") return null;
    const sel = idOrSelector.startsWith("#") ? idOrSelector : `#${idOrSelector}`;
    return qs(sel);
  }

  function getOrCreateModal(idOrSelector) {
    const el = getModalEl(idOrSelector);
    if (!el) return null;

    try {
      return bootstrap.Modal.getOrCreateInstance(el, {
        backdrop: true,
        keyboard: true,
        focus: true,
      });
    } catch (e) {
      console.warn("[ManageUsers] getOrCreateModal failed:", e);
      return null;
    }
  }

  function showModal(idOrSelector) {
    const inst = getOrCreateModal(idOrSelector);
    if (!inst) {
      safeShowError("Modal not found. Please refresh the page.");
      return false;
    }

    cleanupModalBackdrops();
    try {
      inst.show();
      return true;
    } catch (e) {
      console.warn("[ManageUsers] showModal failed:", e);
      safeShowError("Failed to open modal. Please refresh.");
      return false;
    }
  }

  function hideModal(idOrSelector) {
    const inst = getOrCreateModal(idOrSelector);
    if (!inst) return false;

    try {
      inst.hide();
      cleanupModalBackdrops();
      return true;
    } catch (e) {
      console.warn("[ManageUsers] hideModal failed:", e);
      return false;
    }
  }

  function setModalHtml(idOrSelector, html) {
    const el = getModalEl(idOrSelector);
    if (!el) return false;

    const target =
      el.querySelector("[data-role='body']") ||
      el.querySelector(".modal-body") ||
      el;

    target.innerHTML = html;
    return true;
  }

  // -------------------------
  // Global Modal Utilities
  // -------------------------
  function showConfirmModal(config) {
    const modalEl = getModalEl("modalConfirmAction");
    if (!modalEl) {
      safeShowError("Confirmation modal not found.");
      return;
    }

    // Set title
    const titleEl = qs("#modalConfirmActionLabel", modalEl);
    if (titleEl) titleEl.textContent = config.title || "Confirm Action";

    // Set subtitle
    const subtitleEl = qs("#confirmModalSubtitle", modalEl);
    if (subtitleEl) subtitleEl.textContent = config.subtitle || "Please confirm your action";

    // Set message
    const messageEl = qs("#confirmModalMessage", modalEl);
    if (messageEl) messageEl.textContent = config.message || "Are you sure you want to perform this action?";

    // Set icon based on type
    const iconEl = qs("#confirmModalIcon", modalEl);
    if (iconEl) {
      const iconClasses = {
        success: "bi-check-circle-fill text-success",
        danger: "bi-exclamation-triangle-fill text-danger",
        warning: "bi-exclamation-triangle-fill text-warning",
        info: "bi-info-circle-fill text-info",
        archive: "bi-archive-fill text-warning",
        restore: "bi-arrow-counterclockwise text-success",
        approve: "bi-check-circle-fill text-success"
      };
      
      const iconClass = iconClasses[config.type] || "bi-question-circle-fill text-primary";
      iconEl.innerHTML = `<i class="bi ${iconClass}" style="font-size: 2rem;"></i>`;
    }

    // Set items if provided
    const detailsContainer = qs("#confirmModalDetails", modalEl);
    const itemsEl = qs("#confirmModalItems", modalEl);
    if (detailsContainer && itemsEl) {
      if (Array.isArray(config.items) && config.items.length > 0) {
        itemsEl.innerHTML = config.items
          .slice(0, 5)
          .map(item => `<div class="mb-1">${escapeHtml(item)}</div>`)
          .join("");
        detailsContainer.classList.remove("d-none");
      } else {
        detailsContainer.classList.add("d-none");
      }
    }

    // Set warning if needed
    const warningEl = qs("#confirmModalWarning", modalEl);
    const warningTextEl = qs("#confirmWarningText", modalEl);
    if (warningEl && warningTextEl) {
      if (config.showWarning && config.warningText) {
        warningTextEl.textContent = config.warningText;
        warningEl.classList.remove("d-none");
      } else {
        warningEl.classList.add("d-none");
      }
    }

    // Configure action button
    const actionBtn = qs("#confirmModalActionBtn", modalEl);
    if (actionBtn) {
      actionBtn.textContent = config.btnText || "Confirm";
      
      const btnClasses = {
        primary: "btn-primary",
        success: "btn-success", 
        danger: "btn-danger",
        warning: "btn-warning",
        info: "btn-info"
      };
      
      actionBtn.classList.remove("btn-primary", "btn-success", "btn-danger", "btn-warning", "btn-info", "btn-outline-secondary");
      
      const btnClass = config.btnClass || "primary";
      actionBtn.classList.add(btnClasses[btnClass] || "btn-primary");
      
      const currentIcon = actionBtn.querySelector(".bi");
      if (currentIcon) {
        currentIcon.remove();
      }
      
      if (config.btnIcon) {
        const icon = document.createElement("i");
        icon.className = `bi bi-${config.btnIcon} me-2`;
        actionBtn.prepend(icon);
      }
      
      const newActionBtn = actionBtn.cloneNode(true);
      actionBtn.parentNode.replaceChild(newActionBtn, actionBtn);
      
      newActionBtn.addEventListener("click", async (e) => {
        e.preventDefault();
        
        if (typeof config.onConfirm === "function") {
          try {
            const originalText = newActionBtn.innerHTML;
            newActionBtn.innerHTML = `<span class="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span>Processing...`;
            await config.onConfirm();
            
            const modalInstance = bootstrap.Modal.getInstance(modalEl);
            if (modalInstance) {
              modalInstance.hide();
            }
          } catch (error) {
            newActionBtn.innerHTML = originalText;
            newActionBtn.disabled = false;
            console.error("Confirm action failed:", error);
            safeShowError(error?.message || "Action failed. Please try again.");
          }
        } else {
          const modalInstance = bootstrap.Modal.getInstance(modalEl);
          if (modalInstance) {
            modalInstance.hide();
          }
        }
      });
    }

    // Configure cancel button
    const cancelBtn = modalEl.querySelector('button[data-bs-dismiss="modal"]');
    if (cancelBtn) {
      const newCancelBtn = cancelBtn.cloneNode(true);
      cancelBtn.parentNode.replaceChild(newCancelBtn, cancelBtn);
      
      newCancelBtn.addEventListener("click", (e) => {
        e.preventDefault();
        const modalInstance = bootstrap.Modal.getInstance(modalEl);
        if (modalInstance) {
          modalInstance.hide();
        }
      });
    }

    showModal("modalConfirmAction");
  }

  function showSuccessModal(config) {
    const modalEl = getModalEl("modalSuccess");
    if (!modalEl) {
      safeShowSuccess(config.message || "Operation completed successfully.");
      return;
    }

    const titleEl = qs("#successModalTitle", modalEl);
    if (titleEl) titleEl.textContent = config.title || "Success";

    const messageEl = qs("#successModalMessage", modalEl);
    if (messageEl) messageEl.textContent = config.message || "Operation completed successfully.";

    const iconEl = qs("#successModalIcon", modalEl);
    if (iconEl && config.icon) {
      iconEl.className = `bi bi-${config.icon}`;
      iconEl.classList.add("text-success");
    }

    const okBtn = qs("#successModalOkBtn", modalEl);
    if (okBtn) {
      const newOkBtn = okBtn.cloneNode(true);
      okBtn.parentNode.replaceChild(newOkBtn, okBtn);
      
      newOkBtn.addEventListener("click", (e) => {
        e.preventDefault();
        const modalInstance = bootstrap.Modal.getInstance(modalEl);
        if (modalInstance) {
          modalInstance.hide();
        }
      });
    }

    showModal("modalSuccess");
  }

  // -------------------------
  // Robust JSON POST
  // -------------------------
  async function postJSON(payload) {
    const res = await fetch(API_URL, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload || {}),
    });

    const text = await res.text();

    if (payload?.action === "meta") {
      console.log("[ManageUsers] META RAW:", res.status, text);
    }

    let data;
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error("Invalid server response (not JSON). Check META RAW in console.");
    }

    if (!res.ok) throw new Error(data?.message || data?.error || `HTTP ${res.status}`);
    if (!data || data.success !== true) throw new Error(data?.message || data?.error || "Request failed.");
    return data;
  }

  // -------------------------
  // CSV Helpers
  // -------------------------
  function toCSV(rows, headers) {
    const esc = (v) => {
      const s = String(v ?? "");
      if (/[,"\n]/.test(s)) return `"${s.replaceAll('"', '""')}"`;
      return s;
    };
    const lines = [];
    lines.push(headers.map(esc).join(","));
    for (const r of rows) lines.push(headers.map((h) => esc(r[h])).join(","));
    return lines.join("\n");
  }

  function downloadText(filename, text) {
    const blob = new Blob([text], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(a.href);
  }

  // -------------------------
  // Shared state
  // -------------------------
  const state = {
    meta: {
      active_term: null,
      programs: [],
    },
    observers: {
      programSelect: null,
    },
  };

  // -------------------------
  // Active term -> School Year input
  // -------------------------
  function getActiveSchoolYear() {
    const term = state.meta.active_term;
    if (!term) return "";
    return String(term.school_year ?? "").trim();
  }

  function applyActiveTermToStudentSchoolYear({ force = false } = {}) {
    const sy = getActiveSchoolYear();
    const input = qs("#student_school_year");
    if (!input) return;

    if (!sy) {
      input.placeholder = "YYYY-YYYY";
      return;
    }

    const cur = String(input.value ?? "").trim();
    if (force || cur === "") input.value = sy;

    input.placeholder = "YYYY-YYYY";
    input.setAttribute("maxlength", "9");
  }

  // -------------------------
  // Programs normalize + lookup
  // -------------------------
  function normalizePrograms(raw) {
    if (!Array.isArray(raw)) return [];

    const out = raw
      .map((p) => ({
        id: p?.id ?? "",
        program_name: String(p?.program_name ?? "").trim(),
        abbreviation: String(p?.abbreviation ?? "").trim(),
        status: String(p?.status ?? "").trim(),
      }))
      .filter((p) => p.program_name || p.abbreviation);

    out.sort((a, b) => {
      const A = (a.abbreviation || a.program_name).toLowerCase();
      const B = (b.abbreviation || b.program_name).toLowerCase();
      return A.localeCompare(B);
    });

    return out;
  }

  function findProgramByAny(value) {
    const v = String(value ?? "").trim().toLowerCase();
    if (!v) return null;
    const list = normalizePrograms(state.meta.programs);
    return (
      list.find((p) => String(p.abbreviation).toLowerCase() === v) ||
      list.find((p) => String(p.program_name).toLowerCase() === v) ||
      null
    );
  }

  function programLabel(p) {
    if (p.abbreviation && p.program_name) return `${p.abbreviation} — ${p.program_name}`;
    return p.abbreviation || p.program_name || "—";
  }

  // -------------------------
  // Program select (VALUE = ABBREVIATION)
  // -------------------------
  function populateProgramSelect({ force = false, debugTag = "" } = {}) {
    const sel = qs("#student_program");
    if (!sel) {
      console.warn("[ManageUsers] #student_program not found.", debugTag);
      return false;
    }

    const programs = normalizePrograms(state.meta.programs);

    const currentValRaw = String(sel.value ?? "").trim();
    const currentProg = currentValRaw ? findProgramByAny(currentValRaw) : null;
    const currentVal = currentProg?.abbreviation ? currentProg.abbreviation : currentValRaw;

    sel.innerHTML = `<option value="" selected>— Select program —</option>`;

    for (const p of programs) {
      const abbr = (p.abbreviation || "").trim();
      if (!abbr) continue;

      const opt = document.createElement("option");
      opt.value = abbr;
      opt.textContent = programLabel(p);
      opt.dataset.programName = p.program_name || "";
      sel.appendChild(opt);
    }

    if (!force && currentVal) {
      const exists = Array.from(sel.options).some((o) => o.value === currentVal);
      if (exists) sel.value = currentVal;
    }

    console.log(`[ManageUsers] Program select populated (${sel.options.length - 1} programs).`, debugTag);
    return sel.options.length > 1;
  }

  function observeProgramSelect() {
    const sel = qs("#student_program");
    if (!sel) return;

    if (state.observers.programSelect) return;

    const obs = new MutationObserver(() => {
      if (
        sel.options.length <= 1 &&
        Array.isArray(state.meta.programs) &&
        state.meta.programs.length > 0
      ) {
        populateProgramSelect({ force: true, debugTag: "MutationObserver:self-heal" });
      }
    });

    obs.observe(sel, { childList: true, subtree: false });
    state.observers.programSelect = obs;
  }

  function waitForElement(selector, timeoutMs = 2000) {
    return new Promise((resolve) => {
      const start = Date.now();

      (function tick() {
        const el = qs(selector);
        if (el) return resolve(el);

        if (Date.now() - start >= timeoutMs) return resolve(null);
        setTimeout(tick, 50);
      })();
    });
  }

  // -------------------------
  // Program abbreviation helper (TABLE display)
  // -------------------------
  function programAbbrevFromRow(row) {
    if (!row) return "—";

    const candidates = [
      row.program_abbr,
      row.program_abbreviation,
      row.program_code,
      row.program_short,
      row.programAbbr,
      row.programCode,
      row.programShort,
    ].filter(Boolean);

    if (candidates.length) return String(candidates[0]).trim();

    const raw = String(row.program || "").trim();
    if (!raw) return "—";

    if (raw.length <= 10 && !/\s/.test(raw)) return raw;

    const found = findProgramByAny(raw);
    if (found?.abbreviation) return found.abbreviation;

    const beforeParen = raw.split("(")[0].trim();
    if (beforeParen && beforeParen.length <= 10 && !/\s/.test(beforeParen)) return beforeParen;

    return raw;
  }

  // -------------------------
  // Meta loader
  // -------------------------
  async function loadMeta() {
    const data = await postJSON({ action: "meta" });

    state.meta.active_term = data.active_term || null;
    state.meta.programs = Array.isArray(data.programs) ? data.programs : [];

    console.log("[ManageUsers] meta.active_term:", state.meta.active_term);
    console.log("[ManageUsers] meta.programs length:", state.meta.programs.length, state.meta.programs);

    applyActiveTermToStudentSchoolYear({ force: false });

    const sel = await waitForElement("#student_program", 2500);
    if (sel) {
      populateProgramSelect({ force: true, debugTag: "loadMeta" });
      observeProgramSelect();
    }

    return state.meta;
  }

  // -------------------------
  // Shared object
  // -------------------------
  const Shared = {
    API_URL,
    qs,
    qsa,
    escapeHtml,
    safeShowError,
    safeShowSuccess,
    postJSON,
    toCSV,
    downloadText,

    getMeta: () => state.meta,
    populateProgramSelect,

    getModalEl,
    getOrCreateModal,
    showModal,
    hideModal,
    setModalHtml,
    
    showConfirmModal,
    showSuccessModal,

    programAbbrevFromRow,
    findProgramByAny,
  };

  // -------------------------
  // Event isolation
  // -------------------------
  function _isInStaffArea(target) {
    if (!target) return false;
    return !!target.closest(
      "#facultyActiveTbody, #facultyInactiveTbody, #facultyArchivedTbody, " +
      "#moderatorsActiveTbody, #moderatorsInactiveTbody, #moderatorsArchivedTbody"
    );
  }

  function _isStudentActionClick(target) {
    if (!target) return false;
    return !!target.closest(".mu-view-one, .mu-edit-one, .mu-reset-one, .mu-set-status");
  }

  function _wrapStudentDocumentClickListener(fn) {
    if (typeof fn !== "function") return fn;
    return function (e) {
      try {
        if (_isStudentActionClick(e.target) && _isInStaffArea(e.target)) return;
      } catch (_) {}
      return fn.call(this, e);
    };
  }

  function _interceptDocumentAddListeners(runInit) {
    const added = [];
    const origAdd = document.addEventListener.bind(document);
    document.addEventListener = function (type, listener, options) {
      added.push({ type, listener, options });
      return origAdd(type, listener, options);
    };
    try {
      runInit();
    } finally {
      document.addEventListener = origAdd;
    }
    return added;
  }

  function _patchStudentClickDelegation(addedListeners) {
    for (const it of addedListeners) {
      if (it.type !== "click" || typeof it.listener !== "function") continue;

      const src = Function.prototype.toString.call(it.listener);
      const looksLikeStudentRowHandler =
        src.includes(".mu-view-one") || src.includes(".mu-edit-one") || src.includes("openViewStudent") || src.includes("openEditStudent");

      if (!looksLikeStudentRowHandler) continue;

      try {
        document.removeEventListener("click", it.listener, it.options);
      } catch (_) {}

      const wrapped = _wrapStudentDocumentClickListener(it.listener);
      document.addEventListener("click", wrapped, it.options);
    }
  }

  // -------------------------
  // Modal collision guard
  // -------------------------
  function bindAddModalCollisionGuard() {
    if (window.__MU_ADD_GUARD_BOUND) return;
    window.__MU_ADD_GUARD_BOUND = true;

    function hideIfShown(id) {
      const el = qs(id);
      if (!el) return;
      if (!el.classList.contains("show")) return;
      try {
        bootstrap.Modal.getOrCreateInstance(el).hide();
      } catch (_) {}
    }

    function settle() {
      const student = qs("#modalAddStudent");
      const faculty = qs("#modalAddFaculty");
      const moderator = qs("#modalAddModerator");

      const studentShown = !!(student && student.classList.contains("show"));
      const facultyShown = !!(faculty && faculty.classList.contains("show"));
      const moderatorShown = !!(moderator && moderator.classList.contains("show"));

      const anyStaffShown = facultyShown || moderatorShown;
      if (!(studentShown && anyStaffShown)) return;

      const intent = window.__MU_LAST_ADD_INTENT || "student";
      if (intent === "student") {
        hideIfShown("#modalAddFaculty");
        hideIfShown("#modalAddModerator");
      } else {
        hideIfShown("#modalAddStudent");
      }
    }

    document.addEventListener("click", (e) => {
      const t = e.target;
      if (!t) return;

      if (t.closest("#btnAddStudentTab")) window.__MU_LAST_ADD_INTENT = "student";
      if (t.closest("#btnAddFacultyTab, #btnAddModeratorTab")) window.__MU_LAST_ADD_INTENT = "staff";

      setTimeout(settle, 0);
    }, true);
  }

  function initModules() {
    bindAddModalCollisionGuard();

    if (window.UsersStudent?.init) {
      const added = _interceptDocumentAddListeners(() => window.UsersStudent.init(Shared));
      _patchStudentClickDelegation(added);
    } else {
      console.warn("[ManageUsers] students.js missing (window.UsersStudent).");
    }

    if (window.UsersFacultyAdmin?.init) window.UsersFacultyAdmin.init(Shared);
    else console.warn("[ManageUsers] faculty-admin.js missing (window.UsersFacultyAdmin).");

    if (window.UsersModerator?.init) window.UsersModerator.init(Shared);
    else console.warn("[ManageUsers] moderator.js missing (window.UsersModerator).");
    
    if (window.UsersPresident?.init) window.UsersPresident.init(Shared);
    else console.warn("[ManageUsers] presidents.js missing (window.UsersPresident).");
  }

  // FIXED: Single refreshAll function that includes all modules
  async function refreshAll() {
    try {
      await loadMeta();

      populateProgramSelect({ force: false, debugTag: "refreshAll:afterMeta" });

      await window.UsersStudent?.refresh?.();
      await window.UsersFacultyAdmin?.refresh?.();
      await window.UsersModerator?.refresh?.();
      await window.UsersPresident?.refresh?.();

      applyActiveTermToStudentSchoolYear({ force: false });
      populateProgramSelect({ force: true, debugTag: "refreshAll:afterModules" });

      cleanupModalBackdrops();
      
      console.log("[ManageUsers] All modules refreshed successfully");
    } catch (e) {
      safeShowError(e?.message || "Failed to refresh Manage Users.");
    }
  }

  function bindGlobalRefreshBtn() {
    const btn = qs("#btnRefreshUsers");
    if (!btn) return;
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      refreshAll();
    });
  }

  // -------------------------
  // Exclusive Add buttons
  // -------------------------
  function bindExclusiveAddButtons() {
    if (window.__MU_EXCLUSIVE_ADD_BOUND) return;
    window.__MU_EXCLUSIVE_ADD_BOUND = true;

    function hideIfShown(selector) {
      const el = qs(selector);
      if (!el) return;
      if (!el.classList.contains("show")) return;
      try { bootstrap.Modal.getOrCreateInstance(el).hide(); } catch (_) {}
    }

    function openStudentAdd(e) {
      e.preventDefault();
      e.stopPropagation();
      if (typeof e.stopImmediatePropagation === "function") e.stopImmediatePropagation();

      window.__MU_LAST_ADD_INTENT = "student";
      hideIfShown("#modalAddFaculty"); hideIfShown("#modalAddModerator");
      showModal("modalAddStudent");
    }

    const btnStudent = qs("#btnAddStudentTab");
    if (btnStudent) btnStudent.addEventListener("click", openStudentAdd, true);

    const addStudentEl = qs("#modalAddStudent");
    const addFacultyEl = qs("#modalAddFaculty");
    const addModeratorEl = qs("#modalAddModerator");

    function hideAllStaffAdds() {
      hideIfShown("#modalAddFaculty");
      hideIfShown("#modalAddModerator");
    }

    if (addStudentEl) {
      addStudentEl.addEventListener("show.bs.modal", hideAllStaffAdds);
      addStudentEl.addEventListener("shown.bs.modal", hideAllStaffAdds);
    }
    if (addFacultyEl) {
      addFacultyEl.addEventListener("show.bs.modal", () => hideIfShown("#modalAddStudent"));
      addFacultyEl.addEventListener("shown.bs.modal", () => hideIfShown("#modalAddStudent"));
    }
    if (addModeratorEl) {
      addModeratorEl.addEventListener("show.bs.modal", () => hideIfShown("#modalAddStudent"));
      addModeratorEl.addEventListener("shown.bs.modal", () => hideIfShown("#modalAddStudent"));
    }
  }

  function bindAddStudentModalAutofill() {
    const modalEl = qs("#modalAddStudent");
    if (!modalEl) return;

    modalEl.addEventListener("shown.bs.modal", async () => {
      try {
        if (!state.meta.active_term || !Array.isArray(state.meta.programs)) {
          await loadMeta();
        }

        applyActiveTermToStudentSchoolYear({ force: true });
        populateProgramSelect({ force: true, debugTag: "modal:shown:immediate" });
        observeProgramSelect();

        setTimeout(() => {
          applyActiveTermToStudentSchoolYear({ force: true });
          populateProgramSelect({ force: true, debugTag: "modal:shown:timeout120" });
        }, 120);

        setTimeout(() => {
          populateProgramSelect({ force: true, debugTag: "modal:shown:timeout350" });
        }, 350);
      } catch (e) {
        console.warn("[ManageUsers] modal autofill failed:", e);
      }
    });
  }

  // -------------------------
  // Listen to notification "open user" event
  // -------------------------
  function bindNotifOpenUserListener() {
    if (window.__MU_NOTIF_OPEN_USER_BOUND) return;
    window.__MU_NOTIF_OPEN_USER_BOUND = true;

    window.addEventListener("notif:openUser", async (ev) => {
      try {
        const detail = ev?.detail || {};
        const userId = String(detail.userId || "").trim();
        const idNumber = String(detail.idNumber || "").trim();

        await refreshAll();

        if (window.UsersStudent?.openFromNotification) {
          await window.UsersStudent.openFromNotification({ userId, idNumber });
          return;
        }

        safeShowError("Students module can't open notification user yet (missing openFromNotification).");
      } catch (e) {
        safeShowError(e?.message || "Failed to open user from notification.");
      }
    });
  }

  function init() {
    bindExclusiveAddButtons();
    bindGlobalRefreshBtn();
    bindAddStudentModalAutofill();
    initModules();
    refreshAll();

    bindNotifOpenUserListener();
  }

  window.ManageUsers = {
    init,
    refresh: refreshAll,
    Shared,
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();