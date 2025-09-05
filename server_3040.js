"use strict";
const http = require("http");
const PORT = 3040;
function send(res,c,t,b){ res.writeHead(c,{"Content-Type":t}); res.end(b); }
const INDEX = `<!doctype html><meta charset="utf-8"><title>3040 OK</title>
<body style="font-family:system-ui;margin:24px">
<h1>🟢 Server 3040 radi</h1>
<p>Ovo je test index. <a href="/scan.html">Otvori /scan.html</a></p>
</body>`;
const SCAN = `<!doctype html><meta charset="utf-8"><title>Scan 3040</title>
<body style="font-family:system-ui;margin:24px">
<h1>Scan 3040</h1><p>Samo test da se može dohvatiti.</p>
</body>`;
const srv = http.createServer((req,res)=>{
  const u=(req.url||"").split("?")[0];
  if(u==="/health") return send(res,200,"application/json",JSON.stringify({ok:true,port:PORT,now:new Date().toISOString()}));
  if(u==="/scan.html") return send(res,200,"text/html; charset=utf-8",SCAN);
  if(u==="/"||u==="/index.html") return send(res,200,"text/html; charset=utf-8",INDEX);
  return send(res,404,"text/plain","Not Found");
});
srv.listen(PORT,"127.0.0.1",()=>console.log("✅ server on http://127.0.0.1:"+PORT));
