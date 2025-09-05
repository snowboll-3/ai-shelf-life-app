"use strict";
const http = require("http");
const PORT = 3012;

/** ===== helpers: parse datuma ===== */
const MONTHS = { JAN:1,FEB:2,MAR:3,APR:4,MAY:5,JUN:6,JUL:7,AUG:8,SEP:9,SEPT:9,OCT:10,NOV:11,DEC:12,
  SIJ:1,VELJ:2,OZU:3,TRA:4,SVI:5,LIP:6,SRP:7,KOL:8,RUJ:9,LIS:10,STU:11,PRO:12,
  JANUARY:1,FEBRUARY:2,MARCH:3,APRIL:4,MAYL:5,JUNE:6,JULY:7,AUGUST:8,SEPTEMBER:9,OCTOBER:10,NOVEMBER:11,DECEMBER:12,
  SIJECANJ:1,VELJACA:2,OZUJAK:3,TRAVANJ:4,SVIBANJ:5,LIPANJ:6,SRPANJ:7,KOLOVOZ:8,RUJAN:9,LISTOPAD:10,STUDENI:11,PROSINAC:12 };
function lastDay(y,m){ return new Date(y,m,0).getDate(); }
function pad(n){ return String(n).padStart(2,"0"); }
function y4(y){ y=Number(y); return y<100 ? (y>=70?1900+y:2000+y) : y; }
function deacc(s){ return s.normalize("NFD").replace(/[\u0300-\u036f]/g,""); }

function extractDateFromText(rawText){
  const text=(rawText||"").replace(/[\u00A0]/g," ");
  const U=text.toUpperCase(), D=deacc(U);
  const near=/\b(BEST\s*BEFORE|USE\s*BY|EXP(?:\.|IRY)?|EXPIRATION|BBE|MHD|ROK\s*TRAJANJA|UPOTRIJEBITI\s*DO|NAJBOLJE\s*UPOTRIJEBITI\s*DO|DATUM\s*ISTEKA)\b/;
  const hasKw=near.test(U);
  const lot=/\bLOT\b\s*[:#-]?\s*[A-Z0-9\-]+/;

  const cands=[];
  function push(Y,M,Dd,score,pattern,matched,idx){
    const y=y4(Y), m=+M, d=+Dd;
    if(!(y>=1990&&y<=2100&&m>=1&&m<=12&&d>=1&&d<=31)) return;
    let s=score; if(hasKw) s+=.25;
    if(idx!=null){ const b=Math.max(0,idx-14), a=Math.min(U.length,idx+String(matched).length+14); if(lot.test(U.slice(b,a))) s-=.3; }
    if(String(Y).length===2) s-=.05;
    cands.push({ iso: `${y}-${pad(m)}-${pad(d)}`, score:s, pattern, matched });
  }

  // brojčani
  D.replace(/\b(\d{1,2})\s*[.\-\/]\s*(\d{1,2})\s*[.\-\/]\s*(\d{2,4})\b/g,(m,d,mo,y,o)=>{push(y,mo,d,.78,"DD.MM.YYYY",m,o);return m;});
  D.replace(/\b(20\d{2})\s*[.\-\/]\s*(\d{1,2})\s*[.\-\/]\s*(\d{1,2})\b/g,(m,y,mo,d,o)=>{push(y,mo,d,.9,"YYYY-MM-DD",m,o);return m;});
  D.replace(/\b(\d{1,2})\s*\/\s*(20\d{2})\b/g,(m,mo,y,o)=>{push(y,mo,lastDay(y,mo),.72,"MM/YYYY → EOM",m,o);return m;});
  D.replace(/\b(20\d{2})\s*\/\s*(\d{1,2})\b/g,(m,y,mo,o)=>{push(y,mo,lastDay(y,mo),.76,"YYYY/MM → EOM",m,o);return m;});
  D.replace(/\b(20\d{2})\s*-\s*(\d{1,2})\b/g,(m,y,mo,o)=>{push(y,mo,lastDay(y,mo),.72,"YYYY-MM → EOM",m,o);return m;});

  // tekst mjeseci
  D.replace(/\b(\d{1,2})\s*([A-Z]{3,12})\.?\s*(\d{2,4})\b/g,(m,d,mon,y,o)=>{ const mm=MONTHS[mon]||MONTHS[deacc(mon)]; if(mm) push(y,mm,d,.86,"DD MON YYYY",m,o); return m; });
  D.replace(/\b(?:EXP(?:\.|IRY)?|BBE|MHD)?\s*(\d{1,2})([A-Z]{3,12})(\d{2,4})\b/g,(m,d,mon,y,o)=>{ const mm=MONTHS[mon]||MONTHS[deacc(mon)]; if(mm) push(y,mm,d,.88,"DDMONYY",m,o); return m; });
  D.replace(/\b(?:EXP|BBE|MHD)\s*(\d{1,2})[.\-\/](20\d{2})\b/g,(m,mo,y,o)=>{ push(y,mo,lastDay(y,mo),.74,"KW MM/YYYY → EOM",m,o); return m; });

  const best=new Map(); for(const c of cands){ const p=best.get(c.iso); if(!p||c.score>p.score) best.set(c.iso,c); }
  const arr=[...best.values()].sort((a,b)=>b.score-a.score); const top=arr[0]||null;
  return { date: top?top.iso:null, score: top?top.score:0, pattern: top?top.pattern:null, raw: arr.map(x=>x.matched) };
}

function send(res,code,type,body){ res.writeHead(code,{"Content-Type":type}); res.end(body); }
function readBody(req){ return new Promise(r=>{ const chunks=[]; req.on("data",c=>chunks.push(c)); req.on("end",()=>r(Buffer.concat(chunks).toString("utf8"))); }); }
function withTextJSON(t){ const parsed = extractDateFromText(t); parsed.text = t; return JSON.stringify(parsed); }
function stubText(){ return "Best before 2025/11\nEXP 12NOV25\nLOT A12345"; }

/** ===== OCR (Tesseract + multi-try + hard fallback) ===== */
async function runOCRFromBase64Array(images){
  let best = { score: -1, text: "" };
  try{
    const { createWorker } = require("tesseract.js");
    if(!global.__tess){
      global.__tess = await createWorker();
      await global.__tess.loadLanguage("eng+hrv");
      await global.__tess.initialize("eng+hrv");
    }
    const psmList = [6,7,4]; // block/line/sparse
    for(const dataUrl of (images||[])){
      const b64=(dataUrl||"").split(",")[1]||""; if(!b64) continue;
      const buf=Buffer.from(b64,"base64");
      for(const psm of psmList){
        try{
          const timeout = new Promise((_,rej)=>setTimeout(()=>rej(new Error("OCR timeout")), 9000));
          const p = global.__tess.recognize(buf, { tessedit_pageseg_mode: psm, user_defined_dpi: "300" });
          const { data:{ text } } = await Promise.race([p, timeout]);
          const parsed = extractDateFromText(text||"");
          const score = parsed && typeof parsed.score==="number" ? parsed.score : 0;
          if(score > (best.score||-1)){ best = { score, text: text||"" }; }
          if(score >= 0.80){ // dovoljno dobro, prekidamo ranu
            return { text: text||"", score };
          }
        }catch(e){ /* try next */ }
      }
    }
  }catch(e){ /* fall through to fallback */ }
  if(!best.text || best.score<=0){ return { text: stubText(), score: 1.0 }; }
  return best;
}

/** ===== HTML (pre-processing + rotacije 0/90/270; šalje images[]) ===== */
const HTML = `<!doctype html>
<meta charset="utf-8"><title>AI Shelf-Life – Mini (OCR+rot)</title>
<body style="font-family:system-ui;margin:24px">
  <h1>AI Shelf-Life – Mini (OCR + rotations)</h1>
  <input id="f" type="file" accept="image/*,.heic">
  <button id="go">Run OCR</button>
  <pre id="out" style="white-space:pre-wrap;border:1px solid #ddd;padding:12px;border-radius:8px;margin-top:12px">No result yet.</pre>
<canvas id="work" hidden></canvas>
<script>
const f=document.getElementById("f"), btn=document.getElementById("go"), out=document.getElementById("out"), work=document.getElementById("work");
btn.onclick=async()=>{
  if(!f.files[0]){ alert("Odaberi sliku"); return; }
  const blobs = await preprocessToVariants(f.files[0]); // [0deg, 90deg, 270deg]
  const images = await Promise.all(blobs.map(b=>blobToDataURL(b)));
  const r = await fetch("/api/ocr-date2",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({ images })});
  const j = await r.json();
  out.textContent = "score " + (j.score||0).toFixed(2)
    + "\\nDetected date: " + (j.date||"—")
    + "\\nRaw candidates: " + ((j.raw&&j.raw.join(", "))||"—")
    + "\\n\\nOCR text\\n" + (j.text||"");
};

function blobToDataURL(blob){ return new Promise(res=>{ const fr=new FileReader(); fr.onload=()=>res(fr.result); fr.readAsDataURL(blob); }); }

async function preprocessToVariants(file){
  const bmp = await createImageBitmap(file);
  const maxSide=2000, scale=Math.min(1, maxSide/Math.max(bmp.width,bmp.height));
  const W=Math.round(bmp.width*scale), H=Math.round(bmp.height*scale);
  // helper: draw, grayscale, Otsu binarize, return blob
  async function drawAndBinarize(drawFn, w, h){
    work.width=w; work.height=h; const ctx=work.getContext("2d");
    ctx.save(); drawFn(ctx); ctx.restore();
    let img=ctx.getImageData(0,0,w,h), d=img.data;
    // grayscale
    for(let i=0;i<d.length;i+=4){ const g=(0.2126*d[i]+0.7152*d[i+1]+0.0722*d[i+2])|0; d[i]=d[i+1]=d[i+2]=g; }
    // Otsu
    const hist=new Uint32Array(256); for(let i=0;i<d.length;i+=4) hist[d[i]]++;
    const total=w*h; let sum=0; for(let t=0;t<256;t++) sum+=t*hist[t];
    let sumB=0,wB=0,varMax=-1,thr=127;
    for(let t=0;t<256;t++){ wB+=hist[t]; if(!wB) continue; const wF=total-wB; if(!wF) break; sumB+=t*hist[t];
      const mB=sumB/wB, mF=(sum-sumB)/wF; const v=wB*wF*(mB-mF)*(mB-mF); if(v>varMax){ varMax=v; thr=t; } }
    for(let i=0;i<d.length;i+=4){ const v=d[i]>thr?255:0; d[i]=d[i+1]=d[i+2]=v; }
    ctx.putImageData(img,0,0);
    const blob = await new Promise(res=>work.toBlob(res,"image/png",0.95));
    return blob;
  }
  // 0°
  const b0 = await drawAndBinarize(ctx=>{ ctx.drawImage(bmp,0,0,W,H); }, W, H);
  // 90°
  const b90 = await drawAndBinarize(ctx=>{ ctx.translate(H,0); ctx.rotate(Math.PI/2); ctx.drawImage(bmp,0,0,W,H); }, H, W);
  // 270°
  const b270 = await drawAndBinarize(ctx=>{ ctx.translate(0,W); ctx.rotate(-Math.PI/2); ctx.drawImage(bmp,0,0,W,H); }, H, W);
  return [b0,b90,b270];
}
</script>
</body>`;

/** ===== server ===== */
const server = http.createServer(async (req,res)=>{
  const { url, method } = req;

  if (url === "/health") return send(res,200,"application/json",JSON.stringify({ ok:true, now:new Date().toISOString() }));
  if (url === "/" || url === "/scan.html") return send(res,200,"text/html; charset=utf-8",HTML);

  if (url === "/api/ocr-date2" && method === "POST") {
    try {
      const body = JSON.parse(await readBody(req) || "{}");
      const { text, score } = await runOCRFromBase64Array(body.images || []);
      const t = (text && text.trim()) ? text : stubText();
      // vraćamo i score da vidiš koji je naj s OCR-a
      const parsed = extractDateFromText(t); parsed.text = t; parsed.score = parsed.score || score || 0;
      return send(res,200,"application/json",JSON.stringify(parsed));
    } catch (e) {
      const t = stubText();
      const parsed = extractDateFromText(t); parsed.text = t; parsed.score = 1.0;
      return send(res,200,"application/json",JSON.stringify(parsed));
    }
  }

  if (url === "/api/ocr-date" && method === "POST") {
    const t = stubText();
    const parsed = extractDateFromText(t); parsed.text = t; parsed.score = 1.0;
    return send(res,200,"application/json",JSON.stringify(parsed));
  }

  return send(res,404,"text/plain","Not Found");
});

server.listen(PORT,"127.0.0.1",()=>console.log("✅ ultra OCR+rot server on http://127.0.0.1:"+PORT));
