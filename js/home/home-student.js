/* js/home-student.js */
/* global bootstrap, showError, Chart */

(function () {
  "use strict";
  if (window.__HomeStudentBooted) return;
  window.__HomeStudentBooted = true;

  const API_URL = "php/home-dashboard-student.php";

  function qs(sel, root = document) { return root.querySelector(sel); }

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
     Calendar (same as admin)
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
     Charts (same as faculty)
     ========================= */
  const chartsByRoot = new WeakMap();
  function getChartsState(root) {
    let st = chartsByRoot.get(root);
    if (!st) { st = { orgChart: null, eventChart: null }; chartsByRoot.set(root, st); }
    return st;
  }
  function destroyCharts(root) {
    const st = chartsByRoot.get(root);
    if (!st) return;
    try { st.orgChart?.destroy?.(); } catch (e) {}
    try { st.eventChart?.destroy?.(); } catch (e) {}
    st.orgChart = null;
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
          label: "Total Org Fees",
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
        scales: { y: { beginAtZero: true } }
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
        scales: { y: { beginAtZero: true } }
      }
    });
  }

  /* =========================
     Lists
     ========================= */
  function renderPaidList(root, paid) {
    const el = qs("#paidOrgList", root);
    if (!el) return;

    if (!Array.isArray(paid) || paid.length === 0) {
      el.innerHTML = `<li class="list-group-item text-muted">No paid organization fees yet.</li>`;
      return;
    }

    el.innerHTML = paid.map((p) => {
      const meta = [p.org_type, p.scope].filter(Boolean).join(" • ") || "—";
      return `
        <li class="list-group-item">
          <div class="d-flex justify-content-between align-items-start">
            <div class="me-2">
              <div class="fw-semibold">${esc(p.org_name)}${p.abbreviation ? ` (${esc(p.abbreviation)})` : ""}</div>
              <div class="small text-muted">${esc(meta)}</div>
              <div class="small text-muted">Receipt: ${esc(p.receipt_no || "—")}</div>
            </div>
            <div class="text-end">
              <div class="fw-semibold">${esc(peso(p.amount))}</div>
              <span class="badge bg-success">Paid</span>
            </div>
          </div>
        </li>
      `;
    }).join("");
  }

  function renderUnpaidList(root, unpaid) {
    const el = qs("#unpaidOrgList", root);
    if (!el) return;

    if (!Array.isArray(unpaid) || unpaid.length === 0) {
      el.innerHTML = `<li class="list-group-item text-muted">No unpaid organization fees. You're good.</li>`;
      return;
    }

    el.innerHTML = unpaid.map((u) => {
      const meta = [u.org_type, u.scope].filter(Boolean).join(" • ") || "—";
      return `
        <li class="list-group-item">
          <div class="d-flex justify-content-between align-items-start">
            <div class="me-2">
              <div class="fw-semibold">${esc(u.org_name)}${u.abbreviation ? ` (${esc(u.abbreviation)})` : ""}</div>
              <div class="small text-muted">${esc(meta)}</div>
            </div>
            <div class="text-end">
              <div class="fw-semibold">${esc(peso(u.fee_required))}</div>
              <span class="badge bg-danger">Unpaid</span>
            </div>
          </div>
        </li>
      `;
    }).join("");
  }

  function renderClubs(root, clubs) {
    const el = qs("#clubsList", root);
    if (!el) return;

    if (!Array.isArray(clubs) || clubs.length === 0) {
      el.innerHTML = `<li class="list-group-item text-muted">You haven't joined any clubs yet.</li>`;
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
            <div class="fw-semibold">${esc(c.org_name)}${c.abbreviation ? ` (${esc(c.abbreviation)})` : ""}</div>
            <div class="small text-muted">Requested: ${esc(c.requested_at || "—")}</div>
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
     Fill UI (same format rules)
     ========================= */
  function fillUI(root, data) {
    const user = data.user || {};
    const isOfficer = !!data.is_officer;

    // Welcome + date (same as admin)
    const welcomeUsername = qs("#welcomeUsername", root);
    const welcomeToday = qs("#welcomeToday", root);
    if (welcomeUsername) welcomeUsername.textContent = user.name || "Student";
    if (welcomeToday) welcomeToday.textContent = formatTodayLong(new Date());

    // Officer-only blocks
    const handledWrap = qs("#handledOrgWrap", root);
    const kpiRow = qs("#kpiRow", root);
    const chartsRow = qs("#chartsRow", root);

    if (!isOfficer) {
      // ✅ hide handled/kpi/charts if non-officer student
      handledWrap?.classList.add("d-none");
      kpiRow?.classList.add("d-none");
      chartsRow?.classList.add("d-none");
      destroyCharts(root);
    } else {
      handledWrap?.classList.remove("d-none");
      kpiRow?.classList.remove("d-none");
      chartsRow?.classList.remove("d-none");

      // Handled org (same ids as admin)
      const org = data.organization || null;
      const handledOrgName = qs("#handledOrgName", root);
      const handledOrgScope = qs("#handledOrgScope", root);

      if (!org) {
        if (handledOrgName) handledOrgName.textContent = "No organization assigned";
        if (handledOrgScope) handledOrgScope.textContent = "—";
      } else {
        if (handledOrgName) handledOrgName.textContent = org.org_name || "—";
        if (handledOrgScope) {
          const parts = [];
          if (org.org_type) parts.push(org.org_type);
          if (org.scope) parts.push(org.scope);
          if (org.abbreviation) parts.push(`(${org.abbreviation})`);
          handledOrgScope.textContent = parts.join(" • ") || "—";
        }
      }

      // KPIs
      const kpis = data.kpis || {};
      const elOrgFees = qs("#kpiOrgFeesTotal", root);
      const elCredits = qs("#kpiEventCredits", root);
      const elDebits = qs("#kpiEventDebits", root);

      if (elOrgFees) elOrgFees.textContent = peso(kpis.org_fees_total);
      if (elCredits) elCredits.textContent = peso(kpis.event_credits);
      if (elDebits) elDebits.textContent = peso(kpis.event_debits);

      // Charts
      const ch = data.charts || {};
      renderOrgFeesChart(root, ch?.org_fees?.labels || [], ch?.org_fees?.values || []);
      renderEventFundsChart(root, ch?.event_funds?.labels || [], ch?.event_funds?.credits || [], ch?.event_funds?.debits || []);
    }

    // Student things (always visible)
    renderUnpaidList(root, data.org_fees_unpaid || []);
    renderPaidList(root, data.org_fees_paid || []);
    renderClubs(root, data.clubs_joined || []);
  }

  async function init(root) {
    const container = (root && root.querySelector) ? root : document;
    try {
      buildCalendar(container, new Date());
      destroyCharts(container); // fresh load

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