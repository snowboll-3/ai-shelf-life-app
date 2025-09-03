const Ajv = require("ajv");
const addFormats = require("ajv-formats");
const fs = require("fs");

// Učitaj JSON šemu
const schema = JSON.parse(fs.readFileSync("./shelf_life_v2.schema.json", "utf8"));

// Inicijaliziraj AJV
const ajv = new Ajv({ allErrors: true, strict: true });
addFormats(ajv);

// Napravi validator iz šeme
const validate = ajv.compile(schema);

// Primjer VALIDNOG JSON-a (treba proći)
const data = {
  product: { name: "Milk 2%", barcode: "3850123456789", category: "dairy" },
  shelf_life: { unopened_days: 7, opened_days: 3, storage_temp: "cold", adjustment_factor: 1.0 },
  status: { confidence: 0.92, reason_codes: ["SKU_exact_match", "temperature_normal"], safe_to_consume: true },
  metadata: { last_updated: "2025-09-02T10:00:00Z", source: "LLM" }
};

const ok = validate(data);
if (!ok) {
  console.error("❌ Neispravan JSON:", validate.errors);
} else {
  console.log("✅ JSON je valjan!");
}
