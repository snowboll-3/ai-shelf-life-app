const { parseAndValidateLLM } = require("./validateShelfLife");
const fs = require("fs");
const path = require("path");

function appendJsonLine(filePath, obj) {
  const line = JSON.stringify(obj) + "\n";
  fs.appendFileSync(filePath, line, "utf8");
}

// Middleware: validira req.body i loguje nevaljane u invalid_results.jsonl
function validateShelfLifeBody(req, res, next) {
  try {
    const data = parseAndValidateLLM(req.body || "");
    req.validData = data;           // već VALIDNO po šemi
    return next();
  } catch (e) {
    appendJsonLine(path.join(__dirname, "invalid_results.jsonl"), {
      received_at: new Date().toISOString(),
      error: String(e && e.message ? e.message : e),
      raw_preview: String(req.body || "").slice(0, 300)
    });
    return res.status(400).json({ ok: false, saved: false, error: e.message });
  }
}

module.exports = { validateShelfLifeBody };
