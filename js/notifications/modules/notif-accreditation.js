/* js/notifications/modules/notif-accreditation.js */
/* global bootstrap */

(function () {
  "use strict";
  if (window.__NotifAccreditationBooted) return;
  window.__NotifAccreditationBooted = true;

  if (!window.Notifications?.register) {
    console.warn("[NotifAccreditation] notifications-core.js not loaded yet.");
    return;
  }

  const API_BASE = "php/notification.php";
  const REUPLOAD_API = API_BASE;

  function safeShowError(msg) {
    if (typeof window.showError === "function") return window.showError(msg);
    alert(msg || "Something went wrong.");
  }
  
  function safeShowSuccess(msg) {
    if (typeof window.showSuccess === "function") return window.showSuccess(msg);
    alert(msg || "Success.");
  }

  function esc(s) {
    return String(s ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function fullName(row, prefix) {
    const fn = row?.[`${prefix}_first_name`] ?? "";
    const mn = row?.[`${prefix}_middle_name`] ?? "";
    const ln = row?.[`${prefix}_last_name`] ?? "";
    return [fn, mn, ln].filter(Boolean).join(" ").trim() || "—";
  }

  function postForm(data) {
    const body = new URLSearchParams();
    Object.entries(data || {}).forEach(([k, v]) => body.append(k, String(v ?? "")));

    return fetch(API_BASE, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      credentials: "same-origin",
      body
    })
      .then((r) => r.json())
      .then((j) => {
        if (!j || j.success !== true) throw new Error(j?.message || "Request failed");
        return j;
      });
  }

  async function postMultipart(formData) {
    const res = await fetch(REUPLOAD_API, {
      method: "POST",
      body: formData,
      credentials: "same-origin"
    });

    const text = await res.text();
    let j;
    try { j = JSON.parse(text); }
    catch (e) { throw new Error("Server returned non-JSON: " + text.slice(0, 300)); }

    const ok = (j && (j.success === true || j.ok === true));
    if (!res.ok || !ok) throw new Error(j?.message || `Request failed (HTTP ${res.status})`);
    return j;
  }

  function getPayload(payloadId, type) {
    const url =
      `${API_BASE}?action=get_payload&type=${encodeURIComponent(type)}&payload_id=${encodeURIComponent(String(payloadId))}&t=${Date.now()}`;

    return fetch(url, { credentials: "same-origin" })
      .then((r) => r.json())
      .then((j) => {
        if (!j || j.success !== true) throw new Error(j?.message || "Failed to load accreditation payload");
        return j;
      });
  }

  function badge(status) {
    const s = String(status || "").toLowerCase();
    const map = {
      accepted: "success",
      returned: "warning",
      submitted: "secondary",
      pending: "secondary",
      recommended: "info",
      approved: "primary",
      active: "success",
      rejected: "danger"
    };
    const cls = map[s] || "secondary";
    const label = status || "—";
    return `<span class="badge text-bg-${cls}">${esc(label)}</span>`;
  }

  function scopeBadge(scope) {
    const s = String(scope || "—");
    const map = {
      general: "info",
      exclusive: "dark",
      clubs: "warning",
      all: "primary",
      both: "primary"
    };
    const cls = map[s.toLowerCase()] || "secondary";
    const label = s === "Both" ? "All" : s;
    return `<span class="badge text-bg-${cls}">${esc(label)}</span>`;
  }

  function ensureAccreditationStyles() {
    if (document.getElementById("accNotificationStyles")) return;
    
    const style = document.createElement("style");
    style.id = "accNotificationStyles";
    style.textContent = `
      /* Match accreditation page design */
      #notifDetailModal .modal-dialog { max-width: 1200px; }
      
      /* Force checkbox visibility and interactivity */
      #notifDetailBody .doc-checkbox {
        width: 18px !important;
        height: 18px !important;
        min-width: 18px !important;
        min-height: 18px !important;
        margin: 0 auto !important;
        display: inline-block !important;
        position: relative !important;
        z-index: 1060 !important;
      }
      
      #notifDetailBody .doc-checkbox:not(:disabled) {
        opacity: 1 !important;
        pointer-events: auto !important;
        cursor: pointer !important;
      }
      
      #notifDetailBody .doc-checkbox:disabled {
        opacity: 0.5 !important;
        pointer-events: none !important;
        cursor: not-allowed !important;
      }
      
      /* Ensure buttons are interactable */
      #notifDetailBody button:not(:disabled) {
        cursor: pointer !important;
        pointer-events: auto !important;
      }
      
      #notifDetailBody button:disabled {
        cursor: not-allowed !important;
        opacity: 0.5 !important;
      }
      
      /* Ensure table cells have proper sizing */
      #notifDetailBody .checkbox-col {
        width: 40px !important;
        min-width: 40px !important;
        text-align: center !important;
        vertical-align: middle !important;
      }
      
      /* Force table cell to contain checkbox properly */
      #notifDetailBody td.checkbox-col {
        padding: 0.75rem 0 !important;
        line-height: 1 !important;
      }
      
      /* Ensure modal content is above backdrop */
      .modal-content {
        position: relative;
        z-index: 1060;
      }
      
      .modal-backdrop {
        z-index: 1050;
      }
      
      #notifDetailBody {
        position: relative;
        z-index: 1061;
        overflow-y: auto;
        max-height: 70vh;
      }
      
      /* Make table rows clickable for better UX */
      #notifDetailBody tr {
        cursor: default;
      }
      
      #notifDetailBody tr.table-active {
        background-color: rgba(13, 110, 253, 0.1) !important;
      }
      
      /* Accordion styles */
      #notifDetailBody .accordion-button:not(.collapsed) {
        background-color: #e7f1ff;
        color: #0c63e4;
      }
      
      #notifDetailBody .accordion-button:focus {
        box-shadow: none;
        border-color: rgba(0,0,0,.125);
      }
      
      #notifDetailBody .sa-wrap {
        white-space: pre-wrap;
        word-wrap: break-word;
        max-height: 200px;
        overflow-y: auto;
        padding: 0.5rem;
        background-color: #f8f9fa;
        border-radius: 0.375rem;
        border: 1px solid #dee2e6;
      }
      
      #notifDetailBody .accred-header {
        background-color: #f8fafc;
        border: 1px solid #e9ecef;
        border-radius: 0.5rem;
        padding: 1rem;
        margin-bottom: 1rem;
      }
      
      #notifDetailBody .status-badge-group {
        display: flex;
        align-items: center;
        gap: 1rem;
        margin-bottom: 0.75rem;
      }
      
      #notifDetailBody .info-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
        gap: 0.75rem;
        margin-top: 0.5rem;
      }
      
      #notifDetailBody .info-item {
        display: flex;
        flex-direction: column;
      }
      
      #notifDetailBody .info-label {
        font-size: 0.75rem;
        color: #6c757d;
        margin-bottom: 0.25rem;
      }
      
      #notifDetailBody .info-value {
        font-weight: 500;
        color: #212529;
      }
      
      #notifDetailBody .action-bar {
        background-color: #f8f9fa;
        border: 1px solid #dee2e6;
        border-radius: 0.5rem;
        padding: 0.75rem 1rem;
        margin-bottom: 1rem;
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 0.5rem;
      }
      
      #notifDetailBody .bulk-toolbar {
        background-color: #e9ecef;
        border-radius: 0.375rem;
        padding: 0.5rem 1rem;
        margin-bottom: 1rem;
        display: flex;
        justify-content: space-between;
        align-items: center;
      }
      
      #notifDetailBody .table-accred {
        border: 1px solid #dee2e6;
        border-radius: 0.5rem;
        overflow: hidden;
      }
      
      #notifDetailBody .table-accred th {
        background-color: #f8f9fa;
        font-size: 0.85rem;
        font-weight: 600;
        color: #495057;
        padding: 0.75rem 0.75rem;
        border-bottom: 1px solid #dee2e6;
      }
      
      #notifDetailBody .table-accred td {
        padding: 0.75rem 0.75rem;
        vertical-align: middle;
        border-bottom: 1px solid #f1f1f1;
      }
      
      #notifDetailBody .table-accred tr:last-child td {
        border-bottom: none;
      }
      
      #notifDetailBody .table-accred tr.table-active {
        background-color: rgba(13, 110, 253, 0.05);
      }
      
      #notifDetailBody .doc-name {
        font-weight: 500;
        margin-bottom: 0.25rem;
      }
      
      #notifDetailBody .return-reason {
        font-size: 0.8rem;
        color: #6c757d;
        background-color: #fff3cd;
        padding: 0.25rem 0.5rem;
        border-radius: 0.25rem;
        display: inline-block;
      }
      
      #notifDetailBody .btn-group-accred {
        display: flex;
        gap: 0.25rem;
        justify-content: flex-end;
      }
      
      #notifDetailBody .btn-icon {
        padding: 0.25rem 0.5rem;
        font-size: 0.75rem;
      }
      
      #notifDetailBody .form-check-input:checked {
        background-color: #0d6efd;
        border-color: #0d6efd;
      }
      
      #notifDetailBody .cursor-pointer { cursor: pointer; }
      
      #notifDetailBody .badge-soft {
        font-weight: 500;
        padding: 0.35rem 0.65rem;
      }
      
      #notifDetailBody .alert-accred {
        border-radius: 0.5rem;
        border-left: 4px solid;
        margin-top: 1rem;
      }
      
      #notifDetailBody .alert-accred.info {
        border-left-color: #0dcaf0;
        background-color: #f0f9ff;
      }
      
      #notifDetailBody .alert-accred.warning {
        border-left-color: #ffc107;
        background-color: #fff9e6;
      }
      
      #accActionModal .modal-dialog { max-width: 600px; }
      
      .acc-reupload-wrap {
        display: flex;
        gap: 0.5rem;
        align-items: center;
        margin-top: 0.5rem;
      }
      
      .acc-reupload-wrap input[type="file"] {
        max-width: 200px;
        font-size: 0.8rem;
      }
    `;
    
    document.head.appendChild(style);
  }

  function ensureActionModal() {
    ensureAccreditationStyles();

    let el = document.getElementById("accActionModal");
    if (el) return el;

    const wrap = document.createElement("div");
    wrap.innerHTML = `
      <div class="modal fade" id="accActionModal" tabindex="-1" aria-hidden="true">
        <div class="modal-dialog modal-dialog-centered">
          <div class="modal-content">
            <div class="modal-header">
              <h5 class="modal-title" id="accActionTitle">Confirm</h5>
              <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
            </div>
            <div class="modal-body">
              <div class="mb-3" id="accActionMessage">Proceed?</div>
              <div class="mb-3" id="accActionNoteWrap" style="display:none;">
                <label class="form-label fw-semibold" for="accActionNote">Note</label>
                <textarea class="form-control" id="accActionNote" rows="4" placeholder=""></textarea>
                <div class="form-text text-muted" id="accActionHint"></div>
              </div>
              <div class="alert alert-danger py-2 mb-0 d-none" id="accActionInlineErr"></div>
            </div>
            <div class="modal-footer">
              <button type="button" class="btn btn-outline-secondary" data-bs-dismiss="modal">Cancel</button>
              <button type="button" class="btn btn-primary" id="accActionOk">Confirm</button>
            </div>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(wrap.firstElementChild);
    return document.getElementById("accActionModal");
  }

  /**
   * Debug function to check what's intercepting clicks
   */
  function setupClickDebugger() {
    document.addEventListener('click', function(e) {
      console.log('[Global Click]', {
        target: e.target,
        targetTag: e.target.tagName,
        targetClass: e.target.className,
        targetId: e.target.id,
        path: e.composedPath().map(el => ({
          tag: el.tagName,
          id: el.id,
          class: el.className
        }))
      });
    }, true); // Use capture to see all clicks
  }

  // Call this once at the beginning
  setupClickDebugger();

  function showInlineActionModal(opts) {
    return new Promise((resolve) => {
      const modalEl = ensureActionModal();
      const titleEl = document.getElementById("accActionTitle");
      const msgEl = document.getElementById("accActionMessage");
      const okBtn = document.getElementById("accActionOk");
      const noteWrap = document.getElementById("accActionNoteWrap");
      const noteEl = document.getElementById("accActionNote");
      const hintEl = document.getElementById("accActionHint");
      const errEl = document.getElementById("accActionInlineErr");

      const noteEnabled = !!opts?.note?.enabled;
      const noteRequired = !!opts?.note?.required;

      titleEl.textContent = opts?.title || "Confirm";
      msgEl.innerHTML = opts?.message || "Proceed?";
      okBtn.textContent = opts?.okText || "Confirm";
      okBtn.className = `btn ${opts?.okClass || "btn-primary"}`;

      noteWrap.style.display = noteEnabled ? "block" : "none";
      if (noteEnabled) {
        noteWrap.querySelector('label').textContent = opts?.note?.label || "Note";
        noteEl.placeholder = opts?.note?.placeholder || "";
        noteEl.value = opts?.note?.value || "";
        hintEl.textContent = opts?.note?.hint || "";
      } else {
        noteEl.value = "";
      }

      errEl.classList.add("d-none");
      errEl.textContent = "";

      const modal = bootstrap.Modal.getOrCreateInstance(modalEl, { backdrop: "static" });
      modal.show();

      const cleanup = () => {
        okBtn.onclick = null;
        modalEl.removeEventListener("hidden.bs.modal", onHidden);
      };

      const onHidden = () => {
        cleanup();
        resolve({ ok: false, note: "" });
      };

      modalEl.addEventListener("hidden.bs.modal", onHidden, { once: true });

      okBtn.onclick = () => {
        if (noteEnabled && noteRequired) {
          const v = noteEl.value.trim();
          if (!v) {
            errEl.textContent = "Note is required.";
            errEl.classList.remove("d-none");
            noteEl.focus();
            return;
          }
        }
        modal.hide();
        cleanup();
        resolve({ ok: true, note: noteEl.value.trim() });
      };

      setTimeout(() => {
        if (noteEnabled) noteEl.focus();
      }, 150);
    });
  }

  function showOpSuccess(message) { safeShowSuccess(message); }
  function showOpError(message) { safeShowError(message); }

  function closeNotificationPanel() {
    const panel = document.getElementById('notifPanel');
    const overlay = document.getElementById('notifOverlay');
    
    if (panel && panel.classList.contains('open')) {
      panel.classList.remove('open');
      if (overlay) {
        overlay.classList.remove('show');
        overlay.hidden = true;
      }
      document.body.style.overflow = '';
    }
  }

  // Track selected documents
  let selectedDocs = new Set();

  function initBulkUI(bodyEl) {
    const toolbar = bodyEl.querySelector("#accBulkToolbar");
    const selectAll = bodyEl.querySelector("#accSelectAll");
    const countEl = bodyEl.querySelector("#accBulkCount");
    const acceptBtn = bodyEl.querySelector("#accBulkAccept");
    const returnBtn = bodyEl.querySelector("#accBulkReturn");
    const clearBtn = bodyEl.querySelector("#accBulkClear");

    if (!toolbar || !selectAll || !countEl || !acceptBtn || !returnBtn || !clearBtn) return;

    // Clear selected docs
    selectedDocs.clear();

    // Get all checkboxes
    const checkboxes = Array.from(bodyEl.querySelectorAll(".doc-checkbox"));
    
    // Update UI function
    const updateUI = () => {
      // Only consider enabled (not disabled) checkboxes for bulk actions
      const enabledCheckboxes = checkboxes.filter(cb => !cb.disabled);
      const checked = enabledCheckboxes.filter(cb => cb.checked);
      const count = checked.length;

      // Update toolbar visibility
      toolbar.style.display = count > 0 ? "flex" : "none";
      countEl.textContent = count;

      // Update button states
      acceptBtn.disabled = count === 0;
      returnBtn.disabled = count === 0;

      // Update select all - only consider enabled checkboxes
      if (enabledCheckboxes.length > 0) {
        selectAll.checked = count === enabledCheckboxes.length;
        selectAll.indeterminate = count > 0 && count < enabledCheckboxes.length;
      } else {
        selectAll.checked = false;
        selectAll.indeterminate = false;
      }

      // Update row highlighting
      checkboxes.forEach(cb => {
        const row = cb.closest("tr");
        if (row) {
          if (cb.checked && !cb.disabled) {
            row.classList.add("table-active");
          } else {
            row.classList.remove("table-active");
          }
        }
      });

      // Update selected set
      selectedDocs.clear();
      checked.forEach(cb => selectedDocs.add(cb.value));
    };

    // Individual checkbox change
    checkboxes.forEach(cb => {
      cb.removeEventListener("change", updateUI);
      cb.addEventListener("change", (e) => {
        updateUI();
      });
    });

    // Select all change
    selectAll.removeEventListener("change", () => {});
    selectAll.addEventListener("change", (e) => {
      const enabledCheckboxes = checkboxes.filter(cb => !cb.disabled);
      enabledCheckboxes.forEach(cb => {
        cb.checked = e.target.checked;
      });
      updateUI();
    });

    // Clear button
    clearBtn.removeEventListener("click", () => {});
    clearBtn.addEventListener("click", (e) => {
      e.preventDefault();
      checkboxes.forEach(cb => {
        cb.checked = false;
      });
      updateUI();
    });

    // Store updateUI for later use
    bodyEl.__updateBulkUI = updateUI;
    
    // Initial update
    updateUI();
  }

  function buildHtml(payload) {
    ensureAccreditationStyles();

    const req = payload?.request || {};
    const docs = Array.isArray(payload?.documents) ? payload.documents : [];
    const caps = payload?.capabilities || {};

    const roleRaw = String(caps.role || "").toLowerCase();
    const isSuperAdmin = roleRaw === "super_admin";
    const canReview = !!caps.can_review_docs && !isSuperAdmin;
    const canRecommend = !!caps.can_recommend;
    const canSuper = !!caps.can_super_actions;
    const canReupload = !!caps.can_reupload_docs;

    const term = `${esc(req.school_year || "—")} - ${esc(req.semester || "—")}`;
    const coordinator = fullName(req, "coord");
    const moderator = fullName(req, "mod");

    // Check if all documents are accepted (for recommend button)
    const allDocsAccepted = docs.length > 0 && docs.every(d => 
      String(d.document_status || d.status || "").toLowerCase() === "accepted"
    );

    // Header section
    const header = `
      <div class="accred-header">
        <div class="status-badge-group">
          ${badge(req.status || "—")}
          <span class="text-muted small ms-auto">Request #${esc(req.id || "—")}</span>
        </div>
        
        <div class="info-grid">
          <div class="info-item">
            <span class="info-label">Term</span>
            <span class="info-value">${term}</span>
          </div>
          <div class="info-item">
            <span class="info-label">Organization</span>
            <span class="info-value">${esc(req.org_name || "—")} ${req.abbreviation ? `(${esc(req.abbreviation)})` : ''}</span>
          </div>
          <div class="info-item">
            <span class="info-label">Scope</span>
            <span class="info-value">${scopeBadge(req.scope || "—")}</span>
          </div>
          <div class="info-item">
            <span class="info-label">Type</span>
            <span class="info-value">${esc(req.org_type || "—")}</span>
          </div>
          <div class="info-item">
            <span class="info-label">Submitted</span>
            <span class="info-value">${req.submitted_at ? new Date(req.submitted_at).toLocaleString() : "—"}</span>
          </div>
          <div class="info-item">
            <span class="info-label">Coordinator</span>
            <span class="info-value">${esc(coordinator)}</span>
          </div>
          ${moderator !== "—" ? `
          <div class="info-item">
            <span class="info-label">Moderator</span>
            <span class="info-value">${esc(moderator)}</span>
          </div>
          ` : ''}
        </div>
      </div>
    `;

    // Organization Information Accordion with complete details
    const orgInfoAccordion = `
      <div class="accordion mb-3" id="saOrgInfoAcc">
        <div class="accordion-item">
          <h2 class="accordion-header">
            <button class="accordion-button collapsed" type="button" data-bs-toggle="collapse" data-bs-target="#saOrgInfoCollapse" aria-expanded="false">
              <i class="bi bi-building me-2"></i>Organization Information
            </button>
          </h2>
          <div id="saOrgInfoCollapse" class="accordion-collapse collapse" data-bs-parent="#saOrgInfoAcc">
            <div class="accordion-body">
              <div class="row g-3">
                <!-- Organization Basic Info -->
                <div class="col-12 col-md-6">
                  <div class="fw-semibold">Organization Name</div>
                  <div class="text-muted small sa-wrap">${esc(req.org_name || "—")}</div>
                </div>
                <div class="col-12 col-md-6">
                  <div class="fw-semibold">Abbreviation</div>
                  <div class="text-muted small sa-wrap">${esc(req.abbreviation || "—")}</div>
                </div>
                
                <!-- Description -->
                <div class="col-12">
                  <div class="fw-semibold">Description</div>
                  <div class="text-muted small sa-wrap">${esc(req.description || "—")}</div>
                </div>
                
                <!-- Mission & Vision -->
                <div class="col-12 col-lg-6">
                  <div class="fw-semibold">Mission</div>
                  <div class="text-muted small sa-wrap">${esc(req.mission || "—")}</div>
                </div>
                <div class="col-12 col-lg-6">
                  <div class="fw-semibold">Vision</div>
                  <div class="text-muted small sa-wrap">${esc(req.vision || "—")}</div>
                </div>
                
                <!-- Objectives & Advocacy -->
                <div class="col-12 col-lg-6">
                  <div class="fw-semibold">Objectives</div>
                  <div class="text-muted small sa-wrap">${esc(req.objectives || "—")}</div>
                </div>
                <div class="col-12 col-lg-6">
                  <div class="fw-semibold">Advocacy</div>
                  <div class="text-muted small sa-wrap">${esc(req.advocacy || "—")}</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;

    // Action bar with conditional buttons
    const actionBar = `
      <div class="action-bar">
        <div class="d-flex gap-2 align-items-center">
          <span class="text-muted small me-2">Role: <span class="badge bg-secondary">${esc(roleRaw.replace("_", " "))}</span></span>
          
          <button type="button" class="btn btn-outline-primary btn-sm" data-action="open-full">
            <i class="bi bi-box-arrow-up-right me-1"></i>Open Full Page
          </button>
          
          ${(!isSuperAdmin && canRecommend) ? `
            <button type="button" class="btn btn-outline-secondary btn-sm" data-action="return-request">
              <i class="bi bi-arrow-counterclockwise me-1"></i>Return Request
            </button>
            <button type="button" class="btn ${allDocsAccepted ? 'btn-info' : 'btn-outline-secondary'} btn-sm text-white" 
                    data-action="recommend-request"
                    ${allDocsAccepted ? '' : 'disabled'} 
                    title="${allDocsAccepted ? 'Recommend this request' : 'All documents must be accepted first'}">
              <i class="bi bi-send-check me-1"></i>Recommend
            </button>
          ` : ""}
          
          ${canSuper ? `
            ${!isSuperAdmin ? `
              <button type="button" class="btn btn-primary btn-sm" data-action="approve-request">
                <i class="bi bi-check2-circle me-1"></i>Approve
              </button>
            ` : ""}
            ${req.status !== "Active" ? `
              <button type="button" class="btn btn-success btn-sm" data-action="activate-request">
                <i class="bi bi-lightning-charge me-1"></i>Activate
              </button>
            ` : ""}
            ${!isSuperAdmin ? `
              <button type="button" class="btn btn-danger btn-sm" data-action="reject-request">
                <i class="bi bi-x-circle me-1"></i>Reject
              </button>
            ` : ""}
          ` : ""}
        </div>
      </div>
    `;

    // Bulk toolbar - Only shown when canReview is true
    const bulkToolbar = canReview ? `
      <div class="bulk-toolbar" id="accBulkToolbar" style="display: none;">
        <div>
          <span class="fw-semibold" id="accBulkCount">0</span> document(s) selected
        </div>
        <div class="btn-group btn-group-sm">
          <button type="button" class="btn btn-success" id="accBulkAccept" disabled>
            <i class="bi bi-check-circle me-1"></i>Accept Selected
          </button>
          <button type="button" class="btn btn-warning" id="accBulkReturn" disabled>
            <i class="bi bi-arrow-counterclockwise me-1"></i>Return Selected
          </button>
          <button type="button" class="btn btn-outline-secondary" id="accBulkClear">
            <i class="bi bi-x-circle me-1"></i>Clear
          </button>
        </div>
      </div>
    ` : "";

    // Documents table with checkboxes and buttons - Only enabled for Submitted status
    const tableRows = docs.map((d) => {
      const docId = d.id;
      const fileUrl = d.file_url || d.file_path || "#";
      const dbStatus = String(d.document_status || d.status || "").toLowerCase();
      const isSubmitted = dbStatus === "submitted";
      const isReturned = dbStatus === "returned";
      const isAccepted = dbStatus === "accepted";
      
      // Checkbox only selectable for Submitted documents
      const selectable = canReview && isSubmitted;
      
      const checkbox = canReview ? `
        <input type="checkbox" 
               class="form-check-input doc-checkbox" 
               value="${docId}"
               data-doc-id="${docId}"
               data-status="${dbStatus}"
               ${selectable ? "" : "disabled"}
               title="${selectable ? 'Select this document' : 'Only documents with Submitted status can be selected'}">
      ` : "";

      const reasonHtml = d.return_reason ? `
        <div class="return-reason mt-1">
          <i class="bi bi-info-circle me-1"></i>${esc(d.return_reason)}
        </div>
      ` : "";

      const viewBtn = fileUrl !== "#" ? `
        <a href="${fileUrl}" target="_blank" class="btn btn-outline-secondary btn-sm btn-icon" title="View Document">
          <i class="bi bi-eye"></i>
        </a>
      ` : `
        <button class="btn btn-outline-secondary btn-sm btn-icon" disabled title="No file available">
          <i class="bi bi-eye-slash"></i>
        </button>
      `;

      // Accept button only enabled for Submitted documents
      const acceptBtnEnabled = canReview && isSubmitted && !isAccepted;
      const acceptBtn = canReview ? `
        <button class="btn ${acceptBtnEnabled ? 'btn-outline-success' : 'btn-outline-secondary'} btn-sm btn-icon" 
                data-action="accept-doc" 
                data-doc-id="${docId}"
                ${acceptBtnEnabled ? '' : 'disabled'} 
                title="${acceptBtnEnabled ? 'Accept this document' : 'Only Submitted documents can be accepted'}">
          <i class="bi bi-check-circle"></i>
        </button>
      ` : "";

      // Return button only enabled for Submitted documents
      const returnBtnEnabled = canReview && isSubmitted;
      const returnBtn = canReview ? `
        <button class="btn ${returnBtnEnabled ? 'btn-outline-warning' : 'btn-outline-secondary'} btn-sm btn-icon" 
                data-action="return-doc" 
                data-doc-id="${docId}"
                ${returnBtnEnabled ? '' : 'disabled'} 
                title="${returnBtnEnabled ? 'Return this document' : 'Only Submitted documents can be returned'}">
          <i class="bi bi-x-circle"></i>
        </button>
      ` : "";

      // Reupload only available for Returned documents
      const reuploadHtml = (canReupload && isReturned) ? `
        <div class="acc-reupload-wrap">
          <input type="file" class="form-control form-control-sm" data-reupload-file="${docId}" accept=".pdf,.doc,.docx,.jpg,.jpeg,.png">
          <button class="btn btn-outline-primary btn-sm" data-action="reupload-doc" 
                  data-doc-id="${docId}" data-req-id="${req.id}" data-reqmt-id="${d.requirement_id}">
            <i class="bi bi-upload me-1"></i>Reupload
          </button>
        </div>
      ` : "";

      return `
        <tr data-doc-id="${docId}" data-status="${dbStatus}">
          ${canReview ? `<td class="checkbox-col">${checkbox}</td>` : ""}
          <td>
            <div class="doc-name">${esc(d.requirement_name || "—")}</div>
            ${reasonHtml}
          </td>
          <td style="width: 120px;">${badge(d.document_status || d.status || "Submitted")}</td>
          <td style="width: ${canReview ? '280px' : '180px'};" class="text-end">
            <div class="btn-group-accred">
              ${viewBtn}
              ${acceptBtn}
              ${returnBtn}
            </div>
            ${reuploadHtml}
          </td>
        </tr>
      `;
    }).join("");

    const tableHeader = canReview ? `
      <thead>
        <tr>
          <th class="checkbox-col">
            <input type="checkbox" class="form-check-input" id="accSelectAll" title="Select all documents with Submitted status">
          </th>
          <th>Requirement</th>
          <th style="width: 120px;">Status</th>
          <th style="width: 280px;" class="text-end">Actions</th>
        </tr>
      </thead>
    ` : `
      <thead>
        <tr>
          <th>Requirement</th>
          <th style="width: 120px;">Status</th>
          <th style="width: 180px;" class="text-end">Actions</th>
        </tr>
      </thead>
    `;

    const table = `
      <div class="table-accred">
        <table class="table table-sm align-middle mb-0">
          ${tableHeader}
          <tbody>
            ${tableRows || `
              <tr>
                <td colspan="${canReview ? 4 : 3}" class="text-center text-muted py-4">
                  <i class="bi bi-folder2-open fs-4 d-block mb-2"></i>
                  No documents found.
                </td>
              </tr>
            `}
          </tbody>
        </table>
      </div>
    `;

    // Summary section
    const summary = payload?.summary ? `
      <div class="row mt-3 g-2">
        <div class="col-md-3">
          <div class="card bg-light">
            <div class="card-body p-2 text-center">
              <div class="small text-muted">Total Documents</div>
              <div class="h5 mb-0">${payload.summary.total || 0}</div>
            </div>
          </div>
        </div>
        <div class="col-md-3">
          <div class="card bg-success bg-opacity-10">
            <div class="card-body p-2 text-center">
              <div class="small text-muted">Accepted</div>
              <div class="h5 mb-0 text-success">${payload.summary.accepted || 0}</div>
            </div>
          </div>
        </div>
        <div class="col-md-3">
          <div class="card bg-warning bg-opacity-10">
            <div class="card-body p-2 text-center">
              <div class="small text-muted">Returned</div>
              <div class="h5 mb-0 text-warning">${payload.summary.returned || 0}</div>
            </div>
          </div>
        </div>
        <div class="col-md-3">
          <div class="card bg-secondary bg-opacity-10">
            <div class="card-body p-2 text-center">
              <div class="small text-muted">Pending</div>
              <div class="h5 mb-0">${payload.summary.other || 0}</div>
            </div>
          </div>
        </div>
      </div>
    ` : "";

    const tips = canReview ? `
      <div class="alert-accred info mt-3 p-2 small">
        <i class="bi bi-info-circle me-2"></i>
        <strong>Tip:</strong> Only documents with <span class="badge bg-secondary">Submitted</span> status can be selected for bulk actions or reviewed individually.
      </div>
    ` : "";

    // Removed the reuploadTip completely

    return header + orgInfoAccordion + actionBar + bulkToolbar + summary + table + tips;
  }
  /**
   * Clean up event listeners by cloning and replacing elements
   */
  function cleanupEventListeners(container) {
    if (!container) return;
    
    // Find all elements with data-action attribute
    const actionElements = container.querySelectorAll('[data-action]');
    actionElements.forEach(el => {
      const newEl = el.cloneNode(true);
      el.parentNode.replaceChild(newEl, el);
    });
    
    // Also clean up checkboxes and other interactive elements
    const checkboxes = container.querySelectorAll('.doc-checkbox');
    checkboxes.forEach(cb => {
      const newCb = cb.cloneNode(true);
      cb.parentNode.replaceChild(newCb, cb);
    });
    
    const buttons = container.querySelectorAll('button:not([data-action])');
    buttons.forEach(btn => {
      const newBtn = btn.cloneNode(true);
      btn.parentNode.replaceChild(newBtn, btn);
    });
  }

  function wireModalActions(payloadId, helpers, refreshDoc, bodyEl) {
    if (!bodyEl) {
      console.error('[Accreditation] No body element provided to wireModalActions');
      return;
    }

    console.log('[Accreditation] Wiring modal actions');

    // Clean up existing event listeners first
    cleanupEventListeners(bodyEl);

    // Open full page
    bodyEl.querySelectorAll("[data-action='open-full']").forEach(btn => {
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        
        const modalEl = document.getElementById("notifDetailModal");
        if (modalEl) bootstrap.Modal.getInstance(modalEl)?.hide();
        closeNotificationPanel();
        window.dispatchEvent(new CustomEvent("notif:openAccreditation", {
          detail: { requestId: payloadId }
        }));
        const accredLink = document.querySelector('.sidebar-link[data-section="manage-accreditation"]');
        if (accredLink) accredLink.click();
      });
    });

    // Accept single document
    bodyEl.querySelectorAll("[data-action='accept-doc']").forEach(btn => {
      btn.addEventListener("click", async (e) => {
        e.preventDefault();
        e.stopPropagation();
        
        const docId = btn.dataset.docId;
        if (!docId) return;

        const confirm = await showInlineActionModal({
          title: "Accept Document",
          message: "Are you sure you want to accept this document?",
          okText: "Accept",
          okClass: "btn-success",
          note: { enabled: false }
        });
        if (!confirm.ok) return;

        btn.disabled = true;
        try {
          await postForm({
            action: "review_doc",
            doc_id: docId,
            decision: "accept"
          });
          showOpSuccess("Document accepted.");
          await refreshDoc();
        } catch (err) {
          showOpError(err.message);
        } finally {
          btn.disabled = false;
        }
      });
    });

    // Return single document
    bodyEl.querySelectorAll("[data-action='return-doc']").forEach(btn => {
      btn.addEventListener("click", async (e) => {
        e.preventDefault();
        e.stopPropagation();
        
        const docId = btn.dataset.docId;
        if (!docId) return;

        const confirm = await showInlineActionModal({
          title: "Return Document",
          message: "Provide a reason for returning this document.",
          okText: "Return",
          okClass: "btn-warning",
          note: {
            enabled: true,
            required: true,
            label: "Return reason",
            placeholder: "Enter reason for return..."
          }
        });
        if (!confirm.ok) return;

        btn.disabled = true;
        try {
          await postForm({
            action: "review_doc",
            doc_id: docId,
            decision: "return",
            reason: confirm.note
          });
          showOpSuccess("Document returned.");
          await refreshDoc();
        } catch (err) {
          showOpError(err.message);
        } finally {
          btn.disabled = false;
        }
      });
    });

    // Reupload document
    bodyEl.querySelectorAll("[data-action='reupload-doc']").forEach(btn => {
      btn.addEventListener("click", async (e) => {
        e.preventDefault();
        e.stopPropagation();
        
        const docId = btn.dataset.docId;
        const reqId = btn.dataset.reqId;
        const reqmtId = btn.dataset.reqmtId;
        const fileInput = bodyEl.querySelector(`[data-reupload-file="${docId}"]`);
        
        if (!fileInput || !fileInput.files[0]) {
          showOpError("Please select a file first.");
          return;
        }

        const confirm = await showInlineActionModal({
          title: "Reupload Document",
          message: "This will replace the current document.",
          okText: "Reupload",
          okClass: "btn-primary",
          note: { enabled: false }
        });
        if (!confirm.ok) return;

        btn.disabled = true;
        try {
          const fd = new FormData();
          fd.append("action", "accreditation_reupload_doc");
          fd.append("request_id", reqId);
          fd.append("requirement_id", reqmtId);
          fd.append("file", fileInput.files[0]);

          await postMultipart(fd);
          showOpSuccess("Document reuploaded.");
          fileInput.value = "";
          await refreshDoc();
        } catch (err) {
          showOpError(err.message);
        } finally {
          btn.disabled = false;
        }
      });
    });

    // Request actions
    const actions = {
      "return-request": { title: "Return Request", msg: "Provide reason for returning this request.", btn: "btn-outline-secondary", note: true },
      "recommend-request": { title: "Recommend Request", msg: "Add optional note for recommendation.", btn: "btn-info", note: false },
      "approve-request": { title: "Approve Request", msg: "Approve this accreditation request?", btn: "btn-primary", note: false },
      "activate-request": { title: "Activate Request", msg: "Activate this accreditation?", btn: "btn-success", note: false },
      "reject-request": { title: "Reject Request", msg: "Provide reason for rejection.", btn: "btn-danger", note: true }
    };

    Object.entries(actions).forEach(([action, config]) => {
      bodyEl.querySelectorAll(`[data-action="${action}"]`).forEach(btn => {
        // Skip if button is disabled
        if (btn.disabled) return;
        
        btn.addEventListener("click", async (e) => {
          e.preventDefault();
          e.stopPropagation();
          
          const doAction = action.replace("-request", "");
          
          const confirm = await showInlineActionModal({
            title: config.title,
            message: config.msg,
            okText: config.title,
            okClass: config.btn,
            note: {
              enabled: config.note,
              required: config.note,
              label: "Reason",
              placeholder: "Enter reason..."
            }
          });
          if (!confirm.ok) return;

          btn.disabled = true;
          try {
            await postForm({
              action: "request_action",
              request_id: payloadId,
              do: doAction,
              note: confirm.note
            });
            showOpSuccess(`${config.title} completed.`);
            await refreshDoc();
          } catch (err) {
            showOpError(err.message);
          } finally {
            btn.disabled = false;
          }
        });
      });
    });

    // Bulk actions
    const bulkAccept = bodyEl.querySelector("#accBulkAccept");
    const bulkReturn = bodyEl.querySelector("#accBulkReturn");
    const bulkClear = bodyEl.querySelector("#accBulkClear");

    if (bulkAccept) {
      bulkAccept.addEventListener("click", async (e) => {
        e.preventDefault();
        e.stopPropagation();
        
        const checkboxes = Array.from(bodyEl.querySelectorAll(".doc-checkbox:checked:not(:disabled)"));
        const docIds = checkboxes.map(cb => cb.value).filter(Boolean);
        
        if (docIds.length === 0) return;

        const confirm = await showInlineActionModal({
          title: "Accept Selected",
          message: `Accept ${docIds.length} selected document(s)?`,
          okText: "Accept",
          okClass: "btn-success",
          note: { enabled: false }
        });
        if (!confirm.ok) return;

        bulkAccept.disabled = true;
        try {
          await postForm({
            action: "bulk_review_docs",
            decision: "accept",
            doc_ids: docIds.join(",")
          });
          showOpSuccess(`${docIds.length} document(s) accepted.`);
          await refreshDoc();
        } catch (err) {
          showOpError(err.message);
        } finally {
          bulkAccept.disabled = false;
        }
      });
    }

    if (bulkReturn) {
      bulkReturn.addEventListener("click", async (e) => {
        e.preventDefault();
        e.stopPropagation();
        
        const checkboxes = Array.from(bodyEl.querySelectorAll(".doc-checkbox:checked:not(:disabled)"));
        const docIds = checkboxes.map(cb => cb.value).filter(Boolean);
        
        if (docIds.length === 0) return;

        const confirm = await showInlineActionModal({
          title: "Return Selected",
          message: `Provide reason for returning ${docIds.length} document(s).`,
          okText: "Return",
          okClass: "btn-warning",
          note: {
            enabled: true,
            required: true,
            label: "Return reason",
            placeholder: "Enter reason for return..."
          }
        });
        if (!confirm.ok) return;

        bulkReturn.disabled = true;
        try {
          await postForm({
            action: "bulk_review_docs",
            decision: "return",
            reason: confirm.note,
            doc_ids: docIds.join(",")
          });
          showOpSuccess(`${docIds.length} document(s) returned.`);
          await refreshDoc();
        } catch (err) {
          showOpError(err.message);
        } finally {
          bulkReturn.disabled = false;
        }
      });
    }

    if (bulkClear) {
      bulkClear.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        
        bodyEl.querySelectorAll(".doc-checkbox").forEach(cb => {
          cb.checked = false;
        });
        if (bodyEl.__updateBulkUI) bodyEl.__updateBulkUI();
      });
    }

    // Initialize bulk UI
    initBulkUI(bodyEl);
  }

  /**
   * Wait for elements to be ready with debugging
   */
  function waitForElementsAndWire(payloadId, helpers, refreshDoc, maxAttempts = 20) {
    let attempts = 0;
    
    const checkAndWire = () => {
      attempts++;
      
      const bodyEl = document.getElementById("notifDetailBody");
      if (!bodyEl) {
        if (attempts < maxAttempts) {
          setTimeout(checkAndWire, 200);
        }
        return;
      }
      
      // Check if the table with checkboxes is loaded
      const checkboxes = bodyEl.querySelectorAll(".doc-checkbox");
      const table = bodyEl.querySelector(".table-accred");
      const anyButtons = bodyEl.querySelectorAll("button").length;
      
      if (checkboxes.length > 0 || table || anyButtons > 0) {
        // Elements are ready, wire them up
        wireModalActions(payloadId, helpers, refreshDoc, bodyEl);
      } else if (attempts < maxAttempts) {
        // Wait a bit and try again
        setTimeout(checkAndWire, 300);
      } else {
        // Max attempts reached, try one last time
        wireModalActions(payloadId, helpers, refreshDoc, bodyEl);
      }
    };
    
    checkAndWire();
  }

  async function handler(notif, meta, helpers) {
    const payloadId = meta?.payloadId || notif?.payload_id || "";
    const type = (meta?.type || notif?.notif_type || "accreditation").toLowerCase();

    helpers.openDetailModal({
      title: notif?.title || "Accreditation",
      body: '<div class="text-center py-4"><div class="spinner-border text-primary" role="status"></div><p class="mt-2 text-muted">Loading details...</p></div>',
      meta: ""
    });

    let payload;
    try {
      payload = await getPayload(payloadId, type);
    } catch (err) {
      helpers.openDetailModal({
        title: notif?.title || "Accreditation",
        body: `<div class="alert alert-danger">${err.message}</div>`,
        meta: ""
      });
      return;
    }

    const render = () => {
      const html = buildHtml(payload);
      helpers.openDetailModal({
        title: notif?.title || "Accreditation",
        body_html: html,
        meta: notif?.created_at ? `Received: ${new Date(notif.created_at).toLocaleString()}` : ""
      });

      helpers.setActionButton({
        text: "Open Full Page",
        onClick: () => {
          const modalEl = document.getElementById("notifDetailModal");
          if (modalEl) bootstrap.Modal.getInstance(modalEl)?.hide();
          closeNotificationPanel();
          window.dispatchEvent(new CustomEvent("notif:openAccreditation", {
            detail: { requestId: payloadId }
          }));
          const accredLink = document.querySelector('.sidebar-link[data-section="manage-accreditation"]');
          if (accredLink) accredLink.click();
        }
      });

      // Use the improved waiting mechanism instead of setTimeout
      waitForElementsAndWire(payloadId, helpers, refreshDoc);
    };

    const refreshDoc = async () => {
      payload = await getPayload(payloadId, type);
      render();
    };

    render();
  }

  window.Notifications.register("accreditation", handler);
  window.Notifications.register("reaccreditation", handler);
})();