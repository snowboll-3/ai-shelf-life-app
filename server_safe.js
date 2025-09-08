"use strict";
const express = require("express");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 10000;

// body limit
app.use(express.json({ limit: "5mb" }));

// statics
app.use("/public", express.static(__dirname + "/public"));

// health
app.get("/health", (req,res)=> res.status(200).send("ok"));

// root (da Render odmah vidi odgovor)
app.get("/", (req,res)=> res.status(200).send("ok"));

app.listen(PORT, ()=> console.log("✅ Server on port", PORT));
