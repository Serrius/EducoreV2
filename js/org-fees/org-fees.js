/* js/organization-payments.js */
/* global bootstrap, showSuccess, showError */

(function () {
  "use strict";
  if (window.__OrgPaymentsBooted) return;
  window.__OrgPaymentsBooted = true;

  const API_URL = "php/organization-payments.php";

  function qs(sel, root = document) { return root.querySelector(sel); }
  function qsa(sel, root = document) { return Array.from(root.querySelectorAll(sel)); }

  function safeShowError(msg) {
    if (typeof window.showError === "function") return window.showError(msg);
    alert(msg || "Something went wrong.");
  }
  function safeShowSuccess(msg) {
    if (typeof window.showSuccess === "function") return window.showSuccess(msg);
    alert(msg || "Success.");
  }

  function escapeHtml(s) {
    return String(s ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  // same resolver logic as clubs.js
  function resolveAppUrl(path) {
    if (!path) return "";
    const raw = String(path).trim();
    if (!raw) return "";
    if (/^https?:\/\//i.test(raw)) return raw;

    const p = raw.replaceAll("\\", "/");
    const parts = (window.location.pathname || "/").split("/").filter(Boolean);
    const base = parts.length > 0 ? `/${parts[0]}` : "";
    if (p.startsWith("/")) return base + p;
    return base + "/" + p.replace(/^\.?\//, "");
  }

  function openNewTab(url) {
    const u = resolveAppUrl(url);
    if (!u) return;
    window.open(u, "_blank", "noopener");
  }

  async function postJSON(payload) {
    const res = await fetch(API_URL, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload || {}),
    });

    const text = await res.text();
    console.log("[OrgPayments] RAW:", res.status, text);

    let data;
    try { data = JSON.parse(text); }
    catch { throw new Error("Invalid server response (not JSON). Check console RAW."); }

    if (!res.ok) throw new Error(data?.message || `HTTP ${res.status}`);
    if (!data?.success) throw new Error(data?.message || "Request failed.");
    return data;
  }

  const state = {
    term: null,
    orgs: [],
    orgsFiltered: [],
    selectedOrg: null,
    permissions: { user_id: 0, role: "", is_officer: false, can_view_list: false, can_set_payment: false },
    paid: { rows: [], search: "", page: 1, perPage: 10, total: 0, totalPages: 1 },
    unpaid: { rows: [], search: "", page: 1, perPage: 10, total: 0, totalPages: 1 },
    myStatus: null,
  };

  function showSection(which) {
    const list = qs("#orgPaySectionList");
    const details = qs("#orgPaySectionDetails");
    if (list) list.classList.toggle("d-none", which !== "list");
    if (details) details.classList.toggle("d-none", which !== "details");
  }

  function money(n) {
    const v = Number(n || 0);
    return `₱ ${v.toFixed(2)}`;
  }

  function normText(v) {
    return String(v ?? "").trim();
  }

  function setText(sel, v, fallback) {
    const el = qs(sel);
    if (!el) return;
    const s = normText(v);
    el.textContent = s || (fallback ?? "—");
  }

  function setLogo(sel, path) {
    const el = qs(sel);
    if (!el) return;
    const u = resolveAppUrl(path);
    el.src = u || "assets/images/logo.png";
  }

  function renderOrgInfo(org) {
    if (!org) return;
    // Logo
    setLogo("#orgPayOrgLogo", org.logo_path);

    // Dropdown sections
    setText("#orgPayInfoDesc", org.description, "No description provided.");
    setText("#orgPayInfoMission", org.mission, "No mission provided.");
    setText("#orgPayInfoVision", org.vision, "No vision provided.");
    setText("#orgPayInfoAdvocacy", org.advocacy, "No advocacy provided.");
  }

  function setBtnLoading(btn, on, textSel, loadSel) {
    if (!btn) return;
    const t = textSel ? qs(textSel) : null;
    const l = loadSel ? qs(loadSel) : null;
    btn.disabled = !!on;
    if (t) t.classList.toggle("d-none", !!on);
    if (l) l.classList.toggle("d-none", !on);
  }

  function clampInt(n, def, min, max) {
    const x = Number.parseInt(n, 10);
    if (!Number.isFinite(x)) return def;
    return Math.min(Math.max(x, min), max);
  }

  function buildPager(page, totalPages) {
    const p = clampInt(page, 1, 1, Math.max(totalPages, 1));
    const tp = clampInt(totalPages, 1, 1, 1000000);

    const items = [];
    const push = (label, pageNum, disabled, active, aria) => {
      items.push({ label, pageNum, disabled: !!disabled, active: !!active, aria: aria || "" });
    };
    const pushEllipsis = () => items.push({ label: "…", pageNum: null, disabled: true, active: false, aria: "ellipsis" });

    push("«", p - 1, p <= 1, false, "prev");

    // windowed pages (max 5)
    let start = Math.max(1, p - 2);
    let end = Math.min(tp, start + 4);
    start = Math.max(1, end - 4);

    if (start > 1) {
      push("1", 1, false, p === 1, "page");
      if (start > 2) pushEllipsis();
    }

    for (let i = start; i <= end; i++) push(String(i), i, false, i === p, "page");

    if (end < tp) {
      if (end < tp - 1) pushEllipsis();
      push(String(tp), tp, false, p === tp, "page");
    }

    push("»", p + 1, p >= tp, false, "next");
    return items;
  }

  function renderPagination(ulEl, page, totalPages) {
    if (!ulEl) return;
    const tp = Math.max(1, Number(totalPages) || 1);
    if (tp <= 1) {
      ulEl.innerHTML = "";
      return;
    }

    const items = buildPager(page, tp);
    ulEl.innerHTML = items.map((it) => {
      if (it.aria === "ellipsis") {
        return `<li class="page-item disabled"><span class="page-link">…</span></li>`;
      }
      const cls = `page-item${it.disabled ? " disabled" : ""}${it.active ? " active" : ""}`;
      const ariaCurrent = it.active ? ' aria-current="page"' : "";
      const disabledAttr = it.disabled ? ' tabindex="-1" aria-disabled="true"' : "";
      return `
        <li class="${cls}">
          <button class="page-link" type="button" data-page="${it.pageNum}"${ariaCurrent}${disabledAttr}>${escapeHtml(it.label)}</button>
        </li>
      `;
    }).join("");
  }

  // -------------------------
  // ORG CARD VISUALS (NEW)
  // - Inactive orgs appear "blurred/opacity"
  // - Cards same height (flex column + mt-auto)
  // -------------------------
  function ensureOrgCardStyles() {
    if (document.getElementById("orgPayCardStyles")) return;
    const style = document.createElement("style");
    style.id = "orgPayCardStyles";
    style.textContent = `
      /* Same height + consistent layout */
      .org-pay-card .card-body{
        display:flex;
        flex-direction:column;
        min-height: 190px; /* tweak if you want taller/shorter */
      }
      .org-pay-card .org-pay-actions{ margin-top:auto; }

      /* Inactive look */
      .org-pay-card.is-inactive{
        opacity:.65;
        filter: blur(.35px);
      }
      .org-pay-card.is-inactive:hover{
        opacity:.75;
        filter: blur(.25px);
      }
      .org-pay-card .inactive-badge{
        position:absolute;
        top:12px;
        right:12px;
        z-index:2;
      }
      /* prevent blur from making text too ugly inside badge */
      .org-pay-card .inactive-badge .badge{ filter:none; }
    `;
    document.head.appendChild(style);
  }

  // tries to infer "inactive" from whatever fields your PHP returns
  function isOrgInactive(o) {
    // common flags
    if (o == null) return false;
    if (typeof o.is_active === "boolean") return !o.is_active;
    if (typeof o.is_activated === "boolean") return !o.is_activated;
    if (typeof o.is_accredited === "boolean") return !o.is_accredited; // if you use this meaning "activated"
    if (typeof o.accredited === "boolean") return !o.accredited;

    // string statuses
    const s = String(
      o.activation_status ??
      o.accreditation_status ??
      o.status ??
      ""
    ).trim();

    // treat these as inactive
    if (!s) return false;
    return ["PENDING", "INACTIVE", "REJECTED", "DENIED", "DRAFT"].includes(s.toUpperCase());
  }

  // optional: backend can send a direct "can_open" if you want the button disabled client-side
  function canOpenOrg(o) {
    if (typeof o?.can_open === "boolean") return o.can_open;
    return true; // default: let server decide
  }

  // -------------------------
  // PERMISSION UI
  // -------------------------
  function applyPermissionUI() {
    const canView = !!state.permissions?.can_view_list;
    const canSet = !!state.permissions?.can_set_payment;

    if (qs("#orgPayCanPay")) qs("#orgPayCanPay").value = canSet ? "1" : "0";

    const btnSet = qs("#orgPayBtnSetPayment");
    if (btnSet) btnSet.classList.toggle("d-none", !canSet);

    const listWrap = qs("#orgPayListWrap");
    const statusWrap = qs("#orgPayMyStatusWrap");
    if (listWrap) listWrap.classList.toggle("d-none", !canView);
    if (statusWrap) statusWrap.classList.toggle("d-none", canView);

    const btnPrintAll = qs("#orgPayBtnPrintAllPaid");
    if (btnPrintAll) btnPrintAll.classList.toggle("d-none", !canView);
  }

  // -------------------------
  // MY STATUS
  // -------------------------
  async function loadMyStatus() {
    const orgId = Number(qs("#orgPayOrgId")?.value || 0);
    if (!orgId) return;

    const stText = qs("#orgPayMyStatusText");
    const stBadge = qs("#orgPayMyStatusBadge");
    const stMeta = qs("#orgPayMyStatusMeta");
    const btnPrint = qs("#orgPayBtnPrintMyReceipt");

    if (stText) stText.textContent = "Loading...";
    if (stMeta) stMeta.textContent = "—";
    if (stBadge) {
      stBadge.className = "badge ms-2 d-none";
      stBadge.textContent = "—";
    }
    if (btnPrint) {
      btnPrint.classList.add("d-none");
      btnPrint.dataset.url = "";
    }

    const data = await postJSON({ action: "get_my_status", org_id: orgId });
    state.myStatus = data;

    renderMyStatus();
  }

  function renderMyStatus() {
    const d = state.myStatus || {};
    const s = String(d.status || "—");

    const stText = qs("#orgPayMyStatusText");
    const label = qs("#orgPayMyStatusLabel");
    if (label) label.textContent = "My Status (Active Term)";

    const stBadge = qs("#orgPayMyStatusBadge");
    const stMeta = qs("#orgPayMyStatusMeta");
    const btnPrint = qs("#orgPayBtnPrintMyReceipt");

    if (stText) stText.textContent = s;

    if (stBadge) {
      stBadge.classList.remove("d-none");
      stBadge.textContent = s;
      stBadge.classList.remove("text-bg-success", "text-bg-danger", "text-bg-secondary");
      if (s === "Paid") stBadge.classList.add("text-bg-success");
      else if (s === "Unpaid") stBadge.classList.add("text-bg-danger");
      else stBadge.classList.add("text-bg-secondary");
    }

    const student = d.student || {};
    const line1 = `${student.id_number || "—"} • ${student.program || "—"} ${student.year_level || ""}`.trim();

    if (stMeta) {
      if (d.eligible === false) stMeta.textContent = `${line1} • Not eligible for this organization fee.`;
      else if (s === "Paid" && d.payment) stMeta.textContent = `${line1} • Paid at ${d.payment.paid_at || "—"} • Receipt ${d.payment.receipt_no || "—"}`;
      else stMeta.textContent = `${line1} • No payment record yet.`;
    }

    if (btnPrint) {
      const url = d?.payment?.print_receipt_url ? String(d.payment.print_receipt_url) : "";
      if (s === "Paid" && url) {
        btnPrint.dataset.url = url;
        btnPrint.classList.remove("d-none");
      } else {
        btnPrint.dataset.url = "";
        btnPrint.classList.add("d-none");
      }
    }
  }

  // -------------------------
  // ORGS LIST
  // -------------------------
  function renderOrgCards() {
  // Use the same style injector approach
  ensureOrgPayModernStyles();

  const wrap = qs("#orgPayOrgCards");
  if (!wrap) return;

  const rows = state.orgsFiltered || [];
  if (!rows.length) {
    wrap.innerHTML = `
      <div class="col-12">
        <div class="alert alert-light border rounded-4 mb-0">
          <i class="bi bi-info-circle me-2"></i>No organizations found.
        </div>
      </div>
    `;
    return;
  }

  wrap.innerHTML = rows.map((o) => {
    const id = Number(o.id) || 0;
    const orgName = escapeHtml(o.org_name || "Unknown Organization");
    const abbreviation = escapeHtml(o.abbreviation || "");
    const scope = o.scope || "General";
    const feeAmount = o.fee_required || 0;
    const memberCount = o.member_count || 0;
    
    const inactive = isOrgInactive(o);
    const canOpen = canOpenOrg(o);

    // Status badge class based on org status
    const statusBadge = inactive 
      ? 'of-badge of-badge-secondary' 
      : 'of-badge of-badge-success';

    const statusText = inactive ? 'Inactive' : 'Active';

    // Format currency
    const formattedFee = new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'PHP',
      minimumFractionDigits: 2
    }).format(feeAmount);

    // Get initials for avatar
    const initials = (orgName) => {
      return orgName
        .split(/\s+/)
        .slice(0, 2)
        .map(w => w.charAt(0).toUpperCase())
        .join("");
    };

    return `
      <div class="col-12 col-md-6 col-xl-4">
        <div class="of-org-card ${inactive ? 'is-inactive' : ''}" data-org-id="${id}">
          
          <!-- Card Top with Avatar -->
          <div class="of-org-card__top">
            <div class="of-org-card__avatar">
              ${escapeHtml(initials(orgName))}
            </div>
            <div class="of-org-card__title-wrap">
              <div class="of-org-card__title" title="${orgName}">${orgName}</div>
              <div class="of-org-card__org" title="${abbreviation}">${abbreviation || '—'}</div>
            </div>
          </div>

          <!-- Status and Scope Badges -->
          <div class="of-org-card__badges">
            <span class="${statusBadge}">
              <i class="bi bi-building"></i>
              <span>${statusText}</span>
            </span>
            <span class="of-badge of-badge-light">
              <i class="bi bi-diagram-3"></i>
              <span>${escapeHtml(scope)}</span>
            </span>
          </div>

          <!-- Stats Section -->
          <div class="of-org-card__stats">
            <div class="of-org-card__stat-item">
              <span class="of-org-card__stat-icon">
                <i class="bi bi-cash-stack"></i>
              </span>
              <div>
                <div class="of-org-card__stat-label">Required Fee</div>
                <div class="of-org-card__stat-value">${formattedFee}</div>
              </div>
            </div>

            <div class="of-org-card__stat-item" style="display:none;">
              <span class="of-org-card__stat-icon">
                <i class="bi bi-people"></i>
              </span>
              <div>
                <div class="of-org-card__stat-label">Members</div>
                <div class="of-org-card__stat-value">${memberCount} students</div>
              </div>
            </div>
          </div>

          <!-- Inactive Message (if inactive) -->
          ${inactive ? `
            <div class="of-org-card__inactive-msg">
              <i class="bi bi-exclamation-triangle me-1"></i>
              This organization is not activated yet
            </div>
          ` : ''}

          <!-- Footer with Action Button -->
          <div class="of-org-card__footer">
            <button type="button" 
                    class="of-open-org-btn" 
                    data-org-id="${id}"
                    ${!canOpen || inactive ? 'disabled' : ''}>
              <i class="bi ${inactive ? 'bi-lock-fill' : 'bi-box-arrow-in-right'} me-1"></i>
              ${inactive ? 'Inactive' : 'Open Organization'}
            </button>
          </div>

        </div>
      </div>
    `;
  }).join("");

  // Bind click events to the open buttons
  qsa(".of-open-org-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const id = Number(btn.dataset.orgId || 0);
      if (!id) return;
      if (btn.disabled) return;
      openOrganization(id).catch(err => safeShowError(err?.message || "Failed to open organization."));
    });
  });

  // Make entire card clickable (optional, but nice UX)
  qsa(".of-org-card").forEach((card) => {
    card.addEventListener("click", (e) => {
      // Don't trigger if clicking the button
      if (e.target.closest(".of-open-org-btn")) return;
      
      const id = Number(card.dataset.orgId || 0);
      if (!id) return;
      
      // Check if inactive
      const isInactive = card.classList.contains('is-inactive');
      if (isInactive) {
        safeShowError("This organization is not activated yet.");
        return;
      }
      
      openOrganization(id).catch(err => safeShowError(err?.message || "Failed to open organization."));
    });
  });
  }

  function ensureOrgPayModernStyles() {
    if (document.getElementById("org-pay-modern-styles")) return;

    const style = document.createElement("style");
    style.id = "org-pay-modern-styles";

    style.textContent = `
      /* Modern Organization Cards - Matching Event Expenses Design */
      #orgPayOrgCards .of-org-card {
        border-radius: 18px;
        overflow: hidden;
        background: linear-gradient(180deg, #ffffff 0%, #fbfcff 100%);
        transition: transform 0.18s ease, box-shadow 0.18s ease, border-color 0.18s ease;
        border: 1px solid rgba(13, 110, 253, 0.08);
        min-height: 100%;
        position: relative;
        cursor: pointer;
        margin-bottom: 0;
        display: flex;
        flex-direction: column;
      }

      #orgPayOrgCards .of-org-card:hover {
        transform: translateY(-4px);
        box-shadow: 0 14px 34px rgba(0, 0, 0, 0.10) !important;
        border-color: rgba(13, 110, 253, 0.2);
      }

      /* Inactive state */
      #orgPayOrgCards .of-org-card.is-inactive {
        opacity: 0.75;
        filter: grayscale(0.3);
      }

      #orgPayOrgCards .of-org-card.is-inactive:hover {
        opacity: 0.85;
        transform: translateY(-2px);
      }

      /* Card Top Section with Gradient */
      #orgPayOrgCards .of-org-card__top {
        display: flex;
        align-items: flex-start;
        gap: 14px;
        padding: 18px 18px 12px;
        background: radial-gradient(circle at top right, rgba(13, 110, 253, 0.10), transparent 35%),
                    linear-gradient(180deg, rgba(13, 110, 253, 0.04), rgba(13, 110, 253, 0));
      }

      /* Avatar - Matching Event Expenses */
      #orgPayOrgCards .of-org-card__avatar {
        width: 46px;
        height: 46px;
        min-width: 46px;
        border-radius: 14px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        font-weight: 700;
        font-size: 0.95rem;
        color: #0d6efd;
        background: rgba(13, 110, 253, 0.12);
        border: 1px solid rgba(13, 110, 253, 0.12);
      }

      /* Title Area */
      #orgPayOrgCards .of-org-card__title-wrap {
        flex: 1;
        min-width: 0;
      }

      #orgPayOrgCards .of-org-card__title {
        font-size: 1rem;
        font-weight: 700;
        color: #1f2937;
        line-height: 1.3;
        margin-bottom: 4px;
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
        overflow: hidden;
      }

      #orgPayOrgCards .of-org-card__org {
        font-size: 0.875rem;
        color: #6b7280;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      /* Badges Section */
      #orgPayOrgCards .of-org-card__badges {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        padding: 0 18px 14px;
      }

      #orgPayOrgCards .of-badge {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        border-radius: 999px;
        padding: 7px 10px;
        font-size: 0.72rem;
        font-weight: 700;
        line-height: 1;
        letter-spacing: 0.01em;
        border: 1px solid transparent;
      }

      #orgPayOrgCards .of-badge-success {
        color: #0f5132;
        background: #d1e7dd;
        border-color: #badbcc;
      }

      #orgPayOrgCards .of-badge-secondary {
        color: #41464b;
        background: #e2e3e5;
        border-color: #d3d6d8;
      }

      #orgPayOrgCards .of-badge-light {
        color: #41464b;
        background: #e9ecef;
        border-color: #d3d6d8;
      }

      /* Stats Section - Similar to Event Expenses Meta Items */
      #orgPayOrgCards .of-org-card__stats {
        display: grid;
        gap: 10px;
        padding: 0 18px 16px;
      }

      #orgPayOrgCards .of-org-card__stat-item {
        display: flex;
        align-items: flex-start;
        gap: 10px;
        padding: 11px 12px;
        border-radius: 14px;
        background: #f8fafc;
        border: 1px solid #eef2f7;
        transition: background-color 0.15s ease;
      }

      #orgPayOrgCards .of-org-card__stat-item:hover {
        background: #ffffff;
        border-color: #0d6efd30;
      }

      #orgPayOrgCards .of-org-card__stat-icon {
        width: 34px;
        height: 34px;
        min-width: 34px;
        border-radius: 10px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        background: #ffffff;
        border: 1px solid #e9eef5;
        color: #0d6efd;
        font-size: 0.95rem;
      }

      #orgPayOrgCards .of-org-card__stat-label {
        font-size: 0.72rem;
        font-weight: 700;
        color: #6b7280;
        text-transform: uppercase;
        letter-spacing: 0.04em;
        margin-bottom: 2px;
      }

      #orgPayOrgCards .of-org-card__stat-value {
        font-size: 0.92rem;
        font-weight: 600;
        color: #1f2937;
        line-height: 1.25;
        word-break: break-word;
      }

      /* Inactive Message */
      #orgPayOrgCards .of-org-card__inactive-msg {
        margin: 0 18px 12px;
        padding: 8px 12px;
        border-radius: 10px;
        background: rgba(108, 117, 125, 0.1);
        color: #6c757d;
        font-size: 0.8rem;
        display: flex;
        align-items: center;
        border: 1px dashed #ced4da;
      }

      /* Footer with Button */
      #orgPayOrgCards .of-org-card__footer {
        margin-top: auto;
        padding: 0 18px 18px;
      }

      #orgPayOrgCards .of-open-org-btn {
        display: block;
        width: 100%;
        border-radius: 12px;
        font-weight: 600;
        padding: 0.65rem 0.9rem;
        box-shadow: none !important;
        transition: all 0.15s ease;
        background: #0d6efd;
        color: white;
        border: none;
        font-size: 0.875rem;
        text-align: center;
        cursor: pointer;
      }

      #orgPayOrgCards .of-open-org-btn:hover:not(:disabled) {
        transform: scale(1.02);
        background: #0b5ed7;
      }

      #orgPayOrgCards .of-open-org-btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
        background: #6c757d;
      }

      /* Mobile Responsive */
      @media (max-width: 575px) {
        #orgPayOrgCards .of-org-card__top,
        #orgPayOrgCards .of-org-card__badges,
        #orgPayOrgCards .of-org-card__stats,
        #orgPayOrgCards .of-org-card__footer,
        #orgPayOrgCards .of-org-card__inactive-msg {
          padding-left: 14px;
          padding-right: 14px;
        }
      }
    `;

    document.head.appendChild(style);
  }

  function applyOrgFilter() {
    const q = String(qs("#orgPaySearchOrg")?.value || "").trim().toLowerCase();
    const src = state.orgs || [];
    state.orgsFiltered = !q
      ? src
      : src.filter(o =>
        String(o.org_name || "").toLowerCase().includes(q) ||
        String(o.abbreviation || "").toLowerCase().includes(q)
      );
    renderOrgCards();
  }

  async function loadOrganizations() {
    const data = await postJSON({ action: "get_organizations" });
    state.term = data.term || null;
    state.orgs = data.organizations || [];
    state.orgsFiltered = state.orgs;
    renderOrgCards();
    showSection("list");
  }

  function renderRestrictedAdminCard() {
    const label = qs("#orgPayMyStatusLabel");
    const stText = qs("#orgPayMyStatusText");
    const stBadge = qs("#orgPayMyStatusBadge");
    const stMeta = qs("#orgPayMyStatusMeta");
    const btnPrint = qs("#orgPayBtnPrintMyReceipt");

    if (label) label.textContent = "Access Restricted";
    if (stText) stText.textContent = "You do not handle this organization.";
    if (stMeta) stMeta.textContent = "You can only manage organizations assigned to you.";

    if (stBadge) {
      stBadge.className = "badge ms-2 d-none";
      stBadge.textContent = "—";
    }
    if (btnPrint) {
      btnPrint.classList.add("d-none");
      btnPrint.dataset.url = "";
    }
  }

  // -------------------------
  // DETAILS + TABS
  // -------------------------
  async function openOrganization(orgId) {
    const data = await postJSON({ action: "get_org_details", org_id: orgId });
    state.selectedOrg = data.org || null;

    state.permissions = data.permissions || state.permissions;

    if (qs("#orgPayOrgId")) qs("#orgPayOrgId").value = String(orgId);

    const org = state.selectedOrg || {};
    if (qs("#orgPayOrgName")) qs("#orgPayOrgName").textContent = org.org_name || "—";
    if (qs("#orgPayScopeText")) {
      const scope = org.scope || "General";
      const prog = org.program_abbr ? ` • ${org.program_abbr}` : "";
      qs("#orgPayScopeText").textContent = `Scope: ${scope}${prog}`;
    }
    if (qs("#orgPayRequiredFee")) qs("#orgPayRequiredFee").textContent = money(org.fee_required || 0);

    // ✅ NEW: logo + dropdown info (Description/Mission/Vision/Advocacy)
    renderOrgInfo(org);

    const termText = data.term?.label ? data.term.label : "—";
    if (qs("#orgPayTermBadge")) qs("#orgPayTermBadge").textContent = `Academic Term: ${termText}`;

    applyPermissionUI();

    state.paid.page = 1;
    state.unpaid.page = 1;

    showSection("details");

    const btnPrintAll = qs("#orgPayBtnPrintAllPaid");
    if (btnPrintAll) btnPrintAll.dataset.printAllUrl = `php/print-organization-paid.php?org_id=${Number(orgId)}`;

    if (!state.permissions?.can_view_list) {
      if (state.permissions?.block_reason === "not_handling") {
        renderRestrictedAdminCard();
        return;
      }
      await loadMyStatus();
      return;
    }

    await refreshCounts();
    await loadPaid();
    await loadUnpaid();
  }

  async function refreshCounts() {
    const orgId = Number(qs("#orgPayOrgId")?.value || 0);
    const data = await postJSON({ action: "get_counts", org_id: orgId });

    if (qs("#orgPayCountPaid")) qs("#orgPayCountPaid").textContent = String(data.paid_count ?? 0);
    if (qs("#orgPayCountUnpaid")) qs("#orgPayCountUnpaid").textContent = String(data.unpaid_count ?? 0);
  }

  function renderPaidTable(rows) {
    const tb = qs("#orgPayPaidTbody");
    if (!tb) return;

    if (!rows.length) {
      tb.innerHTML = `<tr><td colspan="5" class="text-muted">No paid records yet.</td></tr>`;
      return;
    }

    tb.innerHTML = rows.map((r) => {
      const name = `${r.last_name || ""}, ${r.first_name || ""} ${r.middle_name || ""}`.replace(/\s+/g, " ").trim();
      const meta = `${r.id_number || "—"} • ${r.program || "—"} ${r.year_level || ""}`.trim();
      return `
        <tr>
          <td>
            <div class="fw-semibold">${escapeHtml(name || "—")}</div>
            <div class="text-muted small">${escapeHtml(meta)}</div>
          </td>
          <td class="fw-semibold">${money(r.amount || 0)}</td>
          <td>${escapeHtml(r.paid_at || "—")}</td>
          <td class="text-muted">${escapeHtml(r.receipt_no || "—")}</td>
          <td>
            <button type="button"
              class="btn btn-sm btn-dark btnPrintReceipt"
              data-payment-id="${Number(r.payment_id)}">
              <i class="bi bi-printer me-1"></i>Print
            </button>
          </td>
        </tr>
      `;
    }).join("");
  }

  async function loadPaid() {
    const orgId = Number(qs("#orgPayOrgId")?.value || 0);
    const q = String(qs("#orgPaySearchPaid")?.value || "").trim();
    const data = await postJSON({ action: "list_paid", org_id: orgId, q, page: state.paid.page, per_page: state.paid.perPage });

    state.paid.rows = data.rows || [];
    state.paid.total = Number(data.total ?? state.paid.rows.length) || 0;
    state.paid.perPage = Number(data.per_page ?? state.paid.perPage) || state.paid.perPage;
    state.paid.page = Number(data.page ?? state.paid.page) || state.paid.page;
    state.paid.totalPages = Number(data.total_pages ?? 1) || 1;

    renderPaidTable(state.paid.rows);

    if (qs("#orgPayPaidHint")) qs("#orgPayPaidHint").textContent = `${state.paid.rows.length} shown`;
    if (qs("#orgPayPaidPageInfo")) qs("#orgPayPaidPageInfo").textContent =
      `Page ${state.paid.page} of ${state.paid.totalPages} • ${state.paid.total} total`;

    renderPagination(qs("#orgPayPaidPagination"), state.paid.page, state.paid.totalPages);
  }

  function renderUnpaidList(rows) {
    const wrap = qs("#orgPayUnpaidList");
    if (!wrap) return;

    if (!rows.length) {
      wrap.innerHTML = `<div class="list-group-item text-muted">No unpaid students found.</div>`;
      return;
    }

    const canPay = !!state.permissions?.can_set_payment;

    wrap.innerHTML = rows.map((r) => {
      const name = `${r.last_name || ""}, ${r.first_name || ""} ${r.middle_name || ""}`.replace(/\s+/g, " ").trim();
      const meta = `${r.id_number || "—"} • ${r.program || "—"} ${r.year_level || ""}`.trim();

      return `
        <div class="list-group-item d-flex align-items-center justify-content-between gap-2">
          <div>
            <div class="fw-semibold">${escapeHtml(name || "—")}</div>
            <div class="text-muted small">${escapeHtml(meta)}</div>
          </div>
          ${canPay ? `
            <div class="d-flex gap-2">
              <button class="btn btn-sm btn-primary btnQuickPay"
                data-student-id="${Number(r.user_id)}"
                data-name="${escapeHtml(name)}"
                data-meta="${escapeHtml(meta)}">
                <i class="bi bi-cash-coin me-1"></i>Pay
              </button>

              <button class="btn btn-sm btn-warning btnNotifyUnpaid"
                data-student-id="${Number(r.user_id)}"
                data-name="${escapeHtml(name)}">
                <i class="bi bi-bell me-1"></i>Notify
              </button>
            </div>
          ` : `
            <span class="badge text-bg-light border">Unpaid</span>
          `}
        </div>
      `;
    }).join("");
  }

  async function loadUnpaid() {
    const orgId = Number(qs("#orgPayOrgId")?.value || 0);
    const q = String(qs("#orgPaySearchUnpaid")?.value || "").trim();
    const data = await postJSON({ action: "list_unpaid", org_id: orgId, q, page: state.unpaid.page, per_page: state.unpaid.perPage });

    state.unpaid.rows = data.rows || [];
    state.unpaid.total = Number(data.total ?? state.unpaid.rows.length) || 0;
    state.unpaid.perPage = Number(data.per_page ?? state.unpaid.perPage) || state.unpaid.perPage;
    state.unpaid.page = Number(data.page ?? state.unpaid.page) || state.unpaid.page;
    state.unpaid.totalPages = Number(data.total_pages ?? 1) || 1;

    renderUnpaidList(state.unpaid.rows);

    if (qs("#orgPayUnpaidHint")) qs("#orgPayUnpaidHint").textContent = `${state.unpaid.rows.length} shown`;
    if (qs("#orgPayUnpaidPageInfo")) qs("#orgPayUnpaidPageInfo").textContent =
      `Page ${state.unpaid.page} of ${state.unpaid.totalPages} • ${state.unpaid.total} total`;

    renderPagination(qs("#orgPayUnpaidPagination"), state.unpaid.page, state.unpaid.totalPages);
  }

  // -------------------------
  // MODAL: SET PAYMENT
  // -------------------------
  function openSetPaymentModal(prefillStudent) {
    const el = qs("#modalOrgPaySetPayment");
    if (!el || !window.bootstrap) return safeShowError("Set Payment modal is missing.");

    const orgId = Number(qs("#orgPayOrgId")?.value || 0);
    if (!orgId) return safeShowError("Missing organization id.");

    if (!state.permissions?.can_set_payment) return safeShowError("You are not allowed to set payments.");

    const org = state.selectedOrg || {};
    if (qs("#opOrgId")) qs("#opOrgId").value = String(orgId);

    if (qs("#opStudentId")) qs("#opStudentId").value = "";
    if (qs("#opSelectedName")) qs("#opSelectedName").textContent = "—";
    if (qs("#opSelectedMeta")) qs("#opSelectedMeta").textContent = "—";

    if (qs("#opAmount")) qs("#opAmount").value = Number(org.fee_required || 0) > 0 ? Number(org.fee_required).toFixed(2) : "";
    if (qs("#opReceiptNo")) qs("#opReceiptNo").value = "";

    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, "0");
    const dd = String(today.getDate()).padStart(2, "0");
    if (qs("#opPaidDate")) qs("#opPaidDate").value = `${yyyy}-${mm}-${dd}`;

    const now = new Date();
    const hh = String(now.getHours()).padStart(2, "0");
    const mi = String(now.getMinutes()).padStart(2, "0");
    if (qs("#opPaidTime")) qs("#opPaidTime").value = `${hh}:${mi}`;

    if (qs("#opSearch")) qs("#opSearch").value = "";
    if (qs("#opResults")) qs("#opResults").innerHTML = `<div class="list-group-item text-muted">Type to search eligible students.</div>`;

    if (prefillStudent?.student_id) {
      qs("#opStudentId").value = String(prefillStudent.student_id);
      qs("#opSelectedName").textContent = prefillStudent.name || "—";
      qs("#opSelectedMeta").textContent = prefillStudent.meta || "—";
    }

    bootstrap.Modal.getOrCreateInstance(el).show();
  }

  function bindSetPaymentModal() {
    const input = qs("#opSearch");
    const results = qs("#opResults");

    if (input && results && !input.__bound) {
      input.__bound = true;

      let t = null;
      input.addEventListener("input", () => {
        if (t) clearTimeout(t);
        t = setTimeout(async () => {
          const q = String(input.value || "").trim();
          if (!q) {
            results.innerHTML = `<div class="list-group-item text-muted">Type to search eligible students.</div>`;
            return;
          }
          results.innerHTML = `<div class="list-group-item text-muted"><span class="spinner-border spinner-border-sm me-2"></span>Searching...</div>`;

          try {
            const orgId = Number(qs("#opOrgId")?.value || 0);
            const data = await postJSON({ action: "search_eligible_students", org_id: orgId, q });
            const rows = data.rows || [];

            if (!rows.length) {
              results.innerHTML = `<div class="list-group-item text-muted">No eligible students found.</div>`;
              return;
            }

            results.innerHTML = rows.map((r) => {
              const name = String(r.name || "—");
              const meta = `${r.id_number || "—"}`.trim();
              return `
                <button type="button" class="list-group-item list-group-item-action opPick"
                  data-user-id="${Number(r.user_id)}"
                  data-name="${escapeHtml(name)}"
                  data-meta="${escapeHtml(meta)}">
                  <div class="d-flex align-items-center justify-content-between">
                    <div>
                      <div class="fw-semibold">${escapeHtml(name)}</div>
                      <div class="text-muted small">${escapeHtml(meta)}</div>
                    </div>
                    <i class="bi bi-chevron-right text-muted"></i>
                  </div>
                </button>
              `;
            }).join("");
          } catch (err) {
            results.innerHTML = `<div class="list-group-item text-danger">Search failed.</div>`;
            console.error(err);
          }
        }, 250);
      });

      results.addEventListener("click", (e) => {
        const btn = e.target.closest(".opPick");
        if (!btn) return;

        const userId = Number(btn.dataset.userId || 0);
        const name = String(btn.dataset.name || "—");
        const meta = String(btn.dataset.meta || "—");

        if (qs("#opStudentId")) qs("#opStudentId").value = String(userId);
        if (qs("#opSelectedName")) qs("#opSelectedName").textContent = name;
        if (qs("#opSelectedMeta")) qs("#opSelectedMeta").textContent = meta;
      });
    }

    const form = qs("#formOrgPaySetPayment");
    if (form && !form.__bound) {
      form.__bound = true;

      form.addEventListener("submit", async (e) => {
        e.preventDefault();

        const btn = qs("#btnOpSave");
        const orgId = Number(qs("#opOrgId")?.value || 0);
        const studentId = Number(qs("#opStudentId")?.value || 0);
        const amount = String(qs("#opAmount")?.value || "").trim();
        const date = String(qs("#opPaidDate")?.value || "").trim();
        const time = String(qs("#opPaidTime")?.value || "").trim();

        if (!orgId) return safeShowError("Missing organization id.");
        if (!studentId) return safeShowError("Please select a student first.");
        if (!amount) return safeShowError("Please enter amount.");
        if (!date || !time) return safeShowError("Please select paid date/time.");

        if (!state.permissions?.can_set_payment) return safeShowError("You are not allowed to set payments.");

        setBtnLoading(btn, true, ".op-btn-text", ".op-btn-loading");
        try {
          const receiptNo = String(qs("#opReceiptNo")?.value || "").trim();
          const data = await postJSON({
          action: "set_payment",
          org_id: orgId,
          student_id: studentId,
          amount,
          paid_at: `${date} ${time}:00`,
          receipt_no: receiptNo || null, // ✅ optional
        });

          const el = qs("#modalOrgPaySetPayment");
          if (el) bootstrap.Modal.getOrCreateInstance(el).hide();

          safeShowSuccess("Payment saved.");

          await refreshCounts();
          await loadPaid();
          await loadUnpaid();

          if (data.print_receipt_url) openNewTab(data.print_receipt_url);
        } catch (err) {
          safeShowError(err?.message || "Failed to save payment.");
        } finally {
          setBtnLoading(btn, false, ".op-btn-text", ".op-btn-loading");
        }
      });
    }
  }

  // -------------------------
  // BIND EVENTS
  // -------------------------
  function bindUI() {
    const orgSearch = qs("#orgPaySearchOrg");
    if (orgSearch && !orgSearch.__bound) {
      orgSearch.__bound = true;
      orgSearch.addEventListener("input", applyOrgFilter);
    }

    const cards = qs("#orgPayOrgCards");
    if (cards && !cards.__bound) {
      cards.__bound = true;
      cards.addEventListener("click", (e) => {
        const btn = e.target.closest(".btnOpenOrg");
        if (!btn) return;

        if (btn.disabled) return;

        const id = Number(btn.dataset.orgId || 0);
        if (id) openOrganization(id).catch(err => safeShowError(err?.message || "Failed to open organization."));
      });
    }

    const back = qs("#orgPayBtnBack");
    if (back && !back.__bound) {
      back.__bound = true;
      back.addEventListener("click", () => {
        state.selectedOrg = null;
        showSection("list");
      });
    }

    const btnMyPrint = qs("#orgPayBtnPrintMyReceipt");
    if (btnMyPrint && !btnMyPrint.__bound) {
      btnMyPrint.__bound = true;
      btnMyPrint.addEventListener("click", () => {
        const url = String(btnMyPrint.dataset.url || "");
        if (!url) return safeShowError("No receipt available.");
        openNewTab(url);
      });
    }

    const searchPaid = qs("#orgPaySearchPaid");
    if (searchPaid && !searchPaid.__bound) {
      searchPaid.__bound = true;
      let t = null;
      searchPaid.addEventListener("input", () => {
        if (!state.permissions?.can_view_list) return;
        if (t) clearTimeout(t);
        state.paid.page = 1;
        t = setTimeout(() => loadPaid().catch(err => safeShowError(err?.message || "Failed to load paid.")), 200);
      });
    }

    const searchUnpaid = qs("#orgPaySearchUnpaid");
    if (searchUnpaid && !searchUnpaid.__bound) {
      searchUnpaid.__bound = true;
      let t = null;
      searchUnpaid.addEventListener("input", () => {
        if (!state.permissions?.can_view_list) return;
        if (t) clearTimeout(t);
        state.unpaid.page = 1;
        t = setTimeout(() => loadUnpaid().catch(err => safeShowError(err?.message || "Failed to load unpaid.")), 200);
      });
    }

    const paidTb = qs("#orgPayPaidTbody");
    if (paidTb && !paidTb.__bound) {
      paidTb.__bound = true;
      paidTb.addEventListener("click", (e) => {
        const btn = e.target.closest(".btnPrintReceipt");
        if (!btn) return;
        const pid = Number(btn.dataset.paymentId || 0);
        if (!pid) return safeShowError("Missing payment id.");
        openNewTab(`php/print-organization-fee-receipt.php?payment_id=${pid}`);
      });
    }

    const paidPager = qs("#orgPayPaidPagination");
    if (paidPager && !paidPager.__bound) {
      paidPager.__bound = true;
      paidPager.addEventListener("click", (e) => {
        if (!state.permissions?.can_view_list) return;
        const b = e.target.closest("button[data-page]");
        if (!b) return;
        const p = Number(b.dataset.page || 1);
        if (!Number.isFinite(p) || p < 1) return;
        if (p === state.paid.page) return;
        state.paid.page = p;
        loadPaid().catch((err) => safeShowError(err?.message || "Failed to load paid."));
      });
    }

    const unpaidList = qs("#orgPayUnpaidList");
    if (unpaidList && !unpaidList.__bound) {
      unpaidList.__bound = true;

      unpaidList.addEventListener("click", async (e) => {

        const payBtn = e.target.closest(".btnQuickPay");
        if (payBtn) {
          if (!state.permissions?.can_set_payment)
            return safeShowError("You are not allowed to set payments.");

          openSetPaymentModal({
            student_id: Number(payBtn.dataset.studentId || 0),
            name: String(payBtn.dataset.name || "—"),
            meta: String(payBtn.dataset.meta || "—"),
          });
          return;
        }

        const notifyBtn = e.target.closest(".btnNotifyUnpaid");
        if (notifyBtn) {

          const studentId = Number(notifyBtn.dataset.studentId || 0);
          const name = String(notifyBtn.dataset.name || "student");

          const orgId = Number(qs("#orgPayOrgId")?.value || 0);

          try {
            await postJSON({
              action: "notify_unpaid_student",
              org_id: orgId,
              student_id: studentId
            });

            safeShowSuccess(`Reminder sent to ${name}.`);

          } catch (err) {
            safeShowError(err?.message || "Failed to send notification.");
          }

        }

      });
    }

    const unpaidPager = qs("#orgPayUnpaidPagination");
    if (unpaidPager && !unpaidPager.__bound) {
      unpaidPager.__bound = true;
      unpaidPager.addEventListener("click", (e) => {
        if (!state.permissions?.can_view_list) return;
        const b = e.target.closest("button[data-page]");
        if (!b) return;
        const p = Number(b.dataset.page || 1);
        if (!Number.isFinite(p) || p < 1) return;
        if (p === state.unpaid.page) return;
        state.unpaid.page = p;
        loadUnpaid().catch((err) => safeShowError(err?.message || "Failed to load unpaid."));
      });
    }

    const btnSet = qs("#orgPayBtnSetPayment");
    if (btnSet && !btnSet.__bound) {
      btnSet.__bound = true;
      btnSet.addEventListener("click", () => openSetPaymentModal(null));
    }

    const btnPrintAll = qs("#orgPayBtnPrintAllPaid");
    if (btnPrintAll && !btnPrintAll.__bound) {
      btnPrintAll.__bound = true;
      btnPrintAll.addEventListener("click", () => {
        if (!state.permissions?.can_view_list) return safeShowError("You are not allowed to view this list.");
        const orgId = Number(qs("#orgPayOrgId")?.value || 0);
        if (!orgId) return safeShowError("Missing organization id.");
        openNewTab(`php/print-organization-paid.php?org_id=${orgId}`);
      });
    }
  }

  function init() {/* js/event-expenses/event-expenses.js */
/* global bootstrap, showSuccess, showError */

(function () {
  "use strict";

  const API_URL = "php/event-expenses.php";

  function qs(sel, root = document) { return root.querySelector(sel); }
  function qsa(sel, root = document) { return Array.from(root.querySelectorAll(sel)); }

  function safeShowError(msg) {
    if (typeof window.showError === "function") return window.showError(msg);
    alert(msg || "Something went wrong.");
  }
  function safeShowSuccess(msg) {
    if (typeof window.showSuccess === "function") return window.showSuccess(msg);
    alert(msg || "Success.");
  }

  function escapeHtml(s) {
    return String(s ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  // same resolver logic as your other modules
  function resolveAppUrl(path) {
    if (!path) return "";
    const raw = String(path).trim();
    if (!raw) return "";
    if (/^https?:\/\//i.test(raw)) return raw;

    const p = raw.replaceAll("\\", "/");
    const parts = (window.location.pathname || "/").split("/").filter(Boolean);
    const base = parts.length > 0 ? `/${parts[0]}` : "";
    if (p.startsWith("/")) return base + p;
    return base + "/" + p.replace(/^\.?\//, "");
  }

  function openNewTab(url) {
    const u = resolveAppUrl(url);
    if (!u) return;
    window.open(u, "_blank", "noopener");
  }

  async function postJSON(payload) {
    const res = await fetch(API_URL, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload || {}),
    });

    const text = await res.text();
    console.log("[EventExpenses] RAW:", res.status, text);

    let data;
    try { data = JSON.parse(text); }
    catch { throw new Error("Invalid server response (not JSON). Check console RAW."); }

    if (!res.ok) throw new Error(data?.message || `HTTP ${res.status}`);
    if (!data?.success) throw new Error(data?.message || "Request failed.");
    return data;
  }

  // -------------------------
  // UI helpers
  // -------------------------
  function money(n) {
    const v = Number(n || 0);
    return `₱${v.toFixed(2)}`;
  }

  function toast(msg) {
    const el = qs("#eeToast");
    const body = qs("#eeToastMsg");
    if (body) body.textContent = msg || "";
    if (!el || typeof bootstrap === "undefined") return;

    const t = bootstrap.Toast.getOrCreateInstance(el, { delay: 2500 });
    t.show();
  }

  function setHidden(el, hidden) {
    if (!el) return;
    el.classList.toggle("d-none", !!hidden);
  }

  function setActionEnabled(selectorOrEl, enabled, reasonText) {
    const el = typeof selectorOrEl === "string" ? qs(selectorOrEl) : selectorOrEl;
    if (!el) return;
    const isBtn = el.tagName === "BUTTON" || el.tagName === "A" || el.getAttribute("role") === "button";
    el.classList.toggle("disabled-action", !enabled);
    if (isBtn) el.disabled = !enabled;
    if (!enabled && reasonText) el.setAttribute("title", reasonText);
    if (enabled) el.removeAttribute("title");
  }

  function showView(which) {
    const list = qs("#eeListView");
    const ev = qs("#eeEventView");
    if (list) list.classList.toggle("d-none", which !== "list");
    if (ev) ev.classList.toggle("d-none", which !== "event");
  }

  function closeModal(modalId) {
    const el = qs(modalId);
    if (!el || typeof bootstrap === "undefined") return;
    const inst = bootstrap.Modal.getInstance(el);
    if (inst) inst.hide();
  }

  // -------------------------
  // state
  // -------------------------
  const state = {
    terms: [],
    activeTermId: 0,
    selectedTermId: 0,

    selectedSchoolYear: "",
    selectedSemester: "",

    events: [],
    eventsFiltered: [],
    search: "",

    selectedEventId: 0,
    selectedEvent: null,

    permissions: {
      user_id: 0,
      role: "",
      can_add_event: false,
      can_add_credit: false,
      can_add_debit: false,
      can_view: true,
      is_readonly: false,

      // extra (optional from backend)
      force_org_scope: false, // if true, lock add-event scope to organization
    },

    gates: {
      proposal_approved: false,
      accomplishment_approved: false,
    },

    // org context for officers
    myOrgs: [],        // [{id,name}]
    forcedOrgId: 0,    // if only 1 org
    forcedOrgName: "",

    credits: [],
    debits: [],
    ledger: [],
  };

  let __bound = false;

  // -------------------------
  // term UI
  // -------------------------
  function uniq(arr) { return Array.from(new Set(arr)); }

  function termLabel(t) {
    const sy = String(t?.school_year ?? "");
    const sem = String(t?.semester ?? "");
    return `${sy} • ${sem}`.trim();
  }

  function computeSelectedTermFromFilters() {
    const sy = String(state.selectedSchoolYear || "");
    const sem = String(state.selectedSemester || "");
    if (!sy || !sem) return 0;

    const hit = state.terms.find((t) => String(t.school_year) === sy && String(t.semester) === sem);
    return hit ? Number(hit.id) || 0 : 0;
  }

  function renderTermFilters() {
    const aySel = qs("#eeAySelect");
    const semSel = qs("#eeActiveYearSelect");

    // If the page HTML isn't present yet (SPA), skip quietly.
    if (!aySel || !semSel) return;

    const years = uniq(state.terms.map((t) => String(t.school_year || "")).filter(Boolean)).sort();

    aySel.innerHTML = years.length
      ? years.map((y) => `<option value="${escapeHtml(y)}">${escapeHtml(y)}</option>`).join("")
      : `<option value="">—</option>`;

    // default school year
    if (!state.selectedSchoolYear) {
      const active = state.terms.find((t) => Number(t.id) === Number(state.activeTermId));
      state.selectedSchoolYear = active ? String(active.school_year || "") : (years[0] || "");
    }
    aySel.value = state.selectedSchoolYear || (years[0] || "");

    // semesters for that SY
    const sems = uniq(
      state.terms
        .filter((t) => String(t.school_year) === String(aySel.value || ""))
        .map((t) => String(t.semester || ""))
        .filter(Boolean)
    );

    const semOrder = (s) => {
      const x = String(s).toLowerCase();
      if (x.includes("1") || x.includes("first")) return 1;
      if (x.includes("2") || x.includes("second")) return 2;
      if (x.includes("summer")) return 3;
      return 99;
    };
    sems.sort((a, b) => semOrder(a) - semOrder(b) || a.localeCompare(b));

    semSel.innerHTML = sems.length
      ? sems.map((s) => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join("")
      : `<option value="">—</option>`;

    if (!state.selectedSemester) {
      const active = state.terms.find((t) => Number(t.id) === Number(state.activeTermId));
      if (active && String(active.school_year) === String(aySel.value || "")) {
        state.selectedSemester = String(active.semester || "");
      } else {
        state.selectedSemester = sems[0] || "";
      }
    }
    semSel.value = state.selectedSemester || (sems[0] || "");

    // determine term_id
    state.selectedSchoolYear = String(aySel.value || "");
    state.selectedSemester = String(semSel.value || "");
    state.selectedTermId = computeSelectedTermFromFilters() || state.activeTermId || 0;

    // read-only badge
    const ro = qs("#eeReadOnlyBadge");
    const isReadOnly = state.selectedTermId && state.activeTermId && Number(state.selectedTermId) !== Number(state.activeTermId);
    setHidden(ro, !isReadOnly);
  }

  function bindTermFilterEvents() {
    const aySel = qs("#eeAySelect");
    const semSel = qs("#eeActiveYearSelect");
    if (!aySel || !semSel) return;

    aySel.addEventListener("change", async () => {
      state.selectedSchoolYear = String(aySel.value || "");
      state.selectedSemester = "";
      renderTermFilters();
      await loadEvents();
    });

    semSel.addEventListener("change", async () => {
      state.selectedSemester = String(semSel.value || "");
      renderTermFilters();
      await loadEvents();
    });
  }

  // -------------------------
  // org officer scope locking
  // -------------------------
  function renderOfficerOrgs() {
    const deptSel = qs("#aeDepartment");
    const wrap = qs("#aeDeptWrap");
    const scopeSel = qs("#aeScope");
    if (!deptSel || !wrap || !scopeSel) return;

    const orgs = Array.isArray(state.myOrgs) ? state.myOrgs : [];
    deptSel.innerHTML = `<option value="" disabled selected>Select organization</option>` +
      orgs.map((o) => `<option value="${escapeHtml(o.id)}">${escapeHtml(o.name || o.org_name || "Organization")}</option>`).join("");

    // if only one org -> force it
    if (orgs.length === 1) {
      const only = orgs[0];
      const oid = Number(only.id) || 0;
      state.forcedOrgId = oid;
      state.forcedOrgName = String(only.name || only.org_name || "");

      // force scope
      scopeSel.value = "organization";
      scopeSel.disabled = true;

      // show org select but lock it to only choice
      wrap.classList.remove("d-none");
      deptSel.value = String(oid);
      deptSel.disabled = true;

      // also mark required UI state
      deptSel.setAttribute("title", "Locked to your organization.");
      scopeSel.setAttribute("title", "Officers can only create organization-scoped events.");
      return;
    }

    // multiple orgs (officer in multiple)
    if (orgs.length > 1) {
      scopeSel.value = "organization";
      scopeSel.disabled = true;
      wrap.classList.remove("d-none");
      deptSel.disabled = false;
      return;
    }

    // no org list returned -> don't lock
    scopeSel.disabled = false;
    deptSel.disabled = false;
    // only show org pick when user selects org scope
    wrap.classList.toggle("d-none", String(scopeSel.value || "") !== "organization");
  }

  function applyAddEventScopeRules() {
    const scopeSel = qs("#aeScope");
    const wrap = qs("#aeDeptWrap");
    if (!scopeSel || !wrap) return;

    // if backend says force org scope
    if (state.permissions.force_org_scope) {
      scopeSel.value = "organization";
      scopeSel.disabled = true;
      wrap.classList.remove("d-none");
      return;
    }

    // otherwise normal behavior
    scopeSel.disabled = false;
    wrap.classList.toggle("d-none", String(scopeSel.value || "") !== "organization");
  }

  // -------------------------
  // list rendering
  // -------------------------
  function ensureCardStyles() {
    if (document.getElementById("eeCardStyles")) return;
    const style = document.createElement("style");
    style.id = "eeCardStyles";
    style.textContent = `
      .ee-event-card .card-body{
        display:flex;
        flex-direction:column;
        min-height: 190px;
      }
      .ee-event-card .ee-card-actions{ margin-top:auto; }
      .ee-event-card .badge-top-right{
        position:absolute;
        top:12px;
        right:12px;
        z-index:2;
      }
    `;
    document.head.appendChild(style);
  }

  function filterEvents() {
    const q = String(state.search || "").trim().toLowerCase();
    if (!q) { state.eventsFiltered = state.events.slice(); return; }

    state.eventsFiltered = state.events.filter((e) => {
      const t = `${e.title || e.event_name || ""} ${e.org_name || e.organization || ""} ${e.location || ""} ${e.scope || ""}`.toLowerCase();
      return t.includes(q);
    });
  }

  function renderEmptyState() {
    setHidden(qs("#eeEmptyState"), state.eventsFiltered.length !== 0);
  }

  function renderCards() {
    ensureCardStyles();
    const grid = qs("#eeCardsGrid");
    if (!grid) return;

    filterEvents();
    renderEmptyState();

    if (state.eventsFiltered.length === 0) { grid.innerHTML = ""; return; }

    grid.innerHTML = state.eventsFiltered.map((e) => {
      const id = Number(e.id) || 0;
      const title = escapeHtml(e.title || e.event_name || "Untitled Event");
      const org = escapeHtml(e.org_name || e.organization || "—");
      const date = escapeHtml(e.event_date || e.date || "—");
      const scope = escapeHtml(e.scope || "—");
      const status = escapeHtml(e.status || e.event_status || "—");

      const s = String(status).toLowerCase();
      const badgeCls = s.includes("approved") || s.includes("accepted")
        ? "bg-success"
        : s.includes("pending")
          ? "bg-warning text-dark"
          : "bg-secondary";

      return `
        <div class="col-12 col-md-6 col-lg-4">
          <div class="card shadow-sm border-0 position-relative ee-event-card" data-event-id="${id}">
            <div class="badge-top-right">
              <span class="badge ${badgeCls}">${status}</span>
            </div>
            <div class="card-body">
              <div class="fw-semibold mb-1">${title}</div>
              <div class="small text-muted mb-2">${org}</div>

              <div class="small mb-1"><span class="text-muted">Date:</span> ${date}</div>
              <div class="small mb-1"><span class="text-muted">Scope:</span> ${scope}</div>

              <div class="ee-card-actions d-flex gap-2 mt-3">
                <button type="button" class="btn btn-outline-primary btn-sm w-100" data-ee-open="${id}">
                  <i class="bi bi-folder2-open me-1"></i>Open
                </button>
              </div>
            </div>
          </div>
        </div>
      `;
    }).join("");

    qsa("[data-ee-open]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = Number(btn.getAttribute("data-ee-open") || 0);
        if (!id) return;
        await openEvent(id);
      });
    });
  }

  // -------------------------
  // event rendering
  // -------------------------
  function setGateBadges() {
    const p = !!state.gates.proposal_approved;
    const a = !!state.gates.accomplishment_approved;

    setHidden(qs("#eeProposalGateBadge"), p);
    setHidden(qs("#eeAccompGateBadge"), a);
    setHidden(qs("#eeUnlockedBadge"), !(p && a));

    const banner = qs("#eeEventGateBanner");
    const txt = qs("#eeEventGateText");

    if (!p) {
      setHidden(banner, false);
      if (txt) txt.textContent = "Proposal is not approved yet. Some sections will remain locked.";
    } else if (!a) {
      setHidden(banner, false);
      if (txt) txt.textContent = "Accomplishment report is not approved yet. Liquidation will remain locked.";
    } else {
      setHidden(banner, true);
    }

    const fundsLock = qs("#eeFundsLock");
    const fundsLockText = qs("#eeFundsLockText");
    const debitsLock = qs("#eeDebitsLock");
    const debitsLockText = qs("#eeDebitsLockText");
    const liqLock = qs("#eeLiqLock");
    const liqLockText = qs("#eeLiqLockText");

    const canAddCredit = !!state.permissions.can_add_credit;
    const canAddDebit = !!state.permissions.can_add_debit;

    if (!canAddCredit) {
      setHidden(fundsLock, false);
      if (fundsLockText) fundsLockText.textContent = "You can view credits, but you cannot add credits with your role.";
    } else setHidden(fundsLock, true);

    if (!canAddDebit) {
      setHidden(debitsLock, false);
      if (debitsLockText) debitsLockText.textContent = "You can view expenses, but you cannot add expenses with your role.";
    } else setHidden(debitsLock, true);

    if (!a) {
      setHidden(liqLock, false);
      if (liqLockText) liqLockText.textContent = "This report becomes available after the accomplishment report is approved.";
    } else setHidden(liqLock, true);

    setActionEnabled("#fundAddBtn", canAddCredit, "Not allowed.");
    setActionEnabled("#debitAddBtn", canAddDebit, "Not allowed.");
    setActionEnabled("#liqPrintBtn", a, "Locked until accomplishment is approved.");
  }

  function renderOverview() {
    const e = state.selectedEvent || {};
    const meta = qs("#eeEventMeta");
    const title = qs("#eeEventHeaderTitle");
    const status = qs("#eeEventStatus");

    if (title) title.textContent = e.title || e.event_name || "Event";
    if (status) status.textContent = e.status || e.event_status || "—";

    const metaParts = [
      e.org_name || e.organization || "—",
      e.event_date || e.date || "—",
      (e.school_year && e.semester) ? `${e.school_year} • ${e.semester}` : "",
    ].filter(Boolean);

    if (meta) meta.textContent = metaParts.join(" · ");

    if (qs("#ovOrg")) qs("#ovOrg").textContent = e.org_name || e.organization || "—";
    if (qs("#ovDate")) qs("#ovDate").textContent = e.event_date || e.date || "—";
    if (qs("#ovYear")) qs("#ovYear").textContent = e.school_year || "—";
    if (qs("#ovAY")) qs("#ovAY").textContent = e.semester || "—"; // keep id, show semester
    if (qs("#ovDesc")) qs("#ovDesc").textContent = e.description || e.event_description || "—";

    const credits = Number(e.total_credits ?? e.credits_total ?? 0);
    const debits = Number(e.total_debits ?? e.debits_total ?? 0);
    const balance = (Number.isFinite(credits) ? credits : 0) - (Number.isFinite(debits) ? debits : 0);

    if (qs("#ovCredits")) qs("#ovCredits").textContent = money(credits);
    if (qs("#ovDebits")) qs("#ovDebits").textContent = money(debits);
    if (qs("#ovBalance")) qs("#ovBalance").textContent = money(balance);

    if (qs("#liqEvent")) qs("#liqEvent").textContent = e.title || e.event_name || "—";
    if (qs("#liqOrg")) qs("#liqOrg").textContent = e.org_name || e.organization || "—";
    if (qs("#liqDate")) qs("#liqDate").textContent = e.event_date || e.date || "—";
    if (qs("#liqYear")) qs("#liqYear").textContent = e.school_year || "—";
    if (qs("#liqCredits")) qs("#liqCredits").textContent = money(credits);
    if (qs("#liqDebits")) qs("#liqDebits").textContent = money(debits);
    if (qs("#liqBalance")) qs("#liqBalance").textContent = money(balance);
  }

  function renderCredits() {
    const tb = qs("#fundsTbody");
    if (!tb) return;

    if (!state.credits.length) {
      tb.innerHTML = `<tr><td colspan="4" class="text-center text-muted">No credits yet.</td></tr>`;
      return;
    }

    tb.innerHTML = state.credits.map((c) => {
      const dt = escapeHtml(c.date || c.created_at || "—");
      const src = escapeHtml(c.source || c.title || "—");
      const notes = escapeHtml(c.notes || c.description || "—");
      const amt = money(c.amount || 0);
      return `
        <tr>
          <td>${dt}</td>
          <td>${src}</td>
          <td>${notes}</td>
          <td class="text-end">${amt}</td>
        </tr>
      `;
    }).join("");
  }

  function renderDebits() {
    const tb = qs("#debitsTbody");
    const liqTb = qs("#liqTbody");
    if (!tb) return;

    if (!state.debits.length) {
      tb.innerHTML = `<tr><td colspan="8" class="text-center text-muted">No expenses yet.</td></tr>`;
      if (liqTb) liqTb.innerHTML = `<tr><td colspan="8" class="text-center text-muted">No items.</td></tr>`;
      return;
    }

    tb.innerHTML = state.debits.map((d) => {
      const dt = escapeHtml(d.date || d.created_at || "—");
      const cat = escapeHtml(d.category || "—");
      const notes = escapeHtml(d.notes || d.description || "—");
      const qty = escapeHtml(d.qty ?? d.quantity ?? 1);
      const unit = money(d.unit_price ?? 0);
      const amt = money(d.amount ?? 0);
      const rno = escapeHtml(d.receipt_no || d.receipt_number || "—");

      const fileUrl = d.receipt_url || d.receipt_path || "";
      const receiptCell = fileUrl
        ? `<button type="button" class="btn btn-link btn-sm p-0" data-ee-openfile="${escapeHtml(fileUrl)}">View</button>`
        : `<span class="text-muted small">—</span>`;

      return `
        <tr>
          <td>${dt}</td>
          <td>${cat}</td>
          <td>${notes}</td>
          <td class="text-center">${qty}</td>
          <td class="text-end">${unit}</td>
          <td class="text-end">${amt}</td>
          <td>${rno}</td>
          <td>${receiptCell}</td>
        </tr>
      `;
    }).join("");

    if (liqTb) {
      liqTb.innerHTML = state.debits.map((d, idx) => {
        const dt = escapeHtml(d.date || d.created_at || "—");
        const cat = escapeHtml(d.category || "—");
        const notes = escapeHtml(d.notes || d.description || "—");
        const qty = escapeHtml(d.qty ?? d.quantity ?? 1);
        const unit = money(d.unit_price ?? 0);
        const amt = money(d.amount ?? 0);
        const rno = escapeHtml(d.receipt_no || d.receipt_number || "—");
        return `
          <tr>
            <td>${idx + 1}</td>
            <td>${dt}</td>
            <td>${cat}</td>
            <td>${notes}</td>
            <td class="text-center">${qty}</td>
            <td class="text-end">${unit}</td>
            <td class="text-end">${amt}</td>
            <td>${rno}</td>
          </tr>
        `;
      }).join("");
    }

    qsa("[data-ee-openfile]").forEach((btn) => {
      btn.addEventListener("click", () => openNewTab(btn.getAttribute("data-ee-openfile") || ""));
    });
  }

  function renderLedger() {
    const tb = qs("#ledgerTbody");
    if (!tb) return;

    if (!state.ledger.length) {
      tb.innerHTML = `<tr><td colspan="7" class="text-center text-muted">No entries.</td></tr>`;
      return;
    }

    tb.innerHTML = state.ledger.map((x) => {
      const dt = escapeHtml(x.date || x.created_at || "—");
      const type = escapeHtml(x.type || "—");
      const desc = escapeHtml(x.description || x.notes || "—");
      const cr = x.credit ? money(x.credit) : "—";
      const dr = x.debit ? money(x.debit) : "—";
      const ref = escapeHtml(x.reference || x.ref || "—");
      const bal = (x.balance != null) ? money(x.balance) : "—";

      return `
        <tr>
          <td>${dt}</td>
          <td>${type}</td>
          <td>${desc}</td>
          <td class="text-end">${cr}</td>
          <td class="text-end">${dr}</td>
          <td class="text-end">${ref}</td>
          <td class="text-end">${bal}</td>
        </tr>
      `;
    }).join("");
  }

  // -------------------------
  // badges + gates
  // -------------------------
  function applyGlobalRoleBadges() {
    const roleBadge = qs("#eeRoleBadge");
    const gateBadge = qs("#eeGateBadge");

    if (roleBadge) {
      const role = String(state.permissions.role || "").toUpperCase();
      roleBadge.textContent = role || "ROLE";
      setHidden(roleBadge, !role);
    }

    if (gateBadge) {
      const term = state.terms.find((t) => Number(t.id) === Number(state.selectedTermId));
      gateBadge.textContent = term ? termLabel(term) : "TERM";
      setHidden(gateBadge, !term);
    }
  }

  function applyListGates() {
    const banner = qs("#eeListGateBanner");
    const txt = qs("#eeListGateText");

    const isReadOnlyTerm = state.selectedTermId && state.activeTermId && Number(state.selectedTermId) !== Number(state.activeTermId);
    const isReadOnly = !!state.permissions.is_readonly || isReadOnlyTerm;

    setHidden(qs("#eeListHintBadge"), !isReadOnly);
    setHidden(banner, !isReadOnly);

    if (txt) {
      txt.textContent = isReadOnly
        ? "This page is currently in view-only mode for the selected term."
        : "—";
    }

    const canAdd = !!state.permissions.can_add_event && !isReadOnly;
    setActionEnabled("#btnAddEvent", canAdd, isReadOnly ? "Locked on non-active term." : "Not allowed.");
    setActionEnabled("#btnEmptyAdd", canAdd, isReadOnly ? "Locked on non-active term." : "Not allowed.");
  }

  // -------------------------
  // API loaders
  // -------------------------
  async function loadTerms() {
    const data = await postJSON({ action: "get_terms" });

    const terms = data.terms || data.academic_terms || [];
    state.terms = Array.isArray(terms) ? terms : [];

    // FIX: your PHP returns active_term:{id,...}
    state.activeTermId = Number(
      data.active_term_id ||
      data.activeTermId ||
      data.active_term?.id ||
      data.active_term?.term_id ||
      0
    ) || 0;

    // pick active/default
    const active =
      state.terms.find((t) => Number(t.id) === Number(state.activeTermId)) ||
      state.terms.find((t) => String(t.status).toLowerCase() === "active") ||
      state.terms[0];

    if (active) {
      state.selectedSchoolYear = String(active.school_year || "");
      state.selectedSemester = String(active.semester || "");
      state.selectedTermId = Number(active.id) || 0;
    }

    renderTermFilters();
  }

  async function loadContext() {
    // optional endpoint: if you implement this in PHP, great.
    // If not implemented, we just skip silently.
    try {
      const data = await postJSON({ action: "get_context" });

      if (data.permissions) state.permissions = { ...state.permissions, ...data.permissions };

      const orgs = data.my_orgs || data.officer_orgs || data.organizations || [];
      state.myOrgs = Array.isArray(orgs)
        ? orgs.map((o) => ({
            id: Number(o.id || o.org_id) || 0,
            name: String(o.name || o.org_name || o.organization_name || "").trim(),
          })).filter((o) => o.id)
        : [];

      // if backend directly tells you to force org scope
      if (data.force_org_scope === true) state.permissions.force_org_scope = true;

      // if they’re an officer and backend gives orgs, force it too
      if (state.myOrgs.length) state.permissions.force_org_scope = true;

      renderOfficerOrgs();
      applyAddEventScopeRules();
    } catch (e) {
      // ignore if PHP doesn't have get_context yet
      console.log("[EventExpenses] get_context skipped:", e.message);
    }
  }

  async function loadEvents() {
    const q = String(state.search || "").trim();
    const termId = Number(state.selectedTermId || 0);

    const data = await postJSON({
      action: "list_events",
      term_id: termId,
      q,
    });

    const rows = data.events || data.rows || [];
    state.events = Array.isArray(rows) ? rows : [];

    if (data.permissions) state.permissions = { ...state.permissions, ...data.permissions };

    renderCards();
    applyGlobalRoleBadges();
    applyListGates();
  }

  async function openEvent(eventId) {
    state.selectedEventId = Number(eventId) || 0;
    if (!state.selectedEventId) return;

    const termId = Number(state.selectedTermId || 0);

    const data = await postJSON({
      action: "get_event",
      event_id: state.selectedEventId,
      term_id: termId,
    });

    state.selectedEvent = data.event || data.row || null;

    state.permissions = { ...state.permissions, ...(data.permissions || {}) };
    state.gates = { ...state.gates, ...(data.gates || {}) };

    if (!data.gates && state.selectedEvent) {
      const ps = String(state.selectedEvent.proposal_status || state.selectedEvent.proposal || "").toLowerCase();
      const as = String(state.selectedEvent.accomplishment_status || state.selectedEvent.accomplishment || "").toLowerCase();
      state.gates.proposal_approved = ps === "approved" || ps === "accepted";
      state.gates.accomplishment_approved = as === "approved" || as === "accepted";
    }

    state.credits = Array.isArray(data.credits) ? data.credits : [];
    state.debits = Array.isArray(data.debits) ? data.debits : [];
    state.ledger = Array.isArray(data.ledger) ? data.ledger : [];

    showView("event");
    renderOverview();
    setGateBadges();
    renderCredits();
    renderDebits();
    renderLedger();

    toast("Event loaded.");
  }

  // -------------------------
  // binds
  // -------------------------
  function bindListEvents() {
    const search = qs("#eeSearch");
    if (search) {
      let t = null;
      search.addEventListener("input", () => {
        state.search = String(search.value || "");
        clearTimeout(t);
        t = setTimeout(() => {
          loadEvents().catch((e) => safeShowError(e.message));
        }, 250);
      });
    }

    const back = qs("#eeBackBtn");
    if (back) back.addEventListener("click", () => {
      state.selectedEventId = 0;
      state.selectedEvent = null;
      showView("list");
    });
  }

  function bindAddEventModal() {
    const scopeSel = qs("#aeScope");
    const deptWrap = qs("#aeDeptWrap");

    if (scopeSel && deptWrap) {
      scopeSel.addEventListener("change", () => {
        applyAddEventScopeRules();
        deptWrap.classList.toggle("d-none", String(scopeSel.value || "") !== "organization");
      });
    }

    const save = qs("#aeSaveBtn");
    if (save) {
      save.addEventListener("click", async () => {
        try {
          const name = String(qs("#aeName")?.value || "").trim();
          const loc = String(qs("#aeLocation")?.value || "").trim();
          const scopeSel2 = qs("#aeScope");
          const scope = String(scopeSel2?.value || "").trim();
          const orgId = Number(qs("#aeDepartment")?.value || 0) || 0;

          if (!name) throw new Error("Event Name is required.");
          if (!loc) throw new Error("Location is required.");
          if (!scope) throw new Error("Scope is required.");

          // if scope is forced to organization (officers), enforce it
          const finalScope = (state.permissions.force_org_scope ? "organization" : scope);

          if (finalScope === "organization" && !orgId) {
            throw new Error("Organization is required.");
          }

          const termId = Number(state.selectedTermId || 0);
          if (!termId) throw new Error("No term selected.");

          const data = await postJSON({
            action: "add_event",
            term_id: termId,
            title: name,
            location: loc,
            scope: finalScope,
            org_id: finalScope === "organization" ? orgId : null,
          });

          safeShowSuccess(data.message || "Event added.");
          closeModal("#addEventModal");
          await loadEvents();
        } catch (e) {
          safeShowError(e.message);
        }
      });
    }
  }

  function bindAddCreditModal() {
    const btn = qs("#fundAddBtn");
    if (btn) {
      btn.addEventListener("click", () => {
        const hid = qs("#acEventId");
        if (hid) hid.value = String(state.selectedEventId || "");
        const el = qs("#addCreditModal");
        if (el && typeof bootstrap !== "undefined") bootstrap.Modal.getOrCreateInstance(el).show();
      });
    }

    const save = qs("#acSaveBtn");
    if (save) {
      save.addEventListener("click", async () => {
        try {
          if (!state.permissions.can_add_credit) throw new Error("Not allowed.");

          const date = String(qs("#acDate")?.value || "").trim();
          const source = String(qs("#acSource")?.value || "").trim();
          const amount = Number(qs("#acAmount")?.value || 0);
          const notes = String(qs("#acNotes")?.value || "").trim();

          if (!date) throw new Error("Date is required.");
          if (!source) throw new Error("Source is required.");
          if (!(amount >= 0)) throw new Error("Invalid amount.");

          const data = await postJSON({
            action: "add_credit",
            term_id: Number(state.selectedTermId || 0),
            event_id: Number(state.selectedEventId || 0),
            date,
            source,
            amount,
            notes,
          });

          safeShowSuccess(data.message || "Credit added.");
          closeModal("#addCreditModal");
          await openEvent(state.selectedEventId);
        } catch (e) {
          safeShowError(e.message);
        }
      });
    }
  }

  function bindAddDebitModal() {
    const unitEl = qs("#axUnitPrice");
    const qtyEl = qs("#axQuantity");
    const amtEl = qs("#axAmount");

    function recalcAmount() {
      if (!amtEl) return;
      const unit = Number(unitEl?.value || 0);
      const qty = Number(qtyEl?.value || 1);
      const total = (Number.isFinite(unit) ? unit : 0) * (Number.isFinite(qty) ? qty : 1);
      amtEl.value = total ? String(total.toFixed(2)) : "";
    }

    if (unitEl) unitEl.addEventListener("input", recalcAmount);
    if (qtyEl) qtyEl.addEventListener("input", recalcAmount);

    const btn = qs("#debitAddBtn");
    if (btn) {
      btn.addEventListener("click", () => {
        const hid = qs("#axEventId");
        if (hid) hid.value = String(state.selectedEventId || "");
        const el = qs("#addExpenseModal");
        if (el && typeof bootstrap !== "undefined") bootstrap.Modal.getOrCreateInstance(el).show();
      });
    }

    const save = qs("#axSaveBtn");
    if (save) {
      save.addEventListener("click", async () => {
        try {
          if (!state.permissions.can_add_debit) throw new Error("Not allowed.");

          const date = String(qs("#axDate")?.value || "").trim();
          const category = String(qs("#axCategory")?.value || "").trim();
          const qty = Number(qs("#axQuantity")?.value || 1);
          const unit = Number(qs("#axUnitPrice")?.value || 0);
          const amount = Number(qs("#axAmount")?.value || 0);
          const receiptNo = String(qs("#axReceiptNumber")?.value || "").trim();
          const notes = String(qs("#axNotes")?.value || "").trim();
          const file = qs("#axReceipt")?.files?.[0] || null;

          if (!date) throw new Error("Date is required.");
          if (!category) throw new Error("Category is required.");
          if (!(qty >= 1)) throw new Error("Quantity must be 1 or more.");
          if (!(amount >= 0)) throw new Error("Invalid amount.");
          if (!receiptNo) throw new Error("Receipt Number is required.");
          if (!file) throw new Error("Receipt file is required.");
          if (!notes) throw new Error("Notes is required.");

          const fd = new FormData();
          fd.append("action", "add_debit");
          fd.append("term_id", String(Number(state.selectedTermId || 0)));
          fd.append("event_id", String(Number(state.selectedEventId || 0)));
          fd.append("date", date);
          fd.append("category", category);
          fd.append("qty", String(qty));
          fd.append("unit_price", String(unit));
          fd.append("amount", String(amount));
          fd.append("receipt_no", receiptNo);
          fd.append("notes", notes);
          fd.append("receipt_file", file);

          const res = await fetch(API_URL, {
            method: "POST",
            credentials: "include",
            body: fd,
          });

          const text = await res.text();
          console.log("[EventExpenses] RAW multipart:", res.status, text);

          let data;
          try { data = JSON.parse(text); }
          catch { throw new Error("Invalid server response (not JSON). Check console RAW."); }

          if (!res.ok) throw new Error(data?.message || `HTTP ${res.status}`);
          if (!data?.success) throw new Error(data?.message || "Request failed.");

          safeShowSuccess(data.message || "Expense added.");
          closeModal("#addExpenseModal");
          await openEvent(state.selectedEventId);
        } catch (e) {
          safeShowError(e.message);
        }
      });
    }
  }

  function bindPrintButtons() {
    const ledgerBtn = qs("#ledgerPrintBtn");
    if (ledgerBtn) ledgerBtn.addEventListener("click", () => window.print());

    const liqBtn = qs("#liqPrintBtn");
    if (liqBtn) {
      liqBtn.addEventListener("click", () => {
        if (!state.gates.accomplishment_approved) {
          safeShowError("Locked: accomplishment report not approved yet.");
          return;
        }
        window.print();
      });
    }
  }

  // -------------------------
  // init (callable for SPA)
  // -------------------------
  async function init() {
    try {
      // SPA guard: only run when page exists
      const root = qs("#event-expenses-page");
      if (!root) return;

      // prevent double binding when user clicks sidebar multiple times
      if (__bound) return;
      __bound = true;

      showView("list");
      setHidden(qs("#eeReadOnlyBadge"), true);

      bindTermFilterEvents();
      bindListEvents();
      bindAddEventModal();
      bindAddCreditModal();
      bindAddDebitModal();
      bindPrintButtons();

      const emptyAdd = qs("#btnEmptyAdd");
      if (emptyAdd) {
        emptyAdd.addEventListener("click", () => {
          const el = qs("#addEventModal");
          if (el && typeof bootstrap !== "undefined") bootstrap.Modal.getOrCreateInstance(el).show();
        });
      }

      await loadTerms();
      await loadContext(); // <- officer scope/org locking + perms (optional)
      applyGlobalRoleBadges();
      await loadEvents();
    } catch (e) {
      safeShowError(e.message);
    }
  }

  // expose callable init for your section router
  window.EventExpenses = window.EventExpenses || {};
  window.EventExpenses.init = init;

  // If the page is not SPA-loaded and already in DOM, auto-init.
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();

    bindUI();
    bindSetPaymentModal();
    loadOrganizations().catch((err) => safeShowError(err?.message || "Failed to load."));
  }

  window.OrgPayments = { init, _debug: { state, postJSON } };
})();
//const unpaidList