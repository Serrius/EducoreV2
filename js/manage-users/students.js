/* js/manage-users/students.js */
/* global bootstrap */

(function () {
  "use strict";

  /* Make dropdown-menu escape overflow containers by portaling to <body> */
  function enableDropdownPortal() {
    // prevent double-binding if your page re-inits scripts
    if (window.__muDropdownPortalBound) return;
    window.__muDropdownPortalBound = true;

    const stash = new WeakMap();
    const ACTIVE_CLASS = "mu-portal-open";

    function isTrapped(el) {
      return !!el.closest(
        ".table-responsive, .table-responsive-sm, .table-responsive-md, .table-responsive-lg, .table-responsive-xl, .table-responsive-xxl, .main"
      );
    }

    function hardNeutralizePopperStyles(menu) {
      // Popper injects these; remove/override so our fixed positioning wins
      menu.style.transform = "none";
      menu.style.inset = "auto";
      menu.style.right = "auto";
      menu.style.bottom = "auto";

      // ✅ prevent “stretched like hell”
      menu.style.width = "auto";
      menu.style.minWidth = "220px";
      menu.style.maxWidth = "320px"; // ~300px feel
      menu.style.whiteSpace = "normal";
      menu.style.overflowWrap = "anywhere";
      menu.style.boxSizing = "border-box";
    }

    function place(toggle, menu) {
      const r = toggle.getBoundingClientRect();

      // fixed overlay so it ignores overflow/scroll parents
      menu.style.position = "fixed";
      menu.style.zIndex = "3000";
      menu.style.display = "block";
      menu.style.visibility = "hidden";

      hardNeutralizePopperStyles(menu);

      const mw = menu.offsetWidth;
      const mh = menu.offsetHeight;

      // dropdown-menu-end behavior (align right edge of toggle)
      let left = r.right - mw;
      let top = r.bottom;

      const pad = 8;

      // clamp X within viewport
      left = Math.max(pad, Math.min(left, window.innerWidth - mw - pad));

      // flip up if clipped
      if (top + mh > window.innerHeight - pad) top = r.top - mh;
      top = Math.max(pad, Math.min(top, window.innerHeight - mh - pad));

      menu.style.left = `${left}px`;
      menu.style.top = `${top}px`;
      menu.style.visibility = "visible";
    }

    function restoreOne(menu) {
      const info = stash.get(menu);
      if (!info) return;

      menu.classList.remove(ACTIVE_CLASS);

      // restore original inline styles exactly
      if (info.originalStyle == null) menu.removeAttribute("style");
      else menu.setAttribute("style", info.originalStyle);

      // return to original DOM position
      info.parent.insertBefore(menu, info.next || null);

      const onReflow = menu._mu_reflow;
      if (onReflow) {
        window.removeEventListener("scroll", onReflow, true);
        window.removeEventListener("resize", onReflow, true);
        delete menu._mu_reflow;
      }
      delete menu._mu_toggle;
    }

    // ✅ Use show event (before Popper starts dancing), then portal immediately
    document.addEventListener("show.bs.dropdown", (e) => {
      const dd = e.target; // .dropdown
      const toggle = dd.querySelector('[data-bs-toggle="dropdown"]');
      const menu = dd.querySelector(".dropdown-menu");
      if (!toggle || !menu) return;

      // only portal if inside scroll/overflow jail
      if (!isTrapped(dd)) return;

      // IMPORTANT: stop Bootstrap from using Popper on this dropdown
      // (JS-only, no HTML edits required)
      toggle.setAttribute("data-bs-display", "static");

      // store original location + style (once)
      if (!stash.has(menu)) {
        stash.set(menu, {
          parent: menu.parentNode,
          next: menu.nextSibling,
          originalStyle: menu.getAttribute("style"),
        });
      }

      menu.classList.add(ACTIVE_CLASS);

      // move to <body> now (so it won't be clipped)
      document.body.appendChild(menu);

      // wait one frame so Bootstrap adds .show, then position
      requestAnimationFrame(() => {
        place(toggle, menu);

        const onReflow = () => place(toggle, menu);
        window.addEventListener("scroll", onReflow, true);
        window.addEventListener("resize", onReflow, true);
        menu._mu_reflow = onReflow;
        menu._mu_toggle = toggle;
      });
    });

    document.addEventListener("hidden.bs.dropdown", (e) => {
      const dd = e.target;
      const menu = dd.querySelector(".dropdown-menu");
      if (!menu) return;

      // restore if we portaled it
      if (menu.classList.contains(ACTIVE_CLASS) && menu.parentElement === document.body) {
        restoreOne(menu);
      }
    });

    // Safety net: if bootstrap closes it without hidden event (rare), restore anyway
    document.addEventListener("click", () => {
      document.querySelectorAll(`body > .dropdown-menu.${ACTIVE_CLASS}`).forEach((menu) => {
        if (menu.classList.contains("show")) return;
        restoreOne(menu);
      });
    });

    document.addEventListener("keydown", (e) => {
      if (e.key !== "Escape") return;
      document.querySelectorAll(`body > .dropdown-menu.${ACTIVE_CLASS}`).forEach((menu) => {
        // bootstrap will close; we restore on hidden/click safety net
        menu.classList.remove("show");
      });
    });
  }

  let S = null;

  const GROUP = "students";
  const STATUSES = ["Pending", "Active", "Inactive", "Archived"];
  const PRESIDENT_STATUS = "President"; // New separate group

  const UI = {
    Pending: {
      tbody: "#studentsPendingTbody",
      meta: "#studentsPendingMeta",
      pag: "#studentsPendingPagination",
      bulkBar: "#studentsPendingBulkBar",
      selCount: "#studentsPendingSelectedCount",
      btnSelectAll: "#studentsPendingSelectAllBtn",
      btnClear: "#studentsPendingClearSelectionBtn",
      btnExport: "#studentsPendingExportSelectedBtn",
      btnApprove: "#studentsPendingApproveSelectedBtn",
      btnReject: "#studentsPendingRejectSelectedBtn",
    },
    Active: {
      tbody: "#studentsActiveTbody",
      meta: "#studentsActiveMeta",
      pag: "#studentsActivePagination",
      bulkBar: "#studentsActiveBulkBar",
      selCount: "#studentsActiveSelectedCount",
      btnSelectAll: "#studentsActiveSelectAllBtn",
      btnClear: "#studentsActiveClearSelectionBtn",
      btnExport: "#studentsActiveExportSelectedBtn",
      btnArchive: "#studentsActiveArchiveSelectedBtn",
    },
    Inactive: {
      tbody: "#studentsInactiveTbody",
      meta: "#studentsInactiveMeta",
      pag: "#studentsInactivePagination",
      bulkBar: "#studentsInactiveBulkBar",
      selCount: "#studentsInactiveSelectedCount",
      btnSelectAll: "#studentsInactiveSelectAllBtn",
      btnClear: "#studentsInactiveClearSelectionBtn",
      btnExport: "#studentsInactiveExportSelectedBtn",
      btnArchive: "#studentsInactiveArchiveSelectedBtn",
    },
    Archived: {
      tbody: "#studentsArchivedTbody",
      meta: "#studentsArchivedMeta",
      pag: "#studentsArchivedPagination",
      bulkBar: "#studentsArchivedBulkBar",
      selCount: "#studentsArchivedSelectedCount",
      btnSelectAll: "#studentsArchivedSelectAllBtn",
      btnClear: "#studentsArchivedClearSelectionBtn",
      btnExport: "#studentsArchivedExportSelectedBtn",
      btnRestore: "#studentsArchivedRestoreSelectedBtn",
    },
    President: { // NEW: President UI configuration
      tbody: "#studentsPresidentTbody",
      meta: "#studentsPresidentMeta",
      pag: "#studentsPresidentPagination",
      bulkBar: "#studentsPresidentBulkBar",
      selCount: "#studentsPresidentSelectedCount",
      btnSelectAll: "#studentsPresidentSelectAllBtn",
      btnClear: "#studentsPresidentClearSelectionBtn",
      btnExport: "#studentsPresidentExportSelectedBtn",
    },
  };

  const common = {
    // Updated to use per-tab search inputs instead of a global one
    searchPending: "#studentsPendingSearch",
    searchActive: "#studentsActiveSearch",
    searchInactive: "#studentsInactiveSearch",
    searchArchived: "#studentsArchivedSearch",
    pageSize: "#studentsPageSize", // You'll need to add this to HTML
    exportPendingCsv: "#exportStudentsPendingCsv",
    exportActiveCsv: "#exportStudentsActiveCsv",
    exportInactiveCsv: "#exportStudentsInactiveCsv",
    exportArchivedCsv: "#exportStudentsArchivedCsv",
    exportAllCsv: "#exportStudentsAllCsv",
    importCsv: "#importStudentsCsv",
  };

  const state = {
    search: {
      Pending: "",
      Active: "",
      Inactive: "",
      Archived: ""
    },
    limit: 10,
    Pending: { page: 1, total: 0, rows: [], signature: "" },
    Active: { page: 1, total: 0, rows: [], signature: "" },
    Inactive: { page: 1, total: 0, rows: [], signature: "" },
    Archived: { page: 1, total: 0, rows: [], signature: "" },
    
    polling: { 
      timer: null, 
      everyMs: 6000,
      paused: false, 
      running: false 
    },
    delegatedBound: false,
    currentRoot: null,
    pendingHighlight: null,
    searchDebounceTimers: {
      Pending: null,
      Active: null,
      Inactive: null,
      Archived: null
    }
  };

    // Handler factory functions for bulk actions
  function createApproveHandler() {
    return async (e) => {
      e.preventDefault();
      const status = "Pending";
      const ids = getSelectedIds(status);
      const studentInfo = getSelectedStudentInfo(status);
      if (!ids.length) return;
      
      if (typeof S.showConfirmModal === 'function') {
        S.showConfirmModal({
          title: 'Approve Selected Students',
          subtitle: 'Change status from Pending to Active',
          message: `Are you sure you want to approve ${ids.length} selected student(s)?`,
          type: 'approve',
          btnText: 'Approve',
          btnClass: 'success',
          btnIcon: 'check-circle',
          items: studentInfo.slice(0, 5),
          onConfirm: async function() {
            try {
              await bulkSetStatus(status, ids, "Active");
              S.safeShowSuccess(`Successfully approved ${ids.length} student(s).`);
            } catch (err) {
              S.safeShowError(err?.message || "Failed to approve selected students.");
            }
          }
        });
      }
    };
  }

  function createRejectHandler() {
    return async (e) => {
      e.preventDefault();
      const status = "Pending";
      const ids = getSelectedIds(status);
      const studentInfo = getSelectedStudentInfo(status);
      if (!ids.length) return;
      
      if (typeof S.showConfirmModal === 'function') {
        S.showConfirmModal({
          title: 'Reject Selected Students',
          subtitle: 'Remove selected pending students',
          message: `Reject ${ids.length} selected student(s)?`,
          type: 'danger',
          btnText: 'Reject',
          btnClass: 'danger',
          btnIcon: 'x-circle',
          showWarning: true,
          warningText: 'This action is irreversible.',
          items: studentInfo.slice(0, 5),
          onConfirm: async function() {
            try {
              await bulkSetStatus(status, ids, "Inactive");
              S.safeShowSuccess(`Rejected ${ids.length} student(s).`);
            } catch (err) {
              S.safeShowError(err?.message || "Failed to reject students.");
            }
          }
        });
      }
    };
  }

  function createActiveArchiveHandler() {
    return async (e) => {
      e.preventDefault();
      const status = "Active";
      const ids = getSelectedIds(status);
      const studentInfo = getSelectedStudentInfo(status);
      if (!ids.length) return;
      
      if (typeof S.showConfirmModal === 'function') {
        S.showConfirmModal({
          title: 'Archive Selected Students',
          subtitle: 'Move selected active students to archive',
          message: `Archive ${ids.length} selected student(s)?`,
          type: 'archive',
          btnText: 'Archive',
          btnClass: 'warning',
          btnIcon: 'archive',
          showWarning: true,
          warningText: 'Archived students will not appear in active lists.',
          items: studentInfo.slice(0, 5),
          onConfirm: async function() {
            try {
              await bulkSetStatus(status, ids, "Archived");
              S.safeShowSuccess(`Archived ${ids.length} student(s).`);
            } catch (err) {
              S.safeShowError(err?.message || "Failed to archive students.");
            }
          }
        });
      }
    };
  }

  function createInactiveActivateHandler() {
    return async (e) => {
      e.preventDefault();
      const status = "Inactive";
      const ids = getSelectedIds(status);
      const studentInfo = getSelectedStudentInfo(status);
      if (!ids.length) return;
      
      if (typeof S.showConfirmModal === 'function') {
        S.showConfirmModal({
          title: 'Activate Selected Students',
          subtitle: 'Move selected inactive students to Active',
          message: `Activate ${ids.length} selected student(s)?`,
          type: 'success',
          btnText: 'Activate',
          btnClass: 'success',
          btnIcon: 'check-circle',
          items: studentInfo.slice(0, 5),
          onConfirm: async function() {
            try {
              await bulkActivateInactive(ids);
            } catch (err) {
              S.safeShowError(err?.message || "Failed to activate students.");
            }
          }
        });
      }
    };
  }

  function createInactiveArchiveHandler() {
    return async (e) => {
      e.preventDefault();
      const status = "Inactive";
      const ids = getSelectedIds(status);
      const studentInfo = getSelectedStudentInfo(status);
      if (!ids.length) return;
      
      if (typeof S.showConfirmModal === 'function') {
        S.showConfirmModal({
          title: 'Archive Selected Students',
          subtitle: 'Move selected inactive students to archive',
          message: `Archive ${ids.length} selected student(s)?`,
          type: 'archive',
          btnText: 'Archive',
          btnClass: 'warning',
          btnIcon: 'archive',
          showWarning: true,
          warningText: 'Archived students will not appear in active/inactive lists.',
          items: studentInfo.slice(0, 5),
          onConfirm: async function() {
            try {
              await bulkSetStatus(status, ids, "Archived");
              S.safeShowSuccess(`Archived ${ids.length} student(s).`);
            } catch (err) {
              S.safeShowError(err?.message || "Failed to archive students.");
            }
          }
        });
      }
    };
  }

    function createArchivedActivateHandler() {
    return async (e) => {
      e.preventDefault();
      const status = "Archived";
      const ids = getSelectedIds(status);
      const studentInfo = getSelectedStudentInfo(status);
      if (!ids.length) return;
      
      if (typeof S.showConfirmModal === 'function') {
        S.showConfirmModal({
          title: 'Activate Selected Students',
          subtitle: 'Move selected archived students to Active',
          message: `Activate ${ids.length} selected student(s)?`,
          type: 'success',
          btnText: 'Activate',
          btnClass: 'success',
          btnIcon: 'check-circle',
          items: studentInfo.slice(0, 5),
          onConfirm: async function() {
            try {
              await bulkSetStatus(status, ids, "Active");
              S.safeShowSuccess(`Activated ${ids.length} student(s).`);
            } catch (err) {
              S.safeShowError(err?.message || "Failed to activate students.");
            }
          }
        });
      }
    };
  }

  function createArchivedRestoreHandler() {
    return async (e) => {
      e.preventDefault();
      const status = "Archived";
      const ids = getSelectedIds(status);
      const studentInfo = getSelectedStudentInfo(status);
      if (!ids.length) return;
      
      if (typeof S.showConfirmModal === 'function') {
        S.showConfirmModal({
          title: 'Restore Selected Students',
          subtitle: 'Move selected archived students back to Active',
          message: `Restore ${ids.length} selected student(s) to Active?`,
          type: 'restore',
          btnText: 'Restore',
          btnClass: 'primary',
          btnIcon: 'arrow-counterclockwise',
          items: studentInfo.slice(0, 5),
          onConfirm: async function() {
            try {
              await bulkSetStatus(status, ids, "Active");
              S.safeShowSuccess(`Restored ${ids.length} student(s).`);
            } catch (err) {
              S.safeShowError(err?.message || "Failed to restore students.");
            }
          }
        });
      }
    };
  }

  // Add this function to reinitialize event listeners after refresh
  function reinitializeEventListeners() {
    console.log('[Students] Reinitializing event listeners...');
    
    // Re-bind bulk bars for all statuses
    for (const st of STATUSES) {
      const cfg = UI[st];
      
      // Re-bind select all buttons
      const btnSelectAll = S.qs(cfg.btnSelectAll);
      if (btnSelectAll) {
        const newBtn = btnSelectAll.cloneNode(true);
        btnSelectAll.parentNode.replaceChild(newBtn, btnSelectAll);
        newBtn.addEventListener("click", (e) => {
          e.preventDefault();
          setAllRowChecks(st, true);
          syncBulkBar(st);
        });
      }
      
      // Re-bind clear buttons
      const btnClear = S.qs(cfg.btnClear);
      if (btnClear) {
        const newBtn = btnClear.cloneNode(true);
        btnClear.parentNode.replaceChild(newBtn, btnClear);
        newBtn.addEventListener("click", (e) => {
          e.preventDefault();
          clearSelection(st);
        });
      }
      
      // Re-bind export buttons
      const btnExport = S.qs(cfg.btnExport);
      if (btnExport) {
        const newBtn = btnExport.cloneNode(true);
        btnExport.parentNode.replaceChild(newBtn, btnExport);
        newBtn.addEventListener("click", (e) => {
          e.preventDefault();
          exportSelected(st);
        });
      }
    }
    
    // Re-bind Pending tab buttons
    const pendingApprove = S.qs("#studentsPendingApproveSelectedBtn");
    if (pendingApprove) {
      const newBtn = pendingApprove.cloneNode(true);
      pendingApprove.parentNode.replaceChild(newBtn, pendingApprove);
      newBtn.addEventListener("click", createApproveHandler());
    }
    
    const pendingReject = S.qs("#studentsPendingRejectSelectedBtn");
    if (pendingReject) {
      const newBtn = pendingReject.cloneNode(true);
      pendingReject.parentNode.replaceChild(newBtn, pendingReject);
      newBtn.addEventListener("click", createRejectHandler());
    }
    
    // Re-bind Active tab archive button
    const activeArchive = S.qs("#studentsActiveArchiveSelectedBtn");
    if (activeArchive) {
      const newBtn = activeArchive.cloneNode(true);
      activeArchive.parentNode.replaceChild(newBtn, activeArchive);
      newBtn.addEventListener("click", createActiveArchiveHandler());
    }
    
    // Re-bind Inactive tab buttons
    const inactiveActivate = S.qs("#studentsInactiveActivateSelectedBtn");
    if (inactiveActivate) {
      const newBtn = inactiveActivate.cloneNode(true);
      inactiveActivate.parentNode.replaceChild(newBtn, inactiveActivate);
      newBtn.addEventListener("click", createInactiveActivateHandler());
    }
    
    const inactiveArchive = S.qs("#studentsInactiveArchiveSelectedBtn");
    if (inactiveArchive) {
      const newBtn = inactiveArchive.cloneNode(true);
      inactiveArchive.parentNode.replaceChild(newBtn, inactiveArchive);
      newBtn.addEventListener("click", createInactiveArchiveHandler());
    }
    
    // Re-bind Archived tab restore button
    const archivedRestore = S.qs("#studentsArchivedRestoreSelectedBtn");
    if (archivedRestore) {
      const newBtn = archivedRestore.cloneNode(true);
      archivedRestore.parentNode.replaceChild(newBtn, archivedRestore);
      newBtn.addEventListener("click", createArchivedRestoreHandler());
    }
  }

  // -------------------------
  // Signature-based change detection (from manage-program.js)
  // -------------------------
  function computeSignatureFromListPayload(payload) {
    const total = Number(payload.total || 0);
    const first = Array.isArray(payload.rows) && payload.rows.length ? payload.rows[0] : null;
    const newestId = first ? String(first.id ?? "") : "";
    const newestCreated = first ? String(first.created_at ?? "") : "";
    return `${total}|${newestId}|${newestCreated}`;
  }

  async function fetchSignature(status) {
    const search = state.search;
    
    const data = await S.postJSON({
      action: "list_users",
      group: GROUP,
      status,
      search,
      page: 1,
      limit: 1,
    });

    return computeSignatureFromListPayload(data);
  }

  // NEW: Fetch signature for presidents (separate group)
  async function fetchPresidentSignature() {
    const search = state.search;
    
    const data = await S.postJSON({
      action: "list_users",
      group: "presidents",
      search,
      page: 1,
      limit: 1,
    });

    return computeSignatureFromListPayload(data);
  }

  function anyModalOpen() {
    // Check if any relevant modal is open
    const modalSelectors = [
      "#modalAddStudent",
      "#modalViewStudent", 
      "#modalEditStudent",
      "#modalImportCsv",
      "#modalSuccess",
      "#modalConfirmAction"
    ];
    
    return modalSelectors.some(selector => {
      const el = S.qs(selector);
      return el && el.classList.contains("show");
    });
  }

  async function pollForChanges() {
    if (state.polling.running) return;
    if (state.polling.paused) return;
    if (anyModalOpen()) return;

    state.polling.running = true;
    try {
      // Fetch signatures for all status types in parallel
      const [sigP, sigA, sigI, sigR, sigPres] = await Promise.all([
        fetchSignature("Pending"),
        fetchSignature("Active"),
        fetchSignature("Inactive"),
        fetchSignature("Archived"),
        fetchPresidentSignature() // NEW: President signature
      ]);
      
      // Check if any signature changed
      const changed = 
        sigP !== state.Pending.signature || 
        sigA !== state.Active.signature || 
        sigI !== state.Inactive.signature || 
        sigR !== state.Archived.signature ||
        sigPres !== state.President.signature; // NEW: Check president

      if (changed) {
        console.log('Database changes detected in students, refreshing all tables...');
        
        // Refresh all tables
        await refresh();
        
        // Update signatures
        state.Pending.signature = sigP;
        state.Active.signature = sigA;
        state.Inactive.signature = sigI;
        state.Archived.signature = sigR;
        state.President.signature = sigPres; // NEW: Update president signature
        
        // Show subtle notification
        if (document.visibilityState === 'visible') {
          S.safeShowSuccess('Students table updated');
        }
      }
    } catch (e) {
      console.warn('[Students] Poll failed:', e?.message || e);
    } finally {
      state.polling.running = false;
    }
  }

  function startPolling() {
    stopPolling();
    state.polling.timer = setInterval(pollForChanges, state.polling.everyMs);
  }

  function stopPolling() {
    if (state.polling.timer) clearInterval(state.polling.timer);
    state.polling.timer = null;
    state.polling.running = false;
  }

  // Handle page visibility changes
  function setupVisibilityHandlers() {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        // Page became visible, check for changes immediately
        pollForChanges();
        
        // Restart polling
        if (!state.polling.timer) {
          startPolling();
        }
      } else {
        // Page is hidden, stop polling to save resources
        stopPolling();
      }
    });
  }

  // -------------------------
  // Program + Term helpers
  // -------------------------
  function getProgramsFromMeta() {
    const meta = S.getMeta ? S.getMeta() : {};
    const programs = Array.isArray(meta.programs) ? meta.programs : [];
    return programs;
  }

  function normalizeProgramRow(p) {
    const programName = String(p?.program_name ?? p?.name ?? p?.program ?? "").trim();
    const abbr = String(p?.abbreviation ?? p?.abbr ?? p?.code ?? "").trim();
    const status = String(p?.status ?? "").trim();
    return { programName, abbr, status };
  }

  function populateProgramDropdown({ force = false } = {}) {
    const programSelect = S.qs("#student_program");
    if (!programSelect) return;

    const currentVal = String(programSelect.value ?? "").trim();

    // Clear existing options except the first placeholder
    while (programSelect.options.length > 1) programSelect.remove(1);

    const programs = getProgramsFromMeta()
      .map(normalizeProgramRow)
      .filter((p) => p.programName);

    // If meta has no programs, keep placeholder only
    if (!programs.length) return;

    for (const p of programs) {
      // If your API already filters active programs, keep all.
      // If it includes status, prefer Active but don't hard-break if status missing.
      if (p.status && p.status !== "Active") continue;

      const option = document.createElement("option");

      // FIXED: Store abbreviation as value (since database stores abbreviation)
      option.value = p.abbr || p.programName;

      option.textContent = p.abbr ? `${p.abbr} — ${p.programName}` : p.programName;
      programSelect.appendChild(option);
    }

    // Restore selection if it still exists (unless forcing a reset)
    if (!force && currentVal) {
      const exists = Array.from(programSelect.options).some((o) => o.value === currentVal);
      if (exists) programSelect.value = currentVal;
    }
  }

  function setActiveSchoolYear({ force = false } = {}) {
    const meta = S.getMeta ? S.getMeta() : {};
    const term = meta.active_term || null;
    const schoolYearInput = S.qs("#student_school_year");

    if (!schoolYearInput) return;

    const sy = String(term?.school_year ?? "").trim();
    if (!sy) return;

    const cur = String(schoolYearInput.value ?? "").trim();
    if (force || cur === "") schoolYearInput.value = sy;
  }

  // -------------------------
  // Selection / Bulkbar
  // -------------------------
  function ensureHeaderCheckbox(status) {
    const cfg = UI[status];
    const tbody = S.qs(cfg.tbody);
    if (!tbody) return;

    const table = tbody.closest("table");
    if (!table) return;

    const headRow = table.querySelector("thead tr");
    if (!headRow) return;

    const firstTh = headRow.querySelector("th");
    if (firstTh && firstTh.classList.contains("chk-col")) return;

    const th = document.createElement("th");
    th.className = "chk-col";
    th.innerHTML = `<input type="checkbox" class="form-check-input header-checkbox mu-header-check" aria-label="Select all" />`;
    headRow.insertBefore(th, headRow.firstChild);

    th.querySelector("input")?.addEventListener("change", () => {
      const checked = th.querySelector("input").checked;
      setAllRowChecks(status, checked);
      syncBulkBar(status);
    });
  }

  function injectRowCheckboxes(status) {
    const cfg = UI[status];
    const tbody = S.qs(cfg.tbody);
    if (!tbody) return;

    for (const tr of Array.from(tbody.querySelectorAll("tr[data-id]"))) {
      if (tr.querySelector("td.chk-col")) continue;

      const id = tr.getAttribute("data-id");
      const td = document.createElement("td");
      td.className = "chk-col";
      td.innerHTML = `
        <input class="form-check-input mu-row-check" type="checkbox" data-id="${S.escapeHtml(id)}" aria-label="Select row" />
      `;
      tr.insertBefore(td, tr.firstChild);

      td.querySelector("input")?.addEventListener("change", () => {
        syncBulkBar(status);
      });
    }
  }

  function getSelectedIds(status) {
    const cfg = UI[status];
    const tbody = S.qs(cfg.tbody);
    if (!tbody) return [];
    return Array.from(tbody.querySelectorAll("input.mu-row-check:checked"))
      .map((c) => parseInt(c.getAttribute("data-id") || "0", 10))
      .filter((n) => n > 0);
  }

  function getSelectedStudentInfo(status) {
    const cfg = UI[status];
    const tbody = S.qs(cfg.tbody);
    if (!tbody) return [];
    
    const selectedRows = Array.from(tbody.querySelectorAll("tr[data-id]")).filter(row => {
      const checkbox = row.querySelector("input.mu-row-check");
      return checkbox && checkbox.checked;
    });
    
    return selectedRows.map(row => {
      const idNumber = row.cells[1]?.textContent || "—";
      const name = row.cells[2]?.textContent || "—";
      return `${idNumber} (${name})`;
    });
  }

  function setAllRowChecks(status, checked) {
    const cfg = UI[status];
    const tbody = S.qs(cfg.tbody);
    if (!tbody) return;

    for (const c of Array.from(tbody.querySelectorAll("input.mu-row-check"))) c.checked = !!checked;
  }

  function clearSelection(status) {
    const cfg = UI[status];
    const tbody = S.qs(cfg.tbody);
    if (!tbody) return;

    for (const c of Array.from(tbody.querySelectorAll("input.mu-row-check"))) c.checked = false;
    const table = tbody.closest("table");
    const header = table?.querySelector("input.mu-header-check");
    if (header) header.checked = false;

    syncBulkBar(status);
  }

  function syncBulkBar(status) {
    const cfg = UI[status];
    const bar = S.qs(cfg.bulkBar);
    const countEl = S.qs(cfg.selCount);
    if (!bar || !countEl) return;

    const ids = getSelectedIds(status);
    countEl.textContent = String(ids.length);

    if (ids.length > 0) bar.classList.remove("d-none");
    else bar.classList.add("d-none");
  }

  // -------------------------
  // API - FIXED refreshBothStatuses
  // -------------------------
  async function fetchList(status) {
    const st = state[status];
    const data = await S.postJSON({
      action: "list_users",
      group: GROUP,
      status,
      search: state.search[status], // Use status-specific search
      page: st.page,
      limit: state.limit,
    });

    st.rows = Array.isArray(data.rows) ? data.rows : [];
    st.total = Number(data.total || 0);
    
    return computeSignatureFromListPayload(data);
  }

  // New function to bind per-tab search
  function bindSearch() {
    const statuses = ["Pending", "Active", "Inactive", "Archived"];
    
    statuses.forEach(status => {
      const searchId = common[`search${status}`];
      const searchEl = S.qs(searchId);
      
      if (searchEl) {
        searchEl.addEventListener("input", () => {
          // Clear existing timer
          if (state.searchDebounceTimers[status]) {
            clearTimeout(state.searchDebounceTimers[status]);
          }

          // Set new timer
          state.searchDebounceTimers[status] = setTimeout(() => {
            state.search[status] = searchEl.value.trim();
            state[status].page = 1;
            refreshStatus(status);
            console.log(`[Students] Searching ${status}:`, state.search[status]);
          }, 300);
        });
      }
    });
  }

  // NEW: Fetch presidents list
  async function fetchPresidentList() {
    const st = state.President;
    const data = await S.postJSON({
      action: "list_users",
      group: "presidents",
      search: state.search,
      page: st.page,
      limit: state.limit,
    });

    st.rows = Array.isArray(data.rows) ? data.rows : [];
    st.total = Number(data.total || 0);
    
    return computeSignatureFromListPayload(data);
  }

  async function bulkSetStatus(status, ids, newStatus) {
    const result = await S.postJSON({
      action: "bulk_set_status",
      group: GROUP,
      status: newStatus,
      ids,
    });
    
    clearSelection(status);
    
    // FIXED: Refresh BOTH the source AND destination status tabs
    await refreshStatus(status); // Source tab
    await refreshStatus(newStatus); // Destination tab
    
    return result;
  }

  // NEW FUNCTION: Refresh both source and destination statuses (FIXED - was missing)
  async function refreshBothStatuses(sourceStatus, destinationStatus) {
    await refreshStatus(sourceStatus);
    if (destinationStatus && destinationStatus !== sourceStatus) {
      await refreshStatus(destinationStatus);
    }
    // Also refresh presidents if needed
    if (destinationStatus === "President" || sourceStatus === "President") {
      await refreshPresidentTab();
    }
  }

  async function bulkActivateInactive(ids) {
    if (!ids.length) return;
    
    const result = await S.postJSON({
      action: "bulk_set_status",
      group: GROUP,
      status: "Active",
      ids,
    });
    
    clearSelection("Inactive");
    
    // Refresh both Inactive and Active tabs
    await refreshStatus("Inactive");
    await refreshStatus("Active");
    
    // Show success message
    if (typeof S.showSuccessModal === 'function') {
      S.showSuccessModal({
        title: 'Students Activated',
        message: `Successfully activated ${ids.length} student(s).`,
        icon: 'check-circle-fill'
      });
    } else {
      S.safeShowSuccess(`Successfully activated ${ids.length} student(s).`);
    }
    
    return result;
  }

  // FIXED: Promote student to President (single function)
  async function promoteToPresident(id) {
    const result = await S.postJSON({
      action: "update_user_role",
      id: id,
      role: "org_president",
    });
    
    // Refresh the Active tab
    await refreshStatus("Active");
    
    // Also refresh presidents if the module exists
    if (window.UsersPresident?.refresh) {
      await window.UsersPresident.refresh();
    }
    
    return result;
  }

  // FIXED: Demote president to Student
  async function demoteToStudent(id) {
    const result = await S.postJSON({
      action: "update_user_role",
      id: id,
      role: "student",
    });
    
    // Refresh both tabs
    if (window.UsersPresident?.refresh) {
      await window.UsersPresident.refresh();
    }
    await refreshStatus("Active");
    
    return result;
  }
  async function bulkResetPassword(status, ids) {
    const result = await S.postJSON({ action: "bulk_reset_password", ids });
    clearSelection(status);
    
    // Show success modal using global utility
    if (typeof S.showSuccessModal === 'function') {
      S.showSuccessModal({
        title: 'Password Reset',
        message: `Passwords reset for ${ids.length} student(s) to their ID Number.`,
        icon: 'key-fill'
      });
    }
    
    return result;
  }

  // -------------------------
  // Render
  // -------------------------
  function fullName(r) {
    const parts = [r.first_name, r.middle_name, r.last_name].filter(Boolean);
    const name = parts.join(" ");
    return (name + (r.suffix ? ` ${r.suffix}` : "")).trim();
  }

  function renderEmptyRow(colspan, msg) {
    return `
      <tr>
        <td colspan="${colspan}" class="text-center text-muted py-5">
          <div class="mb-2"><i class="bi bi-inbox" style="font-size: 1.5rem;"></i></div>
          ${S.escapeHtml(msg)}
        </td>
      </tr>
    `;
  }

  function actionsHtml(status, id, studentData) {
    const sid = S.escapeHtml(id);
    const studentName = studentData ? fullName(studentData) : "Student";

    // More menu - same structure as faculty/moderator
    const moreMenu = `
      <div class="dropdown d-inline-block">
        <button class="btn btn-outline-secondary btn-sm" type="button" data-bs-toggle="dropdown" aria-expanded="false" title="More">
          <i class="bi bi-three-dots-vertical"></i>
        </button>
        <ul class="dropdown-menu dropdown-menu-end">
          <li>
            <a class="dropdown-item mu-student-view-one" href="#" data-id="${sid}">
              <i class="bi bi-eye me-2"></i>View
            </a>
          </li>
          <li>
            <a class="dropdown-item mu-student-edit-one" href="#" data-id="${sid}">
              <i class="bi bi-pencil-square me-2"></i>Edit
            </a>
          </li>
          <li><hr class="dropdown-divider"></li>
          <li>
            <a class="dropdown-item mu-student-reset-one" href="#" data-id="${sid}" data-name="${S.escapeHtml(studentName)}">
              <i class="bi bi-key me-2"></i>Reset Password
            </a>
          </li>
          <!-- NEW: Promote to President option for Active students -->
          ${status === "Active" ? `
          <li>
            <a class="dropdown-item mu-student-promote-president" href="#" data-id="${sid}" data-name="${S.escapeHtml(studentName)}">
              <i class="bi bi-stars me-2"></i>Promote to President
            </a>
          </li>
          ` : ''}
        </ul>
      </div>
    `;

    // PENDING - similar to faculty Active but with specific buttons
    if (status === "Pending") {
      return `
        <div class="d-flex justify-content-end gap-1 flex-wrap">
          <button class="btn btn-success btn-sm mu-set-status" data-id="${sid}" data-next="Active" data-name="${S.escapeHtml(studentName)}" type="button" title="Approve">
            <i class="bi bi-check-circle"></i>
          </button>
          <button class="btn btn-outline-secondary btn-sm mu-set-status" data-id="${sid}" data-next="Inactive" data-name="${S.escapeHtml(studentName)}" type="button" title="Decline">
            <i class="bi bi-dash-circle"></i>
          </button>
          ${moreMenu}
        </div>
      `;
    }

    // ACTIVE - same as faculty Active
    if (status === "Active") {
      return `
        <div class="d-flex justify-content-end gap-1 flex-wrap">
          <button class="btn btn-outline-secondary btn-sm mu-set-status" data-id="${sid}" data-next="Inactive" data-name="${S.escapeHtml(studentName)}" type="button" title="Set Inactive">
            <i class="bi bi-dash-circle"></i>
          </button>
          <button class="btn btn-outline-warning btn-sm mu-set-status" data-id="${sid}" data-next="Archived" data-name="${S.escapeHtml(studentName)}" type="button" title="Archive">
            <i class="bi bi-archive"></i>
          </button>
          ${moreMenu}
        </div>
      `;
    }

    // INACTIVE - same as faculty Inactive
    if (status === "Inactive") {
      return `
        <div class="d-flex justify-content-end gap-1 flex-wrap">
          <button class="btn btn-success btn-sm mu-set-status" data-id="${sid}" data-next="Active" data-name="${S.escapeHtml(studentName)}" type="button" title="Activate">
            <i class="bi bi-check-circle"></i>
          </button>
          <button class="btn btn-outline-warning btn-sm mu-set-status" data-id="${sid}" data-next="Archived" data-name="${S.escapeHtml(studentName)}" type="button" title="Archive">
            <i class="bi bi-archive"></i>
          </button>
          ${moreMenu}
        </div>
      `;
    }

    // ARCHIVED - same as faculty Archived
    if (status === "Archived") {
      return `
        <div class="d-flex justify-content-end gap-1 flex-wrap">
          <button class="btn btn-outline-success btn-sm mu-set-status" data-id="${sid}" data-next="Active" data-name="${S.escapeHtml(studentName)}" type="button" title="Restore">
            <i class="bi bi-arrow-counterclockwise"></i>
          </button>
          ${moreMenu}
        </div>
      `;
    }

    return moreMenu; // Default for other statuses
  }

  // NEW: Render presidents rows
  function renderPresidentRows() {
    const cfg = UI.President;
    const tbody = S.qs(cfg.tbody);
    if (!tbody) return;

    const rows = state.President.rows;

    if (!rows.length) {
      tbody.innerHTML = renderEmptyRow(7, "No presidents found.");
      syncBulkBar("President");
      return;
    }

    tbody.innerHTML = rows
      .map((r) => {
        const prog = r.program || "—";
        const ylvl = r.year_level || "—";
        const sy = r.school_year || "—";

        return `
          <tr data-id="${S.escapeHtml(r.id)}">
            <td>${S.escapeHtml(r.id_number || "—")}</td>
            <td>${S.escapeHtml(fullName(r) || "—")}</td>
            <td>${S.escapeHtml(prog)}</td>
            <td>${S.escapeHtml(ylvl)}</td>
            <td>${S.escapeHtml(sy)}</td>
            <td><span class="badge bg-light text-dark border">${S.escapeHtml(r.status || "—")}</span></td>
            <td class="text-end">
              <div class="d-flex justify-content-end gap-1 flex-wrap">
                <button class="btn btn-outline-secondary btn-sm mu-president-view-one" data-id="${S.escapeHtml(r.id)}" title="View">
                  <i class="bi bi-eye"></i>
                </button>
                <button class="btn btn-outline-warning btn-sm mu-president-demote" data-id="${S.escapeHtml(r.id)}" data-name="${S.escapeHtml(fullName(r))}" title="Demote to Student">
                  <i class="bi bi-arrow-down-circle"></i>
                </button>
                <button class="btn btn-outline-danger btn-sm mu-set-status" data-id="${S.escapeHtml(r.id)}" data-next="Inactive" data-name="${S.escapeHtml(fullName(r))}" title="Set Inactive">
                  <i class="bi bi-dash-circle"></i>
                </button>
              </div>
            </td>
          </tr>
        `;
      })
      .join("");

    ensureHeaderCheckbox("President");
    injectRowCheckboxes("President");
    syncBulkBar("President");
  }

  function renderRows(status) {
    const cfg = UI[status];
    const tbody = S.qs(cfg.tbody);
    if (!tbody) return;

    const rows = state[status].rows;

    if (!rows.length) {
      tbody.innerHTML = renderEmptyRow(8, `No ${status.toLowerCase()} students found.`);
      syncBulkBar(status);
      return;
    }

    tbody.innerHTML = rows
      .map((r) => {
        const prog = r.program || "—";
        const ylvl = r.year_level || "—";
        const sy = r.school_year || "—";
        // Show role badge if not 'student'
        const roleBadge = r.role && r.role !== 'student' ? 
          `<span class="badge bg-primary ms-2">${S.escapeHtml(r.role.replace('_', ' '))}</span>` : '';

        return `
          <tr data-id="${S.escapeHtml(r.id)}">
            <td>${S.escapeHtml(r.id_number || "—")}</td>
            <td>${S.escapeHtml(fullName(r) || "—")}${roleBadge}</td>
            <td>${S.escapeHtml(prog)}</td>
            <td>${S.escapeHtml(ylvl)}</td>
            <td>${S.escapeHtml(sy)}</td>
            <td><span class="badge bg-light text-dark border">${S.escapeHtml(r.status || "—")}</span></td>
            <td class="text-end">
              ${actionsHtml(status, r.id, r)}
            </td>
          </tr>
        `;
      })
      .join("");

    ensureHeaderCheckbox(status);
    injectRowCheckboxes(status);
    syncBulkBar(status);
    
    // Check if there's a pending highlight after rendering
    checkPendingHighlight();
  }

  function renderMeta(status) {
    const cfg = UI[status];
    const metaEl = S.qs(cfg.meta);
    if (!metaEl) return;

    const st = state[status];
    const total = st.total || 0;
    const page = st.page || 1;
    const limit = state.limit || 10;

    const start = total === 0 ? 0 : (page - 1) * limit + 1;
    const end = Math.min(total, (page - 1) * limit + st.rows.length);

    metaEl.textContent = `Showing ${start}–${end} of ${total}`;
  }

  function renderPagination(status) {
    const cfg = UI[status];
    const ul = S.qs(cfg.pag);
    if (!ul) return;

    const st = state[status];
    const totalPages = Math.max(1, Math.ceil((st.total || 0) / state.limit));
    const cur = st.page;

    const item = (label, page, disabled, active) => {
      const cls = ["page-item", disabled ? "disabled" : "", active ? "active" : ""].filter(Boolean).join(" ");
      const safePage = String(page);
      return `
        <li class="${cls}">
          <a class="page-link" href="#" data-page="${S.escapeHtml(safePage)}">${S.escapeHtml(label)}</a>
        </li>
      `;
    };

    const parts = [];
    parts.push(item("Prev", "prev", cur <= 1, false));

    const windowSize = 5;
    let start = Math.max(1, cur - 2);
    let end = Math.min(totalPages, start + windowSize - 1);
    start = Math.max(1, end - windowSize + 1);

    for (let p = start; p <= end; p++) parts.push(item(String(p), String(p), false, p === cur));

    parts.push(item("Next", "next", cur >= totalPages, false));
    ul.innerHTML = parts.join("");
  }

  async function refreshStatus(status) {
    const signature = await fetchList(status);
    state[status].signature = signature;
    renderRows(status);
    renderMeta(status);
    renderPagination(status);
  }

  // NEW: Refresh president tab
  async function refreshPresidentTab() {
    const signature = await fetchPresidentList();
    state.President.signature = signature;
    renderPresidentRows();
    renderMeta("President");
    renderPagination("President");
  }

  async function refresh() {
    const refreshPromises = STATUSES.map(status => refreshStatus(status));
    await Promise.all(refreshPromises);
    // Reinitialize event listeners after data refresh
    setTimeout(() => reinitializeEventListeners(), 100);
  }


  // -------------------------
  // NOTIFICATION HIGHLIGHTING FUNCTIONS
  // -------------------------
    
  // Listen for notifications wanting to open a specific student
  function setupNotificationListener() {
    window.addEventListener("notif:openUser", async (event) => {
      const { userId, idNumber, studentData } = event.detail;
      
      if (!userId && !idNumber) return;
      
      console.log("[Students] Notification openUser event received:", { userId, idNumber, studentData });
      
      // If we received full student data, store it immediately in the cache
      if (studentData && studentData.id) {
        console.log("[Students] Received full student data from notification:", studentData);
        
        // Find which status tab this student belongs to
        const status = studentData.status || "Pending";
        if (STATUSES.includes(status)) {
          // Check if this student is already in our cache
          const existingIndex = state[status].rows.findIndex(r => Number(r.id) === Number(studentData.id));
          
          if (existingIndex === -1) {
            // Add to cache if not present
            state[status].rows.unshift(studentData);
            console.log(`[Students] Added student to ${status} cache`);
          }
        }
      }
      
      // Call the highlight function
      await highlightFromNotification({ userId, idNumber });
    });
  }

  // NEW DEDICATED HIGHLIGHT FUNCTION - NO MODAL
  async function highlightFromNotification({ userId = "", idNumber = "" } = {}) {
    console.log("[Students] ===== HIGHLIGHT FROM NOTIFICATION =====");
    console.log("[Students] Received params:", { userId, idNumber });
    
    if (!userId && !idNumber) {
      console.error("[Students] Both userId and idNumber are empty!");
      return false;
    }
    
    // Make sure students tab is active
    const studentsTabTrigger = document.querySelector('#tab-students');
    if (studentsTabTrigger && !studentsTabTrigger.classList.contains('active')) {
      console.log("[Students] Activating students tab");
      const tab = new bootstrap.Tab(studentsTabTrigger);
      tab.show();
      await new Promise(resolve => setTimeout(resolve, 300));
    }
    
    // Try multiple strategies to find the student
    let found = false;
    
    // Strategy 1: Direct API call to get student by ID
    if (userId && !found) {
      console.log("[Students] Strategy 1: Fetching student by ID from API");
      try {
        const response = await S.postJSON({
          action: "get_user",
          group: GROUP,
          id: userId
        });
        
        if (response && response.success && response.data) {
          console.log("[Students] Found student via get_user:", response.data);
          const student = response.data;
          
          // Add to cache
          const status = student.status || "Pending";
          if (STATUSES.includes(status)) {
            state[status].rows = [student, ...state[status].rows];
            await refreshStatus(status);
            
            // Try to highlight after refresh
            setTimeout(() => {
              highlightStudentRow(student.id, student.id_number);
              S.safeShowSuccess(`Student ${student.id_number} found and highlighted.`);
            }, 500);
            found = true;
          }
        }
      } catch (e) {
        console.log("[Students] get_user failed:", e);
      }
    }
    
    // Strategy 2: Search all status tabs with larger limit
    if (!found && userId) {
      console.log("[Students] Strategy 2: Searching all status tabs");
      for (const status of STATUSES) {
        try {
          const data = await S.postJSON({
            action: "list_users",
            group: GROUP,
            status,
            search: userId,
            page: 1,
            limit: 100,
          });
          
          const rows = Array.isArray(data.rows) ? data.rows : [];
          const match = rows.find(r => String(r.id) === String(userId) || String(r.id_number).includes(userId));
          
          if (match) {
            console.log("[Students] Found student in", status, "tab:", match);
            state[status].rows = [match, ...state[status].rows];
            await refreshStatus(status);
            
            setTimeout(() => {
              highlightStudentRow(match.id, match.id_number);
              S.safeShowSuccess(`Student ${match.id_number} found and highlighted.`);
            }, 500);
            found = true;
            break;
          }
        } catch (e) {
          console.log(`[Students] Search in ${status} failed:`, e);
        }
      }
    }
    
    // Strategy 3: Try to find in DOM by searching all rows
    if (!found) {
      console.log("[Students] Strategy 3: Searching DOM directly");
      const allRows = document.querySelectorAll('tbody[id*="students"] tr[data-id]');
      console.log(`[Students] Found ${allRows.length} rows in DOM`);
      
      for (const row of allRows) {
        const rowId = row.getAttribute('data-id');
        const idCell = row.querySelector('td:first-child');
        const rowIdNumber = idCell?.textContent?.trim() || "";
        
        if (rowId === String(userId) || (idNumber && rowIdNumber === String(idNumber))) {
          console.log("[Students] Found matching row in DOM!");
          
          // Scroll to and highlight the row
          row.scrollIntoView({ behavior: 'smooth', block: 'center' });
          
          // Remove any existing highlights
          document.querySelectorAll('tr.highlighted-row').forEach(el => {
            el.classList.remove('highlighted-row');
            el.style.backgroundColor = '';
            el.style.outline = '';
          });
          
          // Apply highlight
          row.classList.add('highlighted-row');
          row.style.transition = 'background-color 0.5s ease';
          row.style.backgroundColor = '#fff3cd';
          row.style.outline = '2px solid #ffc107';
          row.style.outlineOffset = '-2px';
          
          // Remove highlight after 4 seconds
          setTimeout(() => {
            if (row.classList.contains('highlighted-row')) {
              row.classList.remove('highlighted-row');
              row.style.backgroundColor = '';
              row.style.outline = '';
            }
          }, 4000);
          
          S.safeShowSuccess(`Student with ID ${userId} found and highlighted.`);
          found = true;
          break;
        }
      }
    }
    
    // Strategy 4: Force refresh all tables and try DOM again
    if (!found) {
      console.log("[Students] Strategy 4: Refreshing all tables");
      await refresh();
      
      // Try DOM one more time after refresh
      setTimeout(() => {
        const allRows = document.querySelectorAll('tbody[id*="students"] tr[data-id]');
        for (const row of allRows) {
          const rowId = row.getAttribute('data-id');
          if (rowId === String(userId)) {
            row.scrollIntoView({ behavior: 'smooth', block: 'center' });
            row.classList.add('highlighted-row');
            row.style.backgroundColor = '#fff3cd';
            row.style.outline = '2px solid #ffc107';
            S.safeShowSuccess(`Student ID ${userId} found after refresh!`);
            found = true;
            break;
          }
        }
        
        if (!found) {
          S.safeShowError(`Student with ID ${userId} not found. Please check if they exist in the system.`);
        }
      }, 1000);
    }
    
    return found;
  }

  // Helper function to extract student data from a DOM row
  function extractStudentFromRow(row) {
    if (!row) return null;
    
    const cells = row.querySelectorAll('td');
    if (cells.length < 7) return null;
    
    return {
      id: Number(row.getAttribute('data-id') || 0),
      id_number: cells[0]?.textContent?.trim() || "",
      first_name: extractNamePart(cells[1]?.textContent || "", 0),
      last_name: extractNamePart(cells[1]?.textContent || "", 2),
      program: cells[2]?.textContent?.trim() || "",
      year_level: cells[3]?.textContent?.trim() || "",
      school_year: cells[4]?.textContent?.trim() || "",
      status: cells[5]?.querySelector('.badge')?.textContent?.trim() || cells[5]?.textContent?.trim() || ""
    };
  }

  // Simple helper to extract name parts (you might want to improve this)
  function extractNamePart(fullName, index) {
    const parts = fullName.split(' ').filter(Boolean);
    return parts[index] || "";
  }

  // Check for pending highlight (called after renders)
  function checkPendingHighlight() {
    if (state.pendingHighlight) {
      const { userId, idNumber } = state.pendingHighlight;
      setTimeout(() => {
        highlightStudentRow(userId, idNumber);
      }, 100);
    }
  }

  // Function to highlight a student row (UPDATED - persistent until new highlight)
  let currentHighlightedRow = null;

  function highlightStudentRow(userId, idNumber) {
    // Try to find the row by data-id attribute first
    let row = document.querySelector(`tr[data-id="${userId}"]`);
    
    // If not found by ID, try by ID number in the cell
    if (!row && idNumber) {
      const allRows = document.querySelectorAll('tbody[id*="students"] tr[data-id]');
      for (const r of allRows) {
        const idCell = r.querySelector('td:first-child');
        if (idCell && idCell.textContent.trim() === String(idNumber)) {
          row = r;
          break;
        }
      }
    }

    if (!row) {
      console.log("[Students] Could not find student row to highlight");
      return false;
    }

    // Remove highlight from previously highlighted row (if any)
    if (currentHighlightedRow) {
      currentHighlightedRow.classList.remove('highlighted-row');
      currentHighlightedRow.style.backgroundColor = '';
      currentHighlightedRow.style.outline = '';
      currentHighlightedRow.style.boxShadow = '';
      currentHighlightedRow.style.borderLeft = '';
    }

    // Scroll the row into view smoothly
    row.scrollIntoView({ behavior: 'smooth', block: 'center' });

    // Apply persistent highlight
    row.classList.add('highlighted-row');
    row.style.backgroundColor = '#fff3cd';
    row.style.outline = '3px solid #ffc107';
    row.style.outlineOffset = '-1px';
    row.style.boxShadow = '0 0 15px rgba(255, 193, 7, 0.5)';
    row.style.borderLeft = '6px solid #ffc107';
    
    // Store as current highlighted row
    currentHighlightedRow = row;

    return true;
  }

  // Also modify fetchStudentByIdNumber to be more aggressive
  async function fetchStudentByIdNumber(idNumber) {
    const needle = String(idNumber || "").trim();
    if (!needle) return null;

    // Search across all status tabs with larger limit
    for (const status of STATUSES) {
      const data = await S.postJSON({
        action: "list_users",
        group: GROUP,
        status,
        search: needle,
        page: 1,
        limit: 100, // Increased limit
      });

      const rows = Array.isArray(data.rows) ? data.rows : [];
      // Try exact match first
      let exact = rows.find(r => String(r.id_number || "").trim() === needle);
      if (exact) return exact;
      
      // Try partial match if exact not found
      exact = rows.find(r => String(r.id_number || "").trim().includes(needle));
      if (exact) return exact;
    }
    return null;
  }

  // -------------------------
  // Add Student Modal (FIXED - Use ONLY create_student)
  // -------------------------
  function bindAddStudentModal() {
    const modalEl = S.qs("#modalAddStudent");
    if (!modalEl) return;

    const form = S.qs("#formAddStudent", modalEl);
    const btnSave = S.qs("#btnSaveStudent", modalEl);
    const errorBox = S.qs("#addStudentError", modalEl);
    const successBox = S.qs("#addStudentSuccess", modalEl);
    const schoolYearInput = S.qs("#student_school_year", modalEl);
    const programSelect = S.qs("#student_program", modalEl);
    const yearLevelSelect = S.qs("#student_year_level", modalEl);

    const setAlert = (el, msg, isShow) => {
      if (!el) return;
      el.textContent = msg || "";
      if (isShow) el.classList.remove("d-none");
      else el.classList.add("d-none");
    };

    const setBtnLoading = (isLoading) => {
      if (!btnSave) return;
      btnSave.disabled = !!isLoading;
      const t = btnSave.querySelector(".btnsave-student-text");
      const l = btnSave.querySelector(".btnsave-student-loading");
      if (t) t.classList.toggle("d-none", !!isLoading);
      if (l) l.classList.toggle("d-none", !isLoading);
    };

    // ✅ FIX: Populate Year Level dropdown to match edit modal
    function populateYearLevelDropdown() {
      if (!yearLevelSelect || yearLevelSelect.options.length > 1) return;
      
      const yearLevels = [
        "1st Year", "2nd Year", "3rd Year", "4th Year", "5th Year", "Irregular"
      ];
      
      // Clear existing options except placeholder
      while (yearLevelSelect.options.length > 1) yearLevelSelect.remove(1);
      
      for (const level of yearLevels) {
        const option = document.createElement("option");
        option.value = level;
        option.textContent = level;
        yearLevelSelect.appendChild(option);
      }
    }

    // ✅ IMPORTANT FIX:
    // reset first, then populate + set school year (shown event so DOM is stable)
    modalEl.addEventListener("shown.bs.modal", () => {
      setAlert(errorBox, "", false);
      setAlert(successBox, "", false);

      // reset FIRST (so it doesn't wipe our populated values)
      form?.reset();

      // set default status to Pending
      const statusSelect = S.qs("#student_status", modalEl);
      if (statusSelect) statusSelect.value = "Pending";

      // populate programs, year levels + school year AFTER reset
      populateProgramDropdown({ force: true });
      populateYearLevelDropdown();
      setActiveSchoolYear({ force: true });

      // beat any other late reset
      setTimeout(() => {
        populateProgramDropdown({ force: true });
        populateYearLevelDropdown();
        setActiveSchoolYear({ force: true });
      }, 50);
      
      // Pause polling while modal is open
      state.polling.paused = true;
    });

    // Resume polling when modal closes
    modalEl.addEventListener("hidden.bs.modal", () => {
      state.polling.paused = false;
    });

    // Save button click
    btnSave?.addEventListener("click", async (e) => {
      e.preventDefault();
      setAlert(errorBox, "", false);
      setAlert(successBox, "", false);

      const idNumber = S.qs("#student_id_number", modalEl)?.value?.trim();
      const firstName = S.qs("#student_first_name", modalEl)?.value?.trim();
      const lastName = S.qs("#student_last_name", modalEl)?.value?.trim();

      if (!idNumber || !firstName || !lastName) {
        // Show inline error alert
        setAlert(errorBox, "Please fill in required fields: ID Number, First Name, and Last Name.", true);
        
        // Use global error notification
        S.safeShowError("Please fill in required fields: ID Number, First Name, and Last Name.");
        return;
      }

      const payload = {
        action: "create_student", // ✅ FIXED: Use ONLY create_student
        id_number: idNumber,
        first_name: firstName,
        middle_name: S.qs("#student_middle_name", modalEl)?.value?.trim() || "",
        last_name: lastName,
        suffix: S.qs("#student_suffix", modalEl)?.value?.trim() || "",
        email: S.qs("#student_email", modalEl)?.value?.trim() || "",
        program: programSelect?.value || "",
        year_level: yearLevelSelect?.value || "",
        school_year: schoolYearInput?.value?.trim() || "",
        status: S.qs("#student_status", modalEl)?.value || "Pending",
      };

      setBtnLoading(true);

      try {
        const data = await S.postJSON(payload);

        // Show inline success alert
        const successMessage = `Student ${fullName(payload)} created successfully. ${data.temp_password ? `Temporary password: ${data.temp_password}` : 'Password has been generated'}. Please provide this to the student.`;
        setAlert(successBox, successMessage, true);

        // Use global success notification
        S.safeShowSuccess(`Student ${fullName(payload)} created successfully.`);

        // reset but keep school year and programs
        form?.reset();
        const statusSelect = S.qs("#student_status", modalEl);
        if (statusSelect) statusSelect.value = "Pending";
        populateProgramDropdown({ force: true });
        populateYearLevelDropdown();
        setActiveSchoolYear({ force: true });

        // Refresh ALL tables, not just pending
        await refresh();

        setTimeout(() => {
          const modalInstance = bootstrap.Modal.getInstance(modalEl);
          if (modalInstance) {
            modalInstance.hide();
          }
        }, 1500);
      } catch (err) {
        console.error("Error creating student:", err);
        
        // Show inline error alert
        const errorMessage = err?.message || "Failed to create student. Please check the details and try again.";
        setAlert(errorBox, errorMessage, true);
        
        // Use global error notification
        S.safeShowError(errorMessage);
      } finally {
        setBtnLoading(false);
      }
    });
  }

  // -------------------------
  // Bulk actions binders (UPDATED with global modal utilities)
  // -------------------------
  function bindBulkBar(status) {
    const cfg = UI[status];

    // Select All button
    const btnSelectAll = S.qs(cfg.btnSelectAll);
    if (btnSelectAll) {
      const newBtn = btnSelectAll.cloneNode(true);
      btnSelectAll.parentNode.replaceChild(newBtn, btnSelectAll);
      newBtn.addEventListener("click", (e) => {
        e.preventDefault();
        setAllRowChecks(status, true);
        syncBulkBar(status);
      });
    }

    // Clear button
    const btnClear = S.qs(cfg.btnClear);
    if (btnClear) {
      const newBtn = btnClear.cloneNode(true);
      btnClear.parentNode.replaceChild(newBtn, btnClear);
      newBtn.addEventListener("click", (e) => {
        e.preventDefault();
        clearSelection(status);
      });
    }

    // Export button
    const btnExport = S.qs(cfg.btnExport);
    if (btnExport) {
      const newBtn = btnExport.cloneNode(true);
      btnExport.parentNode.replaceChild(newBtn, btnExport);
      newBtn.addEventListener("click", (e) => {
        e.preventDefault();
        exportSelected(status);
      });
    }

    // Pending tab buttons
    if (status === "Pending") {
      const btnApprove = S.qs(cfg.btnApprove);
      if (btnApprove) {
        const newBtn = btnApprove.cloneNode(true);
        btnApprove.parentNode.replaceChild(newBtn, btnApprove);
        newBtn.addEventListener("click", createApproveHandler());
      }

      const btnReject = S.qs(cfg.btnReject);
      if (btnReject) {
        const newBtn = btnReject.cloneNode(true);
        btnReject.parentNode.replaceChild(newBtn, btnReject);
        newBtn.addEventListener("click", createRejectHandler());
      }
    }

    // Archive button (Active tab)
    if (status === "Active" && cfg.btnArchive) {
      const btn = S.qs(cfg.btnArchive);
      if (btn) {
        const newBtn = btn.cloneNode(true);
        btn.parentNode.replaceChild(newBtn, btn);
        newBtn.addEventListener("click", createActiveArchiveHandler());
      }
    }

    // Inactive tab buttons
    if (status === "Inactive") {
      const btnActivate = S.qs("#studentsInactiveActivateSelectedBtn");
      if (btnActivate) {
        const newBtn = btnActivate.cloneNode(true);
        btnActivate.parentNode.replaceChild(newBtn, btnActivate);
        newBtn.addEventListener("click", createInactiveActivateHandler());
      }

      const btnArchive = S.qs(cfg.btnArchive);
      if (btnArchive) {
        const newBtn = btnArchive.cloneNode(true);
        btnArchive.parentNode.replaceChild(newBtn, btnArchive);
        newBtn.addEventListener("click", createInactiveArchiveHandler());
      }
    }

    // Archived tab buttons
    if (status === "Archived") {
      const btnActivate = S.qs("#studentsArchivedActivateSelectedBtn");
      if (btnActivate) {
        const newBtn = btnActivate.cloneNode(true);
        btnActivate.parentNode.replaceChild(newBtn, btnActivate);
        newBtn.addEventListener("click", createArchivedActivateHandler());
      }

      const btnRestore = S.qs(cfg.btnRestore);
      if (btnRestore) {
        const newBtn = btnRestore.cloneNode(true);
        btnRestore.parentNode.replaceChild(newBtn, btnRestore);
        newBtn.addEventListener("click", createArchivedRestoreHandler());
      }
    }
  }

  // -------------------------
  // Export selected (client-side)
  // -------------------------
  function exportSelected(status) {
    const ids = getSelectedIds(status);
    if (!ids.length) return;

    const rows = state[status].rows.filter((r) => ids.includes(Number(r.id)));
    const exportRows = rows.map((r) => ({
      id_number: r.id_number || "",
      first_name: r.first_name || "",
      middle_name: r.middle_name || "",
      last_name: r.last_name || "",
      suffix: r.suffix || "",
      email: r.email || "",
      program: r.program || "",
      year_level: r.year_level || "",
      school_year: r.school_year || "",
      role: r.role || "student",
      status: r.status || "",
    }));

    const csv = S.toCSV(exportRows, [
      "id_number",
      "first_name",
      "middle_name",
      "last_name",
      "suffix",
      "email",
      "program",
      "year_level",
      "school_year",
      "role",
      "status",
    ]);

    const fname = `students_${status.toLowerCase()}_selected.csv`;
    S.downloadText(fname, csv);
  }

  // -------------------------
  // Export All Students (NEW FUNCTION)
  // -------------------------
  async function exportAllStudents() {
    const rows = [];
    const statuses = ["Pending", "Active", "Inactive", "Archived"];
    
    for (const status of statuses) {
      const limit = 200;
      let page = 1;
      
      while (true) {
        const data = await S.postJSON({
          action: "list_users",
          group: GROUP,
          status,
          search: state.search,
          page,
          limit,
        });
        
        const pageRows = Array.isArray(data.rows) ? data.rows : [];
        rows.push(...pageRows.map(r => ({
          id_number: r.id_number || "",
          first_name: r.first_name || "",
          middle_name: r.middle_name || "",
          last_name: r.last_name || "",
          suffix: r.suffix || "",
          email: r.email || "",
          program: r.program || "",
          year_level: r.year_level || "",
          school_year: r.school_year || "",
          role: r.role || "student",
          status: r.status || "",
        })));
        
        const total = Number(data.total || 0);
        const totalPages = total ? Math.ceil(total / limit) : 1;
        if (page >= totalPages) break;
        page++;
      }
    }
    
    // Also export presidents
    const presLimit = 200;
    let presPage = 1;
    while (true) {
      const data = await S.postJSON({
        action: "list_users",
        group: "presidents",
        search: state.search,
        page: presPage,
        limit: presLimit,
      });
      
      const pageRows = Array.isArray(data.rows) ? data.rows : [];
      rows.push(...pageRows.map(r => ({
        id_number: r.id_number || "",
        first_name: r.first_name || "",
        middle_name: r.middle_name || "",
        last_name: r.last_name || "",
        suffix: r.suffix || "",
        email: r.email || "",
        program: r.program || "",
        year_level: r.year_level || "",
        school_year: r.school_year || "",
        role: r.role || "org_president",
        status: r.status || "",
      })));
      
      const total = Number(data.total || 0);
      const totalPages = total ? Math.ceil(total / presLimit) : 1;
      if (presPage >= totalPages) break;
      presPage++;
    }
    
    const csv = S.toCSV(rows, [
      "id_number", "first_name", "middle_name", "last_name", "suffix", 
      "email", "program", "year_level", "school_year", "role", "status"
    ]);
    
    S.downloadText("students_all.csv", csv);
  }

  // -------------------------
  // Common controls
  // -------------------------
  function bindSearchAndPageSize() {
    const searchEl = S.qs(common.search);
    const sizeEl = S.qs(common.pageSize);

    if (searchEl) {
      searchEl.addEventListener("input", () => {
        state.search = searchEl.value.trim();
        for (const s of STATUSES) {
          if (state[s]) state[s].page = 1;
        }
        state.President.page = 1; // Reset president page
        refresh();
      });
    }

    if (sizeEl) {
      sizeEl.addEventListener("change", () => {
        state.limit = parseInt(sizeEl.value, 10) || 10;
        for (const s of STATUSES) {
          if (state[s]) state[s].page = 1;
        }
        state.President.page = 1; // Reset president page
        refresh();
      });
    }
  }

  function bindPagination(status) {
    const cfg = UI[status];
    const ul = S.qs(cfg.pag);
    if (!ul) return;

    ul.addEventListener("click", (e) => {
      const a = e.target.closest("a.page-link");
      if (!a) return;
      e.preventDefault();

      const val = a.getAttribute("data-page");
      const st = state[status];
      if (!st) return;
      
      const totalPages = Math.max(1, Math.ceil((st.total || 0) / state.limit));

      if (val === "prev") st.page = Math.max(1, st.page - 1);
      else if (val === "next") st.page = Math.min(totalPages, st.page + 1);
      else st.page = parseInt(val, 10) || 1;

      if (status === "President") {
        refreshPresidentTab();
      } else {
        refreshStatus(status);
      }
    });
  }

  // -------------------------
  // Row actions

  function findStudentById(id) {
    const needle = Number(id);
    for (const st of STATUSES) {
      const rows = state[st]?.rows || [];
      const found = rows.find((r) => Number(r.id) === needle);
      if (found) return found;
    }
    // Also check presidents
    const presRows = state.President?.rows || [];
    const presFound = presRows.find((r) => Number(r.id) === needle);
    if (presFound) return presFound;
    
    return null;
  }

  function fillViewStudentModal(r) {
    const dash = (v) => {
      const s = String(v ?? "").trim();
      return s ? s : "—";
    };

    const set = (sel, val) => {
      const el = S.qs(sel);
      if (el) el.textContent = dash(val);
    };

    // IDs that you already have (based on your function)
    set("#viewStudentIdNo", r?.id_number);
    set("#viewStudentEmail", r?.email);
    set("#viewStudentProgram", r?.program);
    set("#viewStudentYearLevel", r?.year_level);
    set("#viewStudentSchoolYear", r?.school_year);
    set("#viewStudentStatus", r?.status);
    set("#viewStudentLastLogin", r?.last_login_at);
    set("#viewStudentCreated", r?.created_at);

    // ✅ FIX: set the separate name fields used by your modal layout
    set("#viewStudentFirstName", r?.first_name);
    set("#viewStudentMiddleName", r?.middle_name);
    set("#viewStudentLastName", r?.last_name);
    set("#viewStudentSuffix", r?.suffix);
    set("#viewStudentRole", r?.role || "student");

    // Optional: if your HTML ALSO has a combined name field, fill it too (won’t break if missing)
    set("#viewStudentName", fullName(r));

    // keep your edit-from-view working
    const btn = S.qs("#btnOpenEditStudentFromView");
    if (btn) btn.setAttribute("data-id", String(r?.id || ""));
  }

  function populateEditProgramDropdown({ force = false, selectedValue = null } = {}) {
    const sel = S.qs("#edit_student_program");
    if (!sel) return;

    const currentVal = selectedValue !== null && selectedValue !== undefined 
      ? String(selectedValue).trim()
      : String(sel.value ?? "").trim();

    // clear except placeholder
    while (sel.options.length > 1) sel.remove(1);

    const programs = getProgramsFromMeta()
      .map(normalizeProgramRow)
      .filter((p) => p.programName);

    for (const p of programs) {
      if (p.status && p.status !== "Active") continue;

      const opt = document.createElement("option");
      // FIXED: Store abbreviation as value (since database stores abbreviation)
      opt.value = p.abbr || p.programName;
      opt.textContent = p.abbr ? `${p.abbr} — ${p.programName}` : p.programName;
      // Store both abbreviation and program name as data attributes for matching
      opt.dataset.abbr = p.abbr || "";
      opt.dataset.programName = p.programName || "";
      sel.appendChild(opt);
    }

    // Try to select the value
    if (currentVal) {
      // First try exact match on value (abbreviation)
      let found = false;
      for (const o of Array.from(sel.options)) {
        if (o.value === currentVal) {
          sel.value = currentVal;
          found = true;
          break;
        }
      }
      
      // If not found, try matching on abbreviation (data-abbr)
      if (!found) {
        for (const o of Array.from(sel.options)) {
          const abbr = o.dataset.abbr || "";
          if (abbr && abbr === currentVal) {
            sel.value = o.value;
            found = true;
            break;
          }
        }
      }
      
      // If not found, try matching on program name
      if (!found) {
        for (const o of Array.from(sel.options)) {
          const programName = o.dataset.programName || "";
          if (programName && programName === currentVal) {
            sel.value = o.value;
            found = true;
            break;
          }
        }
      }
      
      // If still not found, try partial matching
      if (!found) {
        const currentLower = currentVal.toLowerCase();
        for (const o of Array.from(sel.options)) {
          const text = o.textContent.toLowerCase();
          const abbr = (o.dataset.abbr || "").toLowerCase();
          const programName = (o.dataset.programName || "").toLowerCase();
          
          if (text.includes(currentLower) || 
              abbr.includes(currentLower) || 
              programName.includes(currentLower) ||
              currentLower.includes(abbr) ||
              currentLower.includes(programName)) {
            sel.value = o.value;
            found = true;
            break;
          }
        }
      }
      
      // If still not found and we have a value, add it as an option
      if (!found && currentVal && currentVal !== "") {
        const opt = document.createElement("option");
        opt.value = currentVal;
        opt.textContent = currentVal;
        opt.dataset.abbr = currentVal;
        opt.dataset.programName = currentVal;
        sel.appendChild(opt);
        sel.value = currentVal;
      }
    }
    
    // If force is true and we couldn't match, at least ensure dropdown has options
    if (force && sel.options.length <= 1 && programs.length > 0) {
      sel.value = programs[0].abbr || programs[0].programName || "";
    }
  }

  function fillEditStudentModal(r) {
    const setVal = (sel, val) => {
      const el = S.qs(sel);
      if (el) el.value = String(val ?? "");
    };

    setVal("#edit_student_id", r?.id || "");
    setVal("#edit_student_id_number", r?.id_number || "");
    setVal("#edit_student_first_name", r?.first_name || "");
    setVal("#edit_student_middle_name", r?.middle_name || "");
    setVal("#edit_student_last_name", r?.last_name || "");
    setVal("#edit_student_suffix", r?.suffix || "");
    setVal("#edit_student_email", r?.email || "");
    setVal("#edit_student_school_year", r?.school_year || "");
    setVal("#edit_student_status", r?.status || "Pending"); // ✅ Ensure status is set with default

    // FIXED: Year Level - ensure options exist first, then set value
    const yearLevelSelect = S.qs("#edit_student_year_level");
    if (yearLevelSelect) {
      // Ensure the dropdown has the standard year level options
      if (yearLevelSelect.options.length <= 1) {
        // Use the same year levels as in the add modal for consistency
        const yearLevels = [
          "1st Year", "2nd Year", "3rd Year", "4th Year", "5th Year", "Irregular"
        ];
        yearLevelSelect.innerHTML = '<option value="">— Select year level —</option>' +
          yearLevels.map(opt => `<option value="${opt}">${opt}</option>`).join('');
      }
      
      // Set the value (normalize common variations)
      const yearLevel = r?.year_level || "";
      let normalizedYearLevel = yearLevel;
      
      // Normalize common variations - match the exact options in dropdown
      if (yearLevel.includes("1") || yearLevel.toLowerCase().includes("first")) normalizedYearLevel = "1st Year";
      else if (yearLevel.includes("2") || yearLevel.toLowerCase().includes("second")) normalizedYearLevel = "2nd Year";
      else if (yearLevel.includes("3") || yearLevel.toLowerCase().includes("third")) normalizedYearLevel = "3rd Year";
      else if (yearLevel.includes("4") || yearLevel.toLowerCase().includes("fourth")) normalizedYearLevel = "4th Year";
      else if (yearLevel.includes("5") || yearLevel.toLowerCase().includes("fifth")) normalizedYearLevel = "5th Year";
      else if (yearLevel.toLowerCase().includes("irregular")) normalizedYearLevel = "Irregular";
      
      // Try to set the value
      setVal("#edit_student_year_level", normalizedYearLevel || yearLevel);
      
      // If value not in options, add it
      if (yearLevel && !Array.from(yearLevelSelect.options).some(o => o.value === yearLevelSelect.value)) {
        const option = document.createElement("option");
        option.value = yearLevel;
        option.textContent = yearLevel;
        yearLevelSelect.appendChild(option);
        yearLevelSelect.value = yearLevel;
      }
    }

    // FIXED: Program - pass the student's program as selectedValue
    // Also need to update the populateProgramDropdown function to use abbreviation as value
    const studentProgram = r?.program || "";
    
    // First, try to set the value directly
    const programSelect = S.qs("#edit_student_program");
    if (programSelect && studentProgram) {
      programSelect.value = studentProgram;
    }
    
    // Then populate the dropdown with proper matching logic
    populateEditProgramDropdown({ 
      force: true, 
      selectedValue: studentProgram 
    });
    
    // Double-check program is selected (in case populate changed it)
    if (programSelect && studentProgram && programSelect.value !== studentProgram) {
      // Try one more time after a brief delay (in case async population)
      setTimeout(() => {
        if (programSelect.value !== studentProgram) {
          programSelect.value = studentProgram;
        }
      }, 100);
    }
  }

  function openViewStudent(id) {
    // Try to find in local state first
    let r = findStudentById(id);
    
    if (!r) {
      // If not found in state, fetch from API directly
      S.postJSON({ action: "get_user", id: id })
        .then(data => {
          const user = data?.user || data;
          if (user) {
            fillViewStudentModal(user);
            const modalEl = S.qs("#modalViewStudent");
            if (modalEl) {
              const modal = bootstrap.Modal.getOrCreateInstance(modalEl);
              modal.show();
              state.polling.paused = true;
              modalEl.addEventListener("hidden.bs.modal", () => {
                state.polling.paused = false;
              }, { once: true });
            }
          } else {
            S.safeShowError("Student not found. Please refresh the page.");
          }
        })
        .catch(err => {
          console.error("Failed to fetch student:", err);
          S.safeShowError("Failed to load student details.");
        });
      return;
    }

    // Found in local state
    fillViewStudentModal(r);
    const modalEl = S.qs("#modalViewStudent");
    if (!modalEl) return S.safeShowError("View Student modal is missing in HTML.");

    const modal = bootstrap.Modal.getOrCreateInstance(modalEl);
    modal.show();
    
    state.polling.paused = true;
    
    modalEl.addEventListener("hidden.bs.modal", () => {
      state.polling.paused = false;
    }, { once: true });
  }

  function openEditStudent(id) {
    // Try to find in local state first
    let r = findStudentById(id);
    
    if (!r) {
      // If not found in state, fetch from API directly
      S.postJSON({ action: "get_user", id: id })
        .then(data => {
          const user = data?.user || data;
          if (user) {
            // reset alerts
            const err = S.qs("#editStudentError");
            const ok = S.qs("#editStudentSuccess");
            if (err) err.classList.add("d-none");
            if (ok) ok.classList.add("d-none");

            fillEditStudentModal(user);

            const modalEl = S.qs("#modalEditStudent");
            if (modalEl) {
              const modal = bootstrap.Modal.getOrCreateInstance(modalEl);
              modal.show();
              state.polling.paused = true;
              modalEl.addEventListener("hidden.bs.modal", () => {
                state.polling.paused = false;
              }, { once: true });
            }
          } else {
            S.safeShowError("Student not found. Please refresh the page.");
          }
        })
        .catch(err => {
          console.error("Failed to fetch student:", err);
          S.safeShowError("Failed to load student for editing.");
        });
      return;
    }

    // Found in local state
    const err = S.qs("#editStudentError");
    const ok = S.qs("#editStudentSuccess");
    if (err) err.classList.add("d-none");
    if (ok) ok.classList.add("d-none");

    fillEditStudentModal(r);

    const modalEl = S.qs("#modalEditStudent");
    if (!modalEl) return S.safeShowError("Edit Student modal is missing in HTML.");

    const modal = bootstrap.Modal.getOrCreateInstance(modalEl);
    modal.show();
    
    state.polling.paused = true;
    
    modalEl.addEventListener("hidden.bs.modal", () => {
      state.polling.paused = false;
    }, { once: true });
  }

  function openEditStudent(id) {
    const r = findStudentById(id);
    if (!r) return S.safeShowError("Student not found in current page data. Try refreshing.");

    // reset alerts
    const err = S.qs("#editStudentError");
    const ok = S.qs("#editStudentSuccess");
    if (err) err.classList.add("d-none");
    if (ok) ok.classList.add("d-none");

    fillEditStudentModal(r);

    const modalEl = S.qs("#modalEditStudent");
    if (!modalEl) return S.safeShowError("Edit Student modal is missing in HTML.");

    const modal = bootstrap.Modal.getOrCreateInstance(modalEl);
    modal.show();
    
    // Pause polling while modal is open
    state.polling.paused = true;
    
    // Resume when modal closes
    modalEl.addEventListener("hidden.bs.modal", () => {
      state.polling.paused = false;
    }, { once: true });
  }

  function bindStudentViewEditModals() {
    // View modal -> open edit
    S.qs("#btnOpenEditStudentFromView")?.addEventListener("click", (e) => {
      e.preventDefault();
      const id = Number(e.currentTarget.getAttribute("data-id") || "0");
      if (!id) return;

      // hide view first, then show edit
      const viewEl = S.qs("#modalViewStudent");
      const viewModal = bootstrap.Modal.getInstance(viewEl);
      if (viewModal) {
        viewModal.hide();
      }

      setTimeout(() => openEditStudent(id), 150);
    });

    // Save edit - FIXED: Keep inline alerts AND show modal popups
    S.qs("#btnSaveEditStudent")?.addEventListener("click", async (e) => {
      e.preventDefault();

      const err = S.qs("#editStudentError");
      const ok = S.qs("#editStudentSuccess");

      const setAlert = (el, msg, show) => {
        if (!el) return;
        el.textContent = msg || "";
        el.classList.toggle("d-none", !show);
      };

      setAlert(err, "", false);
      setAlert(ok, "", false);

      const id = Number(S.qs("#edit_student_id")?.value || "0");
      if (!id) {
        setAlert(err, "Missing student id.", true);
        // Use global error notification
        S.safeShowError("Missing student ID. Please try refreshing and editing again.");
        return;
      }

      const btn = S.qs("#btnSaveEditStudent");
      const setBtnLoading = (isLoading) => {
        if (!btn) return;
        btn.disabled = !!isLoading;
        btn.querySelector(".btnedit-student-text")?.classList.toggle("d-none", !!isLoading);
        btn.querySelector(".btnedit-student-loading")?.classList.toggle("d-none", !isLoading);
      };

      // ✅ Collect ALL required fields including id_number and status
      const id_number = S.qs("#edit_student_id_number")?.value?.trim();
      const first_name = S.qs("#edit_student_first_name")?.value?.trim();
      const last_name = S.qs("#edit_student_last_name")?.value?.trim();
      const status = S.qs("#edit_student_status")?.value?.trim() || "Pending";
      
      if (!id_number || !first_name || !last_name) {
        setAlert(err, "ID Number, First Name and Last Name are required.", true);
        // Use global error notification
        S.safeShowError("ID Number, First Name and Last Name are required.");
        return;
      }

      // ✅ Try different action names for update with ALL required fields
      let payload = {
        action: "update_student", // Try this first
        id: id,
        id_number: id_number,
        first_name: first_name,
        middle_name: S.qs("#edit_student_middle_name")?.value?.trim() || "",
        last_name: last_name,
        suffix: S.qs("#edit_student_suffix")?.value?.trim() || "",
        email: S.qs("#edit_student_email")?.value?.trim() || "",
        program: S.qs("#edit_student_program")?.value || "",
        year_level: S.qs("#edit_student_year_level")?.value || "",
        school_year: S.qs("#edit_student_school_year")?.value?.trim() || "",
        status: status,
      };

      setBtnLoading(true);
      try {
        const response = await S.postJSON(payload);
        
        // Show inline success alert
        setAlert(ok, "Student updated successfully.", true);
        
        // Use global success notification
        const studentName = `${first_name} ${last_name}`.trim();
        S.safeShowSuccess(`Student "${studentName}" has been updated successfully.`);

        // refresh ALL tables (student might change status)
        await refresh();

        // close edit modal after a short delay
        const modalEl = S.qs("#modalEditStudent");
        const modalInstance = bootstrap.Modal.getInstance(modalEl);
        if (modalInstance) {
          setTimeout(() => modalInstance.hide(), 300);
        }
      } catch (ex) {
        // Try with "edit_student" if "update_student" fails
        if (ex?.message?.includes("unknown action") || ex?.message?.includes("Invalid action")) {
          try {
            payload.action = "edit_student";
            const response = await S.postJSON(payload);
            
            // Show inline success alert
            setAlert(ok, "Student updated successfully.", true);
            
            // Use global success notification
            const studentName = `${first_name} ${last_name}`.trim();
            S.safeShowSuccess(`Student "${studentName}" has been updated successfully.`);
            
            await refresh();
            
            // close edit modal after a short delay
            const modalEl = S.qs("#modalEditStudent");
            const modalInstance = bootstrap.Modal.getInstance(modalEl);
            if (modalInstance) {
              setTimeout(() => modalInstance.hide(), 300);
            }
          } catch (secondErr) {
            // Try with the new "update_user" action as a final fallback
            try {
              payload.action = "update_user";
              payload.group = "students"; // ✅ ADDED: Required for update_user action
              const response = await S.postJSON(payload);
              
              // Show inline success alert
              setAlert(ok, "Student updated successfully.", true);
              
              // Use global success notification
              const studentName = `${first_name} ${last_name}`.trim();
              S.safeShowSuccess(`Student "${studentName}" has been updated successfully.`);
              
              await refresh();
              
              // close edit modal after a short delay
              const modalEl = S.qs("#modalEditStudent");
              const modalInstance = bootstrap.Modal.getInstance(modalEl);
              if (modalInstance) {
                setTimeout(() => modalInstance.hide(), 300);
              }
            } catch (thirdErr) {
              // Show inline error alert
              setAlert(err, thirdErr?.message || "Failed to update student.", true);
              
              // Use global error notification
              S.safeShowError(thirdErr?.message || "Failed to update student. Please try again.");
            }
          }
        } else {
          // Show inline error alert
          setAlert(err, ex?.message || "Failed to update student.", true);
          
          // Use global error notification
          S.safeShowError(ex?.message || "Failed to update student. Please try again.");
        }
      } finally {
        setBtnLoading(false);
      }
    });
  }

  // -------------------------
  
  function bindRowActions() {
    document.addEventListener("click", async (e) => {
      const viewBtn = e.target.closest(".mu-student-view-one, .mu-president-view-one");
      if (viewBtn) {
        e.preventDefault();
        const id = parseInt(viewBtn.getAttribute("data-id") || "0", 10);
        if (id) openViewStudent(id);
        return;
      }

      const editBtn = e.target.closest(".mu-student-edit-one");
      if (editBtn) {
        e.preventDefault();
        const id = parseInt(editBtn.getAttribute("data-id") || "0", 10);
        if (id) openEditStudent(id);
        return;
      }

      const resetBtn = e.target.closest(".mu-student-reset-one");
      if (resetBtn) {
        e.preventDefault();
        const id = parseInt(resetBtn.getAttribute("data-id") || "0", 10);
        const studentName = resetBtn.getAttribute("data-name") || "Student";
        if (!id) return;

        // Use global confirm modal
        if (typeof S.showConfirmModal === 'function') {
          S.showConfirmModal({
            title: 'Reset Password',
            subtitle: `Reset password for ${studentName}`,
            message: `Are you sure you want to reset the password for ${studentName}? The password will be reset to their ID Number.`,
            type: 'info',
            btnText: 'Reset Password',
            btnClass: 'warning',
            btnIcon: 'key',
            showWarning: false,
            onConfirm: async function() {
              try {
                await S.postJSON({ action: "reset_password", id });
                
                // Use global success notification
                S.safeShowSuccess(`Password for ${studentName} has been reset to their ID Number.`);
                
                // Refresh to get updated data
                await refresh();
              } catch (err) {
                S.safeShowError(err?.message || "Failed to reset password.");
              }
            }
          });
        }
        return;
      }

            // FIXED: Promote to President action
      const promoteBtn = e.target.closest(".mu-student-promote-president");
      if (promoteBtn) {
        e.preventDefault();
        const id = parseInt(promoteBtn.getAttribute("data-id") || "0", 10);
        const studentName = promoteBtn.getAttribute("data-name") || "Student";
        if (!id) return;

        if (typeof S.showConfirmModal === 'function') {
          S.showConfirmModal({
            title: 'Promote to President',
            subtitle: `Change role for ${studentName}`,
            message: `Are you sure you want to promote ${studentName} to President? This will change their role from Student to Organization President.`,
            type: 'success',
            btnText: 'Promote',
            btnClass: 'success',
            btnIcon: 'stars',
            onConfirm: async function() {
              try {
                await S.postJSON({ 
                  action: "update_user_role", 
                  id: id, 
                  role: "org_president" 
                });
                S.safeShowSuccess(`${studentName} has been promoted to President.`);
                
                // Refresh both tabs
                await refreshStatus("Active");
                if (window.UsersPresident?.refresh) {
                  await window.UsersPresident.refresh();
                }
              } catch (err) {
                S.safeShowError(err?.message || "Failed to promote student.");
              }
            }
          });
        }
        return;
      }

      // FIXED: Demote from President action
      const demoteBtn = e.target.closest(".mu-president-demote");
      if (demoteBtn) {
        e.preventDefault();
        const id = parseInt(demoteBtn.getAttribute("data-id") || "0", 10);
        const presidentName = demoteBtn.getAttribute("data-name") || "President";
        if (!id) return;

        if (typeof S.showConfirmModal === 'function') {
          S.showConfirmModal({
            title: 'Demote to Student',
            subtitle: `Change role for ${presidentName}`,
            message: `Are you sure you want to demote ${presidentName} from President back to Student?`,
            type: 'warning',
            btnText: 'Demote',
            btnClass: 'warning',
            btnIcon: 'arrow-down-circle',
            onConfirm: async function() {
              try {
                await S.postJSON({ 
                  action: "update_user_role", 
                  id: id, 
                  role: "student" 
                });
                S.safeShowSuccess(`${presidentName} has been demoted to Student.`);
                
                // Refresh both tabs
                if (window.UsersPresident?.refresh) {
                  await window.UsersPresident.refresh();
                }
                await refresh();
              } catch (err) {
                S.safeShowError(err?.message || "Failed to demote president.");
              }
            }
          });
        }
        return;
      }

      const statusBtn = e.target.closest(".mu-set-status");
      if (statusBtn) {
        e.preventDefault();
        const id = parseInt(statusBtn.getAttribute("data-id") || "0", 10);
        const next = String(statusBtn.getAttribute("data-next") || "");
        const studentName = statusBtn.getAttribute("data-name") || "Student";
        if (!id || !next) return;

        const tr = statusBtn.closest("tr");
        const tbody = tr?.closest("tbody");
        const status = tbody?.id?.includes("Pending") ? "Pending"
          : tbody?.id?.includes("Active") ? "Active"
          : tbody?.id?.includes("Inactive") ? "Inactive"
          : tbody?.id?.includes("Archived") ? "Archived"
          : tbody?.id?.includes("President") ? "President"
          : "";

        // Map next status to action names for the confirmation modal
        const actionNames = {
          "Active": status === "Pending" ? "approve" : "activate",
          "Inactive": "deactivate",
          "Archived": "archive"
        };
        
        const actionName = actionNames[next] || "update";
        const actionDisplay = {
          "approve": "Approve",
          "activate": "Activate", 
          "deactivate": "Deactivate",
          "archive": "Archive"
        }[actionName] || "Update";
        
        const statusMessages = {
          "Active": status === "Pending" 
            ? "Approve this student and change their status to Active" 
            : "Change status to Active",
          "Inactive": "Change status to Inactive",
          "Archived": "Archive this student"
        };
        
        const warningMessages = {
          "Active": "",
          "Inactive": "Student will be marked as inactive and won't be able to log in.",
          "Archived": "Archived students will not appear in active/inactive lists."
        };

        // Use global confirm modal
        if (typeof S.showConfirmModal === 'function') {
          S.showConfirmModal({
            title: `${actionDisplay} Student`,
            subtitle: statusMessages[next] || `Change status to ${next}`,
            message: `Are you sure you want to ${actionName} ${studentName}?`,
            type: next === "Archived" ? "archive" : 
                  next === "Active" ? "success" : 
                  next === "Inactive" ? "warning" : "info",
            btnText: actionDisplay,
            btnClass: next === "Active" ? "success" : 
                     next === "Inactive" ? "warning" : 
                     next === "Archived" ? "warning" : "primary",
            btnIcon: next === "Active" ? "check-circle" : 
                    next === "Inactive" ? "dash-circle" : 
                    next === "Archived" ? "archive" : "check",
            showWarning: !!warningMessages[next],
            warningText: warningMessages[next],
            onConfirm: async function() {
              try {
                const group = status === "President" ? "presidents" : GROUP;
                await S.postJSON({ action: "set_status", group, id, status: next });
                
                // Use global success notification
                const successMessages = {
                  "Active": status === "Pending" 
                    ? "Student approved successfully" 
                    : "Student activated successfully",
                  "Inactive": "Student deactivated successfully",
                  "Archived": "Student archived successfully"
                };
                
                S.safeShowSuccess(`${studentName}: ${successMessages[next] || 'Status updated successfully'}.`);
                
                // FIXED: Refresh BOTH the source AND destination tabs
                if (status === "President") {
                  await refreshPresidentTab(); // Source tab
                } else if (status) {
                  await refreshStatus(status); // Source tab
                }
                
                if (next && next !== status) {
                  if (next === "President") {
                    await refreshPresidentTab(); // Destination tab
                  } else {
                    await refreshStatus(next); // Destination tab
                  }
                }
              } catch (err) {
                S.safeShowError(err?.message || "Failed to update status.");
              }
            }
          });
        }
      }
    });
  }

  // -------------------------
  // Export dropdown (loaded page)
  // -------------------------
  function exportLoaded(status) {
    const rows = state[status]?.rows || [];
    const exportRows = rows.map((r) => ({
      id_number: r.id_number || "",
      first_name: r.first_name || "",
      middle_name: r.middle_name || "",
      last_name: r.last_name || "",
      suffix: r.suffix || "",
      email: r.email || "",
      program: r.program || "",
      year_level: r.year_level || "",
      school_year: r.school_year || "",
      role: r.role || "student",
      status: r.status || "",
    }));

    const csv = S.toCSV(exportRows, [
      "id_number",
      "first_name",
      "middle_name",
      "last_name",
      "suffix",
      "email",
      "program",
      "year_level",
      "school_year",
      "role",
      "status",
    ]);

    S.downloadText(`students_${status.toLowerCase()}_page.csv`, csv);
  }

  function bindExportDropdown() {
    S.qs(common.exportPendingCsv)?.addEventListener("click", (e) => {
      e.preventDefault();
      exportLoaded("Pending");
    });
    S.qs(common.exportActiveCsv)?.addEventListener("click", (e) => {
      e.preventDefault();
      exportLoaded("Active");
    });
    S.qs(common.exportInactiveCsv)?.addEventListener("click", (e) => {
      e.preventDefault();
      exportLoaded("Inactive");
    });
    S.qs(common.exportArchivedCsv)?.addEventListener("click", (e) => {
      e.preventDefault();
      exportLoaded("Archived");
    });
    S.qs("#exportStudentsPresidentCsv")?.addEventListener("click", (e) => {
      e.preventDefault();
      exportLoaded("President");
    });
    
    // ADD THIS: Bind the "All" button
    S.qs("#exportStudentsAllCsv")?.addEventListener("click", (e) => {
      e.preventDefault();
      exportAllStudents();
    });
  }

  // -------------------------
  // Import - FIXED to use only create_student
  // -------------------------
  function parseCSV(text) {
    const rows = [];
    let i = 0;
    let cur = "";
    let inQ = false;
    let row = [];

    const pushCell = () => {
      row.push(cur);
      cur = "";
    };
    const pushRow = () => {
      rows.push(row);
      row = [];
    };

    while (i < text.length) {
      const ch = text[i];

      if (inQ) {
        if (ch === '"') {
          if (text[i + 1] === '"') {
            cur += '"';
            i += 2;
            continue;
          }
          inQ = false;
          i++;
          continue;
        }
        cur += ch;
        i++;
        continue;
      }

      if (ch === '"') {
        inQ = true;
        i++;
        continue;
      }

      if (ch === ",") {
        pushCell();
        i++;
        continue;
      }

      if (ch === "\n") {
        pushCell();
        pushRow();
        i++;
        continue;
      }

      if (ch === "\r") {
        i++;
        continue;
      }

      cur += ch;
      i++;
    }

    pushCell();
    pushRow();

    while (rows.length && rows[rows.length - 1].every((c) => String(c).trim() === "")) rows.pop();
    return rows;
  }

  function bindImport() {
    const openBtn = S.qs(common.importCsv);
    if (!openBtn) return;

    const modalEl = S.qs("#modalImportCsv");
    if (!modalEl) return;

    const fileEl = modalEl.querySelector('input[type="file"]');
    const groupHidden = S.qs("#csv_import_target");
    const modeInsertOnly = S.qs("#importInsertOnly");
    const errBox = S.qs("#importCsvError");
    const okBox = S.qs("#importCsvSuccess");
    const btn = S.qs("#btnProcessCsvImport");

    const setAlert = (el, msg, isShow) => {
      if (!el) return;
      el.textContent = msg || "";
      if (isShow) el.classList.remove("d-none");
      else el.classList.add("d-none");
    };

    const setBtnLoading = (isLoading) => {
      if (!btn) return;
      btn.disabled = !!isLoading;
      const t = btn.querySelector(".btnimport-text");
      const l = btn.querySelector(".btnimport-loading");
      if (t) t.classList.toggle("d-none", !!isLoading);
      if (l) l.classList.toggle("d-none", !isLoading);
    };

    openBtn.addEventListener("click", (e) => {
      e.preventDefault();
      groupHidden && (groupHidden.value = "students");
      setAlert(errBox, "", false);
      setAlert(okBox, "", false);
      if (fileEl) fileEl.value = "";
      const modal = bootstrap.Modal.getOrCreateInstance(modalEl);
      modal.show();
      
      // Pause polling while modal is open
      state.polling.paused = true;
    });

    // Resume polling when import modal closes
    modalEl.addEventListener("hidden.bs.modal", () => {
      state.polling.paused = false;
    });

    btn?.addEventListener("click", async (e) => {
      e.preventDefault();
      setAlert(errBox, "", false);
      setAlert(okBox, "", false);

      const file = fileEl?.files?.[0];
      if (!file) {
        setAlert(errBox, "Please choose a CSV file first.", true);
        return;
      }

      const isInsertOnly = !!modeInsertOnly?.checked;
      setBtnLoading(true);

      try {
        const text = await file.text();
        const parsed = parseCSV(text);
        if (!parsed.length) throw new Error("CSV is empty.");

        const header = parsed[0].map((h) => String(h).trim());
        const idx = (name) => header.findIndex((h) => h.toLowerCase() === name.toLowerCase());

        const required = ["id_number", "first_name", "last_name"];
        for (const r of required) {
          if (idx(r) < 0) throw new Error(`CSV missing required column: ${r}`);
        }

        let created = 0;
        let failed = 0;

        for (let r = 1; r < parsed.length; r++) {
          const line = parsed[r];
          if (!line || line.every((c) => String(c).trim() === "")) continue;

          // ✅ FIXED: Use ONLY create_student
          let payload = {
            action: "create_student",
            id_number: String(line[idx("id_number")] || "").trim(),
            first_name: String(line[idx("first_name")] || "").trim(),
            middle_name: String(line[idx("middle_name")] || "").trim(),
            last_name: String(line[idx("last_name")] || "").trim(),
            suffix: String(line[idx("suffix")] || "").trim(),
            email: String(line[idx("email")] || "").trim(),
            program: String(line[idx("program")] || "").trim(),
            year_level: String(line[idx("year_level")] || "").trim(),
            school_year: String(line[idx("school_year")] || "").trim(),
            status: String(line[idx("status")] || "Pending").trim() || "Pending",
          };

          if (!payload.id_number || !payload.first_name || !payload.last_name) {
            failed++;
            continue;
          }

          try {
            await S.postJSON(payload);
            created++;
          } catch (err) {
            failed++;
            console.error("Failed to create student from CSV:", err);
            
            if (!isInsertOnly) {
              // I have no idea what to put here lmfao
            }
          }
        }

        // Use global success notification for import
        S.safeShowSuccess(`Student import completed. Created: ${created}. Failed/Skipped: ${failed}.`);
        
        await refresh();
        
        // Close import modal
        const modalInstance = bootstrap.Modal.getInstance(modalEl);
        if (modalInstance) {
          setTimeout(() => modalInstance.hide(), 1500);
        }
      } catch (err) {
        setAlert(errBox, err?.message || "Import failed.", true);
        S.safeShowError(err?.message || "Import failed.");
      } finally {
        setBtnLoading(false);
      }
    });
  }

  // -------------------------
  // Find student by id_number from API (not just current page cache)
  // -------------------------
  async function fetchStudentByIdNumber(idNumber) {
    const needle = String(idNumber || "").trim();
    if (!needle) return null;

    // Search across all status tabs (fast small pages)
    for (const status of STATUSES) {
      const data = await S.postJSON({
        action: "list_users",
        group: GROUP,
        status,
        search: needle,
        page: 1,
        limit: 25,
      });

      const rows = Array.isArray(data.rows) ? data.rows : [];
      const exact = rows.find(r => String(r.id_number || "").trim() === needle);
      if (exact) return exact;
    }
    
    // Search presidents
    const presData = await S.postJSON({
      action: "list_users",
      group: "presidents",
      search: needle,
      page: 1,
      limit: 25,
    });
    
    const presRows = Array.isArray(presData.rows) ? presData.rows : [];
    const presExact = presRows.find(r => String(r.id_number || "").trim() === needle);
    if (presExact) return presExact;
    
    return null;
  }

  async function fetchStudentById(userId) {
    const id = Number(userId || 0);
    if (!id) return null;

    // Search across all status tabs
    for (const status of STATUSES) {
      const data = await S.postJSON({
        action: "list_users",
        group: GROUP,
        status,
        search: String(id),
        page: 1,
        limit: 25,
      });

      const rows = Array.isArray(data.rows) ? data.rows : [];
      const exact = rows.find(r => Number(r.id) === id);
      if (exact) return exact;
    }
    
    // Search presidents
    const presData = await S.postJSON({
      action: "list_users",
      group: "presidents",
      search: String(id),
      page: 1,
      limit: 25,
    });
    
    const presRows = Array.isArray(presData.rows) ? presData.rows : [];
    const presExact = presRows.find(r => Number(r.id) === id);
    if (presExact) return presExact;
    
    return null;
  }

  // -------------------------
  // Init
  // -------------------------
  function init(shared) {
    S = shared;
    
    bindSearch(); // Replace bindSearchAndPageSize with this
    bindAddStudentModal();

    enableDropdownPortal();

    for (const st of STATUSES) {
      bindPagination(st);
      bindBulkBar(st);
      syncBulkBar(st);
    }

    bindRowActions();
    bindStudentViewEditModals();
    bindExportDropdown();
    bindImport();
    
    setupVisibilityHandlers();
    startPolling();
    setupNotificationListener();
    
    refresh().then(async () => {
      const [sigP, sigA, sigI, sigR] = await Promise.all([
        fetchSignature("Pending"),
        fetchSignature("Active"),
        fetchSignature("Inactive"),
        fetchSignature("Archived")
      ]);
      
      state.Pending.signature = sigP;
      state.Active.signature = sigA;
      state.Inactive.signature = sigI;
      state.Archived.signature = sigR;
    });
  }

  // Public API
  window.UsersStudent = {
    init,
    refresh,
    refreshStatus,
    refreshBothStatuses,
    refreshPresidentTab,
    startPolling,
    stopPolling,
    highlightFromNotification,
    openFromNotification: highlightFromNotification
  };

})();