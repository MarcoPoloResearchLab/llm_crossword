// @ts-check
"use strict";

// Global setup: start docker compose before integration tests.
const { execSync } = require("child_process");
const {
  getIntegrationEnvironment,
  runAuthPreflight,
  waitForIntegrationEnvironment,
} = require("./auth-preflight");

const ROOT = require("path").join(__dirname, "../..");

module.exports = async function globalSetup() {
  const integrationEnvironment = getIntegrationEnvironment();

  console.log("[integration] Starting docker compose...");
  execSync("docker compose up -d --build --force-recreate", { cwd: ROOT, stdio: "inherit" });

  console.log("[integration] Waiting for services...");
  await waitForIntegrationEnvironment(integrationEnvironment);

  console.log("[integration] Running auth preflight...");
  await runAuthPreflight(integrationEnvironment);

  console.log("[integration] Integration environment is ready.");
};
