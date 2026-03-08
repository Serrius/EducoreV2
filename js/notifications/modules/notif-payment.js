/* js/notifications/modules/notif-payment.js */
/* global bootstrap */

(function () {
  "use strict";
  if (!window.Notifications?.register) {
    console.warn("[NotifPayment] notifications-core.js not loaded yet.");
    return;
  }

  function openPayment(payloadId, userId, idNumber) {
    // Emit an event so your payments page can decide what to open.
    // payloadId can be: payment_id OR org_id OR membership_id depending on what you store.
    window.dispatchEvent(new CustomEvent("notif:openPayment", {
      detail: {
        payloadId: payloadId || "",
        userId: userId || "",
        idNumber: idNumber || ""
      }
    }));

    // Try to navigate to a likely payments section in your SPA.
    const candidates = [
      '.sidebar-link[data-section="organization-payments"]',
      '.sidebar-link[data-section="org-fees"]',
      '.sidebar-link[data-section="organization-fees"]',
      '.sidebar-link[data-section="payments"]',
      '.sidebar-link[data-section="manage-payments"]'
    ];
    for (const sel of candidates) {
      const el = document.querySelector(sel);
      if (el) { el.click(); break; }
    }

    // If you already have a global opener, try it safely.
    const fn =
      window.openPaymentFromNotif ||
      window.openOrgPaymentFromNotif ||
      window.OrganizationPayments?.openPayment ||
      window.OrganizationPayments?.openOrganization ||
      window.OrgPayments?.openPayment ||
      window.OrgPayments?.openOrganization ||
      null;

    if (typeof fn === "function") {
      try { fn(payloadId, userId, idNumber); } catch (e) {}
    }
  }

  function handler(notif, meta, helpers) {
    // In your notifications table, payload_id is the only generic “link” field.
    // For payment notifications, you decide what payload_id means (payment_id, org_id, etc).
    const payloadId = meta.payloadId || notif.payload_id || "";
    const userId = meta.userId || notif.user_id || "";
    const idNumber = meta.idNumber || notif.id_number || "";

    helpers.setActionButton({
      text: "Open payment",
      onClick: () => {
        const modalEl = document.getElementById("notifDetailModal");
        if (modalEl) bootstrap.Modal.getInstance(modalEl)?.hide();
        openPayment(payloadId, userId, idNumber);
      }
    });
  }

  window.Notifications.register("payment", handler);

})();