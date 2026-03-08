/* js/accredititation/admin/accreditation.js */
/* global bootstrap, showSuccess, showError */

(function () {
  "use strict";

  // ✅ Change this if your PHP endpoint name is different
  // e.g. "php/accreditation.php" or "php/manage-accreditation.php"
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
  };

  // Root-aware selectors (important for injected pages)
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
  // One-org submit rule (button visibility)
  // -------------------------
  async function resolveCanSubmit() {
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

    if (searchEl && !searchEl.__adBound) {
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

    // Return as-is if not a number
    return String(yearLevel);
  }

  // ✅ Fee UI helpers (supports your "membership fee" + "fee required" fields)
  function getAddModalOrgType() {
    return String(rqs("#accOrgType")?.value || "Organization");
  }

  // ✅ NEW: function to detect already-selected officer student IDs (prevents duplicates)
  function getSelectedOfficerIds(excludeIndex = null) {
    const set = new Set();
    for (let i = 0; i < 5; i++) {
      if (excludeIndex != null && Number(excludeIndex) === i) continue;
      const hid = rqs(`#officer_${i}_student_id`);
      const v = String(hid?.value || "").trim();
      if (v) set.add(v);
    }
    return set;
  }

  // ✅ NEW: Function to handle scope radio buttons when Club is selected
  function syncScopeForClub() {
    const orgType = getAddModalOrgType();
    const isClub = orgType === "Club";

    // Get all scope radio buttons
    const generalScopeRadio = rqs("#scopeGeneral");
    const exclusiveScopeRadio = rqs("#scopeExclusive");
    const generalScopeLabel = generalScopeRadio?.nextElementSibling;
    const exclusiveScopeLabel = exclusiveScopeRadio?.nextElementSibling;

    if (isClub) {
      // Disable scope selection for Clubs
      if (generalScopeRadio) generalScopeRadio.disabled = true;
      if (exclusiveScopeRadio) exclusiveScopeRadio.disabled = true;
      if (generalScopeLabel) generalScopeLabel.classList.add("disabled");
      if (exclusiveScopeLabel) exclusiveScopeLabel.classList.add("disabled");

      // Set to General by default for Clubs
      if (generalScopeRadio) generalScopeRadio.checked = true;

      // Hide program selector for Clubs
      const programSelect = rqs("#accProgramId");
      if (programSelect) {
        programSelect.disabled = true;
        programSelect.value = "";
      }
    } else {
      // Re-enable scope selection for Organizations
      if (generalScopeRadio) generalScopeRadio.disabled = false;
      if (exclusiveScopeRadio) exclusiveScopeRadio.disabled = false;
      if (generalScopeLabel) generalScopeLabel.classList.remove("disabled");
      if (exclusiveScopeLabel) exclusiveScopeLabel.classList.remove("disabled");

      // Re-enable program selector logic
      syncProgramEnable();
    }
  }

  function syncFeeFieldsForAddModal() {
    const orgType = getAddModalOrgType();
    const isClub = orgType === "Club";
    const isOrganization = orgType === "Organization";

    // Organization fee field (fee_required)
    const orgFeeWrap = rqs("#orgFeeWrap");
    const orgFeeInput = rqs("#accFeeRequired") || rqs("[name='fee_required']");

    // Club fee field (membership_fee)
    const clubFeeWrap = rqs("#clubFeeWrap");
    const clubFeeInput = rqs("#accMembershipFee") || rqs("[name='membership_fee']");

    // Show/hide organization fee field
    if (orgFeeWrap) orgFeeWrap.style.display = isOrganization ? "" : "none";
    if (orgFeeInput) {
    if (!isOrganization) {
      orgFeeInput.value = "";
    }
  }


    // Show/hide club fee field
    if (clubFeeWrap) clubFeeWrap.style.display = isClub ? "" : "none";
    if (clubFeeInput) {
      if (!isClub) clubFeeInput.value = "";
    }

    // Also handle scope radio buttons for Clubs
    syncScopeForClub();
  }

  // ✅ Officers: student search for the 5 hard-coded rows
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
    // If Club, no program filter (Clubs are open to all)
    const orgType = getAddModalOrgType();
    if (orgType === "Club") return null;

    // If Exclusive, restrict search to selected program
    const scope = currentScopeValue();
    if (scope !== "Exclusive") return null;
    const pid = Number(rqs("#accProgramId")?.value || 0);
    return pid || null;
  }

  function getAddModalProgramName() {
    // Get the selected program name for filtering
    const orgType = getAddModalOrgType();
    if (orgType === "Club") return null;

    const scope = currentScopeValue();
    if (scope !== "Exclusive") return null;

    const programSelect = rqs("#accProgramId");
    if (!programSelect) return null;

    const selectedOption = programSelect.options[programSelect.selectedIndex];
    if (!selectedOption || selectedOption.value === "") return null;

    // Extract program abbreviation from the option text (e.g., "BSIT — Bachelor ...")
    const optionText = selectedOption.textContent || "";
    const programName = optionText.split("—")[0]?.trim();
    return programName || null;
  }

  function showOfficerResults(index, items) {
    const box = rqs(`#searchResults_${index}`);
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

        // course/year label
        let courseYear = "";

        // First check if course_year is directly available
        if (s.course_year) {
          courseYear = escapeHtml(s.course_year);
        }
        // If not, construct it: "BSIT 1st Year" ✅ (no plus)
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

  function bindOfficerRowSearch(index) {
    const nameInput = rqs(`#officer_${index}_full_name`);
    const idHidden = rqs(`#officer_${index}_student_id`);
    const courseInput = rqs(`#officer_${index}_course_year`);
    const resultsBox = rqs(`#searchResults_${index}`);

    if (!nameInput || !resultsBox) return;
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

      const items = await searchStudents(q, programId, programName);

      // ✅ NEW: filter out students already picked in other officer rows
      const taken = getSelectedOfficerIds(index);
      const filtered = (items || []).filter((s) => !taken.has(String(s.id || "")));

      showOfficerResults(index, filtered);
    }, 250);

    nameInput.addEventListener("input", () => run().catch((e) => safeShowError(e.message)));
    nameInput.addEventListener("focus", () => run().catch(() => {}));

    // click select
    resultsBox.addEventListener("click", (e) => {
      const item = e.target.closest(".student-search-item[data-student-id]");
      if (!item) return;

      const sid = item.getAttribute("data-student-id") || "";
      const full = item.getAttribute("data-full-name") || "";
      const cy = item.getAttribute("data-course-year") || "";

      // ✅ NEW: block duplicates (extra safety)
      const taken = getSelectedOfficerIds(index);
      if (sid && taken.has(String(sid))) {
        safeShowError("That student is already selected in another officer field.");
        return;
      }

      if (idHidden) idHidden.value = sid;
      if (nameInput) nameInput.value = full;
      if (courseInput) courseInput.value = cy;

      hideOfficerResults(index);
    });

    // Clear course/year when name is cleared
    nameInput.addEventListener("input", () => {
      const q = String(nameInput.value || "").trim();
      if (q.length === 0) {
        if (courseInput) {
          courseInput.value = "";
          courseInput.placeholder = "Will auto-fill from student search";
        }
        if (idHidden) {
          idHidden.value = "";
        }
      }
    });

    // click outside closes
    if (!document.__offOutsideBound) {
      document.__offOutsideBound = true;
      document.addEventListener("click", (e) => {
        const anyOpen = qsa(".student-search-results", store._root || document).filter(
          (el) => el && el.style.display !== "none"
        );
        if (!anyOpen.length) return;

        for (const el of anyOpen) {
          if (e.target.closest(".student-search-container")) return;
        }
        for (const el of anyOpen) el.style.display = "none";
      });
    }
  }

  // support your inline onclick="searchStudent(0)"
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

      // ✅ NEW: filter out already-selected students
      const taken = getSelectedOfficerIds(index);
      const filtered = (items || []).filter((s) => !taken.has(String(s.id || "")));

      showOfficerResults(index, filtered);
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

      // ✅ bind the 5 hard-coded officer rows (0..4)
      for (let i = 0; i < 5; i++) bindOfficerRowSearch(i);
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
        
        // ✅ Bind the 5 hard-coded officer rows for editing
        for (let i = 0; i < 5; i++) bindEditOfficerRowSearch(i);
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
      
      // Disable program for Clubs
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

      // Organization fee field
      const orgFeeWrap = rqs("#editOrgFeeWrap");
      const orgFeeInput = rqs("#editAccFeeRequired");

      // Club fee field
      const clubFeeWrap = rqs("#editClubFeeWrap");
      const clubFeeInput = rqs("#editAccMembershipFee");

      // Show/hide organization fee field
      if (orgFeeWrap) orgFeeWrap.style.display = isOrganization ? "" : "none";
      
      // Show/hide club fee field
      if (clubFeeWrap) clubFeeWrap.style.display = isClub ? "" : "none";
      
      // Handle scope radio buttons for Clubs
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

    // ✅ NEW: Function to get selected officer IDs for edit modal
    function getEditSelectedOfficerIds(excludeIndex = null) {
      const set = new Set();
      for (let i = 0; i < 5; i++) {
        if (excludeIndex != null && Number(excludeIndex) === i) continue;
        const hid = rqs(`#edit_officer_${i}_student_id`);
        const v = String(hid?.value || "").trim();
        if (v) set.add(v);
      }
      return set;
    }

    // ✅ NEW: Student search for edit modal
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

    function showEditOfficerResults(index, items) {
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

          // course/year label
          let courseYear = "";

          // First check if course_year is directly available
          if (s.course_year) {
            courseYear = escapeHtml(s.course_year);
          }
          // If not, construct it: "BSIT 1st Year" ✅ (no plus)
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

    function bindEditOfficerRowSearch(index) {
      const nameInput = rqs(`#edit_officer_${index}_full_name`);
      const idHidden = rqs(`#edit_officer_${index}_student_id`);
      const courseInput = rqs(`#edit_officer_${index}_course_year`);
      const resultsBox = rqs(`#edit_searchResults_${index}`);

      if (!nameInput || !resultsBox) return;
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

        const items = await searchStudents(q, programId, programName);

        // ✅ Filter out students already picked in other officer rows
        const taken = getEditSelectedOfficerIds(index);
        const filtered = (items || []).filter((s) => !taken.has(String(s.id || "")));

        showEditOfficerResults(index, filtered);
      }, 250);

      nameInput.addEventListener("input", () => run().catch((e) => safeShowError(e.message)));
      nameInput.addEventListener("focus", () => run().catch(() => {}));

      // click select
      resultsBox.addEventListener("click", (e) => {
        const item = e.target.closest(".student-search-item[data-student-id]");
        if (!item) return;

        const sid = item.getAttribute("data-student-id") || "";
        const full = item.getAttribute("data-full-name") || "";
        const cy = item.getAttribute("data-course-year") || "";

        // ✅ Block duplicates (extra safety)
        const taken = getEditSelectedOfficerIds(index);
        if (sid && taken.has(String(sid))) {
          safeShowError("That student is already selected in another officer field.");
          return;
        }

        if (idHidden) idHidden.value = sid;
        if (nameInput) nameInput.value = full;
        if (courseInput) courseInput.value = cy;

        hideEditOfficerResults(index);
      });

      // Clear course/year when name is cleared
      nameInput.addEventListener("input", () => {
        const q = String(nameInput.value || "").trim();
        if (q.length === 0) {
          if (courseInput) {
            courseInput.value = "";
            courseInput.placeholder = "Will auto-fill from student search";
          }
          if (idHidden) {
            idHidden.value = "";
          }
        }
      });
    }

    // support your inline onclick="editSearchStudent(0)"
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

        // ✅ Filter out already-selected students
        const taken = getEditSelectedOfficerIds(index);
        const filtered = (items || []).filter((s) => !taken.has(String(s.id || "")));

        showEditOfficerResults(index, filtered);
      } catch (e) {
        safeShowError(e.message);
      }
    };

// -------------------------
// Open Edit Modal (UPDATED WITH REQUIREMENTS)
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
      
      // DEBUGGING: Log the entire request object
      console.log("Full request data:", req);
      console.log("Description value:", req.description);
      console.log("All keys in req:", Object.keys(req));
      
      // Fill form fields
      rqs("#editOrgId").value = req.org_id;
      rqs("#editRequestId").value = requestId;
      rqs("#editAccOrgName").value = req.org_name || "";
      rqs("#editAccOrgAbbr").value = req.org_abbr || "";
      
      // DEBUGGING: Check if element exists
      const editDescEl = document.querySelector("#editAccOrgDescription");
      console.log("Description element found:", editDescEl);
      
      if (editDescEl) {
        console.log("Setting description to:", req.description || "");
        editDescEl.value = req.description || "";
      } else {
        console.error("Element #editAccOrgDescription not found in DOM");
        // List all elements with editAcc in their ID to debug
        const allEditElements = document.querySelectorAll('[id*="editAcc"]');
        console.log("All elements with 'editAcc' in ID:", 
          Array.from(allEditElements).map(el => el.id));
      }
      
      rqs("#editAccOrgMission").value = req.mission || "";
      rqs("#editAccOrgVision").value = req.vision || "";
      rqs("#editAccOrgObjectives").value = req.objectives || "";
      rqs("#editAccOrgAdvocacy").value = req.advocacy || "";

    // Set organization type
    const orgType = req.org_type || "Organization";
    rqs("#editAccOrgType").value = orgType;

    // Set scope (adjust UI based on type)
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

    // Set renewal flags if this is a renewal
    rqs("#editIsRenewal").value = req.is_renewal ? "1" : "0";
    rqs("#editPreviousRequestId").value = req.previous_request_id || "0";
    
    // Show/hide renewal notices
    const isRenewal = req.is_renewal;
    rqs("#editRenewalNotice").style.display = isRenewal ? "inline" : "none";
    rqs("#editRegularNotice").style.display = isRenewal ? "none" : "inline";
    rqs("#editRenewalAlert").style.display = isRenewal ? "block" : "none";
    rqs("#editRegularAlert").style.display = isRenewal ? "none" : "block";

    // ✅ Load existing officers into the edit form
    const officersTbody = rqs("#editOfficersTbody");
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
        
        for (let i = 0; i < positions.length; i++) {
          const position = positions[i];
          const officer = req.officers.find(o => o.position === position);
          
          const officerRow = `
            <tr class="officer-row off-row-required" data-index="${i}" data-required="1">
              <td>
                <div class="off-pos">
                  <input class="form-control" name="edit_officers[${i}][position]" value="${escapeHtml(position)}" readonly required>
                </div>
                <input type="hidden" name="edit_officers[${i}][officer_id]" id="edit_officer_${i}_id" value="${officer ? officer.id : 0}">
                <input type="hidden" name="edit_officers[${i}][student_id]" id="edit_officer_${i}_student_id" value="${officer ? officer.user_id : ''}">
              </td>
              <td>
                <div class="student-search-container">
                  <div class="input-group">
                    <input class="form-control" name="edit_officers[${i}][full_name]" id="edit_officer_${i}_full_name"
                           placeholder="Search student..." required
                           data-search-target="#edit_officer_${i}_student_id"
                           data-course-target="#edit_officer_${i}_course_year"
                           value="${officer ? escapeHtml(officer.full_name) : ''}"
                           autocomplete="off">
                    <button class="btn btn-outline-secondary" type="button" onclick="editSearchStudent(${i})">
                      <i class="bi bi-search"></i>
                    </button>
                  </div>
                  <div class="student-search-results" id="edit_searchResults_${i}"></div>
                </div>
              </td>
              <td>
                <input class="form-control" name="edit_officers[${i}][course_year]" id="edit_officer_${i}_course_year"
                       placeholder="Will auto-fill from student search" 
                       value="${officer ? escapeHtml(officer.course_year) : ''}"
                       readonly required>
              </td>
              <td>
                <select class="form-select" name="edit_officers[${i}][status]">
                  <option value="Active" ${officer && officer.status === 'Active' ? 'selected' : ''}>Active</option>
                  <option value="Inactive" ${officer && officer.status === 'Inactive' ? 'selected' : ''}>Inactive</option>
                </select>
              </td>
            </tr>
          `;
          
          officersTbody.innerHTML += officerRow;
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
  // Load Requirements for Edit Modal - UPDATED
  // -------------------------
  async function loadEditRequirements(requestId, orgType, scope, programId, isRenewal) {
    try {
      const data = await postJSON({
        action: "list_requirements_for_upload",
        org_type: orgType || "Organization",
        scope: scope || "General",
        program_id: programId || null,
        is_renewal: isRenewal ? 1 : 0,
        // ✅ NEW: Pass current request_id to get current documents
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
// Render Requirements Table for Edit Modal - UPDATED
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

      // ✅ NEW: Check for current document
      const hasCurrent = req.has_current_document;
      const currentDoc = req.current_document;
      
      // ✅ UPDATED: Check for previous document (for renewals)
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
      
      // ✅ UPDATED: Build hint text with proper document status
      let hint = required ? "Required" : "Optional";
      
      // Show current document first (for editing)
      if (hasCurrent && currentDoc) {
        hint += ` • <span class="text-success">Current: <a href="${escapeHtml(currentDoc.file_url || '#')}" target="_blank">${escapeHtml(currentDoc.file_name || 'File')}</a></span>`;
      } 
      // Otherwise show previous document (for renewals when no current doc exists)
      else if (hasPrevious && previousDoc) {
        hint += ` • Previously: <a href="${escapeHtml(previousDoc.file_url || '#')}" target="_blank">${escapeHtml(previousDoc.file_name || 'File')}</a>`;
      }
      
      if (isNewRequirement) {
        hint += ' • <span class="text-warning">New this term</span>';
      }
      
      // ✅ UPDATED: File input with different behavior based on existing document
      let fileInputHtml = '';
      if (hasCurrent && currentDoc) {
        // If we have a current document, the field is optional (can keep or replace)
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
        // If no current document, field is required (unless optional)
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
  // Submit Organization Edit (UPDATED FOR FILE UPLOADS)
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

    // ✅ Validate officers
    const seen = new Set();
    for (let i = 0; i < 5; i++) {
      const hid = rqs(`#edit_officer_${i}_student_id`);
      const name = rqs(`#edit_officer_${i}_full_name`);
      if (hid && name && name.required) {
        const v = String(hid.value || "").trim();
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

    // ✅ Validate required file uploads (for renewals)
    const fileInputs = rqsa("[data-role='edit-req-file']", form);
    const reqIds = [];
    const missingRequiredFiles = [];
    
    for (const inp of fileInputs) {
      const reqId = inp.getAttribute("data-req-id");
      const required = inp.closest("tr")?.getAttribute("data-required") === "1";
      if (reqId) reqIds.push(String(reqId));
      if (required && !inp.files?.length) {
        const reqName = inp.closest("tr")?.querySelector(".req-name")?.textContent || "Requirement";
        missingRequiredFiles.push(reqName);
      }
    }

    if (missingRequiredFiles.length > 0) {
      safeShowError(`Please upload all required documents: ${missingRequiredFiles.join(", ")}`);
      return;
    }

    // Create FormData for file upload
    const fd = new FormData(form);
    fd.append("action", "update_organization");
    fd.append("org_id", orgId);
    fd.append("request_id", requestId);
    fd.append("org_name", rqs("#editAccOrgName").value.trim());
    fd.append("abbreviation", rqs("#editAccOrgAbbr").value.trim());
    fd.append("org_type", orgType);
    fd.append("scope", scope);
    fd.append("program_id", rqs("#editAccProgramId")?.value || 0);
    const editDescEl = document.querySelector("#editAccOrgDescription");
    if (editDescEl) fd.append("description", editDescEl.value.trim());
    fd.append("mission", rqs("#editAccOrgMission").value.trim());
    fd.append("vision", rqs("#editAccOrgVision").value.trim());
    fd.append("objectives", rqs("#editAccOrgObjectives").value.trim());
    fd.append("advocacy", rqs("#editAccOrgAdvocacy").value.trim());

    if (orgType === "Organization") {
      const val = String(rqs("#editAccFeeRequired")?.value || "").trim();
      fd.append("fee_required", val === "" ? "0" : val);
    } else {
      fd.append("fee_required", "0");
    }

    fd.append("membership_fee", orgType === "Club" ? (parseFloat(rqs("#editAccMembershipFee")?.value) || 0) : 0);
    
    // Add officer data to form data
    for (let i = 0; i < 5; i++) {
      fd.append(`edit_officers[${i}][officer_id]`, rqs(`#edit_officer_${i}_id`)?.value || 0);
      fd.append(`edit_officers[${i}][position]`, rqs(`[name="edit_officers[${i}][position]"]`)?.value || "");
      fd.append(`edit_officers[${i}][student_id]`, rqs(`#edit_officer_${i}_student_id`)?.value || 0);
      fd.append(`edit_officers[${i}][full_name]`, rqs(`#edit_officer_${i}_full_name`)?.value || "");
      fd.append(`edit_officers[${i}][course_year]`, rqs(`#edit_officer_${i}_course_year`)?.value || "");
      fd.append(`edit_officers[${i}][status]`, rqs(`[name="edit_officers[${i}][status]"]`)?.value || "Active");
    }

    // Add requirement IDs
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

    // ✅ Enforce selected officer IDs (and ensure no duplicates)
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

    const memInput = rqs("#accMembershipFee") || rqs("[name='membership_fee']");
    const reqInput = rqs("#accFeeRequired") || rqs("[name='fee_required']");

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
  // Table button rendering helper - UPDATED TO INCLUDE EDIT BUTTON
  // -------------------------
  function renderTableActions(item) {
  // Edit button - shown for Active, Returned, AND Recommended status
  const canEdit = item.status === 'Active' || item.status === 'Returned' || item.status === 'Recommended' || item.status === 'Pending' || item.status === 'Draft';
  const editBtn = canEdit ? `
    <button class="btn btn-sm btn-outline-primary" 
            onclick="window.ADAccreditation?.openEditModal('${item.id}')"
            data-bs-toggle="tooltip" title="Edit Organization">
      <i class="bi bi-pencil"></i>
    </button>
  ` : '';

  // View button - always shown
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

        // Set basic info
        rqs("#adViewRequestId").value = requestId;
        rqs("#adViewReqSub").textContent = `ID: ${requestId} • ${req.org_name || ""}`;
        rqs("#adOrgName").textContent = req.org_name || "—";
        rqs("#adOrgAbbr").textContent = req.org_abbr || "—";
        rqs("#adOrgScope").textContent = req.scope || "—";
        rqs("#adOrgProgram").textContent = req.program || "—";
        rqs("#adOrgTerm").textContent = req.term_label || "—";
        
        // Format dates
        const submittedAt = req.submitted_at ? formatDate(req.submitted_at) : "—";
        const updatedAt = req.updated_at ? formatDate(req.updated_at) : "—";
        rqs("#adSubmittedAt").textContent = submittedAt;
        rqs("#adUpdatedAt").textContent = updatedAt;
        
        // Status badge
        const statusEl = rqs("#adReqStatus");
        if (statusEl) {
          statusEl.textContent = req.status || "—";
          // Clear all badge classes
          statusEl.className = "badge";
          // Add base badge class and status-specific class
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
        rqs("#adOrgTypeDetail").textContent = req.org_type || "—";
        rqs("#adOrgScopeDetail").textContent = req.scope || "—";
        rqs("#adOrgProgramDetail").textContent = req.program || "—";
        
        // Fee information
        let feeDetail = "No fee";
        if (req.org_type === "Club" && req.membership_fee > 0) {
          feeDetail = `Club Membership: ₱${parseFloat(req.membership_fee).toFixed(2)}`;
        } else if (req.org_type === "Organization" && Number(req.fee_required || 0) > 0) {
          feeDetail = `Organization Fee Required: ₱${Number(req.fee_required).toFixed(2)}`;
        } else if (req.org_type === "Organization") {
          feeDetail = "No required fee";
        }

        rqs("#adOrgFeeDetail").textContent = feeDetail;
        
        // Mission, Vision, Objectives, Advocacy
        const descEl = document.querySelector("#adOrgDescription");
        if (descEl) descEl.textContent = req.description || "—";
        rqs("#adOrgMission").textContent = req.mission || "—";
        rqs("#adOrgVision").textContent = req.vision || "—";
        rqs("#adOrgObjectives").textContent = req.objectives || "—";
        rqs("#adOrgAdvocacy").textContent = req.advocacy || "—";

        // Load officers
        if (req.officers && Array.isArray(req.officers)) {
          renderOfficersTable(req.officers);
          rqs("#adOfficersCount").textContent = req.officers.length;
        } else {
          rqs("#adOfficersTbody").innerHTML = `
            <tr>
              <td colspan="6" class="text-center text-muted py-4">
                <i class="bi bi-people fs-4 d-block mb-2"></i>
                No officers found.
              </td>
            </tr>`;
          rqs("#adOfficersCount").textContent = "0";
        }

        // Load documents
        store.docs.items = data.request.docs || [];
        store.docs.page = data.docs_paging?.page || 1;
        store.docs.perPage = data.docs_paging?.per_page || 8;
        store.docs.total = data.docs_paging?.total || 0;
        store.docs.requestId = requestId;

        renderDocumentsTable();
        rqs("#adDocumentsCount").textContent = store.docs.total;
        
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
          
          // Status badge
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

          // Status badge
          let statusClass = "text-bg-secondary";
          if (status === "Approved") statusClass = "text-bg-success";
          else if (status === "Returned") statusClass = "text-bg-warning";
          else if (status === "Submitted") statusClass = "text-bg-info";

          // Actions
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

          // Note: Replace document functionality would need a separate modal - I already set up the button here, but the actual implementation of the replace flow is not included in this snippet. It would involve opening a modal similar to the add/edit modals, allowing the user to upload a new file, and then submitting that to an endpoint to replace the existing document.
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
        
      // Initialize tooltips if Bootstrap is available
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
        
        // Set document ID
        rqs("#adReplaceDocId").value = docId;
        
        // Reset form
        const form = rqs("#adReplaceDocumentForm");
        if (form) form.reset();
        
        // Show modal
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
          
          // Disable button and show loading
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
            
            // Close modal
            if (window.bootstrap) {
              const modal = bootstrap.Modal.getInstance(modalEl);
              if (modal) modal.hide();
            }
            
            // Refresh the current view modal if open
            const currentRequestId = store.docs.requestId;
            if (currentRequestId) {
              loadRequestDocuments(currentRequestId, store.docs.page);
            }
            
          } catch (error) {
            safeShowError(error.message || "Failed to replace document.");
          } finally {
            // Re-enable button
            if (submitBtn) {
              submitBtn.disabled = false;
              submitBtn.innerHTML = oldHtml || `<i class="bi bi-upload me-1"></i> Replace Document`;
            }
          }
        });
      }
    }

  // -------------------------
  // RENEWAL SYSTEM FUNCTIONS
  // -------------------------
  async function checkRenewalStatus() {
    try {
      const data = await postJSON({ action: "check_accreditation_status" });
      
      if (data.ok) {
        // Check if we need to show renewal notification
        if (data.needs_renewal && data.previous_request && !data.has_current_term_request) {
          showRenewalNotification(data);
        }
        // Check if we have a renewal in draft
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
    // Fill notification modal with data
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
    
    // Show modal
    const modalEl = rqs("#adRenewalNotificationModal");
    if (modalEl && window.bootstrap) {
      const modal = new bootstrap.Modal(modalEl);
      modal.show();
    }
  }

  function bindRenewalModals() {
    // Bind "View Details" button
    const viewDetailsBtn = rqs("#adRenewalViewDetails");
    if (viewDetailsBtn) {
      viewDetailsBtn.addEventListener("click", () => {
        const previousRequestId = rqs("#adRenewalPreviousRequestId")?.value || "";
        const newTermId = rqs("#adRenewalNewTermId")?.value || "";
        
        if (!previousRequestId || !newTermId) {
          safeShowError("Missing renewal data.");
          return;
        }
        
        // Close notification modal
        const notifModal = rqs("#adRenewalNotificationModal");
        if (notifModal && window.bootstrap) {
          const modal = bootstrap.Modal.getInstance(notifModal);
          if (modal) modal.hide();
        }
        
        // Show requirements modal
        loadRenewalRequirements(previousRequestId, newTermId);
      });
    }
    
    // Bind "Start Renewal Now" button
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
    
    // Bind "Continue to Renewal Form" button
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
    
    // Bind "Continue Editing" button for in-progress renewals
    const continueEditingBtn = rqs("#adRenewalContinueEditing");
    if (continueEditingBtn) {
      continueEditingBtn.addEventListener("click", () => {
        const requestId = rqs("#adRenewalInProgressRequestId")?.value || "";
        
        if (!requestId) {
          safeShowError("Missing request data.");
          return;
        }
        
        // Close the renewal in progress modal
        const inProgressModal = rqs("#adRenewalInProgressModal");
        if (inProgressModal && window.bootstrap) {
          const modal = bootstrap.Modal.getInstance(inProgressModal);
          if (modal) modal.hide();
        }
        
        // Open the renewal request for editing
        openEditModal(requestId);
      });
    }
    
    // Bind "Remind Me Later" button
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
        
        // Show requirements modal
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
        
        // Close any open modals
        const modals = ['#adRenewalNotificationModal', '#adRenewalRequirementsModal'];
        modals.forEach(selector => {
          const modalEl = rqs(selector);
          if (modalEl && window.bootstrap) {
            const modal = bootstrap.Modal.getInstance(modalEl);
            if (modal) modal.hide();
          }
        });
        
        // Open the new renewal request in edit mode
        if (data.new_request_id) {
          openEditModal(data.new_request_id);
        }
        
        // Refresh the page lists
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
  // INIT (Orchestrator)
  // -------------------------
  async function init(root) {
    const r = root || document;

    if (r.__adAccInited) return;
    r.__adAccInited = true;

    store._root = r;

    bindHeader();
    bindAddModal();
    bindEditModal();
    bindReplaceModal();
    bindRenewalModals();

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

    // Check for renewal status after a short delay
    setTimeout(() => {
      checkRenewalStatus();
    }, 1000);

    bus.emit("booted", { root: r });

    try { window.ADAccreditationPending?.init?.(r); } catch (e) { console.error("[Pending.init] failed", e); }
    try { window.ADAccreditationActive?.init?.(r); } catch (e) { console.error("[Active.init] failed", e); }
    try { window.ADAccreditationReturned?.init?.(r); } catch (e) { console.error("[Returned.init] failed", e); }
  }

  // -------------------------
  // Public API (for modules)
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
    
    // Renewal system functions
    checkRenewalStatus,
    showRenewalNotification,
    loadRenewalRequirements,
    startRenewalProcess,
    showRenewalInProgress,
  };

  // Alias for pages that use the "sa" prefix
  window.SAAccreditation = window.ADAccreditation;
})();
//feeDetail