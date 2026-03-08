/* js/manage-announcement.js */
/* global bootstrap, showSuccess, showError */

(function () {
  "use strict";

  // Prevent redefining the module (since it's loaded globally in main HTML)
  if (window.ManageAnnouncement?.init) return;

  const API_URL = "php/announcements.php";

  function safeShowError(msg) {
    if (typeof window.showError === "function") return window.showError(msg);
    alert(msg || "Something went wrong.");
  }
  function safeShowSuccess(msg) {
    if (typeof window.showSuccess === "function") return window.showSuccess(msg);
    alert(msg || "Success.");
  }

  function escapeHtml(s) {
    return String(s ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  async function postJSON(payload) {
    const res = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(payload),
    });

    const j = await res.json().catch(() => null);
    if (!j || j.ok !== true) throw new Error(j?.message || "Server error (" + res.status + ")");
    return j;
  }

  function badgeRole(role) {
    const map = {
      super_admin: "bg-danger",
      special_admin: "bg-warning text-dark",
      overseer: "bg-dark",
      admin: "bg-primary",
      faculty_admin: "bg-primary",
      moderator: "bg-primary",
      org_president: "bg-primary",
      treasurer: "bg-primary",
      org_officer: "bg-primary",
      student: "bg-secondary",
    };
    return map[role] || "bg-secondary";
  }

  function statusPill(s) {
    const cls =
      s === "Active"
        ? "bg-success"
        : s === "Pending"
        ? "bg-warning text-dark"
        : s === "Declined"
        ? "bg-danger"
        : s === "Archived"
        ? "bg-secondary"
        : "bg-secondary";
    return `<span class="badge ${cls}">${escapeHtml(s || "—")}</span>`;
  }

  // Module state (so we can destroy between SPA navigations)
  let CURRENT = {
    root: null,
    cleanup: [],
    createModal: null,
    viewModal: null,
    editModal: null,

    ME: null,
    ACTIVE_TERM_ID: null,

    // Filter state
    STUDENT_ONLY: false,
    TERM_SCOPE: "term", // "term" | "all"
    SELECTED_SCHOOL_YEAR: "", // "YYYY-YYYY"
    SELECTED_SEMESTER: "", // "1st"/"2nd"/"Summer"
    CURRENT_TERM_ID: null, // resolved from selected school_year + semester

    // search text per tab
    SEARCH: { Pending: "", Active: "", Archived: "" },

    // cached org options
    ORG_OPTIONS: null,

    // cached term options
    TERMS: [],
    TERM_BY_ID: {},
    TERMS_BY_SY: {}, // { "2025-2026": [term,term] }

    CURRENT_VIEW_ID: null,
    CURRENT_VIEW_ITEM: null,
    CURRENT_VIEW_CAN_EDIT: false,
    CURRENT_VIEW_CAN_MANAGE: false,

    delegatedBound: false,
  };

  function on(el, event, handler, opts) {
    if (!el) return;
    el.addEventListener(event, handler, opts);
    CURRENT.cleanup.push(() => el.removeEventListener(event, handler, opts));
  }

  function destroy() {
    try {
      CURRENT.cleanup.forEach((fn) => {
        try { fn(); } catch (_) {}
      });
    } finally {
      CURRENT.cleanup = [];
      CURRENT.root = null;
      CURRENT.createModal = null;
      CURRENT.viewModal = null;
      CURRENT.editModal = null;

      CURRENT.ME = null;
      CURRENT.ACTIVE_TERM_ID = null;

      CURRENT.STUDENT_ONLY = false;
      CURRENT.TERM_SCOPE = "term";
      CURRENT.SELECTED_SCHOOL_YEAR = "";
      CURRENT.SELECTED_SEMESTER = "";
      CURRENT.CURRENT_TERM_ID = null;

      CURRENT.SEARCH = { Pending: "", Active: "", Archived: "" };

      CURRENT.ORG_OPTIONS = null;

      CURRENT.TERMS = [];
      CURRENT.TERM_BY_ID = {};
      CURRENT.TERMS_BY_SY = {};

      CURRENT.CURRENT_VIEW_ID = null;
      CURRENT.CURRENT_VIEW_ITEM = null;
      CURRENT.CURRENT_VIEW_CAN_EDIT = false;
      CURRENT.CURRENT_VIEW_CAN_MANAGE = false;

      CURRENT.delegatedBound = false;
    }
  }

  // ---------------------------
  // Target user search/picker
  // ---------------------------
  function debounce(fn, delay = 250) {
    let t = null;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), delay);
    };
  }

  // REQUIRED FORMAT: "Full Name(id_number)" (NO SPACE)
  function formatUserLabel(u) {
    const name = String(u?.name || "").trim();
    const idn = String(u?.id_number || "").trim();
    if (name && idn) return `${name}(${idn})`;
    if (name) return name;
    if (idn) return `(${idn})`;
    return "";
  }

  function closeSuggest(wrapEl, listEl) {
    if (listEl) listEl.innerHTML = "";
    if (wrapEl) wrapEl.classList.remove("show");
  }

  function buildSuggestItems(listEl, users, onPick) {
    if (!listEl) return;
    listEl.innerHTML = "";

    if (!users || users.length === 0) {
      const empty = document.createElement("div");
      empty.className = "list-group-item small text-muted";
      empty.textContent = "No results.";
      listEl.appendChild(empty);
      return;
    }

    users.forEach((u) => {
      const item = document.createElement("button");
      item.type = "button";
      item.className =
        "list-group-item list-group-item-action d-flex justify-content-between align-items-center";
      item.innerHTML = `
        <div class="me-2">
          <div class="fw-semibold">${escapeHtml(u.name || "")}</div>
          <div class="small text-muted">${escapeHtml(u.id_number || "")}</div>
        </div>
        <span class="badge bg-light text-dark">#${escapeHtml(u.id)}</span>
      `;
      item.addEventListener("click", () => onPick(u));
      listEl.appendChild(item);
    });
  }

  function wireUserPicker({ inputEl, hiddenEl, wrapEl, listEl }) {
    if (!inputEl || !hiddenEl || !wrapEl || !listEl) return;

    // If they type manually, unset hidden ID
    on(inputEl, "input", () => {
      hiddenEl.value = "";
    });

    const runSearch = debounce(async () => {
      const q = String(inputEl.value || "").trim();
      if (q.length < 2) {
        closeSuggest(wrapEl, listEl);
        return;
      }
      try {
        const j = await postJSON({ action: "user_search", q, limit: 12 });
        const users = j.users || [];

        buildSuggestItems(listEl, users, (u) => {
          inputEl.value = formatUserLabel(u); // <- NO SPACE format
          hiddenEl.value = String(u.id);
          closeSuggest(wrapEl, listEl);
        });

        wrapEl.classList.add("show");
      } catch (_) {
        closeSuggest(wrapEl, listEl);
      }
    }, 250);

    on(inputEl, "focus", () => runSearch());
    on(inputEl, "keyup", () => runSearch());

    // Close when clicking outside
    on(document, "click", (ev) => {
      if (!wrapEl.classList.contains("show")) return;
      const t = ev.target;
      if (t === inputEl || wrapEl.contains(t)) return;
      closeSuggest(wrapEl, listEl);
    });

    on(inputEl, "keydown", (e) => {
      if (e.key === "Escape") {
        closeSuggest(wrapEl, listEl);
        inputEl.blur();
      }
    });
  }

  function setUserPickerValue(pickerEls, userId, labelText) {
    const { inputEl, hiddenEl, wrapEl, listEl } = pickerEls;
    if (hiddenEl) hiddenEl.value = userId ? String(userId) : "";
    if (inputEl) inputEl.value = labelText || "";
    closeSuggest(wrapEl, listEl);
  }

  // ---------------------------
  // Term helpers (SY + Semester filtering)
  // ---------------------------
  function prettySemester(sem) {
    const v = String(sem || "").trim();
    if (v === "1st") return "1st Semester";
    if (v === "2nd") return "2nd Semester";
    if (v.toLowerCase() === "summer") return "Summer";
    return v || "—";
  }

  function buildTermsIndex(terms) {
    CURRENT.TERM_BY_ID = {};
    CURRENT.TERMS_BY_SY = {};

    (terms || []).forEach((t) => {
      CURRENT.TERM_BY_ID[String(t.id)] = t;
      const sy = String(t.school_year || "").trim();
      if (!sy) return;
      if (!CURRENT.TERMS_BY_SY[sy]) CURRENT.TERMS_BY_SY[sy] = [];
      CURRENT.TERMS_BY_SY[sy].push(t);
    });

    // sort each school year terms by semester order
    const semOrder = { "1st": 1, "2nd": 2, "Summer": 3 };
    Object.keys(CURRENT.TERMS_BY_SY).forEach((sy) => {
      CURRENT.TERMS_BY_SY[sy].sort((a, b) => {
        const aa = semOrder[String(a.semester || "").trim()] || 99;
        const bb = semOrder[String(b.semester || "").trim()] || 99;
        if (aa !== bb) return aa - bb;
        return Number(b.id || 0) - Number(a.id || 0);
      });
    });
  }

  function resolveTermId(schoolYear, semester) {
    const sy = String(schoolYear || "").trim();
    const sem = String(semester || "").trim();
    const list = CURRENT.TERMS_BY_SY[sy] || [];
    const found = list.find((t) => String(t.semester || "").trim() === sem);
    return found ? Number(found.id) : null;
  }

  function uniqueSemestersForSY(schoolYear) {
    const sy = String(schoolYear || "").trim();
    const list = CURRENT.TERMS_BY_SY[sy] || [];
    const seen = new Set();
    const out = [];
    list.forEach((t) => {
      const sem = String(t.semester || "").trim();
      if (!sem || seen.has(sem)) return;
      seen.add(sem);
      out.push(sem);
    });
    return out;
  }

  // ---------------------------
  // Dedupe announcements
  // ---------------------------
  function dedupeById(items) {
    const m = new Map();
    (items || []).forEach((x) => {
      const id = x?.id;
      if (!id) return;
      m.set(String(id), x);
    });
    return Array.from(m.values());
  }

  // ---------------------------
  // Search filtering (client-side)
  // ---------------------------
  function normalizeText(x) {
    return String(x ?? "").toLowerCase();
  }

  function matchAnnouncement(a, q) {
    const needle = normalizeText(q).trim();
    if (!needle) return true;

    const hay = [
      a?.title,
      a?.body,
      a?.org_name,
      a?.status,
      a?.created_at,
      a?.reviewed_at,
      a?.target_user_label,
    ].map(normalizeText).join(" | ");

    return hay.includes(needle);
  }

  function applyClientSearch(items, status) {
    const q = CURRENT.SEARCH[status] || "";
    return (items || []).filter((a) => matchAnnouncement(a, q));
  }

  // ---------------------------
  // Init
  // ---------------------------
  function init(root) {
    destroy();
    CURRENT.root = root || document;

    const qs = (sel, r = CURRENT.root) => r.querySelector(sel);
    const qsa = (sel, r = CURRENT.root) => Array.from(r.querySelectorAll(sel));

    // Page elements
    const elTabs = qs("#announcementTabs");
    const elSchoolYearSelect = qs("#announcementAySpanSelect");
    const elSemesterSelect = qs("#announcementActiveYearSelect");

    const elPendingWrap = qs("#pendingAnnouncementWrap");
    const elActiveWrap = qs("#activeAnnouncementWrap");
    const elArchivedWrap = qs("#archivedAnnouncementWrap");

    // tab panes
    const elPendingPane = qs("#tabPendingAnnouncement");
    const elActivePane = qs("#tabAllAnnouncement");
    const elArchivedPane = qs("#tabArchivedAnnouncement");

    // search inputs per tab
    const elPendingSearch = qs("#pendingAnnouncementSearch");
    const elActiveSearch = qs("#activeAnnouncementSearch");
    const elArchivedSearch = qs("#archivedAnnouncementSearch");

    const elCreateBtn = qs("#btnNewAnnouncement");
    const elCreateModal = qs("#modalNewAnnouncement");
    const elCreateForm = qs("#newAnnouncementForm");

    const elViewModal = qs("#modalViewAnnouncement");
    const elViewTitle = qs("#viewAnnTitle");
    const elViewMeta = qs("#viewAnnMeta");
    const elViewBody = qs("#viewAnnBody");
    const elViewStatus = qs("#viewAnnStatus");

    const elViewBtnEdit = qs("#btnViewEdit");
    const elViewBtnAccept = qs("#btnViewAccept");
    const elViewBtnDecline = qs("#btnViewDecline");
    const elViewBtnArchive = qs("#btnViewArchive");

    const elEditModal = qs("#modalEditAnnouncement");
    const elEditForm = qs("#editAnnouncementForm");

    const elWhoAmI = qs("#whoAmI");
    const elReadOnlyBadge = qs("#ayReadOnlyBadge");

    const elNewOrgSelect = qs("#newAnnOrgSelect");
    const elNewOrgHelp = qs("#newAnnOrgHelp");

    const elNewTargetText = qs("#newAnnTargetUserText");
    const elNewTargetId = qs("#newAnnTargetUserId");
    const elNewSuggestWrap = qs("#newAnnUserSuggest");
    const elNewSuggestList = qs("#newAnnUserSuggest .list-group");

    const elEditTargetText = qs("#editAnnTargetUserText");
    const elEditTargetId = qs("#editAnnTargetUserId");
    const elEditSuggestWrap = qs("#editAnnUserSuggest");
    const elEditSuggestList = qs("#editAnnUserSuggest .list-group");

    const newPickerEls = {
      inputEl: elNewTargetText,
      hiddenEl: elNewTargetId,
      wrapEl: elNewSuggestWrap,
      listEl: elNewSuggestList,
    };
    const editPickerEls = {
      inputEl: elEditTargetText,
      hiddenEl: elEditTargetId,
      wrapEl: elEditSuggestWrap,
      listEl: elEditSuggestList,
    };

    if (!elActiveWrap) {
      console.error("[ManageAnnouncement] Missing #activeAnnouncementWrap in injected HTML.");
      return;
    }

    // Modals
    CURRENT.createModal = elCreateModal ? new bootstrap.Modal(elCreateModal) : null;
    CURRENT.viewModal = elViewModal ? new bootstrap.Modal(elViewModal) : null;
    CURRENT.editModal = elEditModal ? new bootstrap.Modal(elEditModal) : null;

    function setTabsVisible(isVisible) {
      if (!elTabs) return;
      elTabs.style.display = isVisible ? "" : "none";
    }

    function setCreateVisible(isVisible) {
      if (!elCreateBtn) return;
      elCreateBtn.classList.toggle("d-none", !isVisible);
    }

    function setFiltersLocked(locked) {
      if (elSchoolYearSelect) elSchoolYearSelect.disabled = !!locked;
      if (elSemesterSelect) elSemesterSelect.disabled = !!locked;
    }

    // When tabs are hidden (student-only), force Active pane to be visible
    function forceStudentActivePane() {
      if (elPendingPane) {
        elPendingPane.classList.remove("show", "active");
        elPendingPane.style.display = "none";
      }
      if (elArchivedPane) {
        elArchivedPane.classList.remove("show", "active");
        elArchivedPane.style.display = "none";
      }
      if (elActivePane) {
        elActivePane.style.display = "";
        elActivePane.classList.add("show", "active");
      }
    }

    function renderCard(a, canAccept, canDecline, canArchive) {

      ensureAnnouncementCardStyles();

      const orgLine = a.org_name
        ? escapeHtml(a.org_name)
        : "General";

      const targetLine = a.target_user_id
        ? `<span class="aa-badge aa-badge-info">Targeted</span>`
        : "";

      const presidentLine = a.posted_by_president
        ? `<div class="aa-note" style="display:none;">Posted by President • faculty_admin approval required</div>`
        : "";

      const body = escapeHtml(a.body || "");

      const initials = (text) => {
        const str = String(text || "").trim();
        if (!str) return "AN";
        return str.split(/\s+/)
          .slice(0,2)
          .map(w => w.charAt(0).toUpperCase())
          .join("");
      };

      const acceptBtn = canAccept
        ? `<button class="btn btn-sm btn-success me-1 js-accept" data-id="${a.id}" type="button">
            <i class="bi bi-check2-circle me-1"></i>Accept
          </button>`
        : "";

      const declineBtn = canDecline
        ? `<button class="btn btn-sm btn-outline-danger me-1 js-decline" data-id="${a.id}" type="button">
            <i class="bi bi-x-circle me-1"></i>Decline
          </button>`
        : "";

      const archiveBtn = canArchive
        ? `<button class="btn btn-sm btn-outline-secondary js-archive" data-id="${a.id}" type="button">
            <i class="bi bi-archive me-1"></i>Archive
          </button>`
        : "";

      return `
        <div class="col-12 col-md-6 col-xl-4">
          <div class="aa-card card border-0 shadow-sm h-100 announcement-card js-open-view"
              data-id="${a.id}" role="button" tabindex="0">

            <div class="aa-card-top">

              <div class="aa-avatar">${initials(orgLine)}</div>

              <div class="aa-title-wrap">
                <div class="aa-title">${escapeHtml(a.title)}</div>
                <div class="aa-org">${orgLine}</div>
              </div>

              <div class="aa-status">
                ${statusPill(a.status)}
              </div>

            </div>

            <div class="aa-badges">
              ${targetLine}
            </div>

            <div class="aa-body">
              ${body}
            </div>

            ${presidentLine}

            <div class="aa-footer">

              <div class="aa-date">
                <i class="bi bi-clock me-1"></i>
                ${escapeHtml(a.created_at ?? "")}
              </div>

              <div class="aa-actions">
                ${acceptBtn}
                ${declineBtn}
                ${archiveBtn}
              </div>

            </div>

          </div>
        </div>
      `;
    }

    function ensureAnnouncementCardStyles() {

  if (document.getElementById("aa-card-styles")) return;

  const style = document.createElement("style");
  style.id = "aa-card-styles";

  style.textContent = `

  .aa-card {
    border-radius:18px;
    overflow:hidden;
    background:linear-gradient(180deg,#ffffff 0%,#fbfcff 100%);
    border:1px solid rgba(13,110,253,0.08);
    transition:transform .18s ease, box-shadow .18s ease;
  }

  .aa-card:hover {
    transform:translateY(-4px);
    box-shadow:0 14px 34px rgba(0,0,0,0.10);
  }

  .aa-card-top {
    display:flex;
    gap:14px;
    padding:18px 18px 10px;
    align-items:flex-start;

    background:
    radial-gradient(circle at top right, rgba(13,110,253,0.10), transparent 35%),
    linear-gradient(180deg, rgba(13,110,253,0.04), rgba(13,110,253,0));
  }

  .aa-avatar {
    width:46px;
    height:46px;
    min-width:46px;
    border-radius:14px;
    display:flex;
    align-items:center;
    justify-content:center;
    font-weight:700;
    font-size:.95rem;

    color:#0d6efd;
    background:rgba(13,110,253,0.12);
    border:1px solid rgba(13,110,253,0.12);
  }

  .aa-title-wrap {
    flex:1;
    min-width:0;
  }

  .aa-title {
    font-size:1rem;
    font-weight:700;
    color:#1f2937;
    margin-bottom:4px;

    display:-webkit-box;
    -webkit-line-clamp:2;
    -webkit-box-orient:vertical;
    overflow:hidden;
  }

  .aa-org {
    font-size:.85rem;
    color:#6b7280;
  }

  .aa-status {
    margin-left:auto;
  }

  .aa-badges {
    padding:0 18px 10px;
  }

  .aa-badge {
    display:inline-flex;
    align-items:center;
    border-radius:999px;
    padding:6px 10px;
    font-size:.7rem;
    font-weight:700;
  }

  .aa-badge-info {
    background:#cff4fc;
    color:#055160;
  }

  .aa-body {
    padding:0 18px;
    font-size:.9rem;
    color:#374151;

    display:-webkit-box;
    -webkit-line-clamp:4;
    -webkit-box-orient:vertical;
    overflow:hidden;

    white-space:pre-wrap;
  }

  .aa-note {
    padding:8px 18px;
    font-size:.8rem;
    color:#b45309;
  }

  .aa-footer {
    margin-top:auto;
    padding:14px 18px 18px;

    display:flex;
    align-items:center;
    justify-content:space-between;
    gap:10px;
  }

  .aa-date {
    font-size:.75rem;
    color:#6b7280;
  }

  .aa-actions .btn {
    border-radius:10px;
    font-weight:600;
  }

  `;

  document.head.appendChild(style);
    }

    function wrapGridHTML(cardsHTML) {
      return `<div class="row g-3">${
        cardsHTML ||
        `<div class="col-12"><div class="text-muted text-center py-4">No announcements.</div></div>`
      }</div>`;
    }

    async function loadMe() {
  const j = await postJSON({ action: "me" });

  CURRENT.ME = j;
  CURRENT.ACTIVE_TERM_ID = j.active_term_id ? Number(j.active_term_id) : null;

  const role = j.user?.role || "student";
  if (elWhoAmI) {
    elWhoAmI.className = "badge " + badgeRole(role);
    elWhoAmI.textContent = role;
  }

  // ✅ Use the PHP flag to determine if tabs / add button should show
  CURRENT.STUDENT_ONLY = !j.can_post_announcements;

  setTabsVisible(!CURRENT.STUDENT_ONLY);
  setCreateVisible(!CURRENT.STUDENT_ONLY);
  setFiltersLocked(CURRENT.STUDENT_ONLY);

  if (CURRENT.STUDENT_ONLY) forceStudentActivePane();
  if (elReadOnlyBadge) elReadOnlyBadge.classList.add("invisible");
    }

        async function loadTerms() {
          const j = await postJSON({ action: "terms" });
          const terms = Array.isArray(j.terms) ? j.terms : [];

          CURRENT.TERMS = terms;
          buildTermsIndex(terms);

          if (j.active_term_id) {
            CURRENT.ACTIVE_TERM_ID = Number(j.active_term_id);
          }
    }

   async function loadOrgOptionsAndPopulate() {
  if (!elNewOrgSelect) return;

  try {
    const j = await postJSON({ action: "org_options" });
    CURRENT.ORG_OPTIONS = j;

    const canGeneral = !!j.can_post_general;
    const options = Array.isArray(j.options) ? j.options : [];

    elNewOrgSelect.innerHTML = "";
    elNewOrgSelect.disabled = false;

    // Only privileged users can choose General
    if (canGeneral) {
      const optGeneral = document.createElement("option");
      optGeneral.value = "";
      optGeneral.textContent = "General";
      elNewOrgSelect.appendChild(optGeneral);
    }

    options.forEach((o) => {
      const op = document.createElement("option");
      op.value = String(o.id);
      op.textContent = String(o.name || "Organization #" + o.id);
      elNewOrgSelect.appendChild(op);
    });

    if (canGeneral) {
      elNewOrgSelect.value = "";
      elNewOrgSelect.disabled = false;

      if (elNewOrgHelp) {
        elNewOrgHelp.textContent = "Choose General or an organization.";
      }
      return;
    }

    if (options.length === 0) {
      elNewOrgSelect.value = "";
      elNewOrgSelect.disabled = true;

      if (elNewOrgHelp) {
        elNewOrgHelp.textContent = "No organization assignment found for your account.";
      }
      return;
    }

    if (options.length === 1) {
      // Keep enabled so FormData still submits it
      elNewOrgSelect.value = String(options[0].id);
      elNewOrgSelect.disabled = false;

      if (elNewOrgHelp) {
        elNewOrgHelp.textContent = `Announcement will be posted under ${options[0].name}.`;
      }
      return;
    }

    elNewOrgSelect.value = String(options[0].id);
    elNewOrgSelect.disabled = false;

    if (elNewOrgHelp) {
      elNewOrgHelp.textContent = "Choose one of your assigned organizations.";
    }
  } catch (e) {
    console.warn("[ManageAnnouncement] org_options failed:", e?.message || e);
  }
    }

    function renderInto(container, items, mode) {
      if (!container) return;

      const deduped = dedupeById(items || []);
      const filtered = applyClientSearch(deduped, mode);

      const html = filtered
        .map((a) => {
          const canManage = !!a.can_manage;
          const canAccept = mode === "Pending" && canManage;
          const canDecline = mode === "Pending" && canManage;
          const canArchive = mode === "Active" && canManage;

          return renderCard(a, canAccept, canDecline, canArchive);
        })
        .join("");

      container.innerHTML = wrapGridHTML(html);
    }

    function buildListPayload(status) {
      if (CURRENT.STUDENT_ONLY) {
        return { action: "list", status, academic_term_id: CURRENT.ACTIVE_TERM_ID };
      }
      if (CURRENT.TERM_SCOPE === "all") {
        return { action: "list", status, term_scope: "all" };
      }
      const termId = CURRENT.CURRENT_TERM_ID || CURRENT.ACTIVE_TERM_ID;
      return { action: "list", status, academic_term_id: termId };
    }

    async function loadLists() {
      if (!CURRENT.STUDENT_ONLY) {
        const pending = await postJSON(buildListPayload("Pending"));
        renderInto(elPendingWrap, pending.items, "Pending");
      }

      const active = await postJSON(buildListPayload("Active"));
      renderInto(elActiveWrap, active.items, "Active");

      if (!CURRENT.STUDENT_ONLY) {
        const arch = await postJSON(buildListPayload("Archived"));
        renderInto(elArchivedWrap, arch.items, "Archived");
      }
    }

    async function changeStatus(id, status) {
      try {
        await postJSON({ action: "set_status", id: Number(id), status });
        safeShowSuccess("Announcement updated.");
        await loadLists();

        if (CURRENT.CURRENT_VIEW_ID && Number(CURRENT.CURRENT_VIEW_ID) === Number(id)) {
          await openView(Number(id), { keepOpen: true });
        }
      } catch (e) {
        safeShowError(e.message);
      }
    }

    function openEditFromView(a) {
      if (!a || !elEditForm) return;

      qs("[name=id]", elEditForm).value = String(a.id);
      qs("[name=title]", elEditForm).value = a.title || "";
      qs("[name=body]", elEditForm).value = a.body || "";

      const label = String(a.target_user_label || "").trim();
      const fixedLabel = label.replace(/\s*\(\s*/g, "(").replace(/\s*\)\s*/g, ")");
      setUserPickerValue(editPickerEls, a.target_user_id || null, fixedLabel);

      CURRENT.editModal?.show();
    }

    async function openView(id, opts = {}) {
      try {
        const j = await postJSON({ action: "get", id: Number(id) });

        CURRENT.CURRENT_VIEW_ID = Number(id);
        CURRENT.CURRENT_VIEW_ITEM = j.item;
        CURRENT.CURRENT_VIEW_CAN_EDIT = !!j.can_edit;
        CURRENT.CURRENT_VIEW_CAN_MANAGE = !!j.can_manage;

        const a = j.item;

        const orgLabel = a.org_name ? `Org: ${escapeHtml(a.org_name)}` : "General";
        const targetLabel = a.target_user_id ? " • Targeted" : "";
        const createdAt = a.created_at ? escapeHtml(a.created_at) : "";
        const reviewer = a.reviewed_at ? ` • Reviewed: ${escapeHtml(a.reviewed_at)}` : "";
        const presidentLine = a.posted_by_president
          ? `<div class="small text-warning mt-1" style="display:none;">Posted by President • faculty_admin approval required</div>`
          : "";

        if (elViewTitle) elViewTitle.textContent = a.title || "";
        if (elViewBody) elViewBody.textContent = a.body || "";
        if (elViewMeta) {
          elViewMeta.innerHTML = `
            <div class="text-muted small">${orgLabel}${targetLabel} • ${createdAt}${reviewer}</div>
            ${presidentLine}
          `;
        }
        if (elViewStatus) elViewStatus.innerHTML = statusPill(a.status);

        if (elViewBtnEdit) elViewBtnEdit.classList.toggle("d-none", !CURRENT.CURRENT_VIEW_CAN_EDIT);

        const canManageThis = !!j.can_manage;
        const showAcceptDecline = a.status === "Pending" && canManageThis;
        const showArchive = a.status === "Active" && canManageThis;

        if (elViewBtnAccept) elViewBtnAccept.classList.toggle("d-none", !showAcceptDecline);
        if (elViewBtnDecline) elViewBtnDecline.classList.toggle("d-none", !showAcceptDecline);
        if (elViewBtnArchive) elViewBtnArchive.classList.toggle("d-none", !showArchive);

        if (!opts.keepOpen) CURRENT.viewModal?.show();
      } catch (e) {
        safeShowError(e.message);
      }
    }

    function wireCreate() {
      if (!elCreateBtn || !elCreateForm || !CURRENT.createModal) return;

      on(elCreateBtn, "click", () => {
        elCreateForm.reset();

        const termField = qs("[name=academic_term_id]", elCreateForm);
        if (termField) {
          const termId = CURRENT.STUDENT_ONLY ? CURRENT.ACTIVE_TERM_ID : (CURRENT.CURRENT_TERM_ID || CURRENT.ACTIVE_TERM_ID);
          termField.value = termId ? String(termId) : "";
        }

        setUserPickerValue(newPickerEls, null, "");
        loadOrgOptionsAndPopulate();

        CURRENT.createModal.show();
      });

      on(elCreateForm, "submit", async (ev) => {
        ev.preventDefault();
        try {
          const fd = new FormData(elCreateForm);

          const title = String(fd.get("title") || "").trim();
          const body = String(fd.get("body") || "").trim();

          const orgIdRaw = String(fd.get("org_id") || "").trim();
          const orgId = orgIdRaw ? Number(orgIdRaw) : null;

          const targetUserIdRaw = String(fd.get("target_user_id") || "").trim();
          const targetUserId = targetUserIdRaw ? Number(targetUserIdRaw) : null;

          const termId =
            Number(fd.get("academic_term_id")) ||
            Number(CURRENT.CURRENT_TERM_ID || CURRENT.ACTIVE_TERM_ID || 0);

          if (!title || !body) return safeShowError("Title and body are required.");
          if (orgIdRaw && Number.isNaN(orgId))
            return safeShowError("Organization ID must be a number (or leave blank for General).");
          if (targetUserIdRaw && Number.isNaN(targetUserId))
            return safeShowError("Invalid selected target user.");
          if (!termId) return safeShowError("Missing academic term.");

          const j = await postJSON({
            action: "create",
            title,
            body,
            org_id: orgId,
            target_user_id: targetUserId || null,
            academic_term_id: termId,
          });

          const isPresidentPost = !!j.posted_by_president;

          safeShowSuccess(
            j.status === "Active"
              ? "Announcement posted and is now Active (notifications sent)."
              : isPresidentPost
              ? "Announcement submitted (Pending). Waiting for Coordinator approval."
              : "Announcement submitted (Pending). Waiting for approval."
          );

          CURRENT.createModal.hide();
          await loadLists();
        } catch (e) {
          safeShowError(e.message);
        }
      });
    }

    function wireModals() {
      if (elViewBtnEdit)
        on(elViewBtnEdit, "click", () => {
          if (!CURRENT.CURRENT_VIEW_ITEM) return;
          openEditFromView(CURRENT.CURRENT_VIEW_ITEM);
        });

      if (elViewBtnAccept) on(elViewBtnAccept, "click", () => changeStatus(CURRENT.CURRENT_VIEW_ID, "Active"));
      if (elViewBtnDecline) on(elViewBtnDecline, "click", () => changeStatus(CURRENT.CURRENT_VIEW_ID, "Declined"));
      if (elViewBtnArchive) on(elViewBtnArchive, "click", () => changeStatus(CURRENT.CURRENT_VIEW_ID, "Archived"));

      if (elEditForm) {
        on(elEditForm, "submit", async (ev) => {
          ev.preventDefault();
          try {
            const fd = new FormData(elEditForm);
            const id = Number(fd.get("id"));
            const title = String(fd.get("title") || "").trim();
            const body = String(fd.get("body") || "").trim();

            const targetUserIdRaw = String(fd.get("target_user_id") || "").trim();
            const targetUserId = targetUserIdRaw ? Number(targetUserIdRaw) : null;

            if (!title || !body) return safeShowError("Title and body are required.");
            if (targetUserIdRaw && Number.isNaN(targetUserId)) return safeShowError("Invalid selected target user.");

            await postJSON({
              action: "update",
              id,
              title,
              body,
              target_user_id: targetUserId || null,
            });

            safeShowSuccess("Announcement updated.");
            CURRENT.editModal?.hide();

            await loadLists();
            await openView(id, { keepOpen: true });
          } catch (e) {
            safeShowError(e.message);
          }
        });
      }
    }

    function bindDelegatedActionsOnce() {
      if (CURRENT.delegatedBound) return;
      CURRENT.delegatedBound = true;

      on(document, "click", (e) => {
        const t = e.target;

        const inRoot = CURRENT.root && CURRENT.root.contains(t);
        const inModal =
          (elViewModal && elViewModal.contains(t)) ||
          (elEditModal && elEditModal.contains(t)) ||
          (elCreateModal && elCreateModal.contains(t));
        if (!inRoot && !inModal) return;

        const btnAccept = t.closest(".js-accept");
        if (btnAccept) {
          e.preventDefault();
          e.stopPropagation();
          const id = btnAccept.getAttribute("data-id");
          if (id) changeStatus(id, "Active");
          return;
        }

        const btnDecline = t.closest(".js-decline");
        if (btnDecline) {
          e.preventDefault();
          e.stopPropagation();
          const id = btnDecline.getAttribute("data-id");
          if (id) changeStatus(id, "Declined");
          return;
        }

        const btnArchive = t.closest(".js-archive");
        if (btnArchive) {
          e.preventDefault();
          e.stopPropagation();
          const id = btnArchive.getAttribute("data-id");
          if (id) changeStatus(id, "Archived");
          return;
        }

        const card = t.closest(".js-open-view");
        if (card) {
          e.preventDefault();
          const id = Number(card.getAttribute("data-id") || 0);
          if (id) openView(id);
        }
      });

      on(document, "keydown", (e) => {
        const t = e.target;
        const inRoot = CURRENT.root && CURRENT.root.contains(t);
        if (!inRoot) return;

        const card = t.closest?.(".js-open-view");
        if (!card) return;

        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          const id = Number(card.getAttribute("data-id") || 0);
          if (id) openView(id);
        }
      });
    }

    function wireTabSearchBars() {
      const refresh = debounce(async () => {
        await loadLists();
      }, 200);

      if (elPendingSearch) {
        on(elPendingSearch, "input", () => {
          CURRENT.SEARCH.Pending = String(elPendingSearch.value || "");
          refresh();
        });
      }
      if (elActiveSearch) {
        on(elActiveSearch, "input", () => {
          CURRENT.SEARCH.Active = String(elActiveSearch.value || "");
          refresh();
        });
      }
      if (elArchivedSearch) {
        on(elArchivedSearch, "input", () => {
          CURRENT.SEARCH.Archived = String(elArchivedSearch.value || "");
          refresh();
        });
      }
    }

    async function initTermControls() {
      if (!elSchoolYearSelect || !elSemesterSelect) return;

      await loadTerms();

      if (CURRENT.STUDENT_ONLY) {
        const t = CURRENT.TERM_BY_ID[String(CURRENT.ACTIVE_TERM_ID)] || null;

        elSchoolYearSelect.innerHTML = "";
        const o1 = document.createElement("option");
        o1.value = String(CURRENT.ACTIVE_TERM_ID || "");
        o1.textContent = t ? String(t.school_year || "Active Term") : "Active Term";
        elSchoolYearSelect.appendChild(o1);

        elSemesterSelect.innerHTML = "";
        const o2 = document.createElement("option");
        o2.value = String(CURRENT.ACTIVE_TERM_ID || "");
        o2.textContent = t ? prettySemester(t.semester) : "Active";
        elSemesterSelect.appendChild(o2);

        CURRENT.TERM_SCOPE = "term";
        CURRENT.CURRENT_TERM_ID = CURRENT.ACTIVE_TERM_ID;

        if (elReadOnlyBadge) elReadOnlyBadge.classList.add("invisible");
        return;
      }

      const schoolYears = Object.keys(CURRENT.TERMS_BY_SY).sort((a, b) => b.localeCompare(a));

      elSchoolYearSelect.innerHTML = "";

      const oAll = document.createElement("option");
      oAll.value = "__ALL__";
      oAll.textContent = "All Terms";
      elSchoolYearSelect.appendChild(oAll);

      schoolYears.forEach((sy) => {
        const opt = document.createElement("option");
        opt.value = sy;
        opt.textContent = sy;
        elSchoolYearSelect.appendChild(opt);
      });

      const activeTerm = CURRENT.TERM_BY_ID[String(CURRENT.ACTIVE_TERM_ID)] || null;
      const defaultSY = String(activeTerm?.school_year || schoolYears[0] || "");
      const defaultSem = String(activeTerm?.semester || uniqueSemestersForSY(defaultSY)[0] || "1st");

      CURRENT.SELECTED_SCHOOL_YEAR = defaultSY;
      CURRENT.SELECTED_SEMESTER = defaultSem;
      CURRENT.TERM_SCOPE = "term";
      CURRENT.CURRENT_TERM_ID = resolveTermId(defaultSY, defaultSem) || CURRENT.ACTIVE_TERM_ID;

      elSchoolYearSelect.value = defaultSY || "__ALL__";

      function fillSemestersForSY(sy) {
        elSemesterSelect.innerHTML = "";
        const sems = uniqueSemestersForSY(sy);

        if (!sems.length) {
          const opt = document.createElement("option");
          opt.value = "";
          opt.textContent = "—";
          elSemesterSelect.appendChild(opt);
          return;
        }

        sems.forEach((sem) => {
          const opt = document.createElement("option");
          opt.value = sem;
          opt.textContent = prettySemester(sem);
          elSemesterSelect.appendChild(opt);
        });
      }

      fillSemestersForSY(defaultSY);
      elSemesterSelect.value = defaultSem;

      async function syncBadgeAndReload() {
        if (elReadOnlyBadge) {
          elReadOnlyBadge.classList.toggle(
            "invisible",
            CURRENT.TERM_SCOPE === "all" || Number(CURRENT.CURRENT_TERM_ID) === Number(CURRENT.ACTIVE_TERM_ID)
          );
        }
        await loadLists();
      }

      on(elSchoolYearSelect, "change", async () => {
        const v = String(elSchoolYearSelect.value || "").trim();

        if (v === "__ALL__") {
          CURRENT.TERM_SCOPE = "all";
          CURRENT.SELECTED_SCHOOL_YEAR = "";
          CURRENT.SELECTED_SEMESTER = "";
          CURRENT.CURRENT_TERM_ID = null;

          elSemesterSelect.disabled = true;
          elSemesterSelect.innerHTML = "";
          const opt = document.createElement("option");
          opt.value = "";
          opt.textContent = "All Semesters";
          elSemesterSelect.appendChild(opt);

          await syncBadgeAndReload();
          return;
        }

        CURRENT.TERM_SCOPE = "term";
        CURRENT.SELECTED_SCHOOL_YEAR = v;

        elSemesterSelect.disabled = false;
        fillSemestersForSY(v);

        const sems = uniqueSemestersForSY(v);
        const keep = sems.includes(CURRENT.SELECTED_SEMESTER)
          ? CURRENT.SELECTED_SEMESTER
          : (sems[0] || "");
        CURRENT.SELECTED_SEMESTER = keep;
        elSemesterSelect.value = keep;

        CURRENT.CURRENT_TERM_ID = resolveTermId(CURRENT.SELECTED_SCHOOL_YEAR, CURRENT.SELECTED_SEMESTER) || null;

        await syncBadgeAndReload();
      });

      on(elSemesterSelect, "change", async () => {
        const sem = String(elSemesterSelect.value || "").trim();
        CURRENT.TERM_SCOPE = "term";
        CURRENT.SELECTED_SEMESTER = sem;

        CURRENT.CURRENT_TERM_ID = resolveTermId(CURRENT.SELECTED_SCHOOL_YEAR, CURRENT.SELECTED_SEMESTER) || null;

        await syncBadgeAndReload();
      });

      await syncBadgeAndReload();
    }

    // Boot
    (async () => {
      try {
        wireUserPicker(newPickerEls);
        wireUserPicker(editPickerEls);

        wireTabSearchBars();
        bindDelegatedActionsOnce();
        wireModals();

        await loadMe();
        await initTermControls();
        await loadOrgOptionsAndPopulate();
        wireCreate();

        await loadLists();
      } catch (e) {
        safeShowError(e.message);
      }
    })();
  }

  window.ManageAnnouncement = { init, destroy };
})();
//success