'use strict';

/**
 * Découpe la planche de cadres de cartes en un PNG par classe.
 *
 *   node tools/card-frames.js cardsHearthstone.png
 *
 * La planche présente 19 cadres sur fond noir, rangés en trois lignes : les treize
 * classes, plus quelques variantes de spec (les trois du chasseur de démons, les
 * trois du prêtre). Chaque cadre en sort avec deux trous :
 *
 *  - le fond AUTOUR de la carte, pour qu'elle ne soit pas un rectangle noir posé
 *    sur la page ;
 *  - l'intérieur du MÉDAILLON, que l'illustration remplit d'un aplat sombre — posé
 *    sur le portrait, il le cacherait entièrement.
 *
 * Les deux se percent par propagation à travers les seuls pixels très sombres. Le
 * cadre lui-même est clair et doré : il arrête la propagation des deux côtés, sans
 * qu'on ait à décrire la moindre forme.
 *
 * Les cartes sont repérées par composantes connexes, pas par une grille codée en
 * dur : les libellés sous les cartes sont trop petits pour être retenus, et une
 * planche recomposée autrement continuera de fonctionner tant que l'ordre de lecture
 * reste le même.
 *
 * Outil ponctuel, comme tools/chroma-key.js et tools/cutout.js : les PNG produits
 * sont les livrables, rien n'est appelé au runtime.
 */

const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');

const ROOT = path.join(__dirname, '..');
const SORTIE = path.join(ROOT, 'public', 'img', 'cards');

const [, , entreeArg] = process.argv;
const ENTREE = entreeArg || path.join(ROOT, 'cardsHearthstone.png');

// Ordre de lecture de la planche : gauche à droite, ligne par ligne. C'est le seul
// endroit qui sait quel cadre va à quelle classe — la planche, elle, ne porte que
// des libellés en anglais dessinés dans l'image.
const CADRES = [
  'death-knight', 'mage', 'rogue', 'demon-hunter', 'monk', 'shaman',
  'druid', 'paladin', 'warlock', 'priest', 'warrior', 'hunter',
  'demon-hunter-havoc', 'demon-hunter-vengeance', 'demon-hunter-devourer',
  'evoker',
  'priest-discipline', 'priest-holy', 'priest-shadow',
];

// Un pixel « sombre » : le fond de planche est à ~8, l'aplat du médaillon guère
// plus. La dorure du cadre dépasse largement, d'où la marge.
const SOMBRE = 34;
// Aire minimale d'une carte, pour écarter les libellés dessinés sous chacune.
const AIRE_MIN = 8000;

const planche = PNG.sync.read(fs.readFileSync(ENTREE));

/** Composantes connexes de pixels non sombres : une par carte. */
function cartes(png) {
  const { width: W, height: H, data } = png;
  const vif = (i) => Math.max(data[i], data[i + 1], data[i + 2]) > SOMBRE;
  const vu = new Uint8Array(W * H);
  const trouvees = [];

  for (let depart = 0; depart < W * H; depart++) {
    if (vu[depart] || !vif(depart * 4)) continue;
    const pile = [depart];
    vu[depart] = 1;
    let n = 0;
    let x0 = W;
    let x1 = 0;
    let y0 = H;
    let y1 = 0;

    while (pile.length) {
      const q = pile.pop();
      n++;
      const x = q % W;
      const y = (q - x) / W;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
          const r = ny * W + nx;
          if (vu[r] || !vif(r * 4)) continue;
          vu[r] = 1;
          pile.push(r);
        }
      }
    }
    if (n > AIRE_MIN) trouvees.push({ x0, y0, x1, y1 });
  }

  // Ordre de lecture. Deux cartes sont sur la même ligne si leurs sommets sont
  // proches : les cadres ne sont pas alignés au pixel près sur la planche.
  return trouvees.sort((a, b) => (Math.abs(a.y0 - b.y0) > 40 ? a.y0 - b.y0 : a.x0 - b.x0));
}

/** Recadre la planche sur une carte, en RGBA opaque. */
function decouper(png, boite) {
  const w = boite.x1 - boite.x0 + 1;
  const h = boite.y1 - boite.y0 + 1;
  const out = new PNG({ width: w, height: h });
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const src = ((boite.y0 + y) * png.width + (boite.x0 + x)) * 4;
      const dst = (y * w + x) * 4;
      out.data[dst] = png.data[src];
      out.data[dst + 1] = png.data[src + 1];
      out.data[dst + 2] = png.data[src + 2];
      out.data[dst + 3] = 255;
    }
  }
  return out;
}

/**
 * Perce une zone sombre par propagation, depuis une liste de graines.
 * Renvoie le nombre de pixels rendus transparents.
 */
function percer(png, graines) {
  const { width: W, height: H, data } = png;
  const sombre = (i) => data[i + 3] > 0 && Math.max(data[i], data[i + 1], data[i + 2]) <= SOMBRE;
  const masque = new Uint8Array(W * H);
  const pile = [];

  for (const g of graines) {
    if (g < 0 || g >= W * H || masque[g] || !sombre(g * 4)) continue;
    masque[g] = 1;
    pile.push(g);
  }

  while (pile.length) {
    const q = pile.pop();
    const x = q % W;
    const y = (q - x) / W;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const r = ny * W + nx;
      if (masque[r] || !sombre(r * 4)) continue;
      masque[r] = 1;
      pile.push(r);
    }
  }

  // Dilatation d'un pixel : mange la frange d'anti-crénelage, sans quoi il reste un
  // liseré noir entre le portrait et le cerclage.
  const dilate = new Uint8Array(masque);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (!masque[y * W + x]) continue;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        dilate[ny * W + nx] = 1;
      }
    }
  }

  let n = 0;
  for (let i = 0; i < dilate.length; i++) {
    if (!dilate[i]) continue;
    data[i * 4 + 3] = 0;
    n++;
  }
  return n;
}

const boites = cartes(planche);
if (boites.length !== CADRES.length) {
  console.error(
    `${boites.length} cadre(s) détecté(s) sur la planche, ${CADRES.length} attendu(s) : ` +
      'la table CADRES ne correspond plus à l’image.'
  );
  process.exit(1);
}

fs.mkdirSync(SORTIE, { recursive: true });
let total = 0;

boites.forEach((boite, i) => {
  const nom = CADRES[i];
  const carte = decouper(planche, boite);
  const { width: W, height: H } = carte;

  // Le pourtour : toutes les bordures servent de graines.
  const bord = [];
  for (let x = 0; x < W; x++) bord.push(x, (H - 1) * W + x);
  for (let y = 0; y < H; y++) bord.push(y * W, y * W + W - 1);
  const fond = percer(carte, bord);

  // Le médaillon : une colonne de graines sur l'axe central, dans le tiers haut.
  const cx = Math.round(W * 0.5);
  const graines = [];
  for (let y = Math.round(H * 0.12); y < Math.round(H * 0.42); y++) graines.push(y * W + cx);
  const oeil = percer(carte, graines);

  const chemin = path.join(SORTIE, `${nom}.png`);
  fs.writeFileSync(chemin, PNG.sync.write(carte));
  const ko = fs.statSync(chemin).size / 1024;
  total += ko;
  console.log(
    `${nom.padEnd(26)} ${W}x${H}  fond ${String(fond).padStart(6)} px  ` +
      `médaillon ${String(oeil).padStart(5)} px  ${ko.toFixed(0)} Ko`
  );
});

console.log(`\n${boites.length} cadres dans public/img/cards/ — ${total.toFixed(0)} Ko au total.`);
