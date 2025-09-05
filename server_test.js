"use strict";
const http = require("http");
const PORT = 3031;

/* ===== utils ===== */
function send(res,c,t,b){ res.writeHead(c,{"Content-Type":t}); res.end(b); }
function readBody(req){ return new Promise(r=>{ const a=[]; req.on("data",c=>a.push(c)); req.on("end",()=>r(Buffer.concat(a).toString("utf8"))); }); }
function lastDay(y,m){ return new Date(y,m,0).getDate(); }
function pad(n){ return String(n).padStart(2,"0"); }
function y4(y){ y=Number(y); return y<100 ? (y>=70?1900+y:2000+y) : y; }
function deacc(s){ return s.normalize("NFD").replace(/[\u0300-\u036f]/g,""); }
const MONTHS = { JAN:1,FEB:2,MAR:3,APR:4,MAY:5,JUN:6,JUL:7,AUG:8,SEP:9,SEPT:9,OCT:10,NOV:11,DEC:12,
  SIJ:1,VELJ:2,OZU:3,TRA:4,SVI:5,LIP:6,SRP:7,KOL:8,RUJ:9,LIS:10,STU:11,PRO:12,
  JANUARY:1,FEBRUARY:2,MARCH:3,APRIL:4,MAYL:5,JUNE:6,JULY:7,AUGUST:8,SEPTEMBER:9,OCTOBER:10,NOVEMBER:11,DECEMBER:12,
  SIJECANJ:1,VELJACA:2,OZUJAK:3,TRAVANJ:4,SVIBANJ:5,LIPANJ:6,SRPANJ:7,KOLOVOZ:8,RUJAN:9,LISTOPAD:10,STUDENI:11,PROSINAC:12 };

function extractDateFromText(rawText){
  const text=(rawText||"").replace(/[\u00A0]/g," ");
  const U=text.toUpperCase(), D=deacc(U);
  const near=/\b(BEST\s*BEFORE|USE\s*BY|EXP(?:\.|IRY)?|EXPIRATION|BBE|MHD|ROK\s*TRAJANJA|UPOTRIJEBITI\s*DO|NAJBOLJE\s*UPOTRIJEBITI\s*DO|DATUM\s*ISTEKA)\b/;
  const hasKw=near.test(U); const lot=/\bLOT\b\s*[:#-]?\s*[A-Z0-9\-]+/;
  const c=[]; function push(Y,M,Dd,sc,pat,m,off){ const y=y4(Y), mo=+M, d=+Dd;
    if(!(y>=1990&&y<=2100&&mo>=1&&mo<=12&&d>=1&&d<=31)) return;
    let s=sc; if(hasKw) s+=.25; if(off!=null){ const b=Math.max(0,off-14), a=Math.min(U.length,off+String(m).length+14); if(lot.test(U.slice(b,a))) s-=.3; }
    if(String(Y).length===2) s-=.05; c.push({iso:`${y}-${pad(mo)}-${pad(d)}`,score:s,pattern:pat,matched:m});
  }
  // numeric + month text
  D.replace(/\b(\d{1,2})\s*[.\-\/]\s*(\d{1,2})\s*[.\-\/]\s*(\d{2,4})\b/g,(m,d,mo,y,o)=>{push(y,mo,d,.78,"DD.MM.YYYY",m,o);return m;});
  D.replace(/\b(20\d{2})\s*[.\-\/]\s*(\d{1,2})\s*[.\-\/]\s*(\d{1,2})\b/g,(m,y,mo,d,o)=>{push(y,mo,d,.9,"YYYY-MM-DD",m,o);return m;});
  D.replace(/\b(\d{1,2})\s*\/\s*(20\d{2})\b/g,(m,mo,y,o)=>{push(y,mo,lastDay(y,mo),.72,"MM/YYYY → EOM",m,o);return m;});
  D.replace(/\b(20\d{2})\s*\/\s*(\d{1,2})\b/g,(m,y,mo,o)=>{push(y,mo,lastDay(y,mo),.76,"YYYY/MM → EOM",m,o);return m;});
  D.replace(/\b(20\d{2})\s*-\s*(\d{1,2})\b/g,(m,y,mo,o)=>{push(y,mo,lastDay(y,mo),.72,"YYYY-MM → EOM",m,o);return m;});
  D.replace(/\b(\d{1,2})\s*([A-Z]{3,12})\.?\s*(\d{2,4})\b/g,(m,d,mon,y,o)=>{ const mm=MONTHS[mon]||MONTHS[deacc(mon)]; if(mm) push(y,mm,d,.86,"DD MON YYYY",m,o); return m; });
  D.replace(/\b(?:EXP(?:\.|IRY)?|BBE|MHD)?\s*(\d{1,2})([A-Z]{3,12})(\d{2,4})\b/g,(m,d,mon,y,o)=>{ const mm=MONTHS[mon]||MONTHS[deacc(mon)]; if(mm) push(y,mm,d,.88,"DDMONYY",m,o); return m; });
  D.replace(/\b(?:EXP|BBE|MHD)\s*(\d{1,2})[.\-\/](20\d{2})\b/g,(m,mo,y,o)=>{ push(y,mo,lastDay(y,mo),.74,"KW MM/YYYY → EOM",m,o); return m; });
  const best=new Map(); for(const x of c){ const p=best.get(x.iso); if(!p||x.score>p.score) best.set(x.iso,x); }
  const arr=[...best.values()].sort((a,b)=>b.score-a.score); const top=arr[0]||null;
  return { date: top?top.iso:null, score: top?top.score:0, pattern: top?top.pattern:null, raw: arr.map(x=>x.matched) };
}

/* ===== OCR worker (warm-up) ===== */
let __worker = null, __warmed = false;
async function getWorker(){
  const { createWorker } = require("tesseract.js");
  if(!__worker){
    __worker = await createWorker();
    // brži start: eng; ako želiš kasnije dodamo +hrv
    await __worker.loadLanguage("eng");
    await __worker.initialize("eng");
  }
  return __worker;
}
// warm-up s 1x1 PNG
const ONEPX = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgYAAAAAMAASsJTYQAAAAASUVORK5CYII=","base64");
(async ()=>{ try{ const w=await getWorker(); await w.recognize(ONEPX,{tessedit_pageseg_mode:7}); __warmed=true; console.log("🟢 OCR warmed"); }catch(e){ console.warn("warm fail", e?.message||e); }})();

/* ===== OCR multi-try (rotacije + PSM) ===== */
async function runOCRMulti(images){
  const psmList=[6,7,4]; // block/line/sparse-ish
  let best={ score:-1, text:"", source:"ocr" };
  try{
    const w = await getWorker();
    for(const dataUrl of images||[]){
      const b64=(dataUrl||"").split(",")[1]||""; if(!b64) continue;
      const buf=Buffer.from(b64,"base64");
      for(const psm of psmList){
        try{
          const p = w.recognize(buf,{ user_defined_dpi:"300", tessedit_pageseg_mode:psm, preserve_interword_spaces:"1" });
          const stepTimeout = new Promise((_,rej)=>setTimeout(()=>rej(new Error("ocr step timeout")), 5000));
          const { data:{ text } } = await Promise.race([p, stepTimeout]);
          const parsed = extractDateFromText(text||"");
          const score = parsed && typeof parsed.score==="number" ? parsed.score : 0;
          if(score > (best.score||-1)) best={ score, text:text||"", source:"ocr" };
          if(score>=0.80) return best; // rano stani ako je jako dobro
        }catch(e){ /* probaj dalje */ }
      }
    }
  }catch(e){ /* ignore */ }
  return best;
}

/* ===== HTML (preprocess + rotacije + status) ===== */
const INDEX = `<!doctype html><meta charset="utf-8"><title>Test 3031</title>
<body style="font-family:system-ui;margin:24px">
  <h1>🟢 Test server 3031 radi</h1>
  <p>Ovo je minimalna stranica.</p>
  <p><a href="/scan.html">👉 Otvori /scan.html</a></p>
</body>`;

const SCAN = `<!doctype html>
<meta charset="utf-8"><title>Scan (OCR multi-try)</title>
<body style="font-family:system-ui;margin:24px">
  <h1>Scan (OCR multi-try)</h1>
  <input id="f" type="file" accept="image/*,.heic">
  <button id="go">Run OCR</button>
  <pre id="out" style="white-space:pre-wrap;border:1px solid #ddd;padding:10px;border-radius:8px;margin-top:12px">No result yet.</pre>
<canvas id="work" hidden></canvas>
<script>
const f=document.getElementById("f"), btn=document.getElementById("go"), out=document.getElementById("out"), work=document.getElementById("work");
btn.onclick=async()=>{
  if(!f.files[0]){ alert("Odaberi sliku"); return; }
  try{
    out.textContent="Preprocessing + rotations…";
    const blobs = await preprocessToVariants(f.files[0]); // [0°,90°,270°]
    const images = await Promise.all(blobs.map(b=>blobToDataURL(b)));
    out.textContent="Calling /api/ocr-date2…";
    const r = await fetch("/api/ocr-date2",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({ images })});
    const j = await r.json();
    out.textContent = "source " + (j.source||"?")
      + "\\nscore " + (j.score||0).toFixed(2)
      + "\\nDetected date: " + (j.date||"—")
      + "\\nRaw candidates: " + ((j.raw&&j.raw.join(", "))||"—")
      + "\\n\\nOCR text\\n" + (j.text||"");
  }catch(e){
    out.textContent = "❌ " + (e?.message||e);
  }
};
function blobToDataURL(blob){ return new Promise(res=>{ const fr=new FileReader(); fr.onload=()=>res(fr.result); fr.readAsDataURL(blob); }); }
async function preprocessToVariants(file){
  const bmp = await createImageBitmap(file);
  const maxSide=1800, scale=Math.min(1, maxSide/Math.max(bmp.width,bmp.height));
  const W=Math.round(bmp.width*scale), H=Math.round(bmp.height*scale);
  async function drawAndBinarize(drawFn, w, h){
    work.width=w; work.height=h; const ctx=work.getContext("2d");
    ctx.save(); drawFn(ctx); ctx.restore();
    let img=ctx.getImageData(0,0,w,h), d=img.data;
    for(let i=0;i<d.length;i+=4){ const g=(0.2126*d[i]+0.7152*d[i+1]+0.0722*d[i+2])|0; d[i]=d[i+1]=d[i+2]=g; }
    const hist=new Uint32Array(256); for(let i=0;i<d.length;i+=4) hist[d[i]]++;
    const total=w*h; let sum=0; for(let t=0;t<256;t++) sum+=t*hist[t];
    let sumB=0,wB=0,varMax=-1,thr=127;
    for(let t=0;t<256;t++){ wB+=hist[t]; if(!wB) continue; const wF=total-wB; if(!wF) break; sumB+=t*hist[t];
      const mB=sumB/wB, mF=(sum-sumB)/wF; const v=wB*wF*(mB-mF)*(mB-mF); if(v>varMax){ varMax=v; thr=t; } }
    for(let i=0;i<d.length;i+=4){ const v=d[i]>thr?255:0; d[i]=d[i+1]=d[i+2]=v; }
    ctx.putImageData(img,0,0);
    return await new Promise(res=>work.toBlob(res,"image/png",0.95));
  }
  const b0   = await drawAndBinarize(ctx=>{ ctx.drawImage(bmp,0,0,W,H); }, W, H);
  const b90  = await drawAndBinarize(ctx=>{ ctx.translate(H,0); ctx.rotate(Math.PI/2);  ctx.drawImage(bmp,0,0,W,H); }, H, W);
  const b270 = await drawAndBinarize(ctx=>{ ctx.translate(0,W); ctx.rotate(-Math.PI/2); ctx.drawImage(bmp,0,0,W,H); }, H, W);
  return [b0,b90,b270];
}
</script>
</body>`;

/* ===== routes ===== */
const server = http.createServer(async (req,res)=>{
  const u = (req.url||"").split("?")[0];
  if (u === "/health") return send(res,200,"application/json",JSON.stringify({ok:true,port:PORT,warmed:__warmed,now:new Date().toISOString()}));
  if (u === "/" || u === "/index.html") return send(res,200,"text/html; charset=utf-8",INDEX);
  if (u === "/scan.html") return send(res,200,"text/html; charset=utf-8",SCAN);

  if (u === "/api/ocr-date2" && req.method === "POST"){
    try{
      const body = JSON.parse(await readBody(req)||"{}");
      const imgs = Array.isArray(body.images) ? body.images : (body.image ? [body.image] : []);
      // paralelno: OCR multi-try vs. hard timeout fallback nakon 12s
      const ocrP = (async ()=>{
        const best = await runOCRMulti(imgs);
        let text = (best.text||"").trim();
        let source = "ocr";
        if (!text) { text = "Best before 2025/11\nEXP 12NOV25\nLOT A12345"; source = "fallback"; }
        const parsed = extractDateFromText(text); parsed.text = text; parsed.source = source; parsed.score = parsed.score || best.score || 0;
        return parsed;
      })();
      const timeoutP = new Promise(resolve=>setTimeout(()=>{
        const t="Best before 2025/11\nEXP 12NOV25\nLOT A12345";
        const parsed = extractDateFromText(t); parsed.text=t; parsed.source="fallback"; parsed.score=1.0; parsed.pattern = parsed.pattern || "FALLBACK (timeout)";
        resolve(parsed);
      }, 12000));
      const result = await Promise.race([ocrP, timeoutP]);
      return send(res,200,"application/json",JSON.stringify(result));
    }catch(e){
      const t="Best before 2025/11\nEXP 12NOV25\nLOT A12345";
      const parsed = extractDateFromText(t); parsed.text=t; parsed.source="fallback"; parsed.score=1.0;
      return send(res,200,"application/json",JSON.stringify(parsed));
    }
  }
  if (u === "/api/ocr-date" && req.method === "POST"){
    const t="Best before 2025/11\nEXP 12NOV25\nLOT A12345";
    const parsed = extractDateFromText(t); parsed.text=t; parsed.source="fallback"; parsed.score=1.0;
    return send(res,200,"application/json",JSON.stringify(parsed));
  }
  return send(res,404,"text/plain","Not Found");
});

server.listen(PORT,"127.0.0.1",()=>console.log("✅ test+scan (OCR multi) on http://127.0.0.1:"+PORT));
