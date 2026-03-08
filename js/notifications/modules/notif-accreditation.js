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

  const API_BASE = "php/notification.php"; // reviewer actions + payload loader
  // If your reupload endpoint lives elsewhere, change this:
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

  // For uploads (multipart/form-data)
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

    // Support both conventions: {success:true} or {ok:true}
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
    if (s === "accepted") return `<span class="badge text-bg-success">Accepted</span>`;
    if (s === "returned") return `<span class="badge text-bg-warning">Returned</span>`;
    if (s === "submitted") return `<span class="badge text-bg-secondary">Submitted</span>`;
    if (s === "pending") return `<span class="badge text-bg-secondary">Pending</span>`;
    if (s === "recommended") return `<span class="badge text-bg-info">Recommended</span>`;
    if (s === "approved") return `<span class="badge text-bg-primary">Approved</span>`;
    if (s === "active") return `<span class="badge text-bg-success">Active</span>`;
    if (s === "rejected") return `<span class="badge text-bg-danger">Rejected</span>`;
    return `<span class="badge text-bg-secondary">${esc(status || "—")}</span>`;
  }

  /* =========================
     Wide modal styling
     ========================= */
  function ensureWideModalStyles() {
    if (document.getElementById("accWideModalStyles")) return;
    const style = document.createElement("style");
    style.id = "accWideModalStyles";
    style.textContent = `
      /* widen accreditation notification detail modal */
      #notifDetailModal .modal-dialog { max-width: 1100px; }
      @media (max-width: 1199.98px) {
        #notifDetailModal .modal-dialog { max-width: 95vw; margin-left: auto; margin-right: auto; }
      }

      /* widen confirm modal (accActionModal) */
      #accActionModal .modal-dialog { max-width: 980px; }
      @media (max-width: 991.98px) {
        #accActionModal .modal-dialog { max-width: 95vw; margin-left: auto; margin-right: auto; }
      }

      /* reupload controls inside table */
      .acc-reupload-wrap { display:flex; gap:.5rem; align-items:center; justify-content:flex-end; flex-wrap:wrap; }
      .acc-reupload-wrap input[type="file"]{ max-width: 240px; }
    `;
    document.head.appendChild(style);
  }

  /* =========================
     Confirm modal helpers
     ========================= */
  function ensureActionModal() {
    ensureWideModalStyles();

    let el = document.getElementById("accActionModal");
    if (el) return el;

    const wrap = document.createElement("div");
    wrap.innerHTML = `
      <div class="modal fade" id="accActionModal" tabindex="-1" aria-hidden="true">
        <div class="modal-dialog modal-dialog-centered modal-xl">
          <div class="modal-content">
            <div class="modal-header">
              <h5 class="modal-title" id="accActionTitle">Confirm</h5>
              <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
            </div>

            <div class="modal-body">
              <div class="mb-2" id="accActionMessage">Proceed?</div>

              <div class="mb-2" id="accActionNoteWrap" style="display:none;">
                <label class="form-label mb-1" for="accActionNote">Note</label>
                <textarea class="form-control" id="accActionNote" rows="4" placeholder=""></textarea>
                <div class="form-text" id="accActionHint"></div>
              </div>

              <div class="alert alert-danger py-2 mb-0" id="accActionInlineErr" style="display:none;"></div>
            </div>

            <div class="modal-footer">
              <button type="button" class="btn btn-outline-secondary" data-bs-dismiss="modal" id="accActionCancel">
                Cancel
              </button>
              <button type="button" class="btn btn-primary" id="accActionOk">
                Confirm
              </button>
            </div>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(wrap.firstElementChild);
    return document.getElementById("accActionModal");
  }

  function showInlineActionModal(opts) {
    return new Promise((resolve) => {
      const modalEl = ensureActionModal();
      const titleEl = modalEl.querySelector("#accActionTitle");
      const msgEl = modalEl.querySelector("#accActionMessage");
      const okBtn = modalEl.querySelector("#accActionOk");
      const noteWrap = modalEl.querySelector("#accActionNoteWrap");
      const noteEl = modalEl.querySelector("#accActionNote");
      const hintEl = modalEl.querySelector("#accActionHint");
      const errEl = modalEl.querySelector("#accActionInlineErr");

      const noteEnabled = !!opts?.note?.enabled;
      const noteRequired = !!opts?.note?.required;

      titleEl.textContent = String(opts?.title || "Confirm");
      msgEl.innerHTML = String(opts?.message || "Proceed?");
      okBtn.textContent = String(opts?.okText || "Confirm");

      okBtn.className = "btn";
      okBtn.classList.add(opts?.okClass ? opts.okClass : "btn-primary");

      noteWrap.style.display = noteEnabled ? "" : "none";
      if (noteEnabled) {
        modalEl.querySelector('label[for="accActionNote"]').textContent = String(opts?.note?.label || "Note");
        noteEl.placeholder = String(opts?.note?.placeholder || "");
        noteEl.value = String(opts?.note?.value || "");
        hintEl.textContent = String(opts?.note?.hint || "");
      } else {
        noteEl.value = "";
      }

      errEl.style.display = "none";
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
          const v = String(noteEl.value || "").trim();
          if (!v) {
            errEl.textContent = "Note is required.";
            errEl.style.display = "";
            noteEl.focus();
            return;
          }
        }
        modal.hide();
        cleanup();
        resolve({ ok: true, note: String(noteEl.value || "").trim() });
      };

      setTimeout(() => {
        if (noteEnabled) noteEl.focus();
      }, 150);
    });
  }

  function showOpSuccess(message) { safeShowSuccess(message || "Success."); }
  function showOpError(message) { safeShowError(message || "Something went wrong."); }

  // NEW: Function to close the notification panel
  function closeNotificationPanel() {
    // Find and close the notification panel
    const panel = document.getElementById('notifPanel');
    const overlay = document.getElementById('notifOverlay');
    const bellButton = document.getElementById('bellButton');
    const bellIcon = document.getElementById('bellIcon');
    
    if (panel && panel.classList.contains('open')) {
      panel.classList.remove('open');
      panel.setAttribute('aria-hidden', 'true');
      
      if (overlay) {
        overlay.classList.remove('show');
        setTimeout(() => { overlay.hidden = true; }, 200);
      }
      
      if (bellButton) {
        bellButton.setAttribute('aria-expanded', 'false');
        bellButton.focus();
      }
      
      if (bellIcon) {
        bellIcon.classList.remove('bi-bell-fill');
        bellIcon.classList.add('bi-bell');
      }
      
      document.body.style.overflow = '';
    }
  }

  function buildHtml(payload) {
    ensureWideModalStyles();

    const req = payload?.request || {};
    const docs = Array.isArray(payload?.documents) ? payload.documents : [];
    const caps = payload?.capabilities || {};

    const roleRaw = String(caps.role || "").toLowerCase().trim();
    const isSuperAdmin = roleRaw === "super_admin";

    // request status -> used to hide Activate if already Active
    const reqStatusRaw = String(req.status || "").toLowerCase().trim();
    const isAlreadyActive = reqStatusRaw === "active";

    // Base permissions from backend
    const canReview = !!caps.can_review_docs;
    const canRecommend = !!caps.can_recommend;
    const canSuper = !!caps.can_super_actions;

    // NEW: allow reupload UI (typically for request owner / org officer / coordinator etc.)
    // Your backend should return this flag. If not present, it defaults false.
    const canReupload = !!caps.can_reupload_docs;

    // UI rule: for super_admin, hide accept/return (docs + bulk),
    // and hide request buttons return/reject/approve, but KEEP activate (unless already active).
    const canReviewUI = canReview && !isSuperAdmin;

    const roleLabel = roleRaw.replaceAll("_", " ") || "—";
    const term = `${esc(req.school_year || "—")} - ${esc(req.semester || "—")}`;
    const coordinator = fullName(req, "coord");
    const moderator = fullName(req, "mod");

    // IMPORTANT CHANGE:
    // Put "Open full page" INSIDE the modal body as well (not only via helpers.setActionButton),
    // so ALL roles will always see it even if notifications-core filters header actions.
    const openFullBtn = `
      <button type="button" class="btn btn-outline-primary btn-sm"
              data-acc-open-full="1">
        <i class="bi bi-box-arrow-up-right me-1"></i> Open full page
      </button>
    `;

    const requestActions = (canRecommend || canSuper) ? `
      <div class="d-flex flex-wrap gap-2 align-items-center mb-3 p-2 bg-light rounded-3">
        <div class="me-auto small text-muted">
          <strong>Role:</strong> ${esc(roleLabel)}
        </div>

        ${openFullBtn}

        ${(!isSuperAdmin && canRecommend) ? `
          <button type="button" class="btn btn-outline-secondary btn-sm"
                  data-acc-req-action="return">
            <i class="bi bi-arrow-counterclockwise me-1"></i> Return
          </button>
          <button type="button" class="btn btn-info btn-sm text-white"
                  data-acc-req-action="recommend">
            <i class="bi bi-send-check me-1"></i> Recommend
          </button>
        ` : ""}

        ${canSuper ? `
          ${!isSuperAdmin ? `
            <button type="button" class="btn btn-primary btn-sm"
                    data-acc-req-action="approve">
              <i class="bi bi-check2-circle me-1"></i> Approve
            </button>
          ` : ""}

          ${!isAlreadyActive ? `
            <button type="button" class="btn btn-success btn-sm"
                    data-acc-req-action="activate">
              <i class="bi bi-lightning-charge me-1"></i> Activate
            </button>
          ` : ""}

          ${!isSuperAdmin ? `
            <button type="button" class="btn btn-danger btn-sm"
                    data-acc-req-action="reject">
              <i class="bi bi-x-circle me-1"></i> Reject
            </button>
          ` : ""}
        ` : ""}
      </div>
    ` : `
      <div class="d-flex flex-wrap gap-2 align-items-center mb-3 p-2 bg-light rounded-3">
        <div class="me-auto small text-muted">
          <strong>Role:</strong> ${esc(roleLabel)}
        </div>
        ${openFullBtn}
      </div>
    `;

    const header = `
      <div class="mb-2">
        <div class="d-flex flex-wrap gap-2 align-items-center">
          <div><strong>Status:</strong> ${badge(req.status || "—")}</div>
          <div class="text-muted small ms-auto">
            <span><strong>Request ID:</strong> ${esc(req.id || "—")}</span>
          </div>
        </div>
        <div class="mt-2"><strong>Term:</strong> ${term}</div>
        <div><strong>Organization:</strong> ${esc(req.org_name || "—")}</div>
        <div><strong>Scope:</strong> ${esc(req.scope || "—")} <span class="mx-2">•</span> <strong>Type:</strong> ${esc(req.org_type || "—")}</div>
        <div style="display:none;"><strong>Coordinator:</strong> ${esc(coordinator)} <span class="mx-2">•</span> <strong>Moderator:</strong> ${esc(moderator)}</div>
      </div>
      ${requestActions}
    `;

    const bulkToolbar = canReviewUI ? `
      <div class="d-flex justify-content-between align-items-center mb-2 p-2 bg-light rounded-3"
           id="accBulkToolbar" style="display:none;">
        <div class="text-muted small">
          <span id="accBulkCount">0</span> selected
        </div>
        <div class="d-flex gap-2">
          <button type="button" class="btn btn-success btn-sm" id="accBulkAccept" disabled>
            <i class="bi bi-check-circle me-1"></i> Accept Selected
          </button>
          <button type="button" class="btn btn-warning btn-sm" id="accBulkReturn" disabled>
            <i class="bi bi-arrow-counterclockwise me-1"></i> Return Selected
          </button>
          <button type="button" class="btn btn-outline-secondary btn-sm" id="accBulkClear">
            <i class="bi bi-x-circle me-1"></i> Clear
          </button>
        </div>
      </div>
    ` : "";

    const tableRows = docs.map((d) => {
      const docId = Number(d.id || 0);
      const fileUrl = d.file_url ? esc(d.file_url) : (d.file_path ? esc(d.file_path) : "");
      const docStatus = String(d.status || "");
      const s = String(docStatus || "").toLowerCase().trim();
      const isSubmitted = s === "submitted";
      const isReturned = s === "returned";

      // only submitted docs are actionable/selectable (and NOT for super_admin)
      const selectable = canReviewUI && docId > 0 && isSubmitted;

      const checkbox = canReviewUI ? `
        <input type="checkbox"
               class="form-check-input acc-doc-check"
               data-acc-doc-check="${esc(String(docId))}"
               ${selectable ? "" : "disabled"}
               aria-label="Select document ${esc(d.requirement_name || "")}">
      ` : "";

      const viewBtn = fileUrl
        ? `<a href="${fileUrl}" target="_blank" rel="noopener" class="btn btn-sm btn-outline-secondary">View</a>`
        : `<button type="button" class="btn btn-sm btn-outline-secondary" disabled>No file</button>`;

      // accept/return hidden for super_admin via canReviewUI
      const reviewBtns = canReviewUI ? `
        <button type="button" class="btn btn-sm btn-success ms-1"
                data-acc-review="accept" data-acc-doc="${esc(String(docId))}"
                ${isSubmitted ? "" : "disabled"}>
          Accept
        </button>
        <button type="button" class="btn btn-sm btn-warning ms-1"
                data-acc-review="return" data-acc-doc="${esc(String(docId))}"
                ${isSubmitted ? "" : "disabled"}>
          Return
        </button>
      ` : "";

      // reupload UI (only when returned + capability enabled)
      const reqId = Number(req.id || 0);
      const requirementId = Number(
        d.requirement_id || d.requirement_template_id || d.template_requirement_id || d.requirement || 0
      );

      const reuploadUI = (canReupload && isReturned && reqId > 0 && requirementId > 0) ? `
        <div class="acc-reupload-wrap mt-1">
          <input type="file"
                 class="form-control form-control-sm acc-reupload-file"
                 data-acc-reupload-file="${esc(String(docId))}"
                 accept=".pdf,.png,.jpg,.jpeg,.doc,.docx"
                 aria-label="Choose file to reupload">
          <button type="button"
                  class="btn btn-sm btn-outline-primary"
                  data-acc-reupload="1"
                  data-acc-doc="${esc(String(docId))}"
                  data-acc-request-id="${esc(String(reqId))}"
                  data-acc-requirement-id="${esc(String(requirementId))}">
            Reupload
          </button>
        </div>
      ` : "";

      const reason = d.return_reason
        ? `<div class="small text-muted mt-1"><strong>Reason:</strong> ${esc(d.return_reason)}</div>`
        : "";

      const actionsWidth = canReviewUI ? "width:320px;" : "width:220px;";

      return `
        <tr>
          ${canReviewUI ? `<td style="width:40px;" class="text-center">${checkbox}</td>` : ""}
          <td>${esc(d.requirement_name || "—")}${reason}</td>
          <td>${badge(docStatus || "Submitted")}</td>
          <td class="text-end" style="${actionsWidth}">
            ${viewBtn}
            ${reviewBtns}
            ${reuploadUI}
          </td>
        </tr>
      `;
    }).join("");

    const tableHead = canReviewUI ? `
      <thead class="table-light">
        <tr>
          <th style="width:40px;" class="text-center">
            <input type="checkbox" class="form-check-input" id="accSelectAll" aria-label="Select all">
          </th>
          <th>Requirement</th>
          <th style="width:140px;">Status</th>
          <th style="width:320px;" class="text-end">Actions</th>
        </tr>
      </thead>
    ` : `
      <thead class="table-light">
        <tr>
          <th>Requirement</th>
          <th style="width:140px;">Status</th>
          <th style="width:220px;" class="text-end">Actions</th>
        </tr>
      </thead>
    `;

    const table = `
      ${bulkToolbar}
      <div class="table-responsive mt-2">
        <table class="table table-sm align-middle mb-0">
          ${tableHead}
          <tbody>
            ${tableRows || `<tr><td colspan="${canReviewUI ? 4 : 3}" class="text-center text-muted py-3">No documents found.</td></tr>`}
          </tbody>
        </table>
      </div>
      ${canReviewUI ? `
        <div class="small text-muted mt-2">
          Tip: Only <strong>Submitted</strong> documents can be accepted/returned.
        </div>
      ` : ``}
      ${canReupload ? `
        <div class="small text-muted mt-1">
          Tip: You can reupload only <strong>Returned</strong> documents.
        </div>
      ` : ``}
    `;

    return header + table;
  }

  // UPDATED: Close panel before navigating
  function gotoAccreditation(payloadId) {
    // Close the notification panel first
    closeNotificationPanel();
    
    window.dispatchEvent(new CustomEvent("notif:openAccreditation", {
      detail: { requestId: payloadId || "" }
    }));
    const accredLink = document.querySelector('.sidebar-link[data-section="manage-accreditation"]');
    if (accredLink) accredLink.click();
  }

  function getSelectedDocIds(bodyEl) {
    return Array.from(bodyEl.querySelectorAll(".acc-doc-check"))
      .filter((cb) => cb && !cb.disabled && cb.checked)
      .map((cb) => Number(cb.getAttribute("data-acc-doc-check") || 0))
      .filter((n) => Number.isInteger(n) && n > 0);
  }

  function updateBulkUI(bodyEl) {
    const toolbar = bodyEl.querySelector("#accBulkToolbar");
    const countEl = bodyEl.querySelector("#accBulkCount");
    const btnAccept = bodyEl.querySelector("#accBulkAccept");
    const btnReturn = bodyEl.querySelector("#accBulkReturn");
    const btnClear = bodyEl.querySelector("#accBulkClear");
    const selectAll = bodyEl.querySelector("#accSelectAll");
    const checks = Array.from(bodyEl.querySelectorAll(".acc-doc-check"));

    // If toolbar doesn't exist (e.g. super_admin or no review perms), nothing to update
    if (!toolbar || !countEl || !btnAccept || !btnReturn || !btnClear || !selectAll) return;

    const enabledChecks = checks.filter((c) => c && !c.disabled);
    const selected = enabledChecks.filter((c) => c.checked);
    const selectedCount = selected.length;

    toolbar.style.display = selectedCount > 0 ? "flex" : "none";
    countEl.textContent = String(selectedCount);

    btnAccept.disabled = selectedCount === 0;
    btnReturn.disabled = selectedCount === 0;

    // disable bulk buttons if none selectable
    const hasSelectable = enabledChecks.length > 0;
    if (!hasSelectable) {
      btnAccept.disabled = true;
      btnReturn.disabled = true;
    }

    if (enabledChecks.length === 0) {
      selectAll.checked = false;
      selectAll.indeterminate = false;
      selectAll.disabled = true;
    } else {
      selectAll.disabled = false;
      selectAll.checked = selectedCount > 0 && selectedCount === enabledChecks.length;
      selectAll.indeterminate = selectedCount > 0 && selectedCount < enabledChecks.length;
    }
  }

  function wireModalActions(payloadId, type, helpers, refreshDoc) {
    const bodyEl = document.getElementById("notifDetailBody");
    if (!bodyEl) return;

    if (bodyEl.dataset.accWired === "1") return;
    bodyEl.dataset.accWired = "1";

    // Always-available "Open full page" button inside body
    bodyEl.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-acc-open-full]");
      if (!btn) return;

      const modalEl = document.getElementById("notifDetailModal");
      if (modalEl) bootstrap.Modal.getInstance(modalEl)?.hide();
      gotoAccreditation(payloadId);
    });

    // Single doc accept/return (ONLY if submitted)
    bodyEl.addEventListener("click", async (e) => {
      const btn = e.target.closest("[data-acc-review]");
      if (!btn) return;
      if (btn.disabled) return;

      const decision = String(btn.getAttribute("data-acc-review") || "").toLowerCase();
      const docId = Number(btn.getAttribute("data-acc-doc") || 0);
      if (!docId) return;

      // enforce submitted-only at click time too
      const row = btn.closest("tr");
      const statusText = row?.querySelector("td:nth-child(3) .badge")?.textContent || "";
      const isSubmitted = String(statusText || "").toLowerCase().includes("submitted");
      if (!isSubmitted) return;

      const isReturn = decision === "return";
      const confirm = await showInlineActionModal({
        title: isReturn ? "Return Document" : "Accept Document",
        message: isReturn
          ? "Provide a return reason for this document."
          : "Are you sure you want to accept this document?",
        okText: isReturn ? "Return" : "Accept",
        okClass: isReturn ? "btn-warning" : "btn-success",
        note: {
          enabled: true,
          required: isReturn,
          label: isReturn ? "Return reason" : "Note (optional)",
          placeholder: isReturn ? "Type reason..." : "Optional note...",
          hint: isReturn ? "Required." : ""
        }
      });
      if (!confirm.ok) return;

      btn.disabled = true;

      try {
        await postForm({
          action: "review_doc",
          doc_id: String(docId),
          decision,
          reason: confirm.note
        });
        showOpSuccess(isReturn ? "Document returned." : "Document accepted.");
        await refreshDoc();
      } catch (err) {
        console.error("[NotifAccreditation] review_doc error:", err);
        showOpError(err?.message || "Failed to update document.");
      } finally {
        btn.disabled = false;
      }
    });

    // Reupload returned doc (multipart)
    bodyEl.addEventListener("click", async (e) => {
      const btn = e.target.closest("[data-acc-reupload]");
      if (!btn) return;
      if (btn.disabled) return;

      const docId = Number(btn.getAttribute("data-acc-doc") || 0);
      const requestId = Number(btn.getAttribute("data-acc-request-id") || 0);
      const requirementId = Number(btn.getAttribute("data-acc-requirement-id") || 0);
      if (!docId || !requestId || !requirementId) {
        showOpError("Missing request/requirement info for reupload.");
        return;
      }

      const row = btn.closest("tr") || bodyEl;
      const fileInput =
        row.querySelector(`.acc-reupload-file[data-acc-reupload-file="${String(docId)}"]`) ||
        row.querySelector(".acc-reupload-file");

      const file = fileInput?.files?.[0] || null;
      if (!file) {
        showOpError("Please choose a file first.");
        return;
      }

      const confirm = await showInlineActionModal({
        title: "Reupload Document",
        message: "This will replace the returned document and set it back to Pending/Submitted depending on your backend rule.",
        okText: "Reupload",
        okClass: "btn-outline-primary",
        note: { enabled: false, required: false }
      });
      if (!confirm.ok) return;

      btn.disabled = true;

      try {
        const fd = new FormData();
        fd.append("action", "accreditation_reupload_doc");
        fd.append("request_id", String(requestId));
        fd.append("requirement_id", String(requirementId));
        fd.append("file", file);

        await postMultipart(fd);

        showOpSuccess("Reupload successful.");
        if (fileInput) fileInput.value = "";
        await refreshDoc();
      } catch (err) {
        console.error("[NotifAccreditation] reupload error:", err);
        showOpError(err?.message || "Reupload failed.");
      } finally {
        btn.disabled = false;
      }
    });

    // Request actions (modals)
    bodyEl.addEventListener("click", async (e) => {
      const btn = e.target.closest("[data-acc-req-action]");
      if (!btn) return;

      const doAction = String(btn.getAttribute("data-acc-req-action") || "").toLowerCase();
      if (!doAction) return;

      const isReject = doAction === "reject";
      const isReturn = doAction === "return";
      const isRecommend = doAction === "recommend";
      const isApprove = doAction === "approve";
      const isActivate = doAction === "activate";

      const cfg = (() => {
        if (isReject) {
          return {
            title: "Reject Request",
            message: "Provide a rejection reason for this accreditation request.",
            okText: "Reject",
            okClass: "btn-danger",
            note: { enabled: true, required: true, label: "Rejection reason", placeholder: "Type reason...", hint: "Required." }
          };
        }
        if (isReturn) {
          return {
            title: "Return Request",
            message: "Provide a return note / reason for this accreditation request.",
            okText: "Return",
            okClass: "btn-outline-secondary",
            note: { enabled: true, required: true, label: "Return note / reason", placeholder: "Type note...", hint: "Required." }
          };
        }
        if (isRecommend) {
          return {
            title: "Recommend Request",
            message: "Add a note for recommendation (optional), then confirm.",
            okText: "Recommend",
            okClass: "btn-info",
            note: { enabled: true, required: false, label: "Recommendation note (optional)", placeholder: "Optional note...", hint: "" }
          };
        }
        if (isApprove) {
          return {
            title: "Approve Request",
            message: "Optional note, then confirm approval.",
            okText: "Approve",
            okClass: "btn-primary",
            note: { enabled: true, required: false, label: "Approval note (optional)", placeholder: "Optional note...", hint: "" }
          };
        }
        if (isActivate) {
          return {
            title: "Activate Request",
            message: "Optional note, then confirm activation.",
            okText: "Activate",
            okClass: "btn-success",
            note: { enabled: true, required: false, label: "Activation note (optional)", placeholder: "Optional note...", hint: "" }
          };
        }
        return {
          title: "Confirm",
          message: "Proceed?",
          okText: "Confirm",
          okClass: "btn-primary",
          note: { enabled: false, required: false }
        };
      })();

      const confirm = await showInlineActionModal(cfg);
      if (!confirm.ok) return;

      btn.disabled = true;

      try {
        await postForm({
          action: "request_action",
          request_id: String(payloadId),
          do: doAction,
          note: confirm.note
        });

        const msg =
          isRecommend ? "Request recommended." :
          isReturn ? "Request returned." :
          isApprove ? "Request approved." :
          isActivate ? "Request activated." :
          isReject ? "Request rejected." :
          "Request updated.";

        showOpSuccess(msg);
        await refreshDoc();
      } catch (err) {
        console.error("[NotifAccreditation] request_action error:", err);
        showOpError(err?.message || "Failed to update request.");
      } finally {
        btn.disabled = false;
      }
    });

    // Checkbox changes
    bodyEl.addEventListener("change", (e) => {
      const cb = e.target;
      if (cb && (cb.classList?.contains("acc-doc-check") || cb.id === "accSelectAll")) {
        const selectAll = bodyEl.querySelector("#accSelectAll");
        const checks = Array.from(bodyEl.querySelectorAll(".acc-doc-check")).filter((c) => !c.disabled);

        if (cb.id === "accSelectAll" && selectAll) {
          const on = !!selectAll.checked;
          checks.forEach((c) => { c.checked = on; });
        }

        updateBulkUI(bodyEl);
      }
    });

    // Bulk buttons (ONLY submitted selectable)
    bodyEl.addEventListener("click", async (e) => {
      const bAccept = e.target.closest("#accBulkAccept");
      const bReturn = e.target.closest("#accBulkReturn");
      const bClear = e.target.closest("#accBulkClear");
      if (!bAccept && !bReturn && !bClear) return;

      if (bClear) {
        Array.from(bodyEl.querySelectorAll(".acc-doc-check")).forEach((c) => { c.checked = false; });
        const sa = bodyEl.querySelector("#accSelectAll");
        if (sa) { sa.checked = false; sa.indeterminate = false; }
        updateBulkUI(bodyEl);
        return;
      }

      const ids = getSelectedDocIds(bodyEl);
      if (!ids.length) return;

      const decision = bAccept ? "accept" : "return";

      const confirm = await showInlineActionModal({
        title: decision === "accept" ? "Accept Selected" : "Return Selected",
        message: decision === "accept"
          ? `Accept ${ids.length} selected submitted document(s)?`
          : `Provide a return reason for ${ids.length} submitted document(s).`,
        okText: decision === "accept" ? "Accept" : "Return",
        okClass: decision === "accept" ? "btn-success" : "btn-warning",
        note: {
          enabled: true,
          required: decision === "return",
          label: decision === "return" ? "Return reason" : "Note (optional)",
          placeholder: decision === "return" ? "Type reason..." : "Optional note...",
          hint: decision === "return" ? "Required." : ""
        }
      });
      if (!confirm.ok) return;

      const btnAccept = bodyEl.querySelector("#accBulkAccept");
      const btnReturn = bodyEl.querySelector("#accBulkReturn");
      const btnClear2 = bodyEl.querySelector("#accBulkClear");
      if (btnAccept) btnAccept.disabled = true;
      if (btnReturn) btnReturn.disabled = true;
      if (btnClear2) btnClear2.disabled = true;

      try {
        await postForm({
          action: "bulk_review_docs",
          decision,
          reason: confirm.note,
          doc_ids: ids.join(",")
        });

        showOpSuccess(decision === "accept"
          ? "Selected submitted documents accepted."
          : "Selected submitted documents returned."
        );

        await refreshDoc();
      } catch (err) {
        console.error("[NotifAccreditation] bulk_review_docs error:", err);
        showOpError(err?.message || "Bulk action failed.");
      } finally {
        if (btnAccept) btnAccept.disabled = false;
        if (btnReturn) btnReturn.disabled = false;
        if (btnClear2) btnClear2.disabled = false;
      }
    });
  }

  async function handler(notif, meta, helpers) {
    const payloadId = meta?.payloadId || notif?.payload_id || "";
    const type = (meta?.type || notif?.notif_type || "accreditation").toLowerCase();

    helpers.openDetailModal({
      title: notif?.title || "Accreditation",
      body: "Loading accreditation details...",
      meta: ""
    });

    let payload;
    try {
      payload = await getPayload(payloadId, type);
    } catch (err) {
      helpers.openDetailModal({
        title: notif?.title || "Accreditation",
        body: err?.message || "Failed to load accreditation details.",
        meta: ""
      });
      return;
    }

    const render = () => {
      helpers.openDetailModal({
        title: notif?.title || "Accreditation",
        body_html: buildHtml(payload),
        meta: notif?.created_at ? `Received: ${notif.created_at}` : ""
      });

      // Keep this too (if core shows it, nice),
      // but we ALSO added an in-body button so all roles always have it.
      helpers.setActionButton({
        text: "Open full page",
        onClick: () => {
          const modalEl = document.getElementById("notifDetailModal");
          if (modalEl) bootstrap.Modal.getInstance(modalEl)?.hide();
          gotoAccreditation(payloadId);
        }
      });

      const bodyEl = document.getElementById("notifDetailBody");
      if (bodyEl) updateBulkUI(bodyEl);
    };

    const refreshDoc = async () => {
      payload = await getPayload(payloadId, type);
      render();
      const bodyEl = document.getElementById("notifDetailBody");
      if (bodyEl) bodyEl.dataset.accWired = "1";
    };

    render();
    wireModalActions(payloadId, type, helpers, refreshDoc);
  }

  window.Notifications.register("accreditation", handler);
  window.Notifications.register("reaccreditation", handler);

})();
//moderator