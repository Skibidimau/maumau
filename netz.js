// Online-Modus: jeder spielt an seinem eigenen Gerät. Verbindung über PeerJS (lib/peerjs.min.js, globales Peer).
// Prinzip "Lockstep": Beide Geräte rechnen dieselbe Spiellogik mit demselben Startwert fürs Mischen.
// Übertragen werden nur der Rundenstart und die Züge (legen, ziehen, farbe) – nie der ganze Spielzustand.
// Der Gastgeber ist Spieler 1 und fängt an, der Gast ist Spieler 2.
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
  netz.warteschlange = [];
  netz.farbeWartet = null;
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

  if (animationLaeuft || warteAufFarbwahl || warteAufAnzahlwahl || !istFern()) return;
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

// ---------- Menü ----------

function onlineStatus(html) {
  document.getElementById("onlineStatus").innerHTML = html;
}

// Online-Bereich nur im Modus "Online" zeigen; der Start-Button gehört dort dem Gastgeber
function onlineMenueAktualisieren() {
  const online = document.getElementById("modus").value === "online";
  document.getElementById("onlineBereich").hidden = !online;
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
