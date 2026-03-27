/* js/accreditation/special/accreditation.js */
/* global bootstrap, showSuccess, showError */

(function () {
  "use strict";

  // ✅ Change this if your PHP endpoint name is different
  const API_URL = "php/accreditation-special.php";

  // -------------------------
  // Tiny helpers
  // -------------------------
  function qs(sel, root = document) {
    return root.querySelector(sel);
  }
  function qsa(sel, root = document) {
    return Array.from(root.querySelectorAll(sel));
  }
  function escapeHtml(s) {
    return String(s ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }
  function debounce(fn, ms) {
    let t = null;
    return function (...args) {
      clearTimeout(t);
      t = setTimeout(() => fn.apply(this, args), ms);
    };
  }

  // -------------------------
  // Simple event bus
  // -------------------------
  const bus = {
    _m: new Map(),
    on(evt, fn) {
      if (!this._m.has(evt)) this._m.set(evt, new Set());
      this._m.get(evt).add(fn);
      return () => this.off(evt, fn);
    },
    off(evt, fn) {
      const s = this._m.get(evt);
      if (s) s.delete(fn);
    },
    emit(evt, payload) {
      const s = this._m.get(evt);
      if (!s) return;
      for (const fn of s) {
        try {
          fn(payload);
        } catch (e) {
          console.error(e);
        }
      }
    },
  };

  // -------------------------
  // Shared store
  // -------------------------
  const store = {
    _root: null, // last init root

    search: "",
    terms: [],

    // Updated: Removed semester from pending and active
    pending: {
      items: [],
      page: 1,
      perPage: 10,
      total: 0,
      status: "Pending",
      termId: "",
      year: "", // Only year filter now
    },
    active: {
      items: [],
      page: 1,
      perPage: 10,
      total: 0,
      termId: "",
      year: "", // Only year filter now
    },
    
    // ✅ NEW: Added recommended store
    recommended: {
      items: [],
      page: 1,
      perPage: 10,
      total: 0,
      termId: "",
      year: "", // Only year filter for recommended
    },

    reqs: { items: [], page: 1, perPage: 10, total: 0, status: "Active" },
    // templatesByReq[reqId] = { items, page, perPage, total, loaded }
    templatesByReq: {},
  };

  // Helper to always query within the current injected page root
  function rqs(sel) {
    return qs(sel, store._root || document);
  }
  function rqsa(sel) {
    return qsa(sel, store._root || document);
  }

  // -------------------------
  // Global UX helpers (root-aware)
  // -------------------------
  function safeShowError(msg) {
    if (typeof window.showError === "function") return window.showError(msg);

    const m = rqs("#saErrorModal");
    if (m && window.bootstrap) {
      const body = m.querySelector("[data-role='message']");
      if (body) body.textContent = msg || "Something went wrong.";
      bootstrap.Modal.getOrCreateInstance(m).show();
      return;
    }

    alert(msg || "Something went wrong.");
  }

  function safeShowSuccess(msg) {
    if (typeof window.showSuccess === "function") return window.showSuccess(msg);

    const m = rqs("#saSuccessModal");
    if (m && window.bootstrap) {
      const body = m.querySelector("[data-role='message']");
      if (body) body.textContent = msg || "Done.";
      bootstrap.Modal.getOrCreateInstance(m).show();
      return;
    }

    alert(msg || "Done.");
  }

  // -------------------------
  // Networking
  // -------------------------
  async function postJSON(payload) {
    const res = await fetch(API_URL, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload || {}),
    });

    const txt = await res.text();
    let data;
    try {
      data = JSON.parse(txt);
    } catch (e) {
      throw new Error("Invalid JSON from server.\n\n" + txt.slice(0, 500));
    }

    if (!res.ok || data?.ok === false) {
      throw new Error(data?.error || `Request failed (${res.status})`);
    }
    return data;
  }

  // -------------------------
  // Pagination renderer (Bootstrap)
  // -------------------------
  function renderPagination(ulEl, metaEl, page, perPage, total, onPageClick) {
    if (!ulEl) return;

    const p = Math.max(1, Number(page || 1));
    const pp = Math.max(1, Number(perPage || 10));
    const t = Math.max(0, Number(total || 0));

    const totalPages = Math.max(1, Math.ceil(t / pp));
    const cur = Math.min(p, totalPages);

    if (metaEl) {
      if (!t) metaEl.textContent = "";
      else {
        const from = (cur - 1) * pp + 1;
        const to = Math.min(cur * pp, t);
        metaEl.textContent = `Showing ${from}-${to} of ${t}`;
      }
    }

    ulEl.innerHTML = "";

    function li(label, disabled, active, goPage, ariaLabel) {
      const item = document.createElement("li");
      item.className =
        "page-item" + (disabled ? " disabled" : "") + (active ? " active" : "");
      const a = document.createElement("a");
      a.className = "page-link";
      a.href = "#";
      a.textContent = label;
      if (ariaLabel) a.setAttribute("aria-label", ariaLabel);
      a.addEventListener("click", (e) => {
        e.preventDefault();
        if (disabled || active) return;
        onPageClick(goPage);
      });
      item.appendChild(a);
      return item;
    }

    // Prev
    ulEl.appendChild(li("‹", cur <= 1, false, cur - 1, "Previous"));

    const windowSize = 2;
    let start = Math.max(1, cur - windowSize);
    let end = Math.min(totalPages, cur + windowSize);

    while (end - start < windowSize * 2 && (start > 1 || end < totalPages)) {
      if (start > 1) start--;
      else if (end < totalPages) end++;
      else break;
    }

    if (start > 1) {
      ulEl.appendChild(li("1", false, cur === 1, 1));
      if (start > 2) {
        const dots = document.createElement("li");
        dots.className = "page-item disabled";
        dots.innerHTML = '<span class="page-link">…</span>';
        ulEl.appendChild(dots);
      }
    }

    for (let i = start; i <= end; i++) {
      ulEl.appendChild(li(String(i), false, i === cur, i));
    }

    if (end < totalPages) {
      if (end < totalPages - 1) {
        const dots = document.createElement("li");
        dots.className = "page-item disabled";
        dots.innerHTML = '<span class="page-link">…</span>';
        ulEl.appendChild(dots);
      }
      ulEl.appendChild(li(String(totalPages), false, cur === totalPages, totalPages));
    }

    // Next
    ulEl.appendChild(li("›", cur >= totalPages, false, cur + 1, "Next"));
  }

// -------------------------
// Accept Document Modal Functions
// -------------------------
function openAcceptDocumentModal(docId, fileName) {
  const modalEl = rqs("#saAcceptDocumentModal");
  if (!modalEl || !window.bootstrap) return;

  const hid = rqs("#saAcceptDocId");
  if (hid) hid.value = String(docId);

  const nameEl = rqs("#saAcceptDocName");
  if (nameEl) nameEl.textContent = fileName || "Document";

  // Bind confirm button if not already bound
  const confirmBtn = rqs("#saAcceptDocConfirmBtn");
  if (confirmBtn && !confirmBtn.__saBound) {
    confirmBtn.__saBound = true;
    confirmBtn.addEventListener("click", async () => {
      try {
        await postJSON({
          action: 'review_document',
          doc_id: docId,
          decision: 'accept'
        });
        
        bootstrap.Modal.getOrCreateInstance(modalEl).hide();
        safeShowSuccess(`Document "${fileName}" accepted.`);
        
        // Refresh the view modal to update document status
        const requestId = rqs("#saViewRequestId")?.value;
        if (requestId) {
          setTimeout(() => {
            // Emit event to refresh
            bus.emit('documents:reviewed', { docId, action: 'accept' });
          }, 500);
        }
        bus.emit("refresh:all");
      } catch (e) {
        safeShowError(e.message || 'Failed to accept document.');
      }
    });
  }

  bootstrap.Modal.getOrCreateInstance(modalEl).show();
}

  // -------------------------
  // Return Document Modal Functions
  // -------------------------
  function openReturnDocumentModal(docId, fileName) {
    const modalEl = rqs("#saReturnReasonModal");
    if (!modalEl || !window.bootstrap) return;

    const hid = rqs("#saReturnDocId");
    if (hid) hid.value = String(docId);

    const label = rqs("#saReturnDocLabel");
    if (label) label.textContent = fileName || `Document #${docId}`;

    const reasonEl = rqs("#saReturnReasonText");
    if (reasonEl) reasonEl.value = "";

    // Bind form submit if not already bound
    const form = rqs("#saReturnReasonForm");
    if (form && !form.__saBound) {
      form.__saBound = true;
      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        const id = rqs("#saReturnDocId")?.value;
        const reason = rqs("#saReturnReasonText")?.value?.trim();
        if (!id || !reason) return;

        try {
          await postJSON({
            action: 'return_document',
            doc_id: id,
            reason: reason
          });
          
          bootstrap.Modal.getOrCreateInstance(modalEl).hide();
          safeShowSuccess(`Document "${fileName}" returned.`);
          
          // Refresh the view modal to update document status
          const requestId = rqs("#saViewRequestId")?.value;
          if (requestId) {
            setTimeout(() => {
              // Emit event to refresh
              bus.emit('documents:reviewed', { docId: id, action: 'return' });
            }, 500);
          }
          bus.emit("refresh:all");
        } catch (err) {
          safeShowError(err.message);
        }
      });
    }

    bootstrap.Modal.getOrCreateInstance(modalEl).show();
  }

  // -------------------------
  // Preview helper with Accept/Return buttons
  // -------------------------
  function openPreview(fileUrl, fileName, docId, docStatus, requestId) {
    console.log("[Base] openPreview called with:", { fileUrl, fileName, docId, docStatus, requestId });
    
    const modalEl = rqs("#saPreviewFileModal");
    if (!modalEl || !window.bootstrap) {
      window.open(fileUrl, "_blank", "noopener");
      return;
    }

    const title = rqs("#saPreviewFileName");
    const iframe = rqs("#saPreviewIframe");
    const hint = rqs("#saPreviewHint");
    const openBtn = rqs("#saPreviewOpenNewTab");
    
    // Hidden fields for document info
    const docIdField = rqs("#saPreviewDocId");
    const docStatusField = rqs("#saPreviewDocStatus");
    const requestIdField = rqs("#saPreviewRequestId");
    const docInfo = rqs("#saPreviewDocInfo");
    
    // Action buttons
    const acceptBtn = rqs("#saPreviewAcceptBtn");
    const returnBtn = rqs("#saPreviewReturnBtn");

    if (title) title.textContent = fileName || "Preview";
    if (openBtn) openBtn.href = fileUrl || "#";
    
    // Store document info
    if (docIdField) {
      docIdField.value = docId || "";
      console.log("[Base] Set docId field to:", docIdField.value);
    }
    
    if (docStatusField) docStatusField.value = docStatus || "";
    if (requestIdField) requestIdField.value = requestId || "";
    if (docInfo) docInfo.textContent = fileName || "";

    const ext = (fileName || fileUrl || "").toLowerCase();
    const isPdf = ext.endsWith(".pdf");
    const isDocx = ext.endsWith(".docx");

    if (iframe) iframe.src = "";
    if (hint) hint.style.display = "none";

    if (isPdf) {
      if (iframe) iframe.src = fileUrl;
    } else if (isDocx) {
      if (hint) hint.style.display = "";
    } else {
      window.open(fileUrl, "_blank", "noopener");
      return;
    }

    // Check if we should show accept/return buttons based on tab context
    // Hide buttons for recommended and active tabs
    const activeTab = document.querySelector('.tab-pane.active');
    const isRecommendedTab = activeTab && activeTab.id === 'saRecommendedPane';
    const isActiveTab = activeTab && activeTab.id === 'saActivePane';
    
    if (acceptBtn && returnBtn) {
      if (isRecommendedTab || isActiveTab) {
        // Hide accept/return buttons for recommended and active tabs
        acceptBtn.style.display = 'none';
        returnBtn.style.display = 'none';
      } else {
        // Show buttons for pending tab
        acceptBtn.style.display = '';
        returnBtn.style.display = '';
        
        // Set button states based on document status
        const isAccepted = docStatus === 'Accepted';
        const isReturned = docStatus === 'Returned';
        
        acceptBtn.disabled = isAccepted || isReturned;
        acceptBtn.classList.toggle('disabled', isAccepted || isReturned);
        acceptBtn.title = isAccepted ? 'Already accepted' : (isReturned ? 'Document is returned' : 'Accept this document');
        
        returnBtn.disabled = isReturned;
        returnBtn.classList.toggle('disabled', isReturned);
        returnBtn.title = isReturned ? 'Already returned' : 'Return this document for revision';
      }
    }

    bootstrap.Modal.getOrCreateInstance(modalEl).show();
  }

  // Add event listeners for preview modal buttons
  function bindPreviewModalActions() {
    const modalEl = rqs("#saPreviewFileModal");
    if (!modalEl || modalEl.__saPreviewActionsBound) return;
    modalEl.__saPreviewActionsBound = true;
    
    const acceptBtn = rqs("#saPreviewAcceptBtn");
    const returnBtn = rqs("#saPreviewReturnBtn");
    
    if (acceptBtn && !acceptBtn.__saBound) {
      acceptBtn.__saBound = true;
      acceptBtn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        
        // Read values directly from the hidden fields
        const docId = rqs("#saPreviewDocId")?.value;
        const fileName = rqs("#saPreviewFileName")?.textContent;
        const requestId = rqs("#saPreviewRequestId")?.value;
        const docStatus = rqs("#saPreviewDocStatus")?.value;
        
        console.log("[Preview] Accept clicked - reading from fields:", { 
          docId, 
          fileName, 
          requestId, 
          docStatus,
          docIdField: rqs("#saPreviewDocId") // Log the actual element
        });
        
        if (!docId) {
          console.error("[Preview] No docId found in hidden field");
          safeShowError("Missing document information: No document ID");
          return;
        }
        
        if (!fileName) {
          safeShowError("Missing document information: No file name");
          return;
        }
        
        // Check if document is already accepted or returned
        if (docStatus === 'Accepted') {
          safeShowError("This document is already accepted");
          return;
        }
        
        if (docStatus === 'Returned') {
          safeShowError("This document is already returned");
          return;
        }
        
        // Hide preview modal
        bootstrap.Modal.getInstance(modalEl).hide();
        
        // Small delay to ensure modal is hidden
        setTimeout(() => {
          // Call the accept function directly
          if (typeof window.SAAccreditation.openAcceptDocumentModal === 'function') {
            window.SAAccreditation.openAcceptDocumentModal(docId, fileName);
          } else {
            console.error("[Preview] openAcceptDocumentModal not available");
            safeShowError("Cannot open accept modal");
          }
        }, 300);
      });
    }
    
    if (returnBtn && !returnBtn.__saBound) {
      returnBtn.__saBound = true;
      returnBtn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        
        // Read values directly from the hidden fields
        const docId = rqs("#saPreviewDocId")?.value;
        const fileName = rqs("#saPreviewFileName")?.textContent;
        const requestId = rqs("#saPreviewRequestId")?.value;
        const docStatus = rqs("#saPreviewDocStatus")?.value;
        
        console.log("[Preview] Return clicked - reading from fields:", { 
          docId, 
          fileName, 
          requestId, 
          docStatus 
        });
        
        if (!docId) {
          console.error("[Preview] No docId found in hidden field");
          safeShowError("Missing document information: No document ID");
          return;
        }
        
        if (!fileName) {
          safeShowError("Missing document information: No file name");
          return;
        }
        
        // Check if document is already returned
        if (docStatus === 'Returned') {
          safeShowError("This document is already returned");
          return;
        }
        
        // Hide preview modal
        bootstrap.Modal.getInstance(modalEl).hide();
        
        // Small delay to ensure modal is hidden
        setTimeout(() => {
          // Call the return function directly
          if (typeof window.SAAccreditation.openReturnDocumentModal === 'function') {
            window.SAAccreditation.openReturnDocumentModal(docId, fileName);
          } else {
            console.error("[Preview] openReturnDocumentModal not available");
            safeShowError("Cannot open return modal");
          }
        }, 300);
      });
    }
  }

  // -------------------------
  // Document Review Functions
  // -------------------------
  function acceptDocument(docId, fileName) {
    if (!confirm(`Accept document: ${fileName}?`)) return;
    
    postJSON({
      action: 'review_document',
      doc_id: docId,
      decision: 'accept'
    })
    .then(() => {
      safeShowSuccess(`Document "${fileName}" accepted.`);
      // Check if we should enable/disable recommendation button after document review
      bus.emit('documents:reviewed', { docId, action: 'accept' });
    })
    .catch(e => safeShowError(e.message || 'Failed to accept document.'));
  }

  function returnDocument(docId, fileName, currentReason = '') {
    const reason = prompt(`Return reason for "${fileName}":`, currentReason);
    if (reason === null) return; // User cancelled
    if (!reason.trim()) {
      safeShowError('Return reason is required.');
      return;
    }
    
    postJSON({
      action: 'return_document',
      doc_id: docId,
      reason: reason.trim()
    })
    .then(() => {
      safeShowSuccess(`Document "${fileName}" returned.`);
      // Check if we should disable recommendation button after document return
      bus.emit('documents:reviewed', { docId, action: 'return' });
    })
    .catch(e => safeShowError(e.message || 'Failed to return document.'));
  }

  // -------------------------
  // Bulk Document Review Functions (Updated with modals)
  // -------------------------
  function bulkAcceptDocuments(docIds, fileNames) {
    if (!docIds.length) return;
    
    // Get the modal elements
    const modalEl = rqs("#saBulkAcceptModal");
    if (!modalEl || !window.bootstrap) {
      // Fallback to confirm if modal not available
      if (!confirm(`Accept ${docIds.length} selected document(s)?`)) return;
      performBulkAccept(docIds);
      return;
    }
    
    // Store selected IDs temporarily
    window.__saBulkAcceptDocIds = docIds;
    
    // Update modal content
    const countEl = rqs("#saBulkAcceptCount");
    if (countEl) countEl.textContent = docIds.length;
    
    const fileListEl = rqs("#saBulkAcceptFileList");
    if (fileListEl && fileNames && fileNames.length > 0) {
      // Show first 3 files, then "and X more..."
      const maxFiles = 3;
      const filesToShow = fileNames.slice(0, maxFiles);
      let html = '<ul class="list-unstyled small mb-0">';
      filesToShow.forEach(fileName => {
        html += `<li class="mb-1"><i class="bi bi-file-earmark me-1"></i>${fileName}</li>`;
      });
      if (fileNames.length > maxFiles) {
        html += `<li class="text-muted"><em>and ${fileNames.length - maxFiles} more...</em></li>`;
      }
      html += '</ul>';
      fileListEl.innerHTML = html;
    }
    
    // Show modal
    bootstrap.Modal.getOrCreateInstance(modalEl).show();
  }

  function bulkReturnDocuments(docIds, fileNames, reason = '') {
    if (!docIds.length) return;
    
    // Always use modal for bulk return
    const modalEl = rqs("#saBulkReturnReasonModal");
    if (!modalEl || !window.bootstrap) {
      // Fallback to prompt if modal not available
      const reason = prompt(`Return reason for ${docIds.length} document(s):`, '');
      if (reason === null) return;
      if (!reason.trim()) {
        safeShowError('Return reason is required.');
        return;
      }
      performBulkReturn(docIds, reason.trim());
    } else {
      // Store selected IDs temporarily
      window.__saBulkReturnDocIds = docIds;
      
      // Update modal content
      const countEl = rqs("#saBulkReturnCount");
      if (countEl) countEl.textContent = docIds.length;
      
      const fileListEl = rqs("#saBulkReturnFileList");
      if (fileListEl && fileNames && fileNames.length > 0) {
        // Show first 3 files, then "and X more..."
        const maxFiles = 3;
        const filesToShow = fileNames.slice(0, maxFiles);
        let html = '<ul class="list-unstyled small mb-0">';
        filesToShow.forEach(fileName => {
          html += `<li class="mb-1"><i class="bi bi-file-earmark me-1"></i>${fileName}</li>`;
        });
        if (fileNames.length > maxFiles) {
          html += `<li class="text-muted"><em>and ${fileNames.length - maxFiles} more...</em></li>`;
        }
        html += '</ul>';
        fileListEl.innerHTML = html;
      } else if (fileListEl) {
        fileListEl.innerHTML = '';
      }
      
      const reasonEl = rqs("#saBulkReturnReasonText");
      if (reasonEl) reasonEl.value = reason || '';
      
      // Clear any existing error messages
      const errorEl = rqs("#saBulkReturnError");
      if (errorEl) errorEl.style.display = 'none';
      
      bootstrap.Modal.getOrCreateInstance(modalEl).show();
    }
  }

  function performBulkAccept(docIds) {
    console.log('[Bulk] Performing bulk accept for', docIds.length, 'documents');
    postJSON({
      action: 'bulk_review_documents',
      doc_ids: docIds,
      decision: 'accept'
    })
    .then(() => {
      safeShowSuccess(`${docIds.length} document(s) accepted.`);
      // Emit event to refresh documents
      bus.emit('documents:bulk-reviewed', { docIds, action: 'accept' });
      // Clear selections
      setTimeout(() => {
        if (window.__saHandleDocCheckboxChange) {
          // Trigger a UI refresh
          const event = new Event('documents:changed');
          bus.emit('documents:changed');
        }
      }, 500);
    })
    .catch(e => {
      console.error('[Bulk] Accept error:', e);
      safeShowError(e.message || 'Failed to accept documents.');
    });
  }

  function performBulkReturn(docIds, reason) {
    console.log('[Bulk] Performing bulk return for', docIds.length, 'documents');
    postJSON({
      action: 'bulk_review_documents',
      doc_ids: docIds,
      decision: 'return',
      reason: reason
    })
    .then(() => {
      safeShowSuccess(`${docIds.length} document(s) returned.`);
      // Emit event to refresh documents
      bus.emit('documents:bulk-reviewed', { docIds, action: 'return' });
      // Clear selections
      setTimeout(() => {
        if (window.__saHandleDocCheckboxChange) {
          // Trigger a UI refresh
          const event = new Event('documents:changed');
          bus.emit('documents:changed');
        }
      }, 500);
    })
    .catch(e => {
      console.error('[Bulk] Return error:', e);
      safeShowError(e.message || 'Failed to return documents.');
    });
  }

  function renderDocumentActions(doc) {
    const div = document.createElement('div');
    div.className = 'btn-group btn-group-sm';
    
    const status = doc.status || 'Submitted';
    const isAccepted = status === 'Accepted';
    const isReturned = status === 'Returned';
    
    // Accept button (show only if not already accepted)
    if (!isAccepted) {
      const acceptBtn = document.createElement('button');
      acceptBtn.className = 'btn btn-outline-success';
      acceptBtn.type = 'button';
      acceptBtn.innerHTML = '<i class="fas fa-check"></i> Accept';
      acceptBtn.title = 'Accept this document';
      acceptBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        acceptDocument(doc.id, doc.file_name || 'document');
      });
      div.appendChild(acceptBtn);
    }
    
    // Return/Reject button
    const returnBtn = document.createElement('button');
    returnBtn.className = isReturned ? 'btn btn-warning' : 'btn btn-outline-warning';
    returnBtn.type = 'button';
    returnBtn.innerHTML = isReturned ? '<i class="fas fa-undo"></i> Revise' : '<i class="fas fa-times"></i> Return';
    returnBtn.title = isReturned ? 'Request revision again' : 'Return for revision';
    returnBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const currentReason = isReturned ? (doc.return_reason || '') : '';
      returnDocument(doc.id, doc.file_name || 'document', currentReason);
    });
    div.appendChild(returnBtn);
    
    return div;
  }

  // Helper function to check if any documents are returned
  function hasReturnedDocuments(docs) {
    if (!Array.isArray(docs)) return false;
    return docs.some(doc => doc.status === 'Returned');
  }

  // Function to update recommendation button state
  function updateRecommendationButtonState(requestId, docs) {
    // Handle saSubmitRecommendationBtn
    const submitBtn = rqs(`#saSubmitRecommendationBtn[data-request-id="${requestId}"]`);
    
    // Handle saOpenRecommendationBtn (this is likely the button that opens the modal)
    const openBtn = rqs(`#saOpenRecommendationBtn[data-request-id="${requestId}"]`);
    
    const hasReturned = hasReturnedDocuments(docs);
    
    // Update submit recommendation button
    if (submitBtn) {
      if (hasReturned) {
        submitBtn.disabled = true;
        submitBtn.title = "Cannot submit recommendation: Some requirements are returned";
        submitBtn.classList.add('disabled');
      } else {
        submitBtn.disabled = false;
        submitBtn.title = "Submit recommendation for this request";
        submitBtn.classList.remove('disabled');
      }
    }
    
    // Update open recommendation button (the one that opens the modal)
    if (openBtn) {
      if (hasReturned) {
        openBtn.disabled = true;
        openBtn.title = "Cannot open recommendation form: Some requirements are returned";
        openBtn.classList.add('disabled');
        // Prevent click event if disabled
        if (!openBtn.__saOriginalClick) {
          openBtn.__saOriginalClick = openBtn.onclick;
        }
        openBtn.onclick = (e) => {
          e.preventDefault();
          safeShowError("Cannot open recommendation form: Some requirements are returned. Please accept all returned documents first.");
          return false;
        };
      } else {
        openBtn.disabled = false;
        openBtn.title = "Open recommendation form";
        openBtn.classList.remove('disabled');
        // Restore original click handler
        if (openBtn.__saOriginalClick) {
          openBtn.onclick = openBtn.__saOriginalClick;
        }
      }
    }
  }

  // Function to disable all recommendation buttons for a request
  function disableAllRecommendationButtons(requestId, reason = "Some requirements are returned") {
    // Find all buttons related to this request
    const allButtons = rqsa(`[data-request-id="${requestId}"]`);
    
    allButtons.forEach(btn => {
      const btnId = btn.id || '';
      if (btnId.includes('Recommendation') || 
          btn.classList.contains('recommendation-btn') ||
          btn.getAttribute('data-action') === 'recommend') {
        
        btn.disabled = true;
        btn.classList.add('disabled');
        btn.title = `Cannot proceed: ${reason}`;
        
        // Store original click handler and replace with warning
        if (!btn.__saOriginalClick) {
          btn.__saOriginalClick = btn.onclick;
        }
        btn.onclick = (e) => {
          e.preventDefault();
          safeShowError(`Cannot proceed: ${reason}. Please accept all returned documents first.`);
          return false;
        };
      }
    });
  }

  // Function to enable all recommendation buttons for a request
  function enableAllRecommendationButtons(requestId) {
    // Find all buttons related to this request
    const allButtons = rqsa(`[data-request-id="${requestId}"]`);
    
    allButtons.forEach(btn => {
      const btnId = btn.id || '';
      if (btnId.includes('Recommendation') || 
          btn.classList.contains('recommendation-btn') ||
          btn.getAttribute('data-action') === 'recommend') {
        
        btn.disabled = false;
        btn.classList.remove('disabled');
        btn.title = btn.getAttribute('data-original-title') || "Submit recommendation";
        
        // Restore original click handler
        if (btn.__saOriginalClick) {
          btn.onclick = btn.__saOriginalClick;
        }
      }
    });
  }

  // Function to handle bulk actions UI
  function setupBulkActions() {
    const toolbar = rqs("#saBulkActionsToolbar");
    const selectAllHeader = rqs("#saSelectAllHeader");
    const selectAllDocs = rqs("#saSelectAllDocs");
    const selectedCount = rqs("#saSelectedCount");
    const bulkAcceptBtn = rqs("#saBulkAcceptBtn");
    const bulkReturnBtn = rqs("#saBulkReturnBtn");
    const bulkClearBtn = rqs("#saBulkClearBtn");
    const bulkAcceptConfirmBtn = rqs("#saBulkAcceptConfirmBtn");
    const bulkReturnForm = rqs("#saBulkReturnReasonForm");
    
    if (!toolbar || !selectAllHeader || !selectAllDocs || !selectedCount || 
        !bulkAcceptBtn || !bulkReturnBtn || !bulkClearBtn) {
      console.log('[Bulk Actions] Missing required elements');
      return;
    }
    
    console.log('[Bulk Actions] Setting up...');
    
    // Track selected document IDs
    let selectedDocIds = [];
    
    // Update selected count and button states
    function updateBulkUI() {
      const selectedCountNum = selectedDocIds.length;
      console.log('[Bulk Actions] Updating UI, selected count:', selectedCountNum);
      selectedCount.textContent = selectedCountNum;
      
      // Show/hide toolbar
      toolbar.style.display = selectedCountNum > 0 ? 'flex' : 'none';
      
      // Enable/disable action buttons
      bulkAcceptBtn.disabled = selectedCountNum === 0;
      bulkReturnBtn.disabled = selectedCountNum === 0;
      
      // Update select all checkboxes
      const allCheckboxes = rqsa('.doc-checkbox:not(:disabled)');
      const allChecked = allCheckboxes.length > 0 && 
                        allCheckboxes.every(cb => cb.checked);
      selectAllHeader.checked = allChecked;
      if (selectAllDocs) selectAllDocs.checked = allChecked;
    }
    
    // Clear all selections
    function clearSelections() {
      console.log('[Bulk Actions] Clearing selections');
      selectedDocIds = [];
      rqsa('.doc-checkbox').forEach(cb => {
        cb.checked = false;
        cb.closest('tr')?.classList.remove('table-active');
      });
      updateBulkUI();
    }
    
    // Select all documents
    function selectAllDocuments() {
      const isChecked = selectAllHeader.checked;
      console.log('[Bulk Actions] Select all:', isChecked);
      
      const allCheckboxes = rqsa('.doc-checkbox:not(:disabled)');
      
      allCheckboxes.forEach(cb => {
        cb.checked = isChecked;
        const tr = cb.closest('tr');
        if (tr) {
          if (isChecked) {
            tr.classList.add('table-active');
          } else {
            tr.classList.remove('table-active');
          }
        }
      });
      
      if (isChecked) {
        selectedDocIds = allCheckboxes.map(cb => cb.value);
      } else {
        selectedDocIds = [];
      }
      
      updateBulkUI();
    }
    
    // Handle individual checkbox change
    function handleDocCheckboxChange(checkbox) {
      // Skip if checkbox is disabled (already accepted/returned)
      if (checkbox.disabled) return;
      
      const docId = checkbox.value;
      const tr = checkbox.closest('tr');
      
      console.log('[Bulk Actions] Checkbox changed:', docId, 'checked:', checkbox.checked);
      
      if (checkbox.checked) {
        if (!selectedDocIds.includes(docId)) {
          selectedDocIds.push(docId);
        }
        if (tr) tr.classList.add('table-active');
      } else {
        selectedDocIds = selectedDocIds.filter(id => id !== docId);
        if (tr) tr.classList.remove('table-active');
      }
      
      updateBulkUI();
    }
    
    // Set up event listeners for select all
    selectAllHeader.addEventListener('change', selectAllDocuments);
    if (selectAllDocs) {
      selectAllDocs.addEventListener('change', selectAllDocuments);
    }
    
    // Clear selections button
    if (bulkClearBtn && !bulkClearBtn.__saBound) {
      bulkClearBtn.__saBound = true;
      bulkClearBtn.addEventListener('click', clearSelections);
    }
    
    // Bulk accept button
    if (bulkAcceptBtn && !bulkAcceptBtn.__saBound) {
      bulkAcceptBtn.__saBound = true;
      bulkAcceptBtn.addEventListener('click', () => {
        console.log('[Bulk Actions] Bulk accept clicked');
        if (selectedDocIds.length === 0) {
          console.log('[Bulk Actions] No documents selected for accept');
          return;
        }
        
        const fileNames = selectedDocIds.map(id => {
          const checkbox = rqs(`.doc-checkbox[value="${id}"]`);
          return checkbox?.dataset?.fileName || `Document ${id}`;
        });
        console.log('[Bulk Actions] Calling bulkAcceptDocuments with IDs:', selectedDocIds);
        bulkAcceptDocuments(selectedDocIds, fileNames);
      });
    }
    
    // Bulk return button
    if (bulkReturnBtn && !bulkReturnBtn.__saBound) {
      bulkReturnBtn.__saBound = true;
      bulkReturnBtn.addEventListener('click', () => {
        console.log('[Bulk Actions] Bulk return clicked');
        if (selectedDocIds.length === 0) {
          console.log('[Bulk Actions] No documents selected for return');
          return;
        }
        
        const fileNames = selectedDocIds.map(id => {
          const checkbox = rqs(`.doc-checkbox[value="${id}"]`);
          return checkbox?.dataset?.fileName || `Document ${id}`;
        });
        console.log('[Bulk Actions] Calling bulkReturnDocuments with IDs:', selectedDocIds);
        bulkReturnDocuments(selectedDocIds, fileNames);
      });
    }
    
    // Bind bulk accept confirm button
    if (bulkAcceptConfirmBtn && !bulkAcceptConfirmBtn.__saBound) {
      bulkAcceptConfirmBtn.__saBound = true;
      bulkAcceptConfirmBtn.addEventListener('click', () => {
        console.log('[Bulk Actions] Bulk accept confirm clicked');
        const modalEl = rqs("#saBulkAcceptModal");
        if (modalEl && window.bootstrap) {
          bootstrap.Modal.getOrCreateInstance(modalEl).hide();
        }
        
        const docIds = window.__saBulkAcceptDocIds || [];
        console.log('[Bulk Actions] Confirm accept for IDs:', docIds);
        
        if (docIds.length === 0) {
          safeShowError('No documents selected.');
          return;
        }
        
        performBulkAccept(docIds);
      });
    }
    
    // Set up bulk return form submission
    if (bulkReturnForm && !bulkReturnForm.__saBound) {
      bulkReturnForm.__saBound = true;
      bulkReturnForm.addEventListener('submit', (e) => {
        e.preventDefault();
        console.log('[Bulk Actions] Bulk return form submitted');
        
        const reason = rqs("#saBulkReturnReasonText")?.value?.trim();
        const docIds = window.__saBulkReturnDocIds || [];
        
        console.log('[Bulk Actions] Return reason:', reason, 'Doc IDs:', docIds);
        
        // Clear previous errors
        const reasonError = rqs("#saBulkReturnReasonError");
        const generalError = rqs("#saBulkReturnError");
        const errorMessage = rqs("#saBulkReturnErrorMessage");
        
        if (reasonError) reasonError.style.display = 'none';
        if (generalError) {
          generalError.classList.add('d-none');
          generalError.classList.remove('d-block');
        }
        
        // Validate
        if (!reason) {
          console.log('[Bulk Actions] Validation failed: No reason');
          if (reasonError) reasonError.style.display = 'block';
          if (errorMessage) errorMessage.textContent = 'Return reason is required.';
          if (generalError) {
            generalError.classList.remove('d-none');
            generalError.classList.add('d-block');
          }
          return;
        }
        
        if (docIds.length === 0) {
          console.log('[Bulk Actions] Validation failed: No doc IDs');
          if (errorMessage) errorMessage.textContent = 'No documents selected.';
          if (generalError) {
            generalError.classList.remove('d-none');
            generalError.classList.add('d-block');
          }
          return;
        }
        
        const modalEl = rqs("#saBulkReturnReasonModal");
        if (modalEl && window.bootstrap) {
          bootstrap.Modal.getOrCreateInstance(modalEl).hide();
        }
        
        performBulkReturn(docIds, reason);
      });
    }
    
    // Export the handleDocCheckboxChange function so it can be called from setupDocumentCheckboxes
    window.__saHandleDocCheckboxChange = handleDocCheckboxChange;
    
    console.log('[Bulk Actions] Setup complete');
  }

  // Set up document checkboxes
  function setupDocumentCheckboxes() {
    const tbody = rqs("#saDocsTbody");
    if (!tbody) {
      console.log('[Document Checkboxes] No tbody found');
      return;
    }
    
    console.log('[Document Checkboxes] Setting up...');
    
    // Remove existing event listeners by cloning checkboxes
    rqsa('.doc-checkbox').forEach(cb => {
      const newCb = cb.cloneNode(true);
      cb.parentNode.replaceChild(newCb, cb);
    });
    
    // Add checkboxes to each document row
    const rows = tbody.querySelectorAll('tr[data-doc-id]');
    console.log('[Document Checkboxes] Found', rows.length, 'document rows');
    
    rows.forEach(row => {
      const docId = row.getAttribute('data-doc-id');
      const docName = row.querySelector('td:nth-child(3)')?.textContent || '';
      const statusCell = row.querySelector('td:nth-child(5)');
      const status = statusCell ? statusCell.textContent.trim() : '';
      
      console.log('[Document Checkboxes] Row:', docId, 'Status:', status);
      
      // Check if document is already accepted or returned
      const isAccepted = status.includes('Accepted');
      const isReturned = status.includes('Returned');
      
      // Create checkbox cell if not exists
      let checkboxCell = row.querySelector('td:first-child');
      if (!checkboxCell) {
        checkboxCell = document.createElement('td');
        row.insertBefore(checkboxCell, row.firstChild);
      }
      
      // Create checkbox
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.className = 'form-check-input doc-checkbox';
      checkbox.value = docId;
      checkbox.dataset.fileName = docName.trim();
      checkbox.dataset.status = status;
      
      // ✅ UPDATED: Disable checkbox AND action buttons for already accepted or returned documents
      if (isAccepted || isReturned) {
        checkbox.disabled = true;
        checkbox.title = isAccepted ? 
          'This document is already accepted - cannot be selected' : 
          'This document is returned - cannot be selected';
        checkbox.style.cursor = 'not-allowed';
        
        // Also disable action buttons in the same row
        const actionButtons = row.querySelectorAll('[data-action="accept-doc"], [data-action="return-doc"]');
        actionButtons.forEach(btn => {
          btn.disabled = true;
          btn.classList.add('btn-disabled-review');
          btn.style.opacity = '0.5';
          btn.title = isAccepted ? 'Already accepted' : 'Already returned';
        });
      }
      
      checkboxCell.innerHTML = '';
      checkboxCell.appendChild(checkbox);
      
      // Add event listener using the exported function
      checkbox.addEventListener('change', function() {
        if (window.__saHandleDocCheckboxChange) {
          window.__saHandleDocCheckboxChange(this);
        } else {
          console.error('[Document Checkboxes] Handle function not found');
        }
      });
    });
    
    // Initialize the bulk UI with zero selections
    setTimeout(() => {
      const toolbar = rqs("#saBulkActionsToolbar");
      const selectedCount = rqs("#saSelectedCount");
      const bulkAcceptBtn = rqs("#saBulkAcceptBtn");
      const bulkReturnBtn = rqs("#saBulkReturnBtn");
      
      if (toolbar) toolbar.style.display = 'none';
      if (selectedCount) selectedCount.textContent = '0';
      if (bulkAcceptBtn) bulkAcceptBtn.disabled = true;
      if (bulkReturnBtn) bulkReturnBtn.disabled = true;
      
      console.log('[Document Checkboxes] Setup complete');
    }, 100);
  }

  // Helper function for handleDocCheckboxChange
  function handleDocCheckboxChange(checkbox) {
    const toolbar = rqs("#saBulkActionsToolbar");
    const selectedCount = rqs("#saSelectedCount");
    
    if (!toolbar || !selectedCount) return;
    
    let selectedDocIds = [];
    const allCheckboxes = rqsa('.doc-checkbox:not(:disabled)'); // Only count enabled checkboxes
    allCheckboxes.forEach(cb => {
      if (cb.checked) selectedDocIds.push(cb.value);
    });
    
    selectedCount.textContent = selectedDocIds.length;
    
    // Show/hide toolbar
    toolbar.style.display = selectedDocIds.length > 0 ? 'flex' : 'none';
    
    // Enable/disable action buttons
    const bulkAcceptBtn = rqs("#saBulkAcceptBtn");
    const bulkReturnBtn = rqs("#saBulkReturnBtn");
    if (bulkAcceptBtn) bulkAcceptBtn.disabled = selectedDocIds.length === 0;
    if (bulkReturnBtn) bulkReturnBtn.disabled = selectedDocIds.length === 0;
    
    // Update row styling
    const tr = checkbox.closest('tr');
    if (tr) {
      if (checkbox.checked) {
        tr.classList.add('table-active');
      } else {
        tr.classList.remove('table-active');
      }
    }
    
    // Update select all checkboxes
    const selectAllHeader = rqs("#saSelectAllHeader");
    const selectAllDocs = rqs("#saSelectAllDocs");
    const allEnabledCheckboxes = rqsa('.doc-checkbox:not(:disabled)');
    const allChecked = allEnabledCheckboxes.length > 0 && 
                      allEnabledCheckboxes.every(cb => cb.checked);
    
    if (selectAllHeader) selectAllHeader.checked = allChecked;
    if (selectAllDocs) selectAllDocs.checked = allChecked;
  }

  // -------------------------
  // Term helpers (UPDATED: year-only filters)
  // -------------------------
  function termLabel(t) {
    return t.label || `${t.school_year}`; // Removed semester from label
  }

  function getActiveTerm(data) {
    const id = data?.active_term_id ? String(data.active_term_id) : "";
    if (!id) return null;
    return store.terms.find((t) => String(t.id) === id) || null;
  }

  function uniqYearsFromTerms() {
    const s = new Set();
    for (const t of store.terms) {
      if (t && t.school_year) s.add(String(t.school_year));
    }
    // Sort like "2025-2026" properly by starting year (newest first)
    return Array.from(s).sort((a, b) => {
      const aStart = parseInt(String(a).slice(0, 4), 10);
      const bStart = parseInt(String(b).slice(0, 4), 10);
      return bStart - aStart; // Descending (newest first)
    });
  }

  // ✅ UPDATED: Simplified termId from year only (no semester)
  function termIdFromYear(year) {
    const y = String(year || "").trim();
    if (!y) return "";
    // Find the first term with this school year (accreditation is per academic year)
    const t = store.terms.find(x => String(x.school_year) === y);
    return t ? String(t.id) : "";
  }

  function setPendingTermFromUI() {
    store.pending.termId = termIdFromYear(store.pending.year);
  }

  function setActiveTermFromUI() {
    store.active.termId = termIdFromYear(store.active.year);
  }
  
  // ✅ NEW: Set recommended term from UI
  function setRecommendedTermFromUI() {
    store.recommended.termId = termIdFromYear(store.recommended.year);
  }

  // -------------------------
  // Bind term filters (root-aware) - UPDATED
  // -------------------------
  function bindTermFilters() {
    // Pending dropdown
    const pYear = rqs("#saPendingYearFilter");

    if (pYear && !pYear.__saBound) {
      pYear.__saBound = true;
      pYear.addEventListener("change", () => {
        store.pending.year = String(pYear.value || "");
        setPendingTermFromUI();
        store.pending.page = 1;
        bus.emit("filters:changed", { scope: "pending" });
      });
    }

    // Active dropdown
    const aYear = rqs("#saActiveYearFilter");

    if (aYear && !aYear.__saBound) {
      aYear.__saBound = true;
      aYear.addEventListener("change", () => {
        store.active.year = String(aYear.value || "");
        setActiveTermFromUI();
        store.active.page = 1;
        bus.emit("filters:changed", { scope: "active" });
      });
    }
    
    // ✅ NEW: Recommended dropdown
    const rYear = rqs("#saRecommendedYearFilter");
    
    if (rYear && !rYear.__saBound) {
      rYear.__saBound = true;
      rYear.addEventListener("change", () => {
        store.recommended.year = String(rYear.value || "");
        setRecommendedTermFromUI();
        store.recommended.page = 1;
        bus.emit("filters:changed", { scope: "recommended" });
      });
    }

    // OLD dropdowns fallback (if you still have them somewhere)
    const pendingTermSel = rqs("#saPendingTermFilter");
    const activeTermSel = rqs("#saActiveTermFilter");

    if (pendingTermSel && !pendingTermSel.__saBound) {
      pendingTermSel.__saBound = true;
      pendingTermSel.addEventListener("change", () => {
        store.pending.termId = String(pendingTermSel.value || "");
        store.pending.page = 1;
        bus.emit("filters:changed", { scope: "pending" });
      });
    }

    if (activeTermSel && !activeTermSel.__saBound) {
      activeTermSel.__saBound = true;
      activeTermSel.addEventListener("change", () => {
        store.active.termId = String(activeTermSel.value || "");
        store.active.page = 1;
        bus.emit("filters:changed", { scope: "active" });
      });
    }
  }

  // -------------------------
  // Load terms (for filters) - UPDATED for year-only dropdowns
  // -------------------------
  async function loadTerms() {
    // Expected server response:
    // { ok:true, terms:[{id, school_year, semester, status, label?}], active_term_id }
    const data = await postJSON({ action: "list_terms" });
    store.terms = Array.isArray(data?.terms) ? data.terms : [];

    // Get year filter elements
    const pYear = rqs("#saPendingYearFilter");
    const aYear = rqs("#saActiveYearFilter");
    const rYear = rqs("#saRecommendedYearFilter"); // ✅ NEW

    // Get old dropdowns fallback
    const pendingTermSel = rqs("#saPendingTermFilter");
    const activeTermSel = rqs("#saActiveTermFilter");

    const years = uniqYearsFromTerms();
    const activeTerm = getActiveTerm(data);

    // ---- Pending: default to Active Year
    if (pYear) {
      // keep first option (Active Year) as-is from HTML
      const firstOpt = pYear.querySelector("option") ? pYear.querySelector("option").outerHTML : "";
      pYear.innerHTML = firstOpt || `<option value="">Active Year</option>`;

      for (const y of years) {
        const opt = document.createElement("option");
        opt.value = String(y);
        opt.textContent = String(y);
        pYear.appendChild(opt);
      }

      // default to active year if given, else leave blank to mean "Active Year"
      store.pending.year = activeTerm ? String(activeTerm.school_year || "") : "";
      pYear.value = store.pending.year || "";
    }

    // Compute pending termId
    setPendingTermFromUI();

    // ---- Active: default "All Years"
    if (aYear) {
      const firstOpt = aYear.querySelector("option") ? aYear.querySelector("option").outerHTML : "";
      aYear.innerHTML = firstOpt || `<option value="">All Years</option>`;

      for (const y of years) {
        const opt = document.createElement("option");
        opt.value = String(y);
        opt.textContent = String(y);
        aYear.appendChild(opt);
      }

      store.active.year = ""; // all
      aYear.value = "";
    }

    setActiveTermFromUI();

    // ---- ✅ NEW Recommended: default "All Years"
    if (rYear) {
      const firstOpt = rYear.querySelector("option") ? rYear.querySelector("option").outerHTML : "";
      rYear.innerHTML = firstOpt || `<option value="">All Years</option>`;

      for (const y of years) {
        const opt = document.createElement("option");
        opt.value = String(y);
        opt.textContent = String(y);
        rYear.appendChild(opt);
      }

      store.recommended.year = ""; // all
      rYear.value = "";
    }

    setRecommendedTermFromUI();

    // ---- OLD dropdowns fallback population
    if (pendingTermSel) {
      pendingTermSel.innerHTML = `<option value="">Active Year</option>`;
      for (const t of store.terms) {
        const opt = document.createElement("option");
        opt.value = String(t.id);
        opt.textContent = termLabel(t);
        pendingTermSel.appendChild(opt);
      }
      if (data?.active_term_id) pendingTermSel.value = String(data.active_term_id);
      store.pending.termId = String(pendingTermSel.value || store.pending.termId || "");
    }

    if (activeTermSel) {
      activeTermSel.innerHTML = `<option value="">All Years</option>`;
      for (const t of store.terms) {
        const opt = document.createElement("option");
        opt.value = String(t.id);
        opt.textContent = termLabel(t);
        activeTermSel.appendChild(opt);
      }
      store.active.termId = "";
      activeTermSel.value = "";
    }

    bus.emit("terms:loaded", store.terms);
  }

  // -------------------------
  // Bind header controls - root-aware
  // -------------------------
  function bindHeader() {
    const searchEl = rqs("#saAccSearch");
    const refreshBtn = rqs("#saAccRefreshBtn");

    if (searchEl) {
      // Always sync the visible input with the (freshly-cleared) store on re-navigation
      searchEl.value = store.search || "";

      if (!searchEl.__saBound) {
        searchEl.__saBound = true;
        searchEl.addEventListener(
        "input",
        debounce(() => {
          store.search = String(searchEl.value || "").trim();
          store.pending.page = 1;
          store.recommended.page = 1;
          store.active.page = 1;
          store.reqs.page = 1;
          bus.emit("search:changed", store.search);
        }, 250)
      );
      } // end !searchEl.__saBound
    } // end if (searchEl)

    if (refreshBtn && !refreshBtn.__saBound) {
      refreshBtn.__saBound = true;
      refreshBtn.addEventListener("click", () => {
        bus.emit("refresh:all");
      });
    }
  }

  // -------------------------
  // INIT (Orchestrator entry point)
  // -------------------------
  async function init(root) {
    const r = root || document;

    // Always update root so rqs() targets the right element after re-navigation
    store._root = r;

    // Reset pagination + search so re-entering the page fetches from scratch
    store.search = "";
    store.pending    = { items: [], page: 1, perPage: store.pending?.perPage    || 10, total: 0, status: "Pending", termId: store.pending?.termId    || "", year: store.pending?.year    || "" };
    store.active     = { items: [], page: 1, perPage: store.active?.perPage     || 10, total: 0, termId: store.active?.termId     || "", year: store.active?.year     || "" };
    store.recommended= { items: [], page: 1, perPage: store.recommended?.perPage|| 10, total: 0, termId: store.recommended?.termId|| "", year: store.recommended?.year|| "" };
    store.reqs       = { items: [], page: 1, perPage: store.reqs?.perPage       || 10, total: 0, status: store.reqs?.status       || "Active" };

    // Bind UI elements — helpers guard per-element so no double-listeners
    bindHeader();
    bindTermFilters();
    bindPreviewModalActions();

    try {
      await loadTerms();
    } catch (e) {
      console.error(e);
      safeShowError(e.message || "Failed to load terms.");
    }

    // Emit booted — tab modules listen to (re-)fetch their data
    bus.emit("booted", { root: r });

    try { window.SAAccreditationPending?.init?.(r);     } catch (e) { console.error("[Pending.init] failed", e); }
    try { window.SAAccreditationRecommended?.init?.(r); } catch (e) { console.error("[Recommended.init] failed", e); }
    try { window.SAAccreditationActive?.init?.(r);      } catch (e) { console.error("[Active.init] failed", e); }
    try { window.SAAccreditationFiles?.init?.(r);       } catch (e) { console.error("[Files.init] failed", e); }
  }

  // -------------------------
  // Public API for modules
  // -------------------------
  window.SAAccreditation = {
    init,

    API_URL,
    qs,
    qsa,
    rqs,
    rqsa,
    escapeHtml,
    debounce,

    postJSON,
    renderPagination,
    openPreview,

    safeShowError,
    safeShowSuccess,

    bus,
    store,
    loadTerms,

    // Document review functions
    acceptDocument,
    returnDocument,
    bulkAcceptDocuments,
    bulkReturnDocuments,
    renderDocumentActions,
    hasReturnedDocuments,
    updateRecommendationButtonState,
    disableAllRecommendationButtons,
    enableAllRecommendationButtons,
    
    openPreview,
    openAcceptDocumentModal, 
    openReturnDocumentModal, 
    bindPreviewModalActions,
    

    // Bulk action functions
    setupBulkActions,
    setupDocumentCheckboxes,
    handleDocCheckboxChange,

    // ✅ UPDATED: Year-only helper
    termIdFromYear,
    };
    window.SAAccreditation.openAcceptDocumentModal = function(docId, fileName) {
    const pending = window.SAAccreditationPending;
    if (pending && pending.openAcceptDocumentModal) {
      const A = window.SAAccreditation;
      pending.openAcceptDocumentModal(A, docId, fileName);
    } else {
      console.error("[Base] Pending module not loaded for accept modal");
    }
  };

  window.SAAccreditation.openReturnDocumentModal = function(docId, fileName) {
    const pending = window.SAAccreditationPending;
    if (pending && pending.openReturnDocumentModal) {
      const A = window.SAAccreditation;
      pending.openReturnDocumentModal(A, docId, fileName);
    } else {
      console.error("[Base] Pending module not loaded for return modal");
    }
  };

  // Bridge functions to connect with pending module
window.SAAccreditation.openAcceptDocumentModal = function(docId, fileName) {
  if (!docId) {
    console.error("[Base] Cannot open accept modal: No document ID provided");
    safeShowError("Cannot accept: Missing document ID");
    return;
  }
  
  const pending = window.SAAccreditationPending;
  if (pending && pending.openAcceptDocumentModal) {
    const A = window.SAAccreditation;
    pending.openAcceptDocumentModal(A, docId, fileName);
  } else {
    console.error("[Base] Pending module not loaded for accept modal");
    safeShowError("Cannot open accept modal");
  }
};

window.SAAccreditation.openReturnDocumentModal = function(docId, fileName) {
  if (!docId) {
    console.error("[Base] Cannot open return modal: No document ID provided");
    safeShowError("Cannot return: Missing document ID");
    return;
  }
  
  const pending = window.SAAccreditationPending;
  if (pending && pending.openReturnDocumentModal) {
    const A = window.SAAccreditation;
    pending.openReturnDocumentModal(A, docId, fileName);
  } else {
    console.error("[Base] Pending module not loaded for return modal");
    safeShowError("Cannot open return modal");
  }
};
})();
