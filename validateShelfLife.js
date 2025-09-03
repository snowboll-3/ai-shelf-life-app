const fs = require("fs");
const Ajv = require("ajv");
const addFormats = require("ajv-formats");

// Učitaj šemu (skini BOM ako postoji)
function loadJsonFileSmart(path) {
  const raw = fs.readFileSync(path, "utf8");
  let txt = raw.replace(/^\uFEFF/, "").trimStart();
  if (!txt.startsWith("{")) {
    const i = txt.indexOf("{");
    if (i >= 0) txt = txt.slice(i);
  }
  return JSON.parse(txt);
}

const schema = loadJsonFileSmart("./shelf_life_v2.schema.json");
const ajv = new Ajv({ allErrors: true, strict: true });
addFormats(ajv);
const validate = ajv.compile(schema);

// Izvuci prvi JSON objekt iz teksta balansiranjem vitičastih zagrada
function extractFirstJsonObject(text) {
  const s = (text || "").replace(/^\uFEFF/, "");
  let start = s.indexOf("{");
  if (start === -1) return null;
  let depth = 0;
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        const candidate = s.slice(start, i + 1);
        try { return JSON.parse(candidate); } catch { /* try dalje */ }
      }
    }
  }
  return null;
}

// Glavna funkcija: primi sirovi AI tekst -> JSON -> validiraj -> vrati objekt
function parseAndValidateLLM(rawText) {
  let data;
  try {
    data = JSON.parse(rawText); // ako je čist JSON
  } catch {
    data = extractFirstJsonObject(rawText);
  }
  if (!data) throw new Error("Nije pronađen valjan JSON u AI izlazu.");

  const ok = validate(data);
  if (!ok) {
    const msg = (validate.errors || [])
      .map(e => `${e.instancePath || "/"} ${e.message}`)
      .join("; ");
    throw new Error(`Nevaljan JSON prema AI Shelf-Life v2 šemi: ${msg}`);
  }
  return data;
}

module.exports = { parseAndValidateLLM };
