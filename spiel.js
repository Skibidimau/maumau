// Spielkonstanten
const farben = ["eichel", "gruen", "herz", "schell"];
const werte = ["7", "8", "9", "10", "bube", "dame", "koenig", "ass"];
const FARB_NAMEN = { eichel: "🌰 Eichel", gruen: "🍃 Grün", herz: "❤️ Herz", schell: "🔔 Schellen" };
const WERT_NAMEN = { bube: "Bube", dame: "Dame", koenig: "König", ass: "Ass" };

// "9 herz" → "❤️ Herz 9" (für Hinweise)
function kartenName(karte) {
  const [wert, farbe] = karte.split(" ");
  return `${FARB_NAMEN[farbe]} ${WERT_NAMEN[wert] || wert}`;
}

let stapel = [];
let deckAnzahl = 4;
let spieler1Hand = [];
let spieler2Hand = [];
let spieler1Decks = [];
let spieler2Decks = [];
let aktuellerSpieler = 1;
let ablagestapel = [];
let ablageWuensche = {}; // Position in der Ablage → gewünschte Farbe: der Bube dort zeigt sie dauerhaft

let ziehStapel = 0;
let extraZug = false;
let letzteFarbeNachAss = null;
let wunschFarbe = null;
let warteAufFarbwahl = false;
let warteAufAnzahlwahl = false;
let animationLaeuft = false; // sperrt Eingaben, solange Karten fliegen oder die Hand wechselt

// Spielart: "klassisch" = Teilhände der Reihe nach, "offizier" = Offiziers-Mau-Mau: Welche Teilhand man nach
// einer leeren Hand aufnimmt, entscheidet der Gegenspieler (teilhandOderSieg / teilstapelWahlStarten)
let spielart = "klassisch";
let warteAufTeilstapelwahl = false;
let teilstapelWahlAktiv = null; // Fortsetzung, solange der Mensch einen Teilstapel des Gegners auswählt
let teilstapelWahlNummer = 0; // verwirft eine Wahl aus einer inzwischen abgebrochenen Runde

// Modus: "pve" = Mensch (Spieler 1) gegen Computer (Spieler 2),
// "online" = jeder an seinem Gerät (eigene Nummer in netz.eigeneNummer, siehe netz.js)
let modus = "pve";
const COMPUTER = 2;
let spielVorbei = false;
let computerTimer = null;

function istComputer(spieler = aktuellerSpieler) {
  return modus === "pve" && spieler === COMPUTER;
}

// Online: Spieler am anderen Gerät (seine Züge kommen über die Verbindung)
function istFern(spieler = aktuellerSpieler) {
  return modus === "online" && spieler !== netz.eigeneNummer;
}

// Wessen Hand unten liegt: im PvE immer die des Menschen, online die eigene
function ansichtSpieler() {
  return modus === "online" ? netz.eigeneNummer : 1;
}

function handVon(spieler) {
  return spieler === 1 ? spieler1Hand : spieler2Hand;
}

function spielerName(spieler) {
  if (spieler === ansichtSpieler()) return "Du";
  return modus === "online" ? "Mitspieler" : "Computer";
}

// Satz passend zum Spieler: der Mensch am eigenen Gerät wird geduzt ("Du legst …"), sonst "Computer legt …"
function satz(duText, erText, spieler = aktuellerSpieler) {
  if (spieler === ansichtSpieler()) return `Du ${duText}`;
  return `${spielerName(spieler)} ${erText}`;
}

// Zufall fürs Mischen: online auf beiden Geräten derselbe Startwert, damit beide dieselben Karten haben
let zufall = Math.random;

function zufallMitStartwert(startwert) {
  // mulberry32 – kleiner, schneller Pseudozufall
  let a = startwert >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Eichel-Dame: +4 Karten pro Dame, stapelbar; Eichel-Könige entschärfen (gleiche Anzahl wie Damen im Stapel)
const EICHEL_DAME = "dame eichel";
const EICHEL_KOENIG = "koenig eichel";
let damenZiehen = 0;
let damenImStapel = 0;
let letzteDamenAnzahl = 0;
let letzteSiebenAnzahl = 0; // wie viele 7er zuletzt auf einmal gelegt wurden (Konter braucht mindestens so viele)

// Strafkarten für mehrere auf einmal gelegte Karten (Skibidi gibt einen Aufschlag):
// 7er: 2 pro Karte, ab 3 Stück einmal +1 (3 = 7, 4 = 9, 5 = 11)
// Eichel-Damen: 4 pro Karte, ab der 3. jede +2 extra (1 = 4, 2 = 8, 3 = 14, 4 = 20)
function siebenerStrafe(anzahl) {
  return 2 * anzahl + (anzahl >= 3 ? 1 : 0);
}

function damenStrafe(anzahl) {
  return 4 * anzahl + 2 * Math.max(0, anzahl - 2);
}

// Name eines Skibidis nach Anzahl gleicher Karten
const SKIBIDI_NAMEN = { 3: "SKIBIDI", 4: "Skibidi Quadrubili", 5: "Skibidi Pentribili", 6: "Skibidi Hexabili", 7: "Skibidi Heptabili", 8: "Skibidi Oktobili", 9: "Skibidi Nonabili", 10: "Skibidi Dezibili" };

function skibidiName(anzahl) {
  return SKIBIDI_NAMEN[anzahl] || "Skibidi Maximili";
}

function deckErstellen() {
  stapel = [];
  for (let d = 0; d < deckAnzahl; d++) {
    for (let farbe of farben) {
      for (let wert of werte) {
        stapel.push(`${wert} ${farbe}`);
      }
    }
  }
  mischen(stapel);
}

function mischen(karten) {
  for (let i = karten.length - 1; i > 0; i--) {
    const j = Math.floor(zufall() * (i + 1));
    [karten[i], karten[j]] = [karten[j], karten[i]];
  }
}


// Liest und prüft die Menü-Einstellungen; null bei ungültiger Eingabe (mit Hinweis)
function einstellungenLesen() {
  const decks = parseInt(document.getElementById("decks").value);
  if (isNaN(decks) || decks < 1 || decks > 200) {
    meldung("Bitte eine gültige Anzahl an Decks zwischen 1 und 200 eingeben!");
    return null;
  }

  const anzahl = parseInt(document.getElementById("anzahl").value);
  if (isNaN(anzahl) || anzahl < 1) {
    meldung("Erste Hand: bitte mindestens 1 Karte eingeben!");
    return null;
  }

  // Teilstapel: kommaseparierte Kartenzahlen, z. B. "8,3,2"; leer = keine; für beide Spieler gleich
  const teilstapel = teilstapelLesen("teilstapel");
  if (!teilstapel) {
    meldung("Teilstapel: bitte Kartenzahlen ab 1 mit Komma getrennt eingeben, z. B. 8,3,2");
    return null;
  }

  const benoetigt = (anzahl + teilstapel.reduce((a, b) => a + b, 0)) * 2 + 1; // +1 für die Startkarte
  if (benoetigt > decks * 32) {
    meldung(`Nicht genug Karten: benötigt ${benoetigt}, ${decks} Deck(s) haben ${decks * 32}. Mehr Decks wählen!`);
    return null;
  }

  return {
    decks,
    anzahl,
    teilstapel,
    modus: document.getElementById("modus").value,
    spielart: document.getElementById("spielart").value
  };
}

const SPIELART_HINWEISE = {
  klassisch: "Nach einer leeren Hand nimmt jeder seine Teilstapel der Reihe nach auf.",
  offizier: "Nach einer leeren Hand entscheidet der Gegenspieler, welchen deiner Teilstapel du aufnimmst. " +
    "Braucht mindestens 2 Teilstapel."
};

function spielartHinweisZeigen() {
  document.getElementById("spielartHinweis").innerText = SPIELART_HINWEISE[document.getElementById("spielart").value];
}

// Größe der eigenen Handkarten (Menü, je Gerät gespeichert) – Faktor für handLayout in szene3d.js
const KARTENGROESSE_FAKTOR = { klein: 0.82, mittel: 1, gross: 1.2 };
const KARTENGROESSE_SPEICHER = "maumau-kartengroesse";
let handGroesseFaktor = 1;

function kartengroesseLaden() {
  const auswahl = document.getElementById("kartengroesse");
  try {
    const gespeichert = localStorage.getItem(KARTENGROESSE_SPEICHER);
    if (KARTENGROESSE_FAKTOR[gespeichert]) auswahl.value = gespeichert;
  } catch (fehler) {
    // ohne Speicher eben „Mittel“
  }
  handGroesseFaktor = KARTENGROESSE_FAKTOR[auswahl.value] || 1;
}

function kartengroesseGeaendert() {
  const wert = document.getElementById("kartengroesse").value;
  handGroesseFaktor = KARTENGROESSE_FAKTOR[wert] || 1;
  try {
    localStorage.setItem(KARTENGROESSE_SPEICHER, wert);
  } catch (fehler) {
    // nicht speicherbar – gilt dann nur bis zum Neuladen
  }
  handLayout();
}

// Vollbild (Adressleiste weg): geht nur nach einem Tipp/Klick – deshalb beim Starten, Eröffnen, Beitreten und
// über den ⛶-Knopf. iPhones können das im Browser nicht; dort hilft "Zum Home-Bildschirm" (manifest.json).
function vollbildMoeglich() {
  const el = document.documentElement;
  return !!(el.requestFullscreen || el.webkitRequestFullscreen);
}

// immer = true: auch am PC (⛶-Knopf); sonst nur auf Touch-Geräten (Handy/Tablet)
function vollbildAnfordern(immer = false) {
  if (!vollbildMoeglich() || document.fullscreenElement || document.webkitFullscreenElement) return;
  if (!immer && !window.matchMedia("(pointer: coarse)").matches) return;
  const el = document.documentElement;
  try {
    const versuch = el.requestFullscreen ? el.requestFullscreen({ navigationUI: "hide" }) : el.webkitRequestFullscreen();
    if (versuch && versuch.catch) versuch.catch(() => {}); // abgelehnt: dann eben mit Adressleiste
  } catch (fehler) {
    // nicht unterstützt
  }
}

function vollbildUmschalten() {
  if (document.fullscreenElement || document.webkitFullscreenElement) {
    (document.exitFullscreen || document.webkitExitFullscreen).call(document);
  } else {
    vollbildAnfordern(true);
  }
}

// Spielanleitung aus dem Menü (Overlay #anleitung); Escape oder ✕ schließt
function anleitungZeigen() {
  const anleitung = document.getElementById("anleitung");
  anleitung.hidden = false;
  anleitung.querySelector(".anleitung-fenster").scrollTop = 0;
}

function anleitungSchliessen() {
  document.getElementById("anleitung").hidden = true;
}

document.addEventListener("keydown", ereignis => {
  if (ereignis.key === "Escape" && !document.getElementById("anleitung").hidden) anleitungSchliessen();
});

function rundeStarten() {
  vollbildAnfordern();
  const einstellungen = einstellungenLesen();
  if (!einstellungen) return;
  if (einstellungen.modus === "online") {
    onlineRundeStarten(einstellungen); // netz.js: schickt Einstellungen und Startwert an das andere Gerät
    return;
  }
  spielAufbauen(einstellungen, null);
}

// Baut eine neue Runde auf. startwert: online auf beiden Geräten gleich (gleiches Mischen), sonst null
function spielAufbauen({ decks, anzahl, teilstapel, modus: neuerModus, spielart: neueSpielart }, startwert) {
  zufall = startwert === null ? Math.random : zufallMitStartwert(startwert);
  deckAnzahl = decks;
  deckErstellen();

  modus = neuerModus;
  spielart = neueSpielart === "offizier" ? "offizier" : "klassisch";
  warteAufTeilstapelwahl = false;
  teilstapelWahlAktiv = null;
  teilstapelWahlNummer++;
  netz.teilstapelWartet = null;
  spielVorbei = false;
  clearTimeout(computerTimer);
  spieler1Hand = [];
  spieler2Hand = [];
  aktuellerSpieler = 1;
  ablagestapel = [];
  ablageWuensche = {};
  ziehStapel = 0;
  letzteSiebenAnzahl = 0;
  extraZug = false;
  letzteFarbeNachAss = null;
  wunschFarbe = null;
  warteAufFarbwahl = false;
  warteAufAnzahlwahl = false;
  damenZiehen = 0;
  damenImStapel = 0;
  letzteDamenAnzahl = 0;
  document.getElementById("farbwahl").innerHTML = "";

  for (let i = 0; i < anzahl; i++) {
    spieler1Hand.push(stapel.pop());
    spieler2Hand.push(stapel.pop());
  }

  spieler1Decks = teilstapel.map(groesse => stapel.splice(-groesse));
  spieler2Decks = teilstapel.map(groesse => stapel.splice(-groesse));

  // Startkarte darf kein Bube sein; übersprungene Buben kommen unter den Stapel
  let startkarte = stapel.pop();
  for (let versuche = stapel.length; startkarte.startsWith("bube") && versuche > 0; versuche--) {
    stapel.unshift(startkarte);
    startkarte = stapel.pop();
  }

  ablagestapel.push(startkarte);

  // Startkarte wirkt wie gelegt: 7 = 2 ziehen, Eichel-Dame = 4 ziehen (kontern/entschärfen wie sonst auch)
  if (startkarte.startsWith("7 ")) {
    ziehStapel = 2;
    letzteSiebenAnzahl = 1;
  }
  if (startkarte === EICHEL_DAME) {
    damenZiehen = 4;
    damenImStapel = 1;
    letzteDamenAnzahl = 1;
  }

  // Wer anfängt, klärt anfangAuslosen() am Ende (Farbe tippen, der Junge wirft Karten); bis dahin ist alles gesperrt
  warteAufAnfang = true;
  rundenKennung = startwert === null ? 0 : startwert;
  netzPostLeeren();

  // Tisch vor dem Rendern einblenden, sonst lässt sich die Fächerbreite nicht messen
  document.getElementById("menue").hidden = true;
  document.getElementById("tisch").hidden = false;
  animationLaeuft = false;
  // Reste der letzten Runde (Emote, hängender Kopf, Buttons) zurücksetzen
  szeneFigurZuruecksetzen();
  aussehenAnprobeBeenden();
  szeneAussehen(aussehenFuerFigur());
  barRundenstart();
  menueBestaetigungZuruecksetzen();
  document.getElementById("emotes").hidden = true;
  document.getElementById("sprechblase").hidden = true;
  document.getElementById("chatButton").hidden = modus !== "online";
  document.getElementById("chat").hidden = modus !== "online";
  document.getElementById("emoteButton").hidden = false;
  // ⛶ nur am Rechner – auf Handy/Tablet geht es beim Starten automatisch ins Vollbild
  document.getElementById("vollbildButton").hidden = !vollbildMoeglich() || window.matchMedia("(pointer: coarse)").matches;
  document.getElementById("emoteLeiste").hidden = true;
  anzeigenAktuelleHand();
  document.getElementById("ausgabe").innerText =
    (spielart === "offizier" ? "Offiziers-Mau-Mau! " : "") + `Runde gestartet. Jeder hat ${anzahl} Karten auf der Hand.`;
  anfangAuslosen();
}

// ---------- Wer fängt an? ----------
// Beide tippen auf eine Farbe. Dann wirft der Junge aus seinem Sitzsack Karten auf den Tisch, bis eine der getippten
// Farben kommt – wer zuerst richtig liegt, entscheidet, wer anfängt. Die Karten bestimmt zufall() (online auf beiden
// Geräten gleich, weil beide dieselben Tipps kennen). Online tippen beide gleichzeitig (Nachricht "tipp"; dieselbe
// Farbe = nochmal tippen), die Entscheidung kommt mit "anfang". Bis dahin ist alles gesperrt (warteAufAnfang).
let warteAufAnfang = false;
let anfangNummer = 0; // verwirft Reste einer inzwischen abgebrochenen oder neuen Runde
let rundenKennung = 0; // online: Startwert der Runde – Tipps und Entscheidung gelten nur für diese Runde

function anfangAuslosen() {
  const nummer = ++anfangNummer;
  warteAufAnfang = true;
  animationLaeuft = true;
  anfangTippen(nummer, 1);
}

function anfangAktuell(nummer) {
  return nummer === anfangNummer && !spielVorbei;
}

function anfangTippen(nummer, runde) {
  if (!anfangAktuell(nummer)) return;
  const ich = ansichtSpieler();
  const gegner = ich === 1 ? 2 : 1;
  document.getElementById("ausgabe").innerText = "Wer fängt an? Tipp, welche Farbe der Junge wirft!";
  zeigeTippwahl(farbe => {
    if (!anfangAktuell(nummer)) return;
    if (modus === "online") {
      netzSenden({ typ: "tipp", kennung: rundenKennung, runde, farbe });
      document.getElementById("ausgabe").innerText = `Du tippst auf ${FARB_NAMEN[farbe]} – warte auf deinen Mitspieler …`;
      figurDenkt(true);
      netzPostAbwarten(`tipp|${rundenKennung}|${runde}`, seine => {
        figurDenkt(false);
        anfangKartenWerfen(nummer, runde, { [ich]: farbe, [gegner]: seine });
      });
    } else {
      // Der Computer tippt danach auf eine andere Farbe
      const andere = farben.filter(f => f !== farbe);
      anfangKartenWerfen(nummer, runde, { [ich]: farbe, [gegner]: andere[Math.floor(Math.random() * andere.length)] });
    }
  });
}

function zeigeTippwahl(beiWahl) {
  const auswahl = document.getElementById("farbwahl");
  auswahl.className = "";
  auswahl.innerHTML = "<p>Wer fängt an? Tipp, welche Farbe der Junge wirft:</p>";
  farben.forEach(farbe => {
    const img = document.createElement("img");
    img.src = `images/ass_${farbe}.svg`;
    img.alt = farbe;
    img.className = "karte-bild";
    img.onclick = () => {
      auswahl.innerHTML = "";
      beiWahl(farbe);
    };
    auswahl.appendChild(img);
  });
}

// Der Junge wirft, bis eine der getippten Farben kommt
async function anfangKartenWerfen(nummer, runde, tipps) {
  if (!anfangAktuell(nummer)) return;
  const ich = ansichtSpieler();
  const gegner = ich === 1 ? 2 : 1;
  if (tipps[1] === tipps[2]) {
    meldung(`Beide auf ${FARB_NAMEN[tipps[1]]} – nochmal tippen!`);
    anfangTippen(nummer, runde + 1);
    return;
  }
  document.getElementById("ausgabe").innerText =
    `Du: ${FARB_NAMEN[tipps[ich]]} · ${spielerName(gegner)}: ${FARB_NAMEN[tipps[gegner]]}`;
  let gewinner = null;
  for (let wurf = 0; !gewinner; wurf++) {
    const karte = `${werte[Math.floor(zufall() * werte.length)]} ${farben[Math.floor(zufall() * farben.length)]}`;
    await szeneJungeWirftKarte(karte, wurf);
    if (!anfangAktuell(nummer)) return;
    const farbe = karte.split(" ")[1];
    gewinner = tipps[ich] === farbe ? ich : tipps[gegner] === farbe ? gegner : null;
    if (!gewinner) meldung(`${kartenName(karte)} – daneben!`);
    else meldung(`${kartenName(karte)} – ${gewinner === ich ? "du liegst richtig!" : `${spielerName(gegner)} liegt richtig!`}`);
  }
  await warte(600);
  anfangEntscheiden(nummer, gewinner);
}

// Wer richtig lag, entscheidet: der Mensch per Knopf, der Computer selbst (meist fängt er an), online kommt die
// Entscheidung vom anderen Gerät
function anfangEntscheiden(nummer, gewinner) {
  if (!anfangAktuell(nummer)) return;
  const ich = ansichtSpieler();
  const gegner = ich === 1 ? 2 : 1;
  const festlegen = anfaenger => anfangFestlegen(nummer, anfaenger);
  if (gewinner === ich) {
    zeigeAnfangWahl(festlegen);
  } else if (modus === "online") {
    document.getElementById("ausgabe").innerText = "Dein Mitspieler entscheidet, wer anfängt …";
    figurDenkt(true);
    netzPostAbwarten(`anfang|${rundenKennung}`, anfaenger => {
      figurDenkt(false);
      festlegen(anfaenger);
    });
  } else {
    document.getElementById("ausgabe").innerText = "Der Computer entscheidet, wer anfängt …";
    figurDenkt(true);
    setTimeout(() => {
      figurDenkt(false);
      festlegen(Math.random() < 0.75 ? gegner : ich);
    }, dauer(1100));
  }
}

function zeigeAnfangWahl(beiWahl) {
  const ich = ansichtSpieler();
  const gegner = ich === 1 ? 2 : 1;
  const auswahl = document.getElementById("farbwahl");
  auswahl.innerHTML = "";
  auswahl.className = "anfang-wahl";
  const frage = document.createElement("p");
  frage.innerText = "Du lagst richtig! Wer fängt an?";
  auswahl.appendChild(frage);
  const knopf = (text, spieler) => {
    const button = document.createElement("button");
    button.innerText = text;
    button.onclick = () => {
      auswahl.innerHTML = "";
      auswahl.className = "";
      if (modus === "online") netzSenden({ typ: "anfang", kennung: rundenKennung, spieler });
      beiWahl(spieler);
    };
    auswahl.appendChild(button);
  };
  knopf("Ich fange an", ich);
  knopf(modus === "online" ? "Mitspieler fängt an" : "Computer fängt an", gegner);
}

function anfangFestlegen(nummer, anfaenger) {
  if (!anfangAktuell(nummer)) return;
  aktuellerSpieler = anfaenger === 2 ? 2 : 1;
  warteAufAnfang = false;
  animationLaeuft = false;
  szeneAnfangKartenWeg();
  document.getElementById("ausgabe").innerText = satz("fängst an.", "fängt an.");
  meldung(satz("fängst an!", "fängt an!"));
  zugBeginnen();
}

// Abbrechen braucht einen zweiten Klick innerhalb von 3 Sekunden (native confirm()-Dialoge
// sind z. B. im eingebetteten Browser der Claude-App blockiert)
let menueBestaetigungTimer = null;

// Liest "8,3,2" als [8, 3, 2]; leeres Feld = []; ungültige Eingabe = null
function teilstapelLesen(feldId) {
  const text = document.getElementById(feldId).value.trim();
  if (text === "") return [];
  const zahlen = text.split(",").map(teil => Number(teil.trim()));
  return zahlen.every(n => Number.isInteger(n) && n >= 1) ? zahlen : null;
}

function zumMenue() {
  const button = document.getElementById("neuesSpielButton");
  if (spielVorbei) {
    // Runde ist vorbei: keine Rückfrage nötig
    menueBestaetigungZuruecksetzen();
    document.getElementById("tisch").hidden = true;
    document.getElementById("menue").hidden = false;
    onlineMenueAktualisieren();
    szeneAussehen(eigenesAussehen()); // Vorschau der eigenen Auswahl
    return;
  }
  if (!menueBestaetigungTimer) {
    button.innerText = "Wirklich abbrechen?";
    button.classList.add("warnung");
    menueBestaetigungTimer = setTimeout(menueBestaetigungZuruecksetzen, 3000);
    return;
  }
  menueBestaetigungZuruecksetzen();
  spielVorbei = true; // stoppt einen geplanten Computerzug
  clearTimeout(computerTimer);
  document.getElementById("tisch").hidden = true;
  document.getElementById("menue").hidden = false;
  onlineMenueAktualisieren();
  szeneAussehen(eigenesAussehen());
}

function menueBestaetigungZuruecksetzen() {
  clearTimeout(menueBestaetigungTimer);
  menueBestaetigungTimer = null;
  const button = document.getElementById("neuesSpielButton");
  button.innerText = "Neues Spiel";
  button.classList.remove("warnung");
}

// Zeile an die Ausgabe unten anhängen (Zeilenumbruch nur, wenn schon etwas dasteht)
function ausgabeAnhaengen(text) {
  const ausgabe = document.getElementById("ausgabe");
  ausgabe.innerText = ausgabe.innerText ? ausgabe.innerText + "\n" + text : text;
}

// Kurze Einblendung statt alert() – native Dialoge sind nicht überall verfügbar
let meldungTimer = null;

function meldung(text) {
  const div = document.getElementById("meldung");
  div.innerText = text;
  div.hidden = false;
  div.classList.remove("sichtbar");
  void div.offsetWidth; // Einblend-Animation neu starten
  div.classList.add("sichtbar");
  clearTimeout(meldungTimer);
  meldungTimer = setTimeout(() => {
    div.classList.remove("sichtbar");
  }, 2600);
}

// Darstellung: Beschriftungen im HTML, Karten, Stapel und Hände in der 3D-Szene (szene3d.js)
function anzeigenAktuelleHand() {
  const unten = ansichtSpieler();
  const gegner = unten === 1 ? 2 : 1;
  const hand = handVon(unten);
  const gegnerHand = handVon(gegner);
  const eigeneDecks = unten === 1 ? spieler1Decks : spieler2Decks;
  const gegnerDecks = gegner === 1 ? spieler1Decks : spieler2Decks;
  const amZug = aktuellerSpieler === unten && !warteAufAnfang;
  sortiereHand(hand);

  szeneHandZeigen(hand, amZug);
  szeneGegnerHandZeigen(gegnerHand.length);
  szeneTeilstapelZeigen(eigeneDecks, gegnerDecks);

  document.getElementById("gegnerInfo").innerText = `${spielerName(gegner)} · ${gegnerHand.length} Karte(n)`;
  document.getElementById("spielerAnzeige").innerText = warteAufAnfang
    ? "Wer fängt an?"
    : amZug ? "Du bist dran" : `${spielerName(gegner)} ist am Zug …`;

  // Grundausdruck des Strichmännchens (= Spieler gegenüber) je nach Lage
  if (!spielVorbei) {
    const fastFertig = (karten, decks) => karten.length <= 1 && decks.length === 0;
    if (fastFertig(gegnerHand, gegnerDecks)) szeneGrundausdruck("frech");
    else if (fastFertig(hand, eigeneDecks)) szeneGrundausdruck("besorgt");
    else szeneGrundausdruck("neutral");
  }

  updateAblage();
}

// Darf der Mensch gerade eine Karte seiner Hand anklicken? (für Hover und Klick in der 3D-Szene)
function handKlickbar() {
  return (
    !spielVorbei &&
    !document.getElementById("tisch").hidden &&
    aktuellerSpieler === ansichtSpieler() &&
    !warteAufFarbwahl && !warteAufAnzahlwahl && !warteAufTeilstapelwahl && !animationLaeuft
  );
}

// Offiziers-Mau-Mau: Darf man gerade einen Teilstapel des Gegners anklicken (er muss ihn aufnehmen)?
function teilstapelWaehlbar() {
  return !!teilstapelWahlAktiv && !spielVorbei;
}

function teilstapelGeklickt(index) {
  if (teilstapelWaehlbar()) teilstapelWahlAktiv(index);
}

// Darf das Gegenüber von selbst trinken/naschen? Nur gegen den Computer und während man selbst am Zug ist (dann
// zieht er garantiert nicht). Online trinkt und nascht es nur, wenn der Mitspieler es wirklich tut (szeneFernAktion).
function figurDarfNaschen() {
  return (
    modus === "pve" &&
    !spielVorbei &&
    !document.getElementById("tisch").hidden &&
    aktuellerSpieler === ansichtSpieler() &&
    !animationLaeuft && !warteAufTeilstapelwahl
  );
}

function handKarteGeklickt(index) {
  if (handKlickbar()) versucheKarteAuszuspielen(index);
}

// ---------- Gesicht des Strichmännchens (= Spieler gegenüber) reagiert auf das Spiel ----------

// vonFigur: Die Figur hat gelegt (sonst der Spieler unten)
function gesichtZumLegen(vonFigur, karte, anzahl, warWunsch, warDamenStrafe) {
  const [wert] = karte.split(" ");
  const strafe = wert === "7" || karte === EICHEL_DAME;
  const figurNr = ansichtSpieler() === 1 ? 2 : 1;
  const fastFertig = spieler => handVon(spieler).length === 1 && (spieler === 1 ? spieler1Decks : spieler2Decks).length === 0;
  if (vonFigur) {
    if (anzahl >= 3) szeneAusdruck("jubel");
    else if (karte === EICHEL_KOENIG && warDamenStrafe) szeneAusdruck("frech"); // entschärft
    else if (strafe) szeneAusdruck("frech");
    if (fastFertig(figurNr)) figurSagt("mau");
    else if (anzahl >= 3) figurSagt("skibidi");
    else if (strafe) figurSagt("angriff", 0.5);
  } else {
    if (anzahl >= 3 || strafe) szeneAusdruck("schock");
    else if (karte === EICHEL_KOENIG && warDamenStrafe) szeneAusdruck("wuetend"); // seine Damen entschärft
    else if (wert === "10" && warWunsch) szeneAusdruck("wuetend"); // seinen Wunsch aufgehoben
    if (karte === EICHEL_KOENIG && warDamenStrafe) figurSagt("entschaerft");
    else if (fastFertig(ansichtSpieler())) figurSagt("panik");
  }
}

// gezogen von der Figur (nachOben) oder vom Spieler unten; anzahl = gezogene Karten
function gesichtZumZiehen(vonFigur, anzahl) {
  if (vonFigur) szeneAusdruck(anzahl >= 4 ? "wuetend" : anzahl >= 2 ? "schock" : "genervt");
  else if (anzahl >= 2) szeneAusdruck("lachen"); // lacht dich aus
  if (vonFigur && anzahl >= 4) figurSagt("strafe", 0.7);
}

// ---------- Sprüche des Gegenübers (Sprechblase neben dem Kopf, rein zur Unterhaltung) ----------

const SPRUECHE = {
  angriff: ["Viel Spaß beim Ziehen! 😏", "Nimm das!", "Ups … war das etwa meine?", "Zieh, Baby, zieh!"],
  skibidi: ["SKIBIDI, Baby! 🔥", "Hast du das gesehen?!", "Das nennt man Klasse.", "Und tschüss!"],
  strafe: ["Das wirst du bereuen …", "Ernsthaft?!", "Na warte!", "Okay. Jetzt ist es persönlich."],
  mau: ["Mau! 😎", "Nur noch eine …", "Spürst du den Druck?", "Gleich ist es vorbei."],
  panik: ["Oh oh …", "Nicht so schnell!", "Das schaffst du eh nicht.", "Moment mal!"],
  entschaerft: ["Nein! Meine Damen! 😱", "Das war gemein.", "Woher hast du die Könige?!"],
  getroffen: ["Hey! 😠", "Spinnst du?!", "Na warte …", "Das gibt Rache!"],
  retour: ["Retour! 😏", "Fang!", "Selber! 😜"],
  gefangen: ["Mampf! 😋", "Lecker!", "Danke! 😋", "Mehr davon!", "Hab ihn! 😎"]
};

// Snack auf das Gegenüber werfen (Rechtsklick bzw. lange drücken auf die eigene Schale). Online sieht es der
// Mitspieler auf sich zufliegen; der Computer ärgert sich und wirft manchmal zurück. In der Hälfte der Fälle
// schnappt das Gegenüber den Happen mit dem Mund (online geht das Ergebnis mit, damit beide dasselbe sehen).
let letzterWurf = 0;

function snackWerfen() {
  if (document.getElementById("tisch").hidden || Date.now() - letzterWurf < 700) return;
  const gefangen = Math.random() < 0.5;
  const ergebnis = szeneSnackWerfen(gefangen);
  if (ergebnis === "kein") {
    meldung("Kein Snack da – hol dir einen an der Bar 🍹");
    return;
  }
  if (ergebnis === "leer") {
    meldung("Deine Schale ist leer!");
    return;
  }
  letzterWurf = Date.now();
  if (modus === "online") {
    netzSenden({ typ: "wurf", snack: barWahl.snack, gefangen });
    return;
  }
  if (gefangen) {
    setTimeout(() => {
      letzterSpruch = 0;
      figurSagt("gefangen");
    }, dauer(1000));
    return;
  }
  if (gegnerBarWahl.snack && Math.random() < 0.5) {
    setTimeout(() => {
      szeneWurfAufMich(gegnerBarWahl.snack);
      letzterSpruch = 0;
      figurSagt("retour");
    }, dauer(1300));
  } else {
    setTimeout(() => {
      letzterSpruch = 0;
      figurSagt("getroffen");
    }, dauer(700));
  }
}
let letzterSpruch = 0;
let letzterSpruchText = "";
let spruchTimer = null;

// situation: Schlüssel in SPRUECHE; chance: Wahrscheinlichkeit, dass er überhaupt etwas sagt
function figurSagt(situation, chance = 1) {
  const liste = SPRUECHE[situation];
  if (!liste || spielVorbei || Math.random() > chance || Date.now() - letzterSpruch < 4000) return;
  const auswahl = liste.filter(t => t !== letzterSpruchText);
  const text = auswahl[Math.floor(Math.random() * auswahl.length)];
  letzterSpruch = Date.now();
  letzterSpruchText = text;
  const blase = document.getElementById("sprechblase");
  blase.innerText = text;
  blase.hidden = false;
  clearTimeout(spruchTimer);
  spruchTimer = setTimeout(() => (blase.hidden = true), 2600);
}

// Großer Skibidi-Schriftzug (Name je nach Anzahl), der aufploppt und wieder verschwindet (Konfetti kommt aus der Szene)
function skibidiEinblenden(anzahl = 3) {
  const schrift = document.getElementById("skibidi");
  schrift.innerText = skibidiName(anzahl) + "!";
  if (!dauer(1)) return;
  schrift.hidden = false;
  schrift.animate(
    [
      { transform: "translate(-50%, -50%) scale(0.2) rotate(-12deg)", opacity: 0 },
      { transform: "translate(-50%, -50%) scale(1.25) rotate(4deg)", opacity: 1, offset: 0.25 },
      { transform: "translate(-50%, -50%) scale(1) rotate(-3deg)", opacity: 1, offset: 0.4 },
      { transform: "translate(-50%, -50%) scale(1.05) rotate(2deg)", opacity: 1, offset: 0.75 },
      { transform: "translate(-50%, -50%) scale(1.6) rotate(0deg)", opacity: 0 }
    ],
    { duration: 1700, easing: "ease-out" }
  ).finished.then(() => {
    schrift.hidden = true;
  });
}

const wenigerBewegung = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function dauer(ms) {
  return wenigerBewegung ? 0 : ms;
}

function warte(ms) {
  return new Promise(fertig => setTimeout(fertig, dauer(ms)));
}

function sortiereHand(hand) {
  hand.sort((a, b) => {
    const [wertA, farbeA] = a.split(" ");
    const [wertB, farbeB] = b.split(" ");
    const farbeIndexA = farben.indexOf(farbeA);
    const farbeIndexB = farben.indexOf(farbeB);
    const wertIndexA = werte.indexOf(wertA);
    const wertIndexB = werte.indexOf(wertB);
    return farbeIndexA !== farbeIndexB ? farbeIndexA - farbeIndexB : wertIndexA - wertIndexB;
  });
}

// Feste, aus der Position abgeleitete Lage einer Karte auf der Ablage (wirkt hingeworfen, springt aber nicht)
function ablageLage(position) {
  return {
    drehung: ((position * 37) % 23) - 11,
    x: ((position * 53) % 9) - 4,
    y: ((position * 29) % 7) - 3
  };
}

// verdeckt: so viele oberste Karten noch nicht zeigen (sie sind gerade im Flug)
function updateAblage(verdeckt = 0) {
  szeneAblageZeigen(ablagestapel, verdeckt, wunschFarbe, ablageWuensche);
  szeneZiehstapelZeigen(stapel.length);

  const infoDiv = document.getElementById("ablageInfo");
  infoDiv.innerHTML = "";
  // Nur noch kurze Schilder für Wunsch und Ass – Strafen (7, Eichel-Dame) und die oberste Karte sieht man am Tisch
  const hinweise = [];
  if (wunschFarbe) hinweise.push(`Wunsch: ${FARB_NAMEN[wunschFarbe]}`);
  if (extraZug && letzteFarbeNachAss) hinweise.push(`Ass: nochmal legen (${FARB_NAMEN[letzteFarbeNachAss]}, Bube oder Ass)`);
  hinweise.forEach(text => {
    const span = document.createElement("span");
    span.className = "schild";
    span.innerText = text;
    infoDiv.appendChild(span);
  });
}


// Wie viele gleiche Karten man mindestens auf einmal legen muss, um eine 7er- bzw. Damen-Strafe zu kontern:
// immer mindestens so viele, wie zuletzt auf einmal gelegt wurden (auf zwei 7er nur mit zwei gleichen 7ern usw.)
function konterMinimum(zuletztGelegt) {
  return Math.max(1, zuletztGelegt);
}

// Erlaubte Anzahlen gleicher Karten auf einmal (gleicher Wert UND gleiche Farbe): 7er und Eichel-Damen ab 2, alle
// anderen Karten erst ab 3 (Skibidi) – also 1 oder 3, 4, … aber nie genau 2
function erlaubteAnzahlen(karte, minimum, gleiche) {
  const anzahlen = [];
  const abZwei = karte.startsWith("7 ") || karte === EICHEL_DAME;
  for (let n = minimum; n <= gleiche; n++) if (n === 1 || abZwei || n >= 3) anzahlen.push(n);
  return anzahlen;
}

// Prüft ohne Nebenwirkungen, ob eine Karte gelegt werden darf (auch für die Computer-Zugwahl) und wie viele
// gleiche Karten man dabei auf einmal legen darf (anzahlen, aufsteigend; maximum = die größte davon).
// Mehrere gleiche gehen immer, wenn die Karte erlaubt ist – auch bei Wunsch, Ass-Extrazug oder Strafe. Nur die
// Eichel-Könige zum Entschärfen haben eine feste Anzahl.
function zugPruefen(karte, hand) {
  const [wert, farbe] = karte.split(" ");
  const [oWert, oFarbe] = ablagestapel[ablagestapel.length - 1].split(" ");
  const istEichelDame = karte === EICHEL_DAME;
  const istEichelKoenig = karte === EICHEL_KOENIG;
  const gleiche = hand.filter(k => k === karte).length;

  let darfLegen;
  let minimum = 1;
  let festeAnzahl = null;
  if (damenZiehen > 0) {
    // Damen nachlegen (mindestens so viele wie zuletzt gelegt) oder mit genau so vielen Königen entschärfen, wie
    // Damen im Stapel liegen – ganz oder gar nicht
    if (istEichelDame) minimum = konterMinimum(letzteDamenAnzahl);
    if (istEichelKoenig) minimum = festeAnzahl = damenImStapel;
    darfLegen = (istEichelDame || istEichelKoenig) && gleiche >= minimum;
  } else if (ziehStapel > 0) {
    // 7 auf 7 – mit mindestens so vielen gleichen 7ern, wie zuletzt gelegt wurden
    minimum = konterMinimum(letzteSiebenAnzahl);
    darfLegen = wert === "7" && gleiche >= minimum;
  } else if (extraZug) {
    darfLegen = farbe === letzteFarbeNachAss || wert === "bube" || wert === "ass";
  } else if (wunschFarbe) {
    darfLegen = wert === "10" || wert === "bube" || farbe === wunschFarbe;
  } else {
    darfLegen = wert === oWert || farbe === oFarbe || wert === "bube";
  }

  // Kein Bube auf Bube
  if (wert === "bube" && oWert === "bube") darfLegen = false;

  const anzahlen = festeAnzahl ? [festeAnzahl] : erlaubteAnzahlen(karte, minimum, gleiche);
  return { erlaubt: darfLegen, minimum, maximum: anzahlen[anzahlen.length - 1] || 1, anzahlen, gleiche };
}

// Zustandsänderungen, die schon beim Ausspielen greifen (vor dem eigentlichen Legen)
function zugNebenwirkungen(karte) {
  const [wert, farbe] = karte.split(" ");
  if (damenZiehen > 0 || ziehStapel > 0) return;
  if (extraZug) {
    // Ass-Extrazug ist mit einer Karte der Ass-Farbe bedient
    if (farbe === letzteFarbeNachAss && wert !== "ass") {
      extraZug = false;
      letzteFarbeNachAss = null;
    }
  } else if (wunschFarbe && wert === "10") {
    wunschFarbe = null; // eine 10 hebt jeden Wunsch auf
  }
}

function versucheKarteAuszuspielen(index) {
  spieleKarte(handVon(aktuellerSpieler)[index]);
}

// Gemeinsamer Einstieg für Klick, Computer und Züge vom anderen Gerät. Hat man mehrere gleiche Karten, wählt der
// Mensch die Anzahl (waehleAnzahl), der Computer legt alle; anzahlVorgabe = Anzahl vom anderen Gerät.
function spieleKarte(karte, anzahlVorgabe = null) {
  const hand = handVon(aktuellerSpieler);
  const oFarbe = ablagestapel[ablagestapel.length - 1].split(" ")[1];
  const { erlaubt, minimum, maximum, anzahlen, gleiche } = zugPruefen(karte, hand);

  if (!erlaubt) {
    const [wert] = karte.split(" ");
    if (damenZiehen > 0 && karte === EICHEL_KOENIG) {
      meldung(`Zum Entschärfen brauchst du ${damenImStapel} Eichel-König(e) auf einmal!`);
    } else if (damenZiehen > 0 && karte === EICHEL_DAME) {
      meldung(`Kontern nur mit mindestens ${minimum} Eichel-Damen auf einmal!`);
    } else if (damenZiehen === 0 && ziehStapel > 0 && wert === "7" && gleiche < minimum) {
      meldung(`Kontern nur mit mindestens ${minimum} gleichen 7ern (gleiche Farbe) auf einmal!`);
    } else {
      meldung("Diese Karte darf nicht gelegt werden!");
    }
    return;
  }

  const legen = anzahl => {
    zugNebenwirkungen(karte);
    karteLegen(hand, karte, anzahl, oFarbe);
  };
  if (anzahlVorgabe) {
    // vom anderen Gerät: dieselbe Rechnung dort – zur Sicherheit auf eine erlaubte Anzahl bringen
    legen(anzahlen.includes(anzahlVorgabe) ? anzahlVorgabe : anzahlen.filter(n => n <= anzahlVorgabe).pop() || minimum);
  } else if (istComputer()) legen(maximum);
  else waehleAnzahl(anzahlen, legen);
}

async function karteLegen(hand, karte, anzahl, oFarbe) {
  const [wert, farbe] = karte.split(" ");
  // Nie mehr legen, als man von genau dieser Karte hat – sonst rutschte eine andere Karte mit (indexOf = −1)
  anzahl = Math.max(1, Math.min(anzahl, hand.filter(k => k === karte).length));

  // Wo die gelegten Karten sitzen, merken, bevor die Hände neu gezeichnet werden.
  // Spielt der Gegner oben (Computer), kommen sie verdeckt aus seinem Fächer.
  const vonOben = aktuellerSpieler !== ansichtSpieler();
  const startLagen = szeneStartLagen(karte, anzahl, vonOben);
  const erstePosition = ablagestapel.length;
  const warWunsch = wunschFarbe; // für die Reaktion des Gesichts (10 hebt seinen Wunsch auf)
  const warDamenStrafe = damenZiehen > 0;

  // Online: eigenen Zug ans andere Gerät schicken (dort läuft dieselbe Logik mit denselben Karten)
  if (modus === "online" && aktuellerSpieler === netz.eigeneNummer) netzSenden({ typ: "legen", karte, anzahl });

  for (let n = 0; n < anzahl; n++) {
    ablagestapel.push(hand.splice(hand.indexOf(karte), 1)[0]);
  }

  // Karten fliegen aus der Hand auf die Ablage, erst danach wirkt die Karte
  animationLaeuft = true;
  anzeigenAktuelleHand();
  updateAblage(anzahl);
  // Der Gegner gegenüber greift zur Ablage, während seine Karte fliegt
  const greifen = vonOben ? figurGreift("ablage") : Promise.resolve();
  const skibidi = anzahl >= 3;
  if (skibidi) skibidiEinblenden(anzahl);
  await szeneLegeAnimation(karte, startLagen, erstePosition, ablagestapel.length, skibidi);
  await greifen;
  // Jede gelegte Karte außer einem Buben erfüllt einen offenen Wunsch (bzw. hebt ihn mit der 10 auf)
  if (wert !== "bube") wunschFarbe = null;
  gesichtZumLegen(vonOben, karte, anzahl, warWunsch, warDamenStrafe);
  updateAblage();
  animationLaeuft = false;

  // Was gelegt wurde, sieht man auf dem Tisch – keine Textmeldung mehr dazu
  const ausgabe = document.getElementById("ausgabe");
  ausgabe.innerText = "";

  // Entschärfen vor der Leere-Hand-Prüfung, damit die Strafe auch beim letzten König verfällt
  if (karte === EICHEL_KOENIG && damenZiehen > 0) {
    damenZiehen = 0;
    damenImStapel = 0;
    letzteDamenAnzahl = 0;
    wunschFarbe = null;
    ausgabeAnhaengen(satz("entschärfst die Eichel-Damen.", "entschärft die Eichel-Damen."));
  }

  // Letzte Karte gelegt: nächste Teilhand aufnehmen, danach ist der Gegner dran.
  // 7, Eichel-Dame und Ass eröffnen einen Prozess, der erst abgeschlossen sein muss:
  // - 7/Eichel-Dame: aufgenommen wird erst, wenn klar ist, wer zieht (leere Hand in naechsterSpieler)
  // - Ass: der Spieler müsste nochmal legen, hat aber keine Karte mehr -> er muss ziehen
  const oeffnetProzess = wert === "7" || wert === "ass" || karte === EICHEL_DAME;
  if (hand.length === 0 && !oeffnetProzess) {
    if (teilstapelVon(aktuellerSpieler).length === 0) {
      teilhandOderSieg(); // keine Teilhand mehr: gewonnen
      return;
    }
    extraZug = false;
    letzteFarbeNachAss = null;
    if (wert === "bube") {
      // Der Wunsch muss feststehen, bevor die nächste Teilhand aufgedeckt wird
      warteAufFarbwahl = true;
      anzeigenAktuelleHand();
      farbwahlStarten(() => teilhandOderSieg(naechsterSpieler));
      return;
    }
    wunschFarbe = null;
    teilhandOderSieg(naechsterSpieler);
    return;
  }

  if (karte === EICHEL_DAME) {
    damenZiehen += damenStrafe(anzahl);
    damenImStapel += anzahl;
    letzteDamenAnzahl = anzahl;
    extraZug = false;
    wunschFarbe = null;
    naechsterSpieler();
    return;
  }

  if (wert === "7") {
    ziehStapel += siebenerStrafe(anzahl);
    letzteSiebenAnzahl = anzahl;
    naechsterSpieler();
    return;
  }

  if (wert === "ass") {
    extraZug = true;
    letzteFarbeNachAss = farbe;
    if (hand.length === 0) {
      ausgabeAnhaengen(satz("hast keine Karten mehr und musst ziehen.", "hat keine Karten mehr und muss ziehen."));
    }
    anzeigenAktuelleHand();
    computerZugPlanen(); // nach einem Ass ist der Computer gleich nochmal dran
    return;
  }

  if (wert === "bube") {
    // Ein Bube beendet einen laufenden Ass-Extrazug, sonst ginge der an den Gegner über
    extraZug = false;
    letzteFarbeNachAss = null;
    warteAufFarbwahl = true;
    farbwahlStarten(naechsterSpieler);
    return;
  }

  extraZug = false;
  wunschFarbe = null;
  naechsterSpieler();
}

// vomComputer: im PvE darf nur der Computer selbst für sich ziehen, nicht ein Klick des Menschen
async function karteZiehen(vomComputer = false) {
  if (warteAufFarbwahl || warteAufAnzahlwahl || warteAufTeilstapelwahl || animationLaeuft || spielVorbei) return;
  if ((istComputer() || istFern()) && !vomComputer) return;
  if (modus === "online" && aktuellerSpieler === netz.eigeneNummer) netzSenden({ typ: "ziehen" });
  const hand = handVon(aktuellerSpieler);
  const nachOben = aktuellerSpieler !== ansichtSpieler();
  let zuZiehen = damenZiehen > 0 ? damenZiehen : ziehStapel > 0 ? ziehStapel : 1;

  let neueKarten = 0; // so viele Karten kamen frisch aus der Schachtel in den Ziehstapel
  const gezogeneKarten = [];
  for (let i = 0; i < zuZiehen; i++) {
    if (stapel.length === 0) {
      // Ziehstapel leer: Der Junge packt ein neues Deck aus (so viele 32er-Blätter wie zu Beginn), gemischt über
      // zufall() – online also auf beiden Geräten gleich. Die Ablage bleibt liegen.
      deckErstellen();
      neueKarten += stapel.length;
    }
    const karte = stapel.pop();
    hand.push(karte);
    gezogeneKarten.push(karte);
  }
  const gezogen = gezogeneKarten.length;

  // Ein offener Wunsch bleibt beim Ziehen bestehen, bis jemand die Farbe legt oder eine 10 ihn aufhebt
  ziehStapel = 0;
  letzteSiebenAnzahl = 0;
  damenZiehen = 0;
  damenImStapel = 0;
  letzteDamenAnzahl = 0;
  extraZug = false;
  document.getElementById("ausgabe").innerText =
    satz(`ziehst ${gezogen} Karte(n).`, `zieht ${gezogen} Karte(n).`) +
    (neueKarten ? " Neues Deck aus der Schachtel." : "");

  // Erst die Karten in die Hand fliegen lassen und kurz zeigen, dann ist der Nächste dran
  animationLaeuft = true;
  if (neueKarten) {
    // Der Junge aus der Fernseh-Ecke holt eine Schachtel, packt das neue Deck aus, mischt und legt es hin
    szeneZiehstapelZeigen(0);
    await szeneJungeMischt(neueKarten, () => szeneZiehstapelZeigen(stapel.length + gezogen));
  }
  updateAblage();
  if (gezogen > 0) {
    // Zielplätze in der Hand unsichtbar anlegen, dann fliegen die Karten vom Stapel dorthin
    sortiereHand(hand);
    const ziele = nachOben ? szeneGegnerHandZeigen(hand.length, gezogen) : szeneHandZeigen(hand, true, gezogeneKarten);
    if (nachOben) {
      // Der Gegner langt zum Stapel, die Karten fliegen zu ihm zurück
      const greifen = figurGreift("stapel", 600 + Math.min(gezogen, 8) * 120);
      await warte(260);
      await szeneZiehAnimation(gezogeneKarten, ziele, true);
      await greifen;
    } else {
      await szeneZiehAnimation(gezogeneKarten, ziele, false);
    }
  }
  anzeigenAktuelleHand();
  if (!nachOben) szeneMarkiereNeueKarten(gezogeneKarten);
  gesichtZumZiehen(nachOben, gezogen);
  await warte(nachOben ? 250 : 650);
  animationLaeuft = false;
  naechsterSpieler();
}

// Bube gelegt: der Mensch wählt per Klick, der Computer nach kurzer Pause selbst
function farbwahlStarten(nachWahl) {
  if (istFern()) {
    // Online: die Wunschfarbe kommt vom anderen Gerät (netzAbarbeiten ruft dann nachWahl auf)
    netz.farbeWartet = nachWahl;
    figurDenkt(true);
    return;
  }
  if (istComputer()) {
    setTimeout(() => {
      farbeGewaehlt(computerWunschfarbe());
      nachWahl();
    }, dauer(900));
    return;
  }
  zeigeFarbwahl(nachWahl);
}

function farbeGewaehlt(farbe) {
  if (aktuellerSpieler !== ansichtSpieler()) szeneAusdruck("frech"); // die Figur wünscht sich etwas
  wunschFarbe = farbe;
  ablageWuensche[ablagestapel.length - 1] = farbe; // der Bube oben behält die Farbe auch später
  warteAufFarbwahl = false;
  ausgabeAnhaengen(satz(`wünschst dir ${FARB_NAMEN[farbe]}.`, `wünscht sich ${FARB_NAMEN[farbe]}.`));
  updateAblage(); // Bube auf der Ablage nimmt sofort fließend die Wunschfarbe an
}

function zeigeFarbwahl(nachWahl) {
  const farbwahl = document.getElementById("farbwahl");
  farbwahl.className = "";
  farbwahl.innerHTML = "<p>Wähle eine neue Farbe:</p>";

  farben.forEach(farbe => {
    const img = document.createElement("img");
    img.src = `images/ass_${farbe}.svg`;
    img.alt = farbe;
    img.className = "karte-bild";
    img.onclick = () => {
      farbwahl.innerHTML = "";
      if (modus === "online") netzSenden({ typ: "farbe", farbe });
      farbeGewaehlt(farbe);
      nachWahl();
    };
    farbwahl.appendChild(img);
  });
}

// ---------- Computergegner ----------

function computerZugPlanen() {
  clearTimeout(computerTimer);
  if (!istComputer() || spielVorbei) {
    figurDenkt(false);
    return;
  }
  figurDenkt(true);
  computerTimer = setTimeout(computerZug, dauer(1500));
}

function computerZug() {
  computerTimer = null;
  figurDenkt(false);
  if (!istComputer() || spielVorbei) return;
  if (animationLaeuft || warteAufFarbwahl || warteAufAnzahlwahl || warteAufTeilstapelwahl || welt.figurNascht) {
    computerZugPlanen(); // nascht er gerade, erst austrinken/aufessen
    return;
  }
  const zug = computerZugWaehlen(handVon(COMPUTER));
  if (zug) {
    spieleKarte(zug.karte, zug.anzahl);
  } else {
    karteZiehen(true);
  }
}

// Einfache Strategie: Buben aufheben, häufige Farbe abbauen, Strafkarten nutzen,
// angreifen wenn der Mensch fast fertig ist. null = ziehen.
function computerZugWaehlen(hand) {
  // Damen-Strafe: lieber entschärfen, sonst Damen nachlegen (die Anzahl regelt spieleKarte: alle gleichen)
  if (damenZiehen > 0) {
    if (zugPruefen(EICHEL_KOENIG, hand).erlaubt) return { karte: EICHEL_KOENIG };
    if (zugPruefen(EICHEL_DAME, hand).erlaubt) return { karte: EICHEL_DAME };
    return null;
  }

  const farbAnzahl = farbe => hand.filter(k => k.endsWith(farbe) && !k.startsWith("bube")).length;
  const menschFastFertig = spieler1Hand.length <= 2 && spieler1Decks.length === 0;
  let besteKarte = null;
  let besteWertung = -Infinity;

  for (const karte of new Set(hand)) {
    const pruefung = zugPruefen(karte, hand);
    if (!pruefung.erlaubt) continue;
    const [wert, farbe] = karte.split(" ");

    let wertung = farbAnzahl(farbe);
    if (pruefung.maximum >= 3) wertung += 5 * pruefung.maximum; // Skibidi
    else if (pruefung.maximum === 2) wertung += 2;
    if (karte === EICHEL_DAME) wertung += 8;
    else if (wert === "7") wertung += 5;
    if (wert === "ass") wertung += hand.some(k => k !== karte && k.endsWith(farbe)) ? 4 : -4;
    if (wert === "bube" && hand.length > 2) wertung -= 8;
    if (wert === "10" && wunschFarbe) wertung += 2;
    if (menschFastFertig && (wert === "7" || karte === EICHEL_DAME)) wertung += 6;
    wertung += Math.random(); // nicht immer gleich spielen

    if (wertung > besteWertung) {
      besteWertung = wertung;
      besteKarte = karte;
    }
  }

  if (!besteKarte) return null;
  return { karte: besteKarte, anzahl: null }; // null: spieleKarte legt für den Computer alle gleichen
}

// Häufigste eigene Farbe (ohne Buben)
function computerWunschfarbe() {
  const hand = handVon(COMPUTER);
  const anzahl = farbe => hand.filter(k => k.endsWith(farbe) && !k.startsWith("bube")).length;
  return farben.reduce((beste, farbe) => (anzahl(farbe) > anzahl(beste) ? farbe : beste));
}

// Auswahl, wie viele gleiche Karten man legt – ein Knopf je erlaubter Anzahl (aus zugPruefen), ab 3 mit
// Skibidi-Namen; "Abbrechen" = doch eine andere Karte. Nur eine Möglichkeit: gleich legen.
function waehleAnzahl(anzahlen, beiAuswahl) {
  if (anzahlen.length === 1) {
    beiAuswahl(anzahlen[0]);
    return;
  }

  const auswahl = document.getElementById("farbwahl");
  auswahl.className = "";
  auswahl.innerHTML = "<p>Wie viele willst du legen?</p>";
  warteAufAnzahlwahl = true;
  const schliessen = () => {
    warteAufAnzahlwahl = false;
    auswahl.innerHTML = "";
  };

  for (const n of anzahlen) {
    const button = document.createElement("button");
    button.innerText = n >= 3 ? `${n}x – ${skibidiName(n)}` : `${n}x`;
    button.onclick = () => {
      schliessen();
      beiAuswahl(n);
    };
    auswahl.appendChild(button);
  }
  const abbrechen = document.createElement("button");
  abbrechen.className = "abbrechen";
  abbrechen.innerText = "Abbrechen";
  abbrechen.onclick = schliessen;
  auswahl.appendChild(abbrechen);
}

function naechsterSpieler() {
  aktuellerSpieler = aktuellerSpieler === 1 ? 2 : 1;
  // Hat der Spieler, der jetzt dran ist, keine Karten mehr (letzte Karte war eine Strafkarte): Liegt die Strafe
  // wieder bei ihm, muss er ziehen und behält die nächste Teilhand zurück. Ist sie erledigt, geht es mit der
  // nächsten Teilhand weiter bzw. er hat gewonnen.
  if (handVon(aktuellerSpieler).length === 0) {
    if (ziehStapel === 0 && damenZiehen === 0) {
      teilhandOderSieg(zugBeginnen);
      return;
    }
    ausgabeAnhaengen(satz("hast keine Karten mehr und musst ziehen.", "hat keine Karten mehr und muss ziehen."));
  }
  zugBeginnen();
}

function zugBeginnen() {
  // Die Ansicht bleibt immer bei der eigenen Hand
  anzeigenAktuelleHand();
  computerZugPlanen();
  if (modus === "online") figurDenkt(istFern()); // Gegenüber "überlegt", bis sein Zug ankommt
}

function teilstapelVon(spieler) {
  return spieler === 1 ? spieler1Decks : spieler2Decks;
}

// Hand des aktuellen Spielers ist leer: nächste Teilhand aufnehmen und weiter() – oder er hat gewonnen, wenn
// keine mehr da ist (dann ohne weiter()). Offiziers-Mau-Mau: Welche seiner Teilhände er aufnimmt, entscheidet
// der Gegenspieler (teilstapelWahlStarten).
function teilhandOderSieg(weiter) {
  const spieler = aktuellerSpieler;
  const decks = teilstapelVon(spieler);
  if (decks.length === 0) {
    ausgabeAnhaengen("🎉 " + satz("hast gewonnen!", "hat gewonnen!"));
    disableAktionen();
    return;
  }
  const aufnehmen = index => {
    const neueHand = decks.splice(index, 1)[0];
    if (spieler === 1) spieler1Hand = neueHand;
    else spieler2Hand = neueHand;
    ausgabeAnhaengen(satz("nimmst die nächste Teilhand auf.", "nimmt die nächste Teilhand auf.", spieler));
    weiter();
  };
  if (spielart !== "offizier" || decks.length === 1) aufnehmen(0);
  else teilstapelWahlStarten(spieler, aufnehmen);
}

// Offiziers-Mau-Mau: Der Gegenspieler von „spieler“ wählt einen von dessen Teilstapeln – der Mensch per Knopf
// (oder Klick auf den Stapel), der Computer selbst, online kommt die Wahl vom anderen Gerät ("teilstapel").
// Der gewählte Stapel hebt sich kurz an, dann wird er aufgenommen.
function teilstapelWahlStarten(spieler, aufnehmen) {
  const waehler = spieler === 1 ? 2 : 1;
  const decks = teilstapelVon(spieler);
  const nummer = ++teilstapelWahlNummer;
  warteAufTeilstapelwahl = true;
  anzeigenAktuelleHand();
  const anzeige = document.getElementById("spielerAnzeige");

  const gewaehlt = index => {
    if (nummer !== teilstapelWahlNummer || spielVorbei) return; // Runde inzwischen vorbei oder neu
    if (!(Number.isInteger(index) && index >= 0 && index < decks.length)) index = 0;
    teilstapelWahlAktiv = null;
    document.getElementById("farbwahl").innerHTML = "";
    document.getElementById("farbwahl").className = "";
    const karten = decks[index].length;
    if (spieler === ansichtSpieler()) {
      meldung(`${modus === "online" ? "Dein Mitspieler" : "Der Computer"} gibt dir den Teilstapel mit ${karten} Karten.`);
    } else {
      meldung(`${modus === "online" ? "Dein Mitspieler muss" : "Der Computer muss"} den Teilstapel mit ${karten} Karten aufnehmen.`);
    }
    szeneTeilstapelMarkieren(spieler === ansichtSpieler() ? "eigen" : "gegner", index).then(() => {
      if (nummer !== teilstapelWahlNummer || spielVorbei) return;
      warteAufTeilstapelwahl = false;
      aufnehmen(index);
    });
  };

  if (istFern(waehler)) {
    // Online: der Mitspieler wählt, seine Wahl kommt über die Verbindung (netzAbarbeiten ruft gewaehlt auf)
    netz.teilstapelWartet = gewaehlt;
    figurDenkt(true);
    anzeige.innerText = "Mitspieler wählt deinen Teilstapel …";
    return;
  }
  if (istComputer(waehler)) {
    figurDenkt(true);
    anzeige.innerText = "Computer wählt deinen Teilstapel …";
    setTimeout(() => {
      figurDenkt(false);
      gewaehlt(computerTeilstapelWahl(decks));
    }, dauer(1600));
    return;
  }
  anzeige.innerText = "Wähle seinen Teilstapel";
  zeigeTeilstapelWahl(decks, index => {
    if (modus === "online") netzSenden({ typ: "teilstapel", index });
    gewaehlt(index);
  });
}

// Auswahl für den Menschen: ein Knopf je Teilstapel des Gegners, in der Reihenfolge, wie sie auf dem Tisch
// liegen (seine Reihe sieht man gespiegelt); alternativ den Stapel selbst antippen (teilstapelGeklickt)
function zeigeTeilstapelWahl(decks, beiWahl) {
  const auswahl = document.getElementById("farbwahl");
  auswahl.innerHTML = "";
  auswahl.className = "teilstapel-wahl";
  const frage = document.createElement("p");
  frage.innerText = `Welchen Teilstapel muss ${modus === "online" ? "dein Mitspieler" : "der Computer"} aufnehmen?`;
  auswahl.appendChild(frage);
  for (let index = decks.length - 1; index >= 0; index--) {
    const button = document.createElement("button");
    button.innerText = `${decks[index].length} Karten`;
    button.onclick = () => teilstapelGeklickt(index);
    auswahl.appendChild(button);
  }
  teilstapelWahlAktiv = beiWahl;
}

// Der Computer als Offizier: Er gibt dir lieber einen kleinen Stapel und hebt die großen für später auf – mit
// einer großen letzten Teilhand ist es schwerer, fertig zu werden. Manchmal entscheidet er aus dem Bauch.
function computerTeilstapelWahl(decks) {
  if (Math.random() < 0.2) return Math.floor(Math.random() * decks.length);
  let index = 0;
  decks.forEach((deck, i) => {
    if (deck.length < decks[index].length) index = i;
  });
  return index;
}

function disableAktionen() {
  spielVorbei = true;
  clearTimeout(computerTimer);
  figurDenkt(false);
  szeneHandLeeren();
  document.getElementById("farbwahl").innerHTML = "";
  document.getElementById("spielerAnzeige").innerText = satz("hast gewonnen!", "hat gewonnen!");
  updateAblage();
  spielEndeDarstellen(aktuellerSpieler);
}

// Sieger und Verlierer: Das Strichmännchen steht immer für den Spieler gegenüber.
// - Gewinnt er: im PvE macht er selbst ein Emote, online kommt es vom Gewinner-Gerät ("emote"-Nachricht).
// - Gewinnt man selbst: Er lässt den Kopf hängen; online darf man ihm ein Sieger-Emote schicken.
function spielEndeDarstellen(gewinner) {
  const figurHatGewonnen = gewinner !== ansichtSpieler();
  szeneGrundausdruck(figurHatGewonnen ? "gluecklich" : "traurig");
  if (figurHatGewonnen) {
    if (modus === "pve") {
      const posen = ["salto", "kippe", "schnipsen", "karten"];
      setTimeout(() => szeneEmote(posen[Math.floor(Math.random() * posen.length)]), dauer(700));
    }
  } else {
    szeneFigurTraurig(true);
    document.getElementById("emotes").hidden = false; // Siegesfeier für den Gewinner am eigenen Gerät
  }
  // Nach dem Spiel geht es ohne Rückfrage zurück ins Menü (online bleibt die Verbindung bestehen)
  const button = document.getElementById("neuesSpielButton");
  if (modus === "online" && netz.rolle === "gast") button.innerText = "Zum Menü";
  else button.innerText = "Nochmal spielen";
}

// ---------- Emotes während des Spiels ----------

let letztesSpielEmote = 0;

function emoteLeisteUmschalten() {
  const leiste = document.getElementById("emoteLeiste");
  leiste.hidden = !leiste.hidden;
}

// Online: das Strichmännchen beim Mitspieler (= wir) macht das Emote.
// Gegen den Computer: er reagiert darauf (wird z. B. wütend, wenn man ihn auslacht).
function spielEmote(art) {
  if (Date.now() - letztesSpielEmote < 1500) return; // nicht spammen
  letztesSpielEmote = Date.now();
  document.getElementById("emoteLeiste").hidden = true;
  eigenesEmoteZeigen({ winken: "👋", lachen: "😂", wuetend: "😡", frech: "😏", schock: "😱", mittelfinger: "🖕", kippe: "🚬" }[art]);
  // 😡: man haut selbst einmal auf den Tisch – alles hüpft, die Katze springt, das Bild wackelt
  if (art === "wuetend") szeneTischSchlag(1);

  if (modus === "online") {
    if (netz.verbunden) netzSenden({ typ: "emote", art });
  } else if (modus === "pve") {
    // Der Computer reagiert passend (Mittelfinger gibt's zurück, bei der Kippe raucht er mit)
    const reaktion = { winken: "winken", lachen: "wuetend", wuetend: "lachen", frech: "frech", schock: "lachen", mittelfinger: "mittelfinger", kippe: "kippe" }[art];
    setTimeout(() => szeneEmote(reaktion), dauer(500));
  }
}

function eigenesEmoteZeigen(zeichen) {
  const anzeige = document.getElementById("eigenesEmote");
  anzeige.innerText = zeichen;
  anzeige.hidden = false;
  anzeige.animate(
    [
      { transform: "translate(-50%, 20px) scale(0.4)", opacity: 0 },
      { transform: "translate(-50%, 0) scale(1.15)", opacity: 1, offset: 0.25 },
      { transform: "translate(-50%, -30px) scale(1)", opacity: 1, offset: 0.7 },
      { transform: "translate(-50%, -60px) scale(0.9)", opacity: 0 }
    ],
    { duration: 1300, easing: "ease-out" }
  ).finished.then(() => (anzeige.hidden = true));
}

// Siegesfeier. Online: ans andere Gerät, dort führt das Strichmännchen (= wir) sie aus.
// Gegen den Computer: groß einblenden, und der Verlierer gegenüber reagiert darauf.
// Kippe schnipsen und Karten werfen sieht man auch selbst (aus eigener Sicht aufs Strichmännchen gezielt);
// das andere Gerät sieht das Strichmännchen dasselbe auf sich zu machen.
const FEIER_ZEICHEN = { salto: "🤸", kippe: "🚬", mittelfinger: "🖕", schnipsen: "🔥", karten: "🃏" };

function emoteAusloesen(art) {
  if (Date.now() - letztesSpielEmote < 1500) return;
  letztesSpielEmote = Date.now();
  if (art === "schnipsen" || art === "karten") {
    const laeuftNoch = art === "schnipsen" ? welt.aschenbecherKippe.userData.unterwegs : welt.kartenFliegen;
    if (laeuftNoch) return;
    if (art === "schnipsen") szeneKippeSchnipsen();
    else szeneKartenWerfen();
    if (modus === "online" && netz.verbunden) netzSenden({ typ: "emote", art });
    return;
  }
  eigenesEmoteZeigen(FEIER_ZEICHEN[art]);
  if (modus === "online") {
    if (!netz.verbunden) {
      meldung("Keine Verbindung zum Mitspieler.");
      return;
    }
    netzSenden({ typ: "emote", art });
    const texte = {
      salto: "Dein Mitspieler sieht deinen Rückwärtssalto 🤸",
      kippe: "Dein Mitspieler sieht dich eine rauchen 🚬",
      mittelfinger: "Dein Mitspieler sieht deinen Mittelfinger 🖕"
    };
    meldung(texte[art]);
    return;
  }
  // Reaktion des Verlierers (Strichmännchen) – kurz aus der Trauer heraus, dann wieder traurig
  const reaktion = { salto: "schock", kippe: "genervt", mittelfinger: "wuetend" }[art];
  szeneFigurTraurig(false);
  if (art === "mittelfinger") szeneEmote("wuetend");
  else szeneAusdruck(reaktion, 2400);
  setTimeout(() => szeneFigurTraurig(true), dauer(2400));
}

// 3D-Szene aufbauen und Kartenbilder laden; erst danach lässt sich ein Spiel starten
const startButton = document.getElementById("startButton");
startButton.disabled = true;
startButton.innerText = "Lädt …";
aussehenLaden();
barLaden();
kartengroesseLaden();
const szeneBereit = szeneStarten();
if (welt.huefte) szeneAussehen(eigenesAussehen()); // Vorschau hinter dem Menü
szeneBereit
  .then(() => {
    startButton.disabled = false;
    startButton.innerText = "Spiel starten";
    onlineMenueAktualisieren(); // im Modus "Online" darf nur der verbundene Gastgeber starten
    updateAblage(); // leerer Tisch im Hintergrund des Menüs
  })
  .catch(fehler => {
    startButton.innerText = "3D nicht verfügbar";
    // Grund dauerhaft im Menü zeigen (die Einblendung verschwindet nach ein paar Sekunden)
    const hinweis = document.getElementById("startFehler");
    hinweis.hidden = false;
    hinweis.innerText = "Die 3D-Ansicht konnte nicht gestartet werden: " + fehler.message;
  });
