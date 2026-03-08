/* js/notifications/modules/notif-users.js */
/* global bootstrap */

(function () {
  "use strict";
  if (window.__NotifUsersBooted) return;
  window.__NotifUsersBooted = true;

  if (!window.Notifications?.register) {
    console.warn("[NotifUsers] notifications-core.js not loaded yet.");
    return;
  }

  // Matches notif types that should open user details
  const USER_TYPES = new Set([
    "registration",
    "user",
    "users",
    "account",
    "student",
    "faculty",
    "moderator"
  ]);

  function closeNotificationPanel() {
    // Find and close the notification panel
    const panel = document.getElementById('notifPanel');
    const overlay = document.getElementById('notifOverlay');
    const bellButton = document.getElementById('bellButton');
    const bellIcon = document.getElementById('bellIcon');
    
    if (panel && panel.classList.contains('open')) {
      panel.classList.remove('open');
      panel.setAttribute('aria-hidden', 'true');
      
      if (overlay) {
        overlay.classList.remove('show');
        setTimeout(() => { overlay.hidden = true; }, 200);
      }
      
      if (bellButton) {
        bellButton.setAttribute('aria-expanded', 'false');
        bellButton.focus();
      }
      
      if (bellIcon) {
        bellIcon.classList.remove('bi-bell-fill');
        bellIcon.classList.add('bi-bell');
      }
      
      document.body.style.overflow = '';
    }
  }

  function gotoUsersPage(userId, idNumber) {
    console.log("[NotifUsers] gotoUsersPage called with:", { userId, idNumber });

    // Store in sessionStorage as a backup
    if (userId || idNumber) {
      sessionStorage.setItem('pendingUserHighlight', JSON.stringify({
        userId: userId,
        idNumber: idNumber
      }));
    }

    // Dispatch custom event with the data
    window.dispatchEvent(new CustomEvent("notif:openUser", {
      detail: { 
        userId: userId || "", 
        idNumber: idNumber || ""
      }
    }));

    // Close the notification panel first
    closeNotificationPanel();

    // Find and click the manage-users sidebar link
    const usersLink = document.querySelector('.sidebar-link[data-section="manage-users"]');
    if (usersLink) {
      console.log("[NotifUsers] Clicking manage-users sidebar link");
      usersLink.click();
    }
  }

  function extractUserIdFromModal() {
    // Get the modal body content
    const bodyEl = document.getElementById('notifDetailBody');
    if (!bodyEl) return null;
    
    const text = bodyEl.textContent || '';
    console.log("[NotifUsers] Modal text:", text);
    
    // Try to extract user ID from patterns like "User 69" or "ID: 69" or just numbers
    const patterns = [
      /User[:\s]*(\d+)/i,           // User 69, User: 69
      /ID[:\s]*(\d+)/i,              // ID: 69
      /#(\d+)/,                       // #69
      /student[:\s]*(\d+)/i,          // student 69
      /(\d+)\s*[\(]/                  // 69 (Balls Balls)
    ];
    
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match && match[1]) {
        console.log("[NotifUsers] Extracted user ID:", match[1]);
        return match[1];
      }
    }
    
    // Fallback: just find any number in the text
    const anyNumber = text.match(/\b(\d+)\b/);
    if (anyNumber) {
      console.log("[NotifUsers] Extracted any number as fallback:", anyNumber[1]);
      return anyNumber[1];
    }
    
    return null;
  }

  function handler(notif, meta, helpers) {
    console.log("[NotifUsers] ===== NOTIFICATION HANDLER =====");
    
    // First, try to get data from the notification objects
    let userId = meta?.userId || notif?.user_id || meta?.payload?.user_id || notif?.payload?.user_id || "";
    let idNumber = meta?.idNumber || notif?.id_number || meta?.payload?.id_number || notif?.payload?.id_number || "";
    
    const notifType = String(notif?.type || notif?.notif_type || meta?.type || "").toLowerCase();
    const isUserType = USER_TYPES.has(notifType) || userId || idNumber;
    
    console.log("[NotifUsers] Initial data - userId:", userId, "idNumber:", idNumber, "type:", notifType);

    // Set the action button
    helpers.setActionButton({
      text: "View in user list",
      onClick: () => {
        console.log("[NotifUsers] Action button clicked");
        
        // Try to extract user ID from the modal content if we don't have it yet
        let finalUserId = userId;
        let finalIdNumber = idNumber;
        
        if (!finalUserId && !finalIdNumber) {
          const extractedId = extractUserIdFromModal();
          if (extractedId) {
            finalUserId = extractedId;
          }
        }
        
        console.log("[NotifUsers] Final data to send:", { userId: finalUserId, idNumber: finalIdNumber });
        
        // Close the detail modal
        const modalEl = document.getElementById("notifDetailModal");
        if (modalEl) {
          const modal = bootstrap.Modal.getInstance(modalEl);
          if (modal) modal.hide();
        }
        
        // Navigate (this will also close the notification panel)
        gotoUsersPage(finalUserId, finalIdNumber);
      }
    });
  }

  // Register for all user types
  USER_TYPES.forEach((type) => {
    window.Notifications.register(type, handler);
  });

  window.Notifications.register("registration", handler);

})();