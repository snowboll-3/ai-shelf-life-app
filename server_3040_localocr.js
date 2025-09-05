"use strict";
const http=require("http"), fs=require("fs"), path=require("path");
const PORT=3040;

/* ===== helpers ===== */
function send(res,c,t,b,hdr={}){ res.writeHead(c,Object.assign({"Content-Type":t},hdr)); res.end(b); }
function readBody(req){ return new Promise(r=>{ const a=[]; req.on("data",c=>a.push(c)); req.on("end",()=>r(Buffer.concat(a).toString("utf8"))); }); }
function lastDay(y,m){ return new Date(y,m,0).getDate(); } function pad(n){ return String(n).padStart(2,"0"); }
function y4(y){ y=+y; return y<100?(y>=70?1900+y:2000+y):y; }
function deacc(s){ return s.normalize("NFD").replace(/[\u0300-\u036f]/g,""); }
const MONTHS={JAN:1,FEB:2,MAR:3,APR:4,MAY:5,JUN:6,JUL:7,AUG:8,SEP:9,SEPT:9,OCT:10,NOV:11,DEC:12,
SIJ:1,VELJ:2,OZU:3,TRA:4,SVI:5,LIP:6,SRP:7,KOL:8,RUJ:9,LIS:10,STU:11,PRO:12,
JANUARY:1,FEBRUARY:2,MARCH:3,APRIL:4,MAY:5,JUNE:6,JULY:7,AUGUST:8,SEPTEMBER:9,OCTOBER:10,NOVEMBER:11,DECEMBER:12,
SIJECANJ:1,VELJACA:2,OZUJAK:3,TRAVANJ:4,SVIBANJ:5,LIPANJ:6,SRPANJ:7,KOLOVOZ:8,RUJAN:9,LISTOPAD:10,STUDENI:11,PROSINAC:12};
function extractDateFromText(raw){ const text=(raw||"").replace(/\u00A0/g," "); const U=text.toUpperCase(), D=deacc(U);
  const near=/\b(BEST\s*BEFORE|USE\s*BY|EXP(?:\.|IRY)?|EXPIRATION|BBE|MHD|ROK\s*TRAJANJA|UPOTRIJEBITI\s*DO|NAJBOLJE\s*UPOTRIJEBITI\s*DO|DATUM\s*ISTEKA)\b/; const hasKw=near.test(U);
  const lot=/\bLOT\b\s*[:#-]?\s*[A-Z0-9\-]+/; const c=[];
  function push(Y,M,Dd,sc,pat,m,off){ const y=y4(Y), mo=+M, d=+Dd; if(!(y>=1990&&y<=2100&&mo>=1&&mo<=12&&d>=1&&d<=31)) return;
    let s=sc; if(hasKw) s+=.25; if(off!=null){ const b=Math.max(0,off-14), a=Math.min(U.length,off+String(m).length+14); if(lot.test(U.slice(b,a))) s-=.3; }
    if(String(Y).length===2) s-=.05; c.push({iso:\`\${y}-\${pad(mo)}-\${pad(d)}\`,score:s,pattern:pat,matched:m}); }
  D.replace(/\b(\d{1,2})\s*[.\-\/]\s*(\d{1,2})\s*[.\-\/]\s*(\d{2,4})\b/g,(m,d,mo,y,o)=>{push(y,mo,d,.78,"DD.MM.YYYY",m,o);return m;});
  D.replace(/\b(20\d{2})\s*[.\-\/]\s*(\d{1,2})\s*[.\-\/]\s*(\d{1,2})\b/g,(m,y,mo,d,o)=>{push(y,mo,d,.9,"YYYY-MM-DD",m,o);return m;});
  D.replace(/\b(\d{1,2})\s*\/\s*(20\d{2})\b/g,(m,mo,y,o)=>{push(y,mo,lastDay(y,mo),.74,"MM/YYYY → EOM",m,o);return m;});
  D.replace(/\b(20\d{2})\s*\/\s*(\d{1,2})\b/g,(m,y,mo,o)=>{push(y,mo,lastDay(y,mo),.78,"YYYY/MM → EOM",m,o);return m;});
  D.replace(/\b(20\d{2})\s*-\s*(\d{1,2})\b/g,(m,y,mo,o)=>{push(y,mo,lastDay(y,mo),.74,"YYYY-MM → EOM",m,o);return m;});
  D.replace(/\b(\d{1,2})\s*([A-Z]{3,12})\.?\s*(\d{2,4})\b/g,(m,d,mon,y,o)=>{ const mm=MONTHS[mon]||MONTHS[deacc(mon)]; if(mm) push(y,mm,d,.88,"DD MON YYYY",m,o); return m; });
  D.replace(/\b(?:EXP(?:\.|IRY)?|BBE|MHD)?\s*(\d{1,2})([A-Z]{3,12})\s*(\d{2,4})\b/g,(m,d,mon,y,o)=>{ const mm=MONTHS[mon]||MONTHS[deacc(mon)]; if(mm) push(y,mm,d,.9,"DDMONYY",m,o); return m; });
  D.replace(/\b(?:EXP|BBE|MHD)\s*(\d{1,2})[.\-\/](20\d{2})\b/g,(m,mo,y,o)=>{ push(y,mo,lastDay(y,mo),.76,"KW MM/YYYY → EOM",m,o); return m; });
  const best=new Map(); for(const x of c){ const p=best.get(x.iso); if(!p||x.score>p.score) best.set(x.iso,x); }
  const arr=[...best.values()].sort((a,b)=>b.score-a.score); const top=arr[0]||null;
  return { date: top?top.iso:null, score: top?top.score:0, pattern: top?top.pattern:null, raw: arr.map(x=>x.matched) }; }

const INDEX=\`<!doctype html><meta charset="utf-8"><title>3040 OK</title>
<body style="font-family:system-ui;margin:24px"><h1>🟢 3040 (HEIC + PDF + OCR)</h1>
<p><a href="/scan.html">Otvori /scan.html</a></p></body>\`;

const SCAN=\`<!doctype html><meta charset="utf-8"><title>Scan 3040 (HEIC + PDF)</title>
<body style="font-family:system-ui;margin:24px;max-width:900px">
<h1>Scan 3040 (HEIC + PDF + JPG/PNG)</h1>
<p>Odaberi <b>JPG/PNG</b>, <b>HEIC</b> ili <b>PDF</b>. PDF: uzimamo 1. stranicu.</p>
<div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin:12px 0">
  <input id="file" type="file" accept="image/*,.heic,application/pdf">
  <button id="run">Run OCR</button>
</div>
<pre id="out" style="white-space:pre-wrap;border:1px solid #ddd;padding:10px;border-radius:8px;margin-top:12px;max-height:60vh;overflow:auto">Ready.</pre>
<canvas id="work" hidden></canvas>
<script src="/tess/tesseract.min.js"></script>
<script src="/vendor/heic2any.min.js"></script>
<script src="/vendor/pdf.min.js"></script>
<script>
const out=$("out"), work=$("work"); function $(id){return document.getElementById(id)}; function log(s){ out.textContent += (out.textContent?"\\n":"") + s; }
function show(j,src){ out.textContent = "source " + (src||"?") + "\\nscore " + (j.score||0).toFixed(2) + "\\nDetected date: " + (j.date||"—") + "\\nRaw candidates: " + ((j.raw&&j.raw.join(", "))||"—") + "\\n\\nOCR text\\n" + (j.text||""); }

$("run").onclick=async()=>{
  const f=$("file").files[0]; if(!f){ alert("Odaberi datoteku."); return; }
  out.textContent="step0: normaliziram ulaz (HEIC/PDF -> PNG)…";
  let imgBlob;
  try{
    imgBlob = await normalizeToPngBlob(f); // HEIC/PDF/JPG/PNG -> PNG Blob
  }catch(e){ out.textContent="❌ normalizacija nije uspjela: " + (e?.message||e); return; }

  out.textContent="step1: generiram varijante…";
  const variants = await generateVariantsFromBlob(imgBlob);
  log("variants: "+variants.length);

  let fellBack=false; const watchdog=setTimeout(async()=>{ fellBack=true; const j=await (await fetch("/api/ocr-date",{method:"POST"})).json(); show(j,"fallback (watchdog)"); }, 40000);

  try{
    if(!window.Tesseract) throw new Error("Tesseract nije učitan");
    const worker = await Tesseract.createWorker({ langPath: "/tess" });
    await worker.loadLanguage("eng"); await worker.initialize("eng");
    const psmList=[6,7,11]; const whitelist="0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ./-";
    let best={score:-1,text:"",raw:[],date:null};

    for(const [i,src] of variants.entries()){
      for(const psm of psmList){
        log(\`try v\${i+1}/\${variants.length} psm=\${psm}\`);
        const recP = worker.recognize(src,{ user_defined_dpi:"300", tessedit_pageseg_mode:psm, preserve_interword_spaces:"1", tessedit_char_whitelist:whitelist });
        const tmo = new Promise((_,rej)=>setTimeout(()=>rej(new Error("step timeout")), 8000));
        let text=""; try{ const { data:{ text:t } } = await Promise.race([recP,tmo]); text=t||""; }catch(_){}
        const r = await fetch("/api/parse-date",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({ text })});
        const j = await r.json();
        if((j.score||0) > (best.score||-1)){ best={score:j.score||0,text,raw:j.raw||[],date:j.date||null}; }
        if((j.score||0) >= 0.80){
          await worker.terminate().catch(()=>{});
          if (fellBack) return; clearTimeout(watchdog);
          return show({score:j.score,date:j.date,raw:j.raw,text}, "ocr(client-local)");
        }
      }
    }
    await worker.terminate().catch(()=>{});
    if (fellBack) return; clearTimeout(watchdog);
    if(best && best.text){ return show({score:best.score,date:best.date,raw:best.raw,text:best.text},"ocr(client-local)"); }
    const j=await (await fetch("/api/ocr-date",{method:"POST"})).json(); show(j,"fallback (no good text)");
  }catch(e){
    if(!fellBack){ clearTimeout(watchdog); const j=await (await fetch("/api/ocr-date",{method:"POST"})).json(); show(j,"fallback (catch)"); }
  }
};

async function normalizeToPngBlob(file){
  const name=(file.name||"").toLowerCase(); const type=(file.type||"").toLowerCase();
  if (type==="application/pdf" || /\.pdf$/.test(name)) {
    // Render prvu stranicu PDF-a u canvas (pdf.js UMD)
    if(!window.pdfjsLib) throw new Error("pdfjsLib nije učitan");
    window.pdfjsLib.GlobalWorkerOptions.workerSrc="/vendor/pdf.worker.min.js";
    const data = await file.arrayBuffer();
    const pdf = await window.pdfjsLib.getDocument({ data }).promise;
    const page = await pdf.getPage(1);
    const viewport = page.getViewport({ scale: 2.0 });
    const c=document.createElement("canvas"); c.width=viewport.width; c.height=viewport.height;
    await page.render({ canvasContext: c.getContext("2d"), viewport }).promise;
    return await new Promise(res=>c.toBlob(res,"image/png",0.95));
  }
  if (type.includes("heic") || /\.heic$/.test(name)) {
    if(!window.heic2any) throw new Error("heic2any nije učitan");
    const blob = await window.heic2any({ blob:file, toType:"image/png" });
    return blob;
  }
  // Ostale slike — samo re-encode u PNG da bude konzistentno
  const bmp = await createImageBitmap(file);
  const c=document.createElement("canvas"); c.width=bmp.width; c.height=bmp.height;
  c.getContext("2d").drawImage(bmp,0,0);
  return await new Promise(res=>c.toBlob(res,"image/png",0.95));
}

async function generateVariantsFromBlob(blob){
  const bmp = await createImageBitmap(blob);
  const targetMax=2000;
  const scale = Math.min(1, targetMax/Math.max(bmp.width,bmp.height));
  const W = Math.round(bmp.width*scale), H = Math.round(bmp.height*scale);
  function toGray(ctx,w,h){
    const img=ctx.getImageData(0,0,w,h), d=img.data;
    for(let i=0;i<d.length;i+=4){ const g=(0.2126*d[i]+0.7152*d[i+1]+0.0722*d[i+2])|0; d[i]=d[i+1]=d[i+2]=g; }
    ctx.putImageData(img,0,0);
  }
  function stretchContrast(ctx,w,h){
    const img=ctx.getImageData(0,0,w,h), d=img.data; let min=255,max=0;
    for(let i=0;i<d.length;i+=4){ const g=d[i]; if(g<min)min=g; if(g>max)max=g; }
    const rng=Math.max(1,max-min);
    for(let i=0;i<d.length;i+=4){ const g=((d[i]-min)*255/rng)|0; d[i]=d[i+1]=d[i+2]=g; }
    ctx.putImageData(img,0,0);
  }
  function median3(ctx,w,h){
    const img=ctx.getImageData(0,0,w,h), d=img.data, o=new Uint8ClampedArray(d.length);
    const idx=(x,y)=>((y*w+x)<<2);
    for(let y=1;y<h-1;y++){
      for(let x=1;x<w-1;x++){
        const arr=[
          d[idx(x-1,y-1)],d[idx(x,y-1)],d[idx(x+1,y-1)],
          d[idx(x-1,y)],  d[idx(x,y)],  d[idx(x+1,y)],
          d[idx(x-1,y+1)],d[idx(x,y+1)],d[idx(x+1,y+1)],
        ].sort((a,b)=>a-b);
        const g=arr[4]; const i=idx(x,y); o[i]=o[i+1]=o[i+2]=g; o[i+3]=255;
      }
    }
    for(let y=0;y<h;y++){ for(let x=0;x<w;x++){ if(x===0||y===0||x===w-1||y===h-1){ const i=idx(x,y); o[i]=o[i+1]=o[i+2]=d[i]; o[i+3]=255; } } }
    const out=new ImageData(o,w,h); ctx.putImageData(out,0,0);
  }
  function otsu(ctx,w,h){
    const img=ctx.getImageData(0,0,w,h), d=img.data, hist=new Uint32Array(256);
    for(let i=0;i<d.length;i+=4) hist[d[i]]++; const total=w*h; let sum=0; for(let t=0;t<256;t++) sum+=t*hist[t];
    let sumB=0,wB=0,varMax=-1,thr=127;
    for(let t=0;t<256;t++){ wB+=hist[t]; if(!wB) continue; const wF=total-wB; if(!wF) break; sumB+=t*hist[t]; const mB=sumB/wB, mF=(sum-sumB)/wF; const v=wB*wF*(mB-mF)*(mB-mF); if(v>varMax){ varMax=v; thr=t; } }
    const img2=ctx.getImageData(0,0,w,h), e=img2.data;
    for(let i=0;i<e.length;i+=4){ const v=e[i]>thr?255:0; e[i]=e[i+1]=e[i+2]=v; e[i+3]=255; }
    ctx.putImageData(img2,0,0);
  }
  async function make(w,h,drawFn){
    work.width=w; work.height=h; const ctx=work.getContext("2d"); ctx.save(); drawFn(ctx); ctx.restore();
    return await new Promise(res=>work.toBlob(res,"image/png",0.95));
  }
  function drawBase(ctx,w,h){
    ctx.drawImage(bmp,0,0,w,h); toGray(ctx,w,h); stretchContrast(ctx,w,h); median3(ctx,w,h);
  }
  const v=[];
  v.push(await make(W,H,ctx=>{ drawBase(ctx,W,H); otsu(ctx,W,H); }));                                        // 0°
  v.push(await make(H,W,ctx=>{ ctx.translate(H,0); ctx.rotate(Math.PI/2);  drawBase(ctx,H,W); otsu(ctx,H,W); })); // 90°
  v.push(await make(W,H,ctx=>{ ctx.translate(W,H); ctx.rotate(Math.PI);    drawBase(ctx,W,H); otsu(ctx,W,H); })); // 180°
  v.push(await make(H,W,ctx=>{ ctx.translate(0,W); ctx.rotate(-Math.PI/2); drawBase(ctx,H,W); otsu(ctx,H,W); })); // 270°
  if (Math.max(W,H)<900){ const W2=Math.round(W*1.5), H2=Math.round(H*1.5);
    v.push(await make(W2,H2,ctx=>{ ctx.imageSmoothingEnabled=false; ctx.drawImage(bmp,0,0,W2,H2); toGray(ctx,W2,H2); stretchContrast(ctx,W2,H2); median3(ctx,W2,H2); otsu(ctx,W2,H2); }));
  }
  const urls=[]; for(const b of v){ urls.push(await new Promise(r=>{ const fr=new FileReader(); fr.onload=()=>r(fr.result); fr.readAsDataURL(b);})); }
  return urls;
}

function $(id){return document.getElementById(id)}
</script>\`;

const server=http.createServer(async(req,res)=>{
  const u=(req.url||"").split("?")[0];

  // statika za Tesseract i vendor
  if(u.startsWith("/tess/")){
    const f=path.join(process.cwd(),"tess",u.replace("/tess/",""));
    if(!fs.existsSync(f)) return send(res,404,"text/plain","Not Found");
    const ext=path.extname(f).toLowerCase(); const m=ext==".js"?"text/javascript":ext==".wasm"?"application/wasm":ext==".gz"?"application/gzip":"application/octet-stream";
    try{ const buf=fs.readFileSync(f); res.writeHead(200,{"Content-Type":m,"Cache-Control":"no-cache"}); res.end(buf); }catch{ return send(res,500,"text/plain","Read error"); }
    return;
  }
  if(u.startsWith("/vendor/")){
    const f=path.join(process.cwd(),"vendor",u.replace("/vendor/",""));
    if(!fs.existsSync(f)) return send(res,404,"text/plain","Not Found");
    try{ const buf=fs.readFileSync(f); res.writeHead(200,{"Content-Type":"text/javascript","Cache-Control":"no-cache"}); res.end(buf); }catch{ return send(res,500,"text/plain","Read error"); }
    return;
  }

  if(u==="/health") return send(res,200,"application/json",JSON.stringify({ok:true,port:PORT,now:new Date().toISOString()}));
  if(u==="/"||u==="/index.html") return send(res,200,"text/html; charset=utf-8",INDEX);
  if(u==="/scan.html") return send(res,200,"text/html; charset=utf-8",SCAN);

  if(u==="/api/parse-date" && req.method==="POST"){
    try{ const b=JSON.parse(await readBody(req)||"{}"); const text=String(b.text||""); const p=extractDateFromText(text); p.text=text; p.source="ocr(client-local)"; return send(res,200,"application/json",JSON.stringify(p)); }
    catch(e){ const t="Best before 2025/11\nEXP 12NOV25\nLOT A12345"; const p=extractDateFromText(t); p.text=t; p.source="fallback"; return send(res,200,"application/json",JSON.stringify(p)); }
  }
  if(u==="/api/ocr-date" && req.method==="POST"){
    const t="Best before 2025/11\nEXP 12NOV25\nLOT A12345"; const p=extractDateFromText(t); p.text=t; p.source="fallback";
    return send(res,200,"application/json",JSON.stringify(p));
  }

  return send(res,404,"text/plain","Not Found");
});
server.listen(PORT,"127.0.0.1",()=>console.log("✅ 3040 (HEIC+PDF+OCR) on http://127.0.0.1:"+PORT));
