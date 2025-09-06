const express = require("express");
const { parseAndValidateLLM } = require("./validateShelfLife");

const app = express();


// serve static files
app.use(express.static('public'));
app.get('/dashboard.html', (req,res)=>res.redirect(301,'/dashboard.hr.html'));
app.get('/dashboard', (req,res)=>res.redirect(301,'/dashboard.hr.html'));
app.use(express.json({ limit: '8mb' }));app.use(express.static(path.join(__dirname, "public")));
app.use(express.text({ type: 'text/plain', limit: '1mb' }));

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




/* ====== API: product lookup, OCR date, save scan ====== */

/* 1) Proizvod po barkodu – OpenFoodFacts */
app.get('/api/product/:barcode', async (req, res) => {
  try {
    const bc = String(req.params.barcode || '').trim();
    if (!bc) return res.status(400).json({ error: 'barcode required' });
    const url = `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(bc)}.json`;
    const r = await fetch(url, { headers: { 'User-Agent': 'ai-shelf-life-app/0.1 (+local)' } });
    if (!r.ok) return res.json({ name: null });
    const j = await r.json();
    const p = j?.product || {};
    const name = p.product_name || p.generic_name || null;
    const brand = (Array.isArray(p.brands_tags) && p.brands_tags[0]) || p.brands || null;
    res.json({ name, brand });
  } catch (e) {
    console.error('product lookup error', e);
    res.json({ name: null });
  }
});

/* 2) OCR datuma – Tesseract.js + heuristike */
var Tesseract = globalThis.__tesseract || (globalThis.__tesseract = require('tesseract.js'));

function parseDatesHeuristic(rawText){
  let t = (rawText || '').replace(/\s+/g,' ').trim();
  const upper = t.toUpperCase();
  const MONTHS = {
    JAN:1,FEB:2,MAR:3,APR:4,MAY:5,JUN:6,JUL:7,AUG:8,SEP:9,OCT:10,NOV:11,DEC:12,
    SIJ:1, VELJ:2, OŽU:3, OZU:3, TRA:4, SVI:5, LIP:6, SRP:7, KOL:8, RUJ:9, LIS:10, STU:11, PRO:12
  };
  const reISO   = /\b(20[2-4]\d)[.\-\/](0?[1-9]|1[0-2])[.\-\/](0?[1-9]|[12]\d|3[01])\b/g;
  const reEU    = /\b(0?[1-9]|[12]\d|3[01])[.\-\/](0?[1-9]|1[0-2])[.\-\/]((?:20)?\d{2})\b/g;
  const reText1 = new RegExp(`\\b(0?[1-9]|[12]\\d|3[01])\\s*(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC|SIJ|VELJ|OŽU|OZU|TRA|SVI|LIP|SRP|KOL|RUJ|LIS|STU|PRO)[\\s.,-]*(\\d{2,4})\\b`,'g');
  const reText2 = new RegExp(`\\b(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC|SIJ|VELJ|OŽU|OZU|TRA|SVI|LIP|SRP|KOL|RUJ|LIS|STU|PRO)[\\s.,-]*(0?[1-9]|[12]\\d|3[01])[\\s.,-]*(\\d{2,4})\\b`,'g');
  const KEYS = ['BEST BEFORE','USE BY','EXP','BBE','MHD','UPOTRIJEBITI DO','NAJBOLJE','ROK','ISTJEČE',' DO '];

  function windowScore(idx){
    const w = 20;
    const seg = upper.slice(Math.max(0, idx - w), Math.min(upper.length, idx + w));
    let s = 0; for (const k of KEYS) if (seg.includes(k)) s += 10; return s;
  }
  function makeISO(y,m,d){
    const iso = y + '-' + pad(m) + '-' + pad(d);
    if (isNaN(iso.getTime())) return null;
    return iso.toISOString().slice(0,10);
  }
  const candidates = [];
  function addCand(raw, y,m,d, idx){
    const iso = y + '-' + pad(m) + '-' + pad(d); if (!iso) return;
    const today = new Date(); const dt = new Date(iso);
    let score = 0;
    const diffDays = Math.round((dt - today)/86400000);
    if (diffDays < -1) score -= 20;
    if (diffDays >= 0 && diffDays <= 730) score += 20;
    score += windowScore(idx);
    if (/^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}$/.test(raw)) score += 2;
    candidates.push({ raw, iso, score });
  }
  for (const m of upper.matchAll(reISO))  { const [raw,Y,M,D] = m; addCand(raw, Y,M,D, m.index||0); }
  for (const m of upper.matchAll(reEU))   { const [raw,D,M,Y] = m; const year=(String(Y).length===2)?(Number(Y)+2000):Number(Y); addCand(raw, year,M,D, m.index||0); }
  for (const m of upper.matchAll(reText1)){ const [raw,D,MON,Y]=m; const MM=MONTHS[MON]||0; const year=(String(Y).length===2)?(Number(Y)+2000):Number(Y); if(MM) addCand(raw, year,MM,D, m.index||0); }
  for (const m of upper.matchAll(reText2)){ const [raw,MON,D,Y]=m; const MM=MONTHS[MON]||0; const year=(String(Y).length===2)?(Number(Y)+2000):Number(Y); if(MM) addCand(raw, year,MM,D, m.index||0); }
  candidates.sort((a,b)=> b.score - a.score);
  return { candidates, best: candidates[0] || null, text: rawText };
}

app.post('/api/ocr-date', async (req, res) => {
  try {
    const dataURL = String(req.body?.imageData || '');
    if (!dataURL.startsWith('data:image/')) return res.status(400).json({ error: 'imageData dataURL required' });
    const b64 = dataURL.split(',')[1];
    const buf = Buffer.from(b64, 'base64');
    const result = await Tesseract.recognize(buf, 'eng', {}); // kasnije: 'eng+hrv'
    const text = result?.data?.text || '';
    const parsed = parseDatesHeuristic(text);
    res.json(parsed);
  } catch (e) {
    console.error('ocr error', e);
    res.status(500).json({ error: String(e?.message || e) });
  }
});

/* 3) Spremi sken u JSONL (bez slike, po defaultu) */
const SCANS_FILE = path.join(__dirname, "data", "scans.jsonl");
function appendJSONL(file, obj){
  try{
    fs.mkdirSync(path.dirname(file), { recursive:true });
    fs.appendFileSync(file, JSON.stringify(obj) + "\n");
  }catch(e){ console.error('appendJSONL error', e); }
}
app.post('/api/scan/save', (req, res) => {
  const { barcode, product, expiry, ocr_raw, imageData } = req.body || {};
  const rec = { ts: new Date().toISOString(), barcode, product, expiry, ocr_raw, hasImage: !!imageData };
  appendJSONL(SCANS_FILE, rec);
  res.json({ ok:true });
});

/* ====== /API END ====== */



// Upload (Task B)
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 12 * 1024 * 1024 } });

//
// === Task B: OCR date extraction + endpoints ===
const MONTHS = {
  JAN:1, FEB:2, MAR:3, APR:4, MAY:5, JUN:6, JUL:7, AUG:8, SEP:9, SEPT:9, OCT:10, NOV:11, DEC:12,
  SIJ:1, VELJ:2, "OŽU":3, OZU:3, TRA:4, SVI:5, LIP:6, SRP:7, KOL:8, RUJ:9, LIS:10, STU:11, PRO:12
};
function lastDay(y, m){ return new Date(y, m, 0).getDate(); }
function pad(n){ return String(n).padStart(2, '0'); }
function y4(y){ y = Number(y); return y < 100 ? (y >= 70 ? 1900 + y : 2000 + y) : y; }

function extractDateFromText(rawText){
  const text = (rawText || '').replace(/[\u00A0]/g, ' ');
  const U = text.toUpperCase();
  const nearKeywords = /(BEST\s*BEFORE|USE\s*BY|EXP(?:\.|IRY)?|EXPIRATION|BBE|MHD|ROK\s*TRAJANJA|UPOTRIJEBITI\s*DO|NAJBOLJE\s*UPOTRIJEBITI\s*DO|DATUM\s*ISTEKA)/i;
  const hasKw = nearKeywords.test(text);
  const lotNear = /(\bLOT\b\s*[:#-]?\s*[A-Z0-9\-]+)/i;

  const candidates = [];
  function push(dateY, dateM, dateD, score, pattern, matched, idx){
    const y = y4(dateY), m = Number(dateM), d = Number(dateD);
    if (!(y>=1990 && y<=2100 && m>=1 && m<=12 && d>=1 && d<=31)) return;
    const iso = y + '-' + pad(m) + '-' + pad(d);
    let s = score;
    if (hasKw) s += 0.25;
    if (idx != null) {
      const before = Math.max(0, idx - 14);
      const after = Math.min(U.length, idx + String(matched).length + 14);
      if (lotNear.test(U.slice(before, after))) s -= 0.3;
    }
    if (String(dateY).length === 2) s -= 0.05;
    candidates.push({ iso, score: s, pattern, matched });
  }

  // DD.MM.YYYY ili D.M.YY
  U.replace(/\b(\d{1,2})[.\-\/](\d{1,2})[.\-\/](\d{2,4})\b/g, (m, d, mo, y, off) => { push(y, mo, d, 0.75, 'DD.MM.YYYY', m, off); return m; });
  // YYYY-MM-DD
  U.replace(/\b(20\d{2})[.\-\/](\d{1,2})[.\-\/](\d{1,2})\b/g, (m, y, mo, d, off) => { push(y, mo, d, 0.9, 'YYYY-MM-DD', m, off); return m; });
  // MM/YYYY i YYYY/MM → EOM
  U.replace(/\b(\d{1,2})\/(20\d{2})\b/g, (m, mo, y, off) => { push(y, mo, lastDay(y, mo), 0.7, 'MM/YYYY → EOM', m, off); return m; });
  U.replace(/\b(20\d{2})\/(\d{1,2})\b/g, (m, y, mo, off) => { push(y, mo, lastDay(y, mo), 0.75, 'YYYY/MM → EOM', m, off); return m; });
  // 12 NOV 2025 / 12 NOV 25 + HR abbr
  U.replace(/\b(\d{1,2})\s*([A-ZŠŽĆĐČ]{3,4})\.?\s*(\d{2,4})\b/g, (m, d, mon, y, off) => {
    mon = mon.replace('Š','S').replace('Ž','Z').replace('Ć','C').replace('Đ','D').replace('Č','C');
    if (MONTHS[mon]) push(y, MONTHS[mon], d, 0.85, 'DD MON YYYY', m, off);
    return m;
  });
  // EXP 12NOV25 / BBE 12NOV2025 / 12NOV25
  U.replace(/\b(?:EXP(?:\.|IRY)?|BBE)?\s*(\d{1,2})([A-Z]{3})(\d{2,4})\b/g, (m, d, mon, y, off) => {
    if (MONTHS[mon]) push(y, MONTHS[mon], d, 0.88, 'DDMONYY', m, off);
    return m;
  });
  // YYYY-MM → EOM
  U.replace(/\b(20\d{2})-(\d{1,2})\b/g, (m, y, mo, off) => { push(y, mo, lastDay(y, mo), 0.72, 'YYYY-MM → EOM', m, off); return m; });

  const bestByIso = new Map();
  for (const c of candidates) {
    const prev = bestByIso.get(c.iso);
    if (!prev || c.score > prev.score) bestByIso.set(c.iso, c);
  }
  const unique = [...bestByIso.values()].sort((a,b)=>b.score-a.score);
  const top = unique[0] || null;

  return { date: top ? top.iso : null, score: top ? top.score : 0, pattern: top ? top.pattern : null, raw: unique.map(x=>x.matched), text };
}

// TEMP stub OCR – zamijeni kasnije svojim OCR-om koji vraća { text }
async function runOCR(buffer) {
  return { text: ['Best before 2025/11', 'EXP 12NOV25', 'LOT A12345'].join('\n') };
}

// /api/ocr-date2 (teži) → 503 ako LIGHT_DEPLOY=1
if (typeof app?.post === 'function') {
  app.post('/api/ocr-date2', upload.single('image'), async (req, res) => {
    if (process.env.LIGHT_DEPLOY === '1') return res.status(503).json({ error: 'LIGHT_DEPLOY' });
    try {
      const { buffer } = req.file;
      const { text } = await runOCR(buffer);
      return res.json(extractDateFromText(text));
    } catch (e) {
      console.error('ocr-date2 error', e); return res.status(500).json({ error: String(e.message || e) });
    }
  });

  // /api/ocr-date (lakši) – fallback
  app.post('/api/ocr-date', upload.single('image'), async (req, res) => {
    try {
      const { buffer } = req.file;
      const { text } = await runOCR(buffer);
      return res.json(extractDateFromText(text));
    } catch (e) {
      console.error('ocr-date error', e); return res.status(500).json({ error: String(e.message || e) });
    }
  });
}
// === end Task B block ===


// Explicit route for scan.html (ensure it's reachable)
try {
  app.get('/scan.html', (req, res) => res.sendFile(path.join(__dirname, 'public', 'scan.html')));
} catch (e) {
  console.error('scan.html route error', e);
}




//// ==== scan logging routes (auto) ====
const LOG_DIR = path.join(process.cwd(),'logs');
const JSONL   = path.join(LOG_DIR,'scans.jsonl');
const CSVFILE = path.join(LOG_DIR,'scans.csv');
function csvEscape(v){ if(v==null) return ''; const s=String(v).replace(/\r?\n/g,' ').slice(0,5000); return (/[\",]/.test(s))? '\"'+s.replace(/\"/g,'\"\"')+'\"' : s; }

app.post('/api/scan-log', express.json({limit:'1mb'}), (req,res)=>{
  try{
    const b=req.body||{}; const now=new Date().toISOString();
    const rec = {
      ts:now, source:b.source||'scan_pwa', barcode:b.barcode||null, product:b.product||null,
      date:b.date||null, score:(typeof b.score==='number'?b.score:Number(b.score||0)),
      pattern:b.pattern||null, lots:Array.isArray(b.lots)?b.lots:(b.lots?[String(b.lots)]:[]),
      raw:Array.isArray(b.raw)?b.raw:(b.raw?[String(b.raw)]:[]), filename:b.filename||null, text:b.text||null
    };
    fs.appendFileSync(JSONL, JSON.stringify(rec)+'\n','utf8');
    const line=[rec.ts,rec.source,rec.barcode,rec.product,rec.date,isNaN(rec.score)?'':rec.score.toFixed(2),rec.pattern||'',(rec.lots||[]).join('|'),(rec.raw||[]).join('|'),rec.filename||'',(rec.text||'').replace(/\r?\n/g,' ').slice(0,5000)]
      .map(csvEscape).join(',');
    if (!fs.existsSync(CSVFILE)) fs.writeFileSync(CSVFILE,'ts,source,barcode,product,date,score,pattern,lots,raw,filename,text','utf8');
    fs.appendFileSync(CSVFILE,'\n'+line,'utf8');
    res.json({ok:true,saved:true});
  }catch(e){ res.status(500).json({ok:false,error:String(e&&e.message||e)}); }
});

app.get('/api/logs/scans.json', (req,res)=>{
  try{
    const limit=Math.max(1,Math.min(1000,Number(req.query.limit||200)));
    if (!fs.existsSync(JSONL)) return res.json([]);
    const data=fs.readFileSync(JSONL,'utf8').split(/\r?\n/).filter(Boolean);
    const tail=data.slice(-limit).map(l=>{try{return JSON.parse(l)}catch(_){return null}}).filter(Boolean);
    res.json(tail);
  }catch(e){ res.status(500).json({ok:false,error:String(e&&e.message||e)}); }
});

app.get('/logs/scans.csv', (req,res)=>{
  try{
    if (!fs.existsSync(CSVFILE)) return res.status(404).send('no csv');
    res.set('Content-Type','text/csv; charset=utf-8'); res.set('Cache-Control','no-cache');
    res.send(fs.readFileSync(CSVFILE,'utf8'));
  }catch(e){ res.status(500).send('error'); }
});
//// ==== end scan logging routes ====


//// === INLINE PAGES HOTFIX (when public/*.html missing) ===
const INLINE_SCAN = <!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>AI Shelf-Life – Scan</title>
<style>body{font-family:system-ui;margin:16px}.row{margin:10px 0}button{padding:10px 14px;border:1px solid #ddd;border-radius:10px;background:#fff;cursor:pointer}
#out{white-space:pre-wrap;border:1px solid #eee;border-radius:8px;padding:10px;margin-top:12px}.muted{color:#6b7280;font-size:12px}
#cam{width:100%;max-width:440px;display:none;border-radius:8px;border:1px solid #eee}input[type="text"],input[type="file"]{padding:10px 12px;border:1px solid #ddd;border-radius:10px}.flex{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
</style>
<h1>AI Shelf-Life – Scan (OCR + Barcode)</h1>
<p class="muted">Inline verzija (bez PWA). Radi i bez public/*.html. Barcode koristi ZXing CDN.</p>
<div class="row flex">
  <input id="file" type="file" accept="image/*,.heic,application/pdf">
  <button id="run">Run OCR</button>
</div>
<div class="row flex">
  <input id="barcode" type="text" placeholder="Barcode (auto)">
  <button id="scan">Scan barcode</button>
  <button id="stop" style="display:none">Stop</button>
</div>
<video id="cam" playsinline muted></video>
<pre id="out">Ready.</pre>
<script>
const \$=id=>document.getElementById(id);
function show(j,src){
  const lots=(j.lots&&j.lots.length)?"\\nLOT: "+j.lots.join(", "):"";
  const pat=j.pattern? " ("+j.pattern+")":"";
  \out.textContent="source "+(src||"?")+
  "\\nscore "+Number(j.score||0).toFixed(2)+pat+
  "\\nDetected date: "+(j.date||"—")+
  "\\nRaw candidates: "+((j.raw&&j.raw.join(", "))||"—")+lots+
  "\\n\\nOCR text\\n"+(j.text||"");
  // autolog
  try{ fetch('/api/scan-log',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
    source: src||'inline', barcode: (\barcode||{}).value||null, date:j.date||null, score:j.score||0,
    pattern:j.pattern||null, lots:j.lots||[], raw:j.raw||[], text:j.text||null
  })}); }catch(_){}
}
\$ ("run").onclick=async()=>{
  const f=\file.files[0]; if(!f){ alert("Odaberi datoteku"); return; }
  \out.textContent="Uploading to /api/ocr-date2…";
  const fd=new FormData(); fd.append("image",f,f.name);
  try{
    const r=await fetch("/api/ocr-date2",{method:"POST",body:fd});
    if(r.status===503||r.status===404){ const r2=await fetch("/api/ocr-date",{method:"POST"}); show(await r2.json(),"fallback"); return; }
    show(await r.json(),"server(/api/ocr-date2)");
  }catch(e){
    try{ const r2=await fetch("/api/ocr-date",{method:"POST"}); show(await r2.json(),"fallback(catch)"); }
    catch(_){ \out.textContent="Ne mogu dohvatiti /api/ocr-date2 ni /api/ocr-date."; }
  }
};
</script>
<script src="https://unpkg.com/@zxing/library@0.21.2/umd/index.min.js"></script>
<script>
let codeReader=null,currentDeviceId=null;
async function startScan(){
  if(!window.ZXing||!ZXing.BrowserMultiFormatReader){ alert("Barcode lib nije učitana."); return; }
  \cam.style.display="block"; \scan.style.display="none"; \stop.style.display="inline-block";
  codeReader=new ZXing.BrowserMultiFormatReader();
  try{
    const devices=await ZXing.BrowserCodeReader.listVideoInputDevices();
    let dev=devices.find(d=>/back|environment/i.test(d.label))||devices[devices.length-1];
    currentDeviceId=dev?.deviceId;
    const hints=new Map(); const formats=[ZXing.BarcodeFormat.EAN_13,ZXing.BarcodeFormat.EAN_8,ZXing.BarcodeFormat.UPC_A,ZXing.BarcodeFormat.UPC_E,ZXing.BarcodeFormat.CODE_128,ZXing.BarcodeFormat.ITF];
    hints.set(ZXing.DecodeHintType.POSSIBLE_FORMATS,formats); hints.set(ZXing.DecodeHintType.TRY_HARDER,true); codeReader.hints=hints;
    await codeReader.decodeFromVideoDevice(currentDeviceId,"cam",(result,err)=>{ if(result&&result.getText){ \barcode.value=result.getText(); stopScan(); } });
  }catch(e){ alert("Kamera nije dostupna: "+(e?.message||e)); stopScan(); }
}
async function stopScan(){ if(codeReader){ try{ await codeReader.reset(); }catch(e){} codeReader=null; } const v=\cam; v.pause?.(); v.srcObject=null; v.style.display="none"; \scan.style.display="inline-block"; \stop.style.display="none"; }
\scan.onclick=startScan; \stop.onclick=stopScan;
</script>;
const INLINE_EGGS = <!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Eggs mode – AI Shelf-Life</title>
<style>:root{--muted:#6b7280}body{font-family:system-ui;margin:16px}.card{background:#f9fafb;padding:14px;border:1px solid #e5e7eb;border-radius:12px}
.grid{display:grid;gap:12px;grid-template-columns:1fr}@media(min-width:680px){.grid{grid-template-columns:1fr 1fr}}label{font-size:12px;color:var(--muted);margin-bottom:6px;display:block}
input,button{width:100%;padding:10px 12px;border:1px solid #e5e7eb;border-radius:10px;background:#fff}.kpi{display:flex;gap:10px;flex-wrap:wrap;margin-top:8px}
.pill{padding:8px 10px;border-radius:999px;border:1px solid #e5e7eb;background:#fff}.ok{border-color:#bbf7d0;color:#16a34a;background:#f0fdf4}.warn{border-color:#fde68a;color:#d97706;background:#fffbeb}.bad{border-color:#fecaca;color:#dc2626;background:#fef2f2}
.small{font-size:12px;color:var(--muted)}.list li{border-bottom:1px solid #eee;padding:6px 0}</style>
<h1>🥚 Eggs mode</h1><p class="small">Bilježi kada su jaja stavljena u frižider i koliko je dana ostalo do roka.</p>
<div class="card"><div class="grid">
  <div><label>Stavljena u frižider</label><input id="fridge" type="datetime-local"></div>
  <div><label>Best before (opcija)</label><input id="bbd" type="date"></div>
  <div><label>Pack / položena (opcija)</label><input id="pack" type="date"></div>
  <div><label>Prozor bez BBD/pack (dana)</label><input id="window" type="number" value="21" min="7" max="60"></div>
  <div><label>Batch/kod (opcija)</label><input id="code" type="text" placeholder="npr. 1HR1234…"></div>
  <div><label>Količina (opcija)</label><input id="qty" type="number" value="10" min="1" step="1"></div>
</div>
<div class="kpi" id="kpi"></div>
<div style="display:flex;gap:8px;margin-top:8px"><button id="save">Spremi batch</button><button id="reset">Reset</button></div>
<p class="small">Napomena: informativno; držati jaja stalno ohlađena.</p></div>
<h3 style="margin-top:16px">Zadnji batch-evi</h3><ul id="list" class="list"></ul>
<script>
const \$=id=>document.getElementById(id), pad=n=>String(n).padStart(2,'0'), toISO=d=>\\-\-\\;
const addDays=(d,x)=>{const t=new Date(d);t.setDate(t.getDate()+x);return t}, diff=(a,b)=>Math.floor((a-b)/(24*3600*1000));
function estimate(){ const now=new Date(); const fridge=new Date(\fridge.value||now.toISOString().slice(0,16));
  const bbd=\bbd.value?new Date(\bbd.value+"T23:59:59"):null; const pack=\pack.value?new Date(\pack.value+"T12:00:00"):null; const win=parseInt(\window.value||'21',10);
  let est,reason; if(bbd){ est=bbd; reason="BBD s kutije"; } else if(pack){ est=addDays(pack,28); reason="pack +28 dana"; } else { est=addDays(fridge,win); reason=\ridge +\ dana\; }
  const left=diff(est,new Date()), cls=left>=7?"ok":(left>=0?"warn":"bad");
  \kpi.innerHTML=\<span class="pill \">Procijenjeni rok: <b>\</b> <span class="small">(\)</span></span><span class="pill \">Preostalo: <b>\</b> d</span>\;
  return {est,left,reason,fridge,pack};
}
function load(){ const arr=JSON.parse(localStorage.getItem('eggs_batches')||'[]'); \list.innerHTML=arr.slice().reverse().map(x=>\<li><b>\ · \</b><div class="small">Fridge: \ · BBD: \ · Est: \ (\ d)</div></li>\).join('')||'<li class="small">Nema zapisa.</li>'; }
function save(){ const {est,left}=estimate(); const rec={code:\code.value||null,qty:parseInt(\qty.value||'0',10)||null,fridge:\fridge.value,bbd:\bbd.value||null,pack:\pack.value||null,windowDays:parseInt(\window.value||'21',10),est:toISO(est),left};
  const arr=JSON.parse(localStorage.getItem('eggs_batches')||'[]'); arr.push(rec); localStorage.setItem('eggs_batches',JSON.stringify(arr)); load();
  fetch('/api/eggs-log',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(rec)}).catch(()=>{});
}
function reset(){ const now=new Date(); \fridge.value=now.toISOString().slice(0,16); \bbd.value=''; \pack.value=''; \code.value=''; \qty.value='10'; \window.value='21'; estimate(); }
\fridge.onchange=\bbd.onchange=\pack.onchange=\window.oninput=estimate; \save.onclick=()=>{save();alert('Spremljeno (lokalno).')}; \reset.onclick=reset;
(function(){ const now=new Date(); \fridge.value=now.toISOString().slice(0,16); estimate(); load(); })();
</script>;
const INLINE_LOGS = <!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Logs – AI Shelf-Life</title>
<style>body{font-family:system-ui;margin:16px}table{border-collapse:collapse;width:100%}th,td{border:1px solid #eee;padding:6px 8px;font-size:14px;vertical-align:top}th{background:#fafafa}.row{margin:10px 0}</style>
<h1>Logs</h1><div class="row"><button id="reload">Reload</button> <a href="/logs/scans.csv" download>⬇️ Download CSV</a></div>
<table id="t"><thead><tr><th>ts</th><th>source</th><th>barcode</th><th>product</th><th>date</th><th>score</th><th>pattern</th><th>lots</th><th>raw</th><th>text</th></tr></thead><tbody></tbody></table>
<script>
async function load(){ try{ const r=await fetch('/api/logs/scans.json?limit=200'); const arr=await r.json(); const tb=document.querySelector('#t tbody');
  tb.innerHTML=(arr||[]).reverse().map(x=>\<tr><td>\</td><td>\</td><td>\</td><td>\</td><td>\</td><td>\</td><td>\</td><td>\</td><td>\</td><td>\</td></tr>\).join(''); }catch(e){ alert('Ne mogu dohvatiti /api/logs/scans.json'); } }
document.getElementById('reload').onclick=load; load();
</script>;
app.get('/scan_pwa.html', (req,res)=>res.status(200).type('html').send(INLINE_SCAN));
app.get('/eggs.html',     (req,res)=>res.status(200).type('html').send(INLINE_EGGS));
app.get('/logs.html',     (req,res)=>res.status(200).type('html').send(INLINE_LOGS));
//// === END INLINE PAGES HOTFIX ===

