/* js/notifications/modules/notif-club.js */
/* global bootstrap */

(function () {
  "use strict";
  if (!window.Notifications?.register) {
    console.warn("[NotifClub] notifications-core.js not loaded yet.");
    return;
  }

  function openClub(payloadId, userId, idNumber) {
    // Emit an event so your club/membership page can decide what to open.
    // payloadId can be: org_id (club id) OR membership_id, depending on what you store.
    window.dispatchEvent(new CustomEvent("notif:openClub", {
      detail: {
        payloadId: payloadId || "",
        userId: userId || "",
        idNumber: idNumber || ""
      }
    }));

    // Try to navigate to a likely club/membership section in your SPA.
    const candidates = [
      '.sidebar-link[data-section="clubs"]',
      '.sidebar-link[data-section="club-memberships"]',
      '.sidebar-link[data-section="memberships"]',
      '.sidebar-link[data-section="organization-memberships"]',
      '.sidebar-link[data-section="manage-clubs"]'
    ];
    for (const sel of candidates) {
      const el = document.querySelector(sel);
      if (el) { el.click(); break; }
    }

    // If you already have a global opener, try it safely.
    const fn =
      window.openClubFromNotif ||
      window.openMembershipFromNotif ||
      window.Clubs?.openClub ||
      window.Clubs?.openMembership ||
      window.Memberships?.openMembership ||
      window.ManageClubs?.openClub ||
      null;

    if (typeof fn === "function") {
      try { fn(payloadId, userId, idNumber); } catch (e) {}
    }
  }

  function handler(notif, meta, helpers) {
    const payloadId = meta.payloadId || notif.payload_id || "";
    const userId = meta.userId || notif.user_id || "";
    const idNumber = meta.idNumber || notif.id_number || "";

    helpers.setActionButton({
      text: "Open club",
      onClick: () => {
        const modalEl = document.getElementById("notifDetailModal");
        if (modalEl) bootstrap.Modal.getInstance(modalEl)?.hide();
        openClub(payloadId, userId, idNumber);
      }
    });
  }

  window.Notifications.register("club", handler);

})();