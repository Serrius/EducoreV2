/* js/clubs/clubs.js */
/* global bootstrap, showSuccess, showError */

(function () {
  "use strict";

  // prevent double-loading
  if (window.__ClubsBooted) return;
  window.__ClubsBooted = true;

  const API_URL = "php/clubs.php";

  // -------------------------
  // DOM helpers (your style)
  // -------------------------
  function qs(sel, root = document) {
    return root.querySelector(sel);
  }
  function qsa(sel, root = document) {
    return Array.from(root.querySelectorAll(sel));
  }

  function safeShowError(msg) {
    if (typeof window.showError === "function") return window.showError(msg);
    alert(msg || "Something went wrong.");
  }
  function safeShowSuccess(msg) {
    if (typeof window.showSuccess === "function") return window.showSuccess(msg);
    alert(msg || "Success.");
  }

  // -------------------------
  // App base URL resolver
  // -------------------------
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

  // -------------------------
  // Fetch helper
  // -------------------------
  async function postJSON(payload) {
    const res = await fetch(API_URL, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload || {}),
    });

    const text = await res.text();
    console.log("[Clubs] RAW:", res.status, text);

    let data;
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error("Invalid server response (not JSON). Check console RAW.");
    }

    if (!res.ok) throw new Error(data?.message || `HTTP ${res.status}`);
    if (!data?.success) throw new Error(data?.message || "Request failed.");
    return data;
  }

  // -------------------------
  // State
  // -------------------------
  const state = {
    term: null,

    clubs: [],
    clubsFiltered: [],
    selectedClub: null,

    manageOrgId: 0,

    pending: { rows: [], page: 1, pageSize: 10, search: "" },
    active: { rows: [], page: 1, pageSize: 10, search: "" },
    fees: { rows: [], page: 1, pageSize: 10, search: "" },

    clubMembers: { rows: [], search: "" },
  };

  // -------------------------
  // Sections
  // -------------------------
  function showSection(which) {
    const list = qs("#clubsSectionList");
    const details = qs("#clubsSectionDetails");
    const manage = qs("#clubsSectionManage");

    if (list) list.classList.toggle("d-none", which !== "list");
    if (details) details.classList.toggle("d-none", which !== "details");
    if (manage) manage.classList.toggle("d-none", which !== "manage");

    const back = qs("#clubsBtnBackToList");
    if (back) back.classList.toggle("d-none", which === "list");
  }

  // -------------------------
  // Small helpers
  // -------------------------
  function escapeHtml(s) {
    return String(s ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function setBtnLoading(btn, on, textSel, loadSel) {
    if (!btn) return;
    const t = btn.querySelector(textSel);
    const l = btn.querySelector(loadSel);
    btn.disabled = !!on;
    if (t) t.classList.toggle("d-none", !!on);
    if (l) l.classList.toggle("d-none", !on);
  }

  function setBadgeCount(id, n) {
    const el = qs(id);
    if (el) el.textContent = String(n || 0);
  }

  function normalizeName(r) {
    const parts = [];
    if (r.first_name) parts.push(r.first_name);
    if (r.middle_name) parts.push(r.middle_name);
    if (r.last_name) parts.push(r.last_name);
    if (r.suffix) parts.push(r.suffix);
    return parts.join(" ").replace(/\s+/g, " ").trim();
  }

  function isTruthyFlag(v) {
    const s = String(v ?? "").trim().toLowerCase();
    return v === true || v === 1 || s === "1" || s === "true" || s === "yes" || s === "y";
  }

  // IMPORTANT FIX:
  // - Some rows might not send fee_required consistently.
  // - If membership_fee > 0, treat as fee-required for display + default amounts.
  function getClubFeeInfo(club) {
    const feeNum = Number(club?.membership_fee ?? 0);
    const fee = Number.isFinite(feeNum) ? feeNum : 0;
    const feeRequired = isTruthyFlag(club?.fee_required) || fee > 0;
    return { feeRequired, fee };
  }

  function renderRoleBadge(r) {
    const role = String(r.role || r.member_role || "").trim();
    const pos = String(r.position || "").trim();
    if (role.toLowerCase() === "officer") {
      const label = pos ? `Officer (${pos})` : "Officer";
      return `<span class="badge text-bg-warning">${escapeHtml(label)}</span>`;
    }
    if (role) return `<span class="badge text-bg-success">${escapeHtml(role)}</span>`;
    return `<span class="badge text-bg-success">Member</span>`;
  }

  function paginate(rows, page, pageSize) {
    const total = rows.length;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const p = Math.min(Math.max(1, page), totalPages);
    const start = (p - 1) * pageSize;
    return {
      total,
      totalPages,
      page: p,
      slice: rows.slice(start, start + pageSize),
    };
  }

  function renderPagination(containerSel, total, page, pageSize) {
    const ul = qs(containerSel);
    if (!ul) return;

    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const cur = Math.min(Math.max(1, page), totalPages);

    const windowSize = 5;
    let start = Math.max(1, cur - Math.floor(windowSize / 2));
    let end = start + windowSize - 1;
    if (end > totalPages) {
      end = totalPages;
      start = Math.max(1, end - windowSize + 1);
    }

    const btn = (p, label, active, disabled) => `
      <li class="page-item ${active ? "active" : ""} ${disabled ? "disabled" : ""}">
        <button class="page-link" type="button" data-page="${p}">${label}</button>
      </li>
    `;

    let html = "";
    html += btn("prev", "&laquo;", false, cur <= 1);
    for (let i = start; i <= end; i++) html += btn(i, i, i === cur, false);
    html += btn("next", "&raquo;", false, cur >= totalPages);

    ul.innerHTML = html;
  }

  // -------------------------
  // Render: Clubs cards
  // -------------------------
  function renderClubsGrid() {
    ensureModernClubStyles();

    const grid = qs("#clubsCardGrid");
    const empty = qs("#clubsEmpty");
    const badge = qs("#clubsCountBadge");
    if (!grid) return;

    const rows = state.clubsFiltered || [];

    if (badge) badge.textContent = `${rows.length} clubs`;

    if (rows.length <= 0) {
      grid.innerHTML = "";
      if (empty) empty.classList.remove("d-none");
      return;
    }

    if (empty) empty.classList.add("d-none");

    grid.innerHTML = rows.map((c) => {
      const id = Number(c.id) || 0;
      const name = escapeHtml(c.org_name || "Unknown Organization");
      const abbreviation = escapeHtml(c.abbreviation || "");
      const scope = escapeHtml(c.scope || "General");
      const description = (c.description || "").trim();
      const shortDesc = description.length > 80 ? description.slice(0, 77) + "..." : description || "No description provided.";
      
      const cover = resolveAppUrl(c.logo_path || "assets/images/club-default.png");

      const { feeRequired, fee } = getClubFeeInfo(c);
      const feeText = feeRequired ? `₱ ${fee.toFixed(2)}` : "Free";
      const memberCount = c.member_count || 0;

      // Status badge class
      const status = String(c.status || "").toLowerCase();
      let statusBadgeClass = "club-badge club-badge-secondary";
      if (status.includes("active") || status.includes("accredited")) {
        statusBadgeClass = "club-badge club-badge-success";
      } else if (status.includes("pending")) {
        statusBadgeClass = "club-badge club-badge-warning";
      } else if (status.includes("inactive")) {
        statusBadgeClass = "club-badge club-badge-secondary";
      }

      // Get initials for avatar fallback
      const initials = name
        .split(/\s+/)
        .slice(0, 2)
        .map(w => w.charAt(0).toUpperCase())
        .join("");

      return `
        <div class="col-12 col-sm-6 col-lg-4 col-xl-3">
          <div class="club-modern-card" data-club-id="${id}">
            
            <!-- Card Top with Avatar -->
            <div class="club-modern-card__top">
              <div class="club-modern-card__avatar">
                <img src="${cover}" 
                    alt="${name}"
                    onerror="this.onerror=null; this.parentElement.innerHTML='${escapeHtml(initials)}';">
              </div>
              <div class="club-modern-card__title-wrap">
                <div class="club-modern-card__title" title="${name}">${name}</div>
                <div class="club-modern-card__org" title="${abbreviation}">${abbreviation || '—'}</div>
              </div>
            </div>

            <!-- Status Badge -->
            <div class="club-modern-card__badges">
              <span class="${statusBadgeClass}">
                <i class="bi bi-flag"></i>
                <span>${escapeHtml(c.status || "Active")}</span>
              </span>
              <span class="club-badge club-badge-light">
                <i class="bi bi-diagram-3"></i>
                <span>${scope}</span>
              </span>
            </div>

            <!-- Description -->
            <div class="club-modern-card__description" title="${escapeHtml(description)}">
              ${escapeHtml(shortDesc)}
            </div>

            <!-- Stats Section -->
            <div class="club-modern-card__stats">
              <div class="club-modern-card__stat-item">
                <span class="club-modern-card__stat-icon">
                  <i class="bi bi-cash-stack"></i>
                </span>
                <div>
                  <div class="club-modern-card__stat-label">Membership Fee</div>
                  <div class="club-modern-card__stat-value">${escapeHtml(feeText)}</div>
                </div>
              </div>

              <div class="club-modern-card__stat-item">
                <span class="club-modern-card__stat-icon">
                  <i class="bi bi-people"></i>
                </span>
                <div>
                  <div class="club-modern-card__stat-label">Members</div>
                  <div class="club-modern-card__stat-value">${memberCount} students</div>
                </div>
              </div>
            </div>

            <!-- Footer with Action Button -->
            <div class="club-modern-card__footer">
              <button type="button" class="club-view-btn" data-club-id="${id}">
                <i class="bi bi-eye me-1"></i>
                View Club
              </button>
            </div>

          </div>
        </div>
      `;
    }).join("");

    // Bind click events
    qsa(".club-view-btn").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const id = Number(btn.dataset.clubId || 0);
        if (id) loadClubDetails(id);
      });
    });

    // Make entire card clickable
    qsa(".club-modern-card").forEach((card) => {
      card.addEventListener("click", (e) => {
        if (e.target.closest(".club-view-btn")) return;
        const id = Number(card.dataset.clubId || 0);
        if (id) loadClubDetails(id);
      });
    });
  }

  function ensureModernClubStyles() {
  if (document.getElementById("club-modern-styles")) return;

  const style = document.createElement("style");
  style.id = "club-modern-styles";

  style.textContent = `
    /* Modern Club Cards - Matching Event Expenses Design */
    #clubsCardGrid .club-modern-card {
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
      height: 100%;
    }

    #clubsCardGrid .club-modern-card:hover {
      transform: translateY(-4px);
      box-shadow: 0 14px 34px rgba(0, 0, 0, 0.10) !important;
      border-color: rgba(13, 110, 253, 0.2);
    }

    /* Card Top Section with Gradient */
    #clubsCardGrid .club-modern-card__top {
      display: flex;
      align-items: flex-start;
      gap: 14px;
      padding: 18px 18px 12px;
      background: radial-gradient(circle at top right, rgba(13, 110, 253, 0.10), transparent 35%),
                  linear-gradient(180deg, rgba(13, 110, 253, 0.04), rgba(13, 110, 253, 0));
    }

    /* Avatar - Matching Event Expenses */
    #clubsCardGrid .club-modern-card__avatar {
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
      overflow: hidden;
    }

    #clubsCardGrid .club-modern-card__avatar img {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }

    #clubsCardGrid .club-modern-card__avatar:empty {
      display: inline-flex;
    }

    /* Title Area */
    #clubsCardGrid .club-modern-card__title-wrap {
      flex: 1;
      min-width: 0;
    }

    #clubsCardGrid .club-modern-card__title {
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

    #clubsCardGrid .club-modern-card__org {
      font-size: 0.875rem;
      color: #6b7280;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    /* Badges Section */
    #clubsCardGrid .club-modern-card__badges {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      padding: 0 18px 12px;
    }

    #clubsCardGrid .club-badge {
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

    #clubsCardGrid .club-badge-success {
      color: #0f5132;
      background: #d1e7dd;
      border-color: #badbcc;
    }

    #clubsCardGrid .club-badge-warning {
      color: #664d03;
      background: #fff3cd;
      border-color: #ffecb5;
    }

    #clubsCardGrid .club-badge-secondary {
      color: #41464b;
      background: #e2e3e5;
      border-color: #d3d6d8;
    }

    #clubsCardGrid .club-badge-light {
      color: #41464b;
      background: #e9ecef;
      border-color: #d3d6d8;
    }

    /* Description */
    #clubsCardGrid .club-modern-card__description {
      font-size: 0.88rem;
      color: #374151;
      line-height: 1.5;
      padding: 0 18px 12px;
      display: -webkit-box;
      -webkit-line-clamp: 3;
      -webkit-box-orient: vertical;
      overflow: hidden;
      min-height: 3.8em;
    }

    /* Stats Section */
    #clubsCardGrid .club-modern-card__stats {
      display: grid;
      gap: 8px;
      padding: 0 18px 12px;
    }

    #clubsCardGrid .club-modern-card__stat-item {
      display: flex;
      align-items: flex-start;
      gap: 10px;
      padding: 10px 12px;
      border-radius: 14px;
      background: #f8fafc;
      border: 1px solid #eef2f7;
      transition: background-color 0.15s ease;
    }

    #clubsCardGrid .club-modern-card__stat-item:hover {
      background: #ffffff;
      border-color: #0d6efd30;
    }

    #clubsCardGrid .club-modern-card__stat-icon {
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

    #clubsCardGrid .club-modern-card__stat-label {
      font-size: 0.7rem;
      font-weight: 700;
      color: #6b7280;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      margin-bottom: 2px;
    }

    #clubsCardGrid .club-modern-card__stat-value {
      font-size: 0.9rem;
      font-weight: 600;
      color: #1f2937;
      line-height: 1.25;
      word-break: break-word;
    }

    /* Footer */
    #clubsCardGrid .club-modern-card__footer {
      margin-top: auto;
      padding: 0 18px 18px;
    }

    #clubsCardGrid .club-view-btn {
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

    #clubsCardGrid .club-view-btn:hover {
      transform: scale(1.02);
      background: #0b5ed7;
    }

    /* Mobile Responsive */
    @media (max-width: 575px) {
      #clubsCardGrid .club-modern-card__top,
      #clubsCardGrid .club-modern-card__badges,
      #clubsCardGrid .club-modern-card__description,
      #clubsCardGrid .club-modern-card__stats,
      #clubsCardGrid .club-modern-card__footer {
        padding-left: 14px;
        padding-right: 14px;
      }
    }
  `;

  document.head.appendChild(style);
  }

  function fillCategoryFilter() {
    const sel = qs("#clubsCategory");
    if (!sel) return;

    const cats = new Set();
    (state.clubs || []).forEach((c) => {
      const v = String(c.scope || "").trim();
      if (v) cats.add(v);
    });

    const cur = sel.value;
    sel.innerHTML =
      `<option value="">All Categories</option>` +
      Array.from(cats)
        .sort()
        .map((c) => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`)
        .join("");
    sel.value = cur;
  }

  function applyClubsFilter() {
    const q = (qs("#clubsSearch")?.value || "").toLowerCase();
    const cat = (qs("#clubsCategory")?.value || "").trim();

    state.clubsFiltered = (state.clubs || []).filter((c) => {
      const name = String(c.org_name || "").toLowerCase();
      const abbr = String(c.abbreviation || "").toLowerCase();
      const scope = String(c.scope || "").trim();
      const okQ = !q || name.includes(q) || abbr.includes(q);
      const okC = !cat || scope === cat;
      return okQ && okC;
    });

    renderClubsGrid();
  }

  // -------------------------
  // Details render
  // -------------------------
  function renderClubDetails(payload) {
    console.log("club payload:", payload);
    state.selectedClub = payload || null;

    const club = payload?.club || {};
    const membership = payload?.membership || null;

    const isOfficer = isTruthyFlag(payload?.is_officer);
    const officerPos = String(payload?.officer_position || "").trim();

    // NEW: officer-like manage access (super/special/admin/moderator assigned)
    const canManage = isTruthyFlag(payload?.can_manage);
    const manageAs = String(payload?.manage_as || "").trim();

    if (qs("#clubsSelectedClubId")) qs("#clubsSelectedClubId").value = String(club.id || "");
    if (qs("#manageClubId")) qs("#manageClubId").value = String(club.id || "");

    if (qs("#clubCover")) {
      qs("#clubCover").src = resolveAppUrl(club.logo_path || "assets/images/club-default.png");
      qs("#clubCover").alt = club.org_name ? `${club.org_name} logo` : "Club logo";
    }
    if (qs("#clubName")) qs("#clubName").textContent = club.org_name || "—";
    if (qs("#clubCategory")) qs("#clubCategory").textContent = club.scope || "—";
    if (qs("#clubDescription")) qs("#clubDescription").textContent = club.description || "—";
    if (qs("#clubMission")) qs("#clubMission").textContent = club.mission || "—";
    if (qs("#clubVision")) qs("#clubVision").textContent = club.vision || "—";
    if (qs("#clubAdvocacy")) qs("#clubAdvocacy").textContent = club.advocacy || "—";

    if (qs("#clubStatusText")) qs("#clubStatusText").textContent = `Status: ${club.status || "—"}`;
    if (qs("#clubTermBadge")) {
      const t = payload?.term;
      const termLabel = t ? `${t.school_year} • ${t.semester}` : "—";
      qs("#clubTermBadge").textContent = `Academic Term: ${termLabel}`;
    }

    // compute fee reliably
    const { feeRequired, fee } = getClubFeeInfo(club);
    if (qs("#clubMembershipFee")) qs("#clubMembershipFee").textContent = feeRequired ? `₱ ${fee.toFixed(2)}` : "Free";
    if (qs("#clubFeeNote")) {
      qs("#clubFeeNote").textContent = feeRequired ? "Payment required before activation (pending → active)." : "";
    }

    const memberCount = Number(payload?.active_member_count ?? 0);
    if (qs("#clubMembersCount")) qs("#clubMembersCount").textContent = String(payload?.active_member_count ?? "—");

    const btnViewMembers = qs("#btnViewClubMembers");
    if (btnViewMembers) {
      btnViewMembers.disabled = !Number.isFinite(memberCount) || memberCount <= 0;
    }

    const btnJoin = qs("#btnClubJoin");
    const btnPending = qs("#btnClubPending");
    const btnMember = qs("#btnClubMember");
    const btnManage = qs("#btnClubManage");

    // reset
    if (btnJoin) btnJoin.classList.add("d-none");
    if (btnPending) btnPending.classList.add("d-none");
    if (btnMember) btnMember.classList.add("d-none");
    if (btnManage) btnManage.classList.add("d-none");

    // NEW LOGIC:
    // If you can manage, behave like officer (no join UI)
    if (canManage) {
      if (btnManage) {
        btnManage.classList.remove("d-none");

        // keep officer position for real officers
        btnManage.dataset.officerPosition = isOfficer ? officerPos : "";

        // optional label
        btnManage.dataset.manageAs = manageAs;

        // OPTIONAL: update button text to show who can manage
        const txt = manageAs ? `Manage (${manageAs})` : "Manage Club";
        btnManage.innerHTML = `<i class="bi bi-gear me-2"></i>${escapeHtml(txt)}`;
      }

      // Officers don't see the student status panel
      const statusWrap = qs("#clubMyStatusWrap");
      if (statusWrap) statusWrap.classList.add("d-none");

      return;
    }

    // Normal student UI
    const st = String(membership?.status || "");

    if (!membership) {
      if (btnJoin) {
        btnJoin.classList.remove("d-none");
        btnJoin.style.display = ""; // ✅ clears inline display:none
      }
    } else if (st === "Pending") {
      if (btnPending) {
        btnPending.classList.remove("d-none");
        btnPending.style.display = "";
      }
    } else if (st === "Approved") {
      if (btnMember) {
        btnMember.classList.remove("d-none");
        btnMember.style.display = "";
      }
    } else {
      if (btnJoin) {
        btnJoin.classList.remove("d-none");
        btnJoin.style.display = "";
      }
    }

    // Show the My Membership Status panel for regular students only
    renderClubMyStatus(membership);
  }

  function renderClubMyStatus(membership) {
    const wrap = qs("#clubMyStatusWrap");
    const stText = qs("#clubMyStatusText");
    const stBadge = qs("#clubMyStatusBadge");
    const stMeta = qs("#clubMyStatusMeta");
    const btnPrint = qs("#btnClubPrintMyReceipt");
    const accBody = qs("#clubMyStatusAccBody");
    const accBtn = qs("#clubMyStatusAccHead .accordion-button");

    // Only show for non-officers (canManage hides this section entirely via early return above)
    if (!wrap) return;
    wrap.classList.remove("d-none");

    const st = String(membership?.status || "—");

    if (stText) stText.textContent = st;

    if (stBadge) {
      stBadge.classList.remove("d-none", "text-bg-success", "text-bg-warning", "text-bg-danger", "text-bg-secondary");
      stBadge.textContent = st;
      if (st === "Approved") stBadge.classList.add("text-bg-success");
      else if (st === "Pending") stBadge.classList.add("text-bg-warning");
      else stBadge.classList.add("text-bg-secondary");
      stBadge.classList.remove("d-none");
    }

    if (stMeta) {
      if (!membership) {
        stMeta.textContent = "You have not joined this club yet.";
      } else if (st === "Approved" && membership.receipt_paid_at) {
        stMeta.textContent = `Paid on ${membership.receipt_paid_at}${membership.receipt_no ? " • Receipt: " + membership.receipt_no : ""}`;
      } else if (st === "Pending") {
        stMeta.textContent = "Your request is pending. An officer will record your payment and activate you.";
      } else {
        stMeta.textContent = "—";
      }
    }

    if (btnPrint) {
      const url = membership?.print_receipt_url ? String(membership.print_receipt_url) : "";
      if (st === "Approved" && url) {
        btnPrint.dataset.url = url;
        btnPrint.classList.remove("d-none");
      } else {
        btnPrint.dataset.url = "";
        btnPrint.classList.add("d-none");
      }
    }

    // Auto-expand when Approved so the print button is immediately visible
    if (accBody && accBtn) {
      if (st === "Approved") {
        accBody.classList.add("show");
        accBtn.classList.remove("collapsed");
        accBtn.setAttribute("aria-expanded", "true");
      } else {
        accBody.classList.remove("show");
        accBtn.classList.add("collapsed");
        accBtn.setAttribute("aria-expanded", "false");
      }
    }
  }

  // -------------------------
  // Club members modal
  // -------------------------
  function memberFullName(r) {
    const parts = [r.first_name, r.middle_name, r.last_name, r.suffix].filter(Boolean);
    return parts.join(" ").replace(/\s+/g, " ").trim();
  }

  function renderClubMembersModal() {
  const tbody = qs("#clubMembersTbody");
  if (!tbody) return;

  const q = (state.clubMembers.search || "").trim().toLowerCase();
  let rows = (state.clubMembers.rows || []).filter((r) => {
    if (!q) return true;
    const name = memberFullName(r).toLowerCase();
    const idn = String(r.id_number || "").toLowerCase();
    const prog = String(r.program || "").toLowerCase();
    const role = String(r.role_label || "").toLowerCase();
    return name.includes(q) || idn.includes(q) || prog.includes(q) || role.includes(q);
  });

  // Define hierarchical priority for officer positions
  const officerPriority = {
    // Top leadership
    'president': 100,
    'chairperson': 100,
    'president / chairperson': 100,
    
    // Vice Presidents
    'vice president': 90,
    'vp': 90,
    
    // Secretaries
    'secretary': 80,
    
    // Treasurers
    'treasurer': 70,
    
    // Auditors
    'auditor': 60,
    
    // Other officer positions
    'pio': 50,
    'public information officer': 50,
    'business manager': 40,
    'officer': 30,
    
    // Default for any other officer role not explicitly listed
    'other officer': 25
  };

  // Function to normalize role text for comparison
  function normalizeRole(roleText) {
    if (!roleText) return '';
    return roleText.toLowerCase().trim();
  }

  // Function to get priority score for a role
  function getRolePriority(roleText) {
    const normalized = normalizeRole(roleText);
    
    // Check if it's a member
    if (normalized === 'member' || normalized === '') return 0;
    
    // Check exact matches first
    for (const [key, value] of Object.entries(officerPriority)) {
      if (normalized.includes(key)) {
        return value;
      }
    }
    
    // If it contains any officer-related keywords but wasn't matched above
    const officerKeywords = ['officer', 'head', 'lead', 'coordinator'];
    for (const keyword of officerKeywords) {
      if (normalized.includes(keyword)) {
        return 20; // Default officer priority
      }
    }
    
    // If it's not a member and not matched above, treat as other officer
    return 25;
  }

  // Sort rows with hierarchical priority
  rows.sort((a, b) => {
    const aRole = a.role_label || '';
    const bRole = b.role_label || '';
    
    const aPriority = getRolePriority(aRole);
    const bPriority = getRolePriority(bRole);
    
    // First, sort by priority (higher priority first)
    if (aPriority !== bPriority) {
      return bPriority - aPriority;
    }
    
    // If same priority, sort by name alphabetically
    const aName = memberFullName(a).toLowerCase();
    const bName = memberFullName(b).toLowerCase();
    return aName.localeCompare(bName);
  });

  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="4" class="text-center text-muted py-4">No members.</td></tr>`;
  } else {
    tbody.innerHTML = rows.map((r) => {
      const roleLabel = escapeHtml(r.role_label || "Member");
      const name = escapeHtml(memberFullName(r) || "—");
      const idn = escapeHtml(String(r.id_number || "—"));
      const prog = escapeHtml(String(r.program || "—"));
      
      // Check if this is an officer (priority > 0)
      const isOfficer = getRolePriority(r.role_label) > 0;
      
      // Different background colors based on role
      let rowClass = '';
      if (isOfficer) {
        const priority = getRolePriority(r.role_label);
        if (priority >= 100) rowClass = 'table-primary'; // President - Blue
        else if (priority >= 90) rowClass = 'table-info'; // Vice President - Light Blue
        else if (priority >= 80) rowClass = 'table-success'; // Secretary - Green
        else if (priority >= 70) rowClass = 'table-warning'; // Treasurer - Yellow
        else if (priority >= 60) rowClass = 'table-danger'; // Auditor - Red
        else rowClass = 'table-light'; // Other officers - Light Gray
      }
      
      return `
        <tr class="${rowClass}">
          <td class="text-muted">${idn}</td>
          <td>${name}</td>
          <td>${prog}</td>
          <td><span class="badge ${isOfficer ? 'text-bg-primary' : 'text-bg-light border'}">${roleLabel}</span></td>
        </tr>
      `;
    }).join("");
  }

  const meta = qs("#clubMembersMeta");
  if (meta) meta.textContent = `${rows.length} member${rows.length === 1 ? "" : "s"}`;
  }

  async function loadClubMembers(orgId) {
    const data = await postJSON({ action: "list_club_members", org_id: orgId });
    state.clubMembers.rows = Array.isArray(data?.members) ? data.members : [];
    state.clubMembers.search = "";
    const inp = qs("#clubMembersSearch");
    if (inp) inp.value = "";
    renderClubMembersModal();
  }

  async function loadClubDetails(orgId) {
    try {
      const data = await postJSON({ action: "get_club_details", org_id: orgId });
      state.term = data.term || null;
      renderClubDetails(data);
      showSection("details");
    } catch (err) {
      safeShowError(err?.message || "Failed to load club details.");
    }
  }

  // -------------------------
  // Manage: render
  // -------------------------
  function renderPending() {
    const tbody = qs("#pendingTbody");
    if (!tbody) return;

    const q = (state.pending.search || "").toLowerCase();
    const filtered = (state.pending.rows || []).filter((r) => {
      const name = normalizeName(r).toLowerCase();
      const idn = String(r.id_number || "").toLowerCase();
      return !q || name.includes(q) || idn.includes(q);
    });

    setBadgeCount("#pendingCount", filtered.length);

    const pz = paginate(filtered, state.pending.page, state.pending.pageSize);
    state.pending.page = pz.page;

    if (pz.slice.length <= 0) {
      tbody.innerHTML = `<tr><td colspan="5" class="text-center text-muted py-4">No pending requests.</td></tr>`;
      renderPagination("#pendingPagination", 0, 1, state.pending.pageSize);
      return;
    }

    tbody.innerHTML = pz.slice
      .map((r) => {
        const name = normalizeName(r) || "—";
        const when = r.requested_at || "—";
        return `
          <tr>
            <td class="fw-semibold">${escapeHtml(r.id_number || "—")}</td>
            <td>
              <div class="fw-semibold">${escapeHtml(name)}</div>
              <div class="text-muted small">User ID: ${escapeHtml(String(r.student_user_id || ""))}</div>
            </td>
            <td>${escapeHtml(String(when))}</td>
            <td><span class="badge text-bg-secondary">Pending</span></td>
            <td class="text-end">
              <button
                type="button"
                class="btn btn-sm btn-success btn-activate-member"
                data-membership-id="${r.membership_id}"
                data-student-user-id="${r.student_user_id}"
                data-id-number="${escapeHtml(r.id_number || "")}"
                data-student-name="${escapeHtml(name)}"
              >
                <i class="bi bi-cash-coin me-1"></i>Activate
              </button>
            </td>
          </tr>
        `;
      })
      .join("");

    renderPagination("#pendingPagination", pz.total, pz.page, pz.pageSize);
  }

  function renderActive() {
    const tbody = qs("#activeTbody");
    if (!tbody) return;

    const q = (state.active.search || "").toLowerCase();
    const filtered = (state.active.rows || []).filter((r) => {
      const name = normalizeName(r).toLowerCase();
      const idn = String(r.id_number || "").toLowerCase();
      return !q || name.includes(q) || idn.includes(q);
    });

    setBadgeCount("#activeCount", filtered.length);

    const pz = paginate(filtered, state.active.page, state.active.pageSize);
    state.active.page = pz.page;

    if (pz.slice.length <= 0) {
      tbody.innerHTML = `<tr><td colspan="5" class="text-center text-muted py-4">No active members.</td></tr>`;
      renderPagination("#activePagination", 0, 1, state.active.pageSize);
      return;
    }

    tbody.innerHTML = pz.slice
      .map((r) => {
        const name = normalizeName(r) || "—";
        const when = r.reviewed_at || r.fee_paid_at || "—";
        return `
          <tr>
            <td class="fw-semibold">${escapeHtml(r.id_number || "—")}</td>
            <td>
              <div class="fw-semibold">${escapeHtml(name)}</div>
              <div class="text-muted small">User ID: ${escapeHtml(String(r.student_user_id || ""))}</div>
            </td>
            <td>${escapeHtml(String(when))}</td>
            <td>${renderRoleBadge(r)}</td>
            <td class="text-end">
              <span class="text-muted small">—</span>
            </td>
          </tr>
        `;
      })
      .join("");

    renderPagination("#activePagination", pz.total, pz.page, pz.pageSize);
  }

  function renderFees() {
    const tbody = qs("#feesTbody");
    if (!tbody) return;

    const q = (state.fees.search || "").toLowerCase();
    const filtered = (state.fees.rows || []).filter((r) => {
      const name = normalizeName(r).toLowerCase();
      const idn = String(r.id_number || "").toLowerCase();
      const rn = String(r.receipt_no || "").toLowerCase();
      return !q || name.includes(q) || idn.includes(q) || rn.includes(q);
    });

    setBadgeCount("#feesCount", filtered.length);

    const pz = paginate(filtered, state.fees.page, state.fees.pageSize);
    state.fees.page = pz.page;

    if (pz.slice.length <= 0) {
      tbody.innerHTML = `<tr><td colspan="6" class="text-center text-muted py-4">No fee records.</td></tr>`;
      renderPagination("#feesPagination", 0, 1, state.fees.pageSize);
      return;
    }

    tbody.innerHTML = pz.slice
      .map((r) => {
        const name = normalizeName(r) || "—";
        const amt = Number(r.amount || 0).toFixed(2);
        const paidAt = r.paid_at ? String(r.paid_at) : "—";
        const rec = r.receipt_no ? String(r.receipt_no) : "—";

        return `
          <tr>
            <td class="fw-semibold">${escapeHtml(r.id_number || "—")}</td>
            <td>
              <div class="fw-semibold">${escapeHtml(name)}</div>
              <div class="text-muted small">Receipt: <span class="font-monospace">${escapeHtml(rec)}</span></div>
            </td>
            <td>₱ ${escapeHtml(amt)}</td>
            <td>${escapeHtml(paidAt)}</td>
            <td><span class="font-monospace">${escapeHtml(rec)}</span></td>
            <td class="text-end">
              <button
                type="button"
                class="btn btn-sm btn-outline-dark btn-print-receipt"
                data-receipt-id="${r.receipt_id}"
                data-student-name="${escapeHtml(name)}"
                data-id-number="${escapeHtml(r.id_number || "")}"
                data-amount="${escapeHtml(amt)}"
                data-paid-at="${escapeHtml(paidAt)}"
                data-receipt-no="${escapeHtml(rec)}"
              >
                <i class="bi bi-printer me-1"></i>Receipt
              </button>
            </td>
          </tr>
        `;
      })
      .join("");

    renderPagination("#feesPagination", pz.total, pz.page, pz.pageSize);
  }

  async function loadPending(orgId) {
    const data = await postJSON({ action: "get_pending_members", org_id: orgId });
    state.term = data.term || state.term;
    state.pending.rows = data.rows || [];
    renderPending();
  }

  async function loadActive(orgId) {
    const data = await postJSON({ action: "get_active_members", org_id: orgId });
    state.term = data.term || state.term;
    state.active.rows = data.rows || [];
    renderActive();
  }

  async function loadFees(orgId) {
    const data = await postJSON({ action: "get_fee_records", org_id: orgId });
    state.term = data.term || state.term;
    state.fees.rows = data.rows || [];
    const btn = qs("#btnPrintAllPaid");
    if (btn) btn.dataset.printAllUrl = data.print_all_paid_url || "";
    renderFees();
  }

  async function loadManageAll(orgId) {
    state.manageOrgId = orgId;

    state.pending.page = 1;
    state.active.page = 1;
    state.fees.page = 1;

    await Promise.all([loadPending(orgId), loadActive(orgId), loadFees(orgId)]);
  }

  // -------------------------
  // Modals openers
  // -------------------------
  function openJoinModal(orgId, clubName) {
    const el = qs("#modalClubJoinConfirm");
    if (!el || !window.bootstrap) return;

    if (qs("#joinClubId")) qs("#joinClubId").value = String(orgId);
    if (qs("#joinClubName")) qs("#joinClubName").textContent = clubName || "—";

    bootstrap.Modal.getOrCreateInstance(el).show();
  }

  function openActivateModal(payload) {
    const el = qs("#modalActivateMember");
    if (!el || !window.bootstrap) return;

    if (qs("#actClubId")) qs("#actClubId").value = String(state.manageOrgId || "");
    if (qs("#actRequestId")) qs("#actRequestId").value = String(payload.membership_id || "");
    if (qs("#actStudentId")) qs("#actStudentId").value = String(payload.student_user_id || "");

    if (qs("#actStudentName")) qs("#actStudentName").textContent = payload.student_name || "—";
    if (qs("#actStudentIdNum")) qs("#actStudentIdNum").textContent = payload.id_number || "—";

    const cName = state.selectedClub?.club?.org_name || "—";
    if (qs("#actClubName")) qs("#actClubName").textContent = cName;

    // default amount from computed club fee reliably
    const club = state.selectedClub?.club || null;
    const { fee } = getClubFeeInfo(club);
    if (qs("#actAmount")) qs("#actAmount").value = fee > 0 ? fee.toFixed(2) : "";

    if (qs("#actPaidDate")) {
      const today = new Date();
      const yyyy = today.getFullYear();
      const mm = String(today.getMonth() + 1).padStart(2, "0");
      const dd = String(today.getDate()).padStart(2, "0");
      qs("#actPaidDate").value = `${yyyy}-${mm}-${dd}`;
    }

    if (qs("#actMethod")) qs("#actMethod").value = "Cash";
    if (qs("#actRefNo")) qs("#actRefNo").value = "";
    if (qs("#actRemarks")) qs("#actRemarks").value = "";

    bootstrap.Modal.getOrCreateInstance(el).show();
  }

  function openReceiptModal(info) {
    const el = qs("#modalPrintReceipt");
    if (!el || !window.bootstrap) return;

    if (qs("#receiptStudentName")) qs("#receiptStudentName").textContent = info.student_name || "—";
    if (qs("#receiptStudentIdNum")) qs("#receiptStudentIdNum").textContent = info.id_number || "—";
    if (qs("#receiptAmount")) qs("#receiptAmount").textContent = `₱ ${info.amount || "0.00"}`;
    if (qs("#receiptPaidAt")) qs("#receiptPaidAt").textContent = info.paid_at || "—";
    if (qs("#receiptRefNo")) qs("#receiptRefNo").textContent = info.receipt_no || "—";

    if (qs("#receiptClubId")) qs("#receiptClubId").value = String(state.manageOrgId || "");
    if (qs("#receiptPaymentId")) qs("#receiptPaymentId").value = String(info.receipt_id || "");

    bootstrap.Modal.getOrCreateInstance(el).show();
  }

  // -------------------------
  // Bindings
  // -------------------------
  function bindListEvents() {
    const refresh = qs("#clubsBtnRefresh");
    if (refresh && !refresh.__bound) {
      refresh.__bound = true;
      refresh.addEventListener("click", () => loadClubs());
    }

    const back = qs("#clubsBtnBackToList");
    if (back && !back.__bound) {
      back.__bound = true;
      back.addEventListener("click", () => showSection("list"));
    }

    const search = qs("#clubsSearch");
    if (search && !search.__bound) {
      search.__bound = true;
      search.addEventListener("input", () => applyClubsFilter());
    }

    const cat = qs("#clubsCategory");
    if (cat && !cat.__bound) {
      cat.__bound = true;
      cat.addEventListener("change", () => applyClubsFilter());
    }

    const grid = qs("#clubsCardGrid");
    if (grid && !grid.__bound) {
      grid.__bound = true;

      grid.addEventListener("click", (e) => {
        const btn = e.target.closest(".btn-view-club");
        const card = e.target.closest(".club-card");
        const idStr = btn?.dataset?.clubId || card?.dataset?.clubId;
        const id = Number(idStr || 0);
        if (!id) return;
        loadClubDetails(id);
      });
    }
  }

  function bindDetailsEvents() {
    const back = qs("#btnClubBack");
    if (back && !back.__bound) {
      back.__bound = true;
      back.addEventListener("click", () => showSection("list"));
    }

    const btnMyReceipt = qs("#btnClubPrintMyReceipt");
    if (btnMyReceipt && !btnMyReceipt.__bound) {
      btnMyReceipt.__bound = true;
      btnMyReceipt.addEventListener("click", () => {
        const url = String(btnMyReceipt.dataset.url || "");
        if (!url) return safeShowError("No receipt available.");
        openNewTab(url);
      });
    }

    const join = qs("#btnClubJoin");
    if (join && !join.__bound) {
      join.__bound = true;
      join.addEventListener("click", () => {
        // If backend says can_manage, join button should be hidden anyway,
        // but we guard just in case.
        const canManage = isTruthyFlag(state.selectedClub?.can_manage);
        if (canManage) return safeShowError("You have manage access for this club. Join is not applicable.");

        const orgId = Number(qs("#clubsSelectedClubId")?.value || 0);
        const name = qs("#clubName")?.textContent || "—";
        if (!orgId) return;
        openJoinModal(orgId, name);
      });
    }

    const manage = qs("#btnClubManage");
    if (manage && !manage.__bound) {
      manage.__bound = true;
      manage.addEventListener("click", async () => {
        const orgId = Number(qs("#clubsSelectedClubId")?.value || 0);
        if (!orgId) return;

        if (qs("#manageClubId")) qs("#manageClubId").value = String(orgId);

        // officerPosition will be blank for non-officers (super/special/admin/moderator)
        if (qs("#manageClubOfficerRole")) {
          qs("#manageClubOfficerRole").value = String(manage.dataset.officerPosition || "");
        }

        showSection("manage");
        await loadManageAll(orgId);
      });
    }

    const viewMembers = qs("#btnViewClubMembers");
    if (viewMembers && !viewMembers.__bound) {
      viewMembers.__bound = true;
      viewMembers.addEventListener("click", async () => {
        const orgId = Number(qs("#clubsSelectedClubId")?.value || 0);
        if (!orgId) return;
        try {
          await loadClubMembers(orgId);
          const el = qs("#modalClubMembers");
          if (el) bootstrap.Modal.getOrCreateInstance(el).show();
        } catch (err) {
          safeShowError(err?.message || "Failed to load members.");
        }
      });
    }

    const memSearch = qs("#clubMembersSearch");
    if (memSearch && !memSearch.__bound) {
      memSearch.__bound = true;
      memSearch.addEventListener("input", () => {
        state.clubMembers.search = String(memSearch.value || "");
        renderClubMembersModal();
      });
    }
  }

  function bindJoinModal() {
    const btn = qs("#btnConfirmJoinClub");
    if (!btn || btn.__bound) return;
    btn.__bound = true;

    btn.addEventListener("click", async () => {
      const orgId = Number(qs("#joinClubId")?.value || 0);
      if (!orgId) return safeShowError("Missing club id.");

      setBtnLoading(btn, true, ".join-btn-text", ".join-btn-loading");

      try {
        await postJSON({ action: "request_join", org_id: orgId });

        const el = qs("#modalClubJoinConfirm");
        if (el) bootstrap.Modal.getOrCreateInstance(el).hide();

        safeShowSuccess("Join request submitted.");

        await loadClubDetails(orgId);
      } catch (err) {
        safeShowError(err?.message || "Failed to join.");
      } finally {
        setBtnLoading(btn, false, ".join-btn-text", ".join-btn-loading");
      }
    });
  }

  function bindManageEvents() {
    const back = qs("#btnManageBackToDetails");
    if (back && !back.__bound) {
      back.__bound = true;
      back.addEventListener("click", () => showSection("details"));
    }

    const refresh = qs("#btnManageRefresh");
    if (refresh && !refresh.__bound) {
      refresh.__bound = true;
      refresh.addEventListener("click", async () => {
        const orgId = Number(qs("#manageClubId")?.value || 0);
        if (!orgId) return;
        await loadManageAll(orgId);
      });
    }

    const bindPaging = (key, selPageSize, selSearch, selPagination, renderFn) => {
      const pageSize = qs(selPageSize);
      if (pageSize && !pageSize.__bound) {
        pageSize.__bound = true;
        pageSize.addEventListener("change", () => {
          state[key].pageSize = Number(pageSize.value || 10);
          state[key].page = 1;
          renderFn();
        });
      }

      const search = qs(selSearch);
      if (search && !search.__bound) {
        search.__bound = true;
        search.addEventListener("input", () => {
          state[key].search = String(search.value || "");
          state[key].page = 1;
          renderFn();
        });
      }

      const pager = qs(selPagination);
      if (pager && !pager.__bound) {
        pager.__bound = true;
        pager.addEventListener("click", (e) => {
          const b = e.target.closest("[data-page]");
          if (!b) return;

          const p = b.dataset.page;
          const total =
            (key === "pending" ? state.pending.rows : key === "active" ? state.active.rows : state.fees.rows) || [];
          const totalPages = Math.max(1, Math.ceil(total.length / state[key].pageSize));

          if (p === "prev") state[key].page = Math.max(1, state[key].page - 1);
          else if (p === "next") state[key].page = Math.min(totalPages, state[key].page + 1);
          else {
            const num = Number(p || 1);
            if (num >= 1) state[key].page = num;
          }
          renderFn();
        });
      }
    };

    bindPaging("pending", "#pendingPageSize", "#pendingSearch", "#pendingPagination", renderPending);
    bindPaging("active", "#activePageSize", "#activeSearch", "#activePagination", renderActive);
    bindPaging("fees", "#feesPageSize", "#feesSearch", "#feesPagination", renderFees);

    const pendingT = qs("#pendingTbody");
    if (pendingT && !pendingT.__bound) {
      pendingT.__bound = true;
      pendingT.addEventListener("click", (e) => {
        const btn = e.target.closest(".btn-activate-member");
        if (!btn) return;

        openActivateModal({
          membership_id: Number(btn.dataset.membershipId || 0),
          student_user_id: Number(btn.dataset.studentUserId || 0),
          id_number: String(btn.dataset.idNumber || ""),
          student_name: String(btn.dataset.studentName || ""),
        });
      });
    }

    const feesT = qs("#feesTbody");
    if (feesT && !feesT.__bound) {
      feesT.__bound = true;
      feesT.addEventListener("click", (e) => {
        const btn = e.target.closest(".btn-print-receipt");
        if (!btn) return;

        openReceiptModal({
          receipt_id: Number(btn.dataset.receiptId || 0),
          student_name: String(btn.dataset.studentName || ""),
          id_number: String(btn.dataset.idNumber || ""),
          amount: String(btn.dataset.amount || "0.00"),
          paid_at: String(btn.dataset.paidAt || ""),
          receipt_no: String(btn.dataset.receiptNo || ""),
        });
      });
    }

    // Set payment (officers)
    const setPayBtn = qs("#btnSetPayment");
    if (setPayBtn && !setPayBtn.__bound) {
      setPayBtn.__bound = true;
      setPayBtn.addEventListener("click", () => {
        const el = qs("#modalSetPayment");
        if (!el || !window.bootstrap) return safeShowError("Set Payment modal is missing.");

        if (qs("#setPayClubId")) qs("#setPayClubId").value = String(state.manageOrgId || "");
        if (qs("#setPayUserId")) qs("#setPayUserId").value = "";
        if (qs("#setPaySelectedName")) qs("#setPaySelectedName").textContent = "—";
        if (qs("#setPaySelectedMeta")) qs("#setPaySelectedMeta").textContent = "—";

        const club = state.selectedClub?.club || null;
        const { fee } = getClubFeeInfo(club);
        if (qs("#setPayAmount")) qs("#setPayAmount").value = fee > 0 ? fee.toFixed(2) : "";

        if (qs("#setPayDate")) {
          const today = new Date();
          const yyyy = today.getFullYear();
          const mm = String(today.getMonth() + 1).padStart(2, "0");
          const dd = String(today.getDate()).padStart(2, "0");
          qs("#setPayDate").value = `${yyyy}-${mm}-${dd}`;
        }

        if (qs("#setPaySearch")) qs("#setPaySearch").value = "";
        if (qs("#setPayResults")) {
          qs("#setPayResults").innerHTML = `<div class="list-group-item text-muted">Type to search officers...</div>`;
        }

        bootstrap.Modal.getOrCreateInstance(el).show();
      });
    }

    // Print all paid
    const printAll = qs("#btnPrintAllPaid");
    if (printAll && !printAll.__bound) {
      printAll.__bound = true;
      printAll.addEventListener("click", () => {
        const el = qs("#modalPrintAllPaid");
        if (!el || !window.bootstrap) {
          const u = printAll.dataset.printAllUrl || "";
          if (u) openNewTab(u);
          return;
        }

        if (qs("#printAllClubId")) qs("#printAllClubId").value = String(state.manageOrgId || "");
        bootstrap.Modal.getOrCreateInstance(el).show();
      });
    }

    const confirmAll = qs("#btnConfirmPrintAllPaid");
    if (confirmAll && !confirmAll.__bound) {
      confirmAll.__bound = true;
      confirmAll.addEventListener("click", () => {
        const btn = qs("#btnPrintAllPaid");
        const url = btn?.dataset?.printAllUrl || "";
        if (!url) return safeShowError("Print-all URL is missing.");

        const el = qs("#modalPrintAllPaid");
        if (el) bootstrap.Modal.getOrCreateInstance(el).hide();

        openNewTab(url);
      });
    }
  }

  function bindActivateForm() {
    const form = qs("#formActivateMember");
    if (!form || form.__bound) return;
    form.__bound = true;

    form.addEventListener("submit", async (e) => {
      e.preventDefault();

      const btn = qs("#btnConfirmActivate");
      const membershipId = Number(qs("#actRequestId")?.value || 0);
      const amount = String(qs("#actAmount")?.value || "").trim();
      const paidDate = String(qs("#actPaidDate")?.value || "").trim();

      if (!membershipId) return safeShowError("Missing membership id.");
      if (!amount) return safeShowError("Please enter amount.");
      if (!paidDate) return safeShowError("Please select payment date.");

      setBtnLoading(btn, true, ".act-btn-text", ".act-btn-loading");

      try {
        const refNo = String(qs("#actRefNo")?.value || "").trim();

        const data = await postJSON({
          action: "activate_member",
          membership_id: membershipId,
          amount: amount,
          paid_at: paidDate,

          // ✅ make OR/Ref input functional
          receipt_no: refNo,
        });

        const el = qs("#modalActivateMember");
        if (el) bootstrap.Modal.getOrCreateInstance(el).hide();

        safeShowSuccess("Member activated successfully.");

        await loadManageAll(state.manageOrgId);

        if (data.print_receipt_url) openNewTab(data.print_receipt_url);
      } catch (err) {
        safeShowError(err?.message || "Activation failed.");
      } finally {
        setBtnLoading(btn, false, ".act-btn-text", ".act-btn-loading");
      }
    });
  }

  function bindReceiptModal() {
    const btn = qs("#btnConfirmPrintReceipt");
    if (!btn || btn.__bound) return;
    btn.__bound = true;

    btn.addEventListener("click", () => {
      const receiptId = Number(qs("#receiptPaymentId")?.value || 0);
      if (!receiptId) return safeShowError("Missing receipt id.");

      const url = `php/print-membership-receipt.php?receipt_id=${receiptId}`;

      const el = qs("#modalPrintReceipt");
      if (el) bootstrap.Modal.getOrCreateInstance(el).hide();

      openNewTab(url);
    });
  }

  function bindSetPaymentModal() {
    const form = qs("#formSetPayment");
    if (form && !form.__bound) {
      form.__bound = true;

      form.addEventListener("submit", async (e) => {
        e.preventDefault();

        const btn = qs("#btnConfirmSetPayment");
        const orgId = Number(qs("#setPayClubId")?.value || 0);
        const userId = Number(qs("#setPayUserId")?.value || 0);
        const amount = String(qs("#setPayAmount")?.value || "").trim();
        const paidDate = String(qs("#setPayDate")?.value || "").trim();

        if (!orgId) return safeShowError("Missing club id.");
        if (!userId) return safeShowError("Please select an officer first.");
        if (!amount) return safeShowError("Please enter amount.");
        if (!paidDate) return safeShowError("Please select payment date.");

        setBtnLoading(btn, true, ".setpay-btn-text", ".setpay-btn-loading");

        try {
          const data = await postJSON({
            action: "set_payment",
            org_id: orgId,
            user_id: userId,
            amount: amount,
            paid_at: paidDate,
          });

          const el = qs("#modalSetPayment");
          if (el) bootstrap.Modal.getOrCreateInstance(el).hide();

          safeShowSuccess("Payment saved.");

          await loadManageAll(orgId);

          if (data.print_receipt_url) openNewTab(data.print_receipt_url);
        } catch (err) {
          safeShowError(err?.message || "Failed to save payment.");
        } finally {
          setBtnLoading(btn, false, ".setpay-btn-text", ".setpay-btn-loading");
        }
      });
    }

    const input = qs("#setPaySearch");
    const results = qs("#setPayResults");
    if (input && results && !input.__bound) {
      input.__bound = true;

      let t = null;
      input.addEventListener("input", () => {
        if (t) clearTimeout(t);
        t = setTimeout(async () => {
          const q = String(input.value || "").trim();
          if (!q) {
            results.innerHTML = `<div class="list-group-item text-muted">Type to search officers...</div>`;
            return;
          }
          results.innerHTML = `<div class="list-group-item text-muted"><span class="spinner-border spinner-border-sm me-2"></span>Searching...</div>`;

          try {
            const data = await postJSON({
              action: "search_officers",
              org_id: Number(state.manageOrgId || 0),
              q: q,
            });

            const rows = data.rows || [];
            if (!rows.length) {
              results.innerHTML = `<div class="list-group-item text-muted">No officers found.</div>`;
              return;
            }

            results.innerHTML = rows
              .map((r) => {
                const name = normalizeName(r) || r.full_name || "—";
                const meta = `${r.id_number || "—"} • ${r.position || "Officer"}`;
                return `
                  <button type="button" class="list-group-item list-group-item-action setpay-pick"
                    data-user-id="${r.user_id}"
                    data-id-number="${escapeHtml(String(r.id_number || ""))}"
                    data-name="${escapeHtml(String(name))}"
                    data-position="${escapeHtml(String(r.position || ""))}"
                  >
                    <div class="d-flex align-items-center justify-content-between">
                      <div>
                        <div class="fw-semibold">${escapeHtml(name)}</div>
                        <div class="text-muted small">${escapeHtml(meta)}</div>
                      </div>
                      <i class="bi bi-chevron-right text-muted"></i>
                    </div>
                  </button>
                `;
              })
              .join("");
          } catch (err) {
            results.innerHTML = `<div class="list-group-item text-danger">Search failed.</div>`;
            console.error(err);
          }
        }, 250);
      });

      results.addEventListener("click", (e) => {
        const btn = e.target.closest(".setpay-pick");
        if (!btn) return;

        const userId = Number(btn.dataset.userId || 0);
        const name = String(btn.dataset.name || "—");
        const idn = String(btn.dataset.idNumber || "—");
        const pos = String(btn.dataset.position || "");

        if (qs("#setPayUserId")) qs("#setPayUserId").value = String(userId);
        if (qs("#setPaySelectedName")) qs("#setPaySelectedName").textContent = name;
        if (qs("#setPaySelectedMeta")) qs("#setPaySelectedMeta").textContent = `${idn} • ${pos || "Officer"}`;
      });
    }
  }

  // -------------------------
  // Load clubs list
  // -------------------------
  async function loadClubs() {
    try {
      const data = await postJSON({ action: "get_clubs" });
      state.term = data.term || null;
      state.clubs = data.clubs || [];
      fillCategoryFilter();
      applyClubsFilter();
      showSection("list");
    } catch (err) {
      safeShowError(err?.message || "Failed to load clubs.");
    }
  }

  // -------------------------
  // Public init
  // -------------------------
  function init() {
    bindListEvents();
    bindDetailsEvents();
    bindJoinModal();
    bindManageEvents();
    bindActivateForm();
    bindReceiptModal();
    bindSetPaymentModal();

    loadClubs();
  }

  window.Clubs = {
    init,
    _debug: { state, postJSON },
  };
})();
// if (!membership)