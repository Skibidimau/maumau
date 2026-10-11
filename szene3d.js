// 3D-Darstellung mit Three.js (lib/three.min.js, Version 0.149, globales THREE).
// Zeigt Raum, Tisch, Stapel, Ablage, die eigene Hand (an der Kamera) und den Gegner als Strichmännchen.
// Die Spiellogik (spiel.js) ruft nur die szene…-Funktionen auf; Zustand liest diese Datei nicht selbst.

const KARTE_B = 0.9;
const KARTE_H = 1.4; // Seitenverhältnis 144 × 224 wie die Kartenbilder
const ZIEH_POS = new THREE.Vector3(-1.35, 0, -0.8);
const ABLAGE_POS = new THREE.Vector3(1.35, 0, -0.8);
const EIGENE_STAPEL_Z = 0.4;
const GEGNER_STAPEL_Z = -1.95;
const TEILSTAPEL_SKALA = 0.55;
const HAND_ABSTAND = 2.3; // Abstand der eigenen Hand vor der Kamera
const GEGNER_KARTEN_SKALA = 0.6;

const welt = {
  bereit: false,
  renderer: null,
  szene: null,
  kamera: null,
  behaelter: null,
  handGruppe: null,
  gegnerFaecher: null,
  ablageGruppe: null,
  ziehGruppe: null,
  ziehBlock: null,
  ziehObereKarte: null,
  ziehBeschriftung: null,
  eigeneStapelGruppe: null,
  gegnerStapelGruppe: null,
  figur: null,
  huefte: null,
  kopf: null,
  armLinks: null,
  armRechts: null,
  denkt: false,
  hoverIndex: -1,
  hoverStapel: false,
  handGesperrt: false,
  animationen: new Set()
};

const kartenTexturen = {};
const materialCache = {};

// ---------- Laden ----------

function szeneStarten() {
  if (typeof THREE === "undefined") {
    return Promise.reject(new Error("Die Datei lib/three.min.js wurde nicht gefunden."));
  }
  if (typeof KARTEN_SVG === "undefined") {
    return Promise.reject(new Error("Die Datei karten-daten.js wurde nicht gefunden."));
  }
  try {
    // WebGL-Test vorab, damit ein fehlendes WebGL als verständliche Meldung ankommt
    const test = document.createElement("canvas");
    if (!(test.getContext("webgl2") || test.getContext("webgl"))) {
      return Promise.reject(new Error("Dieser Browser kann kein WebGL (3D-Grafik)."));
    }
  } catch (fehler) {
    return Promise.reject(new Error("Dieser Browser kann kein WebGL (3D-Grafik)."));
  }
  welt.behaelter = document.getElementById("szene");
  // Farbwerte (0x…) als sRGB verstehen, sonst wirkt in r149 alles blass
  THREE.ColorManagement.legacyMode = false;

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  welt.behaelter.appendChild(renderer.domElement);
  welt.renderer = renderer;

  welt.szene = new THREE.Scene();
  welt.szene.background = new THREE.Color(0x221a14);
  welt.kamera = new THREE.PerspectiveCamera(48, 1, 0.1, 100);
  welt.szene.add(welt.kamera);

  lichtAufbauen();
  raumAufbauen();
  tischAufbauen();
  figurAufbauen();

  welt.ablageGruppe = new THREE.Group();
  welt.eigeneStapelGruppe = new THREE.Group();
  welt.gegnerStapelGruppe = new THREE.Group();
  welt.szene.add(welt.ablageGruppe, welt.eigeneStapelGruppe, welt.gegnerStapelGruppe);
  ziehstapelAufbauen();

  welt.handGruppe = new THREE.Group();
  welt.kamera.add(welt.handGruppe);

  window.addEventListener("resize", kameraAnpassen);
  // Ändert sich die Höhe der unteren Leiste (Zeilenumbruch, längere Meldung), Hand neu ausrichten
  const unteresUi = document.getElementById("unteresUi");
  if (unteresUi && window.ResizeObserver) new ResizeObserver(() => handLayout()).observe(unteresUi);
  renderer.domElement.addEventListener("pointermove", zeigerBewegt);
  renderer.domElement.addEventListener("click", geklickt);
  renderer.domElement.addEventListener("pointerleave", () => {
    welt.hoverIndex = -1;
    welt.hoverStapel = false;
  });

  kameraAnpassen();
  requestAnimationFrame(schleife);

  const laden = Object.keys(KARTEN_SVG).map(texturLaden);
  return Promise.all(laden).then(() => {
    welt.bereit = true;
    ziehstapelMaterialSetzen();
  });
}

function texturLaden(name) {
  return new Promise((fertig, fehler) => {
    const bild = new Image();
    bild.onload = () => {
      const leinwand = document.createElement("canvas");
      leinwand.width = 432;
      leinwand.height = 672;
      leinwand.getContext("2d").drawImage(bild, 0, 0, leinwand.width, leinwand.height);
      const textur = new THREE.CanvasTexture(leinwand);
      textur.encoding = THREE.sRGBEncoding;
      textur.anisotropy = welt.renderer.capabilities.getMaxAnisotropy();
      kartenTexturen[name] = textur;
      fertig();
    };
    bild.onerror = () => fehler(new Error("Kartenbild nicht lesbar: " + name));
    bild.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(KARTEN_SVG[name]);
  });
}

function bildName(karte) {
  if (!karte) return "Back";
  const [wert, farbe] = karte.split(" ");
  return `${wert}_${farbe}`;
}

// variante: "normal", "gedimmt" (eigene Hand, wenn man nicht dran ist) oder "leuchtend" (frisch gezogen)
function kartenMaterial(name, variante = "normal") {
  const schluessel = name + "|" + variante;
  if (!materialCache[schluessel]) {
    materialCache[schluessel] = new THREE.MeshStandardMaterial({
      map: kartenTexturen[name] || null,
      transparent: true,
      alphaTest: 0.5,
      roughness: 0.6,
      metalness: 0,
      color: variante === "gedimmt" ? 0x9a9a9a : 0xffffff,
      emissive: variante === "leuchtend" ? 0x7a5200 : 0x000000
    });
  }
  return materialCache[schluessel];
}

// ---------- Aufbau der Welt ----------

function lichtAufbauen() {
  welt.szene.add(new THREE.HemisphereLight(0xfff4e0, 0x3a2a1e, 0.6));

  const sonne = new THREE.DirectionalLight(0xfff1d6, 0.85);
  sonne.position.set(2.5, 8, 3.5);
  sonne.target.position.set(0, 0, -0.6);
  sonne.castShadow = true;
  sonne.shadow.mapSize.set(2048, 2048);
  Object.assign(sonne.shadow.camera, { left: -6, right: 6, top: 6, bottom: -6, near: 1, far: 22 });
  sonne.shadow.bias = -0.0006;
  sonne.shadow.normalBias = 0.02;
  welt.szene.add(sonne, sonne.target);

  const lampe = new THREE.PointLight(0xffd9a0, 0.35, 14);
  lampe.position.set(0, 4.5, -0.5);
  welt.szene.add(lampe);
}

function raumAufbauen() {
  const wand = new THREE.Mesh(
    new THREE.PlaneGeometry(40, 16),
    new THREE.MeshStandardMaterial({ color: 0xcdbfa8, roughness: 0.95 })
  );
  wand.position.set(0, 5, -6);
  wand.receiveShadow = true;

  const boden = new THREE.Mesh(
    new THREE.PlaneGeometry(40, 30),
    new THREE.MeshStandardMaterial({ color: 0x4a3a2c, roughness: 0.9 })
  );
  boden.rotation.x = -Math.PI / 2;
  boden.position.y = -1.6;
  boden.receiveShadow = true;

  welt.szene.add(wand, boden);
}

function tischAufbauen() {
  const holz = new THREE.MeshStandardMaterial({ color: 0x5a3a1e, roughness: 0.7 });
  const filz = new THREE.MeshStandardMaterial({ color: 0x2f8a4e, roughness: 0.95 });

  const platte = new THREE.Mesh(new THREE.BoxGeometry(7, 0.12, 4.6), filz);
  platte.position.y = -0.06;
  platte.receiveShadow = true;

  const unterbau = new THREE.Mesh(new THREE.BoxGeometry(7.6, 0.2, 5.2), holz);
  unterbau.position.y = -0.2;
  unterbau.castShadow = true;
  unterbau.receiveShadow = true;

  const tisch = new THREE.Group();
  tisch.add(platte, unterbau);

  // erhöhter Holzrand
  const rand = [
    [7.6, 0.3, 0, 2.45],
    [7.6, 0.3, 0, -2.45],
    [0.3, 4.6, 3.65, 0],
    [0.3, 4.6, -3.65, 0]
  ];
  for (const [breite, tiefe, x, z] of rand) {
    const leiste = new THREE.Mesh(new THREE.BoxGeometry(breite, 0.16, tiefe), holz);
    leiste.position.set(x, 0.02, z);
    leiste.castShadow = true;
    leiste.receiveShadow = true;
    tisch.add(leiste);
  }

  for (const x of [-3.3, 3.3]) {
    for (const z of [-2.1, 2.1]) {
      const bein = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.1, 1.3, 12), holz);
      bein.position.set(x, -0.95, z);
      bein.castShadow = true;
      tisch.add(bein);
    }
  }
  welt.szene.add(tisch);
}

// Schwarzes Strichmännchen hinter dem Tisch: Hüfte (zum Vorbeugen), Rumpf, Kopf, zwei Arme mit Schulter-
// und Ellbogengelenk. Die Hände halten seinen Kartenfächer; zum Legen/Ziehen greifen sie über Inverse Kinematik.
function figurAufbauen() {
  const schwarz = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.55 });
  const holz = new THREE.MeshStandardMaterial({ color: 0x6b4423, roughness: 0.75 });
  const stab = (laenge, dicke = 0.055, material = schwarz) => {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(dicke, dicke, laenge, 14), material);
    m.castShadow = true;
    return m;
  };

  const figur = new THREE.Group();
  figur.position.set(0, 0, -3.0);

  // Stuhllehne hinter ihm
  for (const x of [-0.5, 0.5]) {
    const pfosten = stab(2.4, 0.05, holz);
    pfosten.position.set(x, -0.4, -0.4);
    figur.add(pfosten);
  }
  const lehne = stab(1.1, 0.06, holz);
  lehne.rotation.z = Math.PI / 2;
  lehne.position.set(0, 0.75, -0.4);
  figur.add(lehne);

  const huefte = new THREE.Group();
  huefte.position.set(0, -0.35, 0);
  figur.add(huefte);

  const rumpf = stab(1.95);
  rumpf.position.y = 0.975;
  const schultern = stab(0.8);
  schultern.rotation.z = Math.PI / 2;
  schultern.position.y = 1.75;
  huefte.add(rumpf, schultern);

  const kopf = new THREE.Group();
  kopf.position.y = 1.95;
  const kopfKugel = new THREE.Mesh(new THREE.SphereGeometry(0.3, 28, 20), schwarz);
  kopfKugel.position.y = 0.34;
  kopfKugel.castShadow = true;
  kopf.add(kopfKugel);
  huefte.add(kopf);

  // Gesicht: auf ein Canvas gezeichnet (gesichtZeichnen), als Fläche knapp vor der Kopfkugel
  const leinwand = document.createElement("canvas");
  leinwand.width = 256;
  leinwand.height = 256;
  const gesichtTextur = new THREE.CanvasTexture(leinwand);
  gesichtTextur.encoding = THREE.sRGBEncoding;
  const gesicht = new THREE.Mesh(
    new THREE.PlaneGeometry(0.6, 0.6),
    new THREE.MeshBasicMaterial({ map: gesichtTextur, transparent: true, depthWrite: false })
  );
  gesicht.position.set(0, 0.33, 0.31);
  kopf.add(gesicht);
  welt.gesicht = {
    ctx: leinwand.getContext("2d"),
    textur: gesichtTextur,
    gezeichnet: "",
    temporaer: null,
    temporaerBis: 0,
    basis: "neutral",
    naechstesBlinzeln: 0,
    blinzelnBis: 0
  };

  const armBauen = seite => {
    const schulter = new THREE.Group();
    schulter.position.set(0.4 * seite, 1.75, 0);
    const a = 0.7;
    const b = 0.7;
    const oberarm = stab(a, 0.05);
    oberarm.position.y = -a / 2;
    const ellbogen = new THREE.Group();
    ellbogen.position.y = -a;
    const unterarm = stab(b, 0.045);
    unterarm.position.y = -b / 2;
    const hand = handBauen(schwarz, seite);
    hand.position.y = -b;
    ellbogen.add(unterarm, hand);
    schulter.add(oberarm, ellbogen);
    huefte.add(schulter);
    return { schulter, ellbogen, hand, a, b, seite, greifAnteil: 0, greifZiel: new THREE.Vector3() };
  };

  // Fächer vor der Brust, Rückseiten zu uns (Gruppe um 180° gedreht)
  const faecher = new THREE.Group();
  faecher.position.set(0, 1.25, 0.55);
  faecher.rotation.set(-0.15, Math.PI, 0);
  huefte.add(faecher);

  welt.figur = figur;
  welt.huefte = huefte;
  welt.kopf = kopf;
  welt.gegnerFaecher = faecher;
  welt.armLinks = armBauen(-1);
  welt.armRechts = armBauen(1);
  welt.szene.add(figur);
}

// Hand mit Handfläche, vier Fingern und Daumen (zeigt in Unterarm-Richtung, also lokal nach −y)
function handBauen(material, seite) {
  const hand = new THREE.Group();
  const flaeche = new THREE.Mesh(new THREE.SphereGeometry(1, 14, 10), material);
  flaeche.scale.set(0.075, 0.07, 0.04);
  flaeche.position.y = -0.03;
  flaeche.castShadow = true;
  hand.add(flaeche);
  // Jeder Finger hängt an einem Gelenk am Handrand, damit er sich einklappen lässt (fingerKruemmen)
  const finger = [];
  for (let i = 0; i < 4; i++) {
    const laenge = [0.07, 0.085, 0.08, 0.065][i]; // Index 1 = Mittelfinger (der längste)
    const gelenk = new THREE.Group();
    gelenk.position.set((i - 1.5) * 0.034, -0.085, 0);
    gelenk.rotation.z = (i - 1.5) * 0.12;
    const glied = new THREE.Mesh(new THREE.CapsuleGeometry(0.014, laenge, 4, 8), material);
    glied.position.y = -laenge / 2 - 0.005;
    glied.castShadow = true;
    gelenk.add(glied);
    hand.add(gelenk);
    finger.push(gelenk);
  }
  const daumen = new THREE.Mesh(new THREE.CapsuleGeometry(0.016, 0.06, 4, 8), material);
  daumen.position.set(-0.075 * seite, -0.045, 0.025);
  daumen.rotation.z = 0.9 * seite;
  daumen.castShadow = true;
  hand.add(daumen);
  hand.userData = { finger, daumen, daumenDrehung: 0.9 * seite };
  return hand;
}

// Finger einklappen (0 = gestreckt, 1 = Faust); ausnahmeIndex bleibt gestreckt (z. B. 1 = Mittelfinger)
function fingerKruemmen(hand, anteil, ausnahmeIndex = -1) {
  hand.userData.finger.forEach((gelenk, i) => {
    gelenk.rotation.x = i === ausnahmeIndex ? 0 : -2.2 * anteil; // zur Handfläche hin
  });
  hand.userData.daumen.rotation.z = hand.userData.daumenDrehung * (1 - 0.8 * anteil);
}

// ---------- Gesicht ----------

// Zeichnet einen Gesichtsausdruck – bewusst übertrieben (weiße Augen/Brauen/Mund auf dem schwarzen Kopf).
// ausdruck: neutral, gluecklich, jubel, lachen, frech, wuetend, genervt, schock, traurig, besorgt, nachdenklich
function gesichtZeichnen(ausdruck, augenZu) {
  const g = welt.gesicht;
  const ctx = g.ctx;
  ctx.clearRect(0, 0, 256, 256);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  const weiss = "#f6f2e8";
  const rot = "#c8322a";

  // Parameter je Ausdruck
  const p = {
    augenHoehe: 30, // halbe Augenhöhe
    lid: 0, // 0 = offen, 1 = zu (von oben)
    pupille: 11,
    blick: [0, 0],
    brauen: [0, 0], // Neigung links/rechts (positiv = innen nach unten = böse)
    brauenHoehe: [0, 0],
    mund: "strich",
    lachAugen: false,
    traene: false
  };
  switch (ausdruck) {
    case "gluecklich": Object.assign(p, { mund: "laecheln", brauenHoehe: [-8, -8] }); break;
    case "jubel": Object.assign(p, { mund: "offenGross", lachAugen: true, brauenHoehe: [-14, -14] }); break;
    case "lachen": Object.assign(p, { mund: "offenGross", lachAugen: true, traene: true, brauen: [-0.2, -0.2] }); break;
    case "frech": Object.assign(p, { mund: "grinsen", lid: 0.45, brauen: [0.15, -0.35], brauenHoehe: [4, -16], blick: [6, 0] }); break;
    case "wuetend": Object.assign(p, { mund: "zaehne", lid: 0.3, brauen: [0.6, 0.6], brauenHoehe: [8, 8], pupille: 9 }); break;
    case "genervt": Object.assign(p, { mund: "schief", lid: 0.5, brauenHoehe: [6, 6], blick: [0, -4] }); break;
    case "schock": Object.assign(p, { mund: "o", augenHoehe: 38, pupille: 7, brauenHoehe: [-22, -22] }); break;
    case "traurig": Object.assign(p, { mund: "traurig", brauen: [-0.55, -0.55], blick: [0, 8], traene: true }); break;
    case "besorgt": Object.assign(p, { mund: "wellig", brauen: [-0.45, -0.45], brauenHoehe: [-6, -6] }); break;
    case "nachdenklich": Object.assign(p, { mund: "seitlich", blick: [-9, -9], brauen: [0, -0.3], brauenHoehe: [0, -12] }); break;
  }
  if (augenZu && !p.lachAugen) p.lid = 1;

  const augen = [[86, 112], [170, 112]];
  augen.forEach(([x, y], i) => {
    if (p.lachAugen) {
      // ^ ^ – zugekniffene Lachaugen
      ctx.strokeStyle = weiss;
      ctx.lineWidth = 9;
      ctx.beginPath();
      ctx.arc(x, y + 10, 20, Math.PI * 1.15, Math.PI * 1.85);
      ctx.stroke();
      return;
    }
    // Augapfel
    ctx.fillStyle = weiss;
    ctx.beginPath();
    ctx.ellipse(x, y, 24, p.augenHoehe, 0, 0, Math.PI * 2);
    ctx.fill();
    // Pupille
    ctx.fillStyle = "#111";
    ctx.beginPath();
    ctx.arc(x + p.blick[0], y + p.blick[1] + 4, p.pupille, 0, Math.PI * 2);
    ctx.fill();
    // Lid: schwarze Fläche von oben (Kopffarbe), unten mit gerader Kante
    if (p.lid > 0) {
      ctx.fillStyle = "#111";
      const kante = y - p.augenHoehe + p.augenHoehe * 2 * p.lid;
      ctx.fillRect(x - 30, y - p.augenHoehe - 6, 60, kante - (y - p.augenHoehe - 6));
      ctx.strokeStyle = weiss;
      ctx.lineWidth = 4;
      if (p.lid < 1) {
        ctx.beginPath();
        ctx.moveTo(x - 24, kante);
        ctx.lineTo(x + 24, kante);
        ctx.stroke();
      } else {
        ctx.lineWidth = 6;
        ctx.beginPath();
        ctx.moveTo(x - 22, y + 4);
        ctx.quadraticCurveTo(x, y + 14, x + 22, y + 4);
        ctx.stroke();
      }
    }
    // Braue: Linie über dem Auge, Neigung nach innen
    const innen = i === 0 ? 1 : -1; // Richtung zur Gesichtsmitte
    const neigung = p.brauen[i] * 22;
    const by = y - p.augenHoehe - 16 + p.brauenHoehe[i];
    ctx.strokeStyle = weiss;
    ctx.lineWidth = 10;
    ctx.beginPath();
    ctx.moveTo(x - 26 * innen, by - neigung * 0.2);
    ctx.lineTo(x + 26 * innen, by + neigung);
    ctx.stroke();
  });

  if (p.traene) {
    ctx.fillStyle = "#7fc6ff";
    ctx.beginPath();
    ctx.moveTo(196, 140);
    ctx.quadraticCurveTo(208, 162, 196, 170);
    ctx.quadraticCurveTo(184, 162, 196, 140);
    ctx.fill();
  }

  // Mund
  ctx.strokeStyle = weiss;
  ctx.fillStyle = weiss;
  ctx.lineWidth = 9;
  ctx.beginPath();
  switch (p.mund) {
    case "laecheln":
      ctx.arc(128, 168, 38, Math.PI * 0.15, Math.PI * 0.85);
      ctx.stroke();
      break;
    case "grinsen":
      ctx.moveTo(92, 186);
      ctx.quadraticCurveTo(140, 206, 172, 170);
      ctx.stroke();
      break;
    case "offenGross":
      ctx.moveTo(84, 176);
      ctx.lineTo(172, 176);
      ctx.quadraticCurveTo(170, 232, 128, 234);
      ctx.quadraticCurveTo(86, 232, 84, 176);
      ctx.fill();
      ctx.fillStyle = rot;
      ctx.beginPath();
      ctx.ellipse(128, 214, 22, 12, 0, 0, Math.PI * 2);
      ctx.fill();
      break;
    case "zaehne":
      ctx.fillRect(90, 182, 76, 28);
      ctx.strokeStyle = "#111";
      ctx.lineWidth = 3;
      for (let x = 103; x < 166; x += 13) {
        ctx.beginPath();
        ctx.moveTo(x, 182);
        ctx.lineTo(x, 210);
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.moveTo(90, 196);
      ctx.lineTo(166, 196);
      ctx.stroke();
      break;
    case "schief":
      ctx.moveTo(98, 196);
      ctx.lineTo(160, 186);
      ctx.stroke();
      break;
    case "o":
      ctx.ellipse(128, 198, 18, 24, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#3a0a08";
      ctx.beginPath();
      ctx.ellipse(128, 200, 11, 16, 0, 0, Math.PI * 2);
      ctx.fill();
      break;
    case "traurig":
      ctx.arc(128, 222, 34, Math.PI * 1.2, Math.PI * 1.8);
      ctx.stroke();
      break;
    case "wellig":
      ctx.moveTo(94, 196);
      ctx.quadraticCurveTo(111, 184, 128, 196);
      ctx.quadraticCurveTo(145, 208, 162, 196);
      ctx.stroke();
      break;
    case "seitlich":
      ctx.moveTo(110, 196);
      ctx.lineTo(150, 190);
      ctx.stroke();
      break;
    default:
      ctx.moveTo(104, 192);
      ctx.lineTo(152, 192);
      ctx.stroke();
  }
  g.textur.needsUpdate = true;
}

// Kurzzeitiger Ausdruck (Reaktion auf ein Spielereignis), danach wieder der Grundausdruck
function szeneAusdruck(ausdruck, ms = 2400) {
  if (!welt.gesicht) return;
  welt.gesicht.temporaer = ausdruck;
  welt.gesicht.temporaerBis = performance.now() + ms;
}

// Grundausdruck je nach Spiellage (neutral, frech, besorgt, traurig, gluecklich …)
function szeneGrundausdruck(ausdruck) {
  if (welt.gesicht) welt.gesicht.basis = ausdruck;
}

function gesichtAktualisieren(jetzt) {
  const g = welt.gesicht;
  if (!g) return;
  if (g.temporaer && jetzt > g.temporaerBis) g.temporaer = null;
  let ausdruck = g.temporaer || (welt.denkt ? "nachdenklich" : g.basis);
  if (welt.traurig && !g.temporaer) ausdruck = "traurig";
  // Blinzeln alle paar Sekunden
  if (jetzt > g.naechstesBlinzeln) {
    g.blinzelnBis = jetzt + 130;
    g.naechstesBlinzeln = jetzt + 2500 + Math.random() * 3000;
  }
  const zu = jetzt < g.blinzelnBis;
  const schluessel = ausdruck + (zu ? "|zu" : "");
  if (schluessel !== g.gezeichnet) {
    gesichtZeichnen(ausdruck, zu);
    g.gezeichnet = schluessel;
  }
}

function ziehstapelAufbauen() {
  const gruppe = new THREE.Group();
  gruppe.position.copy(ZIEH_POS);

  const seiten = new THREE.MeshStandardMaterial({ color: 0xf1ebdc, roughness: 0.85 });
  // Material für die Oberseite wird nach dem Laden der Texturen gesetzt
  const block = new THREE.Mesh(new THREE.BoxGeometry(KARTE_B * 0.94, 1, KARTE_H * 0.94), [
    seiten, seiten, seiten, seiten, seiten, seiten
  ]);
  block.castShadow = true;
  block.receiveShadow = true;
  gruppe.add(block);

  welt.ziehGruppe = gruppe;
  welt.ziehBlock = block;
  welt.szene.add(gruppe);
}

function ziehstapelMaterialSetzen() {
  const seiten = welt.ziehBlock.material[0];
  const oben = () => new THREE.MeshStandardMaterial({ map: kartenTexturen.Back, roughness: 0.6 });
  welt.ziehBlock.material = [seiten, seiten, oben(), seiten, seiten, seiten];
  // eigenes Material für die Teilstapel, damit das Hover-Leuchten des Ziehstapels sie nicht mitfärbt
  welt.teilstapelMaterial = [seiten, seiten, oben(), seiten, seiten, seiten];
}

// ---------- Kamera und Größe ----------

function kameraAnpassen() {
  const breite = welt.behaelter.clientWidth || window.innerWidth;
  const hoehe = welt.behaelter.clientHeight || window.innerHeight;
  welt.renderer.setSize(breite, hoehe);
  const kamera = welt.kamera;
  kamera.aspect = breite / hoehe;

  // Feste Blickrichtung vom eigenen Platz; Abstand so, dass Ziehstapel und Ablage samt Beschriftung
  // in die Breite passen (im Hochformat werden dafür die Tischränder seitlich angeschnitten)
  const vfov = THREE.MathUtils.degToRad(kamera.fov);
  const hfov = 2 * Math.atan(Math.tan(vfov / 2) * kamera.aspect);
  const abstand = Math.max(7.4, 2.25 / Math.tan(hfov / 2));
  const blickziel = new THREE.Vector3(0, 0.35, -0.15);
  const richtung = new THREE.Vector3(0, 0.64, 0.77).normalize();
  kamera.position.copy(blickziel).addScaledVector(richtung, abstand);
  kamera.lookAt(blickziel);
  kamera.updateProjectionMatrix();

  handLayout();
}

function sichtbareHandflaeche() {
  const hoehe = 2 * HAND_ABSTAND * Math.tan(THREE.MathUtils.degToRad(welt.kamera.fov) / 2);
  return { hoehe, breite: hoehe * welt.kamera.aspect };
}

// ---------- Karten ----------

// Karte als Gruppe aus Vorder- und Rückseite (stehend in der XY-Ebene, Vorderseite zeigt nach +Z).
// karte = null: beide Seiten zeigen die Rückseite (für Gegnerkarten, damit nichts verraten wird).
const kartenGeometrie = new THREE.PlaneGeometry(KARTE_B, KARTE_H);

function karteErzeugen(karte, variante = "normal") {
  const gruppe = new THREE.Group();
  const vorne = new THREE.Mesh(kartenGeometrie, kartenMaterial(bildName(karte), variante));
  const hinten = new THREE.Mesh(kartenGeometrie, kartenMaterial("Back", variante));
  hinten.rotation.y = Math.PI;
  hinten.position.z = -0.003;
  gruppe.add(vorne, hinten);
  gruppe.userData = { karte, vorne, hinten };
  return gruppe;
}

function schattenWerfen(gruppe, anAus) {
  gruppe.traverse(o => {
    if (o.isMesh) o.castShadow = anAus;
  });
}

const ACHSE_Y = new THREE.Vector3(0, 1, 0);

// Lage einer flach liegenden Karte: offen = Vorderseite oben; drehungGrad im Uhrzeigersinn von oben gesehen
function liegendeLage(drehungGrad, offen = true) {
  const q = new THREE.Quaternion().setFromAxisAngle(ACHSE_Y, THREE.MathUtils.degToRad(-drehungGrad));
  q.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(offen ? -Math.PI / 2 : Math.PI / 2, 0, 0)));
  return q;
}

function weltLage(objekt) {
  objekt.updateWorldMatrix(true, false);
  const pos = new THREE.Vector3();
  const quat = new THREE.Quaternion();
  const skala = new THREE.Vector3();
  objekt.matrixWorld.decompose(pos, quat, skala);
  return { pos, quat, skala: skala.x };
}

// ---------- Ablage, Ziehstapel, Teilstapel ----------

// Ziel einer Ablagekarte: feste Drehung/Versetzung aus ablageLage() (spiel.js), leicht übereinander
function ablageZiel(position, gesamt) {
  const lage = ablageLage(position);
  const ebene = position - Math.max(0, gesamt - 6);
  return {
    pos: new THREE.Vector3(ABLAGE_POS.x + lage.x * 0.014, 0.006 + ebene * 0.004, ABLAGE_POS.z + lage.y * 0.014),
    quat: liegendeLage(lage.drehung, true),
    skala: 1
  };
}

// verdeckt: so viele oberste Karten noch nicht zeigen (sie sind gerade im Flug)
// wunschFarbe: liegt oben ein Bube mit offenem Wunsch, blendet er fließend in den Buben der Wunschfarbe über
function szeneAblageZeigen(ablage, verdeckt = 0, wunschFarbe = null) {
  // eigene (geklonte) Materialien des Wunsch-Effekts freigeben
  if (welt.wunschUeberlagerung) welt.wunschUeberlagerung.material.dispose();
  if (welt.wunschSchein) welt.wunschSchein.material.dispose();
  welt.ablageGruppe.clear();
  welt.wunschUeberlagerung = null;
  welt.wunschSchein = null;
  const bis = ablage.length - verdeckt;
  const sichtbar = ablage.slice(Math.max(0, bis - 6), bis);
  sichtbar.forEach((karte, i) => {
    const position = bis - sichtbar.length + i;
    const ziel = ablageZiel(position, bis);
    const k = karteErzeugen(karte);
    k.position.copy(ziel.pos);
    k.quaternion.copy(ziel.quat);
    welt.ablageGruppe.add(k);

    const istOben = verdeckt === 0 && position === ablage.length - 1;
    if (istOben && wunschFarbe && karte.startsWith("bube")) wunschAnzeigen(k, position, wunschFarbe);
  });
  if (!welt.wunschUeberlagerung) welt.wunsch = null;
}

// Über den liegenden Buben eine zweite Kartenfläche (Bube der Wunschfarbe) legen, die einblendet,
// darunter ein goldener Schein. Der Startzeitpunkt bleibt beim Neuzeichnen erhalten (kein erneutes Einblenden).
const scheinGeometrie = new THREE.PlaneGeometry(KARTE_B * 1.14, KARTE_H * 1.1);

function wunschAnzeigen(karteObjekt, position, farbe) {
  const schluessel = position + "|" + farbe;
  if (!welt.wunsch || welt.wunsch.schluessel !== schluessel) {
    welt.wunsch = { schluessel, start: performance.now() };
  }
  const material = kartenMaterial(`bube_${farbe}`).clone();
  material.alphaTest = 0.02; // beim Einblenden nicht schlagartig ausstanzen
  material.opacity = 0;
  material.depthWrite = false;
  const ueberlagerung = new THREE.Mesh(kartenGeometrie, material);
  ueberlagerung.position.z = 0.002; // lokal: knapp über der Vorderseite
  karteObjekt.add(ueberlagerung);

  const schein = new THREE.Mesh(
    scheinGeometrie,
    new THREE.MeshBasicMaterial({ color: 0xffc94a, transparent: true, opacity: 0, depthWrite: false })
  );
  schein.position.z = -0.004; // lokal: unter der Karte
  karteObjekt.add(schein);

  welt.wunschUeberlagerung = ueberlagerung;
  welt.wunschSchein = schein;
}

function wunschAktualisieren(jetzt) {
  if (!welt.wunschUeberlagerung || !welt.wunsch) return;
  const ms = dauer(900);
  const t = ms ? Math.min(1, (jetzt - welt.wunsch.start) / ms) : 1;
  welt.wunschUeberlagerung.material.opacity = sanft(t);
  // Schein pulsiert leicht, sobald der Bube die Farbe angenommen hat
  welt.wunschSchein.material.opacity = sanft(t) * (0.35 + 0.15 * Math.sin(jetzt / 260));
}

function stapelHoehe(anzahl) {
  return 0.02 + Math.min(anzahl, 160) * 0.003;
}

function szeneZiehstapelZeigen(anzahl) {
  const hoehe = stapelHoehe(anzahl);
  welt.ziehBlock.scale.y = hoehe;
  welt.ziehBlock.position.y = hoehe / 2;
  welt.ziehBlock.visible = anzahl > 0;

  if (welt.ziehBeschriftung) welt.ziehGruppe.remove(welt.ziehBeschriftung);
  welt.ziehBeschriftung = textSprite(`${anzahl} Karten`, 0.2);
  welt.ziehBeschriftung.position.set(0, 0.12, KARTE_H / 2 + 0.25);
  welt.ziehGruppe.add(welt.ziehBeschriftung);
}

function ziehstapelOben() {
  const hoehe = welt.ziehBlock.visible ? welt.ziehBlock.scale.y : 0;
  return {
    pos: new THREE.Vector3(ZIEH_POS.x, hoehe + 0.01, ZIEH_POS.z),
    quat: liegendeLage(0, false),
    skala: 0.94
  };
}

// Übrige Teilhände als kleine verdeckte Stapel mit Kartenzahl; beim Gegner gespiegelte Reihenfolge
function szeneTeilstapelZeigen(eigeneDecks, gegnerDecks) {
  teilstapelReihe(welt.eigeneStapelGruppe, eigeneDecks, EIGENE_STAPEL_Z, false);
  teilstapelReihe(welt.gegnerStapelGruppe, gegnerDecks, GEGNER_STAPEL_Z, true);
}

function teilstapelReihe(gruppe, decks, z, gespiegelt) {
  gruppe.clear();
  if (decks.length === 0) {
    const leer = textSprite("letzte Teilhand", 0.16);
    leer.position.set(0, 0.1, z);
    gruppe.add(leer);
    return;
  }
  const abstand = KARTE_B * TEILSTAPEL_SKALA + 0.28;
  const liste = gespiegelt ? [...decks].reverse() : decks;
  liste.forEach((deck, i) => {
    const x = (i - (liste.length - 1) / 2) * abstand;
    const hoehe = stapelHoehe(deck.length);
    const block = new THREE.Mesh(
      new THREE.BoxGeometry(KARTE_B * TEILSTAPEL_SKALA, hoehe, KARTE_H * TEILSTAPEL_SKALA),
      welt.teilstapelMaterial || welt.ziehBlock.material
    );
    block.position.set(x, hoehe / 2, z);
    block.castShadow = true;
    gruppe.add(block);
    // Kartenzahl auf der Seite zur Tischmitte hin, damit die eigene Hand sie nicht verdeckt
    const zahl = textSprite(String(deck.length), 0.15);
    const versatz = (KARTE_H * TEILSTAPEL_SKALA) / 2 + 0.16;
    zahl.position.set(x, 0.08, gespiegelt ? z + versatz : z - versatz);
    gruppe.add(zahl);
  });
}

// Beschriftung als Sprite (zeigt immer zur Kamera); gleiche Texte teilen sich die Textur
const spriteTexturen = {};

function textSprite(text, hoehe) {
  if (!spriteTexturen[text]) {
    const leinwand = document.createElement("canvas");
    const ctx = leinwand.getContext("2d");
    ctx.font = "600 44px system-ui, 'Segoe UI', sans-serif";
    const breite = Math.ceil(ctx.measureText(text).width) + 40;
    leinwand.width = breite;
    leinwand.height = 64;
    ctx.font = "600 44px system-ui, 'Segoe UI', sans-serif";
    ctx.fillStyle = "rgba(0, 0, 0, 0.45)";
    ctx.beginPath();
    ctx.roundRect ? ctx.roundRect(0, 0, breite, 64, 32) : ctx.rect(0, 0, breite, 64);
    ctx.fill();
    ctx.fillStyle = "#f4f1e6";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, breite / 2, 34);
    const textur = new THREE.CanvasTexture(leinwand);
    textur.encoding = THREE.sRGBEncoding;
    spriteTexturen[text] = { textur, verhaeltnis: breite / 64 };
  }
  const { textur, verhaeltnis } = spriteTexturen[text];
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: textur, transparent: true, depthWrite: false }));
  sprite.scale.set(hoehe * verhaeltnis, hoehe, 1);
  return sprite;
}

// ---------- Hände ----------

// Eigene Hand als Fächer an der Kamera. neueKarten: diese Karten werden unsichtbar angelegt
// (Zielplätze für die Ziehanimation) und als Liste zurückgegeben.
function szeneHandZeigen(hand, amZug, neueKarten = []) {
  welt.handGruppe.clear();
  welt.handGesperrt = !amZug;
  const offen = [...neueKarten];
  const versteckt = [];
  hand.forEach((karte, index) => {
    const k = karteErzeugen(karte, amZug ? "normal" : "gedimmt");
    k.userData.index = index;
    k.userData.hoch = 0;
    const i = offen.indexOf(karte);
    if (i !== -1) {
      offen.splice(i, 1);
      k.visible = false;
      versteckt.push(k);
    }
    welt.handGruppe.add(k);
  });
  handLayout();
  return versteckt;
}

function handLayout() {
  if (!welt.handGruppe) return;
  const karten = welt.handGruppe.children;
  const n = karten.length;
  const flaeche = sichtbareHandflaeche();
  const skala = Math.min((0.23 * flaeche.hoehe) / KARTE_H, (0.19 * flaeche.breite) / KARTE_B);
  const b = KARTE_B * skala;
  const h = KARTE_H * skala;

  // Platz für die untere Leiste (Buttons, Meldungen) freihalten. Im Querformat auf kleinen Bildschirmen
  // steht die Leiste rechts unten in der Ecke (CSS) – dann unten keinen Platz reservieren, dafür seitlich.
  const ui = document.getElementById("unteresUi");
  const seitlich = ui && getComputedStyle(ui).position === "absolute";
  const uiHoehe = ui && !seitlich ? ui.offsetHeight : 0;
  const proPixel = flaeche.hoehe / (welt.behaelter.clientHeight || window.innerHeight);
  const uiBreite = ui && seitlich ? ui.offsetWidth * proPixel : 0;
  const nutzbareBreite = flaeche.breite - 2 * uiBreite;
  // + Reserve für Neigung und Fächer-Senkung der Karten
  let mitteY = -flaeche.hoehe / 2 + (uiHoehe + (seitlich ? 14 : 34)) * proPixel + h / 2;

  const abstand = n > 1 ? Math.min(b * 0.72, (nutzbareBreite * 0.94 - b) / (n - 1)) : 0;
  const winkel = Math.min(4, 36 / Math.max(n, 1));

  // Äußere Karten hängen tiefer und sind gedreht – ihre unteren Ecken sollen nicht unter die Leiste rutschen
  const aussen = (n - 1) / 2;
  const randWinkel = THREE.MathUtils.degToRad(aussen * winkel);
  const senkungAussen = aussen * aussen * winkel * 0.0035 * skala;
  const eckeTiefer = (b / 2) * Math.sin(randWinkel) - (h / 2) * (1 - Math.cos(randWinkel));
  mitteY += senkungAussen + Math.max(0, eckeTiefer);

  // Alle Karten sind gleich nach hinten gekippt (NEIGUNG), liegen also in parallelen Ebenen.
  // Damit jede Karte sicher vor der vorigen liegt, wird der Tiefenabstand entlang der gekippten
  // Kartennormale gerechnet – sonst rutschen die tiefer hängenden äußeren Karten rechts hinter ihre Nachbarn.
  const NEIGUNG = 0.12;
  const normaleY = Math.sin(NEIGUNG);
  const normaleZ = Math.cos(NEIGUNG);
  const ebenenAbstand = 0.004;

  karten.forEach((karte, i) => {
    const versatz = i - (n - 1) / 2;
    const y = mitteY - versatz * versatz * winkel * 0.0035 * skala;
    const z = -HAND_ABSTAND + (i * ebenenAbstand - normaleY * (y - mitteY)) / normaleZ;
    karte.scale.setScalar(skala);
    karte.userData.basis = new THREE.Vector3(versatz * abstand, y, z);
    karte.userData.hubHoehe = h * 0.16;
    karte.rotation.set(-NEIGUNG, 0, THREE.MathUtils.degToRad(-versatz * winkel));
    karte.position.copy(karte.userData.basis);
  });
}

// Gegnerfächer: anzahl Rückseiten; die letzten `neu` bleiben unsichtbar (Zielplätze fürs Ziehen)
function szeneGegnerHandZeigen(anzahl, neu = 0) {
  const faecher = welt.gegnerFaecher;
  faecher.clear();
  const versteckt = [];
  const anordnung = gegnerFaecherAnordnung(anzahl);
  welt.gegnerHandZiele = anordnung.haende;

  anordnung.karten.forEach((platz, i) => {
    const k = karteErzeugen(null);
    k.scale.setScalar(GEGNER_KARTEN_SKALA);
    // Die Fächergruppe ist um 180° gedreht: lokales x = −Bildschirm-x, lokales −z = zu uns hin,
    // und eine Drehung um z erscheint von vorn gesehen umgekehrt – deshalb auch die Neigung spiegeln
    k.position.set(-platz.x, platz.y, -platz.z);
    k.rotation.z = THREE.MathUtils.degToRad(-platz.dreh);
    schattenWerfen(k, true);
    if (i >= anzahl - neu) {
      k.visible = false;
      versteckt.push(k);
    }
    faecher.add(k);
  });
  return versteckt;
}

// Wie das Strichmännchen seine Karten hält – je nach Anzahl:
//   bis 6:   ein echter Fächer in einer Hand, die andere Hand ruht auf der Tischkante
//   7 – 16:  zwei Fächer, einer in jeder Hand
//   ab 17:   eine "Wand" aus mehreren Fächern übereinander (bis vors Gesicht), beide Hände halten die unterste Reihe
// Koordinaten in Bildschirmsicht (x nach rechts, z zu uns hin), relativ zur Fächergruppe.
// dreh in Grad (positiv = gegen den Uhrzeigersinn aus unserer Sicht).
function gegnerFaecherAnordnung(anzahl) {
  const kartenH = KARTE_H * GEGNER_KARTEN_SKALA;
  const radius = kartenH * 0.42; // Drehpunkt knapp über der Unterkante der Karten
  const faecherListe = []; // { x, y, z, neigung, anzahl }
  let haende;

  if (anzahl <= 6) {
    faecherListe.push({ x: 0.12, y: -0.32, z: 0, neigung: 0, anzahl });
    haende = {
      rechts: new THREE.Vector3(0.12, -0.36, -0.1), // hält den Fächer (hinter den Karten)
      links: new THREE.Vector3(-0.42, -0.74, 0.18) // ruht auf der Tischkante
    };
  } else if (anzahl <= 16) {
    const links = Math.ceil(anzahl / 2);
    faecherListe.push({ x: -0.42, y: -0.32, z: 0, neigung: 9, anzahl: links });
    faecherListe.push({ x: 0.42, y: -0.32, z: 0, neigung: -9, anzahl: anzahl - links });
    haende = {
      links: new THREE.Vector3(-0.42, -0.36, -0.1),
      rechts: new THREE.Vector3(0.42, -0.36, -0.1)
    };
  } else {
    // Wand: 2 Spalten, so viele Reihen wie nötig (höchstens 4), untere Reihen vorne
    const reihen = Math.min(4, Math.ceil(anzahl / 14));
    const anzahlFaecher = reihen * 2;
    let rest = anzahl;
    for (let r = 0; r < reihen; r++) {
      for (const seite of [-1, 1]) {
        const uebrigeFaecher = anzahlFaecher - faecherListe.length;
        const hier = Math.ceil(rest / uebrigeFaecher);
        rest -= hier;
        faecherListe.push({
          x: seite * 0.36 + (r % 2 ? seite * 0.08 : 0),
          y: -0.32 + r * 0.4,
          z: -r * 0.05, // höhere Reihen liegen weiter hinten
          neigung: -seite * (6 + r * 3),
          anzahl: hier
        });
      }
    }
    haende = {
      links: new THREE.Vector3(-0.36, -0.36, -0.12),
      rechts: new THREE.Vector3(0.36, -0.36, -0.12)
    };
  }

  // Karten auf die Fächer verteilen: jeder Fächer dreht seine Karten um einen gemeinsamen Drehpunkt
  const karten = [];
  let ebene = 0;
  for (const f of faecherListe) {
    const schritt = f.anzahl > 1 ? Math.min(13, 72 / f.anzahl) : 0;
    for (let i = 0; i < f.anzahl; i++) {
      const winkel = f.neigung + (i - (f.anzahl - 1) / 2) * -schritt;
      const rad = THREE.MathUtils.degToRad(winkel);
      karten.push({
        x: f.x - Math.sin(rad) * radius,
        y: f.y + Math.cos(rad) * radius,
        z: f.z + (ebene++) * 0.004, // spätere Karten liegen vorne
        dreh: winkel
      });
    }
  }
  return { karten, haende };
}

// Startlagen der Karten, die gleich gelegt werden (bevor die Hände neu gezeichnet werden)
function szeneStartLagen(karte, anzahl, vonOben) {
  if (vonOben) {
    return welt.gegnerFaecher.children.slice(-anzahl).map(weltLage);
  }
  return welt.handGruppe.children
    .filter(k => k.userData.karte === karte)
    .slice(0, anzahl)
    .map(weltLage);
}

function szeneHandLeeren() {
  welt.handGruppe.clear();
}

// ---------- Animationen ----------

function animieren(ms, schritt) {
  if (!ms) {
    schritt(1);
    return Promise.resolve();
  }
  return new Promise(fertig => {
    welt.animationen.add({ start: performance.now(), ms, schritt, fertig });
  });
}

function animationenFortschreiben(jetzt) {
  for (const a of [...welt.animationen]) {
    const t = Math.min(1, (jetzt - a.start) / a.ms);
    a.schritt(t);
    if (t >= 1) {
      welt.animationen.delete(a);
      a.fertig();
    }
  }
}

const sanft = t => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

function warteMs(ms) {
  return ms > 0 ? new Promise(fertig => setTimeout(fertig, ms)) : Promise.resolve();
}

// Karte fliegt im Bogen von einer Lage zur anderen (Position, Drehung und Größe werden überblendet).
// wirbel: zusätzliche volle Drehungen um die Hochachse (für SKIBIDI); am Ende wieder exakt in Ziellage.
async function flug(karteObjekt, von, nach, ms, bogenHoehe, verzoegerung = 0, wirbel = 0) {
  karteObjekt.position.copy(von.pos);
  karteObjekt.quaternion.copy(von.quat);
  karteObjekt.scale.setScalar(von.skala);
  karteObjekt.visible = false;
  schattenWerfen(karteObjekt, true);
  welt.szene.add(karteObjekt);
  await warteMs(verzoegerung);
  karteObjekt.visible = true;
  await animieren(ms, t => {
    const e = sanft(t);
    karteObjekt.position.lerpVectors(von.pos, nach.pos, e);
    karteObjekt.position.y += Math.sin(Math.PI * e) * bogenHoehe;
    karteObjekt.quaternion.slerpQuaternions(von.quat, nach.quat, e);
    if (wirbel) karteObjekt.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(ACHSE_Y, wirbel * Math.PI * 2 * e));
    karteObjekt.scale.setScalar(von.skala + (nach.skala - von.skala) * e);
  });
  welt.szene.remove(karteObjekt);
}

// Gelegte Karten fliegen aus der Hand (oder aus dem Gegnerfächer, dann drehen sie sich um) auf die Ablage.
// skibidi: Karten wirbeln im Flug, danach Konfetti über der Ablage.
async function szeneLegeAnimation(karte, startLagen, erstePosition, gesamt, skibidi = false) {
  await Promise.all(
    startLagen.map((start, i) =>
      flug(
        karteErzeugen(karte),
        start,
        ablageZiel(erstePosition + i, gesamt),
        dauer(skibidi ? 760 : 520),
        skibidi ? 1.4 : 0.9,
        dauer(i * (skibidi ? 140 : 110)),
        skibidi ? (i % 2 ? -1 : 1) : 0
      )
    )
  );
  if (skibidi) szeneKonfetti(); // läuft weiter, während das Spiel fortfährt
}

// Konfetti-Wolke über der Ablage: kleine bunte Blättchen fliegen hoch, trudeln und fallen
const konfettiGeometrie = new THREE.PlaneGeometry(0.07, 0.11);
const KONFETTI_FARBEN = [0xf2c14e, 0xe6453a, 0x2f9e5b, 0x3a7be6, 0xf4f1e6, 0xb84fd1];

function szeneKonfetti() {
  const ms = dauer(1800);
  if (!ms) return;
  const teile = [];
  for (let i = 0; i < 90; i++) {
    const teil = new THREE.Mesh(
      konfettiGeometrie,
      new THREE.MeshBasicMaterial({
        color: KONFETTI_FARBEN[i % KONFETTI_FARBEN.length],
        side: THREE.DoubleSide,
        transparent: true
      })
    );
    const winkel = Math.random() * Math.PI * 2;
    const tempo = 1.2 + Math.random() * 1.8;
    teil.userData = {
      start: ABLAGE_POS.clone().add(new THREE.Vector3(0, 0.15, 0)),
      geschwindigkeit: new THREE.Vector3(Math.cos(winkel) * tempo * 0.6, 3 + Math.random() * 2.5, Math.sin(winkel) * tempo * 0.6),
      drall: new THREE.Vector3(Math.random() * 12, Math.random() * 12, Math.random() * 12)
    };
    welt.szene.add(teil);
    teile.push(teil);
  }
  animieren(ms, t => {
    const s = (t * ms) / 1000; // Sekunden seit Start
    for (const teil of teile) {
      const { start, geschwindigkeit, drall } = teil.userData;
      teil.position.set(
        start.x + geschwindigkeit.x * s,
        Math.max(0.01, start.y + geschwindigkeit.y * s - 4.9 * s * s),
        start.z + geschwindigkeit.z * s
      );
      teil.rotation.set(drall.x * s, drall.y * s, drall.z * s);
      teil.material.opacity = t < 0.75 ? 1 : 1 - (t - 0.75) / 0.25;
    }
  }).then(() => {
    for (const teil of teile) {
      welt.szene.remove(teil);
      teil.material.dispose();
    }
  });
}

// Gezogene Karten fliegen vom Ziehstapel auf ihre (unsichtbar angelegten) Plätze in der Hand
async function szeneZiehAnimation(karten, zielObjekte, nachOben) {
  const start = ziehstapelOben();
  const schritt = Math.min(150, 1100 / Math.max(karten.length, 1));
  await Promise.all(
    zielObjekte.map((ziel, i) =>
      flug(karteErzeugen(nachOben ? null : karten[i]), start, weltLage(ziel), dauer(560), 0.7, dauer(i * schritt)).then(
        () => {
          ziel.visible = true;
        }
      )
    )
  );
}

// PvP: eigene Hand sinkt nach unten weg, neu zeichnen, neue Hand steigt auf
async function szeneHandWechsel(neuZeichnen) {
  const hoehe = sichtbareHandflaeche().hoehe;
  await animieren(dauer(260), t => {
    welt.handGruppe.position.y = -hoehe * 0.5 * sanft(t);
  });
  neuZeichnen();
  await animieren(dauer(340), t => {
    welt.handGruppe.position.y = -hoehe * 0.5 * (1 - sanft(t));
  });
  welt.handGruppe.position.y = 0;
}

// Frisch gezogene Karten in der eigenen Hand kurz aufleuchten lassen
function szeneMarkiereNeueKarten(karten) {
  const offen = [...karten];
  for (const k of welt.handGruppe.children) {
    const i = offen.indexOf(k.userData.karte);
    if (i === -1) continue;
    offen.splice(i, 1);
    k.userData.vorne.material = kartenMaterial(bildName(k.userData.karte), "leuchtend");
  }
}

// ---------- Strichmännchen bewegen ----------

const UNTEN = new THREE.Vector3(0, -1, 0);

// Zwei-Gelenk-IK: Hand des Arms zum Zielpunkt (Weltkoordinaten), Ellbogen zeigt nach außen/unten
function armZumZiel(arm, zielWelt) {
  const eltern = arm.schulter.parent;
  eltern.updateWorldMatrix(true, false);
  const schulter = arm.schulter.position.clone();
  const ziel = eltern.worldToLocal(zielWelt.clone());
  const zurZiel = ziel.clone().sub(schulter);
  const d = THREE.MathUtils.clamp(zurZiel.length(), Math.abs(arm.a - arm.b) + 0.001, arm.a + arm.b - 0.001);
  const richtung = zurZiel.normalize();
  const alpha = Math.acos(THREE.MathUtils.clamp((arm.a * arm.a + d * d - arm.b * arm.b) / (2 * arm.a * d), -1, 1));
  // Richtung, in die der Ellbogen zeigt: normalerweise nach außen/unten; Gesten können das überschreiben (arm.pol)
  const pol = (arm.pol || new THREE.Vector3(arm.seite, -0.7, -0.4)).clone().normalize();
  const achse = new THREE.Vector3().crossVectors(richtung, pol);
  if (achse.lengthSq() < 1e-6) achse.set(0, 0, 1);
  achse.normalize();
  const oberRichtung = richtung.clone().applyAxisAngle(achse, alpha);
  const ellbogen = schulter.clone().addScaledVector(oberRichtung, arm.a);
  const unterRichtung = ziel.clone().sub(ellbogen).normalize();

  const qOber = new THREE.Quaternion().setFromUnitVectors(UNTEN, oberRichtung);
  const qUnter = new THREE.Quaternion().setFromUnitVectors(UNTEN, unterRichtung);
  arm.schulter.quaternion.copy(qOber);
  arm.ellbogen.quaternion.copy(qOber.clone().invert().multiply(qUnter));
}

function figurAktualisieren(jetzt) {
  if (!welt.figur) return;
  // Kopf wippt beim Überlegen, sonst langsam zurück in die Mitte
  const kopfZiel = welt.denkt ? Math.sin(jetzt / 190) * 0.14 : 0;
  welt.kopf.rotation.z += (kopfZiel - welt.kopf.rotation.z) * 0.15;

  // Verloren: Kopf hängt, Oberkörper sackt nach vorn
  const kopfNicken = welt.traurig ? 0.6 : 0;
  welt.kopf.rotation.x += (kopfNicken - welt.kopf.rotation.x) * 0.06;
  if (welt.traurig) welt.huefte.rotation.x += (0.28 - welt.huefte.rotation.x) * 0.05;

  // Flamme des Feuerzeugs sitzt über der linken Hand und flackert
  if (welt.flamme && welt.flamme.visible) {
    const hand = welt.armLinks.ellbogen.localToWorld(new THREE.Vector3(0, -welt.armLinks.b, 0));
    welt.flamme.position.copy(hand).add(new THREE.Vector3(0, 0.1, 0));
    welt.flamme.scale.set(1, 0.8 + Math.random() * 0.5, 1);
  }
  const dt = welt.letzteZeit ? Math.min(0.1, (jetzt - welt.letzteZeit) / 1000) : 0;
  welt.letzteZeit = jetzt;
  rauchAktualisieren(jetzt, dt);

  for (const arm of [welt.armLinks, welt.armRechts]) {
    // Ruhe: Hände an den unteren Ecken des Fächers, hinter den Karten (lokal +z zeigt wegen der
    // 180°-Drehung des Fächers von uns weg), damit sie nicht durch die Karten scheinen
    // Ziel aus der aktuellen Fächer-Anordnung (Bildschirmsicht → lokal: x und z spiegeln)
    const ziele = welt.gegnerHandZiele || {
      links: new THREE.Vector3(-0.27, -0.3, -0.1),
      rechts: new THREE.Vector3(0.27, -0.3, -0.1)
    };
    const z = arm.seite < 0 ? ziele.links : ziele.rechts;
    const ruhe = welt.gegnerFaecher.localToWorld(new THREE.Vector3(-z.x, z.y, -z.z));
    const ziel = ruhe.lerp(arm.greifZiel, arm.greifAnteil);
    armZumZiel(arm, ziel);
  }
}

// Greifen zur Ablage (rechter Arm) oder zum Ziehstapel (linker Arm): vorbeugen, Arm ausstrecken, zurück
function figurGreift(ziel, dauerMs = 760) {
  const zurAblage = ziel === "ablage";
  const arm = zurAblage ? welt.armRechts : welt.armLinks;
  arm.greifZiel.copy(zurAblage ? ABLAGE_POS : ZIEH_POS).add(new THREE.Vector3(0, 0.25, 0));
  const plateau = t => (t < 0.4 ? sanft(t / 0.4) : t < 0.6 ? 1 : sanft((1 - t) / 0.4));
  return animieren(dauer(dauerMs), t => {
    const k = plateau(t);
    arm.greifAnteil = k;
    welt.huefte.rotation.x = 0.38 * k;
  }).then(() => {
    arm.greifAnteil = 0;
    welt.huefte.rotation.x = 0;
  });
}

function figurDenkt(anAus) {
  welt.denkt = anAus;
}

// ---------- Spielende: Emotes und Enttäuschung ----------

// Verlierer: Oberkörper sackt etwas nach vorn, Kopf hängt (läuft weich in figurAktualisieren)
function szeneFigurTraurig(anAus) {
  welt.traurig = anAus;
}

// Alles zurück auf Anfang (neue Runde)
function szeneFigurZuruecksetzen() {
  welt.traurig = false;
  if (welt.gesicht) {
    welt.gesicht.basis = "neutral";
    welt.gesicht.temporaer = null;
  }
  welt.emoteLaeuft = false;
  welt.rauchAktiv = false;
  welt.huefte.position.y = -0.35;
  welt.huefte.rotation.set(0, 0, 0);
  welt.kopf.rotation.set(0, 0, 0);
  welt.gegnerFaecher.visible = true;
  for (const arm of [welt.armLinks, welt.armRechts]) {
    arm.greifAnteil = 0;
    arm.pol = null;
    fingerKruemmen(arm.hand, 0);
  }
  if (welt.kippe) {
    welt.kippe.parent.remove(welt.kippe);
    welt.kippe = null;
  }
  if (welt.flamme) welt.flamme.visible = false;
}

function szeneEmote(art) {
  if (welt.emoteLaeuft) return Promise.resolve();
  welt.emoteLaeuft = true;
  let ablauf;
  if (art === "kippe") {
    welt.traurig = false;
    szeneAusdruck("frech", 7000);
    ablauf = kippeAnzuenden();
  } else if (art === "salto") {
    welt.traurig = false;
    szeneAusdruck("jubel", 2200);
    ablauf = rueckwaertssalto();
  } else if (art === "mittelfinger") {
    welt.traurig = false;
    szeneAusdruck("frech", 3200);
    ablauf = mittelfingerZeigen();
  } else {
    ablauf = kurzesEmote(art);
  }
  return ablauf.then(() => {
    welt.emoteLaeuft = false;
  });
}

// Emotes während des Spiels: Gesicht + Geste, ca. 1,8 s
async function kurzesEmote(art) {
  const huefte = welt.huefte;
  const kopf = welt.kopf;
  const rechts = welt.armRechts;
  const links = welt.armLinks;
  const ausdruck = { winken: "gluecklich", lachen: "lachen", wuetend: "wuetend", frech: "frech", schock: "schock" }[art] || "gluecklich";
  szeneAusdruck(ausdruck, 2200);
  const ms = dauer(1800);
  const huelle = t => (t < 0.15 ? sanft(t / 0.15) : t > 0.85 ? sanft((1 - t) / 0.15) : 1); // rein, halten, raus
  const zeit = t => (t * ms) / 1000;

  await animieren(ms, t => {
    const k = huelle(t);
    const s = zeit(t);
    switch (art) {
      case "winken": // rechter Arm hoch, Hand wedelt hin und her
        rechts.greifZiel.copy(huefte.localToWorld(new THREE.Vector3(0.75 + Math.sin(s * 14) * 0.18, 2.45, 0.25)));
        rechts.greifAnteil = k;
        kopf.rotation.z = Math.sin(s * 7) * 0.08 * k;
        break;
      case "lachen": // Oberkörper und Kopf wackeln vor Lachen
        kopf.rotation.x = (Math.sin(s * 22) * 0.1 - 0.1) * k;
        huefte.rotation.z = Math.sin(s * 11) * 0.05 * k;
        break;
      case "wuetend": // Faust hoch und schütteln
        rechts.greifZiel.copy(huefte.localToWorld(new THREE.Vector3(0.5, 2.25 + Math.sin(s * 26) * 0.08, 0.4)));
        rechts.greifAnteil = k;
        huefte.rotation.x = 0.12 * k;
        break;
      case "frech": // Kopf schief, leicht zurücklehnen
        kopf.rotation.z = 0.28 * k;
        huefte.rotation.x = -0.1 * k;
        break;
      case "schock": // Hände an den Kopf, zurückweichen
        rechts.greifZiel.copy(huefte.localToWorld(new THREE.Vector3(0.36, 2.3, 0.12)));
        links.greifZiel.copy(huefte.localToWorld(new THREE.Vector3(-0.36, 2.3, 0.12)));
        rechts.greifAnteil = k;
        links.greifAnteil = k;
        huefte.rotation.x = -0.18 * k;
        break;
    }
  });
  rechts.greifAnteil = 0;
  links.greifAnteil = 0;
  kopf.rotation.set(0, 0, 0);
  huefte.rotation.set(0, 0, 0);
}

// Rückwärtssalto: aus dem Stuhl hochspringen, sich einmal rückwärts überschlagen, landen
async function rueckwaertssalto() {
  const huefte = welt.huefte;
  const armeHoch = seite => huefte.localToWorld(new THREE.Vector3(0.75 * seite, 2.7, 0.1));
  welt.gegnerFaecher.visible = false;

  // Ausholen: kurz in die Knie (nach unten) und Arme hoch
  await animieren(dauer(350), t => {
    huefte.position.y = -0.35 - 0.25 * sanft(t);
    for (const arm of [welt.armLinks, welt.armRechts]) {
      arm.greifZiel.copy(armeHoch(arm.seite));
      arm.greifAnteil = sanft(t);
    }
  });
  // Sprung mit Überschlag (Rotation um die Hüfte, Oberkörper kippt zuerst nach hinten)
  await animieren(dauer(1100), t => {
    huefte.position.y = -0.6 + 2.4 * 4 * t * (1 - t);
    huefte.rotation.x = -Math.PI * 2 * sanft(t);
  });
  huefte.rotation.x = 0;
  // Landen und Arme runter
  await animieren(dauer(450), t => {
    huefte.position.y = -0.6 + 0.25 * sanft(t);
    for (const arm of [welt.armLinks, welt.armRechts]) arm.greifAnteil = 1 - sanft(t);
  });
  huefte.position.y = -0.35;
  welt.gegnerFaecher.visible = true;
}

// Mittelfinger: rechte Hand nach vorn hoch (Unterarm steht, Finger zeigt nach oben), restliche Finger zur Faust,
// dazu leicht nach vorn beugen
async function mittelfingerZeigen() {
  const rechts = welt.armRechts;
  const huefte = welt.huefte;
  // Ziel seitlich neben dem Kopf und über dem Ellbogen, damit der Unterarm (und damit der Finger) nach oben zeigt
  const ziel = () => huefte.localToWorld(new THREE.Vector3(0.46, 2.3, 0.5));
  rechts.pol = new THREE.Vector3(0.15, -1, 0.1); // Ellbogen nach unten → Unterarm senkrecht
  await animieren(dauer(450), t => {
    const k = sanft(t);
    rechts.greifZiel.copy(ziel());
    rechts.greifAnteil = k;
    fingerKruemmen(rechts.hand, k, 1);
    huefte.rotation.x = 0.12 * k;
  });
  // Halten, mit kleinem Nachdruck-Wippen
  await animieren(dauer(1900), t => {
    rechts.greifZiel.copy(ziel()).add(new THREE.Vector3(0, Math.sin(t * Math.PI * 6) * 0.03, 0));
  });
  await animieren(dauer(450), t => {
    const k = 1 - sanft(t);
    rechts.greifAnteil = k;
    fingerKruemmen(rechts.hand, k, 1);
    huefte.rotation.x = 0.12 * k;
  });
  fingerKruemmen(rechts.hand, 0);
  rechts.pol = null;
}

// Kippe anzünden: Zigarette zum Mund, Feuerzeug dran, Flamme, Glut, Rauch – danach raucht er weiter
async function kippeAnzuenden() {
  const rechts = welt.armRechts;
  const links = welt.armLinks;
  if (!welt.kippe) {
    const kippe = new THREE.Group();
    const papier = new THREE.Mesh(
      new THREE.CylinderGeometry(0.025, 0.025, 0.3, 10),
      new THREE.MeshStandardMaterial({ color: 0xf4f1e6, roughness: 0.8 })
    );
    const filter = new THREE.Mesh(
      new THREE.CylinderGeometry(0.026, 0.026, 0.09, 10),
      new THREE.MeshStandardMaterial({ color: 0xd08a3a, roughness: 0.8 })
    );
    filter.position.y = -0.18;
    const glut = new THREE.Mesh(
      new THREE.CylinderGeometry(0.027, 0.027, 0.03, 10),
      new THREE.MeshStandardMaterial({ color: 0x552200, emissive: 0x000000 })
    );
    glut.position.y = 0.16;
    kippe.add(papier, filter, glut);
    kippe.userData.glut = glut;
    // in die rechte Hand, quer zum Unterarm
    kippe.position.set(0, -rechts.b, 0.05);
    kippe.rotation.set(0, 0, Math.PI / 2);
    rechts.ellbogen.add(kippe);
    welt.kippe = kippe;
  }
  if (!welt.flamme) {
    const flamme = new THREE.Mesh(
      new THREE.ConeGeometry(0.035, 0.11, 10),
      new THREE.MeshBasicMaterial({ color: 0xffa020 })
    );
    const licht = new THREE.PointLight(0xff9a30, 0.8, 1.6);
    flamme.add(licht);
    welt.szene.add(flamme);
    welt.flamme = flamme;
  }
  const mund = () => welt.huefte.localToWorld(new THREE.Vector3(0.12, 2.18, 0.34));
  const neben = () => welt.huefte.localToWorld(new THREE.Vector3(0.36, 2.12, 0.42));

  // Zigarette zum Mund
  await animieren(dauer(800), t => {
    rechts.greifZiel.copy(mund());
    rechts.greifAnteil = sanft(t);
  });
  // Feuerzeug ran, Flamme flackert
  await animieren(dauer(700), t => {
    links.greifZiel.copy(neben());
    links.greifAnteil = sanft(t);
  });
  welt.flamme.visible = true;
  await animieren(dauer(1100), t => {
    welt.kippe.userData.glut.material.emissive.setRGB(1, 0.35 * t, 0).multiplyScalar(t);
  });
  welt.flamme.visible = false;
  // Feuerzeug weg, zurücklehnen, ausatmen
  welt.rauchAktiv = true;
  await animieren(dauer(900), t => {
    links.greifAnteil = 1 - sanft(t);
    rechts.greifAnteil = 1 - 0.45 * sanft(t);
    welt.huefte.rotation.x = -0.12 * sanft(t);
  });
}

// Rauchwölkchen: steigen auf, wachsen und verblassen
const rauchGeometrie = new THREE.SphereGeometry(1, 10, 8);
const rauchTeile = [];
let naechsterRauch = 0;

function rauchAktualisieren(jetzt, dt) {
  if (welt.rauchAktiv && welt.kippe && jetzt > naechsterRauch && dauer(1)) {
    naechsterRauch = jetzt + 160 + Math.random() * 200;
    const quelle = welt.kippe.userData.glut.getWorldPosition(new THREE.Vector3());
    const teil = new THREE.Mesh(
      rauchGeometrie,
      new THREE.MeshBasicMaterial({ color: 0xcfcfcf, transparent: true, opacity: 0.45, depthWrite: false })
    );
    teil.position.copy(quelle);
    teil.userData = { alter: 0, drift: (Math.random() - 0.5) * 0.25 };
    teil.scale.setScalar(0.03);
    welt.szene.add(teil);
    rauchTeile.push(teil);
  }
  for (let i = rauchTeile.length - 1; i >= 0; i--) {
    const teil = rauchTeile[i];
    teil.userData.alter += dt;
    const a = teil.userData.alter;
    teil.position.y += dt * 0.45;
    teil.position.x += dt * teil.userData.drift;
    teil.scale.setScalar(0.03 + a * 0.09);
    teil.material.opacity = Math.max(0, 0.45 * (1 - a / 2.2));
    if (a > 2.2) {
      welt.szene.remove(teil);
      teil.material.dispose();
      rauchTeile.splice(i, 1);
    }
  }
}

// ---------- Zeiger: Hover und Klick ----------

const zeiger = new THREE.Vector2();
const strahl = new THREE.Raycaster();

function trefferBestimmen(ereignis) {
  const rect = welt.renderer.domElement.getBoundingClientRect();
  zeiger.set(((ereignis.clientX - rect.left) / rect.width) * 2 - 1, -((ereignis.clientY - rect.top) / rect.height) * 2 + 1);
  strahl.setFromCamera(zeiger, welt.kamera);

  const handTreffer = strahl.intersectObjects(welt.handGruppe.children, true).find(t => t.object.parent.visible);
  if (handTreffer) return { art: "hand", index: handTreffer.object.parent.userData.index };

  if (strahl.intersectObject(welt.ziehGruppe, true).length) return { art: "stapel" };
  return null;
}

function zeigerBewegt(ereignis) {
  const treffer = trefferBestimmen(ereignis);
  const klickbar = typeof handKlickbar === "function" && handKlickbar();
  welt.hoverIndex = treffer && treffer.art === "hand" && klickbar ? treffer.index : -1;
  welt.hoverStapel = !!(treffer && treffer.art === "stapel" && klickbar);
  welt.renderer.domElement.style.cursor = welt.hoverIndex !== -1 || welt.hoverStapel ? "pointer" : "default";
}

function geklickt(ereignis) {
  const treffer = trefferBestimmen(ereignis);
  if (!treffer) return;
  if (treffer.art === "hand") handKarteGeklickt(treffer.index);
  else if (treffer.art === "stapel") karteZiehen();
}

function handHoverAktualisieren() {
  for (const k of welt.handGruppe.children) {
    if (!k.userData.basis) continue;
    const ziel = k.userData.index === welt.hoverIndex ? 1 : 0;
    k.userData.hoch += (ziel - k.userData.hoch) * 0.25;
    k.position.y = k.userData.basis.y + k.userData.hoch * k.userData.hubHoehe;
    k.position.z = k.userData.basis.z + k.userData.hoch * 0.05;
  }
  // Ziehstapel leuchtet leicht, wenn man darauf zeigt
  const oben = welt.ziehBlock.material[2];
  if (oben && oben.emissive) oben.emissive.setHex(welt.hoverStapel ? 0x332200 : 0x000000);
}

// ---------- Schleife ----------

function schleife(jetzt) {
  requestAnimationFrame(schleife);
  animationenFortschreiben(jetzt);
  figurAktualisieren(jetzt);
  gesichtAktualisieren(jetzt);
  wunschAktualisieren(jetzt);
  handHoverAktualisieren();
  welt.renderer.render(welt.szene, welt.kamera);
}
