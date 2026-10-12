// 3D-Darstellung mit Three.js (lib/three.min.js, Version 0.149, globales THREE).
// Zeigt Raum, Tisch, Stapel, Ablage, die eigene Hand (an der Kamera) und den Gegner als Strichmännchen.
// Die Spiellogik (spiel.js) ruft nur die szene…-Funktionen auf; Zustand liest diese Datei nicht selbst.

const KARTE_B = 0.9;
const KARTE_H = 1.4; // Seitenverhältnis 144 × 224 wie die Kartenbilder
// Karten auf dem Tisch (Ablage, Ziehstapel) sind kleiner als die Kartenfläche KARTE_B × KARTE_H, damit sie
// zu Gläsern, Katze und Figur passen; die eigene Hand an der Kamera hat ihre eigene Größe (handLayout).
// Handy/Tablet (Fingerbedienung oder kleiner Bildschirm): Karten auf dem Tisch und in der Hand größer, damit man
// sie erkennt und gut antippen kann
const AUF_HANDY =
  (window.matchMedia && window.matchMedia("(pointer: coarse)").matches) || Math.min(screen.width, screen.height) < 520;

// Alle Karten auf dem Tisch (Ziehstapel, Ablage, Teilstapel) in derselben Größe
const TISCH_SKALA = AUF_HANDY ? 0.74 : 0.58;
const ABLAGE_SKALA = TISCH_SKALA;
const ZIEH_POS = new THREE.Vector3(-0.9, 0, -0.35);
const ABLAGE_POS = new THREE.Vector3(0.9, 0, -0.35);
const EIGENE_STAPEL_Z = 0.55;
const GEGNER_STAPEL_Z = -2.06;
const TEILSTAPEL_SKALA = TISCH_SKALA;
const HAND_ABSTAND = 2.3; // Abstand der eigenen Hand vor der Kamera
const GEGNER_KARTEN_SKALA = 0.45;

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

  // Die eigene Hand hängt am "Körper" (Grundstellung der Kamera), nicht am Kopf: Dreht man den Kopf
  // (blickZiehen), bleibt die Hand stehen und man kann auf die äußeren Karten des Bogens schauen.
  welt.koerper = new THREE.Group();
  welt.szene.add(welt.koerper);
  welt.handGruppe = new THREE.Group();
  welt.koerper.add(welt.handGruppe);
  welt.blick = { yaw: 0, pitch: 0 };

  window.addEventListener("resize", kameraAnpassen);
  // Ändert sich die Höhe der unteren Leiste (Zeilenumbruch, längere Meldung), Hand neu ausrichten
  const unteresUi = document.getElementById("unteresUi");
  if (unteresUi && window.ResizeObserver) new ResizeObserver(() => handLayout()).observe(unteresUi);
  renderer.domElement.addEventListener("pointermove", zeigerBewegt);
  renderer.domElement.addEventListener("pointerdown", ereignis => {
    zeigerRunter(ereignis);
    if (!welt.pinch) blickStart(ereignis);
  });
  renderer.domElement.addEventListener("pointermove", ereignis => {
    zeigerBewegtZoom(ereignis);
    if (!welt.pinch) blickZiehen(ereignis);
  });
  for (const art of ["pointerup", "pointercancel"]) {
    renderer.domElement.addEventListener(art, ereignis => {
      zeigerHoch(ereignis);
      blickEnde(ereignis);
    });
  }
  // Mausrad zoomt (am Rechner)
  renderer.domElement.addEventListener("wheel", ereignis => {
    ereignis.preventDefault();
    zoomSetzen((welt.zoom || 1) * Math.exp(-ereignis.deltaY * 0.0015));
  }, { passive: false });
  renderer.domElement.addEventListener("dblclick", () => blickZuruecksetzen());
  // Rechtsklick auf den eigenen Snack = auf das Gegenüber werfen (kein Browser-Menü über der Szene)
  renderer.domElement.addEventListener("contextmenu", ereignis => {
    ereignis.preventDefault();
    const treffer = trefferBestimmen(ereignis);
    if (treffer && treffer.art === "knabbern" && typeof snackWerfen === "function") snackWerfen();
  });
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
    const foto = name === "Back" && typeof KARTEN_RUECKSEITE !== "undefined";
    bild.onload = () => {
      const leinwand = document.createElement("canvas");
      leinwand.width = 432;
      leinwand.height = 672;
      const ctx = leinwand.getContext("2d");
      if (foto) {
        // Foto der Rückseite: Ecken abrunden (außen durchsichtig, alphaTest schneidet sie weg)
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(0, 0, 432, 672, 30);
        else ctx.rect(0, 0, 432, 672);
        ctx.clip();
      }
      ctx.drawImage(bild, 0, 0, leinwand.width, leinwand.height);
      const textur = new THREE.CanvasTexture(leinwand);
      textur.encoding = THREE.sRGBEncoding;
      textur.anisotropy = welt.renderer.capabilities.getMaxAnisotropy();
      kartenTexturen[name] = textur;
      fertig();
    };
    bild.onerror = () => fehler(new Error("Kartenbild nicht lesbar: " + name));
    bild.src = foto ? KARTEN_RUECKSEITE : "data:image/svg+xml;charset=utf-8," + encodeURIComponent(KARTEN_SVG[name]);
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

// Gemütlich gedimmt: schwaches warmes Grundlicht, ein Lichtkegel wie von einer Pendelleuchte über dem Tisch
// (wirft die Schatten), dazu Kaminfeuer und Stehlampe (in raumAusstatten) und ein schwaches Licht an der Kamera,
// damit die eigene Hand lesbar bleibt.
function lichtAufbauen() {
  welt.szene.add(new THREE.HemisphereLight(0xffe2c0, 0x2a1a10, 0.36));

  // Lichtkegel aus der Pendelleuchte unter der Decke (raumDekorieren)
  const pendel = new THREE.SpotLight(0xffdcae, 1.3, 0, 0.95, 0.6, 1);
  pendel.position.set(0, 4.35, -0.55);
  pendel.target.position.set(0, 0, -0.6);
  pendel.castShadow = true;
  pendel.shadow.mapSize.set(2048, 2048);
  pendel.shadow.camera.near = 0.5;
  pendel.shadow.camera.far = 10;
  pendel.shadow.bias = -0.0006;
  pendel.shadow.normalBias = 0.02;
  welt.szene.add(pendel, pendel.target);

  // Fülllicht an der Kamera (wandert mit, beleuchtet die eigene Hand und den vorderen Tisch)
  const fuell = new THREE.PointLight(0xfff0dc, 0.32, 9, 1);
  welt.kamera.add(fuell);
}

// Raum "über Eck": zwei Wände treffen sich hinter dem Gegenüber rechts in einer Ecke. welt.raum hat den
// Ursprung in der Ecke und ist um 30° gedreht: Wand 1 liegt bei lokal z = 0 (nach links, x < 0), Wand 2 bei
// lokal x = 0 (nach vorn, z > 0); der Raum ist lokal x < 0, z > 0. Sachen an den Wänden setzt anWand().
const RAUM_ECKE = new THREE.Vector3(2.45, 0, -7.76);
const RAUM_DREHUNG = Math.PI / 6;

// Fenster in Wand 2 (Mitte entlang der Wand, Höhe der Mitte, Größe der Öffnung)
// Fenster (wand 1 = links hinter dem Gegenüber), neben der Ecke; in der Ecke steht das Katzenklo
const FENSTER = { wand: 1, entlang: 1.3, y: 1.55, breite: 2.0, hoehe: 2.1 };
const TAPETE_RAPPORT = 0.9;

// Tapete: warmes Salbeigrün mit feinen hellen Streifen und kleinen goldenen Ornamenten (kachelbar)
function tapetenTextur() {
  const textur = gemaeldeTextur((ctx, b, h) => {
    ctx.fillStyle = "#6d7f63";
    ctx.fillRect(0, 0, b, h);
    ctx.fillStyle = "#77896c";
    ctx.fillRect(0, 0, b / 2, h);
    ctx.strokeStyle = "rgba(240, 225, 190, 0.35)";
    ctx.lineWidth = 3;
    for (const x of [1.5, b / 2 - 1.5]) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }
    // Ornament: kleine Lilie/Raute in Gold, versetzt
    const ornament = (x, y, s) => {
      ctx.fillStyle = "rgba(226, 190, 110, 0.75)";
      ctx.beginPath();
      ctx.moveTo(x, y - s);
      ctx.quadraticCurveTo(x + s * 0.55, y - s * 0.2, x, y + s);
      ctx.quadraticCurveTo(x - s * 0.55, y - s * 0.2, x, y - s);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(x - s * 0.55, y + s * 0.05, s * 0.22, 0, Math.PI * 2);
      ctx.arc(x + s * 0.55, y + s * 0.05, s * 0.22, 0, Math.PI * 2);
      ctx.fill();
    };
    ornament(b * 0.25, h * 0.25, 16);
    ornament(b * 0.75, h * 0.75, 16);
  }, 128, 128);
  textur.wrapS = textur.wrapT = THREE.RepeatWrapping;
  textur.repeat.set(1 / TAPETE_RAPPORT, 1 / TAPETE_RAPPORT);
  return textur;
}

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

  // Wände als Flächen in ihrer eigenen Ebene (u entlang der Wand, v = Höhe); Wand 2 hat ein Loch fürs Fenster.
  // ShapeGeometry nimmt die Koordinaten als UV – die Tapete wiederholt sich so alle TAPETE_RAPPORT Einheiten.
  const tapete = tapetenTextur();
  const wandMaterial = farbe => new THREE.MeshStandardMaterial({ map: tapete, color: farbe, roughness: 0.92 });
  const rechteck = (u0, u1) => {
    const form = new THREE.Shape();
    form.moveTo(u0, -3);
    form.lineTo(u1, -3);
    form.lineTo(u1, 13);
    form.lineTo(u0, 13);
    form.closePath();
    return form;
  };
  // Loch fürs Fenster: in Wand 1 läuft u = lokales x (nach links negativ), in Wand 2 u = lokales z
  const f = FENSTER;
  const mitteU = f.wand === 1 ? -f.entlang : f.entlang;
  const loch = new THREE.Path();
  loch.moveTo(mitteU - f.breite / 2, f.y - f.hoehe / 2);
  loch.lineTo(mitteU - f.breite / 2, f.y + f.hoehe / 2);
  loch.lineTo(mitteU + f.breite / 2, f.y + f.hoehe / 2);
  loch.lineTo(mitteU + f.breite / 2, f.y - f.hoehe / 2);
  loch.closePath();
  const form1 = rechteck(-30, 0);
  const form2 = rechteck(0, 30);
  (f.wand === 1 ? form1 : form2).holes.push(loch);
  const wand1 = new THREE.Mesh(new THREE.ShapeGeometry(form1), wandMaterial(0xffffff));
  wand1.receiveShadow = true;
  const wand2 = new THREE.Mesh(new THREE.ShapeGeometry(form2), wandMaterial(0xeae2d6)); // etwas dunkler: Ecke sichtbar
  wand2.rotation.y = -Math.PI / 2;
  wand2.receiveShadow = true;
  raum.add(wand1, wand2);

  // Parkett: Dielen im Versatz, leicht unterschiedliche Holztöne (kachelbar)
  const parkett = gemaeldeTextur((ctx, b, h) => {
    const dielen = 4;
    const dh = h / dielen;
    for (let r = 0; r < dielen; r++) {
      const versatz = (r % 2) * (b / 2);
      for (let x = -b; x < b; x += b / 2) {
        const ton = 70 + ((r * 37 + x * 3) % 24);
        ctx.fillStyle = `rgb(${ton + 30}, ${ton}, ${ton - 30})`;
        ctx.fillRect(x + versatz, r * dh, b / 2 - 2, dh - 2);
      }
    }
  }, 256, 128);
  parkett.wrapS = parkett.wrapT = THREE.RepeatWrapping;
  parkett.repeat.set(16, 24);
  const boden = new THREE.Mesh(
    new THREE.PlaneGeometry(40, 30),
    new THREE.MeshStandardMaterial({ map: parkett, roughness: 0.75 })
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
  // Holz mit Maserung (warmes Nussbraun)
  const maserung = gemaeldeTextur((ctx, b, h) => {
    ctx.fillStyle = "#5a3820";
    ctx.fillRect(0, 0, b, h);
    for (let i = 0; i < 46; i++) {
      const y = (i * 37) % h;
      ctx.strokeStyle = `rgba(${30 + (i % 3) * 12}, ${18 + (i % 4) * 6}, 8, ${0.25 + (i % 5) * 0.06})`;
      ctx.lineWidth = 1 + (i % 3);
      ctx.beginPath();
      ctx.moveTo(0, y);
      for (let x = 0; x <= b; x += 16) ctx.lineTo(x, y + Math.sin(x / 40 + i) * 4);
      ctx.stroke();
    }
  }, 256, 256);
  maserung.wrapS = maserung.wrapT = THREE.RepeatWrapping;
  const holz = new THREE.MeshStandardMaterial({ map: maserung, roughness: 0.55 });
  // Spielfilz: tiefes, warmes Waldgrün mit feiner Stoffstruktur (statt knalligem Billardgrün)
  const stoff = gemaeldeTextur((ctx, b, h) => {
    ctx.fillStyle = "#2c5a40";
    ctx.fillRect(0, 0, b, h);
    for (let i = 0; i < 9000; i++) {
      const x = (i * 7919) % b;
      const y = (i * 104729) % h;
      ctx.fillStyle = i % 2 ? "rgba(255, 245, 210, 0.03)" : "rgba(0, 0, 0, 0.045)";
      ctx.fillRect(x, y, 1, 1);
    }
  }, 256, 256);
  stoff.wrapS = stoff.wrapT = THREE.RepeatWrapping;
  stoff.repeat.set(6, 4);
  const filz = new THREE.MeshStandardMaterial({ map: stoff, color: 0xd8e2cc, roughness: 1 });
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
  raumDekorieren();
  bilderAufhaengen();
  pflanzeAufstellen();
  katzeHinlegen();
  leckerliPackungAufstellen();
  aschenbecherAufstellen();
}

// Was man vom Raum rundherum sieht: Fußleisten, Teppich; Wand 1 (links): Kamin, Bücherregal; Wand 2 (rechts):
// Fenster mit der Mondkatze, Stehlampe, Getränkeschrank mit Snacks. Boden bei y = −1.6; Wandplätze über anWand().
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

  fensterBauen(kasten, weissLack, holzDunkel);
  kaminBauen(kasten, holzDunkel);
  barSchrankBauen(kasten, holzDunkel);

  // Bücherregal links an Wand 1 (im Querformat sichtbar)
  const regal = anWand(new THREE.Group(), 1, 9.2, BODEN_Y, 0.28);
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

  // Stehlampe rechts neben dem Getränkeschrank, mit gedimmtem warmem Licht
  const lampe = anWand(new THREE.Group(), 2, 6.3, BODEN_Y, 0.5);
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
  const licht = new THREE.PointLight(0xffb866, 0.45, 8, 1.5);
  licht.position.y = 3.3;
  lampe.add(fuss, stab, schirm, licht);
  for (const teil of [fuss, stab, schirm]) teil.castShadow = true;
}

// Deko, die man vor allem beim Umschauen entdeckt: Balkendecke mit Pendelleuchte, Lichterkette, Wanduhr mit echter
// Uhrzeit über dem Katzenbild am Kamin, Leuchtschild über der Bar, Kratzbaum mit schlafender Katze, Tür mit
// Garderobe, Kaktus und Kerze auf der Fensterbank.
function raumDekorieren() {
  const BODEN_Y = -1.6;
  const DECKE_Y = 5.2;
  const mat = (farbe, extra = {}) => new THREE.MeshStandardMaterial({ color: farbe, roughness: 0.7, ...extra });
  const teil = (geo, material, x, y, z, eltern, schatten = true) => {
    const m = new THREE.Mesh(geo, material);
    m.position.set(x, y, z);
    m.castShadow = schatten;
    m.receiveShadow = true;
    eltern.add(m);
    return m;
  };
  const holzDunkel = mat(0x3e2614);
  const holzMittel = mat(0x6b4423, { roughness: 0.6 });
  const weissLack = mat(0xece6da, { roughness: 0.5 });
  const messing = mat(0xc9a24a, { metalness: 0.8, roughness: 0.3 });

  // ---- Decke mit Holzbalken (wirft keine Schatten – sonst wäre unten alles dunkel) ----
  const decke = new THREE.Mesh(new THREE.PlaneGeometry(30, 30), mat(0xe8dcc6, { roughness: 0.95 }));
  decke.rotation.x = Math.PI / 2;
  decke.position.set(-15, DECKE_Y, 15);
  welt.raum.add(decke);
  for (let z = 0.9; z < 16; z += 1.7) teil(new THREE.BoxGeometry(30, 0.22, 0.26), holzDunkel, -15, DECKE_Y - 0.11, z, welt.raum, false);

  // ---- Pendelleuchte über dem Tisch (der Lichtkegel kommt aus ihr, siehe lichtAufbauen) ----
  const pendel = new THREE.Group();
  pendel.position.set(0, 0, -0.55);
  welt.szene.add(pendel);
  teil(new THREE.CylinderGeometry(0.012, 0.012, 0.6, 6), mat(0x111111), 0, DECKE_Y - 0.3, 0, pendel, false);
  teil(
    new THREE.CylinderGeometry(0.1, 0.42, 0.34, 28, 1, true),
    mat(0x2f4a3a, { metalness: 0.4, roughness: 0.4, side: THREE.DoubleSide, emissive: 0x1a0e00 }),
    0, DECKE_Y - 0.72, 0, pendel, false
  );
  teil(new THREE.SphereGeometry(0.08, 14, 10), new THREE.MeshBasicMaterial({ color: 0xffe2a8 }), 0, DECKE_Y - 0.8, 0, pendel, false);

  // ---- Lichterkette oben an beiden Wänden, durchhängend zwischen Haken ----
  const lampenMat = [0xffd27a, 0xffb347, 0xfff2c0].map(farbe => new THREE.MeshBasicMaterial({ color: farbe }));
  const birne = new THREE.SphereGeometry(0.035, 8, 6);
  const kette = (wand, von, bis) => {
    const punkte = [];
    let n = 0;
    for (let s = von; s <= bis; s += 0.08) {
      const u = ((s - von) % 2) / 2; // alle 2 Einheiten ein Haken
      const y = DECKE_Y - 0.45 - Math.sin(Math.PI * u) * 0.32;
      const p = wand === 1 ? new THREE.Vector3(-s, y, 0.06) : new THREE.Vector3(-0.06, y, s);
      punkte.push(p);
      if (n++ % 3 === 0) {
        const b = new THREE.Mesh(birne, lampenMat[(n / 3) % 3 | 0]);
        b.position.copy(p).add(new THREE.Vector3(0, -0.04, 0));
        welt.raum.add(b);
      }
    }
    welt.raum.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(punkte), new THREE.LineBasicMaterial({ color: 0x1a1a1a })));
  };
  kette(1, 0.1, 14);
  kette(2, 0.1, 9);
  const kettenLicht = new THREE.PointLight(0xffc477, 0.25, 9, 1.5);
  kettenLicht.position.set(-1.2, DECKE_Y - 0.9, 1.2);
  welt.raum.add(kettenLicht);
  welt.lichterkette = lampenMat;

  // ---- Wanduhr über dem Katzenbild am Kamin (zeigt die echte Uhrzeit, uhrAktualisieren) ----
  const uhr = anWand(new THREE.Group(), 1, KAMIN.entlang, 2.3, KAMIN.tiefe + 0.03);
  const ziffernblatt = gemaeldeTextur((ctx, b, h) => {
    ctx.fillStyle = "#f4ead2";
    ctx.beginPath();
    ctx.arc(b / 2, h / 2, b / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#2a1a0e";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `bold ${Math.round(b * 0.11)}px Georgia, serif`;
    for (let i = 1; i <= 12; i++) {
      const w = (i / 12) * Math.PI * 2;
      ctx.fillText(String(i), b / 2 + Math.sin(w) * b * 0.37, h / 2 - Math.cos(w) * h * 0.37);
    }
    for (let i = 0; i < 60; i++) {
      const w = (i / 60) * Math.PI * 2;
      const lang = i % 5 === 0 ? 0.06 : 0.03;
      ctx.lineWidth = i % 5 === 0 ? 3 : 1.5;
      ctx.strokeStyle = "#2a1a0e";
      ctx.beginPath();
      ctx.moveTo(b / 2 + Math.sin(w) * b * (0.47 - lang), h / 2 - Math.cos(w) * h * (0.47 - lang));
      ctx.lineTo(b / 2 + Math.sin(w) * b * 0.47, h / 2 - Math.cos(w) * h * 0.47);
      ctx.stroke();
    }
  }, 256, 256);
  const R = 0.34;
  teil(new THREE.CircleGeometry(R, 40), new THREE.MeshStandardMaterial({ map: ziffernblatt, roughness: 0.6 }), 0, 0, 0.02, uhr, false);
  teil(new THREE.TorusGeometry(R + 0.02, 0.035, 10, 40), messing, 0, 0, 0.025, uhr);
  const zeiger = (laenge, breite, farbe, z) => {
    const geo = new THREE.BoxGeometry(breite, laenge, 0.01);
    geo.translate(0, laenge / 2 - 0.03, 0); // dreht sich um die Mitte des Ziffernblatts
    return teil(geo, mat(farbe), 0, 0, z, uhr, false);
  };
  welt.uhr = {
    stunde: zeiger(R * 0.55, 0.035, 0x1a1a1a, 0.035),
    minute: zeiger(R * 0.8, 0.022, 0x1a1a1a, 0.045),
    sekunde: zeiger(R * 0.85, 0.01, 0xc0182a, 0.055)
  };
  teil(new THREE.CylinderGeometry(0.025, 0.025, 0.03, 12), messing, 0, 0, 0.06, uhr, false).rotation.x = Math.PI / 2;

  // ---- Leuchtschild über der Bar ----
  const neonTextur = gemaeldeTextur((ctx, b, h) => {
    ctx.clearRect(0, 0, b, h);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `900 ${Math.round(h * 0.52)}px "Trebuchet MS", sans-serif`;
    ctx.shadowColor = "#ff3fa4";
    ctx.shadowBlur = 24;
    ctx.strokeStyle = "#ff7ac4";
    ctx.lineWidth = 6;
    ctx.strokeText("MAU MAU ♠", b / 2, h / 2);
    ctx.shadowBlur = 8;
    ctx.fillStyle = "#ffe0f2";
    ctx.fillText("MAU MAU ♠", b / 2, h / 2);
  }, 512, 140);
  const neon = anWand(new THREE.Group(), 2, 4.55, 2.6, 0.04);
  const schild = teil(new THREE.PlaneGeometry(1.8, 0.49), new THREE.MeshBasicMaterial({ map: neonTextur, transparent: true, depthWrite: false }), 0, 0, 0.02, neon, false);
  const neonLicht = new THREE.PointLight(0xff4fa8, 0.35, 3.5, 1.5);
  neonLicht.position.set(0, 0, 0.5);
  neon.add(neonLicht);
  welt.neon = { schild, licht: neonLicht, naechstesFlackern: 0 };

  // ---- Kratzbaum an Wand 2 neben der Ecke, oben wohnt die graue Katze (zweiteKatzeBauen) ----
  const baum = anWand(new THREE.Group(), 2, 1.95, BODEN_Y, 0.6);
  baum.scale.setScalar(1.35);
  const sisal = gemaeldeTextur((ctx, b, h) => {
    ctx.fillStyle = "#c9a774";
    ctx.fillRect(0, 0, b, h);
    ctx.strokeStyle = "rgba(110, 80, 40, 0.5)";
    ctx.lineWidth = 2;
    for (let y = 0; y < h; y += 5) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(b, y + 3);
      ctx.stroke();
    }
  }, 64, 64);
  sisal.wrapS = sisal.wrapT = THREE.RepeatWrapping;
  sisal.repeat.set(2, 10);
  const pluesch = mat(0xd8cbb4, { roughness: 1 });
  teil(new THREE.BoxGeometry(0.8, 0.08, 0.8), pluesch, 0, 0.04, 0, baum);
  for (const [x, z, hoehe] of [[-0.18, -0.15, 2.6], [0.2, 0.12, 1.75]]) {
    teil(new THREE.CylinderGeometry(0.075, 0.075, hoehe, 14), mat(0xffffff, { map: sisal, roughness: 1 }), x, hoehe / 2, z, baum);
  }
  teil(new THREE.BoxGeometry(0.62, 0.07, 0.5), pluesch, 0.12, 0.95, 0.05, baum);
  teil(new THREE.BoxGeometry(0.6, 0.07, 0.48), pluesch, 0.08, 1.78, 0.08, baum);
  // Liegemulde oben
  teil(new THREE.CylinderGeometry(0.34, 0.3, 0.1, 24), pluesch, -0.12, 2.65, -0.1, baum);
  const rand = teil(new THREE.TorusGeometry(0.31, 0.07, 10, 24), pluesch, -0.12, 2.72, -0.1, baum);
  rand.rotation.x = Math.PI / 2;
  const grau = mat(0x8a8a90, { roughness: 1 });

  // ---- Katzenklo in der Ecke zwischen Kratzbaum und Fenster ----
  const klo = new THREE.Group();
  klo.position.set(-0.55, BODEN_Y, 0.55);
  klo.rotation.y = Math.PI / 4;
  welt.raum.add(klo);
  const plastik = mat(0x5f8fb0, { roughness: 0.5 });
  teil(new THREE.BoxGeometry(0.62, 0.05, 0.5), plastik, 0, 0.025, 0, klo);
  for (const [b, t, x, z] of [[0.62, 0.04, 0, 0.23], [0.62, 0.04, 0, -0.23], [0.04, 0.5, 0.29, 0], [0.04, 0.5, -0.29, 0]]) {
    teil(new THREE.BoxGeometry(b, 0.2, t), plastik, x, 0.1, z, klo);
  }
  teil(new THREE.BoxGeometry(0.56, 0.02, 0.44), mat(0xd9c49a, { roughness: 1 }), 0, 0.15, 0, klo); // Streu
  const schaufel = teil(new THREE.BoxGeometry(0.1, 0.01, 0.14), mat(0xe6453a), 0.42, 0.01, 0.1, klo);
  schaufel.rotation.y = 0.5;

  zweiteKatzeBauen(baum, klo);
  // Spielzeugmaus an einer Schnur unter der unteren Ebene (die Katze kommt vom Boden aus dran); pendelt um den
  // Aufhängepunkt (welt.spielmaus.schwung, die Katze stupst sie an)
  const mausAufhaengung = new THREE.Group();
  mausAufhaengung.position.set(0.3, 0.9, 0.22);
  baum.add(mausAufhaengung);
  mausAufhaengung.add(new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, -0.5, 0)]),
    new THREE.LineBasicMaterial({ color: 0xeeeeee })
  ));
  const maus = teil(new THREE.SphereGeometry(0.05, 10, 8), grau, 0, -0.54, 0, mausAufhaengung);
  maus.scale.set(1, 0.8, 1.4);
  teil(new THREE.CylinderGeometry(0.004, 0.004, 0.12, 4), mat(0xe8a0a0), 0, -0.56, -0.1, mausAufhaengung).rotation.x = Math.PI / 2;
  welt.spielmaus = { aufhaengung: mausAufhaengung, schwung: 0.05 };

  // ---- Tür links hinter dem Bücherregal, daneben eine Garderobe ----
  const tuer = anWand(new THREE.Group(), 1, 13, BODEN_Y, 0);
  for (const [b, h, x, y] of [[0.1, 2.3, -0.58, 1.15], [0.1, 2.3, 0.58, 1.15], [1.26, 0.1, 0, 2.3]]) {
    teil(new THREE.BoxGeometry(b, h, 0.12), weissLack, x, y, 0.06, tuer);
  }
  teil(new THREE.BoxGeometry(1.06, 2.25, 0.05), holzMittel, 0, 1.125, 0.03, tuer);
  for (const [x, y, h] of [[-0.24, 1.65, 0.7], [0.24, 1.65, 0.7], [-0.24, 0.6, 0.85], [0.24, 0.6, 0.85]]) {
    teil(new THREE.BoxGeometry(0.36, h, 0.02), holzDunkel, x, y, 0.06, tuer); // Kassetten
  }
  teil(new THREE.SphereGeometry(0.045, 12, 8), messing, 0.4, 1.05, 0.1, tuer);
  const garderobe = anWand(new THREE.Group(), 1, 14.4, 0.3, 0.02);
  teil(new THREE.BoxGeometry(1.0, 0.12, 0.04), holzDunkel, 0, 0, 0.02, garderobe);
  for (const x of [-0.35, 0, 0.35]) teil(new THREE.CylinderGeometry(0.015, 0.015, 0.12, 6), messing, x, -0.02, 0.09, garderobe).rotation.x = Math.PI / 2;
  // Hut am linken Haken, Schal am rechten
  teil(new THREE.CylinderGeometry(0.2, 0.2, 0.02, 20), mat(0x2a2a2a), -0.35, -0.05, 0.2, garderobe).rotation.x = 1.2;
  teil(new THREE.CylinderGeometry(0.11, 0.12, 0.16, 18), mat(0x2a2a2a), -0.35, 0.0, 0.17, garderobe).rotation.x = 1.2;
  const schal = teil(new THREE.BoxGeometry(0.12, 0.9, 0.03), mat(0xb3202a, { roughness: 1 }), 0.35, -0.45, 0.12, garderobe);
  schal.rotation.z = 0.05;

  // ---- Gerahmte Gemälde für die freien Wandstücke ----
  const gemaelde = (wand, entlang, y, breite, hoehe, malen) => {
    const g = anWand(new THREE.Group(), wand, entlang, y, 0.04);
    teil(new THREE.BoxGeometry(breite + 0.16, hoehe + 0.16, 0.07), holzDunkel, 0, 0, 0, g);
    teil(new THREE.PlaneGeometry(breite, hoehe), new THREE.MeshStandardMaterial({ map: gemaeldeTextur(malen, 512, Math.round((512 * hoehe) / breite)), roughness: 0.8 }), 0, 0, 0.037, g, false);
    return g;
  };
  gemaelde(1, 11.6, 1.75, 1.05, 1.35, abstraktMalen); // links über der Pflanze
  gemaelde(2, 10.3, 1.85, 1.7, 1.1, sonnenuntergangMalen); // rechts über dem Sessel

  // ---- Wandbrett über der Tür mit kleinen Töpfen und Hängepflanzen ----
  const brett = anWand(new THREE.Group(), 1, 13, 1.0, 0.02);
  teil(new THREE.BoxGeometry(1.4, 0.05, 0.25), holzDunkel, 0, 0, 0.12, brett);
  const blattGruen = mat(0x3f7a45, { roughness: 0.8 });
  for (const [x, farbe] of [[-0.45, 0xb5603a], [0, 0xece6da], [0.45, 0x3a7a8c]]) {
    teil(new THREE.CylinderGeometry(0.09, 0.07, 0.16, 12), mat(farbe), x, 0.105, 0.12, brett);
    teil(new THREE.SphereGeometry(0.11, 10, 8), blattGruen, x, 0.24, 0.12, brett);
    // Ranken hängen über die Kante herab
    for (let i = 1; i <= 6; i++) {
      teil(new THREE.SphereGeometry(0.045, 8, 6), blattGruen, x + Math.sin(i * 1.3) * 0.05, 0.05 - i * 0.11, 0.24, brett);
    }
  }

  // ---- Ohrensessel aus rotem Samt mit Decke, rechts unter dem großen Gemälde ----
  const sessel = anWand(new THREE.Group(), 2, 10.3, BODEN_Y, 0.6);
  const samt = mat(0x7a1f2a, { roughness: 1 });
  teil(new THREE.BoxGeometry(1.0, 0.42, 0.85), samt, 0, 0.38, 0, sessel); // Sitz
  teil(new THREE.BoxGeometry(1.0, 1.35, 0.22), samt, 0, 0.95, -0.34, sessel); // Lehne
  for (const s of [-1, 1]) {
    teil(new THREE.BoxGeometry(0.16, 0.38, 0.85), samt, s * 0.55, 0.72, 0, sessel); // Armlehnen
    teil(new THREE.BoxGeometry(0.12, 0.55, 0.3), samt, s * 0.48, 1.38, -0.24, sessel); // Ohren
    for (const z of [-0.33, 0.33]) teil(new THREE.CylinderGeometry(0.035, 0.025, 0.17, 8), holzDunkel, s * 0.42, 0.085, z, sessel);
  }
  teil(new THREE.BoxGeometry(0.85, 0.12, 0.7), mat(0x8f2a35, { roughness: 1 }), 0, 0.65, 0.04, sessel); // Kissen
  teil(new THREE.BoxGeometry(0.2, 0.03, 0.9), mat(0xd9a441, { roughness: 1 }), 0.55, 0.93, 0, sessel); // Decke über der Lehne
  teil(new THREE.BoxGeometry(0.2, 0.5, 0.03), mat(0xd9a441, { roughness: 1 }), 0.65, 0.7, 0.42, sessel);

  // ---- Fensterbank: Kaktus im Topf und eine Kerze ----
  const bankY = FENSTER.y - FENSTER.hoehe / 2 - 0.02;
  const kaktus = anWand(new THREE.Group(), FENSTER.wand, FENSTER.entlang + 0.75, bankY, 0.16);
  teil(new THREE.CylinderGeometry(0.08, 0.06, 0.14, 14), mat(0xb5603a), 0, 0.07, 0, kaktus);
  teil(new THREE.CapsuleGeometry(0.05, 0.16, 4, 10), mat(0x3f7a45), 0, 0.26, 0, kaktus);
  const arm = teil(new THREE.CapsuleGeometry(0.025, 0.06, 4, 8), mat(0x3f7a45), 0.06, 0.28, 0, kaktus);
  arm.rotation.z = -0.6;
  const kerze = anWand(new THREE.Group(), FENSTER.wand, FENSTER.entlang - 0.75, bankY, 0.16);
  teil(new THREE.CylinderGeometry(0.045, 0.045, 0.18, 12), mat(0xf2ead8), 0, 0.09, 0, kerze);
  const flamme = teil(new THREE.ConeGeometry(0.02, 0.06, 8), new THREE.MeshBasicMaterial({ color: 0xffd27a, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }), 0, 0.22, 0, kerze, false);
  welt.fensterKerze = flamme;
}

// Zweite (graue, getigerte) Katze: wohnt oben im Kratzbaum. Ab und zu wacht sie auf, streckt sich, gähnt, klettert
// herunter und unternimmt etwas (in zufälliger Auswahl/Reihenfolge): aufs Klo gehen und scharren, auf der
// Fensterbank sitzen und hinausschauen, am Kratzbaum kratzen, mit der Spielmaus spielen, sich putzen – dann
// klettert sie zurück ins Bett. Kind von welt.raum (Koordinaten im Raum).
// Aufbau: Ursprung zwischen den Pfoten am Boden, Kopf zeigt nach +x. Das Becken (Gelenk an den Hinterbeinen) kippt
// den Vorderkörper samt Vorderbeinen und Kopf hoch – so entstehen Sitzen und Aufrichten zum Kratzen.
function zweiteKatzeBauen(baum, klo) {
  const fellTextur = gemaeldeTextur((ctx, b, h) => {
    ctx.fillStyle = "#8d8d94";
    ctx.fillRect(0, 0, b, h);
    ctx.fillStyle = "rgba(60, 60, 66, 0.55)";
    for (let x = 0; x < b; x += 22) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      for (let y = 0; y <= h; y += 8) ctx.lineTo(x + Math.sin(y / 14 + x) * 4, y);
      for (let y = h; y >= 0; y -= 8) ctx.lineTo(x + 7 + Math.sin(y / 14 + x) * 4, y);
      ctx.fill();
    }
  }, 256, 128);
  const fell = new THREE.MeshStandardMaterial({ map: fellTextur, roughness: 1 });
  const grau = new THREE.MeshStandardMaterial({ color: 0x8a8a90, roughness: 1 });
  const weiss = new THREE.MeshStandardMaterial({ color: 0xf2efe8, roughness: 1 });
  const rosa = new THREE.MeshStandardMaterial({ color: 0xe8a0a0, roughness: 0.7 });
  const dunkel = new THREE.MeshStandardMaterial({ color: 0x3a3a40, roughness: 1 });
  const kugel = new THREE.SphereGeometry(1, 18, 14);
  const teil = (geo, m, x, y, z, eltern, skala) => {
    const t = new THREE.Mesh(geo, m);
    t.position.set(x, y, z);
    if (skala) t.scale.set(...skala);
    t.castShadow = true;
    eltern.add(t);
    return t;
  };

  const katze = new THREE.Group();
  welt.raum.add(katze);
  const becken = new THREE.Group(); // Gelenk über den Hinterbeinen
  becken.position.set(-0.1, 0.17, 0);
  katze.add(becken);
  // Rumpf aus Brust, Hüfte und hellem Bauch
  teil(kugel, fell, 0.17, 0.01, 0, becken, [0.15, 0.11, 0.12]);
  teil(kugel, fell, 0.03, 0, 0, becken, [0.15, 0.115, 0.13]);
  teil(kugel, weiss, 0.12, -0.055, 0, becken, [0.13, 0.055, 0.085]);
  teil(kugel, weiss, 0.27, 0.01, 0, becken, [0.06, 0.08, 0.075]); // Brustlatz

  // Kopf
  const kopf = new THREE.Group();
  kopf.position.set(0.33, 0.1, 0);
  becken.add(kopf);
  teil(kugel, fell, 0, 0, 0, kopf, [0.085, 0.077, 0.088]);
  for (const s of [-1, 1]) {
    teil(kugel, fell, 0.03, -0.025, s * 0.04, kopf, [0.045, 0.04, 0.045]); // Backen
    const ohr = teil(new THREE.ConeGeometry(0.032, 0.07, 4), grau, -0.01, 0.075, s * 0.045, kopf);
    ohr.rotation.x = s * 0.3;
    const innen = teil(new THREE.ConeGeometry(0.02, 0.05, 4), rosa, 0.006, 0.072, s * 0.045, kopf);
    innen.rotation.x = s * 0.3;
  }
  teil(kugel, weiss, 0.065, -0.03, 0, kopf, [0.035, 0.028, 0.042]); // Schnauze
  teil(kugel, weiss, 0.05, -0.055, 0, kopf, [0.03, 0.02, 0.03]); // Kinn
  teil(new THREE.ConeGeometry(0.012, 0.015, 3), rosa, 0.097, -0.012, 0, kopf).rotation.z = -Math.PI / 2;
  const mund = teil(new THREE.BoxGeometry(0.03, 0.03, 0.035), new THREE.MeshStandardMaterial({ color: 0x7a2a30 }), 0.08, -0.047, 0, kopf);
  mund.scale.y = 0.01;
  const haarPunkte = [];
  for (const s of [-1, 1]) {
    for (let i = 0; i < 3; i++) {
      haarPunkte.push(new THREE.Vector3(0.085, -0.025 + i * 0.008, s * 0.025), new THREE.Vector3(0.13, -0.04 + i * 0.02, s * 0.12));
    }
  }
  kopf.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(haarPunkte), new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8 })));
  const augenOffen = new THREE.Group();
  const augenZu = new THREE.Group();
  kopf.add(augenOffen, augenZu);
  for (const s of [-1, 1]) {
    teil(kugel, new THREE.MeshStandardMaterial({ color: 0xc8d860, emissive: 0x222a08, roughness: 0.3 }), 0.066, 0.018, s * 0.036, augenOffen, [0.012, 0.017, 0.016]);
    teil(kugel, new THREE.MeshBasicMaterial({ color: 0x0b0b0b }), 0.077, 0.018, s * 0.036, augenOffen, [0.004, 0.013, 0.005]);
    teil(new THREE.BoxGeometry(0.004, 0.004, 0.026), dunkel, 0.075, 0.015, s * 0.036, augenZu);
  }

  // Beine: vorne am Becken (kippen mit), hinten an der Katze; jeweils mit weißer Pfote
  const bein = (eltern, x, y, z) => {
    const gelenk = new THREE.Group();
    gelenk.position.set(x, y, z);
    eltern.add(gelenk);
    const geo = new THREE.CylinderGeometry(0.024, 0.02, 0.16, 8);
    geo.translate(0, -0.08, 0);
    teil(geo, fell, 0, 0, 0, gelenk);
    teil(kugel, weiss, 0.01, -0.165, 0, gelenk, [0.03, 0.017, 0.026]);
    return gelenk;
  };
  const vorne = [bein(becken, 0.24, -0.01, 0.06), bein(becken, 0.24, -0.01, -0.06)];
  const hinten = [bein(katze, -0.1, 0.16, 0.065), bein(katze, -0.1, 0.16, -0.065)];

  // Schwanz (gestreift) mit Gelenk an der Wurzel
  const schwanz = new THREE.Group();
  becken.add(schwanz);
  schwanz.position.set(-0.12, 0.02, 0);
  teil(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0, 0), new THREE.Vector3(-0.08, 0.1, 0), new THREE.Vector3(-0.07, 0.24, 0), new THREE.Vector3(0.0, 0.33, 0)
  ]), 20, 0.022, 8), fell, 0, 0, 0, schwanz);

  // Wegpunkte im Raum
  welt.raum.updateWorldMatrix(true, true);
  const zuRaum = (obj, x, y, z) => welt.raum.worldToLocal(obj.localToWorld(new THREE.Vector3(x, y, z)));
  const bankY = FENSTER.y - FENSTER.hoehe / 2 - 0.02;
  const fensterMitte = FENSTER.wand === 1 ? new THREE.Vector3(-FENSTER.entlang, 0, 0) : new THREE.Vector3(0, 0, FENSTER.entlang);
  const raus = FENSTER.wand === 1 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(-1, 0, 0); // vom Fenster in den Raum
  const ort = {
    bett: zuRaum(baum, -0.12, 2.74, -0.1),
    ebene2: zuRaum(baum, 0.08, 1.82, 0.08),
    ebene1: zuRaum(baum, 0.12, 0.99, 0.05),
    baumBoden: zuRaum(baum, 0.25, 0, 0.75),
    kratzen: zuRaum(baum, -0.18, 0, 0.34),
    pfosten: zuRaum(baum, -0.18, 0, -0.15),
    maus: zuRaum(baum, 0.3, 0, 0.6),
    mausZiel: zuRaum(baum, 0.3, 0, 0.22),
    kloMitte: zuRaum(klo, 0, 0.16, 0),
    kloVorne: zuRaum(klo, -0.62, 0, 0),
    unterFenster: fensterMitte.clone().addScaledVector(raus, 0.85).setY(-1.6),
    fensterbank: fensterMitte.clone().addScaledVector(raus, 0.2).setY(bankY),
    rausBlick: Math.atan2(raus.z, -raus.x) // Kopf zum Fenster hinaus
  };
  katze.position.copy(ort.bett);
  katze.rotation.y = -Math.PI / 2;
  welt.katze2 = {
    gruppe: katze, becken, kopf, mund, augenOffen, augenZu, schwanz, vorne, hinten, ort,
    plan: [{ art: "schlafen", dauer: 15000 + Math.random() * 20000 }],
    aktion: null, zielDrehung: -Math.PI / 2, wo: ort.bett.clone()
  };
}

// Haltungen der grauen Katze (für Übergänge überblendet). beckenNeig kippt den Vorderkörper hoch,
// vorneDreh dreht die Vorderbeine gegen (sitzend senkrecht, beim Kratzen nach vorn oben)
const KATZE2_HALTUNG = {
  liegen: { beckenY: 0.09, beckenNeig: 0, vorneDreh: 0, vorneLaenge: 0.15, hintenLaenge: 0.15, kopfY: 0.03, kopfNeig: -0.15, schwanzNeig: 1.9 },
  stehen: { beckenY: 0.17, beckenNeig: 0, vorneDreh: 0, vorneLaenge: 1, hintenLaenge: 1, kopfY: 0.1, kopfNeig: 0, schwanzNeig: -0.25 },
  sitzen: { beckenY: 0.12, beckenNeig: 0.6, vorneDreh: -0.6, vorneLaenge: 1.4, hintenLaenge: 0.4, kopfY: 0.08, kopfNeig: -0.5, schwanzNeig: 1.2 },
  kratzen: { beckenY: 0.15, beckenNeig: 1.15, vorneDreh: 0.75, vorneLaenge: 1, hintenLaenge: 0.95, kopfY: 0.06, kopfNeig: -0.95, schwanzNeig: 0.5 }
};

function katze2Haltung(a, b, k, k2) {
  const h = {};
  for (const schluessel of Object.keys(a)) h[schluessel] = a[schluessel] + (b[schluessel] - a[schluessel]) * k;
  k2.becken.position.y = h.beckenY;
  k2.becken.rotation.z = h.beckenNeig;
  k2.kopf.position.y = h.kopfY;
  k2.kopf.rotation.z = h.kopfNeig;
  k2.schwanz.rotation.z = h.schwanzNeig - h.beckenNeig;
  for (const bein of k2.vorne) {
    bein.scale.y = h.vorneLaenge;
    bein.rotation.z = h.vorneDreh;
  }
  for (const bein of k2.hinten) {
    bein.scale.y = h.hintenLaenge;
    bein.position.y = h.beckenY - 0.01;
    bein.rotation.z = 0;
  }
  return h;
}

// Ein Ausflug: aufwachen, herunterklettern, 2–3 Unternehmungen in zufälliger Reihenfolge, zurück ins Bett
function katze2Ausflug(k2) {
  const o = k2.ort;
  let wo = o.baumBoden;
  const springen = (von, nach, dauer = 650) => ({ art: "springen", von, nach, dauer });
  const laufenNach = ziel => {
    const a = { art: "laufen", von: wo, nach: ziel, dauer: Math.max(400, (wo.distanceTo(ziel) / 0.5) * 1000) };
    wo = ziel;
    return a;
  };
  const unternehmungen = {
    klo: () => [laufenNach(o.kloVorne), springen(o.kloVorne, o.kloMitte, 450), { art: "klo", dauer: 5000 }, springen(o.kloMitte, o.kloVorne, 450)],
    fenster: () => [laufenNach(o.unterFenster), springen(o.unterFenster, o.fensterbank, 800), { art: "fenster", dauer: 9000 + Math.random() * 6000 }, springen(o.fensterbank, o.unterFenster, 700)],
    kratzen: () => [laufenNach(o.kratzen), { art: "kratzen", dauer: 3200 }],
    maus: () => [laufenNach(o.maus), { art: "maus", dauer: 4200 }],
    putzen: () => [{ art: "putzen", dauer: 4200 }]
  };
  const namen = Object.keys(unternehmungen).sort(() => Math.random() - 0.5).slice(0, 2 + Math.floor(Math.random() * 2));
  const ablauf = [
    { art: "strecken", dauer: 1500 },
    { art: "gaehnen", dauer: 1300 },
    springen(o.bett, o.ebene2), springen(o.ebene2, o.ebene1), springen(o.ebene1, o.baumBoden)
  ];
  for (const name of namen) ablauf.push(...unternehmungen[name]());
  ablauf.push(
    laufenNach(o.baumBoden),
    springen(o.baumBoden, o.ebene1), springen(o.ebene1, o.ebene2), springen(o.ebene2, o.bett),
    { art: "hinlegen", dauer: 1200 },
    { art: "schlafen", dauer: 30000 + Math.random() * 40000 }
  );
  return ablauf;
}

function katze2Aktualisieren(jetzt, dt) {
  const k2 = welt.katze2;
  if (!k2) return;
  if (!k2.aktion || jetzt - k2.aktion.start >= k2.aktion.dauer) {
    if (!k2.plan.length) k2.plan = katze2Ausflug(k2);
    k2.aktion = { ...k2.plan.shift(), start: jetzt };
  }
  const a = k2.aktion;
  const t = THREE.MathUtils.clamp((jetzt - a.start) / a.dauer, 0, 1);
  const s = jetzt / 1000;
  const H = KATZE2_HALTUNG;
  const g = k2.gruppe;
  const huelle = Math.min(1, t / 0.15, (1 - t) / 0.15); // rein – halten – raus
  let laufTakt = 0;
  let wedeln = 0;
  k2.becken.scale.set(1, 1, 1);
  k2.mund.scale.y = 0.01;
  switch (a.art) {
    case "schlafen":
      katze2Haltung(H.liegen, H.liegen, 0, k2);
      k2.becken.scale.y = 1 + Math.sin(s * 1.4) * 0.04; // atmet
      break;
    case "strecken":
      katze2Haltung(H.liegen, H.stehen, sanft(t), k2);
      k2.becken.scale.x = 1 + Math.sin(t * Math.PI) * 0.18;
      for (const bein of k2.vorne) bein.rotation.z = Math.sin(t * Math.PI) * 0.5; // Vorderbeine weit nach vorn
      break;
    case "gaehnen":
      katze2Haltung(H.stehen, H.sitzen, sanft(Math.min(1, t * 2)), k2);
      k2.mund.scale.y = Math.sin(t * Math.PI); // Maul weit auf
      k2.kopf.rotation.z += Math.sin(t * Math.PI) * 0.35;
      break;
    case "hinlegen":
      katze2Haltung(H.stehen, H.liegen, sanft(t), k2);
      break;
    case "springen": {
      const hoehe = Math.max(0.25, Math.abs(a.nach.y - a.von.y) * 0.5 + 0.2);
      g.position.lerpVectors(a.von, a.nach, sanft(t));
      g.position.y += Math.sin(Math.PI * t) * hoehe;
      katze2Haltung(H.stehen, H.stehen, 0, k2);
      const streck = Math.sin(Math.PI * t);
      for (const bein of k2.vorne) bein.rotation.z = streck * 0.8; // vorne nach vorn, hinten nach hinten gestreckt
      for (const bein of k2.hinten) bein.rotation.z = -streck * 0.8;
      k2.becken.scale.x = 1 + streck * 0.12;
      const d = new THREE.Vector3().subVectors(a.nach, a.von);
      if (Math.hypot(d.x, d.z) > 0.05) k2.zielDrehung = Math.atan2(-d.z, d.x);
      break;
    }
    case "laufen": {
      g.position.lerpVectors(a.von, a.nach, t);
      katze2Haltung(H.stehen, H.stehen, 0, k2);
      g.position.y += Math.abs(Math.sin(s * 9)) * 0.008;
      laufTakt = s * 9;
      wedeln = 0.15;
      const d = new THREE.Vector3().subVectors(a.nach, a.von);
      if (Math.hypot(d.x, d.z) > 0.01) k2.zielDrehung = Math.atan2(-d.z, d.x);
      break;
    }
    case "klo": {
      g.position.copy(k2.ort.kloMitte);
      katze2Haltung(H.sitzen, H.sitzen, 0, k2);
      k2.zielDrehung = (-3 * Math.PI) / 4; // schaut in den Raum
      k2.kopf.rotation.y = Math.sin(s * 0.8) * 0.4;
      if (t > 0.7) {
        // zum Schluss scharren: aufstehen und mit den Vorderpfoten Streu schieben
        katze2Haltung(H.sitzen, H.stehen, Math.min(1, (t - 0.7) / 0.1), k2);
        k2.vorne.forEach((bein, i) => (bein.rotation.z = Math.max(0, Math.sin(s * 14 + i * Math.PI)) * 0.7));
      }
      break;
    }
    case "fenster":
      g.position.copy(k2.ort.fensterbank);
      katze2Haltung(H.sitzen, H.sitzen, 0, k2);
      k2.zielDrehung = k2.ort.rausBlick; // schaut hinaus zum Mond
      k2.kopf.rotation.y = Math.sin(s * 0.5) * 0.3;
      wedeln = 0.3;
      break;
    case "kratzen": {
      // aufrichten, Vorderpfoten an den Pfosten, abwechselnd kratzen
      katze2Haltung(H.stehen, H.kratzen, huelle, k2);
      if (huelle > 0.9) k2.vorne.forEach((bein, i) => (bein.rotation.z += Math.sin(s * 12 + i * Math.PI) * 0.35));
      const d = new THREE.Vector3().subVectors(k2.ort.pfosten, g.position);
      k2.zielDrehung = Math.atan2(-d.z, d.x);
      wedeln = 0.2;
      break;
    }
    case "maus": {
      // vor der Maus sitzen, dann mit der Pfote danach schlagen (die Maus pendelt stärker)
      katze2Haltung(H.stehen, H.sitzen, Math.min(1, t / 0.15), k2);
      const d = new THREE.Vector3().subVectors(k2.ort.mausZiel, g.position);
      k2.zielDrehung = Math.atan2(-d.z, d.x);
      k2.kopf.rotation.z += 0.35; // schaut hoch zur Maus
      const takt = (s * 2.2) % 1;
      if (t > 0.2 && t < 0.9) {
        k2.vorne[0].rotation.z = -0.6 + Math.max(0, Math.sin(takt * Math.PI * 2)) * 1.6;
        if (takt > 0.2 && takt < 0.3 && welt.spielmaus) welt.spielmaus.schwung = 0.6;
      }
      wedeln = 0.5;
      break;
    }
    case "putzen":
      // sitzt, leckt die rechte Pfote ab und wischt sich damit übers Gesicht
      katze2Haltung(H.stehen, H.sitzen, Math.min(1, t / 0.15), k2);
      if (t > 0.15) {
        k2.vorne[0].rotation.z = -0.6 + 1.5 * huelle;
        k2.kopf.rotation.z += (-0.35 + Math.sin(s * 9) * 0.15) * huelle;
        k2.kopf.rotation.y = -0.3 * huelle;
      }
      break;
  }
  // Schwanz: Grundhaltung aus der Haltung, dazu Wedeln
  k2.schwanz.rotation.x = wedeln ? Math.sin(s * 2.4) * wedeln : 0;
  if (!["klo", "fenster", "putzen"].includes(a.art)) k2.kopf.rotation.y *= 0.9;
  // Beine beim Laufen diagonal im Wechsel
  if (laufTakt) {
    k2.vorne.forEach((bein, i) => (bein.rotation.z = Math.sin(laufTakt + (i ? Math.PI : 0)) * 0.45));
    k2.hinten.forEach((bein, i) => (bein.rotation.z = Math.sin(laufTakt + (i ? 0 : Math.PI)) * 0.45));
  }
  const schlaeft = a.art === "schlafen" || (a.art === "hinlegen" && t > 0.6);
  k2.augenOffen.visible = !schlaeft;
  k2.augenZu.visible = schlaeft;
  // Drehung weich zum Ziel (kürzester Weg)
  let diff = k2.zielDrehung - g.rotation.y;
  diff = Math.atan2(Math.sin(diff), Math.cos(diff));
  g.rotation.y += diff * Math.min(1, dt * 8);
}

// Uhrzeiger, Lichterkette, Leuchtschild, schlafende Katze und Kerze am Fenster bewegen (aus der Schleife)
function dekoAktualisieren(jetzt) {
  if (welt.uhr) {
    const d = new Date();
    const sek = d.getSeconds() + d.getMilliseconds() / 1000;
    const min = d.getMinutes() + sek / 60;
    const std = (d.getHours() % 12) + min / 60;
    welt.uhr.sekunde.rotation.z = -(Math.floor(sek) / 60) * Math.PI * 2; // springt jede Sekunde weiter
    welt.uhr.minute.rotation.z = -(min / 60) * Math.PI * 2;
    welt.uhr.stunde.rotation.z = -(std / 12) * Math.PI * 2;
  }
  const s = jetzt / 1000;
  if (welt.lichterkette) {
    const grund = [0xffd27a, 0xffb347, 0xfff2c0];
    welt.lichterkette.forEach((m, i) => m.color.setHex(grund[i]).multiplyScalar(0.75 + 0.25 * Math.sin(s * 1.3 + i * 2.1)));
  }
  const n = welt.neon;
  if (n) {
    // ab und zu kurz flackern, wie eine alte Leuchtröhre
    if (jetzt > n.naechstesFlackern) {
      n.flackernBis = jetzt + 180;
      n.naechstesFlackern = jetzt + 5000 + Math.random() * 9000;
    }
    const an = jetzt > (n.flackernBis || 0) || Math.sin(jetzt / 18) > 0;
    n.schild.material.opacity = an ? 1 : 0.35;
    n.licht.intensity = an ? 0.35 : 0.1;
  }
  if (welt.spielmaus) {
    // pendelt; nach einem Stupser stärker, dann klingt es ab
    const m = welt.spielmaus;
    m.schwung += (0.05 - m.schwung) * 0.01;
    m.aufhaengung.rotation.x = Math.sin(s * 3.2) * m.schwung;
    m.aufhaengung.rotation.z = Math.sin(s * 2.1) * m.schwung * 0.5;
  }
  if (welt.fensterKerze) welt.fensterKerze.scale.y = 0.85 + 0.2 * Math.sin(s * 11);
}

// Fenster in Wand 2 mit echtem Blick nach draußen: Nachthimmel, Dächer und der Mond, an dem eine Katze leckt –
// jedes Lecken gibt dem Mond Schwung (mondAktualisieren). Lokal im Fenster: x entlang der Wand, z zum Raum,
// draußen ist −z.
function fensterBauen(kasten, weissLack, holzDunkel) {
  const f = FENSTER;
  const fenster = anWand(new THREE.Group(), f.wand, f.entlang, f.y, 0);
  const b = f.breite;
  const h = f.hoehe;
  // Laibung (Wanddicke) und Rahmen
  kasten(b, 0.04, 0.3, weissLack, 0, h / 2, -0.15, fenster);
  kasten(b, 0.04, 0.3, weissLack, 0, -h / 2, -0.15, fenster);
  kasten(0.04, h, 0.3, weissLack, -b / 2, 0, -0.15, fenster);
  kasten(0.04, h, 0.3, weissLack, b / 2, 0, -0.15, fenster);
  for (const [rb, rh, x, y] of [[b + 0.2, 0.1, 0, h / 2 + 0.05], [b + 0.2, 0.1, 0, -h / 2 - 0.05], [0.1, h + 0.2, -b / 2 - 0.05, 0], [0.1, h + 0.2, b / 2 + 0.05, 0]]) {
    kasten(rb, rh, 0.06, weissLack, x, y, 0.03, fenster);
  }
  // Oberlicht-Sprosse und Glas in der Mitte der Laibung (keine senkrechte Sprosse – freie Sicht auf den Mond)
  kasten(b, 0.035, 0.04, weissLack, 0, h * 0.22, -0.15, fenster);
  const glas = new THREE.Mesh(
    new THREE.PlaneGeometry(b, h),
    new THREE.MeshStandardMaterial({ color: 0xa8c8ff, transparent: true, opacity: 0.1, roughness: 0.05, depthWrite: false })
  );
  glas.position.z = -0.16;
  fenster.add(glas);
  kasten(b + 0.4, 0.06, 0.32, weissLack, 0, -h / 2 - 0.05, 0.14, fenster); // Fensterbank
  // Vorhänge seitlich, Stange darüber
  const stoff = new THREE.MeshStandardMaterial({ color: 0x8c2f3a, roughness: 0.95, side: THREE.DoubleSide });
  for (const seite of [-1, 1]) {
    const geo = new THREE.PlaneGeometry(0.6, h + 0.9, 24, 1);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) pos.setZ(i, Math.sin(pos.getX(i) * 26) * 0.05); // Falten
    geo.computeVertexNormals();
    const vorhang = new THREE.Mesh(geo, stoff);
    vorhang.position.set(seite * (b / 2 + 0.32), -0.15, 0.2);
    vorhang.castShadow = true;
    fenster.add(vorhang);
  }
  const stange = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, b + 1.4, 8), holzDunkel);
  stange.rotation.z = Math.PI / 2;
  stange.position.set(0, h / 2 + 0.32, 0.2);
  fenster.add(stange);
  // kühles Mondlicht fällt ein wenig in den Raum
  const mondlicht = new THREE.PointLight(0x8fa8ff, 0.35, 6, 1.5);
  mondlicht.position.set(0, 0, 0.7);
  fenster.add(mondlicht);

  // ---- draußen ----
  const himmel = gemaeldeTextur((ctx, tb, th) => {
    const verlauf = ctx.createLinearGradient(0, 0, 0, th);
    verlauf.addColorStop(0, "#070d24");
    verlauf.addColorStop(0.7, "#1d2c5c");
    verlauf.addColorStop(1, "#3a3f6e");
    ctx.fillStyle = verlauf;
    ctx.fillRect(0, 0, tb, th);
    ctx.fillStyle = "#ffffff";
    for (let i = 0; i < 260; i++) {
      ctx.globalAlpha = 0.3 + ((i * 13) % 7) / 10;
      const groesse = i % 9 === 0 ? 3 : 2;
      ctx.fillRect((i * 97) % tb, (i * 61) % (th * 0.85), groesse, groesse);
    }
  }, 1024, 640);
  const himmelFlaeche = new THREE.Mesh(new THREE.PlaneGeometry(30, 19), new THREE.MeshBasicMaterial({ map: himmel }));
  himmelFlaeche.position.set(-6, 0, -7);
  fenster.add(himmelFlaeche);
  const daecher = gemaeldeTextur((ctx, tb, th) => {
    ctx.fillStyle = "#060914";
    ctx.beginPath();
    ctx.moveTo(0, th);
    let x = 0;
    let n = 0;
    while (x <= tb) {
      const hoehe = th * (0.35 + ((n * 37) % 40) / 100);
      ctx.lineTo(x, hoehe);
      ctx.lineTo(x + 30, hoehe - 26); // Dachspitze
      ctx.lineTo(x + 60, hoehe);
      x += 60 + ((n * 23) % 30);
      n++;
    }
    ctx.lineTo(tb, th);
    ctx.fill();
    // ein paar erleuchtete Fenster
    ctx.fillStyle = "#ffcf7a";
    for (let i = 0; i < 26; i++) ctx.fillRect((i * 151) % tb, th * 0.7 + ((i * 29) % 30), 6, 8);
  }, 1024, 256);
  const dachFlaeche = new THREE.Mesh(new THREE.PlaneGeometry(16, 3), new THREE.MeshBasicMaterial({ map: daecher, transparent: true }));
  dachFlaeche.position.set(-3.5, -1.9, -4.5);
  fenster.add(dachFlaeche);
  // dunkles Flachdach direkt vor dem Fenster – verdeckt den (Zimmer-)Boden, der sonst nach draußen weiterläuft
  const flachdach = new THREE.Mesh(new THREE.PlaneGeometry(24, 12), new THREE.MeshBasicMaterial({ color: 0x0c0f1a }));
  flachdach.rotation.x = -Math.PI / 2;
  flachdach.position.set(0, -1.6 - f.y + 0.08, -6.3); // knapp über dem Zimmerboden (lokal), unter den Dächern
  fenster.add(flachdach);

  // Mond und Katze auf der Sichtlinie vom eigenen Platz durchs Fenster
  welt.raum.updateWorldMatrix(true, true);
  const mitte = fenster.localToWorld(new THREE.Vector3());
  const blick = mitte.clone().sub(new THREE.Vector3(0, 2.7, 3.3)).normalize();
  const blickLokal = fenster.worldToLocal(mitte.clone().add(blick)).sub(fenster.worldToLocal(mitte.clone()));
  const mondPos = blickLokal.clone().multiplyScalar(1.1 / -blickLokal.z).add(new THREE.Vector3(0.3, -0.12, 0));

  const mondTextur = gemaeldeTextur((ctx, tb, th) => {
    ctx.fillStyle = "#f4ecd0";
    ctx.fillRect(0, 0, tb, th);
    for (let i = 0; i < 40; i++) {
      const x = (i * 71) % tb;
      const y = (i * 43) % th;
      const r = 4 + ((i * 17) % 14);
      ctx.fillStyle = `rgba(150, 140, 110, ${0.25 + ((i * 7) % 5) / 12})`;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }, 256, 128);
  const mond = new THREE.Mesh(new THREE.SphereGeometry(0.3, 32, 20), new THREE.MeshBasicMaterial({ map: mondTextur }));
  mond.position.copy(mondPos);
  fenster.add(mond);
  const schein = new THREE.Sprite(new THREE.SpriteMaterial({
    map: gemaeldeTextur((ctx, tb, th) => {
      const v = ctx.createRadialGradient(tb / 2, th / 2, 0, tb / 2, th / 2, tb / 2);
      v.addColorStop(0, "rgba(255, 244, 200, 0.55)");
      v.addColorStop(1, "rgba(255, 244, 200, 0)");
      ctx.fillStyle = v;
      ctx.fillRect(0, 0, tb, th);
    }, 128, 128),
    transparent: true,
    depthWrite: false
  }));
  schein.scale.setScalar(2.3); // großer Hof – die Katze hebt sich als Silhouette davon ab
  schein.position.copy(mondPos).add(new THREE.Vector3(0, 0, -0.05));
  fenster.add(schein);

  // Katze sitzt auf einer Wolke links neben dem Mond und leckt ihn an
  const silhouette = new THREE.MeshBasicMaterial({ color: 0x050508 });
  const wolkeMat = new THREE.MeshBasicMaterial({ color: 0x8a94c0 });
  // quer zur Blickrichtung neben den Mond setzen, damit man sie von der Seite sieht (egal an welcher Wand das
  // Fenster hängt); ihr Kopf (+x) zeigt zum Mond
  const seite = new THREE.Vector3().crossVectors(blickLokal, new THREE.Vector3(0, 1, 0)).normalize(); // nach rechts
  const katze = new THREE.Group();
  katze.position.copy(mondPos).addScaledVector(seite, -0.6).add(new THREE.Vector3(0, -0.27, 0));
  katze.rotation.y = Math.atan2(-seite.z, seite.x);
  katze.scale.setScalar(1.75);
  fenster.add(katze);
  for (const [x, y, r] of [[-0.12, -0.11, 0.1], [0.02, -0.12, 0.12], [0.16, -0.11, 0.09], [-0.24, -0.13, 0.07], [0.06, -0.06, 0.08]]) {
    const ball = new THREE.Mesh(new THREE.SphereGeometry(r, 12, 8), wolkeMat);
    ball.position.set(x, y, 0);
    ball.scale.z = 0.6;
    katze.add(ball);
  }
  const koerper = new THREE.Mesh(new THREE.SphereGeometry(1, 14, 10), silhouette);
  koerper.scale.set(0.075, 0.1, 0.06);
  koerper.position.set(0, 0.05, 0.02);
  const kopfGruppe = new THREE.Group();
  kopfGruppe.position.set(0.05, 0.16, 0.02);
  const kopf = new THREE.Mesh(new THREE.SphereGeometry(0.055, 14, 10), silhouette);
  kopfGruppe.add(kopf);
  for (const s of [-1, 1]) {
    const ohr = new THREE.Mesh(new THREE.ConeGeometry(0.022, 0.05, 4), silhouette);
    ohr.position.set(s * 0.02 + 0.005, 0.055, s * 0.02);
    kopfGruppe.add(ohr);
    const auge = new THREE.Mesh(new THREE.SphereGeometry(0.009, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffe066 }));
    auge.position.set(0.03, 0.01, 0.045 * s * 0.6 + 0.02);
    kopfGruppe.add(auge);
  }
  const zunge = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.012, 0.02), new THREE.MeshBasicMaterial({ color: 0xff6f91 }));
  zunge.geometry.translate(0.03, 0, 0); // wächst von der Schnauze aus
  zunge.position.set(0.045, -0.02, 0.01);
  zunge.scale.x = 0.001;
  kopfGruppe.add(zunge);
  const schwanz = new THREE.Mesh(
    new THREE.TubeGeometry(new THREE.CatmullRomCurve3([
      new THREE.Vector3(-0.06, -0.02, 0), new THREE.Vector3(-0.14, 0.02, 0), new THREE.Vector3(-0.15, 0.12, 0), new THREE.Vector3(-0.1, 0.18, 0)
    ]), 16, 0.012, 6),
    silhouette
  );
  katze.add(koerper, kopfGruppe, schwanz);

  welt.mond = { kugel: mond, kopf: kopfGruppe, zunge, schwanz, tempo: 0.25, naechstesLecken: 0, leckStart: -1, angestossen: false };
}

// Die Mondkatze leckt alle paar Sekunden am Mond; jeder Zungenschlag dreht ihn schneller, danach bremst er langsam
function mondAktualisieren(jetzt, dt) {
  const m = welt.mond;
  if (!m) return;
  if (jetzt > m.naechstesLecken) {
    m.leckStart = jetzt;
    m.angestossen = false;
    m.naechstesLecken = jetzt + 2200 + Math.random() * 1600;
  }
  const t = (jetzt - m.leckStart) / 800; // 0..1 während eines Leckens
  if (t >= 0 && t <= 1) {
    const vor = Math.sin(t * Math.PI);
    m.kopf.position.x = 0.05 + vor * 0.05;
    m.kopf.rotation.z = -vor * 0.25;
    m.zunge.scale.x = Math.max(0.001, Math.sin(Math.min(1, t * 1.6) * Math.PI) * 1.2);
    if (!m.angestossen && t > 0.45) {
      m.angestossen = true;
      m.tempo += 1.4; // Schwung vom Zungenschlag
    }
  } else {
    m.zunge.scale.x = 0.001;
  }
  m.schwanz.rotation.z = Math.sin(jetzt / 500) * 0.15;
  m.tempo += (0.15 - m.tempo) * Math.min(1, dt * 0.5); // Reibung
  m.kugel.rotation.y += m.tempo * dt;
}

// Kamin an Wand 1: Backstein, offener Feuerraum (erhöht, damit man das Feuer über den Tisch sieht), Holzscheite,
// flackernde Flammen mit Licht, Kaminsims mit Kerzen. Darüber hängt das Katzenfoto (WANDBILDER).
const KAMIN = { entlang: 4.8, breite: 2.1, tiefe: 0.55 };

function kaminBauen(kasten, holzDunkel) {
  const g = anWand(new THREE.Group(), 1, KAMIN.entlang, -1.6, 0);
  const stein = gemaeldeTextur((ctx, b, h) => {
    ctx.fillStyle = "#5a4a40";
    ctx.fillRect(0, 0, b, h);
    const reihen = 8;
    const rh = h / reihen;
    for (let r = 0; r < reihen; r++) {
      const versatz = r % 2 ? b / 8 : 0;
      for (let x = -b / 4 + versatz; x < b; x += b / 4) {
        const ton = 120 + ((r * 31 + x * 7) % 40);
        ctx.fillStyle = `rgb(${ton + 40}, ${ton - 40}, ${ton - 70})`;
        ctx.fillRect(x + 3, r * rh + 3, b / 4 - 6, rh - 6);
      }
    }
  }, 256, 256);
  stein.wrapS = stein.wrapT = THREE.RepeatWrapping;
  stein.repeat.set(1.5, 2);
  const steinMat = new THREE.MeshStandardMaterial({ map: stein, roughness: 0.95 });
  const russ = new THREE.MeshStandardMaterial({ color: 0x120c0a, roughness: 1 });
  const W = KAMIN.breite;
  const D = KAMIN.tiefe;
  const HB = 0.55; // Sockel bis zum Feuerraum
  const HF = 0.95; // Höhe der Öffnung
  const PW = 0.42; // Breite der Pfeiler
  kasten(W, HB, D, steinMat, 0, HB / 2, D / 2, g);
  for (const s of [-1, 1]) kasten(PW, HF, D, steinMat, s * (W / 2 - PW / 2), HB + HF / 2, D / 2, g);
  kasten(W, 5, D, steinMat, 0, HB + HF + 2.5, D / 2, g);
  kasten(W - 2 * PW, HF, 0.04, russ, 0, HB + HF / 2, 0.04, g); // Rückwand innen
  kasten(W - 2 * PW, 0.03, D - 0.05, russ, 0, HB + 0.015, D / 2, g);
  kasten(W + 0.35, 0.09, D + 0.24, holzDunkel, 0, HB + HF + 0.05, D / 2 + 0.07, g); // Kaminsims

  // Holzscheite
  const holz = new THREE.MeshStandardMaterial({ color: 0x4a2c16, roughness: 0.9, emissive: 0x2a0800 });
  for (const [x, rot] of [[-0.15, 0.3], [0.15, -0.3], [0, 0]]) {
    const scheit = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.06, 0.75, 8), holz);
    scheit.rotation.set(0, rot, Math.PI / 2);
    scheit.position.set(x * 0.3, HB + 0.08 + (x === 0 ? 0.08 : 0), D * 0.45);
    g.add(scheit);
  }
  // Glut am Boden
  const glut = new THREE.Mesh(new THREE.PlaneGeometry(W - 2 * PW - 0.1, D - 0.1), new THREE.MeshBasicMaterial({ color: 0xff4a10 }));
  glut.rotation.x = -Math.PI / 2;
  glut.position.set(0, HB + 0.035, D / 2);
  g.add(glut);
  // Flammen: Kegel mit additiver Mischung, flackern in kaminAktualisieren
  const flammen = [];
  const farben = [0xff6a10, 0xff9a20, 0xffc840, 0xff7a18, 0xffe080, 0xff8a1a];
  farben.forEach((farbe, i) => {
    const hoehe = 0.3 + (i % 3) * 0.12;
    const kegel = new THREE.Mesh(
      new THREE.ConeGeometry(0.1 - (i % 3) * 0.018, hoehe, 10),
      new THREE.MeshBasicMaterial({ color: farbe, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false })
    );
    kegel.geometry.translate(0, hoehe / 2, 0); // wächst vom Boden aus
    kegel.position.set(-0.3 + (i / (farben.length - 1)) * 0.6, HB + 0.1, D * 0.45 + ((i * 7) % 3) * 0.03);
    g.add(kegel);
    flammen.push({ kegel, phase: i * 1.7, tempo: 9 + (i % 4) * 2.5 });
  });
  const licht = new THREE.PointLight(0xff8a3a, 1.2, 9, 1.4);
  licht.position.set(0, HB + 0.45, D + 0.45);
  g.add(licht);

  // Kerzen auf dem Sims
  const kerzenFlammen = [];
  for (const x of [-0.85, 0.85]) {
    const kerze = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.24, 12), new THREE.MeshStandardMaterial({ color: 0xf2ead8, roughness: 0.7 }));
    kerze.position.set(x, HB + HF + 0.22, D / 2 + 0.1);
    kerze.castShadow = true;
    g.add(kerze);
    const flamme = new THREE.Mesh(
      new THREE.ConeGeometry(0.018, 0.06, 8),
      new THREE.MeshBasicMaterial({ color: 0xffd27a, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })
    );
    flamme.position.set(x, HB + HF + 0.38, D / 2 + 0.1);
    g.add(flamme);
    kerzenFlammen.push(flamme);
  }
  welt.kamin = { flammen, licht, kerzenFlammen };
}

function kaminAktualisieren(jetzt) {
  const k = welt.kamin;
  if (!k) return;
  const s = jetzt / 1000;
  for (const f of k.flammen) {
    const flackern = 0.75 + 0.25 * Math.sin(s * f.tempo + f.phase) + 0.12 * Math.sin(s * f.tempo * 2.3 + f.phase * 2);
    f.kegel.scale.set(0.9 + 0.15 * Math.sin(s * 5 + f.phase), flackern, 0.9);
    f.kegel.rotation.z = Math.sin(s * 3 + f.phase) * 0.12;
  }
  k.licht.intensity = 1.05 + Math.sin(s * 11) * 0.12 + Math.sin(s * 23.7) * 0.08;
  for (const [i, f] of k.kerzenFlammen.entries()) f.scale.y = 0.85 + 0.2 * Math.sin(s * 13 + i * 2);
}

// Getränkeschrank an Wand 2: oben offene Fächer – links die Bar (mit Alkohol), rechts Softdrinks –, unten Türen,
// oben drauf Snacks. Anklicken öffnet die Auswahl (getraenke.js); welt.barSchrank ist das Klickziel.
function barSchrankBauen(kasten, holzDunkel) {
  const g = anWand(new THREE.Group(), 2, 4.55, -1.6, 0);
  const holz = new THREE.MeshStandardMaterial({ color: 0x6b4423, roughness: 0.65 });
  const W = 1.9;
  const H = 3.2;
  const D = 0.5;
  kasten(0.06, H, D, holz, -W / 2, H / 2, D / 2, g);
  kasten(0.06, H, D, holz, W / 2, H / 2, D / 2, g);
  kasten(W, H, 0.03, holzDunkel, 0, H / 2, 0.02, g);
  kasten(W + 0.08, 0.06, D + 0.04, holz, 0, H, D / 2, g);
  kasten(0.04, H - 1.45, D - 0.04, holz, 0, 1.45 + (H - 1.45) / 2, D / 2, g); // Trennwand Bar | Softdrinks
  // Unterschrank mit zwei Türen und Griffen
  kasten(W, 1.4, D, holz, 0, 0.7, D / 2, g);
  for (const s of [-1, 1]) {
    kasten(W / 2 - 0.08, 1.25, 0.02, holzDunkel, s * W / 4, 0.72, D + 0.01, g);
    kasten(0.03, 0.18, 0.04, new THREE.MeshStandardMaterial({ color: 0xc9a24a, metalness: 0.8, roughness: 0.3 }), s * 0.08, 0.8, D + 0.03, g);
  }
  for (const y of [1.45, 2.32]) kasten(W, 0.04, D - 0.02, holz, 0, y, D / 2, g);

  // Flaschen: Körper, Hals, Verschluss, Etikett
  const flasche = (x, y, farbe, hoehe = 0.42, breite = 0.06, etikett = 0xf2ead8, eckig = false) => {
    const glasMat = new THREE.MeshStandardMaterial({ color: farbe, roughness: 0.15, metalness: 0.1 });
    const koerper = eckig
      ? new THREE.Mesh(new THREE.BoxGeometry(breite * 1.8, hoehe * 0.65, breite * 1.4), glasMat)
      : new THREE.Mesh(new THREE.CylinderGeometry(breite, breite, hoehe * 0.65, 14), glasMat);
    koerper.position.set(x, y + hoehe * 0.325, D * 0.5);
    const hals = new THREE.Mesh(new THREE.CylinderGeometry(breite * 0.35, breite * 0.6, hoehe * 0.35, 10), glasMat);
    hals.position.set(x, y + hoehe * 0.65 + hoehe * 0.175, D * 0.5);
    const deckel = new THREE.Mesh(new THREE.CylinderGeometry(breite * 0.38, breite * 0.38, 0.03, 10), new THREE.MeshStandardMaterial({ color: 0x222222 }));
    deckel.position.set(x, y + hoehe + 0.015, D * 0.5);
    const schild = new THREE.Mesh(new THREE.CylinderGeometry(breite * 1.02, breite * 1.02, hoehe * 0.22, 14, 1, true), new THREE.MeshStandardMaterial({ color: etikett, roughness: 0.8 }));
    schild.position.set(x, y + hoehe * 0.3, D * 0.5);
    if (eckig) schild.visible = false;
    g.add(koerper, hals, deckel, schild);
  };
  // Bar (links): Wein, Whisky, Gin, Sekt, Rum, Likör
  [[0x1f3a1c, 0.46], [0x5a1020, 0.46], [0x9a5a1a, 0.36, 0.065, 0x222222, true], [0x9fd0e0, 0.42, 0.06, 0x2a4a8a], [0x23401a, 0.48, 0.06, 0xd9b44a]].forEach(([farbe, hoehe, breite, etikett, eckig], i) => {
    flasche(-0.8 + i * 0.17, 1.47, farbe, hoehe, breite, etikett, eckig);
  });
  [[0x3a1a0a, 0.4, 0.07, 0xd9a441], [0x153015, 0.38, 0.06, 0xb5562a], [0x6a3a10, 0.44, 0.055], [0x8a1a2a, 0.36, 0.06, 0xf2c14e]].forEach(([farbe, hoehe, breite, etikett], i) => {
    flasche(-0.78 + i * 0.2, 2.34, farbe, hoehe, breite, etikett);
  });
  // Softdrinks (rechts): Cola, Limo, Wasser, Saftkartons
  [[0x2a0e08, 0.4, 0.055, 0xd8202a], [0xf2a020, 0.38, 0.055, 0x2a8a3a], [0x9fd8ff, 0.42, 0.055, 0x3a7be6], [0x2a0e08, 0.4, 0.055, 0xd8202a]].forEach(([farbe, hoehe, breite, etikett], i) => {
    flasche(0.12 + i * 0.19, 1.47, farbe, hoehe, breite, etikett);
  });
  for (const [i, farbe] of [0xf28a20, 0x3a9e3a, 0xe8c040].entries()) {
    kasten(0.14, 0.28, 0.1, new THREE.MeshStandardMaterial({ color: farbe, roughness: 0.6 }), 0.18 + i * 0.22, 2.34 + 0.14, D * 0.5, g);
  }
  kasten(0.12, 0.2, 0.12, new THREE.MeshStandardMaterial({ color: 0x8a5a2a, roughness: 0.6 }), 0.82, 2.34 + 0.1, D * 0.5, g); // Eistee

  // Snacks oben drauf: Chipstüte, Popcorn-Eimer, Brezelschale, Gummibärchen-Glas
  const tuete = kasten(0.3, 0.42, 0.1, new THREE.MeshStandardMaterial({ color: 0xe8b020, roughness: 0.5 }), -0.6, H + 0.24, D * 0.5, g);
  tuete.rotation.z = 0.1;
  kasten(0.3, 0.12, 0.101, new THREE.MeshStandardMaterial({ color: 0xc8202a }), -0.6, H + 0.3, D * 0.5, g).rotation.z = 0.1;
  const eimer = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.11, 0.32, 16), new THREE.MeshStandardMaterial({ map: streifenTextur("#d8202a", "#f6f0e6"), roughness: 0.6 }));
  eimer.position.set(-0.15, H + 0.19, D * 0.5);
  g.add(eimer);
  for (let i = 0; i < 9; i++) {
    const korn = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 6), new THREE.MeshStandardMaterial({ color: 0xfff2c8, roughness: 0.9 }));
    korn.position.set(-0.15 + Math.cos(i * 2.4) * 0.08 * (i % 3) / 2, H + 0.37 + (i % 2) * 0.03, D * 0.5 + Math.sin(i * 2.4) * 0.07 * (i % 3) / 2);
    g.add(korn);
  }
  const schale = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.11, 0.09, 18), new THREE.MeshStandardMaterial({ color: 0x2f5a8c, roughness: 0.4 }));
  schale.position.set(0.3, H + 0.075, D * 0.5);
  g.add(schale);
  for (let i = 0; i < 6; i++) {
    const brezel = new THREE.Mesh(new THREE.TorusGeometry(0.035, 0.012, 6, 12), new THREE.MeshStandardMaterial({ color: 0x8a4a1a, roughness: 0.7 }));
    brezel.position.set(0.3 + Math.cos(i) * 0.08, H + 0.13, D * 0.5 + Math.sin(i) * 0.06);
    brezel.rotation.set(1.2, i, 0);
    g.add(brezel);
  }
  const glasDose = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.26, 16), new THREE.MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: 0.3, roughness: 0.05 }));
  glasDose.position.set(0.7, H + 0.16, D * 0.5);
  g.add(glasDose);
  for (let i = 0; i < 10; i++) {
    const baer = new THREE.Mesh(new THREE.SphereGeometry(0.028, 6, 5), new THREE.MeshStandardMaterial({ color: [0xe6453a, 0xf2c14e, 0x2f9e5b, 0xff8a1a, 0xffffff][i % 5], roughness: 0.4 }));
    baer.position.set(0.7 + Math.cos(i * 1.9) * 0.05, H + 0.06 + (i % 4) * 0.045, D * 0.5 + Math.sin(i * 1.9) * 0.05);
    g.add(baer);
  }
  // Schilder
  const schild = (text, x, y, breite) => {
    const tex = gemaeldeTextur((ctx, b, h) => {
      ctx.fillStyle = "#2a1a0e";
      ctx.fillRect(0, 0, b, h);
      ctx.strokeStyle = "#c9a24a";
      ctx.lineWidth = 4;
      ctx.strokeRect(3, 3, b - 6, h - 6);
      ctx.fillStyle = "#f2d48a";
      ctx.font = `bold ${Math.round(h * 0.55)}px Georgia, serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(text, b / 2, h / 2 + 2);
    }, 256, 56);
    const tafel = new THREE.Mesh(new THREE.PlaneGeometry(breite, breite * 56 / 256), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6, emissive: 0x1a1006 }));
    tafel.position.set(x, y, D + 0.02);
    g.add(tafel);
  };
  schild("BAR", -W / 4, H - 0.12, 0.6);
  schild("SOFTDRINKS", W / 4, H - 0.12, 0.7);
  // warmes Licht im Schrank lässt die Flaschen schimmern
  const schrankLicht = new THREE.PointLight(0xffd59a, 0.3, 2.4, 1.5);
  schrankLicht.position.set(0, 2.6, D + 0.3);
  g.add(schrankLicht);
  welt.barSchrank = g;
}

// Längsstreifen (z. B. Popcorn-Eimer)
function streifenTextur(farbe1, farbe2) {
  const tex = gemaeldeTextur((ctx, b, h) => {
    for (let i = 0; i < 8; i++) {
      ctx.fillStyle = i % 2 ? farbe1 : farbe2;
      ctx.fillRect((i * b) / 8, 0, b / 8, h);
    }
  }, 128, 32);
  return tex;
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
  // Katzenfoto über dem Kamin (vorn an der Kaminwand), ein Affe neben der Ecke, der andere links vom Kamin
  { datei: "images/wand/katze.jpg", breite: 0.72, hoehe: 1.28, wand: 1, entlang: KAMIN.entlang, y: 1.0, abstand: KAMIN.tiefe + 0.04, ersatz: sonnenuntergangMalen },
  { datei: "images/wand/affe-nachdenklich.jpg", breite: 1.3, hoehe: 1.2, wand: 2, entlang: 7.75, y: 1.2, ersatz: abstraktMalen },
  { datei: "images/wand/affe-mittelfinger.webp", breite: 1.15, hoehe: 1.43, wand: 1, entlang: 6.85, y: 1.1, ersatz: abstraktMalen }
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
    anWand(gruppe, b.wand, b.entlang, b.y, b.abstand || 0.04);

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
  anWand(gruppe, 1, 10.9, -1.6, 0.65); // ganz links neben dem Bücherregal – verdeckt so kein Bild
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

  // Vorderbeine liegen ausgestreckt, weiße Pfoten; Gelenk an der Schulter (Pfote heben beim Putzen/Laufen)
  const vorne = [];
  for (const z of [-0.075, 0.075]) {
    const schulter = new THREE.Group();
    schulter.position.set(0.27, 0.045, z);
    katze.add(schulter);
    const bein = new THREE.Mesh(new THREE.CapsuleGeometry(0.042, 0.2, 4, 8), z < 0 ? schwarz : orange);
    bein.rotation.z = Math.PI / 2;
    bein.position.set(0.11, 0, 0);
    bein.castShadow = true;
    schulter.add(bein);
    teil(weiss, 0.06, 0.035, 0.05, 0.25, -0.01, 0, schulter);
    vorne.push(schulter);
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

  // rechts auf dem Tisch, weit genug vom Rand (der Schwanz steckt sonst im Holz) und von der Ablage (die Pfoten
  // lägen sonst auf den Karten); sie schaut zu uns
  katze.position.set(2.35, 0, -1.95);
  katze.rotation.y = katzeBlickZuUns(katze.position);
  welt.szene.add(katze);
  welt.katze = {
    gruppe: katze, rumpf, kopf, augen, ohren, schwanz, vorne,
    aktion: null, naechsteAktion: performance.now() + 10000 + Math.random() * 8000,
    kopfBasis: kopf.position.clone(),
    offen: 0.3, offenZiel: 0.3, naechsterBlick: 0, blickZiel: 0,
    naechstesZucken: 0, naechstesZ: 0, zs: [],
    gluecklichBis: 0, // gestreichelt/gefüttert: Augen zufrieden zu, Kopf hebt sich, Schwanz wedelt
    fressAnteil: 0, // 0 = Kopf oben, 1 = Kopf unten am Leckerli
    frisst: false
  };
}

// Drehung, mit der die Tischkatze (Kopf = lokal +x) zu unserem Platz schaut
function katzeBlickZuUns(position) {
  const d = new THREE.Vector3(0, 0, 3.6).sub(position);
  return Math.atan2(-d.z, d.x);
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
  packung.position.set(3.45, 0, -1.55);
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
// laufende eigene Bewegung der Tischkatze (putzen, strecken) abbrechen
function katzeAktionBeenden(k) {
  if (!k.aktion) return;
  k.aktion = null;
  k.naechsteAktion = performance.now() + 12000;
}

function katzeStreicheln() {
  const k = welt.katze;
  if (!k || k.frisst) return;
  katzeAktionBeenden(k);
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
  katzeAktionBeenden(k);
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

// ---------- Getränke und Snacks auf dem Tisch (Auswahl in getraenke.js) ----------

// Plätze auf dem Tisch: eigene Sachen links und rechts vorn (nah genug, dass man sie auch hochkant sieht),
// die des Gegenübers vor ihm (Getränk an seiner rechten Hand)
const TISCH_PLAETZE = {
  eigen: { getraenk: new THREE.Vector3(-1.5, 0, 0.55), snack: new THREE.Vector3(1.55, 0, 0.55) },
  // beide auf seiner freien (linken) Seite – rechts hält er den Fächer
  gegner: { getraenk: new THREE.Vector3(-0.95, 0, -2.5), snack: new THREE.Vector3(-1.45, 0, -2.3) }
};

// Getränk als Gruppe; userData.setzeFuellstand(0..1) senkt den Pegel (Schaum/Eis wandern mit)
function getraenkModell(id) {
  const g = new THREE.Group();
  const glasMat = new THREE.MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: 0.26, roughness: 0.05, metalness: 0.1, depthWrite: false, side: THREE.DoubleSide });
  const fluessigMat = (farbe, deckkraft = 0.9) => new THREE.MeshStandardMaterial({ color: farbe, transparent: deckkraft < 1, opacity: deckkraft, roughness: 0.2, emissive: farbe, emissiveIntensity: 0.12 });
  const glas = profil => {
    const m = new THREE.Mesh(new THREE.LatheGeometry(profil.map(([r, y]) => new THREE.Vector2(r, y)), 24), glasMat);
    m.renderOrder = 2;
    g.add(m);
    return m;
  };
  const scheibe = (r, h, y, mat = glasMat) => {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 20), mat);
    m.position.y = y;
    g.add(m);
    return m;
  };
  let pegel = null; // { mesh, y0, hoehe, oben: [Objekte, die oben auf der Flüssigkeit schwimmen] }
  const fluessigkeit = (rUnten, rOben, y0, hoehe, farbe, deckkraft) => {
    const geo = new THREE.CylinderGeometry(rOben, rUnten, hoehe, 20);
    geo.translate(0, hoehe / 2, 0);
    const m = new THREE.Mesh(geo, fluessigMat(farbe, deckkraft));
    m.position.y = y0;
    g.add(m);
    pegel = { mesh: m, y0, hoehe, oben: [] };
    return m;
  };
  const eis = (anzahl, r) => {
    for (let i = 0; i < anzahl; i++) {
      const wuerfel = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.045, 0.045), new THREE.MeshStandardMaterial({ color: 0xeaf6ff, transparent: true, opacity: 0.7, roughness: 0.1 }));
      wuerfel.rotation.set(i, i * 2, 0);
      wuerfel.userData.versatz = new THREE.Vector3(Math.cos(i * 2.5) * r, -0.01, Math.sin(i * 2.5) * r);
      g.add(wuerfel);
      pegel.oben.push(wuerfel);
    }
  };
  const strohhalm = farbe => {
    const halm = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.42, 8), new THREE.MeshStandardMaterial({ color: farbe, roughness: 0.4 }));
    halm.position.set(0.03, 0.26, 0);
    halm.rotation.z = -0.25;
    g.add(halm);
  };
  const hochglas = () => glas([[0, 0], [0.075, 0], [0.08, 0.01], [0.088, 0.32]]);
  switch (id) {
    case "bier": {
      glas([[0, 0], [0.085, 0], [0.09, 0.01], [0.105, 0.38]]);
      fluessigkeit(0.083, 0.1, 0.012, 0.3, 0xd99a1a, 0.88);
      const schaum = new THREE.Mesh(new THREE.CylinderGeometry(0.102, 0.1, 0.06, 20), new THREE.MeshStandardMaterial({ color: 0xfff8e8, roughness: 0.9 }));
      schaum.userData.versatz = new THREE.Vector3(0, 0.025, 0);
      g.add(schaum);
      pegel.oben.push(schaum);
      break;
    }
    case "wein":
      scheibe(0.075, 0.01, 0.005);
      scheibe(0.009, 0.15, 0.08);
      glas([[0.012, 0.15], [0.05, 0.165], [0.085, 0.23], [0.08, 0.34]]);
      fluessigkeit(0.055, 0.082, 0.168, 0.065, 0x6a0a1a, 0.92);
      break;
    case "whisky":
      scheibe(0.09, 0.02, 0.01);
      glas([[0, 0], [0.09, 0], [0.095, 0.16]]);
      fluessigkeit(0.087, 0.09, 0.02, 0.075, 0xb8641a, 0.9);
      eis(2, 0.03);
      break;
    case "sekt": {
      scheibe(0.06, 0.01, 0.005);
      scheibe(0.008, 0.12, 0.065);
      glas([[0.008, 0.12], [0.03, 0.135], [0.042, 0.34]]);
      fluessigkeit(0.03, 0.04, 0.137, 0.16, 0xf2d878, 0.75);
      break;
    }
    case "cocktail": {
      glas([[0, 0], [0.07, 0], [0.095, 0.3]]);
      fluessigkeit(0.068, 0.09, 0.01, 0.24, 0xff6a30, 0.92);
      const schirm = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.05, 10), new THREE.MeshStandardMaterial({ color: 0xff4f9a, side: THREE.DoubleSide }));
      schirm.position.set(0.05, 0.42, 0);
      schirm.rotation.z = -0.4;
      const stiel = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.2, 6), new THREE.MeshStandardMaterial({ color: 0xf2e2c0 }));
      stiel.position.set(0.035, 0.33, 0);
      stiel.rotation.z = -0.4;
      const scheibeO = new THREE.Mesh(new THREE.TorusGeometry(0.04, 0.012, 6, 16, Math.PI), new THREE.MeshStandardMaterial({ color: 0xff9a20 }));
      scheibeO.position.set(-0.08, 0.3, 0);
      scheibeO.rotation.z = Math.PI / 2;
      g.add(schirm, stiel, scheibeO);
      break;
    }
    case "schnaps":
      // dickwandiges Schnapsglas mit schwerem Boden
      scheibe(0.058, 0.03, 0.015);
      glas([[0, 0], [0.058, 0], [0.068, 0.16]]);
      fluessigkeit(0.056, 0.064, 0.03, 0.11, 0x3a1a08, 0.95);
      break;
    case "cola":
      hochglas();
      fluessigkeit(0.073, 0.085, 0.012, 0.26, 0x2a0e06, 0.95);
      eis(3, 0.035);
      strohhalm(0xd8202a);
      break;
    case "wasser":
      hochglas();
      fluessigkeit(0.073, 0.085, 0.012, 0.26, 0x9fd0ff, 0.35);
      eis(2, 0.035);
      break;
    case "osaft":
      hochglas();
      fluessigkeit(0.073, 0.085, 0.012, 0.26, 0xffa020, 0.95);
      break;
    case "eistee": {
      hochglas();
      fluessigkeit(0.073, 0.085, 0.012, 0.26, 0xc87a28, 0.88);
      eis(2, 0.035);
      strohhalm(0x2f9e5b);
      const zitrone = new THREE.Mesh(new THREE.TorusGeometry(0.04, 0.012, 6, 16), new THREE.MeshStandardMaterial({ color: 0xf2e040 }));
      zitrone.position.set(-0.085, 0.3, 0);
      zitrone.rotation.y = Math.PI / 2;
      g.add(zitrone);
      break;
    }
    case "kaffee": {
      const tasse = new THREE.MeshStandardMaterial({ color: 0xf4efe6, roughness: 0.35 });
      const becher = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.075, 0.16, 20, 1, true), new THREE.MeshStandardMaterial({ color: 0xf4efe6, roughness: 0.35, side: THREE.DoubleSide }));
      becher.position.y = 0.08;
      scheibe(0.075, 0.01, 0.005, tasse);
      const henkel = new THREE.Mesh(new THREE.TorusGeometry(0.04, 0.012, 8, 16), tasse);
      henkel.position.set(0.1, 0.085, 0);
      g.add(becher, henkel);
      fluessigkeit(0.073, 0.082, 0.01, 0.13, 0x3a1e0e, 1);
      break;
    }
    default:
      return null;
  }
  g.traverse(teil => (teil.castShadow = true));
  g.userData.fuellstand = 1;
  g.userData.setzeFuellstand = stand => {
    g.userData.fuellstand = stand;
    if (!pegel) return;
    pegel.mesh.scale.y = Math.max(0.001, stand);
    pegel.mesh.visible = stand > 0.01;
    for (const obj of pegel.oben) {
      obj.position.copy(obj.userData.versatz).add(new THREE.Vector3(0, pegel.y0 + pegel.hoehe * stand, 0));
      obj.visible = stand > 0.01 || obj.geometry.type === "BoxGeometry"; // Eis bleibt liegen
    }
  };
  g.userData.setzeFuellstand(1);
  return g;
}

// Snack in einer Schale; userData.stuecke sind die einzelnen Happen (werden beim Naschen weniger)
function snackModell(id) {
  const g = new THREE.Group();
  const schalenFarbe = { chips: 0xf4efe6, brezeln: 0x2f5a8c, popcorn: 0xd8202a, gummibaerchen: 0xf4efe6, nachos: 0x3a7a5a, schokolade: 0xf4efe6 }[id];
  if (schalenFarbe === undefined) return null;
  const schale = new THREE.Mesh(
    new THREE.LatheGeometry([[0, 0], [0.11, 0], [0.18, 0.07], [0.19, 0.085]].map(([r, y]) => new THREE.Vector2(r, y)), 24),
    new THREE.MeshStandardMaterial({ color: schalenFarbe, roughness: 0.35, side: THREE.DoubleSide })
  );
  schale.castShadow = true;
  g.add(schale);
  const stuecke = [];
  const anzahl = 16;
  for (let i = 0; i < anzahl; i++) {
    let m;
    switch (id) {
      case "chips":
        m = new THREE.Mesh(new THREE.SphereGeometry(1, 8, 4), new THREE.MeshStandardMaterial({ color: 0xf2c040, roughness: 0.6 }));
        m.scale.set(0.04, 0.007, 0.032);
        break;
      case "brezeln":
        m = new THREE.Mesh(new THREE.TorusGeometry(0.026, 0.009, 6, 12), new THREE.MeshStandardMaterial({ color: 0x8a4a1a, roughness: 0.7 }));
        break;
      case "popcorn":
        m = new THREE.Mesh(new THREE.IcosahedronGeometry(0.024, 0), new THREE.MeshStandardMaterial({ color: i % 3 ? 0xfff2c8 : 0xffe08a, roughness: 0.9, flatShading: true }));
        break;
      case "gummibaerchen":
        m = new THREE.Mesh(new THREE.CapsuleGeometry(0.014, 0.02, 3, 6), new THREE.MeshStandardMaterial({ color: [0xe6453a, 0xf2c14e, 0x2f9e5b, 0xff8a1a, 0xffffff][i % 5], roughness: 0.3, transparent: true, opacity: 0.9 }));
        break;
      case "nachos":
        m = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.006, 3), new THREE.MeshStandardMaterial({ color: 0xf2b030, roughness: 0.7 }));
        break;
      case "schokolade":
        m = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.016, 0.05), new THREE.MeshStandardMaterial({ color: 0x4a2414, roughness: 0.5 }));
        break;
    }
    const winkel = i * 2.4;
    const r = 0.03 + (i % 5) * 0.025;
    m.position.set(Math.cos(winkel) * r, 0.05 + (i % 4) * 0.012, Math.sin(winkel) * r);
    m.rotation.set(i * 0.7, i * 1.3, i * 0.4);
    m.castShadow = true;
    g.add(m);
    stuecke.push(m);
  }
  g.userData.stuecke = stuecke;
  return g;
}

// Zeigt die Auswahl einer Seite ("eigen" | "gegner") auf dem Tisch: wahl = { getraenk, snack } (ids oder null)
function szeneTischSachen(seite, wahl) {
  if (!welt.tischSachen) welt.tischSachen = { eigen: {}, gegner: {} };
  const sachen = welt.tischSachen[seite];
  for (const art of ["getraenk", "snack"]) {
    if (sachen[art]) welt.szene.remove(sachen[art]);
    sachen[art] = null;
    const id = wahl && wahl[art];
    if (!id) continue;
    const modell = art === "getraenk" ? getraenkModell(id) : snackModell(id);
    if (!modell) continue;
    modell.position.copy(TISCH_PLAETZE[seite][art]);
    if (seite === "eigen") {
      // je nach Bildformat (tischNachFormat)
      modell.position.x *= welt.sachenFaktor || 1;
      modell.position.z += welt.eigeneVersatz || 0;
    }
    modell.rotation.y = Math.random() * Math.PI * 2;
    welt.szene.add(modell);
    sachen[art] = modell;
  }
  if (seite === "gegner") welt.naechstesNaschen = performance.now() + 9000 + Math.random() * 8000;
}

// Eigenes Getränk anklicken: Glas kommt zur Kamera, kippt (Schluck), geht zurück; der Pegel sinkt
async function szeneSchluck() {
  const glas = welt.tischSachen && welt.tischSachen.eigen.getraenk;
  if (!glas || glas.userData.inBewegung) return;
  if (glas.userData.fuellstand <= 0.01) {
    meldung("Leer! Nachschub gibt's an der Bar 🍹");
    return;
  }
  glas.userData.inBewegung = true;
  const start = glas.position.clone();
  const vorMund = () => welt.kamera.localToWorld(new THREE.Vector3(0.12, -0.32, -1.05));
  await animieren(dauer(420), t => {
    glas.position.lerpVectors(start, vorMund(), sanft(t));
    glas.rotation.x = 0.5 * sanft(t);
  });
  const vorher = glas.userData.fuellstand;
  await animieren(dauer(600), t => {
    glas.rotation.x = 0.5 + Math.sin(t * Math.PI) * 0.6;
    glas.userData.setzeFuellstand(Math.max(0, vorher - 0.25 * t));
  });
  await animieren(dauer(420), t => {
    glas.position.lerpVectors(vorMund(), start, sanft(t));
    glas.rotation.x = 0.5 * (1 - sanft(t));
  });
  glas.position.copy(start);
  glas.rotation.x = 0;
  glas.userData.inBewegung = false;
}

// Eigenen Snack anklicken: ein Happen fliegt zur Kamera und verschwindet
async function szeneKnabbern() {
  const schale = welt.tischSachen && welt.tischSachen.eigen.snack;
  if (!schale) return;
  const stueck = schale.userData.stuecke.pop();
  if (!stueck) {
    meldung("Alles aufgegessen! Nachschub gibt's an der Bar 🍹");
    return;
  }
  welt.szene.attach(stueck);
  const start = stueck.position.clone();
  await animieren(dauer(450), t => {
    stueck.position.lerpVectors(start, welt.kamera.localToWorld(new THREE.Vector3(0, -0.2, -0.6)), sanft(t));
    stueck.position.y += Math.sin(t * Math.PI) * 0.3;
    stueck.scale.multiplyScalar(t > 0.7 ? 0.9 : 1);
  });
  welt.szene.remove(stueck);
}

// ---------- Snacks werfen ----------

// ein einzelner Happen der Sorte (z. B. für den Rückwurf, wenn die eigene Schale nicht dieselbe Sorte hat)
function wurfHappen(snackId) {
  const modell = snackModell(snackId) || snackModell("popcorn");
  const happen = modell.userData.stuecke[0];
  modell.remove(happen);
  return happen;
}

// Eigener Wurf auf das Gegenüber: "ok", "kein" (kein Snack) oder "leer" (Schale leer); die Animation läuft weiter
function szeneSnackWerfen() {
  const schale = welt.tischSachen && welt.tischSachen.eigen.snack;
  if (!schale) return "kein";
  const happen = schale.userData.stuecke.pop();
  if (!happen) return "leer";
  welt.szene.attach(happen);
  happenFliegt(happen, () => welt.kopf.localToWorld(new THREE.Vector3(0.05, 0.38, 0.3)), 650, 0.9).then(() => {
    // getroffen: Kopf zuckt zurück, erschrockenes Gesicht, Happen fällt vor ihm auf den Tisch
    szeneAusdruck("schock", 1300);
    animieren(dauer(420), t => (welt.kopfZurueck = -0.4 * Math.sin(Math.PI * t))).then(() => (welt.kopfZurueck = 0));
    const von = happen.position.clone();
    const nach = new THREE.Vector3(von.x + (Math.random() - 0.5) * 0.4, 0.03, -2.45);
    return animieren(dauer(450), t => {
      happen.position.lerpVectors(von, nach, t);
      happen.position.y = von.y + (nach.y - von.y) * t * t; // fällt
    });
  }).then(() => setTimeout(() => welt.szene.remove(happen), 1500));
  return "ok";
}

// Das Gegenüber wirft einen Happen auf uns: ausholen, werfen, der Happen fliegt auf die Kamera zu, klatscht dagegen
// (Bild wackelt) und fällt nach unten weg
async function szeneWurfAufMich(snackId) {
  const arm = welt.armRechts;
  const frei = !welt.emoteLaeuft && !welt.figurNascht && arm.greifAnteil === 0;
  const huefte = welt.huefte;
  if (frei) {
    welt.figurNascht = true; // Arm ist belegt (Computerzug wartet kurz)
    await animieren(dauer(280), t => {
      arm.greifZiel.copy(huefte.localToWorld(new THREE.Vector3(0.55, 2.25, -0.15)));
      arm.greifAnteil = sanft(t);
    });
    await animieren(dauer(140), t => arm.greifZiel.lerpVectors(huefte.localToWorld(new THREE.Vector3(0.55, 2.25, -0.15)), huefte.localToWorld(new THREE.Vector3(0.3, 1.75, 0.75)), t));
  }
  szeneAusdruck("frech", 1500);
  const schale = welt.tischSachen && welt.tischSachen.gegner.snack;
  const happen = schale && schale.userData.stuecke.length ? schale.userData.stuecke.pop() : wurfHappen(snackId);
  if (happen.parent) welt.szene.attach(happen);
  else welt.szene.add(happen);
  happen.position.copy(frei ? arm.ellbogen.localToWorld(new THREE.Vector3(0, -arm.b, 0)) : welt.kopf.localToWorld(new THREE.Vector3(0.3, 0.1, 0.4)));
  happen.scale.multiplyScalar(1.3);
  if (frei) {
    animieren(dauer(300), t => (arm.greifAnteil = 1 - sanft(t))).then(() => {
      arm.greifAnteil = 0;
      welt.figurNascht = false;
    });
  }
  await happenFliegt(happen, () => welt.kamera.localToWorld(new THREE.Vector3(0.1, -0.05, -0.55)), 600, 0.45);
  welt.wackeln = { start: performance.now(), staerke: 0.7 };
  const von = happen.position.clone();
  await animieren(dauer(450), t => happen.position.copy(von).lerp(welt.kamera.localToWorld(new THREE.Vector3(0.15, -1.3, -0.7)), t * t));
  welt.szene.remove(happen);
}

// Happen fliegt im Bogen zu einem (beweglichen) Ziel und dreht sich dabei
function happenFliegt(happen, ziel, ms, bogen) {
  const start = happen.position.clone();
  const drehung = new THREE.Vector3(Math.random() * 12, Math.random() * 12, Math.random() * 12);
  return animieren(dauer(ms), t => {
    happen.position.lerpVectors(start, ziel(), t);
    happen.position.y += Math.sin(Math.PI * t) * bogen;
    happen.rotation.set(drehung.x * t, drehung.y * t, drehung.z * t);
  });
}

// Das Gegenüber trinkt oder nascht ab und zu – nur wenn es gerade nicht am Zug ist (figurDarfNaschen in spiel.js)
function tischSachenAktualisieren(jetzt) {
  const g = welt.gehalten;
  if (g) {
    // gehaltenes Objekt folgt der Hand (aufrecht, beim Trinken gekippt)
    const hand = g.arm.ellbogen.localToWorld(new THREE.Vector3(0, -g.arm.b, 0));
    g.objekt.position.copy(hand).add(g.versatz);
    g.objekt.rotation.set(g.kippen, g.objekt.rotation.y, 0);
  }
  if (welt.figurNascht || !welt.tischSachen || jetzt < (welt.naechstesNaschen || Infinity)) return;
  welt.naechstesNaschen = jetzt + 15000 + Math.random() * 15000;
  const sachen = welt.tischSachen.gegner;
  const moeglich = [];
  if (sachen.getraenk && sachen.getraenk.userData.fuellstand > 0.01) moeglich.push("getraenk");
  if (sachen.snack && sachen.snack.userData.stuecke.length) moeglich.push("snack");
  // nur mit einer freien Hand: bis 6 Karten hält er den Fächer rechts, links ist frei (gegnerFaecherAnordnung)
  const frei = !welt.emoteLaeuft && welt.armRechts.greifAnteil === 0 && welt.armLinks.greifAnteil === 0 && !welt.traurig &&
    welt.gegnerFaecher.children.length <= 6;
  if (!moeglich.length || !frei || !dauer(1) || typeof figurDarfNaschen !== "function" || !figurDarfNaschen()) return;
  figurNimmt(moeglich[Math.floor(Math.random() * moeglich.length)]);
}

// Trinken/Naschen mit der freien linken Hand: vorbeugen und greifen, im Bogen (erst hoch, dann zum Gesicht)
// zum Mund, trinken mit zurückgelegtem Kopf bzw. Happen in den Mund und kauen, im Bogen zurück, abstellen.
async function figurNimmt(art) {
  const sachen = welt.tischSachen.gegner;
  const trinken = art === "getraenk";
  const arm = welt.armLinks;
  const ziel = trinken ? sachen.getraenk : sachen.snack;
  welt.figurNascht = true;
  const VORBEUGEN = 0.45;
  const start = ziel.position.clone();
  const greifPunkt = start.clone().add(new THREE.Vector3(0, trinken ? 0.2 : 0.08, 0));
  // Ziel vor dem Mund, leicht von der Seite der Hand; beim Trinken tiefer, damit der Glasrand am Mund ist
  const mund = () => mundWelt().add(new THREE.Vector3(-0.06, trinken ? -0.2 : -0.06, trinken ? 0.24 : 0.12));
  // Bogen: über einen Punkt seitlich oberhalb, damit die Hand nicht durch Tisch und Karten fährt
  const bogen = (von, nach, t) => {
    const ueber = new THREE.Vector3((von.x + nach.x) / 2 - 0.15, Math.max(von.y, nach.y) + 0.1, (von.z + nach.z) / 2);
    const u = 1 - t;
    return new THREE.Vector3()
      .addScaledVector(von, u * u)
      .addScaledVector(ueber, 2 * u * t)
      .addScaledVector(nach, t * t);
  };

  await animieren(dauer(600), t => {
    arm.greifZiel.copy(greifPunkt);
    arm.greifAnteil = sanft(t);
    welt.huefte.rotation.x = VORBEUGEN * sanft(t);
  });
  let objekt = ziel;
  if (!trinken) {
    objekt = ziel.userData.stuecke.pop();
    welt.szene.attach(objekt);
  }
  welt.gehalten = { objekt, arm, versatz: new THREE.Vector3(0, trinken ? -0.22 : -0.04, 0.03), kippen: 0 };
  await animieren(dauer(750), t => {
    arm.greifZiel.copy(bogen(greifPunkt, mund(), sanft(t)));
    welt.huefte.rotation.x = VORBEUGEN * (1 - sanft(t));
  });
  if (trinken) {
    // Kopf in den Nacken, Glas kippen, Pegel sinkt
    const vorher = ziel.userData.fuellstand;
    await animieren(dauer(1000), t => {
      const k = Math.sin(t * Math.PI);
      welt.kopfZurueck = -0.3 * k;
      arm.greifZiel.copy(mund());
      welt.gehalten.kippen = -0.75 * k;
      ziel.userData.setzeFuellstand(Math.max(0, vorher - 0.2 * t));
    });
    welt.kopfZurueck = 0;
    welt.gehalten.kippen = 0;
    szeneAusdruck("gluecklich", 1200);
  } else {
    // Happen verschwindet im Mund, dann kauen (Kopf nickt leicht)
    welt.gehalten = null;
    welt.szene.remove(objekt);
    szeneAusdruck("gluecklich", 1600);
    await animieren(dauer(300), () => arm.greifZiel.copy(mund()));
  }
  // Hand zurück (beim Snack: kauen währenddessen)
  await animieren(dauer(700), t => {
    arm.greifZiel.copy(bogen(mund(), greifPunkt, sanft(t)));
    welt.huefte.rotation.x = VORBEUGEN * sanft(t);
    if (!trinken) welt.kopfZurueck = Math.sin(t * Math.PI * 6) * 0.06;
  });
  welt.kopfZurueck = 0;
  if (trinken) {
    welt.gehalten = null;
    ziel.position.copy(start);
    ziel.rotation.x = 0;
    ziel.rotation.z = 0;
  }
  await animieren(dauer(450), t => {
    arm.greifAnteil = 1 - sanft(t);
    welt.huefte.rotation.x = VORBEUGEN * (1 - sanft(t));
  });
  arm.greifAnteil = 0;
  welt.huefte.rotation.x = 0;
  welt.figurNascht = false;
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
    k.blickZiel = wach ? (Math.random() - 0.5) * 0.6 : 0; // schaut meist zu uns
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
  const erschrocken = jetzt < (k.erschrockenBis || 0);
  k.ohren.forEach((ohr, i) => {
    const t = (jetzt - (k.zuckenStart || 0)) / 300;
    const basis = i === 1 ? 0.3 : -0.3;
    ohr.rotation.x = basis + (i === k.zuckenOhr && t < 1 ? Math.sin(t * Math.PI * 3) * 0.4 : 0);
    ohr.rotation.z += ((erschrocken ? 0.75 : -0.15) - ohr.rotation.z) * Math.min(1, dt * 12); // Ohren anlegen
  });

  // Ab und zu tut sie selbst etwas: Pfote putzen oder sich strecken (sie bleibt dabei liegen)
  if (!k.aktion && jetzt > k.naechsteAktion && !k.frisst && !gluecklich && !k.sprungStart && dauer(1)) {
    const putzen = Math.random() < 0.6;
    k.aktion = { art: putzen ? "putzen" : "strecken", start: jetzt, dauer: putzen ? 3600 : 2200 };
    k.offenZiel = 1;
    k.naechsterBlick = jetzt + k.aktion.dauer + 500;
  }
  for (const schulter of k.vorne) schulter.rotation.set(0, 0, 0);
  if (k.aktion) {
    const a = k.aktion;
    const t = THREE.MathUtils.clamp((jetzt - a.start) / a.dauer, 0, 1);
    const huelle = Math.min(1, t / 0.15, (1 - t) / 0.15); // rein – halten – raus
    if (a.art === "putzen") {
      // rechte Pfote zum Mund, Kopf leckt sie ab
      k.vorne[0].rotation.z = 0.95 * huelle;
      k.vorne[0].rotation.y = 0.35 * huelle;
      k.kopf.rotation.z -= (0.35 + Math.sin(s * 10) * 0.12) * huelle;
      k.kopf.rotation.y += (-0.35 - k.kopf.rotation.y) * huelle * 0.5;
    } else if (a.art === "strecken") {
      // Vorderbeine weit nach vorn, Rumpf lang, Kopf hoch (gähnt)
      k.rumpf.scale.x = 1 + 0.14 * huelle;
      for (const schulter of k.vorne) schulter.rotation.z = -0.12 * huelle;
      k.kopf.rotation.z += 0.3 * huelle;
    }
    if (t >= 1) {
      k.aktion = null;
      k.naechsteAktion = jetzt + 12000 + Math.random() * 14000;
    }
  }

  // Schlag auf den Tisch: Katze springt hoch (Parabel), dreht sich dabei leicht und landet wieder
  if (k.sprungStart) {
    const t = (jetzt - k.sprungStart) / 1150; // gemächlich: hoch, kurz schweben, sanft landen
    if (t < 1 && dauer(1)) {
      k.gruppe.position.y = k.sprungHoehe * Math.sin(Math.PI * t);
      k.gruppe.rotation.z = Math.sin(t * Math.PI) * 0.25;
      k.rumpf.scale.y *= 1 + Math.sin(t * Math.PI) * 0.12; // streckt sich im Sprung
    } else {
      k.gruppe.position.y = 0;
      k.gruppe.rotation.z = 0;
      k.sprungStart = 0;
    }
  }

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
  welt.aschenbecher = gruppe;
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
  const block = new THREE.Mesh(new THREE.BoxGeometry(KARTE_B * 0.94 * TISCH_SKALA, 1, KARTE_H * 0.94 * TISCH_SKALA), [
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
  let abstand = Math.max(5.3, 2.4 / Math.tan(hfov / 2)); // hochkant weiter weg: Tisch und Raum statt Großaufnahme
  const quer = THREE.MathUtils.clamp((kamera.aspect - 1) / 1.1, 0, 1); // breite Bildschirme: flacher, mehr Wand
  let blickziel = new THREE.Vector3(0, 0.1 + 0.15 * quer, -1.1 - 0.25 * quer);
  // ca. 31° von oben, quer ca. 34° (sonst verdeckt die Hand zu viel vom vorderen Tisch), hochkant bis ca. 42°
  // Handy quer: noch etwas steiler – die größere Hand verdeckt sonst zu viel vom Tisch
  let richtung = new THREE.Vector3(0, 0.52 + (AUF_HANDY ? 0.2 : 0.08) * quer + 0.26 * schmal, 0.86).normalize();
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
  // Grundstellung merken (Körper mit der Hand), dann die Kopfdrehung obendrauf
  welt.koerper.position.copy(kamera.position);
  welt.koerper.quaternion.copy(kamera.quaternion);
  welt.koerper.updateMatrixWorld();
  if (welt.vorschau) welt.blick = { yaw: 0, pitch: 0 };
  blickAnwenden();
  zoomSetzen(welt.zoom || 1);

  welt.format = { schmal, quer };
  handLayout(); // setzt welt.handOben und ruft tischNachFormat()
}

// ---------- Kopf drehen (wischen/ziehen auf der Szene, Doppeltipp = wieder geradeaus) ----------

const BLICK_GRENZEN = { yaw: 0.75, pitchOben: 0.55, pitchUnten: -0.3 }; // nach oben bis zur Balkendecke

function blickAnwenden() {
  const b = welt.blick;
  const drehung = new THREE.Quaternion().setFromEuler(new THREE.Euler(b.pitch, b.yaw, 0, "YXZ"));
  welt.kamera.quaternion.copy(welt.koerper.quaternion).multiply(drehung);
  welt.kamera.updateMatrixWorld();
}

function blickStart(ereignis) {
  if (welt.vorschau || (ereignis.pointerType === "mouse" && ereignis.button !== 0)) return;
  welt.blickZug = { id: ereignis.pointerId, x: ereignis.clientX, y: ereignis.clientY, yaw: welt.blick.yaw, pitch: welt.blick.pitch, bewegt: false };
  // Touch: lange auf den eigenen Snack drücken = werfen (am Rechner: Rechtsklick, siehe contextmenu)
  clearTimeout(welt.langDruck);
  if (ereignis.pointerType !== "mouse") {
    const treffer = trefferBestimmen(ereignis);
    if (treffer && treffer.art === "knabbern") {
      welt.langDruck = setTimeout(() => {
        const z = welt.blickZug;
        if (z && !z.bewegt) {
          welt.blickZug = null;
          welt.naechstenKlickIgnorieren = true;
          if (typeof snackWerfen === "function") snackWerfen();
        }
      }, 500);
    }
  }
}

function blickZiehen(ereignis) {
  const z = welt.blickZug;
  if (!z || z.id !== ereignis.pointerId) return;
  const dx = ereignis.clientX - z.x;
  const dy = ereignis.clientY - z.y;
  if (!z.bewegt && Math.hypot(dx, dy) < 8) return; // kleine Wackler sind noch ein Tipp
  z.bewegt = true;
  clearTimeout(welt.langDruck);
  // wie die Welt anfassen und verschieben: nach rechts wischen = Blick nach links
  const proPixel = 2.2 / Math.max(welt.behaelter.clientWidth, welt.behaelter.clientHeight);
  welt.blick.yaw = THREE.MathUtils.clamp(z.yaw + dx * proPixel, -BLICK_GRENZEN.yaw, BLICK_GRENZEN.yaw);
  welt.blick.pitch = THREE.MathUtils.clamp(z.pitch + dy * proPixel, BLICK_GRENZEN.pitchUnten, BLICK_GRENZEN.pitchOben);
  blickAnwenden();
}

function blickEnde(ereignis) {
  clearTimeout(welt.langDruck);
  const z = welt.blickZug;
  if (!z || z.id !== ereignis.pointerId) return;
  welt.blickZug = null;
  if (z.bewegt) {
    welt.klickUnterdruecken = performance.now(); // der folgende "click" gehört zum Wischen
    return;
  }
  // Doppeltipp auf Touch-Geräten (dblclick kommt dort nicht zuverlässig)
  if (ereignis.pointerType !== "mouse") {
    const jetzt = performance.now();
    if (jetzt - (welt.letzterTipp || 0) < 320 && !trefferBestimmen(ereignis)) blickZuruecksetzen();
    welt.letzterTipp = jetzt;
  }
}

// weich wieder geradeaus schauen (und Zoom zurück)
function blickZuruecksetzen() {
  const von = { ...welt.blick };
  const zoomVon = welt.zoom || 1;
  if (!von.yaw && !von.pitch && zoomVon === 1) return;
  animieren(dauer(350), t => {
    const k = 1 - sanft(t);
    welt.blick.yaw = von.yaw * k;
    welt.blick.pitch = von.pitch * k;
    blickAnwenden();
    zoomSetzen(1 + (zoomVon - 1) * k);
  });
}

// ---------- Zoom (zwei Finger auseinanderziehen, Mausrad) ----------
// Zoomt die Kamera (kleinerer Bildwinkel). Die eigene Hand soll dabei gleich groß bleiben: Die Handgruppe hängt am
// Körper mit dem Auge als Ursprung, also wird sie quer zur Blickrichtung um 1/zoom gestaucht – das hebt die
// Vergrößerung der Projektion genau auf.
const ZOOM_GRENZEN = { min: 1, max: 2.6 };

function zoomSetzen(zoom) {
  welt.zoom = THREE.MathUtils.clamp(zoom, ZOOM_GRENZEN.min, ZOOM_GRENZEN.max);
  const z = welt.vorschau ? 1 : welt.zoom;
  welt.kamera.zoom = z;
  welt.kamera.updateProjectionMatrix();
  welt.handGruppe.scale.set(1 / z, 1 / z, 1);
}

// Finger auf dem Canvas mitzählen: bei zwei Fingern wird gezoomt statt gedreht
function zeigerRunter(ereignis) {
  welt.zeiger = welt.zeiger || new Map();
  welt.zeiger.set(ereignis.pointerId, { x: ereignis.clientX, y: ereignis.clientY });
  if (welt.zeiger.size === 2) {
    const [a, b] = [...welt.zeiger.values()];
    welt.pinch = { abstand: Math.hypot(a.x - b.x, a.y - b.y), zoom: welt.zoom || 1 };
    welt.blickZug = null; // kein Drehen mehr, solange zwei Finger liegen
    clearTimeout(welt.langDruck);
  }
}

function zeigerBewegtZoom(ereignis) {
  if (!welt.zeiger || !welt.zeiger.has(ereignis.pointerId)) return;
  welt.zeiger.set(ereignis.pointerId, { x: ereignis.clientX, y: ereignis.clientY });
  if (welt.pinch && welt.zeiger.size === 2) {
    const [a, b] = [...welt.zeiger.values()];
    zoomSetzen(welt.pinch.zoom * (Math.hypot(a.x - b.x, a.y - b.y) / Math.max(1, welt.pinch.abstand)));
    welt.klickUnterdruecken = performance.now();
  }
}

function zeigerHoch(ereignis) {
  if (!welt.zeiger) return;
  welt.zeiger.delete(ereignis.pointerId);
  if (welt.zeiger.size < 2) welt.pinch = null;
}

// Was vor einem liegt, rückt je nach Bildformat: hochkant ist zwischen Tischmitte und Hand viel Platz – dort
// rücken Stapel, Ablage, eigene Teilstapel und eigene Snacks näher heran. Auf breiten Bildschirmen schaut die
// Kamera flacher, die Hand verdeckt mehr vom vorderen Tisch – dann liegen die eigenen Teilstapel weiter hinten.
function tischNachFormat() {
  if (!welt.format) return;
  const { schmal, quer } = welt.format;
  let stapelZ = -0.35 + 0.45 * schmal - 0.1 * quer;
  let eigeneVersatz = 0.45 * schmal; // relativ zu EIGENE_STAPEL_Z bzw. TISCH_PLAETZE.eigen
  // Grenze: wo die Sichtlinie über die Oberkante der Hand den Tisch trifft – davor verdeckt die Hand alles
  if (welt.handOben !== undefined && !welt.vorschau) {
    const koerper = welt.koerper; // Grundstellung – unabhängig davon, wohin man gerade schaut
    koerper.updateMatrixWorld();
    const punkt = koerper.localToWorld(new THREE.Vector3(0, welt.handOben, -HAND_ABSTAND));
    const richtung = punkt.sub(koerper.position);
    if (richtung.y < 0) {
      const grenzeZ = koerper.position.z + richtung.z * (-koerper.position.y / richtung.y);
      const halbeTiefe = (KARTE_H * TEILSTAPEL_SKALA) / 2;
      eigeneVersatz = Math.min(eigeneVersatz, grenzeZ - 0.08 - halbeTiefe - EIGENE_STAPEL_Z);
    }
  }
  // Ziehstapel und Ablage bleiben eine Reihe hinter den eigenen Teilstapeln
  stapelZ = Math.min(stapelZ, EIGENE_STAPEL_Z + eigeneVersatz - (KARTE_H * TISCH_SKALA + 0.15));
  // In der Breite: hochkant eng beieinander (sonst nicht im Bild), auf breiten Bildschirmen weiter auseinander –
  // dann haben die Teilstapel in der Mitte Luft und es wirkt nicht gedrängt
  const breiteFaktor = 1 - schmal; // 0 = hochkant, 1 = quer/Desktop
  const stapelX = 0.9 + 0.5 * breiteFaktor;
  const sachenFaktor = 1 + 0.45 * breiteFaktor; // eigene Snacks/Getränk entsprechend weiter außen
  if (ZIEH_POS.z === stapelZ && ABLAGE_POS.x === stapelX && welt.eigeneVersatz === eigeneVersatz && welt.sachenFaktor === sachenFaktor) return;
  ZIEH_POS.set(-stapelX, 0, stapelZ);
  ABLAGE_POS.set(stapelX, 0, stapelZ);
  welt.eigeneVersatz = eigeneVersatz;
  welt.sachenFaktor = sachenFaktor;
  if (welt.ziehGruppe) welt.ziehGruppe.position.copy(ZIEH_POS);
  if (welt.eigeneStapelGruppe) welt.eigeneStapelGruppe.position.z = eigeneVersatz;
  const eigene = welt.tischSachen && welt.tischSachen.eigen;
  for (const art of ["getraenk", "snack"]) {
    if (eigene && eigene[art] && !eigene[art].userData.inBewegung) {
      eigene[art].position.x = TISCH_PLAETZE.eigen[art].x * sachenFaktor;
      eigene[art].position.z = TISCH_PLAETZE.eigen[art].z + eigeneVersatz;
    }
  }
  // Ablage an der neuen Stelle neu zeichnen (nur außerhalb von Animationen)
  if (welt.bereit && typeof updateAblage === "function" && typeof animationLaeuft !== "undefined" && !animationLaeuft) updateAblage();
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
    pos: new THREE.Vector3(ABLAGE_POS.x + lage.x * 0.014 * ABLAGE_SKALA, 0.006 + ebene * 0.003, ABLAGE_POS.z + lage.y * 0.014 * ABLAGE_SKALA),
    quat: liegendeLage(lage.drehung * 0.5, true), // weniger verdreht – leichter zu lesen
    skala: ABLAGE_SKALA
  };
}

// verdeckt: so viele oberste Karten noch nicht zeigen (sie sind gerade im Flug)
// wunschFarbe: liegt oben ein Bube mit offenem Wunsch, blendet er fließend in den Buben der Wunschfarbe über
// wuensche: Position → Farbe; Buben mit erfülltem Wunsch werden direkt in der Wunschfarbe gezeigt
function szeneAblageZeigen(ablage, verdeckt = 0, wunschFarbe = null, wuensche = {}) {
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
    const istOben = verdeckt === 0 && position === ablage.length - 1;
    const offenerWunsch = istOben && wunschFarbe && karte.startsWith("bube");
    // Bube mit (früherem) Wunsch: gleich als Bube der Wunschfarbe; der offene Wunsch oben blendet weich über
    const gezeigt = !offenerWunsch && karte.startsWith("bube") && wuensche[position] ? `bube ${wuensche[position]}` : karte;
    const k = karteErzeugen(gezeigt);
    k.position.copy(ziel.pos);
    k.quaternion.copy(ziel.quat);
    k.scale.setScalar(ziel.skala);
    welt.ablageGruppe.add(k);

    if (offenerWunsch) wunschAnzeigen(k, position, wunschFarbe);
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
  return 0.01 + Math.min(anzahl, 160) * 0.0011;
}

function szeneZiehstapelZeigen(anzahl) {
  const hoehe = stapelHoehe(anzahl);
  welt.ziehBlock.scale.y = hoehe;
  welt.ziehBlock.position.y = hoehe / 2;
  welt.ziehBlock.visible = anzahl > 0;

  if (welt.ziehBeschriftung) welt.ziehGruppe.remove(welt.ziehBeschriftung);
  welt.ziehBeschriftung = textSprite(`${anzahl} Karten`, 0.15);
  welt.ziehBeschriftung.position.set(0, 0.08, (KARTE_H * TISCH_SKALA) / 2 + 0.16);
  welt.ziehGruppe.add(welt.ziehBeschriftung);
}

function ziehstapelOben() {
  const hoehe = welt.ziehBlock.visible ? welt.ziehBlock.scale.y : 0;
  return {
    pos: new THREE.Vector3(ZIEH_POS.x, hoehe + 0.01, ZIEH_POS.z),
    quat: liegendeLage(0, false),
    skala: 0.94 * TISCH_SKALA
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
  const abstand = KARTE_B * TEILSTAPEL_SKALA + 0.2;
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
    const zahl = textSprite(String(deck.length), 0.13);
    const versatz = (KARTE_H * TEILSTAPEL_SKALA) / 2 + 0.12;
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
  // auf dem Handy deutlich größer (gut erkennbar und antippbar), am Rechner zurückhaltender
  const quer = welt.format ? welt.format.quer : 0;
  const anteil = AUF_HANDY ? { hoehe: 0.25 - 0.04 * quer, breite: 0.22 } : { hoehe: 0.17, breite: 0.15 };
  let skala = Math.min((anteil.hoehe * flaeche.hoehe) / KARTE_H, (anteil.breite * flaeche.breite) / KARTE_B);
  let b = KARTE_B * skala;
  let h = KARTE_H * skala;

  // Platz für die untere Leiste (Buttons, Meldungen) freihalten. Im Querformat auf kleinen Bildschirmen
  // steht die Leiste rechts unten in der Ecke (CSS) – dann unten keinen Platz reservieren, dafür seitlich.
  const ui = document.getElementById("unteresUi");
  const seitlich = ui && getComputedStyle(ui).position === "absolute";
  const uiHoehe = ui && !seitlich ? ui.offsetHeight : 0;
  const proPixel = flaeche.hoehe / (welt.behaelter.clientHeight || window.innerHeight);
  const uiBreite = ui && seitlich ? ui.offsetWidth * proPixel : 0;
  const nutzbareBreite = flaeche.breite - 2 * uiBreite;

  // Viele Karten: höchstens PRO_REIHE Karten pro Reihe, darüber mehrere Reihen (höchstens 4). Die vorderste Reihe
  // liegt unten, hintere Reihen höher und weiter hinten – von ihnen sieht man die obere Hälfte mit den Eckzeichen.
  // Dafür werden die Karten etwas kleiner.
  const PRO_REIHE = 7;
  let reihen = 1;
  if (n > PRO_REIHE) {
    reihen = Math.min(4, Math.ceil(n / PRO_REIHE));
    skala *= [1, 0.9, 0.82, 0.75][reihen - 1];
    b = KARTE_B * skala;
    h = KARTE_H * skala;
  }
  // Karten auf die Reihen verteilen (vordere Reihen bekommen die übrigen zusätzlichen Karten)
  const reihenGroesse = [];
  for (let r = 0; r < reihen; r++) reihenGroesse.push(Math.floor(n / reihen) + (r >= reihen - (n % reihen) ? 1 : 0));

  // Alle Karten sind gleich nach hinten gekippt (NEIGUNG), liegen also in parallelen Ebenen.
  // Damit jede Karte sicher vor der vorigen liegt, wird der Tiefenabstand entlang der gekippten
  // Kartennormale gerechnet – sonst rutschen die tiefer hängenden äußeren Karten rechts hinter ihre Nachbarn.
  const NEIGUNG = 0.12;
  const normaleY = Math.sin(NEIGUNG);
  const normaleZ = Math.cos(NEIGUNG);
  const ebenenAbstand = 0.004;
  const REIHEN_HUB = 0.5; // so viel Kartenhöhe liegt jede hintere Reihe höher

  // Mitte der vordersten Reihe; Reserve für Neigung und Fächer-Senkung der Karten
  const vorne = reihenGroesse[reihen - 1];
  const winkelFuer = m => Math.min(4, 36 / Math.max(m, 1));
  let mitteY = -flaeche.hoehe / 2 + (uiHoehe + (seitlich ? 14 : 34)) * proPixel + h / 2;
  // Oberkante der (einreihigen) Hand in Kamera-Koordinaten merken – tischNachFormat legt die eigenen
  // Teilstapel dahinter, damit die Hand sie nicht verdeckt
  welt.handOben = mitteY + h / 2 + h * 0.16;
  // Äußere Karten hängen tiefer und sind gedreht – ihre unteren Ecken sollen nicht unter die Leiste rutschen
  const aussen = (vorne - 1) / 2;
  const randWinkel = THREE.MathUtils.degToRad(aussen * winkelFuer(vorne));
  const senkungAussen = aussen * aussen * winkelFuer(vorne) * 0.0035 * skala;
  const eckeTiefer = (b / 2) * Math.sin(randWinkel) - (h / 2) * (1 - Math.cos(randWinkel));
  mitteY += senkungAussen + Math.max(0, eckeTiefer);

  // Die Hand ist leicht gebogen: Die Karten liegen auf einem Kreisbogen um einen Punkt hinter dem Kopf und sind
  // zur Mitte gedreht – dreht man den Kopf (blickZiehen), schaut man gerade auf die äußeren Karten.
  const BOGEN_RADIUS = HAND_ABSTAND * 1.2;
  const bogenMitteZ = -HAND_ABSTAND + BOGEN_RADIUS;

  let i = 0;
  for (let r = 0; r < reihen; r++) {
    const m = reihenGroesse[r];
    const nachHinten = reihen - 1 - r; // 0 = vorderste Reihe
    const reiheY = mitteY + nachHinten * h * REIHEN_HUB;
    const abstand = m > 1 ? Math.min(b * 0.72, (nutzbareBreite * 0.94 - b) / (m - 1)) : 0;
    const winkel = winkelFuer(m);
    for (let j = 0; j < m; j++, i++) {
      const karte = karten[i];
      const versatz = j - (m - 1) / 2;
      const y = reiheY - versatz * versatz * winkel * 0.0035 * skala;
      // Tiefenversatz: spätere Karten liegen vor den früheren (entlang der gekippten Kartennormale)
      const naeher = (j * ebenenAbstand - normaleY * (y - reiheY)) / normaleZ;
      const radius = BOGEN_RADIUS - naeher + nachHinten * 0.06;
      const phi = (versatz * abstand) / BOGEN_RADIUS;
      karte.scale.setScalar(skala);
      karte.userData.basis = new THREE.Vector3(radius * Math.sin(phi), y, bogenMitteZ - radius * Math.cos(phi));
      karte.userData.hubHoehe = h * (reihen > 1 ? 0.3 : 0.16); // in mehreren Reihen weiter hoch, damit man sie ganz sieht
      karte.rotation.order = "YXZ";
      karte.rotation.set(-NEIGUNG, -phi, THREE.MathUtils.degToRad(-versatz * winkel));
      karte.position.copy(karte.userData.basis);
    }
  }
  tischNachFormat();
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
        skibidi ? 0.55 : 0.22, // flacher Bogen: die Karte gleitet auf den Stapel statt hoch darüber hinweg
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
    new THREE.CylinderGeometry(0.27, 0.27, 0.035, 40, 1, true),
    new THREE.MeshStandardMaterial({ color: 0xc89b32, metalness: 0.8, roughness: 0.35 })
  );
  const seite = (text, oben) => {
    const flaeche = new THREE.Mesh(
      new THREE.CircleGeometry(0.27, 40),
      new THREE.MeshStandardMaterial({ map: muenzTextur(text), metalness: 0.5, roughness: 0.4 })
    );
    flaeche.rotation.x = oben ? -Math.PI / 2 : Math.PI / 2; // Schrift von unserem Platz aus lesbar
    flaeche.position.y = oben ? 0.018 : -0.018;
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
    muenze.position.y = mitte.y + 1.9 * 4 * t * (1 - t);
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
      flug(karteErzeugen(nachOben ? null : karten[i]), start, weltLage(ziel), dauer(560), 0.35, dauer(i * schritt)).then(
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
  if (art === "wuetend") return tischHaemmern();
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

// Wütend: Karten weg, beide Fäuste hoch und dreimal auf die Tischkante hauen – bei jedem Schlag hüpft alles
// auf dem Tisch und die Katze springt erschrocken hoch (szeneTischSchlag)
async function tischHaemmern() {
  const huefte = welt.huefte;
  const arme = [welt.armLinks, welt.armRechts];
  szeneAusdruck("wuetend", 2800);
  welt.gegnerFaecher.visible = false;
  const hoch = seite => new THREE.Vector3(seite * 0.36, 0.8, -2.78);
  const schlag = seite => new THREE.Vector3(seite * 0.32, 0.13, -2.7);
  const setze = (anteil, punkt) => {
    for (const arm of arme) {
      arm.greifZiel.copy(punkt(arm.seite));
      arm.greifAnteil = anteil;
    }
  };
  // Fäuste hoch, kurz ausholen …
  await animieren(dauer(450), t => {
    setze(sanft(t), hoch);
    huefte.rotation.x = 0.22 * sanft(t);
  });
  // … ein einziger Schlag (beschleunigt) …
  await animieren(dauer(130), t => {
    const e = t * t;
    for (const arm of arme) arm.greifZiel.lerpVectors(hoch(arm.seite), schlag(arm.seite), e);
    huefte.rotation.x = 0.22 + 0.12 * e;
  });
  szeneTischSchlag(1); // Wumms
  welt.kopf.rotation.x = 0.15;
  // … Fäuste bleiben kurz liegen, er schnauft
  await animieren(dauer(700), () => {});
  // Arme wieder zum Fächer
  await animieren(dauer(420), t => {
    for (const arm of arme) {
      arm.greifZiel.copy(schlag(arm.seite));
      arm.greifAnteil = 1 - sanft(t);
    }
    huefte.rotation.x = 0.34 * (1 - sanft(t));
  });
  for (const arm of arme) arm.greifAnteil = 0;
  huefte.rotation.set(0, 0, 0);
  welt.gegnerFaecher.visible = true;
}

// Ein Schlag auf den Tisch (vom Gegenüber oder von einem selbst): alles auf dem Tisch hüpft, die Katze springt
// erschrocken hoch, das Bild wackelt kurz. staerke ~ 1
function szeneTischSchlag(staerke = 1) {
  const jetzt = performance.now();
  const objekte = [welt.ablageGruppe, welt.ziehGruppe, welt.eigeneStapelGruppe, welt.gegnerStapelGruppe, welt.leckerliPackung, welt.aschenbecher];
  if (welt.tischSachen) {
    for (const seite of ["eigen", "gegner"]) {
      for (const art of ["getraenk", "snack"]) {
        const obj = welt.tischSachen[seite][art];
        if (obj && !obj.userData.inBewegung && !(welt.gehalten && welt.gehalten.objekt === obj)) objekte.push(obj);
      }
    }
  }
  welt.huepfer = welt.huepfer || [];
  for (const obj of objekte) {
    if (!obj) continue;
    if (!welt.huepfer.includes(obj)) {
      obj.userData.hupfBasisY = obj.position.y;
      welt.huepfer.push(obj);
    }
    obj.userData.hupfStart = jetzt;
    obj.userData.hupfHoehe = (0.025 + Math.random() * 0.045) * staerke;
  }
  const k = welt.katze;
  if (k) {
    k.sprungStart = jetzt;
    k.sprungHoehe = (0.6 + Math.random() * 0.12) * staerke; // hoch und eher schwebend (Dauer in katzeAktualisieren)
    k.erschrockenBis = jetzt + 2200;
    k.offenZiel = 1;
    k.naechsterBlick = jetzt + 2200;
  }
  welt.wackeln = { start: jetzt, staerke };
}

// Hüpfen der Sachen und Wackeln des Bildes fortschreiben (aus der Schleife)
function tischSchlagAktualisieren(jetzt) {
  if (welt.huepfer && welt.huepfer.length) {
    welt.huepfer = welt.huepfer.filter(obj => {
      const t = (jetzt - obj.userData.hupfStart) / 450;
      if (t >= 1 || !obj.parent) {
        obj.position.y = obj.userData.hupfBasisY;
        return false;
      }
      obj.position.y = obj.userData.hupfBasisY + obj.userData.hupfHoehe * Math.sin(Math.PI * t);
      return true;
    });
  }
  const w = welt.wackeln;
  if (w) {
    const t = (jetzt - w.start) / 280;
    welt.kamera.position.copy(welt.koerper.position);
    if (t < 1 && dauer(1)) {
      const s = 0.02 * w.staerke * (1 - t);
      welt.kamera.position.add(new THREE.Vector3((Math.random() - 0.5) * s, (Math.random() - 0.5) * s, 0));
    } else {
      welt.wackeln = null;
    }
  }
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
  const eigene = welt.tischSachen && welt.tischSachen.eigen;
  if (eigene && eigene.getraenk && strahl.intersectObject(eigene.getraenk, true).length) return { art: "schluck" };
  if (eigene && eigene.snack && strahl.intersectObject(eigene.snack, true).length) return { art: "knabbern" };
  if (welt.barSchrank) {
    const bar = strahl.intersectObject(welt.barSchrank, true)[0];
    if (bar) {
      // welcher Teil: oben drauf = Snacks, links = Bar, rechts = Softdrinks
      const lokal = welt.barSchrank.worldToLocal(bar.point.clone());
      return { art: "bar", bereich: lokal.y > 3.2 ? "snacks" : lokal.x < 0 ? "alkohol" : "ohne" };
    }
  }
  if (welt.katze && strahl.intersectObject(welt.katze.gruppe, true).length) return { art: "katze" };
  return null;
}

function zeigerBewegt(ereignis) {
  const treffer = trefferBestimmen(ereignis);
  const klickbar = typeof handKlickbar === "function" && handKlickbar();
  welt.hoverIndex = treffer && treffer.art === "hand" && klickbar ? treffer.index : -1;
  welt.hoverStapel = !!(treffer && treffer.art === "stapel" && klickbar);
  const katzenSache = !!(treffer && ["katze", "leckerli", "schluck", "knabbern", "bar"].includes(treffer.art));
  welt.renderer.domElement.style.cursor = welt.hoverIndex !== -1 || welt.hoverStapel || katzenSache ? "pointer" : "default";
}

function geklickt(ereignis) {
  // Klick nach langem Drücken (Snack geworfen) oder direkt nach einem Wischen (Kopf drehen) ist kein Antippen
  if (welt.naechstenKlickIgnorieren) {
    welt.naechstenKlickIgnorieren = false;
    return;
  }
  if (welt.klickUnterdruecken && performance.now() - welt.klickUnterdruecken < 400) {
    welt.klickUnterdruecken = 0;
    return;
  }
  const treffer = trefferBestimmen(ereignis);
  if (!treffer) return;
  if (treffer.art === "hand") handKarteGeklickt(treffer.index);
  else if (treffer.art === "stapel") karteZiehen();
  else if (treffer.art === "katze") katzeStreicheln();
  else if (treffer.art === "leckerli") katzeFuettern();
  else if (treffer.art === "schluck") szeneSchluck();
  else if (treffer.art === "knabbern") szeneKnabbern();
  else if (treffer.art === "bar") barOeffnen(treffer.bereich);
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
  kaminAktualisieren(jetzt);
  mondAktualisieren(jetzt, dt);
  tischSchlagAktualisieren(jetzt);
  dekoAktualisieren(jetzt);
  katze2Aktualisieren(jetzt, dt);
  tischSachenAktualisieren(jetzt);
  handHoverAktualisieren();
  welt.renderer.render(welt.szene, welt.kamera);
}
