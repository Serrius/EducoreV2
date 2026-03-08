/* js/manage-e-signatures/manage-e-signature.js */
/* global bootstrap, showSuccess, showError */

(function () {
  "use strict";

  const API_URL = "php/manage-e-signature.php";

  // Prevent double-binding across injected loads
  let _bound = false;

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

  function safeShowError(msg) {
    if (typeof window.showError === "function") return window.showError(msg);
    alert(msg || "Something went wrong.");
  }

  function safeShowSuccess(msg) {
    if (typeof window.showSuccess === "function") return window.showSuccess(msg);
    alert(msg || "Success.");
  }

  async function postJSON(payload) {
    const res = await fetch(API_URL, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const text = await res.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch (e) {
      throw new Error("Non-JSON response from server: " + text.slice(0, 200));
    }
    if (!res.ok) throw new Error(json?.message || `HTTP ${res.status}`);
    return json;
  }

  async function postFormData(fd) {
    const res = await fetch(API_URL, {
      method: "POST",
      credentials: "include",
      body: fd,
    });
    const text = await res.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch (e) {
      throw new Error("Non-JSON response from server: " + text.slice(0, 200));
    }
    if (!res.ok) throw new Error(json?.message || `HTTP ${res.status}`);
    return json;
  }

  function withCacheBust(url) {
    if (!url) return url;
    const u = String(url);
    return u + (u.includes("?") ? "&" : "?") + "t=" + Date.now();
  }

  function fileExtFromPath(path) {
    const p = String(path || "");
    const q = p.split("?")[0];
    const parts = q.split(".");
    if (parts.length < 2) return "—";
    return (parts.pop() || "—").toUpperCase();
  }

  function setText(el, val) {
    if (!el) return;
    el.textContent = val ?? "—";
  }

  function setBadge(badgeEl, statusText, variant) {
    if (!badgeEl) return;
    // reset
    badgeEl.className = "badge rounded-pill border";
    // apply bootstrap-ish
    if (variant === "success") badgeEl.classList.add("text-bg-success");
    else if (variant === "warning") badgeEl.classList.add("text-bg-warning");
    else if (variant === "danger") badgeEl.classList.add("text-bg-danger");
    else badgeEl.classList.add("text-bg-light");
    badgeEl.textContent = statusText;
  }

  function pickSigUrl(sig) {
    // PHP returns signature_url (same as signature_file)
    return sig?.signature_url || sig?.signature_file || "";
  }

  function updateMainPreviewUI(state) {
    const {
      sigEmptyState,
      sigImage,
      sigStatusBadge,
      sigOwnerName,
      sigOwnerRole,
      sigUpdatedAt,
      sigFileType,
      sigPreviewFullImg,
    } = state.els;

    const user = state.user;
    const sig = state.signature;

    // owner meta
    setText(sigOwnerName, user?.full_name || "—");
    setText(sigOwnerRole, user?.role ? String(user.role).replaceAll("_", " ") : "—");

    if (!sig || sig.status === "Removed" || !pickSigUrl(sig)) {
      // empty view
      if (sigEmptyState) sigEmptyState.classList.remove("d-none");
      if (sigImage) {
        sigImage.classList.add("d-none");
        sigImage.src = "";
      }

      setText(sigUpdatedAt, "—");
      setText(sigFileType, "—");
      setBadge(sigStatusBadge, "Status: No signature", "warning");

      if (sigPreviewFullImg) sigPreviewFullImg.src = "";
      return;
    }

    const url = withCacheBust(pickSigUrl(sig));

    // show preview
    if (sigEmptyState) sigEmptyState.classList.add("d-none");
    if (sigImage) {
      sigImage.src = url;
      sigImage.classList.remove("d-none");
    }

    setText(sigUpdatedAt, sig.updated_at || "—");
    setText(sigFileType, fileExtFromPath(url));
    setBadge(sigStatusBadge, "Status: Active", "success");

    if (sigPreviewFullImg) sigPreviewFullImg.src = url;
  }

  async function loadCurrent(state) {
    const btnPreviewFull = state.els.btnPreviewFull;
    const btnAddReplace = state.els.btnAddReplace;
    const sigRemoveBtn = state.els.sigRemoveBtn;

    // disable actions while loading
    [btnPreviewFull, btnAddReplace, sigRemoveBtn].forEach((b) => {
      if (b) b.disabled = true;
    });

    try {
      const json = await postJSON({ action: "get_current" });
      if (!json.success) throw new Error(json.message || "Failed to load signature.");
      state.user = json.user || null;
      state.signature = json.signature || null;

      updateMainPreviewUI(state);
    } finally {
      // re-enable
      [btnPreviewFull, btnAddReplace, sigRemoveBtn].forEach((b) => {
        if (b) b.disabled = false;
      });
    }
  }

  function bindPreviewModal(state) {
    const { sigPreviewModal, sigPreviewFullImg } = state.els;
    if (!sigPreviewModal) return;

    sigPreviewModal.addEventListener("show.bs.modal", function () {
      const url = withCacheBust(pickSigUrl(state.signature));
      if (sigPreviewFullImg) sigPreviewFullImg.src = url || "";
    });
  }

  function bindRemove(state) {
    const { sigRemoveBtn } = state.els;
    if (!sigRemoveBtn) return;

    sigRemoveBtn.addEventListener("click", async function () {
      sigRemoveBtn.disabled = true;

      try {
        const json = await postJSON({ action: "remove" });
        if (!json.success) throw new Error(json.message || "Failed to remove signature.");

        safeShowSuccess(json.message || "Signature removed.");

        // update local state
        state.signature = null;

        // close modal if exists
        if (state.els.sigRemoveModal) {
          const modal = bootstrap.Modal.getInstance(state.els.sigRemoveModal);
          modal?.hide();
        }

        // refresh from server (ensures true DB state)
        await loadCurrent(state);
      } catch (e) {
        safeShowError(e.message || "Failed to remove signature.");
      } finally {
        sigRemoveBtn.disabled = false;
      }
    });
  }

  function getMode(state) {
    const { sigModeUpload, sigModeDraw } = state.els;
    if (sigModeDraw?.checked) return "draw";
    if (sigModeUpload?.checked) return "upload";
    return "upload";
  }

  function bindSave(state) {
    const {
      sigSaveBtn,
      sigUploadModal,
      sigFile,
      sigModeUpload,
      sigModeDraw,
      sigUploadPreview,
      sigUploadPreviewEmpty,
      sigNote,
    } = state.els;

    if (!sigSaveBtn || !sigUploadModal) return;

    sigSaveBtn.addEventListener("click", async function () {
      sigSaveBtn.disabled = true;

      try {
        const mode = getMode(state);

        const fd = new FormData();
        fd.append("action", "save");
        fd.append("note", String(sigNote?.value ?? "")); // ignored by PHP for now, safe to send

        if (mode === "upload") {
          const file = sigFile?.files?.[0] || null;
          if (!file) throw new Error("Please choose a signature file to upload.");
          fd.append("signature", file, file.name);
        } else {
          // Draw mode: prefer blob upload (best)
          // The canvas helper exposes: window.__getSignatureCanvasPngBlob(cb)
          const getBlob = window.__getSignatureCanvasPngBlob;
          if (typeof getBlob !== "function") {
            throw new Error("Canvas helper not initialized. Make sure canvas.js is loaded and init() ran.");
          }

          const blob = await new Promise((resolve) => getBlob(resolve));
          if (!blob) throw new Error("Your canvas is empty. Please draw your signature first.");

          fd.append("signature", blob, "signature.png");
        }

        const json = await postFormData(fd);
        if (!json.success) throw new Error(json.message || "Failed to save signature.");

        safeShowSuccess(json.message || "Signature saved.");

        // update local state from response
        state.signature = json.signature || state.signature;

        // close upload modal
        const modal = bootstrap.Modal.getInstance(sigUploadModal);
        modal?.hide();

        // refresh main UI (and re-fetch to be safe)
        await loadCurrent(state);

        // Reset upload preview UI for next time
        if (sigUploadPreview) {
          sigUploadPreview.classList.add("d-none");
          sigUploadPreview.src = "";
        }
        if (sigUploadPreviewEmpty) sigUploadPreviewEmpty.classList.remove("d-none");

        if (sigFile) sigFile.value = "";
        if (sigModeUpload) sigModeUpload.checked = true;
        if (sigModeDraw) sigModeDraw.checked = false;
      } catch (e) {
        safeShowError(e.message || "Failed to save signature.");
      } finally {
        sigSaveBtn.disabled = false;
      }
    });
  }

  function bindUploadModalLifecycle(state) {
    const { sigUploadModal } = state.els;
    if (!sigUploadModal) return;

    sigUploadModal.addEventListener("show.bs.modal", function () {
      // Ensure default mode starts on upload
      const { sigModeUpload, sigModeDraw } = state.els;
      if (sigModeUpload) sigModeUpload.checked = true;
      if (sigModeDraw) sigModeDraw.checked = false;
    });
  }

  function bindQuickButtons(state) {
    const { btnPreviewFull, btnAddReplace } = state.els;
    if (btnPreviewFull) {
      btnPreviewFull.addEventListener("click", function () {
        // Preview modal will pull current signature_url on show
      });
    }
    if (btnAddReplace) {
      btnAddReplace.addEventListener("click", function () {
        // Upload modal opens by data attributes; no extra needed
      });
    }
  }

  function collectEls(root) {
    return {
      // header buttons
      btnPreviewFull: qs("#btnPreviewFull", root),
      btnAddReplace: qs("#btnAddReplace", root),

      // main preview
      sigStatusBadge: qs("#sigStatusBadge", root),
      sigEmptyState: qs("#sigEmptyState", root),
      sigImage: qs("#sigImage", root),

      // meta fields
      sigOwnerName: qs("#sigOwnerName", root),
      sigOwnerRole: qs("#sigOwnerRole", root),
      sigUpdatedAt: qs("#sigUpdatedAt", root),
      sigFileType: qs("#sigFileType", root),

      // modals
      sigUploadModal: qs("#sigUploadModal", root),
      sigRemoveModal: qs("#sigRemoveModal", root),
      sigPreviewModal: qs("#sigPreviewModal", root),

      // preview modal img
      sigPreviewFullImg: qs("#sigPreviewFullImg", root),

      // upload modal controls
      sigModeUpload: qs("#sigModeUpload", root),
      sigModeDraw: qs("#sigModeDraw", root),
      uploadBlock: qs("#uploadBlock", root),
      drawBlock: qs("#drawBlock", root),

      sigFile: qs("#sigFile", root),
      sigNote: qs("#sigNote", root),
      sigUploadPreview: qs("#sigUploadPreview", root),
      sigUploadPreviewEmpty: qs("#sigUploadPreviewEmpty", root),

      sigSaveBtn: qs("#sigSaveBtn", root),

      // remove modal
      sigRemoveBtn: qs("#sigRemoveBtn", root),
    };
  }

  function validatePage(state) {
    // Need at least the main preview + upload modal to be useful.
    if (!state.els.sigStatusBadge) return false;
    if (!state.els.sigUploadModal) return false;
    if (!state.els.sigSaveBtn) return false;
    return true;
  }

  function markInitialized(root) {
    // Mark container to avoid rebinding within same injected DOM
    // Prefer a stable root if available
    const marker = qs("[data-page='manage-e-signature']", root) || qs("#sigUploadModal", root) || root;
    if (marker && marker.dataset) marker.dataset.muInit = "1";
  }

  function alreadyInitialized(root) {
    const marker = qs("[data-page='manage-e-signature']", root) || qs("#sigUploadModal", root) || root;
    return !!(marker && marker.dataset && marker.dataset.muInit === "1");
  }

  // Public orchestrator
  window.ManageESignature = {
    /**
     * Call this AFTER the HTML page is injected:
     *   window.ManageESignature.init(document);
     * or:
     *   window.ManageESignature.init(contentArea);
     */
    init(root = document) {
      try {
        // Per-injection guard: don’t bind twice to the same DOM
        if (alreadyInitialized(root)) return;

        const state = {
          root,
          els: collectEls(root),
          user: null,
          signature: null,
        };

        if (!validatePage(state)) return;

        // Bind one-time listeners (these are bound to injected DOM nodes)
        // ✅ IMPORTANT: init canvas for injected page
        window.ManageESignatureCanvas?.init(root);
        bindQuickButtons(state);
        bindPreviewModal(state);
        bindRemove(state);
        bindSave(state);
        bindUploadModalLifecycle(state);

        // Load initial signature state
        loadCurrent(state).catch((e) => safeShowError(e.message || "Failed to load signature."));

        // Mark this DOM instance as initialized
        markInitialized(root);

        // Optional: expose for debugging in console
        window.__ManageESignatureState = state;
      } catch (e) {
        safeShowError(e.message || "ManageESignature init failed.");
      }
    },

    /**
     * Manual refresh (useful if other modules update the signature)
     */
    refresh() {
      const st = window.__ManageESignatureState;
      if (!st) return;
      loadCurrent(st).catch((e) => safeShowError(e.message || "Failed to refresh signature."));
    },
  };
})();
//bindQuickbuttons