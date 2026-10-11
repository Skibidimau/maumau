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
  einrichtungAufbauen();

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

// Raum "über Eck": zwei Wände treffen sich hinter dem Gegenüber rechts in einer Ecke. welt.raum hat den
// Ursprung in der Ecke und ist um 30° gedreht: Wand 1 liegt bei lokal z = 0 (nach links, x < 0), Wand 2 bei
// lokal x = 0 (nach vorn, z > 0); der Raum ist lokal x < 0, z > 0. Sachen an den Wänden setzt anWand().
const RAUM_ECKE = new THREE.Vector3(2.45, 0, -7.76);
const RAUM_DREHUNG = Math.PI / 6;

function anWand(objekt, wand, entlang, y, abstand = 0.02) {
  if (wand === 1) {
    objekt.position.set(-entlang, y, abstand);
    objekt.rotation.y = 0;
  } else {
    objekt.position.set(-abstand, y, entlang);
    objekt.rotation.y = -Math.PI / 2;
  }
  welt.raum.add(objekt);
  return objekt;
}

function raumAufbauen() {
  const raum = new THREE.Group();
  raum.position.copy(RAUM_ECKE);
  raum.rotation.y = RAUM_DREHUNG;
  welt.szene.add(raum);
  welt.raum = raum;

  const wandFarbe = (farbe) => new THREE.MeshStandardMaterial({ color: farbe, roughness: 0.95 });
  const wand1 = new THREE.Mesh(new THREE.PlaneGeometry(30, 16), wandFarbe(0xcdbfa8));
  wand1.position.set(-15, 5, 0);
  wand1.receiveShadow = true;
  const wand2 = new THREE.Mesh(new THREE.PlaneGeometry(30, 16), wandFarbe(0xc2b49c)); // etwas dunkler: Ecke sichtbar
  wand2.position.set(0, 5, 15);
  wand2.rotation.y = -Math.PI / 2;
  wand2.receiveShadow = true;
  raum.add(wand1, wand2);

  const boden = new THREE.Mesh(
    new THREE.PlaneGeometry(40, 30),
    new THREE.MeshStandardMaterial({ color: 0x4a3a2c, roughness: 0.9 })
  );
  boden.rotation.x = -Math.PI / 2;
  boden.position.y = -1.6;
  boden.receiveShadow = true;

  welt.szene.add(boden);
}

// Filzfläche des Tisches (Breite × Tiefe); Holzrand und Unterbau kommen außen dazu
const TISCH_BREITE = 8.8;
const TISCH_TIEFE = 5.2;
const TISCH_RAND = 0.3;

function tischAufbauen() {
  const holz = new THREE.MeshStandardMaterial({ color: 0x5a3a1e, roughness: 0.7 });
  const filz = new THREE.MeshStandardMaterial({ color: 0x2f8a4e, roughness: 0.95 });
  const b = TISCH_BREITE;
  const t = TISCH_TIEFE;
  const r = TISCH_RAND;

  const platte = new THREE.Mesh(new THREE.BoxGeometry(b, 0.12, t), filz);
  platte.position.y = -0.06;
  platte.receiveShadow = true;

  const unterbau = new THREE.Mesh(new THREE.BoxGeometry(b + 2 * r, 0.2, t + 2 * r), holz);
  unterbau.position.y = -0.2;
  unterbau.castShadow = true;
  unterbau.receiveShadow = true;

  const tisch = new THREE.Group();
  tisch.add(platte, unterbau);

  // erhöhter Holzrand
  const rand = [
    [b + 2 * r, r, 0, t / 2 + r / 2],
    [b + 2 * r, r, 0, -t / 2 - r / 2],
    [r, t, b / 2 + r / 2, 0],
    [r, t, -b / 2 - r / 2, 0]
  ];
  for (const [breite, tiefe, x, z] of rand) {
    const leiste = new THREE.Mesh(new THREE.BoxGeometry(breite, 0.16, tiefe), holz);
    leiste.position.set(x, 0.02, z);
    leiste.castShadow = true;
    leiste.receiveShadow = true;
    tisch.add(leiste);
  }

  for (const x of [-(b / 2 - 0.4), b / 2 - 0.4]) {
    for (const z of [-(t / 2 - 0.4), t / 2 - 0.4]) {
      const bein = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.1, 1.3, 12), holz);
      bein.position.set(x, -0.95, z);
      bein.castShadow = true;
      tisch.add(bein);
    }
  }
  welt.szene.add(tisch);
}

// ---------- Einrichtung: Bilder, Pflanze, Katze, Aschenbecher ----------

function einrichtungAufbauen() {
  raumAusstatten();
  bilderAufhaengen();
  pflanzeAufstellen();
  katzeHinlegen();
  leckerliPackungAufstellen();
  aschenbecherAufstellen();
}

// Was man vom Raum rundherum sieht: Fußleisten, Teppich, Fenster mit Nachthimmel und Vorhängen an Wand 1 (links),
// Bücherregal und Stehlampe an Wand 2 (rechts). Boden bei y = −1.6; Wandplätze über anWand().
function raumAusstatten() {
  const BODEN_Y = -1.6;
  const holzDunkel = new THREE.MeshStandardMaterial({ color: 0x4a2f19, roughness: 0.7 });
  const weissLack = new THREE.MeshStandardMaterial({ color: 0xece6da, roughness: 0.5 });
  const kasten = (b, h, t, material, x, y, z, eltern = welt.szene) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(b, h, t), material);
    m.position.set(x, y, z);
    m.castShadow = true;
    m.receiveShadow = true;
    eltern.add(m);
    return m;
  };

  // Fußleisten an beiden Wänden
  anWand(kasten(30, 0.18, 0.05, weissLack, 0, 0, 0), 1, 15, BODEN_Y + 0.09, 0.03);
  anWand(kasten(30, 0.18, 0.05, weissLack, 0, 0, 0), 2, 15, BODEN_Y + 0.09, 0.03);

  // Teppich unter dem Tisch
  const teppichTextur = gemaeldeTextur((ctx, b, h) => {
    ctx.fillStyle = "#7a2630";
    ctx.fillRect(0, 0, b, h);
    ctx.strokeStyle = "#d9b26a";
    ctx.lineWidth = 10;
    ctx.strokeRect(22, 22, b - 44, h - 44);
    ctx.lineWidth = 4;
    ctx.strokeRect(44, 44, b - 88, h - 88);
    ctx.fillStyle = "#9c3a40";
    for (let x = 90; x < b - 60; x += 60) {
      for (let y = 90; y < h - 60; y += 60) {
        ctx.beginPath();
        ctx.moveTo(x, y - 18);
        ctx.lineTo(x + 18, y);
        ctx.lineTo(x, y + 18);
        ctx.lineTo(x - 18, y);
        ctx.fill();
      }
    }
  }, 512, 384);
  const teppich = new THREE.Mesh(new THREE.PlaneGeometry(13, 9.5), new THREE.MeshStandardMaterial({ map: teppichTextur, roughness: 1 }));
  teppich.rotation.x = -Math.PI / 2;
  teppich.position.set(0, BODEN_Y + 0.01, -0.6);
  teppich.receiveShadow = true;
  welt.szene.add(teppich);

  // Fenster links: Nachthimmel mit Mond und Sternen (leuchtet selbst), Sprossen, Fensterbank, Vorhänge
  const fenster = anWand(new THREE.Group(), 1, 10, 1.5);
  const himmel = gemaeldeTextur((ctx, b, h) => {
    const verlauf = ctx.createLinearGradient(0, 0, 0, h);
    verlauf.addColorStop(0, "#0b1430");
    verlauf.addColorStop(1, "#2b3d6e");
    ctx.fillStyle = verlauf;
    ctx.fillRect(0, 0, b, h);
    ctx.fillStyle = "#ffffff";
    for (let i = 0; i < 70; i++) {
      const x = (i * 97) % b;
      const y = (i * 61) % (h * 0.8);
      ctx.globalAlpha = 0.4 + ((i * 13) % 6) / 10;
      ctx.fillRect(x, y, 2, 2);
    }
    ctx.globalAlpha = 1;
    ctx.fillStyle = "#fff5d0";
    ctx.beginPath();
    ctx.arc(b * 0.7, h * 0.25, 26, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#0e1836";
    ctx.beginPath();
    ctx.arc(b * 0.7 + 12, h * 0.25 - 8, 24, 0, Math.PI * 2);
    ctx.fill();
    // Silhouette von Dächern
    ctx.fillStyle = "#070b18";
    ctx.beginPath();
    ctx.moveTo(0, h);
    for (let x = 0; x <= b; x += 40) ctx.lineTo(x, h * 0.82 - ((x * 7) % 45));
    ctx.lineTo(b, h);
    ctx.fill();
  }, 256, 288);
  const glas = new THREE.Mesh(new THREE.PlaneGeometry(1.7, 1.95), new THREE.MeshBasicMaterial({ map: himmel }));
  glas.position.z = 0.01;
  fenster.add(glas);
  for (const [b, h, x, y] of [[1.9, 0.1, 0, 1.02], [1.9, 0.1, 0, -1.02], [0.1, 2.14, -0.9, 0], [0.1, 2.14, 0.9, 0], [0.05, 1.95, 0, 0], [1.7, 0.05, 0, 0.15]]) {
    kasten(b, h, 0.08, weissLack, x, y, 0.04, fenster);
  }
  kasten(2.1, 0.06, 0.28, weissLack, 0, -1.1, 0.12, fenster); // Fensterbank
  const stoff = new THREE.MeshStandardMaterial({ color: 0x8c2f3a, roughness: 0.95, side: THREE.DoubleSide });
  for (const seite of [-1, 1]) {
    const geo = new THREE.PlaneGeometry(0.6, 2.7, 24, 1);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) pos.setZ(i, Math.sin(pos.getX(i) * 26) * 0.05); // Falten
    geo.computeVertexNormals();
    const vorhang = new THREE.Mesh(geo, stoff);
    vorhang.position.set(seite * 1.2, -0.1, 0.18);
    vorhang.castShadow = true;
    fenster.add(vorhang);
  }
  const stange = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 3.1, 8), holzDunkel);
  stange.rotation.z = Math.PI / 2;
  stange.position.set(0, 1.28, 0.2);
  fenster.add(stange);

  // Bücherregal rechts
  const regal = anWand(new THREE.Group(), 2, 4.2, BODEN_Y, 0.28);
  const RB = 1.8;
  const RH = 3.6;
  kasten(0.06, RH, 0.5, holzDunkel, -RB / 2, RH / 2, 0, regal);
  kasten(0.06, RH, 0.5, holzDunkel, RB / 2, RH / 2, 0, regal);
  kasten(RB, RH, 0.03, holzDunkel, 0, RH / 2, -0.24, regal);
  const buchFarben = [0x8c2f3a, 0x2f5a8c, 0x3f7a45, 0xd9a441, 0x5a3a7a, 0x2a2a2a, 0xc9b79c, 0xb5562a];
  let saat = 3;
  const zufallFest = () => ((saat = (saat * 9301 + 49297) % 233280) / 233280);
  for (let boden = 0; boden < 5; boden++) {
    const y = 0.06 + boden * 0.86;
    kasten(RB, 0.05, 0.5, holzDunkel, 0, y, 0, regal);
    if (boden === 4) break;
    let x = -RB / 2 + 0.08;
    while (x < RB / 2 - 0.25) {
      if (zufallFest() < 0.12) {
        x += 0.18; // Lücke
        continue;
      }
      const dicke = 0.05 + zufallFest() * 0.07;
      const hoehe = 0.45 + zufallFest() * 0.3;
      const farbe = buchFarben[Math.floor(zufallFest() * buchFarben.length)];
      const buch = kasten(dicke, hoehe, 0.34, new THREE.MeshStandardMaterial({ color: farbe, roughness: 0.8 }), x + dicke / 2, y + 0.025 + hoehe / 2, 0.02, regal);
      if (zufallFest() < 0.1) buch.rotation.z = 0.2; // angelehnt
      x += dicke + 0.008;
    }
  }
  // Vase oben drauf
  const vase = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.14, 0.4, 16), new THREE.MeshStandardMaterial({ color: 0x3a7a8c, roughness: 0.3 }));
  vase.position.set(0.4, RH + 0.2, 0);
  vase.castShadow = true;
  regal.add(vase);

  // Stehlampe zwischen Regal und Tisch, mit warmem Licht
  const lampe = anWand(new THREE.Group(), 2, 2.75, BODEN_Y, 0.55);
  const metall = new THREE.MeshStandardMaterial({ color: 0x2a2a2a, metalness: 0.6, roughness: 0.4 });
  const fuss = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.34, 0.06, 20), metall);
  fuss.position.y = 0.03;
  const stab = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 3.4, 8), metall);
  stab.position.y = 1.7;
  const schirm = new THREE.Mesh(
    new THREE.CylinderGeometry(0.32, 0.5, 0.55, 24, 1, true),
    new THREE.MeshStandardMaterial({ color: 0xf2e2c0, emissive: 0xffcf80, emissiveIntensity: 0.55, roughness: 0.9, side: THREE.DoubleSide })
  );
  schirm.position.y = 3.45;
  const licht = new THREE.PointLight(0xffc477, 0.5, 7);
  licht.position.y = 3.3;
  lampe.add(fuss, stab, schirm, licht);
  for (const teil of [fuss, stab, schirm]) teil.castShadow = true;
}

// Gemaltes Bild als Canvas-Textur
function gemaeldeTextur(malen, breite, hoehe) {
  const leinwand = document.createElement("canvas");
  leinwand.width = breite;
  leinwand.height = hoehe;
  malen(leinwand.getContext("2d"), breite, hoehe);
  const textur = new THREE.CanvasTexture(leinwand);
  textur.encoding = THREE.sRGBEncoding;
  return textur;
}

function sonnenuntergangMalen(ctx, b, h) {
  const himmel = ctx.createLinearGradient(0, 0, 0, h * 0.7);
  himmel.addColorStop(0, "#3b2a6b");
  himmel.addColorStop(0.55, "#d9645a");
  himmel.addColorStop(1, "#f5b86b");
  ctx.fillStyle = himmel;
  ctx.fillRect(0, 0, b, h);
  ctx.fillStyle = "#ffe08a";
  ctx.beginPath();
  ctx.arc(b * 0.62, h * 0.58, h * 0.12, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#4a2f5a";
  ctx.beginPath();
  ctx.moveTo(0, h * 0.72);
  ctx.lineTo(b * 0.22, h * 0.48);
  ctx.lineTo(b * 0.42, h * 0.66);
  ctx.lineTo(b * 0.7, h * 0.44);
  ctx.lineTo(b, h * 0.68);
  ctx.lineTo(b, h);
  ctx.lineTo(0, h);
  ctx.fill();
  const see = ctx.createLinearGradient(0, h * 0.72, 0, h);
  see.addColorStop(0, "#c45d63");
  see.addColorStop(1, "#2c2350");
  ctx.fillStyle = see;
  ctx.fillRect(0, h * 0.74, b, h * 0.26);
  ctx.fillStyle = "rgba(255, 224, 138, 0.55)";
  for (let i = 0; i < 6; i++) ctx.fillRect(b * 0.55 + Math.sin(i) * 12, h * (0.77 + i * 0.035), b * 0.14 - i * 6, 3);
}

function abstraktMalen(ctx, b, h) {
  ctx.fillStyle = "#f3ead8";
  ctx.fillRect(0, 0, b, h);
  const formen = [
    ["#e6453a", 0.15, 0.2, 0.22],
    ["#2f6db5", 0.62, 0.32, 0.28],
    ["#f2c14e", 0.35, 0.68, 0.2],
    ["#2f9e5b", 0.75, 0.78, 0.13]
  ];
  for (const [farbe, x, y, r] of formen) {
    ctx.fillStyle = farbe;
    ctx.beginPath();
    ctx.arc(b * x, h * y, b * r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.strokeStyle = "#1e1e1e";
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.moveTo(b * 0.05, h * 0.5);
  ctx.bezierCurveTo(b * 0.3, h * 0.2, b * 0.6, h * 0.9, b * 0.95, h * 0.45);
  ctx.stroke();
}

// Fotos an der Wand. Sie kommen eingebettet aus wandbilder-daten.js (data:-URLs funktionieren auch per file://,
// Bilddateien dort nicht); fehlt ein Foto oder lädt es nicht, zeigt der Rahmen stattdessen ein gemaltes Bild.
const WANDBILDER = [
  // wand/entlang: Wand 1 oder 2 und Abstand von der Ecke (siehe anWand); die Affen hängen links und rechts der Ecke
  { datei: "images/wand/katze.jpg", breite: 0.56, hoehe: 1.0, wand: 1, entlang: 5.0, y: 0.85, ersatz: sonnenuntergangMalen },
  { datei: "images/wand/affe-nachdenklich.jpg", breite: 1.0, hoehe: 0.92, wand: 1, entlang: 1.35, y: 1.15, ersatz: abstraktMalen },
  { datei: "images/wand/affe-mittelfinger.webp", breite: 0.9, hoehe: 1.12, wand: 2, entlang: 1.05, y: 1.05, ersatz: abstraktMalen }
];

function bilderAufhaengen() {
  const rahmenHolz = new THREE.MeshStandardMaterial({ color: 0x6b4a2b, roughness: 0.6 });
  const lader = new THREE.TextureLoader();
  for (const b of WANDBILDER) {
    const gruppe = new THREE.Group();
    const rahmen = new THREE.Mesh(new THREE.BoxGeometry(b.breite + 0.14, b.hoehe + 0.14, 0.06), rahmenHolz);
    rahmen.castShadow = true;
    const material = new THREE.MeshStandardMaterial({ color: 0xe8e2d4, roughness: 0.85 });
    const leinwand = new THREE.Mesh(new THREE.PlaneGeometry(b.breite, b.hoehe), material);
    leinwand.position.z = 0.032;
    gruppe.add(rahmen, leinwand);
    anWand(gruppe, b.wand, b.entlang, b.y, 0.04);

    const ersatzZeigen = () => {
      material.map = gemaeldeTextur(b.ersatz, 512, Math.round((512 * b.hoehe) / b.breite));
      material.needsUpdate = true;
    };
    const daten = typeof WANDBILDER_DATEN !== "undefined" ? WANDBILDER_DATEN[b.datei] : null;
    if (!daten && location.protocol === "file:") {
      ersatzZeigen(); // Bilddateien würden hier beim Zeichnen einen Sicherheitsfehler auslösen
      continue;
    }
    lader.load(
      daten || b.datei,
      textur => {
        textur.encoding = THREE.sRGBEncoding;
        textur.anisotropy = welt.renderer.capabilities.getMaxAnisotropy();
        material.map = textur;
        material.color.set(0xffffff);
        material.needsUpdate = true;
      },
      undefined,
      ersatzZeigen
    );
  }
}

// Zimmerpflanze: Terrakottatopf mit großen, gebogenen Blättern
function pflanzeAufstellen() {
  const gruppe = new THREE.Group();
  const topf = new THREE.Mesh(
    new THREE.CylinderGeometry(0.42, 0.32, 0.75, 20),
    new THREE.MeshStandardMaterial({ color: 0xb5603a, roughness: 0.85 })
  );
  topf.position.y = 0.375;
  topf.castShadow = true;
  const erde = new THREE.Mesh(new THREE.CylinderGeometry(0.39, 0.39, 0.04, 20), new THREE.MeshStandardMaterial({ color: 0x3a2618 }));
  erde.position.y = 0.73;
  gruppe.add(topf, erde);

  const blattMaterial = new THREE.MeshStandardMaterial({ color: 0x2f7d3a, roughness: 0.6, side: THREE.DoubleSide });
  const stielMaterial = new THREE.MeshStandardMaterial({ color: 0x3f6b2a, roughness: 0.7 });
  const blaetter = 9;
  for (let i = 0; i < blaetter; i++) {
    const winkel = (i / blaetter) * Math.PI * 2 + (i % 2) * 0.3;
    const hoehe = 1.3 + (i % 3) * 0.45;
    const neigung = 0.35 + (i % 3) * 0.15;
    const stiel = new THREE.Group();
    stiel.position.y = 0.72;
    stiel.rotation.set(0, winkel, neigung);
    const stab = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.025, hoehe, 6), stielMaterial);
    stab.position.y = hoehe / 2;
    const blatt = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 10), blattMaterial);
    blatt.scale.set(0.32, 0.5, 0.05);
    blatt.position.set(0.12, hoehe + 0.3, 0);
    blatt.rotation.z = -0.5;
    blatt.castShadow = true;
    stiel.add(stab, blatt);
    gruppe.add(stiel);
  }
  anWand(gruppe, 1, 10, -1.6, 0.6); // unter dem Fenster, links neben dem Tisch
}

// Glückskatze (dreifarbig: weiß, orange, schwarz – Vorbild: die Katze vom Foto), liegt in Sphinx-Haltung auf der
// hinteren rechten Tischecke: Kopf erhoben, Vorderpfoten nach vorn, Hinterbein seitlich, Schwanz um den Körper.
// Lokale Achsen: +x = Blickrichtung, y = oben, z = Seite. Döst meist mit halb geschlossenen grünen Augen.
function calicoTextur(breite, hoehe, saat) {
  let s = saat;
  const zufallsZahl = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
  return gemaeldeTextur((ctx, b, h) => {
    ctx.fillStyle = "#f4efe6";
    ctx.fillRect(0, 0, b, h);
    const flecken = (farbe, anzahl, groesse) => {
      ctx.fillStyle = farbe;
      for (let i = 0; i < anzahl; i++) {
        const x = zufallsZahl() * b;
        const y = zufallsZahl() * h * 0.75;
        const r = groesse * (0.6 + zufallsZahl() * 0.8);
        ctx.beginPath();
        ctx.ellipse(x, y, r * 1.4, r, zufallsZahl() * Math.PI, 0, Math.PI * 2);
        ctx.fill();
        if (x < r * 1.4) {
          // am Rand weiterzeichnen, damit die Naht der Textur nicht auffällt
          ctx.beginPath();
          ctx.ellipse(x + b, y, r * 1.4, r, 0, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    };
    flecken("#d9853b", 9, b * 0.11);
    flecken("#2a2420", 7, b * 0.09);
    // ganz leichte Fellstruktur
    ctx.strokeStyle = "rgba(120, 70, 30, 0.12)";
    ctx.lineWidth = 2;
    for (let x = 0; x < b; x += 23) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x + 8, h * 0.6);
      ctx.stroke();
    }
  }, breite, hoehe);
}

// Kopf: orange Blesse in der Mitte, schwarze Flecken um die Augen, Rückseite gemischt
function katzenKopfTextur() {
  return gemaeldeTextur((ctx, b, h) => {
    ctx.fillStyle = "#2a2420";
    ctx.fillRect(0, 0, b, h);
    ctx.fillStyle = "#d9853b";
    ctx.fillRect(b * 0.44, 0, b * 0.12, h); // Blesse vorn (u ≈ 0.5)
    ctx.beginPath();
    ctx.ellipse(b * 0.66, h * 0.45, b * 0.09, h * 0.3, 0, 0, Math.PI * 2); // orange Wange
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(b * 0.08, h * 0.4, b * 0.12, h * 0.35, 0, 0, Math.PI * 2); // orange Hinterkopf
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(b * 0.95, h * 0.4, b * 0.08, h * 0.3, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(140, 70, 25, 0.5)";
    ctx.lineWidth = 2;
    for (let i = 0; i < 5; i++) {
      ctx.beginPath();
      ctx.moveTo(b * (0.46 + i * 0.02), h * 0.05);
      ctx.lineTo(b * (0.47 + i * 0.02), h * 0.3);
      ctx.stroke();
    }
    ctx.fillStyle = "#f4efe6"; // weißes Kinn unten
    ctx.fillRect(0, h * 0.82, b, h * 0.18);
  }, 256, 128);
}

function katzeHinlegen() {
  const fell = new THREE.MeshStandardMaterial({ map: calicoTextur(512, 256, 7), roughness: 0.9 });
  const kopfFell = new THREE.MeshStandardMaterial({ map: katzenKopfTextur(), roughness: 0.9 });
  const weiss = new THREE.MeshStandardMaterial({ color: 0xf4efe6, roughness: 0.9 });
  const orange = new THREE.MeshStandardMaterial({ color: 0xd9853b, roughness: 0.9 });
  const schwarz = new THREE.MeshStandardMaterial({ color: 0x2a2420, roughness: 0.9 });
  const rosa = new THREE.MeshStandardMaterial({ color: 0xe8a0a0, roughness: 0.7 });
  const augenGruen = new THREE.MeshStandardMaterial({ color: 0xa8c060, roughness: 0.3, emissive: 0x1a2408 });
  const pupille = new THREE.MeshBasicMaterial({ color: 0x0b0b0b });
  const kugel = new THREE.SphereGeometry(1, 20, 14);
  const teil = (material, sx, sy, sz, x, y, z, eltern) => {
    const m = new THREE.Mesh(kugel, material);
    m.scale.set(sx, sy, sz);
    m.position.set(x, y, z);
    m.castShadow = true;
    eltern.add(m);
    return m;
  };

  const katze = new THREE.Group();

  // Rumpf: lang gestreckt, hinten rundes Becken, vorn weiße Brust
  const rumpf = new THREE.Group();
  katze.add(rumpf);
  const leib = new THREE.Mesh(new THREE.CapsuleGeometry(0.15, 0.24, 8, 16), fell);
  leib.rotation.z = Math.PI / 2;
  leib.scale.set(0.95, 1, 1.2);
  leib.position.set(0, 0.155, 0);
  leib.castShadow = true;
  rumpf.add(leib);
  teil(fell, 0.18, 0.165, 0.2, -0.19, 0.16, 0, rumpf); // Becken
  teil(weiss, 0.12, 0.15, 0.13, 0.2, 0.2, 0, rumpf); // Brust/Latz

  // Hinterbeine: kräftige Oberschenkel an beiden Seiten, Füße nach vorn
  for (const z of [-0.17, 0.17]) {
    teil(fell, 0.15, 0.11, 0.065, -0.16, 0.13, z, katze);
    const hinterfuss = new THREE.Mesh(new THREE.CapsuleGeometry(0.034, 0.12, 4, 8), z > 0 ? orange : schwarz);
    hinterfuss.rotation.z = Math.PI / 2;
    hinterfuss.position.set(-0.02, 0.034, z * 1.08);
    katze.add(hinterfuss);
    teil(weiss, 0.048, 0.03, 0.044, 0.07, 0.03, z * 1.08, katze);
  }

  // Vorderbeine liegen ausgestreckt, weiße Pfoten
  for (const z of [-0.075, 0.075]) {
    const bein = new THREE.Mesh(new THREE.CapsuleGeometry(0.042, 0.2, 4, 8), z < 0 ? schwarz : orange);
    bein.rotation.z = Math.PI / 2;
    bein.position.set(0.38, 0.045, z);
    bein.castShadow = true;
    katze.add(bein);
    teil(weiss, 0.06, 0.035, 0.05, 0.52, 0.035, z, katze);
  }

  // Hals und Kopf
  const hals = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.11, 0.16, 12), fell);
  hals.position.set(0.27, 0.3, 0);
  hals.rotation.z = -0.35;
  katze.add(hals);

  const kopf = new THREE.Group();
  kopf.position.set(0.33, 0.42, 0);
  katze.add(kopf);
  teil(kopfFell, 0.14, 0.125, 0.15, 0, 0, 0, kopf);
  // Schnauze und Kinn weiß, rosa Nase
  teil(weiss, 0.055, 0.045, 0.05, 0.11, -0.045, 0.03, kopf);
  teil(weiss, 0.055, 0.045, 0.05, 0.11, -0.045, -0.03, kopf);
  teil(weiss, 0.05, 0.035, 0.06, 0.08, -0.08, 0, kopf);
  const nase = new THREE.Mesh(new THREE.ConeGeometry(0.018, 0.025, 3), rosa);
  nase.rotation.set(0, 0, -Math.PI / 2 - 0.4);
  nase.position.set(0.155, -0.012, 0);
  kopf.add(nase);

  // Augen: grün, senkrechte Pupille; Lider über die Höhe (augen.scale.y) – halb zu beim Dösen
  const augen = [];
  for (const z of [-0.058, 0.058]) {
    const auge = new THREE.Group();
    auge.position.set(0.115, 0.025, z);
    auge.rotation.y = z > 0 ? -0.45 : 0.45;
    const apfel = new THREE.Mesh(kugel, augenGruen);
    apfel.scale.set(0.012, 0.026, 0.034);
    const schlitz = new THREE.Mesh(kugel, pupille);
    schlitz.scale.set(0.006, 0.022, 0.007);
    schlitz.position.x = 0.008;
    auge.add(apfel, schlitz);
    kopf.add(auge);
    augen.push(auge);
  }

  // Ohren: Fell außen, rosa innen
  const ohren = [];
  for (const z of [-0.075, 0.075]) {
    const ohr = new THREE.Group();
    ohr.position.set(-0.01, 0.1, z);
    ohr.rotation.set(z > 0 ? 0.3 : -0.3, 0, -0.15);
    const aussen = new THREE.Mesh(new THREE.ConeGeometry(0.055, 0.12, 4), z > 0 ? schwarz : orange);
    aussen.position.y = 0.05;
    aussen.rotation.y = Math.PI / 4;
    const innen = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.085, 4), rosa);
    innen.position.set(0.018, 0.045, 0);
    innen.rotation.y = Math.PI / 4;
    ohr.add(aussen, innen);
    kopf.add(ohr);
    ohren.push(ohr);
  }

  // Schnurrhaare
  const haarPunkte = [];
  for (const seite of [-1, 1]) {
    for (let i = 0; i < 3; i++) {
      haarPunkte.push(new THREE.Vector3(0.12, -0.04 + i * 0.012, seite * 0.04));
      haarPunkte.push(new THREE.Vector3(0.17, -0.06 + i * 0.03, seite * 0.2));
    }
  }
  const schnurrhaare = new THREE.LineSegments(
    new THREE.BufferGeometry().setFromPoints(haarPunkte),
    new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85 })
  );
  kopf.add(schnurrhaare);

  // Schwanz: vom Becken nach hinten und dann seitlich nach vorn um den Körper gelegt; dreht an der Wurzel
  const schwanz = new THREE.Group();
  schwanz.position.set(-0.33, 0.12, 0);
  const kurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(-0.16, -0.06, 0.08),
    new THREE.Vector3(-0.1, -0.085, 0.27),
    new THREE.Vector3(0.18, -0.085, 0.33),
    new THREE.Vector3(0.42, -0.08, 0.3)
  ]);
  const rute = new THREE.Mesh(new THREE.TubeGeometry(kurve, 32, 0.034, 8, false), fell);
  rute.castShadow = true;
  schwanz.add(rute);
  katze.add(schwanz);

  katze.position.set(2.15, 0, -(TISCH_TIEFE / 2 - 0.6));
  katze.rotation.y = -2.45; // schaut nach links zur Tischmitte und etwas zu uns
  welt.szene.add(katze);
  welt.katze = {
    gruppe: katze, rumpf, kopf, augen, ohren, schwanz,
    kopfBasis: kopf.position.clone(),
    offen: 0.3, offenZiel: 0.3, naechsterBlick: 0, blickZiel: 0,
    naechstesZucken: 0, naechstesZ: 0, zs: [],
    gluecklichBis: 0, // gestreichelt/gefüttert: Augen zufrieden zu, Kopf hebt sich, Schwanz wedelt
    fressAnteil: 0, // 0 = Kopf oben, 1 = Kopf unten am Leckerli
    frisst: false
  };
}

// Packung Katzenleckerlis neben der Katze (anklickbar: die Katze bekommt eins)
function leckerliPackungAufstellen() {
  const etikett = gemaeldeTextur((ctx, b, h) => {
    ctx.fillStyle = "#7b3fa0";
    ctx.fillRect(0, 0, b, h);
    ctx.fillStyle = "#f2c14e";
    ctx.fillRect(0, h * 0.08, b, h * 0.06);
    // Pfote
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.ellipse(b / 2, h * 0.58, b * 0.17, b * 0.14, 0, 0, Math.PI * 2);
    ctx.fill();
    for (const [x, y] of [[-0.2, -0.17], [-0.07, -0.25], [0.07, -0.25], [0.2, -0.17]]) {
      ctx.beginPath();
      ctx.ellipse(b / 2 + x * b, h * 0.58 + y * b, b * 0.06, b * 0.075, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = "#f2c14e";
    ctx.textAlign = "center";
    ctx.font = `900 ${Math.round(b * 0.15)}px system-ui, sans-serif`;
    ctx.fillText("MIAU", b / 2, h * 0.32);
    ctx.font = `bold ${Math.round(b * 0.1)}px system-ui, sans-serif`;
    ctx.fillStyle = "#ffffff";
    ctx.fillText("Leckerlis", b / 2, h * 0.86);
  }, 128, 192);
  const lila = new THREE.MeshStandardMaterial({ color: 0x7b3fa0, roughness: 0.5 });
  const vorne = new THREE.MeshStandardMaterial({ map: etikett, roughness: 0.5 });
  const packung = new THREE.Group();
  // Reihenfolge der Box-Seiten: +x, −x, +y, −y, +z (vorn), −z
  const beutel = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.44, 0.13), [lila, lila, lila, lila, vorne, vorne]);
  beutel.position.y = 0.22;
  beutel.castShadow = true;
  const falz = new THREE.Mesh(new THREE.BoxGeometry(0.31, 0.05, 0.05), new THREE.MeshStandardMaterial({ color: 0xf2c14e, roughness: 0.4 }));
  falz.position.y = 0.46;
  packung.add(beutel, falz);
  packung.position.set(2.35, 0, -1.3);
  packung.rotation.y = -0.35; // Etikett schaut zu uns
  welt.szene.add(packung);
  welt.leckerliPackung = packung;
}

let herzTextur = null;

function herzSprite() {
  if (!herzTextur) {
    herzTextur = gemaeldeTextur((ctx, b, h) => {
      ctx.fillStyle = "#ff4f7b";
      ctx.strokeStyle = "rgba(120, 0, 30, 0.5)";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(32, 56);
      ctx.bezierCurveTo(4, 36, 2, 14, 18, 10);
      ctx.bezierCurveTo(26, 8, 31, 14, 32, 20);
      ctx.bezierCurveTo(33, 14, 38, 8, 46, 10);
      ctx.bezierCurveTo(62, 14, 60, 36, 32, 56);
      ctx.fill();
      ctx.stroke();
    }, 64, 64);
  }
  return new THREE.Sprite(new THREE.SpriteMaterial({ map: herzTextur, transparent: true, depthWrite: false }));
}

// Herzchen steigen über der Katze auf (gleiche Schwebe-Liste wie die "z")
function katzeHerzchen(anzahl) {
  const k = welt.katze;
  const kopf = k.kopf.getWorldPosition(new THREE.Vector3());
  for (let i = 0; i < anzahl; i++) {
    const herz = herzSprite();
    herz.position.copy(kopf).add(new THREE.Vector3((Math.random() - 0.5) * 0.4, 0.15 + Math.random() * 0.1, (Math.random() - 0.5) * 0.3));
    herz.userData.alter = -i * 0.18; // nacheinander aufsteigen
    herz.userData.groesse = 0.1 + Math.random() * 0.05;
    herz.material.opacity = 0;
    welt.szene.add(herz);
    k.zs.push(herz);
  }
}

// Streicheln: Herzchen, Augen zufrieden zu, Kopf schmiegt sich hoch
function katzeStreicheln() {
  const k = welt.katze;
  if (!k || k.frisst) return;
  const jetzt = performance.now();
  k.gluecklichBis = jetzt + 2800;
  k.naechsterBlick = k.gluecklichBis;
  k.offenZiel = 0.12;
  k.blickZiel = 0.35;
  katzeHerzchen(5);
}

// Leckerli: fliegt aus der Packung vor die Pfoten, die Katze senkt den Kopf und frisst es
async function katzeFuettern() {
  const k = welt.katze;
  if (!k || k.frisst) return;
  k.frisst = true;
  k.offenZiel = 1;
  k.blickZiel = 0;
  k.naechsterBlick = Infinity;

  const packung = welt.leckerliPackung;
  // Packung wackelt kurz (es raschelt)
  animieren(dauer(300), t => (packung.rotation.z = Math.sin(t * Math.PI * 4) * 0.12 * (1 - t))).then(() => (packung.rotation.z = 0));

  const leckerli = new THREE.Mesh(
    new THREE.TorusGeometry(0.03, 0.016, 8, 12),
    new THREE.MeshStandardMaterial({ color: 0x9a5a2a, roughness: 0.8 })
  );
  leckerli.castShadow = true;
  const start = packung.localToWorld(new THREE.Vector3(0, 0.5, 0));
  const ziel = k.gruppe.localToWorld(new THREE.Vector3(0.5, 0.02, 0));
  leckerli.position.copy(start);
  welt.szene.add(leckerli);
  await animieren(dauer(650), t => {
    leckerli.position.lerpVectors(start, ziel, t);
    leckerli.position.y += Math.sin(t * Math.PI) * 0.45;
    leckerli.rotation.set(t * 9, t * 5, 0);
  });
  leckerli.position.copy(ziel);
  leckerli.rotation.set(Math.PI / 2, 0, 0);

  // Kopf runter, dreimal kauen (Leckerli wird kleiner), Kopf wieder hoch
  await animieren(dauer(380), t => (k.fressAnteil = sanft(t)));
  await animieren(dauer(1000), t => {
    k.kauen = Math.abs(Math.sin(t * Math.PI * 3));
    leckerli.scale.setScalar(Math.max(0, 1 - t * 1.15));
  });
  k.kauen = 0;
  welt.szene.remove(leckerli);
  leckerli.geometry.dispose();
  leckerli.material.dispose();
  await animieren(dauer(380), t => (k.fressAnteil = 1 - sanft(t)));
  k.fressAnteil = 0;
  k.frisst = false;
  katzeStreicheln(); // zufrieden
}

function katzeAktualisieren(jetzt, dt) {
  const k = welt.katze;
  if (!k) return;
  const s = jetzt / 1000;

  // Atmen: Rumpf hebt und senkt sich langsam
  k.rumpf.scale.y = 1 + Math.sin(s * 1.6) * 0.04;

  const gluecklich = jetzt < k.gluecklichBis;
  // Schwanz wedelt gemütlich (zufrieden schneller und weiter)
  k.schwanz.rotation.y = gluecklich ? Math.sin(s * 4) * 0.3 : Math.sin(s * 0.9) * 0.15;

  // Mal döst sie (Augen halb zu), mal schaut sie wach umher (Augen auf, Kopf dreht sich)
  if (jetzt > k.naechsterBlick) {
    const wach = Math.random() < 0.35;
    k.offenZiel = wach ? 1 : 0.28;
    k.blickZiel = wach ? (Math.random() - 0.3) * 0.9 : 0.1;
    k.naechsterBlick = jetzt + (wach ? 2500 : 5000 + Math.random() * 4000);
  }
  k.offen += (k.offenZiel - k.offen) * Math.min(1, dt * 3);
  k.kopf.rotation.y += (k.blickZiel - k.kopf.rotation.y) * Math.min(1, dt * 2);
  if (gluecklich) {
    // schmiegt den Kopf hoch und reibt ihn hin und her
    k.kopf.rotation.z = 0.2 + Math.sin(s * 5) * 0.05;
    k.kopf.rotation.x = Math.sin(s * 3) * 0.18;
  } else {
    k.kopf.rotation.z = Math.sin(s * 1.6) * 0.02 - (k.offenZiel < 0.5 ? 0.08 : 0); // dösend leicht gesenkt
    k.kopf.rotation.x *= 0.9;
  }
  // Fressen: Kopf nach vorn unten zum Leckerli, beim Kauen nickt er leicht
  const f = k.fressAnteil;
  k.kopf.position.set(k.kopfBasis.x + 0.06 * f, k.kopfBasis.y - 0.26 * f + (k.kauen || 0) * 0.025, k.kopfBasis.z);
  k.kopf.rotation.z -= f * 0.65;
  const blinzeln = Math.sin(s * 0.7) > 0.995 ? 0.1 : 1;
  for (const auge of k.augen) auge.scale.y = Math.max(0.08, k.offen * blinzeln);

  // ab und zu zuckt ein Ohr
  if (jetzt > k.naechstesZucken) {
    k.zuckenStart = jetzt;
    k.zuckenOhr = Math.random() < 0.5 ? 0 : 1;
    k.naechstesZucken = jetzt + 4000 + Math.random() * 5000;
  }
  k.ohren.forEach((ohr, i) => {
    const t = (jetzt - (k.zuckenStart || 0)) / 300;
    const basis = i === 1 ? 0.3 : -0.3;
    ohr.rotation.x = basis + (i === k.zuckenOhr && t < 1 ? Math.sin(t * Math.PI * 3) * 0.4 : 0);
  });

  // "z" schweben nur, solange sie döst
  if (jetzt > k.naechstesZ && dauer(1) && k.offenZiel < 0.5 && !gluecklich) {
    k.naechstesZ = jetzt + 2200;
    const z = schnarchZ();
    z.position.copy(k.kopf.getWorldPosition(new THREE.Vector3())).add(new THREE.Vector3(0, 0.22, 0));
    z.userData.alter = 0;
    welt.szene.add(z);
    k.zs.push(z);
  }
  for (let i = k.zs.length - 1; i >= 0; i--) {
    const z = k.zs[i];
    z.userData.alter += dt;
    const a = z.userData.alter;
    if (a < 0) continue; // Herzchen warten, bis sie dran sind
    z.position.y += dt * 0.22;
    z.position.x += Math.sin(a * 3) * dt * 0.08;
    z.material.opacity = Math.max(0, 1 - a / 2.4);
    z.scale.setScalar((z.userData.groesse || 0.12) + a * 0.06);
    if (a > 2.4) {
      welt.szene.remove(z);
      z.material.dispose();
      k.zs.splice(i, 1);
    }
  }
}

let schnarchTextur = null;

function schnarchZ() {
  if (!schnarchTextur) {
    schnarchTextur = gemaeldeTextur((ctx, b, h) => {
      ctx.font = "italic 900 54px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.lineWidth = 6;
      ctx.strokeStyle = "rgba(40, 30, 60, 0.6)";
      ctx.strokeText("z", b / 2, h / 2);
      ctx.fillStyle = "#f4f1e6";
      ctx.fillText("z", b / 2, h / 2);
    }, 64, 64);
  }
  return new THREE.Sprite(new THREE.SpriteMaterial({ map: schnarchTextur, transparent: true, depthWrite: false }));
}

// Aschenbecher hinten links auf dem Tisch, mit einer brennenden Zigarette (raucht dauerhaft, Glut flackert)
function aschenbecherAufstellen() {
  const gruppe = new THREE.Group();
  const schale = new THREE.Mesh(
    new THREE.CylinderGeometry(0.34, 0.3, 0.12, 28),
    new THREE.MeshStandardMaterial({ color: 0x4f6a78, roughness: 0.25, metalness: 0.2 })
  );
  schale.position.y = 0.06;
  schale.castShadow = true;
  const asche = new THREE.Mesh(
    new THREE.CylinderGeometry(0.27, 0.27, 0.02, 24),
    new THREE.MeshStandardMaterial({ color: 0x6b6b6b, roughness: 1 })
  );
  asche.position.y = 0.11;
  gruppe.add(schale, asche);

  // zwei ausgedrückte Kippen
  const stummelMaterial = new THREE.MeshStandardMaterial({ color: 0xd08a3a, roughness: 0.8 });
  for (const [x, z, drehung] of [[-0.08, 0.06, 0.6], [0.06, -0.1, -1.1]]) {
    const stummel = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.024, 0.11, 8), stummelMaterial);
    stummel.position.set(x, 0.135, z);
    stummel.rotation.set(Math.PI / 2, 0, drehung);
    gruppe.add(stummel);
  }

  // brennende Zigarette: Filter liegt außen auf dem Rand, Glut zeigt nach innen
  const kippe = kippeBauen();
  kippe.position.set(0.5, 0.16, 0);
  kippe.rotation.set(0, 0, Math.PI / 2 + 0.08);
  const glut = kippe.userData.glut;
  glut.material.emissive.setRGB(1, 0.35, 0);
  gruppe.add(kippe);

  gruppe.position.set(-2.3, 0, -(TISCH_TIEFE / 2 - 0.55));
  welt.szene.add(gruppe);
  welt.aschenbecherGlut = glut;
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
  figur.position.set(0, 0, -(TISCH_TIEFE / 2 + TISCH_RAND + 0.4)); // direkt hinter der Tischkante

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
  welt.figurSchwarz = schwarz;
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

// ---------- Aussehen (Skin): Körperform, Kleidung, Haare, Kopfbedeckung, Extras ----------

// Rumpf-Umriss (Radius, Höhe in Hüft-Koordinaten) für LatheGeometry; der Rumpf wird danach flach gedrückt
const RUMPF_MANN = [[0.21, 0.45], [0.22, 0.8], [0.24, 1.2], [0.28, 1.58], [0.3, 1.71], [0.2, 1.82], [0.075, 1.87]];
const RUMPF_FRAU = [[0.26, 0.45], [0.24, 0.72], [0.18, 1.05], [0.21, 1.34], [0.25, 1.62], [0.26, 1.71], [0.17, 1.82], [0.075, 1.87]];
const RUMPF_TIEFE = 0.62;
const KOERBCHEN_RADIUS = { A: 0.065, B: 0.08, C: 0.095, D: 0.11, DD: 0.125 };

// Kamera nah an die Figur (Anprobe im Menü) oder zurück an den eigenen Platz
function szeneVorschau(an) {
  welt.vorschau = an;
  kameraAnpassen();
}

// Baut die Kleidung neu (vorherige wird entfernt). aussehen: siehe AUSSEHEN_STANDARD in aussehen.js
function szeneAussehen(aussehen) {
  if (!welt.huefte) return;
  if (welt.kleidung) {
    for (const teil of welt.kleidung) teil.parent.remove(teil);
  }
  welt.kleidung = [];
  if (welt.gesicht) {
    welt.gesicht.frau = aussehen.geschlecht === "frau";
    welt.gesicht.gezeichnet = ""; // neu zeichnen (Wimpern/Lippen)
  }

  const material = (farbe, extra = {}) => new THREE.MeshStandardMaterial({ color: farbe, roughness: 0.85, ...extra });
  const stoff = material(aussehen.farbe);
  const haar = material(aussehen.haarfarbe, { roughness: 0.65, side: THREE.DoubleSide });
  const hut = material(aussehen.hutfarbe, { side: THREE.DoubleSide });
  const gold = material(0xd8b040, { metalness: 0.85, roughness: 0.3 });
  const weissStoff = material(0xf2f0ea);
  const frau = aussehen.geschlecht === "frau";
  const anziehen = (eltern, mesh, x = 0, y = 0, z = 0) => {
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    eltern.add(mesh);
    welt.kleidung.push(mesh);
    return mesh;
  };
  const kugel = (r, mat, segmente = 16) => new THREE.Mesh(new THREE.SphereGeometry(r, segmente, Math.round(segmente * 0.75)), mat);
  const huefte = welt.huefte;
  const kopf = welt.kopf;
  const KM = 0.34; // Mittelpunkt der Kopfkugel (lokal im Kopf)

  // Rumpf: Frau immer mit Figur (ohne Oberteil in Körperfarbe), Mann ohne Oberteil bleibt Strichmännchen
  const oberteil = aussehen.oberteil;
  const rumpfMaterial = oberteil === "keins" ? welt.figurSchwarz : stoff;
  if (oberteil !== "keins" || frau) {
    const umriss = (frau ? RUMPF_FRAU : RUMPF_MANN).map(([r, y]) => new THREE.Vector2(r, y));
    const rumpf = anziehen(huefte, new THREE.Mesh(new THREE.LatheGeometry(umriss, 28), rumpfMaterial));
    rumpf.scale.z = RUMPF_TIEFE;
  }
  if (frau) {
    const r = KOERBCHEN_RADIUS[aussehen.koerbchen] || KOERBCHEN_RADIUS.C;
    for (const x of [-0.095, 0.095]) {
      const brust = anziehen(huefte, kugel(r, rumpfMaterial, 20), x, 1.43 - r * 0.3, 0.09 + r * 0.35);
      brust.scale.set(1, 0.95, 0.85);
    }
  }

  // Ärmel hängen an den Armgelenken und folgen so jeder Bewegung
  const aermel = lang => {
    for (const arm of [welt.armLinks, welt.armRechts]) {
      anziehen(arm.schulter, kugel(0.095, stoff));
      const laengeOben = lang ? arm.a : 0.3;
      const oben = anziehen(arm.schulter, new THREE.Mesh(new THREE.CylinderGeometry(0.088, 0.078, laengeOben, 14), stoff));
      oben.position.y = -laengeOben / 2;
      if (lang) {
        anziehen(arm.ellbogen, kugel(0.08, stoff));
        const unten = anziehen(arm.ellbogen, new THREE.Mesh(new THREE.CylinderGeometry(0.076, 0.07, arm.b - 0.1, 14), stoff));
        unten.position.y = -(arm.b - 0.1) / 2;
      }
    }
  };
  if (oberteil === "tshirt") aermel(false);
  if (oberteil === "hoodie") {
    aermel(true);
    // Kapuze hinter dem Kopf (hintere Hälfte einer Kugelschale)
    const kapuze = anziehen(kopf, new THREE.Mesh(new THREE.SphereGeometry(0.36, 24, 14, Math.PI, Math.PI, 0.5, 2.1), material(aussehen.farbe, { side: THREE.DoubleSide })), 0, KM - 0.08, -0.04);
    kapuze.rotation.x = 0.25;
    // Bauchtasche und Kordeln
    const tasche = anziehen(huefte, new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.17, 0.02), material(new THREE.Color(aussehen.farbe).multiplyScalar(0.75))), 0, 0.95, 0.15);
    tasche.rotation.x = -0.05;
    for (const x of [-0.05, 0.05]) {
      anziehen(huefte, new THREE.Mesh(new THREE.CylinderGeometry(0.007, 0.007, 0.22, 6), weissStoff), x, 1.7, 0.18);
    }
  }
  if (oberteil === "anzug") {
    aermel(true);
    // weißes Hemd im V-Ausschnitt, rote Krawatte
    const v = new THREE.Shape();
    v.moveTo(-0.09, 1.82);
    v.lineTo(0.09, 1.82);
    v.lineTo(0, 1.42);
    v.closePath();
    anziehen(huefte, new THREE.Mesh(new THREE.ShapeGeometry(v), weissStoff), 0, 0, 0.175);
    const rot = material(0xb3202a);
    anziehen(huefte, new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.3, 0.01), rot), 0, 1.6, 0.18);
    anziehen(huefte, new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.05, 0.02), rot), 0, 1.78, 0.18);
  }

  // Haare (lokal im Kopf)
  const frisur = aussehen.frisur;
  if (frisur !== "keine" && frisur !== "irokese") {
    const kappe = anziehen(kopf, new THREE.Mesh(new THREE.SphereGeometry(0.318, 28, 14, 0, Math.PI * 2, 0, 1.25), haar), 0, KM, 0);
    kappe.rotation.x = -0.4; // Haaransatz vorn höher, hinten tiefer
  }
  if (frisur === "lang") {
    const vorhang = anziehen(kopf, new THREE.Mesh(new THREE.CylinderGeometry(0.31, 0.37, 0.8, 24, 1, true, Math.PI * 0.58, Math.PI * 0.84), haar), 0, KM - 0.28, -0.01);
    vorhang.rotation.x = 0.05;
  }
  if (frisur === "zopf") {
    anziehen(kopf, new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.018, 8, 16), hut), 0, KM + 0.08, -0.31);
    for (let i = 0; i < 5; i++) {
      anziehen(kopf, kugel(0.07 - i * 0.008, haar), 0, KM + 0.06 - i * 0.1, -0.36 - i * 0.025);
    }
  }
  if (frisur === "irokese") {
    for (let a = -1.15; a <= 0.75; a += 0.27) {
      const hoehe = 0.34 - Math.abs(a + 0.2) * 0.12; // in der Mitte am höchsten
      const zacke = anziehen(kopf, new THREE.Mesh(new THREE.ConeGeometry(0.06, hoehe, 8), haar), 0, KM + Math.cos(a) * (0.27 + hoehe / 2), Math.sin(a) * (0.27 + hoehe / 2));
      zacke.rotation.x = a;
      zacke.scale.x = 0.5;
    }
  }

  // Kopfbedeckung
  switch (aussehen.kopf) {
    case "cap": {
      const krone = anziehen(kopf, new THREE.Mesh(new THREE.SphereGeometry(0.328, 28, 12, 0, Math.PI * 2, 0, Math.PI / 2), hut), 0, KM + 0.03, 0);
      krone.rotation.x = -0.15;
      const schirm = anziehen(kopf, new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.025, 24), hut), 0, KM + 0.12, 0.3);
      schirm.rotation.x = 0.12;
      schirm.scale.z = 0.95;
      break;
    }
    case "muetze": {
      const gruppe = new THREE.Group();
      gruppe.position.y = KM;
      gruppe.rotation.x = -0.3;
      kopf.add(gruppe);
      welt.kleidung.push(gruppe);
      anziehen(gruppe, new THREE.Mesh(new THREE.SphereGeometry(0.335, 28, 14, 0, Math.PI * 2, 0, 1.3), hut));
      const rand = anziehen(gruppe, new THREE.Mesh(new THREE.TorusGeometry(0.322, 0.045, 10, 32), hut), 0, Math.cos(1.3) * 0.335, 0);
      rand.rotation.x = Math.PI / 2;
      anziehen(gruppe, kugel(0.075, weissStoff), 0, 0.37, 0);
      break;
    }
    case "krone": {
      anziehen(kopf, new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.18, 0.12, 24, 1, true), material(0xd8b040, { metalness: 0.85, roughness: 0.3, side: THREE.DoubleSide })), 0, KM + 0.32, 0);
      for (let i = 0; i < 6; i++) {
        const w = (i / 6) * Math.PI * 2;
        anziehen(kopf, new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.1, 8), gold), Math.sin(w) * 0.195, KM + 0.43, Math.cos(w) * 0.195);
        anziehen(kopf, kugel(0.022, material(0xc0182a, { roughness: 0.2 }), 10), Math.sin(w) * 0.205, KM + 0.32, Math.cos(w) * 0.205);
      }
      break;
    }
    case "partyhut": {
      const tuete = anziehen(kopf, new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.4, 20), hut), 0.04, KM + 0.46, 0);
      tuete.rotation.z = -0.15;
      anziehen(kopf, kugel(0.045, gold), 0.07, KM + 0.67, 0);
      break;
    }
  }

  // Extras
  switch (aussehen.extra) {
    case "sonnenbrille": {
      // Gläser decken die gezeichneten Augen ganz ab; Rahmen in der Hutfarbe, weißer Glanzstreifen
      const glas = material(0x1a1d24, { roughness: 0.15, metalness: 0.4 });
      const rahmen = material(aussehen.hutfarbe, { roughness: 0.4 });
      const glanz = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55 });
      for (const x of [-0.1, 0.1]) {
        const seite = new THREE.Group();
        seite.position.set(x, KM + 0.035, 0.335);
        seite.rotation.y = x * 0.9;
        kopf.add(seite);
        welt.kleidung.push(seite);
        anziehen(seite, new THREE.Mesh(new THREE.BoxGeometry(0.19, 0.165, 0.014), rahmen));
        anziehen(seite, new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.145, 0.014), glas), 0, 0, 0.004);
        const streifen = anziehen(seite, new THREE.Mesh(new THREE.PlaneGeometry(0.025, 0.12), glanz), 0.03, 0.01, 0.012);
        streifen.rotation.z = -0.6;
      }
      anziehen(kopf, new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.018, 0.015), rahmen), 0, KM + 0.07, 0.345);
      break;
    }
    case "kette": {
      // hängt vorn als Bogen vom Hals auf die Brust
      const bogen = new THREE.CatmullRomCurve3([
        new THREE.Vector3(-0.1, 1.86, 0.03),
        new THREE.Vector3(-0.1, 1.76, 0.15),
        new THREE.Vector3(0, 1.66, 0.2),
        new THREE.Vector3(0.1, 1.76, 0.15),
        new THREE.Vector3(0.1, 1.86, 0.03)
      ]);
      anziehen(huefte, new THREE.Mesh(new THREE.TubeGeometry(bogen, 32, 0.014, 8), gold));
      const anhaenger = anziehen(huefte, new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.015, 20), gold), 0, 1.6, 0.205);
      anhaenger.rotation.x = Math.PI / 2;
      break;
    }
    case "fliege": {
      for (const s of [-1, 1]) {
        const fluegel = anziehen(huefte, new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.09, 4), hut), s * 0.045, 1.8, 0.14);
        fluegel.rotation.z = (s * Math.PI) / 2;
      }
      anziehen(huefte, kugel(0.022, hut, 10), 0, 1.8, 0.15);
      break;
    }
  }
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
    const innen = i === 0 ? 1 : -1; // Richtung zur Gesichtsmitte
    // Wimpern (weibliche Figur): drei Striche am äußeren oberen Lidrand
    if (g.frau && p.lid < 1) {
      ctx.strokeStyle = weiss;
      ctx.lineWidth = 4;
      const kante = y - p.augenHoehe + p.augenHoehe * 2 * p.lid;
      [0.35, 0.65, 0.95].forEach((anteil, j) => {
        const wx = x - innen * 24 * anteil;
        const wy = p.lid > 0 ? kante : y - p.augenHoehe * Math.sqrt(1 - anteil * anteil);
        ctx.beginPath();
        ctx.moveTo(wx, wy);
        ctx.lineTo(wx - innen * (5 + j * 4), wy - 11 + j * 2);
        ctx.stroke();
      });
    }
    // Braue: Linie über dem Auge, Neigung nach innen
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

  // Mund (weibliche Figur mit Lippenstift)
  ctx.strokeStyle = g.frau ? "#ff5a7e" : weiss;
  ctx.fillStyle = g.frau ? "#ff5a7e" : weiss;
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

  // Blick wie im Sitzen: Augen etwa auf Kopfhöhe des Gegenübers, flacher Blick über den Tisch, weites
  // Sichtfeld (man sieht Raum und Wand). Im schmalen Hochformat etwas weiter und weiter zurück, damit
  // Ziehstapel und Ablage samt Beschriftung in die Breite passen.
  const schmal = THREE.MathUtils.clamp((1 - kamera.aspect) / 0.55, 0, 1); // 0 = quer, 1 = Handy hochkant
  kamera.fov = 60 + 10 * schmal;
  const vfov = THREE.MathUtils.degToRad(kamera.fov);
  const hfov = 2 * Math.atan(Math.tan(vfov / 2) * kamera.aspect);
  let abstand = Math.max(5.3, 2.35 / Math.tan(hfov / 2));
  const quer = THREE.MathUtils.clamp((kamera.aspect - 1) / 1.1, 0, 1); // breite Bildschirme: flacher, mehr Wand
  let blickziel = new THREE.Vector3(0, 0.1 + 0.3 * quer, -1.1 - 0.5 * quer);
  let richtung = new THREE.Vector3(0, 0.52 - 0.08 * quer, 0.86).normalize(); // ca. 31° von oben (quer ca. 27°)
  kamera.clearViewOffset();
  if (welt.vorschau) {
    // Anprobe im Menü: nah an das Strichmännchen heran (Kopf bis Tischkante, Arme in der Breite), und zwar
    // in die Fläche, die das Menü frei lässt (unten im Hochformat, links im Querformat) – per View-Offset
    const menue = document.getElementById("menue").getBoundingClientRect();
    let freiB = breite;
    let freiH = hoehe;
    let versatzX = 0;
    let versatzY = 0;
    if (menue.top > hoehe * 0.25) {
      freiH = Math.max(80, menue.top);
      versatzY = (hoehe - freiH) / 2;
    } else if (menue.left > breite * 0.25) {
      freiB = Math.max(80, menue.left);
      versatzX = (breite - freiB) / 2;
    }
    blickziel = new THREE.Vector3(0, 1.15, welt.figur.position.z);
    richtung = new THREE.Vector3(0, 0.2, 1).normalize();
    abstand = Math.max(1.3 / (Math.tan(vfov / 2) * (freiH / hoehe)), 1.0 / (Math.tan(hfov / 2) * (freiB / breite)));
    kamera.setViewOffset(breite, hoehe, versatzX, versatzY, breite, hoehe);
  }
  welt.handGruppe.visible = !welt.vorschau;
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

// Münzseite: goldene Scheibe mit Namen (Canvas-Textur)
function muenzTextur(text) {
  const leinwand = document.createElement("canvas");
  leinwand.width = 256;
  leinwand.height = 256;
  const ctx = leinwand.getContext("2d");
  const verlauf = ctx.createRadialGradient(100, 90, 20, 128, 128, 128);
  verlauf.addColorStop(0, "#fff1b0");
  verlauf.addColorStop(0.6, "#e0b443");
  verlauf.addColorStop(1, "#9c7420");
  ctx.fillStyle = verlauf;
  ctx.beginPath();
  ctx.arc(128, 128, 128, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "rgba(110, 75, 15, 0.8)";
  ctx.lineWidth = 8;
  ctx.beginPath();
  ctx.arc(128, 128, 110, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = "#5a3d0a";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  let groesse = 64;
  ctx.font = `bold ${groesse}px sans-serif`;
  while (ctx.measureText(text).width > 180 && groesse > 20) {
    groesse -= 4;
    ctx.font = `bold ${groesse}px sans-serif`;
  }
  ctx.fillText(text, 128, 132);
  const textur = new THREE.CanvasTexture(leinwand);
  textur.encoding = THREE.sRGBEncoding;
  return textur;
}

// Münzwurf über der Tischmitte: gewinnerText liegt am Ende oben, die andere Seite unten
async function szeneMuenzwurf(gewinnerText, andererText) {
  if (welt.muenze) welt.szene.remove(welt.muenze);
  const muenze = new THREE.Group();
  const rand = new THREE.Mesh(
    new THREE.CylinderGeometry(0.42, 0.42, 0.05, 40, 1, true),
    new THREE.MeshStandardMaterial({ color: 0xc89b32, metalness: 0.8, roughness: 0.35 })
  );
  const seite = (text, oben) => {
    const flaeche = new THREE.Mesh(
      new THREE.CircleGeometry(0.42, 40),
      new THREE.MeshStandardMaterial({ map: muenzTextur(text), metalness: 0.5, roughness: 0.4 })
    );
    flaeche.rotation.x = oben ? -Math.PI / 2 : Math.PI / 2; // Schrift von unserem Platz aus lesbar
    flaeche.position.y = oben ? 0.026 : -0.026;
    return flaeche;
  };
  muenze.add(rand, seite(gewinnerText, true), seite(andererText, false));
  muenze.traverse(teil => (teil.castShadow = true));
  const mitte = new THREE.Vector3(0, 0.03, -0.75);
  muenze.position.copy(mitte);
  welt.szene.add(muenze);
  welt.muenze = muenze;

  // hochschnippen, wirbeln (ganze Umdrehungen, damit die Gewinnerseite oben landet), aufkommen
  const drehungen = 5 + Math.floor(Math.random() * 3);
  await animieren(dauer(1500), t => {
    muenze.position.y = mitte.y + 2.6 * 4 * t * (1 - t);
    muenze.rotation.x = Math.PI * 2 * drehungen * (1 - Math.pow(1 - t, 1.6));
    muenze.rotation.z = Math.sin(t * Math.PI) * 0.25;
  });
  muenze.rotation.set(0, 0, 0);
  // kurz nachwippen, liegen lassen, dann verschwinden
  await animieren(dauer(260), t => {
    muenze.rotation.z = Math.sin(t * Math.PI * 3) * 0.12 * (1 - t);
  });
  muenze.rotation.z = 0;
  await warteMs(dauer(1000));
  await animieren(dauer(350), t => muenze.scale.setScalar(1 - t));
  if (welt.muenze === muenze) welt.muenze = null;
  welt.szene.remove(muenze);
}

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
  const kopfNicken = welt.traurig ? 0.6 : welt.kopfZurueck || 0; // kopfZurueck: beim Zug an der Kippe
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
  welt.kippeImMund = false;
  welt.zugStart = 0;
  welt.kopfZurueck = 0;
  welt.huefte.position.y = -0.35;
  welt.huefte.rotation.set(0, 0, 0);
  welt.kopf.rotation.set(0, 0, 0);
  welt.gegnerFaecher.visible = true;
  for (const arm of [welt.armLinks, welt.armRechts]) {
    arm.greifAnteil = 0;
    arm.pol = null;
    fingerKruemmen(arm.hand, 0);
    arm.hand.scale.setScalar(1);
    arm.hand.userData.finger[1].scale.set(1, 1, 1);
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
  const mittelfinger = rechts.hand.userData.finger[1];
  // Hand und Mittelfinger wachsen während der Geste, damit man sie auch auf dem Handy erkennt
  const geste = k => {
    rechts.greifAnteil = k;
    fingerKruemmen(rechts.hand, k, 1);
    rechts.hand.scale.setScalar(1 + 0.7 * k);
    mittelfinger.scale.set(1 + 0.3 * k, 1 + 0.6 * k, 1 + 0.3 * k);
    huefte.rotation.x = 0.12 * k;
  };
  await animieren(dauer(450), t => {
    rechts.greifZiel.copy(ziel());
    geste(sanft(t));
  });
  // Halten, mit kleinem Nachdruck-Wippen
  await animieren(dauer(2600), t => {
    rechts.greifZiel.copy(ziel()).add(new THREE.Vector3(0, Math.sin(t * Math.PI * 8) * 0.04, 0));
  });
  await animieren(dauer(450), t => geste(1 - sanft(t)));
  geste(0);
  fingerKruemmen(rechts.hand, 0);
  rechts.pol = null;
}

// Mundwinkel im Kopf-Koordinatensystem (passt zum gezeichneten Mund auf der Gesichtsfläche)
const MUND_LOKAL = new THREE.Vector3(0.08, 0.16, 0.28);

function mundWelt() {
  return welt.kopf.localToWorld(MUND_LOKAL.clone());
}

// Zigarette: Ursprung am Filterende (das kommt in den Mund), Glut am anderen Ende
function kippeBauen() {
  const kippe = new THREE.Group();
  const filter = new THREE.Mesh(
    new THREE.CylinderGeometry(0.026, 0.026, 0.09, 10),
    new THREE.MeshStandardMaterial({ color: 0xd08a3a, roughness: 0.8 })
  );
  filter.position.y = 0.045;
  const papier = new THREE.Mesh(
    new THREE.CylinderGeometry(0.025, 0.025, 0.3, 10),
    new THREE.MeshStandardMaterial({ color: 0xf4f1e6, roughness: 0.8 })
  );
  papier.position.y = 0.24;
  const glut = new THREE.Mesh(
    new THREE.CylinderGeometry(0.027, 0.027, 0.03, 10),
    new THREE.MeshStandardMaterial({ color: 0x552200, emissive: 0x000000 })
  );
  glut.position.y = 0.405;
  kippe.add(filter, papier, glut);
  kippe.userData.glut = glut;
  return kippe;
}

// Kippe anzünden: in den Mundwinkel stecken, Feuerzeug an die Spitze, Glut – danach bleibt sie im Mund,
// und er zieht alle paar Sekunden daran (kippeZiehen in rauchAktualisieren)
async function kippeAnzuenden() {
  const rechts = welt.armRechts;
  const links = welt.armLinks;
  if (welt.kippeImMund) {
    naechsterZug = performance.now(); // raucht schon: nur kräftig ziehen
    return;
  }
  if (!welt.kippe) {
    const kippe = kippeBauen();
    kippe.position.set(0, -rechts.b - 0.04, 0.05); // zwischen den Fingern, quer zum Unterarm
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

  // 1. Zigarette zum Mund führen
  await animieren(dauer(750), t => {
    rechts.greifZiel.copy(mundWelt());
    rechts.greifAnteil = sanft(t);
  });
  // 2. In den Mundwinkel stecken: an den Kopf hängen, Filter im Mund, Spitze schräg nach vorn unten
  welt.kopf.attach(welt.kippe);
  const startPos = welt.kippe.position.clone();
  const startQuat = welt.kippe.quaternion.clone();
  const mundQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2 + 0.35, 0, -0.35));
  await animieren(dauer(250), t => {
    welt.kippe.position.lerpVectors(startPos, MUND_LOKAL, sanft(t));
    welt.kippe.quaternion.slerpQuaternions(startQuat, mundQuat, sanft(t));
  });
  // 3. Hand zurück zu den Karten, Feuerzeug an die Spitze
  const spitze = () => welt.kippe.userData.glut.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, -0.13, 0.02));
  await animieren(dauer(650), t => {
    rechts.greifAnteil = 1 - sanft(t);
    links.greifZiel.copy(spitze());
    links.greifAnteil = sanft(t);
  });
  // 4. Flamme, er zieht an – die Glut fängt an zu glühen
  welt.flamme.visible = true;
  welt.kopfZurueck = 0;
  await animieren(dauer(1100), t => {
    welt.kippe.userData.glut.material.emissive.setRGB(1, 0.35 * t, 0).multiplyScalar(t);
    welt.kopfZurueck = -0.1 * Math.sin(Math.PI * t);
  });
  welt.flamme.visible = false;
  // 5. Feuerzeug weg, erste Rauchwolke aus dem Mund, ab jetzt raucht er weiter
  welt.rauchAktiv = true;
  welt.kippeImMund = true;
  rauchWolkeAusMund();
  naechsterZug = performance.now() + 3500;
  await animieren(dauer(700), t => {
    links.greifAnteil = 1 - sanft(t);
  });
}

// Ausatmen: ein Schwall Wölkchen aus dem Mundwinkel – zur Seite und nach oben, damit das Gesicht sichtbar bleibt
function rauchWolkeAusMund() {
  if (!dauer(1)) return;
  const mund = mundWelt();
  for (let i = 0; i < 6; i++) {
    rauchTeilchen(
      mund,
      new THREE.Vector3(0.35 + Math.random() * 0.25, 0.3 + Math.random() * 0.2, 0.08 + Math.random() * 0.1),
      0.03,
      0.11,
      2.2,
      0.42
    );
  }
}

// Rauchwölkchen: fliegen los, wachsen, werden langsamer und verblassen
const rauchGeometrie = new THREE.SphereGeometry(1, 10, 8);
const rauchTeile = [];
let naechsterRauch = 0;
let naechsterZug = 0;
let naechsterAschenbecherRauch = 0;

function rauchTeilchen(position, geschwindigkeit, groesse, wachstum, lebensdauer, deckkraft) {
  const teil = new THREE.Mesh(
    rauchGeometrie,
    new THREE.MeshBasicMaterial({ color: 0xd4d4d4, transparent: true, opacity: deckkraft, depthWrite: false })
  );
  teil.position.copy(position);
  teil.scale.setScalar(groesse);
  teil.userData = { alter: 0, v: geschwindigkeit, groesse, wachstum, lebensdauer, deckkraft };
  welt.szene.add(teil);
  rauchTeile.push(teil);
}

function rauchAktualisieren(jetzt, dt) {
  const glutWelt = () => welt.kippe.userData.glut.getWorldPosition(new THREE.Vector3());

  // Zigarette im Aschenbecher: Glut flackert, dünner Rauch steigt dauerhaft auf
  if (welt.aschenbecherGlut && dauer(1)) {
    welt.aschenbecherGlut.material.emissiveIntensity = 0.8 + Math.sin(jetzt / 130) * 0.15 + Math.random() * 0.15;
    if (jetzt > naechsterAschenbecherRauch) {
      naechsterAschenbecherRauch = jetzt + 260 + Math.random() * 260;
      const quelle = welt.aschenbecherGlut.getWorldPosition(new THREE.Vector3());
      rauchTeilchen(quelle, new THREE.Vector3((Math.random() - 0.5) * 0.12, 0.35, (Math.random() - 0.5) * 0.12), 0.02, 0.07, 2.8, 0.32);
    }
  }

  // dünner Rauchfaden von der Spitze
  if (welt.rauchAktiv && welt.kippe && jetzt > naechsterRauch && dauer(1)) {
    naechsterRauch = jetzt + 180 + Math.random() * 220;
    rauchTeilchen(glutWelt(), new THREE.Vector3((Math.random() - 0.5) * 0.25, 0.45, 0), 0.025, 0.08, 2.2, 0.4);
  }

  // Zug an der Kippe im Mund: Glut leuchtet auf, Kopf leicht zurück, danach Rauch aus dem Mund
  if (welt.kippeImMund && welt.kippe && dauer(1)) {
    const glut = welt.kippe.userData.glut.material;
    if (!welt.zugStart && jetzt > naechsterZug && !welt.emoteLaeuft) welt.zugStart = jetzt;
    if (welt.zugStart) {
      const t = (jetzt - welt.zugStart) / 1300;
      if (t < 1) {
        const k = Math.sin(Math.PI * t);
        glut.emissive.setRGB(1, 0.35 + 0.3 * k, 0.05 * k);
        glut.emissiveIntensity = 1 + 1.8 * k;
        welt.kopfZurueck = -0.12 * k;
      } else {
        welt.zugStart = 0;
        glut.emissiveIntensity = 1;
        welt.kopfZurueck = 0;
        rauchWolkeAusMund();
        naechsterZug = jetzt + 4000 + Math.random() * 2500;
      }
    }
  }

  for (let i = rauchTeile.length - 1; i >= 0; i--) {
    const teil = rauchTeile[i];
    const d = teil.userData;
    d.alter += dt;
    const bremse = Math.max(0, 1 - d.alter * 0.6); // Wölkchen werden langsamer
    teil.position.addScaledVector(d.v, dt * bremse);
    teil.position.y += dt * 0.12; // warmer Rauch steigt
    teil.scale.setScalar(d.groesse + d.alter * d.wachstum);
    teil.material.opacity = Math.max(0, d.deckkraft * (1 - d.alter / d.lebensdauer));
    if (d.alter > d.lebensdauer) {
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
  if (welt.leckerliPackung && strahl.intersectObject(welt.leckerliPackung, true).length) return { art: "leckerli" };
  if (welt.katze && strahl.intersectObject(welt.katze.gruppe, true).length) return { art: "katze" };
  return null;
}

function zeigerBewegt(ereignis) {
  const treffer = trefferBestimmen(ereignis);
  const klickbar = typeof handKlickbar === "function" && handKlickbar();
  welt.hoverIndex = treffer && treffer.art === "hand" && klickbar ? treffer.index : -1;
  welt.hoverStapel = !!(treffer && treffer.art === "stapel" && klickbar);
  const katzenSache = !!(treffer && (treffer.art === "katze" || treffer.art === "leckerli"));
  welt.renderer.domElement.style.cursor = welt.hoverIndex !== -1 || welt.hoverStapel || katzenSache ? "pointer" : "default";
}

function geklickt(ereignis) {
  const treffer = trefferBestimmen(ereignis);
  if (!treffer) return;
  if (treffer.art === "hand") handKarteGeklickt(treffer.index);
  else if (treffer.art === "stapel") karteZiehen();
  else if (treffer.art === "katze") katzeStreicheln();
  else if (treffer.art === "leckerli") katzeFuettern();
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
  const dt = welt.letzteSchleife ? Math.min(0.1, (jetzt - welt.letzteSchleife) / 1000) : 0;
  welt.letzteSchleife = jetzt;
  katzeAktualisieren(jetzt, dt);
  handHoverAktualisieren();
  welt.renderer.render(welt.szene, welt.kamera);
}
