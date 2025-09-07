const express = require("express");
const app = express();

// posluži /public
app.use("/public", express.static(__dirname + "/public"));

// health ruta
app.get("/health", (req,res)=> res.status(200).send("ok"));

// jednostavna test stranica
app.get("/", (req,res)=> res.send("probe ok"));

// Render port
const PORT = process.env.PORT || 3035;
app.listen(PORT, ()=> console.log("probe up on", PORT));
