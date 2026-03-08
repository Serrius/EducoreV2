/* js/system-authority/system-authority.js */
/* global bootstrap, showSuccess, showError */

(function () {
  console.log("SDC module:", window.SystemAuthoritySDC);
  console.log("Super module:", window.SystemAuthoritySuper);
  console.log("Restore module:", window.SystemAuthorityRestore);
  "use strict";

  const API_URL = "php/system-authority.php";

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

  async function postJSON(payload) {
    const res = await fetch(API_URL, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const text = await res.text(); // raw first for debugging
    console.log("[SystemAuthority] RAW:", res.status, text);

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

  // ✅ single source of truth helper
  async function getCurrent() {
    const data = await postJSON({ action: "get_current" });
    return {
      super_admin: data.super_admin || null,
      special_admin: data.special_admin || null,
      current_history: data.current_history || null,
    };
  }

  // ----------------------------
  // ✅ Signature preview renderer
  // ----------------------------
 function resolveSigUrl(file) {
  if (!file) return "";
  const fRaw = String(file).trim();
  if (!fRaw) return "";

  // If already absolute URL, keep it
  if (/^https?:\/\//i.test(fRaw)) return fRaw;

  // Normalize slashes
  const f = fRaw.replaceAll("\\", "/");

  // Detect app base (e.g., "/EDUORG" on localhost, "" on root deployments)
  // Works even if this page is injected via fetch.
  const pathParts = (window.location.pathname || "/").split("/").filter(Boolean);

  // If your index is http://localhost/EDUORG/super-admin.html
  // base = "/EDUORG"
  // If root is http://example.com/ then base = ""
  const base = pathParts.length > 0 ? `/${pathParts[0]}` : "";

  // If the incoming path is root-relative "/assets/..." treat it as app-relative instead
  if (f.startsWith("/")) {
    return base + f;
  }

  // Otherwise make it app-relative
  return base + "/" + f.replace(/^\.?\//, "");
}


  function renderSignature(previewEl, sig, fallbackText) {
    if (!previewEl) return;

    // default placeholder
    const placeholderHTML = `
      <div class="text-muted small">
        ${fallbackText || "Signature preview placeholder (no file uploaded)"}
      </div>
    `;

    if (!sig || typeof sig !== "object") {
      previewEl.innerHTML = placeholderHTML;
      return;
    }

    const sigFile = sig.signature_file ? String(sig.signature_file) : "";
    const sigType = sig.signature_type ? String(sig.signature_type) : "";
    const typedName = sig.typed_name ? String(sig.typed_name) : "";

    // ✅ 1) Image signature
    if (sigFile.trim() !== "") {
      const src = resolveSigUrl(sigFile);

      previewEl.innerHTML = `
        <div class="d-flex flex-column align-items-center justify-content-center gap-2">
          <img
            src="${src}"
            alt="E-Signature"
            style="max-width: 100%; max-height: 220px; object-fit: contain;"
            class="img-fluid"
            onerror="this.onerror=null; this.style.display='none'; this.closest('.d-flex').querySelector('.sig-fallback').classList.remove('d-none');"
          />
          <div class="sig-fallback d-none text-muted small">
            Signature file exists but failed to load. Check path:
            <span class="font-monospace">${src}</span>
          </div>
        </div>
      `;
      return;
    }

    // ✅ 2) Typed signature
    if (sigType === "typed" && typedName.trim() !== "") {
      previewEl.innerHTML = `
        <div class="d-flex flex-column align-items-center justify-content-center gap-2">
          <div style="
            font-size: 38px;
            line-height: 1.1;
            font-family: 'Brush Script MT', 'Segoe Script', 'Pacifico', cursive;
            color: #111;
          ">
            ${escapeHtml(typedName)}
          </div>
          <div class="text-muted small">Typed Signature</div>
        </div>
      `;
      return;
    }

    // ✅ 3) fallback
    previewEl.innerHTML = placeholderHTML;
  }

  function escapeHtml(str) {
    return String(str)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  // Expose small shared helpers to other modules
  const Shared = {
    API_URL,
    postJSON,
    getCurrent,
    qs,
    qsa,
    safeShowError,
    safeShowSuccess,
  };

  async function loadCurrentAndPaint() {
    const { super_admin: superU, special_admin: sdcU } = await getCurrent();

    // SUPER card
    if (superU) {
      qs("#super_user_id") && (qs("#super_user_id").value = superU.id);
      qs("#replace_super_current_id") && (qs("#replace_super_current_id").value = superU.id);

      qs("#super_name") && (qs("#super_name").textContent = superU.full_name || "—");
      qs("#super_idnum") && (qs("#super_idnum").textContent = superU.id_number || "—");
      qs("#super_email") && (qs("#super_email").textContent = superU.email || "—");
      qs("#super_status") && (qs("#super_status").textContent = superU.status || "—");

      // ✅ NEW: bind id_number where e_signature is going to be placed
      qs("#super_signature_idnum") && (qs("#super_signature_idnum").value = superU.id_number || "");

      // ✅ NEW: render signature preview
      renderSignature(qs("#super_signature_preview"), superU.signature, "Signature preview placeholder (no file uploaded)");

      const badge = qs("#super_status_badge");
      if (badge) {
        const active = (superU.status || "").toLowerCase() === "active";
        badge.textContent = active ? "Active" : "Inactive";
        badge.className = active
          ? "badge bg-success-subtle text-success border border-success-subtle"
          : "badge bg-secondary-subtle text-secondary border border-secondary-subtle";
      }
    } else {
      qs("#super_user_id") && (qs("#super_user_id").value = "");
      qs("#replace_super_current_id") && (qs("#replace_super_current_id").value = "");

      qs("#super_name") && (qs("#super_name").textContent = "—");
      qs("#super_idnum") && (qs("#super_idnum").textContent = "—");
      qs("#super_email") && (qs("#super_email").textContent = "—");
      qs("#super_status") && (qs("#super_status").textContent = "—");

      // ✅ clear signature idnum
      qs("#super_signature_idnum") && (qs("#super_signature_idnum").value = "");

      // ✅ clear signature preview
      renderSignature(qs("#super_signature_preview"), null, "Signature preview placeholder (no file uploaded)");

      const badge = qs("#super_status_badge");
      if (badge) {
        badge.textContent = "—";
        badge.className = "badge bg-secondary-subtle text-secondary border border-secondary-subtle";
      }
    }

    // SDC card
    if (sdcU) {
      qs("#sdc_user_id") && (qs("#sdc_user_id").value = sdcU.id);
      qs("#replace_sdc_current_id") && (qs("#replace_sdc_current_id").value = sdcU.id);

      qs("#sdc_name") && (qs("#sdc_name").textContent = sdcU.full_name || "—");
      qs("#sdc_idnum") && (qs("#sdc_idnum").textContent = sdcU.id_number || "—");
      qs("#sdc_email") && (qs("#sdc_email").textContent = sdcU.email || "—");
      qs("#sdc_status") && (qs("#sdc_status").textContent = sdcU.status || "—");

      // ✅ NEW: bind id_number where e_signature is going to be placed
      qs("#sdc_signature_idnum") && (qs("#sdc_signature_idnum").value = sdcU.id_number || "");

      // ✅ NEW: render signature preview
      renderSignature(qs("#sdc_signature_preview"), sdcU.signature, "Signature preview placeholder (no file uploaded)");

      const badge = qs("#sdc_status_badge");
      if (badge) {
        const active = (sdcU.status || "").toLowerCase() === "active";
        badge.textContent = active ? "Active" : "Inactive";
        badge.className = active
          ? "badge bg-success-subtle text-success border border-success-subtle"
          : "badge bg-secondary-subtle text-secondary border border-secondary-subtle";
      }
    } else {
      qs("#sdc_user_id") && (qs("#sdc_user_id").value = "");
      qs("#replace_sdc_current_id") && (qs("#replace_sdc_current_id").value = "");

      qs("#sdc_name") && (qs("#sdc_name").textContent = "—");
      qs("#sdc_idnum") && (qs("#sdc_idnum").textContent = "—");
      qs("#sdc_email") && (qs("#sdc_email").textContent = "—");
      qs("#sdc_status") && (qs("#sdc_status").textContent = "—");

      // ✅ clear signature idnum
      qs("#sdc_signature_idnum") && (qs("#sdc_signature_idnum").value = "");

      // ✅ clear signature preview
      renderSignature(qs("#sdc_signature_preview"), null, "Signature preview placeholder (no file uploaded)");

      const badge = qs("#sdc_status_badge");
      if (badge) {
        badge.textContent = "—";
        badge.className = "badge bg-secondary-subtle text-secondary border border-secondary-subtle";
      }
    }

    return { superU, sdcU };
  }

  function bindAuditModalRefresh() {
    const auditModalEl = qs("#modalAuditLogs");
    if (!auditModalEl) return;

    auditModalEl.addEventListener("shown.bs.modal", () => {
      window.SystemAuthorityAudit?.refresh?.();
    });
  }

  // ✅ auto refresh restore tab when opened
  function bindRestoreTabRefresh() {
    const restoreTabBtn = qs("#tab-restore");
    if (!restoreTabBtn) return;

    restoreTabBtn.addEventListener("shown.bs.tab", () => {
      window.SystemAuthorityRestore?.refresh?.();
    });
  }

  async function init() {
    try {
      // init submodules first
      window.SystemAuthoritySuper?.init?.(Shared);
      window.SystemAuthoritySDC?.init?.(Shared);
      window.SystemAuthorityAudit?.init?.(Shared);

      // restore module init
      window.SystemAuthorityRestore?.init?.(Shared);

      bindAuditModalRefresh();
      bindRestoreTabRefresh();

      // First paint
      await loadCurrentAndPaint();
    } catch (e) {
      Shared.safeShowError(e?.message || "Failed to load System Authority.");
    }
  }

  async function refresh() {
    try {
      await loadCurrentAndPaint();
    } catch (e) {
      Shared.safeShowError(e?.message || "Failed to refresh.");
    }
  }

  window.SystemAuthority = {
    init,
    refresh,
    Shared,
  };
})();
//signature