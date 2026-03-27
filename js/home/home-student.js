/* js/home-student.js */
/* global bootstrap, showError, Chart */

(function () {
  "use strict";
  if (window.__HomeStudentBooted) return;
  window.__HomeStudentBooted = true;

  const API_URL = "php/home-dashboard-student.php";

  function qs(sel, root = document) { return root.querySelector(sel); }
  function qsa(sel, root = document) { return Array.from(root.querySelectorAll(sel)); }

  function safeShowError(msg) {
    if (typeof window.showError === "function") return window.showError(msg);
    alert(msg || "Something went wrong.");
  }

  function esc(s) {
    return String(s ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function peso(n) {
    const num = Number(n || 0);
    return "₱" + num.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function vividColor(i, lightness = 58) {
    const hue = (Number(i || 0) * 137.508) % 360;
    return `hsl(${hue}, 95%, ${lightness}%)`;
  }

  // Format semester label
  function semesterLabel(sem) {
    if (sem === "1st") return "1st Semester";
    if (sem === "2nd") return "2nd Semester";
    if (sem === "Summer") return "Summer";
    return String(sem || "—");
  }

  async function getJSON() {
    const res = await fetch(API_URL, {
      method: "GET",
      headers: { "Accept": "application/json" },
      cache: "no-store",
      credentials: "same-origin"
    });

    const text = await res.text();
    let data;
    try { data = JSON.parse(text); }
    catch (e) { throw new Error("Invalid JSON from server: " + text.slice(0, 200)); }

    if (!res.ok || !data?.success) throw new Error(data?.message || ("HTTP " + res.status));
    return data;
  }

  function formatTodayLong(d = new Date()) {
    return d.toLocaleDateString(undefined, { weekday: "long", year: "numeric", month: "long", day: "numeric" });
  }

  /* =========================
     Calendar
     ========================= */
  function buildCalendar(root, date = new Date()) {
    const body = qs("#dashboardCalendarBody", root);
    const monthLabel = qs("#calendarMonthLabel", root);
    const todayLabel = qs("#calendarTodayLabel", root);
    if (!body) return;

    const year = date.getFullYear();
    const month = date.getMonth();

    const first = new Date(year, month, 1);
    const last = new Date(year, month + 1, 0);
    const startDow = first.getDay(); // 0=Sun
    const daysInMonth = last.getDate();

    if (monthLabel) monthLabel.textContent = first.toLocaleDateString(undefined, { month: "long", year: "numeric" });
    if (todayLabel) todayLabel.textContent = formatTodayLong(new Date());

    body.innerHTML = "";

    let day = 1;
    const now = new Date();

    for (let r = 0; r < 6; r++) {
      const tr = document.createElement("tr");

      for (let c = 0; c < 7; c++) {
        const td = document.createElement("td");
        const span = document.createElement("span");

        const cellIndex = r * 7 + c;

        if (cellIndex < startDow || day > daysInMonth) {
          span.textContent = "";
        } else {
          span.textContent = String(day);

          const isToday =
            day === now.getDate() &&
            month === now.getMonth() &&
            year === now.getFullYear();

          if (isToday) td.classList.add("calendar-today");
          day++;
        }

        td.appendChild(span);
        tr.appendChild(td);
      }

      body.appendChild(tr);
      if (day > daysInMonth) break;
    }
  }

  /* =========================
     Charts
     ========================= */
  const chartsByRoot = new WeakMap();
  function getChartsState(root) {
    let st = chartsByRoot.get(root);
    if (!st) { st = { orgChart: null, clubChart: null, eventChart: null }; chartsByRoot.set(root, st); }
    return st;
  }
  function destroyCharts(root) {
    const st = chartsByRoot.get(root);
    if (!st) return;
    try { st.orgChart?.destroy?.(); } catch (e) {}
    try { st.clubChart?.destroy?.(); } catch (e) {}
    try { st.eventChart?.destroy?.(); } catch (e) {}
    st.orgChart = null;
    st.clubChart = null;
    st.eventChart = null;
  }

  function renderOrgFeesChart(root, labels, values) {
    const canvas = qs("#orgFeesChart", root);
    if (!canvas || typeof Chart === "undefined") return;

    const st = getChartsState(root);
    if (st.orgChart) { st.orgChart.destroy(); st.orgChart = null; }

    st.orgChart = new Chart(canvas.getContext("2d"), {
      type: "bar",
      data: {
        labels: Array.isArray(labels) ? labels : [],
        datasets: [{
          label: "Organization Fees Collected",
          data: Array.isArray(values) ? values : [],
          backgroundColor: (ctx) => vividColor(ctx.dataIndex, 60),
          borderColor: (ctx) => vividColor(ctx.dataIndex, 42),
          borderWidth: 1,
          borderRadius: 6
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: { y: { beginAtZero: true, ticks: { callback: (v) => '₱' + v } } }
      }
    });
  }

  function renderClubFeesChart(root, labels, values) {
    const canvas = qs("#clubFeesChart", root);
    if (!canvas || typeof Chart === "undefined") return;

    const st = getChartsState(root);
    if (st.clubChart) { st.clubChart.destroy(); st.clubChart = null; }

    st.clubChart = new Chart(canvas.getContext("2d"), {
      type: "bar",
      data: {
        labels: Array.isArray(labels) ? labels : [],
        datasets: [{
          label: "Club Membership Fees Collected",
          data: Array.isArray(values) ? values : [],
          backgroundColor: (ctx) => vividColor(ctx.dataIndex + 20, 55),
          borderColor: (ctx) => vividColor(ctx.dataIndex + 20, 40),
          borderWidth: 1,
          borderRadius: 6
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: { y: { beginAtZero: true, ticks: { callback: (v) => '₱' + v } } }
      }
    });
  }

  function renderEventFundsChart(root, labels, credits, debits) {
    const canvas = qs("#eventFundsChart", root);
    if (!canvas || typeof Chart === "undefined") return;

    const st = getChartsState(root);
    if (st.eventChart) { st.eventChart.destroy(); st.eventChart = null; }

    st.eventChart = new Chart(canvas.getContext("2d"), {
      type: "bar",
      data: {
        labels: Array.isArray(labels) ? labels : [],
        datasets: [
          {
            label: "Credits",
            data: Array.isArray(credits) ? credits : [],
            backgroundColor: (ctx) => vividColor(ctx.dataIndex, 60),
            borderColor: (ctx) => vividColor(ctx.dataIndex, 42),
            borderWidth: 1,
            borderRadius: 6
          },
          {
            label: "Expenses",
            data: Array.isArray(debits) ? debits : [],
            backgroundColor: (ctx) => vividColor(ctx.dataIndex + 30, 48),
            borderColor: (ctx) => vividColor(ctx.dataIndex + 30, 36),
            borderWidth: 1,
            borderRadius: 6
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { position: "bottom" } },
        scales: { y: { beginAtZero: true, ticks: { callback: (v) => '₱' + v } } }
      }
    });
  }

  /* =========================
     Lists - with count badges and role display
     ========================= */
  function renderOrganizationsList(root, organizations, counts) {
    const container = qs("#organizationsList", root);
    const countBadge = qs("#orgCountBadge", root);
    
    if (!container) return;

    if (countBadge) countBadge.textContent = counts?.organizations || 0;

    if (!Array.isArray(organizations) || organizations.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <i class="bi bi-building-slash"></i>
          <p>You are not handling any organizations.</p>
        </div>`;
      return;
    }

    container.innerHTML = organizations.map((org) => {
      const typeClass = org.org_type === 'Organization' ? 'type-organization' : 'type-club';
      const typeIcon = org.org_type === 'Organization' ? 'bi-building' : 'bi-trophy';
      const scopeClass = org.scope === 'Exclusive' ? 'scope-exclusive' : 'scope-general';
      const statusClass = org.status === 'Active' ? 'status-active' : 'status-inactive';
      const fee = org.org_type === 'Organization' ? org.fee_required : org.membership_fee;
      const feeLabel = org.org_type === 'Organization' ? 'Org Fee' : 'Membership';
      
      // Display the user's role/position for this organization
      const userRole = org.user_role || 'Officer';

      return `
        <div class="handled-org-item">
          <span class="handled-org-type ${typeClass}">
            <i class="bi ${typeIcon} me-1"></i> ${org.org_type}
          </span>
          
          <div class="handled-org-name">
            ${esc(org.org_name)}
            ${org.abbreviation ? `<span class="handled-org-abbr">${esc(org.abbreviation)}</span>` : ''}
          </div>
          
          <span class="handled-org-role">
            <i class="bi bi-person-badge me-1"></i>
            ${esc(userRole)}
          </span>
          
          <span class="handled-org-scope ${scopeClass}">
            <i class="bi ${org.scope === 'Exclusive' ? 'bi-lock' : 'bi-globe'} me-1"></i>
            ${org.scope || 'General'}
          </span>
          
          <div class="handled-org-stats">
            <div class="handled-org-fee">
              <span class="fee-label">${feeLabel}</span>
              <span class="fee-value">${peso(fee)}</span>
            </div>
            <div class="handled-org-status">
              <span class="status-badge ${statusClass}"></span>
              <span class="small">${org.status || 'Active'}</span>
            </div>
          </div>
        </div>
      `;
    }).join("");
  }

  function renderPaidList(root, paid, type = 'org') {
    const el = type === 'org' ? qs("#paidOrgList", root) : qs("#paidClubList", root);
    const countEl = type === 'org' ? qs("#paidOrgCount", root) : qs("#paidClubCount", root);
    
    if (!el) return;

    if (countEl) countEl.textContent = paid?.length || 0;

    if (!Array.isArray(paid) || paid.length === 0) {
      el.innerHTML = `<li class="list-group-item text-muted"><i class="bi bi-check-circle me-2"></i>No paid ${type === 'org' ? 'organization' : 'club'} fees yet.</li>`;
      return;
    }

    el.innerHTML = paid.map((p) => {
      const meta = [p.org_type, p.scope].filter(Boolean).join(" • ") || "—";
      return `
        <li class="list-group-item">
          <div class="d-flex justify-content-between align-items-start">
            <div class="me-2">
              <div class="fw-semibold">
                <i class="bi ${p.org_type === 'Organization' ? 'bi-building' : 'bi-trophy'} me-1 text-success"></i>
                ${esc(p.org_name)}${p.abbreviation ? ` (${esc(p.abbreviation)})` : ""}
              </div>
              <div class="small text-muted">${esc(meta)}</div>
              <div class="small text-muted">
                <i class="bi bi-receipt me-1"></i> Receipt: ${esc(p.receipt_no || "—")}
              </div>
            </div>
            <div class="text-end">
              <div class="fw-semibold text-success">${esc(peso(p.amount))}</div>
              <span class="badge bg-success">Paid</span>
              <div class="small text-muted mt-1">${p.paid_at ? new Date(p.paid_at).toLocaleDateString() : ''}</div>
            </div>
          </div>
        </li>
      `;
    }).join("");
  }

  function renderUnpaidList(root, unpaid, type = 'org') {
    const el = type === 'org' ? qs("#unpaidOrgList", root) : qs("#unpaidClubList", root);
    const countEl = type === 'org' ? qs("#unpaidOrgCount", root) : qs("#unpaidClubCount", root);
    
    if (!el) return;

    if (countEl) countEl.textContent = unpaid?.length || 0;

    if (!Array.isArray(unpaid) || unpaid.length === 0) {
      el.innerHTML = `<li class="list-group-item text-muted"><i class="bi bi-check-circle me-2 text-success"></i>No unpaid ${type === 'org' ? 'organization' : 'club'} fees.</li>`;
      return;
    }

    el.innerHTML = unpaid.map((u) => {
      const meta = [u.org_type, u.scope].filter(Boolean).join(" • ") || "—";
      return `
        <li class="list-group-item">
          <div class="d-flex justify-content-between align-items-start">
            <div class="me-2">
              <div class="fw-semibold">
                <i class="bi ${u.org_type === 'Organization' ? 'bi-building' : 'bi-trophy'} me-1 text-danger"></i>
                ${esc(u.org_name)}${u.abbreviation ? ` (${esc(u.abbreviation)})` : ""}
              </div>
              <div class="small text-muted">${esc(meta)}</div>
            </div>
            <div class="text-end">
              <div class="fw-semibold text-danger">${esc(peso(u.fee_required))}</div>
              <span class="badge bg-danger">Unpaid</span>
            </div>
          </div>
        </li>
      `;
    }).join("");
  }

  function renderClubs(root, clubs) {
    const el = qs("#clubsList", root);
    const countEl = qs("#clubsCount", root);
    
    if (!el) return;

    if (countEl) countEl.textContent = clubs?.length || 0;

    if (!Array.isArray(clubs) || clubs.length === 0) {
      el.innerHTML = `<li class="list-group-item text-muted"><i class="bi bi-people me-2"></i>You haven't joined any clubs yet.</li>`;
      return;
    }

    el.innerHTML = clubs.map((c) => {
      const statusBadge =
        c.status === "Approved"
          ? `<span class="badge bg-success">Joined</span>`
          : `<span class="badge bg-warning text-dark">Pending</span>`;

      const feeBadge = Number(c.fee_amount || 0) > 0
        ? (c.fee_paid ? `<span class="badge bg-success">Fee Paid</span>` : `<span class="badge bg-danger">Fee Unpaid</span>`)
        : `<span class="badge bg-secondary">No Fee</span>`;

      return `
        <li class="list-group-item d-flex justify-content-between align-items-start">
          <div class="me-2">
            <div class="fw-semibold">
              <i class="bi bi-trophy me-1 text-warning"></i>
              ${esc(c.org_name)}${c.abbreviation ? ` (${esc(c.abbreviation)})` : ""}
            </div>
            <div class="small text-muted">
              <i class="bi bi-clock me-1"></i> Requested: ${esc(c.requested_at ? new Date(c.requested_at).toLocaleDateString() : "—")}
            </div>
          </div>
          <div class="text-end">
            <div class="mb-1">${statusBadge}</div>
            <div>${feeBadge}</div>
          </div>
        </li>
      `;
    }).join("");
  }

  /* =========================
     Fill UI - Show user role for each organization
     ========================= */
  function fillUI(root, data) {
    const user = data.user || {};
    const isOfficer = !!data.is_officer; // This comes from PHP
    const counts = data.counts || {};
    const term = data.term || null;

    // Academic Year display
    const displayAcademicYear = qs("#displayAcademicYear", root);
    const displaySemesterLabel = qs("#displaySemesterLabel", root);

    if (!term) {
      if (displayAcademicYear) displayAcademicYear.textContent = "—";
      if (displaySemesterLabel) displaySemesterLabel.textContent = "No active term";
    } else {
      if (displayAcademicYear) displayAcademicYear.textContent = term.school_year || "—";
      if (displaySemesterLabel) displaySemesterLabel.textContent = semesterLabel(term.semester);
    }

    // Welcome + date
    const welcomeUsername = qs("#welcomeUsername", root);
    const welcomeToday = qs("#welcomeToday", root);
    if (welcomeUsername) welcomeUsername.textContent = user.name || "Student";
    if (welcomeToday) welcomeToday.textContent = formatTodayLong(new Date());

    // Officer-only blocks - ONLY show if user is an officer
    const officerWrap = qs("#officerWrap", root);
    const kpiRow = qs("#kpiRow", root);
    const chartsRow = qs("#chartsRow", root);

    if (!isOfficer) {
      // Hide officer sections for regular students
      officerWrap?.classList.add("d-none");
      kpiRow?.classList.add("d-none");
      chartsRow?.classList.add("d-none");
      destroyCharts(root);
    } else {
      // Show officer sections for officers
      officerWrap?.classList.remove("d-none");
      kpiRow?.classList.remove("d-none");
      chartsRow?.classList.remove("d-none");

      // Organizations list with counts and roles
      renderOrganizationsList(root, data.organizations || [], counts);

      // KPIs
      const kpis = data.kpis || {};
      const elOrgFees = qs("#kpiOrgFeesTotal", root);
      const elClubFees = qs("#kpiClubFeesTotal", root);
      const elCredits = qs("#kpiEventCredits", root);
      const elDebits = qs("#kpiEventDebits", root);

      if (elOrgFees) elOrgFees.textContent = peso(kpis.org_fees_total);
      if (elClubFees) elClubFees.textContent = peso(kpis.club_fees_total);
      if (elCredits) elCredits.textContent = peso(kpis.event_credits);
      if (elDebits) elDebits.textContent = peso(kpis.event_debits);

      // Charts
      const ch = data.charts || {};
      renderOrgFeesChart(root, ch?.org_fees?.labels || [], ch?.org_fees?.values || []);
      renderClubFeesChart(root, ch?.club_fees?.labels || [], ch?.club_fees?.values || []);
      renderEventFundsChart(root, ch?.event_funds?.labels || [], ch?.event_funds?.credits || [], ch?.event_funds?.debits || []);
    }

    // Student things (always visible for everyone) - with counts
    renderUnpaidList(root, data.org_fees_unpaid || [], 'org');
    renderPaidList(root, data.org_fees_paid || [], 'org');
    renderUnpaidList(root, data.club_fees_unpaid || [], 'club');
    renderPaidList(root, data.club_fees_paid || [], 'club');
    renderClubs(root, data.clubs_joined || []);
  }

  async function init(root) {
    const container = (root && root.querySelector) ? root : document;
    try {
      buildCalendar(container, new Date());
      destroyCharts(container);

      const data = await getJSON();
      fillUI(container, data);
    } catch (err) {
      console.error("[HomeStudent] init error:", err);
      safeShowError(err?.message || "Failed to load student home dashboard.");
    }
  }

  window.HomeStudent = { init };

  // Optional auto-init if directly loaded
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      const hasDom = document.querySelector("#homePage");
      if (hasDom) init(document);
    });
  } else {
    const hasDom = document.querySelector("#homePage");
    if (hasDom) init(document);
  }
})();