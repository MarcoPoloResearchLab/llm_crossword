/* admin.js — settings modal opened from avatar menu */
(function () {
  "use strict";

  var _fetch = window.authFetch || window.fetch.bind(window);
  var placeholderValue = "—";

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
  var selectedUser = null;
  var sessionData = null;
  var accountDetailsConfig = [
    { key: "display", label: "Display Name", formatter: formatTextValue },
    { key: "email", label: "Email", formatter: formatTextValue },
    { key: "avatar_url", label: "Avatar URL", formatter: formatTextValue },
    { key: "roles", label: "Roles", formatter: formatRolesValue },
    { key: "is_admin", label: "Admin Access", formatter: formatBooleanValue },
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

  function formatBooleanValue(value) {
    if (!hasDisplayValue(value)) return placeholderValue;
    return value ? "Yes" : "No";
  }

  function formatRolesValue(value) {
    if (Array.isArray(value)) {
      return value.length > 0 ? value.join(", ") : placeholderValue;
    }
    if (!hasDisplayValue(value)) return placeholderValue;
    return String(value);
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
    _fetch("/api/session", { credentials: "include" })
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
    sessionData = null;
    selectedUser = null;
    allUsers = [];
    setAdminState(false);
    closeDrawer();
  });

  checkAdminStatus();

  // --- Load users ---
  function loadUsers() {
    setStatus(adminUsersStatus, "Loading users...");
    _fetch("/api/admin/users", { credentials: "include" })
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
    _fetch("/api/admin/balance?user_id=" + encodeURIComponent(uid), { credentials: "include" })
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
    _fetch("/api/admin/grants?user_id=" + encodeURIComponent(uid), { credentials: "include" })
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

      _fetch("/api/admin/grant", {
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
})();
