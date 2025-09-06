/**
 * lib/ocr_mmm.js — MMM parser (HR/EN/FR) s čvršćim razdvajanjima
 * Fix: ne hvata "OZU 2025" (bez dana), podržava "7 Févr 24".
 */
function normalize(s){
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase();
}
const ALIAS = new Map();
const A = (arr, n) => arr.forEach(x => ALIAS.set(normalize(x), n));

// HR
A(['SIJ','SIJECANJ'],1);
A(['VEL','VELJACA','VELJ'],2);
A(['OZU','OZUJAK','OZUJ'],3);
A(['TRA','TRAVANJ'],4);
A(['SVI','SVIBANJ'],5);
A(['LIP','LIPANJ'],6);
A(['SRP','SRPANJ'],7);
A(['KOL','KOLOVOZ'],8);
A(['RUJ','RUJAN'],9);
A(['LIS','LISTOPAD'],10);
A(['STU','STUDENI'],11);
A(['PRO','PROSINAC'],12);

// EN
A(['JAN','JANUARY'],1); A(['FEB','FEBRUARY'],2); A(['MAR','MARCH'],3);
A(['APR','APRIL'],4); A(['MAY'],5); A(['JUN','JUNE'],6); A(['JUL','JULY'],7);
A(['AUG','AUGUST'],8); A(['SEP','SEPT','SEPTEMBER'],9); A(['OCT','OCTOBER'],10);
A(['NOV','NOVEMBER'],11); A(['DEC','DECEMBER'],12);

// FR (FÉVR → FEVR nakon normalize)
A(['JANV','JAN'],1); A(['FEVR','FEV','FÉVR'],2);
A(['MARS','MAR'],3); A(['AVR'],4); A(['MAI'],5);
A(['JUIN'],6); A(['JUIL'],7); A(['AOUT','AOÛT'],8);
A(['SEPT'],9); A(['OCT'],10); A(['NOV'],11); A(['DEC','DÉC'],12);

// Escape za regex
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const MONTH_TOKEN = Array.from(ALIAS.keys())
  .sort((a,b)=>b.length-a.length)
  .map(esc).join('|');

// mora postojati RAZMAK/TOCKA/CRTA između komponenti (nema spajanja brojeva)
const SEP = String.raw`[\s.,/\-]+`;

const P1 = new RegExp(String.raw`\b(?<d>\d{1,2})${SEP}(?<m>${MONTH_TOKEN})${SEP}(?<y>\d{2,4})\b`, 'g'); // D MMM Y
const P2 = new RegExp(String.raw`\b(?<m>${MONTH_TOKEN})${SEP}(?<d>\d{1,2})(?!\d)${SEP}(?<y>\d{2,4})\b`, 'g'); // MMM D Y

const toYear = y => { y = parseInt(y,10); return y < 100 ? 2000 + y : y; };

function parseAll(nd){
  const out = [];
  for (const rx of [P1, P2]){
    rx.lastIndex = 0; let m;
    while ((m = rx.exec(nd))){
      const d = parseInt(m.groups.d,10);
      const mon = ALIAS.get(m.groups.m);
      const y = toYear(m.groups.y);
      if (!mon || !(d>=1 && d<=31)) continue;
      out.push({ text: m[0], day: d, month: mon, year: y, iso: new Date(y, mon-1, d).toISOString() });
    }
  }
  return out;
}
function findAllDates(raw){ return parseAll(normalize(raw)); }
module.exports = { findAllDates, normalize };
