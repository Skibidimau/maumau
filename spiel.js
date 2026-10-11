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

// Leerer Ziehstapel: Ablage bis auf die oberste Karte neu mischen
function ablageNachmischen() {
  if (ablagestapel.length <= 1) return;
  const wunschOben = ablageWuensche[ablagestapel.length - 1];
  const oberste = ablagestapel.pop();
  stapel = ablagestapel;
  mischen(stapel);
  ablagestapel = [oberste];
  ablageWuensche = wunschOben ? { 0: wunschOben } : {};
}

// Liest und prüft die Menü-Einstellungen; null bei ungültiger Eingabe (mit Hinweis)
function einstellungenLesen() {
  const decks = parseInt(document.getElementById("decks").value);
  if (isNaN(decks) || decks < 1 || decks > 40) {
    meldung("Bitte eine gültige Anzahl an Decks zwischen 1 und 40 eingeben!");
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

  return { decks, anzahl, teilstapel, modus: document.getElementById("modus").value };
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
function spielAufbauen({ decks, anzahl, teilstapel, modus: neuerModus }, startwert) {
  zufall = startwert === null ? Math.random : zufallMitStartwert(startwert);
  deckAnzahl = decks;
  deckErstellen();

  modus = neuerModus;
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

  // Münzwurf, wer anfängt – über zufall(), damit online beide Geräte dasselbe Ergebnis haben
  aktuellerSpieler = zufall() < 0.5 ? 1 : 2;

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
  document.getElementById("chatButton").hidden = modus !== "online";
  document.getElementById("chat").hidden = modus !== "online";
  document.getElementById("emoteButton").hidden = false;
  // ⛶ nur am Rechner – auf Handy/Tablet geht es beim Starten automatisch ins Vollbild
  document.getElementById("vollbildButton").hidden = !vollbildMoeglich() || window.matchMedia("(pointer: coarse)").matches;
  document.getElementById("emoteLeiste").hidden = true;
  anzeigenAktuelleHand();
  document.getElementById("ausgabe").innerText = `Runde gestartet. Jeder hat ${anzahl} Karten auf der Hand.`;
  muenzwurfZeigen();
}

// Münze fliegt, danach geht es los (bis dahin sind Klicks und Züge gesperrt)
let muenzwurfNummer = 0;

async function muenzwurfZeigen() {
  const nummer = ++muenzwurfNummer;
  const anfaenger = aktuellerSpieler;
  animationLaeuft = true;
  await szeneMuenzwurf(spielerName(anfaenger), spielerName(anfaenger === 1 ? 2 : 1));
  if (nummer !== muenzwurfNummer || spielVorbei) return; // inzwischen neue Runde oder abgebrochen
  animationLaeuft = false;

  let text = `Münzwurf: ${satz("fängst an.", "fängt an.", anfaenger)}`;
  const startkarte = ablagestapel[0];
  if (startkarte.startsWith("7 ")) text += " Startkarte 7: 2 Karten ziehen – oder eine 7 legen.";
  if (startkarte === EICHEL_DAME) text += " Startkarte Eichel-Dame: 4 Karten ziehen – oder kontern/entschärfen.";
  document.getElementById("ausgabe").innerText = text;
  meldung(satz("fängst an!", "fängt an!", anfaenger));
  computerZugPlanen();
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
  const amZug = aktuellerSpieler === unten;
  sortiereHand(hand);

  szeneHandZeigen(hand, amZug);
  szeneGegnerHandZeigen(gegnerHand.length);
  szeneTeilstapelZeigen(eigeneDecks, gegnerDecks);

  document.getElementById("gegnerInfo").innerText = `${spielerName(gegner)} · ${gegnerHand.length} Karte(n)`;
  document.getElementById("spielerAnzeige").innerText = amZug ? "Du bist dran" : `${spielerName(gegner)} ist am Zug …`;

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
    !warteAufFarbwahl && !warteAufAnzahlwahl && !animationLaeuft
  );
}

// Darf das Gegenüber gerade trinken/naschen? Nur während man selbst am Zug ist (dann zieht er garantiert nicht)
function figurDarfNaschen() {
  return (
    !spielVorbei &&
    !document.getElementById("tisch").hidden &&
    aktuellerSpieler === ansichtSpieler() &&
    !animationLaeuft
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
  if (vonFigur) {
    if (anzahl >= 3) szeneAusdruck("jubel");
    else if (karte === EICHEL_KOENIG && warDamenStrafe) szeneAusdruck("frech"); // entschärft
    else if (strafe) szeneAusdruck("frech");
  } else {
    if (anzahl >= 3 || strafe) szeneAusdruck("schock");
    else if (karte === EICHEL_KOENIG && warDamenStrafe) szeneAusdruck("wuetend"); // seine Damen entschärft
    else if (wert === "10" && warWunsch) szeneAusdruck("wuetend"); // seinen Wunsch aufgehoben
  }
}

// gezogen von der Figur (nachOben) oder vom Spieler unten; anzahl = gezogene Karten
function gesichtZumZiehen(vonFigur, anzahl) {
  if (vonFigur) szeneAusdruck(anzahl >= 4 ? "wuetend" : anzahl >= 2 ? "schock" : "genervt");
  else if (anzahl >= 2) szeneAusdruck("lachen"); // lacht dich aus
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
  const hinweise = [];
  // Oberste Karte zusätzlich als Text – auf kleinen Bildschirmen erkennt man das Symbol sonst schwer
  const oben = ablagestapel[ablagestapel.length - 1];
  if (oben) hinweise.push(`Oben: ${kartenName(oben)}`);
  if (wunschFarbe) hinweise.push(`Wunsch: ${FARB_NAMEN[wunschFarbe]}`);
  if (ziehStapel > 0) {
    const konter = letzteSiebenAnzahl >= 3 ? `mind. ${letzteSiebenAnzahl} gleiche 7er` : "eine 7";
    hinweise.push(`${ziehStapel} Karten ziehen – oder ${konter} legen`);
  }
  if (damenZiehen > 0) {
    hinweise.push(`Eichel-Damen: ${damenZiehen} Karten ziehen – mind. ${letzteDamenAnzahl} Eichel-Dame(n) nachlegen oder mit ${damenImStapel} Eichel-König(en) entschärfen`);
  }
  if (extraZug && letzteFarbeNachAss) hinweise.push(`Ass: nochmal legen (${letzteFarbeNachAss}, Bube oder Ass)`);
  hinweise.forEach(text => {
    const span = document.createElement("span");
    span.className = "schild";
    span.innerText = text;
    infoDiv.appendChild(span);
  });
}


// Prüft ohne Nebenwirkungen, ob eine Karte gelegt werden darf (auch für die Computer-Zugwahl)
function zugPruefen(karte, hand) {
  const [wert, farbe] = karte.split(" ");
  const [oWert, oFarbe] = ablagestapel[ablagestapel.length - 1].split(" ");
  const istEichelDame = karte === EICHEL_DAME;
  const istEichelKoenig = karte === EICHEL_KOENIG;
  const gleiche = hand.filter(k => k === karte).length;

  // Skibidi: ab 3 identischen Karten werden alle auf einmal gelegt – mit jeder Karte, aber nur ohne
  // Sonderzustand; Ausnahme: 7er-Skibidi als Konter auf eine 7er-Strafe.
  // Eichel-Damen laufen über die Anzahlwahl, Eichel-Könige entschärfen in fester Anzahl.
  const keinSonderzustand = ziehStapel === 0 && damenZiehen === 0 && !extraZug && !wunschFarbe;
  const skibidi =
    gleiche >= 3 && !istEichelDame && !(istEichelKoenig && damenZiehen > 0) &&
    (keinSonderzustand || (wert === "7" && ziehStapel > 0 && damenZiehen === 0));

  let darfLegen;
  if (damenZiehen > 0) {
    darfLegen = istEichelDame || istEichelKoenig;
  } else if (ziehStapel > 0) {
    // Kontern nur mit mindestens so vielen gleichen 7ern, wie zuletzt gelegt wurden
    darfLegen = wert === "7" && (skibidi ? gleiche : 1) >= letzteSiebenAnzahl;
  } else if (extraZug) {
    darfLegen = farbe === letzteFarbeNachAss || wert === "bube" || wert === "ass";
  } else if (wunschFarbe) {
    darfLegen = wert === "10" || wert === "bube" || farbe === wunschFarbe;
  } else {
    darfLegen = wert === oWert || farbe === oFarbe || wert === "bube";
  }

  // Kein Bube auf Bube
  if (wert === "bube" && oWert === "bube") darfLegen = false;

  return { erlaubt: darfLegen, skibidi: darfLegen && skibidi, gleiche };
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

// anzahlVorgabe: nur für den Computer – wie viele Eichel-Damen er legt (statt der Anzahlwahl)
function spieleKarte(karte, anzahlVorgabe = null) {
  const hand = handVon(aktuellerSpieler);
  const oFarbe = ablagestapel[ablagestapel.length - 1].split(" ")[1];
  const { erlaubt, skibidi, gleiche } = zugPruefen(karte, hand);

  if (!erlaubt) {
    if (ziehStapel > 0 && damenZiehen === 0 && karte.startsWith("7 ") && letzteSiebenAnzahl >= 3) {
      meldung(`Kontern nur mit mindestens ${letzteSiebenAnzahl} gleichen 7ern auf einmal!`);
    } else {
      meldung("Diese Karte darf nicht gelegt werden!");
    }
    return;
  }

  if (karte === EICHEL_DAME) {
    const minimum = damenZiehen > 0 ? letzteDamenAnzahl : 1;
    if (gleiche < minimum) {
      meldung(`Du musst mindestens ${minimum} Eichel-Dame(n) auf einmal legen!`);
      return;
    }
    zugNebenwirkungen(karte);
    if (anzahlVorgabe) {
      karteLegen(hand, karte, anzahlVorgabe, oFarbe);
    } else {
      waehleAnzahl(minimum, gleiche, anzahl => karteLegen(hand, karte, anzahl, oFarbe));
    }
    return;
  }

  if (karte === EICHEL_KOENIG && damenZiehen > 0) {
    if (gleiche < damenImStapel) {
      meldung(`Zum Entschärfen brauchst du ${damenImStapel} Eichel-König(e)!`);
      return;
    }
    karteLegen(hand, karte, damenImStapel, oFarbe);
    return;
  }

  zugNebenwirkungen(karte);
  karteLegen(hand, karte, skibidi ? gleiche : 1, oFarbe);
}

async function karteLegen(hand, karte, anzahl, oFarbe) {
  const [wert, farbe] = karte.split(" ");

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

  // Was gelegt wurde, sieht man auf dem Tisch (und im Schild „Oben: …“) – keine Textmeldung mehr dazu
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
  // - 7/Eichel-Dame: aufgenommen wird erst, wenn klar ist, wer zieht (pruefeLeereHand in naechsterSpieler)
  // - Ass: der Spieler müsste nochmal legen, hat aber keine Karte mehr -> er muss ziehen
  const oeffnetProzess = wert === "7" || wert === "ass" || karte === EICHEL_DAME;
  if (hand.length === 0 && !oeffnetProzess) {
    const decks = aktuellerSpieler === 1 ? spieler1Decks : spieler2Decks;
    if (decks.length === 0) {
      naechsteTeilhandOderSieg();
      return;
    }
    if (wert === "bube") {
      // Der Wunsch muss feststehen, bevor die nächste Teilhand aufgedeckt wird
      extraZug = false;
      letzteFarbeNachAss = null;
      warteAufFarbwahl = true;
      anzeigenAktuelleHand();
      farbwahlStarten(() => {
        naechsteTeilhandOderSieg();
        naechsterSpieler();
      });
      return;
    }
    naechsteTeilhandOderSieg();
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
  if (warteAufFarbwahl || warteAufAnzahlwahl || animationLaeuft || spielVorbei) return;
  if ((istComputer() || istFern()) && !vomComputer) return;
  if (modus === "online" && aktuellerSpieler === netz.eigeneNummer) netzSenden({ typ: "ziehen" });
  const hand = handVon(aktuellerSpieler);
  const nachOben = aktuellerSpieler !== ansichtSpieler();
  let zuZiehen = damenZiehen > 0 ? damenZiehen : ziehStapel > 0 ? ziehStapel : 1;

  let nachgemischt = false;
  const gezogeneKarten = [];
  for (let i = 0; i < zuZiehen; i++) {
    if (stapel.length === 0) {
      ablageNachmischen();
      nachgemischt = true;
    }
    if (stapel.length === 0) break; // alle übrigen Karten sind auf den Händen
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
    (nachgemischt ? " Die Ablage wurde neu gemischt." : "");

  // Erst die Karten in die Hand fliegen lassen und kurz zeigen, dann ist der Nächste dran
  animationLaeuft = true;
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
  if (animationLaeuft || warteAufFarbwahl || warteAufAnzahlwahl || welt.figurNascht) {
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
  const anzahlVon = karte => hand.filter(k => k === karte).length;

  if (damenZiehen > 0) {
    if (anzahlVon(EICHEL_KOENIG) >= damenImStapel) return { karte: EICHEL_KOENIG };
    if (anzahlVon(EICHEL_DAME) >= letzteDamenAnzahl) return { karte: EICHEL_DAME, anzahl: anzahlVon(EICHEL_DAME) };
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
    if (pruefung.skibidi) wertung += 5 * pruefung.gleiche;
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
  return { karte: besteKarte, anzahl: besteKarte === EICHEL_DAME ? anzahlVon(EICHEL_DAME) : null };
}

// Häufigste eigene Farbe (ohne Buben)
function computerWunschfarbe() {
  const hand = handVon(COMPUTER);
  const anzahl = farbe => hand.filter(k => k.endsWith(farbe) && !k.startsWith("bube")).length;
  return farben.reduce((beste, farbe) => (anzahl(farbe) > anzahl(beste) ? farbe : beste));
}

function waehleAnzahl(minimum, maximum, beiAuswahl) {
  if (minimum === maximum) {
    beiAuswahl(minimum);
    return;
  }

  const auswahl = document.getElementById("farbwahl");
  auswahl.innerHTML = "<p>Wie viele willst du legen?</p>";
  warteAufAnzahlwahl = true;

  for (let n = minimum; n <= maximum; n++) {
    const button = document.createElement("button");
    button.innerText = `${n}x`;
    button.onclick = () => {
      warteAufAnzahlwahl = false;
      auswahl.innerHTML = "";
      beiAuswahl(n);
    };
    auswahl.appendChild(button);
  }
}

function naechsterSpieler() {
  aktuellerSpieler = aktuellerSpieler === 1 ? 2 : 1;
  if (pruefeLeereHand()) return;
  // Die Ansicht bleibt immer bei der eigenen Hand
  anzeigenAktuelleHand();
  computerZugPlanen();
  if (modus === "online") figurDenkt(istFern()); // Gegenüber "überlegt", bis sein Zug ankommt
}

// Hat der Spieler, der jetzt dran ist, keine Karten mehr (letzte Karte war eine Strafkarte):
// Liegt die Strafe wieder bei ihm, muss er ziehen und behält die nächste Teilhand zurück.
// Ist die Strafe erledigt, geht es mit der nächsten Teilhand weiter bzw. er hat gewonnen.
// Gibt true zurück, wenn das Spiel vorbei ist.
function pruefeLeereHand() {
  const hand = aktuellerSpieler === 1 ? spieler1Hand : spieler2Hand;
  if (hand.length > 0) return false;

  const ausgabe = document.getElementById("ausgabe");
  if (ziehStapel > 0 || damenZiehen > 0) {
    ausgabeAnhaengen(satz("hast keine Karten mehr und musst ziehen.", "hat keine Karten mehr und muss ziehen."));
    return false;
  }
  return naechsteTeilhandOderSieg();
}

// Gibt true zurück, wenn der aktuelle Spieler gewonnen hat
function naechsteTeilhandOderSieg() {
  const decks = aktuellerSpieler === 1 ? spieler1Decks : spieler2Decks;
  const ausgabe = document.getElementById("ausgabe");
  if (decks.length > 0) {
    if (aktuellerSpieler === 1) {
      spieler1Hand = decks.shift();
    } else {
      spieler2Hand = decks.shift();
    }
    ausgabeAnhaengen(satz("nimmst die nächste Teilhand auf.", "nimmt die nächste Teilhand auf."));
    return false;
  }
  ausgabeAnhaengen("🎉 " + satz("hast gewonnen!", "hat gewonnen!"));
  disableAktionen();
  return true;
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
    if (modus === "pve") setTimeout(() => szeneEmote(Math.random() < 0.5 ? "salto" : "kippe"), dauer(700));
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
const FEIER_ZEICHEN = { salto: "🤸", kippe: "🚬", mittelfinger: "🖕" };

function emoteAusloesen(art) {
  if (Date.now() - letztesSpielEmote < 1500) return;
  letztesSpielEmote = Date.now();
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
