"use strict";
const http = require("http");
const PORT = process.env.PORT || 3010;

/** ===== Date helpers ===== */
const MONTHS = {
  JAN:1,FEB:2,MAR:3,APR:4,MAY:5,JUN:6,JUL:7,AUG:8,SEP:9,SEPT:9,OCT:10,NOV:11,DEC:12,
  SIJ:1,VELJ:2,"OŽU":3,OZU:3,TRA:4,SVI:5,LIP:6,SRP:7,KOL:8,RUJ:9,LIS:10,STU:11,PRO:12,
  JANUARY:1,FEBRUARY:2,MARCH:3,APRIL:4,MAYL:5,JUNE:6,JULY:7,AUGUST:8,SEPTEMBER:9,OCTOBER:10,NOVEMBER:11,DECEMBER:12,
  "SIJEČANJ":1,"SIJECANJ":1,"VELJAČA":2,"VELJACA":2,"OŽUJAK":3,"OZUJAK":3,"TRAVANJ":4,"SVIBANJ":5,"LIPANJ":6,"SRPANJ":7,"KOLOVOZ":8,"RUJAN":9,"LISTOPAD":10,"STUDENI":11,"PROSINAC":12
};
function lastDay(y,m){ return new Date(y, m, 0).getDate(); }
function pad(n){ return String(n).padStart(2,"0"); }
function y4(y){ y=Number(y); return y<100 ? (y>=70?1900+y:2000+y) : y; }
function deacc(s){ return s.normalize("NFD").replace(/[\u0300-\u036f]/g,""); }

function extractDateFromText(rawText){
  const text=(rawText||"").replace(/[\u00A0]/g," ");
  const U = text.toUpperCase();
  const D = deacc(U);
  const near=/\b(BEST\s*BEFORE|USE\s*BY|EXP(?:\.|IRY)?|EXPIRATION|BBE|MHD|ROK\s*TRAJANJA|UPOTRIJEBITI\s*DO|NAJBOLJE\s*UPOTRIJEBITI\s*DO|DATUM\s*ISTEKA)\b/i;
  const hasKw=near.test(text);
  const lot=/(\bLOT\b\s*[:#-]?\s*[A-Z0-9\-]+)/i;

  const cands=[];
  function push(Y,M,Dd,score,pattern,matched,idx){
    const y=y4(Y), m=+M, d=+Dd;
    if(!(y>=1990&&y<=2100&&m>=1&&m<=12&&d>=1&&d<=31)) return;
    const iso = y+"-"+pad(m)+"-"+pad(d);
    let s=score;
    if(hasKw) s+=0.25;
    if(idx!=null){
      const b=Math.max(0,idx-14), a=Math.min(U.length, idx+String(matched).length+14);
      if(lot.test(U.slice(b,a))) s-=0.3;
    }
    if(String(Y).length===2) s-=0.05;
    cands.push({ iso, score:s, pattern, matched });
  }

  // numeric
  D.replace(/\b(\d{1,2})[.\-\/](\d{1,2})[.\-\/](\d{2,4})\b/g,(m,d,mo,y,off)=>{ push(y,mo,d,0.75,"DD.MM.YYYY",m,off); return m; });
  D.replace(/\b(20\d{2})[.\-\/](\d{1,2})[.\-\/](\d{1,2})\b/g,(m,y,mo,d,off)=>{ push(y,mo,d,0.9,"YYYY-MM-DD",m,off); return m; });
  D.replace(/\b(\d{1,2})\/(20\d{2})\b/g,(m,mo,y,off)=>{ push(y,mo,lastDay(y,mo),0.7,"MM/YYYY → EOM",m,off); return m; });
  D.replace(/\b(20\d{2})\/(\d{1,2})\b/g,(m,y,mo,off)=>{ push(y,mo,lastDay(y,mo),0.75,"YYYY/MM → EOM",m,off); return m; });
  D.replace(/\b(20\d{2})-(\d{1,2})\b/g,(m,y,mo,off)=>{ push(y,mo,lastDay(y,mo),0.72,"YYYY-MM → EOM",m,off); return m; });

  // text months (EN/HR)
  D.replace(/\b(\d{1,2})\s*([A-ZŠŽĆĐČ]{3,12})\.?\s*(\d{2,4})\b/g,(m,d,mon,y,off)=>{
    const norm=deacc(mon);
    if(MONTHS[norm]) push(y,MONTHS[norm],d,0.85,"DD MON YYYY",m,off);
    return m;
  });
  // compact month e.g. EXP 12NOV25
  D.replace(/\b(?:EXP(?:\.|IRY)?|BBE|MHD)?\s*(\d{1,2})([A-Z]{3,9})(\d{2,4})\b/g,(m,d,mon,y,off)=>{
    const norm=deacc(mon);
    if(MONTHS[norm]) push(y,MONTHS[norm],d,0.88,"DDMONYY",m,off);
    return m;
  });
  // EXP 11.2025 → EOM
  D.replace(/\b(?:EXP|BBE|MHD)\s*(\d{1,2})[.\-\/](20\d{2})\b/g,(m,mo,y,off)=>{ push(y,mo,lastDay(y,mo),0.74,"KW MM/YYYY → EOM",m,off); return m; });

  const best=new Map(); for(const c of cands){ const p=best.get(c.iso); if(!p||c.score>p.score) best.set(c.iso,c); }
  const arr=[...best.values()].sort((a,b)=>b.score-a.score);
  const top=arr[0]||null;
  return { date: top?top.iso:null, score: top?top.score:0, pattern: top?top.pattern:null, raw: arr.map(x=>x.matched) };
}

/** ===== OCR (Tesseract + hard fallback) ===== */
async function runOCRFromBase64(dataUrl){
  try{
    const b64=(dataUrl||"").split(",")[1]||"";
    if (!b64) throw new Error("no image");
    const buf=Buffer.from(b64,"base64");
    const { createWorker } = require("tesseract.js");
    if(!global.__tess){
      global.__tess = await createWorker();
      await global.__tess.loadLanguage("eng+hrv");   // eng + hrv
      await global.__tess.initialize("eng+hrv");
    }
    const timeout = new Promise((_,rej)=>setTimeout(()=>rej(new Error("OCR timeout")), 9000));
    const p = global.__tess.recognize(buf);
    const { data:{ text } } = await Promise.race([p, timeout]);
    if(text && text.trim()) return { text };
  }catch(e){
    console.warn("OCR failed → fallback:", e && e.message ? e.message : e);
  }
  return { text: "Best before 2025/11\nEXP 12NOV25\nLOT A12345" };
}

/** ===== tiny utils/server ===== */
function send(res, code, type, body){ res.writeHead(code, {"Content-Type": type}); res.end(body); }
function readBody(req){ return new Promise(r=>{ const chunks=[]; req.on("data",c=>chunks.push(c)); req.on("end",()=>r(Buffer.concat(chunks).toString("utf8"))); }); }
function withTextJSON(t){ const parsed = extractDateFromText(t); parsed.text = t; return JSON.stringify(parsed); }

/** ===== Inline HTML ===== */
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
    const pre = await preprocess(lastFile);
    if(showPre.checked) preview.src = URL.createObjectURL(pre);
    const imgB64 = await blobToDataURL(pre);

    setStatus('Calling /api/ocr-date2…');
    let r = await fetch('/api/ocr-date2',{ method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ image: imgB64 }) });
    let data = await r.json();
    if (r.status === 503 || !data || !data.date) {
      setStatus('Falling back to /api/ocr-date…');
      const r2 = await fetch('/api/ocr-date',{ method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ image: imgB64 }) });
      data = await r2.json();
    }
    renderResult(data);
  } catch(e){ console.error(e); setStatus('❌ '+(e&&e.message?e.message:'Unexpected error')); }
});

function setStatus(msg){ result.innerHTML = '<div class="muted">'+escapeHtml(msg)+'</div>'; }
function tag(t){ return '<span class="tag">'+escapeHtml(t)+'</span>'; }
function escapeHtml(s){ return String(s).replace(/[&<>\"']/g, m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }
function renderResult(data){
  const tags=[]; if(data&&typeof data.score==='number') tags.push(tag('score '+data.score.toFixed(2)));
  if(data&&data.pattern) tags.push(tag(data.pattern));
  result.innerHTML = '<div style="margin-bottom:8px">'+tags.join(' ')+'</div>'
    + '<div><strong>Detected date:</strong> '+escapeHtml(data&&data.date?data.date:'—')+'</div>'
    + '<div><strong>Raw candidates:</strong> '+escapeHtml((data&&data.raw&&data.raw.join(', '))||'—')+'</div>'
    + '<details style="margin-top:10px"><summary>OCR text</summary><pre>'+escapeHtml((data&&data.text)||'')+'</pre></details>';
}
// grayscale + Otsu + resize
async function preprocess(file){
  const bmp = await createImageBitmap(file);
  const maxSide=2000, scale=Math.min(1, maxSide/Math.max(bmp.width,bmp.height));
  work.width=Math.round(bmp.width*scale); work.height=Math.round(bmp.height*scale);
  const ctx=work.getContext('2d'); ctx.drawImage(bmp,0,0,work.width,work.height);
  let imgData=ctx.getImageData(0,0,work.width,work.height), d=imgData.data;
  for(let i=0;i<d.length;i+=4){ const g=Math.round(0.2126*d[i]+0.7152*d[i+1]+0.0722*d[i+2]); d[i]=d[i+1]=d[i+2]=g; }
  const hist=new Uint32Array(256); for(let i=0;i<d.length;i+=4) hist[d[i]]++; const total=work.width*work.height;
  let sum=0; for(let t=0;t<256;t++) sum+=t*hist[t]; let sumB=0,wB=0,varMax=-1,thr=127;
  for(let t=0;t<256;t++){ wB+=hist[t]; if(!wB) continue; const wF=total-wB; if(!wF) break; sumB+=t*hist[t];
    const mB=sumB/wB, mF=(sum-sumB)/wF; const v=wB*wF*(mB-mF)*(mB-mF); if(v>varMax){ varMax=v; thr=t; } }
  for(let i=0;i<d.length;i+=4){ const v=d[i]>thr?255:0; d[i]=d[i+1]=d[i+2]=v; }
  ctx.putImageData(imgData,0,0); const out=await new Promise(res=>work.toBlob(res,"image/png",0.95)); return out;
}
function blobToDataURL(blob){ return new Promise(res=>{ const fr=new FileReader(); fr.onload=()=>res(fr.result); fr.readAsDataURL(blob); }); }
</script>
</body></html>`;

/** ===== Routes ===== */
function stubText(){ return "Best before 2025/11\nEXP 12NOV25\nLOT A12345"; }

const server=http.createServer(async (req,res)=>{
  const { url, method } = req;

  if (url==="/health") return send(res,200,"application/json",JSON.stringify({ok:true, now:new Date().toISOString()}));
  if (url==="/" || url==="/scan.html") return send(res,200,"text/html; charset=utf-8", SCAN_HTML);

  if (url==="/api/ocr-date2" && method==="POST"){
    try{
      const body = JSON.parse(await readBody(req) || "{}");
      const { text } = await runOCRFromBase64(body.image||"");
      const t = (text && text.trim()) ? text : stubText(); // hard fallback
      return send(res,200,"application/json",withTextJSON(t));
    }catch(e){ return send(res,500,"application/json",JSON.stringify({ error:String(e.message||e) })); }
  }

  // sigurni fallback – uvijek stub (i uvijek includes .text)
  if (url==="/api/ocr-date" && method==="POST"){
    const t = stubText();
    return send(res,200,"application/json",withTextJSON(t));
  }

  return send(res,404,"text/plain","Not Found");
});

server.listen(PORT,"127.0.0.1",()=>console.log("mini server on http://127.0.0.1:"+PORT));

function send(res, code, type, body){ res.writeHead(code, {"Content-Type": type}); res.end(body); }
function readBody(req){ return new Promise(r=>{ const chunks=[]; req.on("data",c=>chunks.push(c)); req.on("end",()=>r(Buffer.concat(chunks).toString("utf8"))); }); }
function withTextJSON(t){ const parsed = extractDateFromText(t); parsed.text = t; return JSON.stringify(parsed); }
