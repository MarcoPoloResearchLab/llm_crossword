// @ts-check
"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "../..");
const RUNTIME_ROOT = path.join(ROOT, ".runtime");
const DEFAULT_CROSSWORD_API_ENV_FILE = ".env.crosswordapi.local";
const DEFAULT_TAUTH_CONFIG_FILE = "tauth.config.local.yaml";
const DEFAULT_INTEGRATION_USER_ID = "integration-user";
const DEFAULT_INTEGRATION_USER_EMAIL = "integration-user@example.com";
const DEFAULT_INTEGRATION_USER_NAME = "Integration User";
const DEFAULT_INTEGRATION_USER_AVATAR = "https://example.com/avatar.png";
const DEFAULT_SESSION_LIFETIME_SECONDS = 3600;
const CLOCK_SKEW_SECONDS = 30;

function resolveConfigPath(runtimeFileName, fallbackFileName) {
  const runtimePath = path.join(RUNTIME_ROOT, runtimeFileName);
  if (fs.existsSync(runtimePath)) {
    return runtimePath;
  }
  return path.join(ROOT, fallbackFileName);
}

function resolveEnvPath(variableName, defaultFileName) {
  const configuredPath = process.env[variableName];
  if (typeof configuredPath === "string" && configuredPath.trim().length > 0) {
    if (path.isAbsolute(configuredPath)) {
      return configuredPath;
    }
    return path.join(ROOT, configuredPath);
  }
  return path.join(ROOT, defaultFileName);
}

function parseEnvFile(filePath) {
  const fileText = fs.readFileSync(filePath, "utf8");
  const values = {};
  const lines = fileText.split(/\r?\n/u);

  for (const line of lines) {
    const trimmedLine = line.trim();
    if (!trimmedLine || trimmedLine.startsWith("#")) {
      continue;
    }
    const separatorIndex = trimmedLine.indexOf("=");
    if (separatorIndex <= 0) {
      continue;
    }
    const key = trimmedLine.slice(0, separatorIndex).trim();
    const value = trimmedLine.slice(separatorIndex + 1).trim();
    values[key] = value;
  }

  return values;
}

function readRequiredValue(record, key, sourceLabel) {
  const value = record[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(sourceLabel + ' is missing required key "' + key + '"');
  }
  return value.trim();
}

function readFirstMatch(filePath, pattern, description) {
  const fileText = fs.readFileSync(filePath, "utf8");
  const match = fileText.match(pattern);
  if (!match || typeof match[1] !== "string" || match[1].trim().length === 0) {
    throw new Error(path.basename(filePath) + " is missing " + description);
  }
  return match[1].trim();
}

function assertMatchingValue(actualValue, expectedValue, description) {
  if (actualValue !== expectedValue) {
    throw new Error(description + ' mismatch: "' + actualValue + '" !== "' + expectedValue + '"');
  }
}

function getSignedSessionConfig() {
  const crosswordApiEnvPath = resolveEnvPath("CROSSWORDAPI_ENV_FILE", DEFAULT_CROSSWORD_API_ENV_FILE);
  const tauthConfigPath = resolveConfigPath("tauth.config.yaml", DEFAULT_TAUTH_CONFIG_FILE);
  const crosswordApiEnv = parseEnvFile(crosswordApiEnvPath);

  const signingKey = readRequiredValue(
    crosswordApiEnv,
    "CROSSWORDAPI_JWT_SIGNING_KEY",
    path.basename(crosswordApiEnvPath),
  );
  const issuer = readRequiredValue(
    crosswordApiEnv,
    "CROSSWORDAPI_JWT_ISSUER",
    path.basename(crosswordApiEnvPath),
  );
  const cookieName = readRequiredValue(
    crosswordApiEnv,
    "CROSSWORDAPI_JWT_COOKIE_NAME",
    path.basename(crosswordApiEnvPath),
  );

  const tauthSigningKey = readFirstMatch(
    tauthConfigPath,
    /^\s+jwt_signing_key:\s*"([^"]+)"/mu,
    "jwt_signing_key",
  );
  const tauthCookieName = readFirstMatch(
    tauthConfigPath,
    /^\s+session_cookie_name:\s*"([^"]+)"/mu,
    "session_cookie_name",
  );
  const tenantId = readFirstMatch(
    tauthConfigPath,
    /^\s*-\s+id:\s*"([^"]+)"/mu,
    "tenant id",
  );

  assertMatchingValue(signingKey, tauthSigningKey, "JWT signing key");
  assertMatchingValue(cookieName, tauthCookieName, "session cookie name");

  return Object.freeze({
    cookieName,
    issuer,
    signingKey,
    tenantId,
  });
}

function createSessionIdentity(overrides) {
  const identity = Object.assign(
    {
      userAvatarURL: DEFAULT_INTEGRATION_USER_AVATAR,
      userDisplayName: DEFAULT_INTEGRATION_USER_NAME,
      userEmail: DEFAULT_INTEGRATION_USER_EMAIL,
      userID: DEFAULT_INTEGRATION_USER_ID,
      userRoles: ["user"],
    },
    overrides || {},
  );

  if (!Array.isArray(identity.userRoles) || identity.userRoles.length === 0) {
    throw new Error("session identity must include at least one role");
  }

  return Object.freeze({
    userAvatarURL: String(identity.userAvatarURL),
    userDisplayName: String(identity.userDisplayName),
    userEmail: String(identity.userEmail),
    userID: String(identity.userID),
    userRoles: identity.userRoles.map((role) => String(role)),
  });
}

function toBase64Url(value) {
  return Buffer.from(value).toString("base64url");
}

function createSignedSessionToken(identityOverrides, options) {
  const sessionConfig = getSignedSessionConfig();
  const sessionIdentity = createSessionIdentity(identityOverrides);
  const sessionOptions = Object.assign(
    {
      lifetimeSeconds: DEFAULT_SESSION_LIFETIME_SECONDS,
      now: new Date(),
    },
    options || {},
  );
  const issuedAtSeconds = Math.floor(sessionOptions.now.getTime() / 1000);
  const expiresAtSeconds = issuedAtSeconds + Number(sessionOptions.lifetimeSeconds);

  const headerSegment = toBase64Url(
    JSON.stringify({
      alg: "HS256",
      typ: "JWT",
    }),
  );
  const payloadSegment = toBase64Url(
    JSON.stringify({
      exp: expiresAtSeconds,
      iat: issuedAtSeconds,
      iss: sessionConfig.issuer,
      nbf: issuedAtSeconds - CLOCK_SKEW_SECONDS,
      sub: sessionIdentity.userID,
      tenant_id: sessionConfig.tenantId,
      user_avatar_url: sessionIdentity.userAvatarURL,
      user_display_name: sessionIdentity.userDisplayName,
      user_email: sessionIdentity.userEmail,
      user_id: sessionIdentity.userID,
      user_roles: sessionIdentity.userRoles,
    }),
  );
  const unsignedToken = headerSegment + "." + payloadSegment;
  const signatureSegment = crypto
    .createHmac("sha256", sessionConfig.signingKey)
    .update(unsignedToken)
    .digest("base64url");

  return Object.freeze({
    cookieName: sessionConfig.cookieName,
    expiresAtSeconds,
    identity: sessionIdentity,
    token: unsignedToken + "." + signatureSegment,
  });
}

function createSessionCookieHeader(identityOverrides, options) {
  const session = createSignedSessionToken(identityOverrides, options);
  return session.cookieName + "=" + session.token;
}

async function installSignedSession(context, origin, identityOverrides, options) {
  const session = createSignedSessionToken(identityOverrides, options);
  await context.addCookies([
    {
      expires: session.expiresAtSeconds,
      httpOnly: true,
      name: session.cookieName,
      sameSite: "Strict",
      secure: false,
      url: origin,
      value: session.token,
    },
  ]);
  return session.identity;
}

module.exports = {
  createSessionCookieHeader,
  createSessionIdentity,
  createSignedSessionToken,
  getSignedSessionConfig,
  installSignedSession,
};
