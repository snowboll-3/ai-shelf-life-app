(function(){
  const $=id=>document.getElementById(id);

  // UI tekstovi
  document.title = 'AI Shelf-Life – Brzo skeniranje + Ručni unos';
  const h1 = document.querySelector('h1'); if (h1) h1.textContent = 'Brzo skeniranje + Ručni unos';
  const run = $('run');  if (run)  run.textContent  = 'Pokreni OCR';
  const save = $('save'); if (save) save.textContent = 'Spremi ručno';
  const out = $('out');  if (out && out.textContent.trim()==='Ready.') out.textContent='Spremno.';
  const manual = $('manual'); if (manual) manual.placeholder = 'DD/MM/YYYY';

  // Prevedeni ispis rezultata
  window.show = function(j,src){
    const lots=(j?.lots?.length)?`\nLOT: ${j.lots.join(', ')}`:'';
    const pat = j?.pattern ? ` (${j.pattern})` : '';
    const tag = (src||'').toString();
    const srcHr = tag.includes('manual')   ? 'ručni unos'
                 : tag.includes('fallback')? 'rezervni način'
                 : 'server (/api/ocr-date2)';
    out.textContent =
      `Izvor: ${srcHr}\n`+
      `Ocjena: ${Number(j?.score||0).toFixed(2)}${pat}\n`+
      `Prepoznati datum: ${j?.date||'—'}\n`+
      `Kandidati (raw): ${(j?.raw&&j.raw.join(', '))||'—'}${lots}\n\n`+
      `OCR tekst\n${j?.text||''}`;
  };

  console.log('✅ HR lokalizacija aktivna');
})();
