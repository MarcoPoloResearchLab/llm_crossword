/* auth-fetch.js — fetch wrapper that retries once on 401 after refreshing the session */
(function () {
  "use strict";

  var nativeFetch = window.fetch.bind(window);
  var refreshing = null;
  var tenantHeaderName = "X-TAuth-Tenant";

  function getTauthTenantId() {
    var attributedElement = document.querySelector("[tauth-tenant-id]");
    if (!attributedElement || typeof attributedElement.getAttribute !== "function") {
      return "";
    }
    return (attributedElement.getAttribute("tauth-tenant-id") || "").trim();
  }

  function isTauthPath(url) {
    if (typeof url !== "string") return false;
    if (url === "/me") return true;
    return url.indexOf("/auth/") === 0;
  }

  function buildTauthFetchOptions(options) {
    var merged = Object.assign({}, options || {});
    var headers = new Headers(merged.headers || {});
    var tenantId = getTauthTenantId();

    merged.credentials = "include";
    if (tenantId) {
      headers.set(tenantHeaderName, tenantId);
    }
    merged.headers = headers;
    return merged;
  }

  function fetchTauth(url, options) {
    return nativeFetch(url, buildTauthFetchOptions(options));
  }

  /**
   * Try to rotate the TAuth session cookies via /auth/refresh.
   * Returns a promise that resolves to true if the refresh succeeded.
   */
  function refreshSession() {
    if (refreshing) return refreshing;
    refreshing = fetchTauth("/auth/refresh", {
      method: "POST",
    })
      .then(function (resp) { return resp.ok; })
      .catch(function () { return false; })
      .finally(function () { refreshing = null; });
    return refreshing;
  }

  /**
   * Fetch wrapper that retries the request once if a 401 is returned.
   * On 401 it attempts a session refresh via /auth/refresh and, if successful,
   * replays the original request. If the retry also returns 401 the
   * response is returned as-is so callers can handle logout.
   */
  function authFetch(url, options) {
    var requestFetch = isTauthPath(url) ? fetchTauth : nativeFetch;

    return requestFetch(url, options).then(function (resp) {
      if (resp.status !== 401) return resp;

      return refreshSession().then(function (refreshed) {
        if (!refreshed) return resp;
        // Replay the original request.
        return requestFetch(url, options);
      });
    });
  }

  window.authFetch = authFetch;
  window.fetchTauth = fetchTauth;
  window.getTauthTenantId = getTauthTenantId;
})();
