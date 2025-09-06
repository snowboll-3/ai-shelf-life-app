const jwt = require("jsonwebtoken");
const SECRET = process.env.SECRET || "mrcina_one_secret_abc";
const now = Math.floor(Date.now()/1000);
const token = jwt.sign({ sub:"dev", typ:"premium-activation", iat:now }, SECRET, { algorithm:"HS256" });
process.stdout.write(token);
