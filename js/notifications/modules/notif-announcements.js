/* js/notifications/modules/notif-announcements.js */
/* global bootstrap */

(function () {
  "use strict";
  if (!window.Notifications?.register) {
    console.warn("[NotifAnnouncements] notifications-core.js not loaded yet.");
    return;
  }

  function openAnnouncement(payloadId) {
    // Your UI has #viewAnnouncementModal + #viewAnnouncementBody.
    // We’ll emit an event so your manage-announcement module can decide how to load/show it.
    window.dispatchEvent(new CustomEvent("notif:openAnnouncement", {
      detail: { announcementId: payloadId || "" }
    }));

    // If you already have a global opener, we try it safely.
    const fn =
      window.openAnnouncementFromNotif ||
      window.ManageAnnouncement?.openAnnouncement ||
      window.ManageAnnouncement?.viewAnnouncement ||
      null;

    if (typeof fn === "function") {
      try { fn(payloadId); } catch (e) {}
    }
  }

  function handler(notif, meta, helpers) {
    const payloadId = meta.payloadId || notif.payload_id || notif.id || "";
    if (!payloadId) return;

    helpers.setActionButton({
      text: "View announcement",
      onClick: () => {
        const modalEl = document.getElementById("notifDetailModal");
        if (modalEl) bootstrap.Modal.getInstance(modalEl)?.hide();
        openAnnouncement(payloadId);
      }
    });
  }

  window.Notifications.register("announcement", handler);

})();