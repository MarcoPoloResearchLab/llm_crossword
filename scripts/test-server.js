const express = require("express");
const { createInstrumenter } = require("istanbul-lib-instrument");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const instrumenter = createInstrumenter({ esModules: false, compact: false });

const app = express();

// Instrument JS files for coverage
app.get("/js/:file", (req, res) => {
  const filePath = path.join(ROOT, "js", req.params.file);
  if (!fs.existsSync(filePath)) return res.status(404).send("Not found");
  const code = fs.readFileSync(filePath, "utf8");
  try {
    const instrumented = instrumenter.instrumentSync(code, filePath);
    res.type("application/javascript").send(instrumented);
  } catch (e) {
    res.type("application/javascript").send(code); // fallback
  }
});

// Stub /tauth.js (proxied to TAuth in production, not needed in tests)
app.get("/tauth.js", (req, res) => {
  res.type("application/javascript").send("/* tauth.js stub for tests */");
});

// Serve static files
app.use(express.static(ROOT));

const PORT = process.env.TEST_PORT || 8111;
app.listen(PORT, () => console.log(`Test server on http://localhost:${PORT}`));
