/* service-config.js — resolve browser-facing service URLs */
(function () {
  "use strict";

  var absoluteUrlPattern = /^[a-zA-Z][a-zA-Z\d+\-.]*:/;

  function hasDisplayValue(value) {
    return typeof value === "string" && value.trim() !== "";
  }

  function trimTrailingSlashes(value) {
    return hasDisplayValue(value) ? value.trim().replace(/\/+$/, "") : "";
  }

  function trimLeadingSlashes(value) {
    return hasDisplayValue(value) ? value.trim().replace(/^\/+/, "") : "";
  }

  function isAbsoluteUrl(value) {
    return hasDisplayValue(value) && absoluteUrlPattern.test(value.trim());
  }

  function getLocationOrigin() {
    if (!window.location || !hasDisplayValue(window.location.origin)) {
      return "";
    }
    return trimTrailingSlashes(window.location.origin);
  }

  function readRuntimeServices() {
    var runtimeConfig = window.LLMCrosswordRuntimeConfig;
    var services = runtimeConfig && typeof runtimeConfig === "object" ? runtimeConfig.services : null;

    if (!services || typeof services !== "object") {
      return {};
    }

    return services;
  }

  function resolveBaseUrl(value, fallbackValue) {
    var candidate = trimTrailingSlashes(value);

    if (candidate) {
      return candidate;
    }

    return trimTrailingSlashes(fallbackValue);
  }

  function resolveAbsoluteOrRelativeUrl(value, fallbackValue) {
    var candidate = hasDisplayValue(value) ? value.trim() : "";

    if (candidate) {
      return candidate;
    }

    return hasDisplayValue(fallbackValue) ? fallbackValue.trim() : "";
  }

  function joinUrl(baseUrl, path) {
    var normalizedBaseUrl = trimTrailingSlashes(baseUrl);
    var normalizedPath = hasDisplayValue(path) ? path.trim() : "";

    if (!normalizedPath) {
      return normalizedBaseUrl;
    }
    if (isAbsoluteUrl(normalizedPath)) {
      return normalizedPath;
    }
    if (!normalizedBaseUrl) {
      return normalizedPath;
    }
    if (normalizedPath.charAt(0) === "?" || normalizedPath.charAt(0) === "#") {
      return normalizedBaseUrl + normalizedPath;
    }

    return normalizedBaseUrl + "/" + trimLeadingSlashes(normalizedPath);
  }

  function getConfig() {
    var services = readRuntimeServices();
    var locationOrigin = getLocationOrigin();
    var authBaseUrl = resolveBaseUrl(services.authBaseUrl, locationOrigin);
    var apiBaseUrl = resolveBaseUrl(services.apiBaseUrl, locationOrigin);
    var configUrl = resolveAbsoluteOrRelativeUrl(services.configUrl, joinUrl(apiBaseUrl, "/config.yml"));
    var tauthScriptUrl = resolveAbsoluteOrRelativeUrl(services.tauthScriptUrl, joinUrl(authBaseUrl, "/tauth.js"));

    return Object.freeze({
      apiBaseUrl: apiBaseUrl,
      authBaseUrl: authBaseUrl,
      configUrl: configUrl,
      tauthScriptUrl: tauthScriptUrl,
    });
  }

  function getApiBaseUrl() {
    return getConfig().apiBaseUrl;
  }

  function getAuthBaseUrl() {
    return getConfig().authBaseUrl;
  }

  function getConfigUrl() {
    return getConfig().configUrl;
  }

  function getTauthScriptUrl() {
    return getConfig().tauthScriptUrl;
  }

  function buildApiUrl(path) {
    return joinUrl(getApiBaseUrl(), path);
  }

  function buildAuthUrl(path) {
    return joinUrl(getAuthBaseUrl(), path);
  }

  window.LLMCrosswordServices = Object.freeze({
    buildApiUrl: buildApiUrl,
    buildAuthUrl: buildAuthUrl,
    getApiBaseUrl: getApiBaseUrl,
    getAuthBaseUrl: getAuthBaseUrl,
    getConfig: getConfig,
    getConfigUrl: getConfigUrl,
    getTauthScriptUrl: getTauthScriptUrl,
    isAbsoluteUrl: isAbsoluteUrl,
    joinUrl: joinUrl,
  });
})();
