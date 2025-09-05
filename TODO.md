# TODO (OCR i parser datuma)

- Server parser: prepoznati fraze (EXP, Use by, Best before, Najbolje upotrijebiti do, Upotrijebiti do, BBE, MHD…).
- Formati: DD.MM.YYYY, D/M/YY, YYYY-MM-DD, YYMMDD (GS1 AIs 15/17), 12 NOV 2025, “do kraja …”.
- Sanitizacija OCR teksta: zamjene O↔0, I↔1, S↔5; ukloniti LOT/serije.
- Logging: privremeno spremiti raw OCR tekst u server log radi debuga.
- HEIC/PDF: u browseru upozoriti i predložiti snimanje kao JPG/PNG/WebP.
- Tuning pre-procesa: adaptivni threshold + local binarization (ako bude potrebno).
