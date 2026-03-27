/* js/accreditation/special/active.js */
/* global bootstrap */

(function () {
  "use strict";

  // prevent double-loading the script file itself
  if (window.__saActiveBooted) return;
  window.__saActiveBooted = true;

  function mustBase() {
    if (!window.SAAccreditation) {
      throw new Error("Base module not loaded (SAAccreditation).");
    }
    return window.SAAccreditation;
  }

  // ----- Badges
  function statusBadge(status) {
    const s = String(status || "");
    const map = {
      Active: "success",
      Approved: "primary",
      Recommended: "info",
      Returned: "warning",
      Rejected: "danger",
      Draft: "dark",
      Pending: "secondary",
    };
    const cls = map[s] || "secondary";
    return `<span class="badge text-bg-${cls}">${s || "—"}</span>`;
  }

  function scopeBadge(scope) {
    const s = String(scope || "");
    const map = {
      General: "secondary",
      Exclusive: "dark",
      Clubs: "info",
      All: "primary",
      Both: "primary",
    };
    const cls = map[s] || "secondary";
    return `<span class="badge text-bg-${cls}">${s || "—"}</span>`;
  }

  function renderRow(A, r) {
    const id = A.escapeHtml(r.id);
    const org = A.escapeHtml(r.org_name || r.organization || "—");
    const abbr = A.escapeHtml(r.org_abbr || "");
    const scope = A.escapeHtml(r.scope || "—");
    const program = A.escapeHtml(r.program || "—");
    const term = A.escapeHtml(r.term_label || r.term || "—");
    const status = r.status || "Active";

    return `
      <tr data-id="${id}">
        <td class="text-muted">${id}</td>
        <td class="sa-wrap">
          <div class="fw-semibold">${org}</div>
          <div class="text-muted small">${abbr}</div>
        </td>
        <td>${scopeBadge(scope)}</td>
        <td>${program}</td>
        <td class="sa-wrap">${term}</td>
        <td>${statusBadge(status)}</td>
        <td class="text-end sa-actions">
          <button class="btn btn-outline-secondary btn-sm" data-action="view" type="button" title="View">
            <i class="bi bi-eye"></i>
          </button>
        </td>
      </tr>
    `;
  }

  async function fetchActive(A) {
    const { store } = A;
    const a = store.active;

    const payload = {
      action: "list_requests",
      mode: "active",
      q: store.search || "",
      term_id: a.termId || "", // computed by base from year+semester, or empty for All
      page: a.page,
      per_page: a.perPage,
    };

    const data = await A.postJSON(payload);

    // Expected:
    // { ok:true, items:[...], page, per_page, total, counts:{pending, active} }
    a.items = Array.isArray(data?.items) ? data.items : [];
    a.page = Number(data?.page || a.page || 1);
    a.perPage = Number(data?.per_page || a.perPage || 10);
    a.total = Number(data?.total || 0);

    if (data?.counts) {
      const c = data.counts;
      // root-aware counters (fallback to document if needed)
      const pendingCount = (A.rqs ? A.rqs("#saPendingCount") : null) || A.qs("#saPendingCount");
      const activeCount = (A.rqs ? A.rqs("#saActiveCount") : null) || A.qs("#saActiveCount");
      const recommendedCount = (A.rqs ? A.rqs("#saRecommendedCount") : null) || A.qs("#saRecommendedCount");
      if (pendingCount && c.pending != null) pendingCount.textContent = String(c.pending);
      if (activeCount && c.active != null) activeCount.textContent = String(c.active);
      if (recommendedCount && c.recommended != null) recommendedCount.textContent = String(c.recommended);
    }

    renderActive(A);
  }

  function renderActive(A) {
    const { store } = A;
    const a = store.active;

    const rqs = A.rqs || A.qs;
    const tbody = rqs("#saActiveTbody");
    const meta = rqs("#saActiveMeta");
    const pagMeta = rqs("#saActivePaginationMeta");
    const pag = rqs("#saActivePagination");

    if (meta) {
      meta.innerHTML = `Showing <span class="fw-semibold">${a.total || 0}</span> active accreditations.`;
    }

    if (!tbody) return;

    if (!a.items.length) {
      tbody.innerHTML = `
        <tr>
          <td colspan="7" class="text-center text-muted py-5">
            <div class="mb-2"><i class="bi bi-folder-check fs-2"></i></div>
            No active records found.
          </td>
        </tr>`;
    } else {
      tbody.innerHTML = a.items.map((row) => renderRow(A, row)).join("");
    }

    A.renderPagination(pag, pagMeta, a.page, a.perPage, a.total, (newPage) => {
      store.active.page = newPage;
      fetchActive(A).catch((e) => A.safeShowError(e.message));
    });
  }

  // ----- View Modal for Active Requests (with disabled recommendation button)
  async function openViewModalActive(A, requestId) {
    console.log("[Active] Opening view modal for request:", requestId);
    
    const rqs = A.rqs || A.qs;

    const modalEl = rqs("#saViewRequestModal");
    if (!modalEl || !window.bootstrap) {
      console.error("[Active] Modal not found or bootstrap not loaded");
      return;
    }

    // reset
    const setTxt = (sel, v) => {
      const el = rqs(sel);
      if (el) el.textContent = v;
    };

    setTxt("#saViewReqSub", "Loading…");

    // open early
    const modal = bootstrap.Modal.getOrCreateInstance(modalEl);
    modal.show();

    try {
      const data = await A.postJSON({ action: "get_request", request_id: requestId });
      const r = data?.request || {};

      setTxt("#saViewReqSub", `Request #${r.id || requestId}`);
      setTxt("#saOrgName", r.org_name || "—");
      setTxt("#saOrgAbbr", r.org_abbr || "—");
      setTxt("#saOrgScope", r.scope || "—");
      setTxt("#saOrgProgram", r.program || "—");
      setTxt("#saOrgTerm", r.term_label || "—");
      setTxt("#saCoordinatorName", r.coordinator_name || "—");
      setTxt("#saModeratorName", r.moderator_name || "—");

      // Description support
      const desc = (r.description ?? r.org_description ?? r.org_desc ?? "").toString().trim() || "—";
      setTxt("#saOrgDescription", desc);
      setTxt("#saOrgDescriptionLong", desc);

      setTxt("#saOrgMission", r.mission || "—");
      setTxt("#saOrgVision", r.vision || "—");
      setTxt("#saOrgObjectives", r.objectives || "—");
      setTxt("#saOrgAdvocacy", r.advocacy || "—");

      const hid = rqs("#saViewRequestId");
      if (hid) hid.value = String(r.id || requestId);

      // logo
      const img = rqs("#saOrgLogoImg");
      const fb = rqs("#saOrgLogoFallback");
      const logoUrl = r.logo_url || "";
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

      // officers
      const offTbody = rqs("#saOfficersTbody");
      const officers = Array.isArray(data?.officers) ? data.officers : [];
      if (offTbody) {
        if (!officers.length) {
          offTbody.innerHTML = `<tr><td colspan="4" class="text-center text-muted py-4">No officer records.</td></tr>`;
        } else {
          offTbody.innerHTML = officers
            .map((o) => {
              const pos = A.escapeHtml(o.position || "—");
              const name = A.escapeHtml(o.name || o.full_name || "—");
              const cy = A.escapeHtml(o.course_year || "—");
              const st = A.escapeHtml(o.status || "—");
              return `<tr>
                <td class="sa-wrap">${pos}</td>
                <td class="sa-wrap">${name}</td>
                <td class="sa-wrap">${cy}</td>
                <td><span class="badge text-bg-secondary">${st}</span></td>
              </tr>`;
            })
            .join("");
        }
      }

      // docs + pagination
      renderDocsActive(A, data?.docs, requestId);

      // Handle buttons for Active state
      const assignBtn = rqs("#saAssignModeratorBtn");
      const recBtn = rqs("#saOpenRecommendationBtn");
      const submitRecBtn = rqs("#saSubmitRecommendationBtn");
      
      // Hide assign moderator button for active requests (moderator already assigned)
      if (assignBtn) {
        assignBtn.style.display = "none";
      }
      
      // ✅ DISABLE RECOMMENDATION BUTTONS FOR ACTIVE REQUESTS
      if (recBtn) {
        recBtn.disabled = true;
        recBtn.classList.add("disabled");
        recBtn.setAttribute("title", "Cannot submit recommendation: Request is already active");
        
        // Override click handler to show error message
        if (!recBtn.__saOriginalClick) {
          recBtn.__saOriginalClick = recBtn.onclick;
        }
        recBtn.onclick = (e) => {
          e.preventDefault();
          A.safeShowError("Cannot submit recommendation: This accreditation request is already active.");
          return false;
        };
      }
      
      if (submitRecBtn) {
        submitRecBtn.disabled = true;
        submitRecBtn.classList.add("disabled");
        submitRecBtn.setAttribute("title", "Cannot submit recommendation: Request is already active");
      }
      
      // Add status indicator
      const buttonContainer = modalEl.querySelector(".ms-auto.d-flex.flex-wrap.gap-2");
      if (buttonContainer) {
        const existing = buttonContainer.querySelector("[data-sa-active-status='1']");
        if (existing) existing.remove();
        
        const statusDiv = document.createElement("div");
        statusDiv.setAttribute("data-sa-active-status", "1");
        statusDiv.className = "d-flex align-items-center gap-2";
        statusDiv.innerHTML = `
          <span class="badge text-bg-success">Active Accreditation</span>
        `;
        buttonContainer.appendChild(statusDiv);
      }
      
    } catch (e) {
      console.error("[Active] Error in openViewModalActive:", e);
      A.safeShowError(e.message || "Failed to load request.");
    }
  }

  // In the renderDocsActive function, update to hide accept/return buttons:
  function renderDocsActive(A, docsBlock, requestId) {
    const rqs = A.rqs || A.qs;

    const tbody = rqs("#saDocsTbody");
    const meta = rqs("#saDocsMeta");
    const pagMeta = rqs("#saDocsPaginationMeta");
    const pag = rqs("#saDocsPagination");
    if (!tbody) return;

    const docs = docsBlock?.items || [];
    const page = Number(docsBlock?.page || 1);
    const perPage = Number(docsBlock?.per_page || 10);
    const total = Number(docsBlock?.total || 0);

    if (meta) meta.textContent = total ? `${total} document(s).` : "";

    if (!docs.length) {
      tbody.innerHTML = `<tr><td colspan="6" class="text-center text-muted py-4">No documents found.</td></tr>`;
    } else {
      tbody.innerHTML = docs
        .map((d) => {
          const req = A.escapeHtml(d.requirement_name || "—");
          const file = A.escapeHtml(d.file_name || "—");
          const st = A.escapeHtml(d.status || "—");
          const reason = A.escapeHtml(d.return_reason || "—");
          const url = d.file_url || "#";
          const docId = A.escapeHtml(d.id);

          // ✅ For active requests, show ONLY preview button (no accept/return)
          const actionsHtml = `
            <div class="btn-group btn-group-sm">
              <button class="btn btn-outline-secondary btn-sm" type="button"
                      data-action="preview-doc" 
                      data-url="${A.escapeHtml(url)}" 
                      data-name="${A.escapeHtml(file)}" 
                      data-doc-id="${docId}"
                      title="Preview">
                <i class="bi bi-eye"></i>
              </button>
            </div>
          `;

          return `<tr data-doc-id="${docId}">
            <td></td>
            <td class="sa-wrap">${req}</td>
            <td class="sa-wrap">${file}</td>
            <td>${statusBadge(st)}</td>
            <td class="sa-wrap">${reason}</td>
            <td class="text-end sa-actions">${actionsHtml}</td>
          </tr>`;
        })
        .join("");
        
      // Hide bulk actions toolbar for active requests
      setTimeout(() => {
        const toolbar = rqs("#saBulkActionsToolbar");
        if (toolbar) toolbar.style.display = "none";
      }, 100);
    }

    A.renderPagination(pag, pagMeta, page, perPage, total, (newPage) => {
      if (!window.__saDocPages) window.__saDocPages = {};
      window.__saDocPages[requestId] = newPage;
      openViewModalActive(A, requestId);
    });
  }

  // Update the preview-doc handler in bindDocActionsActive:
  function bindDocActionsActive(A, root) {
    const r = root || A.store._root || document;
    const modalEl = A.qs("#saViewRequestModal", r) || A.qs("#saViewRequestModal");
    if (!modalEl || modalEl.__saDocActionsBoundActive) return;
    modalEl.__saDocActionsBoundActive = true;
    
    modalEl.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-action]");
      if (!btn) return;
      if (btn.disabled) return;
      
      const action = btn.getAttribute("data-action");
      
      if (action === "preview-doc") {
        const url = btn.getAttribute("data-url");
        const name = btn.getAttribute("data-name");
        const docId = btn.getAttribute("data-doc-id");
        
        console.log("[Active] Preview doc:", { url, name, docId });
        
        const requestId = A.rqs("#saViewRequestId")?.value;
        
        if (url && docId) {
          // For active requests, pass "Active" status to keep preview buttons disabled
          A.openPreview(url, name || "", docId, "Active", requestId);
        } else {
          console.error("[Active] Missing url or docId for preview");
          if (!docId) {
            A.safeShowError("Cannot preview: Missing document ID");
          }
          if (!url) {
            A.safeShowError("Cannot preview: Missing file URL");
          }
        }
        return;
      }
    });
  }

  function bindActive(A, root) {
    const r = root || A.store._root || document;
    const tbody = (A.qs && A.qs("#saActiveTbody", r)) || (A.rqs && A.rqs("#saActiveTbody"));

    if (tbody && !tbody.__saActiveBound) {
      tbody.__saActiveBound = true;

      tbody.addEventListener("click", (e) => {
        const btn = e.target.closest("[data-action='view']");
        if (!btn) return;

        const tr = btn.closest("tr");
        const id = tr?.getAttribute("data-id");
        if (!id) return;

        // Open view modal with active-specific handling
        openViewModalActive(A, id);
      });
    }
    
    // Bind document actions in the modal (preview only)
    bindDocActionsActive(A, r);
  }

  function init(root) {
    const A = mustBase();
    const r = root || document;

    // Always re-bind DOM listeners (bind helpers guard per-element)
    bindActive(A, r);

    // Always fetch fresh data on init / re-navigation
    fetchActive(A).catch((e) => A.safeShowError(e.message));

    // Register bus listeners only once per module load
    if (!window.__saActiveBusListening) {
      window.__saActiveBusListening = true;

      A.bus.on("search:changed", () => {
        A.store.active.page = 1;
        fetchActive(A).catch((e) => A.safeShowError(e.message));
      });

      A.bus.on("refresh:all", () => {
        fetchActive(A).catch((e) => A.safeShowError(e.message));
      });

      A.bus.on("filters:changed", (p) => {
        if (!p || p.scope !== "active") return;
        A.store.active.page = 1;
        fetchActive(A).catch((e) => A.safeShowError(e.message));
      });

      A.bus.on("terms:loaded", () => {
        A.store.active.page = 1;
        fetchActive(A).catch((e) => A.safeShowError(e.message));
      });
    }
  }

  // Support both ways:
  // - Base calls window.SAAccreditationActive.init(root)
  // - Active module loaded first and waits for booted
  try {
    const A = window.SAAccreditation;

    if (A?.bus) {
      A.bus.on("booted", (p) => init(p?.root || A.store?._root || document));
    }
  } catch (e) {
    // ignore
  }

  // Public export
  window.SAAccreditationActive = { init };
})();