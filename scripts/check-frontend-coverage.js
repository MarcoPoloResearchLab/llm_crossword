"use strict";

const fs = require("fs");
const path = require("path");

const coverageSummaryPath = path.join(__dirname, "..", "coverage", "coverage-summary.json");
const minimumCoverage = Object.freeze({
  branches: 99.3,
  functions: 100.0,
  lines: 99.8,
  statements: 99.7,
});

function readCoverageSummary(summaryPath) {
  return JSON.parse(fs.readFileSync(summaryPath, "utf8"));
}

function formatPercent(value) {
  return Number(value).toFixed(2).replace(/\.00$/, "");
}

function main() {
  if (!fs.existsSync(coverageSummaryPath)) {
    throw new Error("coverage summary not found at " + coverageSummaryPath);
  }

  const summary = readCoverageSummary(coverageSummaryPath);
  const total = summary && summary.total;

  if (!total || typeof total !== "object") {
    throw new Error("coverage summary is missing total coverage data");
  }

  const failures = [];
  for (const [metric, minimum] of Object.entries(minimumCoverage)) {
    const actual = total[metric] && typeof total[metric].pct === "number"
      ? total[metric].pct
      : NaN;

    if (!Number.isFinite(actual)) {
      failures.push(metric + " coverage is unavailable");
      continue;
    }
    if (actual < minimum) {
      failures.push(
        metric + " coverage must be at least " + formatPercent(minimum) + "% (got " + formatPercent(actual) + "%)"
      );
    }
  }

  if (failures.length > 0) {
    failures.forEach(function printFailure(message) {
      console.error(message);
    });
    process.exit(1);
  }
}

main();
