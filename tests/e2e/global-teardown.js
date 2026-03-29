// Global teardown: stop docker compose after integration tests.
const { execSync } = require("child_process");
const ROOT = require("path").join(__dirname, "../..");

module.exports = async function globalTeardown() {
  console.log("[integration] Stopping docker compose...");
  execSync("docker compose down", { cwd: ROOT, stdio: "inherit" });
  console.log("[integration] Docker compose stopped.");
};
