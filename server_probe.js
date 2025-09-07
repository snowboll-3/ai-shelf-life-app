const express = require("express");
const app = express();
app.use("/public", express.static(__dirname + "/public"));
app.get("/health", (req,res)=>res.status(200).send("ok"));
app.get("/", (req,res)=>res.send("probe ok"));
const PORT = process.env.PORT || 3035;
app.listen(PORT, ()=> console.log("probe up on", PORT));
