"use strict";
const http = require("http");
const PORT = 3020;

function send(res, code, type, body){ res.writeHead(code, {"Content-Type": type}); res.end(body); }

const INDEX = `<!doctype html>
<meta charset="utf-8"><title>It works</title>
<body style="font-family:system-ui;margin:24px">
  <h1>🟢 Lokalni server radi (3020)</h1>
  <p>Ovo je minimalna stranica — cilj je potvrditi da se <b>može dohvatiti</b>.</p>
  <p><a href="/scan.html">Otvori test stranicu</a></p>
</body>`;

const SCAN = `<!doctype html>
<meta charset="utf-8"><title>Scan test</title>
<body style="font-family:system-ui;margin:24px">
  <h1>Scan test</h1>
  <button id="btn">Ping API</button>
  <pre id="out" style="white-space:pre-wrap;border:1px solid #ddd;padding:10px;border-radius:8px;margin-top:12px">No result yet.</pre>
<script>
document.getElementById("btn").onclick = async () => {
  const r = await fetch("/api/ping"); const j = await r.json();
  document.getElementById("out").textContent = JSON.stringify(j, null, 2);
};
</script>
</body>`;

const server = http.createServer((req,res)=>{
  const {url, method} = req;
  if (url === "/health") return send(res,200,"application/json",JSON.stringify({ ok:true, port:PORT, now:new Date().toISOString() }));
  if (url === "/" || url === "/index.html") return send(res,200,"text/html; charset=utf-8", INDEX);
  if (url === "/scan.html") return send(res,200,"text/html; charset=utf-8", SCAN);
  if (url === "/api/ping" && method === "GET") return send(res,200,"application/json",JSON.stringify({ ok:true, msg:"pong" }));
  return send(res,404,"text/plain","Not Found");
});

server.listen(PORT,"127.0.0.1",()=>console.log("✅ simple server on http://127.0.0.1:"+PORT));
