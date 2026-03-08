/* js/home-faculty.js */
/* global showError, Chart */

(function () {
  "use strict";
  if (window.__HomeFacultyBooted) return;
  window.__HomeFacultyBooted = true;

  const API_URL = "php/home-dashboard-faculty.php";

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
     Calendar (same as super-admin)
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

  function fillUI(root, data) {
    const user = data.user || {};
    const org = data.organization || null;
    const kpis = data.kpis || {};
    const ch = data.charts || {};

    // Welcome + date
    const welcomeUsername = qs("#welcomeUsername", root);
    const welcomeToday = qs("#welcomeToday", root);
    if (welcomeUsername) welcomeUsername.textContent = user.name || "Faculty Admin";
    if (welcomeToday) welcomeToday.textContent = formatTodayLong(new Date());

    // Handled org UI
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
    const elOrgFees = qs("#kpiOrgFeesTotal", root);
    const elCredits = qs("#kpiEventCredits", root);
    const elDebits = qs("#kpiEventDebits", root);

    if (elOrgFees) elOrgFees.textContent = peso(kpis.org_fees_total);
    if (elCredits) elCredits.textContent = peso(kpis.event_credits);
    if (elDebits) elDebits.textContent = peso(kpis.event_debits);

    // Charts
    renderOrgFeesChart(root, ch?.org_fees?.labels || [], ch?.org_fees?.values || []);
    renderEventFundsChart(root, ch?.event_funds?.labels || [], ch?.event_funds?.credits || [], ch?.event_funds?.debits || []);
  }

  async function init(root) {
    const container = (root && root.querySelector) ? root : document;
    try {
      // ✅ calendar back
      buildCalendar(container, new Date());

      // refresh charts
      destroyCharts(container);

      const data = await getJSON();
      fillUI(container, data);
    } catch (err) {
      console.error("[HomeFaculty] init error:", err);
      safeShowError(err?.message || "Failed to load faculty home dashboard.");
    }
  }

  function destroy(root) {
    const container = (root && root.querySelector) ? root : document;
    destroyCharts(container);
  }

  window.HomeFaculty = { init, destroy };

  // Optional auto-init if directly loaded (won't harm SPA)
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      const hasDom =
        document.querySelector("#dashboardCalendarBody") ||
        document.querySelector("#orgFeesChart") ||
        document.querySelector("#eventFundsChart");
      if (hasDom) init(document);
    });
  } else {
    const hasDom =
      document.querySelector("#dashboardCalendarBody") ||
      document.querySelector("#orgFeesChart") ||
      document.querySelector("#eventFundsChart");
    if (hasDom) init(document);
  }
})();