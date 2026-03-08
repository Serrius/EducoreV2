/* js/notifications/notifications-core.js */
/* global bootstrap */

(function () {
  "use strict";
  if (window.__NotificationsCoreBooted) return;
  window.__NotificationsCoreBooted = true;

  // ---------- DOM ----------
  const bellButton = document.getElementById("bellButton");
  const bellIcon = document.getElementById("bellIcon");
  const panel = document.getElementById("notifPanel");
  const overlay = document.getElementById("notifOverlay");
  const closeBtn = document.getElementById("notifCloseBtn");
  const list = document.getElementById("notifList");
  const notifDot = document.getElementById("notifDot");

  const detailModalEl = document.getElementById("notifDetailModal");
  const detailTitleEl = document.getElementById("notifDetailTitle");
  const detailBodyEl = document.getElementById("notifDetailBody");
  const detailMetaEl = document.getElementById("notifDetailMeta");
  const detailActionBtn = document.getElementById("notifDetailActionBtn");

  const missingRequired = [];
  if (!bellButton) missingRequired.push("#bellButton");
  if (!bellIcon) missingRequired.push("#bellIcon");
  if (!panel) missingRequired.push("#notifPanel");
  if (!overlay) missingRequired.push("#notifOverlay");
  if (!closeBtn) missingRequired.push("#notifCloseBtn");
  if (!list) missingRequired.push("#notifList");
  if (!notifDot) missingRequired.push("#notifDot");

  if (missingRequired.length) {
    console.warn("[NotifCore] Missing REQUIRED elements:", missingRequired.join(", "));
    return;
  }

  const hasDetailModal =
    !!detailModalEl && !!detailTitleEl && !!detailBodyEl && !!detailMetaEl;

  const hasActionBtn = !!detailActionBtn;

  if (!hasActionBtn) console.warn("[NotifCore] Optional element missing: #notifDetailActionBtn (actions disabled)");
  if (!hasDetailModal) console.warn("[NotifCore] Optional elements missing: notifDetailModal parts (detail modal disabled)");

  // ---------- API ----------
  const API_BASE = "php/notification.php";

  // ---------- Registry ----------
  const registry = new Map();

  function normType(t) {
    return String(t || "").trim().toLowerCase();
  }

  function register(type, handler) {
    const key = normType(type);
    if (!key) return;
    if (typeof handler !== "function") return;
    registry.set(key, handler);
  }

  function unregister(type) {
    registry.delete(normType(type));
  }

  window.Notifications = window.Notifications || {};
  window.Notifications.register = register;
  window.Notifications.unregister = unregister;

  // ---------- helpers ----------
  function escapeHtml(s) {
    return String(s ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }
  function escapeAttr(s) {
    return escapeHtml(s).replaceAll('"', "&quot;");
  }

  function parseMySqlTimestampToEpoch(ts) {
    const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})(?::(\d{2}))?$/.exec(String(ts || ""));
    if (!m) return null;
    const [, Y, Mo, D, H, Mi, S] = m;
    const dt = new Date(Number(Y), Number(Mo) - 1, Number(D), Number(H), Number(Mi), Number(S || 0), 0);
    return Math.floor(dt.getTime() / 1000);
  }

  function formatTimeAgoFromEpoch(sec) {
    const now = Date.now();
    const diffMs = now - (sec * 1000);
    const secAbs = Math.max(0, Math.floor(diffMs / 1000));
    const m = Math.floor(secAbs / 60);
    const h = Math.floor(secAbs / 3600);
    const d = Math.floor(secAbs / 86400);
    const w = Math.floor(secAbs / 604800);

    if (secAbs < 30) return "just now";
    if (secAbs < 60) return `${secAbs}s`;
    if (m < 60) return `${m}m`;
    if (h < 24) return `${h}h`;
    if (d < 7) return `${d}d`;
    return `${w}w`;
  }

  function displayTime(n) {
    if (typeof n?.created_ts === "number") return formatTimeAgoFromEpoch(n.created_ts);
    if (n?.created_at) {
      const epoch = parseMySqlTimestampToEpoch(n.created_at);
      if (epoch) return formatTimeAgoFromEpoch(epoch);
    }
    return n?.time_ago || n?.created_at || "";
  }

  function isUnread(n) {
    if (!n || typeof n !== "object") return false;
    if (typeof n.status === "string") {
      const s = n.status.toLowerCase();
      if (s === "unread") return true;
      if (s === "read") return false;
    }
    if ("read_at" in n) return n.read_at === null || n.read_at === "" || typeof n.read_at === "undefined";
    if ("is_read" in n) {
      const v = n.is_read;
      if (v === 0 || v === "0" || v === false) return true;
      if (v === 1 || v === "1" || v === true) return false;
    }
    return false;
  }

  function updateBellDot(items) {
    const count = (items || []).filter(isUnread).length;
    notifDot.style.display = count > 0 ? "block" : "none";
    bellButton.setAttribute("aria-label", count > 0 ? `Notifications (${count} unread)` : "Notifications");
  }

  function pickLocators(n) {
    const userId = n.user_id ?? n.userId ?? n.meta?.user_id ?? n.payload?.user_id ?? "";
    const idNumber = n.user_id_number ?? n.id_number ?? n.meta?.id_number ?? n.payload?.id_number ?? "";
    const payloadId = n.payload_id ?? n.payloadId ?? n.meta?.payload_id ?? n.payload?.payload_id ?? n.id ?? "";
    return { userId, idNumber, payloadId };
  }

  // ---------- API calls ----------
  function fetchNotifications(afterId = 0) {
    let url = `${API_BASE}?action=list&t=${Date.now()}`;
    if (afterId > 0) url += `&after_id=${encodeURIComponent(String(afterId))}`;

    return fetch(url, { credentials: "same-origin" })
      .then((r) => r.json())
      .then((json) => {
        const items = Array.isArray(json) ? json : (json.notifications || []);
        const latestId = Array.isArray(items) && items.length ? Math.max(...items.map(x => Number(x?.id || 0))) : 0;
        return { items, latestId, raw: json };
      })
      .catch((err) => {
        console.error("[NotifCore] fetch error:", err);
        return { items: [], latestId: 0, raw: null };
      });
  }

  function markNotificationRead(id) {
    const idNum = Number(id);
    if (!Number.isInteger(idNum) || idNum <= 0) return Promise.resolve(false);

    return fetch(API_BASE, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      credentials: "same-origin",
      body: "action=mark_read&id=" + encodeURIComponent(String(idNum))
    })
      .then((r) => r.json())
      .then((j) => !!(j && j.success))
      .catch(() => false);
  }

  // ---------- Render ----------
  function renderNotifications(items) {
    if (!Array.isArray(items) || items.length === 0) {
      list.innerHTML = `<div class="text-center text-muted py-4">No new notifications</div>`;
      notifDot.style.display = "none";
      return;
    }

    list.innerHTML = items.map((n) => {
      const unread = isUnread(n);
      const nid = n.id ?? "";
      const type = normType(n.notif_type || n.type || "");
      const { userId, idNumber, payloadId } = pickLocators(n);

      return `
        <button type="button"
          class="card border-0 border-bottom rounded-0 py-2 px-2 text-start notif-item ${unread ? "unread" : ""}"
          data-notif-id="${escapeAttr(nid)}"
          data-notif-type="${escapeAttr(type)}"
          data-payload-id="${escapeAttr(payloadId)}"
          data-user-id="${escapeAttr(userId)}"
          data-id-number="${escapeAttr(idNumber)}">
          <div class="d-flex">
            <div class="flex-grow-1 pe-2">
              <div class="fw-semibold">${escapeHtml(n.title ?? "Notification")}</div>
              <div class="small text-muted">${escapeHtml(n.body ?? n.message ?? "")}</div>
            </div>
            <span class="small text-nowrap text-muted">${escapeHtml(displayTime(n))}</span>
          </div>
        </button>
      `;
    }).join("");

    updateBellDot(items);
  }

  // ---------- Panel open/close ----------
  let isPanelOpen = false;
  let latestNotificationId = 0;
  let refreshInterval = null;

  function openPanel() {
    panel.classList.add("open");
    overlay.hidden = false;
    overlay.getBoundingClientRect();
    overlay.classList.add("show");

    bellButton.setAttribute("aria-expanded", "true");
    panel.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";
    panel.focus();

    bellIcon.classList.remove("bi-bell");
    bellIcon.classList.add("bi-bell-fill");

    isPanelOpen = true;

    fetchNotifications(0).then(({ items, latestId }) => {
      renderNotifications(items);
      latestNotificationId = Math.max(latestNotificationId, latestId || 0);
    });
  }

  function closePanel() {
    panel.classList.remove("open");
    overlay.classList.remove("show");
    bellButton.setAttribute("aria-expanded", "false");
    panel.setAttribute("aria-hidden", "true");
    document.body.style.overflow = "";
    setTimeout(() => { overlay.hidden = true; }, 200);
    bellButton.focus();

    bellIcon.classList.remove("bi-bell-fill");
    bellIcon.classList.add("bi-bell");

    isPanelOpen = false;
  }

  bellButton.addEventListener("click", (e) => {
    e.preventDefault();
    panel.classList.contains("open") ? closePanel() : openPanel();
  });

  closeBtn.addEventListener("click", closePanel);
  overlay.addEventListener("click", closePanel);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && panel.classList.contains("open")) closePanel();
  });

  // ---------- Detail modal (HTML-capable) ----------
  let _detailModalInstance = null;

  function getDetailModalInstance() {
    if (!hasDetailModal) return null;
    if (_detailModalInstance) return _detailModalInstance;
    _detailModalInstance = new bootstrap.Modal(detailModalEl);
    return _detailModalInstance;
  }

  function openDetailModal(notifOrOpts) {
    if (!hasDetailModal) return;

    const o = (notifOrOpts && typeof notifOrOpts === "object") ? notifOrOpts : {};

    const title = o.title || "Notification";
    const bodyText = (o.body ?? o.message ?? "");
    const bodyHtml = (o.body_html ?? o.bodyHtml ?? "");
    const metaText = (o.meta ?? (o.created_at ? `Received: ${o.created_at}` : ""));
    const metaHtml = (o.meta_html ?? o.metaHtml ?? "");

    detailTitleEl.textContent = title;

    if (bodyHtml) detailBodyEl.innerHTML = String(bodyHtml);
    else detailBodyEl.textContent = String(bodyText);

    if (metaHtml) detailMetaEl.innerHTML = String(metaHtml);
    else detailMetaEl.textContent = String(metaText || "");

    if (hasActionBtn) {
      detailActionBtn.classList.add("d-none");
      detailActionBtn.textContent = "View details";
      detailActionBtn.onclick = null;
    }

    const modal = getDetailModalInstance();
    if (modal) modal.show();
  }

  // ---------- Dispatch to module (returns true/false) ----------
  function dispatchToModule(notif, meta) {
    const type = normType(notif?.notif_type || notif?.type || meta?.type || "");
    const handler = registry.get(type);

    const helpers = {
      closePanel,
      openDetailModal,
      setActionButton: ({ text, onClick }) => {
        if (!hasActionBtn) return;
        detailActionBtn.textContent = text || "View details";
        detailActionBtn.classList.remove("d-none");
        detailActionBtn.onclick = typeof onClick === "function" ? onClick : null;
      },
      hideActionButton: () => {
        if (!hasActionBtn) return;
        detailActionBtn.classList.add("d-none");
        detailActionBtn.onclick = null;
      },
      emit: (eventName, detail) => {
        window.dispatchEvent(new CustomEvent(eventName, { detail }));
      }
    };

    if (handler) {
      try {
        handler(notif, { ...meta, type }, helpers);
        return true;
      } catch (e) {
        console.error("[NotifCore] handler error:", type, e);
        return false;
      }
    }
    return false;
  }

  // ---------- Click notif item (FIXED: open default modal first, then let module override) ----------
  list.addEventListener("click", async (e) => {
    const btn = e.target.closest(".notif-item");
    if (!btn) return;

    const notifId = btn.dataset.notifId || "";
    const type = btn.dataset.notifType || "";
    const payloadId = btn.dataset.payloadId || "";
    const userId = btn.dataset.userId || "";
    const idNumber = btn.dataset.idNumber || "";

    btn.classList.remove("unread");

    markNotificationRead(notifId).then(() => {
      fetchNotifications(0).then(({ items }) => updateBellDot(items));
    });

    const notif = {
      id: notifId,
      notif_type: type,
      payload_id: payloadId,
      user_id: userId,
      id_number: idNumber,
      title: btn.querySelector(".fw-semibold")?.textContent || "Notification",
      body: btn.querySelector(".small.text-muted")?.textContent || "",
      created_at: null
    };

    // ✅ Always show something first (so modules that only set buttons still "work")
    openDetailModal(notif);

    // Then allow modules to override modal content / set action button / emit events
    dispatchToModule(notif, { payloadId, userId, idNumber, type });
  });

  // ---------- Polling ----------
  function startPolling() {
    if (refreshInterval) clearInterval(refreshInterval);
    refreshInterval = setInterval(() => {
      fetchNotifications(latestNotificationId).then(({ items, latestId }) => {
        if (latestId) latestNotificationId = Math.max(latestNotificationId, latestId);

        if (items && items.length) {
          fetchNotifications(0).then(({ items: all }) => {
            if (isPanelOpen) renderNotifications(all);
            else updateBellDot(all);
          });
        }
      });
    }, 8000);
  }

  // initial dot
  fetchNotifications(0).then(({ items, latestId }) => {
    latestNotificationId = Math.max(latestNotificationId, latestId || 0);
    updateBellDot(items);
    startPolling();
  });

})();