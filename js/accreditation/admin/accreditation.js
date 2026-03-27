/* js/accredititation/admin/accreditation.js */
/* global bootstrap, showSuccess, showError */

(function () {
  "use strict";

  // ✅ Change this if your PHP endpoint name is different
  const API_URL = "php/accreditation-admin.php";

  // -------------------------
  // Tiny helpers
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
  function debounce(fn, ms) {
    let t = null;
    return function (...args) {
      clearTimeout(t);
      t = setTimeout(() => fn.apply(this, args), ms);
    };
  }

  // -------------------------
  // Simple event bus
  // -------------------------
  const bus = {
    _m: new Map(),
    on(evt, fn) {
      if (!this._m.has(evt)) this._m.set(evt, new Set());
      this._m.get(evt).add(fn);
      return () => this.off(evt, fn);
    },
    off(evt, fn) {
      const s = this._m.get(evt);
      if (s) s.delete(fn);
    },
    emit(evt, payload) {
      const s = this._m.get(evt);
      if (!s) return;
      for (const fn of s) {
        try {
          fn(payload);
        } catch (e) {
          console.error(e);
        }
      }
    },
  };

  // -------------------------
  // Shared store (admin page)
  // -------------------------
  const store = {
    _root: null,

    search: "",
    terms: [],
    activeTerm: null,

    programs: [],

    canSubmit: null, // boolean | null (unknown)
    myRequestId: null,

    pending: { items: [], page: 1, perPage: 10, total: 0 },
    active: { items: [], page: 1, perPage: 10, total: 0 },
    returned: { items: [], page: 1, perPage: 10, total: 0 },

    // view modal docs paging
    docs: { items: [], page: 1, perPage: 8, total: 0, requestId: null },

    // add modal requirements
    reqUpload: { items: [], loadedKey: "" },

    // current user info (for president auto-fill)
    currentUser: null,
  };

  // Root-aware selectors
  function rqs(sel) {
    return qs(sel, store._root || document);
  }
  function rqsa(sel) {
    return qsa(sel, store._root || document);
  }

  // -------------------------
  // UX helpers
  // -------------------------
  function safeShowError(msg) {
    if (typeof window.showError === "function") return window.showError(msg);
    alert(msg || "Something went wrong.");
  }
  function safeShowSuccess(msg) {
    if (typeof window.showSuccess === "function") return window.showSuccess(msg);
    alert(msg || "Success.");
  }

  // -------------------------
  // Network helpers
  // -------------------------
  async function postJSON(payload) {
    const res = await fetch(API_URL, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload || {}),
    });

    const txt = await res.text();
    let data;
    try {
      data = JSON.parse(txt);
    } catch {
      console.error("Non-JSON response:", txt);
      throw new Error("Invalid JSON from server.");
    }

    if (!res.ok || data?.ok === false) {
      throw new Error(data?.error || data?.message || `Request failed (${res.status}).`);
    }

    return data;
  }

  async function postForm(formData) {
    const res = await fetch(API_URL, {
      method: "POST",
      credentials: "include",
      body: formData,
    });

    const txt = await res.text();
    let data;
    try {
      data = JSON.parse(txt);
    } catch {
      console.error("Non-JSON response:", txt);
      throw new Error("Invalid JSON from server.");
    }

    if (!res.ok || data?.ok === false) {
      throw new Error(data?.error || data?.message || `Upload failed (${res.status}).`);
    }

    return data;
  }

  // -------------------------
  // Pagination renderer
  // -------------------------
  function renderPagination(ulEl, metaEl, page, perPage, total, onPage) {
    if (!ulEl) return;

    const p = Number(page || 1);
    const pp = Number(perPage || 10);
    const t = Number(total || 0);
    const pages = Math.max(1, Math.ceil(t / pp));

    if (metaEl) {
      const start = t ? (p - 1) * pp + 1 : 0;
      const end = Math.min(p * pp, t);
      metaEl.textContent = t ? `Showing ${start}-${end} of ${t}` : "";
    }

    ulEl.innerHTML = "";
    if (pages <= 1) return;

    const mk = (label, targetPage, disabled = false, active = false) => {
      const li = document.createElement("li");
      li.className = `page-item ${disabled ? "disabled" : ""} ${active ? "active" : ""}`;
      const a = document.createElement("a");
      a.className = "page-link";
      a.href = "#";
      a.textContent = label;
      a.addEventListener("click", (e) => {
        e.preventDefault();
        if (disabled || active) return;
        onPage(targetPage);
      });
      li.appendChild(a);
      return li;
    };

    ulEl.appendChild(mk("«", Math.max(1, p - 1), p === 1));

    const win = 2;
    const from = Math.max(1, p - win);
    const to = Math.min(pages, p + win);

    if (from > 1) ulEl.appendChild(mk("1", 1, false, p === 1));
    if (from > 2) {
      const li = document.createElement("li");
      li.className = "page-item disabled";
      li.innerHTML = `<span class="page-link">…</span>`;
      ulEl.appendChild(li);
    }

    for (let i = from; i <= to; i++) ulEl.appendChild(mk(String(i), i, false, i === p));

    if (to < pages - 1) {
      const li = document.createElement("li");
      li.className = "page-item disabled";
      li.innerHTML = `<span class="page-link">…</span>`;
      ulEl.appendChild(li);
    }
    if (to < pages) ulEl.appendChild(mk(String(pages), pages, false, p === pages));

    ulEl.appendChild(mk("»", Math.min(pages, p + 1), p === pages));
  }

  // -------------------------
  // Preview modal
  // -------------------------
  function openPreview(url, fileName) {
    const modalEl = rqs("#adPreviewFileModal");
    if (!modalEl || !window.bootstrap) {
      window.open(url, "_blank", "noopener");
      return;
    }

    const nameEl = rqs("#adPreviewFileName");
    const iframe = rqs("#adPreviewIframe");
    const hint = rqs("#adPreviewHint");
    const openBtn = rqs("#adPreviewOpenNewTab");

    if (nameEl) nameEl.textContent = fileName || "Preview";
    if (openBtn) openBtn.href = url || "#";

    const isDocx = /\.docx(\?|#|$)/i.test(String(url || ""));
    if (hint) hint.style.display = isDocx ? "" : "none";

    if (iframe) iframe.src = isDocx ? "about:blank" : (url || "about:blank");

    bootstrap.Modal.getOrCreateInstance(modalEl).show();
  }

  // -------------------------
  // Get current user info
  // -------------------------
  async function getCurrentUser() {
    try {
      const data = await postJSON({ action: "get_current_user" });
      if (data?.ok && data?.user) {
        store.currentUser = data.user;
        return data.user;
      }
    } catch (e) {
      console.error("Failed to get current user:", e);
    }
    return null;
  }

  // -------------------------
  // Coordinator search
  // -------------------------
  async function searchCoordinators(q) {
    const data = await postJSON({
      action: "search_coordinators",
      q: q || "",
      limit: 25,
    });
    if (!data?.ok) throw new Error(data?.message || "Failed to search coordinators.");
    return data.items || [];
  }

  function bindCoordinatorSearch() {
    const nameInput = rqs("#accCoordinatorName");
    const idHidden = rqs("#accCoordinatorUserId");
    const resultsBox = rqs("#coordinatorSearchResults");

    if (!nameInput || !resultsBox) return;
    if (nameInput.__coordBound) return;
    nameInput.__coordBound = true;

    const run = debounce(async () => {
      const q = String(nameInput.value || "").trim();
      if (q.length < 2) {
        resultsBox.style.display = "none";
        resultsBox.innerHTML = "";
        return;
      }

      const items = await searchCoordinators(q);
      showCoordinatorResults(items);
    }, 250);

    nameInput.addEventListener("input", () => run().catch((e) => safeShowError(e.message)));
    nameInput.addEventListener("focus", () => run().catch(() => {}));

    // click select
    resultsBox.addEventListener("click", (e) => {
      const item = e.target.closest(".coordinator-search-item[data-coordinator-id]");
      if (!item) return;

      const cid = item.getAttribute("data-coordinator-id") || "";
      const name = item.getAttribute("data-full-name") || "";

      if (idHidden) idHidden.value = cid;
      if (nameInput) nameInput.value = name;

      hideCoordinatorResults();
    });

    // click outside closes
    if (!document.__coordOutsideBound) {
      document.__coordOutsideBound = true;
      document.addEventListener("click", (e) => {
        const anyOpen = qsa(".coordinator-search-results", store._root || document).filter(
          (el) => el && el.style.display !== "none"
        );
        if (!anyOpen.length) return;

        for (const el of anyOpen) {
          if (e.target.closest(".coordinator-search-container")) return;
        }
        for (const el of anyOpen) el.style.display = "none";
      });
    }
  }

  function showCoordinatorResults(items) {
    const box = rqs("#coordinatorSearchResults");
    if (!box) return;

    if (!items || !items.length) {
      box.innerHTML = `<div class="coordinator-search-item text-muted">No matches</div>`;
      box.style.display = "";
      return;
    }

    box.innerHTML = items
      .map((c) => {
        const id = escapeHtml(c.id);
        const fullName = escapeHtml(c.full_name || "");
        const idNumber = escapeHtml(c.id_number || "");

        return `
          <div class="coordinator-search-item"
               data-coordinator-id="${id}"
               data-full-name="${fullName}">
            <div class="coordinator-name">${fullName || "—"}</div>
            <div class="coordinator-id">${idNumber}</div>
          </div>
        `;
      })
      .join("");

    box.style.display = "";
  }

  function hideCoordinatorResults() {
    const box = rqs("#coordinatorSearchResults");
    if (!box) return;
    box.style.display = "none";
  }

  // -------------------------
  // Term / Program loaders
  // -------------------------
  function termLabel(t) {
    if (!t) return "—";
    return t.label || `${t.school_year || ""} • ${t.semester || ""}`.trim() || `Term #${t.id || ""}`;
  }

  async function loadTerms() {
    const data = await postJSON({ action: "list_terms" });
    store.terms = Array.isArray(data?.terms) ? data.terms : [];

    const activeId = String(data?.active_term_id || "");
    let active = null;

    if (data?.active_term && typeof data.active_term === "object") active = data.active_term;
    if (!active && activeId) active = store.terms.find((t) => String(t.id) === activeId) || null;
    if (!active) active = store.terms.find((t) => String(t.status || "").toLowerCase() === "active") || null;

    store.activeTerm = active;

    const labelEl = rqs("#activeTermLabel");
    if (labelEl) labelEl.textContent = active ? termLabel(active) : "—";
  }

  async function loadPrograms() {
    const data = await postJSON({ action: "list_programs" });
    const items = Array.isArray(data?.items) ? data.items : Array.isArray(data?.programs) ? data.programs : [];
    store.programs = items;

    const sel = rqs("#accProgramId");
    const selEditOrg = rqs("#editAccProgramId");
    if (!sel && !selEditOrg) return;

    const first = sel?.querySelector("option")
      ? sel.querySelector("option").outerHTML
      : `<option value="">— Select program —</option>`;
    if (sel) sel.innerHTML = first;
    if (selEditOrg) selEditOrg.innerHTML = `<option value="">— Select program —</option>`;

    for (const p of items) {
      const label = p.program_abbr ? `${p.program_abbr} — ${p.program_name}` : (p.program_name || `Program #${p.id}`);

      if (sel) {
        const opt = document.createElement("option");
        opt.value = String(p.id);
        opt.textContent = label;
        sel.appendChild(opt);
      }

      if (selEditOrg) {
        const opt2 = document.createElement("option");
        opt2.value = String(p.id);
        opt2.textContent = label;
        selEditOrg.appendChild(opt2);
      }
    }
  }

  // -------------------------
  // One-org submit rule (REMOVED FOR PRESIDENTS)
  // -------------------------
  async function resolveCanSubmit() {
    // For org_president, always can submit
    if (store.currentUser && store.currentUser.role === 'org_president') {
      store.canSubmit = true;
      store.myRequestId = null;
      applySubmitUI();
      return;
    }

    const candidates = [
      { action: "admin_can_submit" },
      { action: "can_submit" },
      { action: "get_my_request" },
      { action: "my_request" },
    ];

    for (const payload of candidates) {
      try {
        const data = await postJSON(payload);

        let can = null;
        let reqId = null;

        if (typeof data?.can_submit === "boolean") can = data.can_submit;
        if (typeof data?.has_request === "boolean") can = !data.has_request;

        const req = data?.request || data?.item || null;
        if (req && typeof req === "object" && req.id != null) {
          reqId = String(req.id);
          if (can == null) can = false;
        }

        if (data?.request_id != null) {
          reqId = String(data.request_id);
          if (can == null) can = false;
        }

        if (data?.my_request_id != null) {
          reqId = String(data.my_request_id);
          if (can == null) can = false;
        }

        if (can == null) can = true;
        store.canSubmit = can;
        store.myRequestId = reqId;

        applySubmitUI();
        return;
      } catch {
        // try next
      }
    }

    store.canSubmit = true;
    store.myRequestId = null;
    applySubmitUI();
  }

  function applySubmitUI() {
    const btn = rqs("#openAddOrgModal");
    const notice = rqs("#oneOrgNotice");

    if (!btn) return;

    if (store.canSubmit === false) {
      btn.style.display = "none";
      if (notice) notice.classList.remove("d-none");
    } else {
      btn.style.display = "";
      if (notice) notice.classList.add("d-none");
    }
  }

  // -------------------------
  // Header bindings
  // -------------------------
  function bindHeader() {
    const searchEl = rqs("#adAccSearch");
    const refreshBtn = rqs("#adAccRefreshBtn");

    if (searchEl) {
      // Always reset the input to match the (freshly-cleared) store on re-navigation
      searchEl.value = store.search || "";

      if (!searchEl.__adBound) {
        searchEl.__adBound = true;
        searchEl.addEventListener(
          "input",
          debounce(() => {
            store.search = String(searchEl.value || "").trim();
            store.pending.page = 1;
            store.active.page = 1;
            store.returned.page = 1;
            bus.emit("search:changed", store.search);
          }, 250)
        );
      }
    }

    if (refreshBtn && !refreshBtn.__adBound) {
      refreshBtn.__adBound = true;
      refreshBtn.addEventListener("click", () => bus.emit("refresh:all"));
    }
  }

  // -------------------------
  // Add Accreditation modal
  // -------------------------
  function currentScopeValue(r) {
    const root = r || store._root || document;
    const checked = root.querySelector("input[name='scope']:checked");
    return checked ? String(checked.value || "") : "General";
  }

  function syncProgramEnable() {
    const sel = rqs("#accProgramId");
    if (!sel) return;

    const scope = currentScopeValue();
    const shouldEnable = scope === "Exclusive";
    sel.disabled = !shouldEnable;

    if (!shouldEnable) sel.value = "";
  }

  // Helper function to format year level text
  function getYearText(yearLevel) {
    if (!yearLevel) return "";

    const yearNum = parseInt(yearLevel);
    if (!isNaN(yearNum)) {
      if (yearNum === 1) return "1st Year";
      if (yearNum === 2) return "2nd Year";
      if (yearNum === 3) return "3rd Year";
      if (yearNum === 4) return "4th Year";
      if (yearNum === 5) return "5th Year";
      return `${yearNum}th Year`;
    }

    return String(yearLevel);
  }

  function getAddModalOrgType() {
    return String(rqs("#accOrgType")?.value || "Organization");
  }

  // ✅ Function to detect already-selected officer student IDs
  function getSelectedOfficerIds(excludeIndex = null) {
    const set = new Set();
    for (let i = 0; i < 5; i++) {
      if (excludeIndex != null && Number(excludeIndex) === i) continue;
      const hid = rqs(`#officer_${i}_student_id`);
      const v = String(hid?.value || "").trim();
      if (v) set.add(v);
    }
    // Also check dynamic officers
    const dynamicRows = qsa(".dynamic-officer-row");
    dynamicRows.forEach((row, idx) => {
      const actualIdx = 5 + idx;
      if (excludeIndex != null && Number(excludeIndex) === actualIdx) return;
      const hid = row.querySelector(`#officer_${actualIdx}_student_id`);
      const v = String(hid?.value || "").trim();
      if (v) set.add(v);
    });
    return set;
  }

  function syncScopeForClub() {
    const orgType = getAddModalOrgType();
    const isClub = orgType === "Club";

    const generalScopeRadio = rqs("#scopeGeneral");
    const exclusiveScopeRadio = rqs("#scopeExclusive");
    const generalScopeLabel = generalScopeRadio?.nextElementSibling;
    const exclusiveScopeLabel = exclusiveScopeRadio?.nextElementSibling;

    if (isClub) {
      if (generalScopeRadio) generalScopeRadio.disabled = true;
      if (exclusiveScopeRadio) exclusiveScopeRadio.disabled = true;
      if (generalScopeLabel) generalScopeLabel.classList.add("disabled");
      if (exclusiveScopeLabel) exclusiveScopeLabel.classList.add("disabled");

      if (generalScopeRadio) generalScopeRadio.checked = true;

      const programSelect = rqs("#accProgramId");
      if (programSelect) {
        programSelect.disabled = true;
        programSelect.value = "";
      }
    } else {
      if (generalScopeRadio) generalScopeRadio.disabled = false;
      if (exclusiveScopeRadio) exclusiveScopeRadio.disabled = false;
      if (generalScopeLabel) generalScopeLabel.classList.remove("disabled");
      if (exclusiveScopeLabel) exclusiveScopeLabel.classList.remove("disabled");

      syncProgramEnable();
    }
  }

  function syncFeeFieldsForAddModal() {
    const orgType = getAddModalOrgType();
    const isClub = orgType === "Club";
    const isOrganization = orgType === "Organization";

    const orgFeeWrap = rqs("#orgFeeWrap");
    const orgFeeInput = rqs("#accFeeRequired");

    const clubFeeWrap = rqs("#clubFeeWrap");
    const clubFeeInput = rqs("#accMembershipFee");

    if (orgFeeWrap) orgFeeWrap.style.display = isOrganization ? "" : "none";
    if (orgFeeInput) {
      if (!isOrganization) orgFeeInput.value = "";
    }

    if (clubFeeWrap) clubFeeWrap.style.display = isClub ? "" : "none";
    if (clubFeeInput) {
      if (!isClub) clubFeeInput.value = "";
    }

    syncScopeForClub();
  }

  // ✅ Officers: student search
  async function searchStudents(q, programId, programName = null) {
    const data = await postJSON({
      action: "search_students",
      q: q || "",
      program_id: programId || null,
      program_name: programName || null,
      limit: 25,
    });
    if (!data?.ok) throw new Error(data?.message || "Failed to search students.");
    return data.items || [];
  }

  function getAddModalProgramFilter() {
    const orgType = getAddModalOrgType();
    if (orgType === "Club") return null;

    const scope = currentScopeValue();
    if (scope !== "Exclusive") return null;
    const pid = Number(rqs("#accProgramId")?.value || 0);
    return pid || null;
  }

  function getAddModalProgramName() {
    const orgType = getAddModalOrgType();
    if (orgType === "Club") return null;

    const scope = currentScopeValue();
    if (scope !== "Exclusive") return null;

    const programSelect = rqs("#accProgramId");
    if (!programSelect) return null;

    const selectedOption = programSelect.options[programSelect.selectedIndex];
    if (!selectedOption || selectedOption.value === "") return null;

    const optionText = selectedOption.textContent || "";
    const programName = optionText.split("—")[0]?.trim();
    return programName || null;
  }

  function showOfficerResults(index, items) {
    // index can be a number or a string like "dynamic_officer_5"
    const box = rqs(`#searchResults_${index}`);
    if (!box) {
      console.log(`Results box not found for index: ${index}`);
      return;
    }

    if (!items || !items.length) {
      box.innerHTML = `<div class="student-search-item text-muted">No matches</div>`;
      box.style.display = "";
      return;
    }

    box.innerHTML = items
      .map((s) => {
        const id = escapeHtml(s.id);
        const fullName = escapeHtml(
          s.full_name || [s.first_name, s.middle_name, s.last_name].filter(Boolean).join(" ")
        );

        let courseYear = "";

        if (s.course_year) {
          courseYear = escapeHtml(s.course_year);
        }
        else if (s.program && s.year_level) {
          const yearText = getYearText(s.year_level);
          courseYear = escapeHtml(`${s.program} ${yearText}`);
        }
        else if (s.program) {
          courseYear = escapeHtml(s.program);
        }
        else if (s.year_level) {
          const yearText = getYearText(s.year_level);
          courseYear = escapeHtml(yearText);
        }
        else if (s.program_abbr && s.year_level) {
          const yearText = getYearText(s.year_level);
          courseYear = escapeHtml(`${s.program_abbr} ${yearText}`);
        }
        else if (s.program_name && s.year_level) {
          const yearText = getYearText(s.year_level);
          const programAbbr =
            s.program_abbr || s.program_name.split(" ").map((word) => word[0]).join("").toUpperCase();
          courseYear = escapeHtml(`${programAbbr} ${yearText}`);
        }

        return `
          <div class="student-search-item"
              data-student-id="${id}"
              data-full-name="${fullName}"
              data-course-year="${courseYear}">
            <div class="student-name">${fullName || "—"}</div>
          </div>
        `;
      })
      .join("");

    box.style.display = "";
  }

  function hideOfficerResults(index) {
    const box = rqs(`#searchResults_${index}`);
    if (!box) return;
    box.style.display = "none";
  }

  function bindOfficerRowSearch(index, isDynamic = false) {
  // For dynamic officers, use a different ID pattern
  let nameInput, idHidden, courseInput, resultsBox;
  
  if (isDynamic) {
    nameInput = rqs(`#dynamic_officer_${index}_full_name`);
    idHidden = rqs(`#dynamic_officer_${index}_student_id`);
    courseInput = rqs(`#dynamic_officer_${index}_course_year`);
    resultsBox = rqs(`#searchResults_dynamic_officer_${index}`);
  } else {
    nameInput = rqs(`#officer_${index}_full_name`);
    idHidden = rqs(`#officer_${index}_student_id`);
    courseInput = rqs(`#officer_${index}_course_year`);
    resultsBox = rqs(`#searchResults_${index}`);
  }

  if (!nameInput || !resultsBox) {
    console.log(`Missing elements for officer ${index}:`, { nameInput, resultsBox });
    return;
  }
  
  if (nameInput.__offBound) return;
  nameInput.__offBound = true;

  const run = debounce(async () => {
    const q = String(nameInput.value || "").trim();
    if (q.length < 2) {
      resultsBox.style.display = "none";
      resultsBox.innerHTML = "";
      return;
    }

    const programId = getAddModalProgramFilter();
    const programName = getAddModalProgramName();

    try {
      const items = await searchStudents(q, programId, programName);
      const filtered = items || [];
      
      // Pass the correct identifier to showOfficerResults
      if (isDynamic) {
        showOfficerResults(`dynamic_officer_${index}`, filtered);
      } else {
        showOfficerResults(index, filtered);
      }
    } catch (e) {
      safeShowError(e.message);
    }
  }, 250);

  nameInput.addEventListener("input", () => {
    run();
  });
  
  nameInput.addEventListener("focus", () => {
    run();
  });

  // click select
  resultsBox.addEventListener("click", (e) => {
    const item = e.target.closest(".student-search-item[data-student-id]");
    if (!item) return;

    const sid = item.getAttribute("data-student-id") || "";
    const full = item.getAttribute("data-full-name") || "";
    const cy = item.getAttribute("data-course-year") || "";

    if (idHidden) idHidden.value = sid;
    if (nameInput) nameInput.value = full;
    if (courseInput) courseInput.value = cy;

    // Hide results
    resultsBox.style.display = "none";
    resultsBox.innerHTML = "";
  });

  // Clear course/year when name is cleared
  nameInput.addEventListener("input", () => {
    const q = String(nameInput.value || "").trim();
    if (q.length === 0) {
      if (courseInput) {
        courseInput.value = "";
      }
      if (idHidden) {
        idHidden.value = "";
      }
    }
  });
  }

  // Auto-fill president field with current user
  function autoFillPresident() {
    if (!store.currentUser || store.currentUser.role !== 'org_president') return;

    const presidentNameInput = rqs("#officer_0_full_name");
    const presidentIdHidden = rqs("#officer_0_student_id");
    const presidentCourseInput = rqs("#officer_0_course_year");

    if (presidentNameInput && presidentIdHidden) {
      presidentNameInput.value = `${store.currentUser.first_name} ${store.currentUser.last_name}`;
      presidentIdHidden.value = store.currentUser.id;
      
      // Auto-fill course/year if available
      if (presidentCourseInput && store.currentUser.course_year) {
        presidentCourseInput.value = store.currentUser.course_year;
      } else if (presidentCourseInput && store.currentUser.program && store.currentUser.year_level) {
        const yearText = getYearText(store.currentUser.year_level);
        presidentCourseInput.value = `${store.currentUser.program} ${yearText}`;
      }
      
      // Make president field readonly
      presidentNameInput.readOnly = true;
      const searchBtn = rqs("#officer_0_search_btn");
      if (searchBtn) searchBtn.disabled = true;
    }
  }

  // Add dynamic officer row
  function addDynamicOfficerRow() {
    const container = rqs("#dynamicOfficersContainer");
    if (!container) return;

    const currentCount = container.children.length;
    const newIndex = 5 + currentCount; // Start after the 5 hardcoded officers

    const rowHtml = `
      <tr class="dynamic-officer-row" data-dynamic-index="${newIndex}">
        <td>
          <input type="text" class="form-control" name="officers[${newIndex}][position]" 
                 placeholder="e.g., P.R.O., Sergeant-at-Arms" required>
          <input type="hidden" name="officers[${newIndex}][id]" id="officer_${newIndex}_id" value="0">
          <input type="hidden" name="officers[${newIndex}][student_id]" id="dynamic_officer_${newIndex}_student_id">
        </td>
        <td>
          <div class="student-search-container">
            <div class="input-group">
              <input class="form-control" name="officers[${newIndex}][full_name]" 
                     id="dynamic_officer_${newIndex}_full_name"
                     placeholder="Search student..." required
                     data-search-target="#dynamic_officer_${newIndex}_student_id"
                     data-course-target="#dynamic_officer_${newIndex}_course_year"
                     autocomplete="off">
              <button class="btn btn-outline-secondary" type="button" 
                      onclick="window.ADAccreditation?.searchDynamicStudent(${newIndex})">
                <i class="bi bi-search"></i>
              </button>
            </div>
            <div class="student-search-results" id="searchResults_dynamic_officer_${newIndex}"></div>
          </div>
        </td>
        <td>
          <input class="form-control" name="officers[${newIndex}][course_year]" 
                 id="dynamic_officer_${newIndex}_course_year"
                 placeholder="Will auto-fill" readonly>
        </td>
        <td>
          <select class="form-select" name="officers[${newIndex}][status]">
            <option value="Active">Active</option>
            <option value="Inactive">Inactive</option>
          </select>
        </td>
        <td class="text-center">
          <button type="button" class="btn btn-sm btn-outline-danger" onclick="this.closest('tr').remove()">
            <i class="bi bi-trash"></i>
          </button>
        </td>
      </tr>
    `;

    container.insertAdjacentHTML('beforeend', rowHtml);
    
    // Bind search for this new row
    bindOfficerRowSearch(newIndex, true);
  }

  window.searchStudent = async function (index) {
    const nameInput = rqs(`#officer_${index}_full_name`);
    if (!nameInput) return;
    nameInput.focus();

    const q = String(nameInput.value || "").trim();
    if (q.length < 2) return;

    try {
      const programId = getAddModalProgramFilter();
      const programName = getAddModalProgramName();
      const items = await searchStudents(q, programId, programName);

      // REMOVED: Cross-organization filtering
      const filtered = items || [];

      showOfficerResults(index, filtered);
    } catch (e) {
      safeShowError(e.message);
    }
  };

  window.searchDynamicStudent = async function (index) {
    const nameInput = rqs(`#dynamic_officer_${index}_full_name`);
    if (!nameInput) return;
    nameInput.focus();

    const q = String(nameInput.value || "").trim();
    if (q.length < 2) return;

    try {
      const programId = getAddModalProgramFilter();
      const programName = getAddModalProgramName();
      const items = await searchStudents(q, programId, programName);

      const filtered = items || [];

      showOfficerResults(`dynamic_officer_${index}`, filtered);
    } catch (e) {
      safeShowError(e.message);
    }
  };

  // -------------------------
  // Add modal bindings
  // -------------------------
  function bindAddModal() {
    const modalEl = rqs("#addOrgModal");
    if (!modalEl) return;

    modalEl.addEventListener("shown.bs.modal", () => {
      loadPrograms().catch(() => {});
      fetchRequirementsForModal().catch((e) => safeShowError(e.message));
      syncProgramEnable();
      syncFeeFieldsForAddModal();

      // Auto-fill president if current user is org_president
      autoFillPresident();

      // Bind the 5 hard-coded officer rows (0..4)
      for (let i = 0; i < 5; i++) bindOfficerRowSearch(i);

      // Bind coordinator search
      bindCoordinatorSearch();
    });

    const typeSel = rqs("#accOrgType");
    if (typeSel && !typeSel.__adBound) {
      typeSel.__adBound = true;
      typeSel.addEventListener("change", () => {
        fetchRequirementsForModal().catch((e) => safeShowError(e.message));
        syncFeeFieldsForAddModal();
      });
    }

    const scopeRadios = rqsa("input[name='scope']");
    for (const r of scopeRadios) {
      if (r.__adBound) continue;
      r.__adBound = true;
      r.addEventListener("change", () => {
        if (getAddModalOrgType() !== "Club") {
          syncProgramEnable();
          fetchRequirementsForModal().catch((e) => safeShowError(e.message));
        }
      });
    }

    const programSel = rqs("#accProgramId");
    if (programSel && !programSel.__adBound) {
      programSel.__adBound = true;
      programSel.addEventListener("change", () => {
        fetchRequirementsForModal().catch((e) => safeShowError(e.message));
      });
    }

    // Add Officer button
    const addOfficerBtn = rqs("#addOfficerBtn");
    if (addOfficerBtn && !addOfficerBtn.__adBound) {
      addOfficerBtn.__adBound = true;
      addOfficerBtn.addEventListener("click", () => {
        addDynamicOfficerRow();
      });
    }

    const submitBtn = rqs("#saveAddOrgBtn");
    if (submitBtn && !submitBtn.__adBound) {
      submitBtn.__adBound = true;
      submitBtn.addEventListener("click", () => {
        submitNewAccreditation().catch((e) => safeShowError(e.message));
      });
    }
  }

  // -------------------------
  // Edit modal bindings
  // -------------------------
  function bindEditModal() {
    const modalEl = rqs("#editOrgModal");
    if (!modalEl) return;

    modalEl.addEventListener("shown.bs.modal", () => {
      syncEditModalProgramEnable();
      syncEditModalFeeFields();
      
      // Bind the 5 hard-coded officer rows for editing
      for (let i = 0; i < 5; i++) bindEditOfficerRowSearch(i);

      // Bind dynamic officers if any
      const dynamicRows = qsa(".dynamic-officer-row");
      dynamicRows.forEach((row, idx) => {
        const index = row.getAttribute('data-dynamic-index') || (5 + idx);
        bindEditOfficerRowSearch(index, true);
      });

      // Bind coordinator search
      bindEditCoordinatorSearch();

      // Bind moderator (org_president) search
      bindEditModeratorSearch();
    });

    const typeSel = rqs("#editAccOrgType");
    if (typeSel && !typeSel.__editBound) {
      typeSel.__editBound = true;
      typeSel.addEventListener("change", () => {
        syncEditModalFeeFields();
      });
    }

    const scopeRadios = rqsa("input[name='edit_scope']");
    for (const r of scopeRadios) {
      if (r.__editBound) continue;
      r.__editBound = true;
      r.addEventListener("change", () => {
        syncEditModalProgramEnable();
      });
    }

    // Add dynamic officer button in edit modal
    const addOfficerBtn = rqs("#editAddOfficerBtn");
    if (addOfficerBtn && !addOfficerBtn.__editBound) {
      addOfficerBtn.__editBound = true;
      addOfficerBtn.addEventListener("click", () => {
        addEditDynamicOfficerRow();
      });
    }

    const saveBtn = rqs("#saveEditOrgBtn");
    if (saveBtn && !saveBtn.__editBound) {
      saveBtn.__editBound = true;
      saveBtn.addEventListener("click", () => {
        submitOrganizationEdit().catch((e) => safeShowError(e.message));
      });
    }
  }

  function currentEditScopeValue() {
    const root = store._root || document;
    const checked = root.querySelector("input[name='edit_scope']:checked");
    return checked ? String(checked.value || "") : "General";
  }

  function syncEditModalProgramEnable() {
    const sel = rqs("#editAccProgramId");
    if (!sel) return;

    const scope = currentEditScopeValue();
    const orgType = String(rqs("#editAccOrgType")?.value || "Organization");
    
    if (orgType === "Club") {
      sel.disabled = true;
      sel.value = "";
      return;
    }

    const shouldEnable = scope === "Exclusive";
    sel.disabled = !shouldEnable;

    if (!shouldEnable) sel.value = "";
  }

  function syncEditModalFeeFields() {
    const orgType = String(rqs("#editAccOrgType")?.value || "Organization");
    const isClub = orgType === "Club";
    const isOrganization = orgType === "Organization";

    const orgFeeWrap = rqs("#editOrgFeeWrap");
    const orgFeeInput = rqs("#editAccFeeRequired");

    const clubFeeWrap = rqs("#editClubFeeWrap");
    const clubFeeInput = rqs("#editAccMembershipFee");

    if (orgFeeWrap) orgFeeWrap.style.display = isOrganization ? "" : "none";
    if (clubFeeWrap) clubFeeWrap.style.display = isClub ? "" : "none";
    
    if (isClub) {
      const generalScopeRadio = rqs("#editScopeGeneral");
      const exclusiveScopeRadio = rqs("#editScopeExclusive");
      const generalScopeLabel = generalScopeRadio?.nextElementSibling;
      const exclusiveScopeLabel = exclusiveScopeRadio?.nextElementSibling;

      if (generalScopeRadio) generalScopeRadio.disabled = true;
      if (exclusiveScopeRadio) exclusiveScopeRadio.disabled = true;
      if (generalScopeLabel) generalScopeLabel.classList.add("disabled");
      if (exclusiveScopeLabel) exclusiveScopeLabel.classList.add("disabled");

      if (generalScopeRadio) generalScopeRadio.checked = true;
    }
  }

  // ✅ Coordinator search for edit modal
  function bindEditCoordinatorSearch() {
    const nameInput = rqs("#editAccCoordinatorName");
    const idHidden = rqs("#editAccCoordinatorUserId");
    const resultsBox = rqs("#editCoordinatorSearchResults");

    if (!nameInput || !resultsBox) return;
    if (nameInput.__editCoordBound) return;
    nameInput.__editCoordBound = true;

    const run = debounce(async () => {
      const q = String(nameInput.value || "").trim();
      if (q.length < 2) {
        resultsBox.style.display = "none";
        resultsBox.innerHTML = "";
        return;
      }

      const items = await searchCoordinators(q);
      showEditCoordinatorResults(items);
    }, 250);

    nameInput.addEventListener("input", () => run().catch((e) => safeShowError(e.message)));
    nameInput.addEventListener("focus", () => run().catch(() => {}));

    resultsBox.addEventListener("click", (e) => {
      const item = e.target.closest(".coordinator-search-item[data-coordinator-id]");
      if (!item) return;

      const cid = item.getAttribute("data-coordinator-id") || "";
      const name = item.getAttribute("data-full-name") || "";

      if (idHidden) idHidden.value = cid;
      if (nameInput) nameInput.value = name;

      hideEditCoordinatorResults();
    });
  }

  function showEditCoordinatorResults(items) {
    const box = rqs("#editCoordinatorSearchResults");
    if (!box) return;

    if (!items || !items.length) {
      box.innerHTML = `<div class="coordinator-search-item text-muted">No matches</div>`;
      box.style.display = "";
      return;
    }

    box.innerHTML = items
      .map((c) => {
        const id = escapeHtml(c.id);
        const fullName = escapeHtml(c.full_name || "");
        const idNumber = escapeHtml(c.id_number || "");

        return `
          <div class="coordinator-search-item"
               data-coordinator-id="${id}"
               data-full-name="${fullName}">
            <div class="coordinator-name">${fullName || "—"}</div>
            <div class="coordinator-id">${idNumber}</div>
          </div>
        `;
      })
      .join("");

    box.style.display = "";
  }

  function hideEditCoordinatorResults() {
    const box = rqs("#editCoordinatorSearchResults");
    if (!box) return;
    box.style.display = "none";
  }
  // -------------------------
  // Moderator (org_president) search for edit modal
  // -------------------------
  async function searchPresidents(q) {
    const data = await postJSON({
      action: "search_coordinators",
      q: q || "",
      role: "org_president",
      limit: 25,
    });
    if (!data?.ok) throw new Error(data?.message || "Failed to search presidents.");
    return data.items || [];
  }

  function bindEditModeratorSearch() {
    const nameInput = rqs("#editAccModeratorName");
    const idHidden = rqs("#editAccModeratorUserId");
    const resultsBox = rqs("#editModeratorSearchResults");

    if (!nameInput || !resultsBox) return;
    if (nameInput.__editModBound) return;
    nameInput.__editModBound = true;

    const run = debounce(async () => {
      const q = String(nameInput.value || "").trim();
      if (q.length < 2) {
        resultsBox.style.display = "none";
        resultsBox.innerHTML = "";
        return;
      }
      const items = await searchPresidents(q);
      showEditModeratorResults(items);
    }, 250);

    nameInput.addEventListener("input", () => run().catch((e) => safeShowError(e.message)));
    nameInput.addEventListener("focus", () => run().catch(() => {}));

    resultsBox.addEventListener("click", (e) => {
      const item = e.target.closest(".coordinator-search-item[data-coordinator-id]");
      if (!item) return;

      const cid = item.getAttribute("data-coordinator-id") || "";
      const name = item.getAttribute("data-full-name") || "";
      const courseYear = item.getAttribute("data-course-year") || "";

      if (idHidden) idHidden.value = cid;
      if (nameInput) nameInput.value = name;

      // Show turnover warning if this differs from the original moderator
      const currentModId = String(rqs("#editAccModeratorCurrentId")?.value || "");
      const warningEl = rqs("#editModeratorTurnoverWarning");
      if (warningEl) {
        warningEl.style.display = (currentModId && String(cid) !== currentModId) ? "" : "none";
      }

      // Auto-populate the President / Chairperson officer field (index 0)
      const presidentNameInput = rqs("#edit_officer_0_full_name");
      const presidentIdHidden = rqs("#edit_officer_0_student_id");
      const presidentCourseInput = rqs("#edit_officer_0_course_year");

      if (presidentNameInput) presidentNameInput.value = name;
      if (presidentIdHidden) presidentIdHidden.value = cid;
      if (presidentCourseInput && courseYear) presidentCourseInput.value = courseYear;

      hideEditModeratorResults();
    });
  }

  function showEditModeratorResults(items) {
    const box = rqs("#editModeratorSearchResults");
    if (!box) return;

    if (!items || !items.length) {
      box.innerHTML = `<div class="coordinator-search-item text-muted">No matches found.</div>`;
      box.style.display = "";
      return;
    }

    box.innerHTML = items
      .map((c) => {
        const id = escapeHtml(c.id);
        const fullName = escapeHtml(c.full_name || "");
        const idNumber = escapeHtml(c.id_number || "");
        const courseYear = escapeHtml(c.course_year || "");

        return `
          <div class="coordinator-search-item"
               data-coordinator-id="${id}"
               data-full-name="${fullName}"
               data-course-year="${courseYear}">
            <div class="coordinator-name">${fullName || "—"}</div>
            <div class="coordinator-id">${idNumber}${courseYear ? ` • ${courseYear}` : ""}</div>
          </div>
        `;
      })
      .join("");

    box.style.display = "";
  }

  function hideEditModeratorResults() {
    const box = rqs("#editModeratorSearchResults");
    if (!box) return;
    box.style.display = "none";
  }

  function getEditSelectedOfficerIds(excludeIndex = null) {
    const set = new Set();
    for (let i = 0; i < 5; i++) {
      if (excludeIndex != null && Number(excludeIndex) === i) continue;
      const hid = rqs(`#edit_officer_${i}_student_id`);
      const v = String(hid?.value || "").trim();
      if (v) set.add(v);
    }
    const dynamicRows = qsa(".edit-dynamic-officer-row");
    dynamicRows.forEach((row, idx) => {
      const actualIdx = row.getAttribute('data-dynamic-index') || (5 + idx);
      if (excludeIndex != null && Number(excludeIndex) === actualIdx) return;
      const hid = row.querySelector(`#edit_officer_${actualIdx}_student_id`);
      const v = String(hid?.value || "").trim();
      if (v) set.add(v);
    });
    return set;
  }

  function getEditModalProgramFilter() {
    const orgType = String(rqs("#editAccOrgType")?.value || "Organization");
    if (orgType === "Club") return null;

    const scope = currentEditScopeValue();
    if (scope !== "Exclusive") return null;
    const pid = Number(rqs("#editAccProgramId")?.value || 0);
    return pid || null;
  }

  function getEditModalProgramName() {
    const orgType = String(rqs("#editAccOrgType")?.value || "Organization");
    if (orgType === "Club") return null;

    const scope = currentEditScopeValue();
    if (scope !== "Exclusive") return null;

    const programSelect = rqs("#editAccProgramId");
    if (!programSelect) return null;

    const selectedOption = programSelect.options[programSelect.selectedIndex];
    if (!selectedOption || selectedOption.value === "") return null;

    const optionText = selectedOption.textContent || "";
    const programName = optionText.split("—")[0]?.trim();
    return programName || null;
  }

  function showEditOfficerResults(index, items, isDynamic = false) {
    const box = rqs(`#edit_searchResults_${index}`);
    if (!box) return;

    if (!items || !items.length) {
      box.innerHTML = `<div class="student-search-item text-muted">No matches</div>`;
      box.style.display = "";
      return;
    }

    box.innerHTML = items
      .map((s) => {
        const id = escapeHtml(s.id);
        const fullName = escapeHtml(
          s.full_name || [s.first_name, s.middle_name, s.last_name].filter(Boolean).join(" ")
        );

        let courseYear = "";

        if (s.course_year) {
          courseYear = escapeHtml(s.course_year);
        }
        else if (s.program && s.year_level) {
          const yearText = getYearText(s.year_level);
          courseYear = escapeHtml(`${s.program} ${yearText}`);
        }
        else if (s.program) {
          courseYear = escapeHtml(s.program);
        }
        else if (s.year_level) {
          const yearText = getYearText(s.year_level);
          courseYear = escapeHtml(yearText);
        }
        else if (s.program_abbr && s.year_level) {
          const yearText = getYearText(s.year_level);
          courseYear = escapeHtml(`${s.program_abbr} ${yearText}`);
        }
        else if (s.program_name && s.year_level) {
          const yearText = getYearText(s.year_level);
          const programAbbr =
            s.program_abbr || s.program_name.split(" ").map((word) => word[0]).join("").toUpperCase();
          courseYear = escapeHtml(`${programAbbr} ${yearText}`);
        }

        return `
          <div class="student-search-item"
               data-student-id="${id}"
               data-full-name="${fullName}"
               data-course-year="${courseYear}">
            <div class="student-name">${fullName || "—"}</div>
          </div>
        `;
      })
      .join("");

    box.style.display = "";
  }

  function hideEditOfficerResults(index) {
    const box = rqs(`#edit_searchResults_${index}`);
    if (!box) return;
    box.style.display = "none";
  }

  function bindEditOfficerRowSearch(index, isDynamic = false) {
  let nameInput, idHidden, courseInput, resultsBox;
  
  if (isDynamic) {
    nameInput = rqs(`#edit_officer_${index}_full_name`);
    idHidden = rqs(`#edit_officer_${index}_student_id`);
    courseInput = rqs(`#edit_officer_${index}_course_year`);
    resultsBox = rqs(`#edit_searchResults_${index}`);
  } else {
    nameInput = rqs(`#edit_officer_${index}_full_name`);
    idHidden = rqs(`#edit_officer_${index}_student_id`);
    courseInput = rqs(`#edit_officer_${index}_course_year`);
    resultsBox = rqs(`#edit_searchResults_${index}`);
  }

  if (!nameInput || !resultsBox) {
    console.log(`Missing edit elements for officer ${index}:`, { nameInput, resultsBox });
    return;
  }
  
  if (nameInput.__editOffBound) return;
  nameInput.__editOffBound = true;

  const run = debounce(async () => {
    const q = String(nameInput.value || "").trim();
    if (q.length < 2) {
      resultsBox.style.display = "none";
      resultsBox.innerHTML = "";
      return;
    }

    const programId = getEditModalProgramFilter();
    const programName = getEditModalProgramName();

    try {
      const items = await searchStudents(q, programId, programName);
      const filtered = items || [];
      showEditOfficerResults(index, filtered, isDynamic);
    } catch (e) {
      safeShowError(e.message);
    }
  }, 250);

  nameInput.addEventListener("input", () => {
    run();
  });
  
  nameInput.addEventListener("focus", () => {
    run();
  });

  resultsBox.addEventListener("click", (e) => {
    const item = e.target.closest(".student-search-item[data-student-id]");
    if (!item) return;

    const sid = item.getAttribute("data-student-id") || "";
    const full = item.getAttribute("data-full-name") || "";
    const cy = item.getAttribute("data-course-year") || "";

    // President (index 0) is controlled via the Moderator search field — skip direct row search
    if (index === 0) return;

    if (idHidden) idHidden.value = sid;
    if (nameInput) nameInput.value = full;
    if (courseInput) courseInput.value = cy;

    resultsBox.style.display = "none";
    resultsBox.innerHTML = "";
  });

  nameInput.addEventListener("input", () => {
    const q = String(nameInput.value || "").trim();
    if (q.length === 0) {
      if (courseInput) {
        courseInput.value = "";
      }
      if (idHidden) {
        idHidden.value = "";
      }
    }
  });
  }

  // Add dynamic officer row in edit modal
  function addEditDynamicOfficerRow() {
    const container = rqs("#editDynamicOfficersContainer");
    if (!container) return;

    // Find the highest index used
    let maxIndex = 4; // Start after hardcoded (0-4)
    const existingRows = qsa(".edit-dynamic-officer-row");
    existingRows.forEach(row => {
      const idx = row.getAttribute('data-dynamic-index');
      if (idx && parseInt(idx) > maxIndex) maxIndex = parseInt(idx);
    });
    const newIndex = maxIndex + 1;

    const rowHtml = `
      <tr class="edit-dynamic-officer-row" data-dynamic-index="${newIndex}">
        <td>
          <input type="text" class="form-control" name="edit_officers[${newIndex}][position]" 
                 placeholder="e.g., P.R.O., Sergeant-at-Arms" required>
          <input type="hidden" name="edit_officers[${newIndex}][id]" id="edit_officer_${newIndex}_id" value="0">
          <input type="hidden" name="edit_officers[${newIndex}][student_id]" id="edit_officer_${newIndex}_student_id">
        </td>
        <td>
          <div class="student-search-container">
            <div class="input-group">
              <input class="form-control" name="edit_officers[${newIndex}][full_name]" 
                     id="edit_officer_${newIndex}_full_name"
                     placeholder="Search student..." required
                     data-search-target="#edit_officer_${newIndex}_student_id"
                     data-course-target="#edit_officer_${newIndex}_course_year"
                     autocomplete="off">
              <button class="btn btn-outline-secondary" type="button" 
                      onclick="window.ADAccreditation?.editSearchDynamicStudent(${newIndex})">
                <i class="bi bi-search"></i>
              </button>
            </div>
            <div class="student-search-results" id="edit_searchResults_${newIndex}"></div>
          </div>
        </td>
        <td>
          <input class="form-control" name="edit_officers[${newIndex}][course_year]" 
                 id="edit_officer_${newIndex}_course_year"
                 placeholder="Will auto-fill" readonly>
        </td>
        <td>
          <select class="form-select" name="edit_officers[${newIndex}][status]">
            <option value="Active">Active</option>
            <option value="Inactive">Inactive</option>
          </select>
        </td>
        <td class="text-center">
          <button type="button" class="btn btn-sm btn-outline-danger" onclick="this.closest('tr').remove()">
            <i class="bi bi-trash"></i>
          </button>
        </td>
      </tr>
    `;

    container.insertAdjacentHTML('beforeend', rowHtml);
    
    // Bind search for this new row
    bindEditOfficerRowSearch(newIndex, true);
  }

  window.editSearchStudent = async function (index) {
    const nameInput = rqs(`#edit_officer_${index}_full_name`);
    if (!nameInput) return;
    nameInput.focus();

    const q = String(nameInput.value || "").trim();
    if (q.length < 2) return;

    try {
      const programId = getEditModalProgramFilter();
      const programName = getEditModalProgramName();
      const items = await searchStudents(q, programId, programName);

      // REMOVED: Cross-organization filtering
      const filtered = items || [];

      showEditOfficerResults(index, filtered);
    } catch (e) {
      safeShowError(e.message);
    }
  };

  window.editSearchDynamicStudent = async function (index) {
    const nameInput = rqs(`#edit_officer_${index}_full_name`);
    if (!nameInput) return;
    nameInput.focus();

    const q = String(nameInput.value || "").trim();
    if (q.length < 2) return;

    try {
      const programId = getEditModalProgramFilter();
      const programName = getEditModalProgramName();
      const items = await searchStudents(q, programId, programName);

      const filtered = items || [];

      showEditOfficerResults(index, filtered, true);
    } catch (e) {
      safeShowError(e.message);
    }
  };

  // -------------------------
  // Open Edit Modal
  // -------------------------
  async function openEditModal(requestId) {
    try {
      const data = await postJSON({
        action: "get_request",
        request_id: requestId,
        docs_page: 1,
        docs_per_page: 10,
      });

      if (!data?.ok || !data?.request) {
        throw new Error("Failed to load organization data.");
      }

      const req = data.request;

      // Fill form fields
      rqs("#editOrgId").value = req.org_id;
      rqs("#editRequestId").value = requestId;
      rqs("#editAccOrgName").value = req.org_name || "";
      rqs("#editAccOrgAbbr").value = req.org_abbr || "";
      rqs("#editAccOrgDescription").value = req.description || "";
      rqs("#editAccOrgMission").value = req.mission || "";
      rqs("#editAccOrgVision").value = req.vision || "";
      rqs("#editAccOrgObjectives").value = req.objectives || "";
      rqs("#editAccOrgAdvocacy").value = req.advocacy || "";

      // Set organization type
      const orgType = req.org_type || "Organization";
      rqs("#editAccOrgType").value = orgType;

      // Set coordinator (faculty_admin)
      if (req.coordinator_user_id) {
        rqs("#editAccCoordinatorUserId").value = req.coordinator_user_id;
        rqs("#editAccCoordinatorName").value = req.coordinator_name || "";
      }

      // Set moderator (org_president who manages/submitted this org)
      const modUserId = req.moderator_user_id || "";
      const modName   = req.moderator_name   || "";
      const modIdHidden  = rqs("#editAccModeratorUserId");
      const modNameInput = rqs("#editAccModeratorName");
      const modCurrentId = rqs("#editAccModeratorCurrentId");
      if (modIdHidden)  modIdHidden.value  = modUserId;
      if (modNameInput) modNameInput.value = modName;
      if (modCurrentId) modCurrentId.value = modUserId; // keep original for warning comparison
      // Hide turnover warning on fresh open
      const warningEl = rqs("#editModeratorTurnoverWarning");
      if (warningEl) warningEl.style.display = "none";

      // Set scope
      const uiScope = req.scope || "General";
      if (orgType === "Club") {
        rqs("#editScopeGeneral").checked = true;
      } else {
        if (uiScope === "Exclusive") {
          rqs("#editScopeExclusive").checked = true;
        } else {
          rqs("#editScopeGeneral").checked = true;
        }
      }

      // Load programs and set selected
      await loadPrograms();

      const programSelect = rqs("#editAccProgramId");
      if (programSelect && req.program_id) {
        programSelect.value = String(req.program_id);
      }

      // Set fees
      if (orgType === "Club") {
        const clubFeeInput = rqs("#editAccMembershipFee");
        if (clubFeeInput) {
          clubFeeInput.value = req.membership_fee || "";
        }
      } else {
        const orgFeeInput = rqs("#editAccFeeRequired");
        if (orgFeeInput) {
          orgFeeInput.value = (Number(req.fee_required || 0) > 0) ? String(req.fee_required) : "";
        }
      }

      // Set renewal flags
      rqs("#editIsRenewal").value = req.is_renewal ? "1" : "0";
      rqs("#editPreviousRequestId").value = req.previous_request_id || "0";

      const isRenewal = req.is_renewal;
      const renewalNotice = rqs("#editRenewalNotice");
      if (renewalNotice) renewalNotice.style.display = isRenewal ? "inline" : "none";
      const regularNotice = rqs("#editRegularNotice");
      if (regularNotice) regularNotice.style.display = isRenewal ? "none" : "inline";

      // ✅ Load existing officers into the edit form
      const officersTbody = rqs("#editOfficersTbody");
      const dynamicContainer = rqs("#editDynamicOfficersContainer");
      if (dynamicContainer) dynamicContainer.innerHTML = ''; // Clear existing dynamic rows

      if (officersTbody) {
        if (req.officers && Array.isArray(req.officers)) {
          officersTbody.innerHTML = '';

          const positions = [
            'President / Chairperson',
            'Vice President',
            'Secretary',
            'Treasurer',
            'Auditor'
          ];

          // Hardcoded positions (0-4)
          for (let i = 0; i < positions.length; i++) {
            const position = positions[i];
            const officer = req.officers.find(o => o.position === position);

            // For index 0 (President), the name is populated via the Moderator search field
            // so we keep it readonly from direct typing but unlocked for programmatic update.
            const isPresident = (i === 0);
            const officerRow = `
              <tr class="officer-row off-row-required" data-index="${i}" data-required="1">
                <td>
                  <div class="off-pos">
                    <input class="form-control" name="edit_officers[${i}][position]" value="${escapeHtml(position)}" readonly required>
                  </div>
                  <input type="hidden" name="edit_officers[${i}][id]" id="edit_officer_${i}_id" value="${officer ? officer.id : 0}">
                  <input type="hidden" name="edit_officers[${i}][student_id]" id="edit_officer_${i}_student_id" value="${officer ? officer.user_id : ''}">
                </td>
                <td>
                  <div class="student-search-container">
                    <div class="input-group">
                      <input class="form-control" name="edit_officers[${i}][full_name]" id="edit_officer_${i}_full_name"
                             placeholder="${isPresident ? 'Updated via Moderator field above' : 'Search student...'}" required
                             data-search-target="#edit_officer_${i}_student_id"
                             data-course-target="#edit_officer_${i}_course_year"
                             value="${officer ? escapeHtml(officer.full_name) : ''}"
                             ${isPresident ? 'readonly title="Change the Moderator (org_president) field above to update this"' : ''}
                             autocomplete="off">
                      <button class="btn btn-outline-secondary" type="button" onclick="editSearchStudent(${i})" ${isPresident ? 'disabled title="Use the Moderator search above"' : ''}>
                        <i class="bi bi-search"></i>
                      </button>
                    </div>
                    <div class="student-search-results" id="edit_searchResults_${i}"></div>
                  </div>
                  ${isPresident ? '<div class="form-text text-muted small"><i class="bi bi-info-circle me-1"></i>Auto-filled from the Moderator field above.</div>' : ''}
                </td>
                <td>
                  <input class="form-control" name="edit_officers[${i}][course_year]" id="edit_officer_${i}_course_year"
                         placeholder="Will auto-fill" 
                         value="${officer ? escapeHtml(officer.course_year) : ''}"
                         readonly>
                </td>
                <td>
                  <select class="form-select" name="edit_officers[${i}][status]">
                    <option value="Active" ${officer && officer.status === 'Active' ? 'selected' : ''}>Active</option>
                    <option value="Inactive" ${officer && officer.status === 'Inactive' ? 'selected' : ''}>Inactive</option>
                  </select>
                </td>
                <td class="text-center">
                  <!-- No delete for hardcoded positions -->
                </td>
              </tr>
            `;

            officersTbody.innerHTML += officerRow;
          }

          // Dynamic officers (index >=5)
          const dynamicOfficers = req.officers.filter(o => 
            !positions.includes(o.position)
          );

          if (dynamicContainer) {
            dynamicOfficers.forEach((officer, idx) => {
              const dynamicIndex = 5 + idx;
              const officerRow = `
                <tr class="edit-dynamic-officer-row" data-dynamic-index="${dynamicIndex}">
                  <td>
                    <input type="text" class="form-control" name="edit_officers[${dynamicIndex}][position]" 
                           value="${escapeHtml(officer.position)}" required>
                    <input type="hidden" name="edit_officers[${dynamicIndex}][id]" id="edit_officer_${dynamicIndex}_id" value="${officer.id}">
                    <input type="hidden" name="edit_officers[${dynamicIndex}][student_id]" id="edit_officer_${dynamicIndex}_student_id" value="${officer.user_id}">
                  </td>
                  <td>
                    <div class="student-search-container">
                      <div class="input-group">
                        <input class="form-control" name="edit_officers[${dynamicIndex}][full_name]" 
                               id="edit_officer_${dynamicIndex}_full_name"
                               placeholder="Search student..." required
                               data-search-target="#edit_officer_${dynamicIndex}_student_id"
                               data-course-target="#edit_officer_${dynamicIndex}_course_year"
                               value="${escapeHtml(officer.full_name)}"
                               autocomplete="off">
                        <button class="btn btn-outline-secondary" type="button" 
                                onclick="editSearchDynamicStudent(${dynamicIndex})">
                          <i class="bi bi-search"></i>
                        </button>
                      </div>
                      <div class="student-search-results" id="edit_searchResults_${dynamicIndex}"></div>
                    </div>
                  </td>
                  <td>
                    <input class="form-control" name="edit_officers[${dynamicIndex}][course_year]" 
                           id="edit_officer_${dynamicIndex}_course_year"
                           placeholder="Will auto-fill" 
                           value="${escapeHtml(officer.course_year || '')}"
                           readonly>
                  </td>
                  <td>
                    <select class="form-select" name="edit_officers[${dynamicIndex}][status]">
                      <option value="Active" ${officer.status === 'Active' ? 'selected' : ''}>Active</option>
                      <option value="Inactive" ${officer.status === 'Inactive' ? 'selected' : ''}>Inactive</option>
                    </select>
                  </td>
                  <td class="text-center">
                    <button type="button" class="btn btn-sm btn-outline-danger" onclick="this.closest('tr').remove()">
                      <i class="bi bi-trash"></i>
                    </button>
                  </td>
                </tr>
              `;
              dynamicContainer.innerHTML += officerRow;
            });
          }
        }
      }

      // ✅ Load requirements for editing
      await loadEditRequirements(requestId, req.org_type, req.scope, req.program_id, req.is_renewal);

      // Update UI state
      syncEditModalProgramEnable();
      syncEditModalFeeFields();

      // Rebind officer search events
      for (let i = 0; i < 5; i++) bindEditOfficerRowSearch(i);
      const dynamicRows = qsa(".edit-dynamic-officer-row");
      dynamicRows.forEach((row) => {
        const index = row.getAttribute('data-dynamic-index');
        if (index) bindEditOfficerRowSearch(parseInt(index), true);
      });

      // Show modal
      const modalEl = rqs("#editOrgModal");
      if (modalEl && window.bootstrap) {
        bootstrap.Modal.getOrCreateInstance(modalEl).show();
      }
    } catch (e) {
      console.error("Error opening edit modal:", e);
      safeShowError(e.message);
    }
  }

  // -------------------------
  // Load Requirements for Edit Modal
  // -------------------------
  async function loadEditRequirements(requestId, orgType, scope, programId, isRenewal) {
    try {
      const data = await postJSON({
        action: "list_requirements_for_upload",
        org_type: orgType || "Organization",
        scope: scope || "General",
        program_id: programId || null,
        is_renewal: isRenewal ? 1 : 0,
        request_id: requestId,
        previous_request_id: isRenewal ? rqs("#editPreviousRequestId").value : null
      });

      const items = Array.isArray(data?.items) ? data.items : [];
      renderEditRequirementsTable(items, requestId);
    } catch (e) {
      console.error("Failed to load edit requirements:", e);
      safeShowError("Failed to load requirements.");
    }
  }

  // -------------------------
  // Render Requirements Table for Edit Modal
  // -------------------------
  function renderEditRequirementsTable(items, requestId) {
    const tbody = rqs("#editRequirementsUploadTbody");
    if (!tbody) return;

    if (!items.length) {
      tbody.innerHTML = `
        <tr>
          <td colspan="4" class="text-center text-muted py-4">
            No requirements found.
          </td>
        </tr>`;
      return;
    }

    tbody.innerHTML = items
      .map((req, i) => {
        const id = escapeHtml(req.id);
        const name = escapeHtml(req.requirement_name || req.name || "—");
        const applies = escapeHtml(req.applies_to || req.applies || "");
        const required = req.is_required != null ? !!req.is_required : true;

        const tplName = escapeHtml(
          req.template_name ||
          req.active_template_name ||
          req.active_template?.file_name ||
          req.active_template?.name ||
          ""
        );
        const tplUrl =
          req.template_url ||
          req.active_template_url ||
          req.active_template?.url ||
          req.active_template?.file_url ||
          "";

        const hasCurrent = req.has_current_document;
        const currentDoc = req.current_document;

        const hasPrevious = req.has_previous_document;
        const previousDoc = req.previous_document;
        const isNewRequirement = req.is_new_requirement;

        const tplCell = tplUrl
          ? `<div class="req-template-meta">
              <div class="fw-semibold sa-truncate">${tplName || "Template"}</div>
              <div class="d-flex gap-2 mt-1 flex-wrap req-template-actions">
                <button class="btn btn-outline-secondary btn-sm" type="button"
                        data-action="preview-template" data-url="${escapeHtml(tplUrl)}" data-name="${tplName || "Template"}">
                  <i class="bi bi-eye"></i> Preview
                </button>
                <a class="btn btn-outline-secondary btn-sm" href="${escapeHtml(tplUrl)}" target="_blank" rel="noopener">
                  <i class="bi bi-box-arrow-up-right"></i> Open
                </a>
              </div>
            </div>`
          : `<div class="text-muted small">No template</div>`;

        const accept =
          req.accept ||
          ".pdf,application/pdf";

        let hint = required ? "Required" : "Optional";

        if (hasCurrent && currentDoc) {
          hint += ` • <span class="text-success">Current: <a href="${escapeHtml(currentDoc.file_url || '#')}" target="_blank">${escapeHtml(currentDoc.file_name || 'File')}</a></span>`;
        } else if (hasPrevious && previousDoc) {
          hint += ` • Previously: <a href="${escapeHtml(previousDoc.file_url || '#')}" target="_blank">${escapeHtml(previousDoc.file_name || 'File')}</a>`;
        }

        if (isNewRequirement) {
          hint += ' • <span class="text-warning">New this term</span>';
        }

        let fileInputHtml = '';
        if (hasCurrent && currentDoc) {
          fileInputHtml = `
            <input class="form-control" type="file"
                  name="files[${id}]"
                  data-role="edit-req-file"
                  data-req-id="${id}"
                  data-request-id="${requestId}"
                  accept="${escapeHtml(accept)}"
                  data-has-current="true">
            <div class="form-text text-muted">Optional - Leave empty to keep current file</div>
          `;
        } else {
          fileInputHtml = `
            <input class="form-control" type="file"
                  name="files[${id}]"
                  data-role="edit-req-file"
                  data-req-id="${id}"
                  data-request-id="${requestId}"
                  accept="${escapeHtml(accept)}"
                  ${required ? "required" : ""}>
          `;
        }

        return `
          <tr data-req-id="${id}" data-required="${required ? "1" : "0"}" data-has-current="${hasCurrent ? "1" : "0"}">
            <td class="text-muted">${i + 1}</td>
            <td>
              <div class="req-name">${name}</div>
              <div class="req-meta">${applies ? `Applies: ${applies}` : ""}</div>
            </td>
            <td>${tplCell}</td>
            <td class="req-upload">
              ${fileInputHtml}
              <div class="req-meta mt-1">${hint}</div>
            </td>
          </tr>`;
      })
      .join("");

    if (!tbody.__editTplBound) {
      tbody.__editTplBound = true;
      tbody.addEventListener("click", (e) => {
        const btn = e.target.closest("[data-action='preview-template']");
        if (!btn) return;
        const url = btn.getAttribute("data-url");
        const name = btn.getAttribute("data-name") || "Template";
        if (url) openPreview(url, name);
      });
    }
  }

  // -------------------------
  // Submit Organization Edit
  // -------------------------
  async function submitOrganizationEdit() {
    const form = rqs("#editOrgForm");
    if (!form) return;

    if (typeof form.reportValidity === "function" && !form.reportValidity()) return;

    const orgId = rqs("#editOrgId").value;
    const requestId = rqs("#editRequestId").value;
    const orgType = String(rqs("#editAccOrgType")?.value || "Organization");
    const scope = currentEditScopeValue();
    const isRenewal = rqs("#editIsRenewal").value === "1";

    if (orgType === "Organization" && scope === "Exclusive") {
      const programId = String(rqs("#editAccProgramId")?.value || "");
      if (!programId) {
        safeShowError("Please select a program for Exclusive scope.");
        return;
      }
    }

    // Validate moderator (org_president) — required
    const newModeratorId = String(rqs("#editAccModeratorUserId")?.value || "").trim();
    if (!newModeratorId || newModeratorId === "0") {
      safeShowError("Please select the organization moderator (org_president).");
      return;
    }

    // ✅ Validate officers
    const seen = new Set();
    seen.add(newModeratorId); // president is the moderator — pre-mark to catch duplicates below
    for (let i = 0; i < 5; i++) {
      const hid = rqs(`#edit_officer_${i}_student_id`);
      const name = rqs(`#edit_officer_${i}_full_name`);
      if (hid && name) {
        const v = String(hid.value || "").trim();
        if (i === 0) {
          // President is auto-populated from the moderator search — just trust it
          continue;
        } else if (name.required) {
          if (!v) {
            safeShowError(
              `Please pick a student for: ${
                rqs(`#edit_officer_${i}_full_name`)?.closest("tr")?.querySelector("[name*='[position]']")?.value || "Officer"
              }.`
            );
            return;
          }
          if (seen.has(v)) {
            safeShowError("Duplicate officer detected. Please select different students for each officer.");
            return;
          }
          seen.add(v);
        }
      }
    }

    // Validate dynamic officers
    const dynamicRows = qsa(".edit-dynamic-officer-row");
    for (const row of dynamicRows) {
      const positionInput = row.querySelector("[name*='[position]']");
      const hid = row.querySelector("[name*='[student_id]']");
      const nameInput = row.querySelector("[name*='[full_name]']");

      if (!positionInput || !hid || !nameInput) continue;

      const position = positionInput.value.trim();
      const studentId = hid.value.trim();

      if (position === "") {
        safeShowError("Please enter a position for all officer rows.");
        return;
      }

      if (studentId === "") {
        safeShowError(`Please select a student for position: ${position}`);
        return;
      }

      if (seen.has(studentId)) {
        safeShowError(`Duplicate officer detected for position: ${position}. Please select different students.`);
        return;
      }
      seen.add(studentId);
    }

    // ✅ Validate required file uploads
    const fileInputs = rqsa("[data-role='edit-req-file']", form);
    const missingRequiredFiles = [];

    for (const inp of fileInputs) {
      const required = inp.closest("tr")?.getAttribute("data-required") === "1";
      if (required && !inp.files?.length && !inp.hasAttribute('data-has-current')) {
        const reqName = inp.closest("tr")?.querySelector(".req-name")?.textContent || "Requirement";
        missingRequiredFiles.push(reqName);
      }
    }

    if (missingRequiredFiles.length > 0) {
      safeShowError(`Please upload all required documents: ${missingRequiredFiles.join(", ")}`);
      return;
    }

    const fd = new FormData(form);
    fd.append("action", "update_organization");
    fd.append("org_id", orgId);
    fd.append("request_id", requestId);
    fd.append("org_name", rqs("#editAccOrgName").value.trim());
    fd.append("abbreviation", rqs("#editAccOrgAbbr").value.trim());
    fd.append("org_type", orgType);
    fd.append("scope", scope);
    fd.append("program_id", rqs("#editAccProgramId")?.value || 0);
    fd.append("description", rqs("#editAccOrgDescription").value.trim());
    fd.append("mission", rqs("#editAccOrgMission").value.trim());
    fd.append("vision", rqs("#editAccOrgVision").value.trim());
    fd.append("objectives", rqs("#editAccOrgObjectives").value.trim());
    fd.append("advocacy", rqs("#editAccOrgAdvocacy").value.trim());

    // Add coordinator (faculty_admin)
    fd.append("coordinator_user_id", rqs("#editAccCoordinatorUserId")?.value || 0);

    // Add moderator (org_president who manages the org — may have changed via turnover)
    fd.append("moderator_user_id", rqs("#editAccModeratorUserId")?.value || 0);

    if (orgType === "Organization") {
      const val = String(rqs("#editAccFeeRequired")?.value || "").trim();
      fd.append("fee_required", val === "" ? "0" : val);
    } else {
      fd.append("fee_required", "0");
    }

    fd.append("membership_fee", orgType === "Club" ? (parseFloat(rqs("#editAccMembershipFee")?.value) || 0) : 0);

    // Add requirement IDs
    const reqIds = fileInputs.map(inp => inp.getAttribute("data-req-id")).filter(Boolean);
    fd.append("requirement_ids", JSON.stringify(reqIds));

    // Add files
    for (const inp of fileInputs) {
      const reqId = inp.getAttribute("data-req-id");
      const file = inp.files && inp.files[0];
      if (reqId && file) fd.append(`files[${reqId}]`, file);
    }

    const btn = rqs("#saveEditOrgBtn");
    const oldHtml = btn ? btn.innerHTML : "";
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = `<span class="spinner-border spinner-border-sm me-2"></span>Saving…`;
    }

    try {
      const data = await postForm(fd);

      safeShowSuccess(data?.message || "Organization updated successfully.");

      const modalEl = rqs("#editOrgModal");
      if (modalEl && window.bootstrap) bootstrap.Modal.getOrCreateInstance(modalEl).hide();

      // Refresh the lists
      bus.emit("refresh:all");
    } catch (error) {
      safeShowError(error.message);
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = oldHtml || `<i class="bi bi-save me-1"></i> Save Changes`;
      }
    }
  }

  // -------------------------
  // Requirements loader + submit
  // -------------------------
  function reqKey() {
    const typeVal = String(rqs("#accOrgType")?.value || "Organization");
    const scopeVal = currentScopeValue();
    const programId = String(rqs("#accProgramId")?.value || "");
    return `${typeVal}::${scopeVal}::${programId}`;
  }

  async function fetchRequirementsForModal() {
    const key = reqKey();
    if (store.reqUpload.loadedKey === key && store.reqUpload.items.length) return;

    const orgType = String(rqs("#accOrgType")?.value || "Organization");
    const scope = currentScopeValue();
    const programId = String(rqs("#accProgramId")?.value || "");

    let data = null;

    try {
      data = await postJSON({
        action: "list_requirements_for_upload",
        org_type: orgType,
        scope,
        program_id: programId || null,
      });
    } catch {
      const applies = scope === "Club" ? "Clubs" : scope;
      data = await postJSON({
        action: "list_requirements",
        applies_to: applies,
        org_type: orgType,
        program_id: programId || null,
      });
    }

    const items = Array.isArray(data?.items)
      ? data.items
      : Array.isArray(data?.requirements)
        ? data.requirements
        : [];

    store.reqUpload.items = items;
    store.reqUpload.loadedKey = key;

    renderRequirementsUploadTable();
  }

  function renderRequirementsUploadTable() {
    const tbody = rqs("#requirementsUploadTbody");
    if (!tbody) return;

    const items = store.reqUpload.items || [];
    if (!items.length) {
      tbody.innerHTML = `
        <tr>
          <td colspan="4" class="text-center text-muted py-4">
            No requirements found for the selected scope/type.
          </td>
        </tr>`;
      return;
    }

    tbody.innerHTML = items
      .map((req, i) => {
        const id = escapeHtml(req.id);
        const name = escapeHtml(req.requirement_name || req.name || "—");
        const applies = escapeHtml(req.applies_to || req.applies || "");
        const required = req.is_required != null ? !!req.is_required : true;

        const tplName = escapeHtml(
          req.template_name ||
          req.active_template_name ||
          req.active_template?.file_name ||
          req.active_template?.name ||
          ""
        );
        const tplUrl =
          req.template_url ||
          req.active_template_url ||
          req.active_template?.url ||
          req.active_template?.file_url ||
          "";

        const tplCell = tplUrl
          ? `<div class="req-template-meta">
              <div class="fw-semibold sa-truncate">${tplName || "Template"}</div>
              <div class="d-flex gap-2 mt-1 flex-wrap req-template-actions">
                <button class="btn btn-outline-secondary btn-sm" type="button"
                        data-action="preview-template" data-url="${escapeHtml(tplUrl)}" data-name="${tplName || "Template"}">
                  <i class="bi bi-eye"></i> Preview
                </button>
                <a class="btn btn-outline-secondary btn-sm" href="${escapeHtml(tplUrl)}" target="_blank" rel="noopener">
                  <i class="bi bi-box-arrow-up-right"></i> Open
                </a>
              </div>
            </div>`
          : `<div class="text-muted small">No template</div>`;

        const accept =
          req.accept ||
          ".pdf,.docx,image/*,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document";
        const hint = req.hint || (required ? "Required" : "Optional");

        return `
          <tr data-req-id="${id}" data-required="${required ? "1" : "0"}">
            <td class="text-muted">${i + 1}</td>
            <td>
              <div class="req-name">${name}</div>
              <div class="req-meta">${applies ? `Applies: ${applies}` : ""}</div>
            </td>
            <td>${tplCell}</td>
            <td class="req-upload">
              <input class="form-control" type="file"
                     name="files[${id}]"
                     data-role="req-file"
                     data-req-id="${id}"
                     accept="${escapeHtml(accept)}"
                     ${required ? "required" : ""}>
              <div class="req-meta mt-1">${escapeHtml(hint)}</div>
            </td>
          </tr>`;
      })
      .join("");

    if (!tbody.__adTplBound) {
      tbody.__adTplBound = true;
      tbody.addEventListener("click", (e) => {
        const btn = e.target.closest("[data-action='preview-template']");
        if (!btn) return;
        const url = btn.getAttribute("data-url");
        const name = btn.getAttribute("data-name") || "Template";
        if (url) openPreview(url, name);
      });
    }
  }

  async function submitNewAccreditation() {
    const form = rqs("#addOrgForm");
    if (!form) return;

    if (typeof form.reportValidity === "function" && !form.reportValidity()) return;

    const orgType = getAddModalOrgType();
    const scope = currentScopeValue();

    if (orgType === "Organization" && scope === "Exclusive") {
      const programId = String(rqs("#accProgramId")?.value || "");
      if (!programId) {
        safeShowError("Please select a program for Exclusive scope.");
        return;
      }
    }

    // ✅ Enforce selected officer IDs (no duplicates)
    const seen = new Set();
    for (let i = 0; i < 5; i++) {
      const hid = rqs(`#officer_${i}_student_id`);
      const name = rqs(`#officer_${i}_full_name`);
      if (hid && name && name.required) {
        const v = String(hid.value || "").trim();
        if (!v) {
          safeShowError(
            `Please pick a student for: ${
              rqs(`#officer_${i}_full_name`)?.closest("tr")?.querySelector("[name*='[position]']")?.value || "Officer"
            }.`
          );
          return;
        }
        if (seen.has(v)) {
          safeShowError("Duplicate officer detected. Please select different students for each officer.");
          return;
        }
        seen.add(v);
      }
    }

    // Validate dynamic officers
    const dynamicRows = qsa(".dynamic-officer-row");
    for (const row of dynamicRows) {
      const positionInput = row.querySelector("[name*='[position]']");
      const hid = row.querySelector("[name*='[student_id]']");
      const nameInput = row.querySelector("[name*='[full_name]']");

      if (!positionInput || !hid || !nameInput) continue;

      const position = positionInput.value.trim();
      const studentId = hid.value.trim();

      if (position === "") {
        safeShowError("Please enter a position for all officer rows.");
        return;
      }

      if (studentId === "") {
        safeShowError(`Please select a student for position: ${position}`);
        return;
      }

      if (seen.has(studentId)) {
        safeShowError(`Duplicate officer detected for position: ${position}. Please select different students.`);
        return;
      }
      seen.add(studentId);
    }

    // Validate coordinator
    const coordinatorId = rqs("#accCoordinatorUserId")?.value;
    if (!coordinatorId || coordinatorId === "0") {
      safeShowError("Please select a coordinator (faculty_admin).");
      return;
    }

    const fileInputs = rqsa("[data-role='req-file']", form);
    const reqIds = [];
    for (const inp of fileInputs) {
      const reqId = inp.getAttribute("data-req-id");
      const required = inp.closest("tr")?.getAttribute("data-required") === "1";
      if (reqId) reqIds.push(String(reqId));
      if (required && !inp.files?.length) {
        safeShowError("Please upload all required documents.");
        return;
      }
    }

    const fd = new FormData(form);
    fd.append("action", "submit_request");
    fd.append("org_type", orgType);
    fd.append("scope", scope);
    fd.append("term_id", store.activeTerm?.id != null ? String(store.activeTerm.id) : "");
    fd.append("coordinator_user_id", coordinatorId);

    const memInput = rqs("#accMembershipFee");
    const reqInput = rqs("#accFeeRequired");

    if (memInput && String(memInput.value || "").trim() !== "") {
      fd.append("membership_fee", String(memInput.value || "").trim());
    }

    if (reqInput && orgType === "Organization") {
      const val = String(reqInput.value || "").trim();
      fd.append("fee_required", val === "" ? "0" : val);
    }

    fd.append("requirement_ids", JSON.stringify(reqIds));

    for (const inp of fileInputs) {
      const reqId = inp.getAttribute("data-req-id");
      const file = inp.files && inp.files[0];
      if (reqId && file) fd.append(`files[${reqId}]`, file);
    }

    const btn = rqs("#saveAddOrgBtn");
    const oldHtml = btn ? btn.innerHTML : "";
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = `<span class="spinner-border spinner-border-sm me-2"></span>Submitting…`;
    }

    try {
      const data = await postForm(fd);

      safeShowSuccess(data?.message || "Submitted.");
      store.canSubmit = false;
      store.myRequestId = data?.request_id != null ? String(data.request_id) : store.myRequestId;
      applySubmitUI();

      const modalEl = rqs("#addOrgModal");
      if (modalEl && window.bootstrap) bootstrap.Modal.getOrCreateInstance(modalEl).hide();

      bus.emit("refresh:all");
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = oldHtml || `<i class="bi bi-send-check me-1"></i> Submit`;
      }
    }
  }

  // -------------------------
  // Table button rendering helper
  // -------------------------
  function renderTableActions(item) {
    // Edit button - shown for editable statuses
    const canEdit = item.status === 'Active' || item.status === 'Returned' || item.status === 'Recommended' || item.status === 'Pending' || item.status === 'Draft';
    const editBtn = canEdit ? `
      <button class="btn btn-sm btn-outline-primary" 
              onclick="window.ADAccreditation?.openEditModal('${item.id}')"
              data-bs-toggle="tooltip" title="Edit Organization">
        <i class="bi bi-pencil"></i>
      </button>
    ` : '';

    const viewBtn = `
      <button class="btn btn-sm btn-outline-secondary" 
              onclick="window.ADAccreditation?.openViewModal('${item.id}')"
              data-bs-toggle="tooltip" title="View Details">
        <i class="bi bi-eye"></i>
      </button>
    `;

    return `
      <div class="d-flex gap-1 justify-content-end">
        ${editBtn}
        ${viewBtn}
      </div>
    `;
  }

  // -------------------------
  // View Request Modal
  // -------------------------
  async function openViewModal(requestId) {
    try {
      console.log("Opening view modal for request:", requestId);

      const data = await postJSON({
        action: "get_request",
        request_id: requestId,
        docs_page: 1,
        docs_per_page: 8,
      });

      if (!data?.ok || !data?.request) {
        throw new Error("Failed to load request details.");
      }

      const req = data.request;
      console.log("Request data loaded:", req);

      const modalEl = rqs("#adViewRequestModal");
      if (!modalEl) {
        console.error("View modal element #adViewRequestModal not found!");
        safeShowError("View modal not found in page.");
        return;
      }

      // Set basic info with null checks
      const requestIdEl = rqs("#adViewRequestId");
      if (requestIdEl) requestIdEl.value = requestId;
      
      const subEl = rqs("#adViewReqSub");
      if (subEl) subEl.textContent = `ID: ${requestId} • ${req.org_name || ""}`;
      
      const orgNameEl = rqs("#adOrgName");
      if (orgNameEl) orgNameEl.textContent = req.org_name || "—";
      
      const orgAbbrEl = rqs("#adOrgAbbr");
      if (orgAbbrEl) orgAbbrEl.textContent = req.org_abbr || "—";
      
      const orgScopeEl = rqs("#adOrgScope");
      if (orgScopeEl) orgScopeEl.textContent = req.scope || "—";
      
      const orgProgramEl = rqs("#adOrgProgram");
      if (orgProgramEl) orgProgramEl.textContent = req.program || "—";
      
      const orgTermEl = rqs("#adOrgTerm");
      if (orgTermEl) orgTermEl.textContent = req.term_label || "—";
      
      // Format dates
      const submittedAt = req.submitted_at ? formatDate(req.submitted_at) : "—";
      const updatedAt = req.updated_at ? formatDate(req.updated_at) : "—";
      
      const submittedEl = rqs("#adSubmittedAt");
      if (submittedEl) submittedEl.textContent = submittedAt;
      
      const updatedEl = rqs("#adUpdatedAt");
      if (updatedEl) updatedEl.textContent = updatedAt;
      
      // Status badge
      const statusEl = rqs("#adReqStatus");
      if (statusEl) {
        statusEl.textContent = req.status || "—";
        statusEl.className = "badge px-3 py-2";
        if (req.status === "Active") statusEl.classList.add("text-bg-success");
        else if (req.status === "Returned") statusEl.classList.add("text-bg-warning");
        else if (req.status === "Pending") statusEl.classList.add("text-bg-secondary");
        else if (req.status === "Approved") statusEl.classList.add("text-bg-primary");
        else if (req.status === "Recommended") statusEl.classList.add("text-bg-info");
        else if (req.status === "Draft") statusEl.classList.add("text-bg-light");
        else statusEl.classList.add("text-bg-dark");
      }

      // Logo
      const logoImg = rqs("#adOrgLogoImg");
      const logoFallback = rqs("#adOrgLogoFallback");
      if (logoImg && logoFallback) {
        if (req.logo_url) {
          logoImg.src = req.logo_url;
          logoImg.style.display = "block";
          logoFallback.style.display = "none";
        } else {
          logoImg.style.display = "none";
          logoFallback.style.display = "block";
        }
      }

      // Set organization details
      const typeDetailEl = rqs("#adOrgTypeDetail");
      if (typeDetailEl) typeDetailEl.textContent = req.org_type || "—";
      
      const scopeDetailEl = rqs("#adOrgScopeDetail");
      if (scopeDetailEl) scopeDetailEl.textContent = req.scope || "—";
      
      const programDetailEl = rqs("#adOrgProgramDetail");
      if (programDetailEl) programDetailEl.textContent = req.program || "—";
      
      const coordinatorDetailEl = rqs("#adCoordinatorDetail");
      if (coordinatorDetailEl) coordinatorDetailEl.textContent = req.coordinator_name || "—";
      
      // Fee information
      let feeDetail = "No fee";
      if (req.org_type === "Club" && req.membership_fee > 0) {
        feeDetail = `Club Membership: ₱${parseFloat(req.membership_fee).toFixed(2)}`;
      } else if (req.org_type === "Organization" && Number(req.fee_required || 0) > 0) {
        feeDetail = `Organization Fee Required: ₱${Number(req.fee_required).toFixed(2)}`;
      } else if (req.org_type === "Organization") {
        feeDetail = "No required fee";
      }
      
      const feeDetailEl = rqs("#adOrgFeeDetail");
      if (feeDetailEl) feeDetailEl.textContent = feeDetail;
      
      // Mission, Vision, Objectives, Advocacy
      const descEl = rqs("#adOrgDescription");
      if (descEl) descEl.textContent = req.description || "—";
      
      const missionEl = rqs("#adOrgMission");
      if (missionEl) missionEl.textContent = req.mission || "—";
      
      const visionEl = rqs("#adOrgVision");
      if (visionEl) visionEl.textContent = req.vision || "—";
      
      const objectivesEl = rqs("#adOrgObjectives");
      if (objectivesEl) objectivesEl.textContent = req.objectives || "—";
      
      const advocacyEl = rqs("#adOrgAdvocacy");
      if (advocacyEl) advocacyEl.textContent = req.advocacy || "—";

      // Load officers
      const officersTbody = rqs("#adOfficersTbody");
      const officersCount = rqs("#adOfficersCount");
      
      if (officersTbody) {
        if (req.officers && Array.isArray(req.officers)) {
          renderOfficersTable(req.officers);
          if (officersCount) officersCount.textContent = req.officers.length;
        } else {
          officersTbody.innerHTML = `
            <tr>
              <td colspan="6" class="text-center text-muted py-4">
                <i class="bi bi-people fs-4 d-block mb-2"></i>
                No officers found.
              </td>
            </tr>`;
          if (officersCount) officersCount.textContent = "0";
        }
      }

      // Load documents
      const docsTbody = rqs("#adDocsTbody");
      const docsCount = rqs("#adDocumentsCount");
      
      store.docs.items = data.request.docs || [];
      store.docs.page = data.docs_paging?.page || 1;
      store.docs.perPage = data.docs_paging?.per_page || 8;
      store.docs.total = data.docs_paging?.total || 0;
      store.docs.requestId = requestId;

      if (docsCount) docsCount.textContent = store.docs.total;
      
      // Render documents table
      renderDocumentsTable();
      
      // Setup pagination
      const paginationEl = rqs("#adDocsPagination");
      const paginationMetaEl = rqs("#adDocsPaginationMeta");
      const docsMetaEl = rqs("#adDocsMeta");
      
      if (paginationEl && paginationMetaEl) {
        renderPagination(
          paginationEl,
          paginationMetaEl,
          store.docs.page,
          store.docs.perPage,
          store.docs.total,
          (page) => {
            loadRequestDocuments(requestId, page);
          }
        );
      }
      
      if (docsMetaEl) {
        docsMetaEl.textContent = data.docs_meta || "";
      }

      // Show modal
      if (window.bootstrap) {
        const modal = new bootstrap.Modal(modalEl);
        modal.show();
        
        // Initialize tab functionality
        const tabTriggerList = modalEl.querySelectorAll('[data-bs-toggle="tab"]');
        tabTriggerList.forEach(tabTriggerEl => {
          tabTriggerEl.addEventListener('click', function (event) {
            event.preventDefault();
            const target = this.getAttribute('data-bs-target');
            const tabPane = modalEl.querySelector(target);
            if (tabPane) {
              // Hide all tab panes
              const allPanes = modalEl.querySelectorAll('.tab-pane');
              allPanes.forEach(pane => {
                pane.classList.remove('show', 'active');
              });
              
              // Deactivate all tabs
              const allTabs = modalEl.querySelectorAll('.nav-link');
              allTabs.forEach(tab => {
                tab.classList.remove('active');
              });
              
              // Activate current tab and pane
              this.classList.add('active');
              tabPane.classList.add('show', 'active');
            }
          });
        });
      } else {
        // Fallback if Bootstrap not available
        modalEl.style.display = "block";
        modalEl.classList.add("show");
      }
      
    } catch (e) {
      console.error("Error opening view modal:", e);
      safeShowError(e.message || "Failed to load request details.");
    }
  }

  // -------------------------
  // Format date helper
  // -------------------------
  function formatDate(dateString) {
    if (!dateString) return "—";
    try {
      const date = new Date(dateString);
      return date.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch (e) {
      return dateString;
    }
  }

  // -------------------------
  // Render officers table
  // -------------------------
  function renderOfficersTable(officers) {
    const tbody = rqs("#adOfficersTbody");
    if (!tbody || !officers) return;

    if (!officers.length) {
      tbody.innerHTML = `
        <tr>
          <td colspan="6" class="text-center text-muted py-4">
            <i class="bi bi-people fs-4 d-block mb-2"></i>
            No officers found.
          </td>
        </tr>`;
      return;
    }

    tbody.innerHTML = officers
      .map((officer, index) => {
        const position = escapeHtml(officer.position || "—");
        const fullName = escapeHtml(officer.full_name || "—");
        const userId = officer.user_id ? escapeHtml(String(officer.user_id)) : "—";
        const courseYear = escapeHtml(officer.course_year || "—");
        const status = officer.status || "Active";

        let statusClass = "text-bg-success";
        if (status === "Inactive") statusClass = "text-bg-secondary";
        else if (status === "Pending") statusClass = "text-bg-warning";

        return `
          <tr>
            <td class="text-muted">${index + 1}</td>
            <td class="fw-semibold">${position}</td>
            <td>${fullName}</td>
            <td class="text-muted">${userId}</td>
            <td>${courseYear}</td>
            <td><span class="badge ${statusClass}">${status}</span></td>
          </tr>
        `;
      })
      .join("");
  }

  // -------------------------
  // Load request documents for view modal
  // -------------------------
  async function loadRequestDocuments(requestId, page) {
    try {
      const data = await postJSON({
        action: "get_request",
        request_id: requestId,
        docs_page: page,
        docs_per_page: 8,
      });

      if (!data?.ok || !data?.request) return;

      store.docs.items = data.request.docs || [];
      store.docs.page = data.docs_paging?.page || 1;
      store.docs.perPage = data.docs_paging?.per_page || 8;
      store.docs.total = data.docs_paging?.total || 0;

      renderDocumentsTable();
      rqs("#adDocumentsCount").textContent = store.docs.total;

      const paginationEl = rqs("#adDocsPagination");
      const paginationMetaEl = rqs("#adDocsPaginationMeta");
      const docsMetaEl = rqs("#adDocsMeta");

      if (paginationEl && paginationMetaEl) {
        renderPagination(
          paginationEl,
          paginationMetaEl,
          store.docs.page,
          store.docs.perPage,
          store.docs.total,
          (newPage) => {
            loadRequestDocuments(requestId, newPage);
          }
        );
      }

      if (docsMetaEl) {
        docsMetaEl.textContent = data.docs_meta || "";
      }
    } catch (e) {
      console.error("Failed to load documents:", e);
      safeShowError("Failed to load documents.");
    }
  }

  // -------------------------
  // Render documents table
  // -------------------------
  function renderDocumentsTable() {
    const tbody = rqs("#adDocsTbody");
    if (!tbody) return;

    const items = store.docs.items || [];
    if (!items.length) {
      tbody.innerHTML = `
        <tr>
          <td colspan="5" class="text-center text-muted py-4">
            No documents found.
          </td>
        </tr>`;
      return;
    }

    tbody.innerHTML = items
      .map((doc) => {
        const reqName = escapeHtml(doc.requirement_name || "—");
        const fileName = escapeHtml(doc.file_name || "file");
        const status = doc.status || "Submitted";
        const reason = escapeHtml(doc.return_reason || "");
        const fileUrl = doc.file_url || "";
        const canReplace = doc.can_replace || false;
        const reviewedAt = doc.reviewed_at ? new Date(doc.reviewed_at).toLocaleDateString() : "";

        let statusClass = "text-bg-secondary";
        if (status === "Approved") statusClass = "text-bg-success";
        else if (status === "Returned") statusClass = "text-bg-warning";
        else if (status === "Submitted") statusClass = "text-bg-info";

        let actions = "";
        if (fileUrl) {
          actions += `
            <button class="btn btn-sm btn-outline-primary" 
                    onclick="window.ADAccreditation.openPreview('${escapeHtml(fileUrl)}', '${escapeHtml(fileName)}')"
                    data-bs-toggle="tooltip" title="Preview">
              <i class="bi bi-eye"></i>
            </button>
            <a class="btn btn-sm btn-outline-secondary" 
               href="${escapeHtml(fileUrl)}" 
               target="_blank" 
               rel="noopener"
               data-bs-toggle="tooltip" title="Open in new tab">
              <i class="bi bi-box-arrow-up-right"></i>
            </a>
          `;
        }

        if (canReplace) {
          actions += `
            <button class="btn btn-sm btn-outline-warning" 
                    onclick="window.ADAccreditation?.openReplaceModal?.('${doc.id}')"
                    data-bs-toggle="tooltip" title="Replace Document">
              <i class="bi bi-arrow-counterclockwise"></i>
            </button>
          `;
        }

        return `
          <tr>
            <td>${reqName}</td>
            <td>
              <div class="fw-semibold sa-truncate">${fileName}</div>
              ${reviewedAt ? `<div class="text-muted small">Reviewed: ${reviewedAt}</div>` : ""}
            </td>
            <td><span class="badge ${statusClass}">${status}</span></td>
            <td class="text-muted small">${reason}</td>
            <td class="text-end">
              <div class="d-flex gap-1 justify-content-end">
                ${actions}
              </div>
            </td>
          </tr>
        `;
      })
      .join("");

    if (window.bootstrap) {
      const tooltipTriggerList = tbody.querySelectorAll('[data-bs-toggle="tooltip"]');
      tooltipTriggerList.forEach(tooltipTriggerEl => {
        new bootstrap.Tooltip(tooltipTriggerEl);
      });
    }
  }

  // -------------------------
  // Open Replace Document Modal
  // -------------------------
  function openReplaceModal(docId) {
    try {
      console.log("Opening replace modal for document:", docId);

      const modalEl = rqs("#adReplaceDocumentModal");
      if (!modalEl) {
        console.error("Replace modal element #adReplaceDocumentModal not found!");
        safeShowError("Replace modal not found in page.");
        return;
      }

      rqs("#adReplaceDocId").value = docId;

      const form = rqs("#adReplaceDocumentForm");
      if (form) form.reset();

      if (window.bootstrap) {
        const modal = new bootstrap.Modal(modalEl);
        modal.show();
      }
    } catch (e) {
      console.error("Error opening replace modal:", e);
      safeShowError("Failed to open replace modal.");
    }
  }

  // -------------------------
  // Bind Replace Document Modal
  // -------------------------
  function bindReplaceModal() {
    const modalEl = rqs("#adReplaceDocumentModal");
    if (!modalEl) return;

    const form = rqs("#adReplaceDocumentForm");
    const submitBtn = rqs("#adReplaceSubmitBtn");

    if (form && !form.__adBound) {
      form.__adBound = true;
      form.addEventListener("submit", async (e) => {
        e.preventDefault();

        const docId = rqs("#adReplaceDocId").value;
        const fileInput = rqs("#adReplaceFileInput");

        if (!docId || !fileInput || !fileInput.files || !fileInput.files[0]) {
          safeShowError("Please select a file to upload.");
          return;
        }

        const oldHtml = submitBtn ? submitBtn.innerHTML : "";
        if (submitBtn) {
          submitBtn.disabled = true;
          submitBtn.innerHTML = `<span class="spinner-border spinner-border-sm me-2"></span>Uploading...`;
        }

        try {
          const formData = new FormData();
          formData.append("action", "replace_document");
          formData.append("doc_id", docId);
          formData.append("file", fileInput.files[0]);

          const data = await postForm(formData);

          safeShowSuccess(data?.message || "Document replaced successfully.");

          if (window.bootstrap) {
            const modal = bootstrap.Modal.getInstance(modalEl);
            if (modal) modal.hide();
          }

          const currentRequestId = store.docs.requestId;
          if (currentRequestId) {
            loadRequestDocuments(currentRequestId, store.docs.page);
          }

        } catch (error) {
          safeShowError(error.message || "Failed to replace document.");
        } finally {
          if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.innerHTML = oldHtml || `<i class="bi bi-upload me-1"></i> Replace Document`;
          }
        }
      });
    }
  }

  // -------------------------
  // RENEWAL SYSTEM FUNCTIONS (unchanged)
  // -------------------------
  async function checkRenewalStatus() {
    try {
      const data = await postJSON({ action: "check_accreditation_status" });

      if (data.ok) {
        if (data.needs_renewal && data.previous_request && !data.has_current_term_request) {
          showRenewalNotification(data);
        }
        else if (data.has_current_term_request && data.current_request?.is_renewal &&
                 data.current_request?.status === 'Draft') {
          showRenewalInProgress(data);
        }
      }
    } catch (err) {
      console.error("Renewal check failed:", err);
    }
  }

  function showRenewalNotification(data) {
    const orgNameEl = rqs("#adRenewalOrgName");
    const orgTypeEl = rqs("#adRenewalOrgType");
    const prevTermEl = rqs("#adRenewalPreviousTerm");
    const currTermEl = rqs("#adRenewalCurrentTerm");

    if (orgNameEl) orgNameEl.textContent = data.previous_request.org_name || "—";
    if (orgTypeEl) orgTypeEl.textContent = data.previous_request.org_type || "—";
    if (prevTermEl) prevTermEl.textContent = data.previous_term?.school_year + " • " + data.previous_term?.semester || "—";
    if (currTermEl) currTermEl.textContent = data.active_term?.school_year + " • " + data.active_term?.semester || "—";

    const prevRequestIdEl = rqs("#adRenewalPreviousRequestId");
    const newTermIdEl = rqs("#adRenewalNewTermId");
    const orgIdEl = rqs("#adRenewalOrgId");

    if (prevRequestIdEl) prevRequestIdEl.value = data.previous_request.id;
    if (newTermIdEl) newTermIdEl.value = data.active_term?.id;
    if (orgIdEl) orgIdEl.value = data.previous_request.org_id;

    const modalEl = rqs("#adRenewalNotificationModal");
    if (modalEl && window.bootstrap) {
      const modal = new bootstrap.Modal(modalEl);
      modal.show();
    }
  }

  function bindRenewalModals() {
    const viewDetailsBtn = rqs("#adRenewalViewDetails");
    if (viewDetailsBtn) {
      viewDetailsBtn.addEventListener("click", () => {
        const previousRequestId = rqs("#adRenewalPreviousRequestId")?.value || "";
        const newTermId = rqs("#adRenewalNewTermId")?.value || "";

        if (!previousRequestId || !newTermId) {
          safeShowError("Missing renewal data.");
          return;
        }

        const notifModal = rqs("#adRenewalNotificationModal");
        if (notifModal && window.bootstrap) {
          const modal = bootstrap.Modal.getInstance(notifModal);
          if (modal) modal.hide();
        }

        loadRenewalRequirements(previousRequestId, newTermId);
      });
    }

    const startRenewalBtn = rqs("#adRenewalStartNow");
    if (startRenewalBtn) {
      startRenewalBtn.addEventListener("click", () => {
        const previousRequestId = rqs("#adRenewalPreviousRequestId")?.value || "";
        const newTermId = rqs("#adRenewalNewTermId")?.value || "";

        if (!previousRequestId || !newTermId) {
          safeShowError("Missing renewal data.");
          return;
        }

        startRenewalProcess(previousRequestId, newTermId);
      });
    }

    const continueBtn = rqs("#adRenewalContinueToForm");
    if (continueBtn) {
      continueBtn.addEventListener("click", () => {
        const previousRequestId = rqs("#adRenewalReqPreviousRequestId")?.value || "";
        const newTermId = rqs("#adRenewalReqNewTermId")?.value || "";

        if (!previousRequestId || !newTermId) {
          safeShowError("Missing renewal data.");
          return;
        }

        startRenewalProcess(previousRequestId, newTermId);
      });
    }

    const continueEditingBtn = rqs("#adRenewalContinueEditing");
    if (continueEditingBtn) {
      continueEditingBtn.addEventListener("click", () => {
        const requestId = rqs("#adRenewalInProgressRequestId")?.value || "";

        if (!requestId) {
          safeShowError("Missing request data.");
          return;
        }

        const inProgressModal = rqs("#adRenewalInProgressModal");
        if (inProgressModal && window.bootstrap) {
          const modal = bootstrap.Modal.getInstance(inProgressModal);
          if (modal) modal.hide();
        }

        openEditModal(requestId);
      });
    }

    const remindLaterBtn = rqs("#adRenewalRemindLater");
    if (remindLaterBtn) {
      remindLaterBtn.addEventListener("click", () => {
        const modalEl = rqs("#adRenewalNotificationModal");
        if (modalEl && window.bootstrap) {
          const modal = bootstrap.Modal.getInstance(modalEl);
          if (modal) modal.hide();
        }
      });
    }
  }

  async function loadRenewalRequirements(previousRequestId, newTermId) {
    try {
      const data = await postJSON({
        action: "list_requirements_for_upload",
        is_renewal: true,
        previous_request_id: previousRequestId
      });

      if (data.ok) {
        const prevReqIdEl = rqs("#adRenewalReqPreviousRequestId");
        const newTermIdEl = rqs("#adRenewalReqNewTermId");

        if (prevReqIdEl) prevReqIdEl.value = previousRequestId;
        if (newTermIdEl) newTermIdEl.value = newTermId;

        renderRenewalRequirementsTable(data.items);

        const modalEl = rqs("#adRenewalRequirementsModal");
        if (modalEl && window.bootstrap) {
          const modal = new bootstrap.Modal(modalEl);
          modal.show();
        }
      }
    } catch (error) {
      console.error("Failed to load renewal requirements:", error);
      safeShowError("Failed to load renewal requirements.");
    }
  }

  function renderRenewalRequirementsTable(items) {
    const tbody = rqs("#adRenewalRequirementsTbody");
    if (!tbody || !items) return;

    if (!items.length) {
      tbody.innerHTML = `
        <tr>
          <td colspan="5" class="text-center text-muted py-4">
            No requirements found for renewal.
          </td>
        </tr>`;
      return;
    }

    tbody.innerHTML = items.map((req, index) => {
      const status = req.has_previous_document ?
        (req.is_new_requirement ? "new" : "copied") :
        "pending";

      const statusText = req.has_previous_document ?
        (req.is_new_requirement ? "New Requirement" : "Copied from Previous") :
        "Pending Upload";

      const actionNeeded = req.has_previous_document ?
        (req.is_new_requirement ? "Upload new document" : "Review & update if needed") :
        "Upload required";

      const statusClass = status === "copied" ? "status-copied" :
                         status === "new" ? "status-new" :
                         status === "pending" ? "status-unchanged" : "status-draft";

      return `
        <tr>
          <td class="text-muted">${index + 1}</td>
          <td>
            <div class="req-name">${escapeHtml(req.requirement_name)}</div>
            ${req.is_new_requirement ? '<div class="badge status-new renewal-badge mt-1">New This Term</div>' : ''}
          </td>
          <td>
            ${req.has_previous_document ?
              `<span class="badge bg-success renewal-badge">Submitted</span>` :
              `<span class="badge bg-secondary renewal-badge">Not Submitted</span>`}
          </td>
          <td>
            <span class="badge ${statusClass} renewal-badge">${statusText}</span>
          </td>
          <td class="text-muted small">${actionNeeded}</td>
        </tr>
      `;
    }).join("");
  }

  async function startRenewalProcess(previousRequestId, newTermId) {
    try {
      const data = await postJSON({
        action: "start_renewal",
        previous_request_id: previousRequestId,
        new_term_id: newTermId
      });

      if (data.ok) {
        safeShowSuccess("Renewal started! You can now review and update your organization details.");

        const modals = ['#adRenewalNotificationModal', '#adRenewalRequirementsModal'];
        modals.forEach(selector => {
          const modalEl = rqs(selector);
          if (modalEl && window.bootstrap) {
            const modal = bootstrap.Modal.getInstance(modalEl);
            if (modal) modal.hide();
          }
        });

        if (data.new_request_id) {
          openEditModal(data.new_request_id);
        }

        bus.emit("refresh:all");
      }
    } catch (error) {
      safeShowError(error.message || "Failed to start renewal process.");
    }
  }

  function showRenewalInProgress(data) {
    const requestIdEl = rqs("#adRenewalInProgressRequestId");
    if (requestIdEl) {
      requestIdEl.value = data.current_request.id;
    }

    const modalEl = rqs("#adRenewalInProgressModal");
    if (modalEl && window.bootstrap) {
      const modal = new bootstrap.Modal(modalEl);
      modal.show();
    }
  }

  // -------------------------
  // INIT
  // -------------------------
  async function init(root) {
    const r = root || document;

    // Always update root so rqs() targets the right element after re-navigation
    store._root = r;

    // Reset pagination state so re-entering the page fetches from page 1
    store.search = "";
    store.pending  = { items: [], page: 1, perPage: store.pending?.perPage  || 10, total: 0 };
    store.active   = { items: [], page: 1, perPage: store.active?.perPage   || 10, total: 0 };
    store.returned = { items: [], page: 1, perPage: store.returned?.perPage || 10, total: 0 };
    store.docs     = { items: [], page: 1, perPage: store.docs?.perPage     || 8,  total: 0, requestId: null };

    // Bind UI elements — each bind helper guards itself per-element so no double-listeners
    bindHeader();
    bindAddModal();
    bindEditModal();
    bindReplaceModal();
    bindRenewalModals();

    // Get current user info (lightweight, cached after first call)
    if (!store.currentUser) await getCurrentUser();

    try {
      await loadTerms();
    } catch (e) {
      console.error(e);
      safeShowError(e.message || "Failed to load terms.");
    }

    resolveCanSubmit().catch(() => {
      store.canSubmit = true;
      applySubmitUI();
    });

    setTimeout(() => {
      checkRenewalStatus();
    }, 1000);

    // Emit booted — tab modules listen for this to (re-)fetch their data
    bus.emit("booted", { root: r });

    // Also call tab inits directly in case they registered before the bus event
    try { window.ADAccreditationPending?.init?.(r); }  catch (e) { console.error("[Pending.init] failed", e); }
    try { window.ADAccreditationActive?.init?.(r); }   catch (e) { console.error("[Active.init] failed", e); }
    try { window.ADAccreditationReturned?.init?.(r); } catch (e) { console.error("[Returned.init] failed", e); }
  }

  // -------------------------
  // Public API
  // -------------------------
  window.ADAccreditation = {
    init,
    openEditModal,
    openViewModal,
    openReplaceModal,
    renderTableActions,

    API_URL,
    qs,
    qsa,
    rqs,
    rqsa,
    escapeHtml,
    debounce,

    postJSON,
    postForm,
    renderPagination,
    openPreview,

    safeShowError,
    safeShowSuccess,

    bus,
    store,
    loadTerms,
    loadPrograms,
    getCurrentUser,

    // Officer functions
    searchStudent: window.searchStudent,
    searchDynamicStudent: window.searchDynamicStudent,
    editSearchStudent: window.editSearchStudent,
    editSearchDynamicStudent: window.editSearchDynamicStudent,

    // Renewal functions
    checkRenewalStatus,
    showRenewalNotification,
    loadRenewalRequirements,
    startRenewalProcess,
    showRenewalInProgress,
  };

  window.SAAccreditation = window.ADAccreditation;
})();