/* auth-fetch.js — fetch wrapper that retries once on 401 after refreshing the session */
(function () {
  "use strict";

  var nativeFetch = window.fetch.bind(window);
  var refreshing = null;
  var tenantHeaderName = "X-TAuth-Tenant";
  var services = window.LLMCrosswordServices || null;

  function getTauthTenantId() {
    var attributedElement = document.querySelector("[tauth-tenant-id]");
    if (!attributedElement || typeof attributedElement.getAttribute !== "function") {
      return "";
    }
    return (attributedElement.getAttribute("tauth-tenant-id") || "").trim();
  }

  function isTauthPath(url) {
    if (typeof url !== "string") return false;
    if (url === "/me" || url.indexOf("/auth/") === 0) return true;
    return isResolvedTauthUrl(url);
  }

  function isAPIPath(url) {
    if (typeof url !== "string") return false;
    if (url.indexOf("/api/") === 0) return true;
    return isResolvedAPIUrl(url);
  }

  function getConfiguredAuthBaseUrl() {
    if (!services || typeof services.getAuthBaseUrl !== "function") return "";
    return services.getAuthBaseUrl();
  }

  function getConfiguredAPIBaseUrl() {
    if (!services || typeof services.getApiBaseUrl !== "function") return "";
    return services.getApiBaseUrl();
  }

  function matchesResolvedPath(url, baseUrl, pathPrefix) {
    if (typeof url !== "string" || typeof baseUrl !== "string" || typeof pathPrefix !== "string") {
      return false;
    }
    if (!baseUrl || !pathPrefix) {
      return false;
    }
    if (url === baseUrl + pathPrefix) {
      return true;
    }
    return url.indexOf(baseUrl + pathPrefix + "?") === 0;
  }

  function isResolvedTauthUrl(url) {
    var authBaseUrl = getConfiguredAuthBaseUrl();

    return matchesResolvedPath(url, authBaseUrl, "/me")
      || matchesResolvedPath(url, authBaseUrl, "/auth/")
      || url.indexOf(authBaseUrl + "/auth/") === 0;
  }

  function isResolvedAPIUrl(url) {
    var apiBaseUrl = getConfiguredAPIBaseUrl();

    if (!apiBaseUrl) {
      return false;
    }

    return url.indexOf(apiBaseUrl + "/api/") === 0;
  }

  function buildTauthUrl(url) {
    if (typeof url !== "string") return url;
    if (isResolvedTauthUrl(url)) return url;
    if (!services || typeof services.buildAuthUrl !== "function") return url;
    return services.buildAuthUrl(url);
  }

  function buildAPIUrl(url) {
    if (isResolvedAPIUrl(url)) return url;
    if (!services || typeof services.buildApiUrl !== "function") return url;
    return services.buildApiUrl(url);
  }

  function resolveRequestUrl(url) {
    if (isTauthPath(url)) {
      return buildTauthUrl(url);
    }
    if (isAPIPath(url)) {
      return buildAPIUrl(url);
    }
    return url;
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
    return nativeFetch(buildTauthUrl(url), buildTauthFetchOptions(options));
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
    var resolvedUrl = resolveRequestUrl(url);
    var requestFetch = isTauthPath(url) ? fetchTauth : nativeFetch;

    return requestFetch(resolvedUrl, options).then(function (resp) {
      if (resp.status !== 401) return resp;

      return refreshSession().then(function (refreshed) {
        if (!refreshed) return resp;
        // Replay the original request.
        return requestFetch(resolvedUrl, options);
      });
    });
  }

  window.authFetch = authFetch;
  window.fetchTauth = fetchTauth;
  window.getTauthTenantId = getTauthTenantId;
})();
