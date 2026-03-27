/* js/accredititation/admin/returned.js */
/* global bootstrap */

(function () {
  "use strict";

  if (window.__adReturnedBooted) return;
  window.__adReturnedBooted = true;

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
    const status = r.status || "Returned";

    // Use the centralized renderTableActions function
    const actions = A.renderTableActions ? A.renderTableActions(r) : `
      <td class="text-end sa-actions">
        <button class="btn btn-outline-secondary btn-sm" type="button" data-action="view" title="View / Re-upload">
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

  async function fetchReturned(A, overridePage) {
    const { store } = A;
    const p = store.returned;

    // Use overridePage if supplied so pagination clicks are never stale
    const requestPage = (overridePage != null) ? Number(overridePage) : p.page;

    const data = await A.postJSON({
      action: "list_requests",
      mode: "returned",
      q: store.search || "",
      page: requestPage,
      per_page: p.perPage,
    });

    p.items = Array.isArray(data?.items) ? data.items : [];
    p.page = Number(data?.page || p.page || 1);
    p.perPage = Number(data?.per_page || p.perPage || 10);
    p.total = Number(data?.total || 0);

    renderReturned(A);
  }

  function renderReturned(A) {
    const tbody = A.rqs("#adReturnedTbody");
    const meta = A.rqs("#adReturnedMeta");
    const pagMeta = A.rqs("#adReturnedPaginationMeta");
    const pag = A.rqs("#adReturnedPagination");
    const count = A.rqs("#adReturnedCount");

    const p = A.store.returned;
    if (count) count.textContent = String(p.total || 0);

    if (meta) meta.innerHTML = `Showing <span class="fw-semibold">${p.total || 0}</span> returned request(s).`;

    if (!tbody) return;
    tbody.innerHTML = p.items.length
      ? p.items.map((r) => renderRow(A, r)).join("")
      : `
        <tr>
          <td colspan="8" class="text-center text-muted py-5">
            <div class="mb-2"><i class="bi bi-arrow-counterclockwise fs-2"></i></div>
            No returned records.
          </td>
        </tr>`;

    A.renderPagination(pag, pagMeta, p.page, p.perPage, p.total, (newPage) => {
      A.store.returned.page = newPage;
      fetchReturned(A, newPage).catch((e) => A.safeShowError(e.message));
    });

    // Initialize tooltips for the edit/view buttons
    if (window.bootstrap && window.bootstrap.Tooltip) {
      const tooltipTriggerList = tbody.querySelectorAll('[data-bs-toggle="tooltip"]');
      [...tooltipTriggerList].forEach(tooltipTriggerEl => new bootstrap.Tooltip(tooltipTriggerEl));
    }
  }

  // -------------------------
  // View modal + docs
  // -------------------------
  function setTxt(A, sel, v) {
    const el = A.rqs(sel);
    if (el) el.textContent = v;
  }

  function renderDocs(A, docsPayload) {
    // docsPayload expected: { items:[...], page, per_page, total }
    const tbody = A.rqs("#adDocsTbody");
    const pagMeta = A.rqs("#adDocsPaginationMeta");
    const pag = A.rqs("#adDocsPagination");
    const meta = A.rqs("#adDocsMeta");

    const st = A.store.docs;

    const items = Array.isArray(docsPayload?.items) ? docsPayload.items : [];
    st.items = items;
    st.page = Number(docsPayload?.page || st.page || 1);
    st.perPage = Number(docsPayload?.per_page || st.perPage || 8);
    st.total = Number(docsPayload?.total || 0);

    if (meta) meta.textContent = st.total ? `${st.total} document(s).` : "";

    if (!tbody) return;

    if (!items.length) {
      tbody.innerHTML = `<tr><td colspan="5" class="text-center text-muted py-4">No documents found.</td></tr>`;
    } else {
      tbody.innerHTML = items
        .map((d) => {
          const reqName = A.escapeHtml(d.requirement_name || d.requirement || "—");
          const fileName = A.escapeHtml(d.file_name || d.filename || "—");
          const url = d.file_url || d.url || "";
          const status = String(d.status || "—");
          const reason = A.escapeHtml(d.return_reason || d.reason || "—");
          const docId = A.escapeHtml(d.id);

          const canReplace =
            String(status).toLowerCase() === "returned" ||
            String(d.can_replace || "").toLowerCase() === "true" ||
            d.can_replace === true;

          const previewBtn = url
            ? `<button class="btn btn-outline-secondary btn-sm" type="button"
                     data-action="preview-doc" data-url="${A.escapeHtml(url)}" data-name="${fileName}">
                 <i class="bi bi-eye"></i> Preview
               </button>`
            : "";

          const replaceControls = canReplace
            ? `
              <div class="d-flex flex-wrap gap-2 justify-content-end">
                <input class="form-control form-control-sm" type="file"
                       style="max-width: 220px;"
                       data-role="replace-file" data-doc-id="${docId}"
                       accept=".pdf,application/pdf">
                <button class="btn btn-warning btn-sm" type="button" data-action="replace-doc" data-doc-id="${docId}">
                  <i class="bi bi-arrow-repeat"></i> Replace
                </button>
              </div>`
            : `<span class="text-muted small">—</span>`;

          return `
            <tr data-doc-id="${docId}">
              <td class="sa-wrap">${reqName}</td>
              <td class="sa-wrap">
                <div class="fw-semibold sa-truncate">${fileName}</div>
              </td>
              <td>${badge(status)}</td>
              <td class="sa-wrap">${reason}</td>
              <td class="text-end">
                <div class="d-flex flex-wrap gap-2 justify-content-end">
                  ${previewBtn}
                  ${replaceControls}
                </div>
              </td>
            </tr>`;
        })
        .join("");
    }

    A.renderPagination(pag, pagMeta, st.page, st.perPage, st.total, (newPage) => {
      A.store.docs.page = newPage;
      openViewModal(A, A.store.docs.requestId, { page: newPage }).catch((e) => A.safeShowError(e.message));
    });
  }

  async function openViewModal(A, requestId, opts = {}) {
    const modalEl = A.rqs("#adViewRequestModal");
    if (!modalEl || !window.bootstrap) return;

    A.store.docs.requestId = String(requestId || "");
    A.store.docs.page = Number(opts.page || A.store.docs.page || 1);

    // reset
    setTxt(A, "#adViewReqSub", "Loading…");
    setTxt(A, "#adOrgName", "—");
    setTxt(A, "#adOrgAbbr", "—");
    setTxt(A, "#adOrgScope", "—");
    setTxt(A, "#adOrgProgram", "—");
    setTxt(A, "#adOrgTerm", "—");
    setTxt(A, "#adReqStatus", "—");

    // show early
    bootstrap.Modal.getOrCreateInstance(modalEl).show();

    const data = await A.postJSON({
      action: "get_request",
      request_id: requestId,
      docs_page: A.store.docs.page,
      docs_per_page: A.store.docs.perPage,
    });

    // Expected: { ok:true, request:{...}, docs:{items,page,per_page,total} }
    const r = data?.request || data?.item || {};
    setTxt(A, "#adViewReqSub", `Request #${r.id || requestId}`);
    setTxt(A, "#adOrgName", r.org_name || "—");
    setTxt(A, "#adOrgAbbr", r.org_abbr || "—");
    setTxt(A, "#adOrgScope", r.scope || "—");
    setTxt(A, "#adOrgProgram", r.program || r.program_name || "—");
    setTxt(A, "#adOrgTerm", r.term_label || r.term || "—");
    setTxt(A, "#adReqStatus", r.status || "—");

    const hid = A.rqs("#adViewRequestId");
    if (hid) hid.value = String(r.id || requestId);

    // logo
    const img = A.rqs("#adOrgLogoImg");
    const fb = A.rqs("#adOrgLogoFallback");
    const logoUrl = r.logo_url || r.org_logo_url || "";
    if (img && fb) {
      if (logoUrl) {
        img.src = logoUrl;
        img.style.display = "";
        fb.style.display = "none";
      } else {
        img.style.display = "none";
        fb.style.display = "";
      }
    }

    renderDocs(A, data?.docs);
  }

  async function replaceDoc(A, docId, file) {
    if (!file) throw new Error("Please choose a replacement file.");

    const fd = new FormData();
    fd.append("action", "replace_document");
    fd.append("doc_id", String(docId));
    fd.append("file", file);

    await A.postForm(fd);
    A.safeShowSuccess("Document replaced.");

    // refresh modal + tables
    const reqId = A.store.docs.requestId;
    if (reqId) openViewModal(A, reqId, { page: A.store.docs.page }).catch((e) => A.safeShowError(e.message));
    A.bus.emit("refresh:all");
  }

  function bindViewModalActions(A) {
    const modalEl = A.rqs("#adViewRequestModal");
    if (!modalEl || modalEl.__adBound) return;
    modalEl.__adBound = true;

    modalEl.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-action]");
      if (!btn) return;

      const action = btn.getAttribute("data-action");

      if (action === "preview-doc") {
        const url = btn.getAttribute("data-url");
        const name = btn.getAttribute("data-name") || "File";
        if (url) A.openPreview(url, name);
        return;
      }

      if (action === "replace-doc") {
        const docId = btn.getAttribute("data-doc-id");
        if (!docId) return;

        const inp = modalEl.querySelector(`[data-role="replace-file"][data-doc-id="${CSS.escape(String(docId))}"]`);
        const file = inp && inp.files && inp.files[0];

        replaceDoc(A, docId, file).catch((err) => A.safeShowError(err.message));
      }
    });
  }

  // -------------------------
  // Binding tab + modal
  // -------------------------
  function bindReturned(A, root) {
    const r = root || A.store._root || document;

    const tbody = A.qs("#adReturnedTbody", r);
    if (tbody && !tbody.__adBound) {
      tbody.__adBound = true;
      tbody.addEventListener("click", (e) => {
        const btn = e.target.closest("[data-action='view']");
        if (!btn) return;
        const id = btn.closest("tr")?.getAttribute("data-id");
        if (id) openViewModal(A, id).catch((err) => A.safeShowError(err.message));
      });
    }

    // Also allow other tabs to request open
    if (!A.__adViewBusBound) {
      A.__adViewBusBound = true;
      A.bus.on("request:view", (p) => {
        const id = p?.request_id;
        if (id) openViewModal(A, id).catch((e) => A.safeShowError(e.message));
      });
    }

    bindViewModalActions(A);
  }

  function init(root) {
    const A = mustBase();
    const r = root || document;

    // Always re-bind DOM listeners (bind helpers guard per-element)
    bindReturned(A, r);

    // Always fetch fresh data on init / re-navigation
    fetchReturned(A, 1).catch((e) => A.safeShowError(e.message));

    // Register bus listeners only once per module load
    if (!window.__adReturnedBusListening) {
      window.__adReturnedBusListening = true;

      A.bus.on("search:changed", () => {
        A.store.returned.page = 1;
        fetchReturned(A, 1).catch((e) => A.safeShowError(e.message));
      });

      A.bus.on("refresh:all", () => {
        fetchReturned(A, A.store.returned.page).catch((e) => A.safeShowError(e.message));
      });
    }
  }

  try {
    const A = window.ADAccreditation;
    if (A?.bus) A.bus.on("booted", (p) => init(p?.root || A.store?._root || document));
  } catch {}

  window.ADAccreditationReturned = { init };
})();