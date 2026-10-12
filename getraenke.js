// Bar: Getränke (mit und ohne Alkohol) und Snacks zum Auswählen. Was man wählt, steht vor einem auf dem Tisch
// (szeneTischSachen in szene3d.js); anklicken = trinken bzw. naschen. Online sieht der Mitspieler die Auswahl
// (Nachricht "tisch"), gegen den Computer sucht er sich selbst etwas aus. Rein zur Optik, ohne Einfluss aufs Spiel.

const BAR_ANGEBOT = {
  alkohol: [
    { id: "bier", name: "Bier", zeichen: "🍺" },
    { id: "wein", name: "Rotwein", zeichen: "🍷" },
    { id: "whisky", name: "Whisky", zeichen: "🥃" },
    { id: "sekt", name: "Sekt", zeichen: "🥂" },
    { id: "cocktail", name: "Cocktail", zeichen: "🍹" },
    { id: "schnaps", name: "Schnaps", zeichen: "🍶" }
  ],
  ohne: [
    { id: "cola", name: "Cola", zeichen: "🥤" },
    { id: "wasser", name: "Wasser", zeichen: "💧" },
    { id: "osaft", name: "O-Saft", zeichen: "🧃" },
    { id: "eistee", name: "Eistee", zeichen: "🍋" },
    { id: "kaffee", name: "Kaffee", zeichen: "☕" }
  ],
  snacks: [
    { id: "chips", name: "Chips", zeichen: "🥔" },
    { id: "brezeln", name: "Brezeln", zeichen: "🥨" },
    { id: "popcorn", name: "Popcorn", zeichen: "🍿" },
    { id: "gummibaerchen", name: "Gummibärchen", zeichen: "🐻" },
    { id: "nachos", name: "Nachos", zeichen: "🌽" },
    { id: "schokolade", name: "Schokolade", zeichen: "🍫" }
  ]
};
const BAR_TITEL = { alkohol: "Mit Alkohol", ohne: "Ohne Alkohol", snacks: "Snacks" };
const BAR_SPEICHER = "maumau-bar";

let barWahl = { getraenk: null, snack: null };
let gegnerBarWahl = { getraenk: null, snack: null };

function barEintrag(id) {
  for (const liste of Object.values(BAR_ANGEBOT)) {
    const eintrag = liste.find(e => e.id === id);
    if (eintrag) return eintrag;
  }
  return null;
}

// Nur bekannte ids übernehmen (auch für Daten vom anderen Gerät)
function barWahlPruefen(daten) {
  const getraenke = [...BAR_ANGEBOT.alkohol, ...BAR_ANGEBOT.ohne].map(e => e.id);
  const snacks = BAR_ANGEBOT.snacks.map(e => e.id);
  return {
    getraenk: daten && getraenke.includes(daten.getraenk) ? daten.getraenk : null,
    snack: daten && snacks.includes(daten.snack) ? daten.snack : null
  };
}

function barOeffnen(bereich) {
  const fenster = document.getElementById("bar");
  if (document.getElementById("tisch").hidden) return;
  const inhalt = document.getElementById("barInhalt");
  inhalt.innerHTML = "";
  for (const [kategorie, liste] of Object.entries(BAR_ANGEBOT)) {
    const art = kategorie === "snacks" ? "snack" : "getraenk";
    const abschnitt = document.createElement("section");
    if (kategorie === bereich) abschnitt.className = "hervorgehoben";
    const titel = document.createElement("h3");
    titel.innerText = BAR_TITEL[kategorie];
    abschnitt.appendChild(titel);
    const raster = document.createElement("div");
    raster.className = "bar-raster";
    for (const eintrag of liste) {
      const knopf = document.createElement("button");
      knopf.type = "button";
      knopf.className = barWahl[art] === eintrag.id ? "gewaehlt" : "";
      knopf.innerHTML = `<span class="bar-zeichen">${eintrag.zeichen}</span>`;
      knopf.appendChild(document.createTextNode(eintrag.name));
      knopf.onclick = () => barWaehlen(art, eintrag.id);
      raster.appendChild(knopf);
    }
    abschnitt.appendChild(raster);
    inhalt.appendChild(abschnitt);
  }
  const leeren = document.createElement("div");
  leeren.className = "bar-leeren";
  for (const [art, text] of [["getraenk", "Kein Getränk"], ["snack", "Kein Snack"]]) {
    const knopf = document.createElement("button");
    knopf.type = "button";
    knopf.innerText = text;
    knopf.onclick = () => barWaehlen(art, null);
    leeren.appendChild(knopf);
  }
  inhalt.appendChild(leeren);
  const tipp = document.createElement("p");
  tipp.className = "bar-tipp";
  tipp.innerText = "Tipp: Glas/Schale antippen = trinken bzw. naschen · Snack lange drücken (Rechtsklick) = auf den Gegner werfen";
  inhalt.appendChild(tipp);
  fenster.hidden = false;
  const ziel = inhalt.querySelector(".hervorgehoben");
  if (ziel) ziel.scrollIntoView({ block: "nearest" });
  barStatusMelden(true); // online schaut das Strichmännchen beim Mitspieler zur Bar
}

function barSchliessen() {
  document.getElementById("bar").hidden = true;
  barStatusMelden(false);
}

function barUmschalten() {
  if (document.getElementById("bar").hidden) barOeffnen(null);
  else barSchliessen();
}

// Auswahl (auch dieselbe nochmal = frisch nachgefüllt) auf den Tisch, speichern, ans andere Gerät
function barWaehlen(art, id) {
  barWahl[art] = id;
  try {
    localStorage.setItem(BAR_SPEICHER, JSON.stringify(barWahl));
  } catch (fehler) {
    // ohne Speicher geht's auch
  }
  szeneTischSachen("eigen", barWahl);
  barSenden();
  barSchliessen();
  const eintrag = barEintrag(id);
  if (eintrag) meldung(art === "getraenk" ? `${eintrag.zeichen} Prost!` : `${eintrag.zeichen} Guten Appetit!`);
}

function barSenden() {
  if (typeof netz !== "undefined" && netz.verbunden) netzSenden({ typ: "tisch", wahl: barWahl });
}

// Neue Runde: eigene Sachen auf den Tisch; der Computer sucht sich zufällig etwas aus, online kommt es vom Mitspieler
function barRundenstart() {
  barSchliessen();
  if (modus === "online") {
    gegnerBarWahl = (typeof netz !== "undefined" && netz.fernTisch) || { getraenk: null, snack: null };
  } else {
    const zufaellig = liste => liste[Math.floor(Math.random() * liste.length)].id;
    gegnerBarWahl = { getraenk: zufaellig([...BAR_ANGEBOT.alkohol, ...BAR_ANGEBOT.ohne]), snack: zufaellig(BAR_ANGEBOT.snacks) };
  }
  szeneTischSachen("eigen", barWahl);
  szeneTischSachen("gegner", gegnerBarWahl);
}

// Online: Auswahl des Mitspielers angekommen
function barFernGewaehlt(daten) {
  netz.fernTisch = barWahlPruefen(daten);
  if (modus === "online" && !document.getElementById("tisch").hidden) {
    gegnerBarWahl = netz.fernTisch;
    szeneTischSachen("gegner", gegnerBarWahl);
  }
}

function barLaden() {
  try {
    barWahl = barWahlPruefen(JSON.parse(localStorage.getItem(BAR_SPEICHER)));
  } catch (fehler) {
    barWahl = { getraenk: null, snack: null };
  }
}
