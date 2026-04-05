// @ts-check
"use strict";

const fs = require("fs");
const http = require("http");
const https = require("https");
const path = require("path");
const {
  createSessionCookieHeader,
  createSessionIdentity,
  getSignedSessionConfig,
} = require("./signed-session");

const ROOT = path.join(__dirname, "../..");
const RUNTIME_ROOT = path.join(ROOT, ".runtime");
const CONFIGS_ROOT = path.join(ROOT, "configs");
const DEFAULT_SITE_ORIGIN = "http://localhost:8000";
const DEFAULT_TAUTH_ORIGIN = "http://localhost:8081";
const DEFAULT_API_ORIGIN = "http://localhost:9090";
const DEFAULT_WAIT_TIMEOUT_MS = 60000;
const DEFAULT_POLL_INTERVAL_MS = 1000;

function resolveConfigPath(fileName) {
  const runtimePublicPath = path.join(RUNTIME_ROOT, "public-configs", fileName);
  if (fs.existsSync(runtimePublicPath)) {
    return runtimePublicPath;
  }
  const runtimePath = path.join(RUNTIME_ROOT, fileName);
  if (fs.existsSync(runtimePath)) {
    return runtimePath;
  }
  const configsPath = path.join(CONFIGS_ROOT, fileName);
  if (fs.existsSync(configsPath)) {
    return configsPath;
  }
  return path.join(ROOT, fileName);
}

function normalizeOrigin(value, fallbackValue) {
  const candidate = typeof value === "string" ? value.trim() : "";
  const origin = candidate || fallbackValue;
  return origin.replace(/\/+$/, "");
}

function getIntegrationEnvironment() {
  const siteOrigin = normalizeOrigin(process.env.INTEGRATION_URL, DEFAULT_SITE_ORIGIN);
  const tauthOrigin = normalizeOrigin(process.env.INTEGRATION_TAUTH_URL, DEFAULT_TAUTH_ORIGIN);
  const apiOrigin = normalizeOrigin(process.env.INTEGRATION_API_URL, DEFAULT_API_ORIGIN);

  return Object.freeze({
    apiHealthUrl: apiOrigin + "/healthz",
    apiOrigin,
    siteApiSessionUrl: siteOrigin + "/api/session",
    siteConfigUrl: siteOrigin + "/configs/frontend-config.yml",
    siteMeUrl: siteOrigin + "/me",
    siteNonceUrl: siteOrigin + "/auth/nonce",
    siteOrigin,
    siteRootUrl: siteOrigin + "/",
    siteTauthScriptUrl: siteOrigin + "/tauth.js",
    tauthNonceUrl: tauthOrigin + "/auth/nonce",
    tauthOrigin,
    tauthScriptUrl: tauthOrigin + "/tauth.js",
  });
}

function pickTransport(urlString) {
  return urlString.startsWith("https:") ? https : http;
}

function requestText(urlString, options) {
  const requestOptions = Object.assign(
    {
      headers: {},
      method: "GET",
    },
    options || {},
  );

  return new Promise((resolve, reject) => {
    const urlObject = new URL(urlString);
    const transport = pickTransport(urlString);
    const request = transport.request(
      urlObject,
      {
        headers: requestOptions.headers,
        method: requestOptions.method,
      },
      (response) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
        response.on("end", () => {
          resolve({
            body: Buffer.concat(chunks).toString("utf8"),
            headers: response.headers,
            statusCode: response.statusCode || 0,
          });
        });
      },
    );

    request.on("error", reject);
    request.end(requestOptions.body);
  });
}

function hasAllowedStatus(statusCode, allowedStatusCodes) {
  return allowedStatusCodes.indexOf(statusCode) >= 0;
}

async function waitForUrl(urlString, allowedStatusCodes, timeoutMs) {
  const startTime = Date.now();

  while (Date.now() - startTime <= timeoutMs) {
    try {
      const response = await requestText(urlString);
      if (hasAllowedStatus(response.statusCode, allowedStatusCodes)) {
        return response;
      }
    } catch {}

    await new Promise((resolve) => setTimeout(resolve, DEFAULT_POLL_INTERVAL_MS));
  }

  throw new Error(
    "Timed out waiting for " +
      urlString +
      " to return one of [" +
      allowedStatusCodes.join(", ") +
      "]",
  );
}

async function waitForIntegrationEnvironment(environment, timeoutMs) {
  const resolvedTimeoutMs =
    typeof timeoutMs === "number" && timeoutMs > 0 ? timeoutMs : DEFAULT_WAIT_TIMEOUT_MS;

  await waitForUrl(environment.siteRootUrl, [200], resolvedTimeoutMs);
  await waitForUrl(environment.siteTauthScriptUrl, [200], resolvedTimeoutMs);
  await waitForUrl(environment.apiHealthUrl, [200], resolvedTimeoutMs);
  await waitForUrl(environment.tauthScriptUrl, [200], resolvedTimeoutMs);
}

function assertStatus(response, allowedStatusCodes, contextMessage) {
  if (!hasAllowedStatus(response.statusCode, allowedStatusCodes)) {
    throw new Error(
      contextMessage +
        " returned " +
        response.statusCode +
        "; expected one of [" +
        allowedStatusCodes.join(", ") +
        "]",
    );
  }
}

function assertBodyContains(bodyText, expectedFragment, contextMessage) {
  if (bodyText.indexOf(expectedFragment) === -1) {
    throw new Error(contextMessage + ' did not contain "' + expectedFragment + '"');
  }
}

function assertHeaderEquals(headers, headerName, expectedValue, contextMessage) {
  const actualValue = headers[String(headerName).toLowerCase()];
  if (actualValue !== expectedValue) {
    throw new Error(
      contextMessage +
        ' expected header "' +
        headerName +
        '" to be "' +
        expectedValue +
        '" but found "' +
        actualValue +
        '"',
    );
  }
}

function assertCanonicalLocalOrigin(configText, expectedOrigin) {
  assertBodyContains(configText, expectedOrigin, "frontend-config.yml");
  if (configText.indexOf("http://localhost:8080") >= 0) {
    throw new Error('frontend-config.yml still references "http://localhost:8080"');
  }
}

function assertNoncePayload(bodyText, contextMessage) {
  let parsedBody = null;

  try {
    parsedBody = JSON.parse(bodyText);
  } catch (error) {
    throw new Error(contextMessage + " returned invalid JSON");
  }

  if (!parsedBody || typeof parsedBody.nonce !== "string" || parsedBody.nonce.length === 0) {
    throw new Error(contextMessage + " did not return a nonce");
  }
}

function assertHelperExports(bodyText, contextMessage) {
  assertBodyContains(bodyText, 'window["getCurrentUser"] = getCurrentUser;', contextMessage);
}

async function runAuthPreflight(environment) {
  const configText = fs.readFileSync(resolveConfigPath("frontend-config.yml"), "utf8");
  const sessionConfig = getSignedSessionConfig();
  const sessionIdentity = createSessionIdentity();
  const sessionCookieHeader = createSessionCookieHeader(sessionIdentity);

  assertCanonicalLocalOrigin(configText, environment.siteOrigin);

  const rootResponse = await requestText(environment.siteRootUrl);
  assertStatus(rootResponse, [200], "GET " + environment.siteRootUrl);

  const siteTauthScriptResponse = await requestText(environment.siteTauthScriptUrl);
  assertStatus(siteTauthScriptResponse, [200], "GET " + environment.siteTauthScriptUrl);
  assertHelperExports(siteTauthScriptResponse.body, "site tauth.js");

  const siteConfigResponse = await requestText(environment.siteConfigUrl);
  assertStatus(siteConfigResponse, [200], "GET " + environment.siteConfigUrl);
  assertCanonicalLocalOrigin(siteConfigResponse.body, environment.siteOrigin);

  const meResponse = await requestText(environment.siteMeUrl);
  assertStatus(meResponse, [401, 403], "GET " + environment.siteMeUrl);

  const tenantAwareMeResponse = await requestText(environment.siteMeUrl, {
    headers: {
      "X-TAuth-Tenant": sessionConfig.tenantId,
    },
  });
  assertStatus(tenantAwareMeResponse, [401], "GET " + environment.siteMeUrl + " with tenant header");

  const sessionResponse = await requestText(environment.siteApiSessionUrl);
  assertStatus(sessionResponse, [401], "GET " + environment.siteApiSessionUrl);

  const authenticatedMeResponse = await requestText(environment.siteMeUrl, {
    headers: {
      Cookie: sessionCookieHeader,
      "X-TAuth-Tenant": sessionConfig.tenantId,
    },
  });
  assertStatus(authenticatedMeResponse, [200], "GET " + environment.siteMeUrl + " with signed session");
  assertBodyContains(
    authenticatedMeResponse.body,
    sessionIdentity.userEmail,
    "authenticated /me response",
  );

  const authenticatedSessionResponse = await requestText(environment.siteApiSessionUrl, {
    headers: {
      Cookie: sessionCookieHeader,
    },
  });
  assertStatus(
    authenticatedSessionResponse,
    [200],
    "GET " + environment.siteApiSessionUrl + " with signed session",
  );
  assertBodyContains(
    authenticatedSessionResponse.body,
    sessionIdentity.userEmail,
    "authenticated /api/session response",
  );

  const nonceResponse = await requestText(environment.siteNonceUrl, {
    headers: { Origin: environment.siteOrigin },
    method: "POST",
  });
  assertStatus(nonceResponse, [200], "POST " + environment.siteNonceUrl);
  assertNoncePayload(nonceResponse.body, "POST " + environment.siteNonceUrl);

  const tauthOptionsResponse = await requestText(environment.tauthNonceUrl, {
    headers: {
      "Access-Control-Request-Method": "POST",
      Origin: environment.siteOrigin,
    },
    method: "OPTIONS",
  });
  assertStatus(tauthOptionsResponse, [204], "OPTIONS " + environment.tauthNonceUrl);
  assertHeaderEquals(
    tauthOptionsResponse.headers,
    "access-control-allow-origin",
    environment.siteOrigin,
    "OPTIONS " + environment.tauthNonceUrl,
  );

  const apiHealthResponse = await requestText(environment.apiHealthUrl);
  assertStatus(apiHealthResponse, [200], "GET " + environment.apiHealthUrl);

  const bootstrapResponse = await requestText(environment.siteOrigin + "/api/bootstrap", {
    headers: {
      Cookie: sessionCookieHeader,
    },
    method: "POST",
  });
  assertStatus(
    bootstrapResponse,
    [200],
    "POST " + environment.siteOrigin + "/api/bootstrap with signed session",
  );
  assertBodyContains(bootstrapResponse.body, "balance", "authenticated /api/bootstrap response");
}

module.exports = {
  getIntegrationEnvironment,
  runAuthPreflight,
  waitForIntegrationEnvironment,
};
