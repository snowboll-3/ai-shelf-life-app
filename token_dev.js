"use strict";
const crypto=require("crypto");
const SECRET="mrcina_one_secret_abc"; // mora biti ista kao u serveru
const now = Math.floor(Date.now()/1000);
const payload = { sub:"mrcina", plan:"premium", iat:now, exp: now + 7*24*3600 };
const header = { alg:"HS256", typ:"JWT" };
function b64url(x){ return Buffer.from(x).toString("base64").replace(/=+$/,"").replace(/\+/g,"-").replace(/\//g,"_"); }
function sign(d,s){ return crypto.createHmac("sha256", s).update(d).digest("base64").replace(/=+$/,"").replace(/\+/g,"-").replace(/\//g,"_"); }
const h=b64url(JSON.stringify(header)), p=b64url(JSON.stringify(payload)), s=sign(h+"."+p, SECRET);
const jwt = h+"."+p+"."+s;
console.log(jwt);
