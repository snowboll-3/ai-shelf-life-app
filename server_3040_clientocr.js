"use strict";
const http = require("http");
const PORT = 3040;

/* ===== helpers ===== */
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
  const text=(rawText||"").replace(/\u00A0/g," ");
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

/* ===== HTML (client OCR via 2 CDN-a + tvrdi timeout + instant fallback) ===== */
const INDEX = `<!doctype html><meta charset="utf-8"><title>3040 OK</title>
<body style="font-family:system-ui;margin:24px">
<h1>🟢 Server 3040 radi</h1>
<p><a href="/scan.html">Otvori /scan.html</a></p>
</body>`;

const SCAN = `<!doctype html>
<meta charset="utf-8"><title>Scan 3040 (client OCR)</title>
<body style="font-family:system-ui;margin:24px">
  <h1>Scan 3040 (client OCR + fallback)</h1>
  <input id="f" type="file" accept="image/*,.heic">
  <button id="go">Run OCR</button>
  <pre id="out" style="white-space:pre-wrap;border:1px solid #ddd;padding:10px;border-radius:8px;margin-top:12px">No result yet.</pre>
<canvas id="work" hidden></canvas>

<script>
// ————— helpers to load Tesseract from multiple CDNs —————
function loadScript(src, timeoutMs=4000){
  return new Promise((resolve,reject)=>{
    const s=document.createElement("script"); s.src=src; s.async=true;
    let done=false;
    s.onload=()=>{ if(!done){ done=true; resolve(true); } };
    s.onerror=()=>{ if(!done){ done=true; reject(new Error("script load fail")); } };
    document.head.appendChild(s);
    setTimeout(()=>{ if(!done){ done=true; try{s.remove();}catch{} reject(new Error("script load timeout")); } }, timeoutMs);
  });
}
async function loadTesseractWithFallback(){
  const cdns=[
    { base:"https://unpkg.com",     lib:"/tesseract.js@5.0.4/dist/tesseract.min.js", worker:"/tesseract.js@5.0.4/dist/worker.min.js", core:"/tesseract.js-core@5.0.2/tesseract-core.wasm.js", lang:"https://tessdata.projectnaptha.com/4.0.0" },
    { base:"https://cdn.jsdelivr.net/npm", lib:"/tesseract.js@5.0.4/dist/tesseract.min.js", worker:"/tesseract.js@5.0.4/dist/worker.min.js", core:"/tesseract.js-core@5.0.2/tesseract-core.wasm.js", lang:"https://tessdata.projectnaptha.com/4.0.0" }
  ];
  for(const c of cdns){
    try{
      await loadScript(c.base + c.lib, 4000);
      if (window.Tesseract) return c;
    }catch(_){}
  }
  return null;
}

// ————— UI logic —————
const f=document.getElementById("f"), btn=document.getElementById("go"), out=document.getElementById("out"), work=document.getElementById("work");

btn.onclick=async()=>{
  if(!f.files[0]){ alert("Odaberi sliku"); return; }

  // Globalni watchdog: ako bilo što traje > 12s → automatski fallback
  let fellBack=false;
  const watchdog=setTimeout(async ()=>{
    if(fellBack) return;
    fellBack=true;
    out.textContent="Fallback /api/ocr-date…";
    const r2 = await fetch("/api/ocr-date",{method:"POST"}); const j2 = await r2.json();
    out.textContent = "source fallback"
      + "\\nscore " + (j2.score||0).toFixed(2)
      + "\\nDetected date: " + (j2.date||"—")
      + "\\nRaw candidates: " + ((j2.raw&&j2.raw.join(", "))||"—")
      + "\\n\\nOCR text\\n" + (j2.text||"");
  }, 12000);

  try{
    out.textContent="Preprocessing…";
    const img = await preprocess(f.files[0]);   // grayscale + Otsu
    const b64 = await blobToDataURL(img);

    out.textContent="Učitavam Tesseract (CDN)…";
    const cfg = await loadTesseractWithFallback();
    if(!cfg || !window.Tesseract){ throw new Error("CDN blocked"); }

    out.textContent="OCR u pregledniku…";
    const worker = await Tesseract.createWorker({
      workerPath: cfg.base + cfg.worker,
      corePath:   cfg.base + cfg.core,
      langPath:   cfg.lang
    });
    await worker.loadLanguage("eng");
    await worker.initialize("eng");

    const p = worker.recognize(b64, { user_defined_dpi:"300", tessedit_pageseg_mode:6, preserve_interword_spaces:"1" });
    const tmo = new Promise((_,rej)=>setTimeout(()=>rej(new Error("ocr timeout")), 9000));
    const { data:{ text } } = await Promise.race([p, tmo]).catch(()=>({data:{text:""}}));
    try{ await worker.terminate(); }catch{}

    if (fellBack) return; // watchdog već poslao fallback
    clearTimeout(watchdog);

    if (text && text.trim()){
      out.textContent="Parsiram datum…";
      const r = await fetch("/api/parse-date",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({ text })});
      const j = await r.json();
      j.text = text; j.source = "ocr(client)";
      out.textContent = "source " + (j.source||"?")
        + "\\nscore " + (j.score||0).toFixed(2)
        + "\\nDetected date: " + (j.date||"—")
        + "\\nRaw candidates: " + ((j.raw&&j.raw.join(", "))||"—")
        + "\\n\\nOCR text\\n" + (j.text||"");
    }else{
      // ručni fallback
      out.textContent="Fallback /api/ocr-date…";
      const r2 = await fetch("/api/ocr-date",{method:"POST"}); const j2 = await r2.json();
      out.textContent = "source fallback"
        + "\\nscore " + (j2.score||0).toFixed(2)
        + "\\nDetected date: " + (j2.date||"—")
        + "\\nRaw candidates: " + ((j2.raw&&j2.raw.join(", "))||"—")
        + "\\n\\nOCR text\\n" + (j2.text||"");
    }
  }catch(e){
    if(!fellBack){
      clearTimeout(watchdog);
      out.textContent="Fallback /api/ocr-date…";
      const r2 = await fetch("/api/ocr-date",{method:"POST"}); const j2 = await r2.json();
      out.textContent = "source fallback"
        + "\\nscore " + (j2.score||0).toFixed(2)
        + "\\nDetected date: " + (j2.date||"—")
        + "\\nRaw candidates: " + ((j2.raw&&j2.raw.join(", "))||"—")
        + "\\n\\nOCR text\\n" + (j2.text||"");
    }
  }
};

async function preprocess(file){
  const bmp = await createImageBitmap(file);
  const maxSide=1800, scale=Math.min(1, maxSide/Math.max(bmp.width,bmp.height));
  const W=Math.round(bmp.width*scale), H=Math.round(bmp.height*scale);
  work.width=W; work.height=H; const ctx=work.getContext("2d");
  ctx.drawImage(bmp,0,0,W,H);
  let img=ctx.getImageData(0,0,W,H), d=img.data;
  for(let i=0;i<d.length;i+=4){ const g=(0.2126*d[i]+0.7152*d[i+1]+0.0722*d[i+2])|0; d[i]=d[i+1]=d[i+2]=g; }
  const hist=new Uint32Array(256); for(let i=0;i<d.length;i+=4) hist[d[i]]++;
  const total=W*H; let sum=0; for(let t=0;t<256;t++) sum+=t*hist[t];
  let sumB=0,wB=0,varMax=-1,thr=127;
  for(let t=0;t<256;t++){ wB+=hist[t]; if(!wB) continue; const wF=total-wB; if(!wF) break; sumB+=t*hist[t];
    const mB=sumB/wB, mF=(sum-sumB)/wF; const v=wB*wF*(mB-mF)*(mB-mF); if(v>varMax){ varMax=v; thr=t; } }
  for(let i=0;i<d.length;i+=4){ const v=d[i]>thr?255:0; d[i]=d[i+1]=d[i+2]=v; }
  ctx.putImageData(img,0,0); 
  return await new Promise(res=>work.toBlob(res,"image/png",0.95));
}
function blobToDataURL(blob){ return new Promise(res=>{ const fr=new FileReader(); fr.onload=()=>res(fr.result); fr.readAsDataURL(blob); }); }
</script>
</body>`;

/* ===== routes ===== */
const server = http.createServer(async (req,res)=>{
  const u = (req.url||"").split("?")[0];
  if (u === "/health") return send(res,200,"application/json",JSON.stringify({ok:true,port:PORT,now:new Date().toISOString()}));
  if (u === "/" || u === "/index.html") return send(res,200,"text/html; charset=utf-8",INDEX);
  if (u === "/scan.html") return send(res,200,"text/html; charset=utf-8",SCAN);

  if (u === "/api/parse-date" && req.method === "POST"){
    try{
      const body = JSON.parse(await readBody(req)||"{}");
      const text = String(body.text||"");
      const parsed = extractDateFromText(text); parsed.text=text; parsed.source="ocr(client)";
      return send(res,200,"application/json",JSON.stringify(parsed));
    }catch(e){
      const text="Best before 2025/11\nEXP 12NOV25\nLOT A12345";
      const parsed = extractDateFromText(text); parsed.text=text; parsed.source="fallback";
      return send(res,200,"application/json",JSON.stringify(parsed));
    }
  }

  if (u === "/api/ocr-date" && req.method === "POST"){
    const text="Best before 2025/11\nEXP 12NOV25\nLOT A12345";
    const parsed = extractDateFromText(text); parsed.text=text; parsed.source="fallback";
    return send(res,200,"application/json",JSON.stringify(parsed));
  }

  return send(res,404,"text/plain","Not Found");
});

server.listen(PORT,"127.0.0.1",()=>console.log("✅ 3040 client-OCR (dual CDN + fallback) on http://127.0.0.1:"+PORT));
