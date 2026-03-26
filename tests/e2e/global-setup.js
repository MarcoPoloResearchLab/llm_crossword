// Global setup: start docker compose before integration tests.
const { execSync } = require("child_process");
const http = require("http");

const ROOT = require("path").join(__dirname, "../..");
const SITE_URL = process.env.INTEGRATION_URL || "http://localhost:8000";
const MAX_WAIT_MS = 60000;
const POLL_INTERVAL_MS = 2000;

function waitForSite(url, timeoutMs) {
  var start = Date.now();
  return new Promise(function (resolve, reject) {
    function poll() {
      if (Date.now() - start > timeoutMs) {
        return reject(new Error("Timed out waiting for " + url));
      }
      var req = http.get(url, function (res) {
        if (res.statusCode >= 200 && res.statusCode < 500) {
          res.resume();
          return resolve();
        }
        res.resume();
        setTimeout(poll, POLL_INTERVAL_MS);
      });
      req.on("error", function () {
        setTimeout(poll, POLL_INTERVAL_MS);
      });
      req.setTimeout(POLL_INTERVAL_MS);
    }
    poll();
  });
}

module.exports = async function globalSetup() {
  console.log("[integration] Starting docker compose...");
  execSync("docker compose up -d", { cwd: ROOT, stdio: "inherit" });
  console.log("[integration] Waiting for site at " + SITE_URL + "...");
  await waitForSite(SITE_URL, MAX_WAIT_MS);
  console.log("[integration] Site is up.");
};
