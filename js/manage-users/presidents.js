/* js/manage-users/presidents.js */
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
      const dd = e.target;
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

  const GROUP = "presidents";
  const STATUSES = ["Active", "Inactive", "Archived"];
  const EMPTY_MSG = {
    "Active": "No active presidents found.",
    "Inactive": "No inactive presidents found.",
    "Archived": "No archived presidents found."
  };

  const UI = {
    Active: {
      tbody: "#presidentsActiveTbody",
      meta: "#presidentsActiveMeta",
      pag: "#presidentsActivePagination",
      bulkBar: "#presidentsActiveBulkBar",
      selCount: "#presidentsActiveSelectedCount",
      btnSelectAll: "#presidentsActiveSelectAllBtn",
      btnClear: "#presidentsActiveClearSelectionBtn",
      btnExport: "#presidentsActiveExportSelectedBtn",
      btnArchive: "#presidentsActiveArchiveSelectedBtn",
      btnDemote: "#presidentsActiveDemoteSelectedBtn",
    },
    Inactive: {
      tbody: "#presidentsInactiveTbody",
      meta: "#presidentsInactiveMeta",
      pag: "#presidentsInactivePagination",
      bulkBar: "#presidentsInactiveBulkBar",
      selCount: "#presidentsInactiveSelectedCount",
      btnSelectAll: "#presidentsInactiveSelectAllBtn",
      btnClear: "#presidentsInactiveClearSelectionBtn",
      btnExport: "#presidentsInactiveExportSelectedBtn",
      btnActivate: "#presidentsInactiveActivateSelectedBtn",
      btnArchive: "#presidentsInactiveArchiveSelectedBtn",
      btnDemote: "#presidentsInactiveDemoteSelectedBtn",
    },
    Archived: {
      tbody: "#presidentsArchivedTbody",
      meta: "#presidentsArchivedMeta",
      pag: "#presidentsArchivedPagination",
      bulkBar: "#presidentsArchivedBulkBar",
      selCount: "#presidentsArchivedSelectedCount",
      btnSelectAll: "#presidentsArchivedSelectAllBtn",
      btnClear: "#presidentsArchivedClearSelectionBtn",
      btnExport: "#presidentsArchivedExportSelectedBtn",
      btnActivate: "#presidentsArchivedActivateSelectedBtn",
      btnRestore: "#presidentsArchivedRestoreSelectedBtn",
      btnDemote: "#presidentsArchivedDemoteSelectedBtn",
    },
  };

  const common = {
    searchActive: "#presidentsActiveSearch",
    searchInactive: "#presidentsInactiveSearch",
    searchArchived: "#presidentsArchivedSearch",
    pageSize: "#presidentsPageSize",
    btnAdd: "#btnAddPresidentTab",
    btnImport: "#btnImportPresidentsCsv",
    exportActiveCsv: "#exportPresidentsActiveCsv",
    exportInactiveCsv: "#exportPresidentsInactiveCsv",
    exportArchivedCsv: "#exportPresidentsArchivedCsv",
    exportAllCsv: "#exportPresidentsAllCsv",
  };

  const state = {
    search: "",
    limit: 10,
    Active: { page: 1, total: 0, rows: [], signature: "" },
    Inactive: { page: 1, total: 0, rows: [], signature: "" },
    Archived: { page: 1, total: 0, rows: [], signature: "" },

    polling: {
      timer: null,
      everyMs: 6000,
      paused: false,
      running: false,
    },
    searchDebounceTimers: {
      Active: null,
      Inactive: null,
      Archived: null
    }
  };

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
      "#modalAddPresident",
      "#modalViewStudent",
      "#modalEditStudent",
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
          console.log("Presidents table updated");
        }
      }
    } catch (e) {
      console.warn("[presidents] Poll failed:", e?.message || e);
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

  function populateProgramDropdown(selectId, selectedValue = "") {
    const sel = S.qs(selectId);
    if (!sel) return;

    // Clear existing options except first one
    while (sel.options.length > 1) sel.remove(1);

    const programs = getProgramsFromMeta()
      .map(normalizeProgramRow)
      .filter((p) => p.programName && p.status === "Active");

    for (const p of programs) {
      const option = document.createElement("option");
      option.value = p.abbr || p.programName;
      option.textContent = p.abbr ? `${p.abbr} — ${p.programName}` : p.programName;
      sel.appendChild(option);
    }

    if (selectedValue) {
      sel.value = selectedValue;
    }
  }

  function setActiveSchoolYear(inputId) {
    const meta = S.getMeta ? S.getMeta() : {};
    const term = meta.active_term || null;
    const schoolYearInput = S.qs(inputId);

    if (!schoolYearInput) return;

    const sy = String(term?.school_year ?? "").trim();
    if (!sy) return;

    const cur = String(schoolYearInput.value ?? "").trim();
    if (cur === "") schoolYearInput.value = sy;
  }

  // -------------------------
  // Add President Modal
  // -------------------------
  function bindAddPresidentModal() {
    const modalEl = S.qs("#modalAddPresident");
    if (!modalEl) return;

    const form = S.qs("#formAddPresident", modalEl);
    const btnSave = S.qs("#btnSavePresident", modalEl);
    const errorBox = S.qs("#addPresidentError", modalEl);
    const successBox = S.qs("#addPresidentSuccess", modalEl);
    const schoolYearInput = S.qs("#president_school_year", modalEl);
    const programSelect = S.qs("#president_program", modalEl);
    const yearLevelSelect = S.qs("#president_year_level", modalEl);

    const setAlert = (el, msg, isShow) => {
      if (!el) return;
      el.textContent = msg || "";
      if (isShow) el.classList.remove("d-none");
      else el.classList.add("d-none");
    };

    const setBtnLoading = (isLoading) => {
      if (!btnSave) return;
      btnSave.disabled = !!isLoading;
      const t = btnSave.querySelector(".btnsave-president-text");
      const l = btnSave.querySelector(".btnsave-president-loading");
      if (t) t.classList.toggle("d-none", !!isLoading);
      if (l) l.classList.toggle("d-none", !isLoading);
    };

    function populateYearLevelDropdown() {
      if (!yearLevelSelect) return;
      
      const yearLevels = [
        "1st Year", "2nd Year", "3rd Year", "4th Year", "5th Year", "Irregular"
      ];
      
      while (yearLevelSelect.options.length > 1) yearLevelSelect.remove(1);
      
      for (const level of yearLevels) {
        const option = document.createElement("option");
        option.value = level;
        option.textContent = level;
        yearLevelSelect.appendChild(option);
      }
    }

    modalEl.addEventListener("shown.bs.modal", () => {
      setAlert(errorBox, "", false);
      setAlert(successBox, "", false);

      form?.reset();

      const statusSelect = S.qs("#president_status", modalEl);
      if (statusSelect) statusSelect.value = "Active";

      populateProgramDropdown("#president_program");
      populateYearLevelDropdown();
      setActiveSchoolYear("#president_school_year");

      setTimeout(() => {
        populateProgramDropdown("#president_program");
        populateYearLevelDropdown();
        setActiveSchoolYear("#president_school_year");
      }, 50);
      
      state.polling.paused = true;
    });

    modalEl.addEventListener("hidden.bs.modal", () => {
      state.polling.paused = false;
    });

    btnSave?.addEventListener("click", async (e) => {
      e.preventDefault();
      setAlert(errorBox, "", false);
      setAlert(successBox, "", false);

      const idNumber = S.qs("#president_id_number", modalEl)?.value?.trim();
      const firstName = S.qs("#president_first_name", modalEl)?.value?.trim();
      const lastName = S.qs("#president_last_name", modalEl)?.value?.trim();

      if (!idNumber || !firstName || !lastName) {
        setAlert(errorBox, "Please fill in required fields: ID Number, First Name, and Last Name.", true);
        S.safeShowError("Please fill in required fields: ID Number, First Name, and Last Name.");
        return;
      }

      const payload = {
        action: "create_staff",
        role: "org_president",
        id_number: idNumber,
        first_name: firstName,
        middle_name: S.qs("#president_middle_name", modalEl)?.value?.trim() || "",
        last_name: lastName,
        suffix: S.qs("#president_suffix", modalEl)?.value?.trim() || "",
        email: S.qs("#president_email", modalEl)?.value?.trim() || "",
        program: programSelect?.value || "",
        year_level: yearLevelSelect?.value || "",
        school_year: schoolYearInput?.value?.trim() || "",
        status: S.qs("#president_status", modalEl)?.value || "Active",
      };

      setBtnLoading(true);

      try {
        const data = await S.postJSON(payload);

        setAlert(successBox, `President created successfully. Password set to ID Number.`, true);
        S.safeShowSuccess(`President ${firstName} ${lastName} created successfully.`);

        form?.reset();
        const statusSelect = S.qs("#president_status", modalEl);
        if (statusSelect) statusSelect.value = "Active";
        populateProgramDropdown("#president_program");
        populateYearLevelDropdown();
        setActiveSchoolYear("#president_school_year");

        await refresh();

        setTimeout(() => {
          const modalInstance = bootstrap.Modal.getInstance(modalEl);
          if (modalInstance) {
            modalInstance.hide();
          }
        }, 1500);
      } catch (err) {
        console.error("Error creating president:", err);
        const errorMessage = err?.message || "Failed to create president. Please check the details and try again.";
        setAlert(errorBox, errorMessage, true);
        S.safeShowError(errorMessage);
      } finally {
        setBtnLoading(false);
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

  function getSelectedPresidentInfo(status) {
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
  async function fetchList(status) {
    const st = state[status];
    const data = await S.postJSON({
      action: "list_users",
      group: GROUP,
      status,
      search: state.search,
      page: st.page,
      limit: state.limit,
    });

    st.rows = Array.isArray(data.rows) ? data.rows : [];
    st.total = Number(data.total || 0);

    return computeSignatureFromListPayload(data);
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

  function actionsHtml(status, id, presidentData) {
    const sid = S.escapeHtml(id);
    const presidentName = presidentData ? fullName(presidentData) : "President";

    const moreMenu = `
      <div class="dropdown d-inline-block">
        <button class="btn btn-outline-secondary btn-sm" type="button" data-bs-toggle="dropdown" aria-expanded="false" title="More">
          <i class="bi bi-three-dots-vertical"></i>
        </button>
        <ul class="dropdown-menu dropdown-menu-end">
          <li>
            <a class="dropdown-item mu-president-view-one" href="#" data-id="${sid}">
              <i class="bi bi-eye me-2"></i>View
            </a>
          </li>
          <li>
            <a class="dropdown-item mu-president-edit-one" href="#" data-id="${sid}">
              <i class="bi bi-pencil-square me-2"></i>Edit
            </a>
          </li>
          <li><hr class="dropdown-divider"></li>
          <li>
            <a class="dropdown-item mu-president-reset-one" href="#" data-id="${sid}" data-name="${S.escapeHtml(presidentName)}">
              <i class="bi bi-key me-2"></i>Reset Password
            </a>
          </li>
          <li>
            <a class="dropdown-item mu-president-demote-one" href="#" data-id="${sid}" data-name="${S.escapeHtml(presidentName)}">
              <i class="bi bi-arrow-down-circle me-2"></i>Demote to Student
            </a>
          </li>
        </ul>
      </div>
    `;

    if (status === "Active") {
      return `
        <div class="d-flex justify-content-end gap-1 flex-wrap">
          <button class="btn btn-outline-secondary btn-sm mu-set-status" data-id="${sid}" data-next="Inactive" data-name="${S.escapeHtml(presidentName)}" type="button" title="Set Inactive">
            <i class="bi bi-dash-circle"></i>
          </button>
          <button class="btn btn-outline-warning btn-sm mu-set-status" data-id="${sid}" data-next="Archived" data-name="${S.escapeHtml(presidentName)}" type="button" title="Archive">
            <i class="bi bi-archive"></i>
          </button>
          ${moreMenu}
        </div>
      `;
    }

    if (status === "Inactive") {
      return `
        <div class="d-flex justify-content-end gap-1 flex-wrap">
          <button class="btn btn-success btn-sm mu-set-status" data-id="${sid}" data-next="Active" data-name="${S.escapeHtml(presidentName)}" type="button" title="Activate">
            <i class="bi bi-check-circle"></i>
          </button>
          <button class="btn btn-outline-warning btn-sm mu-set-status" data-id="${sid}" data-next="Archived" data-name="${S.escapeHtml(presidentName)}" type="button" title="Archive">
            <i class="bi bi-archive"></i>
          </button>
          ${moreMenu}
        </div>
      `;
    }

    return `
      <div class="d-flex justify-content-end gap-1 flex-wrap">
        <button class="btn btn-outline-success btn-sm mu-set-status" data-id="${sid}" data-next="Active" data-name="${S.escapeHtml(presidentName)}" type="button" title="Restore">
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
      syncBulkBar(status);
      return;
    }

    tbody.innerHTML = rows
      .map((r) => {
        const id = S.escapeHtml(r.id);
        const idNo = S.escapeHtml(r.id_number || "");
        const name = S.escapeHtml(fullName(r));
        const prog = S.escapeHtml(r.program || "—");
        const ylvl = S.escapeHtml(r.year_level || "—");
        const sy = S.escapeHtml(r.school_year || "—");
        const st = S.escapeHtml(r.status || "");

        return `
          <tr data-id="${id}">
            <td>${idNo}</td>
            <td>${name}</td>
            <td>${prog}</td>
            <td>${ylvl}</td>
            <td>${sy}</td>
            <td><span class="badge bg-light text-dark border">${st}</span></td>
            <td class="text-end">${actionsHtml(status, r.id, r)}</td>
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
    state[status].signature = sig;
    renderRows(status);
    renderMeta(status);
    renderPagination(status);
  }

  async function refresh() {
    await Promise.all(STATUSES.map((st) => refreshStatus(st)));
    setTimeout(() => reinitializeEventListeners(), 100);
  }

  // -------------------------
  // Reinitialize event listeners
  // -------------------------
  function reinitializeEventListeners() {
    console.log('[Presidents] Reinitializing event listeners...');
    
    for (const st of STATUSES) {
      const cfg = UI[st];
      
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
      
      const btnClear = S.qs(cfg.btnClear);
      if (btnClear) {
        const newBtn = btnClear.cloneNode(true);
        btnClear.parentNode.replaceChild(newBtn, btnClear);
        newBtn.addEventListener("click", (e) => {
          e.preventDefault();
          clearSelection(st);
        });
      }
      
      const btnExport = S.qs(cfg.btnExport);
      if (btnExport) {
        const newBtn = btnExport.cloneNode(true);
        btnExport.parentNode.replaceChild(newBtn, btnExport);
        newBtn.addEventListener("click", (e) => {
          e.preventDefault();
          exportSelected(st);
        });
      }
      
      if (cfg.btnDemote) {
        const btn = S.qs(cfg.btnDemote);
        if (btn) {
          const newBtn = btn.cloneNode(true);
          btn.parentNode.replaceChild(newBtn, btn);
          newBtn.addEventListener("click", createDemoteHandler(st));
        }
      }
      
      if (cfg.btnArchive) {
        const btn = S.qs(cfg.btnArchive);
        if (btn) {
          const newBtn = btn.cloneNode(true);
          btn.parentNode.replaceChild(newBtn, btn);
          newBtn.addEventListener("click", createArchiveHandler(st));
        }
      }
      
      if (cfg.btnRestore) {
        const btn = S.qs(cfg.btnRestore);
        if (btn) {
          const newBtn = btn.cloneNode(true);
          btn.parentNode.replaceChild(newBtn, btn);
          newBtn.addEventListener("click", createRestoreHandler(st));
        }
      }
      
      if (cfg.btnActivate) {
        const btn = S.qs(cfg.btnActivate);
        if (btn) {
          const newBtn = btn.cloneNode(true);
          btn.parentNode.replaceChild(newBtn, btn);
          newBtn.addEventListener("click", createActivateHandler(st));
        }
      }
    }
  }

  // Handler factory functions
  function createDemoteHandler(status) {
    return async (e) => {
      e.preventDefault();
      const ids = getSelectedIds(status);
      const presidentInfo = getSelectedPresidentInfo(status);
      if (!ids.length) return;

      if (typeof S.showConfirmModal === 'function') {
        S.showConfirmModal({
          title: "Demote Selected Presidents",
          subtitle: "Change role from President to Student",
          message: `Demote ${ids.length} selected president(s) to regular students?`,
          type: "warning",
          btnText: "Demote All",
          btnClass: "warning",
          btnIcon: "arrow-down-circle",
          items: presidentInfo.slice(0, 5),
          onConfirm: async () => {
            try {
              const results = await bulkDemotePresidents(ids);
              const successCount = results.filter(r => r.success).length;
              S.safeShowSuccess(`Successfully demoted ${successCount} president(s).`);
              clearSelection(status);
              await refresh();
            } catch (err) {
              S.safeShowError(err?.message || "Failed to demote presidents.");
            }
          }
        });
      }
    };
  }

  function createArchiveHandler(status) {
    return async (e) => {
      e.preventDefault();
      const ids = getSelectedIds(status);
      const presidentInfo = getSelectedPresidentInfo(status);
      if (!ids.length) return;

      if (typeof S.showConfirmModal === 'function') {
        S.showConfirmModal({
          title: "Archive Selected Presidents",
          subtitle: "Move selected presidents to Archived",
          message: `Archive ${ids.length} selected president(s)?`,
          type: "archive",
          btnText: "Archive",
          btnClass: "warning",
          btnIcon: "archive",
          items: presidentInfo.slice(0, 5),
          onConfirm: async () => {
            try {
              await bulkSetStatus(status, ids, "Archived");
              S.safeShowSuccess(`Archived ${ids.length} president(s).`);
            } catch (err) {
              S.safeShowError(err?.message || "Failed to archive presidents.");
            }
          }
        });
      }
    };
  }

  function createRestoreHandler(status) {
    return async (e) => {
      e.preventDefault();
      const ids = getSelectedIds(status);
      const presidentInfo = getSelectedPresidentInfo(status);
      if (!ids.length) return;

      if (typeof S.showConfirmModal === 'function') {
        S.showConfirmModal({
          title: "Restore Selected Presidents",
          subtitle: "Move selected archived presidents back to Active",
          message: `Restore ${ids.length} selected president(s) to Active?`,
          type: "restore",
          btnText: "Restore",
          btnClass: "success",
          btnIcon: "arrow-counterclockwise",
          items: presidentInfo.slice(0, 5),
          onConfirm: async () => {
            try {
              await bulkSetStatus(status, ids, "Active");
              S.safeShowSuccess(`Restored ${ids.length} president(s).`);
            } catch (err) {
              S.safeShowError(err?.message || "Failed to restore presidents.");
            }
          }
        });
      }
    };
  }

  function createActivateHandler(status) {
    return async (e) => {
      e.preventDefault();
      const ids = getSelectedIds(status);
      const presidentInfo = getSelectedPresidentInfo(status);
      if (!ids.length) return;

      if (typeof S.showConfirmModal === 'function') {
        S.showConfirmModal({
          title: "Activate Selected Presidents",
          subtitle: "Move selected presidents to Active",
          message: `Activate ${ids.length} selected president(s)?`,
          type: "success",
          btnText: "Activate",
          btnClass: "success",
          btnIcon: "check-circle",
          items: presidentInfo.slice(0, 5),
          onConfirm: async () => {
            try {
              await bulkSetStatus(status, ids, "Active");
              S.safeShowSuccess(`Activated ${ids.length} president(s).`);
            } catch (err) {
              S.safeShowError(err?.message || "Failed to activate presidents.");
            }
          }
        });
      }
    };
  }

  // -------------------------
  // API Functions
  // -------------------------
  async function demotePresident(id) {
    const result = await S.postJSON({
      action: "update_user_role",
      id: id,
      role: "student",
    });
    
    await refresh();
    
    return result;
  }

  async function bulkDemotePresidents(ids) {
    const results = [];
    for (const id of ids) {
      try {
        await demotePresident(id);
        results.push({ id, success: true });
      } catch (err) {
        results.push({ id, success: false, error: err });
      }
    }
    return results;
  }

  async function bulkSetStatus(status, ids, newStatus) {
    const result = await S.postJSON({
      action: "bulk_set_status",
      group: GROUP,
      status: newStatus,
      ids,
    });
    
    clearSelection(status);
    
    await refreshStatus(status);
    await refreshStatus(newStatus);
    
    return result;
  }

  // -------------------------
  // Row actions (delegate)
  // -------------------------
  function bindRowActions() {
    if (actionsBound) return;
    actionsBound = true;

    document.addEventListener("click", async (e) => {
      const a = e.target.closest(".mu-president-view-one, .mu-president-edit-one, .mu-president-reset-one, .mu-president-demote-one");
      const btn = e.target.closest("button.mu-set-status");
      if (!a && !btn) return;

      if (a) {
        e.preventDefault();
        const id = parseInt(a.getAttribute("data-id") || "0", 10);
        if (!id) return;

        try {
          if (a.classList.contains("mu-president-view-one")) {
            const data = await S.postJSON({ action: "get_user", id });
            const user = data?.user || data;
            
            const set = (sel, val) => {
              const el = S.qs(sel);
              if (el) el.textContent = val || "—";
            };
            
            set("#viewStudentIdNo", user?.id_number);
            set("#viewStudentEmail", user?.email);
            set("#viewStudentFirstName", user?.first_name);
            set("#viewStudentMiddleName", user?.middle_name);
            set("#viewStudentLastName", user?.last_name);
            set("#viewStudentSuffix", user?.suffix);
            set("#viewStudentProgram", user?.program);
            set("#viewStudentYearLevel", user?.year_level);
            set("#viewStudentSchoolYear", user?.school_year);
            set("#viewStudentStatus", user?.status);
            set("#viewStudentRole", user?.role || "org_president");
            set("#viewStudentCreated", fmtDate(user?.created_at));
            set("#viewStudentLastLogin", fmtDate(user?.last_login_at));
            
            S.showModal("modalViewStudent");
          } else if (a.classList.contains("mu-president-edit-one")) {
            const data = await S.postJSON({ action: "get_user", id });
            const user = data?.user || data;
            
            const setVal = (sel, val) => {
              const el = S.qs(sel);
              if (el) el.value = val ?? "";
            };
            
            setVal("#edit_student_id", user?.id || "");
            setVal("#edit_student_id_number", user?.id_number || "");
            setVal("#edit_student_first_name", user?.first_name || "");
            setVal("#edit_student_middle_name", user?.middle_name || "");
            setVal("#edit_student_last_name", user?.last_name || "");
            setVal("#edit_student_suffix", user?.suffix || "");
            setVal("#edit_student_email", user?.email || "");
            setVal("#edit_student_program", user?.program || "");
            setVal("#edit_student_year_level", user?.year_level || "");
            setVal("#edit_student_school_year", user?.school_year || "");
            setVal("#edit_student_status", user?.status || "Active");
            
            S.showModal("modalEditStudent");
          } else if (a.classList.contains("mu-president-reset-one")) {
            const presidentName = a.getAttribute("data-name") || "President";
            
            if (typeof S.showConfirmModal === 'function') {
              S.showConfirmModal({
                title: "Reset Password",
                subtitle: `Reset password for ${presidentName}`,
                message: `Reset this president's password to their ID Number?`,
                type: "warning",
                btnText: "Reset",
                btnClass: "warning",
                btnIcon: "key",
                onConfirm: async () => {
                  await S.postJSON({ action: "reset_password", id });
                  S.safeShowSuccess(`Password for ${presidentName} reset to ID Number.`);
                }
              });
            }
          } else if (a.classList.contains("mu-president-demote-one")) {
            const presidentName = a.getAttribute("data-name") || "President";
            
            if (typeof S.showConfirmModal === 'function') {
              S.showConfirmModal({
                title: "Demote to Student",
                subtitle: `Change role for ${presidentName}`,
                message: `Are you sure you want to demote ${presidentName} from President back to Student?`,
                type: "warning",
                btnText: "Demote",
                btnClass: "warning",
                btnIcon: "arrow-down-circle",
                onConfirm: async () => {
                  await demotePresident(id);
                  S.safeShowSuccess(`${presidentName} has been demoted to Student.`);
                  await refresh();
                }
              });
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
        const presidentName = btn.getAttribute("data-name") || "President";
        if (!id || !next) return;

        const doIt = async () => {
          try {
            await S.postJSON({ action: "set_status", group: GROUP, id, status: next });
            S.safeShowSuccess(`${presidentName} status updated to ${next}.`);
            await refresh();
          } catch (err) {
            S.safeShowError(err?.message || "Failed to update status.");
          }
        };

        let title, type, btnClass, btnIcon;
        
        if (next === "Archived") {
          title = "Archive President";
          type = "archive";
          btnClass = "warning";
          btnIcon = "archive";
        } else if (next === "Active") {
          title = "Activate President";
          type = "success";
          btnClass = "success";
          btnIcon = "check-circle";
        } else if (next === "Inactive") {
          title = "Deactivate President";
          type = "warning";
          btnClass = "warning";
          btnIcon = "dash-circle";
        } else {
          title = "Update Status";
          type = "info";
          btnClass = "primary";
          btnIcon = "check";
        }
        
        if (typeof S.showConfirmModal === 'function') {
          S.showConfirmModal({
            title,
            subtitle: "Confirm status change",
            message: `Change ${presidentName}'s status to "${next}"?`,
            type,
            btnText: "Confirm",
            btnClass,
            btnIcon,
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

    const btnClear = S.qs(cfg.btnClear);
    if (btnClear) {
      const newBtn = btnClear.cloneNode(true);
      btnClear.parentNode.replaceChild(newBtn, btnClear);
      newBtn.addEventListener("click", (e) => {
        e.preventDefault();
        clearSelection(status);
      });
    }

    const btnExport = S.qs(cfg.btnExport);
    if (btnExport) {
      const newBtn = btnExport.cloneNode(true);
      btnExport.parentNode.replaceChild(newBtn, btnExport);
      newBtn.addEventListener("click", (e) => {
        e.preventDefault();
        exportSelected(status);
      });
    }

    if (cfg.btnDemote) {
      const btn = S.qs(cfg.btnDemote);
      if (btn) {
        const newBtn = btn.cloneNode(true);
        btn.parentNode.replaceChild(newBtn, btn);
        newBtn.addEventListener("click", createDemoteHandler(status));
      }
    }

    if (cfg.btnArchive) {
      const btn = S.qs(cfg.btnArchive);
      if (btn) {
        const newBtn = btn.cloneNode(true);
        btn.parentNode.replaceChild(newBtn, btn);
        newBtn.addEventListener("click", createArchiveHandler(status));
      }
    }

    if (cfg.btnRestore) {
      const btn = S.qs(cfg.btnRestore);
      if (btn) {
        const newBtn = btn.cloneNode(true);
        btn.parentNode.replaceChild(newBtn, btn);
        newBtn.addEventListener("click", createRestoreHandler(status));
      }
    }

    if (cfg.btnActivate) {
      const btn = S.qs(cfg.btnActivate);
      if (btn) {
        const newBtn = btn.cloneNode(true);
        btn.parentNode.replaceChild(newBtn, btn);
        newBtn.addEventListener("click", createActivateHandler(status));
      }
    }
  }

  // -------------------------
  // CSV export helpers
  // -------------------------
  function mapPresidentRowForCsv(r) {
    return {
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
      created_at: r.created_at || "",
    };
  }

  const CSV_HEADERS = ["id_number", "first_name", "middle_name", "last_name", "suffix", "email", "program", "year_level", "school_year", "role", "status", "created_at"];

  function exportRowsToCsv(filename, rows) {
    const csv = S.toCSV(rows, CSV_HEADERS);
    S.downloadText(filename, csv);
  }

  function exportSelected(status) {
    const ids = getSelectedIds(status);
    if (!ids.length) return;

    const rows = state[status].rows.filter((r) => ids.includes(Number(r.id))).map(mapPresidentRowForCsv);
    exportRowsToCsv(`presidents_${status.toLowerCase()}_selected.csv`, rows);
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
      rows.push(...pageRows.map(mapPresidentRowForCsv));

      const total = Number(data.total || 0);
      const totalPages = total ? Math.ceil(total / limit) : 1;
      if (page >= totalPages) break;
      page++;
    }

    exportRowsToCsv(`presidents_${status.toLowerCase()}.csv`, rows);
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
        rows.push(...pageRows.map(mapPresidentRowForCsv));

        const total = Number(data.total || 0);
        const totalPages = total ? Math.ceil(total / limit) : 1;
        if (page >= totalPages) break;
        page++;
      }
    }

    exportRowsToCsv(`presidents_all.csv`, rows);
  }

  // -------------------------
  // Import CSV
  // -------------------------
  function bindImport() {
    const btn = S.qs(common.btnImport);
    if (!btn) return;

    btn.addEventListener("click", () => {
      const target = S.qs("#csv_import_target");
      if (target) target.value = "presidents";
      
      const subtitle = S.qs("#csvImportSubtitle");
      if (subtitle) {
        subtitle.innerHTML = 'Upload a CSV file to import president records. Role will be set to <span class="fw-semibold">org_president</span>.';
      }
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

  // -------------------------
  // Search / Page size / Pagination
  // -------------------------
  function bindSearch(status) {
    const searchId = status === "Active" ? common.searchActive :
                     status === "Inactive" ? common.searchInactive :
                     common.searchArchived;
    
    const searchEl = S.qs(searchId);
    if (!searchEl) return;

    searchEl.addEventListener("input", () => {
      if (state.searchDebounceTimers[status]) {
        clearTimeout(state.searchDebounceTimers[status]);
      }

      state.searchDebounceTimers[status] = setTimeout(() => {
        state.search = String(searchEl.value || "").trim();
        state[status].page = 1;
        refreshStatus(status);
        console.log(`[Presidents] Searching ${status}:`, state.search);
      }, 300);
    });
  }

  function bindPageSize() {
    const limitEl = S.qs(common.pageSize);
    if (!limitEl) return;

    limitEl.addEventListener("change", () => {
      const n = parseInt(limitEl.value || "10", 10);
      state.limit = Number.isFinite(n) && n > 0 ? n : 10;
      
      for (const st of STATUSES) {
        state[st].page = 1;
      }
      
      refresh();
    });
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
  // Tab activation handler
  // -------------------------
  function bindTabActivation() {
    const presidentsTab = document.querySelector('#tab-presidents');
    if (!presidentsTab) return;

    presidentsTab.addEventListener('shown.bs.tab', (e) => {
      console.log('[Presidents] Tab activated, refreshing data...');
      
      state.search = "";
      
      const activeSearch = S.qs(common.searchActive);
      const inactiveSearch = S.qs(common.searchInactive);
      const archivedSearch = S.qs(common.searchArchived);
      
      if (activeSearch) activeSearch.value = "";
      if (inactiveSearch) inactiveSearch.value = "";
      if (archivedSearch) archivedSearch.value = "";
      
      refresh();
    });
  }

  // -------------------------
  // Init
  // -------------------------
  function init(shared) {
    console.log('[Presidents] Initializing...');
    S = shared;

    enableDropdownPortal();
    setupVisibilityHandlers();

    bindAddPresidentModal();
    bindPageSize();
    bindImport();
    bindExportButtons();
    bindRowActions();
    bindTabActivation();

    for (const st of STATUSES) {
      bindSearch(st);
      bindPagination(st);
      bindBulkBar(st);
      syncBulkBar(st);
    }

    refresh().then(() => {
      console.log('[Presidents] Initial data loaded');
    });

    startPolling();
  }

  window.UsersPresident = {
    init,
    refresh,
    refreshStatus,
    startPolling,
    stopPolling,
    demotePresident,
  };
})();