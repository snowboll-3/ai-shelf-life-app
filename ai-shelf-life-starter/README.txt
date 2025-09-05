AI Shelf-Life Starter (local)

1) Install Node.js (LTS). Then in this folder:
   npm install

2) Run (Windows PowerShell):
   $env:LIGHT_DEPLOY = "0"
   npm start

Open http://localhost:3000/scan.html

Notes:
- OCR is stubbed: server pretends the label contained "EXP 12NOV25" and "Best before 2025/11" so you can test end-to-end.
- When you integrate real OCR, replace runOCR(buffer) in server.js to return { text: "..." }.
