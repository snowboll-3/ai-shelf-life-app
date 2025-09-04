const express = require("express");
const fs = require("fs");
const path = require("path");
const { parseAndValidateLLM } = require("./validateShelfLife");

const app = express();

app.get('/dashboard.html', (req,res)=>res.redirect(301,'/dashboard.hr.html'));
app.get('/dashboard', (req,res)=>res.redirect(301,'/dashboard.hr.html'));
app.use(express.json());app.use(express.static(path.join(__dirname, "public")));
app.use(express.text({ type: "*/*", limit: "1mb" }));

// --- utils ---
const stripBom = (s) => s.replace(/^\uFEFF/, "");

function safeJSONParse(str) {
  try { return JSON.parse(str); } catch(_){ return null; }
}

function readJsonl(filePath) {
  if (!fs.existsSync(filePath)) return [];
  const raw = stripBom(fs.readFileSync(filePath, "utf8"));
  return raw.split(/\r?\n/).filter(Boolean).map(line => {
    try { return JSON.parse(line); } catch { return null; }
  }).filter(Boolean);
}

function paginate(list, pageQ, limitQ) {
  const page = Math.max(1, parseInt(pageQ || "1", 10));
  const limit = Math.max(1, parseInt(limitQ || "50", 10));
  const total = list.length;
  const pages = Math.ceil(total / limit) || 0;
  const start = (page - 1) * limit;
  const items = list.slice(start, start + limit);
  return { page, limit, total, pages, items };
}

function toCsv(header, rows) {
  const esc = (v) => {
    if (v === null || v === undefined) return "";
    const s = String(v);
    return `"${s.replace(/"/g, '""')}"`;
  };
  const head = header.map(esc).join(",");
  const body = rows.map(r => r.map(esc).join(",")).join("\n");
  return head + "\n" + body + (rows.length ? "\n" : "");
}

// --- health/version/metrics ---
app.get("/health", (req, res) => {
  res.json({ ok: true, now: new Date().toISOString(), uptime_s: Math.round(process.uptime()) });
});

app.get("/version", (req, res) => {
  const schemaPath = path.join(__dirname, "shelf_life_v2.schema.json");
  let stat = null;
  try { stat = fs.statSync(schemaPath); } catch { /* ignore */ }
  res.json({
    ok: true,
    app: { name: "ai-shelf-life-app", version: "1.0.0" },
    runtime: {
      node: process.version,
      express: require("express/package.json").version,
      ajv: require("ajv/package.json").version
    },
    schema: {
      file: "shelf_life_v2.schema.json",
      exists: !!stat,
      modified_at: stat ? new Date(stat.mtime).toISOString() : null,
      size_bytes: stat ? stat.size : 0
    }
  });
});

app.get("/metrics", (req, res) => {
  try {
    const v = path.join(__dirname, "valid_results.jsonl");
    const i = path.join(__dirname, "invalid_results.jsonl");
    const V = readJsonl(v);
    const I = readJsonl(i);
    res.json({
      ok: true,
      files: {
        valid: { exists: fs.existsSync(v), total: V.length, size_bytes: fs.existsSync(v) ? fs.statSync(v).size : 0 },
        invalid:{ exists: fs.existsSync(i), total: I.length, size_bytes: fs.existsSync(i) ? fs.statSync(i).size : 0 }
      },
      totals: { received: V.length + I.length, valid: V.length, invalid: I.length }
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e && e.message ? e.message : e) });
  }
});

// --- LLM rezultat: parse + validate + spremanje ---
app.post("/llm-result", (req, res) => {
  try {
    const body = String(req.body || "");
    // dopusti "Model kaže: ... {json} ... "
    const jsonBlock = body.match(/\{[\s\S]*\}$/m);
    const textToParse = jsonBlock ? jsonBlock[0] : body;

    let data;
    try {
      data = parseAndValidateLLM(textToParse);
    } catch (schemaErr) {
      // spremi u invalid_results.jsonl
      const invalidLine = JSON.stringify({
        received_at: new Date().toISOString(),
        error: schemaErr.message,
        raw_preview: body.slice(0, 500)
      }) + "\n";
      fs.appendFileSync(path.join(__dirname, "invalid_results.jsonl"), invalidLine, "utf8");
      return res.status(400).json({ ok: false, saved: false, error: schemaErr.message });
    }

    const validLine = JSON.stringify({ received_at: new Date().toISOString(), data }) + "\n";
    fs.appendFileSync(path.join(__dirname, "valid_results.jsonl"), validLine, "utf8");
    return res.status(200).json({ ok: true, saved: true, data });
  } catch (e) {
    const invalidLine = JSON.stringify({
      received_at: new Date().toISOString(),
      error: String(e && e.message ? e.message : e),
      raw_preview: String(req.body || "").slice(0, 500)
    }) + "\n";
    fs.appendFileSync(path.join(__dirname, "invalid_results.jsonl"), invalidLine, "utf8");
    return res.status(400).json({ ok: false, saved: false, error: String(e && e.message ? e.message : e) });
  }
});

// --- LOGS (JSON) — sortirano po datumu silazno ---
app.get("/logs/valid", (req, res) => {
  const list = readJsonl(path.join(__dirname, "valid_results.jsonl"));
  list.sort((a, b) => (new Date(b.received_at) - new Date(a.received_at)));
  const { page, limit, total, pages, items } = paginate(list, req.query.page, req.query.limit);
  res.json({ page, limit, total, pages, items });
});

app.get("/logs/invalid", (req, res) => {
  const list = readJsonl(path.join(__dirname, "invalid_results.jsonl"));
  list.sort((a, b) => (new Date(b.received_at) - new Date(a.received_at)));
  const { page, limit, total, pages, items } = paginate(list, req.query.page, req.query.limit);
  res.json({ page, limit, total, pages, items });
});

// --- LOGS (CSV) ---
app.get("/logs/valid.csv", (req, res) => {
  const list = readJsonl(path.join(__dirname, "valid_results.jsonl"));
  list.sort((a, b) => (new Date(b.received_at) - new Date(a.received_at)));
  const header = ["received_at","product","shelf_life","status","metadata"];
  const rows = list.map(x => ([
    x.received_at,
    JSON.stringify(x.data?.product ?? null),
    JSON.stringify(x.data?.shelf_life ?? null),
    JSON.stringify(x.data?.status ?? null),
    JSON.stringify(x.data?.metadata ?? null),
  ]));
  const csv = toCsv(header, rows);
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.send(csv);
});

app.get("/logs/invalid.csv", (req, res) => {
  const list = readJsonl(path.join(__dirname, "invalid_results.jsonl"));
  list.sort((a, b) => (new Date(b.received_at) - new Date(a.received_at)));
  const header = ["received_at","error","raw_preview"];
  const rows = list.map(x => ([
    x.received_at,
    x.error ?? "",
    x.raw_preview ?? "",
  ]));
  const csv = toCsv(header, rows);
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.send(csv);
});

// --- Tester (simple web forma) ---
app.get("/tester", (req, res) => {
  res.send(`<!doctype html>
<html lang="hr"><head><meta charset="utf-8"><title>AI Shelf-Life Tester</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
 body{font-family:Arial,Helvetica,sans-serif;margin:20px;max-width:900px}
 textarea{width:100%;height:200px}
 .row{display:flex;gap:10px;flex-wrap:wrap}
 button{padding:8px 12px}
 pre{background:#f6f8fa;padding:10px;overflow:auto}
</style></head><body>
<h2>AI Shelf-Life Tester</h2>
<p>Ubaci AI output (može biti tekst sa JSON blokom). Klikni <b>Validiraj</b>.</p>
<div class="row">
  <button onclick="fillGood()">Ubaci valjani primjer</button>
  <button onclick="fillBad()">Ubaci nevaljani primjer</button>
</div>
<textarea id="inp"></textarea>
<div class="row">
  <button onclick="send()">Validiraj</button>
  <a href="/dashboard" target="_blank">🚀 Otvori Dashboard</a>
</div>
<pre id="out"></pre>
<script>
function fillGood(){
  document.getElementById('inp').value =
'Model kaže:\\n{\\n  "product": {"name":"Milk 2%","barcode":"3850123456789","category":"dairy"},\\n  "shelf_life": {"unopened_days":7,"opened_days":3,"storage_temp":"cold","adjustment_factor":1},\\n  "status": {"confidence":0.92,"reason_codes":["SKU_exact_match","temperature_normal"],"safe_to_consume":true},\\n  "metadata": {"last_updated":"2025-09-02T10:00:00Z","source":"LLM"}\\n}';
}
function fillBad(){
  document.getElementById('inp').value =
'Model kaže:\\n{\\n  product:{name:Milk,barcode:123,category:null},\\n  shelf_life:{unopened_days:-1,opened_days:2,storage_temp:fridge,adjustment_factor:1.2,note:x},\\n  status:{confidence:1.2,reason_codes:[unknown_code],safe_to_consume:true},\\n  metadata:{last_update:2025-09-02T10:00:00Z,source:LLM}\\n}';
}
async function send(){
  const txt = document.getElementById('inp').value;
  const r = await fetch('/llm-result',{method:'POST',headers:{'Content-Type':'text/plain; charset=utf-8'},body:txt});
  const j = await r.text();
  document.getElementById('out').textContent = j;
}
</script>
</body></html>`);
});

// --- Dashboard (simple) ---
app.get("/dashboard", (req, res) => {
  res.send(`<!doctype html>
<html lang="hr"><head><meta charset="utf-8"><title>AI Shelf-Life – Dashboard</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
 body{font-family:Arial,Helvetica,sans-serif;margin:20px;max-width:1200px}
 table{border-collapse:collapse;width:100%}
 th,td{border:1px solid #ddd;padding:8px;vertical-align:top}
 th{background:#f3f3f3}
 .controls{display:flex;gap:10px;align-items:center;margin:10px 0;flex-wrap:wrap}
</style></head><body>
<h2>AI Shelf-Life – Dashboard</h2>
<div class="controls">
  <span id="stats"></span>
  <label>Tip:
    <select id="t">
      <option value="valid">valid</option>
      <option value="invalid">invalid</option>
    </select>
  </label>
  <label>Limit: <input id="l" type="number" value="10" min="1" style="width:80px"></label>
  <button onclick="loadData()">Osvježi</button>
  <a href="/tester" target="_blank">🧪 Tester</a>
</div>
<table>
  <thead><tr><th>Time</th><th>Product</th><th>Shelf life</th><th>Status</th><th>Metadata</th></tr></thead>
  <tbody id="tb"></tbody>
</table>
<script>
async function loadStats(){
  const r = await fetch('/metrics'); const j = await r.json();
  document.getElementById('stats').textContent = \`Total: \${j.totals.received} | Valid: \${j.totals.valid} | Invalid: \${j.totals.invalid}\`;
}
function td(v){return '<td>'+v+'</td>'}
function fmtProd(p){ if(!p) return ''; return (p.name||'')+'<br>Barcode: '+(p.barcode||'')+'<br>'+(p.category||''); }
function fmtSL(s){ if(!s) return ''; return 'unopened: '+s.unopened_days+' d<br>opened: '+s.opened_days+' d<br>temp: '+s.storage_temp; }
function fmtSt(s){ if(!s) return ''; return 'confidence: '+s.confidence+'<br>safe: '+s.safe_to_consume+'<br>codes: '+(s.reason_codes||[]).join(', '); }
function fmtMeta(m){ if(!m) return ''; return 'updated: '+m.last_updated+'<br>source: '+m.source; }

async function loadData(){
  await loadStats();
  const type=document.getElementById('t').value;
  const lim=Number(document.getElementById('l').value)||10;
  const r=await fetch('/logs/'+type+'?page=1&limit='+lim); const j=await r.json();
  const tb=document.getElementById('tb'); tb.innerHTML='';
  j.items.forEach(row=>{
    let p=row.data?.product, sl=row.data?.shelf_life, st=row.data?.status, md=row.data?.metadata;
    tb.insertAdjacentHTML('beforeend','<tr>'+td(row.received_at)+td(fmtProd(p))+td(fmtSL(sl))+td(fmtSt(st))+td(fmtMeta(md))+'</tr>');
  });
}
loadData();
</script>
</body></html>`);
});

// --- start ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Server running on http://localhost:${PORT}`));


app.delete("/logs/clean", (req, res) => {
  try {
    const fileKey = (req.query.file || "invalid").toString();
    const fileName = fileKey === "valid" ? "valid_results.jsonl" : "invalid_results.jsonl";
    const days = parseInt((req.query.older_than_days || "0").toString(), 10);
    if (!Number.isFinite(days) || days <= 0) {
      return res.status(400).json({ ok: false, error: "Parametar older_than_days mora biti > 0." });
    }

    const fullPath = path.join(__dirname, fileName);
    if (!fs.existsSync(fullPath)) {
      return res.json({ ok: true, file: fileName, deleted: 0, kept: 0, message: "Datoteka ne postoji." });
    }

    const cutoffMs = Date.now() - days * 24 * 60 * 60 * 1000;
    const cutoffISO = new Date(cutoffMs).toISOString();

    const raw = fs.readFileSync(fullPath, "utf8").replace(/^\uFEFF/, "");
    const lines = raw.split(/\r?\n/).filter(Boolean);

    let kept = [];
    let deletedCount = 0;

    for (const line of lines) {
      let obj;
      try { obj = JSON.parse(line); } catch { obj = null; }
      const ts = obj && obj.received_at ? Date.parse(obj.received_at) : NaN;
      if (Number.isFinite(ts) && ts < cutoffMs) {
        deletedCount++;
      } else {
        kept.push(line);
      }
    }

    fs.writeFileSync(fullPath, kept.length ? kept.join("\n") + "\n" : "", "utf8");

    return res.json({ ok: true, file: fileName, cutoff_iso: cutoffISO, deleted: deletedCount, kept: kept.length });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e && e.message ? e.message : String(e) });
  }
});




app.get('/scan',(req,res)=>res.sendFile(path.join(__dirname,'public','scan.html')));
/* ---------------- Opened items persistence (JSON) ---------------- */
const OPENED_FILE = path.join(__dirname, "data", "opened.json");

function loadOpenedMap() {
  try {
    if (!fs.existsSync(OPENED_FILE)) return {};
    const raw = fs.readFileSync(OPENED_FILE, "utf8");
    return raw ? JSON.parse(raw) : {};
  } catch (e) { console.error("opened: read error:", e); return {}; }
}
function saveOpenedMap(map) {
  try {
    fs.writeFileSync(OPENED_FILE, JSON.stringify(map, null, 2));
  } catch (e) { console.error("opened: write error:", e); }
}

/** GET /items/opened?keys=a,b,c  -> { key: iso, ... } */
app.get("/items/opened", (req, res) => {
  const all = loadOpenedMap();
  const keys = String(req.query.keys || "").split(",").map(s => s.trim()).filter(Boolean);
  if (!keys.length) return res.json(all);
  const out = {};
  for (const k of keys) if (all[k]) out[k] = all[k];
  res.json(out);
});

/** POST /items/opened { key, opened_at? } */
app.post("/items/opened", (req, res) => {
  const { key, opened_at } = req.body || {};
  if (!key) return res.status(400).json({ error: "key required" });
  const all = loadOpenedMap();
  all[key] = opened_at || new Date().toISOString();
  saveOpenedMap(all);
  res.json({ ok: true, key, opened_at: all[key] });
});

/** DELETE /items/opened?key=... */
app.delete("/items/opened", (req, res) => {
  const key = String(req.query.key || "");
  if (!key) return res.status(400).json({ error: "key required" });
  const all = loadOpenedMap();
  delete all[key];
  saveOpenedMap(all);
  res.json({ ok: true, key });
});
/* ----------------------------------------------------------------- */




