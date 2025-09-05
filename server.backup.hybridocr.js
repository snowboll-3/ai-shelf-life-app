"use strict";
const express = require("express");
const path = require("path");
const multer = require("multer");

const app = express();
const PORT = process.env.PORT || 3000;

// --- Static hosting for public/ and explicit /scan.html route ---
app.use(express.static(path.join(__dirname, "public")));
app.get("/scan.html", (req, res) => res.sendFile(path.join(__dirname, "public", "scan.html")));

// --- Health & Version ---
app.get("/health", (req, res) => res.json({ ok: true, now: new Date().toISOString() }));
app.get("/version", (req, res) => res.json({
  ok: true,
  app: { name: "ai-shelf-life-app", version: "1.0.0" },
  runtime: { node: process.version, express: require("express/package.json").version }
}));

// --- Upload middleware (multer 2.x) ---
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 12 * 1024 * 1024 } });

// --- Date extraction helpers (stable, bez template string bugova) ---
const MONTHS = {
  JAN:1, FEB:2, MAR:3, APR:4, MAY:5, JUN:6, JUL:7, AUG:8, SEP:9, SEPT:9, OCT:10, NOV:11, DEC:12,
  SIJ:1, VELJ:2, "OŽU":3, OZU:3, TRA:4, SVI:5, LIP:6, SRP:7, KOL:8, RUJ:9, LIS:10, STU:11, PRO:12
};
function lastDay(y, m){ return new Date(y, m, 0).getDate(); }
function pad(n){ return String(n).padStart(2, "0"); }
function y4(y){ y = Number(y); return y < 100 ? (y >= 70 ? 1900 + y : 2000 + y) : y; }

function extractDateFromText(rawText){
  const text = (rawText || "").replace(/[\u00A0]/g, " ");
  const U = text.toUpperCase();

  const nearKeywords = /(BEST\s*BEFORE|USE\s*BY|EXP(?:\.|IRY)?|EXPIRATION|BBE|MHD|ROK\s*TRAJANJA|UPOTRIJEBITI\s*DO|NAJBOLJE\s*UPOTRIJEBITI\s*DO|DATUM\s*ISTEKA)/i;
  const hasKw = nearKeywords.test(text);
  const lotNear = /(\bLOT\b\s*[:#-]?\s*[A-Z0-9\-]+)/i;

  const candidates = [];
  function push(dateY, dateM, dateD, score, pattern, matched, idx){
    const y = y4(dateY), m = Number(dateM), d = Number(dateD);
    if (!(y>=1990 && y<=2100 && m>=1 && m<=12 && d>=1 && d<=31)) return;
    const iso = y + "-" + pad(m) + "-" + pad(d);
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
  U.replace(/\b(\d{1,2})[.\-\/](\d{1,2})[.\-\/](\d{2,4})\b/g, (m, d, mo, y, off) => { push(y, mo, d, 0.75, "DD.MM.YYYY", m, off); return m; });
  // YYYY-MM-DD
  U.replace(/\b(20\d{2})[.\-\/](\d{1,2})[.\-\/](\d{1,2})\b/g, (m, y, mo, d, off) => { push(y, mo, d, 0.9, "YYYY-MM-DD", m, off); return m; });
  // MM/YYYY i YYYY/MM → EOM
  U.replace(/\b(\d{1,2})\/(20\d{2})\b/g, (m, mo, y, off) => { push(y, mo, lastDay(y, mo), 0.7, "MM/YYYY → EOM", m, off); return m; });
  U.replace(/\b(20\d{2})\/(\d{1,2})\b/g, (m, y, mo, off) => { push(y, mo, lastDay(y, mo), 0.75, "YYYY/MM → EOM", m, off); return m; });
  // 12 NOV 2025 / 12 NOV 25 + HR abbr
  U.replace(/\b(\d{1,2})\s*([A-ZŠŽĆĐČ]{3,4})\.?\s*(\d{2,4})\b/g, (m, d, mon, y, off) => {
    mon = mon.replace("Š","S").replace("Ž","Z").replace("Ć","C").replace("Đ","D").replace("Č","C");
    if (MONTHS[mon]) push(y, MONTHS[mon], d, 0.85, "DD MON YYYY", m, off);
    return m;
  });
  // EXP 12NOV25 / BBE 12NOV2025 / 12NOV25
  U.replace(/\b(?:EXP(?:\.|IRY)?|BBE)?\s*(\d{1,2})([A-Z]{3})(\d{2,4})\b/g, (m, d, mon, y, off) => {
    if (MONTHS[mon]) push(y, MONTHS[mon], d, 0.88, "DDMONYY", m, off);
    return m;
  });
  // YYYY-MM → EOM
  U.replace(/\b(20\d{2})-(\d{1,2})\b/g, (m, y, mo, off) => { push(y, mo, lastDay(y, mo), 0.72, "YYYY-MM → EOM", m, off); return m; });

  const bestByIso = new Map();
  for (const c of candidates) {
    const prev = bestByIso.get(c.iso);
    if (!prev || c.score > prev.score) bestByIso.set(c.iso, c);
  }
  const unique = [...bestByIso.values()].sort((a,b)=>b.score-a.score);
  const top = unique[0] || null;

  return { date: top ? top.iso : null, score: top ? top.score : 0, pattern: top ? top.pattern : null, raw: unique.map(x=>x.matched), text };
}

// --- TEMP OCR stub (vrati tekst s datumima da sve radi end-to-end) ---
async function runOCR(buffer) {
  // Lazy-init Tesseract worker (prvi poziv je sporiji jer skida model)
  if (!global.__tessWorker) {
    const { createWorker } = require("tesseract.js");
    global.__tessWorker = await createWorker();
    await global.__tessWorker.loadLanguage("eng");   // može i "eng+hrv" kasnije
    await global.__tessWorker.initialize("eng");
  }
  const { data: { text } } = await global.__tessWorker.recognize(buffer);
  return { text };
};
}

// --- API: teži + fallback ---
app.post("/api/ocr-date2", upload.single("image"), async (req, res) => {
  if (process.env.LIGHT_DEPLOY === "1") return res.status(503).json({ error: "LIGHT_DEPLOY" });
  try {
    if (!req.file || !req.file.buffer) return res.status(400).json({ error: "image missing" });
    const { text } = await runOCR(req.file.buffer);
    return res.json(extractDateFromText(text));
  } catch (e) {
    console.error("ocr-date2 error", e); return res.status(500).json({ error: String(e.message || e) });
  }
});
app.post("/api/ocr-date", upload.single("image"), async (req, res) => {
  try {
    if (!req.file || !req.file.buffer) return res.status(400).json({ error: "image missing" });
    const { text } = await runOCR(req.file.buffer);
    return res.json(extractDateFromText(text));
  } catch (e) {
    console.error("ocr-date error", e); return res.status(500).json({ error: String(e.message || e) });
  }
});

// --- Index ---
app.get("/", (req, res) => res.type("html").send('<a href="/scan.html">Open Scan</a>'));

// --- Listen ---
app.listen(PORT, () => console.log(`✅ Server running on http://localhost:${PORT}`));

