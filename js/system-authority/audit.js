/* js/system-authority/audit.js */
/* global bootstrap, showSuccess, showError */

(function () {
  "use strict";

  let S;

  const state = {
    super: { rows: [], page: 1, pageSize: 10, search: "" },
    sdc: { rows: [], page: 1, pageSize: 10, search: "" },
  };

  function fmt(v) {
    return v == null || v === "" ? "—" : String(v);
  }

  function escapeHtml(str) {
    return String(str)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function fullName(r) {
    const parts = [r.first_name, r.middle_name, r.last_name, r.suffix].filter(Boolean);
    return parts.join(" ").replace(/\s+/g, " ").trim();
  }

  function matchesSearch(r, needle) {
    if (!needle) return true;
    const hay = [
      r.id_number,
      r.email,
      r.reason,
      r.assigned_at,
      r.revoked_at,
      fullName(r),
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    return hay.includes(needle.toLowerCase());
  }

  function paginate(arr, page, pageSize) {
    const total = arr.length;
    const pages = Math.max(1, Math.ceil(total / pageSize));
    const safePage = Math.min(Math.max(1, page), pages);
    const start = (safePage - 1) * pageSize;
    const end = Math.min(start + pageSize, total);
    return { total, pages, page: safePage, start, end, slice: arr.slice(start, end) };
  }

  function renderPagination(ulEl, currentPage, totalPages) {
    if (!ulEl) return;

    const items = [];

    const prevDisabled = currentPage <= 1 ? "disabled" : "";
    items.push(`
      <li class="page-item ${prevDisabled}">
        <a class="page-link" href="#" data-page="prev">Prev</a>
      </li>
    `);

    // Simple windowed paging: show up to 5 pages around current
    const windowSize = 5;
    let start = Math.max(1, currentPage - Math.floor(windowSize / 2));
    let end = Math.min(totalPages, start + windowSize - 1);
    start = Math.max(1, end - windowSize + 1);

    for (let p = start; p <= end; p++) {
      const active = p === currentPage ? "active" : "";
      items.push(`
        <li class="page-item ${active}">
          <a class="page-link" href="#" data-page="${p}">${p}</a>
        </li>
      `);
    }

    const nextDisabled = currentPage >= totalPages ? "disabled" : "";
    items.push(`
      <li class="page-item ${nextDisabled}">
        <a class="page-link" href="#" data-page="next">Next</a>
      </li>
    `);

    ulEl.innerHTML = items.join("");
  }

  function renderTable(roleKey) {
    const isSuper = roleKey === "super";
    const st = isSuper ? state.super : state.sdc;

    const tbody = S.qs(isSuper ? "#auditSuperTbody" : "#auditSDCTbody");
    const meta = S.qs(isSuper ? "#auditSuperMeta" : "#auditSDCMeta");
    const pag = S.qs(isSuper ? "#auditSuperPagination" : "#auditSDCPagination");

    if (!tbody || !meta || !pag) return;

    const filtered = st.rows.filter((r) => matchesSearch(r, st.search));
    const pageObj = paginate(filtered, st.page, st.pageSize);

    st.page = pageObj.page; // normalize

    if (pageObj.total === 0) {
      tbody.innerHTML = `
        <tr>
          <td class="text-muted" colspan="6">No records found.</td>
        </tr>
      `;
      meta.textContent = "Showing 0–0 of 0";
      renderPagination(pag, 1, 1);
      return;
    }

    meta.textContent = `Showing ${pageObj.start + 1}–${pageObj.end} of ${pageObj.total}`;
    renderPagination(pag, st.page, pageObj.pages);

    tbody.innerHTML = pageObj.slice
      .map((r) => {
        const name = escapeHtml(fullName(r) || "—");
        const idnum = escapeHtml(fmt(r.id_number));
        const email = escapeHtml(fmt(r.email));
        const assigned = escapeHtml(fmt(r.assigned_at));
        const revoked = escapeHtml(fmt(r.revoked_at));
        const reason = escapeHtml(fmt(r.reason));

        return `
          <tr>
            <td>${assigned}</td>
            <td>${revoked}</td>
            <td>${idnum}</td>
            <td>${name}</td>
            <td>${email}</td>
            <td>${reason}</td>
          </tr>
        `;
      })
      .join("");
  }

  async function loadRole(roleVal) {
    // roleVal: 'super_admin' | 'special_admin'
    const data = await S.postJSON({
      action: "get_audit",
      role: roleVal,
      limit: 500,
    });
    return Array.isArray(data.rows) ? data.rows : [];
  }

  async function refresh() {
    try {
      const [superRows, sdcRows] = await Promise.all([
        loadRole("super_admin"),
        loadRole("special_admin"),
      ]);

      state.super.rows = superRows;
      state.sdc.rows = sdcRows;

      // render both tabs
      renderTable("super");
      renderTable("sdc");
    } catch (e) {
      S.safeShowError(e?.message || "Failed to load audit logs.");
    }
  }

  function bindControls() {
    // SUPER controls
    const superPageSize = S.qs("#auditSuperPageSize");
    const superSearch = S.qs("#auditSuperSearch");
    const superPag = S.qs("#auditSuperPagination");

    if (superPageSize) {
      superPageSize.addEventListener("change", () => {
        state.super.pageSize = parseInt(superPageSize.value, 10) || 10;
        state.super.page = 1;
        renderTable("super");
      });
    }

    if (superSearch) {
      superSearch.addEventListener("input", () => {
        state.super.search = superSearch.value.trim();
        state.super.page = 1;
        renderTable("super");
      });
    }

    if (superPag) {
      superPag.addEventListener("click", (e) => {
        const a = e.target.closest("a.page-link");
        if (!a) return;
        e.preventDefault();

        const page = a.getAttribute("data-page");
        const filtered = state.super.rows.filter((r) => matchesSearch(r, state.super.search));
        const totalPages = Math.max(1, Math.ceil(filtered.length / state.super.pageSize));

        if (page === "prev") state.super.page = Math.max(1, state.super.page - 1);
        else if (page === "next") state.super.page = Math.min(totalPages, state.super.page + 1);
        else state.super.page = parseInt(page, 10) || 1;

        renderTable("super");
      });
    }

    // SDC controls
    const sdcPageSize = S.qs("#auditSDCPageSize");
    const sdcSearch = S.qs("#auditSDCSearch");
    const sdcPag = S.qs("#auditSDCPagination");

    if (sdcPageSize) {
      sdcPageSize.addEventListener("change", () => {
        state.sdc.pageSize = parseInt(sdcPageSize.value, 10) || 10;
        state.sdc.page = 1;
        renderTable("sdc");
      });
    }

    if (sdcSearch) {
      sdcSearch.addEventListener("input", () => {
        state.sdc.search = sdcSearch.value.trim();
        state.sdc.page = 1;
        renderTable("sdc");
      });
    }

    if (sdcPag) {
      sdcPag.addEventListener("click", (e) => {
        const a = e.target.closest("a.page-link");
        if (!a) return;
        e.preventDefault();

        const page = a.getAttribute("data-page");
        const filtered = state.sdc.rows.filter((r) => matchesSearch(r, state.sdc.search));
        const totalPages = Math.max(1, Math.ceil(filtered.length / state.sdc.pageSize));

        if (page === "prev") state.sdc.page = Math.max(1, state.sdc.page - 1);
        else if (page === "next") state.sdc.page = Math.min(totalPages, state.sdc.page + 1);
        else state.sdc.page = parseInt(page, 10) || 1;

        renderTable("sdc");
      });
    }
  }

  function init(shared) {
    S = shared;
    bindControls();
  }

  window.SystemAuthorityAudit = {
    init,
    refresh,
  };
})();
