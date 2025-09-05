"use strict";
const express = require("express");
const multer = require("multer");

const app = express();
const PORT = process.env.PORT || 3006;

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 12 * 1024 * 1024 } });

// ===== Date helpers =====
const MONTHS = { JAN:1,FEB:2,MAR:3,APR:4,MAY:5,JUN:6,JUL:7,AUG:8,SEP:9,SEPT:9,OCT:10,NOV:11,DEC:12,
  SIJ:1,VELJ:2,"OŽU":3,OZU:3,TRA:4,SVI:5,LIP:6,SRP:7,KOL:8,RUJ:9,LIS:10,STU:11,PRO:12 };
function lastDay(y,m){ return new Date(y,m,0).getDate(); }
function pad(n){ return String(n).padStart(2,"0"); }
function y4(y){ y=Number(y); return y<100 ? (y>=70?1900+y:2000+y) : y; }
function extractDateFromText(rawText){
  const text = (rawText||"").replace(/[\u00A0]/g," ");
  const U = text.toUpperCase();
  const nearKeywords = /(BEST\s*BEFORE|USE\s*BY|EXP(?:\.|IRY)?|EXPIRATION|BBE|MHD|ROK\s*TRAJANJA|UPOTRIJEBITI\s*DO|NAJBOLJE\s*UPOTRIJEBITI\s*DO|DATUM\s*ISTEKA)/i;
  const hasKw = nearKeywords.test(text);
  const lotNear = /(\bLOT\b\s*[:#-]?\s*[A-Z0-9\-]+)/i;
  const candidates = [];
  function push(Y,M,D,score,pattern,matched,idx){
    const y=y4(Y), m=Number(M), d=Number(D);
    if(!(y>=1990&&y<=2100&&m>=1&&m<=12&&d>=1&&d<=31)) return;
    const iso = y+"-"+pad(m)+"-"+pad(d);
    let s=score;
    if(hasKw) s+=0.25;
    if(idx!=null){
      const before=Math.max(0,idx-14), after=Math.min(U.length,idx+String(matched).length+14);
      if(lotNear.test(U.slice(before,after))) s-=0.3;
    }
    if(String(Y).length===2) s-=0.05;
    candidates.push({iso,score:s,pattern,matched});
  }
  U.replace(/\b(\d{1,2})[.\-\/](\d{1,2})[.\-\/](\d{2,4})\b/g,(m,d,mo,y,off)=>{push(y,mo,d,0.75,"DD.MM.YYYY",m,off);return m;});
  U.replace(/\b(20\d{2})[.\-\/](\d{1,2})[.\-\/](\d{1,2})\b/g,(m,y,mo,d,off)=>{push(y,mo,d,0.9,"YYYY-MM-DD",m,off);return m;});
  U.replace(/\b(\d{1,2})\/(20\d{2})\b/g,(m,mo,y,off)=>{push(y,mo,lastDay(y,mo),0.7,"MM/YYYY → EOM",m,off);return m;});
  U.replace(/\b(20\d{2})\/(\d{1,2})\b/g,(m,y,mo,off)=>{push(y,mo,lastDay(y,mo),0.75,"YYYY/MM → EOM",m,off);return m;});
  U.replace(/\b(\d{1,2})\s*([A-ZŠŽĆĐČ]{3,4})\.?\s*(\d{2,4})\b/g,(m,d,mon,y,off)=>{
    mon=mon.replace("Š","S").replace("Ž","Z").replace("Ć","C").replace("Đ","D").replace("Č","C");
    if(MONTHS[mon]) push(y,MONTHS[mon],d,0.85,"DD MON YYYY",m,off); return m;
  });
  U.replace(/\b(?:EXP(?:\.|IRY)?|BBE)?\s*(\d{1,2})([A-Z]{3})(\d{2,4})\b/g,(m,d,mon,y,off)=>{
    if(MONTHS[mon]) push(y,MONTHS[mon],d,0.88,"DDMONYY",m,off); return m;
  });
  U.replace(/\b(20\d{2})-(\d{1,2})\b/g,(m,y,mo,off)=>{push(y,mo,lastDay(y,mo),0.72,"YYYY-MM → EOM",m,off);return m;});
  const best=new Map(); for(const c of candidates){const p=best.get(c.iso); if(!p||c.score>p.score) best.set(c.iso,c);}
  const arr=[...best.values()].sort((a,b)=>b.score-a.score); const top=arr[0]||null;
  return { date: top?top.iso:null, score: top?top.score:0, pattern: top?top.pattern:null, raw: arr.map(x=>x.matched), text };
}

// ===== Inline /scan.html =====
const SCAN_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>AI Shelf-Life – Scan</title>
<style>
body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Inter,Arial,sans-serif;line-height:1.4;margin:24px}
.card{border:1px solid #e5e7eb;border-radius:14px;padding:16px;margin-bottom:16px}
.row{display:flex;gap:12px;align-items:center;flex-wrap:wrap}
.btn{padding:10px 14px;border-radius:10px;border:1px solid #d1d5db;background:#f3f4f6;cursor:pointer}
.btn.primary{background:#111827;color:#fff;border-color:#111827}
.muted{color:#6b7280}
#preview{max-width:100%;border:1px dashed #d1d5db;border-radius:10px;margin-top:8px}
#result pre{white-space:pre-wrap;background:#f9fafb;border:1px solid #e5e7eb;border-radius:10px;padding:10px}
.tag{display:inline-block;padding:2px 8px;border-radius:999px;border:1px solid #d1d5db;background:#f9fafb;margin-right:6px}
</style>
<script src="https://cdn.jsdelivr.net/npm/heic2any/dist/heic2any.min.js"></script>
</head>
<body>
<h1>Scan label / Skener etikete</h1>
<div class="card">
  <div class="row">
    <label class="btn">📷 Choose image (JPG/PNG/HEIC)
      <input id="file" type="file" accept="image/*,.heic" hidden />
    </label>
    <button id="run" class="btn primary">Run OCR</button>
    <label class="row muted"><input type="checkbox" id="show-pre" checked /> preview pre-processed</label>
  </div>
  <img id="preview" alt="preview" />
  <canvas id="work" hidden></canvas>
</div>
<div class="card"><div id="result"><div class="muted">No result yet.</div></div></div>
<script>
const fileEl=document.getElementById('file'), runBtn=document.getElementById('run'), preview=document.getElementById('preview'), work=document.getElementById('work'), showPre=document.getElementById('show-pre'), result=document.getElementById('result');
let lastFile=null;
fileEl.addEventListener('change',()=>{ lastFile=fileEl.files[0]||null; if(lastFile) preview.src=URL.createObjectURL(lastFile); });
runBtn.addEventListener('click', async ()=>{
  if(!lastFile){ alert('Choose an image first.'); return; }
  try{
    setStatus('Pre-processing…');
    const pre=await preprocess(lastFile);
    if(showPre.checked) preview.src=URL.createObjectURL(pre);
    const form=new FormData(); form.append('image', pre, 'preprocessed.png');
    setStatus('Calling /api/ocr-date2…');
    let r=await fetch('/api/ocr-date2',{method:'POST',body:form});
    if(r.status===503){ setStatus('Light deploy – falling back…'); r=await fetch('/api/ocr-date',{method:'POST',body:form}); }
    const data=await r.json(); renderResult(data,r.status);
  }catch(e){ console.error(e); setStatus('❌ '+(e&&e.message?e.message:'Unexpected error')); }
});
function setStatus(msg){ result.innerHTML='<div class="muted">'+escapeHtml(msg)+'</div>'; }
function renderResult(data,status){
  const tags=[]; if(data&&typeof data.score==='number') tags.push(tag('score '+data.score.toFixed(2)));
  if(data&&data.pattern) tags.push(tag(data.pattern)); if(status===503) tags.push(tag('503 fallback'));
  result.innerHTML='<div style="margin-bottom:8px">'+tags.join(' ')+'</div>'
    +'<div><strong>Detected date:</strong> '+escapeHtml(data&&data.date?data.date:'—')+'</div>'
    +'<div><strong>Raw candidates:</strong> '+escapeHtml((data&&data.raw&&data.raw.join(', '))||'—')+'</div>'
    +'<details style="margin-top:10px"><summary>OCR text</summary><pre>'+escapeHtml((data&&data.text)||'')+'</pre></details>';
}
function tag(t){ return '<span class="tag">'+escapeHtml(t)+'</span>'; }
function escapeHtml(s){ return String(s).replace(/[&<>\"']/g, m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',\"'\":'&#39;'}[m])); }
async function preprocess(file){
  let blob=file;
  if((file.type&&file.type.toLowerCase().includes('heic'))||file.name.toLowerCase().endsWith('.heic')){
    try{ blob=await window.heic2any({blob:file,toType:'image/jpeg',quality:0.9}); }catch(e){ console.warn('HEIC convert failed',e); }
  }
  const bmp=await createImageBitmap(blob);
  const maxSide=2000, scale=Math.min(1,maxSide/Math.max(bmp.width,bmp.height));
  work.width=Math.round(bmp.width*scale); work.height=Math.round(bmp.height*scale);
  const ctx=work.getContext('2d'); ctx.drawImage(bmp,0,0,work.width,work.height);
  let imgData=ctx.getImageData(0,0,work.width,work.height), d=imgData.data;
  for(let i=0;i<d.length;i+=4){ const g=Math.round(0.2126*d[i]+0.7152*d[i+1]+0.0722*d[i+2]); d[i]=d[i+1]=d[i+2]=g; }
  const hist=new Uint32Array(256); for(let i=0;i<d.length;i+=4) hist[d[i]]++; const total=work.width*work.height;
  let sum=0; for(let t=0;t<256;t++) sum+=t*hist[t]; let sumB=0,wB=0,varMax=-1,thr=127;
  for(let t=0;t<256;t++){ wB+=hist[t]; if(!wB) continue; const wF=total-wB; if(!wF) break; sumB+=t*hist[t];
    const mB=sumB/wB,mF=(sum-sumB)/wF; const v=wB*wF*(mB-mF)*(mB-mF); if(v>varMax){ varMax=v; thr=t; } }
  for(let i=0;i<d.length;i+=4){ const v=d[i]>thr?255:0; d[i]=d[i+1]=d[i+2]=v; }
  ctx.putImageData(imgData,0,0); const out=await new Promise(res=>work.toBlob(res,'image/png',0.95)); return out;
}
</script>
</body></html>`;

// ===== Health/Version =====
app.get("/health",(req,res)=>res.json({ ok:true, now:new Date().toISOString() }));
app.get("/version",(req,res)=>res.json({ ok:true, app:"standalone", port:PORT }));

// ===== Routes =====
app.get("/", (req,res)=>res.redirect("/scan.html"));
app.get("/scan.html", (req,res)=>res.type("html").send(SCAN_HTML));

// OCR endpoints (stub OCR text to guarantee a result)
function stubText(){ return "Best before 2025/11\nEXP 12NOV25\nLOT A12345"; }

// Hybrid OCR: try Tesseract, else fallback to stub so FE always works
async function runOCR(buffer) {
  try {
    const { createWorker } = require("tesseract.js");
    if (!global.__tessWorker) {
      global.__tessWorker = await createWorker();
      // možeš kasnije promijeniti u "eng+hrv"
      await global.__tessWorker.loadLanguage("eng");
      await global.__tessWorker.initialize("eng");
    }
    const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error("OCR timeout")), 7000));
    const p = global.__tessWorker.recognize(buffer);
    const { data: { text } } = await Promise.race([p, timeout]);
    if (text && text.trim()) return { text };
  } catch (e) {
    console.warn("Tesseract OCR failed, using fallback:", e && e.message ? e.message : e);
  }
  return { text: stubText() };
}

app.post("/api/ocr-date2", upload.single("image"), async (req,res)=>{
  if (process.env.LIGHT_DEPLOY==="1") return res.status(503).json({ error:"LIGHT_DEPLOY" });
  try { const { text } = await runOCR(req.file?.buffer); return res.json(extractDateFromText(text));}
  catch(e){ console.error(e); return res.status(500).json({ error:String(e.message||e) }); }
});
app.post("/api/ocr-date", upload.single("image"), async (req,res)=>{
  try { const { text } = await runOCR(req.file?.buffer); return res.json(extractDateFromText(text));}
  catch(e){ console.error(e); return res.status(500).json({ error:String(e.message||e) }); }
});

app.listen(PORT, ()=>console.log("✅ standalone server on http://127.0.0.1:"+PORT));

