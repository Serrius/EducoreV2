/* js/accreditation/special/manage-files.js */
/* global bootstrap */

(function () {
  "use strict";

  // prevent double-loading the script file itself
  if (window.__saManageFilesBooted) return;
  window.__saManageFilesBooted = true;

  function mustBase() {
    if (!window.SAAccreditation) {
      throw new Error("Base module not loaded (SAAccreditation).");
    }
    return window.SAAccreditation;
  }

  // ---------- UI helpers
  function appliesBadge(v) {
    const s = String(v || "All");
    const map = {
      All: "primary",
      General: "info",
      Exclusive: "dark",
      Clubs: "warning",
      // backward compat (old values that might still be in DB)
      Both: "primary",
    };
    const cls = map[s] || "secondary";
    const label = s === "Both" ? "All" : s;
    return `<span class="badge text-bg-${cls}">${label}</span>`;
  }

  function escAttr(s) {
    // safe enough for attributes (we already escapeHtml for most text)
    return String(s ?? "").replaceAll('"', "&quot;");
  }

  function buildRequirementRow(A, req, idx) {
    const id = A.escapeHtml(req.id);
    const name = A.escapeHtml(req.requirement_name || req.name || "—");
    const applies = A.escapeHtml(req.applies_to || "All");
    const activeTpl = A.escapeHtml(req.active_template_name || req.active_template || "—");
    const collapseId = `saReqTplCollapse_${id}`;

    // main row
    const row = `
      <tr data-req-id="${id}">
        <td class="text-muted">${idx}</td>
        <td class="sa-wrap">
          <div class="fw-semibold">${name}</div>
          <div class="text-muted small">Templates are optional.</div>
        </td>
        <td>${appliesBadge(applies)}</td>
        <td class="sa-truncate">${activeTpl}</td>
        <td class="text-end sa-req-row-actions">
          <button class="btn btn-outline-secondary btn-sm sa-collapse-btn"
                  type="button"
                  data-bs-toggle="collapse" data-bs-target="#${collapseId}"
                  aria-expanded="false" data-action="toggle-templates" data-req-id="${id}">
            <i class="bi bi-layers me-1"></i> Templates
          </button>

          <button class="btn btn-outline-primary btn-sm"
                  type="button"
                  data-action="upload-template"
                  data-req-id="${id}"
                  data-req-name="${escAttr(name)}">
            <i class="bi bi-upload"></i>
          </button>

          <button class="btn btn-outline-secondary btn-sm"
                  type="button"
                  data-action="edit-req"
                  data-req-id="${id}">
            <i class="bi bi-pencil"></i>
          </button>

          <button class="btn btn-outline-danger btn-sm"
                  type="button"
                  data-action="archive-req"
                  data-req-id="${id}"
                  data-req-name="${escAttr(name)}">
            <i class="bi bi-archive"></i>
          </button>
        </td>
      </tr>
    `;

    // collapse row (templates table + pagination placeholders)
    const collapse = `
      <tr class="collapse" id="${collapseId}" data-role="tpl-collapse" data-req-id="${id}">
        <td colspan="5">
          <div class="sa-req-panel">
            <div class="d-flex flex-wrap align-items-center justify-content-between gap-2 mb-2">
              <div class="min-w-0">
                <div class="sa-mini-title">Templates</div>
                <div class="sa-mini-meta sa-truncate">For: ${name}</div>
              </div>
              <div class="d-flex gap-2">
                <button class="btn btn-outline-secondary btn-sm" type="button"
                        data-action="refresh-templates" data-req-id="${id}">
                  <i class="bi bi-arrow-clockwise me-1"></i> Refresh
                </button>
                <button class="btn btn-outline-primary btn-sm" type="button"
                        data-action="upload-template" data-req-id="${id}" data-req-name="${escAttr(name)}">
                  <i class="bi bi-upload me-1"></i> Upload
                </button>
              </div>
            </div>

            <div class="table-responsive">
              <table class="table table-sm align-middle">
                <thead class="table-light">
                  <tr>
                    <th>File</th>
                    <th style="width: 80px;">Type</th>
                    <th style="width: 70px;">Ver</th>
                    <th style="width: 90px;">Active</th>
                    <th style="width: 140px;" class="text-end">Actions</th>
                  </tr>
                </thead>
                <tbody data-role="tpl-tbody" data-req-id="${id}">
                  <tr>
                    <td colspan="5" class="text-center text-muted py-3">No templates.</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div class="d-flex justify-content-between align-items-center mt-2 flex-wrap gap-2">
              <div class="text-muted small" data-role="tpl-pagination-meta" data-req-id="${id}"></div>
              <nav aria-label="Templates pagination">
                <ul class="pagination pagination-sm mb-0" data-role="tpl-pagination" data-req-id="${id}"></ul>
              </nav>
            </div>

            <div class="text-muted small mt-2" data-role="tpl-meta" data-req-id="${id}"></div>
          </div>
        </td>
      </tr>
    `;

    return row + collapse;
  }

  // ---------- Data fetchers
  async function fetchRequirements(A) {
    const { reqs } = A.store;

    const data = await A.postJSON({
      action: "list_requirements",
      status: reqs.status || "Active",
      page: reqs.page,
      per_page: reqs.perPage,
      q: A.store.search || "",
    });

    // Expected: { ok:true, items:[...], page, per_page, total }
    reqs.items = Array.isArray(data?.items) ? data.items : [];
    reqs.page = Number(data?.page || reqs.page || 1);
    reqs.perPage = Number(data?.per_page || reqs.perPage || 10);
    reqs.total = Number(data?.total || 0);

    renderRequirements(A);
  }

  function renderRequirements(A) {
    const rqs = A.rqs || A.qs;
    const rqsa = A.rqsa || A.qsa;

    const tbody = rqs("#saReqTbody");
    const pagMeta = rqs("#saReqPaginationMeta");
    const pag = rqs("#saReqPagination");
    const metaCompat = rqs("#saReqMeta");

    const { reqs } = A.store;

    if (metaCompat) {
      metaCompat.textContent = reqs.total ? `${reqs.total} requirement(s).` : "";
    }

    if (!tbody) return;

    if (!reqs.items.length) {
      tbody.innerHTML = `
        <tr>
          <td colspan="5" class="text-center text-muted py-5">
            <div class="mb-2"><i class="bi bi-folder2 fs-2"></i></div>
            No requirements found.
          </td>
        </tr>`;
    } else {
      tbody.innerHTML = reqs.items
        .map((req, i) => buildRequirementRow(A, req, (reqs.page - 1) * reqs.perPage + (i + 1)))
        .join("");
    }

    A.renderPagination(pag, pagMeta, reqs.page, reqs.perPage, reqs.total, (newPage) => {
      A.store.reqs.page = newPage;
      fetchRequirements(A).catch((e) => A.safeShowError(e.message));
    });

    // Bind collapse lazy load once per rendered collapse row
    bindCollapseLazyLoad(A, rqsa);
  }

  function getTplState(A, reqId) {
    const key = String(reqId);
    if (!A.store.templatesByReq[key]) {
      A.store.templatesByReq[key] = { items: [], page: 1, perPage: 5, total: 0, loaded: false };
    }
    return A.store.templatesByReq[key];
  }

  async function fetchTemplates(A, reqId, opts = {}) {
    const st = getTplState(A, reqId);
    st.page = opts.page != null ? Number(opts.page) : st.page;
    st.perPage = opts.perPage != null ? Number(opts.perPage) : st.perPage;

    const data = await A.postJSON({
      action: "list_templates",
      requirement_id: reqId,
      page: st.page,
      per_page: st.perPage,
    });

    // Expected: { ok:true, items:[...], page, per_page, total }
    st.items = Array.isArray(data?.items) ? data.items : [];
    st.page = Number(data?.page || st.page || 1);
    st.perPage = Number(data?.per_page || st.perPage || 5);
    st.total = Number(data?.total || 0);
    st.loaded = true;

    renderTemplates(A, reqId);
  }

  function cssEsc(v) {
    // CSS.escape polyfill-ish fallback for older engines
    if (window.CSS && typeof window.CSS.escape === "function") return window.CSS.escape(String(v));
    return String(v).replace(/"/g, '\\"');
  }

  function renderTemplates(A, reqId) {
    const rqs = A.rqs || A.qs;

    const st = getTplState(A, reqId);
    const rid = cssEsc(reqId);

    const tbody = rqs(`[data-role="tpl-tbody"][data-req-id="${rid}"]`);
    const meta = rqs(`[data-role="tpl-meta"][data-req-id="${rid}"]`);
    const pagMeta = rqs(`[data-role="tpl-pagination-meta"][data-req-id="${rid}"]`);
    const pag = rqs(`[data-role="tpl-pagination"][data-req-id="${rid}"]`);

    if (meta) meta.textContent = st.total ? `${st.total} template(s).` : "";

    if (!tbody) return;

    if (!st.items.length) {
      tbody.innerHTML = `<tr><td colspan="5" class="text-center text-muted py-3">No templates.</td></tr>`;
    } else {
      tbody.innerHTML = st.items
        .map((t) => {
          const id = A.escapeHtml(t.id);
          const file = A.escapeHtml(t.file_name || "—");
          const type = A.escapeHtml(t.file_type || (String(file).toLowerCase().endsWith(".pdf") ? "PDF" : "DOCX"));
          const ver = A.escapeHtml(t.version || "—");
          const active = !!t.is_active;
          const url = A.escapeHtml(t.file_url || "#");

          return `
            <tr data-tpl-id="${id}" data-req-id="${A.escapeHtml(reqId)}">
              <td class="sa-wrap">${file}</td>
              <td>${type}</td>
              <td>${ver}</td>
              <td>${active ? '<span class="badge text-bg-success">Yes</span>' : '<span class="badge text-bg-secondary">No</span>'}</td>
              <td class="text-end sa-actions">
                <button class="btn btn-outline-secondary btn-sm" type="button"
                        data-action="preview-template" data-url="${url}" data-name="${escAttr(file)}" title="Preview">
                  <i class="bi bi-eye"></i>
                </button>
                <button class="btn btn-outline-success btn-sm" type="button"
                        data-action="set-active-template"
                        data-tpl-id="${id}" data-req-id="${A.escapeHtml(reqId)}"
                        ${active ? "disabled" : ""} title="Set Active">
                  <i class="bi bi-check2"></i>
                </button>
                <button class="btn btn-outline-danger btn-sm" type="button"
                        data-action="delete-template"
                        data-tpl-id="${id}" data-req-id="${A.escapeHtml(reqId)}" title="Delete">
                  <i class="bi bi-trash"></i>
                </button>
              </td>
            </tr>
          `;
        })
        .join("");
    }

    A.renderPagination(pag, pagMeta, st.page, st.perPage, st.total, (newPage) => {
      fetchTemplates(A, reqId, { page: newPage }).catch((e) => A.safeShowError(e.message));
    });
  }

  function bindCollapseLazyLoad(A, rqsa) {
    const rqsAll = rqsa || A.qsa;
    const collapses = rqsAll('[data-role="tpl-collapse"]');

    for (const row of collapses) {
      if (row.__saTplCollapseBound) continue;
      row.__saTplCollapseBound = true;

      row.addEventListener("shown.bs.collapse", () => {
        const reqId = row.getAttribute("data-req-id");
        if (!reqId) return;

        const st = getTplState(A, reqId);
        if (!st.loaded) {
          fetchTemplates(A, reqId).catch((e) => A.safeShowError(e.message));
        } else {
          renderTemplates(A, reqId);
        }
      });
    }
  }

  // ---------- Requirement modal (add/edit)
  function openRequirementModal(A, req) {
    const rqs = A.rqs || A.qs;

    const modalEl = rqs("#saRequirementModal");
    if (!modalEl || !window.bootstrap) return;

    const titleEl = rqs("#saRequirementModalTitle");
    const idEl = rqs("#saReqId");
    const nameEl = rqs("#saReqName");
    const appliesEl = rqs("#saReqAppliesTo");
    const sortEl = rqs("#saReqSortOrder");

    if (titleEl) titleEl.textContent = req?.id ? "Edit Requirement" : "Add Requirement";
    if (idEl) idEl.value = req?.id ? String(req.id) : "";
    if (nameEl) nameEl.value = req?.requirement_name || "";
    if (appliesEl) {
      // ✅ matches your DB ENUM('General','Exclusive','Clubs','All')
      const v = req?.applies_to || "All";
      appliesEl.value = ["All", "General", "Exclusive", "Clubs"].includes(v) ? v : "All";
    }
    if (sortEl) sortEl.value = String(req?.sort_order ?? 0);

    bootstrap.Modal.getOrCreateInstance(modalEl).show();
  }

  async function loadRequirement(A, reqId) {
    const data = await A.postJSON({ action: "get_requirement", requirement_id: reqId });
    return data?.item || null;
  }

  function bindRequirementForm(A, root) {
    const r = root || A.store._root || document;
    const form = A.qs("#saRequirementForm", r);
    if (!form || form.__saReqFormBound) return;
    form.__saReqFormBound = true;

    form.addEventListener("submit", async (e) => {
      e.preventDefault();

      const id = A.qs("#saReqId", r)?.value || "";
      const name = A.qs("#saReqName", r)?.value?.trim() || "";
      const applies = A.qs("#saReqAppliesTo", r)?.value || "All";
      const sortOrder = Number(A.qs("#saReqSortOrder", r)?.value || 0);

      if (!name) return;

      try {
        await A.postJSON({
          action: id ? "update_requirement" : "create_requirement",
          id: id || undefined,
          requirement_name: name,
          applies_to: applies,
          sort_order: sortOrder,
        });

        const modalEl = A.qs("#saRequirementModal", r) || A.qs("#saRequirementModal");
        if (modalEl) bootstrap.Modal.getOrCreateInstance(modalEl).hide();

        A.safeShowSuccess("Saved.");
        fetchRequirements(A);
      } catch (err) {
        A.safeShowError(err.message);
      }
    });
  }

  // ---------- Archive requirement
  function openArchiveModal(A, reqId, reqName) {
    const rqs = A.rqs || A.qs;

    const modalEl = rqs("#saArchiveRequirementModal");
    if (!modalEl || !window.bootstrap) return;

    const idEl = rqs("#saArchiveReqId");
    const nameEl = rqs("#saArchiveReqName");

    if (idEl) idEl.value = String(reqId);
    if (nameEl) nameEl.textContent = reqName || "—";

    bootstrap.Modal.getOrCreateInstance(modalEl).show();
  }

  function bindArchiveConfirm(A, root) {
    const r = root || A.store._root || document;
    const btn = A.qs("#saArchiveReqConfirmBtn", r);
    if (!btn || btn.__saArchiveBound) return;
    btn.__saArchiveBound = true;

    btn.addEventListener("click", async () => {
      const id = A.qs("#saArchiveReqId", r)?.value;
      if (!id) return;

      try {
        await A.postJSON({ action: "archive_requirement", requirement_id: id });

        const modalEl = A.qs("#saArchiveRequirementModal", r) || A.qs("#saArchiveRequirementModal");
        if (modalEl) bootstrap.Modal.getOrCreateInstance(modalEl).hide();

        A.safeShowSuccess("Requirement archived.");
        fetchRequirements(A);
      } catch (err) {
        A.safeShowError(err.message);
      }
    });
  }

  // ---------- Upload template
  function openUploadTemplateModal(A, reqId, reqName) {
    const rqs = A.rqs || A.qs;

    const modalEl = rqs("#saUploadTemplateModal");
    if (!modalEl || !window.bootstrap) return;

    const hid = rqs("#saTplRequirementId");
    const lab = rqs("#saTplReqName");
    const file = rqs("#saTplFile");

    if (hid) hid.value = String(reqId);
    if (lab) lab.textContent = reqName || `Requirement #${reqId}`;
    if (file) file.value = "";

    bootstrap.Modal.getOrCreateInstance(modalEl).show();
  }

  function bindUploadTemplateForm(A, root) {
    const r = root || A.store._root || document;
    const form = A.qs("#saUploadTemplateForm", r);
    if (!form || form.__saUploadBound) return;
    form.__saUploadBound = true;

    form.addEventListener("submit", async (e) => {
      e.preventDefault();

      const reqId = A.qs("#saTplRequirementId", r)?.value;
      const fileInput = A.qs("#saTplFile", r);
      const file = fileInput?.files?.[0];
      if (!reqId || !file) return;

      try {
        const fd = new FormData();
        fd.append("action", "upload_template");
        fd.append("requirement_id", reqId);
        fd.append("template_file", file);

        const res = await fetch(A.API_URL, {
          method: "POST",
          credentials: "include",
          body: fd,
        });

        const txt = await res.text();
        let data;
        try {
          data = JSON.parse(txt);
        } catch {
          throw new Error("Invalid JSON from server.");
        }

        if (!res.ok || data?.ok === false) {
          throw new Error(data?.error || "Upload failed.");
        }

        const modalEl = A.qs("#saUploadTemplateModal", r) || A.qs("#saUploadTemplateModal");
        if (modalEl) bootstrap.Modal.getOrCreateInstance(modalEl).hide();

        A.safeShowSuccess("Template uploaded.");

        // Refresh req list (active template name changes)
        fetchRequirements(A);

        // Refresh template list for that requirement
        const st = getTplState(A, reqId);
        st.loaded = false;
        fetchTemplates(A, reqId, { page: 1 }).catch((err) => A.safeShowError(err.message));
      } catch (err) {
        A.safeShowError(err.message);
      }
    });
  }

  // ---------- Template actions
  async function setActiveTemplate(A, reqId, tplId) {
    await A.postJSON({ action: "set_active_template", requirement_id: reqId, template_id: tplId });
    A.safeShowSuccess("Template set as active.");

    // refresh requirement list (active template column)
    fetchRequirements(A);

    // refresh templates for req
    const st = getTplState(A, reqId);
    st.loaded = false;
    fetchTemplates(A, reqId).catch((e) => A.safeShowError(e.message));
  }

  async function deleteTemplate(A, reqId, tplId) {
    await A.postJSON({ action: "delete_template", requirement_id: reqId, template_id: tplId });
    A.safeShowSuccess("Template deleted.");

    // refresh templates
    const st = getTplState(A, reqId);
    st.loaded = false;
    fetchTemplates(A, reqId).catch((e) => A.safeShowError(e.message));

    // refresh requirements (in case active template removed)
    fetchRequirements(A);
  }

  // ---------- Delegated actions in Manage Files tab
  function bindManageFiles(A, root) {
    const r = root || A.store._root || document;

    // filter (status)
    const sel = A.qs("#saReqStatusFilter", r);
    if (sel && !sel.__saBound) {
      sel.__saBound = true;
      sel.addEventListener("change", () => {
        A.store.reqs.status = sel.value || "Active";
        A.store.reqs.page = 1;
        fetchRequirements(A).catch((e) => A.safeShowError(e.message));
      });
    }

    // add button
    const addBtn = A.qs("#saAddRequirementBtn", r);
    if (addBtn && !addBtn.__saBound) {
      addBtn.__saBound = true;
      addBtn.addEventListener("click", () => openRequirementModal(A, null));
    }

    // table action delegation
    const tbody = A.qs("#saReqTbody", r);
    if (tbody && !tbody.__saBound) {
      tbody.__saBound = true;

      tbody.addEventListener("click", async (e) => {
        const btn = e.target.closest("[data-action]");
        if (!btn) return;

        const action = btn.getAttribute("data-action");
        const reqId =
          btn.getAttribute("data-req-id") ||
          btn.closest("tr")?.getAttribute("data-req-id");

        const reqName = btn.getAttribute("data-req-name") || "";

        if (action === "upload-template") {
          if (reqId) openUploadTemplateModal(A, reqId, reqName);
          return;
        }

        if (action === "refresh-templates") {
          if (!reqId) return;
          const st = getTplState(A, reqId);
          st.loaded = false;
          fetchTemplates(A, reqId, { page: 1 }).catch((err) => A.safeShowError(err.message));
          return;
        }

        if (action === "edit-req") {
          if (!reqId) return;
          try {
            const req = await loadRequirement(A, reqId);
            openRequirementModal(A, req);
          } catch (err) {
            A.safeShowError(err.message);
          }
          return;
        }

        if (action === "archive-req") {
          if (!reqId) return;
          openArchiveModal(A, reqId, reqName);
          return;
        }

        if (action === "preview-template") {
          const url = btn.getAttribute("data-url");
          const name = btn.getAttribute("data-name");
          if (url) A.openPreview(url, name || "");
          return;
        }

        if (action === "set-active-template") {
          const tplId = btn.getAttribute("data-tpl-id");
          const rId = btn.getAttribute("data-req-id");
          if (!tplId || !rId) return;
          try {
            await setActiveTemplate(A, rId, tplId);
          } catch (err) {
            A.safeShowError(err.message);
          }
          return;
        }

        if (action === "delete-template") {
          const tplId = btn.getAttribute("data-tpl-id");
          const rId = btn.getAttribute("data-req-id");
          if (!tplId || !rId) return;

          if (!confirm("Delete this template?")) return;

          try {
            await deleteTemplate(A, rId, tplId);
          } catch (err) {
            A.safeShowError(err.message);
          }
        }
      });
    }

    bindRequirementForm(A, r);
    bindArchiveConfirm(A, r);
    bindUploadTemplateForm(A, r);
  }

  // ---------- init (called by base)
  function init(root) {
    const A = mustBase();
    const r = root || document;

    // Always re-bind DOM listeners (bind helpers guard per-element)
    bindManageFiles(A, r);

    // Always fetch fresh data on init / re-navigation
    fetchRequirements(A).catch((e) => A.safeShowError(e.message));

    // Register bus listeners only once per module load
    if (!window.__saFilesBusListening) {
      window.__saFilesBusListening = true;

      A.bus.on("search:changed", () => {
        A.store.reqs.page = 1;
        fetchRequirements(A).catch((e) => A.safeShowError(e.message));
      });

      A.bus.on("refresh:all", () => {
        fetchRequirements(A).catch((e) => A.safeShowError(e.message));
        // mark all templates as stale so they re-load on next expand
        for (const k of Object.keys(A.store.templatesByReq || {})) {
          if (A.store.templatesByReq[k]) A.store.templatesByReq[k].loaded = false;
        }
      });
    }
  }

  // Allow base to call: window.SAAccreditationFiles.init(root)
  window.SAAccreditationFiles = { init };

  // If script loads before base calls submodule init, still listen for booted.
  try {
    const A = window.SAAccreditation;
    if (A?.bus) {
      A.bus.on("booted", (p) => init(p?.root || A.store?._root || document));
    }
  } catch (e) {
    // ignore
  }
})();
