// @ts-check

(function (global) {
  "use strict";

  var DEFAULT_CONFIG_URL = "/config.yaml";
  var DEFAULT_YAML_PARSER_URL = "https://cdn.jsdelivr.net/npm/js-yaml@4.1.0/dist/js-yaml.min.js";
  var DEFAULT_HEADER_SELECTOR = "mpr-header";
  var DEFAULT_LOGIN_BUTTON_SELECTOR = "mpr-login-button";
  var DEFAULT_USER_SELECTOR = "mpr-user";

  var SECTION_ENVIRONMENTS = "environments";
  var SECTION_AUTH = "auth";
  var SECTION_AUTH_BUTTON = "authButton";
  var SECTION_ORIGINS = "origins";
  var BUNDLE_MARKER_SELECTOR = "script[data-mpr-ui-bundle-src]";
  var EVENT_CONFIG_APPLIED = "mpr-ui:config:applied";
  var EVENT_BUNDLE_LOADED = "mpr-ui:bundle:loaded";
  var EVENT_ORCHESTRATION_READY = "mpr-ui:orchestration:ready";

  var yamlParserPromise = null;
  var bundleLoadPromise = null;
  var autoOrchestrationPromise = null;

  function ensureNamespace(target) {
    if (!target.MPRUI) {
      target.MPRUI = {};
    }
    return target.MPRUI;
  }

  function isPlainObject(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
  }

  function normalizeOptions(options) {
    var resolved = Object.assign(
      {
        configUrl: DEFAULT_CONFIG_URL,
        yamlParserUrl: DEFAULT_YAML_PARSER_URL,
        headerSelector: DEFAULT_HEADER_SELECTOR,
        loginButtonSelector: DEFAULT_LOGIN_BUTTON_SELECTOR,
        userSelector: DEFAULT_USER_SELECTOR,
      },
      options || {},
    );
    return resolved;
  }

  function requireString(source, key, scope) {
    var value = source[key];
    if (typeof value !== "string" || value.trim().length === 0) {
      throw new Error("config.yaml missing " + scope + "." + key);
    }
    return value.trim();
  }

  function requireStringAllowEmpty(source, key, scope) {
    if (!Object.prototype.hasOwnProperty.call(source, key)) {
      throw new Error("config.yaml missing " + scope + "." + key);
    }
    var value = source[key];
    if (typeof value !== "string") {
      throw new Error("config.yaml missing " + scope + "." + key);
    }
    return value.trim();
  }

  function requireObject(source, key, scope) {
    var value = source[key];
    if (!isPlainObject(value)) {
      throw new Error("config.yaml missing " + scope + "." + key);
    }
    return value;
  }

  function readOptionalObject(source, key, scope) {
    if (!Object.prototype.hasOwnProperty.call(source, key)) {
      return null;
    }
    return requireObject(source, key, scope);
  }

  function readStringArray(source, key) {
    var value = source[key];
    if (!Array.isArray(value)) {
      return [];
    }
    return value
      .map(function mapEntry(entry) {
        return typeof entry === "string" ? entry.trim() : "";
      })
      .filter(function filterEntry(entry) {
        return entry.length > 0;
      });
  }

  function requireEnvironments(value) {
    if (!Array.isArray(value) || value.length === 0) {
      throw new Error("config.yaml missing environments");
    }
    return value.map(function mapEnvironment(environment, index) {
      if (!isPlainObject(environment)) {
        throw new Error("config.yaml environment at index " + index + " must be an object");
      }
      return environment;
    });
  }

  function requireRuntimeOrigin() {
    var location = global.location;
    var origin = location && typeof location.origin === "string" ? location.origin : "";
    if (!origin) {
      throw new Error("window.location.origin is required for config selection");
    }
    return origin;
  }

  function selectEnvironment(environments, runtimeOrigin) {
    var matches = environments.filter(function filterEnvironment(environment) {
      var origins = readStringArray(environment, SECTION_ORIGINS);
      if (origins.length === 0) {
        throw new Error("config.yaml environment missing origins");
      }
      return origins.indexOf(runtimeOrigin) !== -1;
    });
    if (matches.length === 0) {
      throw new Error("config.yaml has no environment for origin " + runtimeOrigin);
    }
    if (matches.length > 1) {
      throw new Error("config.yaml has multiple environments for origin " + runtimeOrigin);
    }
    return matches[0];
  }

  function buildAuthConfig(environment) {
    var authPayload = requireObject(environment, SECTION_AUTH, SECTION_AUTH);
    return Object.freeze({
      tauthUrl: requireStringAllowEmpty(authPayload, "tauthUrl", SECTION_AUTH),
      googleClientId: requireString(authPayload, "googleClientId", SECTION_AUTH),
      tenantId: requireString(authPayload, "tenantId", SECTION_AUTH),
      loginPath: requireString(authPayload, "loginPath", SECTION_AUTH),
      logoutPath: requireString(authPayload, "logoutPath", SECTION_AUTH),
      noncePath: requireString(authPayload, "noncePath", SECTION_AUTH),
    });
  }

  function buildAuthButtonConfig(environment) {
    var buttonPayload = readOptionalObject(environment, SECTION_AUTH_BUTTON, SECTION_AUTH_BUTTON);
    if (!buttonPayload) {
      return null;
    }
    var config = {
      text: requireString(buttonPayload, "text", SECTION_AUTH_BUTTON),
      size: requireString(buttonPayload, "size", SECTION_AUTH_BUTTON),
      theme: requireString(buttonPayload, "theme", SECTION_AUTH_BUTTON),
    };
    if (typeof buttonPayload.shape === "string" && buttonPayload.shape.trim().length > 0) {
      config.shape = buttonPayload.shape.trim();
    }
    return Object.freeze(config);
  }

  function buildRuntimeConfig(environment) {
    var origins = readStringArray(environment, SECTION_ORIGINS);
    var description = typeof environment.description === "string" ? environment.description.trim() : "";
    return Object.freeze({
      description: description,
      origins: origins,
      auth: buildAuthConfig(environment),
      authButton: buildAuthButtonConfig(environment),
    });
  }

  function loadScript(scriptUrl) {
    return new Promise(function executor(resolve, reject) {
      if (!global.document || !global.document.createElement) {
        reject(new Error("document is required to load " + scriptUrl));
        return;
      }
      var scriptElement = global.document.createElement("script");
      scriptElement.async = true;
      scriptElement.defer = true;
      scriptElement.src = scriptUrl;
      scriptElement.onload = function handleLoad() {
        resolve();
      };
      scriptElement.onerror = function handleError() {
        reject(new Error("Failed to load " + scriptUrl));
      };
      if (global.document.head && typeof global.document.head.appendChild === "function") {
        global.document.head.appendChild(scriptElement);
      } else {
        reject(new Error("document.head is required to load " + scriptUrl));
      }
    });
  }

  function ensureYamlParser(parserUrl) {
    if (global.jsyaml && typeof global.jsyaml.load === "function") {
      return Promise.resolve(global.jsyaml);
    }
    if (yamlParserPromise) {
      return yamlParserPromise;
    }
    yamlParserPromise = loadScript(parserUrl).then(function resolveParser() {
      if (global.jsyaml && typeof global.jsyaml.load === "function") {
        return global.jsyaml;
      }
      throw new Error("js-yaml parser did not initialize");
    });
    return yamlParserPromise;
  }

  function fetchConfig(configUrl) {
    if (!global.fetch) {
      return Promise.reject(new Error("fetch is required to load config.yaml"));
    }
    return global.fetch(configUrl, { cache: "no-store" }).then(function parseResponse(response) {
      if (!response || !response.ok) {
        var status = response ? response.status : "unknown";
        throw new Error("config.yaml request failed (" + status + ")");
      }
      return response.text();
    });
  }

  function parseConfigYaml(configText, parser) {
    var parsed = parser.load(configText);
    if (!isPlainObject(parsed)) {
      throw new Error("config.yaml must be an object");
    }
    return parsed;
  }

  function loadYamlConfigInternal(options) {
    var runtimeOrigin = requireRuntimeOrigin();
    return ensureYamlParser(options.yamlParserUrl)
      .then(function parseYaml(parser) {
        return fetchConfig(options.configUrl).then(function handleYamlText(configText) {
          var parsed = parseConfigYaml(configText, parser);
          var environments = requireEnvironments(parsed[SECTION_ENVIRONMENTS]);
          var selected = selectEnvironment(environments, runtimeOrigin);
          return buildRuntimeConfig(selected);
        });
      });
  }

  function ensureDocumentReady() {
    if (!global.document) {
      return Promise.reject(new Error("document is required to apply config"));
    }
    if (global.document.readyState && global.document.readyState !== "loading") {
      return Promise.resolve();
    }
    return new Promise(function waitForReady(resolve) {
      global.document.addEventListener("DOMContentLoaded", resolve, { once: true });
    });
  }

  function dispatchDocumentEvent(eventName, detail) {
    if (!global.document || typeof global.document.dispatchEvent !== "function") {
      return;
    }
    if (typeof global.CustomEvent !== "function") {
      return;
    }
    global.document.dispatchEvent(new global.CustomEvent(eventName, { detail: detail }));
  }

  function setAttributeValue(targetElement, attributeName, attributeValue) {
    if (!targetElement || typeof targetElement.setAttribute !== "function") {
      return;
    }
    if (attributeValue === undefined || attributeValue === null) {
      return;
    }
    targetElement.setAttribute(attributeName, String(attributeValue));
  }

  function removeAttributeValue(targetElement, attributeName) {
    if (!targetElement || typeof targetElement.removeAttribute !== "function") {
      return;
    }
    targetElement.removeAttribute(attributeName);
  }

  function applyAuthAttributes(targetElement, authConfig) {
    setAttributeValue(targetElement, "tauth-tenant-id", authConfig.tenantId);
    setAttributeValue(targetElement, "tauth-login-path", authConfig.loginPath);
    setAttributeValue(targetElement, "tauth-logout-path", authConfig.logoutPath);
    setAttributeValue(targetElement, "tauth-nonce-path", authConfig.noncePath);
    if (authConfig.tauthUrl && authConfig.tauthUrl.trim().length > 0) {
      setAttributeValue(targetElement, "tauth-url", authConfig.tauthUrl);
      return;
    }
    removeAttributeValue(targetElement, "tauth-url");
  }

  function applyHeaderAttributes(headerElement, authConfig) {
    setAttributeValue(headerElement, "google-site-id", authConfig.googleClientId);
    applyAuthAttributes(headerElement, authConfig);
  }

  function applyLoginButtonAttributes(loginButton, authConfig, authButtonConfig) {
    setAttributeValue(loginButton, "site-id", authConfig.googleClientId);
    applyAuthAttributes(loginButton, authConfig);
    setAttributeValue(loginButton, "button-text", authButtonConfig.text);
    setAttributeValue(loginButton, "button-size", authButtonConfig.size);
    setAttributeValue(loginButton, "button-theme", authButtonConfig.theme);
    if (authButtonConfig.shape) {
      setAttributeValue(loginButton, "button-shape", authButtonConfig.shape);
    }
  }

  function applyUserAttributes(userElement, authConfig) {
    setAttributeValue(userElement, "tauth-tenant-id", authConfig.tenantId);
  }

  function applyConfigToDom(runtimeConfig, options) {
    var headers = Array.from(global.document.querySelectorAll(options.headerSelector));
    var loginButtons = Array.from(global.document.querySelectorAll(options.loginButtonSelector));
    var userMenus = Array.from(global.document.querySelectorAll(options.userSelector));
    if (headers.length > 0) {
      headers.forEach(function updateHeader(headerElement) {
        applyHeaderAttributes(headerElement, runtimeConfig.auth);
      });
    }
    if (loginButtons.length > 0) {
      if (!runtimeConfig.authButton) {
        throw new Error("config.yaml missing authButton for login button");
      }
      loginButtons.forEach(function updateLogin(loginButton) {
        applyLoginButtonAttributes(loginButton, runtimeConfig.auth, runtimeConfig.authButton);
      });
    }
    if (userMenus.length > 0) {
      userMenus.forEach(function updateUserMenu(userElement) {
        applyUserAttributes(userElement, runtimeConfig.auth);
      });
    }
    return runtimeConfig;
  }

  function readBundleMarkerSource(bundleMarker) {
    if (!bundleMarker || typeof bundleMarker.getAttribute !== "function") {
      return "";
    }
    var bundleSource = bundleMarker.getAttribute("data-mpr-ui-bundle-src");
    if (typeof bundleSource !== "string" || bundleSource.trim().length === 0) {
      throw new Error("mpr-ui auto-orchestration requires data-mpr-ui-bundle-src");
    }
    return bundleSource.trim();
  }

  function loadBundleFromMarker(bundleMarker) {
    if (!bundleMarker) {
      return Promise.resolve(null);
    }
    if (bundleLoadPromise) {
      return bundleLoadPromise;
    }
    var bundleSource = readBundleMarkerSource(bundleMarker);
    bundleLoadPromise = loadScript(bundleSource).then(function resolveBundleLoad() {
      dispatchDocumentEvent(EVENT_BUNDLE_LOADED, { src: bundleSource });
      return bundleSource;
    });
    return bundleLoadPromise;
  }

  var namespace = ensureNamespace(global);
  namespace.loadYamlConfig = function loadYamlConfig(options) {
    var resolved = normalizeOptions(options);
    return loadYamlConfigInternal(resolved);
  };
  namespace.applyYamlConfig = function applyYamlConfig(options) {
    var resolved = normalizeOptions(options);
    return loadYamlConfigInternal(resolved).then(function applyConfig(runtimeConfig) {
      return ensureDocumentReady().then(function finalizeApply() {
        var result = applyConfigToDom(runtimeConfig, resolved);
        dispatchDocumentEvent(EVENT_CONFIG_APPLIED, { config: resolved, runtimeConfig: result });
        return result;
      });
    });
  };
  namespace.whenAutoOrchestrationReady = function whenAutoOrchestrationReady() {
    if (autoOrchestrationPromise) {
      return autoOrchestrationPromise;
    }
    return Promise.resolve();
  };

  // MU-130: Automatic orchestration for components with data-config-url
  function autoOrchestrate() {
    if (typeof document === 'undefined' || typeof document.querySelector !== 'function') {
      return Promise.resolve();
    }
    if (autoOrchestrationPromise) {
      return autoOrchestrationPromise;
    }
    var header = document.querySelector('mpr-header[data-config-url]');
    if (header) {
      var configUrl = header.getAttribute('data-config-url');
      if (configUrl) {
        var bundleMarker = document.querySelector(BUNDLE_MARKER_SELECTOR);
        autoOrchestrationPromise = global.MPRUI.applyYamlConfig({ configUrl: configUrl })
          .then(function handleConfigApplied() {
            return loadBundleFromMarker(bundleMarker);
          })
          .then(function finalizeOrchestration() {
            dispatchDocumentEvent(EVENT_ORCHESTRATION_READY, { configUrl: configUrl });
          });
        autoOrchestrationPromise.catch(function handleOrchestrationError(err) {
          // eslint-disable-next-line no-console
          console.error('[mpr-ui-config] Auto-orchestration failed:', err);
        });
        return autoOrchestrationPromise;
      }
    }
    return Promise.resolve();
  }

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', autoOrchestrate);
    } else {
      autoOrchestrate();
    }
  }
})(typeof window !== "undefined" ? window : globalThis);
