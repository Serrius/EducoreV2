/* js/user-transaction-history.js */
/* global bootstrap, showError, showSuccess */

(function () {
  "use strict";

  if (window.UserTransactionHistory?.init) return;

  const API_URL = "php/user-transaction-history.php";

  function qs(sel, root = document) { return root.querySelector(sel); }
  function qsa(sel, root = document) { return Array.from(root.querySelectorAll(sel)); }

  function safeShowError(msg) {
    if (typeof window.showError === "function") return window.showError(msg);
    alert(msg || "Something went wrong.");
  }

  function escapeHtml(s) {
    return String(s ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function peso(n) {
    const num = Number(n || 0);
    return "₱" + num.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function semLabel(sem) {
    const s = String(sem ?? "");
    if (s.toLowerCase() === "1st") return "1st Semester";
    if (s.toLowerCase() === "2nd") return "2nd Semester";
    if (s.toLowerCase() === "summer") return "Summer";
    return s || "—";
  }

  function fmtDate(str) {
    const raw = String(str ?? "");
    if (!raw) return "—";
    const d = new Date(raw.replace(" ", "T"));
    if (!isNaN(d.getTime())) {
      return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "2-digit" });
    }
    return raw;
  }

  // Better debug-friendly JSON fetch
  async function getJSON(params) {
    const u = new URL(API_URL, window.location.href);
    Object.entries(params || {}).forEach(([k, v]) => {
      if (v === undefined || v === null || v === "") return;
      u.searchParams.set(k, String(v));
    });

    const res = await fetch(u.toString(), { method: "GET", credentials: "same-origin" });
    const text = await res.text();

    let data = {};
    try { data = text ? JSON.parse(text) : {}; } catch (_) {}

    if (!res.ok || !data?.success) {
      console.error("[UserTransactionHistory] API error", {
        url: u.toString(),
        status: res.status,
        raw: text,
        parsed: data,
      });
      throw new Error(data?.message || `HTTP ${res.status}`);
    }
    return data;
  }

  function buildPagination(navEl, page, totalPages, onPage) {
    navEl.innerHTML = "";
    if (totalPages <= 1) return;

    const ul = document.createElement("ul");
    ul.className = "pagination pagination-sm mb-0";

    function addItem(label, p, disabled = false, active = false) {
      const li = document.createElement("li");
      li.className = "page-item" + (disabled ? " disabled" : "") + (active ? " active" : "");
      const a = document.createElement("a");
      a.className = "page-link";
      a.href = "#";
      a.textContent = label;
      a.addEventListener("click", (e) => {
        e.preventDefault();
        if (disabled || active) return;
        onPage(p);
      });
      li.appendChild(a);
      ul.appendChild(li);
    }

    addItem("«", Math.max(1, page - 1), page <= 1, false);

    const win = 2;
    const start = Math.max(1, page - win);
    const end = Math.min(totalPages, page + win);

    if (start > 1) addItem("1", 1, false, page === 1);
    if (start > 2) {
      const li = document.createElement("li");
      li.className = "page-item disabled";
      li.innerHTML = `<span class="page-link">…</span>`;
      ul.appendChild(li);
    }

    for (let p = start; p <= end; p++) addItem(String(p), p, false, p === page);

    if (end < totalPages - 1) {
      const li = document.createElement("li");
      li.className = "page-item disabled";
      li.innerHTML = `<span class="page-link">…</span>`;
      ul.appendChild(li);
    }
    if (end < totalPages) addItem(String(totalPages), totalPages, false, page === totalPages);

    addItem("»", Math.min(totalPages, page + 1), page >= totalPages, false);

    navEl.appendChild(ul);
  }

  function ensureOnce(root, key) {
    if (!root) return false;
    if (root.dataset[key] === "1") return false;
    root.dataset[key] = "1";
    return true;
  }

  function init(rootEl = document) {
    const root = rootEl.querySelector ? rootEl.querySelector("#user-transaction-history") : null;
    if (!root) return;

    if (!ensureOnce(root, "uthBound")) return;

    const aySelect = qs("#userTransAySelect", root);
    const semSelect = qs("#userTransActiveYearSelect", root);
    const schoolYearLabel = qs("#userTransCurrentSchoolYear", root);
    const searchInput = qs("#userTransSearch", root);
    const tbody = qs("#userTransTableBody", root);
    const pagInfo = qs("#UserTransPaginationInfo", root);
    const pagNav = qs("#UserTransPagination", root);
    const tabLinks = qsa("[data-trans-kind]", root);

    const state = {
      terms: [],
      activeTerm: null,
      schoolYear: "",
      semester: "",
      kind: "all",
      q: "",
      page: 1,
      pageSize: 10,
    };

    function renderAyOptions() {
      const years = Array.from(new Set(state.terms.map(t => t.school_year))).filter(Boolean);
      aySelect.innerHTML = years.map(y => `<option value="${escapeHtml(y)}">${escapeHtml(y)}</option>`).join("");
      if (!years.includes(state.schoolYear) && years.length) state.schoolYear = years[0];
      aySelect.value = state.schoolYear || "";
      schoolYearLabel.textContent = state.schoolYear || "—";
    }

    function renderSemesterOptions() {
      const termsForYear = state.terms.filter(t => t.school_year === state.schoolYear);
      const sems = Array.from(new Set(termsForYear.map(t => t.semester))).filter(Boolean);

      semSelect.innerHTML =
        `<option value="">All Semesters</option>` +
        sems.map(s => `<option value="${escapeHtml(s)}">${escapeHtml(semLabel(s))}</option>`).join("");

      if (state.semester && !sems.includes(state.semester)) state.semester = "";
      semSelect.value = state.semester || "";
    }

    function setLoading() {
      tbody.innerHTML = `
        <tr>
          <td colspan="7" class="text-center text-muted py-3">
            Loading transactions...
          </td>
        </tr>
      `;
    }

    function setEmpty(msg) {
      tbody.innerHTML = `
        <tr>
          <td colspan="7" class="text-center text-muted py-3">
            ${escapeHtml(msg || "No transactions found.")}
          </td>
        </tr>
      `;
    }

    function kindBadge(kind) {
      if (kind === "org_fee") return `<span class="badge text-bg-primary">Org Fee</span>`;
      if (kind === "membership") return `<span class="badge text-bg-success">Club</span>`;
      return `<span class="badge text-bg-secondary">—</span>`;
    }

    function renderRows(items) {
      if (!items || !items.length) return setEmpty("No transactions found.");

      tbody.innerHTML = items.map((it) => {
        const receiptNo = escapeHtml(it.receipt_no);
        const datePaid = escapeHtml(fmtDate(it.paid_at));
        const orgName = escapeHtml(it.org_name || "—");
        const label = escapeHtml(it.label || "");
        const amount = escapeHtml(peso(it.amount));
        const status = escapeHtml(it.status || "—");
        const printUrl = escapeHtml(it.print_url || "");
        const type = kindBadge(it.kind);

        const orgLine = `<div class="fw-semibold">${orgName}</div><div class="small text-muted">${label}</div>`;
        const btn = printUrl
          ? `<button class="btn btn-sm btn-outline-dark trans-print-btn" data-print-url="${printUrl}" title="Print receipt">
               <i class="bi bi-printer"></i>
             </button>`
          : `<button class="btn btn-sm btn-outline-dark" disabled title="No receipt available"><i class="bi bi-printer"></i></button>`;

        return `
          <tr>
            <td class="text-nowrap">${receiptNo}</td>
            <td class="text-nowrap">${datePaid}</td>
            <td class="text-nowrap">${type}</td>
            <td>${orgLine}</td>
            <td class="text-nowrap">${amount}</td>
            <td class="text-nowrap">${status}</td>
            <td class="text-end">${btn}</td>
          </tr>
        `;
      }).join("");
    }

    async function loadTransactions() {
      setLoading();
      try {
        const data = await getJSON({
          action: "list",
          school_year: state.schoolYear,
          semester: state.semester,
          kind: state.kind,
          q: state.q,
          page: state.page,
          page_size: state.pageSize,
        });

        renderRows(data.items || []);

        const total = Number(data.total || 0);
        const totalPages = Number(data.total_pages || 1);
        const page = Number(data.page || 1);
        const pageSize = Number(data.page_size || state.pageSize);

        const start = total === 0 ? 0 : (page - 1) * pageSize + 1;
        const end = Math.min(total, page * pageSize);

        pagInfo.textContent = total === 0 ? "0 transactions" : `Showing ${start}-${end} of ${total}`;

        buildPagination(pagNav, page, totalPages, (p) => {
          state.page = p;
          loadTransactions();
        });
      } catch (e) {
        setEmpty("Failed to load transactions.");
        safeShowError(e?.message || "Failed to load transactions.");
      }
    }

    // Events
    aySelect.addEventListener("change", () => {
      state.schoolYear = aySelect.value || "";
      schoolYearLabel.textContent = state.schoolYear || "—";
      state.page = 1;
      renderSemesterOptions();
      loadTransactions();
    });

    semSelect.addEventListener("change", () => {
      state.semester = semSelect.value || "";
      state.page = 1;
      loadTransactions();
    });

    let t = null;
    searchInput.addEventListener("input", () => {
      clearTimeout(t);
      t = setTimeout(() => {
        state.q = (searchInput.value || "").trim();
        state.page = 1;
        loadTransactions();
      }, 250);
    });

    tabLinks.forEach((a) => {
      a.addEventListener("click", (e) => {
        e.preventDefault();
        state.kind = (a.getAttribute("data-trans-kind") || "all").toLowerCase();
        state.page = 1;
        tabLinks.forEach(x => x.classList.remove("active"));
        a.classList.add("active");
        loadTransactions();
      });
    });

    root.addEventListener("click", (e) => {
      const btn = e.target.closest?.(".trans-print-btn");
      if (!btn) return;
      const url = btn.getAttribute("data-print-url");
      if (!url) return;
      window.open(url, "_blank", "noopener");
    });

    // Init meta -> first load
    (async () => {
      try {
        const meta = await getJSON({ action: "meta" });
        state.terms = meta.terms || [];
        state.activeTerm = meta.active_term || null;

        if (state.activeTerm?.school_year) {
          state.schoolYear = state.activeTerm.school_year;
          state.semester = state.activeTerm.semester || "";
        } else if (state.terms.length) {
          state.schoolYear = state.terms[0].school_year;
          state.semester = "";
        }

        renderAyOptions();
        renderSemesterOptions();

        if (state.activeTerm?.semester) {
          semSelect.value = state.activeTerm.semester;
          state.semester = state.activeTerm.semester;
        }

        loadTransactions();
      } catch (e) {
        safeShowError(e?.message || "Failed to initialize Transaction History.");
      }
    })();
  }

  window.UserTransactionHistory = { init };
})();