/* admin.js — settings drawer (mpr-detail-drawer) opened from avatar menu */
(function () {
  "use strict";

  var _fetch = window.authFetch || window.fetch.bind(window);

  // --- Settings drawer DOM ---
  var settingsDrawer    = document.getElementById("settingsDrawer");
  var userMenu          = document.getElementById("userMenu");
  var tabAccount        = document.getElementById("settingsTabAccount");
  var tabAdmin          = document.getElementById("settingsTabAdmin");
  var accountTab        = document.getElementById("settingsAccountTab");
  var adminTab          = document.getElementById("settingsAdminTab");

  // Account DOM
  var settingsAvatar    = document.getElementById("settingsAvatar");
  var settingsName      = document.getElementById("settingsName");
  var settingsEmail     = document.getElementById("settingsEmail");

  // Admin DOM
  var adminRefreshUsers = document.getElementById("adminRefreshUsers");
  var adminUserSearch   = document.getElementById("adminUserSearch");
  var adminUserList     = document.getElementById("adminUserList");
  var adminUsersStatus  = document.getElementById("adminUsersStatus");
  var adminNoSelection  = document.getElementById("adminNoSelection");
  var adminUserDetails  = document.getElementById("adminUserDetails");
  var adminSelectedUser = document.getElementById("adminSelectedUser");
  var adminRefreshUser  = document.getElementById("adminRefreshUser");
  var adminBalanceCoins = document.getElementById("adminBalanceCoins");
  var adminBalanceTotal = document.getElementById("adminBalanceTotal");
  var adminBalanceStatus = document.getElementById("adminBalanceStatus");
  var adminGrantForm    = document.getElementById("adminGrantForm");
  var adminGrantCoins   = document.getElementById("adminGrantCoins");
  var adminGrantBtn     = document.getElementById("adminGrantBtn");
  var adminGrantStatus  = document.getElementById("adminGrantStatus");

  var isAdmin = false;
  var allUsers = [];
  var selectedUserId = null;
  var adminEmails = [];
  var sessionData = null;

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

  // --- Parse administrators from config.yaml ---
  function loadAdminEmails() {
    return _fetch(window.location.origin + "/config.yaml")
      .then(function (resp) { return resp.text(); })
      .then(function (text) {
        adminEmails = parseAdministrators(text);
      })
      .catch(function () {
        adminEmails = [];
      });
  }

  function parseAdministrators(yamlText) {
    var emails = [];
    var lines = yamlText.split("\n");
    var inAdmins = false;
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      if (/^administrators:/.test(line)) {
        inAdmins = true;
        continue;
      }
      if (inAdmins) {
        var match = line.match(/^\s+-\s+"([^"]+)"/);
        if (match) {
          emails.push(match[1].toLowerCase().trim());
        } else if (/^\S/.test(line)) {
          break;
        }
      }
    }
    return emails;
  }

  // --- Tab switching ---
  function switchTab(tabName) {
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

  // --- Show/hide settings drawer via mpr-detail-drawer open attribute ---
  function openDrawer() {
    if (settingsDrawer) {
      settingsDrawer.setAttribute("open", "");
      populateAccount();
    }
  }

  function closeDrawer() {
    if (settingsDrawer) {
      settingsDrawer.removeAttribute("open");
    }
  }

  // Close drawer when mpr-detail-drawer emits its close event.
  if (settingsDrawer) {
    settingsDrawer.addEventListener("mpr-ui:detail-drawer:close", closeDrawer);
  }

  // --- Account info ---
  function populateAccount() {
    if (!sessionData) {
      settingsName.textContent = "—";
      settingsEmail.textContent = "—";
      settingsAvatar.style.display = "none";
      return;
    }
    settingsName.textContent = sessionData.name || "—";
    settingsEmail.textContent = sessionData.email || "—";
    if (sessionData.picture) {
      settingsAvatar.src = sessionData.picture;
      settingsAvatar.alt = sessionData.name || "Avatar";
      settingsAvatar.style.display = "";
    } else {
      settingsAvatar.style.display = "none";
    }
  }

  // --- Check admin status using config.yaml + session email ---
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
        sessionData = data;
        // Always add Settings to menu once logged in.
        setMenuItems();
        var email = data.email.toLowerCase().trim();
        if (data.is_admin || adminEmails.indexOf(email) >= 0) {
          setAdminState(true);
        } else {
          setAdminState(false);
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
    setAdminState(false);
    closeDrawer();
  });

  // Load admin emails from config.yaml, then check admin status.
  loadAdminEmails().then(function () {
    checkAdminStatus();
  });

  // --- Load users ---
  function loadUsers() {
    adminUsersStatus.textContent = "Loading users...";
    adminUsersStatus.className = "admin-panel__status";
    _fetch("/api/admin/users", { credentials: "include" })
      .then(function (resp) {
        if (!resp.ok) throw new Error("Failed to load users");
        return resp.json();
      })
      .then(function (data) {
        allUsers = data.users || [];
        adminUsersStatus.textContent = "";
        renderUserList();
      })
      .catch(function (err) {
        adminUsersStatus.textContent = err.message;
        adminUsersStatus.className = "admin-panel__status admin-panel__status--error";
      });
  }

  function renderUserList() {
    var query = (adminUserSearch.value || "").toLowerCase();
    var filtered = allUsers.filter(function (uid) {
      return uid.toLowerCase().indexOf(query) >= 0;
    });

    adminUserList.innerHTML = "";
    if (filtered.length === 0) {
      var empty = document.createElement("div");
      empty.className = "admin-panel__user-empty";
      empty.textContent = allUsers.length === 0 ? "No users found." : "No matching users.";
      adminUserList.appendChild(empty);
      return;
    }

    filtered.forEach(function (uid) {
      var btn = document.createElement("button");
      btn.className = "admin-panel__user-item";
      if (uid === selectedUserId) btn.classList.add("admin-panel__user-item--active");
      btn.textContent = uid;
      btn.addEventListener("click", function () { selectUser(uid); });
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
  function selectUser(uid) {
    selectedUserId = uid;
    adminNoSelection.style.display = "none";
    adminUserDetails.style.display = "";
    adminSelectedUser.textContent = uid;
    adminGrantStatus.textContent = "";
    renderUserList();
    loadUserBalance(uid);
  }

  if (adminRefreshUser) {
    adminRefreshUser.addEventListener("click", function () {
      if (selectedUserId) loadUserBalance(selectedUserId);
    });
  }

  // --- Load balance ---
  function loadUserBalance(uid) {
    adminBalanceCoins.textContent = "...";
    adminBalanceTotal.textContent = "...";
    adminBalanceStatus.textContent = "";
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
        adminBalanceStatus.textContent = err.message;
        adminBalanceStatus.className = "admin-panel__status admin-panel__status--error";
      });
  }

  // --- Grant form ---
  if (adminGrantForm) {
    adminGrantForm.addEventListener("submit", function (e) {
      e.preventDefault();
      if (!selectedUserId) return;

      var coins = parseInt(adminGrantCoins.value, 10);
      if (!coins || coins <= 0) {
        adminGrantStatus.textContent = "Enter a positive number of credits.";
        adminGrantStatus.className = "admin-panel__status admin-panel__status--error";
        return;
      }

      adminGrantBtn.disabled = true;
      adminGrantStatus.textContent = "Granting...";
      adminGrantStatus.className = "admin-panel__status";

      _fetch("/api/admin/grant", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: selectedUserId, amount_coins: coins }),
      })
        .then(function (resp) {
          return resp.json().then(function (data) { return { ok: resp.ok, data: data }; });
        })
        .then(function (result) {
          if (!result.ok) {
            adminGrantStatus.textContent = result.data.message || "Grant failed.";
            adminGrantStatus.className = "admin-panel__status admin-panel__status--error";
            return;
          }
          adminGrantStatus.textContent = "Granted " + coins + " credits!";
          adminGrantStatus.className = "admin-panel__status admin-panel__status--success";
          adminGrantCoins.value = "";
          if (result.data.balance) {
            var b = result.data.balance;
            adminBalanceCoins.textContent = b.coins != null ? b.coins : Math.floor(b.available_cents / 100);
            adminBalanceTotal.textContent = b.total_cents != null ? b.total_cents : "-";
          } else {
            loadUserBalance(selectedUserId);
          }
        })
        .catch(function (err) {
          adminGrantStatus.textContent = "Network error: " + err.message;
          adminGrantStatus.className = "admin-panel__status admin-panel__status--error";
        })
        .finally(function () {
          adminGrantBtn.disabled = false;
        });
    });
  }
})();
