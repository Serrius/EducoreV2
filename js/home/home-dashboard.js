/* js/home.js */
/* global showError, showSuccess, Chart */

(function () {
  "use strict";

  // Boot once: define module only once (SPA safe)
  if (window.__HomeBooted) return;
  window.__HomeBooted = true;

  const API_URL = "php/home-dashboard.php";

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
  // Golden angle gives well-spaced colors without needing total count
  const hue = (Number(i || 0) * 137.508) % 360;
  return `hsl(${hue}, 95%, ${lightness}%)`;
  }

  function brightHsl(i, total, lightness = 55) {
    const t = Math.max(1, Number(total) || 1);
    const idx = Number(i) || 0;

    // spread hues evenly for distinct colors
    const hue = Math.round((idx * 360) / t);

    return `hsl(${hue}, 92%, ${lightness}%)`;
  }

  function asArray(x) {
    // Make sure labels/values are real arrays
    if (Array.isArray(x)) return x;
    if (x == null) return [];
    // If server accidentally sends string like "a,b,c"
    if (typeof x === "string") return x.split(",").map(s => s.trim()).filter(Boolean);
    return [];
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

    if (!res.ok || !data?.success) {
      throw new Error(data?.message || ("HTTP " + res.status));
    }
    return data;
  }

  function formatTodayLong(d = new Date()) {
    return d.toLocaleDateString(undefined, { weekday: "long", year: "numeric", month: "long", day: "numeric" });
  }

  function semesterLabel(sem) {
    if (sem === "1st") return "1st Semester";
    if (sem === "2nd") return "2nd Semester";
    if (sem === "Summer") return "Summer";
    return String(sem || "—");
  }

  function buildCalendar(root, date = new Date()) {
    const body = qs("#dashboardCalendarBody", root);
    const monthLabel = qs("#calendarMonthLabel", root);
    const todayLabel = qs("#calendarTodayLabel", root);
    if (!body) return; // home DOM not present yet

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

  // Charts per root (so SPA re-entry won't conflict)
  const chartsByRoot = new WeakMap();

  function getChartsState(root) {
    let st = chartsByRoot.get(root);
    if (!st) {
      st = { orgChart: null, eventChart: null };
      chartsByRoot.set(root, st);
    }
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
  if (!canvas) return;
  if (typeof Chart === "undefined") return;

  const st = getChartsState(root);
  if (st.orgChart) { st.orgChart.destroy(); st.orgChart = null; }

  st.orgChart = new Chart(canvas.getContext("2d"), {
    type: "bar",
    data: {
      labels: Array.isArray(labels) ? labels : [],
      datasets: [{
        label: "Total Org Fees",
        data: Array.isArray(values) ? values : [],
        backgroundColor: (ctx) => vividColor(ctx.dataIndex, 60), // ✅ different per bar
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
  if (!canvas) return;
  if (typeof Chart === "undefined") return;

  const st = getChartsState(root);
  if (st.eventChart) { st.eventChart.destroy(); st.eventChart = null; }

  const L = Array.isArray(labels) ? labels : [];
  const C = Array.isArray(credits) ? credits : [];
  const D = Array.isArray(debits) ? debits : [];

  st.eventChart = new Chart(canvas.getContext("2d"), {
    type: "bar",
    data: {
      labels: L,
      datasets: [
        {
          label: "Credits",
          data: C,
          backgroundColor: (ctx) => vividColor(ctx.dataIndex, 60),
          borderColor: (ctx) => vividColor(ctx.dataIndex, 42),
          borderWidth: 1,
          borderRadius: 6
        },
        {
          label: "Expenses",
          data: D,
          // ✅ shift hue +30 so each expense bar is different from credit bar
          backgroundColor: (ctx) => {
            const hueShiftedIndex = ctx.dataIndex + 30;
            return vividColor(hueShiftedIndex, 48);
          },
          borderColor: (ctx) => {
            const hueShiftedIndex = ctx.dataIndex + 30;
            return vividColor(hueShiftedIndex, 36);
          },
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

  function renderTopEvents(root, list) {
    const ul = qs("#dashboardTopEvents", root);
    const note = qs("#dashboardTopEventsNote", root);
    if (!ul) return;

    ul.innerHTML = "";

    if (!Array.isArray(list) || list.length === 0) {
      ul.innerHTML = `<li class="list-group-item text-muted">No event fund data yet.</li>`;
      if (note) note.textContent = "Data based on event credits and debits for the current academic year.";
      return;
    }

    for (const e of list) {
      const li = document.createElement("li");
      li.className = "list-group-item d-flex justify-content-between align-items-center";
      li.innerHTML = `
        <div class="me-2">
          <div class="fw-semibold">${esc(e.title)}</div>
          <div class="text-muted small">Credits: ${peso(e.credits)} • Expenses: ${peso(e.debits)}</div>
        </div>
        <span class="badge bg-secondary">${peso((Number(e.credits) || 0) + (Number(e.debits) || 0))}</span>
      `;
      ul.appendChild(li);
    }

    if (note) note.textContent = "Top events shown by total movement (credits + expenses).";
  }

  function fillUI(root, data) {
    const user = data.user || {};
    const term = data.term || null;

    // Welcome + date
    const welcomeUsername = qs("#welcomeUsername", root);
    const welcomeToday = qs("#welcomeToday", root);
    if (welcomeUsername) welcomeUsername.textContent = user.name || "User";
    if (welcomeToday) welcomeToday.textContent = formatTodayLong(new Date());

    // Term display
    const displayAcademicYear = qs("#displayAcademicYear", root);
    const displayActiveYear = qs("#displayActiveYear", root);
    const displaySemesterLabel = qs("#displaySemesterLabel", root);

    if (!term) {
      if (displayAcademicYear) displayAcademicYear.textContent = "—";
      if (displayActiveYear) displayActiveYear.textContent = "—";
      if (displaySemesterLabel) displaySemesterLabel.textContent = "No active term";
    } else {
      if (displayAcademicYear) displayAcademicYear.textContent = term.school_year || "—";

      // Your PHP returns start_year/end_year (and maybe active_year in other builds)
      const ay = (term.start_year ?? term.active_year ?? null);
      if (displayActiveYear) displayActiveYear.textContent = (ay == null ? "—" : String(ay));

      if (displaySemesterLabel) displaySemesterLabel.textContent = semesterLabel(term.semester);
    }

    // KPIs
    const kpis = data.kpis || {};
    const elActiveOrgs = qs("#kpiActiveOrgs", root);
    const elOrgFees = qs("#kpiOrgFeesTotal", root);
    const elCredits = qs("#kpiEventCredits", root);
    const elDebits = qs("#kpiEventDebits", root);

    if (elActiveOrgs) elActiveOrgs.textContent = String(kpis.active_orgs ?? 0);
    if (elOrgFees) elOrgFees.textContent = peso(kpis.org_fees_total);
    if (elCredits) elCredits.textContent = peso(kpis.event_credits);
    if (elDebits) elDebits.textContent = peso(kpis.event_debits);

    // Subtitles
    const orgChartSubtitle = qs("#orgChartSubtitle", root);
    const eventChartSubtitle = qs("#eventChartSubtitle", root);
    if (term) {
      if (orgChartSubtitle) orgChartSubtitle.textContent = `${term.school_year} • ${semesterLabel(term.semester)}`;
      if (eventChartSubtitle) eventChartSubtitle.textContent = "Credits vs Expenses";
    }

    // Charts + list
    const ch = data.charts || {};
    const orgFees = ch.org_fees || {};
    const eventFunds = ch.event_funds || {};

    renderOrgFeesChart(root, orgFees.labels || [], orgFees.values || []);
    renderEventFundsChart(root, eventFunds.labels || [], eventFunds.credits || [], eventFunds.debits || []);
    renderTopEvents(root, data.top_events || []);
  }

  /**
   * SPA entry point:
   * Call init(contentArea) AFTER injecting home HTML
   */
  async function init(root) {
    // Normalize root
    const container = (root && root.querySelector) ? root : document;

    // If home DOM isn't in this container, try fallback to document (common router pattern)
    const hasHomeDom =
      !!qs("#dashboardCalendarBody", container) ||
      !!qs("#orgFeesChart", container) ||
      !!qs("#eventFundsChart", container);

    const realRoot = hasHomeDom ? container : document;

    try {
      // Rebuild calendar every time home opens
      buildCalendar(realRoot, new Date());

      // Refresh charts on every entry
      destroyCharts(realRoot);

      const data = await getJSON();
      fillUI(realRoot, data);
    } catch (err) {
      console.error("[Home] init error:", err);
      safeShowError(err?.message || "Failed to load home dashboard.");
    }
  }

  function destroy(root) {
    const container = (root && root.querySelector) ? root : document;
    destroyCharts(container);
  }

  // ✅ Expose BOTH names so your router won't break
  window.Home = { init, destroy };
  window.HomeDashboard = window.Home;

  // ✅ Optional: auto-init if page is directly loaded with home DOM already present
  // (won't harm SPA because it only runs if elements exist)
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      const hasHomeDom =
        document.querySelector("#dashboardCalendarBody") ||
        document.querySelector("#orgFeesChart") ||
        document.querySelector("#eventFundsChart");
      if (hasHomeDom) init(document);
    });
  } else {
    const hasHomeDom =
      document.querySelector("#dashboardCalendarBody") ||
      document.querySelector("#orgFeesChart") ||
      document.querySelector("#eventFundsChart");
    if (hasHomeDom) init(document);
  }
})();
//renderOrgFeesChart