/* js/accreditation/super/active.js */
/* global bootstrap */

(function () {
  "use strict";

  if (window.__suActiveBooted) return;
  window.__suActiveBooted = true;

  function mustBase() {
    if (!window.SUAccreditation) throw new Error("Base module not loaded (SUAccreditation).");
    return window.SUAccreditation;
  }

  function badge(status) {
    const s = String(status || "");
    const map = {
      Active: "success",
      Recommended: "info",
      Approved: "primary",
      Rejected: "danger",
      Pending: "secondary",
      Returned: "warning",
    };
    const cls = map[s] || "secondary";
    return `<span class="badge text-bg-${cls}">${s || "—"}</span>`;
  }

  function scopeBadge(scope) {
    const s = String(scope || "—");
    const map = { General: "info", Exclusive: "dark", Both: "primary", All: "primary" };
    const cls = map[s] || "secondary";
    const label = s === "Both" ? "All" : s;
    return `<span class="badge text-bg-${cls}">${label}</span>`;
  }

  function renderRow(A, r) {
    const id = A.escapeHtml(r.id);
    const org = A.escapeHtml(r.org_name || "—");
    const scope = A.escapeHtml(r.scope || "—");
    const program = A.escapeHtml(r.program || "—");
    const term = A.escapeHtml(r.term_label || "—");
    const status = r.status || "—";
    const descRaw = r.description ?? r.org_description ?? r.org_desc ?? "";
    const desc = A.escapeHtml(String(descRaw || "").trim());

    // ✅ Always resolve from app root so it works from /pages/*
    const certResolved = A.resolvePublicUrl
      ? A.resolvePublicUrl(r.certificate_url || "")
      : String(r.certificate_url || "");

    // href must be escaped for HTML, but data-url must be RAW (NOT escaped)
    const hrefEscaped = certResolved ? A.escapeHtml(certResolved) : "#";
    const dataUrlRaw = certResolved || "";

    return `
      <tr data-id="${id}">
        <td class="text-muted">${id}</td>
        <td class="sa-wrap">
          <div class="fw-semibold">${org}</div>
          <div class="text-muted small">${A.escapeHtml(r.org_abbr || "")}</div>
          ${desc ? `<div class="text-muted small sa-wrap mt-1">${desc}</div>` : ``}
        </td>
        <td>${scopeBadge(scope)}</td>
        <td>${program}</td>
        <td class="sa-wrap">${term}</td>
        <td>${badge(status)}</td>
        <td class="text-end">
          <a class="btn btn-outline-primary btn-sm"
             href="${hrefEscaped}"
             target="_blank"
             rel="noopener"
             data-action="print"
             data-url="${dataUrlRaw}"
             ${certResolved ? "" : "disabled"}>
            <i class="bi bi-printer"></i> Print
          </a>
        </td>
      </tr>
    `;
  }

  async function fetchActive(A) {
  const { store } = A;
  const s = store.active;
  const payload = {
    action: "list_requests",
    mode: "active",
    q: store.search || "",
    status: "Active", // This filters to only Active
    school_year: s.year || "",
    page: s.page,
    per_page: s.perPage,
  };

  const data = await A.postJSON(payload);
  s.items = Array.isArray(data?.items) ? data.items : [];
  s.page = Number(data?.page || s.page || 1);
  s.perPage = Number(data?.per_page || s.perPage || 10);
  s.total = Number(data?.total || 0); // This should be the total for Active only

  // ✅ Use the total from the filtered results
  const activeCount = A.rqs("#suActiveCount");
  if (activeCount) {
    activeCount.textContent = String(s.total);
    activeCount.classList.toggle("d-none", s.total === 0);
  }

  renderActive(A);
  }

  function renderActive(A) {
    const { store } = A;
    const s = store.active;
    const tbody = A.rqs("#suActiveTbody");
    const meta = A.rqs("#suActiveMeta");
    const pagMeta = A.rqs("#suActivePaginationMeta");
    const pag = A.rqs("#suActivePagination");

    if (meta) meta.innerHTML = `Showing <span class="fw-semibold">${s.total || 0}</span> active accreditations.`;

    if (!tbody) return;
    if (!s.items.length) {
      tbody.innerHTML = `
        <tr>
          <td colspan="7" class="text-center text-muted py-5">
            <div class="mb-2"><i class="bi bi-folder-check fs-2"></i></div>
            No active records yet.
          </td>
        </tr>`;
    } else {
      tbody.innerHTML = s.items.map((it) => renderRow(A, it)).join("");
    }

    A.renderPagination(pag, pagMeta, s.page, s.perPage, s.total, (newPage) => {
      store.active.page = newPage;
      fetchActive(A).catch((e) => A.safeShowError(e.message));
    });
  }

  function bindUI(A) {
    const yearSel = A.rqs("#suActiveYearFilter");
    if (yearSel && !yearSel.__bound) {
      yearSel.__bound = true;
      yearSel.addEventListener("change", () => {
        A.store.active.year = yearSel.value || "";
        A.store.active.page = 1;
        fetchActive(A).catch((e) => A.safeShowError(e.message));
      });
    }

    // ✅ Print button: open EXACTLY what the browser would open for the href
    const tbody = A.rqs("#suActiveTbody");
    if (tbody && !tbody.__suPrintBound) {
      tbody.__suPrintBound = true;
      tbody.addEventListener("click", (e) => {
        const a = e.target?.closest?.('a[data-action="print"]');
        if (!a) return;

        // Prefer raw dataset url (not HTML-escaped), fallback to a.href
        const raw = String(a.dataset?.url || "").trim();
        const url = raw || String(a.href || "").trim();

        if (!url || url === "#" || url.startsWith("#")) {
          e.preventDefault();
          return;
        }

        e.preventDefault();
        window.open(url, "_blank", "noopener");
      });
    }
  }

  window.SUAccreditationActive = {
    init() {
      const A = mustBase();
      bindUI(A);
      return fetchActive(A);
    },
    fetchActive,
  };
})();
