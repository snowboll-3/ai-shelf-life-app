
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
