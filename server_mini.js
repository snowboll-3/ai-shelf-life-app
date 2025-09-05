"use strict";
const http = require("http");
const PORT = process.env.PORT || 3010;

const HTML=`<!doctype html><meta charset="utf-8"><title>Scan (mini)</title>
<body style="font-family:system-ui;margin:24px">
  <h1>AI Shelf-Life – Scan (mini)</h1>
  <input id="f" type="file" accept="image/*,.heic">
  <button id="go">Run OCR</button>
  <pre id="out" style="white-space:pre-wrap;border:1px solid #ddd;padding:12px;border-radius:8px;margin-top:12px">No result yet.</pre>
<script>
const f=document.getElementById("f"), btn=document.getElementById("go"), out=document.getElementById("out");
btn.onclick=async()=>{
  // samo pozivamo stub endpoint da dobijemo rezultat
  const r=await fetch("/api/ocr-date",{method:"POST"});
  const j=await r.json();
  out.textContent = "score " + (j.score||0).toFixed(2)
    + "\\nDetected date: " + (j.date||"—")
    + "\\nRaw candidates: " + ((j.raw&&j.raw.join(", "))||"—")
    + "\\n\\nOCR text\\n" + (j.text||"");
};
</script></body>`;

function send(res,code,type,body){ res.writeHead(code,{"Content-Type":type}); res.end(body); }

const server = http.createServer((req,res)=>{
  const {url,method} = req;
  if (url==="/health") return send(res,200,"application/json",JSON.stringify({ok:true, now:new Date().toISOString()}));
  if (url==="/" || url==="/scan.html") return send(res,200,"text/html; charset=utf-8",HTML);

  if ((url==="/api/ocr-date" || url==="/api/ocr-date2") && method==="POST"){
    // STUB — garantirani rezultat
    const text = "Best before 2025/11\nEXP 12NOV25\nLOT A12345";
    const json = {
      date: "2025-11-30",
      score: 1.0,
      pattern: "YYYY/MM → EOM",
      raw: ["2025/11", "EXP 12NOV25"],
      text
    };
    return send(res,200,"application/json",JSON.stringify(json));
  }

  return send(res,404,"text/plain","Not Found");
});

server.listen(PORT,"127.0.0.1",()=>console.log("mini server on http://127.0.0.1:"+PORT));
