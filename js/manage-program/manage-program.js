/* js/manage-program/manage-program.js */
/* global bootstrap, showSuccess, showError */

(function () {
  "use strict";

  const API_URL = "php/manage-program.php";

  // -------------------------
  // Helpers
  // -------------------------
  function qs(sel, root = document) {
    return root.querySelector(sel);
  }

  function setModalMessage(modalEl, msg) {
    if (!modalEl) return false;

    const targets = [
      modalEl.querySelector("[data-role='message']"),
      modalEl.querySelector(".modal-message"),
      modalEl.querySelector(".message"),
      modalEl.querySelector(".modal-body"),
    ].filter(Boolean);

    if (!targets.length) return false;
    targets[0].textContent = msg || "";
    return true;
  }

  function tryBootstrapModalByIds(ids, msg) {
    if (typeof bootstrap === "undefined" || !bootstrap?.Modal) return false;

    for (const id of ids) {
      const el = qs(id, document);
      if (!el) continue;

      setModalMessage(el, msg);

      try {
        bootstrap.Modal.getOrCreateInstance(el).show();
        return true;
      } catch {
        // keep trying
      }
    }
    return false;
  }

  function safeShowError(msg) {
    const m = msg || "Something went wrong.";

    if (typeof window.showError === "function") {
      try {
        window.showError(m);
        return;
      } catch {
        // fall through
      }
    }

    const shown = tryBootstrapModalByIds(
      ["#modalError", "#errorModal", "#globalErrorModal", "#toastErrorModal", "#notifErrorModal"],
      m
    );
    if (shown) return;

    alert(m);
  }

  function safeShowSuccess(msg) {
    const m = msg || "Success.";

    if (typeof window.showSuccess === "function") {
      try {
        window.showSuccess(m);
        return;
      } catch {
        // fall through
      }
    }

    const shown = tryBootstrapModalByIds(
      ["#modalSuccess", "#successModal", "#globalSuccessModal", "#toastSuccessModal", "#notifSuccessModal"],
      m
    );
    if (shown) return;

    alert(m);
  }

  function setBtnLoading(btn, loading, textSel, loadingSel) {
    if (!btn) return;
    const t = btn.querySelector(textSel);
    const l = btn.querySelector(loadingSel);
    if (t) t.classList.toggle("d-none", !!loading);
    if (l) l.classList.toggle("d-none", !loading);
    btn.disabled = !!loading;
  }

  function setAlert(el, show, msg = "", kind = "danger") {
    if (!el) return;
    el.classList.toggle("d-none", !show);
    el.classList.remove("alert-danger", "alert-success", "alert-warning", "alert-info");
    el.classList.add(kind === "success" ? "alert-success" : "alert-danger");
    el.textContent = msg || "";
  }

  function escapeHtml(str) {
    return String(str ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function s(v) {
    return String(v ?? "").trim();
  }

  function clamp(n, min, max) {
    const x = Number(n);
    if (!Number.isFinite(x)) return min;
    return Math.max(min, Math.min(max, x));
  }

  function formatDateTime(v) {
    if (!v) return "—";
    return String(v);
  }

  function resolveIconSrc(path) {
    if (!path) return "";
    if (/^https?:\/\//i.test(path)) return path;
    return path.startsWith("/") ? path : path;
  }

  function renderIconCell(imagePath, altText) {
    const src = resolveIconSrc(imagePath);
    if (!src) {
      return `
        <div class="border bg-white rounded-3 d-flex align-items-center justify-content-center"
             style="width:42px;height:42px;overflow:hidden;">
          <i class="bi bi-image text-muted"></i>
        </div>
      `;
    }
    return `
      <div class="border bg-white rounded-3 d-flex align-items-center justify-content-center"
           style="width:42px;height:42px;overflow:hidden;">
        <img src="${escapeHtml(src)}" alt="${escapeHtml(altText || "icon")}"
             style="width:100%;height:100%;object-fit:cover;">
      </div>
    `;
  }

  async function requestJSON(payload) {
    const res = await fetch(API_URL, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const text = await res.text();
    console.log("[ManagePrograms] RAW:", res.status, text);

    let data;
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error("Invalid server response (not JSON). Check console RAW.");
    }

    if (!res.ok) throw new Error(data?.message || `HTTP ${res.status}`);
    if (!data?.success) throw new Error(data?.message || "Request failed.");
    return data;
  }

  async function requestFormData(fd) {
    const res = await fetch(API_URL, {
      method: "POST",
      credentials: "include",
      body: fd,
    });

    const text = await res.text();
    console.log("[ManagePrograms] RAW(FD):", res.status, text);

    let data;
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error("Invalid server response (not JSON). Check console RAW.");
    }

    if (!res.ok) throw new Error(data?.message || `HTTP ${res.status}`);
    if (!data?.success) throw new Error(data?.message || "Request failed.");
    return data;
  }

  // -------------------------
  // School Year: DIGITS ONLY (NO DASH INSERT)
  // - Blocks letters/symbols
  // - Allows only digits (0-9)
  // - DOES NOT add "-" automatically
  // - Works for typing + paste + drag/drop
  // - Attaches only if #school_year exists
  // -------------------------
  const SchoolYearDigitsOnly = {
    attached: new WeakSet(),
  };

  function digitsOnly(value) {
    // keep only digits; don't add dash; keep max 9? (your HTML uses maxlength=9)
    // If you want up to 8 digits (YYYYYYYY), change slice(0, 8).
    return String(value ?? "").replace(/\D/g, "");
  }

  function attachSchoolYearDigitsOnly(input) {
    if (!input || !(input instanceof HTMLInputElement)) return;
    if (SchoolYearDigitsOnly.attached.has(input)) return;
    SchoolYearDigitsOnly.attached.add(input);

    // normalize initial
    input.value = digitsOnly(input.value);

    // hard block non-digits at keydown (best UX)
    input.addEventListener("keydown", (e) => {
      const k = e.key;

      // allow ctrl/cmd shortcuts (copy/paste/cut/select all)
      if (e.ctrlKey || e.metaKey) return;

      // allow navigation/edit keys
      const allowed = ["Backspace", "Delete", "ArrowLeft", "ArrowRight", "Home", "End", "Tab"];
      if (allowed.includes(k)) return;

      // allow digits only
      if (!/^\d$/.test(k)) {
        e.preventDefault();
      }
    });

    // handle paste/drop/IME etc.
    input.addEventListener("input", () => {
      const before = input.value;
      const cleaned = digitsOnly(before);

      if (cleaned !== before) {
        // keep caret near the same spot
        const pos = input.selectionStart ?? cleaned.length;
        const diff = before.length - cleaned.length;
        input.value = cleaned;
        try {
          const newPos = Math.max(0, pos - diff);
          input.setSelectionRange(newPos, newPos);
        } catch {
          // ignore
        }
      }
    });

    // optional: prevent drop of non-digit text (still sanitized by input handler)
    input.addEventListener("drop", (e) => {
      // allow drop but sanitize after
      setTimeout(() => {
        input.value = digitsOnly(input.value);
      }, 0);
    });
  }

  function ensureSchoolYearDigitsOnly() {
    const el = qs("#school_year", document);
    if (el) attachSchoolYearDigitsOnly(el);
  }

  // -------------------------
  // State
  // -------------------------
  const State = {
    active: { page: 1, pageSize: 50, search: "", items: [], total: 0, totalPages: 1, loaded: false, signature: "" },
    archived: { page: 1, pageSize: 50, search: "", items: [], total: 0, totalPages: 1, loaded: false, signature: "" },
    confirm: { id: null, action: "", program_name: "", abbreviation: "" },
    polling: { timer: null, everyMs: 6000, paused: false, running: false },
    delegatedBound: false,
    currentRoot: null,
  };

  // -------------------------
  // DOM getters
  // -------------------------
  const els = {
    root: () => State.currentRoot || document,

    btnRefresh: () => qs("#btnRefreshPrograms", els.root()),
    btnAdd: () => qs("#btnAddProgram", els.root()),

    activeSearch: () => qs("#activeProgramsSearch", els.root()),
    archivedSearch: () => qs("#archivedProgramsSearch", els.root()),
    activePageSize: () => qs("#activeProgramsPageSize", els.root()),
    archivedPageSize: () => qs("#archivedProgramsPageSize", els.root()),

    activeTbody: () => qs("#activeProgramsTbody", els.root()),
    archivedTbody: () => qs("#archivedProgramsTbody", els.root()),

    activeMeta: () => qs("#activeProgramsMeta", els.root()),
    archivedMeta: () => qs("#archivedProgramsMeta", els.root()),
    activePagination: () => qs("#activeProgramsPagination", els.root()),
    archivedPagination: () => qs("#archivedProgramsPagination", els.root()),

    upsertModalEl: () => qs("#modalUpsertProgram", document),
    confirmModalEl: () => qs("#modalConfirmProgramAction", document),

    formUpsert: () => qs("#formUpsertProgram", document),
    programId: () => qs("#program_id", document),
    programName: () => qs("#program_name", document),
    abbreviation: () => qs("#abbreviation", document),
    imageFile: () => qs("#image_file", document),

    iconPreview: () => qs("#programIconPreview", document),
    iconPlaceholder: () => qs("#programIconPlaceholder", document),
    btnClearIcon: () => qs("#btnClearProgramIcon", document),

    formError: () => qs("#programFormError", document),
    formSuccess: () => qs("#programFormSuccess", document),
    btnSave: () => qs("#btnSaveProgram", document),

    confirmProgramId: () => qs("#confirm_program_id", document),
    confirmAction: () => qs("#confirm_action", document),
    confirmTitle: () => qs("#confirmProgramTitle", document),
    confirmMessage: () => qs("#confirmProgramMessage", document),
    confirmName: () => qs("#confirm_program_name", document),
    confirmAbbr: () => qs("#confirm_program_abbr", document),
    confirmError: () => qs("#confirmProgramError", document),
    btnConfirmAction: () => qs("#btnConfirmProgramAction", document),
  };

  // -------------------------
  // Pagination rendering
  // -------------------------
  function computeMetaText(page, pageSize, total) {
    if (!total || total <= 0) return "Showing 0–0 of 0";
    const start = (page - 1) * pageSize + 1;
    const end = Math.min(page * pageSize, total);
    return `Showing ${start}–${end} of ${total}`;
  }

  function buildPagination(ul, page, totalPages) {
    if (!ul) return;

    const tp = Math.max(1, Number(totalPages || 1));
    const p = clamp(page, 1, tp);

    const windowSize = 5;
    let start = Math.max(1, p - Math.floor(windowSize / 2));
    let end = Math.min(tp, start + windowSize - 1);
    start = Math.max(1, end - windowSize + 1);

    const items = [];

    items.push(`
      <li class="page-item ${p <= 1 ? "disabled" : ""}">
        <a class="page-link" href="#" data-page="prev">Prev</a>
      </li>
    `);

    if (start > 1) {
      items.push(`
        <li class="page-item ${p === 1 ? "active" : ""}">
          <a class="page-link" href="#" data-page="1">1</a>
        </li>
      `);
      if (start > 2) items.push(`<li class="page-item disabled"><span class="page-link">…</span></li>`);
    }

    for (let i = start; i <= end; i++) {
      items.push(`
        <li class="page-item ${p === i ? "active" : ""}">
          <a class="page-link" href="#" data-page="${i}">${i}</a>
        </li>
      `);
    }

    if (end < tp) {
      if (end < tp - 1) items.push(`<li class="page-item disabled"><span class="page-link">…</span></li>`);
      items.push(`
        <li class="page-item ${p === tp ? "active" : ""}">
          <a class="page-link" href="#" data-page="${tp}">${tp}</a>
        </li>
      `);
    }

    items.push(`
      <li class="page-item ${p >= tp ? "disabled" : ""}">
        <a class="page-link" href="#" data-page="next">Next</a>
      </li>
    `);

    ul.innerHTML = items.join("");
  }

  // -------------------------
  // Table rendering
  // -------------------------
  function renderActiveRows(items) {
    const tbody = els.activeTbody();
    if (!tbody) return;

    if (!items || items.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="6" class="text-center text-muted py-5">
            <div class="mb-2"><i class="bi bi-inbox" style="font-size:1.5rem;"></i></div>
            No active programs found.
          </td>
        </tr>
      `;
      return;
    }

    tbody.innerHTML = items
      .map((p) => {
        const id = Number(p.id);
        const abbr = p.abbreviation || "—";
        const name = p.program_name || "—";
        const status = p.status || "Active";
        const created = formatDateTime(p.created_at);

        const badge =
          String(status).toLowerCase() === "active"
            ? `<span class="badge bg-success-subtle text-success border border-success-subtle">Active</span>`
            : `<span class="badge bg-secondary-subtle text-secondary border border-secondary-subtle">${escapeHtml(status)}</span>`;

        return `
          <tr data-id="${id}">
            <td>${renderIconCell(p.image_path, abbr)}</td>
            <td class="fw-semibold">${escapeHtml(abbr)}</td>
            <td>${escapeHtml(name)}</td>
            <td>${badge}</td>
            <td class="text-muted small">${escapeHtml(created)}</td>
            <td class="text-end">
              <button type="button" class="btn btn-sm btn-outline-primary me-1 btn-edit-program" data-id="${id}">
                <i class="bi bi-pencil-square me-1"></i>Edit
              </button>
              <button type="button" class="btn btn-sm btn-outline-danger btn-archive-program" data-id="${id}">
                <i class="bi bi-archive me-1"></i>Archive
              </button>
            </td>
          </tr>
        `;
      })
      .join("");
  }

  function renderArchivedRows(items) {
    const tbody = els.archivedTbody();
    if (!tbody) return;

    if (!items || items.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="6" class="text-center text-muted py-5">
            <div class="mb-2"><i class="bi bi-archive" style="font-size:1.5rem;"></i></div>
            No archived programs found.
          </td>
        </tr>
      `;
      return;
    }

    tbody.innerHTML = items
      .map((p) => {
        const id = Number(p.id);
        const abbr = p.abbreviation || "—";
        const name = p.program_name || "—";
        const status = p.status || "Archived";
        const created = formatDateTime(p.created_at);

        const badge =
          String(status).toLowerCase() === "archived"
            ? `<span class="badge bg-warning-subtle text-dark border border-warning-subtle">Archived</span>`
            : `<span class="badge bg-secondary-subtle text-secondary border border-secondary-subtle">${escapeHtml(status)}</span>`;

        return `
          <tr data-id="${id}">
            <td>${renderIconCell(p.image_path, abbr)}</td>
            <td class="fw-semibold">${escapeHtml(abbr)}</td>
            <td>${escapeHtml(name)}</td>
            <td>${badge}</td>
            <td class="text-muted small">${escapeHtml(created)}</td>
            <td class="text-end">
              <button type="button" class="btn btn-sm btn-outline-primary me-1 btn-edit-program" data-id="${id}">
                <i class="bi bi-pencil-square me-1"></i>Edit
              </button>
              <button type="button" class="btn btn-sm btn-outline-secondary btn-restore-program" data-id="${id}">
                <i class="bi bi-arrow-counterclockwise me-1"></i>Restore
              </button>
            </td>
          </tr>
        `;
      })
      .join("");
  }

  function renderActivePagination() {
    const meta = els.activeMeta();
    if (meta) meta.textContent = computeMetaText(State.active.page, State.active.pageSize, State.active.total);
    buildPagination(els.activePagination(), State.active.page, State.active.totalPages);
  }

  function renderArchivedPagination() {
    const meta = els.archivedMeta();
    if (meta) meta.textContent = computeMetaText(State.archived.page, State.archived.pageSize, State.archived.total);
    buildPagination(els.archivedPagination(), State.archived.page, State.archived.totalPages);
  }

  // -------------------------
  // Data loading
  // -------------------------
  async function loadActive({ paint = true } = {}) {
    const data = await requestJSON({
      action: "list_active",
      search: State.active.search,
      page: State.active.page,
      pageSize: State.active.pageSize,
    });

    State.active.items = data.items || [];
    State.active.total = Number(data.total || 0);
    State.active.totalPages = Number(data.totalPages || 1);
    State.active.loaded = true;

    if (State.active.page > State.active.totalPages && State.active.totalPages >= 1) {
      State.active.page = State.active.totalPages;
      return loadActive({ paint });
    }

    if (paint) {
      renderActiveRows(State.active.items);
      renderActivePagination();
    }
  }

  async function loadArchived({ paint = true } = {}) {
    const data = await requestJSON({
      action: "list_archived",
      search: State.archived.search,
      page: State.archived.page,
      pageSize: State.archived.pageSize,
    });

    State.archived.items = data.items || [];
    State.archived.total = Number(data.total || 0);
    State.archived.totalPages = Number(data.totalPages || 1);
    State.archived.loaded = true;

    if (State.archived.page > State.archived.totalPages && State.archived.totalPages >= 1) {
      State.archived.page = State.archived.totalPages;
      return loadArchived({ paint });
    }

    if (paint) {
      renderArchivedRows(State.archived.items);
      renderArchivedPagination();
    }
  }

  async function refreshAll({ toast = true } = {}) {
    try {
      await Promise.all([loadActive(), loadArchived()]);
      if (toast) safeShowSuccess("Programs refreshed.");
    } catch (e) {
      safeShowError(e?.message || "Failed to refresh.");
    }
  }

  // -------------------------
  // Change detection (polling)
  // -------------------------
  function computeSignatureFromListPayload(payload) {
    const total = Number(payload.total || 0);
    const first = Array.isArray(payload.items) && payload.items.length ? payload.items[0] : null;
    const newestId = first ? String(first.id ?? "") : "";
    const newestCreated = first ? String(first.created_at ?? "") : "";
    return `${total}|${newestId}|${newestCreated}`;
  }

  async function fetchSignature(statusKey) {
    const isActive = statusKey === "active";
    const search = isActive ? State.active.search : State.archived.search;

    const data = await requestJSON({
      action: isActive ? "list_active" : "list_archived",
      search,
      page: 1,
      pageSize: 1,
    });

    return computeSignatureFromListPayload(data);
  }

  function anyModalOpen() {
    const u = els.upsertModalEl();
    const c = els.confirmModalEl();
    return !!((u && u.classList.contains("show")) || (c && c.classList.contains("show")));
  }

  async function pollForChanges() {
    if (State.polling.running) return;
    if (State.polling.paused) return;
    if (anyModalOpen()) return;

    State.polling.running = true;
    try {
      const [sigA, sigR] = await Promise.all([fetchSignature("active"), fetchSignature("archived")]);
      const changed = sigA !== State.active.signature || sigR !== State.archived.signature;

      if (changed) {
        await Promise.all([loadActive(), loadArchived()]);
        State.active.signature = sigA;
        State.archived.signature = sigR;
      }
    } catch (e) {
      console.warn("[ManagePrograms] Poll failed:", e?.message || e);
    } finally {
      State.polling.running = false;
    }
  }

  function startPolling() {
    stopPolling();
    State.polling.timer = setInterval(pollForChanges, State.polling.everyMs);
  }

  function stopPolling() {
    if (State.polling.timer) clearInterval(State.polling.timer);
    State.polling.timer = null;
    State.polling.running = false;
  }

  // -------------------------
  // Preview visibility helpers
  // -------------------------
  function getPreviewBoxEl() {
    const img = els.iconPreview();
    const ph = els.iconPlaceholder();
    return (
      img?.closest(".border.rounded-4.p-3.bg-light") ||
      ph?.closest(".border.rounded-4.p-3.bg-light") ||
      null
    );
  }

  function setPreviewBoxVisible(visible) {
    const box = getPreviewBoxEl();
    if (!box) return;
    box.style.display = visible ? "" : "none";
  }

  // -------------------------
  // Modal helpers
  // -------------------------
  function setIconPreview(srcOrNull) {
    const img = els.iconPreview();
    const placeholder = els.iconPlaceholder();
    if (!img || !placeholder) return;

    if (!srcOrNull) {
      img.style.display = "none";
      img.src = "";
      placeholder.classList.add("d-none");
      setPreviewBoxVisible(false);
      return;
    }

    setPreviewBoxVisible(true);
    img.src = srcOrNull;
    img.style.display = "block";
    placeholder.classList.add("d-none");
  }

  function resetUpsertForm() {
    const form = els.formUpsert();
    if (form) form.reset();

    if (els.programId()) els.programId().value = "";
    if (els.programName()) els.programName().value = "";
    if (els.abbreviation()) els.abbreviation().value = "";

    const f = els.imageFile();
    if (f) f.value = "";

    setIconPreview(null);

    setAlert(els.formError(), false, "");
    setAlert(els.formSuccess(), false, "");

    const label = qs("#modalUpsertProgramLabel", document);
    if (label) label.textContent = "Add Program";

    const sub = qs("#modalUpsertProgram .modal-header .text-muted.small", document);
    if (sub) sub.textContent = "Fill in the program details. Uploading an icon is optional.";

    // NEW: attach digits-only behavior if school_year exists anywhere
    ensureSchoolYearDigitsOnly();
  }

  function previewSelectedFile() {
    const input = els.imageFile();

    if (!input || !input.files || input.files.length === 0) {
      setIconPreview(null);
      return;
    }

    const file = input.files[0];
    if (!file) {
      setIconPreview(null);
      return;
    }

    const url = URL.createObjectURL(file);
    setIconPreview(url);

    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  async function openEditModal(programId) {
    resetUpsertForm();

    try {
      const data = await requestJSON({ action: "get_one", id: programId });
      const p = data.program;

      if (els.programId()) els.programId().value = String(p.id ?? "");
      if (els.programName()) els.programName().value = p.program_name ?? "";
      if (els.abbreviation()) els.abbreviation().value = p.abbreviation ?? "";

      const existingIcon = resolveIconSrc(p.image_path || "");
      if (existingIcon) setIconPreview(existingIcon);
      else setIconPreview(null);

      const label = qs("#modalUpsertProgramLabel", document);
      if (label) label.textContent = "Edit Program";

      const sub = qs("#modalUpsertProgram .modal-header .text-muted.small", document);
      if (sub) sub.textContent = "Update program details. Uploading a new icon replaces the old one.";

      const modalEl = els.upsertModalEl();
      if (modalEl) bootstrap.Modal.getOrCreateInstance(modalEl).show();

      // NEW: safe no-op if #school_year not present
      ensureSchoolYearDigitsOnly();
    } catch (e) {
      safeShowError(e?.message || "Failed to load program.");
    }
  }

  function getProgramFromState(id) {
    const pid = Number(id);
    return (
      State.active.items.find((x) => Number(x.id) === pid) ||
      State.archived.items.find((x) => Number(x.id) === pid) ||
      null
    );
  }

  function openConfirmModal({ id, action, program_name, abbreviation }) {
    State.confirm.id = Number(id);
    State.confirm.action = String(action || "");
    State.confirm.program_name = String(program_name || "");
    State.confirm.abbreviation = String(abbreviation || "");

    if (els.confirmProgramId()) els.confirmProgramId().value = String(State.confirm.id || "");
    if (els.confirmAction()) els.confirmAction().value = State.confirm.action;

    const isArchive = State.confirm.action === "archive";
    const title = isArchive ? "Archive Program" : "Restore Program";
    const msg = isArchive
      ? "This will move the program to Archived Programs and hide it from selection."
      : "This will restore the program to Active Programs and make it selectable again.";

    if (els.confirmTitle()) els.confirmTitle().textContent = title;
    if (els.confirmMessage()) els.confirmMessage().textContent = msg;

    if (els.confirmName()) els.confirmName().textContent = State.confirm.program_name || "—";
    if (els.confirmAbbr()) els.confirmAbbr().textContent = State.confirm.abbreviation || "—";

    setAlert(els.confirmError(), false, "");

    const btn = els.btnConfirmAction();
    if (btn) {
      btn.classList.toggle("btn-danger", isArchive);
      btn.classList.toggle("btn-success", !isArchive);
      const t = btn.querySelector(".programaction-btn-text");
      if (t) t.textContent = isArchive ? "Archive" : "Restore";
    }

    const modalEl = els.confirmModalEl();
    if (modalEl) bootstrap.Modal.getOrCreateInstance(modalEl).show();

    // NEW: safe no-op if #school_year not present
    ensureSchoolYearDigitsOnly();
  }

  // -------------------------
  // Actions
  // -------------------------
  async function handleUpsertSubmit() {
    const btn = els.btnSave();
    setBtnLoading(btn, true, ".programsave-btn-text", ".programsave-btn-loading");
    setAlert(els.formError(), false, "");
    setAlert(els.formSuccess(), false, "");

    try {
      const id = s(els.programId()?.value || "");
      const name = s(els.programName()?.value || "");
      const abbr = s(els.abbreviation()?.value || "").toUpperCase();

      if (!name) throw new Error("Program name is required.");
      if (!abbr) throw new Error("Abbreviation is required.");

      const fd = new FormData();
      fd.append("action", id ? "update" : "create");
      if (id) fd.append("id", id);
      fd.append("program_name", name);
      fd.append("abbreviation", abbr);

      const fileInput = els.imageFile();
      if (fileInput && fileInput.files && fileInput.files[0]) {
        fd.append("image", fileInput.files[0]);
      }

      const data = await requestFormData(fd);

      const okMsg = data?.message || (id ? "Program updated." : "Program created.");
      setAlert(els.formSuccess(), true, okMsg, "success");
      safeShowSuccess(okMsg);

      State.active.page = 1;

      await Promise.all([loadActive(), loadArchived()]);
      State.active.signature = await fetchSignature("active");
      State.archived.signature = await fetchSignature("archived");

      const modalEl = els.upsertModalEl();
      if (modalEl) setTimeout(() => bootstrap.Modal.getOrCreateInstance(modalEl).hide(), 200);
    } catch (err) {
      const msg = err?.message || "Failed to save.";
      setAlert(els.formError(), true, msg, "danger");
      safeShowError(msg);
    } finally {
      setBtnLoading(btn, false, ".programsave-btn-text", ".programsave-btn-loading");
    }
  }

  async function handleConfirmAction() {
    const btn = els.btnConfirmAction();
    setBtnLoading(btn, true, ".programaction-btn-text", ".programaction-btn-loading");
    setAlert(els.confirmError(), false, "");

    try {
      const id = Number(els.confirmProgramId()?.value || 0);
      const action = String(els.confirmAction()?.value || "");

      if (!id) throw new Error("Invalid program id.");
      if (action !== "archive" && action !== "restore") throw new Error("Invalid action.");

      await requestJSON({ action, id });

      await Promise.all([loadActive(), loadArchived()]);
      State.active.signature = await fetchSignature("active");
      State.archived.signature = await fetchSignature("archived");

      const modalEl = els.confirmModalEl();
      if (modalEl) bootstrap.Modal.getOrCreateInstance(modalEl).hide();

      safeShowSuccess(action === "archive" ? "Program archived." : "Program restored.");
    } catch (e) {
      const msg = e?.message || "Failed to process.";
      setAlert(els.confirmError(), true, msg, "danger");
      safeShowError(msg);
    } finally {
      setBtnLoading(btn, false, ".programaction-btn-text", ".programaction-btn-loading");
    }
  }

  // -------------------------
  // Delegated events
  // -------------------------
  function bindDelegatedEventsOnce() {
    if (State.delegatedBound) return;
    State.delegatedBound = true;

    document.addEventListener(
      "submit",
      (e) => {
        const form = e.target;
        if (!(form instanceof HTMLFormElement)) return;
        if (form.id !== "formUpsertProgram") return;

        e.preventDefault();
        e.stopPropagation();
        if (typeof e.stopImmediatePropagation === "function") e.stopImmediatePropagation();

        handleUpsertSubmit();
      },
      true
    );

    document.addEventListener("click", async (e) => {
      const t = e.target;

      const root = els.root();
      const inRoot = !!(root && root.contains(t));
      const inUpsertModal = !!t.closest("#modalUpsertProgram");
      const inConfirmModal = !!t.closest("#modalConfirmProgramAction");
      if (!inRoot && !inUpsertModal && !inConfirmModal) return;

      if (t.closest("#btnRefreshPrograms")) {
        e.preventDefault();
        refreshAll();
        return;
      }

      if (t.closest("#btnAddProgram")) {
        e.preventDefault();
        resetUpsertForm();
        return;
      }

      if (t.closest("#btnSaveProgram")) {
        e.preventDefault();
        handleUpsertSubmit();
        return;
      }

      if (t.closest("#btnClearProgramIcon")) {
        e.preventDefault();
        const f = els.imageFile();
        if (f) f.value = "";
        setIconPreview(null);
        return;
      }

      if (t.closest("#btnConfirmProgramAction")) {
        e.preventDefault();
        handleConfirmAction();
        return;
      }

      const editBtn = t.closest(".btn-edit-program");
      if (editBtn) {
        e.preventDefault();
        const id = editBtn.getAttribute("data-id");
        if (id) openEditModal(id);
        return;
      }

      const archiveBtn = t.closest(".btn-archive-program");
      if (archiveBtn) {
        e.preventDefault();
        const id = archiveBtn.getAttribute("data-id");
        const p = id ? getProgramFromState(id) : null;
        openConfirmModal({
          id,
          action: "archive",
          program_name: p?.program_name || "—",
          abbreviation: p?.abbreviation || "—",
        });
        return;
      }

      const restoreBtn = t.closest(".btn-restore-program");
      if (restoreBtn) {
        e.preventDefault();
        const id = restoreBtn.getAttribute("data-id");
        const p = id ? getProgramFromState(id) : null;
        openConfirmModal({
          id,
          action: "restore",
          program_name: p?.program_name || "—",
          abbreviation: p?.abbreviation || "—",
        });
        return;
      }

      const aPag = t.closest("#activeProgramsPagination a.page-link");
      if (aPag) {
        e.preventDefault();
        const val = aPag.getAttribute("data-page");
        if (!val) return;

        if (val === "prev") State.active.page = Math.max(1, State.active.page - 1);
        else if (val === "next") State.active.page = Math.min(State.active.totalPages, State.active.page + 1);
        else State.active.page = clamp(Number(val), 1, Math.max(1, State.active.totalPages));

        await loadActive();
        return;
      }

      const rPag = t.closest("#archivedProgramsPagination a.page-link");
      if (rPag) {
        e.preventDefault();
        const val = rPag.getAttribute("data-page");
        if (!val) return;

        if (val === "prev") State.archived.page = Math.max(1, State.archived.page - 1);
        else if (val === "next") State.archived.page = Math.min(State.archived.totalPages, State.archived.page + 1);
        else State.archived.page = clamp(Number(val), 1, Math.max(1, State.archived.totalPages));

        await loadArchived();
        return;
      }
    });

    let tActive = null;
    let tArchived = null;

    document.addEventListener("input", (e) => {
      const root = els.root();
      if (!root || !root.contains(e.target)) return;

      const el = e.target;

      if (el && el.id === "activeProgramsSearch") {
        clearTimeout(tActive);
        tActive = setTimeout(async () => {
          State.active.search = s(els.activeSearch()?.value || "");
          State.active.page = 1;
          await loadActive();
        }, 250);
      }

      if (el && el.id === "archivedProgramsSearch") {
        clearTimeout(tArchived);
        tArchived = setTimeout(async () => {
          State.archived.search = s(els.archivedSearch()?.value || "");
          State.archived.page = 1;
          await loadArchived();
        }, 250);
      }

      // NEW: if user is typing in #school_year, ensure digits-only is attached
      if (el && el.id === "school_year") {
        ensureSchoolYearDigitsOnly();
      }
    });

    document.addEventListener("change", async (e) => {
      const root = els.root();
      const inRoot = !!(root && root.contains(e.target));
      const inUpsertModal = !!e.target.closest("#modalUpsertProgram");
      if (!inRoot && !inUpsertModal) return;

      const el = e.target;
      if (!el) return;

      if (el.id === "activeProgramsPageSize") {
        State.active.pageSize = clamp(Number(el.value || 50), 1, 200);
        State.active.page = 1;
        await loadActive();
      }

      if (el.id === "archivedProgramsPageSize") {
        State.archived.pageSize = clamp(Number(el.value || 50), 1, 200);
        State.archived.page = 1;
        await loadArchived();
      }

      if (el.id === "image_file") {
        previewSelectedFile();
      }

      // NEW: safe no-op if #school_year not present
      if (el.id === "school_year") {
        ensureSchoolYearDigitsOnly();
      }
    });

    document.addEventListener("shown.bs.modal", (e) => {
      const m = e.target;
      if (!(m instanceof HTMLElement)) return;
      if (m.id === "modalUpsertProgram" || m.id === "modalConfirmProgramAction") State.polling.paused = true;

      if (m.id === "modalUpsertProgram") previewSelectedFile();

      // NEW: when ANY modal opens, attach digits-only if #school_year exists
      ensureSchoolYearDigitsOnly();
    });

    document.addEventListener("hidden.bs.modal", (e) => {
      const m = e.target;
      if (!(m instanceof HTMLElement)) return;
      if (m.id === "modalUpsertProgram" || m.id === "modalConfirmProgramAction") State.polling.paused = false;
    });
  }

  // -------------------------
  // Init
  // -------------------------
  async function init(rootEl) {
    try {
      State.currentRoot = rootEl || qs("#content-area") || document;
      if (!qs("#programTabs", els.root())) return;

      bindDelegatedEventsOnce();

      const aPS = Number(els.activePageSize()?.value || 50);
      const rPS = Number(els.archivedPageSize()?.value || 50);
      State.active.pageSize = clamp(aPS, 1, 200);
      State.archived.pageSize = clamp(rPS, 1, 200);

      if (els.upsertModalEl()) bootstrap.Modal.getOrCreateInstance(els.upsertModalEl());
      if (els.confirmModalEl()) bootstrap.Modal.getOrCreateInstance(els.confirmModalEl());

      // NEW: attach digits-only behavior if #school_year exists anywhere
      ensureSchoolYearDigitsOnly();

      await Promise.all([loadActive(), loadArchived()]);

      State.active.signature = await fetchSignature("active");
      State.archived.signature = await fetchSignature("archived");
      startPolling();
    } catch (e) {
      safeShowError(e?.message || "Failed to load Manage Programs.");
    }
  }

  async function refresh() {
    try {
      await Promise.all([loadActive(), loadArchived()]);
      State.active.signature = await fetchSignature("active");
      State.archived.signature = await fetchSignature("archived");

      // NEW: safe no-op
      ensureSchoolYearDigitsOnly();
    } catch (e) {
      safeShowError(e?.message || "Failed to refresh.");
    }
  }

  window.ManagePrograms = { init, refresh, startPolling, stopPolling };
  console.log("Manage Program Triggered: ", window.ManagePrograms);
})();
