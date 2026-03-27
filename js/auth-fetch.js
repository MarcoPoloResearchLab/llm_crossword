/* auth-fetch.js — fetch wrapper that retries once on 401 after refreshing the session */
(function () {
  "use strict";

  var nativeFetch = window.fetch.bind(window);
  var refreshing = null;

  /**
   * Try to refresh the TAuth session by hitting /me.
   * Returns a promise that resolves to true if the session was restored.
   */
  function refreshSession() {
    if (refreshing) return refreshing;
    refreshing = nativeFetch("/me", { credentials: "include" })
      .then(function (resp) { return resp.ok; })
      .catch(function () { return false; })
      .finally(function () { refreshing = null; });
    return refreshing;
  }

  /**
   * Fetch wrapper that retries the request once if a 401 is returned.
   * On 401 it attempts a session refresh via /me and, if successful,
   * replays the original request. If the retry also returns 401 the
   * response is returned as-is so callers can handle logout.
   */
  function authFetch(url, options) {
    return nativeFetch(url, options).then(function (resp) {
      if (resp.status !== 401) return resp;

      // Skip retry for the /me endpoint itself to avoid loops.
      if (typeof url === "string" && url.indexOf("/me") !== -1) return resp;

      return refreshSession().then(function (refreshed) {
        if (!refreshed) return resp;
        // Replay the original request.
        return nativeFetch(url, options);
      });
    });
  }

  window.authFetch = authFetch;
})();
