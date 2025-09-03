const { parseAndValidateLLM } = require("./validateShelfLife");

const rawModelOutput = `
Evo rezultata:
{
  "product": {"name":"Milk 2%","barcode":"3850123456789","category":"dairy"},
  "shelf_life":{"unopened_days":7,"opened_days":3,"storage_temp":"cold","adjustment_factor":1.0},
  "status":{"confidence":0.92,"reason_codes":["SKU_exact_match","temperature_normal"],"safe_to_consume":true},
  "metadata":{"last_updated":"2025-09-02T10:00:00Z","source":"LLM"}
}
Hvala!`;

try {
  const obj = parseAndValidateLLM(rawModelOutput);
  console.log("✅ Parsirano i validirano:", obj);
} catch (e) {
  console.error("❌ Greška:", e.message);
}
