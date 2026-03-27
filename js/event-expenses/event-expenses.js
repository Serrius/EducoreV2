/* js/event-expenses/event-expenses.js */
/* global bootstrap, showSuccess, showError */

(function () {
  "use strict";

  // ✅ IMPORTANT SPA FIX:
  window.__EventExpensesWatcherStarted = true;

  const API_URL = "php/event-expenses.php";

  // ✅ MPDF print endpoints
  const PRINT_BASE = "php/";
  const PRINT_LEDGER = `${PRINT_BASE}/event-ledger-pdf.php`;
  const PRINT_PASSBOOK = `${PRINT_BASE}/org-passbook-pdf.php`;
  const PRINT_LIQUIDATION = `${PRINT_BASE}/liquidation-report-pdf.php`;
  const PRINT_ACCOMPLISHMENT = `${PRINT_BASE}/accomplishment-report-pdf.php`;

  function qs(sel, root = document) { return root.querySelector(sel); }
  function qsa(sel, root = document) { return Array.from(root.querySelectorAll(sel)); }

  function safeShowError(msg) {
    if (typeof window.showError === "function") return window.showError(msg);
    alert(msg || "Something went wrong.");
  }
  function safeShowSuccess(msg) {
    if (typeof window.showSuccess === "function") return window.showSuccess(msg);
    alert(msg || "Success.");
  }

  function escapeHtml(s) {
    return String(s ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function esc(s) { return escapeHtml(s); }

  function fmtMoney(v) {
    const n = Number(v ?? 0);
    if (!isFinite(n)) return "0.00";
    return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function resolveAppUrl(path) {
    if (!path) return "";
    const raw = String(path).trim();
    if (!raw) return "";
    if (/^https?:\/\//i.test(raw)) return raw;

    const p = raw.replaceAll("\\", "/");
    const parts = (window.location.pathname || "/").split("/").filter(Boolean);
    const base = parts.length > 0 ? `/${parts[0]}` : "";

    if (p.startsWith("/")) {
      if (base && p.startsWith(base + "/")) return p;
      return base + p;
    }

    return base + "/" + p.replace(/^\.?\//, "");
  }

  function openNewTab(url) {
    const u = resolveAppUrl(url);
    if (!u) return;
    window.open(u, "_blank", "noopener");
  }

  function buildUrl(path, params) {
    const base = resolveAppUrl(path);
    const usp = new URLSearchParams();
    Object.entries(params || {}).forEach(([k, v]) => {
      if (v === undefined || v === null) return;
      const s = String(v);
      if (s.trim() === "") return;
      usp.set(k, s);
    });
    const q = usp.toString();
    return q ? `${base}?${q}` : base;
  }

  async function postJSON(payload) {
    const res = await fetch(API_URL, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload || {}),
    });

    const text = await res.text();
    console.log("[EventExpenses] RAW:", res.status, text);

    let data;
    try { data = JSON.parse(text); }
    catch { throw new Error("Invalid server response (not JSON). Check console RAW."); }

    if (!res.ok) throw new Error(data?.message || `HTTP ${res.status}`);
    if (!data?.success) throw new Error(data?.message || "Request failed.");
    return data;
  }

  async function api(payload) {
    return postJSON(payload);
  }

  // -------------------------
  // UI helpers
  // -------------------------
  function money(n) {
    const v = Number(n || 0);
    return `₱${v.toFixed(2)}`;
  }

  function toISODateInput(v) {
    if (!v) return "";
    const s = String(v);
    return s.slice(0, 10);
  }

  function toast(msg) {
    const el = qs("#eeToast");
    const body = qs("#eeToastMsg");
    if (body) body.textContent = msg || "";
    if (!el || typeof bootstrap === "undefined") return;

    const t = bootstrap.Toast.getOrCreateInstance(el, { delay: 2500 });
    t.show();
  }

  function setHidden(el, hidden) {
    if (!el) return;
    el.classList.toggle("d-none", !!hidden);
  }

  function disableActionEls(disabled, reasonText) {
    const items = qsa("[data-ee-action]");
    items.forEach((el) => {
      const isBtn = el.tagName === "BUTTON" || el.tagName === "A" || el.getAttribute("role") === "button";
      el.classList.toggle("disabled-action", !!disabled);
      if (isBtn) el.disabled = !!disabled;
      if (disabled && reasonText) el.setAttribute("title", reasonText);
      if (!disabled) el.removeAttribute("title");
    });
  }

  function setActionEnabled(selectorOrEl, enabled, reasonText) {
    const el = typeof selectorOrEl === "string" ? qs(selectorOrEl) : selectorOrEl;
    if (!el) return;
    const isBtn = el.tagName === "BUTTON" || el.tagName === "A" || el.getAttribute("role") === "button";
    el.classList.toggle("disabled-action", !enabled);
    if (isBtn) el.disabled = !enabled;
    if (!enabled && reasonText) el.setAttribute("title", reasonText);
    if (enabled) el.removeAttribute("title");
  }

  function showView(which) {
    const list = qs("#eeListView");
    const ev = qs("#eeEventView");
    if (list) list.classList.toggle("d-none", which !== "list");
    if (ev) ev.classList.toggle("d-none", which !== "event");
  }

  function normalizeRole(r) {
    return String(r || "").trim().toLowerCase();
  }

  function isApproverRole(role) {
    const r = normalizeRole(role);
    return ["faculty_admin", "super_admin", "special_admin", "overseer", "moderator"].includes(r);
  }

  function semKey(s) {
    const x = String(s || "").trim().toLowerCase();
    if (!x) return "";
    if (x.includes("summer")) return "summer";
    if (x.includes("1") || x.includes("first")) return "1";
    if (x.includes("2") || x.includes("second")) return "2";
    return x;
  }

  function isReadOnlyTerm() {
    return (
      state.selectedTermId &&
      state.activeTermId &&
      Number(state.selectedTermId) !== Number(state.activeTermId)
    );
  }

  function isReadOnlyMode() {
    return !!state.permissions.is_readonly || isReadOnlyTerm();
  }

  function updateCreditTotal(row) {
    const qty = parseInt(row.querySelector('.credit-qty')?.value) || 0;
    const amount = parseFloat(row.querySelector('.credit-amount')?.value) || 0;
    const total = qty * amount;
    
    const totalCell = row.querySelector('.credit-total');
    if (totalCell) totalCell.textContent = money(total);
    
    updateFinancialSummary();
  }

  // Debit functions
  function addDebitRow(data = null) {
    const template = document.getElementById('debitRowTemplate');
    const tbody = document.getElementById('debitTbody');
    if (!template || !tbody) return;
    
    const clone = template.content.cloneNode(true);
    const row = clone.querySelector('tr');
    
    const descInput = row.querySelector('.debit-desc');
    const dateInput = row.querySelector('.debit-date');
    const categorySelect = row.querySelector('.debit-category');
    const qtyInput = row.querySelector('.debit-qty');
    const unitPriceInput = row.querySelector('.debit-unit-price');
    const totalCell = row.querySelector('.debit-total');
    const receiptNoInput = row.querySelector('.debit-receipt-no');
    const receiptFile = row.querySelector('.debit-receipt');
    const removeBtn = row.querySelector('.debit-remove');
    
    if (data) {
      descInput.value = data.description || '';
      dateInput.value = data.date || '';
      categorySelect.value = data.category || '';
      qtyInput.value = data.quantity || 1;
      unitPriceInput.value = data.unit_price || '';
      receiptNoInput.value = data.receipt_no || '';
    } else {
      const today = new Date().toISOString().split('T')[0];
      dateInput.value = today;
      qtyInput.value = 1;
      // DON'T set defaults for category, receiptNo, receiptFile - they must be filled by user
    }
    
    // Calculate total function
    function updateTotal() {
      const qty = parseInt(qtyInput.value) || 0;
      const unitPrice = parseFloat(unitPriceInput.value) || 0;
      totalCell.textContent = money(qty * unitPrice);
      updateFinancialSummary();
    }
    
    [qtyInput, unitPriceInput].forEach(input => {
      input.addEventListener('input', updateTotal);
    });
    
    // Initial total
    updateTotal();
    
    removeBtn.addEventListener('click', () => {
      row.remove();
      updateFinancialSummary();
    });
    
    tbody.appendChild(clone);
    updateFinancialSummary();
  }

  function updateDebitTotal(row) {
    const qty = parseInt(row.querySelector('.debit-qty')?.value) || 0;
    const unitPrice = parseFloat(row.querySelector('.debit-unit-price')?.value) || 0;
    const total = qty * unitPrice;
    
    const totalCell = row.querySelector('.debit-total');
    if (totalCell) totalCell.textContent = money(total);
    
    updateFinancialSummary();
  }

  function updateFinancialSummary() {
    // Calculate credits total - just sum the amounts, no quantity multiplication
    const creditRows = document.querySelectorAll('#creditTbody tr');
    let totalCredits = 0;
    creditRows.forEach(row => {
      const amount = parseFloat(row.querySelector('.credit-amount')?.value) || 0;
      totalCredits += amount; // Direct amount, not multiplied by quantity
    });
    
    // Calculate debits total - quantity * unit price
    const debitRows = document.querySelectorAll('#debitTbody tr');
    let totalDebits = 0;
    debitRows.forEach(row => {
      const qty = parseInt(row.querySelector('.debit-qty')?.value) || 0;
      const unitPrice = parseFloat(row.querySelector('.debit-unit-price')?.value) || 0;
      totalDebits += qty * unitPrice;
    });
    
    const balance = totalCredits - totalDebits;
    
    // Update UI
    const creditsEl = document.getElementById('summaryTotalCredits');
    const debitsEl = document.getElementById('summaryTotalDebits');
    const balanceEl = document.getElementById('summaryBalance');
    const balanceBox = document.getElementById('summaryBalanceBox');
    const warningEl = document.getElementById('summaryBalanceWarning');
    const warningAmount = document.getElementById('warningAmount');
    
    if (creditsEl) creditsEl.textContent = money(totalCredits);
    if (debitsEl) debitsEl.textContent = money(totalDebits);
    if (balanceEl) balanceEl.textContent = money(balance);
    
    // Style balance box
    if (balanceBox) {
      if (balance >= 0) {
        balanceBox.style.backgroundColor = '#d4edda';
        balanceBox.style.borderColor = '#c3e6cb';
      } else {
        balanceBox.style.backgroundColor = '#f8d7da';
        balanceBox.style.borderColor = '#f5c6cb';
      }
    }
    
    // Show warning if negative
    if (warningEl && warningAmount) {
      if (balance < 0) {
        warningEl.classList.remove('d-none');
        warningAmount.textContent = money(Math.abs(balance));
      } else {
        warningEl.classList.add('d-none');
      }
    }
    
    return { totalCredits, totalDebits, balance };
  }

  function initProposedBudgetSections() {
    console.log("=== INIT PROPOSED BUDGET SECTIONS ===");
    
    // Clear and recreate credit table rows
    const creditTable = document.getElementById('proposedCreditsTable');
    if (creditTable) {
        const tbody = creditTable.querySelector('tbody');
        if (tbody) {
            // Clear existing rows
            tbody.innerHTML = '';
            // Add one empty credit row with event listeners
            addCreditRow();
        }
    }
    
    // Clear and recreate expense table rows
    const expenseTable = document.getElementById('proposedExpensesTable');
    if (expenseTable) {
        const tbody = expenseTable.querySelector('tbody');
        if (tbody) {
            // Clear existing rows
            tbody.innerHTML = '';
            // Add one empty expense row with event listeners
            addExpenseRow();
        }
    }
    
    // Bind add buttons if not already bound
    const addCreditBtn = document.getElementById('addProposedCreditBtn');
    if (addCreditBtn && addCreditBtn.dataset.eeBound !== '1') {
        addCreditBtn.dataset.eeBound = '1';
        addCreditBtn.addEventListener('click', addCreditRow);
    }
    
    const addExpenseBtn = document.getElementById('addProposedExpenseBtn');
    if (addExpenseBtn && addExpenseBtn.dataset.eeBound !== '1') {
        addExpenseBtn.dataset.eeBound = '1';
        addExpenseBtn.addEventListener('click', addExpenseRow);
    }
    
    // Force summary update
    setTimeout(updateModalBudgetSummary, 100);
  }

  function addCreditRow() {
    const table = document.getElementById('proposedCreditsTable');
    if (!table) {
        console.log("proposedCreditsTable not found");
        return;
    }
    
    const tbody = table.querySelector('tbody');
    if (!tbody) return;
    
    const row = document.createElement('tr');
    row.className = 'credit-row';
    row.innerHTML = `
        <td><input type="text" class="form-control form-control-sm credit-desc" placeholder="e.g., Sponsorship, Ticket Sales" required>
        <td><input type="number" class="form-control form-control-sm text-end credit-amount" min="0" step="0.01" placeholder="0.00" required>
        <td><input type="text" class="form-control form-control-sm credit-notes" placeholder="Optional notes">
        <td class="text-center">
            <button type="button" class="btn btn-link btn-sm text-danger p-0 credit-remove" title="Remove">
                <i class="bi bi-trash"></i>
            </button>
    `;
    
    const amountInput = row.querySelector('.credit-amount');
    const removeBtn = row.querySelector('.credit-remove');
    
    amountInput.addEventListener('input', function() {
        updateModalBudgetSummary();
    });
    
    removeBtn.addEventListener('click', function() {
        row.remove();
        updateModalBudgetSummary();
    });
    
    tbody.appendChild(row);
    updateModalBudgetSummary();
  }

  function addExpenseRow() {
      const table = document.getElementById('proposedExpensesTable');
      if (!table) {
          console.log("proposedExpensesTable not found");
          return;
      }
      
      const tbody = table.querySelector('tbody');
      if (!tbody) return;
      
      const row = document.createElement('tr');
      row.className = 'expense-row';
      row.innerHTML = `
          <td><input type="text" class="form-control form-control-sm expense-desc" placeholder="e.g., Food, Venue, Materials" required>
          <td><input type="number" class="form-control form-control-sm text-center expense-qty" min="1" value="1" required>
          <td><input type="number" class="form-control form-control-sm text-end expense-unit-price" min="0" step="0.01" placeholder="0.00" required>
          <td class="text-end expense-total fw-semibold">₱0.00
          <td><input type="text" class="form-control form-control-sm expense-notes" placeholder="Optional notes">
          <td class="text-center">
              <button type="button" class="btn btn-link btn-sm text-danger p-0 expense-remove" title="Remove">
                  <i class="bi bi-trash"></i>
              </button>
          
      `;
      
      const qtyInput = row.querySelector('.expense-qty');
      const priceInput = row.querySelector('.expense-unit-price');
      const totalCell = row.querySelector('.expense-total');
      const removeBtn = row.querySelector('.expense-remove');
      
      function updateTotal() {
          const qty = parseInt(qtyInput.value) || 0;
          const price = parseFloat(priceInput.value) || 0;
          const total = qty * price;
          totalCell.textContent = money(total);
          updateModalBudgetSummary();
          console.log(`Expense updated: qty=${qty}, price=${price}, total=${total}`);
      }
      
      qtyInput.addEventListener('input', updateTotal);
      priceInput.addEventListener('input', updateTotal);
      
      removeBtn.addEventListener('click', function() {
          row.remove();
          updateModalBudgetSummary();
      });
      
      tbody.appendChild(row);
      updateTotal();
  }

  function updateModalBudgetSummary() {
    console.log("=== UPDATE MODAL BUDGET SUMMARY ===");
    
    // Calculate credits total from #proposedCreditsTable
    const creditTable = document.getElementById('proposedCreditsTable');
    let creditsTotal = 0;
    
    if (creditTable) {
        const creditRows = creditTable.querySelectorAll('tbody tr');
        console.log("Credit rows found:", creditRows.length);
        
        creditRows.forEach((row, idx) => {
            const amountInput = row.querySelector('.credit-amount');
            if (amountInput) {
                const amount = parseFloat(amountInput.value) || 0;
                console.log(`Credit row ${idx}: amount = ${amount}`);
                creditsTotal += amount;
            }
        });
    } else {
        console.log("proposedCreditsTable not found");
    }
    
    // Calculate expenses total from #proposedExpensesTable
    const expenseTable = document.getElementById('proposedExpensesTable');
    let expensesTotal = 0;
    
    if (expenseTable) {
        const expenseRows = expenseTable.querySelectorAll('tbody tr');
        console.log("Expense rows found:", expenseRows.length);
        
        expenseRows.forEach((row, idx) => {
            const qtyInput = row.querySelector('.expense-qty');
            const priceInput = row.querySelector('.expense-unit-price');
            
            if (qtyInput && priceInput) {
                const qty = parseInt(qtyInput.value) || 0;
                const price = parseFloat(priceInput.value) || 0;
                const total = qty * price;
                console.log(`Expense row ${idx}: qty=${qty}, price=${price}, total=${total}`);
                expensesTotal += total;
            }
        });
    } else {
        console.log("proposedExpensesTable not found");
    }
    
    const balance = creditsTotal - expensesTotal;
    
    console.log("Totals - Credits:", creditsTotal, "Expenses:", expensesTotal, "Balance:", balance);
    
    // Update DOM elements
    const creditsEl = document.getElementById('modalProposedCreditsTotal');
    const expensesEl = document.getElementById('modalProposedExpensesTotal');
    const balanceEl = document.getElementById('modalProposedBalance');
    const balanceBox = document.getElementById('modalBalanceBox');
    const warningEl = document.getElementById('modalBalanceWarning');
    const warningAmount = document.getElementById('modalWarningAmount');
    
    if (creditsEl) creditsEl.textContent = money(creditsTotal);
    if (expensesEl) expensesEl.textContent = money(expensesTotal);
    if (balanceEl) balanceEl.textContent = money(balance);
    
    if (balanceBox) {
        balanceBox.style.backgroundColor = balance >= 0 ? '#d4edda' : '#f8d7da';
        balanceBox.style.borderColor = balance >= 0 ? '#c3e6cb' : '#f5c6cb';
    }
    
    if (warningEl && warningAmount) {
        if (balance < 0) {
            warningEl.classList.remove('d-none');
            warningAmount.textContent = money(Math.abs(balance));
        } else {
            warningEl.classList.add('d-none');
        }
    }
  }

  function collectCreditItems() {
  const rows = document.querySelectorAll('#creditTbody tr');
  const items = [];
  
  rows.forEach(row => {
    const date = row.querySelector('.credit-date')?.value;
    const source = row.querySelector('.credit-source')?.value?.trim();
    const amount = parseFloat(row.querySelector('.credit-amount')?.value) || 0;
    const notes = row.querySelector('.credit-notes')?.value?.trim() || '';
    
    if (date && source && amount > 0) {
      items.push({
        date: date,
        source: source,
        amount: amount,
        notes: notes
      });
    }
  });
  
  return items;
  }

    // In collectDebitItems
  function collectDebitItems() {
    const rows = document.querySelectorAll('#debitTbody tr');
    const items = [];
    
    rows.forEach((row, index) => {
      // Get the actual DOM elements
      const descEl = row.querySelector('.debit-desc');
      const dateEl = row.querySelector('.debit-date');
      const categoryEl = row.querySelector('.debit-category');
      const qtyEl = row.querySelector('.debit-qty');
      const unitPriceEl = row.querySelector('.debit-unit-price');
      const receiptNoEl = row.querySelector('.debit-receipt-no');
      const receiptFileEl = row.querySelector('.debit-receipt');
      
      // DEBUG: Check if elements exist
      console.log("=== ELEMENT CHECK ===", index);
      console.log("descEl exists:", !!descEl);
      console.log("dateEl exists:", !!dateEl);
      console.log("categoryEl exists:", !!categoryEl);
      console.log("qtyEl exists:", !!qtyEl);
      console.log("unitPriceEl exists:", !!unitPriceEl);
      console.log("receiptNoEl exists:", !!receiptNoEl);
      console.log("receiptFileEl exists:", !!receiptFileEl);
      
      // Get values
      const desc = descEl?.value?.trim();
      const date = dateEl?.value;
      const category = categoryEl?.value;
      const qty = parseInt(qtyEl?.value) || 0;
      const unitPrice = parseFloat(unitPriceEl?.value) || 0;
      const receiptNo = receiptNoEl?.value?.trim();
      const receiptFile = receiptFileEl?.files?.[0];
      
      console.log("Raw values:", {
        desc,
        date,
        category,
        qty,
        unitPrice,
        receiptNo,
        receiptFileName: receiptFile?.name
      });
      
      if (desc && date && category && qty > 0 && unitPrice > 0 && receiptNo && receiptFile) {
        items.push({
          description: desc,
          date: date,
          category: category,
          quantity: qty,
          unit_price: unitPrice,
          receipt_no: receiptNo,
          receipt_file: receiptFile,
          row_index: index
        });
      }
    });
    
    console.log("Collected debit items:", items);
    return items;
  }

  function resetAddEventForm() {
    // Clear event details
    const setVal = (id, v) => { const el = qs(id); if (el) el.value = v; };
    setVal("#aeName", "");
    setVal("#aeDate", "");
    setVal("#aeLocation", "");
    setVal("#aeDescription", "");
    
    const scopeSel = qs("#aeScope");
    const deptWrap = qs("#aeDeptWrap");
    const deptSel = qs("#aeDepartment");
    
    if (scopeSel) scopeSel.value = "general";
    if (deptSel) deptSel.value = "";
    if (deptWrap) deptWrap.classList.toggle("d-none", true);
    
    // Clear credits table
    const creditTable = document.getElementById('proposedCreditsTable');
    if (creditTable) {
        const tbody = creditTable.querySelector('tbody');
        if (tbody) {
            tbody.innerHTML = '';
        }
    }
    
    // Clear expenses table
    const expenseTable = document.getElementById('proposedExpensesTable');
    if (expenseTable) {
        const tbody = expenseTable.querySelector('tbody');
        if (tbody) {
            tbody.innerHTML = '';
        }
    }
    
    // Add one empty row to each
    addCreditRow();
    addExpenseRow();
    
    // Force summary update
    setTimeout(() => {
        updateModalBudgetSummary();
    }, 50);
    
    // Reset the modal's hidden input if any
    const aeYear = document.getElementById('aeYear');
    if (aeYear) aeYear.value = '';
  }
  // -------------------------
  // Budget Proposal Functions
  // -------------------------
  
  // Update a single row's total and validate
  function updateItemTotal(row) {
    const qtyInput = row.querySelector('.proposed-qty');
    const costInput = row.querySelector('.proposed-cost');
    const descInput = row.querySelector('.proposed-desc');
    
    const qty = parseInt(qtyInput?.value) || 0;
    const cost = parseFloat(costInput?.value) || 0;
    const total = qty * cost;
    
    const totalCell = row.querySelector('.proposed-item-total');
    if (totalCell) {
      totalCell.textContent = money(total);
    }
    
    // Validation styling
    if (descInput && descInput.value.trim() && qty > 0 && cost > 0) {
      row.style.backgroundColor = '';
      if (descInput) descInput.classList.remove('is-invalid');
      if (qtyInput) qtyInput.classList.remove('is-invalid');
      if (costInput) costInput.classList.remove('is-invalid');
    } else {
      row.style.backgroundColor = '#fff3cd';
      if (descInput && !descInput.value.trim()) descInput.classList.add('is-invalid');
      if (qtyInput && qty <= 0) qtyInput.classList.add('is-invalid');
      if (costInput && cost <= 0) costInput.classList.add('is-invalid');
    }
    
    updateFinancialSummary();
  }

  // Update row styling based on credit/debit type
  function updateRowTypeStyle(row) {
    const typeSelect = row.querySelector('.proposed-type');
    const descInput = row.querySelector('.proposed-desc');
    
    if (typeSelect && typeSelect.value === 'credit') {
      row.style.borderLeft = '3px solid #28a745';
      descInput.placeholder = 'e.g., Sponsorship, Ticket Sales, Budget';
    } else if (typeSelect) {
      row.style.borderLeft = '3px solid #dc3545';
      descInput.placeholder = 'e.g., Food, Venue, Materials (Expense)';
    }
  }

  // Update the financial summary totals
  function updateFinancialSummary() {
    // Calculate credits total - just sum the amounts
    const creditRows = document.querySelectorAll('#creditTbody tr');
    let totalCredits = 0;
    creditRows.forEach(row => {
      const amount = parseFloat(row.querySelector('.credit-amount')?.value) || 0;
      totalCredits += amount;
    });
    
    // Calculate debits total - quantity * unit price
    const debitRows = document.querySelectorAll('#debitTbody tr');
    let totalDebits = 0;
    debitRows.forEach(row => {
      const qty = parseInt(row.querySelector('.debit-qty')?.value) || 0;
      const unitPrice = parseFloat(row.querySelector('.debit-unit-price')?.value) || 0;
      totalDebits += qty * unitPrice;
    });
    
    const balance = totalCredits - totalDebits;
    
    // Update UI
    const creditsEl = document.getElementById('summaryTotalCredits');
    const debitsEl = document.getElementById('summaryTotalDebits');
    const balanceEl = document.getElementById('summaryBalance');
    const balanceBox = document.getElementById('summaryBalanceBox');
    const warningEl = document.getElementById('summaryBalanceWarning');
    const warningAmount = document.getElementById('warningAmount');
    
    if (creditsEl) creditsEl.textContent = money(totalCredits);
    if (debitsEl) debitsEl.textContent = money(totalDebits);
    if (balanceEl) balanceEl.textContent = money(balance);
    
    // Style balance box
    if (balanceBox) {
      if (balance >= 0) {
        balanceBox.style.backgroundColor = '#d4edda';
        balanceBox.style.borderColor = '#c3e6cb';
      } else {
        balanceBox.style.backgroundColor = '#f8d7da';
        balanceBox.style.borderColor = '#f5c6cb';
      }
    }
    
    // Show warning if negative
    if (warningEl && warningAmount) {
      if (balance < 0) {
        warningEl.classList.remove('d-none');
        warningAmount.textContent = money(Math.abs(balance));
      } else {
        warningEl.classList.add('d-none');
      }
    }
    
    return { totalCredits, totalDebits, balance };
  }

  // Add a new budget row
  function addProposedItemRow(data = null) {
    const template = document.getElementById('proposedExpenseRowTemplate');
    const tbody = document.getElementById('proposedExpenseTbody');
    if (!template || !tbody) return;
    
    const clone = template.content.cloneNode(true);
    const row = clone.querySelector('tr');
    
    const rowId = 'prop_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    row.dataset.rowId = rowId;
    
    const descInput = row.querySelector('.proposed-desc');
    const qtyInput = row.querySelector('.proposed-qty');
    const costInput = row.querySelector('.proposed-cost');
    const typeSelect = row.querySelector('.proposed-type');
    const removeBtn = row.querySelector('.proposed-remove');
    
    if (data) {
      descInput.value = data.description || '';
      qtyInput.value = data.quantity || 1;
      costInput.value = data.estimated_cost || '';
      if (data.type) typeSelect.value = data.type;
    } else {
      qtyInput.value = 1;
      typeSelect.value = 'credit';
    }
    
    // Initialize row
    updateItemTotal(row);
    updateRowTypeStyle(row);
    
    // Event listeners
    [qtyInput, costInput].forEach(input => {
      input.addEventListener('input', () => {
        updateItemTotal(row);
        updateFinancialSummary();
      });
      input.addEventListener('blur', () => formatInputValue(input));
    });
    
    descInput.addEventListener('input', () => updateFinancialSummary());
    typeSelect.addEventListener('change', () => {
      updateRowTypeStyle(row);
      updateFinancialSummary();
    });
    
    removeBtn.addEventListener('click', () => {
      row.remove();
      updateFinancialSummary();
    });
    
    tbody.appendChild(clone);
    updateFinancialSummary();
  }

  // Format input values (e.g., cost to 2 decimal places)
  function formatInputValue(input) {
    if (!input) return;
    if (input.classList.contains('proposed-cost') && input.value) {
      const num = parseFloat(input.value);
      if (!isNaN(num)) {
        input.value = num.toFixed(2);
      }
    }
  }

  // Collect all proposed items from the table
  function collectProposedItems() {
    const rows = document.querySelectorAll('#proposedExpenseTbody tr');
    const items = [];
    
    rows.forEach(row => {
      const descInput = row.querySelector('.proposed-desc');
      const qtyInput = row.querySelector('.proposed-qty');
      const costInput = row.querySelector('.proposed-cost');
      const typeSelect = row.querySelector('.proposed-type');
      
      const desc = descInput?.value?.trim();
      const qty = parseInt(qtyInput?.value) || 0;
      const cost = parseFloat(costInput?.value) || 0;
      const type = typeSelect?.value || 'credit';
      
      if (desc && qty > 0 && cost > 0) {
        items.push({
          description: desc,
          quantity: qty,
          estimated_cost: cost,
          type: type
        });
      }
    });
    
    return items;
  }

  // Initialize the proposed expenses table with example rows
  function initProposedExpenses() {
    const template = document.getElementById('proposedExpenseRowTemplate');
    const tbody = document.getElementById('proposedExpenseTbody');
    const addBtn = document.getElementById('addProposedItemBtn');
    
    if (!template || !tbody || !addBtn) return;
    
    tbody.innerHTML = '';
    
    // Add example rows
/*    addProposedItemRow({
      description: 'Sponsorship / Fund Allocation',
      quantity: 1,
      estimated_cost: 5000,
      type: 'credit'
    });
    
    addProposedItemRow({
      description: 'Food and Refreshments',
      quantity: 50,
      estimated_cost: 100,
      type: 'debit'
    }); */
    
    if (addBtn.dataset.eeBound !== '1') {
      addBtn.dataset.eeBound = '1';
      addBtn.addEventListener('click', () => addProposedItemRow());
    }
  }

  // -------------------------
  // Bind Submit Accomplishment button
  // -------------------------
  function bindSubmitAccomplishment() {
    const btn = qs("#eeSubmitAccompBtn");
    if (!btn || btn.dataset.eeBound === "1") return;
    btn.dataset.eeBound = "1";
    
    btn.addEventListener("click", async () => {
      try {
        if (isReadOnlyMode()) throw new Error("Read-only mode.");
        
        const objectives = qs("#accompObjectivesInput")?.value.trim() || '';
        const outcomes = qs("#accompOutcomesInput")?.value.trim() || '';
        const challenges = qs("#accompChallengesInput")?.value.trim() || '';
        
        if (!objectives) throw new Error("Please enter the objectives achieved.");
        if (!outcomes) throw new Error("Please enter the outcomes/accomplishments.");
        
        const modal = qs("#eeDecisionModal");
        modal.dataset.objectives = objectives;
        modal.dataset.outcomes = outcomes;
        modal.dataset.challenges = challenges;
        
        openDecisionModal({
          action: "submit_accomplishment_report",
          title: "Submit Accomplishment Report?",
          text: "This will submit the accomplishment report for review by the coordinator.",
          confirmText: "Submit",
          confirmBtnClass: "btn-primary",
          showNoteField: false
        });
        
      } catch (e) {
        safeShowError(e.message);
      }
    });
  }

  // Bind Approve Accomplishment button (for coordinators)
  function bindApproveAccomplishment() {
    const btn = qs("#accompApproveBtn");
    if (!btn || btn.dataset.eeBound === "1") return;
    btn.dataset.eeBound = "1";
    
    btn.addEventListener("click", async () => {
      try {
        if (isReadOnlyMode()) throw new Error("Read-only mode.");
        
        openDecisionModal({
          action: "approve_accomplishment_report",
          title: "Approve Accomplishment Report?",
          text: "This will approve the accomplishment report and finalize it. This action cannot be undone.",
          confirmText: "Approve",
          confirmBtnClass: "btn-success",
          showNoteField: false
        });
        
      } catch (e) {
        safeShowError(e.message);
      }
    });
  }

  // Bind Decline Accomplishment button (for coordinators)
  function bindDeclineAccomplishment() {
    const btn = qs("#accompDeclineBtn");
    if (!btn || btn.dataset.eeBound === "1") return;
    btn.dataset.eeBound = "1";
    
    btn.addEventListener("click", async () => {
      try {
        if (isReadOnlyMode()) throw new Error("Read-only mode.");
        
        openDecisionModal({
          action: "decline_accomplishment_report",
          title: "Decline Accomplishment Report?",
          text: "This will decline the accomplishment report. Please provide a reason below.",
          confirmText: "Decline",
          confirmBtnClass: "btn-danger",
          showNoteField: true
        });
        
      } catch (e) {
        safeShowError(e.message);
      }
    });
  }

  // -------------------------
  // state
  // -------------------------
  const state = {
    terms: [],
    activeTermId: 0,
    selectedTermId: 0,

    selectedSchoolYear: "",
    selectedSemester: "",

    events: [],
    eventsFiltered: [],
    search: "",

    selectedEventId: 0,
    selectedEvent: null,

    permissions: {
      user_id: 0,
      role: "",
      can_add_event: false,
      can_add_credit: false,
      can_add_debit: false,
      can_view: true,
      is_readonly: false,
      can_print_ledger: false,
      can_print_passbook: false,
      can_print_liquidation: false,
      can_print_accomplishment: false,
      can_submit_accomplishment: false,
      can_approve_accomplishment: false,
      can_decline_accomplishment: false,
    },
    gates: {
      proposal_approved: false,
      accomplishment_approved: false,
    },

    credits: [],
    debits: [],
    ledger: [],
    passbook: [],

    myOrgs: [],

    // Proposed expenses data
    proposedCredits: [],     
    proposedExpenses: [],     
    proposedCreditsTotal: 0,
    proposedExpensesTotal: 0,
    proposedBalance: 0,

    // Accomplishment report data
    accomplishment: {
      objectives: '',
      outcomes: '',
      challenges: '',
      status: 'Draft',
      finalized: false,
      finalized_at: null,
      finalized_by: null,
      generated_pdf: null
    },
  };

  // -------------------------
  // Data loading functions
  // -------------------------
  async function loadTerms() {
    const data = await postJSON({ action: "get_terms" });

    state.terms = Array.isArray(data.terms) ? data.terms : [];
    state.activeTermId = Number(data.active_term_id || data.activeTermId || 0) || 0;

    if (!state.selectedTermId) state.selectedTermId = state.activeTermId || 0;

    if (data.permissions) state.permissions = { ...state.permissions, ...data.permissions };

    // ✅ ADD THIS DEBUG
    console.log("=== LOAD TERMS RESPONSE ===");
    console.log("my_orgs from server:", data.my_orgs);
    
    if (data.my_orgs) {
      state.myOrgs = data.my_orgs;
      console.log("State.myOrgs set to:", state.myOrgs);
    }

    renderTermFilters();
    applyGlobalRoleBadges();
    applyListGates();
  }

  async function loadEvents() {
    const termId =
      Number(state.selectedTermId || 0) ||
      Number(state.activeTermId || 0) ||
      0;

    const data = await postJSON({
      action: "list_events",
      term_id: termId,
      school_year: String(state.selectedSchoolYear || ""),
      semester: String(state.selectedSemester || ""),
      q: String(state.search || "").trim() || null,
    });

    const myOrgs = extractMyOrgs(data);
    if (Array.isArray(myOrgs)) state.myOrgs = myOrgs;

    if (data.permissions) state.permissions = { ...state.permissions, ...data.permissions };

    state.events = Array.isArray(data.events) ? data.events : [];
    state.eventsFiltered = state.events.slice();

    renderOrgOptions();
    renderCards();
    applyAddEventVisibility();
    applyListGates();
  }

  function extractMyOrgs(data) {
    const candidates = [
      data?.my_orgs,
      data?.myOrgs,
      data?.my_orgs_list,
      data?.organizations,
      data?.orgs,
      data?.officer_orgs,
      data?.officerOrgs,
      data?.permissions?.my_orgs,
      data?.permissions?.myOrgs,
    ];

    for (const c of candidates) {
      if (Array.isArray(c)) return c;
    }
    return [];
  }

  function isOfficerRole() {
    const r = String(state.permissions?.role || "").toLowerCase();

    if (r === "org_president" || r === "treasurer" || r === "org_officer" || r === "officer") return true;

    if (r === "student") {
      return Array.isArray(state.myOrgs) && state.myOrgs.length > 0;
    }

    return false;
  }

  function isCoordinator() {
    return String(state.permissions?.role || "").toLowerCase() === "faculty_admin";
  }

  function officerOrgIdsSet() {
    const orgs = Array.isArray(state.myOrgs) ? state.myOrgs : [];
    const set = new Set();
    orgs.forEach((o) => set.add(Number(o.id) || 0));
    return set;
  }

  function ownsSelectedEventOrg() {
    if (!isOfficerRole()) return true;
    const e = state.selectedEvent || {};
    const orgId = Number(e.org_id || e.orgId || 0) || 0;
    if (!orgId) return false;
    return officerOrgIdsSet().has(orgId);
  }

  function renderOrgOptions() {
    const sel = qs("#aeDepartment");
    if (!sel) return;

    const scopeSel = qs("#aeScope");
    const deptWrap = qs("#aeDeptWrap");

    const orgs = Array.isArray(state.myOrgs) ? state.myOrgs : [];

    if (!orgs.length) {
      sel.innerHTML = `<option value="" disabled selected>No organization found for your account (check officers for this term)</option>`;
      sel.disabled = true;

      if (isOfficerRole()) {
        if (scopeSel) {
          scopeSel.value = "organization";
          scopeSel.disabled = true;
          Array.from(scopeSel.options || []).forEach((opt) => {
            if (String(opt.value) !== "organization") opt.disabled = true;
          });
        }
        if (deptWrap) deptWrap.classList.remove("d-none");
      }
      return;
    }

    sel.disabled = false;
    sel.innerHTML =
      `<option value="" disabled selected>Select organization</option>` +
      orgs
        .map((o) => {
          const id = Number(o.id || o.org_id || 0) || 0;
          const label = escapeHtml(o.label || o.org_label || o.org_name || "Organization");
          return `<option value="${id}">${label}</option>`;
        })
        .join("");

    if (isOfficerRole()) {
      if (scopeSel) {
        scopeSel.value = "organization";
        scopeSel.disabled = true;
        Array.from(scopeSel.options || []).forEach((opt) => {
          if (String(opt.value) !== "organization") opt.disabled = true;
        });
      }
      if (deptWrap) deptWrap.classList.remove("d-none");
    }

    if (orgs.length === 1) {
      const onlyId = String(Number(orgs[0].id || orgs[0].org_id || 0) || "");
      sel.value = onlyId;
      sel.disabled = true;

      if (scopeSel) scopeSel.value = "organization";
      if (deptWrap) deptWrap.classList.remove("d-none");
    }
  }

  function hardHide(el, hide) {
    if (!el) return;
    el.classList.toggle("d-none", !!hide);
    el.style.display = hide ? "none" : "";
    el.style.visibility = hide ? "hidden" : "";
  }

  function applyPrintVisibility() {
    const ro = isReadOnlyMode();

    const canLedger = !!state.permissions?.can_print_ledger && !ro;
    const canPassbook = !!state.permissions?.can_print_passbook && !ro;
    const canLiqBase = !!state.permissions?.can_print_liquidation && !ro;
    const canAccompBase = !!state.permissions?.can_print_accomplishment && !ro;

    hardHide(qs("#ledgerPrintBtn"), !canLedger);
    hardHide(qs("#eePassbookPrintBtn"), !canPassbook);
    hardHide(qs("#liqPrintBtn"), !canLiqBase);
    
    setActionEnabled("#ledgerPrintBtn", canLedger, ro ? "Read-only mode." : "Not allowed.");
    setActionEnabled("#eePassbookPrintBtn", canPassbook, ro ? "Read-only mode." : "Not allowed.");

    const canLiq = canLiqBase && !!state.gates?.accomplishment_approved;
    setActionEnabled("#liqPrintBtn", canLiq, !canLiqBase ? "Not allowed." : "Locked until accomplishment is approved.");
  }

  function applyAddEventVisibility() {
    const ro = isReadOnlyMode();
    const allowed = !!state.permissions?.can_add_event;
    const canAdd = allowed && !ro;

    qsa("#btnAddEvent").forEach((el) => hardHide(el, !canAdd));
    qsa("#btnEmptyAdd").forEach((el) => hardHide(el, !canAdd));

    qsa("#btnAddEvent").forEach((el) => setActionEnabled(el, canAdd, ro ? "Read-only mode." : "Not allowed."));
    qsa("#btnEmptyAdd").forEach((el) => setActionEnabled(el, canAdd, ro ? "Read-only mode." : "Not allowed."));
  }

  function applyEventActionVisibility() {
    const ro = isReadOnlyMode();
    const proposalApproved = !!state.gates?.proposal_approved;
    const accomplishmentApproved = !!state.gates?.accomplishment_approved;
    const status = state.selectedEvent?.status || '';
    
    const isLocked = accomplishmentApproved;

    const canAddCredit = !!state.permissions?.can_add_credit && !ro && !isLocked && proposalApproved;
    const canAddDebit = !!state.permissions?.can_add_debit && !ro && !isLocked && proposalApproved;
    const canManagePassbook = !!state.permissions?.can_manage_passbook && !ro && !isLocked && proposalApproved;
    const canSubmitForApproval = !!state.permissions?.can_submit_for_approval && !ro && !isLocked && (status === 'Draft' || status === 'Declined');
    const canDelete = !!state.permissions?.can_delete && !ro && !isLocked;

    hardHide(qs("#fundAddBtn"), !canAddCredit);
    hardHide(qs("#debitAddBtn"), !canAddDebit);
    hardHide(qs("#eeAddTxnBtn"), !canManagePassbook);
    hardHide(qs("#eeSubmitForApprovalBtn"), !canSubmitForApproval);

    setActionEnabled("#fundAddBtn", canAddCredit, 
      isLocked ? "🔒 Event is already finalized (Accomplishment Approved)" : 
      (!proposalApproved ? "❌ Proposal must be approved first" : 
      (ro ? "🔒 Read-only mode." : "")));

    setActionEnabled("#debitAddBtn", canAddDebit,
      isLocked ? "🔒 Event is already finalized (Accomplishment Approved)" : 
      (!proposalApproved ? "❌ Proposal must be approved first" : 
      (ro ? "🔒 Read-only mode." : "")));

    setActionEnabled("#eeAddTxnBtn", canManagePassbook,
      isLocked ? "🔒 Event is already finalized (Accomplishment Approved)" : 
      (!proposalApproved ? "❌ Proposal must be approved first" : 
      (ro ? "🔒 Read-only mode." : "")));

    setActionEnabled("#eeSubmitForApprovalBtn", canSubmitForApproval,
      isLocked ? "🔒 Event is already finalized" : 
      (ro ? "🔒 Read-only mode." : 
      (status !== 'Draft' && status !== 'Declined' ? "❌ Can only submit Draft or Declined events" : "")));

    const canPrintLedger = !!state.permissions?.can_print_ledger;
    const canPrintPassbook = !!state.permissions?.can_print_passbook;
    const canPrintLiqBase = !!state.permissions?.can_print_liquidation;

    hardHide(qs("#ledgerPrintBtn"), !canPrintLedger);
    hardHide(qs("#eePassbookPrintBtn"), !canPrintPassbook);
    hardHide(qs("#liqPrintBtn"), !(canPrintLiqBase && accomplishmentApproved));

    setActionEnabled("#ledgerPrintBtn", canPrintLedger, "Not allowed.");
    setActionEnabled("#eePassbookPrintBtn", canPrintPassbook, "Not allowed.");
  }

  // -------------------------
  // term UI
  // -------------------------
  function uniq(arr) { return Array.from(new Set(arr)); }

  function termLabel(t) {
    const sy = String(t?.school_year ?? "");
    const sem = String(t?.semester ?? "");
    return `${sy} • ${sem}`.trim();
  }

  function computeSelectedTermFromFilters() {
    const sy = String(state.selectedSchoolYear || "").trim();
    const sem = String(state.selectedSemester || "").trim();
    if (!sy || !sem) return 0;

    const semK = semKey(sem);
    const hit = state.terms.find((t) =>
      String(t.school_year || "").trim() === sy &&
      semKey(t.semester) === semK
    );
    return hit ? Number(hit.id) || 0 : 0;
  }

  function renderTermFilters() {
    const aySel = qs("#eeAySelect");
    const semSel = qs("#eeActiveYearSelect");

    const years = uniq(state.terms.map((t) => String(t.school_year || "")).filter(Boolean)).sort();
    if (aySel) {
      aySel.innerHTML = years.map((y) => `<option value="${escapeHtml(y)}">${escapeHtml(y)}</option>`).join("");
    }

    if (!state.selectedSchoolYear) {
      const active = state.terms.find((t) => Number(t.id) === Number(state.activeTermId));
      state.selectedSchoolYear = active ? String(active.school_year || "") : (years[0] || "");
    }
    if (aySel) aySel.value = state.selectedSchoolYear;

    const sems = uniq(
      state.terms
        .filter((t) => String(t.school_year) === state.selectedSchoolYear)
        .map((t) => String(t.semester || ""))
        .filter(Boolean)
    );

    const semOrder = (s) => {
      const k = semKey(s);
      if (k === "1") return 1;
      if (k === "2") return 2;
      if (k === "summer") return 3;
      return 99;
    };
    sems.sort((a, b) => semOrder(a) - semOrder(b) || a.localeCompare(b));

    if (semSel) {
      semSel.innerHTML = sems.map((s) => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join("");
    }

    if (!state.selectedSemester) {
      const active = state.terms.find((t) => Number(t.id) === Number(state.activeTermId));
      if (active && String(active.school_year) === state.selectedSchoolYear) {
        state.selectedSemester = String(active.semester || "");
      } else {
        state.selectedSemester = sems[0] || "";
      }
    }
    if (semSel) semSel.value = state.selectedSemester;

    const termId = computeSelectedTermFromFilters();
    state.selectedTermId = termId || state.activeTermId || 0;

    const ro = qs("#eeReadOnlyBadge");
    const roMode = isReadOnlyTerm();
    setHidden(ro, !roMode);

    applyAddEventVisibility();
  }

  function bindTermFilterEvents() {
    const aySel = qs("#eeAySelect");
    const semSel = qs("#eeActiveYearSelect");

    if (aySel && aySel.dataset.eeBound !== "1") {
      aySel.dataset.eeBound = "1";
      aySel.addEventListener("change", async () => {
        state.selectedSchoolYear = String(aySel.value || "");
        state.selectedSemester = "";
        renderTermFilters();
        await loadEvents();
      });
    }

    if (semSel && semSel.dataset.eeBound !== "1") {
      semSel.dataset.eeBound = "1";
      semSel.addEventListener("change", async () => {
        state.selectedSemester = String(semSel.value || "");
        state.selectedTermId = computeSelectedTermFromFilters();
        renderTermFilters();
        await loadEvents();
      });
    }
  }

  // -------------------------
  // list rendering
  // -------------------------
  function ensureCardStyles() {
    if (document.getElementById("eeCardStyles")) return;
    const style = document.createElement("style");
    style.id = "eeCardStyles";
    style.textContent = `
      .ee-event-card .card-body{
        display:flex;
        flex-direction:column;
        min-height: 190px;
      }
      .ee-event-card .ee-card-actions{ margin-top:auto; }
      .ee-event-card .badge-top-right{
        position:absolute;
        top:12px;
        right:12px;
        z-index:2;
        display: flex;
        gap: 4px;
      }
    `;
    document.head.appendChild(style);
  }

  function ensureCardStyles2() {
    if (document.getElementById("ee-card-styles")) return;

    const style = document.createElement("style");
    style.id = "ee-card-styles";
    style.textContent = `
      #eeCardsGrid .ee-event-card {
        border-radius: 18px;
        overflow: hidden;
        background: linear-gradient(180deg, #ffffff 0%, #fbfcff 100%);
        transition: transform .18s ease, box-shadow .18s ease, border-color .18s ease;
        border: 1px solid rgba(13, 110, 253, 0.08);
        min-height: 100%;
      }

      #eeCardsGrid .ee-event-card:hover {
        transform: translateY(-4px);
        box-shadow: 0 14px 34px rgba(0, 0, 0, 0.10) !important;
      }

      #eeCardsGrid .ee-event-card .card-body {
        padding: 0;
      }

      #eeCardsGrid .ee-event-card__top {
        display: flex;
        align-items: flex-start;
        gap: 14px;
        padding: 18px 18px 12px;
        background:
          radial-gradient(circle at top right, rgba(13,110,253,0.10), transparent 35%),
          linear-gradient(180deg, rgba(13,110,253,0.04), rgba(13,110,253,0));
      }

      #eeCardsGrid .ee-event-card__avatar {
        width: 46px;
        height: 46px;
        min-width: 46px;
        border-radius: 14px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        font-weight: 700;
        font-size: 0.95rem;
        color: #0d6efd;
        background: rgba(13, 110, 253, 0.12);
        border: 1px solid rgba(13, 110, 253, 0.12);
      }

      #eeCardsGrid .ee-event-card__title-wrap {
        flex: 1;
        min-width: 0;
      }

      #eeCardsGrid .ee-event-card__title {
        font-size: 1rem;
        font-weight: 700;
        color: #1f2937;
        line-height: 1.3;
        margin-bottom: 4px;
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
        overflow: hidden;
      }

      #eeCardsGrid .ee-event-card__org {
        font-size: .875rem;
        color: #6b7280;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      #eeCardsGrid .ee-event-card__badges {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        padding: 0 18px 14px;
      }

      #eeCardsGrid .ee-badge {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        border-radius: 999px;
        padding: 7px 10px;
        font-size: .72rem;
        font-weight: 700;
        line-height: 1;
        letter-spacing: .01em;
        border: 1px solid transparent;
      }

      #eeCardsGrid .ee-badge-success {
        color: #0f5132;
        background: #d1e7dd;
        border-color: #badbcc;
      }

      #eeCardsGrid .ee-badge-warning {
        color: #664d03;
        background: #fff3cd;
        border-color: #ffecb5;
      }

      #eeCardsGrid .ee-badge-danger {
        color: #842029;
        background: #f8d7da;
        border-color: #f5c2c7;
      }

      #eeCardsGrid .ee-badge-info {
        color: #055160;
        background: #cff4fc;
        border-color: #b6effb;
      }

      #eeCardsGrid .ee-badge-secondary {
        color: #41464b;
        background: #e2e3e5;
        border-color: #d3d6d8;
      }

      #eeCardsGrid .ee-badge-dark {
        color: #fff;
        background: #495057;
        border-color: #495057;
      }

      #eeCardsGrid .ee-event-card__meta {
        display: grid;
        gap: 10px;
        padding: 0 18px 16px;
      }

      #eeCardsGrid .ee-event-card__meta-item {
        display: flex;
        align-items: flex-start;
        gap: 10px;
        padding: 11px 12px;
        border-radius: 14px;
        background: #f8fafc;
        border: 1px solid #eef2f7;
      }

      #eeCardsGrid .ee-event-card__meta-icon {
        width: 34px;
        height: 34px;
        min-width: 34px;
        border-radius: 10px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        background: #ffffff;
        border: 1px solid #e9eef5;
        color: #0d6efd;
        font-size: .95rem;
      }

      #eeCardsGrid .ee-event-card__meta-label {
        font-size: .72rem;
        font-weight: 700;
        color: #6b7280;
        text-transform: uppercase;
        letter-spacing: .04em;
        margin-bottom: 2px;
      }

      #eeCardsGrid .ee-event-card__meta-value {
        font-size: .92rem;
        font-weight: 600;
        color: #1f2937;
        line-height: 1.25;
        word-break: break-word;
      }

      #eeCardsGrid .ee-event-card__footer {
        margin-top: auto;
        padding: 0 18px 18px;
      }

      #eeCardsGrid .ee-open-btn {
        border-radius: 12px;
        font-weight: 600;
        padding: .65rem .9rem;
        box-shadow: none !important;
      }

      @media (max-width: 575.98px) {
        #eeCardsGrid .ee-event-card__top,
        #eeCardsGrid .ee-event-card__badges,
        #eeCardsGrid .ee-event-card__meta,
        #eeCardsGrid .ee-event-card__footer {
          padding-left: 14px;
          padding-right: 14px;
        }

        #eeCardsGrid .ee-event-card__title {
          font-size: .96rem;
        }
      }
    `;
    document.head.appendChild(style);
  }

  function filterEvents() {
    const q = String(state.search || "").trim().toLowerCase();
    if (!q) {
      state.eventsFiltered = state.events.slice();
      return;
    }
    state.eventsFiltered = state.events.filter((e) => {
      const t = `${e.title || ""} ${e.org_name || ""} ${e.location || ""} ${e.scope || ""}`.toLowerCase();
      return t.includes(q);
    });
  }

  function renderEmptyState() {
    setHidden(qs("#eeEmptyState"), state.eventsFiltered.length !== 0);
  }

  function renderCards() {
    ensureCardStyles();
    ensureCardStyles2();
    const grid = qs("#eeCardsGrid");
    if (!grid) return;

    filterEvents();
    renderEmptyState();

    if (state.eventsFiltered.length === 0) {
      grid.innerHTML = "";
      return;
    }

    function badgeClassStatus(status) {
      const s = String(status || "").toLowerCase();

      if (s.includes("approved")) return "ee-badge ee-badge-success";
      if (s.includes("pending") || s.includes("submitted")) return "ee-badge ee-badge-warning";
      if (s.includes("declined") || s.includes("rejected")) return "ee-badge ee-badge-danger";
      if (s.includes("draft")) return "ee-badge ee-badge-dark";

      return "ee-badge ee-badge-secondary";
    }

    function badgeClassAccomp(status) {
      const s = String(status || "").toLowerCase();

      if (s === "approved") return "ee-badge ee-badge-success";
      if (s === "submitted") return "ee-badge ee-badge-info";
      if (s === "declined" || s === "rejected") return "ee-badge ee-badge-danger";
      if (s === "draft" || s === "locked") return "ee-badge ee-badge-dark";

      return "ee-badge ee-badge-secondary";
    }

    function formatDisplayDate(raw) {
      if (!raw) return "—";
      const d = new Date(raw);
      if (Number.isNaN(d.getTime())) return escapeHtml(raw);
      return d.toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric"
      });
    }

    function initials(text) {
      const str = String(text || "").trim();
      if (!str) return "EV";
      return str
        .split(/\s+/)
        .slice(0, 2)
        .map(w => w.charAt(0).toUpperCase())
        .join("");
    }

    grid.innerHTML = state.eventsFiltered.map((e) => {
      const id = Number(e.id) || 0;
      const title = escapeHtml(e.title || e.event_name || "Untitled Event");
      const orgRaw = e.org_name || e.organization || "Unknown Organization";
      const org = escapeHtml(orgRaw);
      const date = formatDisplayDate(e.event_date || e.date || "");
      const scopeRaw = e.scope || "—";
      const scope = escapeHtml(scopeRaw);
      const statusRaw = e.status || e.event_status || "—";
      const status = escapeHtml(statusRaw);
      const accompStatusRaw = e.accomplishment_status || "—";
      const accompStatus = escapeHtml(accompStatusRaw);

      const proposalBadge = badgeClassStatus(statusRaw);
      const accompBadge = badgeClassAccomp(accompStatusRaw);

      return `
        <div class="col-12 col-md-6 col-xl-4">
          <div class="ee-event-card card h-100 border-0 shadow-sm" data-event-id="${id}">
            <div class="ee-event-card__top">
              <div class="ee-event-card__avatar">${escapeHtml(initials(orgRaw))}</div>
              <div class="ee-event-card__title-wrap">
                <div class="ee-event-card__title" title="${title}">${title}</div>
                <div class="ee-event-card__org" title="${org}">${org}</div>
              </div>
            </div>

            <div class="ee-event-card__badges">
              <span class="${proposalBadge}">
                <i class="bi bi-file-earmark-text"></i>
                <span>Proposal: ${status}</span>
              </span>
              <span class="${accompBadge}">
                <i class="bi bi-clipboard-check"></i>
                <span>Accomp: ${accompStatus}</span>
              </span>
            </div>

            <div class="ee-event-card__meta">
              <div class="ee-event-card__meta-item">
                <span class="ee-event-card__meta-icon">
                  <i class="bi bi-calendar-event"></i>
                </span>
                <div>
                  <div class="ee-event-card__meta-label">Event Date</div>
                  <div class="ee-event-card__meta-value">${escapeHtml(date)}</div>
                </div>
              </div>

              <div class="ee-event-card__meta-item">
                <span class="ee-event-card__meta-icon">
                  <i class="bi bi-diagram-3"></i>
                </span>
                <div>
                  <div class="ee-event-card__meta-label">Scope</div>
                  <div class="ee-event-card__meta-value text-capitalize">${scope}</div>
                </div>
              </div>
            </div>

            <div class="ee-event-card__footer">
              <button type="button" class="btn btn-primary btn-sm w-100 ee-open-btn" data-ee-open="${id}">
                <i class="bi bi-folder2-open me-1"></i>Open Event
              </button>
            </div>
          </div>
        </div>
      `;
    }).join("");

    qsa("[data-ee-open]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = Number(btn.getAttribute("data-ee-open") || 0);
        if (!id) return;
        await openEvent(id);
      });
    });
  }

  // -------------------------
  // event rendering
  // -------------------------
  function deriveStatusesFromEvent(e) {
    const proposalStatus =
      String(
        e?.proposal_status ??
        e?.proposalStatus ??
        e?.proposal ??
        e?.status ??
        e?.event_status ??
        ""
      ).trim();

    const accompStatus =
      String(
        e?.accomplishment_status ??
        e?.accomplishmentStatus ??
        e?.accomplishment ??
        ""
      ).trim();

    return {
      proposal: proposalStatus,
      accomplishment: accompStatus,
      proposalLc: proposalStatus.toLowerCase(),
      accomplishmentLc: accompStatus.toLowerCase(),
    };
  }

  function isEventApprovedLocked(ev = null) {
    const e = ev || state.selectedEvent || {};
    const st = deriveStatusesFromEvent(e);
    return st.accomplishmentLc === "approved";
  }

  function setGateBadges() {
    const p = !!state.gates.proposal_approved;
    const a = !!state.gates.accomplishment_approved;
    const status = state.selectedEvent?.status || '';
    const accompStatus = state.accomplishment?.status || 'Draft';

    console.log("[GateBadges] Proposal approved:", p, "Accomplishment approved:", a, "Accomp status:", accompStatus);

    setHidden(qs("#eeProposalGateBadge"), p);
    setHidden(qs("#eeAccompGateBadge"), a);
    setHidden(qs("#eeUnlockedBadge"), !(p && a));

    const banner = qs("#eeEventGateBanner");
    const txt = qs("#eeEventGateText");

    if (status === 'Draft') {
      setHidden(banner, false);
      if (txt) txt.textContent = "📝 This event is in DRAFT mode. Submit for approval to proceed.";
    } else if (status === 'Submitted') {
      setHidden(banner, false);
      if (txt) txt.textContent = "⏳ This event is PENDING APPROVAL. Please wait for reviewer action.";
    } else if (!p) {
      setHidden(banner, false);
      if (txt) txt.textContent = "⚠️ Proposal is not approved yet. You cannot add funds or expenses until the proposal is approved.";
    } else if (!a) {
      setHidden(banner, false);
      if (txt) txt.textContent = "✅ Proposal approved. You can now add funds and expenses. The liquidation report becomes available after accomplishment is approved.";
    } else {
      setHidden(banner, true);
    }

    const fundsLock = qs("#eeFundsLock");
    const fundsLockText = qs("#eeFundsLockText");
    const debitsLock = qs("#eeDebitsLock");
    const debitsLockText = qs("#eeDebitsLockText");

    if (!p) {
      setHidden(fundsLock, false);
      setHidden(debitsLock, false);
      if (fundsLockText) fundsLockText.textContent = "❌ Proposal must be approved first before adding funds.";
      if (debitsLockText) debitsLockText.textContent = "❌ Proposal must be approved first before adding expenses.";
    } else if (a) {
      setHidden(fundsLock, false);
      setHidden(debitsLock, false);
      if (fundsLockText) fundsLockText.textContent = "🔒 Event is already finalized. No further changes allowed.";
      if (debitsLockText) debitsLockText.textContent = "🔒 Event is already finalized. No further changes allowed.";
    } else {
      setHidden(fundsLock, true);
      setHidden(debitsLock, true);
    }

    const liqLock = qs("#eeLiqLock");
    const liqLockText = qs("#eeLiqLockText");
    
    setHidden(liqLock, a);
    
    if (!a) {
      if (liqLockText) liqLockText.textContent = "📄 Liquidation report becomes available AFTER the accomplishment report is approved.";
      hardHide(qs("#liqPrintBtn"), true);
    } else {
      hardHide(qs("#liqPrintBtn"), false);
    }

    const accompLock = qs("#eeAccompLock");
    const accompLockText = qs("#eeAccompLockText");
    
    setHidden(accompLock, p);
    
    if (!p) {
      if (accompLockText) accompLockText.textContent = "📝 This report becomes available AFTER the event proposal is approved.";
    }

    const accompStatusAlert = qs("#accompStatusAlert");
    const accompStatusText = qs("#accompStatusText");

    if (accompStatusAlert && accompStatusText) {
      const isAccomplishmentApproved = !!state.gates?.accomplishment_approved;
      
      console.log("[GateBadges] Accomplishment check:", {
        gatesApproved: isAccomplishmentApproved,
        stateStatus: state.accomplishment?.status,
        proposalApproved: p
      });

      if (!p) {
        accompStatusAlert.className = "alert alert-warning py-2 mb-3 small";
        accompStatusAlert.style.display = "block";
        accompStatusText.textContent = "🔒 Accomplishment report is locked. Event proposal must be approved first.";
      } 
      else if (isAccomplishmentApproved) {
        console.log("[GateBadges] Accomplishment is approved - HIDING alert");
        accompStatusAlert.style.display = "none";
      } 
      else {
        const currentStatus = state.accomplishment?.status || 'Draft';
        console.log("[GateBadges] Showing alert for status:", currentStatus);
        
        switch (currentStatus) {
          case "Submitted":
            accompStatusAlert.className = "alert alert-info py-2 mb-3 small";
            accompStatusAlert.style.display = "block";
            accompStatusText.textContent = "⏳ Accomplishment report is pending review by the coordinator.";
            break;
          case "Declined":
            accompStatusAlert.className = "alert alert-danger py-2 mb-3 small";
            accompStatusAlert.style.display = "block";
            accompStatusText.textContent = "❌ Accomplishment report was declined. Please revise and resubmit.";
            break;
          default:
            accompStatusAlert.className = "alert alert-secondary py-2 mb-3 small";
            accompStatusAlert.style.display = "block";
            accompStatusText.textContent = "📝 Accomplishment report is in draft mode. Click 'Submit for Review' when complete.";
        }
      }
    }

    applyEventActionVisibility();
    applyAccomplishmentSubmitButton();
  }

  function applyApprovalButtons() {
    const wrap = qs("#eeApprovalWrap");
    if (!wrap) return;

    const e = state.selectedEvent || {};
    const role = state.permissions.role || "";
    const approver = isApproverRole(role);
    const ro = isReadOnlyMode();

    if (!approver || ro) {
      setHidden(wrap, true);
      return;
    }

    const st = deriveStatusesFromEvent(e);
    const status = e.status || '';

    const proposalApproved = (state.gates.proposal_approved != null)
      ? !!state.gates.proposal_approved
      : (st.proposalLc === "approved");

    const accompApproved = (state.gates.accomplishment_approved != null)
      ? !!state.gates.accomplishment_approved
      : (st.accomplishmentLc === "approved");

    const proposalNeedsDecision = !proposalApproved && status === 'Submitted';
    const accompNeedsDecision = proposalApproved && !accompApproved && st.accomplishmentLc === 'submitted';

    const apProp = qs("#eeApproveProposalBtn");
    const dcProp = qs("#eeDeclineProposalBtn");
    const apAcc = qs("#eeApproveAccompBtn");
    const dcAcc = qs("#eeDeclineAccompBtn");

    setHidden(apProp, !proposalNeedsDecision);
    setHidden(dcProp, !proposalNeedsDecision);
    setHidden(apAcc, !accompNeedsDecision);
    setHidden(dcAcc, !accompNeedsDecision);

    const anyVisible = [apProp, dcProp, apAcc, dcAcc].some((x) => x && !x.classList.contains("d-none"));
    setHidden(wrap, !anyVisible);
  }

  // -------------------------
  // accomplishment submit UI (officer)
  // -------------------------
  function applyAccomplishmentSubmitButton() {
    const btn = qs("#eeSubmitAccompBtn");
    if (!btn) return;

    const ro = isReadOnlyMode();
    const proposalApproved = state.gates?.proposal_approved || false;
    const status = state.accomplishment?.status || 'Draft';
    
    const canSubmit = proposalApproved && !ro && isOfficerRole() && 
                      (status === 'Draft' || status === 'Declined');
    
    setHidden(btn, !canSubmit);
  }

  function bindAccomplishmentPrint() {
    const btn = qs("#eePrintAccompBtn");
    if (!btn || btn.dataset.eeBound === "1") return;
    btn.dataset.eeBound = "1";
    
    btn.addEventListener("click", () => {
      const eventId = Number(state.selectedEventId || 0);
      if (!eventId) return safeShowError("No event selected.");
      
      const status = state.accomplishment?.status || 'Draft';
      const isCoord = isCoordinator();
      
      if ((status === 'Draft' || status === 'Submitted') && !isCoord) {
        return safeShowError("Printing is not available until the report is approved.");
      }
      
      const url = buildUrl(PRINT_ACCOMPLISHMENT, {
        event_id: eventId,
        term_id: Number(state.selectedTermId || 0) || null,
        preview: (status !== 'Approved' && isCoord) ? '1' : '0'
      });
      openNewTab(url);
    });
  }

  function renderAccomplishment() {
    const e = state.selectedEvent || {};
    const accomp = state.accomplishment || {};
    
    const proposalApproved = !!state.gates?.proposal_approved;
    const isAccomplishmentApproved = !!state.gates?.accomplishment_approved;
    
    const status = isAccomplishmentApproved ? 'Approved' : (accomp.status || 'Draft');
    
    const isCoord = isCoordinator();
    const canSubmit = !!state.permissions?.can_submit_accomplishment;
    const canApprove = !!state.permissions?.can_approve_accomplishment;
    const canDecline = !!state.permissions?.can_decline_accomplishment;
    const canPrintBase = !!state.permissions?.can_print_accomplishment;

    console.log("[Accomplishment] Rendering with status:", status, "Gates approved:", isAccomplishmentApproved);

    // Basic event info
    const elEvent = qs("#accompEvent");
    const elOrg = qs("#accompOrg");
    const elVenue = qs("#accompVenue");
    const elDate = qs("#accompDate");
    const elYear = qs("#accompYear");
    const elSem = qs("#accompSemester");
    const elDesc = qs("#accompDescription");

    if (elEvent) elEvent.textContent = e.title || e.event_name || "—";
    if (elOrg) elOrg.textContent = e.org_name || e.organization || "—";
    if (elVenue) elVenue.textContent = e.location || "—";
    if (elDate) {
      elDate.textContent = e.event_date
        ? new Date(e.event_date).toLocaleDateString("en-US", {
            year: "numeric",
            month: "long",
            day: "numeric"
          })
        : "—";
    }
    if (elYear) elYear.textContent = e.school_year || "—";
    if (elSem) elSem.textContent = e.semester || "—";
    if (elDesc) elDesc.textContent = e.description || e.event_description || "No description provided.";

    // Objectives / outcomes / challenges - NO MORE LOREM IPSUM DEFAULTS
    const objectivesText = String(accomp.objectives || "").trim();
    const outcomesText = String(accomp.outcomes || "").trim();
    const challengesText = String(accomp.challenges || "").trim();

    const objectivesInput = qs("#accompObjectivesInput");
    const outcomesInput = qs("#accompOutcomesInput");
    const challengesInput = qs("#accompChallengesInput");

    const objectivesView = qs("#accompObjectivesView");
    const outcomesView = qs("#accompOutcomesView");
    const challengesView = qs("#accompChallengesView");

    const objectivesEdit = qs("#accompObjectivesEdit");
    const outcomesEdit = qs("#accompOutcomesEdit");
    const challengesEdit = qs("#accompChallengesEdit");

    const isEditable =
      proposalApproved &&
      !isReadOnlyMode() &&
      isOfficerRole() &&
      !isAccomplishmentApproved &&
      (status === "Draft" || status === "Declined");

    if (objectivesInput) objectivesInput.value = objectivesText;
    if (outcomesInput) outcomesInput.value = outcomesText;
    if (challengesInput) challengesInput.value = challengesText;

    if (objectivesView) {
      objectivesView.innerHTML = objectivesText
        ? objectivesText
            .split("\n")
            .filter(line => line.trim())
            .map(line => `<div>• ${escapeHtml(line)}</div>`)
            .join("")
        : `<span class="text-muted">No objectives recorded.</span>`;
    }

    if (outcomesView) {
      outcomesView.innerHTML = outcomesText
        ? outcomesText
            .split("\n")
            .filter(line => line.trim())
            .map(line => `<div>• ${escapeHtml(line)}</div>`)
            .join("")
        : `<span class="text-muted">No outcomes recorded.</span>`;
    }

    if (challengesView) {
      challengesView.innerHTML = challengesText
        ? challengesText
            .split("\n")
            .filter(line => line.trim())
            .map(line => `<div>${escapeHtml(line)}</div>`)
            .join("")
        : `<span class="text-muted">No challenges recorded.</span>`;
    }

    setHidden(objectivesEdit, !isEditable);
    setHidden(outcomesEdit, !isEditable);
    setHidden(challengesEdit, !isEditable);

    setHidden(objectivesView, isEditable);
    setHidden(outcomesView, isEditable);
    setHidden(challengesView, isEditable);

    // Financial summary
    const credits = Number(e.total_credits ?? 0);
    const debits = Number(e.total_debits ?? 0);
    const proposedCredits = state.proposedCreditsTotal || 0;
    const proposedExpenses = state.proposedExpensesTotal || 0;
    const proposedBalance = proposedCredits - proposedExpenses;
    const actualBalance = credits - debits;

    const elProposedCredits = qs("#accompProposedCredits");
    const elProposedExpenses = qs("#accompProposedExpenses");
    const elProposedBalance = qs("#accompProposedBalance");
    const elActualCredits = qs("#accompActualCredits");
    const elActualTotal = qs("#accompActualTotal");
    const elBalance = qs("#accompBalance");
    const elBalanceBox = qs("#accompBalanceBox");

    if (elProposedCredits) elProposedCredits.textContent = money(proposedCredits);
    if (elProposedExpenses) elProposedExpenses.textContent = money(proposedExpenses);
    if (elProposedBalance) elProposedBalance.textContent = money(proposedBalance);
    if (elActualCredits) elActualCredits.textContent = money(credits);
    if (elActualTotal) elActualTotal.textContent = money(debits);
    if (elBalance) elBalance.textContent = money(actualBalance);

    if (elBalanceBox) {
        if (actualBalance >= 0) {
            elBalanceBox.style.backgroundColor = "#d4edda";
            elBalanceBox.style.borderColor = "#c3e6cb";
        } else {
            elBalanceBox.style.backgroundColor = "#f8d7da";
            elBalanceBox.style.borderColor = "#f5c6cb";
        }
    }

    // Buttons
    const showSubmitButton =
      canSubmit &&
      proposalApproved &&
      !isReadOnlyMode() &&
      isOfficerRole() &&
      !isAccomplishmentApproved &&
      (status === "Draft" || status === "Declined");

    setHidden(qs("#eeSubmitAccompBtn"), !showSubmitButton);

    setHidden(qs("#accompApproveBtn"), !(canApprove && status === "Submitted" && !isAccomplishmentApproved));
    setHidden(qs("#accompDeclineBtn"), !(canDecline && status === "Submitted" && !isAccomplishmentApproved));

    let showPrintButton = false;
    if (canPrintBase && proposalApproved) {
      if (status === "Approved" || isAccomplishmentApproved) {
        showPrintButton = true;
      } else if ((status === "Draft" || status === "Submitted" || status === "Declined") && isCoord) {
        showPrintButton = true;
      }
    }
    setHidden(qs("#eePrintAccompBtn"), !showPrintButton);

    const approvalWrapper = qs("#accompApprovalButtons");
    if (approvalWrapper) {
      const approveHidden = qs("#accompApproveBtn")?.classList.contains("d-none");
      const declineHidden = qs("#accompDeclineBtn")?.classList.contains("d-none");
      setHidden(approvalWrapper, !!approveHidden && !!declineHidden);
    }

    // Status alert
    const alert = qs("#accompStatusAlert");
    const alertText = qs("#accompStatusText");

    if (alert && alertText) {
      if (!proposalApproved) {
        alert.className = "alert alert-warning py-2 mb-3 small";
        alert.style.display = "block";
        alertText.textContent = "Accomplishment report is locked. Event proposal must be approved first.";
      } else if (isAccomplishmentApproved) {
        alert.style.display = "none";
      } else {
        switch (status) {
          case "Submitted":
            alert.className = "alert alert-info py-2 mb-3 small";
            alert.style.display = "block";
            alertText.textContent = "Accomplishment report is pending review by the coordinator.";
            break;
          case "Declined":
            alert.className = "alert alert-danger py-2 mb-3 small";
            alert.style.display = "block";
            alertText.textContent = "Accomplishment report was declined. Please revise and resubmit.";
            break;
          default:
            alert.className = "alert alert-secondary py-2 mb-3 small";
            alert.style.display = "block";
            alertText.textContent = "Accomplishment report is in draft mode. Click 'Submit for Review' when complete.";
        }
      }
    }

    // Signers + generated info
    loadAccomplishmentSigners();

    const generatedInfo = qs("#accompGeneratedInfo");
    if (generatedInfo) {
      generatedInfo.textContent = `Generated: ${new Date().toLocaleString()}`;
    }
  }

  function renderProposedBudgetComparison() {
      // ==================== PROPOSED CREDITS SECTION (Funds Tab) ====================
      const proposedCreditsTbody = qs("#proposedCreditsTbody");
      if (proposedCreditsTbody) {
          if (state.proposedCredits.length === 0) {
              proposedCreditsTbody.innerHTML = '<tr><td colspan="3" class="text-center text-muted">No proposed credits yet.</td></tr>';
          } else {
              proposedCreditsTbody.innerHTML = state.proposedCredits.map((item, idx) => `
                  <tr>
                      <td>${escapeHtml(item.description)}</td>
                      <td class="text-end fw-semibold text-success">${money(item.amount)}</td>
                      <td>${escapeHtml(item.notes || '—')}</td>
                  </tr>
              `).join('');
          }
          
          const totalProposedCreditsEl = qs("#totalProposedCredits");
          if (totalProposedCreditsEl) totalProposedCreditsEl.textContent = money(state.proposedCreditsTotal);
      }
      
      // ==================== PROPOSED EXPENSES SECTION (Expenses Tab) ====================
      const proposedDebitsTbody = qs("#proposedDebitsTbody");
      if (proposedDebitsTbody) {
          if (state.proposedExpenses.length === 0) {
              proposedDebitsTbody.innerHTML = '<tr><td colspan="5" class="text-center text-muted">No proposed expenses yet.</td></tr>';
          } else {
              proposedDebitsTbody.innerHTML = state.proposedExpenses.map((item, idx) => `
                  <tr>
                      <td>${escapeHtml(item.description)}</td>
                      <td class="text-center">${item.quantity}</td>
                      <td class="text-end">${money(item.estimated_cost)}</td>
                      <td class="text-end fw-semibold text-danger">${money(item.total)}</td>
                      <td>${escapeHtml(item.notes || '—')}</td>
                  </tr>
              `).join('');
          }
          
          const totalProposedDebitsEl = qs("#totalProposedDebits");
          if (totalProposedDebitsEl) totalProposedDebitsEl.textContent = money(state.proposedExpensesTotal);
      }
      
      // ==================== VARIANCE IN FUNDS TAB ====================
      const actualCreditsTotal = state.credits.reduce((sum, c) => sum + c.amount, 0);
      const creditVariance = actualCreditsTotal - state.proposedCreditsTotal;
      
      const varianceProposedCreditsEl = qs("#varianceProposedCredits");
      const varianceActualCreditsEl = qs("#varianceActualCredits");
      const varianceCreditsDiffEl = qs("#varianceCreditsDiff");
      
      if (varianceProposedCreditsEl) varianceProposedCreditsEl.textContent = money(state.proposedCreditsTotal);
      if (varianceActualCreditsEl) varianceActualCreditsEl.textContent = money(actualCreditsTotal);
      if (varianceCreditsDiffEl) {
          varianceCreditsDiffEl.textContent = money(creditVariance);
          varianceCreditsDiffEl.className = creditVariance >= 0 ? 'text-success' : 'text-danger';
      }
      
      // ==================== VARIANCE IN EXPENSES TAB ====================
      const actualDebitsTotal = state.debits.reduce((sum, d) => sum + d.amount, 0);
      const expenseVariance = actualDebitsTotal - state.proposedExpensesTotal;
      const variancePercent = state.proposedExpensesTotal > 0 ? (actualDebitsTotal / state.proposedExpensesTotal) * 100 : 0;
      
      const expenseVarianceProposedEl = qs("#expenseVarianceProposed");
      const expenseVarianceActualEl = qs("#expenseVarianceActual");
      const expenseVarianceDiffEl = qs("#expenseVarianceDiff");
      const expenseVarianceProgress = qs("#expenseVarianceProgress");
      const expenseVariancePercent = qs("#expenseVariancePercent");
      
      if (expenseVarianceProposedEl) expenseVarianceProposedEl.textContent = money(state.proposedExpensesTotal);
      if (expenseVarianceActualEl) expenseVarianceActualEl.textContent = money(actualDebitsTotal);
      if (expenseVarianceDiffEl) {
          expenseVarianceDiffEl.textContent = money(expenseVariance);
          expenseVarianceDiffEl.className = expenseVariance <= 0 ? 'text-success' : 'text-danger';
      }
      
      if (expenseVarianceProgress) {
          const width = Math.min(100, Math.max(0, variancePercent));
          expenseVarianceProgress.style.width = `${width}%`;
          expenseVarianceProgress.className = expenseVariance <= 0 ? 'progress-bar bg-success' : 'progress-bar bg-danger';
          if (expenseVariancePercent) expenseVariancePercent.textContent = `${width.toFixed(0)}%`;
      }
      
      // ==================== LEDGER SUMMARY ====================
      const proposedBalance = state.proposedCreditsTotal - state.proposedExpensesTotal;
      const actualBalance = actualCreditsTotal - actualDebitsTotal;
      const netVariance = actualBalance - proposedBalance;
      
      const ledgerProposedCredits = qs("#ledgerProposedCredits");
      const ledgerActualCredits = qs("#ledgerActualCredits");
      const ledgerProposedDebits = qs("#ledgerProposedDebits");
      const ledgerActualDebits = qs("#ledgerActualDebits");
      const ledgerProposedBalance = qs("#ledgerProposedBalance");
      const ledgerActualBalance = qs("#ledgerActualBalance");
      const ledgerVariance = qs("#ledgerVariance");
      
      if (ledgerProposedCredits) ledgerProposedCredits.textContent = money(state.proposedCreditsTotal);
      if (ledgerActualCredits) ledgerActualCredits.textContent = money(actualCreditsTotal);
      if (ledgerProposedDebits) ledgerProposedDebits.textContent = money(state.proposedExpensesTotal);
      if (ledgerActualDebits) ledgerActualDebits.textContent = money(actualDebitsTotal);
      if (ledgerProposedBalance) ledgerProposedBalance.textContent = money(proposedBalance);
      if (ledgerActualBalance) ledgerActualBalance.textContent = money(actualBalance);
      if (ledgerVariance) {
          ledgerVariance.textContent = money(netVariance);
          ledgerVariance.className = netVariance >= 0 ? 'text-success' : 'text-danger';
      }
      
      // ==================== VARIANCE IN OVERVIEW TAB ====================
      const varianceProposedBalanceEl = qs("#varianceProposedBalance");
      const varianceActualBalanceEl = qs("#varianceActualBalance");
      const varianceNetDiffEl = qs("#varianceNetDiff");
      
      if (varianceProposedBalanceEl) varianceProposedBalanceEl.textContent = money(proposedBalance);
      if (varianceActualBalanceEl) varianceActualBalanceEl.textContent = money(actualBalance);
      if (varianceNetDiffEl) {
          varianceNetDiffEl.textContent = money(netVariance);
          varianceNetDiffEl.className = netVariance >= 0 ? 'text-success' : 'text-danger';
      }
      
      // ==================== ACCOMPLISHMENT TAB FINANCIAL SUMMARY ====================
      const accompProposedCredits = qs("#accompProposedCredits");
      const accompProposedExpenses = qs("#accompProposedExpenses");
      const accompProposedBalance = qs("#accompProposedBalance");
      const accompActualCredits = qs("#accompActualCredits");
      const accompActualTotal = qs("#accompActualTotal");
      const accompBalance = qs("#accompBalance");
      const accompVarianceAlert = qs("#accompVarianceAlert");
      const accompVarianceText = qs("#accompVarianceText");
      
      if (accompProposedCredits) accompProposedCredits.textContent = money(state.proposedCreditsTotal);
      if (accompProposedExpenses) accompProposedExpenses.textContent = money(state.proposedExpensesTotal);
      if (accompProposedBalance) accompProposedBalance.textContent = money(proposedBalance);
      if (accompActualCredits) accompActualCredits.textContent = money(actualCreditsTotal);
      if (accompActualTotal) accompActualTotal.textContent = money(actualDebitsTotal);
      if (accompBalance) accompBalance.textContent = money(actualBalance);
      
      if (accompVarianceAlert && accompVarianceText) {
          if (netVariance > 0) {
              accompVarianceAlert.className = "alert alert-success mt-3 py-2 small";
              accompVarianceText.innerHTML = `✅ The event ended ₱${Math.abs(netVariance).toFixed(2)} UNDER budget. Good financial management!`;
          } else if (netVariance < 0) {
              accompVarianceAlert.className = "alert alert-warning mt-3 py-2 small";
              accompVarianceText.innerHTML = `⚠️ The event exceeded the budget by ₱${Math.abs(netVariance).toFixed(2)}. Please provide explanation in challenges/recommendations.`;
          } else {
              accompVarianceAlert.className = "alert alert-info mt-3 py-2 small";
              accompVarianceText.innerHTML = `✅ The event met the budget exactly. No variance.`;
          }
      }
  }

  // -------------------------
  // event submit-for-approval UI (officer)
  // -------------------------
  function applyEventSubmitForApprovalButton() {
    const btn = qs("#eeSubmitForApprovalBtn");
    if (!btn) return;

    const ro = isReadOnlyMode();
    const e = state.selectedEvent || {};
    const st = String(e.status || e.event_status || "");
    const canSubmit = !!state.permissions?.can_add_event && (!isOfficerRole() || ownsSelectedEventOrg());
    setHidden(btn, ro || !canSubmit || st !== "Draft");
  }

  function bindEventSubmitForApprovalButton() {
    const btn = qs("#eeSubmitForApprovalBtn");
    if (!btn) return;
    if (btn.dataset.eeBound === "1") return;
    btn.dataset.eeBound = "1";

    btn.addEventListener("click", async (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      try {
        if (isReadOnlyMode()) throw new Error("Read-only mode.");
        const eid = Number(state.selectedEventId || 0);
        if (!eid) throw new Error("No event selected.");

        const data = await postJSON({
          action: "submit_event_for_approval",
          event_id: eid,
        });

        safeShowSuccess(data.message || "Submitted for approval.");
        await openEvent(eid);
        await loadEvents();
      } catch (e) {
        safeShowError(e.message);
      }
    });
  }

  function renderOverview() {
    const e = state.selectedEvent || {};
    const meta = qs("#eeEventMeta");
    const title = qs("#eeEventHeaderTitle");
    const status = qs("#eeEventStatus");

    if (title) title.textContent = e.title || e.event_name || "Event";
    if (status) status.textContent = e.status || e.event_status || "—";

    const metaParts = [
      e.org_name || e.organization || "—",
      e.event_date || e.date || "—",
      (e.school_year && e.semester) ? `${e.school_year} • ${e.semester}` : "",
    ].filter(Boolean);

    if (meta) meta.textContent = metaParts.join(" · ");

    const ovOrg = qs("#ovOrg");
    const ovDate = qs("#ovDate");
    const ovYear = qs("#ovYear");
    const ovAY = qs("#ovAY");
    const ovDesc = qs("#ovDesc");

    if (ovOrg) ovOrg.textContent = e.org_name || e.organization || "—";
    if (ovDate) ovDate.textContent = e.event_date || e.date || "—";
    if (ovYear) ovYear.textContent = e.school_year || "—";
    if (ovAY) ovAY.textContent = e.semester || "—";
    if (ovDesc) ovDesc.textContent = e.description || e.event_description || "—";

    const credits = Number(e.total_credits ?? e.credits_total ?? 0);
    const debits = Number(e.total_debits ?? e.debits_total ?? 0);
    const balance = (Number.isFinite(credits) ? credits : 0) - (Number.isFinite(debits) ? debits : 0);

    const ovCredits = qs("#ovCredits");
    const ovDebits = qs("#ovDebits");
    const ovBalance = qs("#ovBalance");

    if (ovCredits) ovCredits.textContent = money(credits);
    if (ovDebits) ovDebits.textContent = money(debits);
    if (ovBalance) ovBalance.textContent = money(balance);
  }

  function renderCredits() {
    const tb = qs("#fundsTbody");
    if (!tb) return;

    const ro = isReadOnlyMode();
    const accomplishmentApproved = !!state.gates?.accomplishment_approved;
    const isLocked = accomplishmentApproved;
    const canDelete = !ro && !isLocked && !!state.permissions?.can_delete;

    if (!state.credits.length) {
      tb.innerHTML = `<tr><td colspan="5" class="text-center text-muted">No credits yet.</td></tr>`;
      return;
    }

    tb.innerHTML = state.credits.map((c) => {
      const dt = escapeHtml(c.date || c.created_at || "—");
      const src = escapeHtml(c.source || c.title || "—");
      const notes = escapeHtml(c.notes || c.description || "—");
      const amt = money(c.amount || 0);
      const creditId = Number(c.id || 0);
      
      const deleteBtn = canDelete 
        ? `<button class="btn btn-link btn-sm text-danger p-0 ee-credit-delete" data-credit-id="${creditId}" title="Delete credit">
            <i class="bi bi-trash"></i>
          </button>`
        : '';

      return `
        <tr data-credit-id="${creditId}">
          <td>${dt}</td>
          <td>${src}</td>
          <td>${notes}</td>
          <td class="text-end">${amt}</td>
          <td class="text-center">${deleteBtn}</td>
        </tr>
      `;
    }).join("");
    
    if (canDelete) {
      qsa(".ee-credit-delete").forEach(btn => {
        btn.addEventListener("click", async (e) => {
          e.preventDefault();
          e.stopPropagation();
          const creditId = btn.getAttribute("data-credit-id");
          if (!creditId) return;
          
          const modal = qs("#eeDecisionModal");
          modal.dataset.creditId = creditId;
          
          openDecisionModal({
            action: "delete_credit",
            title: "Delete Credit?",
            text: "This will permanently delete this credit. This action cannot be undone.",
            confirmText: "Delete",
            confirmBtnClass: "btn-danger",
            showNoteField: false
          });
        });
      });
    }
  }

  function renderDebits() {
    const tb = qs("#debitsTbody");
    const liqTb = qs("#liqTbody");
    if (!tb) return;

    const ro = isReadOnlyMode();
    const accomplishmentApproved = !!state.gates?.accomplishment_approved;
    const isLocked = accomplishmentApproved;
    const canDelete = !ro && !isLocked && !!state.permissions?.can_delete;

    if (!state.debits.length) {
      tb.innerHTML = `<tr><td colspan="9" class="text-center text-muted">No expenses yet.</td></tr>`;
      if (liqTb) liqTb.innerHTML = `<tr><td colspan="8" class="text-center text-muted">No items.</td></tr>`;
      return;
    }

    tb.innerHTML = state.debits.map((d) => {
      const dt = escapeHtml(d.date || d.created_at || "—");
      const cat = escapeHtml(d.category || "—");
      const notes = escapeHtml(d.notes || d.description || "—");
      const qty = escapeHtml(d.qty ?? d.quantity ?? 1);
      const unit = money(d.unit_price ?? 0);
      const amt = money(d.amount ?? 0);
      const rno = escapeHtml(d.receipt_no || d.receipt_number || "—");
      const debitId = Number(d.id || 0);

      const fileUrl = d.receipt_url || d.receipt_path || "";
      const receiptCell = fileUrl
        ? `<button type="button" class="btn btn-link btn-sm p-0" data-ee-openfile="${escapeHtml(fileUrl)}">View</button>`
        : `<span class="text-muted small">—</span>`;
      
      const deleteBtn = canDelete 
        ? `<button class="btn btn-link btn-sm text-danger p-0 ee-debit-delete" data-debit-id="${debitId}" title="Delete expense">
            <i class="bi bi-trash"></i>
          </button>`
        : '';

      return `
        <tr data-debit-id="${debitId}">
          <td>${dt}</td>
          <td>${cat}</td>
          <td>${notes}</td>
          <td class="text-center">${qty}</td>
          <td class="text-end">${unit}</td>
          <td class="text-end">${amt}</td>
          <td>${rno}</td>
          <td>${receiptCell}</td>
          <td class="text-center">${deleteBtn}</td>
        </tr>
      `;
    }).join("");

    if (liqTb) {
      liqTb.innerHTML = state.debits.map((d, idx) => {
        const dt = escapeHtml(d.date || d.created_at || "—");
        const cat = escapeHtml(d.category || "—");
        const notes = escapeHtml(d.notes || d.description || "—");
        const qty = escapeHtml(d.qty ?? d.quantity ?? 1);
        const unit = money(d.unit_price ?? 0);
        const amt = money(d.amount ?? 0);
        const rno = escapeHtml(d.receipt_no || d.receipt_number || "—");
        return `
          <tr>
            <td>${idx + 1}</td>
            <td>${dt}</td>
            <td>${cat}</td>
            <td>${notes}</td>
            <td class="text-center">${qty}</td>
            <td class="text-end">${unit}</td>
            <td class="text-end">${amt}</td>
            <td>${rno}</td>
          </tr>
        `;
      }).join("");
    }

    qsa("[data-ee-openfile]").forEach((btn) => {
      btn.addEventListener("click", () => openNewTab(btn.getAttribute("data-ee-openfile") || ""));
    });
    
    if (canDelete) {
      qsa(".ee-debit-delete").forEach(btn => {
        btn.addEventListener("click", async (e) => {
          e.preventDefault();
          e.stopPropagation();
          const debitId = btn.getAttribute("data-debit-id");
          if (!debitId) return;
          
          const modal = qs("#eeDecisionModal");
          modal.dataset.debitId = debitId;
          
          openDecisionModal({
            action: "delete_debit",
            title: "Delete Expense?",
            text: "This will permanently delete this expense. This action cannot be undone.",
            confirmText: "Delete",
            confirmBtnClass: "btn-danger",
            showNoteField: false
          });
        });
      });
    }
  }

  async function deleteCredit(creditId) {
    try {
      if (isReadOnlyMode()) throw new Error("Read-only mode.");
      if (isEventApprovedLocked()) throw new Error("Locked: this event is already approved.");
      
      const data = await postJSON({
        action: "delete_credit",
        credit_id: creditId
      });
      
      safeShowSuccess(data.message || "Credit deleted.");
      await openEvent(state.selectedEventId);
    } catch (e) {
      safeShowError(e.message);
    }
  }

  async function deleteDebit(debitId) {
    try {
      if (isReadOnlyMode()) throw new Error("Read-only mode.");
      if (isEventApprovedLocked()) throw new Error("Locked: this event is already approved.");
      
      const data = await postJSON({
        action: "delete_debit",
        debit_id: debitId
      });
      
      safeShowSuccess(data.message || "Expense deleted.");
      await openEvent(state.selectedEventId);
    } catch (e) {
      safeShowError(e.message);
    }
  }

  function renderLedger() {
    const tb = qs("#ledgerTbody");
    if (!tb) {
      console.error("[Ledger] Table body element #ledgerTbody not found!");
      return;
    }

    console.log("[Ledger] Rendering ledger with data:", state.ledger);

    if ((!state.ledger || state.ledger.length === 0) && (state.credits?.length > 0 || state.debits?.length > 0)) {
      console.log("[Ledger] Creating simple ledger from credits/debits");
      const simpleLedger = [];
      let balance = 0;
      
      state.credits.forEach(c => {
        balance += c.amount;
        simpleLedger.push({
          date: c.date,
          type: 'CREDIT',
          description: c.source + (c.notes ? ' - ' + c.notes : ''),
          credit: c.amount,
          debit: 0,
          balance: balance,
          recorded_by_name: 'User ' + (c.recorded_by || ''),
          reference: 'credit#' + c.id
        });
      });
      
      state.debits.forEach(d => {
        balance -= d.amount;
        simpleLedger.push({
          date: d.date,
          type: 'DEBIT',
          description: d.category + (d.notes ? ' - ' + d.notes : ''),
          credit: 0,
          debit: d.amount,
          balance: balance,
          recorded_by_name: 'User ' + (d.recorded_by || ''),
          reference: 'debit#' + d.id
        });
      });
      
      simpleLedger.sort((a, b) => new Date(a.date) - new Date(b.date));
      
      let runningBalance = 0;
      simpleLedger.forEach(entry => {
        runningBalance += (entry.credit || 0) - (entry.debit || 0);
        entry.balance = runningBalance;
      });
      
      state.ledger = simpleLedger;
      console.log("[Ledger] Created simple ledger:", state.ledger);
    }

    if (!state.ledger || !Array.isArray(state.ledger) || state.ledger.length === 0) {
      tb.innerHTML = `<tr><td colspan="8" class="text-center text-muted">No ledger entries found. Try adding some credits or debits first.</td></tr>`;
      return;
    }

    let totalCredits = 0;
    let totalDebits = 0;
    let finalBalance = 0;

    tb.innerHTML = state.ledger.map((x, index) => {
      const credit = typeof x.credit === 'number' ? x.credit : (typeof x.amount_in === 'number' ? x.amount_in : 0);
      const debit = typeof x.debit === 'number' ? x.debit : (typeof x.amount_out === 'number' ? x.amount_out : 0);
      const balance = typeof x.balance === 'number' ? x.balance : (typeof x.balance_after === 'number' ? x.balance_after : 0);
      
      const dt = escapeHtml(x.date || x.txn_date || "—");
      const type = escapeHtml(x.type || (credit > 0 ? 'CREDIT' : 'DEBIT') || "—");
      const desc = escapeHtml(x.description || x.notes || "—");
      const recordedBy = escapeHtml(x.recorded_by_name || x.recorded_by || "—");
      const cr = credit > 0 ? money(credit) : "—";
      const dr = debit > 0 ? money(debit) : "—";
      const bal = money(balance);
      const ref = escapeHtml(x.reference || x.ref || (x.id ? '#' + x.id : '—'));
      
      totalCredits += credit;
      totalDebits += debit;
      finalBalance = balance;

      const rowClass = balance < 0 ? 'table-danger' : '';

      return `
        <tr class="${rowClass}">
          <td>${dt}</td>
          <td><span class="badge ${type === 'CREDIT' ? 'bg-success' : 'bg-danger'}">${type}</span></td>
          <td>${desc}</td>
          <td>${recordedBy}</td>
          <td class="text-end fw-semibold text-success">${cr}</td>
          <td class="text-end fw-semibold text-danger">${dr}</td>
          <td class="text-end"><small class="text-muted">${ref}</small></td>
          <td class="text-end fw-bold ${balance < 0 ? 'text-danger' : ''}">${bal}</td>
        </tr>
      `;
    }).join("");

    const summaryRow = `
      <tr class="table-secondary fw-bold">
        <td colspan="4" class="text-end">TOTALS:</td>
        <td class="text-end text-success">${money(totalCredits)}</td>
        <td class="text-end text-danger">${money(totalDebits)}</td>
        <td class="text-end"></td>
        <td class="text-end ${finalBalance < 0 ? 'text-danger' : ''}">${money(finalBalance)}</td>
      </tr>
    `;
    tb.innerHTML += summaryRow;

    updateOverviewFinancials(totalCredits, totalDebits, finalBalance);
  }

  function showBalanceWarning(balance) {
    const existingWarning = qs("#balanceWarning");
    if (existingWarning) existingWarning.remove();
    
    if (balance < 0) {
      const warningDiv = document.createElement('div');
      warningDiv.id = 'balanceWarning';
      warningDiv.className = 'alert alert-danger mt-2 py-2 small';
      warningDiv.innerHTML = `
        <i class="bi bi-exclamation-triangle-fill me-2"></i>
        <strong>FINANCIAL WARNING:</strong> Expenses exceed funds by ₱${Math.abs(balance).toFixed(2)}. 
        This event is over budget.
      `;
      
      const overviewCard = qs("#pane-overview .row");
      if (overviewCard) {
        overviewCard.parentNode.insertBefore(warningDiv, overviewCard.nextSibling);
      }
    }
  }

  function updateOverviewFinancials(credits, debits, balance) {
    const ovCredits = qs("#ovCredits");
    const ovDebits = qs("#ovDebits");
    const ovBalance = qs("#ovBalance");

    if (ovCredits) {
      ovCredits.textContent = money(credits);
      ovCredits.className = credits > 0 ? 'fs-5 text-success' : 'fs-5';
    }
    if (ovDebits) {
      ovDebits.textContent = money(debits);
      ovDebits.className = debits > 0 ? 'fs-5 text-danger' : 'fs-5';
    }
    if (ovBalance) {
      ovBalance.textContent = money(balance);
      ovBalance.className = balance < 0 ? 'fs-5 text-danger fw-bold' : 'fs-5 text-success fw-bold';
    }
    
    showBalanceWarning(balance);
  }

  function renderPassbookLog(rows) {
    const tb = qs("#eePassbookTbody");
    if (!tb) {
      console.warn("[Passbook] Missing tbody #eePassbookTbody. Passbook section will not render.");
      return;
    }

    const proposalApproved = !!state.gates?.proposal_approved;
    const accomplishmentApproved = !!state.gates?.accomplishment_approved;
    const canManage = !!state.permissions?.can_manage_passbook;
    const ro = isReadOnlyMode();
    
    const locked = ro || !proposalApproved || accomplishmentApproved;

    const btnAdd = qs("#eeAddTxnBtn");
    if (btnAdd) {
      btnAdd.disabled = locked || !canManage;
      btnAdd.classList.toggle("disabled", locked || !canManage);
      btnAdd.title = locked ? 
        (accomplishmentApproved ? "🔒 Event is already finalized (Accomplishment Approved)" : 
         !proposalApproved ? "❌ Proposal must be approved first" : 
         "🔒 Read-only mode") : 
        "";
    }

    let totalW = 0;
    let totalD = 0;
    let runningBalance = 0;

    const passbookRows = Array.isArray(rows) ? rows : [];

    if (!passbookRows.length) {
      tb.innerHTML = `<tr><td colspan="8" class="text-center text-muted py-4">No transactions yet.</td></tr>`;
    } else {
      const sortedRows = [...passbookRows].sort((a, b) => {
        const dateA = a.date || a.txn_date || '';
        const dateB = b.date || b.txn_date || '';
        if (dateA < dateB) return -1;
        if (dateA > dateB) return 1;
        return (a.id || 0) - (b.id || 0);
      });
      
      tb.innerHTML = sortedRows.map(r => {
        const date = formatMDY(r.date || r.txn_date || "");
        const typeLabel = String(r.title || "").trim() || (String(r.type || "").toLowerCase() === "debit" ? "Withdrawal" : "Deposit");
        const fullname = String(r.recorded_by_name || "").trim() || `User #${Number(r.recorded_by_user_id || 0)}`;
        const desc = String(r.notes || "").trim() || String(r.description || "").trim();

        const w = Number(r.amount_out ?? r.debit ?? 0) || 0;
        const d = Number(r.amount_in ?? r.credit ?? 0) || 0;
        
        totalW += w;
        totalD += d;
        
        runningBalance += d - w;

        const canDeleteRow = canManage && !locked && !!r.is_manual;

        return `
          <tr data-id="${Number(r.id || 0)}">
            <td>${escapeHtml(date)}</td>
            <td>${escapeHtml(typeLabel)}</td>
            <td>${escapeHtml(fullname)}</td>
            <td>${escapeHtml(desc)}</td>
            <td class="text-end">${w > 0 ? peso(w) : "—"}</td>
            <td class="text-end">${d > 0 ? peso(d) : "—"}</td>
            <td class="text-end fw-semibold">${peso(runningBalance)}</td>
            <td class="text-center">
              ${canDeleteRow ? `<button class="btn btn-link p-0 text-danger eeTxnDel" title="Delete"><i class="bi bi-trash"></i></button>` : ``}
            </td>
          </tr>
        `;
      }).join("");
    }

    const elW = qs("#eeTxnSumWithdraw");
    const elD = qs("#eeTxnSumDeposit");
    const elB = qs("#eeTxnBalance");
    
    if (elW) elW.textContent = peso(totalW);
    if (elD) elD.textContent = peso(totalD);
    if (elB) elB.textContent = peso(runningBalance);
  }

  // -------------------------
  // Passbook Log (per-event)
  // -------------------------
  function formatMDY(ymd) {
    const s = String(ymd || "");
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return s;
    return `${m[2]}/${m[3]}/${m[1]}`;
  }

  function peso(v) {
    const n = Number(v || 0);
    const sign = n < 0 ? "-" : "";
    return `${sign}₱${fmtMoney(Math.abs(n))}`;
  }

  function bindPassbookUI() {
    const btnAdd = qs("#eeAddTxnBtn");
    const modalEl = qs("#eeTxnModal");
    const btnSave = qs("#eeTxnSaveBtn");

    let modal = null;
    if (modalEl && window.bootstrap?.Modal) {
      modal = bootstrap.Modal.getOrCreateInstance(modalEl);
    }

    function resetModal() {
      const now = new Date();
      const yyyy = now.getFullYear();
      const mm = String(now.getMonth() + 1).padStart(2, "0");
      const dd = String(now.getDate()).padStart(2, "0");
      const today = `${yyyy}-${mm}-${dd}`;

      const elDate = qs("#eeTxnDate");
      const elType = qs("#eeTxnType");
      const elDesc = qs("#eeTxnDesc");
      const elW = qs("#eeTxnWithdraw");
      const elD = qs("#eeTxnDeposit");

      if (elDate) elDate.value = today;
      if (elType) elType.value = "Bank Withdrawal";
      if (elDesc) elDesc.value = "";
      if (elW) elW.value = "";
      if (elD) elD.value = "";
    }

    async function reloadSelectedEvent() {
      const eid = Number(state.selectedEvent?.id || state.selectedEventId || 0);
      if (!eid) return;
      await openEvent(eid, { preserveTab: true });
    }

    if (btnAdd && btnAdd.dataset.eeBound !== "1") {
      btnAdd.dataset.eeBound = "1";
      btnAdd.addEventListener("click", () => {
        if (btnAdd.disabled) return;
        resetModal();
        if (modal) modal.show();
      });
    }

    if (btnSave && btnSave.dataset.eeBound !== "1") {
      btnSave.dataset.eeBound = "1";
      btnSave.addEventListener("click", async () => {
        const eid = Number(state.selectedEvent?.id || state.selectedEventId || 0);
        if (!eid) return safeShowError("No event selected.");

        if (isReadOnlyMode()) return safeShowError("Read-only mode.");
        if (isEventApprovedLocked()) return safeShowError("Locked: this event is already approved.");

        const date = String(qs("#eeTxnDate")?.value || "").trim();
        const type = String(qs("#eeTxnType")?.value || "").trim() || "Bank Withdrawal";
        const desc = String(qs("#eeTxnDesc")?.value || "").trim();

        const w = Number(qs("#eeTxnWithdraw")?.value || 0) || 0;
        const d = Number(qs("#eeTxnDeposit")?.value || 0) || 0;

        if (!date) return safeShowError("Please select a date.");
        if (w <= 0 && d <= 0) return safeShowError("Enter a withdrawal or deposit amount.");
        if (w > 0 && d > 0) return safeShowError("Enter either Withdrawal OR Deposit (not both).");

        btnSave.disabled = true;
        try {
          const reqId = (window.crypto?.randomUUID
            ? crypto.randomUUID()
            : String(Date.now()) + "-" + Math.random().toString(16).slice(2));

          const res = await api({
            action: "add_passbook_txn",
            event_id: eid,
            date,
            type,
            description: desc,
            withdrawal: w,
            deposit: d,
            request_id: reqId
          });

          if (!res || !res.success) throw new Error(res?.message || "Failed to add transaction.");

          if (modal) modal.hide();
          await reloadSelectedEvent();
          safeShowSuccess(res.message || "Transaction added.");
        } catch (e) {
          safeShowError(e.message || "Failed to add transaction.");
        } finally {
          btnSave.disabled = false;
        }
      });
    }

    if (!window.__EEPassbookDeleteBound) {
      window.__EEPassbookDeleteBound = true;

      document.addEventListener("click", async (ev) => {
        const btn = ev.target.closest?.(".eeTxnDel");
        if (!btn) return;

        const tr = btn.closest("tr");
        const pid = Number(tr?.getAttribute("data-id") || 0);
        if (!pid) return;

        if (isReadOnlyMode()) return safeShowError("Read-only mode.");
        if (isEventApprovedLocked()) return safeShowError("Locked: this event is already approved.");

        const modal = qs("#eeDecisionModal");
        modal.dataset.passbookId = pid;
        
        openDecisionModal({
          action: "delete_passbook_txn",
          title: "Delete Transaction?",
          text: "This will permanently delete this passbook transaction. This action cannot be undone.",
          confirmText: "Delete",
          confirmBtnClass: "btn-danger",
          showNoteField: false
        });
      });
    }
  }

  async function openEvent(eventId, opts = {}) {
    state.selectedEventId = Number(eventId) || 0;
    if (!state.selectedEventId) return;

    const termId = Number(state.selectedTermId || 0);

    console.log("[openEvent] Fetching event data for ID:", eventId);
    
    const data = await postJSON({
      action: "get_event",
      event_id: state.selectedEventId,
      term_id: termId,
    });

    console.log("[openEvent] Full response:", data);
    console.log("[openEvent] Ledger data:", data.ledger);
    console.log("[openEvent] Credits data:", data.credits);
    console.log("[openEvent] Debits data:", data.debits);

    state.selectedEvent = data.event || data.row || null;

    state.permissions = { ...state.permissions, ...(data.permissions || {}) };
    state.gates = { ...state.gates, ...(data.gates || {}) };
    
    console.log("[openEvent] Gates after update:", state.gates);

    if (!state.permissions.role && data.permissions?.role) {
      state.permissions.role = data.permissions.role;
    }

    applyAddEventVisibility();

    if (!data.gates && state.selectedEvent) {
      const st = deriveStatusesFromEvent(state.selectedEvent);
      state.gates.proposal_approved = st.proposalLc === "approved";
      state.gates.accomplishment_approved = st.accomplishmentLc === "approved";
    }

    // ==================== LOAD PROPOSED CREDITS ====================
    if (data.proposed_credits && Array.isArray(data.proposed_credits)) {
        state.proposedCredits = data.proposed_credits;
        state.proposedCreditsTotal = data.proposed_credits_total || 0;
    } else {
        state.proposedCredits = [];
        state.proposedCreditsTotal = 0;
    }

    // ==================== LOAD PROPOSED EXPENSES ====================
    if (data.proposed_expenses && Array.isArray(data.proposed_expenses)) {
        state.proposedExpenses = data.proposed_expenses;
        state.proposedExpensesTotal = data.proposed_expenses_total || 0;
    } else {
        state.proposedExpenses = [];
        state.proposedExpensesTotal = 0;
    }

    // Calculate proposed balance
    state.proposedBalance = state.proposedCreditsTotal - state.proposedExpensesTotal;

    const isAccomplishmentApproved = !!state.gates?.accomplishment_approved;
    
    if (data.accomplishment) {
      state.accomplishment = {
        objectives: data.accomplishment.objectives || '',
        outcomes: data.accomplishment.outcomes || '',
        challenges: data.accomplishment.challenges || '',
        status: isAccomplishmentApproved ? 'Approved' : (data.accomplishment.status || 'Draft'),
        submitted_by: data.accomplishment.submitted_by || 0,
        submitted_at: data.accomplishment.submitted_at || null,
        approved_by: data.accomplishment.approved_by || 0,
        approved_at: data.accomplishment.approved_at || null,
        declined_reason: data.accomplishment.declined_reason || '',
        generated_pdf: data.accomplishment.generated_pdf || null
      };
    } else {
      state.accomplishment = {
        objectives: '',
        outcomes: '',
        challenges: '',
        status: isAccomplishmentApproved ? 'Approved' : 'Draft',
        submitted_by: 0,
        submitted_at: null,
        approved_by: 0,
        approved_at: null,
        declined_reason: '',
        generated_pdf: null
      };
    }

    console.log("[openEvent] Loaded accomplishment:", state.accomplishment);

    state.credits = Array.isArray(data.credits) ? data.credits : [];
    state.debits = Array.isArray(data.debits) ? data.debits : [];
    state.ledger = Array.isArray(data.ledger) ? data.ledger : [];

    console.log("[openEvent] State after update:", {
      credits: state.credits.length,
      debits: state.debits.length,
      ledger: state.ledger.length
    });

    showView("event");
    renderOverview();
    applyEventActionVisibility();
    setGateBadges();
    applyPrintVisibility();
    applyApprovalButtons();
    applyAccomplishmentSubmitButton();
    applyEventSubmitForApprovalButton();
    renderCredits();
    renderDebits();
    renderLedger();
    renderProposedBudgetComparison();
    renderAccomplishment();
    renderAccomplishmentPdfPreview();
    renderLiquidation();

    const pbRows =
      (Array.isArray(data.passbook) && data.passbook) ||
      (Array.isArray(data.passbook_logs) && data.passbook_logs) ||
      (Array.isArray(data.passbookLog) && data.passbookLog) ||
      (Array.isArray(data.passbook_rows) && data.passbook_rows) ||
      [];

    state.passbook = pbRows;

    const pbPerms =
      data.passbook_permissions ||
      data.passbookPerms ||
      data.passbook_perms ||
      data.permissions ||
      {};

    renderPassbookLog(state.passbook, state.selectedEvent || {}, pbPerms);
    bindPassbookUI();
    renderLiquidationPassbook();
    
    toast("Event loaded.");
  }

  // ==================== Accomplishment Report Functions ====================

  function renderAccomplishmentPdfPreview() {
    const previewCard = qs("#accompPdfPreviewCard");
    const previewIframe = qs("#accompPdfPreview");
    const placeholder = qs("#accompPdfPlaceholder");
    const downloadBtn = qs("#accompDownloadPdfBtn");
    const refreshBtn = qs("#accompRefreshPreviewBtn");
    const statusBadge = qs("#accompPdfStatusBadge");
    
    if (!previewCard) return;
    
    const e = state.selectedEvent || {};
    const accomp = state.accomplishment || {};
    const proposalApproved = !!state.gates?.proposal_approved;
    const status = String(accomp.status || "Draft");
    const isCoord = isCoordinator();
    
    if (!proposalApproved) {
      previewCard.classList.add("d-none");
      return;
    }
    
    previewCard.classList.remove("d-none");
    
    const eventId = Number(state.selectedEventId || 0);
    if (!eventId) return;
    
    let previewMode = "preview";
    if (status === "Approved") {
      previewMode = "final";
    } else if (isCoord && (status === "Draft" || status === "Submitted" || status === "Declined")) {
      previewMode = "coordinator_preview";
    } else if (!isCoord && status !== "Approved") {
      previewCard.classList.add("d-none");
      return;
    }
    
    if (statusBadge) {
      statusBadge.textContent = status;
      statusBadge.className = "badge";
      if (status === "Approved") {
        statusBadge.classList.add("bg-success");
      } else if (status === "Submitted") {
        statusBadge.classList.add("bg-warning", "text-dark");
      } else if (status === "Declined") {
        statusBadge.classList.add("bg-danger");
      } else {
        statusBadge.classList.add("bg-secondary");
      }
    }
    
    const previewUrl = buildUrl(PRINT_ACCOMPLISHMENT, {
      event_id: eventId,
      term_id: Number(state.selectedTermId || 0) || null,
      mode: previewMode,
      _t: Date.now()
    });
    
    if (previewIframe) {
      previewIframe.src = previewUrl;
      previewIframe.classList.remove("d-none");
    }
    
    if (placeholder) {
      placeholder.classList.add("d-none");
    }
    
    if (downloadBtn) {
      downloadBtn.onclick = () => {
        const downloadUrl = buildUrl(PRINT_ACCOMPLISHMENT, {
          event_id: eventId,
          term_id: Number(state.selectedTermId || 0) || null,
          mode: previewMode,
          download: "1"
        });
        window.open(downloadUrl, "_blank");
      };
    }
    
    if (refreshBtn) {
      refreshBtn.onclick = () => {
        if (previewIframe) {
          previewIframe.src = buildUrl(PRINT_ACCOMPLISHMENT, {
            event_id: eventId,
            term_id: Number(state.selectedTermId || 0) || null,
            mode: previewMode,
            _t: Date.now()
          });
        }
      };
    }
  }

  function bindAccomplishmentPreview() {
    const refreshBtn = qs("#accompRefreshPreviewBtn");
    if (!refreshBtn || refreshBtn.dataset.eeBound === "1") return;
    refreshBtn.dataset.eeBound = "1";
    
    refreshBtn.addEventListener("click", () => {
      renderAccomplishmentPdfPreview();
    });
  }

  async function loadAccomplishmentSigners() {
    const eventId = state.selectedEventId;
    if (!eventId) return;
    
    try {
      const data = await postJSON({
        action: "get_accomplishment_signers",
        event_id: eventId
      });
      
      if (data.signers) {
        if (qs("#accompTreasurerName")) qs("#accompTreasurerName").textContent = data.signers.treasurer || '—';
        if (qs("#accompPresidentName")) qs("#accompPresidentName").textContent = data.signers.president || '—';
        if (qs("#accompCoordinatorName")) qs("#accompCoordinatorName").textContent = data.signers.coordinator || '—';
        
        if (data.signatures) {
          if (data.signatures.treasurer && qs("#accompTreasurerSig")) {
            qs("#accompTreasurerSig").innerHTML = `<img src="${data.signatures.treasurer}" class="sig-img" style="max-height: 40px;">`;
          }
          if (data.signatures.president && qs("#accompPresidentSig")) {
            qs("#accompPresidentSig").innerHTML = `<img src="${data.signatures.president}" class="sig-img" style="max-height: 40px;">`;
          }
          if (data.signatures.coordinator && qs("#accompCoordinatorSig")) {
            qs("#accompCoordinatorSig").innerHTML = `<img src="${data.signatures.coordinator}" class="sig-img" style="max-height: 40px;">`;
          }
        }
      }
      
      if (qs("#accompGeneratedInfo")) {
        qs("#accompGeneratedInfo").textContent = `Generated: ${new Date().toLocaleString()}`;
      }
    } catch (e) {
      console.warn("Failed to load signers:", e);
    }
  }

  async function loadAccomplishmentData(eventId) {
    try {
      const data = await postJSON({
        action: "get_accomplishment_data",
        event_id: eventId
      }).catch(() => null);
      
      if (data && data.accomplishment) {
        state.accomplishment = {
          objectives: data.accomplishment.objectives || '',
          outcomes: data.accomplishment.outcomes || '',
          challenges: data.accomplishment.challenges || '',
          status: data.accomplishment.status || 'Draft',
          submitted_by: data.accomplishment.submitted_by || 0,
          submitted_at: data.accomplishment.submitted_at || null,
          approved_by: data.accomplishment.approved_by || 0,
          approved_at: data.accomplishment.approved_at || null,
          declined_reason: data.accomplishment.declined_reason || ''
        };
      }
    } catch (e) {
      console.warn("Failed to load accomplishment data:", e);
    }
  }

  // ==================== Enhanced Liquidation Functions ====================

  function renderLiquidationProposed() {
    const proposedTbody = qs("#proposedBreakdownTbody");
    const proposedTotalEl = qs("#proposedBreakdownTotal");
    const liqProposedTotal = qs("#liqProposedTotal");
    const liqActualTotal = qs("#liqActualTotal");
    const liqVariance = qs("#liqVariance");
    const varianceBox = qs("#liqVarianceBox");
    
    if (!proposedTbody) return;
    
    const items = Array.isArray(state.proposedExpenses) ? state.proposedExpenses : [];
    const proposedTotal = state.proposedExpensesTotal || 0;
    
    const actualExpenses = Array.isArray(state.debits) ? state.debits.reduce((sum, entry) => sum + (entry.amount || 0), 0) : 0;
    const variance = proposedTotal - actualExpenses;
    
    console.log("[LiquidationProposed] Proposed:", proposedTotal, "Actual:", actualExpenses, "Variance:", variance);
    
    if (!items.length) {
      proposedTbody.innerHTML = '<tr><td colspan="5" class="text-center text-muted py-3">No proposed expenses submitted.</td></tr>';
    } else {
      proposedTbody.innerHTML = items.map((item, idx) => {
        const desc = escapeHtml(item.description || '—');
        const qty = Number(item.quantity || 1);
        const cost = Number(item.estimated_cost || 0);
        const total = qty * cost;
        
        return `
          <tr>
            <td>${idx + 1}</td>
            <td>${desc}</td>
            <td class="text-center">${qty}</td>
            <td class="text-end">${money(cost)}</td>
            <td class="text-end fw-semibold">${money(total)}</td>
          </tr>
        `;
      }).join('');
    }
    
    if (proposedTotalEl) proposedTotalEl.textContent = money(proposedTotal);
    if (liqProposedTotal) liqProposedTotal.textContent = money(proposedTotal);
    if (liqActualTotal) liqActualTotal.textContent = money(actualExpenses);
    
    if (liqVariance) {
      liqVariance.textContent = money(variance);
      
      if (varianceBox) {
        if (variance >= 0) {
          varianceBox.style.backgroundColor = '#d4edda';
          varianceBox.style.borderColor = '#c3e6cb';
        } else {
          varianceBox.style.backgroundColor = '#f8d7da';
          varianceBox.style.borderColor = '#f5c6cb';
        }
      }
    }
  }

  function renderLiquidationPassbook() {
    const tbody = qs("#passbookLiquidationTbody");
    const depositsEl = qs("#passbookTotalDeposits");
    const withdrawalsEl = qs("#passbookTotalWithdrawals");
    const balanceEl = qs("#passbookFinalBalance");
    
    if (!tbody) return;
    
    const rows = Array.isArray(state.passbook) ? state.passbook : [];
    
    if (!rows.length) {
      tbody.innerHTML = '<tr><td colspan="8" class="text-center text-muted py-3">No passbook transactions recorded.</td></tr>';
      return;
    }
    
    const sortedRows = [...rows].sort((a, b) => {
      const dateA = a.date || a.txn_date || '';
      const dateB = b.date || b.txn_date || '';
      if (dateA < dateB) return -1;
      if (dateA > dateB) return 1;
      return (a.id || 0) - (b.id || 0);
    });
    
    let totalDeposits = 0;
    let totalWithdrawals = 0;
    let runningBalance = 0;
    
    tbody.innerHTML = sortedRows.map((r, idx) => {
      const date = escapeHtml(r.date || r.txn_date || '—');
      const type = r.txn_type === 'credit' ? 'DEPOSIT' : 'WITHDRAWAL';
      const typeClass = r.txn_type === 'credit' ? 'text-success' : 'text-danger';
      
      const title = escapeHtml(r.title || '');
      const notes = escapeHtml(r.notes || '');
      const desc = notes ? `${title} - ${notes}` : (title || '—');
      
      const deposit = Number(r.amount_in || r.credit || 0);
      const withdrawal = Number(r.amount_out || r.debit || 0);
      
      totalDeposits += deposit;
      totalWithdrawals += withdrawal;
      runningBalance += deposit - withdrawal;
      
      const ref = escapeHtml(r.ref_table ? `${r.ref_table}#${r.ref_id}` : '—');
      
      return `
        <tr>
          <td>${idx + 1}</td>
          <td>${date}</td>
          <td class="${typeClass} fw-semibold">${type}</td>
          <td>${desc}</td>
          <td class="text-end">${deposit > 0 ? money(deposit) : '—'}</td>
          <td class="text-end">${withdrawal > 0 ? money(withdrawal) : '—'}</td>
          <td class="text-end fw-semibold">${money(runningBalance)}</td>
          <td><small class="text-muted">${ref}</small></td>
        </tr>
      `;
    }).join('');
    
    if (depositsEl) depositsEl.textContent = money(totalDeposits);
    if (withdrawalsEl) withdrawalsEl.textContent = money(totalWithdrawals);
    if (balanceEl) balanceEl.textContent = money(runningBalance);
  }

  function updateVariance() {
    const proposed = Number(state.proposedExpensesTotal || 0);
    const actual = Number(state.selectedEvent?.total_debits || 0);
    const variance = proposed - actual;
    
    const varianceEl = qs("#liqVariance");
    const actualTotalEl = qs("#liqActualTotal");
    
    if (actualTotalEl) actualTotalEl.textContent = money(actual);
    if (varianceEl) {
      varianceEl.textContent = money(variance);
      
      const box = qs("#liqVarianceBox");
      if (box) {
        if (variance >= 0) {
          box.style.backgroundColor = '#d4edda';
          box.style.borderColor = '#c3e6cb';
        } else {
          box.style.backgroundColor = '#f8d7da';
          box.style.borderColor = '#f5c6cb';
        }
      }
    }
  }

  function renderLiquidation() {
    const e = state.selectedEvent || {};
    
    const liqEvent = qs("#liqEvent");
    const liqOrg = qs("#liqOrg");
    const liqDate = qs("#liqDate");
    const liqYear = qs("#liqYear");
    const liqCredits = qs("#liqCredits");
    const liqDebits = qs("#liqDebits");
    const liqBalance = qs("#liqBalance");

    if (liqEvent) liqEvent.textContent = e.title || e.event_name || "—";
    if (liqOrg) liqOrg.textContent = e.org_name || e.organization || "—";
    if (liqDate) liqDate.textContent = e.event_date || e.date || "—";
    if (liqYear) liqYear.textContent = e.school_year || "—";
    
    const credits = Array.isArray(state.credits) ? state.credits.reduce((sum, entry) => sum + (entry.amount || 0), 0) : 0;
    const debits = Array.isArray(state.debits) ? state.debits.reduce((sum, entry) => sum + (entry.amount || 0), 0) : 0;
    const balance = credits - debits;

    const proposedCredits = state.proposedCreditsTotal || 0;
    const proposedExpenses = state.proposedExpensesTotal || 0;
    const proposedBalance = proposedCredits - proposedExpenses;
    const creditVariance = credits - proposedCredits;
    const expenseVariance = debits - proposedExpenses;
    const netVariance = (credits - debits) - (proposedCredits - proposedExpenses);

    // Update the DOM elements with these new values
    const liqProposedCredits = qs("#liqProposedCredits");
    const liqActualCredits = qs("#liqActualCredits");
    const liqCreditVariance = qs("#liqCreditVariance");
    const liqProposedExpenses = qs("#liqProposedExpenses");
    const liqActualExpenses = qs("#liqActualExpenses");
    const liqExpenseVariance = qs("#liqExpenseVariance");
    const liqProposedBalance = qs("#liqProposedBalance");
    const liqActualBalance = qs("#liqActualBalance");
    const liqNetVariance = qs("#liqNetVariance");

    if (liqProposedCredits) liqProposedCredits.textContent = money(proposedCredits);
    if (liqActualCredits) liqActualCredits.textContent = money(credits);
    if (liqCreditVariance) {
        liqCreditVariance.textContent = money(creditVariance);
        liqCreditVariance.className = creditVariance >= 0 ? 'text-success' : 'text-danger';
    }
    if (liqProposedExpenses) liqProposedExpenses.textContent = money(proposedExpenses);
    if (liqActualExpenses) liqActualExpenses.textContent = money(debits);
    if (liqExpenseVariance) {
        liqExpenseVariance.textContent = money(expenseVariance);
        liqExpenseVariance.className = expenseVariance <= 0 ? 'text-success' : 'text-danger';
    }
    if (liqProposedBalance) liqProposedBalance.textContent = money(proposedBalance);
    if (liqActualBalance) liqActualBalance.textContent = money(balance);
    if (liqNetVariance) {
        liqNetVariance.textContent = money(netVariance);
        liqNetVariance.className = netVariance >= 0 ? 'text-success' : 'text-danger';
    }
    
    console.log("[Liquidation] Credits:", credits, "Debits:", debits, "Balance:", balance);
    
    if (liqCredits) {
      liqCredits.textContent = money(credits);
      liqCredits.className = credits > 0 ? 'text-success' : '';
    }
    if (liqDebits) {
      liqDebits.textContent = money(debits);
      liqDebits.className = debits > 0 ? 'text-danger' : '';
    }
    if (liqBalance) {
      liqBalance.textContent = money(balance);
      liqBalance.className = balance < 0 ? 'text-danger fw-bold' : 'text-success fw-bold';
    }
    
    if (typeof renderLiquidationProposed === 'function') {
      renderLiquidationProposed();
    }
    if (typeof renderLiquidationPassbook === 'function') {
      renderLiquidationPassbook();
    }
  }

  // ==================== End New Functions ====================

  function applyGlobalRoleBadges() {
    const roleBadge = qs("#eeRoleBadge");
    const gateBadge = qs("#eeGateBadge");

    if (roleBadge) {
      const role = String(state.permissions.role || "").toUpperCase() || "";
      roleBadge.textContent = role || "ROLE";
      setHidden(roleBadge, !role);
    }

    if (gateBadge) {
      const term = state.terms.find((t) => Number(t.id) === Number(state.selectedTermId));
      gateBadge.textContent = term ? termLabel(term) : "TERM";
      setHidden(gateBadge, !term);
    }
  }

  function applyListGates() {
    const banner = qs("#eeListGateBanner");
    const txt = qs("#eeListGateText");

    const ro = isReadOnlyMode();

    setHidden(qs("#eeListHintBadge"), !ro);
    setHidden(banner, !ro);

    if (txt) {
      txt.textContent = ro
        ? "This page is currently in view-only mode for the selected term."
        : "—";
    }

    applyAddEventVisibility();
  }

  function closeModal(modalId) {
    const el = qs(modalId);
    if (!el || typeof bootstrap === "undefined") return;
    const inst = bootstrap.Modal.getInstance(el);
    if (inst) inst.hide();
  }

  function openModal(modalId) {
    const el = qs(modalId);
    if (!el || typeof bootstrap === "undefined") return;
    bootstrap.Modal.getOrCreateInstance(el).show();
  }

  function openDecisionModal(opts) {
    const {
      action = "",
      title = "Confirm Action",
      text = "Are you sure?",
      confirmText = "Confirm",
      confirmBtnClass = "btn-primary",
      showNoteField = true,
    } = opts || {};

    const mTitle = qs("#eeDecisionTitle");
    const mText = qs("#eeDecisionText");
    const noteField = qs("#eeDecisionNoteField");
    const hidAction = qs("#eeDecisionAction");
    const hidEventId = qs("#eeDecisionEventId");
    const btn = qs("#eeDecisionConfirmBtn");

    if (mTitle) mTitle.textContent = title;
    if (mText) mText.textContent = text;

    if (noteField) {
      noteField.classList.toggle("d-none", !showNoteField);
      if (!showNoteField) {
        const note = qs("#eeDecisionNote");
        if (note) note.value = "";
      }
    }

    if (hidAction) hidAction.value = String(action || "");
    if (hidEventId) hidEventId.value = String(state.selectedEventId || "");

    if (btn) {
      btn.textContent = confirmText;
      btn.className = `btn ${confirmBtnClass}`;
    }

    openModal("#eeDecisionModal");
  }

  function bindApprovalButtons() {
    const bind = (sel, handler) => {
      const el = qs(sel);
      if (!el || el.dataset.eeBound === "1") return;
      el.dataset.eeBound = "1";
      el.addEventListener("click", handler);
    };

    bind("#eeApproveProposalBtn", () => {
      if (!isApproverRole(state.permissions.role) || isReadOnlyMode()) return;
      openDecisionModal({
        action: "approve_proposal",
        title: "Approve Proposal?",
        text: "This will approve the event proposal and unlock the next steps for this event.",
        confirmText: "Approve",
        confirmBtnClass: "btn-success",
      });
    });

    bind("#eeDeclineProposalBtn", () => {
      if (!isApproverRole(state.permissions.role) || isReadOnlyMode()) return;
      openDecisionModal({
        action: "decline_proposal",
        title: "Decline Proposal?",
        text: "This will decline the event proposal. You can add an optional note below.",
        confirmText: "Decline",
        confirmBtnClass: "btn-danger",
      });
    });

    bind("#eeApproveAccompBtn", () => {
      if (!isApproverRole(state.permissions.role) || isReadOnlyMode()) return;
      openDecisionModal({
        action: "approve_accomplishment",
        title: "Approve Accomplishment?",
        text: "This will approve the accomplishment report and unlock liquidation printing.",
        confirmText: "Approve",
        confirmBtnClass: "btn-success",
      });
    });

    bind("#eeDeclineAccompBtn", () => {
      if (!isApproverRole(state.permissions.role) || isReadOnlyMode()) return;
      openDecisionModal({
        action: "decline_accomplishment",
        title: "Decline Accomplishment?",
        text: "This will decline the accomplishment report. You can add an optional note below.",
        confirmText: "Decline",
        confirmBtnClass: "btn-danger",
      });
    });

    const confirm = qs("#eeDecisionConfirmBtn");
    if (confirm && confirm.dataset.eeBound !== "1") {
      confirm.dataset.eeBound = "1";
      confirm.addEventListener("click", async () => {
        try {
          const hidAction = qs("#eeDecisionAction");
          const hidEventId = qs("#eeDecisionEventId");
          const note = qs("#eeDecisionNote");
          const modal = qs("#eeDecisionModal");

          const action = String(hidAction?.value || "").trim();
          const eventId = Number(hidEventId?.value || 0) || Number(state.selectedEventId || 0);
          const msg = String(note?.value || "").trim();

          if (!action) throw new Error("Missing action.");
          if (!eventId) throw new Error("Missing event id.");
          if (isReadOnlyMode()) throw new Error("Read-only mode.");

          confirm.disabled = true;

          let data;
          
          switch (action) {
            case "submit_accomplishment_report":
              if (!state.permissions?.can_submit_accomplishment) {
                throw new Error("Not allowed to submit accomplishment report.");
              }
              
              const objectives = modal.dataset.objectives || '';
              const outcomes = modal.dataset.outcomes || '';
              const challenges = modal.dataset.challenges || '';
              
              if (!objectives || !outcomes) {
                throw new Error("Objectives and outcomes are required.");
              }
              
              data = await postJSON({
                action: "submit_accomplishment_report",
                event_id: eventId,
                objectives,
                outcomes,
                challenges
              });
              break;
              
            case "approve_accomplishment_report":
              if (!state.permissions?.can_approve_accomplishment) {
                throw new Error("Not allowed to approve accomplishment reports.");
              }
              
              data = await postJSON({
                action: "approve_accomplishment_report",
                event_id: eventId
              });
              break;
              
            case "decline_accomplishment_report":
              if (!state.permissions?.can_decline_accomplishment) {
                throw new Error("Not allowed to decline accomplishment reports.");
              }
              if (!msg) throw new Error("Decline reason is required.");
              
              data = await postJSON({
                action: "decline_accomplishment_report",
                event_id: eventId,
                reason: msg
              });
              break;
              
            case "delete_credit":
              const creditId = Number(modal.dataset.creditId || 0);
              if (!creditId) throw new Error("Missing credit ID.");
              
              data = await postJSON({
                action: "delete_credit",
                credit_id: creditId
              });
              break;
              
            case "delete_debit":
              const debitId = Number(modal.dataset.debitId || 0);
              if (!debitId) throw new Error("Missing debit ID.");
              
              data = await postJSON({
                action: "delete_debit",
                debit_id: debitId
              });
              break;
              
            case "delete_passbook_txn":
              const passbookId = Number(modal.dataset.passbookId || 0);
              if (!passbookId) throw new Error("Missing transaction ID.");
              
              data = await postJSON({
                action: "delete_passbook_txn",
                passbook_id: passbookId
              });
              break;
              
            case "approve_proposal":
            case "decline_proposal":
            case "approve_accomplishment":
            case "decline_accomplishment":
              if (!isApproverRole(state.permissions.role)) {
                throw new Error("Not allowed.");
              }
              
              data = await postJSON({
                action,
                event_id: eventId,
                term_id: Number(state.selectedTermId || 0),
                note: msg || null,
              });
              break;
              
            default:
              throw new Error(`Unknown action: ${action}`);
          }

          safeShowSuccess(data.message || "Action completed successfully.");
          closeModal("#eeDecisionModal");
          
          await openEvent(eventId);
          
        } catch (e) {
          safeShowError(e.message);
        } finally {
          confirm.disabled = false;
          const modal = qs("#eeDecisionModal");
          delete modal.dataset.objectives;
          delete modal.dataset.outcomes;
          delete modal.dataset.challenges;
          delete modal.dataset.creditId;
          delete modal.dataset.debitId;
          delete modal.dataset.passbookId;
        }
      });
    }
  }

  function bindAccomplishmentSubmit() {
    // Kept for backward compatibility
  }

  function bindListEvents() {
    const search = qs("#eeSearch");
    if (search && search.dataset.eeBound !== "1") {
      search.dataset.eeBound = "1";
      let t = null;
      search.addEventListener("input", () => {
        state.search = String(search.value || "");
        clearTimeout(t);
        t = setTimeout(() => { loadEvents().catch((e) => safeShowError(e.message)); }, 250);
      });
    }

    const back = qs("#eeBackBtn");
    if (back && back.dataset.eeBound !== "1") {
      back.dataset.eeBound = "1";
      back.addEventListener("click", () => {
        state.selectedEventId = 0;
        state.selectedEvent = null;
        showView("list");
        applyAddEventVisibility();
      });
    }
  }

  function bindAddEventModal() {
  const scopeSel = qs("#aeScope");
  const deptWrap = qs("#aeDeptWrap");
  const deptSel = qs("#aeDepartment");

  if (scopeSel && deptWrap && scopeSel.dataset.eeBound !== "1") {
    scopeSel.dataset.eeBound = "1";
    scopeSel.addEventListener("change", () => {
      const v = String(scopeSel.value || "");
      deptWrap.classList.toggle("d-none", v !== "organization");
    });
  }

  // In bindAddEventModal function, replace the addEventModal event listener:
  const addEventModal = document.getElementById('addEventModal');
  if (addEventModal) {
      // Remove any existing listeners by cloning and replacing
      const newModal = addEventModal.cloneNode(true);
      addEventModal.parentNode.replaceChild(newModal, addEventModal);
      
      newModal.addEventListener('show.bs.modal', function() {
          setTimeout(() => {
              if (typeof initProposedBudgetSections === 'function') {
                  initProposedBudgetSections();
              }
          }, 100);
      });
      
      // Re-bind the modal to the variable for later use
      window.addEventModalInstance = newModal;
  }

  function enforceAddEventOrgLock() {
    const scopeSel2 = qs("#aeScope");
    const deptWrap2 = qs("#aeDeptWrap");
    const deptSel2 = qs("#aeDepartment");

    renderOrgOptions();

    if (!isOfficerRole()) {
      if (scopeSel2) {
        scopeSel2.disabled = false;
        Array.from(scopeSel2.options || []).forEach((opt) => (opt.disabled = false));
      }
      return;
    }

    if (scopeSel2) {
      scopeSel2.value = "organization";
      scopeSel2.disabled = true;
      Array.from(scopeSel2.options || []).forEach((opt) => {
        opt.disabled = (String(opt.value) !== "organization");
      });
    }

    if (deptWrap2) deptWrap2.classList.remove("d-none");

    if (deptSel2 && deptSel2.options && deptSel2.options.length > 0 && !deptSel2.value) {
      const first = Array.from(deptSel2.options).find((o) => o.value && !o.disabled);
      if (first) deptSel2.value = first.value;
    }
  }

    async function submitAddEvent(mode) {
    try {
        if (!state.permissions?.can_add_event || isReadOnlyMode()) {
            throw new Error("Not allowed.");
        }

        enforceAddEventOrgLock();

        const name = String(qs("#aeName")?.value || "").trim();
        const eventDate = String(qs("#aeDate")?.value || "").trim();
        const loc = String(qs("#aeLocation")?.value || "").trim();
        const scope = String(qs("#aeScope")?.value || "").trim();
        const orgId = Number(qs("#aeDepartment")?.value || 0) || 0;
        const desc = String(qs("#aeDescription")?.value || "").trim();

        if (!name) throw new Error("Event Name is required.");
        if (!eventDate) throw new Error("Event Date is required.");
        if (!loc) throw new Error("Location is required.");
        if (!scope) throw new Error("Scope is required.");

        if (scope === "organization" && !orgId) {
            throw new Error(isOfficerRole()
                ? "No organization found for your account (check officers for this term)."
                : "Organization is required."
            );
        }

        const schoolYear = String(state.selectedSchoolYear || "");
        const semester = String(state.selectedSemester || "");

        // Collect PROPOSED budget items from the modal
        function collectProposedBudgetItems() {
            const credits = [];
            const expenses = [];
            
            // Collect from Proposed Credits table
            const creditRows = document.querySelectorAll('#proposedCreditsTable tbody tr');
            console.log("Found credit rows:", creditRows.length);
            
            creditRows.forEach((row, index) => {
                const descInput = row.querySelector('.credit-desc');
                const amountInput = row.querySelector('.credit-amount');
                const notesInput = row.querySelector('.credit-notes');
                
                const desc = descInput?.value?.trim();
                const amount = parseFloat(amountInput?.value) || 0;
                const notes = notesInput?.value?.trim() || '';
                
                console.log(`Credit row ${index}: desc="${desc}", amount=${amount}, notes="${notes}"`);
                
                if (desc && amount > 0) {
                    credits.push({
                        description: desc,
                        amount: amount,
                        notes: notes
                    });
                } else {
                    console.log(`Credit row ${index} skipped - desc: ${desc}, amount: ${amount}`);
                }
            });
            
            // Collect from Proposed Expenses table
            const expenseRows = document.querySelectorAll('#proposedExpensesTable tbody tr');
            console.log("Found expense rows:", expenseRows.length);
            
            expenseRows.forEach((row, index) => {
                const descInput = row.querySelector('.expense-desc');
                const qtyInput = row.querySelector('.expense-qty');
                const priceInput = row.querySelector('.expense-unit-price');
                const notesInput = row.querySelector('.expense-notes');
                
                const desc = descInput?.value?.trim();
                const qty = parseInt(qtyInput?.value) || 0;
                const price = parseFloat(priceInput?.value) || 0;
                const notes = notesInput?.value?.trim() || '';
                
                console.log(`Expense row ${index}: desc="${desc}", qty=${qty}, price=${price}, notes="${notes}"`);
                
                if (desc && qty > 0 && price > 0) {
                    expenses.push({
                        description: desc,
                        quantity: qty,
                        estimated_cost: price,
                        notes: notes
                    });
                } else {
                    console.log(`Expense row ${index} skipped - desc: ${desc}, qty: ${qty}, price: ${price}`);
                }
            });
            
            console.log("Final credits:", credits);
            console.log("Final expenses:", expenses);
            console.log("Total credits:", credits.length, "Total expenses:", expenses.length);
            return { credits, expenses };
        }

        const { credits, expenses } = collectProposedBudgetItems();

        if (credits.length === 0 && expenses.length === 0) {
            throw new Error("Please add at least one proposed credit or expense item.");
        }

        // Calculate totals for warning
        const creditsTotal = credits.reduce((sum, item) => sum + item.amount, 0);
        const expensesTotal = expenses.reduce((sum, item) => sum + (item.quantity * item.estimated_cost), 0);
        const balance = creditsTotal - expensesTotal;

        if (balance < -1000) {
            if (!confirm(`Warning: The proposed budget has a deficit of ${money(Math.abs(balance))}. Are you sure you want to proceed?`)) {
                return;
            }
        }

        const formData = new FormData();
        formData.append('action', 'add_event');
        formData.append('mode', mode);
        formData.append('school_year', schoolYear);
        formData.append('semester', semester);
        formData.append('title', name);
        formData.append('event_date', eventDate);
        formData.append('location', loc);
        formData.append('scope', scope);
        if (desc) formData.append('description', desc);
        if (scope === 'organization' && orgId) formData.append('org_id', orgId);
        
        // Add proposed items as JSON
        formData.append('proposed_credits', JSON.stringify(credits));
        formData.append('proposed_expenses', JSON.stringify(expenses));
        
        console.log("Sending proposed_credits:", JSON.stringify(credits, null, 2));
        console.log("Sending proposed_expenses:", JSON.stringify(expenses, null, 2));

        const res = await fetch(API_URL, {
            method: 'POST',
            credentials: 'include',
            body: formData
        });

        const text = await res.text();
        console.log("[AddEvent] Response:", res.status, text);
        
        let data;
        try { data = JSON.parse(text); }
        catch { 
            console.error("Failed to parse response:", text);
            throw new Error("Invalid server response: " + text.substring(0, 200)); 
        }
        
        if (!res.ok) throw new Error(data?.message || `HTTP ${res.status}`);
        if (!data?.success) throw new Error(data?.message || "Request failed.");

        safeShowSuccess(data.message || "Event created with proposed budget.");
        resetAddEventForm();
        closeModal("#addEventModal");
        await loadEvents();
    } catch (e) {
        console.error("SubmitAddEvent error:", e);
        safeShowError(e.message);
    }
    }

      // Bind buttons INSIDE the function where submitAddEvent is defined
      const saveDraftBtn = qs("#aeSaveDraftBtn");
      if (saveDraftBtn && saveDraftBtn.dataset.eeBound !== "1") {
        saveDraftBtn.dataset.eeBound = "1";
        saveDraftBtn.addEventListener("click", (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          submitAddEvent("draft");
        });
      }

      const submitBtn = qs("#aeSubmitForApprovalBtn");
      if (submitBtn && submitBtn.dataset.eeBound !== "1") {
        submitBtn.dataset.eeBound = "1";
        submitBtn.addEventListener("click", (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          submitAddEvent("submit");
        });
      }

      const legacySave = qs("#aeSaveBtn");
      if (legacySave && legacySave.dataset.eeBound !== "1") {
        legacySave.dataset.eeBound = "1";
        legacySave.addEventListener("click", (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          submitAddEvent("draft");
        });
      }
    }

  function bindAddCreditModal() {
    const btn = qs("#fundAddBtn");
    if (btn && btn.dataset.eeBound !== "1") {
      btn.dataset.eeBound = "1";
      btn.addEventListener("click", () => {
        if (isReadOnlyMode()) return safeShowError("Read-only mode.");
        if (isEventApprovedLocked()) return safeShowError("Locked: this event is already approved.");
        if (!state.permissions?.can_add_credit) return safeShowError("Not allowed.");
        const hid = qs("#acEventId");
        if (hid) hid.value = String(state.selectedEventId || "");
        const el = qs("#addCreditModal");
        if (el && typeof bootstrap !== "undefined") bootstrap.Modal.getOrCreateInstance(el).show();
      });
    }

    const save = qs("#acSaveBtn");
    if (save && save.dataset.eeBound !== "1") {
      save.dataset.eeBound = "1";
      save.addEventListener("click", async () => {
        try {
          if (isReadOnlyMode()) throw new Error("Read-only mode.");
          if (isEventApprovedLocked()) throw new Error("Locked: this event is already approved.");
          if (!state.permissions.can_add_credit) throw new Error("Not allowed.");

          const date = String(qs("#acDate")?.value || "").trim();
          const source = String(qs("#acSource")?.value || "").trim();
          const amount = Number(qs("#acAmount")?.value || 0);
          const notes = String(qs("#acNotes")?.value || "").trim();

          if (!date) throw new Error("Date is required.");
          if (!source) throw new Error("Source is required.");
          if (!(amount >= 0)) throw new Error("Invalid amount.");

          const data = await postJSON({
            action: "add_credit",
            term_id: Number(state.selectedTermId || 0),
            event_id: Number(state.selectedEventId || 0),
            date,
            source,
            amount,
            notes,
          });

          safeShowSuccess(data.message || "Credit added.");
          closeModal("#addCreditModal");
          await openEvent(state.selectedEventId);
        } catch (e) {
          safeShowError(e.message);
        }
      });
    }
  }

  function bindAddDebitModal() {
    const unitEl = qs("#axUnitPrice");
    const qtyEl = qs("#axQuantity");
    const amtEl = qs("#axAmount");

    function recalcAmount() {
      if (!amtEl) return;
      const unit = Number(unitEl?.value || 0);
      const qty = Number(qtyEl?.value || 1);
      const total = (Number.isFinite(unit) ? unit : 0) * (Number.isFinite(qty) ? qty : 1);
      amtEl.value = total ? String(total.toFixed(2)) : "";
    }

    if (unitEl && unitEl.dataset.eeBound !== "1") {
      unitEl.dataset.eeBound = "1";
      unitEl.addEventListener("input", recalcAmount);
    }
    if (qtyEl && qtyEl.dataset.eeBound !== "1") {
      qtyEl.dataset.eeBound = "1";
      qtyEl.addEventListener("input", recalcAmount);
    }

    const btn = qs("#debitAddBtn");
    if (btn && btn.dataset.eeBound !== "1") {
      btn.dataset.eeBound = "1";
      btn.addEventListener("click", () => {
        if (isReadOnlyMode()) return safeShowError("Read-only mode.");
        if (isEventApprovedLocked()) return safeShowError("Locked: this event is already approved.");
        if (!state.permissions?.can_add_debit) return safeShowError("Not allowed.");
        const hid = qs("#axEventId");
        if (hid) hid.value = String(state.selectedEventId || "");
        const el = qs("#addExpenseModal");
        if (el && typeof bootstrap !== "undefined") bootstrap.Modal.getOrCreateInstance(el).show();
      });
    }

    const save = qs("#axSaveBtn");
    if (save && save.dataset.eeBound !== "1") {
      save.dataset.eeBound = "1";
      save.addEventListener("click", async () => {
        try {
          if (isReadOnlyMode()) throw new Error("Read-only mode.");
          if (isEventApprovedLocked()) throw new Error("Locked: this event is already approved.");
          if (!state.permissions.can_add_debit) throw new Error("Not allowed.");

          const date = String(qs("#axDate")?.value || "").trim();
          const category = String(qs("#axCategory")?.value || "").trim();
          const quantity = Number(qs("#axQuantity")?.value || 1);
          const unit = Number(qs("#axUnitPrice")?.value || 0);
          const amount = Number(qs("#axAmount")?.value || 0);
          const receiptNumber = String(qs("#axReceiptNumber")?.value || "").trim();
          const notes = String(qs("#axNotes")?.value || "").trim();
          const file = qs("#axReceipt")?.files?.[0] || null;

          if (!date) throw new Error("Date is required.");
          if (!category) throw new Error("Category is required.");
          if (!(quantity >= 1)) throw new Error("Quantity must be 1 or more.");
          if (!(amount >= 0)) throw new Error("Invalid amount.");
          if (!receiptNumber) throw new Error("Receipt Number is required.");
          if (!file) throw new Error("Receipt file is required.");
          if (!notes) throw new Error("Notes is required.");

          const fd = new FormData();
          fd.append("action", "add_debit");
          fd.append("event_id", String(Number(state.selectedEventId || 0)));
          fd.append("date", date);
          fd.append("category", category);
          fd.append("quantity", String(quantity));
          fd.append("unit_price", String(unit));
          fd.append("amount", String(amount));
          fd.append("receipt_number", receiptNumber);
          fd.append("notes", notes);
          fd.append("receipt", file);

          const res = await fetch(API_URL, {
            method: "POST",
            credentials: "include",
            body: fd,
          });

          const text = await res.text();
          console.log("[EventExpenses] RAW multipart:", res.status, text);

          let data;
          try { data = JSON.parse(text); }
          catch { throw new Error("Invalid server response (not JSON). Check console RAW."); }

          if (!res.ok) throw new Error(data?.message || `HTTP ${res.status}`);
          if (!data?.success) throw new Error(data?.message || "Request failed.");

          safeShowSuccess(data.message || "Expense added.");
          closeModal("#addExpenseModal");
          await openEvent(state.selectedEventId);
        } catch (e) {
          safeShowError(e.message);
        }
      });
    }
  }

  function bindPrintButtons() {
    const ledgerBtn = qs("#ledgerPrintBtn");
    if (ledgerBtn && ledgerBtn.dataset.eeBound !== "1") {
      ledgerBtn.dataset.eeBound = "1";
      ledgerBtn.addEventListener("click", () => {
        if (!state.permissions?.can_print_ledger) return safeShowError("Not allowed.");
        if (!state.permissions?.can_print_ledger || isReadOnlyMode()) return safeShowError("Not allowed to print ledger for this event.");
        const eventId = Number(state.selectedEventId || 0);
        if (!eventId) return safeShowError("No event selected.");
        const url = buildUrl(PRINT_LEDGER, {
          event_id: eventId,
          term_id: Number(state.selectedTermId || 0) || null,
        });
        openNewTab(url);
      });
    }

    const passbookBtn = qs("#eePassbookPrintBtn");
    if (passbookBtn && passbookBtn.dataset.eeBound !== "1") {
      passbookBtn.dataset.eeBound = "1";
      passbookBtn.addEventListener("click", () => {
        if (!state.permissions?.can_print_passbook || isReadOnlyMode()) return safeShowError("Not allowed to print passbook for this event.");
        if (!state.permissions?.can_print_passbook) return safeShowError("Not allowed.");
        const orgId = Number(state.selectedEvent?.org_id || 0);
        if (!orgId) return safeShowError("This event has no organization (cannot print passbook).");

        const schoolYear = String(state.selectedSchoolYear || "");
        const semester = String(state.selectedSemester || "");
        const url = buildUrl(PRINT_PASSBOOK, {
          org_id: orgId,
          school_year: schoolYear,
          semester: semester,
          term_id: Number(state.selectedTermId || 0) || null,
        });
        openNewTab(url);
      });
    }

    const liqBtn = qs("#liqPrintBtn");
    if (liqBtn && liqBtn.dataset.eeBound !== "1") {
      liqBtn.dataset.eeBound = "1";
      liqBtn.addEventListener("click", () => {
        if (!state.permissions?.can_print_liquidation || isReadOnlyMode()) return safeShowError("Not allowed to print liquidation for this event.");
        if (!state.permissions?.can_print_liquidation) return safeShowError("Not allowed.");
        const eventId = Number(state.selectedEventId || 0);
        if (!eventId) return safeShowError("No event selected.");

        if (!state.gates.accomplishment_approved) {
          safeShowError("Locked: accomplishment report not approved yet.");
          return;
        }

        const url = buildUrl(PRINT_LIQUIDATION, {
          event_id: eventId,
          term_id: Number(state.selectedTermId || 0) || null,
        });
        openNewTab(url);
      });
    }

    bindAccomplishmentPrint();
  }

  function waitForEl(selector, timeoutMs = 6000) {
    return new Promise((resolve, reject) => {
      const start = Date.now();
      (function tick() {
        const el = qs(selector);
        if (el) return resolve(el);
        if (Date.now() - start >= timeoutMs) return reject(new Error(`Missing DOM: ${selector}`));
        setTimeout(tick, 50);
      })();
    });
  }

  // -------------------------
  // init
  // -------------------------
  async function init() {
    try {
      await waitForEl("#eeAySelect");
      await waitForEl("#eeActiveYearSelect");
      await waitForEl("#eeSearch");

      showView("list");
      setHidden(qs("#eeReadOnlyBadge"), true);

      bindTermFilterEvents();
      bindListEvents();
      bindAddEventModal();
      bindEventSubmitForApprovalButton();
      bindAddCreditModal();
      bindAddDebitModal();
      bindPrintButtons();
      bindApprovalButtons();
      bindAccomplishmentSubmit();
      bindSubmitAccomplishment();
      bindApproveAccomplishment();
      bindDeclineAccomplishment();
      bindAccomplishmentPreview();
      //initProposedExpenses();

      const emptyAdd = qs("#btnEmptyAdd");
      if (emptyAdd && emptyAdd.dataset.eeBound !== "1") {
        emptyAdd.dataset.eeBound = "1";
        emptyAdd.addEventListener("click", () => {
          if (!state.permissions?.can_add_event || isReadOnlyMode()) return safeShowError("Not allowed.");
          const el = qs("#addEventModal");
          if (el && typeof bootstrap !== "undefined") bootstrap.Modal.getOrCreateInstance(el).show();
        });
      }

      await loadTerms();
      applyGlobalRoleBadges();
      await loadEvents();

      applyAddEventVisibility();
    } catch (e) {
      safeShowError(e.message);
    }
  }

  function mountIfReady() {
    const page = document.getElementById("event-expenses-page");
    if (!page) return false;

    if (page.dataset.eeMounted === "1") {
      applyAddEventVisibility();
      return true;
    }

    page.dataset.eeMounted = "1";
    init();
    return true;
  }

  try {
    if (window.__EventExpensesMountObserver) window.__EventExpensesMountObserver.disconnect();
  } catch (_) {}

  if (!mountIfReady()) {
    const mo = new MutationObserver(() => {
      mountIfReady();
      applyAddEventVisibility();
    });
    mo.observe(document.body, { childList: true, subtree: true });
    window.__EventExpensesMountObserver = mo;
  } else {
    applyAddEventVisibility();
  }

  window.loadTerms = loadTerms;
  window.loadEvents = loadEvents;

  window.EE_DEBUG = {
    state,
    semKey,
    dump() {
      const el = document.querySelector("#btnAddEvent");
      console.log("[EE_DEBUG] btn exists:", !!el, "display:", el ? getComputedStyle(el).display : null);
      console.log("[EE_DEBUG] perms.can_add_event:", !!state.permissions?.can_add_event);
      console.log("[EE_DEBUG] perms.can_add_credit:", !!state.permissions?.can_add_credit);
      console.log("[EE_DEBUG] perms.can_add_debit:", !!state.permissions?.can_add_debit);
      console.log("[EE_DEBUG] perms.can_print_ledger:", !!state.permissions?.can_print_ledger);
      console.log("[EE_DEBUG] perms.can_print_passbook:", !!state.permissions?.can_print_passbook);
      console.log("[EE_DEBUG] perms.can_print_liquidation:", !!state.permissions?.can_print_liquidation);
      console.log("[EE_DEBUG] perms.can_print_accomplishment:", !!state.permissions?.can_print_accomplishment);
      console.log("[EE_DEBUG] is_readonly flag:", !!state.permissions?.is_readonly);
      console.log("[EE_DEBUG] activeTermId:", state.activeTermId, "selectedTermId:", state.selectedTermId);
      console.log("[EE_DEBUG] selected SY:", state.selectedSchoolYear, "selected Sem:", state.selectedSemester, "semKey:", semKey(state.selectedSemester));
      console.log("[EE_DEBUG] isReadOnlyTerm:", isReadOnlyTerm(), "isReadOnlyMode:", isReadOnlyMode());
      console.log("[EE_DEBUG] terms sample:", state.terms.slice(0, 5));
      console.log("[EE_DEBUG] proposedTotal:", state.proposedTotal);
      console.log("[EE_DEBUG] accomplishment status:", state.accomplishment?.status);
    },
    applyAddEventVisibility,
    applyPrintVisibility,
    applyEventActionVisibility,
    mountIfReady,
  };
})();