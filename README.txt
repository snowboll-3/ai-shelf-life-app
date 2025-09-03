# AI Shelf-Life App – Brzi vodič

## Pokretanje servera
- Aplikacija radi preko **PM2** (u pozadini).
- Provjeri status:
  pm2 status

## Najčešće PM2 komande
- pm2 status                → prikaže sve procese
- pm2 logs ai-shelf-life    → prikaz logova (izađi sa Ctrl+C)
- pm2 restart ai-shelf-life → restart aplikacije
- pm2 stop ai-shelf-life    → zaustavi aplikaciju
- pm2 delete ai-shelf-life  → ukloni iz PM2
- pm2 save                  → spremi trenutačne procese (za autostart)

## Autostart
PM2 je podešen da se automatski pokrene nakon restarta računala
i podigne ovu aplikaciju.

## API rute (za testiranje u browseru ili curl)
- http://localhost:3000/health        → health-check
- http://localhost:3000/version       → info o app, runtime, schema
- http://localhost:3000/tester        → web sučelje za validaciju
- http://localhost:3000/logs/valid    → pregled valjanih unosa
- http://localhost:3000/logs/invalid  → pregled nevaljanih unosa
- http://localhost:3000/logs/valid.csv
- http://localhost:3000/logs/invalid.csv

## Datoteke logova
- valid_results.jsonl   → spremanje valjanih zapisa
- invalid_results.jsonl → spremanje nevaljanih zapisa
