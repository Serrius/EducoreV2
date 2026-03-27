/* js/manage-users/faculty-admin.js */
/* global bootstrap */

(function () {
  "use strict";

  /* Make dropdown-menu escape overflow containers by portaling to <body> */
  function enableDropdownPortal() {
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
      menu.style.transform = "none";
      menu.style.inset = "auto";
      menu.style.right = "auto";
      menu.style.bottom = "auto";

      menu.style.width = "auto";
      menu.style.minWidth = "220px";
      menu.style.maxWidth = "320px";
      menu.style.whiteSpace = "normal";
      menu.style.overflowWrap = "anywhere";
      menu.style.boxSizing = "border-box";
    }

    function place(toggle, menu) {
      const r = toggle.getBoundingClientRect();

      menu.style.position = "fixed";
      menu.style.zIndex = "3000";
      menu.style.display = "block";
      menu.style.visibility = "hidden";

      hardNeutralizePopperStyles(menu);

      const mw = menu.offsetWidth;
      const mh = menu.offsetHeight;

      let left = r.right - mw;
      let top = r.bottom;

      const pad = 8;
      left = Math.max(pad, Math.min(left, window.innerWidth - mw - pad));

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

      if (info.originalStyle == null) menu.removeAttribute("style");
      else menu.setAttribute("style", info.originalStyle);

      info.parent.insertBefore(menu, info.next || null);

      const onReflow = menu._mu_reflow;
      if (onReflow) {
        window.removeEventListener("scroll", onReflow, true);
        window.removeEventListener("resize", onReflow, true);
        delete menu._mu_reflow;
      }
      delete menu._mu_toggle;
    }

    document.addEventListener("show.bs.dropdown", (e) => {
      const dd = e.target; // .dropdown
      const toggle = dd.querySelector('[data-bs-toggle="dropdown"]');
      const menu = dd.querySelector(".dropdown-menu");
      if (!toggle || !menu) return;

      if (!isTrapped(dd)) return;

      toggle.setAttribute("data-bs-display", "static");

      if (!stash.has(menu)) {
        stash.set(menu, {
          parent: menu.parentNode,
          next: menu.nextSibling,
          originalStyle: menu.getAttribute("style"),
        });
      }

      menu.classList.add(ACTIVE_CLASS);
      document.body.appendChild(menu);

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

      if (menu.classList.contains(ACTIVE_CLASS) && menu.parentElement === document.body) {
        restoreOne(menu);
      }
    });

    document.addEventListener("click", () => {
      document.querySelectorAll(`body > .dropdown-menu.${ACTIVE_CLASS}`).forEach((menu) => {
        if (menu.classList.contains("show")) return;
        restoreOne(menu);
      });
    });

    document.addEventListener("keydown", (e) => {
      if (e.key !== "Escape") return;
      document.querySelectorAll(`body > .dropdown-menu.${ACTIVE_CLASS}`).forEach((menu) => {
        menu.classList.remove("show");
      });
    });
  }

  let S = null;
  let actionsBound = false;

  const GROUP = "faculty";
  const STATUSES = ["Active", "Inactive", "Archived"];
  const EMPTY_MSG = {
    "Active": "No active faculty admins found.",
    "Inactive": "No inactive faculty admins found.",
    "Archived": "No archived faculty admins found."
  };

  const UI = {
    Active: {
      tbody: "#facultyActiveTbody",
      meta: "#facultyActiveMeta",
      pag: "#facultyActivePagination",
      bulkBar: "#facultyActiveBulkBar",
      selCount: "#facultyActiveSelectedCount",
      btnSelectAll: "#facultyActiveSelectAllBtn",
      btnClear: "#facultyActiveClearSelectionBtn",
      btnExport: "#facultyActiveExportSelectedBtn",
      btnArchive: "#facultyActiveArchiveSelectedBtn",
    },
    Inactive: {
      tbody: "#facultyInactiveTbody",
      meta: "#facultyInactiveMeta",
      pag: "#facultyInactivePagination",
      bulkBar: "#facultyInactiveBulkBar",
      selCount: "#facultyInactiveSelectedCount",
      btnSelectAll: "#facultyInactiveSelectAllBtn",
      btnClear: "#facultyInactiveClearSelectionBtn",
      btnExport: "#facultyInactiveExportSelectedBtn",
      btnArchive: "#facultyInactiveArchiveSelectedBtn",
    },
    Archived: {
      tbody: "#facultyArchivedTbody",
      meta: "#facultyArchivedMeta",
      pag: "#facultyArchivedPagination",
      bulkBar: "#facultyArchivedBulkBar",
      selCount: "#facultyArchivedSelectedCount",
      btnSelectAll: "#facultyArchivedSelectAllBtn",
      btnClear: "#facultyArchivedClearSelectionBtn",
      btnExport: "#facultyArchivedExportSelectedBtn",
      btnRestore: "#facultyArchivedRestoreSelectedBtn",
    },
  };

  const common = {
    // Updated to use per-tab search inputs
    searchActive: "#facultyActiveSearch",
    searchInactive: "#facultyInactiveSearch",
    searchArchived: "#facultyArchivedSearch",
    pageSize: "#facultyPageSize", // You'll need to add this to HTML
    btnAdd: "#btnAddFacultyTab",
    btnImport: "#btnImportFacultyCsv",
    exportActiveCsv: "#exportFacultyActiveCsv",
    exportInactiveCsv: "#exportFacultyInactiveCsv",
    exportArchivedCsv: "#exportFacultyArchivedCsv",
    exportAllCsv: "#exportFacultyAllCsv",
  };

  const state = {
    search: {
      Active: "",
      Inactive: "",
      Archived: ""
    },
    limit: 10,
    Active: { page: 1, total: 0, rows: [], signature: "" },
    Inactive: { page: 1, total: 0, rows: [], signature: "" },
    Archived: { page: 1, total: 0, rows: [], signature: "" },

    polling: {
      timer: null,
      everyMs: 1000,
      paused: false,
      running: false,
    },
    searchDebounceTimers: {
      Active: null,
      Inactive: null,
      Archived: null
    }
  };

  // Add this function to reinitialize event listeners after refresh
  function reinitializeEventListeners() {
    console.log('[Faculty] Reinitializing event listeners...');
    
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
      
      // Re-bind archive buttons
      if (cfg.btnArchive) {
        const btn = S.qs(cfg.btnArchive);
        if (btn) {
          const newBtn = btn.cloneNode(true);
          btn.parentNode.replaceChild(newBtn, btn);
          newBtn.addEventListener("click", createArchiveHandler(st));
        }
      }
      
      // Re-bind restore buttons
      if (cfg.btnRestore) {
        const btn = S.qs(cfg.btnRestore);
        if (btn) {
          const newBtn = btn.cloneNode(true);
          btn.parentNode.replaceChild(newBtn, btn);
          newBtn.addEventListener("click", createRestoreHandler(st));
        }
      }
    }
  }

  // Handler factory functions
  function createArchiveHandler(status) {
    return async (e) => {
      e.preventDefault();
      const ids = getSelectedIds(status);
      if (!ids.length) return;

      const doIt = async () => {
        await S.postJSON({ action: "bulk_set_status", group: GROUP, status: "Archived", ids });
        clearSelection(status);
        await refresh();
        S.safeShowSuccess(`Archived ${ids.length} user(s).`);
      };

      if (typeof S.showConfirmModal === "function") {
        S.showConfirmModal({
          title: "Archive Selected",
          subtitle: "Move selected users to Archived",
          message: `Archive ${ids.length} selected user(s)?`,
          type: "archive",
          btnText: "Archive",
          btnClass: "warning",
          btnIcon: "archive",
          onConfirm: doIt,
        });
      } else {
        await doIt();
      }
    };
  }

  function createRestoreHandler(status) {
    return async (e) => {
      e.preventDefault();
      const ids = getSelectedIds(status);
      if (!ids.length) return;

      const doIt = async () => {
        await S.postJSON({ action: "bulk_set_status", group: GROUP, status: "Active", ids });
        clearSelection(status);
        await refresh();
        S.safeShowSuccess(`Restored ${ids.length} user(s).`);
      };

      if (typeof S.showConfirmModal === "function") {
        S.showConfirmModal({
          title: "Restore Selected",
          subtitle: "Move selected users back to Active",
          message: `Restore ${ids.length} selected user(s) to Active?`,
          type: "restore",
          btnText: "Restore",
          btnClass: "success",
          btnIcon: "arrow-counterclockwise",
          onConfirm: doIt,
        });
      } else {
        await doIt();
      }
    };
  }
  
  // Handler factory functions
  function createArchiveHandler(status) {
    return async (e) => {
      e.preventDefault();
      const ids = getSelectedIds(status);
      if (!ids.length) return;

      const doIt = async () => {
        await S.postJSON({ action: "bulk_set_status", group: GROUP, status: "Archived", ids });
        clearSelection(status);
        await refresh();
        S.safeShowSuccess(`Archived ${ids.length} user(s).`);
      };

      if (typeof S.showConfirmModal === "function") {
        S.showConfirmModal({
          title: "Archive Selected",
          subtitle: "Move selected users to Archived",
          message: `Archive ${ids.length} selected user(s)?`,
          type: "archive",
          btnText: "Archive",
          btnClass: "warning",
          btnIcon: "archive",
          onConfirm: doIt,
        });
      } else {
        await doIt();
      }
    };
  }

  function createRestoreHandler(status) {
    return async (e) => {
      e.preventDefault();
      const ids = getSelectedIds(status);
      if (!ids.length) return;

      const doIt = async () => {
        await S.postJSON({ action: "bulk_set_status", group: GROUP, status: "Active", ids });
        clearSelection(status);
        await refresh();
        S.safeShowSuccess(`Restored ${ids.length} user(s).`);
      };

      if (typeof S.showConfirmModal === "function") {
        S.showConfirmModal({
          title: "Restore Selected",
          subtitle: "Move selected users back to Active",
          message: `Restore ${ids.length} selected user(s) to Active?`,
          type: "restore",
          btnText: "Restore",
          btnClass: "success",
          btnIcon: "arrow-counterclockwise",
          onConfirm: doIt,
        });
      } else {
        await doIt();
      }
    };
  }

  // -------------------------
  // Signature-based change detection
  // -------------------------
  function computeSignatureFromListPayload(payload) {
    const total = Number(payload.total || 0);
    const first = Array.isArray(payload.rows) && payload.rows.length ? payload.rows[0] : null;
    const newestId = first ? String(first.id ?? "") : "";
    const newestCreated = first ? String(first.created_at ?? "") : "";
    return `${total}|${newestId}|${newestCreated}`;
  }

  async function fetchSignature(status) {
    const data = await S.postJSON({
      action: "list_users",
      group: GROUP,
      status,
      search: state.search,
      page: 1,
      limit: 1,
    });
    return computeSignatureFromListPayload(data);
  }

  function anyModalOpen() {
    const modalSelectors = [
      "#modalAddFaculty",
      "#modalEditFaculty",
      "#modalViewFaculty",
      "#modalImportCsv",
      "#modalSuccess",
      "#modalConfirmAction",
    ];

    return modalSelectors.some((selector) => {
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
      const [sigA, sigI, sigR] = await Promise.all([
        fetchSignature("Active"),
        fetchSignature("Inactive"),
        fetchSignature("Archived"),
      ]);

      const changed =
        sigA !== state.Active.signature ||
        sigI !== state.Inactive.signature ||
        sigR !== state.Archived.signature;

      if (changed) {
        await refresh();

        state.Active.signature = sigA;
        state.Inactive.signature = sigI;
        state.Archived.signature = sigR;

        if (document.visibilityState === "visible") {
          console.log("Faculty Admins table updated");
        }
      }
    } catch (e) {
      console.warn("[faculty-admin] Poll failed:", e?.message || e);
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

  function setupVisibilityHandlers() {
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") {
        pollForChanges();
        if (!state.polling.timer) startPolling();
      } else {
        stopPolling();
      }
    });
  }

  // -------------------------
  // Selection helpers
  // -------------------------
  function ensureHeaderCheckbox(status) {
    const cfg = UI[status];
    const tbody = S.qs(cfg.tbody);
    if (!tbody) return;

    const table = tbody.closest("table");
    const headRow = table?.querySelector("thead tr");
    if (!headRow) return;

    const firstTh = headRow.querySelector("th");
    if (firstTh && firstTh.classList.contains("chk-col")) return;

    const th = document.createElement("th");
    th.className = "chk-col";
    th.innerHTML =
      `<input type="checkbox" class="form-check-input header-checkbox mu-header-check" aria-label="Select all" />`;
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
      td.innerHTML = `<input class="form-check-input mu-row-check" type="checkbox" data-id="${S.escapeHtml(
        id
      )}" aria-label="Select row" />`;
      tr.insertBefore(td, tr.firstChild);

      td.querySelector("input")?.addEventListener("change", () => syncBulkBar(status));
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
    const header = tbody.closest("table")?.querySelector("input.mu-header-check");
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
    bar.classList.toggle("d-none", ids.length === 0);
  }

  // -------------------------
  // Data fetch
  // -------------------------
  // Update fetchList to use status-specific search
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
    const statuses = ["Active", "Inactive", "Archived"];
    
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
            console.log(`[Faculty] Searching ${status}:`, state.search[status]);
          }, 300);
        });
      }
    });
  }

  // -------------------------
  // Render helpers
  // -------------------------
  function fullName(r) {
    const parts = [r.first_name, r.middle_name, r.last_name].filter(Boolean);
    const name = parts.join(" ");
    return (name + (r.suffix ? ` ${r.suffix}` : "")).trim();
  }

  function fmtDate(s) {
    const str = String(s || "").trim();
    if (!str) return "—";
    return str.replace("T", " ").replace("Z", "");
  }

  function getColspan(status, fallback = 7) {
    const cfg = UI[status];
    const tbody = S.qs(cfg.tbody);
    const ths = tbody?.closest("table")?.querySelectorAll("thead th");
    const n = ths ? ths.length : 0;
    return n > 0 ? n : fallback;
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

  function roleLabel(r) {
    const raw = String(r?.role || r?.user_role || "").trim();
    if (raw === "faculty_admin") return "Faculty Admin";
    if (raw === "moderator") return "Moderator";
    return raw || "Faculty Admins";
  }

  function actionsHtml(status, id) {
    const sid = S.escapeHtml(id);

    const moreMenu = `
      <div class="dropdown d-inline-block">
        <button class="btn btn-outline-secondary btn-sm" type="button" data-bs-toggle="dropdown" aria-expanded="false" title="More">
          <i class="bi bi-three-dots-vertical"></i>
        </button>
        <ul class="dropdown-menu dropdown-menu-end">
          <li>
            <a class="dropdown-item mu-faculty-view-one" href="#" data-id="${sid}">
              <i class="bi bi-eye me-2"></i>View
            </a>
          </li>
          <li>
            <a class="dropdown-item mu-faculty-edit-one" href="#" data-id="${sid}">
              <i class="bi bi-pencil-square me-2"></i>Edit
            </a>
          </li>
          <li><hr class="dropdown-divider"></li>
          <li>
            <a class="dropdown-item mu-faculty-reset-one" href="#" data-id="${sid}">
              <i class="bi bi-key me-2"></i>Reset Password
            </a>
          </li>
        </ul>
      </div>
    `;

    if (status === "Active") {
      return `
        <div class="d-flex justify-content-end gap-1 flex-wrap">
          <button class="btn btn-outline-secondary btn-sm mu-set-status" data-id="${sid}" data-next="Inactive" type="button" title="Set Inactive">
            <i class="bi bi-dash-circle"></i>
          </button>
          <button class="btn btn-outline-warning btn-sm mu-set-status" data-id="${sid}" data-next="Archived" type="button" title="Archive">
            <i class="bi bi-archive"></i>
          </button>
          ${moreMenu}
        </div>
      `;
    }

    if (status === "Inactive") {
      return `
        <div class="d-flex justify-content-end gap-1 flex-wrap">
          <button class="btn btn-success btn-sm mu-set-status" data-id="${sid}" data-next="Active" type="button" title="Activate">
            <i class="bi bi-check-circle"></i>
          </button>
          <button class="btn btn-outline-warning btn-sm mu-set-status" data-id="${sid}" data-next="Archived" type="button" title="Archive">
            <i class="bi bi-archive"></i>
          </button>
          ${moreMenu}
        </div>
      `;
    }

    return `
      <div class="d-flex justify-content-end gap-1 flex-wrap">
        <button class="btn btn-outline-success btn-sm mu-set-status" data-id="${sid}" data-next="Active" type="button" title="Restore">
          <i class="bi bi-arrow-counterclockwise"></i>
        </button>
        ${moreMenu}
      </div>
    `;
  }

  function renderRows(status) {
    const cfg = UI[status];
    const tbody = S.qs(cfg.tbody);
    if (!tbody) return;

    ensureHeaderCheckbox(status);

    const rows = state[status].rows;

    if (!rows.length) {
      tbody.innerHTML = renderEmptyRow(getColspan(status, 8), EMPTY_MSG[status] || "No records found.");
      return;
    }

    tbody.innerHTML = rows
      .map((r) => {
        const id = S.escapeHtml(r.id);
        const idNo = S.escapeHtml(r.id_number || "");
        const name = S.escapeHtml(fullName(r));
        const program = S.escapeHtml(r.program || "—"); // NEW: Program column
        const role = S.escapeHtml(roleLabel(r));
        const st = S.escapeHtml(r.status || "");
        const created = S.escapeHtml(fmtDate(r.created_at || ""));

        return `
          <tr data-id="${id}">
            <td>${idNo}</td>
            <td>${name}</td>
            <td>${program}</td> <!-- NEW: Program column -->
            <td>${role}</td>
            <td><span class="badge bg-light text-dark border">${st}</span></td>
            <td class="text-muted small">${created}</td>
            <td class="text-end">${actionsHtml(status, r.id)}</td>
          </tr>
        `;
      })
      .join("");

    injectRowCheckboxes(status);
    syncBulkBar(status);
  }

  function renderMeta(status) {
    const cfg = UI[status];
    const meta = S.qs(cfg.meta);
    if (!meta) return;

    const st = state[status];
    const total = st.total;
    const page = st.page;
    const limit = state.limit;
    const from = total === 0 ? 0 : (page - 1) * limit + 1;
    const to = Math.min(total, page * limit);

    meta.textContent = `Showing ${from}–${to} of ${total}`;
  }

  function renderPagination(status) {
    const cfg = UI[status];
    const ul = S.qs(cfg.pag);
    if (!ul) return;

    const st = state[status];
    const totalPages = Math.max(1, Math.ceil(st.total / state.limit));
    const page = Math.min(st.page, totalPages);

    const mk = (label, p, disabled = false, active = false) => `
      <li class="page-item ${disabled ? "disabled" : ""} ${active ? "active" : ""}">
        <a class="page-link" href="#" data-page="${p}">${label}</a>
      </li>
    `;

    let html = "";
    html += mk("Prev", "prev", page <= 1);
    const start = Math.max(1, page - 2);
    const end = Math.min(totalPages, page + 2);
    for (let p = start; p <= end; p++) html += mk(String(p), String(p), false, p === page);
    html += mk("Next", "next", page >= totalPages);

    ul.innerHTML = html;
  }

  async function refreshStatus(status) {
    const sig = await fetchList(status);
    renderRows(status);
    renderMeta(status);
    renderPagination(status);
    state[status].signature = sig;
  }

  async function refresh() {
    await Promise.all(STATUSES.map((st) => refreshStatus(st)));
    // Reinitialize event listeners after data refresh
    setTimeout(() => reinitializeEventListeners(), 100);
  }

  // -------------------------
  // Program dropdown helpers
  // -------------------------
  function populateStaffProgramDropdown(selectId, selectedValue = "") {
    const sel = S.qs(selectId);
    if (!sel) return;
    
    // Clear existing options except first one
    while (sel.options.length > 1) sel.remove(1);
    
    // Get programs from meta
    const meta = S.getMeta ? S.getMeta() : {};
    const programs = Array.isArray(meta.programs) ? meta.programs : [];
    
    // Add "None" option
    const noneOption = document.createElement("option");
    noneOption.value = "";
    noneOption.textContent = "General";
    sel.appendChild(noneOption);
    
    // Add active programs
    for (const prog of programs) {
      if (prog.status !== "Active") continue;
      
      const option = document.createElement("option");
      option.value = prog.abbreviation || prog.program_name || "";
      option.textContent = prog.abbreviation ? `${prog.abbreviation} — ${prog.program_name}` : prog.program_name;
      sel.appendChild(option);
    }
    
    // Set selected value
    if (selectedValue) {
      sel.value = selectedValue;
    }
  }

  // -------------------------
  // CSV export helpers
  // -------------------------
  function mapStaffRowForCsv(r) {
    return {
      id_number: r.id_number || "",
      first_name: r.first_name || "",
      middle_name: r.middle_name || "",
      last_name: r.last_name || "",
      suffix: r.suffix || "",
      email: r.email || "",
      program: r.program || "", // NEW: Added program
      role: r.role || "",
      status: r.status || "",
      created_at: r.created_at || "",
    };
  }

  const CSV_HEADERS = ["id_number", "first_name", "middle_name", "last_name", "suffix", "email", "program", "role", "status", "created_at"]; // UPDATED

  function exportRowsToCsv(filename, rows) {
    const csv = S.toCSV(rows, CSV_HEADERS);
    S.downloadText(filename, csv);
  }

  function exportSelected(status) {
    const ids = getSelectedIds(status);
    if (!ids.length) return;

    const rows = state[status].rows.filter((r) => ids.includes(Number(r.id))).map(mapStaffRowForCsv);
    exportRowsToCsv(`faculty_${status.toLowerCase()}_selected.csv`, rows);
  }

  async function exportAllStatus(status) {
    const rows = [];
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
      rows.push(...pageRows.map(mapStaffRowForCsv));

      const total = Number(data.total || 0);
      const totalPages = total ? Math.ceil(total / limit) : 1;
      if (page >= totalPages) break;
      page++;
    }

    exportRowsToCsv(`faculty_${status.toLowerCase()}.csv`, rows);
  }

  async function exportAllGroups() {
    const rows = [];
    const statuses = ["Active", "Inactive", "Archived"];

    for (const st of statuses) {
      const limit = 200;
      let page = 1;

      while (true) {
        const data = await S.postJSON({
          action: "list_users",
          group: GROUP,
          status: st,
          search: state.search,
          page,
          limit,
        });

        const pageRows = Array.isArray(data.rows) ? data.rows : [];
        rows.push(...pageRows.map(mapStaffRowForCsv));

        const total = Number(data.total || 0);
        const totalPages = total ? Math.ceil(total / limit) : 1;
        if (page >= totalPages) break;
        page++;
      }
    }

    exportRowsToCsv(`faculty_all.csv`, rows);
  }

  // -------------------------
  // Staff modals: Add / Edit / View
  // -------------------------
  function setAddStaffTargetRole(defaultRole) {
    const hidden = S.qs("#faculty_add_target_role");
    const sel = S.qs("#faculty_role");
    if (hidden) hidden.value = defaultRole;
    if (sel) sel.value = defaultRole;
  }

  function resetAddStaffForm(defaultRole) {
    const form = S.qs("#formAddFaculty");
    if (form) form.reset();
    setAddStaffTargetRole(defaultRole);

    const statusSel = S.qs("#faculty_status");
    if (statusSel && !statusSel.value) statusSel.value = "Active";
    
    // Populate program dropdown
    populateStaffProgramDropdown("#faculty_program");
  }

  function inferDefaultRoleFromActiveTab() {
    const facultyTab = document.querySelector("#tab-faculty");
    const moderatorsTab = document.querySelector("#tab-moderators");

    const facultyActive = facultyTab?.classList.contains("active");
    const moderatorsActive = moderatorsTab?.classList.contains("active");

    if (moderatorsActive) return "moderator";
    if (facultyActive) return "faculty_admin";
    return "faculty_admin";
  }

  function bindAddStaffOpen() {
    const btn = S.qs(common.btnAdd);
    if (!btn) return;

    btn.addEventListener("click", () => {
      const role = "faculty_admin";
      resetAddStaffForm(role);
    });

    const modalEl = S.qs("#modalAddFaculty");
    if (modalEl) {
      modalEl.addEventListener("shown.bs.modal", () => {
        const role = "faculty_admin";
        setAddStaffTargetRole(role);
        // Populate program dropdown when modal shown
        populateStaffProgramDropdown("#faculty_program");
      });
    }
  }

  function bindCreateStaff() {
    const form = S.qs("#formAddFaculty");
    if (!form) return;

    form.addEventListener("submit", async (e) => {
      e.preventDefault();

      const role = "faculty_admin";

      const payload = {
        action: "create_staff",
        role,
        id_number: String(S.qs("#faculty_id_number")?.value || "").trim(),
        email: String(S.qs("#faculty_email")?.value || "").trim(),
        first_name: String(S.qs("#faculty_first_name")?.value || "").trim(),
        middle_name: String(S.qs("#faculty_middle_name")?.value || "").trim(),
        last_name: String(S.qs("#faculty_last_name")?.value || "").trim(),
        suffix: String(S.qs("#faculty_suffix")?.value || "").trim(),
        program: String(S.qs("#faculty_program")?.value || "").trim(), // NEW
        status: String(S.qs("#faculty_status")?.value || "Active").trim(),
      };

      try {
        const res = await S.postJSON(payload);

        S.hideModal("modalAddFaculty");

        await refresh(); // easiest: refresh all status lists

        if (typeof S.showSuccessModal === "function") {
          S.showSuccessModal({
            title: "Staff Created",
            message: res?.temp_password
              ? `Created successfully. Temporary password: ${res.temp_password}`
              : "Created successfully.",
            icon: "check-circle-fill",
          });
        } else {
          S.safeShowSuccess("Staff created successfully.");
        }

        form.reset();
        // Reset program dropdown
        populateStaffProgramDropdown("#faculty_program");
      } catch (err) {
        S.safeShowError(err?.message || "Failed to create staff.");
      }
    });
  }

  function bindSaveStaffButton() {
    const btn = S.qs("#btnSaveFaculty");
    if (!btn) return;

    btn.addEventListener("click", (e) => {
      e.preventDefault();
      const form = S.qs("#formAddFaculty");
      if (form) {
        // Trigger form submission
        form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      }
    });
  }

  async function loadUser(id) {
    return await S.postJSON({ action: "get_user", id });
  }

  function fillViewStaff(data) {
    const u = data?.user || data?.row || data?.data || (Array.isArray(data?.rows) ? data.rows[0] : null) || data;

    const set = (sel, val) => {
      const el = document.querySelector(sel);
      if (!el) {
        console.warn("[fillViewStaff] Missing element:", sel);
        return;
      }
      const out = String(val ?? "").trim();
      el.textContent = out !== "" ? out : "—";
    };

    set("#viewFacultyIdNo", u?.id_number);
    set("#viewFacultyEmail", u?.email);
    set("#viewFacultyStatus", u?.status);
    set("#viewFacultyFirstName", u?.first_name);
    set("#viewFacultyMiddleName", u?.middle_name);
    set("#viewFacultyLastName", u?.last_name);
    set("#viewFacultySuffix", u?.suffix);
    set("#viewFacultyProgram", u?.program || "—"); // NEW
    set("#viewFacultyRole", roleLabel(u));
    set("#viewFacultyCreated", fmtDate(u?.created_at));
    set("#viewFacultyLastLogin", fmtDate(u?.last_login_at));
  }

  function fillEditStaff(data) {
    const u = data?.user || data;

    const setVal = (id, val) => {
      const el = S.qs(id);
      if (!el) return;
      el.value = val ?? "";
    };

    setVal("#faculty_edit_user_id", u?.id || "");
    setVal("#faculty_edit_id_number", u?.id_number || "");
    setVal("#faculty_edit_email", u?.email || "");
    setVal("#faculty_edit_first_name", u?.first_name || "");
    setVal("#faculty_edit_middle_name", u?.middle_name || "");
    setVal("#faculty_edit_last_name", u?.last_name || "");
    setVal("#faculty_edit_suffix", u?.suffix || "");
    setVal("#faculty_edit_program", u?.program || ""); // NEW
    setVal("#faculty_edit_role", u?.role || inferDefaultRoleFromActiveTab());
    setVal("#faculty_edit_status", u?.status || "Active");
    setVal("#faculty_edit_created_at", u?.created_at || "");
    
    // Populate program dropdown with user's program selected
    setTimeout(() => {
      populateStaffProgramDropdown("#faculty_edit_program", u?.program || "");
    }, 50);
  }

  function bindEditStaffSubmit() {
    const form = S.qs("#formEditFaculty");
    if (!form) return;

    form.addEventListener("submit", async (e) => {
      e.preventDefault();

      const payload = {
        action: "update_staff",
        id: Number(S.qs("#faculty_edit_user_id")?.value || 0),
        role: String(S.qs("#faculty_edit_role")?.value || "").trim(),
        id_number: String(S.qs("#faculty_edit_id_number")?.value || "").trim(),
        email: String(S.qs("#faculty_edit_email")?.value || "").trim(),
        first_name: String(S.qs("#faculty_edit_first_name")?.value || "").trim(),
        middle_name: String(S.qs("#faculty_edit_middle_name")?.value || "").trim(),
        last_name: String(S.qs("#faculty_edit_last_name")?.value || "").trim(),
        suffix: String(S.qs("#faculty_edit_suffix")?.value || "").trim(),
        program: String(S.qs("#faculty_edit_program")?.value || "").trim(), // NEW
        status: String(S.qs("#faculty_edit_status")?.value || "Active").trim(),
      };

      try {
        await S.postJSON(payload);
        S.hideModal("modalEditFaculty");
        await refresh();

        if (typeof S.showSuccessModal === "function") {
          S.showSuccessModal({
            title: "Updated",
            message: "Staff updated successfully.",
            icon: "check-circle-fill",
          });
        } else {
          S.safeShowSuccess("Staff updated successfully.");
        }
      } catch (err) {
        S.safeShowError(err?.message || "Failed to update staff.");
      }
    });

    // Bind the update button click
    const updateBtn = S.qs("#btnUpdateFaculty");
    if (updateBtn) {
      updateBtn.addEventListener("click", (e) => {
        e.preventDefault();
        const submitEvent = new Event("submit", { bubbles: true, cancelable: true });
        form.dispatchEvent(submitEvent);
      });
    }
  }

  // -------------------------
  // Row actions (delegate)
  // -------------------------
  function bindRowActions() {
    if (actionsBound) return;
    actionsBound = true;

    document.addEventListener("click", async (e) => {
      const a = e.target.closest(".mu-faculty-view-one, .mu-faculty-edit-one, .mu-faculty-reset-one");
      const btn = e.target.closest("button.mu-set-status");
      if (!a && !btn) return;

      if (a) {
        e.preventDefault();
        const id = parseInt(a.getAttribute("data-id") || "0", 10);
        if (!id) return;

        try {
          if (a.classList.contains("mu-faculty-view-one")) {
            const data = await loadUser(id);
            fillViewStaff(data);
            S.showModal("modalViewFaculty");
          } else if (a.classList.contains("mu-faculty-edit-one")) {
            const data = await loadUser(id);
            fillEditStaff(data);
            S.showModal("modalEditFaculty");
          } else if (a.classList.contains("mu-faculty-reset-one")) {
            const doIt = async () => {
              await S.postJSON({ action: "reset_password", id });
              S.safeShowSuccess("Password reset to the user's ID Number.");
            };

            if (typeof S.showConfirmModal === "function") {
              S.showConfirmModal({
                title: "Reset Password",
                subtitle: "This will reset the password",
                message: "Reset this user's password to their ID Number?",
                type: "warning",
                btnText: "Reset",
                btnClass: "warning",
                btnIcon: "key",
                onConfirm: doIt,
              });
            } else {
              await doIt();
            }
          }
        } catch (err) {
          S.safeShowError(err?.message || "Action failed.");
        }
        return;
      }

      if (btn) {
        e.preventDefault();
        const id = parseInt(btn.getAttribute("data-id") || "0", 10);
        const next = String(btn.getAttribute("data-next") || "").trim();
        if (!id || !next) return;

        const doIt = async () => {
          await S.postJSON({ action: "set_status", group: GROUP, id, status: next });
          await refresh();
          S.safeShowSuccess("Status updated.");
        };

        if (typeof S.showConfirmModal === "function") {
          const title = next === "Archived" ? "Archive User" : next === "Active" ? "Set Active" : "Set Inactive";
          S.showConfirmModal({
            title,
            subtitle: "Confirm status change",
            message: `Change status to "${next}"?`,
            type: next === "Archived" ? "archive" : next === "Active" ? "restore" : "info",
            btnText: "Confirm",
            btnClass: next === "Archived" ? "warning" : "primary",
            btnIcon: next === "Archived" ? "archive" : "check-circle",
            onConfirm: doIt,
          });
        } else {
          await doIt();
        }
      }
    });
  }

  // -------------------------
  // Bulk actions
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

    // Archive button (for Active, Inactive tabs)
    if (cfg.btnArchive) {
      const btn = S.qs(cfg.btnArchive);
      if (btn) {
        const newBtn = btn.cloneNode(true);
        btn.parentNode.replaceChild(newBtn, btn);
        newBtn.addEventListener("click", async (e) => {
          e.preventDefault();
          const ids = getSelectedIds(status);
          if (!ids.length) return;

          const doIt = async () => {
            await S.postJSON({ action: "bulk_set_status", group: GROUP, status: "Archived", ids });
            clearSelection(status);
            await refresh();
            S.safeShowSuccess(`Archived ${ids.length} user(s).`);
          };

          if (typeof S.showConfirmModal === "function") {
            S.showConfirmModal({
              title: "Archive Selected",
              subtitle: "Move selected users to Archived",
              message: `Archive ${ids.length} selected user(s)?`,
              type: "archive",
              btnText: "Archive",
              btnClass: "warning",
              btnIcon: "archive",
              onConfirm: doIt,
            });
          } else {
            await doIt();
          }
        });
      }
    }

    // Restore button (for Archived tab)
    if (cfg.btnRestore) {
      const btn = S.qs(cfg.btnRestore);
      if (btn) {
        const newBtn = btn.cloneNode(true);
        btn.parentNode.replaceChild(newBtn, btn);
        newBtn.addEventListener("click", async (e) => {
          e.preventDefault();
          const ids = getSelectedIds(status);
          if (!ids.length) return;

          const doIt = async () => {
            await S.postJSON({ action: "bulk_set_status", group: GROUP, status: "Active", ids });
            clearSelection(status);
            await refresh();
            S.safeShowSuccess(`Restored ${ids.length} user(s).`);
          };

          if (typeof S.showConfirmModal === "function") {
            S.showConfirmModal({
              title: "Restore Selected",
              subtitle: "Move selected users back to Active",
              message: `Restore ${ids.length} selected user(s) to Active?`,
              type: "restore",
              btnText: "Restore",
              btnClass: "success",
              btnIcon: "arrow-counterclockwise",
              onConfirm: doIt,
            });
          } else {
            await doIt();
          }
        });
      }
    }

    // Activate button for Inactive tab (Faculty/Coordinators)
    if (status === "Inactive") {
      const btnActivate = S.qs("#facultyInactiveActivateSelectedBtn");
      if (btnActivate) {
        const newBtn = btnActivate.cloneNode(true);
        btnActivate.parentNode.replaceChild(newBtn, btnActivate);
        newBtn.addEventListener("click", async (e) => {
          e.preventDefault();
          const ids = getSelectedIds(status);
          if (!ids.length) return;

          const doIt = async () => {
            await S.postJSON({ action: "bulk_set_status", group: GROUP, status: "Active", ids });
            clearSelection(status);
            await refresh();
            S.safeShowSuccess(`Activated ${ids.length} user(s).`);
          };

          if (typeof S.showConfirmModal === "function") {
            S.showConfirmModal({
              title: "Activate Selected",
              subtitle: "Move selected users to Active",
              message: `Activate ${ids.length} selected user(s)?`,
              type: "success",
              btnText: "Activate",
              btnClass: "success",
              btnIcon: "check-circle",
              onConfirm: doIt,
            });
          } else {
            await doIt();
          }
        });
      }
    }

    // Activate button for Archived tab (Students, Faculty, Presidents)
    if (status === "Archived") {
      // Try different possible IDs for the activate button in archived tab
      const possibleIds = [
        "#studentsArchivedActivateSelectedBtn",
        "#facultyArchivedActivateSelectedBtn", 
        "#presidentsArchivedActivateSelectedBtn"
      ];
      
      for (const id of possibleIds) {
        const btnActivate = S.qs(id);
        if (btnActivate) {
          const newBtn = btnActivate.cloneNode(true);
          btnActivate.parentNode.replaceChild(newBtn, btnActivate);
          newBtn.addEventListener("click", async (e) => {
            e.preventDefault();
            const ids = getSelectedIds(status);
            if (!ids.length) return;

            const doIt = async () => {
              await S.postJSON({ action: "bulk_set_status", group: GROUP, status: "Active", ids });
              clearSelection(status);
              await refresh();
              S.safeShowSuccess(`Activated ${ids.length} user(s).`);
            };

            if (typeof S.showConfirmModal === "function") {
              S.showConfirmModal({
                title: "Activate Selected",
                subtitle: "Move selected archived users to Active",
                message: `Activate ${ids.length} selected user(s)?`,
                type: "success",
                btnText: "Activate",
                btnClass: "success",
                btnIcon: "check-circle",
                onConfirm: doIt,
              });
            } else {
              await doIt();
            }
          });
          break; // Only bind the first one found
        }
      }
    }
  }

  // -------------------------
  // Search / Page size / Pagination
  // -------------------------
  function bindSearchAndPageSize() {
    const searchEl = S.qs(common.search);
    const limitEl = S.qs(common.pageSize);

    if (searchEl) {
      let t = null;
      searchEl.addEventListener("input", () => {
        clearTimeout(t);
        t = setTimeout(() => {
          state.search = String(searchEl.value || "").trim();
          for (const st of STATUSES) state[st].page = 1;
          refresh();
        }, 250);
      });
    }

    if (limitEl) {
      limitEl.addEventListener("change", () => {
        const n = parseInt(limitEl.value || "10", 10);
        state.limit = Number.isFinite(n) && n > 0 ? n : 10;
        for (const st of STATUSES) state[st].page = 1;
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

      const st = state[status];
      const totalPages = Math.max(1, Math.ceil(st.total / state.limit));
      const cur = st.page;

      const p = String(a.getAttribute("data-page") || "");
      if (p === "prev") st.page = Math.max(1, cur - 1);
      else if (p === "next") st.page = Math.min(totalPages, cur + 1);
      else {
        const n = parseInt(p, 10);
        if (Number.isFinite(n) && n >= 1 && n <= totalPages) st.page = n;
      }

      refreshStatus(status);
    });
  }

  // -------------------------
  // Export dropdown buttons
  // -------------------------
  function bindExportButtons() {
    S.qs(common.exportActiveCsv)?.addEventListener("click", () => exportAllStatus("Active"));
    S.qs(common.exportInactiveCsv)?.addEventListener("click", () => exportAllStatus("Inactive"));
    S.qs(common.exportArchivedCsv)?.addEventListener("click", () => exportAllStatus("Archived"));
    S.qs(common.exportAllCsv)?.addEventListener("click", () => exportAllGroups());
  }

  function bindImportButton() {
    const btn = S.qs(common.btnImport);
    if (!btn) return;
    btn.addEventListener("click", () => {
      const role = "faculty_admin";
      setAddStaffTargetRole(role);
      // Also populate program dropdown for import modal
      populateStaffProgramDropdown("#faculty_program");
    });
  }

  // -------------------------
  // Init
  // -------------------------
  function init(shared) {
    S = shared;

    enableDropdownPortal();
    setupVisibilityHandlers();

    bindSearch(); // Replace bindSearchAndPageSize with this

    for (const st of STATUSES) {
      bindPagination(st);
      bindBulkBar(st);
      syncBulkBar(st);
    }

    bindExportButtons();
    bindImportButton();
    bindSaveStaffButton();

    bindAddStaffOpen();
    bindCreateStaff();
    bindEditStaffSubmit();

    bindRowActions();

    startPolling();
  }
  window.UsersFacultyAdmin = {
    init,
    refresh,
    refreshStatus,
    startPolling,
    stopPolling,
  };
})();