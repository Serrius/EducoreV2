/* js/system-authority/restore.js */
/* global bootstrap, showSuccess, showError */

(function () {
  "use strict";

  let S;

  const state = {
    super: { rows: [], page: 1, pageSize: 10, search: "" },
    sdc: { rows: [], page: 1, pageSize: 10, search: "" },
  };

  // Modal state
  let restoreModal = null;
  let pendingRestore = null; // { historyId, roleVal, restoredName }

  function fmt(v) {
    return v == null || v === "" ? "—" : String(v);
  }

  function escapeHtml(str) {
    return String(str)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  // For server-side "reason" text (not HTML), keep it safe/clean.
  function cleanReasonText(str) {
    return String(str || "")
      .replace(/\s+/g, " ")
      .trim()
      .replaceAll('"', "'"); // avoid weird quote issues in logs
  }

  function fullName(r) {
    const parts = [r.first_name, r.middle_name, r.last_name, r.suffix].filter(Boolean);
    return parts.join(" ").replace(/\s+/g, " ").trim();
  }

  function matchesSearch(r, needle) {
    if (!needle) return true;
    const hay = [
      r.id_number,
      r.email,
      r.assigned_at,
      r.revoked_at,
      r.reason,
      fullName(r),
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    return hay.includes(needle.toLowerCase());
  }

  function paginate(arr, page, pageSize) {
    const total = arr.length;
    const pages = Math.max(1, Math.ceil(total / pageSize));
    const safePage = Math.min(Math.max(1, page), pages);
    const start = (safePage - 1) * pageSize;
    const end = Math.min(start + pageSize, total);
    return { total, pages, page: safePage, start, end, slice: arr.slice(start, end) };
  }

  function renderPagination(ulEl, currentPage, totalPages) {
    if (!ulEl) return;

    const items = [];
    const prevDisabled = currentPage <= 1 ? "disabled" : "";
    items.push(`
      <li class="page-item ${prevDisabled}">
        <a class="page-link" href="#" data-page="prev">Prev</a>
      </li>
    `);

    const windowSize = 5;
    let start = Math.max(1, currentPage - Math.floor(windowSize / 2));
    let end = Math.min(totalPages, start + windowSize - 1);
    start = Math.max(1, end - windowSize + 1);

    for (let p = start; p <= end; p++) {
      const active = p === currentPage ? "active" : "";
      items.push(`
        <li class="page-item ${active}">
          <a class="page-link" href="#" data-page="${p}">${p}</a>
        </li>
      `);
    }

    const nextDisabled = currentPage >= totalPages ? "disabled" : "";
    items.push(`
      <li class="page-item ${nextDisabled}">
        <a class="page-link" href="#" data-page="next">Next</a>
      </li>
    `);

    ulEl.innerHTML = items.join("");
  }

  /**
   * We only want "old admins" => rows that have revoked_at NOT NULL.
   * And we don’t want duplicates spam, so keep the latest record per user_id.
   */
  function buildRestoreCandidates(rows, currentActiveUserId) {
    const revoked = rows.filter((r) => r.revoked_at != null && String(r.revoked_at).trim() !== "");

    // Exclude current active holder if it somehow appears
    const filtered = currentActiveUserId
      ? revoked.filter((r) => Number(r.user_id) !== Number(currentActiveUserId))
      : revoked;

    // Keep latest per user_id (by assigned_at desc)
    filtered.sort((a, b) => String(b.assigned_at || "").localeCompare(String(a.assigned_at || "")));

    const seen = new Set();
    const unique = [];
    for (const r of filtered) {
      const uid = Number(r.user_id || 0);
      if (!uid) continue;
      if (seen.has(uid)) continue;
      seen.add(uid);
      unique.push(r);
    }
    return unique;
  }

  function renderTable(roleKey) {
    const isSuper = roleKey === "super";
    const st = isSuper ? state.super : state.sdc;

    const tbody = S.qs(isSuper ? "#restoreSuperTbody" : "#restoreSDCTbody");
    const meta = S.qs(isSuper ? "#restoreSuperMeta" : "#restoreSDCMeta");
    const pag = S.qs(isSuper ? "#restoreSuperPagination" : "#restoreSDCPagination");

    if (!tbody || !meta || !pag) return;

    const filtered = st.rows.filter((r) => matchesSearch(r, st.search));
    const pageObj = paginate(filtered, st.page, st.pageSize);
    st.page = pageObj.page;

    if (pageObj.total === 0) {
      tbody.innerHTML = `
        <tr>
          <td class="text-muted" colspan="6">No inactive admins found.</td>
        </tr>
      `;
      meta.textContent = "Showing 0–0 of 0";
      renderPagination(pag, 1, 1);
      return;
    }

    meta.textContent = `Showing ${pageObj.start + 1}–${pageObj.end} of ${pageObj.total}`;
    renderPagination(pag, st.page, pageObj.pages);

    tbody.innerHTML = pageObj.slice
      .map((r) => {
        const idnum = escapeHtml(fmt(r.id_number));
        const name = escapeHtml(fullName(r) || "—");
        const email = escapeHtml(fmt(r.email));
        const created = escapeHtml(fmt(r.assigned_at));
        const revoked = escapeHtml(fmt(r.revoked_at));
        const reason = escapeHtml(fmt(r.reason));

        return `
          <tr>
            <td>${idnum}</td>
            <td>
              <div class="fw-semibold">${name}</div>
              <div class="text-muted small">Reason: ${reason}</div>
            </td>
            <td>${email}</td>
            <td>${created}</td>
            <td>${revoked}</td>
            <td>
              <button
                type="button"
                class="btn btn-sm btn-success restore-admin-btn"
                data-history-id="${escapeHtml(r.id)}"
                data-role="${escapeHtml(isSuper ? "super_admin" : "special_admin")}"
                data-idnum="${idnum}"
                data-name="${escapeHtml(fullName(r) || "—")}"
                data-email="${email}"
              >
                <i class="bi bi-arrow-counterclockwise me-1"></i>Restore
              </button>
            </td>
          </tr>
        `;
      })
      .join("");
  }

  async function loadRole(roleVal) {
    const data = await S.postJSON({
      action: "get_audit",
      role: roleVal,
      limit: 500,
    });
    return Array.isArray(data.rows) ? data.rows : [];
  }

  async function refresh() {
    try {
      const current = await S.getCurrent();
      const currentSuperId = current?.super_admin?.id || null;
      const currentSdcId = current?.special_admin?.id || null;

      const [superRows, sdcRows] = await Promise.all([
        loadRole("super_admin"),
        loadRole("special_admin"),
      ]);

      state.super.rows = buildRestoreCandidates(superRows, currentSuperId);
      state.sdc.rows = buildRestoreCandidates(sdcRows, currentSdcId);

      renderTable("super");
      renderTable("sdc");
    } catch (e) {
      S.safeShowError(e?.message || "Failed to load restore list.");
    }
  }

  function setRestoreModalLoading(isLoading) {
    const btn = S.qs("#btnConfirmRestore");
    if (!btn) return;

    btn.disabled = !!isLoading;

    const t = btn.querySelector(".restore-btn-text");
    const l = btn.querySelector(".restore-btn-loading");
    if (t) t.classList.toggle("d-none", !!isLoading);
    if (l) l.classList.toggle("d-none", !isLoading);
  }

  function roleLabel(roleVal) {
    return roleVal === "super_admin" ? "Super Admin" : "Student Development Coordinator";
  }

  function openRestoreModal({ historyId, roleVal, idnum, name, email }) {
    const modalEl = S.qs("#modalRestoreConfirm");
    if (!modalEl) {
      S.safeShowError("Restore modal is missing in HTML. Add #modalRestoreConfirm.");
      return;
    }

    if (!restoreModal) restoreModal = bootstrap.Modal.getOrCreateInstance(modalEl);

    // Fill UI
    S.qs("#restoreConfirmRole") && (S.qs("#restoreConfirmRole").textContent = roleLabel(roleVal));
    S.qs("#restoreConfirmIdNum") && (S.qs("#restoreConfirmIdNum").textContent = idnum || "—");
    S.qs("#restoreConfirmName") && (S.qs("#restoreConfirmName").textContent = name || "—");
    S.qs("#restoreConfirmEmail") && (S.qs("#restoreConfirmEmail").textContent = email || "—");

    // Store payload (hidden inputs if you want them)
    S.qs("#restoreConfirmHistoryId") && (S.qs("#restoreConfirmHistoryId").value = String(historyId));
    S.qs("#restoreConfirmRoleValue") && (S.qs("#restoreConfirmRoleValue").value = String(roleVal));

    // Store pending restore info (include restored name)
    pendingRestore = {
      historyId,
      roleVal,
      restoredName: cleanReasonText(name || "previous admin"),
    };

    setRestoreModalLoading(false);
    restoreModal.show();
  }

  async function confirmRestore() {
    if (!pendingRestore) return;

    const { historyId, roleVal, restoredName } = pendingRestore;
    setRestoreModalLoading(true);

    // ✅ Reason is attached to the REVOKED admin row (prev holder),
    // so it should read like “revoked because X was restored”.
    const reasonText = `Revoked due to restoring ${restoredName || "a previous admin"}`;

    try {
      await S.postJSON({
        action: "restore_from_history",
        role: roleVal,
        history_id: Number(historyId),
        reason: reasonText,
      });

      S.safeShowSuccess("Restored successfully.");

      // Close modal
      const modalEl = S.qs("#modalRestoreConfirm");
      if (modalEl) bootstrap.Modal.getOrCreateInstance(modalEl).hide();

      pendingRestore = null;

      // Refresh main cards + audit + restore tables
      await window.SystemAuthority?.refresh?.();
      await window.SystemAuthorityAudit?.refresh?.();
      await refresh();
    } catch (e) {
      S.safeShowError(e?.message || "Restore failed.");
    } finally {
      setRestoreModalLoading(false);
    }
  }

  function bindControls() {
    // SUPER controls
    const superPageSize = S.qs("#restoreSuperPageSize");
    const superSearch = S.qs("#restoreSuperSearch");
    const superPag = S.qs("#restoreSuperPagination");

    if (superPageSize) {
      superPageSize.addEventListener("change", () => {
        state.super.pageSize = parseInt(superPageSize.value, 10) || 10;
        state.super.page = 1;
        renderTable("super");
      });
    }

    if (superSearch) {
      superSearch.addEventListener("input", () => {
        state.super.search = superSearch.value.trim();
        state.super.page = 1;
        renderTable("super");
      });
    }

    if (superPag) {
      superPag.addEventListener("click", (e) => {
        const a = e.target.closest("a.page-link");
        if (!a) return;
        e.preventDefault();

        const page = a.getAttribute("data-page");
        const filtered = state.super.rows.filter((r) => matchesSearch(r, state.super.search));
        const totalPages = Math.max(1, Math.ceil(filtered.length / state.super.pageSize));

        if (page === "prev") state.super.page = Math.max(1, state.super.page - 1);
        else if (page === "next") state.super.page = Math.min(totalPages, state.super.page + 1);
        else state.super.page = parseInt(page, 10) || 1;

        renderTable("super");
      });
    }

    // SDC controls
    const sdcPageSize = S.qs("#restoreSDCPageSize");
    const sdcSearch = S.qs("#restoreSDCSearch");
    const sdcPag = S.qs("#restoreSDCPagination");

    if (sdcPageSize) {
      sdcPageSize.addEventListener("change", () => {
        state.sdc.pageSize = parseInt(sdcPageSize.value, 10) || 10;
        state.sdc.page = 1;
        renderTable("sdc");
      });
    }

    if (sdcSearch) {
      sdcSearch.addEventListener("input", () => {
        state.sdc.search = sdcSearch.value.trim();
        state.sdc.page = 1;
        renderTable("sdc");
      });
    }

    if (sdcPag) {
      sdcPag.addEventListener("click", (e) => {
        const a = e.target.closest("a.page-link");
        if (!a) return;
        e.preventDefault();

        const page = a.getAttribute("data-page");
        const filtered = state.sdc.rows.filter((r) => matchesSearch(r, state.sdc.search));
        const totalPages = Math.max(1, Math.ceil(filtered.length / state.sdc.pageSize));

        if (page === "prev") state.sdc.page = Math.max(1, state.sdc.page - 1);
        else if (page === "next") state.sdc.page = Math.min(totalPages, state.sdc.page + 1);
        else state.sdc.page = parseInt(page, 10) || 1;

        renderTable("sdc");
      });
    }

    // Restore buttons -> OPEN MODAL
    document.addEventListener("click", (e) => {
      const btn = e.target.closest(".restore-admin-btn");
      if (!btn) return;

      const historyId = btn.getAttribute("data-history-id");
      const roleVal = btn.getAttribute("data-role");
      if (!historyId || !roleVal) return;

      openRestoreModal({
        historyId,
        roleVal,
        idnum: btn.getAttribute("data-idnum") || "—",
        name: btn.getAttribute("data-name") || "—",
        email: btn.getAttribute("data-email") || "—",
      });
    });

    // Confirm restore button inside modal
    const confirmBtn = S.qs("#btnConfirmRestore");
    if (confirmBtn) {
      confirmBtn.addEventListener("click", () => {
        confirmRestore();
      });
    }

    // Cleanup pending state when modal closes
    const modalEl = S.qs("#modalRestoreConfirm");
    if (modalEl) {
      modalEl.addEventListener("hidden.bs.modal", () => {
        pendingRestore = null;
        setRestoreModalLoading(false);
      });
    }

    // Auto-refresh when Restore tab becomes visible
    const restoreTabBtn = S.qs("#tab-restore");
    if (restoreTabBtn) {
      restoreTabBtn.addEventListener("shown.bs.tab", () => {
        refresh();
      });
    }
  }

  function init(shared) {
    S = shared;
    bindControls();
  }

  window.SystemAuthorityRestore = {
    init,
    refresh,
  };
})();
