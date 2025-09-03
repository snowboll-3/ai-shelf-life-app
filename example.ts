import { AIShelfLifeV2 } from "./types/shelf_life_v2";

function processShelfLife(data: AIShelfLifeV2) {
  console.log("Proizvod:", data.product.name);
  console.log("Barkod:", data.product.barcode);
  console.log("Shelf life (otvoreno):", data.shelf_life.opened_days, "dana");
  console.log("Status (sigurno za konzumaciju?):", data.status.safe_to_consume);
}

const sample: AIShelfLifeV2 = {
  product: { name: "Milk 2%", barcode: "3850123456789", category: "dairy" },
  shelf_life: {
    unopened_days: 7,
    opened_days: 3,
    storage_temp: "cold",
    adjustment_factor: 1
  },
  status: {
    confidence: 0.92,
    reason_codes: ["SKU_exact_match", "temperature_normal"],
    safe_to_consume: true
  },
  metadata: { last_updated: "2025-09-02T10:00:00Z", source: "LLM" }
};

processShelfLife(sample);
