/* js/accredititation/admin/pending.js */
/* global bootstrap */

(function () {
  "use strict";

  if (window.__adPendingBooted) return;
  window.__adPendingBooted = true;

  function mustBase() {
    if (!window.ADAccreditation) throw new Error("Base module not loaded (ADAccreditation).");
    return window.ADAccreditation;
  }

  function badge(status) {
    const s = String(status || "");
    const map = {
      Pending: "secondary",
      Returned: "warning",
      Recommended: "info",
      Approved: "primary",
      Rejected: "danger",
      Active: "success",
      Draft: "dark",
    };
    const cls = map[s] || "secondary";
    return `<span class="badge text-bg-${cls}">${s || "—"}</span>`;
  }

  function scopeBadge(scope) {
    const s = String(scope || "—");
    const map = { General: "info", Exclusive: "dark", Club: "warning", Clubs: "warning" };
    return `<span class="badge text-bg-${map[s] || "secondary"}">${s || "—"}</span>`;
  }

  function typeBadge(type) {
    const s = String(type || "—");
    const map = { Organization: "primary", Club: "dark" };
    return `<span class="badge text-bg-${map[s] || "secondary"}">${s}</span>`;
  }

  function renderRow(A, r) {
    const id = A.escapeHtml(r.id);
    const org = A.escapeHtml(r.org_name || r.organization || "—");
    const abbr = A.escapeHtml(r.org_abbr || "");
    const type = A.escapeHtml(r.org_type || r.type || "—");
    const scope = A.escapeHtml(r.scope || "—");
    const program = A.escapeHtml(r.program || r.program_name || "—");
    const term = A.escapeHtml(r.term_label || r.term || "—");
    const status = r.status || "—";

    // Use the centralized renderTableActions function
    const actions = A.renderTableActions ? A.renderTableActions(r) : `
      <td class="text-end sa-actions">
        <button class="btn btn-outline-secondary btn-sm" type="button" data-action="view" title="View">
          <i class="bi bi-eye"></i>
        </button>
      </td>`;

    return `
      <tr data-id="${id}">
        <td class="text-muted">${id}</td>
        <td class="sa-wrap">
          <div class="fw-semibold">${org}</div>
          <div class="text-muted small">${abbr}</div>
        </td>
        <td>${typeBadge(type)}</td>
        <td>${scopeBadge(scope)}</td>
        <td class="sa-wrap">${program}</td>
        <td class="sa-wrap">${term}</td>
        <td>${badge(status)}</td>
        ${actions.includes('<td') ? actions : `<td class="text-end sa-actions">${actions}</td>`}
      </tr>`;
  }

  async function fetchPending(A, overridePage) {
    const { store } = A;
    const p = store.pending;

    // Use overridePage if supplied so pagination clicks are never stale
    const requestPage = (overridePage != null) ? Number(overridePage) : p.page;

    const data = await A.postJSON({
      action: "list_requests",
      mode: "pending",
      q: store.search || "",
      page: requestPage,
      per_page: p.perPage,
    });

    // Expected: { ok:true, items:[...], page, per_page, total }
    p.items = Array.isArray(data?.items) ? data.items : [];
    p.page = Number(data?.page || p.page || 1);
    p.perPage = Number(data?.per_page || p.perPage || 10);
    p.total = Number(data?.total || 0);

    renderPending(A);
  }

  function renderPending(A) {
    const tbody = A.rqs("#adPendingTbody");
    const meta = A.rqs("#adPendingMeta");
    const pagMeta = A.rqs("#adPendingPaginationMeta");
    const pag = A.rqs("#adPendingPagination");
    const count = A.rqs("#adPendingCount");

    const p = A.store.pending;
    if (count) count.textContent = String(p.total || 0);

    if (meta) meta.innerHTML = `Showing <span class="fw-semibold">${p.total || 0}</span> pending request(s).`;

    if (!tbody) return;
    tbody.innerHTML = p.items.length
      ? p.items.map((r) => renderRow(A, r)).join("")
      : `
        <tr>
          <td colspan="8" class="text-center text-muted py-5">
            <div class="mb-2"><i class="bi bi-hourglass-split fs-2"></i></div>
            No pending records.
          </td>
        </tr>`;

    A.renderPagination(pag, pagMeta, p.page, p.perPage, p.total, (newPage) => {
      A.store.pending.page = newPage;
      fetchPending(A, newPage).catch((e) => A.safeShowError(e.message));
    });

    // Initialize tooltips for the edit/view buttons
    if (window.bootstrap && window.bootstrap.Tooltip) {
      const tooltipTriggerList = tbody.querySelectorAll('[data-bs-toggle="tooltip"]');
      [...tooltipTriggerList].forEach(tooltipTriggerEl => new bootstrap.Tooltip(tooltipTriggerEl));
    }
  }

  function bindPending(A, root) {
    const r = root || A.store._root || document;

    const tbody = A.qs("#adPendingTbody", r);
    if (tbody && !tbody.__adBound) {
      tbody.__adBound = true;
      tbody.addEventListener("click", (e) => {
        const btn = e.target.closest("[data-action='view']");
        if (!btn) return;
        const id = btn.closest("tr")?.getAttribute("data-id");
        if (!id) return;

        // Delegate modal to returned.js (single source of truth)
        A.bus.emit("request:view", { request_id: id });
      });
    }
  }

  function init(root) {
    const A = mustBase();
    const r = root || document;

    // Always re-bind DOM listeners (bind helpers guard per-element)
    bindPending(A, r);

    // Always fetch fresh data on init / re-navigation
    fetchPending(A, 1).catch((e) => A.safeShowError(e.message));

    // Register bus listeners only once per module load (guarded by __adPendingBooted at top)
    if (!window.__adPendingBusListening) {
      window.__adPendingBusListening = true;

      A.bus.on("search:changed", () => {
        A.store.pending.page = 1;
        fetchPending(A, 1).catch((e) => A.safeShowError(e.message));
      });

      A.bus.on("refresh:all", () => {
        fetchPending(A, A.store.pending.page).catch((e) => A.safeShowError(e.message));
      });
    }
  }

  try {
    const A = window.ADAccreditation;
    if (A?.bus) A.bus.on("booted", (p) => init(p?.root || A.store?._root || document));
  } catch {}

  window.ADAccreditationPending = { init };
})();