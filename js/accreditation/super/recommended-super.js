/* js/accreditation/super/recommended.js */
/* global bootstrap */

(function () {
  "use strict";

  if (window.__suRecommendedBooted) return;
  window.__suRecommendedBooted = true;

  function mustBase() {
    if (!window.SUAccreditation) throw new Error("Base module not loaded (SUAccreditation).");
    return window.SUAccreditation;
  }

  function badge(status) {
    const s = String(status || "");
    const map = {
      Recommended: "info",
      Active: "success",
      Approved: "primary",
      Rejected: "danger",
      Pending: "secondary",
      Returned: "warning",
    };
    const cls = map[s] || "secondary";
    return `<span class="badge text-bg-${cls}">${s || "—"}</span>`;
  }

  function scopeBadge(scope) {
    const s = String(scope || "—");
    const map = { General: "info", Exclusive: "dark", Clubs: "warning", Both: "primary", All: "primary" };
    const cls = map[s] || "secondary";
    const label = s === "Both" ? "All" : s;
    return `<span class="badge text-bg-${cls}">${label}</span>`;
  }

  function row(A, r) {
    const id = A.escapeHtml(r.id);
    const org = A.escapeHtml(r.org_name || "—");
    const abbr = A.escapeHtml(r.org_abbr || "");
    const descRaw = r.description ?? r.org_description ?? "";
    const desc = A.escapeHtml(String(descRaw || "").trim());
    const scope = A.escapeHtml(r.scope || "—");
    const program = A.escapeHtml(r.program || "—");
    const term = A.escapeHtml(r.term_label || "—");
    const coord = A.escapeHtml(r.coordinator_name || "—");
    const mod = A.escapeHtml(r.moderator_name || "—");
    const status = r.status || "—";

    return `
      <tr data-id="${id}">
        <td class="text-muted">${id}</td>
        <td class="su-wrap">
          <div class="fw-semibold">${org}</div>
          ${abbr ? `<div class="text-muted small">${abbr}</div>` : ``}
          ${desc ? `<div class="text-muted small su-wrap mt-1">${desc}</div>` : ``}
        </td>
        <td>${scopeBadge(scope)}</td>
        <td>${program}</td>
        <td class="su-wrap">${term}</td>
        <td class="su-wrap">${coord}</td>
        <td class="su-wrap">${mod}</td>
        <td>${badge(status)}</td>
        <td class="text-end">
          <button class="btn btn-outline-secondary btn-sm" type="button" data-action="view" title="Preview recommendation">
            <i class="bi bi-eye"></i>
          </button>
        </td>
      </tr>
    `;
  }

  async function fetchRecommended(A) {
  const { store } = A;
  const r = store.recommended;

  const payload = {
    action: "list_requests",
    status: "Recommended", // This filters to only Recommended
    q: store.search || "",
    school_year: r.year || "",
    page: r.page,
    per_page: r.perPage,
  };

  const data = await A.postJSON(payload);
  r.items = Array.isArray(data?.items) ? data.items : [];
  r.page = Number(data?.page || 1);
  r.perPage = Number(data?.per_page || r.perPage || 10);
  r.total = Number(data?.total || 0); // This should be the total for Recommended only

  // ✅ Use the total from the filtered results, not a separate counts object
  const badgeEl = A.rqs("#suRecommendedCount");
  if (badgeEl) {
    badgeEl.textContent = String(r.total);
    badgeEl.classList.toggle("d-none", r.total === 0);
  }

  renderRecommended(A);
  }

  function renderRecommended(A) {
    const { store } = A;
    const r = store.recommended;

    const tbody = A.rqs("#suRecommendedTbody");
    const meta = A.rqs("#suRecommendedMeta");
    const pag = A.rqs("#suRecommendedPagination");
    const pagMeta = A.rqs("#suRecommendedPaginationMeta");

    if (meta) meta.innerHTML = `Showing <span class="fw-semibold">${r.total || 0}</span> recommended requests.`;

    if (!tbody) return;
    if (!r.items.length) {
      tbody.innerHTML = `
        <tr><td colspan="9" class="text-center text-muted py-5">
          <div class="mb-2"><i class="bi bi-check2-square fs-2"></i></div>
          No recommended requests found.
        </td></tr>`;
    } else {
      tbody.innerHTML = r.items.map((it) => row(A, it)).join("");
    }

    A.renderPagination(pag, pagMeta, r.page, r.perPage, r.total, (newPage) => {
      store.recommended.page = newPage;
      fetchRecommended(A).catch((e) => A.safeShowError(e.message));
    });
  }

  async function openPreviewModal(A, requestId) {
    const modalEl = A.rqs("#suViewRecommendedModal");
    if (!modalEl || !window.bootstrap) return;

    // ✅ Reset using BASE helper so it also resets "Open PDF" button properly
    if (typeof A.setPdfInModal === "function") A.setPdfInModal(A, "");

    // store request id
    const hid = A.rqs("#suActivateRequestId") || A.rqs("#suViewRequestId");
    if (hid) hid.value = String(requestId);

    const sub = A.rqs("#suViewRecSub");
    if (sub) sub.textContent = `Request #${requestId}`;

    bootstrap.Modal.getOrCreateInstance(modalEl).show();

    try {
      const data = await A.postJSON({ action: "get_request", request_id: requestId });
      const r = data?.item || null;
      if (!r) throw new Error("Request not found.");

      if (sub) sub.textContent = `${r.org_name || "Organization"} • Request #${requestId}`;

      // ✅ Use any backend field you might return
      const recommendationUrl =
        r.recommendation_url ||
        r.recommendation_file ||
        r.recommendation_path ||
        "";

      if (!recommendationUrl) {
        A.safeShowError("No recommendation PDF file found for this request.");
      }

      // ✅ IMPORTANT: Use BASE helper so iframe + Open PDF button pull the same resolved URL
      if (typeof A.setPdfInModal === "function") {
        A.setPdfInModal(A, recommendationUrl);
      } else {
        // fallback (should not happen)
        const frame = A.rqs("#suRecommendationFrame");
        if (frame) frame.src = A.resolvePublicUrl ? A.resolvePublicUrl(recommendationUrl) : recommendationUrl;
      }
    } catch (e) {
      A.safeShowError(e.message || "Failed to load request.");
    }
  }

  // In recommended-super.js, update the activateFromModal function:
  async function activateFromModal(A) {
    const modalEl = A.rqs("#suViewRecommendedModal");
    if (!modalEl || !window.bootstrap) return;

    const hid = A.rqs("#suActivateRequestId") || A.rqs("#suViewRequestId");
    const requestId = Number(hid?.value || 0);
    if (!requestId) {
      A.safeShowError("Invalid request ID.");
      return;
    }

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

      // Close view modal
      bootstrap.Modal.getOrCreateInstance(modalEl).hide();
      
      // Show success message
      setTimeout(() => A.safeShowSuccess("Organization activated successfully."), 150);

      // ✅ RELOAD BOTH TABLES
      // Refresh recommended table
      await fetchRecommended(A);
      // Refresh active table
      if (window.SUAccreditationActive?.fetchActive) {
        await window.SUAccreditationActive.fetchActive(A);
      }
      
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

  function bindUI(A) {
    const tbody = A.rqs("#suRecommendedTbody");
    if (tbody && !tbody.__bound) {
      tbody.__bound = true;
      tbody.addEventListener("click", (e) => {
        const btn = e.target?.closest?.("[data-action]");
        if (!btn) return;

        const tr = e.target?.closest?.("tr[data-id]");
        const id = Number(tr?.dataset?.id || 0);
        if (!id) return;

        if (btn.dataset.action === "view") openPreviewModal(A, id);
      });
    }

    const actBtn = A.rqs("#suActivateBtn");
    if (actBtn && !actBtn.__bound) {
      actBtn.__bound = true;
      actBtn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        activateFromModal(A);
      });
    }

    const yearSel = A.rqs("#suRecommendedYearFilter");
    if (yearSel && !yearSel.__bound) {
      yearSel.__bound = true;
      yearSel.addEventListener("change", () => {
        A.store.recommended.year = yearSel.value || "";
        A.store.recommended.page = 1;
        fetchRecommended(A).catch((e) => A.safeShowError(e.message));
      });
    }
  }

  window.SUAccreditationRecommended = {
    init(root) {
      const A = mustBase();
      // Always re-bind (helpers guard per-element) and always fetch fresh
      bindUI(A);
      return fetchRecommended(A).catch((e) => A.safeShowError(e.message));
    },
    fetchRecommended,
    activateFromModal: function () {
      const A = mustBase();
      activateFromModal(A);
    },
  };
})();
