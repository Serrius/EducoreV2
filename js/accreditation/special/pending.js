/* js/accreditation/special/pending.js */
/* global bootstrap */

(function () {
  "use strict";

  // prevent double-loading the script file itself
  if (window.__saPendingBooted) return;
  window.__saPendingBooted = true;

  function mustBase() {
    if (!window.SAAccreditation) throw new Error("Base module not loaded (SAAccreditation).");
    return window.SAAccreditation;
  }

  // -------------------------
  // UI helpers
  // -------------------------
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
      Submitted: "info",
      Accepted: "success",
    };
    const cls = map[s] || "secondary";
    return `<span class="badge text-bg-${cls}">${s || "—"}</span>`;
  }

  function scopeBadge(scope) {
    const s = String(scope || "—");
    const map = {
      General: "info",
      Exclusive: "dark",
      Clubs: "warning",
      All: "primary",
      Both: "primary",
    };
    const cls = map[s] || "secondary";
    const label = s === "Both" ? "All" : s;
    return `<span class="badge text-bg-${cls}">${label}</span>`;
  }

  function renderRow(A, r) {
    const id = A.escapeHtml(r.id);
    const org = A.escapeHtml(r.org_name || r.organization || "—");
    const scope = A.escapeHtml(r.scope || "—");
    const program = A.escapeHtml(r.program || "—");
    const term = A.escapeHtml(r.term_label || r.term || "—");
    const coord = A.escapeHtml(r.coordinator_name || "—");
    const mod = A.escapeHtml(r.moderator_name || "—");
    const status = r.status || "—";

    return `
      <tr data-id="${id}">
        <td class="text-muted">${id}</td>
        <td class="sa-wrap">
          <div class="fw-semibold">${org}</div>
          <div class="text-muted small">${A.escapeHtml(r.org_abbr || "")}</div>
        </td>
        <td>${scopeBadge(scope)}</td>
        <td>${program}</td>
        <td class="sa-wrap">${term}</td>
        <td class="sa-wrap">${coord}</td>
        <td class="sa-wrap">${mod}</td>
        <td>${badge(status)}</td>
        <td class="text-end sa-actions">
          <button class="btn btn-outline-secondary btn-sm" type="button" data-action="view" title="View">
            <i class="bi bi-eye"></i>
          </button>
        </td>
      </tr>
    `;
  }

  // -------------------------
  // Helper function to check if all documents are accepted
  // -------------------------
  function areAllDocumentsAccepted(docs) {
    if (!Array.isArray(docs) || docs.length === 0) return false;
    
    // Check if ALL documents have status 'Accepted'
    return docs.every(doc => doc.status === 'Accepted');
  }

  // -------------------------
  // Data: list pending - UPDATED (year-only)
  // -------------------------
  async function fetchPending(A) {
    console.log("[Pending] Starting fetchPending...");
    
    const { store } = A;
    const p = store.pending;

    // Get current filter values from store (updated by base module)
    const yearVal = p.year || "";

    console.log("[Pending] Store state:", {
      search: store.search,
      status: p.status,
      year: yearVal,
      termId: p.termId,
      page: p.page,
      perPage: p.perPage
    });

    const payload = {
      action: "list_requests",
      mode: "pending",
      q: store.search || "",
      status: p.status || "Pending",
      school_year: yearVal,
      term_id: p.termId || "",
      page: p.page,
      per_page: p.perPage,
    };

    console.log("[Pending] Sending payload:", payload);

    try {
      const data = await A.postJSON(payload);
      console.log("[Pending] Received response:", data);

      p.items = Array.isArray(data?.items) ? data.items : [];
      p.page = Number(data?.page || p.page || 1);
      p.perPage = Number(data?.per_page || p.perPage || 10);
      p.total = Number(data?.total || 0);

      // Update badge counts if provided
      if (data?.counts) {
        const c = data.counts;
        const pendingCount = (A.rqs || A.qs)("#saPendingCount");
        const activeCount = (A.rqs || A.qs)("#saActiveCount");
        const recommendedCount = (A.rqs || A.qs)("#saRecommendedCount"); // ✅ NEW
        
        if (pendingCount && c.pending != null) {
          pendingCount.textContent = String(c.pending);
          pendingCount.classList.toggle('d-none', c.pending === 0);
        }
        if (activeCount && c.active != null) {
          activeCount.textContent = String(c.active);
          activeCount.classList.toggle('d-none', c.active === 0);
        }
        if (recommendedCount && c.recommended != null) { // ✅ NEW
          recommendedCount.textContent = String(c.recommended);
          recommendedCount.classList.toggle('d-none', c.recommended === 0);
        }
      }

      renderPending(A);
    } catch (error) {
      console.error("[Pending] Error in fetchPending:", error);
      A.safeShowError(error.message || "Failed to load pending requests.");
    }
  }

  function renderPending(A) {
    const { store } = A;
    const p = store.pending;

    const tbody = (A.rqs || A.qs)("#saPendingTbody");
    const meta = (A.rqs || A.qs)("#saPendingMeta");
    const pagMeta = (A.rqs || A.qs)("#saPendingPaginationMeta");
    const pag = (A.rqs || A.qs)("#saPendingPagination");

    if (meta) meta.innerHTML = `Showing <span class="fw-semibold">${p.total || 0}</span> pending requests.`;

    if (!tbody) {
      console.error("[Pending] Could not find #saPendingTbody");
      return;
    }

    if (!p.items.length) {
      console.log("[Pending] No items to display");
      tbody.innerHTML = `
        <tr>
          <td colspan="9" class="text-center text-muted py-5">
            <div class="mb-2"><i class="bi bi-hourglass-split fs-2"></i></div>
            No requests found.
          </td>
        </tr>`;
    } else {
      console.log(`[Pending] Rendering ${p.items.length} items`);
      tbody.innerHTML = p.items.map((r) => renderRow(A, r)).join("");
    }

    A.renderPagination(pag, pagMeta, p.page, p.perPage, p.total, (newPage) => {
      store.pending.page = newPage;
      fetchPending(A).catch((e) => A.safeShowError(e.message));
    });
  }

  // -------------------------
  // View modal (shared with Active via bus)
  // -------------------------
  async function openViewModal(A, requestId) {
    console.log("[Pending] Opening view modal for request:", requestId);
    
    const rqs = A.rqs || A.qs;

    const modalEl = rqs("#saViewRequestModal");
    if (!modalEl || !window.bootstrap) {
      console.error("[Pending] Modal not found or bootstrap not loaded");
      return;
    }

    // reset
    const setTxt = (sel, v) => {
      const el = rqs(sel);
      if (el) el.textContent = v;
    };

    setTxt("#saViewReqSub", "Loading…");

    // Wire buttons immediately — BEFORE the async API call — so onclick is
    // always set regardless of whether the request succeeds or fails.
    // Use document.querySelector since these buttons are inside the modal which
    // is at body level, potentially outside the injected root that A.rqs searches.
    const dqs = (sel) => document.querySelector(sel);

    const assignBtn = dqs("#saAssignModeratorBtn");
    if (assignBtn) {
      assignBtn.dataset.requestId = requestId;
      assignBtn.onclick = () => openAssignModerator(A, requestId);
    }

    const editAssignBtn = dqs("#saEditAssignmentBtn");
    if (editAssignBtn) {
      editAssignBtn.dataset.requestId = requestId;
      editAssignBtn.onclick = () => openEditAssignment(A, requestId);
    }

    const recBtn = dqs("#saOpenRecommendationBtn");
    if (recBtn) {
      recBtn.dataset.requestId = requestId;
      recBtn.onclick = () => openRecommendation(A, requestId);
    }

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
      renderDocs(A, data?.docs, requestId);

      // ✅ FIX: Setup bulk actions after modal is fully rendered
      setTimeout(() => {
        A.setupBulkActions();
      }, 200);

      // Check if all documents are accepted to enable recommendation button
      const docs = data?.docs?.items || [];
      const allAccepted = areAllDocumentsAccepted(docs);
      
      // Update onclick to use resolved r.id now that we have it
      if (assignBtn)     assignBtn.onclick     = () => openAssignModerator(A, r.id || requestId);
      if (editAssignBtn) editAssignBtn.onclick  = () => openEditAssignment(A, r.id || requestId);

      // Recommendation button — enable/disable based on document acceptance state
      const submitRecBtn = dqs("#saSubmitRecommendationBtn");
      const recBtnEl = dqs("#saOpenRecommendationBtn");

      if (recBtnEl) {
        recBtnEl.dataset.requestId = requestId;
        if (allAccepted) {
          recBtnEl.disabled = false;
          recBtnEl.title = "Open recommendation form";
          recBtnEl.classList.remove('disabled');
          recBtnEl.onclick = () => openRecommendation(A, r.id || requestId);
        } else {
          recBtnEl.disabled = true;
          recBtnEl.title = "Cannot open recommendation form: Not all requirements are accepted";
          recBtnEl.classList.add('disabled');
          recBtnEl.onclick = (e) => {
            e.preventDefault();
            A.safeShowError("Cannot open recommendation form: Not all requirements are accepted. Please accept all documents first.");
            return false;
          };
        }
      }

      if (submitRecBtn) {
        submitRecBtn.dataset.requestId = requestId;
        if (allAccepted) {
          submitRecBtn.disabled = false;
          submitRecBtn.title = "Submit recommendation for this request";
          submitRecBtn.classList.remove('disabled');
        } else {
          submitRecBtn.disabled = true;
          submitRecBtn.title = "Cannot submit recommendation: Not all requirements are accepted";
          submitRecBtn.classList.add('disabled');
        }
      }

      // Also update the recommendation button in the modal footer
      const modalFooterRecBtn = modalEl.querySelector('[data-action="recommend"]');
      if (modalFooterRecBtn) {
        modalFooterRecBtn.dataset.requestId = requestId;
        if (allAccepted) {
          modalFooterRecBtn.disabled = false;
          modalFooterRecBtn.classList.remove('disabled');
        } else {
          modalFooterRecBtn.disabled = true;
          modalFooterRecBtn.classList.add('disabled');
        }
      }
      
    } catch (e) {
      console.error("[Pending] Error in openViewModal:", e);
      A.safeShowError(e.message || "Failed to load request.");
    }
  }

  function renderDocs(A, docsBlock, requestId) {
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
          const isAccepted = st === 'Accepted';
          const isReturned = st === 'Returned';

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
              ${!isAccepted ? `
                <button class="btn ${isAccepted || isReturned ? 'btn-disabled-review' : 'btn-outline-success'} btn-sm" type="button"
                        data-action="accept-doc" 
                        data-doc-id="${docId}" 
                        data-file-name="${A.escapeHtml(file)}" 
                        title="${isAccepted ? 'Already accepted' : 'Accept'}" 
                        ${isAccepted || isReturned ? 'disabled' : ''}>
                  <i class="bi bi-check-circle"></i>
                </button>
              ` : ''}
              <button class="btn ${isReturned ? 'btn-disabled-review' : 'btn-outline-warning'} btn-sm" type="button"
                      data-action="return-doc" 
                      data-doc-id="${docId}" 
                      data-file-name="${A.escapeHtml(file)}" 
                      title="${isReturned ? 'Already returned' : 'Return'}" 
                      ${isReturned ? 'disabled' : ''}>
                <i class="bi ${isReturned ? 'bi-arrow-counterclockwise' : 'bi-x-circle'}"></i>
              </button>
            </div>
          `;

          return `<tr data-doc-id="${docId}">
            <td><!-- Checkbox will be added here by setupDocumentCheckboxes --></td>
            <td class="sa-wrap">${req}</td>
            <td class="sa-wrap">${file}</td>
            <td>${badge(st)}</td>
            <td class="sa-wrap">${reason}</td>
            <td class="text-end sa-actions">${actionsHtml}</td>
          </tr>`;
        })
        .join("");
      
      // ✅ FIX: Initialize checkboxes after rendering
      setTimeout(() => {
        A.setupDocumentCheckboxes();
      }, 100);
    }

    A.renderPagination(pag, pagMeta, page, perPage, total, (newPage) => {
      if (!window.__saDocPages) window.__saDocPages = {};
      window.__saDocPages[requestId] = newPage;
      openViewModal(A, requestId);
    });
  }

  // -------------------------
  // Assign Moderator
  // -------------------------
  async function openAssignModerator(A, requestId) {
    const rqs = A.rqs || A.qs;

    const modalEl = rqs("#saAssignModeratorModal");
    if (!modalEl || !window.bootstrap) return;

    const hid = rqs("#saAssignRequestId");
    if (hid) hid.value = String(requestId);

    const sel = rqs("#saModeratorSelect");
    if (sel) {
      sel.innerHTML = `<option value="" selected disabled>Loading...</option>`;
      try {
        const data = await A.postJSON({ action: "list_moderators" });
        const mods = Array.isArray(data?.items) ? data.items : [];
        sel.innerHTML = `<option value="" selected disabled>Choose a moderator...</option>`;
        for (const m of mods) {
          const opt = document.createElement("option");
          opt.value = String(m.id);
          opt.textContent = m.name || `User #${m.id}`;
          sel.appendChild(opt);
        }
      } catch (e) {
        sel.innerHTML = `<option value="" selected disabled>Failed to load</option>`;
        A.safeShowError(e.message);
      }
    }

    // submit handler (bind once)
    const form = rqs("#saAssignModeratorForm");
    if (form && !form.__saBound) {
      form.__saBound = true;
      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        const rid = rqs("#saAssignRequestId")?.value;
        const mid = rqs("#saModeratorSelect")?.value;
        if (!rid || !mid) return;

        try {
          await A.postJSON({ action: "assign_moderator", request_id: rid, moderator_id: mid });
          bootstrap.Modal.getOrCreateInstance(modalEl).hide();
          A.safeShowSuccess("Moderator assigned.");

          // refresh lists
          A.bus.emit("refresh:all");

          // refresh view modal details
          openViewModal(A, rid);
        } catch (err) {
          A.safeShowError(err.message);
        }
      });
    }

    bootstrap.Modal.getOrCreateInstance(modalEl).show();
  }

  // -------------------------
  // Edit Moderator & Coordinator (super admin only)
  // -------------------------
  async function openEditAssignment(A, requestId) {
    const rqs = A.rqs || A.qs;

    const modalEl = rqs("#saEditAssignmentModal");
    if (!modalEl || !window.bootstrap) return;

    const hid = rqs("#saEditAssignRequestId");
    if (hid) hid.value = String(requestId);

    // Load coordinator list and moderator (org_president) list
    const modSel  = rqs("#saEditModeratorSelect");
    const coordSel = rqs("#saEditCoordinatorSelect");

    // Fetch current request data to pre-select
    let currentModId = "";
    let currentCoordId = "";
    try {
      const req = await A.postJSON({ action: "get_request", request_id: requestId });
      currentModId   = String(req?.request?.moderator_user_id   || req?.request?.moderator_id   || "");
      currentCoordId = String(req?.request?.coordinator_user_id || req?.request?.coordinator_id || "");
    } catch (e) { /* non-fatal */ }

    // Populate moderator select (org_president users)
    if (modSel) {
      modSel.innerHTML = `<option value="">Loading...</option>`;
      try {
        const data = await A.postJSON({ action: "list_org_presidents" });
        const items = Array.isArray(data?.items) ? data.items : [];
        modSel.innerHTML = `<option value="">— Keep current —</option>`;
        for (const m of items) {
          const opt = document.createElement("option");
          opt.value = String(m.id);
          opt.textContent = m.name || m.full_name || `User #${m.id}`;
          if (String(m.id) === currentModId) opt.selected = true;
          modSel.appendChild(opt);
        }
      } catch (e) {
        modSel.innerHTML = `<option value="">Failed to load</option>`;
      }
    }

    // Populate coordinator select (faculty_admin users)
    if (coordSel) {
      coordSel.innerHTML = `<option value="">Loading...</option>`;
      try {
        const data = await A.postJSON({ action: "list_coordinators" });
        const items = Array.isArray(data?.items) ? data.items : [];
        coordSel.innerHTML = `<option value="">— Keep current —</option>`;
        for (const m of items) {
          const opt = document.createElement("option");
          opt.value = String(m.id);
          opt.textContent = m.name || m.full_name || `User #${m.id}`;
          if (String(m.id) === currentCoordId) opt.selected = true;
          coordSel.appendChild(opt);
        }
      } catch (e) {
        coordSel.innerHTML = `<option value="">Failed to load</option>`;
      }
    }

    // Bind form (once per modal element)
    const form = rqs("#saEditAssignmentForm");
    if (form && !form.__saEditAssignBound) {
      form.__saEditAssignBound = true;
      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        const rid   = rqs("#saEditAssignRequestId")?.value;
        const mid   = rqs("#saEditModeratorSelect")?.value   || "";
        const cid   = rqs("#saEditCoordinatorSelect")?.value || "";

        if (!rid) return;
        if (!mid && !cid) {
          A.safeShowError("Please select at least a new moderator or coordinator.");
          return;
        }

        try {
          await A.postJSON({
            action:     "update_assignment",
            request_id: rid,
            moderator_id:   mid   || null,
            coordinator_id: cid   || null,
          });

          bootstrap.Modal.getOrCreateInstance(modalEl).hide();
          A.safeShowSuccess("Assignment updated successfully.");
          A.bus.emit("refresh:all");

          // Refresh the view modal if it's still open
          const viewEl = rqs("#saViewRequestModal");
          if (viewEl && viewEl.classList.contains("show")) {
            openViewModal(A, rid);
          }
        } catch (err) {
          A.safeShowError(err.message || "Failed to update assignment.");
        }
      });
    }

    bootstrap.Modal.getOrCreateInstance(modalEl).show();
  }

  // -------------------------
  // Recommendation (Generate PDF - NO UPLOAD)
  // -------------------------
  function openRecommendation(A, requestId) {
  const rqs = A.rqs || A.qs;

  const modalEl = rqs("#saRecommendationModal");
  if (!modalEl || !window.bootstrap) return;

  const hid = rqs("#saRecRequestId");
  if (hid) hid.value = String(requestId);

  // Optional: hide/disable file input if it still exists in the modal
  const fileInput = rqs("#saRecFile");
  if (fileInput) {
    const wrap = fileInput.closest(".mb-3") || fileInput.closest(".form-group") || fileInput.parentElement;
    if (wrap) wrap.style.display = "none";
    fileInput.disabled = true;
  }

  const form = rqs("#saRecommendationForm");
  if (form && !form.__saBound) {
    form.__saBound = true;

    form.addEventListener("submit", async (e) => {
      e.preventDefault();

      const rid = rqs("#saRecRequestId")?.value;
      const notes = rqs("#saRecNotes")?.value || "";
      if (!rid) return;

      try {
        // ✅ Server generates PDF now (no file upload)
        const data = await A.postJSON({
          action: "submit_recommendation",
          request_id: rid,
          notes: notes,
        });

        if (!data?.ok) throw new Error(data?.error || "Failed to generate recommendation PDF.");

        // ✅ Grab URL first
        const pdfUrl =
          data.recommendation_url ||
          data.recommendationUrl ||
          data.pdf_url ||
          data.url ||
          "";

        // ✅ Close VIEW modal FIRST (behind the recommendation modal)
        const viewEl = rqs("#saViewRequestModal");
        if (viewEl) {
          const viewInst = bootstrap.Modal.getInstance(viewEl);
          if (viewInst) viewInst.hide();
        }

        // ✅ Close this modal + reset form
        bootstrap.Modal.getOrCreateInstance(modalEl).hide();
        form.reset();

        // ✅ Now trigger success UI AFTER modals start closing
        // (tiny delay lets bootstrap remove backdrops cleanly)
        setTimeout(() => {
          A.safeShowSuccess("Recommendation PDF generated and submitted.");
          A.bus.emit("refresh:all");
          if (pdfUrl) window.open(pdfUrl, "_blank", "noopener");
        }, 150);
      } catch (err) {
        A.safeShowError(err?.message || "Failed to generate recommendation PDF.");
      }
    });
  }

  bootstrap.Modal.getOrCreateInstance(modalEl).show();
  }

  // -------------------------
  // Accept Document Modal
  // -------------------------
  function openAcceptDocumentModal(A, docId, fileName) {
    console.log("[Pending] Opening accept modal for:", { docId, fileName });
    
    const rqs = A.rqs || A.qs;
    const modalEl = rqs("#saAcceptDocumentModal");
    if (!modalEl || !window.bootstrap) return;

    const hid = rqs("#saAcceptDocId");
    if (hid) hid.value = String(docId);

    const nameEl = rqs("#saAcceptDocName");
    if (nameEl) nameEl.textContent = fileName || "Document";

    // Remove any existing bound handlers
    const confirmBtn = rqs("#saAcceptDocConfirmBtn");
    if (confirmBtn) {
      // Clone and replace to remove old listeners
      const newConfirmBtn = confirmBtn.cloneNode(true);
      confirmBtn.parentNode.replaceChild(newConfirmBtn, confirmBtn);
      
      newConfirmBtn.addEventListener("click", async () => {
        try {
          await A.postJSON({
            action: 'review_document',
            doc_id: docId,
            decision: 'accept'
          });
          
          bootstrap.Modal.getOrCreateInstance(modalEl).hide();
          A.safeShowSuccess(`Document "${fileName}" accepted.`);
          
          const requestId = rqs("#saViewRequestId")?.value;
          if (requestId) {
            setTimeout(() => {
              openViewModal(A, requestId);
            }, 500);
          }
          A.bus.emit("refresh:all");
        } catch (e) {
          A.safeShowError(e.message || 'Failed to accept document.');
        }
      });
    }

    bootstrap.Modal.getOrCreateInstance(modalEl).show();
  }
  // -------------------------
  // Return Document Modal
  // -------------------------
  function openReturnDocumentModal(A, docId, fileName) {
    console.log("[Pending] Opening return modal for:", { docId, fileName });
    
    const rqs = A.rqs || A.qs;
    const modalEl = rqs("#saReturnReasonModal");
    if (!modalEl || !window.bootstrap) return;

    const hid = rqs("#saReturnDocId");
    if (hid) hid.value = String(docId);

    const label = rqs("#saReturnDocLabel");
    if (label) label.textContent = fileName || `Document #${docId}`;

    const reasonEl = rqs("#saReturnReasonText");
    if (reasonEl) reasonEl.value = "";

    // Remove any existing bound handlers by cloning
    const form = rqs("#saReturnReasonForm");
    if (form) {
      const newForm = form.cloneNode(true);
      form.parentNode.replaceChild(newForm, form);
      
      newForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        const id = rqs("#saReturnDocId")?.value;
        const reason = rqs("#saReturnReasonText")?.value?.trim();
        if (!id || !reason) return;

        try {
          await A.postJSON({
            action: 'return_document',
            doc_id: id,
            reason: reason
          });
          
          bootstrap.Modal.getOrCreateInstance(modalEl).hide();
          A.safeShowSuccess(`Document "${fileName}" returned.`);
          
          const requestId = rqs("#saViewRequestId")?.value;
          if (requestId) {
            setTimeout(() => {
              openViewModal(A, requestId);
            }, 500);
          }
          A.bus.emit("refresh:all");
        } catch (err) {
          A.safeShowError(err.message);
        }
      });
    }

    bootstrap.Modal.getOrCreateInstance(modalEl).show();
  }

  // -------------------------
  // Doc actions inside view modal
  // -------------------------
  function bindDocActions(A, root) {
  const r = root || A.store._root || document;
  const modalEl = A.qs("#saViewRequestModal", r);
  if (!modalEl || modalEl.__saDocActionsBound) return;
  modalEl.__saDocActionsBound = true;

  modalEl.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-action]");
    if (!btn) return;

    // Skip if button is disabled
    if (btn.disabled) return;

    const action = btn.getAttribute("data-action");
    const docId = btn.getAttribute("data-doc-id");
    const fileName = btn.getAttribute("data-file-name");
    
    // In bindDocActions function in pending.js
    if (action === "preview-doc") {
      // Get attributes directly from the button
      const url = btn.getAttribute("data-url");
      const name = btn.getAttribute("data-name");
      const docId = btn.getAttribute("data-doc-id"); // This should now have a value
      
      console.log("[Pending] Preview button clicked - raw attributes:", {
        url: url,
        name: name,
        docId: docId,
        allAttributes: btn.attributes
      });
      
      if (!docId) {
        console.error("[Pending] No docId found on preview button");
        A.safeShowError("Cannot preview: Missing document ID");
        return;
      }
      
      // Get document status more reliably
      const row = btn.closest('tr');
      let docStatus = '';
      
      if (row) {
        // Try multiple ways to get status
        const statusBadge = row.querySelector('.badge');
        if (statusBadge) {
          docStatus = statusBadge.textContent.trim();
        } else {
          const statusCell = row.querySelector('td:nth-child(4)');
          if (statusCell) {
            docStatus = statusCell.textContent.trim();
          }
        }
      }
      
      // Get request ID
      const requestId = A.rqs("#saViewRequestId")?.value;
      
      console.log("[Pending] Preview doc - final data:", { 
        url, 
        name, 
        docId, 
        docStatus, 
        requestId 
      });
      
      if (url) {
        // Use the base module's openPreview function
        A.openPreview(url, name || "", docId, docStatus, requestId);
      } else {
        A.safeShowError("Cannot preview: Missing file URL");
      }
      return;
    }

    if (action === "accept-doc" && docId && fileName) {
      openAcceptDocumentModal(A, docId, fileName);
      return;
    }

    if (action === "return-doc" && docId && fileName) {
      openReturnDocumentModal(A, docId, fileName);
    }
  });
  
  // Listen for document review events to refresh the view
  A.bus.on('documents:reviewed', () => {
    const requestId = A.rqs("#saViewRequestId")?.value;
    if (requestId) {
      // Refresh the view modal to update document status and button states
      setTimeout(() => {
        openViewModal(A, requestId);
      }, 500);
    }
  });
  
  // Listen for bulk review events
  A.bus.on('documents:bulk-reviewed', () => {
    const requestId = A.rqs("#saViewRequestId")?.value;
    if (requestId) {
      // Refresh the view modal to update document status and button states
      setTimeout(() => {
        openViewModal(A, requestId);
      }, 500);
    }
  });
  }

  // -------------------------
  // Bind pending tab controls - UPDATED (removed semester filter)
  // -------------------------
  function bindPending(A, root) {
    const r = root || A.store._root || document;

    const statusSel = A.qs("#saPendingStatusFilter", r);
    const yearSel = A.qs("#saPendingYearFilter", r);
    // ✅ REMOVED: semester filter

    if (statusSel && !statusSel.__saBound) {
      statusSel.__saBound = true;
      statusSel.addEventListener("change", () => {
        A.store.pending.status = statusSel.value || "Pending";
        A.store.pending.page = 1;
        console.log("[Pending] Status filter changed to:", A.store.pending.status);
        fetchPending(A).catch((e) => A.safeShowError(e.message));
      });
    }

    if (yearSel && !yearSel.__saBound) {
      yearSel.__saBound = true;
      yearSel.addEventListener("change", () => {
        // The base module handles storing year value, just trigger refresh
        A.store.pending.page = 1;
        console.log("[Pending] Year filter changed to:", yearSel.value);
        fetchPending(A).catch((e) => A.safeShowError(e.message));
      });
    }

    // ✅ REMOVED: semester filter binding

    // delegation for view
    const tbody = A.qs("#saPendingTbody", r);
    if (tbody && !tbody.__saBound) {
      tbody.__saBound = true;
      tbody.addEventListener("click", (e) => {
        const btn = e.target.closest("[data-action='view']");
        if (!btn) return;
        const tr = btn.closest("tr");
        const id = tr?.getAttribute("data-id");
        if (id) openViewModal(A, id);
      });
    }

    bindDocActions(A, r);

    if (!A.__saPendingBusBound) {
      A.__saPendingBusBound = true;
      A.bus.on("request:view", (p) => {
        const id = p?.request_id;
        if (id) openViewModal(A, id);
      });
    }
  }

  // -------------------------
  // init (called by base) - UPDATED
  // -------------------------
  function init(root) {
    console.log("[Pending] Initializing module...");
    const A = mustBase();
    const r = root || document;

    // Always re-bind DOM (bind helpers guard per-element, safe to call repeatedly)
    bindPending(A, r);

    // Always fetch fresh data on every init / re-navigation
    setTimeout(() => {
      console.log("[Pending] Performing initial fetch...");
      fetchPending(A).catch((e) => {
        console.error("[Pending] Initial fetch error:", e);
        A.safeShowError(e.message);
      });
    }, 100);

    // Register bus listeners only once per module load
    if (!window.__saPendingBusListening) {
      window.__saPendingBusListening = true;

      A.bus.on("search:changed", () => {
        A.store.pending.page = 1;
        fetchPending(A).catch((e) => A.safeShowError(e.message));
      });

      A.bus.on("refresh:all", () => {
        fetchPending(A).catch((e) => A.safeShowError(e.message));
      });

      A.bus.on("filters:changed", (payload) => {
        if (payload?.scope === "pending") {
          A.store.pending.page = 1;
          fetchPending(A).catch((e) => A.safeShowError(e.message));
        }
      });

      A.bus.on("terms:loaded", () => {
        A.store.pending.page = 1;
        fetchPending(A).catch((e) => A.safeShowError(e.message));
      });

      A.bus.on('modal:open-accept', (data) => {
        if (data && data.docId && data.fileName) openAcceptDocumentModal(A, data.docId, data.fileName);
      });

      A.bus.on('modal:open-return', (data) => {
        if (data && data.docId && data.fileName) openReturnDocumentModal(A, data.docId, data.fileName);
      });
    }
  }

  // Allow base to call: window.SAAccreditationPending.init(root)
  window.SAAccreditationPending = { 
    init,
    openViewModal,
    openAcceptDocumentModal,
    openReturnDocumentModal,
    openEditAssignment,
  };

  // If script loads before base calls submodule init, still listen for booted.
  try {
    const A = window.SAAccreditation;
    if (A?.bus) {
      console.log("[Pending] Listening for booted event...");
      A.bus.on("booted", (p) => init(p?.root || A.store?._root || document));
    }
  } catch (e) {
    console.error("[Pending] Error setting up booted listener:", e);
  }
})();
//openRecommendation