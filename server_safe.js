/**
 * server_safe.js — Premium status + static + polish + ADMIN grant/log + debug
 * DEV SECRET default: mrcina_one_secret_abc
 * ADMIN_KEY default (DEV): admin123!   <-- radi i bez env varijable
 */
const express = require("express");
const path = require("path");
const fs = require("fs");
const jwt = require("jsonwebtoken");

const SECRET    = process.env.SECRET    || "mrcina_one_secret_abc";
const ADMIN_KEY = process.env.ADMIN_KEY || "admin123!";
const PORT = process.env.PORT || 3035;

// ----- tiny file store -----
const STORE = path.join(__dirname, "data", "activations.json");
function ensureStore() {
  const dir = path.dirname(STORE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(STORE)) fs.writeFileSync(STORE, "{}", "utf8");
}
function readStore() { ensureStore(); try { return JSON.parse(fs.readFileSync(STORE, "utf8")); } catch { return {}; } }
function writeStore(obj) { ensureStore(); fs.writeFileSync(STORE, JSON.stringify(obj, null, 2)); }
function daysInMonth(y,m){ return new Date(y, m+1, 0).getDate(); }
function addCalendarMonths(d, n=1){
  const dt = new Date(d); const orig = dt.getDate();
  let y = dt.getFullYear(); let m = dt.getMonth() + n;
  y += Math.floor(m / 12); m = ((m % 12) + 12) % 12;
  const day = Math.min(orig, daysInMonth(y,m));
  return new Date(y, m, day, dt.getHours(), dt.getMinutes(), dt.getSeconds(), dt.getMilliseconds());
}
function fmtDate(d, locale){ return new Intl.DateTimeFormat(locale, {year:"numeric", month:"2-digit", day:"2-digit", hour:"2-digit", minute:"2-digit"}).format(d); }
function humanLeft(ms, locale){
  if (ms <= 0) return locale.startsWith("hr") ? "isteklo" : "expired";
  const sec = Math.floor(ms/1000); const d=Math.floor(sec/86400); const h=Math.floor((sec%86400)/3600); const m=Math.floor((sec%3600)/60);
  if (d>0) return `${d}d ${h.toString().padStart(2,"0")}:${m.toString().padStart(2,"0")}`;
  if (h>0) return `${h}h ${m}m`;
  return `${m}m`;
}
function makeProgress(openMs, expMs){
  const total = expMs - openMs; const now = Date.now();
  const done = Math.max(0, Math.min(total, now - openMs));
  const pct = total>0 ? done/total : 1;
  let color = "#3fb950"; if (pct<=0.33) color="#db6d28"; else if (pct<=0.66) color="#d29922";
  return { pct, color };
}
function upsertActivation(key, openedAtDate){
  const store = readStore();
  if (!store[key]) {
    const exp = addCalendarMonths(openedAtDate, 1);
    store[key] = { openedAtIso: openedAtDate.toISOString(), expiresAtIso: exp.toISOString() };
    writeStore(store);
  }
  return store[key];
}
function verifyToken(tok){ try { return jwt.verify(tok, SECRET, { algorithms: ["HS256"] }); } catch { return null; } }

// ----- app -----
const app = express();
app.disable("x-powered-by");
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// static
app.use("/public", express.static(path.join(__dirname, "public")));
app.use("/admin",  express.static(path.join(__dirname, "admin")));

// debug routes
app.get("/debug/env", (req,res)=>{
  res.json({
    secret_set: !!SECRET,
    admin_key_len: ADMIN_KEY ? ADMIN_KEY.length : 0,
    admin_key_preview: ADMIN_KEY ? ADMIN_KEY.slice(0,2) + "***" : null
  });
});
app.get("/admin/whoami", (req,res)=>{
  const h = req.headers.authorization||"";
  if (!h.startsWith("Basic ")) return res.status(401).send("no auth");
  const [u,p] = Buffer.from(h.slice(6), "base64").toString("utf8").split(":");
  if (u==="admin" && p===ADMIN_KEY) return res.send("ok");
  return res.status(401).send("bad creds");
});

// simple page helpers
function badge(html, color="#3fb950"){ return `<span style="display:inline-block;padding:2px 8px;border-radius:999px;background:${color};color:#fff;font-weight:600">${html}</span>`; }
function page({ locale, now, openedAt, expiresAt, title }){
  const { pct, color } = makeProgress(openedAt.getTime(), expiresAt.getTime());
  const left = humanLeft(expiresAt - now, locale);
  const nowLine = locale.startsWith("hr") ? "Sada" : "Now";
  const validLine = locale.startsWith("hr") ? "Premium vrijedi do" : "Premium valid until";
  const remainWord = locale.startsWith("hr") ? "Preostalo" : "Remaining";
  const pctStr = Math.round(pct*100);
  return `<!doctype html><html lang="${locale}"><head><meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>${title}</title>
  <style>body{font:16px system-ui;padding:24px;max-width:720px;margin:auto}.progress{background:#eee;border-radius:999px;overflow:hidden;height:12px;margin-top:6px}.bar{height:100%;width:${pctStr}%;background:${color};transition:width .4s ease}.row{display:flex;gap:8px;align-items:center}</style></head>
  <body>
    <h2>${title} ${badge("PREMIUM")}</h2>
    <p><b>${nowLine}:</b> ${fmtDate(now, locale)}<br/>
       <b>${validLine}:</b> ${fmtDate(expiresAt, locale)}<br/>
       <b>${remainWord}:</b> ${left}</p>
    <div class="progress" aria-label="progress ${pctStr}%"><div class="bar"></div></div>
    <p style="margin-top:16px"><a href="/public/polish.html">HEIC/PDF polish</a> · <a href="/admin/manual.html">Admin</a></p>
  </body></html>`;
}
function handlePremium(locale){
  return (req,res)=>{
    const token = (req.query.token||"").toString();
    if (!token) return res.status(401).type("html").send("🔒 Missing ?token");
    const ok = verifyToken(token);
    if (!ok)   return res.status(401).type("html").send("🔒 Token invalid or expired");
    const rec = upsertActivation(token, new Date()); // starts on first open
    const openedAt = new Date(rec.openedAtIso);
    const expiresAt = new Date(rec.expiresAtIso);
    res.setHeader("Content-Security-Policy", "default-src 'self' 'unsafe-inline' https://unpkg.com https://cdnjs.cloudflare.com");
    res.send(page({ locale, now: new Date(), openedAt, expiresAt, title: locale==="hr-HR" ? "Premium – status" : "Premium – status" }));
  };
}
app.get("/premium_status",    handlePremium("hr-HR"));
app.get("/premium_status_en", handlePremium("en-GB"));

// --- Admin auth + grant endpoint ---
function requireAdmin(req,res,next){
  const h = req.headers.authorization||"";
  let ok = false;
  if (h.startsWith("Basic ")) {
    const [u,p] = Buffer.from(h.slice(6), "base64").toString("utf8").split(":");
    ok = (u==="admin" && p===ADMIN_KEY);
  }
  if (!ok) return res.set("WWW-Authenticate",'Basic realm="admin"').status(401).send("Auth required");
  next();
}
app.post("/admin/premium/grant", requireAdmin, (req,res)=>{
  try{
    const { token, months=1, reason="" } = req.body||{};
    if (!token) return res.status(400).send("token required");
    const store = readStore();
    const prev = store[token];
    const base = prev ? new Date(prev.expiresAtIso) : new Date();
    const nextExp = addCalendarMonths(base, parseInt(months,10));
    store[token] = { openedAtIso: prev?prev.openedAtIso:new Date().toISOString(), expiresAtIso: nextExp.toISOString(), manual:true };
    writeStore(store);
    const logDir = path.join(__dirname,"logs"); if (!fs.existsSync(logDir)) fs.mkdirSync(logDir,{recursive:true});
    const line = [new Date().toISOString(), req.ip, `months=${months}`, `reason=${String(reason).replace(/\s+/g,' ').slice(0,200)}`].join("\t")+"\n";
    fs.appendFileSync(path.join(logDir,"premium_manual.log"), line);
    res.type("text/plain").send("OK — expires " + nextExp.toISOString());
  } catch(e){
    console.error(e); res.status(500).send("error");
  }
});

app.get("/", (req,res)=> res.type("html").send(`<p>OK — <a href="/premium_status">/premium_status</a> | <a href="/premium_status_en">/premium_status_en</a> | <a href="/public/polish.html">polish</a> | <a href="/admin/manual.html">admin</a> | <a href="/debug/env">debug</a></p>`));

console.log("Boot:", { SECRET_set: !!SECRET, ADMIN_KEY_len: ADMIN_KEY.length });
app.listen(PORT, ()=> console.log(`✅ Server on http://127.0.0.1:${PORT}`));
