/* js/manage-e-signatures/canvas.js */
/* global bootstrap */

(function () {
  "use strict";

  function qs(sel, root = document) {
    return root.querySelector(sel);
  }

  function alreadyInit(modalEl) {
    return !!(modalEl && modalEl.dataset && modalEl.dataset.sigCanvasInit === "1");
  }

  function markInit(modalEl) {
    if (modalEl && modalEl.dataset) modalEl.dataset.sigCanvasInit = "1";
  }

  function init(root = document) {
    const modeUpload = qs("#sigModeUpload", root);
    const modeDraw = qs("#sigModeDraw", root);
    const uploadBlock = qs("#uploadBlock", root);
    const drawBlock = qs("#drawBlock", root);

    const fileInput = qs("#sigFile", root);
    const previewImg = qs("#sigUploadPreview", root);
    const previewEmpty = qs("#sigUploadPreviewEmpty", root);

    const canvas = qs("#sigCanvas", root);
    const clearBtn = qs("#sigClearCanvas", root);
    const undoBtn = qs("#sigUndoBtn", root);
    const modalEl = qs("#sigUploadModal", root);

    if (!modalEl) return;
    if (alreadyInit(modalEl)) return;

    // If any missing, still mark init to prevent loops
    if (!modeUpload || !modeDraw || !uploadBlock || !drawBlock || !previewImg || !previewEmpty || !canvas) {
      markInit(modalEl);
      return;
    }

    // -------------------------
    // Canvas signature pad
    // -------------------------
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    let drawing = false;
    let last = null;

    const history = [];
    const MAX_HISTORY = 30;

    function setPenStyle() {
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.lineWidth = 3;
      ctx.strokeStyle = "#111";
    }

    function resizeCanvasToCss() {
      const dpr = window.devicePixelRatio || 1;

      // When hidden, rect.width can be 0 — only resize when visible.
      const rect = canvas.getBoundingClientRect();
      const cssW = Math.max(1, Math.floor(rect.width));
      const cssH = Math.max(1, Math.floor(rect.height || canvas.clientHeight || 180));

      canvas.width = Math.floor(cssW * dpr);
      canvas.height = Math.floor(cssH * dpr);

      // draw in CSS pixels
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      setPenStyle();
    }

    function getPos(e) {
      const rect = canvas.getBoundingClientRect();
      const t = e.touches && e.touches[0];
      const clientX = t ? t.clientX : e.clientX;
      const clientY = t ? t.clientY : e.clientY;
      return { x: clientX - rect.left, y: clientY - rect.top };
    }

    function snapshot() {
      try {
        history.push(canvas.toDataURL("image/png"));
        if (history.length > MAX_HISTORY) history.shift();
        if (undoBtn) undoBtn.disabled = history.length <= 1;
      } catch (_) {}
    }

    function restoreFromDataUrl(dataUrl) {
      const img = new Image();
      img.onload = () => {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        // draw at CSS px scale (ctx already setTransform'd)
        ctx.drawImage(img, 0, 0, canvas.clientWidth, canvas.clientHeight);
        refreshCanvasPreview(false);
      };
      img.src = dataUrl;
    }

    function start(e) {
      if (!modeDraw.checked) return;
      e.preventDefault();

      drawing = true;
      last = getPos(e);

      // baseline snapshot
      if (history.length === 0) snapshot();
      snapshot();
    }

    function move(e) {
      if (!drawing || !modeDraw.checked) return;
      e.preventDefault();

      const p = getPos(e);
      ctx.beginPath();
      ctx.moveTo(last.x, last.y);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
      last = p;

      refreshCanvasPreview(true);
    }

    function end(e) {
      if (!drawing) return;
      e.preventDefault();
      drawing = false;
      last = null;
      refreshCanvasPreview(false);
    }

    function clearCanvas() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      history.length = 0;
      if (undoBtn) undoBtn.disabled = true;
      refreshCanvasPreview(false);
    }

    function undo() {
      if (history.length <= 1) return;
      history.pop();
      const prev = history[history.length - 1];
      if (undoBtn) undoBtn.disabled = history.length <= 1;
      restoreFromDataUrl(prev);
    }

    function isCanvasBlank() {
      try {
        const w = canvas.width,
          h = canvas.height;
        const data = ctx.getImageData(0, 0, w, h).data;
        for (let i = 3; i < data.length; i += 4) {
          if (data[i] !== 0) return false;
        }
        return true;
      } catch (_) {
        return false;
      }
    }

    function canvasToPngDataUrl() {
      try {
        return canvas.toDataURL("image/png");
      } catch (_) {
        return "";
      }
    }

    let rafPending = false;
    function refreshCanvasPreview(throttle) {
      if (!modeDraw.checked) return;

      const run = () => {
        rafPending = false;
        if (isCanvasBlank()) {
          previewImg.classList.add("d-none");
          previewImg.src = "";
          previewEmpty.classList.remove("d-none");
          return;
        }
        previewImg.src = canvasToPngDataUrl();
        previewImg.classList.remove("d-none");
        previewEmpty.classList.add("d-none");
      };

      if (throttle) {
        if (rafPending) return;
        rafPending = true;
        requestAnimationFrame(run);
      } else {
        run();
      }
    }

    // -------------------------
    // Mode toggling ✅ FIXED
    // -------------------------
    function setMode(which) {
      const isUpload = which === "upload";
      uploadBlock.classList.toggle("d-none", !isUpload);
      drawBlock.classList.toggle("d-none", isUpload);

      // Reset preview area (shared)
      previewImg.classList.add("d-none");
      previewImg.src = "";
      previewEmpty.classList.remove("d-none");

      // ✅ IMPORTANT: when switching to draw, resize AFTER it becomes visible
      if (!isUpload) {
        requestAnimationFrame(() => {
          resizeCanvasToCss();
          if (history.length === 0) snapshot();
          refreshCanvasPreview(false);
        });
      }
    }

    modeUpload.addEventListener("change", () => {
      if (modeUpload.checked) setMode("upload");
    });
    modeDraw.addEventListener("change", () => {
      if (modeDraw.checked) setMode("draw");
    });

    // -------------------------
    // Upload preview
    // -------------------------
    fileInput.addEventListener("change", () => {
      if (!fileInput.files || !fileInput.files[0]) {
        previewImg.classList.add("d-none");
        previewImg.src = "";
        previewEmpty.classList.remove("d-none");
        return;
      }
      const f = fileInput.files[0];
      const url = URL.createObjectURL(f);
      previewImg.src = url;
      previewImg.classList.remove("d-none");
      previewEmpty.classList.add("d-none");
    });

    // Bind mouse + touch
    canvas.addEventListener("mousedown", start);
    canvas.addEventListener("mousemove", move);
    window.addEventListener("mouseup", end);

    canvas.addEventListener("touchstart", start, { passive: false });
    canvas.addEventListener("touchmove", move, { passive: false });
    window.addEventListener("touchend", end, { passive: false });

    clearBtn && clearBtn.addEventListener("click", clearCanvas);
    undoBtn && undoBtn.addEventListener("click", undo);

    // Modal lifecycle ✅ FIXED: don't resize when draw is hidden
    modalEl.addEventListener("shown.bs.modal", function () {
      // If draw is active, canvas is visible, safe to resize
      if (modeDraw.checked) {
        resizeCanvasToCss();
        if (history.length === 0) snapshot();
        refreshCanvasPreview(false);
      }
    });

    modalEl.addEventListener("hidden.bs.modal", function () {
      // reset UI
      modeUpload.checked = true;
      modeDraw.checked = false;
      setMode("upload");

      // reset upload
      if (fileInput) fileInput.value = "";
      previewImg.classList.add("d-none");
      previewImg.src = "";
      previewEmpty.classList.remove("d-none");

      // clear draw
      clearCanvas();
    });

    // Init default
    setMode("upload");

    // Expose blob getter (used by orchestrator save)
    window.__getSignatureCanvasPngBlob = function (cb) {
      if (!canvas || isCanvasBlank()) return cb(null);
      canvas.toBlob(
        function (blob) {
          cb(blob || null);
        },
        "image/png",
        1.0
      );
    };

    markInit(modalEl);
  }

  // Export module
  window.ManageESignatureCanvas = { init };
})();
