/* ===== SAFE HEADER (auto) ===== */
const express = require("express");
const app = express();

// body limit (za OCR/data URLs)
app.use(express.json({ limit: "3mb" }));

// statika
app.use("/public", express.static(__dirname + "/public"));
/* ===== END HEADER ===== */

// === BARCODE LOOKUP API (Open Food Facts) ===
app.get("/api/barcode_lookup", async (req, res) => {
  try {
    const code = String(req.query.code||"").trim();
    if (!/^\d{8,14}$/.test(code)) {
      return res.status(400).json({ ok:false, error:"invalid_code" });
    }
    const url = `https://world.openfoodfacts.org/api/v2/product/${code}.json`;
    const r = await fetch(url, { headers:{ "User-Agent":"ai-shelf-life-app (Render)" }});
    if (!r.ok) return res.status(502).json({ ok:false, error:"upstream", status:r.status });

    const j = await r.json();
    if (j && (j.status === 1 || j.product)) {
      const p = j.product || {};
      const name = p.product_name || p.generic_name || "";
      const brand = p.brands || "";
      const quantity = p.quantity || "";
      return res.json({ ok:true, code, name, brand, quantity });
    }
    return res.json({ ok:false, code, name:"" });
  } catch (e) {
    console.error("lookup error:", e && e.message || e);
    return res.status(500).json({ ok:false, error:"server_error" });
  }
});
// === END BARCODE LOOKUP ===
// === BARCODE LOOKUP API (Open Food Facts) ===
app.get("/api/barcode_lookup", async (req, res) => {
  try {
    const code = String(req.query.code||"").trim();
    if (!/^\d{8,14}$/.test(code)) {
      return res.status(400).json({ ok:false, error:"invalid_code" });
    }
    const url = `https://world.openfoodfacts.org/api/v2/product/${code}.json`;
    const r = await fetch(url, { headers:{ "User-Agent":"ai-shelf-life-app (Render)" }});
    if (!r.ok) return res.status(502).json({ ok:false, error:"upstream", status:r.status });

    const j = await r.json();
    if (j && (j.status === 1 || j.product)) {
      const p = j.product || {};
      const name = p.product_name || p.generic_name || "";
      const brand = p.brands || "";
      const quantity = p.quantity || "";
      return res.json({ ok:true, code, name, brand, quantity });
    }
    return res.json({ ok:false, code, name:"" });
  } catch (e) {
    console.error("lookup error:", e && e.message || e);
    return res.status(500).json({ ok:false, error:"server_error" });
  }
});
// === END BARCODE LOOKUP ===

/* ===== LISTEN (auto) ===== */
const PORT = process.env.PORT || 3035;
app.get("/health", (req,res)=>res.status(200).send("ok"));
app.listen(PORT, ()=>{ console.log(`✅ Server on http://127.0.0.1:${PORT}`); });
/* ===== END LISTEN ===== */

