// js/account-switcher.js

(function() {
    console.log('🚀 Account Switcher script loaded');
    
    class AccountSwitcher {
        constructor() {
            console.log('📦 AccountSwitcher constructor called');
            this.init();
        }

        init() {
            console.log('🔍 Initializing AccountSwitcher...');
            
            // Check if we're on a page that should have the switcher
            const currentPage = window.location.pathname.split('/').pop();
            const validPages = ['student.html', 'officer.html'];
            
            if (!validPages.includes(currentPage)) {
                console.log('❌ Not on a valid page for account switcher:', currentPage);
                return;
            }

            // Check localStorage data
            const availableAccounts = localStorage.getItem('available_accounts');
            const isOfficer = localStorage.getItem('is_officer') === '1' || localStorage.getItem('is_officer') === 'true';
            const activeAccount = localStorage.getItem('active_account');
            
            console.log('📊 localStorage data:', {
                availableAccounts: availableAccounts,
                isOfficer: isOfficer,
                activeAccount: activeAccount,
                hasDualAccount: availableAccounts !== null
            });

            // Only proceed if user has dual accounts
            if (!availableAccounts) {
                console.log('❌ No available accounts found in localStorage');
                return;
            }

            if (!isOfficer) {
                console.log('❌ User is not an officer');
                return;
            }

            console.log('✅ User has dual accounts, proceeding to add switcher');
            this.addSwitcherToSidebar();
        }

        addSwitcherToSidebar() {
            console.log('🔧 Adding switcher to sidebar...');
            
            // Find the sidebar footer
            const sidebarFooter = document.querySelector('.sidebar-abit');
            
            if (!sidebarFooter) {
                console.error('❌ Sidebar footer not found! Looking for: .sidebar-footer-abit');
                console.log('Available sidebar elements:', document.querySelectorAll('[class*="sidebar"]'));
                return;
            }

            console.log('✅ Sidebar footer found:', sidebarFooter);

            // Get account data
            const activeAccount = localStorage.getItem('active_account') || 'student';
            const officerPos = localStorage.getItem('officer_position') || 'Officer';
            const officerOrg = localStorage.getItem('officer_org_abbreviation') || localStorage.getItem('officer_org_name') || '';
            
            console.log('👤 Account data:', { activeAccount, officerPos, officerOrg });

            // Create the switcher HTML
            const switcherHtml = `
                <hr style="border: none; height: 2px; background: linear-gradient(90deg, transparent, #f5aa1c, transparent); margin: 20px 0; display:none; !important">                
                <div class="account-switcher mb-2" id="accountSwitcherContainer" style="display:none; !important">
                    <div class="dropdown">
                        <button class="btn btn-outline-light w-100 text-start dropdown-toggle" 
                                type="button" 
                                id="accountSwitcherDropdown" 
                                data-bs-toggle="dropdown" 
                                aria-expanded="false"
                                style="background-color: rgba(255,255,255,0.1); border: none;">
                            <i class="bi ${activeAccount === 'officer' ? 'bi-briefcase' : 'bi-person'} me-2"></i>
                            <span id="currentAccountLabel">
                                ${activeAccount === 'officer' ? 
                                    (officerPos) : 
                                    'Student Account'}
                            </span>
                        </button>
                        <ul class="dropdown-menu w-100" aria-labelledby="accountSwitcherDropdown">
                            <li>
                                <a class="dropdown-item ${activeAccount === 'student' ? 'active' : ''}" 
                                   href="#" 
                                   data-account="student">
                                    <i class="bi bi-person me-2"></i>
                                    <div class="d-inline-block">
                                        <strong>Student Account</strong><br>
                                        <small class="text-muted">Regular student access</small>
                                    </div>
                                </a>
                            </li>
                            <li>
                                <a class="dropdown-item ${activeAccount === 'officer' ? 'active' : ''}" 
                                   href="#" 
                                   data-account="officer">
                                    <i class="bi bi-briefcase me-2"></i>
                                    <div class="d-inline-block">
                                        <strong>Officer Account</strong><br>
                                        <small class="text-muted">${officerPos} ${officerOrg ? `(${officerOrg})` : ''}</small>
                                    </div>
                                </a>
                            </li>
                            <li><hr class="dropdown-divider"></li>
                            <li>
                                <a class="dropdown-item" href="#" id="accountPreferencesBtn">
                                    <i class="bi bi-gear me-2"></i>
                                    Account Preferences
                                </a>
                            </li>
                        </ul>
                    </div>
                </div>
            `;

            // Insert at the beginning of sidebar footer
            sidebarFooter.insertAdjacentHTML('afterbegin', switcherHtml);
            console.log('✅ Switcher HTML inserted');

            // Verify the element was added
            const container = document.getElementById('accountSwitcherContainer');
            if (container) {
                console.log('✅ Switcher container found in DOM');
            } else {
                console.error('❌ Switcher container not found after insertion');
            }

            // Add event listeners
            this.attachEventListeners();
        }

        attachEventListeners() {
            console.log('🔗 Attaching event listeners...');
            
            // Account switching
            const accountLinks = document.querySelectorAll('.dropdown-item[data-account]');
            console.log(`Found ${accountLinks.length} account switch links`);
            
            accountLinks.forEach(item => {
                item.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    const account = e.currentTarget.dataset.account;
                    console.log('🔄 Account switch clicked:', account);
                    this.switchAccount(account);
                });
            });

            // Preferences button
            const prefsBtn = document.getElementById('accountPreferencesBtn');
            if (prefsBtn) {
                prefsBtn.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    console.log('⚙️ Preferences button clicked');
                    
                    // Close dropdown
                    const dropdown = bootstrap.Dropdown.getInstance(document.getElementById('accountSwitcherDropdown'));
                    if (dropdown) dropdown.hide();
                    
                    // Show preferences modal
                    this.showPreferences();
                });
                console.log('✅ Preferences button listener attached');
            } else {
                console.error('❌ Preferences button not found');
            }
        }

        switchAccount(account) {
            console.log('🔄 Switching to account:', account);
            
            const currentAccount = localStorage.getItem('active_account');
            if (account === currentAccount) {
                console.log('⏭️ Already on this account, skipping');
                return;
            }

            const currentPage = window.location.pathname.split('/').pop();
            const targetPage = account === 'officer' ? 'officer.html' : 'student.html';
            
            console.log('📍 Current page:', currentPage);
            console.log('🎯 Target page:', targetPage);
            
            // Store the switch preference
            localStorage.setItem('active_account', account);
            sessionStorage.setItem('account_mode', account);
            
            // Close dropdown
            const dropdownElement = document.getElementById('accountSwitcherDropdown');
            if (dropdownElement) {
                const dropdown = bootstrap.Dropdown.getInstance(dropdownElement);
                if (dropdown) dropdown.hide();
            }
            
            // Navigate
            if (currentPage === targetPage) {
                console.log('🔄 Already on correct page, reloading...');
                window.location.reload();
            } else {
                console.log('➡️ Navigating to:', targetPage);
                window.location.href = targetPage;
            }
        }

        showPreferences() {
    console.log('⚙️ Showing preferences modal');
    
    // Create preferences modal
    let modal = document.getElementById('accountPrefsModal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'accountPrefsModal';
        modal.className = 'modal fade';
        modal.innerHTML = `
            <div class="modal-dialog modal-dialog-centered">
                <div class="modal-content">
                    <div class="modal-header bg-primary text-white">
                        <h5 class="modal-title">Account Preferences</h5>
                        <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal"></button>
                    </div>
                    <div class="modal-body">
                        <p>Choose your default account behavior on login:</p>
                        <div class="form-check">
                            <input class="form-check-input" type="radio" name="defaultAccount" id="prefAsk" value="ask" checked>
                            <label class="form-check-label" for="prefAsk">Ask me each time (show selection modal)</label>
                        </div>
                        <div class="form-check">
                            <input class="form-check-input" type="radio" name="defaultAccount" id="prefStudent" value="student">
                            <label class="form-check-label" for="prefStudent">Always use Student account</label>
                        </div>
                        <div class="form-check">
                            <input class="form-check-input" type="radio" name="defaultAccount" id="prefOfficer" value="officer">
                            <label class="form-check-label" for="prefOfficer">Always use Officer account</label>
                        </div>
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancel</button>
                        <button type="button" class="btn btn-primary" id="saveAccountPrefs">Save</button>
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
        console.log('✅ Preferences modal created');
    }

    // Get current preference from localStorage
    const defaultPref = localStorage.getItem('default_account');
    console.log('Current default_account:', defaultPref);
    
    // Set radio buttons based on stored value
    if (defaultPref === 'student') {
        document.getElementById('prefStudent').checked = true;
    } else if (defaultPref === 'officer') {
        document.getElementById('prefOfficer').checked = true;
    } else {
        document.getElementById('prefAsk').checked = true;
    }

    // Show modal
    const bsModal = new bootstrap.Modal(modal);
    bsModal.show();

    // Handle save
    document.getElementById('saveAccountPrefs').onclick = () => {
        let selected = 'ask';
        if (document.getElementById('prefStudent').checked) selected = 'student';
        if (document.getElementById('prefOfficer').checked) selected = 'officer';
        
        console.log('Saving preference:', selected);
        
        if (selected === 'ask') {
            localStorage.removeItem('default_account');
        } else {
            localStorage.setItem('default_account', selected);
        }
        
        bsModal.hide();
        
        // Show success message
        alert('Account preferences saved! It will apply on your next login.');
    };
        }
    }

    // Initialize when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            console.log('📄 DOM Content Loaded');
            window.accountSwitcher = new AccountSwitcher();
        });
    } else {
        console.log('📄 DOM already loaded');
        window.accountSwitcher = new AccountSwitcher();
    }
})();