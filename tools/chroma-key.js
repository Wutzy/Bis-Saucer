'use strict';

/**
 * Détourage par chroma key : retire le fond magenta d'une capture, recadre sur le
 * sujet et réduit l'image. Sert à préparer l'illustration du coin haut de page.
 *
 *   node tools/chroma-key.js Footzy2.png public/img/footzy.png 280
 *
 * Outil ponctuel : le résultat est commité, le script n'est pas appelé au runtime.
 */

const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');

const [, , inputPath, outputPath, widthArg] = process.argv;
if (!inputPath || !outputPath) {
  console.error('usage: node tools/chroma-key.js <entrée.png> <sortie.png> [largeur]');
  process.exit(1);
}
const targetWidth = Number(widthArg) || 280;

// Seuils sur l'indice de "magenta" : (rouge + bleu) / 2 - vert.
// En dessous de LOW le pixel est gardé, au-dessus de HIGH il est effacé, entre les
// deux l'alpha est interpolé — c'est ce qui évite un contour en escalier.
const LOW = 40;
const HIGH = 95;

const src = PNG.sync.read(fs.readFileSync(inputPath));

/** Indice de magenta d'un pixel. */
function magentaness(r, g, b) {
  return (r + b) / 2 - g;
}

// --- 1. Chroma key + anti-frange -------------------------------------------
const keyed = Buffer.alloc(src.width * src.height * 4);
for (let i = 0; i < src.width * src.height; i += 1) {
  const o = i * 4;
  let r = src.data[o];
  let g = src.data[o + 1];
  let b = src.data[o + 2];

  const m = magentaness(r, g, b);
  let alpha;
  if (m <= LOW) alpha = 255;
  else if (m >= HIGH) alpha = 0;
  else alpha = Math.round(255 * (1 - (m - LOW) / (HIGH - LOW)));

  // Anti-frange : sur les bords, le magenta déteint sur le sujet. On ramène le
  // rouge et le bleu au niveau du vert pour retirer cette dominante.
  if (alpha > 0 && alpha < 255) {
    const cap = g + (HIGH - LOW) / 4;
    if (r > cap) r = Math.round(cap);
    if (b > cap) b = Math.round(cap);
  }

  keyed[o] = r;
  keyed[o + 1] = g;
  keyed[o + 2] = b;
  keyed[o + 3] = alpha;
}

// --- 2. Recadrage sur le sujet ----------------------------------------------
let minX = src.width;
let minY = src.height;
let maxX = -1;
let maxY = -1;
for (let y = 0; y < src.height; y += 1) {
  for (let x = 0; x < src.width; x += 1) {
    if (keyed[(y * src.width + x) * 4 + 3] > 16) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
}
if (maxX < 0) {
  console.error('Rien à garder : toute l’image a été considérée comme du fond.');
  process.exit(1);
}

const cropW = maxX - minX + 1;
const cropH = maxY - minY + 1;

// --- 3. Réduction (moyenne de boîte, alpha pondéré) -------------------------
const scale = Math.min(1, targetWidth / cropW);
const outW = Math.max(1, Math.round(cropW * scale));
const outH = Math.max(1, Math.round(cropH * scale));
const out = new PNG({ width: outW, height: outH });

for (let y = 0; y < outH; y += 1) {
  const y0 = minY + Math.floor((y * cropH) / outH);
  const y1 = minY + Math.max(y0 + 1 - minY, Math.floor(((y + 1) * cropH) / outH));
  for (let x = 0; x < outW; x += 1) {
    const x0 = minX + Math.floor((x * cropW) / outW);
    const x1 = minX + Math.max(x0 + 1 - minX, Math.floor(((x + 1) * cropW) / outW));

    let r = 0;
    let g = 0;
    let b = 0;
    let a = 0;
    let n = 0;
    for (let sy = y0; sy < y1 && sy < src.height; sy += 1) {
      for (let sx = x0; sx < x1 && sx < src.width; sx += 1) {
        const o = (sy * src.width + sx) * 4;
        const al = keyed[o + 3];
        // Couleurs pondérées par l'alpha, sinon les pixels transparents
        // délavent les bords du sujet.
        r += keyed[o] * al;
        g += keyed[o + 1] * al;
        b += keyed[o + 2] * al;
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
    } else {
      out.data[o] = 0;
      out.data[o + 1] = 0;
      out.data[o + 2] = 0;
      out.data[o + 3] = 0;
    }
  }
}

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, PNG.sync.write(out));

const before = fs.statSync(inputPath).size;
const after = fs.statSync(outputPath).size;
console.log(`source     : ${src.width}x${src.height}, ${(before / 1024).toFixed(0)} Ko`);
console.log(`recadrage  : ${cropW}x${cropH} (marges de fond retirées)`);
console.log(`sortie     : ${outW}x${outH}, ${(after / 1024).toFixed(0)} Ko -> ${outputPath}`);
