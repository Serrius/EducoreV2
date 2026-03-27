/* js/accreditation/super/accreditation.js */
/* global bootstrap */

(function () {
  "use strict";

  // ✅ Super Admin API endpoint
  const API_URL = "php/accreditation-super.php";

  // prevent double-loading script file itself
  if (window.__suAccreditationBooted) return;
  window.__suAccreditationBooted = true;

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
  // Root-aware query
  // -------------------------
  const store = {
    _root: null,
    __inited: false,

    search: "",
    terms: [],

    recommended: { items: [], page: 1, perPage: 10, total: 0, year: "", termId: "" },
    active: { items: [], page: 1, perPage: 10, total: 0, year: "", termId: "" },
  };

  function rqs(sel) {
    return qs(sel, store._root || document);
  }
  function rqsa(sel) {
    return qsa(sel, store._root || document);
  }

  // -------------------------
  // URL helpers (IMPORTANT for PDFs)
  // -------------------------
  function getAppBaseUrlFromLocation() {
    const path = String(window.location.pathname || "/").replaceAll("\\", "/");

    // prefer "/pages/" (dashboard)
    let pos = path.indexOf("/pages/");
    if (pos !== -1) {
      const base = path.slice(0, pos).replace(/\/+$/, "");
      return base ? base + "/" : "/";
    }

    // fallback "/php/"
    pos = path.indexOf("/php/");
    if (pos !== -1) {
      const base = path.slice(0, pos).replace(/\/+$/, "");
      return base ? base + "/" : "/";
    }

    // fallback "/assets/"
    pos = path.indexOf("/assets/");
    if (pos !== -1) {
      const base = path.slice(0, pos).replace(/\/+$/, "");
      return base ? base + "/" : "/";
    }

    return "/";
  }

  function resolvePublicUrl(urlOrRel) {
    const u = String(urlOrRel || "").trim();
    if (!u) return "";

    // ignore anchors-only
    if (u === "#" || u.startsWith("#")) return "";

    if (/^https?:\/\//i.test(u)) return u;
    if (u.startsWith("/")) return u; // already absolute-from-host

    // otherwise it is relative like "assets/uploads/....pdf"
    const base = getAppBaseUrlFromLocation();
    return base + u.replace(/^\/+/, "");
  }

  function withCacheBust(url) {
    const u = String(url || "").trim();
    if (!u) return "";
    // add cache buster to avoid stale iframe caching after upload/replace
    const sep = u.includes("?") ? "&" : "?";
    return u + sep + "_ts=" + Date.now();
  }

  // -------------------------
  // Modals
  // -------------------------
  function safeShowError(msg) {
    // Prefer the app-wide global (same one used by admin + special admin panels)
    if (typeof window.showError === "function") return window.showError(msg);
    // Fallback: the local modal still in the HTML
    const m = rqs("#suErrorModal");
    if (m && window.bootstrap) {
      const body = m.querySelector("[data-role='message']");
      if (body) body.textContent = msg || "Something went wrong.";
      bootstrap.Modal.getOrCreateInstance(m).show();
      return;
    }
    alert(msg || "Something went wrong.");
  }

  function safeShowSuccess(msg) {
    // Prefer the app-wide global
    if (typeof window.showSuccess === "function") return window.showSuccess(msg);
    // Fallback: the local modal still in the HTML
    const m = rqs("#suSuccessModal");
    if (m && window.bootstrap) {
      const body = m.querySelector("[data-role='message']");
      if (body) body.textContent = msg || "Done.";
      bootstrap.Modal.getOrCreateInstance(m).show();
      return;
    }
    alert(msg || "Done.");
  }

  // -------------------------
  // Preview helper (PDF in iframe) - hardened (admin-style)
  // -------------------------
  function openPreview(fileUrl, fileName) {
    const resolved = resolvePublicUrl(fileUrl);
    if (!resolved) {
      safeShowError("No file URL found to preview.");
      return;
    }

    const modalEl = rqs("#suPreviewFileModal");
    // no modal? just open in new tab
    if (!modalEl || !window.bootstrap) {
      window.open(resolved, "_blank", "noopener");
      return;
    }

    const title = qs("#suPreviewFileName", modalEl);
    const iframe = qs("#suPreviewIframe", modalEl);
    const hint = qs("#suPreviewHint", modalEl);
    const openBtn = qs("#suPreviewOpenNewTab", modalEl);

    if (title) title.textContent = fileName || "Preview";

    // Use admin approach: simple anchor tag with href
    if (openBtn) {
      openBtn.target = "_blank";
      openBtn.rel = "noopener";
      openBtn.href = resolved;

      // Clean up any existing event listeners to avoid conflicts
      if (openBtn.__suBound && openBtn.__suBoundHandler) {
        openBtn.removeEventListener("click", openBtn.__suBoundHandler);
      }
      
      // Only prevent default for empty links (like the admin does)
      if (!openBtn.__suBound) {
        openBtn.__suBound = true;
        openBtn.__suBoundHandler = (e) => {
          const href = String(openBtn.getAttribute("href") || "");
          if (!href || href === "#" || href.startsWith("#")) {
            e.preventDefault();
          }
          // Otherwise let the browser handle the anchor naturally
        };
        openBtn.addEventListener("click", openBtn.__suBoundHandler);
      }
    }

    const extSrc = (fileName || resolved || "").toLowerCase();
    const isPdf = extSrc.endsWith(".pdf");
    const isDocx = extSrc.endsWith(".docx");

    if (iframe) iframe.src = "about:blank";
    if (hint) hint.style.display = "none";

    if (isPdf) {
      // iframe pdf preview (cache-busted)
      if (iframe) iframe.src = withCacheBust(resolved);
    } else if (isDocx) {
      // docx can't preview reliably without viewer; show hint + allow new tab
      if (hint) hint.style.display = "";
    } else {
      // non-previewables -> open directly
      window.open(resolved, "_blank", "noopener");
      return;
    }

    bootstrap.Modal.getOrCreateInstance(modalEl).show();
  }

  // -------------------------
  // ✅ Recommended View Modal PDF + Activate helpers (UPDATED)
  // -------------------------
  function setPdfInModal(A, url) {
    const frame = A.rqs("#suRecommendationFrame");
    if (!frame) return;

    const resolved = A.resolvePublicUrl(url || "");
    
    // Check if URL is valid before setting it
    if (!resolved) {
      frame.src = "about:blank";
      const openBtn = A.rqs("#suOpenRecPdfBtn");
      if (openBtn) {
        openBtn.href = "#";
        openBtn.classList.add("disabled");
        openBtn.setAttribute("aria-disabled", "true");
        // Remove any existing click handlers to prevent confusion
        if (openBtn.__suBound && openBtn.__suBoundHandler) {
          openBtn.removeEventListener("click", openBtn.__suBoundHandler);
        }
        openBtn.__suBound = true;
        openBtn.__suBoundHandler = (e) => {
          e.preventDefault();
          A.safeShowError("PDF file location could not be determined.");
        };
        openBtn.addEventListener("click", openBtn.__suBoundHandler);
      }
      return;
    }

    // Set the iframe source
    frame.src = resolved ? A.withCacheBust?.(resolved) || resolved : "about:blank";

    // Use admin approach: simple anchor tag with href
    const openBtn = A.rqs("#suOpenRecPdfBtn");
    if (openBtn) {
      // Clean up any existing event listeners
      if (openBtn.__suBound && openBtn.__suBoundHandler) {
        openBtn.removeEventListener("click", openBtn.__suBoundHandler);
      }
      
      // Set up the anchor tag like admin does
      openBtn.href = resolved;
      openBtn.classList.remove("disabled");
      openBtn.removeAttribute("aria-disabled");
      openBtn.target = "_blank";
      openBtn.rel = "noopener";
      
      // Add click handler to prevent default for empty links only
      openBtn.__suBound = true;
      openBtn.__suBoundHandler = (e) => {
        const href = String(openBtn.getAttribute("href") || "");
        if (!href || href === "#" || href.startsWith("#")) {
          e.preventDefault();
          A.safeShowError("PDF file location could not be determined.");
        }
        // Let browser handle valid links naturally
      };
      openBtn.addEventListener("click", openBtn.__suBoundHandler);
    }
  }

  async function openPreviewModal(A, requestId) {
    const modalEl = A.rqs("#suViewRecommendedModal");
    if (!modalEl || !window.bootstrap) return;

    // store request id in the correct hidden input
    const hid = A.rqs("#suActivateRequestId");
    if (hid) hid.value = String(requestId);

    // optional subtitle text in your HTML
    const sub = A.rqs("#suViewRecSub");
    if (sub) sub.textContent = `Request #${requestId}`;

    // reset iframe + open button
    setPdfInModal(A, "");

    bootstrap.Modal.getOrCreateInstance(modalEl).show();

    try {
      const data = await A.postJSON({ action: "get_request", request_id: requestId });
      const r = data?.item || null;
      if (!r) throw new Error("Request not found.");

      if (sub) sub.textContent = `${r.org_name || "Organization"} • Request #${requestId}`;

      // Check if recommendation file exists
      const recommendationUrl = r.recommendation_url || r.recommendation_file || "";
      if (!recommendationUrl) {
        A.safeShowError("No recommendation PDF file found for this request.");
      }
      
      // IMPORTANT: backend might return relative paths; resolvePublicUrl handles that.
      setPdfInModal(A, recommendationUrl);
      
    } catch (e) {
      A.safeShowError(e.message || "Failed to load request.");
    }
  }

  async function activateFromModal(A) {
    const modalEl = A.rqs("#suViewRecommendedModal");
    if (!modalEl || !window.bootstrap) return;

    const hid = A.rqs("#suActivateRequestId");
    const requestId = Number(hid?.value || 0);
    if (!requestId) return;

    const btn = A.rqs("#suActivateBtn");
    if (btn) {
      btn.disabled = true;
      btn.dataset._old = btn.innerHTML;
      btn.innerHTML =
        `<span class="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span>` +
        `Activating...`;
    }

    try {
      await A.postJSON({ action: "activate_request", request_id: requestId });

      bootstrap.Modal.getOrCreateInstance(modalEl).hide();
      setTimeout(() => A.safeShowSuccess("Organization activated successfully."), 150);

      A.refreshAll?.();
    } catch (e) {
      A.safeShowError(e.message || "Failed to activate organization.");
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = btn.dataset._old || btn.innerHTML;
        delete btn.dataset._old;
      }
    }
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
  // Pagination
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
      item.className = "page-item" + (disabled ? " disabled" : "") + (active ? " active" : "");
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

    ulEl.appendChild(li("‹", cur <= 1, false, cur - 1, "Previous"));

    const windowSize = 2;
    let start = Math.max(1, cur - windowSize);
    let end = Math.min(totalPages, cur + windowSize);
    while (end - start < windowSize * 2 && (start > 1 || end < totalPages)) {
      if (start > 1) start--;
      else if (end < totalPages) end++;
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

    ulEl.appendChild(li("›", cur >= totalPages, false, cur + 1, "Next"));
  }

  // -------------------------
  // Data loaders
  // -------------------------
  async function loadTerms() {
    const data = await postJSON({ action: "list_terms" });
    store.terms = Array.isArray(data?.terms) ? data.terms : [];
    return store.terms;
  }

  function fillYearSelect(selectEl, { includeAllLabel = "All Years" } = {}) {
    if (!selectEl) return;

    const years = new Set();
    for (const t of store.terms) {
      if (t?.school_year) years.add(String(t.school_year));
    }
    const list = Array.from(years);
    list.sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));

    const curVal = selectEl.value;
    selectEl.innerHTML = "";

    const opt0 = document.createElement("option");
    opt0.value = "";
    opt0.textContent = includeAllLabel;
    selectEl.appendChild(opt0);

    for (const y of list) {
      const opt = document.createElement("option");
      opt.value = y;
      opt.textContent = y;
      selectEl.appendChild(opt);
    }

    if (curVal) selectEl.value = curVal;
  }

  // -------------------------
  // Boot feature modules (SA-style)
  // -------------------------
  function bootModules(root) {
    try {
      if (window.SUAccreditationRecommended?.init) {
        window.SUAccreditationRecommended.init(root);
      } else {
        console.warn("SUAccreditationRecommended module not found.");
      }
    } catch (e) {
      console.error("Recommended module init failed:", e);
    }

    try {
      if (window.SUAccreditationActive?.init) {
        window.SUAccreditationActive.init(root);
      } else {
        console.warn("SUAccreditationActive module not found.");
      }
    } catch (e) {
      console.error("Active module init failed:", e);
    }

    if (typeof window.SUAccreditation.refreshAll !== "function") {
      window.SUAccreditation.refreshAll = async function () {
        console.warn("refreshAll() fallback used (modules didn't register).");
        try {
          await window.SUAccreditationRecommended?.refresh?.();
        } catch (_) {}
        try {
          await window.SUAccreditationActive?.refresh?.();
        } catch (_) {}
      };
    }
  }

  // -------------------------
  // IMPORTANT: intercept preview clicks so SPA doesn't navigate
  // -------------------------
  function bindPreviewDelegation(root) {
    const host = root || document;
    if (host.__suPreviewBound) return;
    host.__suPreviewBound = true;

    host.addEventListener(
      "click",
      (e) => {
        const target = e.target;
        if (!target) return;

        const el = target.closest?.('[data-su-preview="1"], .su-preview-link');
        if (!el) return;

        // Pull URL from common places
        const href = String(el.getAttribute("href") || "");
        const dataUrl = String(el.getAttribute("data-url") || "");
        const fileUrl = (dataUrl || href).trim();

        // if it looks like a preview link but doesn't have a real url, block navigation to "#"
        if (!fileUrl || fileUrl === "#" || fileUrl.startsWith("#")) {
          e.preventDefault();
          e.stopPropagation();
          safeShowError("No file URL found to preview.");
          return;
        }

        // If it's a normal external link and NOT meant for preview, let it pass unless flagged
        const lower = fileUrl.toLowerCase();
        const looksPreviewable = lower.endsWith(".pdf") || lower.endsWith(".docx");
        const forced = el.matches?.('[data-su-preview="1"], .su-preview-link');

        if (!forced && !looksPreviewable) return;

        e.preventDefault();
        e.stopPropagation();

        const fileName =
          el.getAttribute("data-filename") ||
          el.getAttribute("data-name") ||
          el.textContent?.trim() ||
          "Preview";

        openPreview(fileUrl, fileName);
      },
      true
    );
  }

  // -------------------------
  // Init
  // -------------------------
  async function init(root = document) {
    // Always update root so rqs() targets the right element after re-navigation
    store._root = root;

    // Reset store so re-entering the page always starts fresh
    store.search = "";
    store.recommended = { items: [], page: 1, perPage: store.recommended?.perPage || 10, total: 0, year: "", termId: "" };
    store.active      = { items: [], page: 1, perPage: store.active?.perPage      || 10, total: 0, year: "", termId: "" };

    // Reset search input to match cleared store
    const searchEl = rqs("#suAccSearch");
    if (searchEl) {
      searchEl.value = "";
      if (!searchEl.__suBound) {
        searchEl.__suBound = true;
        searchEl.addEventListener(
          "input",
          debounce(() => {
            store.search = String(searchEl.value || "").trim();
            store.recommended.page = 1;
            store.active.page = 1;
            window.SUAccreditation?.refreshAll?.();
          }, 250)
        );
      }
    }

    const refreshBtn = rqs("#suAccRefreshBtn");
    if (refreshBtn && !refreshBtn.__suBound) {
      refreshBtn.__suBound = true;
      refreshBtn.addEventListener("click", () => {
        window.SUAccreditation?.refreshAll?.();
      });
    }

    try {
      await loadTerms();
    } catch (e) {
      console.warn("Could not load terms:", e);
    }

    fillYearSelect(rqs("#suRecommendedYearFilter"), { includeAllLabel: "All Years" });
    fillYearSelect(rqs("#suActiveYearFilter"), { includeAllLabel: "All Years" });

    bootModules(root);
    bindPreviewDelegation(root);

    // Bind recommended modal open trigger (guard per host element)
    const host = root || document;
    if (!host.__suRecViewBound) {
      host.__suRecViewBound = true;
      host.addEventListener("click", (e) => {
        const btn = e.target?.closest?.("[data-su-open-rec]");
        if (!btn) return;
        e.preventDefault();
        const id = Number(btn.getAttribute("data-id") || 0);
        if (!id) return;
        openPreviewModal(window.SUAccreditation, id);
      });
    }

    try {
      await window.SUAccreditation?.refreshAll?.();
    } catch (e) {
      console.error(e);
      safeShowError(e?.message || "Failed to load accreditation data.");
    }
  }

  // Expose base
  window.SUAccreditation = {
    API_URL,
    store,
    qs,
    qsa,
    rqs,
    rqsa,
    escapeHtml,
    debounce,
    postJSON,
    renderPagination,
    safeShowError,
    safeShowSuccess,

    // ✅ expose preview helpers so feature modules can call them directly
    getAppBaseUrlFromLocation,
    resolvePublicUrl,
    withCacheBust,
    openPreview,

    // ✅ expose your new modal helpers
    setPdfInModal,
    openPreviewModal,
    activateFromModal,

    init,
    refreshAll: null,
  };
})();