'use strict';

/**
 * Détourage d'un sujet sur décor (sans fond uni), par propagation depuis les bords.
 *
 *   node tools/cutout.js bol.png public/img/bolderiz.png 360 [tolerance]
 *
 * Principe : le fond est atteignable depuis les bords de l'image par petits pas de
 * couleur. On propage donc depuis le pourtour tant que deux pixels voisins se
 * ressemblent — ce qui suit les dégradés du sol sans déborder sur le sujet, là où
 * un seuil global échouerait. Restent des îlots de premier plan (le personnage,
 * mais aussi le décor au fond) : on ne garde que le plus grand.
 *
 * Outil ponctuel, comme tools/chroma-key.js : le PNG produit est le livrable.
 */

const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');

const [, , inputPath, outputPath, widthArg, tolArg, cleanArg, glowArg] = process.argv;
if (!inputPath || !outputPath) {
  console.error(
    'usage: node tools/cutout.js <entrée.png> <sortie.png> [largeur] [tolérance] [nettoyage]'
  );
  process.exit(1);
}
const targetWidth = Number(widthArg) || 360;
const TOLERANCE = Number(tolArg) || 14;
// Rayon de l'ouverture morphologique : sectionne les fins ponts de pixels par
// lesquels des morceaux de décor restent accrochés au sujet. 0 = désactivé.
const CLEAN = Number(cleanArg) || 0;

/**
 * Mode « halo » : sur une capture où la cible est sélectionnée, le jeu dessine un
 * liseré jaune tout autour du personnage. Ce contour fermé sert de barrière : la
 * propagation ne le traverse pas, ce qui permet une tolérance bien plus large pour
 * balayer un décor texturé sans jamais entamer le sujet. Sans lui, un décor de même
 * teinte que ses vêtements reste collé (feuillage sombre contre pantalon noir).
 */
const USE_GLOW = glowArg === '1' || glowArg === 'glow';

const src = PNG.sync.read(fs.readFileSync(inputPath));
const { width: W, height: H } = src;
const at = (x, y) => (y * W + x) * 4;

/** Écart de couleur entre deux pixels, canal le plus divergent. */
function diff(a, b) {
  return Math.max(
    Math.abs(src.data[a] - src.data[b]),
    Math.abs(src.data[a + 1] - src.data[b + 1]),
    Math.abs(src.data[a + 2] - src.data[b + 2])
  );
}

// --- 1. Propagation du fond depuis les bords ---------------------------------
const isBackground = new Uint8Array(W * H);
const isWall = new Uint8Array(W * H);
const queue = [];

if (USE_GLOW) {
  let walls = 0;
  for (let i = 0; i < W * H; i += 1) {
    const o = i * 4;
    const r = src.data[o];
    const g = src.data[o + 1];
    const b = src.data[o + 2];
    // Jaune vif du liseré de sélection : rouge et vert hauts, bleu nettement bas.
    if (r > 130 && g > 130 && b < g - 55 && b < r - 55) {
      isWall[i] = 1;
      walls += 1;
    }
  }
  console.log(`halo de sélection : ${walls} px servant de barrière`);
}

function seed(x, y) {
  const i = y * W + x;
  if (isBackground[i] || isWall[i]) return;
  isBackground[i] = 1;
  queue.push(i);
}
for (let x = 0; x < W; x += 1) {
  seed(x, 0);
  seed(x, H - 1);
}
for (let y = 0; y < H; y += 1) {
  seed(0, y);
  seed(W - 1, y);
}

for (let head = 0; head < queue.length; head += 1) {
  const i = queue[head];
  const x = i % W;
  const y = (i - x) / W;
  const from = at(x, y);

  const neighbours = [
    [x - 1, y],
    [x + 1, y],
    [x, y - 1],
    [x, y + 1],
  ];
  for (const [nx, ny] of neighbours) {
    if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
    const ni = ny * W + nx;
    if (isBackground[ni] || isWall[ni]) continue;
    if (diff(from, at(nx, ny)) <= TOLERANCE) {
      isBackground[ni] = 1;
      queue.push(ni);
    }
  }
}

// --- 1 bis. Ouverture : on coupe les fins ponts vers le décor -----------------
// Éroder d'abord isole les morceaux de décor qui ne tenaient qu'à quelques pixels ;
// la dilatation rendra ensuite au sujet son épaisseur d'origine, sans les récupérer.
const original = Uint8Array.from(isBackground);

function grow(source, radius) {
  let cur = source;
  for (let step = 0; step < radius; step += 1) {
    const next = Uint8Array.from(cur);
    for (let y = 0; y < H; y += 1) {
      for (let x = 0; x < W; x += 1) {
        if (cur[y * W + x]) continue;
        if (
          (x > 0 && cur[y * W + x - 1]) ||
          (x < W - 1 && cur[y * W + x + 1]) ||
          (y > 0 && cur[(y - 1) * W + x]) ||
          (y < H - 1 && cur[(y + 1) * W + x])
        ) {
          next[y * W + x] = 1;
        }
      }
    }
    cur = next;
  }
  return cur;
}

if (CLEAN > 0) {
  // Faire grossir le fond revient à éroder le sujet.
  const eroded = grow(isBackground, CLEAN);
  for (let i = 0; i < W * H; i += 1) isBackground[i] = eroded[i];
}

// --- 2. On ne garde que le plus grand îlot de premier plan --------------------
const label = new Int32Array(W * H).fill(-1);
let bestLabel = -1;
let bestSize = 0;
let current = 0;

for (let start = 0; start < W * H; start += 1) {
  if (isBackground[start] || label[start] !== -1) continue;
  const stack = [start];
  label[start] = current;
  let size = 0;

  while (stack.length) {
    const i = stack.pop();
    size += 1;
    const x = i % W;
    const y = (i - x) / W;
    for (const [nx, ny] of [
      [x - 1, y],
      [x + 1, y],
      [x, y - 1],
      [x, y + 1],
    ]) {
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const ni = ny * W + nx;
      if (isBackground[ni] || label[ni] !== -1) continue;
      label[ni] = current;
      stack.push(ni);
    }
  }

  if (size > bestSize) {
    bestSize = size;
    bestLabel = current;
  }
  current += 1;
}

console.log(`îlots de premier plan : ${current}, le plus grand fait ${bestSize} px`);

// --- 3. Masque + adoucissement du contour ------------------------------------
const alpha = new Uint8Array(W * H);
for (let i = 0; i < W * H; i += 1) alpha[i] = label[i] === bestLabel ? 255 : 0;

// Dilatation symétrique de l'érosion, bornée au masque d'origine : le sujet
// retrouve sa silhouette exacte, les morceaux détachés ne reviennent pas.
if (CLEAN > 0) {
  let cur = alpha;
  for (let step = 0; step < CLEAN; step += 1) {
    const next = Uint8Array.from(cur);
    for (let y = 0; y < H; y += 1) {
      for (let x = 0; x < W; x += 1) {
        const i = y * W + x;
        if (cur[i] || original[i]) continue; // hors du sujet d'origine : on ne déborde pas
        if (
          (x > 0 && cur[i - 1]) ||
          (x < W - 1 && cur[i + 1]) ||
          (y > 0 && cur[i - W]) ||
          (y < H - 1 && cur[i + W])
        ) {
          next[i] = 255;
        }
      }
    }
    cur = next;
  }
  for (let i = 0; i < W * H; i += 1) alpha[i] = cur[i];
}

// Moyenne 3x3 : évite l'escalier sur les bords du sujet.
const smoothed = new Uint8Array(W * H);
for (let y = 0; y < H; y += 1) {
  for (let x = 0; x < W; x += 1) {
    let sum = 0;
    let n = 0;
    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        sum += alpha[ny * W + nx];
        n += 1;
      }
    }
    smoothed[y * W + x] = Math.round(sum / n);
  }
}

// --- 3 bis. Anti-frange : le décor déteint sur le contour --------------------
// Le fond est lavande, donc les pixels de bord tirent vers le violet. On ne corrige
// que le contour (alpha partiel, ou voisin du vide) pour ne pas toucher aux teintes
// mauves de l'armure du personnage, qui sont légitimes.
const rgb = Buffer.from(src.data);
const MAX_BLUE_OVER_GREEN = 24;
const MAX_RED_OVER_GREEN = 30;
let despilled = 0;

for (let y = 0; y < H; y += 1) {
  for (let x = 0; x < W; x += 1) {
    const i = y * W + x;
    const a = smoothed[i];
    if (a === 0) continue;

    let onEdge = a < 255;
    if (!onEdge) {
      for (const [nx, ny] of [
        [x - 1, y],
        [x + 1, y],
        [x, y - 1],
        [x, y + 1],
      ]) {
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        if (smoothed[ny * W + nx] < 32) {
          onEdge = true;
          break;
        }
      }
    }
    if (!onEdge) continue;

    const o = at(x, y);
    const g = rgb[o + 1];
    let touched = false;
    if (rgb[o + 2] - g > MAX_BLUE_OVER_GREEN) {
      rgb[o + 2] = g + MAX_BLUE_OVER_GREEN;
      touched = true;
    }
    if (rgb[o] - g > MAX_RED_OVER_GREEN) {
      rgb[o] = g + MAX_RED_OVER_GREEN;
      touched = true;
    }
    if (touched) despilled += 1;
  }
}
console.log(`anti-frange appliqué sur ${despilled} pixels de contour`);

// --- 4. Recadrage sur le sujet ----------------------------------------------
let minX = W;
let minY = H;
let maxX = -1;
let maxY = -1;
for (let y = 0; y < H; y += 1) {
  for (let x = 0; x < W; x += 1) {
    if (smoothed[y * W + x] > 16) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
}
if (maxX < 0) {
  console.error('Rien à garder : tout a été considéré comme du fond.');
  process.exit(1);
}

const cropW = maxX - minX + 1;
const cropH = maxY - minY + 1;

// --- 5. Réduction (moyenne de boîte, couleurs pondérées par l'alpha) ----------
const scale = Math.min(1, targetWidth / cropW);
const outW = Math.max(1, Math.round(cropW * scale));
const outH = Math.max(1, Math.round(cropH * scale));
const out = new PNG({ width: outW, height: outH });

for (let y = 0; y < outH; y += 1) {
  const y0 = minY + Math.floor((y * cropH) / outH);
  const y1 = Math.max(y0 + 1, minY + Math.floor(((y + 1) * cropH) / outH));
  for (let x = 0; x < outW; x += 1) {
    const x0 = minX + Math.floor((x * cropW) / outW);
    const x1 = Math.max(x0 + 1, minX + Math.floor(((x + 1) * cropW) / outW));

    let r = 0;
    let g = 0;
    let b = 0;
    let a = 0;
    let n = 0;
    for (let sy = y0; sy < y1 && sy < H; sy += 1) {
      for (let sx = x0; sx < x1 && sx < W; sx += 1) {
        const al = smoothed[sy * W + sx];
        const o = at(sx, sy);
        r += rgb[o] * al;
        g += rgb[o + 1] * al;
        b += rgb[o + 2] * al;
        a += al;
        n += 1;
      }
    }

    const o = (y * outW + x) * 4;
    if (a > 0) {
      out.data[o] = Math.round(r / a);
      out.data[o + 1] = Math.round(g / a);
      out.data[o + 2] = Math.round(b / a);
      out.data[o + 3] = Math.round(a / n);
    }
  }
}

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, PNG.sync.write(out));

console.log(`source    : ${W}x${H}, ${(fs.statSync(inputPath).size / 1024).toFixed(0)} Ko`);
console.log(`recadrage : ${cropW}x${cropH}`);
console.log(
  `sortie    : ${outW}x${outH}, ${(fs.statSync(outputPath).size / 1024).toFixed(0)} Ko -> ${outputPath}`
);
