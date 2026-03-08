/* js/accreditation/special/recommended.js */
/* global bootstrap */

(function () {
  "use strict";

  // prevent double-loading the script file itself
  if (window.__saRecommendedBooted) return;
  window.__saRecommendedBooted = true;

  function mustBase() {
    if (!window.SAAccreditation) throw new Error("Base module not loaded (SAAccreditation).");
    return window.SAAccreditation;
  }

  // -------------------------
  // UI helpers (same as pending.js)
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

    // ✅ NEW: Description support (server can send: description OR org_description)
    const descRaw = r.description ?? r.org_description ?? r.org_desc ?? "";
    const desc = A.escapeHtml(String(descRaw || "").trim());

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
  // Data: list recommended requests
  // -------------------------
  async function fetchRecommended(A) {
    console.log("[Recommended] Starting fetchRecommended...");

    const { store } = A;
    const r = store.recommended;

    // Get current filter values from store
    const yearVal = r.year || "";

    console.log("[Recommended] Store state:", {
      search: store.search,
      year: yearVal,
      termId: r.termId,
      page: r.page,
      perPage: r.perPage,
    });

    const payload = {
      action: "list_requests",
      mode: "recommended",
      q: store.search || "",
      status: "Recommended",
      school_year: yearVal,
      term_id: r.termId || "",
      page: r.page,
      per_page: r.perPage,
    };

    console.log("[Recommended] Sending payload:", payload);

    try {
      const data = await A.postJSON(payload);
      console.log("[Recommended] Received response:", data);

      r.items = Array.isArray(data?.items) ? data.items : [];
      r.page = Number(data?.page || r.page || 1);
      r.perPage = Number(data?.per_page || r.perPage || 10);
      r.total = Number(data?.total || 0);

      // Update badge count if provided
      if (data?.counts) {
        const c = data.counts;
        const recommendedCount = (A.rqs || A.qs)("#saRecommendedCount");
        if (recommendedCount && c.recommended != null) {
          recommendedCount.textContent = String(c.recommended);
          recommendedCount.classList.toggle("d-none", c.recommended === 0);
        }
      }

      renderRecommended(A);
    } catch (error) {
      console.error("[Recommended] Error in fetchRecommended:", error);
      A.safeShowError(error.message || "Failed to load recommended requests.");
    }
  }

  function renderRecommended(A) {
    const { store } = A;
    const r = store.recommended;

    const tbody = (A.rqs || A.qs)("#saRecommendedTbody");
    const meta = (A.rqs || A.qs)("#saRecommendedMeta");
    const pagMeta = (A.rqs || A.qs)("#saRecommendedPaginationMeta");
    const pag = (A.rqs || A.qs)("#saRecommendedPagination");

    if (meta) meta.innerHTML = `Showing <span class="fw-semibold">${r.total || 0}</span> recommended requests.`;

    if (!tbody) {
      console.error("[Recommended] Could not find #saRecommendedTbody");
      return;
    }

    if (!r.items.length) {
      console.log("[Recommended] No items to display");
      tbody.innerHTML = `
        <tr>
          <td colspan="9" class="text-center text-muted py-5">
            <div class="mb-2"><i class="bi bi-check2-square fs-2"></i></div>
            No recommended requests found.
          </td>
        </tr>`;
    } else {
      console.log(`[Recommended] Rendering ${r.items.length} items`);
      tbody.innerHTML = r.items.map((item) => renderRow(A, item)).join("");
    }

    A.renderPagination(pag, pagMeta, r.page, r.perPage, r.total, (newPage) => {
      store.recommended.page = newPage;
      fetchRecommended(A).catch((e) => A.safeShowError(e.message));
    });
  }

  // -------------------------
  // Modal UI cleanup / restore
  // -------------------------
  function ensureModalRestoreHandler(A) {
    const rqs = A.rqs || A.qs;
    const modalEl = rqs("#saViewRequestModal");
    if (!modalEl || !window.bootstrap) return;

    if (modalEl.__saRecommendedRestoreBound) return;
    modalEl.__saRecommendedRestoreBound = true;

    modalEl.addEventListener("hidden.bs.modal", () => {
      const assignBtn = rqs("#saAssignModeratorBtn");
      const recBtn = rqs("#saOpenRecommendationBtn");
      const submitRecBtn = rqs("#saSubmitRecommendationBtn");

      if (assignBtn) {
        assignBtn.disabled = false;
        assignBtn.style.display = "";
        assignBtn.classList.remove("d-none");
      }

      if (recBtn) {
        recBtn.disabled = false;
        recBtn.style.display = "";
        recBtn.classList.remove("d-none");
        recBtn.classList.remove("disabled");
        recBtn.removeAttribute("title");
      }

      if (submitRecBtn) {
        submitRecBtn.disabled = false;
        submitRecBtn.style.display = "";
        submitRecBtn.classList.remove("d-none");
        submitRecBtn.classList.remove("disabled");
        submitRecBtn.removeAttribute("title");
      }

      const buttonContainer = modalEl.querySelector(".ms-auto.d-flex.flex-wrap.gap-2");
      if (buttonContainer) {
        const statusEl = buttonContainer.querySelector("[data-sa-rec-status='1']");
        if (statusEl) statusEl.remove();
      }

      const toolbar = rqs("#saBulkActionsToolbar");
      if (toolbar) toolbar.style.display = "";
    });
  }

  // -------------------------
  // Assign Moderator
  // -------------------------
  async function openAssignModeratorRecommended(A, requestId) {
    const rqs = A.rqs || A.qs;

    const modalEl =
      (A.rqs ? A.rqs("#saAssignModeratorModal") : null) ||
      (A.qs ? A.qs("#saAssignModeratorModal", A.store?._root || document) : null) ||
      (A.qs ? A.qs("#saAssignModeratorModal") : null);

    if (!modalEl || !window.bootstrap) return;

    const hid = rqs("#saAssignRequestId");
    if (hid) hid.value = String(requestId);

    bootstrap.Modal.getOrCreateInstance(modalEl).show();

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

    const form = rqs("#saAssignModeratorForm");
    if (form && !form.__saBoundRecommended) {
      form.__saBoundRecommended = true;
      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        const rid = rqs("#saAssignRequestId")?.value;
        const mid = rqs("#saModeratorSelect")?.value;
        if (!rid || !mid) return;

        try {
          await A.postJSON({ action: "assign_moderator", request_id: rid, moderator_id: mid });
          bootstrap.Modal.getOrCreateInstance(modalEl).hide();
          A.safeShowSuccess("Moderator assigned.");

          A.bus.emit("refresh:all");
          openViewModalRecommended(A, rid);
        } catch (err) {
          A.safeShowError(err.message);
        }
      });
    }
  }

  // -------------------------
  // View modal for recommended requests
  // -------------------------
  async function openViewModalRecommended(A, requestId) {
    console.log("[Recommended] Opening view modal for request:", requestId);

    ensureModalRestoreHandler(A);

    const rqs = A.rqs || A.qs;

    const modalEl =
      (A.rqs ? A.rqs("#saViewRequestModal") : null) ||
      (A.qs ? A.qs("#saViewRequestModal", A.store?._root || document) : null) ||
      (A.qs ? A.qs("#saViewRequestModal") : null);

    if (!modalEl || !window.bootstrap) {
      console.error("[Recommended] Modal not found or bootstrap not loaded");
      return;
    }

    const setTxt = (sel, v) => {
      const el = rqs(sel);
      if (el) el.textContent = v;
    };

    setTxt("#saViewReqSub", "Loading…");

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

      // ✅ NEW: Description in modal (supports multiple possible backend keys)
      const desc =
        (r.description ?? r.org_description ?? r.org_desc ?? "").toString().trim() || "—";
      setTxt("#saOrgDescription", desc);
      setTxt("#saOrgDescriptionLong", desc);

      setTxt("#saOrgMission", r.mission || "—");
      setTxt("#saOrgVision", r.vision || "—");
      setTxt("#saOrgObjectives", r.objectives || "—");
      setTxt("#saOrgAdvocacy", r.advocacy || "—");

      const hid = rqs("#saViewRequestId");
      if (hid) hid.value = String(r.id || requestId);

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

      renderDocsRecommended(A, data?.docs, requestId);

      const assignBtn = rqs("#saAssignModeratorBtn");
      const recBtn = rqs("#saOpenRecommendationBtn");
      const submitRecBtn = rqs("#saSubmitRecommendationBtn");

      if (assignBtn) {
        assignBtn.style.display = "";
        assignBtn.classList.remove("d-none");
        assignBtn.disabled = false;
        assignBtn.dataset.requestId = String(r.id || requestId);
        assignBtn.onclick = () => openAssignModeratorRecommended(A, r.id || requestId);
      }

      if (recBtn) {
        recBtn.disabled = true;
        recBtn.classList.add("disabled");
        recBtn.setAttribute("title", "Recommendation already submitted.");
      }
      if (submitRecBtn) {
        submitRecBtn.disabled = true;
        submitRecBtn.classList.add("disabled");
        submitRecBtn.setAttribute("title", "Recommendation already submitted.");
      }

      const buttonContainer = modalEl.querySelector(".ms-auto.d-flex.flex-wrap.gap-2");
      if (buttonContainer) {
        const existing = buttonContainer.querySelector("[data-sa-rec-status='1']");
        if (existing) existing.remove();

        const statusDiv = document.createElement("div");
        statusDiv.setAttribute("data-sa-rec-status", "1");
        statusDiv.className = "d-flex align-items-center gap-2";
        const recommendationDate = r.recommendation_date ? new Date(r.recommendation_date).toLocaleDateString() : "";
        statusDiv.innerHTML = `
          <span class="badge text-bg-info">Recommendation Submitted</span>
          ${recommendationDate ? `<small class="text-muted">${recommendationDate}</small>` : ""}
        `;
        buttonContainer.appendChild(statusDiv);
      }
    } catch (e) {
      console.error("[Recommended] Error in openViewModalRecommended:", e);
      A.safeShowError(e.message || "Failed to load request.");
    }
  }

  function renderDocsRecommended(A, docsBlock, requestId) {
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

          // ✅ For recommended requests, show ONLY preview button (no accept/return)
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
            <td>${badge(st)}</td>
            <td class="sa-wrap">${reason}</td>
            <td class="text-end sa-actions">${actionsHtml}</td>
          </tr>`;
        })
        .join("");
    }
  }

  // Update the preview-doc handler in bindDocActionsRecommended:
  function bindDocActionsRecommended(A, root) {
    const r = root || A.store._root || document;
    const modalEl = A.qs("#saViewRequestModal", r) || A.qs("#saViewRequestModal");
    if (!modalEl || modalEl.__saDocActionsBoundRecommended) return;
    modalEl.__saDocActionsBoundRecommended = true;

    modalEl.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-action]");
      if (!btn) return;
      if (btn.disabled) return;

      const action = btn.getAttribute("data-action");

      if (action === "preview-doc") {
        const url = btn.getAttribute("data-url");
        const name = btn.getAttribute("data-name");
        const docId = btn.getAttribute("data-doc-id");
        
        console.log("[Recommended] Preview doc:", { url, name, docId });
        
        // Get document status from the row
        const row = btn.closest('tr');
        let docStatus = '';
        
        if (row) {
          const statusBadge = row.querySelector('.badge');
          if (statusBadge) {
            docStatus = statusBadge.textContent.trim();
          }
        }
        
        const requestId = A.rqs("#saViewRequestId")?.value;
        
        if (url && docId) {
          // Use the base module's openPreview function
          A.openPreview(url, name || "", docId, docStatus, requestId);
        } else {
          console.error("[Recommended] Missing url or docId for preview");
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
  // -------------------------
  // Bind recommended tab controls
  // -------------------------
  function bindRecommended(A, root) {
    const r = root || A.store._root || document;

    const yearSel = A.qs("#saRecommendedYearFilter", r);

    if (yearSel && !yearSel.__saBound) {
      yearSel.__saBound = true;
      yearSel.addEventListener("change", () => {
        A.store.recommended.year = yearSel.value || "";
        A.store.recommended.page = 1;
        console.log("[Recommended] Year filter changed to:", yearSel.value);
        fetchRecommended(A).catch((e) => A.safeShowError(e.message));
      });
    }

    const tbody = A.qs("#saRecommendedTbody", r);
    if (tbody && !tbody.__saBound) {
      tbody.__saBound = true;
      tbody.addEventListener("click", (e) => {
        const btn = e.target.closest("[data-action='view']");
        if (!btn) return;
        const tr = btn.closest("tr");
        const id = tr?.getAttribute("data-id");
        if (id) openViewModalRecommended(A, id);
      });
    }

    bindDocActionsRecommended(A, r);
  }


  // -------------------------
  // init (called by base)
  // -------------------------
  function init(root) {
    console.log("[Recommended] Initializing module...");

    const A = mustBase();
    const r = root || document;

    if (r.__saRecommendedInited) {
      console.log("[Recommended] Already initialized, skipping");
      return;
    }
    r.__saRecommendedInited = true;

    bindRecommended(A, r);

    setTimeout(() => {
      fetchRecommended(A).catch((e) => {
        console.error("[Recommended] Initial fetch error:", e);
        A.safeShowError(e.message);
      });
    }, 100);

    A.bus.on("search:changed", () => {
      A.store.recommended.page = 1;
      fetchRecommended(A).catch((e) => A.safeShowError(e.message));
    });

    A.bus.on("refresh:all", () => {
      fetchRecommended(A).catch((e) => A.safeShowError(e.message));
    });

    A.bus.on("filters:changed", (payload) => {
      if (payload.scope === "recommended") {
        A.store.recommended.page = 1;
        fetchRecommended(A).catch((e) => A.safeShowError(e.message));
      }
    });

    A.bus.on("terms:loaded", () => {
      A.store.recommended.page = 1;
      fetchRecommended(A).catch((e) => A.safeShowError(e.message));
    });

    A.bus.on("documents:reviewed", () => {
      fetchRecommended(A).catch((e) => A.safeShowError(e.message));
    });

    A.bus.on("documents:bulk-reviewed", () => {
      fetchRecommended(A).catch((e) => A.safeShowError(e.message));
    });
  }

  window.SAAccreditationRecommended = {
    init,
    fetchRecommended,
    openViewModalRecommended,
  };

  try {
    const A = window.SAAccreditation;
    if (A?.bus) {
      A.bus.on("booted", (p) => init(p?.root || A.store?._root || document));
    }
  } catch (e) {
    console.error("[Recommended] Error setting up booted listener:", e);
  }
})();
//submitRecommendation