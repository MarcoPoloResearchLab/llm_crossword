/* admin.js — settings modal opened from avatar menu */
(function () {
  "use strict";

  var services = window.LLMCrosswordServices || null;
  var _fetch = window.authFetch || window.fetch.bind(window);
  var billingRestoreDrawerStorageKey = "llm-crossword-billing-restore-drawer";
  var placeholderValue = "—";

  function buildApiUrl(path) {
    if (services && typeof services.buildApiUrl === "function") {
      return services.buildApiUrl(path);
    }
    return path;
  }

  // --- Settings modal DOM ---
  var settingsDrawer    = document.getElementById("settingsDrawer");
  var settingsCloseButton = document.getElementById("settingsCloseButton");
  var userMenu          = document.getElementById("userMenu");
  var tabAccount        = document.getElementById("settingsTabAccount");
  var tabAdmin          = document.getElementById("settingsTabAdmin");
  var accountTab        = document.getElementById("settingsAccountTab");
  var adminTab          = document.getElementById("settingsAdminTab");

  // Account DOM
  var settingsAvatar    = document.getElementById("settingsAvatar");
  var settingsName      = document.getElementById("settingsName");
  var settingsEmail     = document.getElementById("settingsEmail");
  var settingsAccountDetails = document.getElementById("settingsAccountDetails");
  var settingsBillingActivityList = document.getElementById("settingsBillingActivityList");
  var settingsBillingBalanceMeta = document.getElementById("settingsBillingBalanceMeta");
  var settingsBillingBalanceValue = document.getElementById("settingsBillingBalanceValue");
  var settingsBillingPanel = document.getElementById("settingsBillingPanel");
  var settingsBillingPackList = document.getElementById("settingsBillingPackList");
  var settingsBillingStatus = document.getElementById("settingsBillingStatus");
  var settingsManageBillingButton = document.getElementById("settingsManageBillingButton");

  // Admin DOM
  var adminRefreshUsers = document.getElementById("adminRefreshUsers");
  var adminUserSearch   = document.getElementById("adminUserSearch");
  var adminUserList     = document.getElementById("adminUserList");
  var adminUsersStatus  = document.getElementById("adminUsersStatus");
  var adminNoSelection  = document.getElementById("adminNoSelection");
  var adminUserDetails  = document.getElementById("adminUserDetails");
  var adminSelectedUser = document.getElementById("adminSelectedUser");
  var adminSelectedUserMeta = document.getElementById("adminSelectedUserMeta");
  var adminRefreshUser  = document.getElementById("adminRefreshUser");
  var adminBalanceCoins = document.getElementById("adminBalanceCoins");
  var adminBalanceTotal = document.getElementById("adminBalanceTotal");
  var adminBalanceStatus = document.getElementById("adminBalanceStatus");
  var adminGrantForm    = document.getElementById("adminGrantForm");
  var adminGrantCoins   = document.getElementById("adminGrantCoins");
  var adminGrantReason  = document.getElementById("adminGrantReason");
  var adminGrantBtn     = document.getElementById("adminGrantBtn");
  var adminGrantStatus  = document.getElementById("adminGrantStatus");
  var adminGrantHistoryList = document.getElementById("adminGrantHistoryList");
  var adminGrantHistoryStatus = document.getElementById("adminGrantHistoryStatus");

  var isAdmin = false;
  var allUsers = [];
  var billingSummary = null;
  var selectedUser = null;
  var sessionData = null;
  var accountDetailsConfig = [
    { key: "display", label: "Display Name", formatter: formatTextValue },
    { key: "email", label: "Email", formatter: formatTextValue },
    { key: "expires", label: "Session Expires", formatter: formatExpiresValue },
  ];

  // --- Add "Settings" to avatar dropdown via menu-items attribute ---
  function setMenuItems() {
    if (!userMenu) return;
    var items = [{ label: "Settings", action: "settings" }];
    userMenu.setAttribute("menu-items", JSON.stringify(items));
  }

  // Listen for custom menu-item clicks from mpr-user.
  document.addEventListener("mpr-user:menu-item", function (e) {
    var detail = e.detail || {};
    if (detail.action === "settings") {
      openDrawer();
    }
  });

  function hasDisplayValue(value) {
    if (value === null || value === undefined) return false;
    if (Array.isArray(value)) return value.length > 0;
    if (typeof value === "string") return value.trim() !== "";
    return true;
  }

  function normalizeRoles(roles) {
    var normalizedRoles = [];
    var seenRoles = {};

    if (!Array.isArray(roles)) return normalizedRoles;

    roles.forEach(function (role) {
      var stringRole = hasDisplayValue(role) ? String(role).trim() : "";
      var normalizedKey;

      if (!stringRole) return;
      normalizedKey = stringRole.toLowerCase();
      if (seenRoles[normalizedKey]) return;
      seenRoles[normalizedKey] = true;
      normalizedRoles.push(stringRole);
    });

    return normalizedRoles;
  }

  function hasAdminRole(roles) {
    return normalizeRoles(roles).some(function (role) {
      return role.toLowerCase() === "admin";
    });
  }

  function normalizeSessionData(rawData) {
    var normalizedRoles;
    var effectiveAdmin;

    if (!rawData) return null;

    normalizedRoles = normalizeRoles(rawData.roles);
    effectiveAdmin = rawData.is_admin === true || hasAdminRole(normalizedRoles);

    if (effectiveAdmin && !hasAdminRole(normalizedRoles)) {
      normalizedRoles.push("admin");
    }

    return {
      user_id: hasDisplayValue(rawData.user_id) ? String(rawData.user_id) : "",
      display: hasDisplayValue(rawData.display) ? String(rawData.display) : "",
      email: hasDisplayValue(rawData.email) ? String(rawData.email) : "",
      avatar_url: hasDisplayValue(rawData.avatar_url) ? String(rawData.avatar_url) : "",
      roles: normalizedRoles,
      expires: rawData.expires,
      is_admin: effectiveAdmin,
    };
  }

  function normalizeAdminUser(rawUser) {
    if (typeof rawUser === "string") {
      return {
        user_id: rawUser,
        email: "",
        display: "",
      };
    }
    if (!rawUser || typeof rawUser !== "object") {
      return null;
    }
    return {
      user_id: hasDisplayValue(rawUser.user_id) ? String(rawUser.user_id) : "",
      email: hasDisplayValue(rawUser.email) ? String(rawUser.email) : "",
      display: hasDisplayValue(rawUser.display) ? String(rawUser.display) : "",
    };
  }

  function getUserPrimaryLabel(user) {
    if (!user) return placeholderValue;
    return user.email || placeholderValue;
  }

  function getUserSecondaryLabel(user) {
    if (!user) return "";
    if (user.display && user.display !== user.email) {
      return user.display;
    }
    return "";
  }

  function getUserSearchText(user) {
    return [
      user && user.email,
      user && user.display,
      user && user.user_id,
    ]
      .filter(hasDisplayValue)
      .join(" ")
      .toLowerCase();
  }

  function isSameUser(leftUser, rightUser) {
    if (!leftUser || !rightUser) return false;
    return leftUser.user_id === rightUser.user_id;
  }

  function setStatus(element, message, isError, isSuccess) {
    if (!element) return;
    element.textContent = message || "";
    element.className = "admin-panel__status";
    if (isError) {
      element.className += " admin-panel__status--error";
    } else if (isSuccess) {
      element.className += " admin-panel__status--success";
    }
  }

  function formatTextValue(value) {
    return hasDisplayValue(value) ? String(value) : placeholderValue;
  }

  function formatRolesValue(value) {
    if (!Array.isArray(value)) return placeholderValue;
    return value.length > 0 ? value.join(", ") : placeholderValue;
  }

  function formatExpiresValue(value) {
    var parsedValue;
    var parsedDate;

    if (!hasDisplayValue(value)) return placeholderValue;

    if (typeof value === "number") {
      parsedValue = value;
    } else if (typeof value === "string" && value.trim() !== "" && !isNaN(Number(value))) {
      parsedValue = Number(value);
    } else {
      return String(value);
    }

    parsedDate = new Date(parsedValue * 1000);
    if (isNaN(parsedDate.getTime())) return String(value);
    return parsedDate.toISOString();
  }

  function getBalanceCredits(balance) {
    if (!balance || typeof balance !== "object") return null;
    if (balance.coins != null && !isNaN(Number(balance.coins))) {
      return Number(balance.coins);
    }
    if (balance.available_cents != null && !isNaN(Number(balance.available_cents))) {
      return Math.floor(Number(balance.available_cents) / 100);
    }
    return null;
  }

  function formatBillingTimestamp(value) {
    var parsedDate;

    if (!hasDisplayValue(value)) return placeholderValue;
    parsedDate = new Date(value);
    if (isNaN(parsedDate.getTime())) return String(value);
    return parsedDate.toLocaleString();
  }

  function normalizeBillingSummary(rawSummary) {
    var summary = rawSummary && typeof rawSummary === "object" ? rawSummary : {};

    return {
      activity: Array.isArray(summary.activity) ? summary.activity : [],
      balance: summary.balance || null,
      enabled: summary.enabled === true,
      packs: Array.isArray(summary.packs) ? summary.packs : [],
      portal_available: summary.portal_available === true,
      provider_code: hasDisplayValue(summary.provider_code) ? String(summary.provider_code) : "",
    };
  }

  function hasPendingBillingReturn() {
    try {
      return new URL(window.location.href).searchParams.has("billing_transaction_id");
    } catch {
      return false;
    }
  }

  function shouldRestoreBillingDrawer() {
    if (hasPendingBillingReturn()) return true;
    try {
      return window.sessionStorage.getItem(billingRestoreDrawerStorageKey) === "1";
    } catch {
      return false;
    }
  }

  function clearPendingBillingRestore() {
    try {
      window.sessionStorage.removeItem(billingRestoreDrawerStorageKey);
    } catch {}
  }

  function getBillingPackLabel(packCode) {
    var matchingPack;

    if (!billingSummary || !Array.isArray(billingSummary.packs) || !hasDisplayValue(packCode)) {
      return "";
    }

    matchingPack = billingSummary.packs.find(function (pack) {
      return pack && pack.code === packCode;
    });
    return matchingPack && hasDisplayValue(matchingPack.label) ? String(matchingPack.label) : "";
  }

  function setBillingActionState(isBusy) {
    var actionButtons;

    if (settingsManageBillingButton) {
      settingsManageBillingButton.disabled = isBusy === true || !billingSummary || billingSummary.portal_available !== true;
    }
    if (!settingsBillingPackList) return;

    actionButtons = settingsBillingPackList.querySelectorAll("[data-billing-pack-button]");
    Array.prototype.forEach.call(actionButtons, function (button) {
      button.disabled = isBusy === true;
    });
  }

  function renderBillingActivity(activityEntries) {
    var entries = Array.isArray(activityEntries) ? activityEntries : [];

    if (!settingsBillingActivityList) return;

    settingsBillingActivityList.innerHTML = "";
    if (entries.length === 0) {
      var empty = document.createElement("div");

      empty.className = "billing-activity-list__empty";
      empty.textContent = "No billing activity yet.";
      settingsBillingActivityList.appendChild(empty);
      return;
    }

    entries.forEach(function (entry) {
      var item = document.createElement("div");
      var header = document.createElement("div");
      var summary = document.createElement("div");
      var status = document.createElement("div");
      var meta = document.createElement("div");
      var metaParts = [];
      var packLabel = getBillingPackLabel(entry && entry.pack_code);

      item.className = "billing-activity";
      header.className = "billing-activity__header";
      summary.className = "billing-activity__summary";
      status.className = "billing-activity__status";
      meta.className = "billing-activity__meta";

      summary.textContent = hasDisplayValue(entry && entry.summary) ? String(entry.summary) : "Billing activity recorded.";
      status.textContent = hasDisplayValue(entry && entry.status) ? String(entry.status) : "pending";
      if (entry && (entry.event_type === "transaction.completed" || entry.status === "completed")) {
        status.className += " billing-activity__status--completed";
      } else {
        status.className += " billing-activity__status--pending";
      }

      if (packLabel) {
        metaParts.push(packLabel);
      }
      if (entry && entry.credits_delta > 0) {
        metaParts.push("+" + entry.credits_delta + " credits");
      }
      if (hasDisplayValue(entry && entry.occurred_at)) {
        metaParts.push(formatBillingTimestamp(entry.occurred_at));
      }
      if (hasDisplayValue(entry && entry.transaction_id)) {
        metaParts.push("Transaction " + entry.transaction_id);
      }
      meta.textContent = metaParts.length > 0 ? metaParts.join(" • ") : placeholderValue;

      header.appendChild(summary);
      header.appendChild(status);
      item.appendChild(header);
      item.appendChild(meta);
      settingsBillingActivityList.appendChild(item);
    });
  }

  function renderBillingPacks(packs) {
    var entries = Array.isArray(packs) ? packs : [];

    if (!settingsBillingPackList) return;

    settingsBillingPackList.innerHTML = "";
    if (entries.length === 0) {
      var empty = document.createElement("div");

      empty.className = "billing-pack-list__empty";
      empty.textContent = "Credit packs are not configured for this deployment.";
      settingsBillingPackList.appendChild(empty);
      return;
    }

    entries.forEach(function (pack) {
      var card = document.createElement("div");
      var label = document.createElement("div");
      var credits = document.createElement("div");
      var meta = document.createElement("div");
      var button = document.createElement("button");

      card.className = "billing-pack";
      label.className = "billing-pack__label";
      credits.className = "billing-pack__credits";
      meta.className = "billing-pack__meta";
      button.className = "billing-pack__buy";
      button.type = "button";
      button.setAttribute("data-billing-pack-button", pack.code || "");
      button.textContent = "Buy now";

      label.textContent = hasDisplayValue(pack.label) ? String(pack.label) : placeholderValue;
      credits.textContent = hasDisplayValue(pack.credits) ? String(pack.credits) + " credits" : placeholderValue;
      meta.textContent = [
        hasDisplayValue(pack.price_display) ? String(pack.price_display) : placeholderValue,
        "One-time pack",
      ].join(" • ");

      button.addEventListener("click", function () {
        if (!window.CrosswordBilling || typeof window.CrosswordBilling.requestCheckout !== "function") return;
        setBillingActionState(true);
        window.CrosswordBilling.requestCheckout(pack.code)
          .catch(function () {})
          .finally(function () {
            setBillingActionState(false);
          });
      });

      card.appendChild(label);
      card.appendChild(credits);
      card.appendChild(meta);
      card.appendChild(button);
      settingsBillingPackList.appendChild(card);
    });
  }

  function renderBillingSummary() {
    var balanceCredits;

    if (!settingsBillingPanel || !settingsBillingBalanceValue || !settingsBillingBalanceMeta) return;

    if (!billingSummary || billingSummary.enabled !== true) {
      settingsBillingBalanceValue.textContent = placeholderValue;
      settingsBillingBalanceMeta.textContent = "Credit purchases are not enabled on this deployment.";
      if (settingsManageBillingButton) settingsManageBillingButton.style.display = "none";
      renderBillingPacks([]);
      renderBillingActivity([]);
      return;
    }

    balanceCredits = getBalanceCredits(billingSummary.balance);
    settingsBillingBalanceValue.textContent = balanceCredits === null ? placeholderValue : balanceCredits + " credits";
    settingsBillingBalanceMeta.textContent = "Each new crossword costs 4 credits. Purchases are granted after Paddle confirms payment.";

    if (settingsManageBillingButton) {
      settingsManageBillingButton.style.display = billingSummary.portal_available ? "" : "none";
      settingsManageBillingButton.disabled = billingSummary.portal_available !== true;
    }

    renderBillingPacks(billingSummary.packs);
    renderBillingActivity(billingSummary.activity);
    setBillingActionState(false);
  }

  function requestBillingSummary(force) {
    if (!window.CrosswordBilling || typeof window.CrosswordBilling.loadSummary !== "function") {
      return Promise.resolve();
    }
    return window.CrosswordBilling.loadSummary({
      force: force === true,
    }).catch(function () {
      return null;
    });
  }

  function syncBillingStatusFromCoordinator() {
    var billingState;
    var lastStatus;

    if (!window.CrosswordBilling || typeof window.CrosswordBilling.getState !== "function") return;

    billingState = window.CrosswordBilling.getState();
    lastStatus = billingState && billingState.lastStatus ? billingState.lastStatus : null;
    if (!lastStatus || !lastStatus.message) return;

    setStatus(
      settingsBillingStatus,
      lastStatus.message,
      lastStatus.tone === "error",
      lastStatus.tone === "success"
    );
  }

  function buildAccountDetails(data) {
    var entries = [];
    var configIndex;
    var fieldConfig;
    var value;

    for (configIndex = 0; configIndex < accountDetailsConfig.length; configIndex++) {
      fieldConfig = accountDetailsConfig[configIndex];
      value = data ? data[fieldConfig.key] : null;
      entries.push({
        label: fieldConfig.label,
        value: fieldConfig.formatter(value),
      });
    }

    return entries;
  }

  function renderAccountDetails() {
    var details;
    var index;
    var entry;
    var item;
    var term;
    var value;

    if (!settingsAccountDetails) return;

    details = buildAccountDetails(sessionData);
    settingsAccountDetails.innerHTML = "";

    for (index = 0; index < details.length; index++) {
      entry = details[index];
      item = document.createElement("div");
      item.className = "settings-account-details__item";

      term = document.createElement("dt");
      term.className = "settings-account-details__term";
      term.textContent = entry.label;

      value = document.createElement("dd");
      value.className = "settings-account-details__value";
      value.textContent = entry.value;

      item.appendChild(term);
      item.appendChild(value);
      settingsAccountDetails.appendChild(item);
    }
  }

  // --- Tab switching ---
  function switchTab(tabName) {
    if (!tabAccount || !tabAdmin || !accountTab || !adminTab) return;
    tabAccount.classList.toggle("settings-tabs__btn--active", tabName === "account");
    tabAdmin.classList.toggle("settings-tabs__btn--active", tabName === "admin");
    accountTab.style.display = tabName === "account" ? "" : "none";
    adminTab.style.display = tabName === "admin" ? "" : "none";

    if (tabName === "admin") loadUsers();
  }

  if (tabAccount) {
    tabAccount.addEventListener("click", function () { switchTab("account"); });
  }
  if (tabAdmin) {
    tabAdmin.addEventListener("click", function () { switchTab("admin"); });
  }

  // --- Show/hide settings modal ---
  function openDrawer() {
    if (!settingsDrawer) return;
    populateAccount();
    requestBillingSummary(true);
    syncBillingStatusFromCoordinator();
    if (settingsDrawer.open) return;
    if (typeof settingsDrawer.showModal === "function") {
      settingsDrawer.showModal();
      return;
    }
    settingsDrawer.setAttribute("open", "");
  }

  function closeDrawer() {
    if (!settingsDrawer) return;
    if (typeof settingsDrawer.close === "function" && settingsDrawer.open) {
      settingsDrawer.close();
      return;
    }
    settingsDrawer.removeAttribute("open");
  }

  if (settingsDrawer) {
    settingsDrawer.addEventListener("click", function (event) {
      if (event.target === settingsDrawer) closeDrawer();
    });
  }

  if (settingsCloseButton) {
    settingsCloseButton.addEventListener("click", closeDrawer);
  }

  // --- Account info ---
  function populateAccount() {
    if (!sessionData) {
      settingsName.textContent = placeholderValue;
      settingsEmail.textContent = placeholderValue;
      if (settingsAvatar) settingsAvatar.style.display = "none";
      renderAccountDetails();
      return;
    }
    settingsName.textContent = sessionData.display || placeholderValue;
    settingsEmail.textContent = sessionData.email || placeholderValue;
    if (!settingsAvatar) {
      renderAccountDetails();
      return;
    }
    if (sessionData.avatar_url) {
      settingsAvatar.src = sessionData.avatar_url;
      settingsAvatar.alt = sessionData.display || "Avatar";
      settingsAvatar.style.display = "";
    } else {
      settingsAvatar.style.display = "none";
    }
    renderAccountDetails();
  }

  // --- Check admin status using the server session as the single source of truth ---
  function checkAdminStatus() {
    _fetch(buildApiUrl("/api/session"), { credentials: "include" })
      .then(function (resp) {
        if (!resp.ok) return null;
        return resp.json();
      })
      .then(function (data) {
        if (!data || !data.email) {
          sessionData = null;
          setAdminState(false);
          return;
        }
        sessionData = normalizeSessionData(data);
        // Always add Settings to menu once logged in.
        setMenuItems();
        setAdminState(sessionData.is_admin);
        requestBillingSummary(false);
        if (settingsDrawer && settingsDrawer.open) {
          populateAccount();
        }
      })
      .catch(function () {
        sessionData = null;
        setAdminState(false);
      });
  }

  function setAdminState(admin) {
    isAdmin = admin;
    if (tabAdmin) tabAdmin.style.display = admin ? "" : "none";
    if (!admin && adminTab && adminTab.style.display !== "none") {
      switchTab("account");
    }
  }

  // Check on auth events.
  document.addEventListener("mpr-ui:auth:authenticated", function () {
    checkAdminStatus();
  });
  document.addEventListener("mpr-ui:auth:unauthenticated", function () {
    billingSummary = null;
    sessionData = null;
    selectedUser = null;
    allUsers = [];
    setAdminState(false);
    clearPendingBillingRestore();
    setStatus(settingsBillingStatus, "");
    renderBillingSummary();
    closeDrawer();
  });

  checkAdminStatus();
  renderBillingSummary();
  if (shouldRestoreBillingDrawer()) {
    openDrawer();
    switchTab("account");
    clearPendingBillingRestore();
    syncBillingStatusFromCoordinator();
  }

  window.addEventListener("llm-crossword:billing-summary", function (event) {
    billingSummary = normalizeBillingSummary(event && event.detail);
    renderBillingSummary();
  });

  window.addEventListener("llm-crossword:billing-status", function (event) {
    var detail = event && event.detail ? event.detail : {};
    var isError = detail.tone === "error";
    var isSuccess = detail.tone === "success";

    setStatus(settingsBillingStatus, detail.message || "", isError, isSuccess);
  });

  window.addEventListener("llm-crossword:billing-open-request", function () {
    openDrawer();
    switchTab("account");
    clearPendingBillingRestore();
    syncBillingStatusFromCoordinator();
    if (settingsBillingPanel && typeof settingsBillingPanel.scrollIntoView === "function") {
      settingsBillingPanel.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  });

  if (settingsManageBillingButton) {
    settingsManageBillingButton.addEventListener("click", function () {
      if (!window.CrosswordBilling || typeof window.CrosswordBilling.requestPortalSession !== "function") return;
      setBillingActionState(true);
      window.CrosswordBilling.requestPortalSession()
        .catch(function () {})
        .finally(function () {
          setBillingActionState(false);
        });
    });
  }

  // --- Load users ---
  function loadUsers() {
    setStatus(adminUsersStatus, "Loading users...");
    _fetch(buildApiUrl("/api/admin/users"), { credentials: "include" })
      .then(function (resp) {
        if (!resp.ok) throw new Error("Failed to load users");
        return resp.json();
      })
      .then(function (data) {
        allUsers = (data.users || [])
          .map(normalizeAdminUser)
          .filter(function (user) {
            return user && user.user_id && user.email;
          });
        if (selectedUser) {
          selectedUser = allUsers.find(function (user) {
            return isSameUser(user, selectedUser);
          }) || selectedUser;
          renderSelectedUser();
        }
        setStatus(adminUsersStatus, "");
        renderUserList();
      })
      .catch(function () {
        setStatus(adminUsersStatus, "We couldn't load the user list. Try Refresh.", true);
        if (allUsers.length > 0) {
          renderUserList();
          return;
        }
        adminUserList.innerHTML = "";
      });
  }

  function renderUserList() {
    var query = (adminUserSearch.value || "").toLowerCase();
    var filtered = allUsers.filter(function (user) {
      return getUserSearchText(user).indexOf(query) >= 0;
    });

    adminUserList.innerHTML = "";
    if (filtered.length === 0) {
      var empty = document.createElement("div");
      empty.className = "admin-panel__user-empty";
      empty.textContent = allUsers.length === 0 ? "No other users found." : "No matching users.";
      adminUserList.appendChild(empty);
      return;
    }

    filtered.forEach(function (user) {
      var btn = document.createElement("button");
      var primary = document.createElement("span");
      var secondaryText = getUserSecondaryLabel(user);

      btn.className = "admin-panel__user-item";
      if (selectedUser && isSameUser(user, selectedUser)) btn.classList.add("admin-panel__user-item--active");
      btn.type = "button";
      btn.title = getUserPrimaryLabel(user);

      primary.className = "admin-panel__user-primary";
      primary.textContent = getUserPrimaryLabel(user);
      btn.appendChild(primary);

      if (secondaryText) {
        var secondary = document.createElement("span");
        secondary.className = "admin-panel__user-secondary";
        secondary.textContent = secondaryText;
        btn.appendChild(secondary);
      }

      btn.addEventListener("click", function () { selectUser(user); });
      adminUserList.appendChild(btn);
    });
  }

  if (adminUserSearch) {
    adminUserSearch.addEventListener("input", renderUserList);
  }

  if (adminRefreshUsers) {
    adminRefreshUsers.addEventListener("click", loadUsers);
  }

  // --- Select user ---
  function renderSelectedUser() {
    if (!selectedUser) return;
    adminSelectedUser.textContent = getUserPrimaryLabel(selectedUser);
    if (adminSelectedUserMeta) {
      adminSelectedUserMeta.textContent = getUserSecondaryLabel(selectedUser);
    }
  }

  function selectUser(user) {
    selectedUser = user;
    adminNoSelection.style.display = "none";
    adminUserDetails.style.display = "";
    renderSelectedUser();
    setStatus(adminGrantStatus, "");
    if (adminGrantCoins) adminGrantCoins.value = "";
    if (adminGrantReason) adminGrantReason.value = "";
    renderUserList();
    loadUserBalance(user.user_id);
    loadGrantHistory(user.user_id);
  }

  if (adminRefreshUser) {
    adminRefreshUser.addEventListener("click", function () {
      if (!selectedUser) return;
      loadUserBalance(selectedUser.user_id);
      loadGrantHistory(selectedUser.user_id);
    });
  }

  // --- Load balance ---
  function loadUserBalance(uid) {
    adminBalanceCoins.textContent = "...";
    adminBalanceTotal.textContent = "...";
    setStatus(adminBalanceStatus, "");
    _fetch(buildApiUrl("/api/admin/balance?user_id=" + encodeURIComponent(uid)), { credentials: "include" })
      .then(function (resp) {
        if (!resp.ok) throw new Error("Failed to load balance");
        return resp.json();
      })
      .then(function (data) {
        var b = data.balance;
        adminBalanceCoins.textContent = b.coins != null ? b.coins : Math.floor(b.available_cents / 100);
        adminBalanceTotal.textContent = b.total_cents != null ? b.total_cents : "-";
      })
      .catch(function (err) {
        setStatus(adminBalanceStatus, err.message, true);
      });
  }

  function renderGrantHistory(records) {
    adminGrantHistoryList.innerHTML = "";

    if (!records || records.length === 0) {
      var empty = document.createElement("div");
      empty.className = "admin-panel__history-empty";
      empty.textContent = "No grants recorded yet.";
      adminGrantHistoryList.appendChild(empty);
      return;
    }

    records.forEach(function (record) {
      var item = document.createElement("div");
      var header = document.createElement("div");
      var amount = document.createElement("span");
      var timestamp = document.createElement("span");
      var reason = document.createElement("div");
      var meta = document.createElement("div");
      var createdAt = hasDisplayValue(record.created_at) ? new Date(record.created_at) : null;
      var timestampText = createdAt && !isNaN(createdAt.getTime())
        ? createdAt.toLocaleString()
        : placeholderValue;

      item.className = "admin-panel__history-item";
      header.className = "admin-panel__history-header";
      amount.className = "admin-panel__history-amount";
      timestamp.className = "admin-panel__history-time";
      reason.className = "admin-panel__history-reason";
      meta.className = "admin-panel__history-meta";

      amount.textContent = "+" + record.amount_coins + " credits";
      timestamp.textContent = timestampText;
      reason.textContent = record.reason || placeholderValue;
      meta.textContent = record.admin_email
        ? "Granted by " + record.admin_email
        : "Granted by admin";

      header.appendChild(amount);
      header.appendChild(timestamp);
      item.appendChild(header);
      item.appendChild(reason);
      item.appendChild(meta);
      adminGrantHistoryList.appendChild(item);
    });
  }

  function loadGrantHistory(uid) {
    if (!adminGrantHistoryList || !adminGrantHistoryStatus) return;

    setStatus(adminGrantHistoryStatus, "Loading grant history...");
    _fetch(buildApiUrl("/api/admin/grants?user_id=" + encodeURIComponent(uid)), { credentials: "include" })
      .then(function (resp) {
        if (!resp.ok) throw new Error("Failed to load grant history");
        return resp.json();
      })
      .then(function (data) {
        setStatus(adminGrantHistoryStatus, "");
        renderGrantHistory(data.grants || []);
      })
      .catch(function (err) {
        setStatus(adminGrantHistoryStatus, err.message, true);
        adminGrantHistoryList.innerHTML = "";
      });
  }

  // --- Grant form ---
  if (adminGrantForm) {
    adminGrantForm.addEventListener("submit", function (e) {
      var coins;
      var reason;
      var targetUser;

      e.preventDefault();
      if (!selectedUser) return;

      coins = parseInt(adminGrantCoins.value, 10);
      if (!coins || coins <= 0) {
        setStatus(adminGrantStatus, "Enter a positive number of credits.", true);
        return;
      }

      reason = (adminGrantReason.value || "").trim();
      if (!reason) {
        setStatus(adminGrantStatus, "Enter a reason for the grant.", true);
        return;
      }

      targetUser = selectedUser;
      adminGrantBtn.disabled = true;
      setStatus(adminGrantStatus, "Granting...");

      _fetch(buildApiUrl("/api/admin/grant"), {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: targetUser.user_id,
          user_email: targetUser.email,
          amount_coins: coins,
          reason: reason,
        }),
      })
        .then(function (resp) {
          return resp.json().then(function (data) { return { ok: resp.ok, data: data }; });
        })
        .then(function (result) {
          if (!result.ok) {
            setStatus(adminGrantStatus, result.data.message || "Grant failed.", true);
            return;
          }
          setStatus(adminGrantStatus, "Granted " + coins + " credits!", false, true);
          adminGrantCoins.value = "";
          adminGrantReason.value = "";
          if (result.data.balance) {
            var b = result.data.balance;
            adminBalanceCoins.textContent = b.coins != null ? b.coins : Math.floor(b.available_cents / 100);
            adminBalanceTotal.textContent = b.total_cents != null ? b.total_cents : "-";
          } else {
            loadUserBalance(targetUser.user_id);
          }
          if (selectedUser && isSameUser(selectedUser, targetUser)) {
            loadGrantHistory(targetUser.user_id);
          }
        })
        .catch(function (err) {
          setStatus(adminGrantStatus, "Network error: " + err.message, true);
        })
        .finally(function () {
          adminGrantBtn.disabled = false;
        });
    });
  }

  (window.__LLM_CROSSWORD_TEST__ || (window.__LLM_CROSSWORD_TEST__ = {})).admin = {
    checkAdminStatus: checkAdminStatus,
    clearPendingBillingRestore: clearPendingBillingRestore,
    formatExpiresValue: formatExpiresValue,
    formatBillingTimestamp: formatBillingTimestamp,
    formatRolesValue: formatRolesValue,
    getBalanceCredits: getBalanceCredits,
    getBillingPackLabel: getBillingPackLabel,
    getUserPrimaryLabel: getUserPrimaryLabel,
    getUserSearchText: getUserSearchText,
    getUserSecondaryLabel: getUserSecondaryLabel,
    hasPendingBillingReturn: hasPendingBillingReturn,
    hasDisplayValue: hasDisplayValue,
    hasAdminRole: hasAdminRole,
    isSameUser: isSameUser,
    loadGrantHistory: loadGrantHistory,
    loadUsers: loadUsers,
    normalizeAdminUser: normalizeAdminUser,
    normalizeBillingSummary: normalizeBillingSummary,
    normalizeRoles: normalizeRoles,
    normalizeSessionData: normalizeSessionData,
    openDrawer: openDrawer,
    populateAccount: populateAccount,
    renderAccountDetails: renderAccountDetails,
    renderBillingActivity: renderBillingActivity,
    renderBillingPacks: renderBillingPacks,
    renderBillingSummary: renderBillingSummary,
    renderGrantHistory: renderGrantHistory,
    renderSelectedUser: renderSelectedUser,
    requestBillingSummary: requestBillingSummary,
    selectUser: selectUser,
    setAdminState: setAdminState,
    setBillingSummary: function (summary) {
      billingSummary = normalizeBillingSummary(summary);
      renderBillingSummary();
    },
    setMenuItems: setMenuItems,
    shouldRestoreBillingDrawer: shouldRestoreBillingDrawer,
    setStatus: setStatus,
    setSessionData: function (data) {
      sessionData = data;
    },
    switchTab: switchTab,
    syncBillingStatusFromCoordinator: syncBillingStatusFromCoordinator,
    setSelectedUser: function (user) {
      selectedUser = user;
    },
    setUsers: function (users) {
      allUsers = users;
    },
  };
})();
