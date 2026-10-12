// Online-Modus: jeder spielt an seinem eigenen Gerät. Verbindung über PeerJS (lib/peerjs.min.js, globales Peer).
// Prinzip "Lockstep": Beide Geräte rechnen dieselbe Spiellogik mit demselben Startwert fürs Mischen.
// Übertragen werden nur der Rundenstart und die Züge (legen, ziehen, farbe) – nie der ganze Spielzustand.
// Der Gastgeber ist Spieler 1, der Gast Spieler 2; wer anfängt, entscheidet ein Münzwurf (über den Startwert).
//
// Lokaler Test ohne Internet: index.html?lokaltest in zwei Tabs öffnen – dann läuft die Verbindung über
// einen BroadcastChannel zwischen den Tabs statt über PeerJS.

const netz = {
  eigeneNummer: 1,
  rolle: null, // "gastgeber" | "gast"
  verbunden: false,
  peer: null,
  kanal: null, // BroadcastChannel im lokalen Test
  verbindung: null, // { senden(daten), schliessen() }
  warteschlange: [], // empfangene Züge, die auf das Ende der eigenen Animation warten
  farbeWartet: null, // Fortsetzung, die auf die Wunschfarbe des anderen Geräts wartet
  teilstapelWartet: null, // Offiziers-Mau-Mau: wartet darauf, welchen Teilstapel der Mitspieler uns gibt
  fernTisch: null, // Getränk/Snack des Mitspielers (getraenke.js)
  fernAussehen: null, // Aussehen des Mitspielers (aussehen.js), zeigt unser Strichmännchen
  letzteNachricht: 0, // Zeitpunkt der letzten Nachricht (auch Lebenszeichen)
  stillGemeldet: false
};

// Lebenszeichen alle 3 s. Bleibt das andere Gerät 12 s stumm, nur warnen – nicht abbrechen:
// Auf dem Handy friert der Browser ein, sobald man kurz die App wechselt, und kommt danach zurück.
const LEBENSZEICHEN_MS = 3000;
const STILL_WARNUNG_MS = 12000;

const PEER_PRAEFIX = "maumau-skibidi-";

function lokalerTest() {
  return location.search.includes("lokaltest");
}

function onlineVerfuegbar() {
  return typeof Peer !== "undefined" || lokalerTest();
}

function codeErzeugen() {
  const zeichen = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // ohne leicht verwechselbare I, O, 0, 1
  let code = "";
  for (let i = 0; i < 5; i++) code += zeichen[Math.floor(Math.random() * zeichen.length)];
  return code;
}

// ---------- Verbindung aufbauen ----------

function onlineEroeffnen() {
  if (!onlineVerfuegbar()) {
    meldung("Online-Spiel nicht verfügbar: lib/peerjs.min.js fehlt.");
    return;
  }
  vollbildAnfordern();
  netzTrennen();
  netz.rolle = "gastgeber";
  netz.eigeneNummer = 1;
  const code = codeErzeugen();
  onlineStatus(`Dein Code: <strong class="online-code">${code}</strong><br>Schick ihn deinem Mitspieler und warte …`);

  if (lokalerTest()) {
    lokalVerbinden(code);
    return;
  }
  netz.peer = new Peer(PEER_PRAEFIX + code);
  netz.peer.on("connection", verbindung => {
    if (netz.verbindung) {
      verbindung.close(); // nur ein Mitspieler
      return;
    }
    verbindungEinrichten(verbindung);
  });
  netz.peer.on("error", onlineFehler);
}

function onlineBeitreten() {
  if (!onlineVerfuegbar()) {
    meldung("Online-Spiel nicht verfügbar: lib/peerjs.min.js fehlt.");
    return;
  }
  const code = document.getElementById("onlineCode").value.trim().toUpperCase();
  if (code.length < 4) {
    meldung("Bitte den Code deines Mitspielers eingeben.");
    return;
  }
  vollbildAnfordern();
  netzTrennen();
  netz.rolle = "gast";
  netz.eigeneNummer = 2;
  onlineStatus("Verbinde …");

  if (lokalerTest()) {
    lokalVerbinden(code);
    netzSendenRoh({ typ: "hallo" });
    return;
  }
  netz.peer = new Peer();
  netz.peer.on("open", () => verbindungEinrichten(netz.peer.connect(PEER_PRAEFIX + code, { reliable: true })));
  netz.peer.on("error", onlineFehler);
}

function verbindungEinrichten(verbindung) {
  verbindung.on("open", () => {
    netz.verbindung = { senden: daten => verbindung.send(daten), schliessen: () => verbindung.close() };
    verbundenMelden();
  });
  verbindung.on("data", empfangen);
  verbindung.on("close", getrennt);
  verbindung.on("error", onlineFehler);
}

// Lokaler Test: zwei Tabs teilen sich einen BroadcastChannel; "hallo" dient als Verbindungsaufbau
function lokalVerbinden(code) {
  netz.kanal = new BroadcastChannel("maumau-" + code);
  netz.verbindung = {
    senden: daten => netz.kanal.postMessage(daten),
    schliessen: () => netz.kanal.close()
  };
  netz.kanal.onmessage = ereignis => empfangen(ereignis.data);
}

function verbundenMelden() {
  netz.verbunden = true;
  netz.letzteNachricht = Date.now();
  netz.stillGemeldet = false;
  if (netz.rolle === "gastgeber") {
    onlineStatus("Mitspieler verbunden! Stell die Runde ein und klick „Spiel starten“.");
  } else {
    onlineStatus("Verbunden! Warte, bis dein Mitspieler die Runde startet …");
  }
  onlineMenueAktualisieren();
  aussehenSenden();
  barSenden();
}

function getrennt() {
  const warVerbunden = netz.verbunden;
  netz.verbunden = false;
  netz.verbindung = null;
  onlineMenueAktualisieren();
  if (!warVerbunden) return;
  onlineStatus("Verbindung getrennt.");
  if (modus === "online" && !spielVorbei) {
    meldung("Die Verbindung zum Mitspieler wurde getrennt.");
    spielVorbei = true;
    figurDenkt(false);
  }
}

function netzTrennen() {
  if (netz.verbindung) {
    netzSendenRoh({ typ: "tschuess" });
    netz.verbindung.schliessen();
  }
  if (netz.peer) netz.peer.destroy();
  netz.peer = null;
  netz.kanal = null;
  netz.verbindung = null;
  netz.verbunden = false;
  netz.fernAussehen = null;
  netz.fernTisch = null;
  welt.fernBlick = null;
  welt.fernBar = 0;
  netz.warteschlange = [];
  netz.farbeWartet = null;
  netz.teilstapelWartet = null;
}

function onlineFehler(fehler) {
  const art = fehler && fehler.type;
  const texte = {
    "peer-unavailable": "Zu diesem Code gibt es kein offenes Spiel. Code prüfen?",
    "unavailable-id": "Dieser Code ist gerade belegt – bitte neu eröffnen.",
    network: "Keine Verbindung zum Vermittlungsserver. Internet prüfen?",
    "server-error": "Der Vermittlungsserver antwortet nicht. Später nochmal versuchen."
  };
  onlineStatus(texte[art] || "Verbindungsfehler: " + (fehler && fehler.message ? fehler.message : art));
}

// ---------- Nachrichten ----------

function netzSendenRoh(daten) {
  if (netz.verbindung) netz.verbindung.senden(daten);
}

function netzSenden(daten) {
  if (netz.verbunden) netzSendenRoh(daten);
}

function empfangen(daten) {
  if (!daten || !daten.typ) return;
  netz.letzteNachricht = Date.now();
  if (netz.stillGemeldet) {
    netz.stillGemeldet = false;
    meldung("Mitspieler ist wieder da.");
  }
  switch (daten.typ) {
    case "lebenszeichen":
      break;
    case "hallo": // lokaler Test: Gast meldet sich, Gastgeber antwortet
      if (netz.rolle === "gastgeber" && !netz.verbunden) netzSendenRoh({ typ: "hallo" });
      if (!netz.verbunden) verbundenMelden();
      break;
    case "tschuess":
      getrennt();
      break;
    case "chat":
      chatEintragen("Mitspieler", daten.text, true);
      break;
    case "wurf": // der Mitspieler wirft einen Snack auf uns (rein optisch); gefangen: wir schnappen ihn mit dem Mund
      if (!document.getElementById("tisch").hidden) {
        szeneWurfAufMich(typeof daten.snack === "string" ? daten.snack : null, daten.gefangen === true);
        if (daten.gefangen === true) setTimeout(() => meldung("Mit dem Mund gefangen! 😋"), dauer(900));
      }
      break;
    case "tisch": // Getränk/Snack des Mitspielers (getraenke.js)
      barFernGewaehlt(daten.wahl);
      break;
    case "aussehen":
      netz.fernAussehen = aussehenPruefen(daten.aussehen);
      if (modus === "online" && !document.getElementById("tisch").hidden) szeneAussehen(netz.fernAussehen);
      break;
    case "emote":
      // Der Mitspieler hat gewonnen und lässt "seine" Figur (das Strichmännchen bei uns) ein Emote machen
      szeneEmote(daten.art);
      break;
    case "aktion": // live: er trinkt, nascht, streichelt oder füttert die Katze – das Strichmännchen macht es nach
      if (!document.getElementById("tisch").hidden && ["schluck", "knabbern", "streicheln", "fuettern"].includes(daten.art)) {
        szeneFernAktion(daten.art, typeof daten.pegel === "number" ? Math.min(1, Math.max(0, daten.pegel)) : undefined);
      }
      break;
    case "blick": // live: wohin er gerade schaut (Kopf des Strichmännchens dreht sich mit)
      if (typeof daten.yaw === "number" && typeof daten.pitch === "number") szeneFernBlick(daten.yaw, daten.pitch);
      break;
    case "bar": // live: er sucht sich gerade etwas an der Bar aus
      szeneFernBar(daten.offen === true);
      break;
    case "start":
      if (netz.rolle !== "gast") return;
      netz.warteschlange = [];
      netz.farbeWartet = null;
      spielAufbauen(daten.einstellungen, daten.startwert);
      break;
    default:
      netz.warteschlange.push(daten); // legen, ziehen, farbe
  }
}

// ---------- Live: was man am Tisch tut, sieht der Mitspieler an seinem Strichmännchen ----------

// Trinken, Naschen, Katze streicheln/füttern (Aufruf aus geklickt in szene3d.js); pegel = eigenes Glas danach
function tischAktionMelden(art, pegel) {
  if (modus === "online") netzSenden({ typ: "aktion", art, pegel });
}

// Bar auf/zu – er schaut dann zum Getränkeschrank (nur bei Änderung senden)
let barOffenGemeldet = false;

function barStatusMelden(offen) {
  if (offen === barOffenGemeldet) return;
  barOffenGemeldet = offen;
  if (modus === "online") netzSenden({ typ: "bar", offen });
}

// Kopf drehen: höchstens alle 150 ms senden, die letzte Stellung kommt immer an
const blickSenden = { zuletzt: 0, timer: null, yaw: 0, pitch: 0, gesendet: "" };

function blickGeaendert(yaw, pitch) {
  if (typeof modus === "undefined" || modus !== "online" || !netz.verbunden) return;
  blickSenden.yaw = yaw;
  blickSenden.pitch = pitch;
  if (blickSenden.timer) return;
  blickSenden.timer = setTimeout(() => {
    blickSenden.timer = null;
    const runden = wert => Math.round(wert * 100) / 100;
    const schluessel = runden(blickSenden.yaw) + "|" + runden(blickSenden.pitch);
    if (schluessel === blickSenden.gesendet) return;
    blickSenden.gesendet = schluessel;
    blickSenden.zuletzt = Date.now();
    netzSenden({ typ: "blick", yaw: runden(blickSenden.yaw), pitch: runden(blickSenden.pitch) });
  }, Math.max(0, 150 - (Date.now() - blickSenden.zuletzt)));
}

// Gastgeber startet die Runde: Einstellungen und Startwert ans andere Gerät, dann bei sich aufbauen
function onlineRundeStarten(einstellungen) {
  if (!netz.verbunden || netz.rolle !== "gastgeber") {
    meldung("Zuerst ein Online-Spiel eröffnen und auf den Mitspieler warten.");
    return;
  }
  const startwert = Math.floor(Math.random() * 4294967296);
  netz.warteschlange = [];
  netz.farbeWartet = null;
  netzSenden({ typ: "start", einstellungen, startwert });
  spielAufbauen(einstellungen, startwert);
}

// Empfangene Züge der Reihe nach ausführen – jeweils erst, wenn die eigene Animation fertig ist
// und das Spiel wirklich auf diesen Zug wartet. So bleiben beide Geräte im Gleichschritt.
function netzAbarbeiten() {
  if (modus !== "online" || spielVorbei) return;
  const naechste = netz.warteschlange[0];
  if (!naechste) return;

  if (naechste.typ === "farbe") {
    if (!netz.farbeWartet) return;
    netz.warteschlange.shift();
    const weiter = netz.farbeWartet;
    netz.farbeWartet = null;
    figurDenkt(false);
    farbeGewaehlt(naechste.farbe);
    weiter();
    return;
  }

  // Offiziers-Mau-Mau: der Mitspieler hat entschieden, welchen unserer Teilstapel wir aufnehmen
  if (naechste.typ === "teilstapel") {
    if (!netz.teilstapelWartet) return;
    netz.warteschlange.shift();
    const gewaehlt = netz.teilstapelWartet;
    netz.teilstapelWartet = null;
    figurDenkt(false);
    gewaehlt(naechste.index);
    return;
  }

  if (animationLaeuft || warteAufFarbwahl || warteAufAnzahlwahl || warteAufTeilstapelwahl || !istFern() || welt.figurNascht) return;
  netz.warteschlange.shift();
  figurDenkt(false);
  if (naechste.typ === "legen") spieleKarte(naechste.karte, naechste.anzahl);
  else if (naechste.typ === "ziehen") karteZiehen(true);
}

setInterval(netzAbarbeiten, 50);

setInterval(() => {
  if (!netz.verbunden) return;
  netzSendenRoh({ typ: "lebenszeichen" });
  if (!netz.stillGemeldet && Date.now() - netz.letzteNachricht > STILL_WARNUNG_MS) {
    netz.stillGemeldet = true;
    meldung("Mitspieler antwortet gerade nicht – warte …");
  }
}, LEBENSZEICHEN_MS);
window.addEventListener("beforeunload", () => netzSendenRoh({ typ: "tschuess" }));

// ---------- Chat ----------

let sprechblasenTimer = null;
const CHAT_SICHTBAR_MS = 9000; // so lange bleibt eine Nachricht stehen, dann verblasst sie

// Eingabezeile ein-/ausblenden (💬-Button, Enter öffnet, Escape schließt)
function chatUmschalten(offen) {
  const formular = document.getElementById("chatFormular");
  const neu = typeof offen === "boolean" ? offen : formular.hidden;
  formular.hidden = !neu;
  document.getElementById("chat").classList.toggle("offen", neu);
  if (neu) document.getElementById("chatEingabe").focus();
  else document.getElementById("chatEingabe").blur();
}

document.addEventListener("keydown", ereignis => {
  if (modus !== "online" || document.getElementById("tisch").hidden) return;
  const eingabe = document.getElementById("chatEingabe");
  if (ereignis.key === "Escape" && document.activeElement === eingabe) {
    chatUmschalten(false);
  } else if (ereignis.key === "Enter" && document.activeElement !== eingabe && document.activeElement.tagName !== "INPUT") {
    ereignis.preventDefault();
    chatUmschalten(true);
  }
});

function chatSenden(ereignis) {
  ereignis.preventDefault();
  const eingabe = document.getElementById("chatEingabe");
  const text = eingabe.value.trim().slice(0, 200);
  if (!text) return;
  if (!netz.verbunden) {
    meldung("Keine Verbindung zum Mitspieler.");
    return;
  }
  netzSenden({ typ: "chat", text });
  chatEintragen("Du", text, false);
  eingabe.value = "";
  chatUmschalten(false); // wie im Spiel-Chat: nach dem Senden zu, weiterspielen
}

// Nachricht in den Verlauf; Nachrichten des Mitspielers zusätzlich als Sprechblase über dem Strichmännchen
function chatEintragen(von, text, vomMitspieler) {
  text = String(text).slice(0, 200);
  const eintrag = document.createElement("div");
  eintrag.className = "eintrag";
  const name = document.createElement("span");
  name.className = "von";
  name.innerText = von + ": ";
  eintrag.appendChild(name);
  eintrag.appendChild(document.createTextNode(text)); // nie als HTML einfügen
  const verlauf = document.getElementById("chatVerlauf");
  verlauf.appendChild(eintrag);
  while (verlauf.children.length > 30) verlauf.firstChild.remove();
  setTimeout(() => eintrag.classList.add("alt"), CHAT_SICHTBAR_MS);

  if (!vomMitspieler) return;
  const blase = document.getElementById("sprechblase");
  blase.innerText = text;
  blase.hidden = false;
  clearTimeout(sprechblasenTimer);
  sprechblasenTimer = setTimeout(() => (blase.hidden = true), 4000 + text.length * 60);
}

// ---------- Menü ----------

function onlineStatus(html) {
  document.getElementById("onlineStatus").innerHTML = html;
}

function onlineVerbindungTrennen() {
  netzTrennen();
  netz.rolle = null;
  onlineStatus("Verbindung getrennt. Du kannst ein neues Spiel eröffnen oder beitreten.");
  onlineMenueAktualisieren();
}

// Online-Bereich nur im Modus "Online" zeigen; der Start-Button gehört dort dem Gastgeber.
// Steht die Verbindung, bleibt sie für weitere Runden ("Nochmal spielen"): Eröffnen/Beitreten werden
// ausgeblendet, der Gastgeber kann die Einstellungen ändern und neu starten, beim Gast sind sie gesperrt.
function onlineMenueAktualisieren() {
  const online = document.getElementById("modus").value === "online";
  document.getElementById("onlineBereich").hidden = !online;
  document.getElementById("onlineVerbinden").hidden = netz.verbunden;
  document.getElementById("onlineTrennen").hidden = !netz.verbunden;
  const gastGesperrt = online && netz.verbunden && netz.rolle === "gast";
  for (const id of ["spielart", "decks", "anzahl", "teilstapel"]) document.getElementById(id).disabled = gastGesperrt;
  if (online && netz.verbunden) {
    onlineStatus(
      netz.rolle === "gastgeber"
        ? "Mitspieler verbunden! Stell die Runde ein und klick „Spiel starten“."
        : "Verbunden! Die Einstellungen macht dein Mitspieler – warte, bis er startet …"
    );
  }
  const start = document.getElementById("startButton");
  if (typeof welt !== "undefined" && !welt.bereit) return; // Szene lädt noch
  if (!online) {
    start.disabled = false;
    start.innerText = "Spiel starten";
  } else if (netz.verbunden && netz.rolle === "gastgeber") {
    start.disabled = false;
    start.innerText = "Spiel starten";
  } else {
    start.disabled = true;
    start.innerText = netz.rolle === "gast" && netz.verbunden ? "Warte auf Gastgeber …" : "Erst verbinden";
  }
}
