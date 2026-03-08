/* js/records-management.js */
/* global bootstrap, showSuccess, showError */

(function () {
  "use strict";

  // Prevent redefining the module (but allow re-init per section load)
  if (window.RecordsManagement?.init) return;

  const API_URL = "php/records.php";

  function qs(sel, root = document) { return root.querySelector(sel); }
  function qsa(sel, root = document) { return Array.from(root.querySelectorAll(sel)); }

  function safeShowError(msg) {
    if (typeof window.showError === "function") return window.showError(msg);
    alert(msg || "Something went wrong.");
  }
  function safeShowSuccess(msg) {
    if (typeof window.showSuccess === "function") return window.showSuccess(msg);
    alert(msg || "Success.");
  }

  function peso(n) {
    const v = Number(n || 0);
    return "₱" + v.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function esc(s) {
    return String(s ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  async function postJSON(payload, signal) {
    const res = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify(payload || {}),
      signal
    });

    const txt = await res.text();
    let data;
    try { data = JSON.parse(txt); } catch (e) {
      console.error("[Records] Non-JSON response:", txt);
      throw new Error("Server returned invalid JSON.");
    }
    if (!res.ok || !data?.success) {
      throw new Error(data?.message || `Request failed (${res.status})`);
    }
    return data;
  }

  function buildSemLabel(sem) {
    const s = String(sem || "").trim();
    if (s.toLowerCase() === "1st") return "1st";
    if (s.toLowerCase() === "2nd") return "2nd";
    if (s.toLowerCase() === "summer") return "Summer";
    return s || "—";
  }

  function termBadgeText(sy, sem) {
    const s = buildSemLabel(sem);
    if (!sy) return "—";
    if (!s) return `AY ${sy}`;
    if (s === "1st") return `1st Sem, AY ${sy}`;
    if (s === "2nd") return `2nd Sem, AY ${sy}`;
    if (s.toLowerCase() === "summer") return `Summer, AY ${sy}`;
    return `${s}, AY ${sy}`;
  }

  function buildPagination(rootUl, page, totalPages, onGo) {
    if (!rootUl) return;
    rootUl.innerHTML = "";

    const tp = Math.max(1, Number(totalPages || 1));
    const p = Math.min(tp, Math.max(1, Number(page || 1)));

    function add(label, targetPage, disabled = false, active = false) {
      const li = document.createElement("li");
      li.className = "page-item" + (disabled ? " disabled" : "") + (active ? " active" : "");
      const a = document.createElement("a");
      a.className = "page-link";
      a.href = "#";
      a.textContent = label;
      a.addEventListener("click", (e) => {
        e.preventDefault();
        if (disabled) return;
        onGo(targetPage);
      });
      li.appendChild(a);
      rootUl.appendChild(li);
    }

    add("«", 1, p === 1);
    add("‹", p - 1, p === 1);

    const windowSize = 2;
    const start = Math.max(1, p - windowSize);
    const end = Math.min(tp, p + windowSize);

    if (start > 1) add("1", 1, false, p === 1);
    if (start > 2) {
      const li = document.createElement("li");
      li.className = "page-item disabled";
      li.innerHTML = `<span class="page-link">…</span>`;
      rootUl.appendChild(li);
    }

    for (let i = start; i <= end; i++) add(String(i), i, false, i === p);

    if (end < tp - 1) {
      const li = document.createElement("li");
      li.className = "page-item disabled";
      li.innerHTML = `<span class="page-link">…</span>`;
      rootUl.appendChild(li);
    }
    if (end < tp) add(String(tp), tp, false, p === tp);

    add("›", p + 1, p === tp);
    add("»", tp, p === tp);
  }

  // ===========================
  // Module instance (re-init safe)
  // ===========================
  let current = null;

  function destroyCurrent() {
    if (!current) return;
    try {
      // abort in-flight requests
      current.abort?.abort();

      // remove bound handlers
      current.unbinds?.forEach(fn => {
        try { fn(); } catch (e) {}
      });
    } catch (e) {}
    current = null;
  }

  function createInstance(root) {
    const ctx = root || document;

    // Toast (use global toast container if outside the injected root)
    let toast;
    function toastMsg(msg) {
      const el = qs("#recordsToast", document) || qs("#recordsToast", ctx);
      const body = qs("#recordsToastMsg", document) || qs("#recordsToastMsg", ctx);
      if (!el || !body) return;
      body.textContent = msg || "Ready.";
      if (!toast) toast = new bootstrap.Toast(el, { delay: 2200 });
      toast.show();
    }

    // DOM (be resilient: your old HTML had different IDs)
    const aySel =
      qs("#recordsAySelect", ctx) ||
      qs("#recordsAySelect", document);

    // your OLD HTML uses recordsActiveYearSelect for semester
    const semSel =
      qs("#recordsSemSelect", ctx) ||
      qs("#recordsActiveYearSelect", ctx) ||
      qs("#recordsSemSelect", document) ||
      qs("#recordsActiveYearSelect", document);

    const readOnlyBadge =
      qs("#recordsReadOnlyBadge", ctx) ||
      qs("#recordsReadOnlyBadge", document);

    // old HTML: recordsCurrentSchoolYear exists, not currentTermBadge
    const currentTermBadge =
      qs("#recordsCurrentTermBadge", ctx) ||
      qs("#recordsCurrentSchoolYear", ctx) ||
      qs("#recordsCurrentTermBadge", document) ||
      qs("#recordsCurrentSchoolYear", document);

    // Org fee
    const orgFeesSearch = qs("#orgFeesSearch", ctx);
    const orgFeesOrgFilter = qs("#orgFeesOrgFilter", ctx);
    const orgFeesTbody = qs("#orgFeesTbody", ctx);
    const orgFeesPagination = qs("#orgFeesPagination", ctx);
    const orgFeesEmptyState = qs("#orgFeesEmptyState", ctx);
    const orgFeesTotal = qs("#orgFeesTotal", ctx);
    const orgFeesAmount = qs("#orgFeesAmount", ctx);
    const orgFeesPaid = qs("#orgFeesPaid", ctx);
    const exportOrgFeesCsvBtn = qs("#exportOrgFeesCsvBtn", ctx);

    // Membership (may not exist in old HTML — keep safe)
    const membershipSearch = qs("#membershipSearch", ctx);
    const membershipOrgFilter = qs("#membershipOrgFilter", ctx);
    const membershipTbody = qs("#membershipTbody", ctx);
    const membershipPagination = qs("#membershipPagination", ctx);
    const membershipEmptyState = qs("#membershipEmptyState", ctx);
    const membershipTotal = qs("#membershipTotal", ctx);
    const membershipAmount = qs("#membershipAmount", ctx);
    const membershipPaid = qs("#membershipPaid", ctx);
    const exportMembershipCsvBtn = qs("#exportMembershipCsvBtn", ctx);

    // Events
    const eventExpensesSearch = qs("#eventExpensesSearch", ctx);
    const eventExpensesOrgFilter = qs("#eventExpensesOrgFilter", ctx);
    const eventExpensesTbody = qs("#eventExpensesTbody", ctx);
    const eventExpensesPagination = qs("#eventExpensesPagination", ctx);
    const eventExpensesEmptyState = qs("#eventExpensesEmptyState", ctx);
    const eventExpensesTotal = qs("#eventExpensesTotal", ctx);
    const eventExpensesCredits = qs("#eventExpensesCredits", ctx);
    const eventExpensesDebits = qs("#eventExpensesDebits", ctx);
    const eventExpensesBalance = qs("#eventExpensesBalance", ctx);
    const exportEventExpensesCsvBtn = qs("#exportEventExpensesCsvBtn", ctx);

    // State
    const state = {
      me: null,
      terms: [],
      orgs: [],
      selected: { school_year: "", semester: "" },
      orgFees: { page: 1, pageSize: 10, totalPages: 1, totalRows: 0 },
      membership: { page: 1, pageSize: 10, totalPages: 1, totalRows: 0 },
      events: { page: 1, pageSize: 10, totalPages: 1, totalRows: 0 }
    };

    // AbortController for this instance
    const abort = new AbortController();

    function fillOrgFilters() {
      const options = (state.orgs || []).map(o => {
        const label =
          `${o.org_name}` +
          `${o.abbreviation ? ` (${o.abbreviation})` : ""}` +
          `${o.org_type ? ` • ${o.org_type}` : ""}`;
        return `<option value="${esc(o.id)}">${esc(label)}</option>`;
      }).join("");

      if (orgFeesOrgFilter) orgFeesOrgFilter.innerHTML = `<option value="">All Organizations / Clubs</option>` + options;
      if (membershipOrgFilter) membershipOrgFilter.innerHTML = `<option value="">All Organizations / Clubs</option>` + options;
      if (eventExpensesOrgFilter) eventExpensesOrgFilter.innerHTML = `<option value="">All Organizations / Clubs</option>` + options;
    }

    function fillTermSelectors() {
      if (!aySel || !semSel) return;

      const syList = Array.from(new Set((state.terms || []).map(t => t.school_year))).filter(Boolean);

      aySel.innerHTML = syList.map(sy => `<option value="${esc(sy)}">${esc(sy)}</option>`).join("");

      const active = (state.terms || []).find(t => t.status === "Active") || null;
      const defaultSY = state.selected.school_year || active?.school_year || syList[0] || "";
      state.selected.school_year = defaultSY;

      if (defaultSY) aySel.value = defaultSY;

      rebuildSemesterOptions();
    }

    function rebuildSemesterOptions() {
      if (!aySel || !semSel) return;

      const sy = aySel.value || state.selected.school_year || "";
      state.selected.school_year = sy;

      const sems = (state.terms || [])
        .filter(t => t.school_year === sy)
        .map(t => t.semester);

      const uniq = Array.from(new Set(sems)).filter(Boolean);

      semSel.innerHTML = uniq
        .map(s => `<option value="${esc(s)}">${esc(buildSemLabel(s))}</option>`)
        .join("");

      const activeForSY = (state.terms || []).find(t => t.school_year === sy && t.status === "Active");
      const defSem = state.selected.semester || activeForSY?.semester || uniq[0] || "";
      state.selected.semester = defSem;

      if (defSem) semSel.value = defSem;

      const isActiveSelected = !!(state.terms || []).find(t => t.school_year === sy && t.semester === defSem && t.status === "Active");
      if (readOnlyBadge) readOnlyBadge.classList.toggle("d-none", isActiveSelected);

      if (currentTermBadge) currentTermBadge.textContent = termBadgeText(sy, defSem);
    }

    // ========== LOADERS ==========
    async function loadBoot() {
      const data = await postJSON({ action: "boot" }, abort.signal);
      state.me = data.me || null;
      state.terms = data.terms || [];
      state.orgs = data.orgs || [];

      fillTermSelectors();
      fillOrgFilters();

      toastMsg(`Ready. Role: ${state.me?.role || "—"}`);
    }

    // ====== ORG FEES ======
    async function loadOrgFees() {
      if (!orgFeesTbody) return;

      orgFeesEmptyState?.classList.add("d-none");
      orgFeesTbody.innerHTML = `<tr><td colspan="8" class="text-center text-muted">Loading organization fees...</td></tr>`;

      const payload = {
        action: "list_org_fees",
        school_year: state.selected.school_year,
        semester: state.selected.semester,
        org_id: orgFeesOrgFilter?.value || "",
        search: orgFeesSearch?.value || "",
        page: state.orgFees.page,
        page_size: state.orgFees.pageSize
      };

      const data = await postJSON(payload, abort.signal);

      const rows = data.rows || [];
      const summary = data.summary || {};
      state.orgFees.totalPages = Number(data.total_pages || 1);
      state.orgFees.totalRows = Number(data.total_rows || 0);

      if (orgFeesTotal) orgFeesTotal.textContent = String(summary.total_rows ?? rows.length ?? 0);
      if (orgFeesAmount) orgFeesAmount.textContent = peso(summary.total_amount ?? 0);
      if (orgFeesPaid) orgFeesPaid.textContent = String(summary.paid_count ?? 0);

      if (!rows.length) {
        orgFeesTbody.innerHTML = "";
        orgFeesEmptyState?.classList.remove("d-none");
      } else {
        orgFeesTbody.innerHTML = rows.map(r => {
          const dt = esc(r.paid_at_label || r.paid_at || "—");
          const receiptNo = esc(r.receipt_no || "—");
          const sid = esc(r.student_id_number || "—");
          const sname = esc(r.student_name || "—");
          const org = esc(r.org_label || r.org_name || "—");
          const amt = peso(r.amount || 0);
          const status = esc(r.status_label || "Paid");

          const rid = Number(r.receipt_id || 0);
          const printUrl = rid > 0
            ? `php/print-organization-fee-receipt.php?receipt_id=${encodeURIComponent(String(rid))}`
            : `php/print-organization-fee-receipt.php?receipt_no=${encodeURIComponent(String(r.receipt_no || ""))}`;

          return `
            <tr>
              <td>${dt}</td>
              <td><span class="badge bg-light text-dark border">${receiptNo}</span></td>
              <td>${sid}</td>
              <td>${sname}</td>
              <td>${org}</td>
              <td class="text-end">${amt}</td>
              <td><span class="badge bg-success">${status}</span></td>
              <td class="text-center">
                <button class="btn btn-sm btn-outline-primary js-print-orgfee" data-url="${esc(printUrl)}">
                  <i class="bi bi-printer"></i>
                </button>
              </td>
            </tr>
          `;
        }).join("");
      }

      buildPagination(orgFeesPagination, state.orgFees.page, state.orgFees.totalPages, (p) => {
        state.orgFees.page = p;
        loadOrgFees().catch(err => safeShowError(err.message));
      });
    }

    // ====== MEMBERSHIP (optional tab) ======
    async function loadMembership() {
      if (!membershipTbody) return;

      membershipEmptyState?.classList.add("d-none");
      membershipTbody.innerHTML = `<tr><td colspan="8" class="text-center text-muted">Loading membership fees...</td></tr>`;

      const payload = {
        action: "list_membership",
        school_year: state.selected.school_year,
        semester: state.selected.semester,
        org_id: membershipOrgFilter?.value || "",
        search: membershipSearch?.value || "",
        page: state.membership.page,
        page_size: state.membership.pageSize
      };

      const data = await postJSON(payload, abort.signal);

      const rows = data.rows || [];
      const summary = data.summary || {};
      state.membership.totalPages = Number(data.total_pages || 1);
      state.membership.totalRows = Number(data.total_rows || 0);

      if (membershipTotal) membershipTotal.textContent = String(summary.total_rows ?? rows.length ?? 0);
      if (membershipAmount) membershipAmount.textContent = peso(summary.total_amount ?? 0);
      if (membershipPaid) membershipPaid.textContent = String(summary.paid_count ?? 0);

      if (!rows.length) {
        membershipTbody.innerHTML = "";
        membershipEmptyState?.classList.remove("d-none");
      } else {
        membershipTbody.innerHTML = rows.map(r => {
          const dt = esc(r.paid_at_label || r.paid_at || "—");
          const receiptNo = esc(r.receipt_no || "—");
          const sid = esc(r.student_id_number || "—");
          const sname = esc(r.student_name || "—");
          const org = esc(r.org_label || r.org_name || "—");
          const amt = peso(r.amount || 0);
          const status = esc(r.status_label || r.status || "Paid");

          const rid = Number(r.receipt_id || 0);
          const printUrl = rid > 0
            ? `php/print-membership-receipt.php?receipt_id=${encodeURIComponent(String(rid))}`
            : `php/print-membership-receipt.php?receipt_no=${encodeURIComponent(String(r.receipt_no || ""))}`;

          return `
            <tr>
              <td>${dt}</td>
              <td><span class="badge bg-light text-dark border">${receiptNo}</span></td>
              <td>${sid}</td>
              <td>${sname}</td>
              <td>${org}</td>
              <td class="text-end">${amt}</td>
              <td><span class="badge bg-success">${status}</span></td>
              <td class="text-center">
                <button class="btn btn-sm btn-outline-primary js-print-membership" data-url="${esc(printUrl)}">
                  <i class="bi bi-printer"></i>
                </button>
              </td>
            </tr>
          `;
        }).join("");
      }

      buildPagination(membershipPagination, state.membership.page, state.membership.totalPages, (p) => {
        state.membership.page = p;
        loadMembership().catch(err => safeShowError(err.message));
      });
    }

    // ====== EVENTS ======
    async function loadEvents() {
      if (!eventExpensesTbody) return;

      eventExpensesEmptyState?.classList.add("d-none");
      eventExpensesTbody.innerHTML = `<tr><td colspan="9" class="text-center text-muted">Loading event expenses...</td></tr>`;

      const payload = {
        action: "list_events",
        school_year: state.selected.school_year,
        semester: state.selected.semester,
        org_id: eventExpensesOrgFilter?.value || "",
        search: eventExpensesSearch?.value || "",
        page: state.events.page,
        page_size: state.events.pageSize
      };

      const data = await postJSON(payload, abort.signal);
      const rows = data.rows || [];
      const summary = data.summary || {};

      state.events.totalPages = Number(data.total_pages || 1);
      state.events.totalRows = Number(data.total_rows || 0);

      if (eventExpensesTotal) eventExpensesTotal.textContent = String(summary.total_events ?? rows.length ?? 0);
      if (eventExpensesCredits) eventExpensesCredits.textContent = peso(summary.total_credits ?? 0);
      if (eventExpensesDebits) eventExpensesDebits.textContent = peso(summary.total_debits ?? 0);
      if (eventExpensesBalance) eventExpensesBalance.textContent = peso(summary.total_balance ?? 0);

      if (!rows.length) {
        eventExpensesTbody.innerHTML = "";
        eventExpensesEmptyState?.classList.remove("d-none");
      } else {
        eventExpensesTbody.innerHTML = rows.map(r => {
          const title = esc(r.title || "—");
          const org = esc(r.org_label || r.org_name || "—");
          const dt = esc(r.event_date || "—");
          const cr = peso(r.total_credits || 0);
          const dr = peso(r.total_debits || 0);
          const bal = peso(r.balance || 0);
          const st = esc(r.status || "—");

          const eventId = Number(r.id || 0);
          const printUrl = `php/event-ledger-pdf.php?event_id=${encodeURIComponent(String(eventId))}`;

          const badge =
            (String(st).toLowerCase() === "approved") ? "bg-success" :
            (String(st).toLowerCase() === "declined") ? "bg-danger" :
            (String(st).toLowerCase() === "submitted") ? "bg-primary" :
            "bg-secondary";

          return `
            <tr>
              <td>${title}</td>
              <td>${org}</td>
              <td>${dt}</td>
              <td class="text-end">${cr}</td>
              <td class="text-end">${dr}</td>
              <td class="text-end">${bal}</td>
              <td class="text-center"><span class="badge ${badge}">${st}</span></td>
              <td class="text-center">
                <button class="btn btn-sm btn-outline-primary js-print-event" data-url="${esc(printUrl)}">
                  <i class="bi bi-printer"></i>
                </button>
              </td>
            </tr>
          `;
        }).join("");
      }

      buildPagination(eventExpensesPagination, state.events.page, state.events.totalPages, (p) => {
        state.events.page = p;
        loadEvents().catch(err => safeShowError(err.message));
      });
    }

    // ====== EXPORTS (CSV) ======
    function downloadCsv(action) {
      const params = new URLSearchParams();
      params.set("action", action);
      params.set("school_year", state.selected.school_year || "");
      params.set("semester", state.selected.semester || "");

      if (action === "export_org_fees_csv") {
        params.set("org_id", orgFeesOrgFilter?.value || "");
        params.set("search", orgFeesSearch?.value || "");
      } else if (action === "export_membership_csv") {
        params.set("org_id", membershipOrgFilter?.value || "");
        params.set("search", membershipSearch?.value || "");
      } else if (action === "export_events_csv") {
        params.set("org_id", eventExpensesOrgFilter?.value || "");
        params.set("search", eventExpensesSearch?.value || "");
      }

      const url = `${API_URL}?${params.toString()}`;
      window.open(url, "_blank", "noopener");
    }

    // ====== HANDLERS ======
    const unbinds = [];

    function on(el, evt, handler, opts) {
      if (!el) return;
      el.addEventListener(evt, handler, opts);
      unbinds.push(() => el.removeEventListener(evt, handler, opts));
    }

    function bindHandlers() {
      on(aySel, "change", () => {
        state.selected.school_year = aySel.value;
        state.selected.semester = "";
        rebuildSemesterOptions();

        state.orgFees.page = 1;
        state.membership.page = 1;
        state.events.page = 1;

        Promise.allSettled([loadOrgFees(), loadMembership(), loadEvents()]).catch(() => {});
      });

      on(semSel, "change", () => {
        state.selected.semester = semSel.value;

        const sy = state.selected.school_year;
        const sem = state.selected.semester;
        const isActiveSelected = !!(state.terms || []).find(t => t.school_year === sy && t.semester === sem && t.status === "Active");
        readOnlyBadge?.classList.toggle("d-none", isActiveSelected);
        if (currentTermBadge) currentTermBadge.textContent = termBadgeText(sy, sem);

        state.orgFees.page = 1;
        state.membership.page = 1;
        state.events.page = 1;

        Promise.allSettled([loadOrgFees(), loadMembership(), loadEvents()]).catch(() => {});
      });

      on(orgFeesOrgFilter, "change", () => { state.orgFees.page = 1; loadOrgFees().catch(e => safeShowError(e.message)); });
      on(membershipOrgFilter, "change", () => { state.membership.page = 1; loadMembership().catch(e => safeShowError(e.message)); });
      on(eventExpensesOrgFilter, "change", () => { state.events.page = 1; loadEvents().catch(e => safeShowError(e.message)); });

      // search (debounced-ish)
      let t1, t2, t3;
      on(orgFeesSearch, "input", () => {
        clearTimeout(t1);
        t1 = setTimeout(() => { state.orgFees.page = 1; loadOrgFees().catch(e => safeShowError(e.message)); }, 250);
      });
      on(membershipSearch, "input", () => {
        clearTimeout(t2);
        t2 = setTimeout(() => { state.membership.page = 1; loadMembership().catch(e => safeShowError(e.message)); }, 250);
      });
      on(eventExpensesSearch, "input", () => {
        clearTimeout(t3);
        t3 = setTimeout(() => { state.events.page = 1; loadEvents().catch(e => safeShowError(e.message)); }, 250);
      });

      // print buttons (delegate INSIDE the injected root to avoid global duplicates)
      on(ctx, "click", (e) => {
        const btn1 = e.target.closest(".js-print-orgfee");
        if (btn1) {
          e.preventDefault();
          const url = btn1.getAttribute("data-url");
          if (url) window.open(url, "_blank", "noopener");
          return;
        }
        const btn2 = e.target.closest(".js-print-membership");
        if (btn2) {
          e.preventDefault();
          const url = btn2.getAttribute("data-url");
          if (url) window.open(url, "_blank", "noopener");
          return;
        }
        const btn3 = e.target.closest(".js-print-event");
        if (btn3) {
          e.preventDefault();
          const url = btn3.getAttribute("data-url");
          if (url) window.open(url, "_blank", "noopener");
        }
      });

      on(exportOrgFeesCsvBtn, "click", () => downloadCsv("export_org_fees_csv"));
      on(exportMembershipCsvBtn, "click", () => downloadCsv("export_membership_csv"));
      on(exportEventExpensesCsvBtn, "click", () => downloadCsv("export_events_csv"));
    }

    // ====== INIT ======
    async function init() {
      try {
        await loadBoot();
        bindHandlers();

        // initial loads (show errors per-table instead of silent allSettled)
        await loadOrgFees().catch((e) => {
          console.error(e);
          if (orgFeesTbody) orgFeesTbody.innerHTML = `<tr><td colspan="8" class="text-center text-danger">Failed loading org fees: ${esc(e.message)}</td></tr>`;
          safeShowError(e.message);
        });

        await loadMembership().catch((e) => {
          console.error(e);
          if (membershipTbody) membershipTbody.innerHTML = `<tr><td colspan="8" class="text-center text-danger">Failed loading membership: ${esc(e.message)}</td></tr>`;
          safeShowError(e.message);
        });

        await loadEvents().catch((e) => {
          console.error(e);
          if (eventExpensesTbody) eventExpensesTbody.innerHTML = `<tr><td colspan="9" class="text-center text-danger">Failed loading events: ${esc(e.message)}</td></tr>`;
          safeShowError(e.message);
        });

      } catch (err) {
        console.error(err);
        safeShowError(err.message || "Failed to initialize records.");
      }
    }

    return {
      init,
      abort,
      unbinds
    };
  }

  // Public API
  function init(rootEl) {
    // Each time you open the Records page, re-bind to the newly injected DOM
    destroyCurrent();
    current = createInstance(rootEl || document);

    current.init().catch((err) => {
      if (err?.name === "AbortError") return;
      console.error(err);
      safeShowError(err?.message || "Failed to initialize records.");
    });
  }

  window.RecordsManagement = { init };
})();
//have to add this comment. Ignore this.
//init