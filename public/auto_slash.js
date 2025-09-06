(function () {
  var el = document.getElementById("manual");
  if (!el) return;
  el.setAttribute("inputmode", "numeric");
  el.placeholder = "DD/MM/YYYY";

  el.addEventListener("input", function (e) {
    var raw = e.target.value;

    // Ako NE počinje brojkom (npr. "EXP 12NOV25"), ne diramo unos
    if (!/^\s*\d/.test(raw)) return;

    // Ako je korisnik zalijepio cijeli DD/MM/YYYY i datum je valjan → pusti
    var m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(raw);
    if (m) {
      var d=+m[1], mo=+m[2], y=+m[3];
      var dt=new Date(y,mo-1,d);
      if (dt.getFullYear()===y && dt.getMonth()===(mo-1) && dt.getDate()===d) return;
    }

    // Radimo iz digit-only, max 8 znamenki (DDMMYYYY)
    var dgt = raw.replace(/\D/g, "").slice(0, 8);
    var out = "";

    if (dgt.length === 0) {
      out = "";
    } else if (dgt.length === 1) {
      // "3" -> "03/"
      out = "0" + dgt[0] + "/";
    } else if (dgt.length === 2) {
      // "31" -> "31/"
      out = dgt.slice(0, 2) + "/";
    } else if (dgt.length === 3) {
      // "31 1" -> "31/01/"
      out = dgt.slice(0, 2) + "/0" + dgt[2] + "/";
    } else {
      // "31 12" -> "31/12/" ; godina tek kad je svih 8 znamenki
      out = dgt.slice(0, 2) + "/" + dgt.slice(2, 4) + "/";
      if (dgt.length === 8) out += dgt.slice(4, 8); // cijela godina odjednom
    }

    if (out !== raw) {
      e.target.value = out;
      var p = out.length;
      e.target.setSelectionRange(p, p);
    }
  });
})();
