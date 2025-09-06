"use strict";
const http = require("http");
const https = require("https");
const url = require("url");
const crypto = require("crypto");

const PORT = 3035;
const UPSTREAM = "https://ai-shelf-life-app.onrender.com";
const SECRET = "mrcina_one_secret_abc"; // mora biti isto kao u token_dev.js

function sign(data, secret){return crypto.createHmac("sha256", secret).update(data).digest("base64").replace(/=+$/,"").replace(/\+/g,"-").replace(/\//g,"_");}
function verifyJwtHS256(token, secret){
  try{
    const [h,p,s] = token.split(".");
    if (!h||!p||!s) return {ok:false};
    const exp = sign(`${h}.${p}`, secret);
    if (exp !== s) return {ok:false};
    const payload = JSON.parse(Buffer.from(p.replace(/-/g,"+").replace(/_/g,"/"),"base64").toString("utf8"));
    if (payload.exp && Math.floor(Date.now()/1000) >= payload.exp) return {ok:false};
    return {ok:true, payload};
  }catch{ return {ok:false} }
}
function send(res,c,t,b){ res.writeHead(c,{"Content-Type":t,"Cache-Control":"no-store"}); res.end(b); }
function html(body){ return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><body style="font-family:system-ui;margin:16px">${body}</body>`; }

const upstream = new url.URL(UPSTREAM);
function proxy(req,res){
  const isHttps = upstream.protocol === "https:";
  const mod = isHttps ? https : http;
  const opt = { hostname: upstream.hostname, port: upstream.port || (isHttps?443:80), method:req.method, path:req.url, headers:{...req.headers, host:upstream.hostname} };
  const ps = mod.request(opt, pr=>{ res.writeHead(pr.statusCode||502, pr.headers); pr.pipe(res); });
  ps.on("error", e=>send(res,502,"text/plain","Upstream error: "+e.message));
  req.pipe(ps);
}

function premiumPage(lang){
  const t = (lang==="en")
    ? {
        title: "Premium – status",
        badge: "Premium active",
        now: "Now:",
        until: "Premium valid until:",
        left: "Remaining:",
        base: "/premium_status_en"
      }
    : {
        title: "Premium – status",
        badge: "Premium aktivan",
        now: "Sada:",
        until: "Premium vrijedi do:",
        left: "Preostalo:",
        base: "/premium_status"
      };

  return html(`
<style>
  :root { --ok:#16a34a; --warn:#f59e0b; --danger:#ef4444; --muted:#6b7280; }
  .badge {display:inline-flex;align-items:center;gap:8px;background:#ecfdf5;color:var(--ok);border:1px solid #86efac;
          padding:10px 14px;border-radius:999px;font-weight:600;}
  .dot{width:10px;height:10px;border-radius:50%;background:var(--ok);box-shadow:0 0 0 4px #dcfce7 inset}
  .card{border:1px solid #e5e7eb;border-radius:14px;padding:16px;margin:16px 0}
  .row{display:flex;gap:10px;margin:8px 0;align-items:center}
  .label{min-width:180px;color:var(--muted)}
  .value{font-weight:600}
  .bar{height:10px;border-radius:999px;background:#eef2f7;overflow:hidden;margin-top:8px;border:1px solid #e5e7eb}
  .fill{height:100%;width:100%;background:var(--ok);transition:width .4s}
  .warn{color:var(--warn)} .danger{color:var(--danger)}
</style>

<h1 style="margin-bottom:12px">${t.title}</h1>
<div class="badge"><span class="dot" id="dot"></span>${t.badge}</div>

<div class="card">
  <div class="row"><span class="label">${t.now}</span><span class="value" id="now"></span></div>
  <div class="row"><span class="label">${t.until}</span><span class="value" id="until"></span></div>
  <div class="row"><span class="label">${t.left}</span><span class="value" id="left"></span></div>
  <div class="bar"><div class="fill" id="fill"></div></div>
</div>

<script>
  const pad=n=>String(n).padStart(2,"0");
  const fmt=d=>pad(d.getDate())+"/"+pad(d.getMonth()+1)+"/"+d.getFullYear()+" "+pad(d.getHours())+":"+pad(d.getMinutes());
  const add1m=(dt)=>{ const d=new Date(dt.getTime()); const day=d.getDate(); d.setMonth(d.getMonth()+1); if(d.getDate()<day) d.setDate(0); return d; };
  const diff=(a,b)=>{ let ms=b-a; if(ms<0) return "0d 00:00"; const d=Math.floor(ms/86400000); ms-=d*86400000; const h=Math.floor(ms/3600000); ms-=h*3600000; const m=Math.floor(ms/60000); return d+"d "+pad(h)+":"+pad(m); };

  (function(){
    const usp=new URLSearchParams(location.search);
    const hasToken=usp.has("token");
    const now=new Date();
    let act=localStorage.getItem("premium_activation_at");
    let exp=localStorage.getItem("premium_expires_at");
    if (hasToken || !act || !exp){
      const ex=add1m(now);
      act=now.toISOString(); exp=ex.toISOString();
      localStorage.setItem("premium_activation_at", act);
      localStorage.setItem("premium_expires_at",  exp);
      try{history.replaceState({}, "", "${t.base}");}catch(e){}
    }
    const actDt=new Date(localStorage.getItem("premium_activation_at"));
    const expDt=new Date(localStorage.getItem("premium_expires_at"));

    const $=id=>document.getElementById(id);
    const dot=$("dot"), nowEl=$("now"), untilEl=$("until"), leftEl=$("left"), fill=$("fill");

    function render(){
      const cur=new Date();
      nowEl.textContent = fmt(cur);
      untilEl.textContent= fmt(expDt);
      leftEl.textContent = diff(cur,expDt);

      const total = expDt - actDt;
      const remaining = Math.max(0, expDt - cur);
      const pct = total>0 ? Math.round(remaining/total*100) : 0;
      fill.style.width = pct+"%";

      const day = 24*3600*1000;
      let cls = ""; let barColor = "var(--ok)";
      if (remaining < day) { cls = "danger"; barColor = "var(--danger)"; }
      else if (remaining < 3*day) { cls = "warn"; barColor = "var(--warn)"; }
      leftEl.className = "value " + cls;
      fill.style.background = barColor;
      dot.style.background = barColor;
    }
    render();
    setInterval(render, 60*1000);
  })();
</script>
  `);
}

const server = http.createServer((req,res)=>{
  const u = req.url.split("?")[0];

  if (u === "/health") {
    return send(res,200,"application/json",JSON.stringify({ok:true, mode:"premium-status-hr+en", port:PORT, now:new Date().toISOString()}));
  }

  function handlePremiumStatus(lang){
    const q = new url.URL(req.url,"http://x").searchParams;
    const auth = req.headers.authorization || "";
    const token = (auth.startsWith("Bearer ")?auth.slice(7):"") || q.get("token") || "";
    const v = verifyJwtHS256(token, SECRET);
    if (!v.ok) {
      const locked = (lang==="en")
        ? `<h1>🔒 Premium locked</h1><p>Token is invalid or expired.</p><p>Open: <code>${lang==="en"?"/premium_status_en":"/premium_status"}?token=&lt;YOUR_TOKEN&gt;</code></p>`
        : `<h1>🔒 Premium zaključan</h1><p>Token nije valjan ili je istekao.</p><p>Otvorite: <code>${lang==="en"?"/premium_status_en":"/premium_status"}?token=&lt;VAŠ_TOKEN&gt;</code></p>`;
      return send(res,401,"text/html; charset=utf-8", html(locked));
    }
    return send(res,200,"text/html; charset=utf-8", premiumPage(lang));
  }

  if (u === "/premium_status")    return handlePremiumStatus("hr");
  if (u === "/premium_status_en") return handlePremiumStatus("en");

  // ostalo proxy
  const isHttps = upstream.protocol === "https:";
  const mod = isHttps ? https : http;
  const opt = { hostname: upstream.hostname, port: upstream.port || (isHttps?443:80), method:req.method, path:req.url, headers:{...req.headers, host:upstream.hostname} };
  const ps = mod.request(opt, pr=>{ res.writeHead(pr.statusCode||502, pr.headers); pr.pipe(res); });
  ps.on("error", e=>send(res,502,"text/plain","Upstream error: "+e.message));
  req.pipe(ps);
});

server.listen(PORT,"127.0.0.1",()=>console.log("✅ Premium-status server (HR+EN) on http://127.0.0.1:"+PORT));
