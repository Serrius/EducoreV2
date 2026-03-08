/* js/manage-academic-terms/manage-academic-terms.js */
/* global bootstrap, showSuccess, showError */

(function () {
  "use strict";

  const API_URL = "php/manage-academic-terms.php";

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
        // try next id
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

  function fmtCreated(v) {
    if (!v) return "—";
    return String(v);
  }

  function isSchoolYearValid(sy) {
    return /^\d{4}-\d{4}$/.test(String(sy || "").trim());
  }

  function prettySemester(sem) {
    const x = String(sem || "").trim();
    if (x === "1st") return "1st Semester";
    if (x === "2nd") return "2nd Semester";
    if (x.toLowerCase() === "summer") return "Summer";
    return x || "—";
  }

  function formatSchoolYearInput(raw) {
    // keep digits only
    const digits = String(raw || "").replace(/\D/g, "").slice(0, 8); // YYYYYYYY
    const a = digits.slice(0, 4);
    const b = digits.slice(4, 8);
    if (b.length) return `${a}-${b}`;
    return a;
  }

  async function requestJSON(payload) {
    const res = await fetch(API_URL, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const text = await res.text();
    console.log("[AcademicTerms] RAW:", res.status, text);

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
  // State
  // -------------------------
  const State = {
    active: { search: "", items: [], signature: "" },
    closed: { page: 1, pageSize: 50, search: "", items: [], total: 0, totalPages: 1, signature: "" },
    currentRoot: null,
    delegatedBound: false,
    polling: { timer: null, everyMs: 6000, paused: false, running: false },
    confirm: { id: null, action: "", school_year: "", semester: "" },
    activeTermId: null,
  };

  // -------------------------
  // DOM getters
  // -------------------------
  const els = {
    root: () => State.currentRoot || document,

    btnRefresh: () => qs("#btnRefreshTerms", els.root()),
    btnAdd: () => qs("#btnAddTerm", els.root()),

    activeSearch: () => qs("#activeTermsSearch", els.root()),
    closedSearch: () => qs("#closedTermsSearch", els.root()),
    closedPageSize: () => qs("#closedTermsPageSize", els.root()),

    activeTbody: () => qs("#activeTermsTbody", els.root()),
    closedTbody: () => qs("#closedTermsTbody", els.root()),

    closedMeta: () => qs("#closedTermsMeta", els.root()),
    closedPagination: () => qs("#closedTermsPagination", els.root()),

    activeTitle: () => qs("#activeTermTitle", els.root()),
    activeSubtitle: () => qs("#activeTermSubtitle", els.root()),
    btnEditActive: () => qs("#btnEditActiveTerm", els.root()),
    btnCloseActive: () => qs("#btnCloseActiveTerm", els.root()),

    upsertModalEl: () => qs("#modalUpsertTerm", document),
    confirmModalEl: () => qs("#modalConfirmTermAction", document),

    formUpsert: () => qs("#formUpsertTerm", document),
    termId: () => qs("#term_id", document),
    schoolYear: () => qs("#school_year", document),
    semester: () => qs("#semester", document),
    statusActiveRadio: () => qs("#statusActive", document),
    statusClosedRadio: () => qs("#statusClosed", document),
    btnSave: () => qs("#btnSaveTerm", document),
    formError: () => qs("#termFormError", document),
    formSuccess: () => qs("#termFormSuccess", document),

    confirmId: () => qs("#confirm_term_id", document),
    confirmAction: () => qs("#confirm_term_action", document),
    confirmTitle: () => qs("#confirmTermTitle", document),
    confirmMessage: () => qs("#confirmTermMessage", document),
    confirmSY: () => qs("#confirm_term_school_year", document),
    confirmSem: () => qs("#confirm_term_semester", document),
    confirmError: () => qs("#confirmTermError", document),
    btnConfirm: () => qs("#btnConfirmTermAction", document),
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
  // Signatures
  // -------------------------
  function computeSignatureFromListPayload(payload) {
    const total = Number(payload.total ?? (Array.isArray(payload.items) ? payload.items.length : 0) ?? 0);
    const first = Array.isArray(payload.items) && payload.items.length ? payload.items[0] : null;
    const newestId = first ? String(first.id ?? "") : "";
    const newestCreated = first ? String(first.created_at ?? "") : "";
    return `${total}|${newestId}|${newestCreated}`;
  }

  async function fetchSignature(which) {
    if (which === "active") {
      const data = await requestJSON({ action: "list_active", search: State.active.search });
      return computeSignatureFromListPayload({ items: data.items || [], total: (data.items || []).length });
    }

    const data = await requestJSON({
      action: "list_closed",
      search: State.closed.search,
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

  // -------------------------
  // Rendering
  // -------------------------
  function statusBadge(status) {
    const s0 = String(status || "").trim();
    if (s0 === "Active") {
      return `<span class="badge bg-success-subtle text-success border border-success-subtle">Active</span>`;
    }
    if (s0 === "Closed") {
      return `<span class="badge bg-secondary-subtle text-secondary border border-secondary-subtle">Closed</span>`;
    }
    return `<span class="badge bg-light text-muted border">${escapeHtml(s0 || "—")}</span>`;
  }

  function renderActiveSummary(items) {
    const t = els.activeTitle();
    const sub = els.activeSubtitle();
    const btnEdit = els.btnEditActive();
    const btnClose = els.btnCloseActive();

    const active = Array.isArray(items) && items.length ? items[0] : null;
    State.activeTermId = active ? Number(active.id) : null;

    if (t) t.textContent = active ? `${active.school_year} • ${prettySemester(active.semester)}` : "—";
    if (sub) sub.textContent = active ? "This term is currently Active." : "No active term set.";

    const enabled = !!State.activeTermId;
    if (btnEdit) btnEdit.disabled = !enabled;
    if (btnClose) btnClose.disabled = !enabled;
  }

  function renderActiveRows(items) {
    const tbody = els.activeTbody();
    if (!tbody) return;

    if (!items || items.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="5" class="text-center text-muted py-5">
            <div class="mb-2"><i class="bi bi-inbox" style="font-size:1.5rem;"></i></div>
            No active term found.
          </td>
        </tr>
      `;
      renderActiveSummary([]);
      return;
    }

    renderActiveSummary(items);

    tbody.innerHTML = items
      .map((x) => {
        const id = Number(x.id);
        const sy = x.school_year || "—";
        const sem = prettySemester(x.semester);
        const st = statusBadge(x.status);
        const created = fmtCreated(x.created_at);

        return `
          <tr data-id="${id}">
            <td class="fw-semibold">${escapeHtml(sy)}</td>
            <td>${escapeHtml(sem)}</td>
            <td>${st}</td>
            <td class="text-muted small">${escapeHtml(created)}</td>
            <td class="text-end">
              <button type="button" class="btn btn-sm btn-outline-primary me-1 btn-edit-term" data-id="${id}">
                <i class="bi bi-pencil-square me-1"></i>Edit Status
              </button>
              <button type="button" class="btn btn-sm btn-outline-danger btn-close-term" data-id="${id}">
                <i class="bi bi-lock-fill me-1"></i>Close
              </button>
            </td>
          </tr>
        `;
      })
      .join("");
  }

  function renderClosedRows(items) {
    const tbody = els.closedTbody();
    if (!tbody) return;

    if (!items || items.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="5" class="text-center text-muted py-5">
            <div class="mb-2"><i class="bi bi-clock-history" style="font-size:1.5rem;"></i></div>
            No closed terms found.
          </td>
        </tr>
      `;
      return;
    }

    tbody.innerHTML = items
      .map((x) => {
        const id = Number(x.id);
        const sy = x.school_year || "—";
        const sem = prettySemester(x.semester);
        const st = statusBadge(x.status);
        const created = fmtCreated(x.created_at);

        return `
          <tr data-id="${id}">
            <td class="fw-semibold">${escapeHtml(sy)}</td>
            <td>${escapeHtml(sem)}</td>
            <td>${st}</td>
            <td class="text-muted small">${escapeHtml(created)}</td>
            <td class="text-end">
              <button type="button" class="btn btn-sm btn-outline-primary me-1 btn-edit-term" data-id="${id}">
                <i class="bi bi-pencil-square me-1"></i>Edit Status
              </button>
              <button type="button" class="btn btn-sm btn-outline-success btn-restore-term" data-id="${id}">
                <i class="bi bi-arrow-counterclockwise me-1"></i>Restore
              </button>
            </td>
          </tr>
        `;
      })
      .join("");
  }

  function renderClosedPagination() {
    const meta = els.closedMeta();
    if (meta) meta.textContent = computeMetaText(State.closed.page, State.closed.pageSize, State.closed.total);
    buildPagination(els.closedPagination(), State.closed.page, State.closed.totalPages);
  }

  // -------------------------
  // Data loading
  // -------------------------
  async function loadActive({ paint = true } = {}) {
    const data = await requestJSON({ action: "list_active", search: State.active.search });
    State.active.items = data.items || [];
    if (paint) renderActiveRows(State.active.items);
  }

  async function loadClosed({ paint = true } = {}) {
    const data = await requestJSON({
      action: "list_closed",
      search: State.closed.search,
      page: State.closed.page,
      pageSize: State.closed.pageSize,
    });

    State.closed.items = data.items || [];
    State.closed.total = Number(data.total || 0);
    State.closed.totalPages = Number(data.totalPages || 1);

    if (State.closed.page > State.closed.totalPages && State.closed.totalPages >= 1) {
      State.closed.page = State.closed.totalPages;
      return loadClosed({ paint });
    }

    if (paint) {
      renderClosedRows(State.closed.items);
      renderClosedPagination();
    }
  }

  async function refreshAll({ toast = true } = {}) {
    try {
      await Promise.all([loadActive(), loadClosed()]);
      State.active.signature = await fetchSignature("active");
      State.closed.signature = await fetchSignature("closed");
      if (toast) safeShowSuccess("Academic terms refreshed.");
    } catch (e) {
      safeShowError(e?.message || "Failed to refresh.");
    }
  }

  // -------------------------
  // Polling
  // -------------------------
  async function pollForChanges() {
    if (State.polling.running) return;
    if (State.polling.paused) return;
    if (anyModalOpen()) return;

    State.polling.running = true;
    try {
      const [sigA, sigC] = await Promise.all([fetchSignature("active"), fetchSignature("closed")]);

      const changed = sigA !== State.active.signature || sigC !== State.closed.signature;
      if (changed) {
        await Promise.all([loadActive(), loadClosed()]);
        State.active.signature = sigA;
        State.closed.signature = sigC;
      }
    } catch (e) {
      console.warn("[AcademicTerms] Poll failed:", e?.message || e);
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
  // Modals
  // -------------------------
  function resetUpsertForm() {
    const form = els.formUpsert();
    if (form) form.reset();

    if (els.termId()) els.termId().value = "";
    if (els.schoolYear()) els.schoolYear().value = "";
    if (els.semester()) els.semester().value = "";
    if (els.statusClosedRadio()) els.statusClosedRadio().checked = true;

    // enable inputs for create mode
    if (els.schoolYear()) els.schoolYear().disabled = false;
    if (els.semester()) els.semester().disabled = false;

    setAlert(els.formError(), false, "");
    setAlert(els.formSuccess(), false, "");

    const label = qs("#modalUpsertTermLabel", document);
    if (label) label.textContent = "Add Academic Term";

    const sub = qs("#modalUpsertTerm .modal-header .text-muted.small", document);
    if (sub) sub.textContent = "Define the school year and semester for this term (frozen history).";
  }

  async function openEditModal(termId) {
    resetUpsertForm();

    try {
      const data = await requestJSON({ action: "get_one", id: termId });
      const t = data.term;

      if (els.termId()) els.termId().value = String(t.id ?? "");
      if (els.schoolYear()) els.schoolYear().value = t.school_year ?? "";
      if (els.semester()) els.semester().value = t.semester ?? "";

      // freeze edits in UI (status-only edits)
      if (els.schoolYear()) els.schoolYear().disabled = true;
      if (els.semester()) els.semester().disabled = true;

      const st = String(t.status || "Closed");
      if (st === "Active") {
        if (els.statusActiveRadio()) els.statusActiveRadio().checked = true;
      } else {
        if (els.statusClosedRadio()) els.statusClosedRadio().checked = true;
      }

      const label = qs("#modalUpsertTermLabel", document);
      if (label) label.textContent = "Edit Academic Term (Status only)";

      const sub = qs("#modalUpsertTerm .modal-header .text-muted.small", document);
      if (sub) sub.textContent = "School year & semester are frozen for historical correctness. You can only change status.";

      const modalEl = els.upsertModalEl();
      if (modalEl) bootstrap.Modal.getOrCreateInstance(modalEl).show();
    } catch (e) {
      safeShowError(e?.message || "Failed to load term.");
    }
  }

  function openConfirmModal({ id, action, school_year, semester }) {
    State.confirm.id = Number(id);
    State.confirm.action = String(action || "");
    State.confirm.school_year = String(school_year || "");
    State.confirm.semester = String(semester || "");

    if (els.confirmId()) els.confirmId().value = String(State.confirm.id || "");
    if (els.confirmAction()) els.confirmAction().value = State.confirm.action;

    const isClose = State.confirm.action === "close";
    const title = isClose ? "Close Academic Term" : "Restore Academic Term";
    const msg = isClose
      ? "This will set the term status to Closed."
      : "This will set this term as Active (and close any current active term).";

    if (els.confirmTitle()) els.confirmTitle().textContent = title;
    if (els.confirmMessage()) els.confirmMessage().textContent = msg;
    if (els.confirmSY()) els.confirmSY().textContent = State.confirm.school_year || "—";
    if (els.confirmSem()) els.confirmSem().textContent = prettySemester(State.confirm.semester);

    setAlert(els.confirmError(), false, "");

    const btn = els.btnConfirm();
    if (btn) {
      btn.classList.toggle("btn-danger", isClose);
      btn.classList.toggle("btn-success", !isClose);
      const t = btn.querySelector(".termaction-btn-text");
      if (t) t.textContent = isClose ? "Close" : "Restore";
    }

    const modalEl = els.confirmModalEl();
    if (modalEl) bootstrap.Modal.getOrCreateInstance(modalEl).show();
  }

  function getTermFromState(id) {
    const tid = Number(id);
    return (
      State.active.items.find((x) => Number(x.id) === tid) ||
      State.closed.items.find((x) => Number(x.id) === tid) ||
      null
    );
  }

  // -------------------------
  // Actions
  // -------------------------
  async function handleUpsertSave() {
    const btn = els.btnSave();
    setBtnLoading(btn, true, ".termsave-btn-text", ".termsave-btn-loading");
    setAlert(els.formError(), false, "");
    setAlert(els.formSuccess(), false, "");

    try {
      const id = s(els.termId()?.value || "");
      const status = els.statusActiveRadio()?.checked ? "Active" : "Closed";

      const isEdit = !!id;

      // Create needs SY + semester. Update is status-only.
      let payload;

      if (!isEdit) {
        const schoolYear = s(els.schoolYear()?.value || "");
        const semester = s(els.semester()?.value || "");

        if (!schoolYear) throw new Error("School year is required.");
        if (!isSchoolYearValid(schoolYear)) throw new Error("School year must be in YYYY-YYYY format (e.g., 2025-2026).");
        if (!semester) throw new Error("Semester is required.");

        payload = {
          action: "create",
          school_year: schoolYear,
          semester,
          status,
        };
      } else {
        payload = {
          action: "update",
          id,
          status,
        };
      }

      const data = await requestJSON(payload);

      safeShowSuccess(data?.message || (isEdit ? "Academic term status updated." : "Academic term saved."));

      State.closed.page = 1;
      await Promise.all([loadActive(), loadClosed()]);
      State.active.signature = await fetchSignature("active");
      State.closed.signature = await fetchSignature("closed");

      const modalEl = els.upsertModalEl();
      if (modalEl) setTimeout(() => bootstrap.Modal.getOrCreateInstance(modalEl).hide(), 200);
    } catch (err) {
      const msg = err?.message || "Failed to save.";
      setAlert(els.formError(), true, msg, "danger");
      safeShowError(msg);
    } finally {
      setBtnLoading(btn, false, ".termsave-btn-text", ".termsave-btn-loading");
    }
  }

  async function handleConfirmAction() {
    const btn = els.btnConfirm();
    setBtnLoading(btn, true, ".termaction-btn-text", ".termaction-btn-loading");
    setAlert(els.confirmError(), false, "");

    try {
      const id = Number(els.confirmId()?.value || 0);
      const action = String(els.confirmAction()?.value || "");

      if (!id) throw new Error("Invalid term id.");
      if (action !== "close" && action !== "restore") throw new Error("Invalid action.");

      await requestJSON({ action, id });

      await Promise.all([loadActive(), loadClosed()]);
      State.active.signature = await fetchSignature("active");
      State.closed.signature = await fetchSignature("closed");

      const modalEl = els.confirmModalEl();
      if (modalEl) bootstrap.Modal.getOrCreateInstance(modalEl).hide();

      safeShowSuccess(action === "close" ? "Academic term closed." : "Academic term restored as Active.");
    } catch (e) {
      const msg = e?.message || "Failed to process.";
      setAlert(els.confirmError(), true, msg, "danger");
      safeShowError(msg);
    } finally {
      setBtnLoading(btn, false, ".termaction-btn-text", ".termaction-btn-loading");
    }
  }

  // -------------------------
  // Delegated events
  // -------------------------
  function bindDelegatedEventsOnce() {
    if (State.delegatedBound) return;
    State.delegatedBound = true;

    // Fix school year input formatter (YYYY-YYYY) without breaking hyphen
    document.addEventListener("input", (e) => {
      const el = e.target;
      if (!(el instanceof HTMLInputElement)) return;
      if (el.id !== "school_year") return;

      const prev = el.value;
      const next = formatSchoolYearInput(prev);
      if (next !== prev) el.value = next;
    });

    document.addEventListener(
      "submit",
      (e) => {
        const form = e.target;
        if (!(form instanceof HTMLFormElement)) return;
        if (form.id !== "formUpsertTerm") return;

        e.preventDefault();
        e.stopPropagation();
        if (typeof e.stopImmediatePropagation === "function") e.stopImmediatePropagation();
        handleUpsertSave();
      },
      true
    );

    document.addEventListener("click", async (e) => {
      const t = e.target;

      const root = els.root();
      const inRoot = !!(root && root.contains(t));
      const inUpsertModal = !!t.closest("#modalUpsertTerm");
      const inConfirmModal = !!t.closest("#modalConfirmTermAction");
      if (!inRoot && !inUpsertModal && !inConfirmModal) return;

      if (t.closest("#btnRefreshTerms")) {
        e.preventDefault();
        refreshAll();
        return;
      }

      if (t.closest("#btnAddTerm")) {
        e.preventDefault();
        resetUpsertForm();
        return;
      }

      if (t.closest("#btnSaveTerm")) {
        e.preventDefault();
        handleUpsertSave();
        return;
      }

      if (t.closest("#btnEditActiveTerm")) {
        e.preventDefault();
        if (State.activeTermId) openEditModal(State.activeTermId);
        return;
      }

      if (t.closest("#btnCloseActiveTerm")) {
        e.preventDefault();
        if (!State.activeTermId) return;
        const term = getTermFromState(State.activeTermId);
        openConfirmModal({
          id: State.activeTermId,
          action: "close",
          school_year: term?.school_year || "—",
          semester: term?.semester || "—",
        });
        return;
      }

      if (t.closest("#btnConfirmTermAction")) {
        e.preventDefault();
        handleConfirmAction();
        return;
      }

      const editBtn = t.closest(".btn-edit-term");
      if (editBtn) {
        e.preventDefault();
        const id = editBtn.getAttribute("data-id");
        if (id) openEditModal(id);
        return;
      }

      const closeBtn = t.closest(".btn-close-term");
      if (closeBtn) {
        e.preventDefault();
        const id = closeBtn.getAttribute("data-id");
        const term = id ? getTermFromState(id) : null;
        openConfirmModal({
          id,
          action: "close",
          school_year: term?.school_year || "—",
          semester: term?.semester || "—",
        });
        return;
      }

      const restoreBtn = t.closest(".btn-restore-term");
      if (restoreBtn) {
        e.preventDefault();
        const id = restoreBtn.getAttribute("data-id");
        const term = id ? getTermFromState(id) : null;
        openConfirmModal({
          id,
          action: "restore",
          school_year: term?.school_year || "—",
          semester: term?.semester || "—",
        });
        return;
      }

      const pag = t.closest("#closedTermsPagination a.page-link");
      if (pag) {
        e.preventDefault();
        const val = pag.getAttribute("data-page");
        if (!val) return;

        if (val === "prev") State.closed.page = Math.max(1, State.closed.page - 1);
        else if (val === "next") State.closed.page = Math.min(State.closed.totalPages, State.closed.page + 1);
        else State.closed.page = clamp(Number(val), 1, Math.max(1, State.closed.totalPages));

        await loadClosed();
        State.closed.signature = await fetchSignature("closed");
      }
    });

    let tActive = null;
    let tClosed = null;

    document.addEventListener("input", (e) => {
      const root = els.root();
      if (!root || !root.contains(e.target)) return;

      const el = e.target;

      if (el && el.id === "activeTermsSearch") {
        clearTimeout(tActive);
        tActive = setTimeout(async () => {
          State.active.search = s(els.activeSearch()?.value || "");
          await loadActive();
          State.active.signature = await fetchSignature("active");
        }, 250);
      }

      if (el && el.id === "closedTermsSearch") {
        clearTimeout(tClosed);
        tClosed = setTimeout(async () => {
          State.closed.search = s(els.closedSearch()?.value || "");
          State.closed.page = 1;
          await loadClosed();
          State.closed.signature = await fetchSignature("closed");
        }, 250);
      }
    });

    document.addEventListener("change", async (e) => {
      const root = els.root();
      if (!root || !root.contains(e.target)) return;

      const el = e.target;
      if (!el) return;

      if (el.id === "closedTermsPageSize") {
        State.closed.pageSize = clamp(Number(el.value || 50), 1, 200);
        State.closed.page = 1;
        await loadClosed();
        State.closed.signature = await fetchSignature("closed");
      }
    });

    document.addEventListener("shown.bs.modal", (e) => {
      const m = e.target;
      if (!(m instanceof HTMLElement)) return;
      if (m.id === "modalUpsertTerm" || m.id === "modalConfirmTermAction") State.polling.paused = true;
    });

    document.addEventListener("hidden.bs.modal", (e) => {
      const m = e.target;
      if (!(m instanceof HTMLElement)) return;
      if (m.id === "modalUpsertTerm" || m.id === "modalConfirmTermAction") State.polling.paused = false;
    });
  }

  // -------------------------
  // Init
  // -------------------------
  async function init(rootEl) {
    try {
      State.currentRoot = rootEl || qs("#content-area") || document;

      if (!qs("#termTabs", els.root())) return;

      bindDelegatedEventsOnce();

      State.closed.pageSize = clamp(Number(els.closedPageSize()?.value || 50), 1, 200);

      if (els.upsertModalEl()) bootstrap.Modal.getOrCreateInstance(els.upsertModalEl());
      if (els.confirmModalEl()) bootstrap.Modal.getOrCreateInstance(els.confirmModalEl());

      await Promise.all([loadActive(), loadClosed()]);

      State.active.signature = await fetchSignature("active");
      State.closed.signature = await fetchSignature("closed");

      startPolling();
    } catch (e) {
      safeShowError(e?.message || "Failed to load Academic Terms.");
    }
  }

  async function refresh() {
    try {
      await Promise.all([loadActive(), loadClosed()]);
      State.active.signature = await fetchSignature("active");
      State.closed.signature = await fetchSignature("closed");
    } catch (e) {
      safeShowError(e?.message || "Failed to refresh.");
    }
  }

  window.ManageAcademicTerms = { init, refresh, startPolling, stopPolling };
})();