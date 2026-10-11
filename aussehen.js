// Aussehen (Skin) des Strichmännchens: im Menü wählbar, im Browser gespeichert.
// Online ist es das eigene Aussehen – das andere Gerät zeigt es auf seinem Strichmännchen (Nachricht "aussehen").
// Der Computer sieht jede Runde zufällig aus (zufallsAussehen).

const AUSSEHEN_STANDARD = {
  geschlecht: "mann",
  koerbchen: "C",
  oberteil: "keins",
  farbe: "#c0392b",
  frisur: "keine",
  haarfarbe: "#3b2414",
  kopf: "keine",
  hutfarbe: "#2c3e50",
  extra: "keins"
};

// Erlaubte Werte je Feld (auch zum Prüfen empfangener Daten)
const AUSSEHEN_WERTE = {
  geschlecht: ["mann", "frau"],
  koerbchen: ["A", "B", "C", "D", "DD"],
  oberteil: ["keins", "tshirt", "hoodie", "anzug", "tanktop"],
  frisur: ["keine", "kurz", "lang", "zopf", "irokese"],
  kopf: ["keine", "cap", "muetze", "krone", "partyhut"],
  extra: ["keins", "sonnenbrille", "kette", "fliege"]
};
const AUSSEHEN_FARBEN = ["farbe", "haarfarbe", "hutfarbe"];
const AUSSEHEN_SPEICHER = "maumau-aussehen";

// Macht aus beliebigen Daten (z. B. vom anderen Gerät) ein gültiges Aussehen
function aussehenPruefen(daten) {
  const ergebnis = { ...AUSSEHEN_STANDARD };
  if (!daten || typeof daten !== "object") return ergebnis;
  for (const [feld, werte] of Object.entries(AUSSEHEN_WERTE)) {
    if (werte.includes(daten[feld])) ergebnis[feld] = daten[feld];
  }
  for (const feld of AUSSEHEN_FARBEN) {
    if (typeof daten[feld] === "string" && /^#[0-9a-fA-F]{6}$/.test(daten[feld])) ergebnis[feld] = daten[feld];
  }
  return ergebnis;
}

function aussehenFeld(feld) {
  return document.getElementById("aussehen-" + feld);
}

function eigenesAussehen() {
  const daten = {};
  for (const feld of Object.keys(AUSSEHEN_STANDARD)) daten[feld] = aussehenFeld(feld).value;
  return aussehenPruefen(daten);
}

function aussehenInsMenue(aussehen) {
  for (const [feld, wert] of Object.entries(aussehen)) aussehenFeld(feld).value = wert;
  aussehenMenueAnpassen();
}

// Körbchengröße nur bei weiblicher Figur
function aussehenMenueAnpassen() {
  document.getElementById("aussehenKoerbchen").hidden = aussehenFeld("geschlecht").value !== "frau";
}

// Jede Änderung im Menü: speichern, als Vorschau auf das Strichmännchen, online ans andere Gerät
function aussehenGeaendert() {
  const aussehen = eigenesAussehen();
  aussehenMenueAnpassen();
  try {
    localStorage.setItem(AUSSEHEN_SPEICHER, JSON.stringify(aussehen));
  } catch (fehler) {
    // privates Fenster o. Ä.: dann eben nicht speichern
  }
  szeneAussehen(aussehen);
  aussehenSenden();
}

// Ein zufälliges Aussehen (für den 🎲-Knopf und für den Computer, der jede Runde anders aussieht)
function zufallsAussehen() {
  const zufaelligAus = liste => liste[Math.floor(Math.random() * liste.length)];
  const farbe = () => "#" + Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, "0");
  const haarfarben = ["#1b1b1b", "#3b2414", "#7a4a22", "#d9b66a", "#b5462a", "#e0e0e0", "#d94fa8", "#3a6fd8"];
  const aussehen = {};
  for (const [feld, werte] of Object.entries(AUSSEHEN_WERTE)) aussehen[feld] = zufaelligAus(werte);
  aussehen.farbe = farbe();
  aussehen.hutfarbe = farbe();
  aussehen.haarfarbe = zufaelligAus(haarfarben);
  return aussehenPruefen(aussehen);
}

function aussehenZufall() {
  aussehenInsMenue(zufallsAussehen());
  aussehenGeaendert();
}

function aussehenSenden() {
  if (typeof netz !== "undefined" && netz.verbunden) netzSenden({ typ: "aussehen", aussehen: eigenesAussehen() });
}

// Welches Aussehen trägt das Strichmännchen in der laufenden Runde?
function aussehenFuerFigur() {
  if (modus === "online") return (typeof netz !== "undefined" && netz.fernAussehen) || AUSSEHEN_STANDARD;
  return zufallsAussehen(); // der Computer sieht jede Runde anders aus
}

// Anprobe: Ist der Bereich "Aussehen" aufgeklappt, rutscht das Menü an den Rand und die Kamera fährt an die Figur
function aussehenAnprobe(an) {
  document.getElementById("menue").classList.toggle("anprobe", an);
  requestAnimationFrame(() => szeneVorschau(an));
}

function aussehenAnprobeBeenden() {
  const bereich = document.getElementById("aussehenBereich");
  if (bereich.open) bereich.open = false; // löst "toggle" aus
  document.getElementById("menue").classList.remove("anprobe");
  szeneVorschau(false);
}

// Beim Laden: gespeichertes Aussehen ins Menü
function aussehenLaden() {
  const bereich = document.getElementById("aussehenBereich");
  bereich.addEventListener("toggle", () => aussehenAnprobe(bereich.open));
  let gespeichert = null;
  try {
    gespeichert = JSON.parse(localStorage.getItem(AUSSEHEN_SPEICHER));
  } catch (fehler) {
    gespeichert = null;
  }
  aussehenInsMenue(aussehenPruefen(gespeichert));
}
