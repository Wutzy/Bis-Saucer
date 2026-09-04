'use strict';

/**
 * Prépare les images d'un numéro de la gazette : recadre une zone de l'affiche
 * d'origine, réduit, et enregistre en niveaux de gris.
 *
 * Un découpage, pour illustrer un numéro écrit en HTML :
 *
 *   node tools/gazette-portrait.js NewzSaucer/Woryms+15.png public/img/gazette/avis-recherche-01.png 38 549 477 561
 *
 * L'affiche entière, pour un numéro publié tel quel — pleine définition pour la loupe,
 * puis une vignette allégée pour la page :
 *
 *   node tools/gazette-portrait.js NewzSaucer/Woryms+15.png public/img/gazette/affiche-01.png 0 0 1024 1536
 *   node tools/gazette-portrait.js NewzSaucer/Woryms+15.png public/img/gazette/affiche-01-vignette.png 0 0 1024 1536 560
 *
 * Pourquoi les niveaux de gris : une affiche de journal est une sépia, c'est-à-dire un
 * gris teinté — mesuré sur celle du numéro 1, ses canaux valent (1,123 · 0,987 · 0,767)
 * fois la luminance, à 2/255 près. Trois canaux qui se déduisent l'un de l'autre
 * pèseraient le triple (3 449 Ko contre 1 175) sans rien montrer de plus : on stocke la
 * luminance, et la page rejoue la teinte avec `brightness(0.82) sepia(1)`. Les
 * découpages, eux, sont désaturés par la page de toute façon.
 *
 * Outil ponctuel : le PNG recadré est le livrable, le script n'est pas appelé au
 * runtime. Sa seule dépendance, `pngjs`, est en `devDependencies`.
 */

const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');

const [, , inputPath, outputPath, xArg, yArg, wArg, hArg, widthArg] = process.argv;
if (!inputPath || !outputPath || xArg === undefined) {
  console.error(
    'usage: node tools/gazette-portrait.js <affiche.png> <sortie.png> <x> <y> <largeur> <hauteur> [largeurCible]'
  );
  process.exit(1);
}

const src = PNG.sync.read(fs.readFileSync(inputPath));

const cropX = Math.max(0, Number(xArg) || 0);
const cropY = Math.max(0, Number(yArg) || 0);
const cropW = Math.min(Number(wArg) || src.width, src.width - cropX);
const cropH = Math.min(Number(hArg) || src.height, src.height - cropY);
if (cropW <= 0 || cropH <= 0) {
  console.error('Recadrage vide : vérifie x, y, largeur et hauteur.');
  process.exit(1);
}

// Sans largeur cible on garde la définition d'origine : le portrait est déjà petit
// dans l'affiche, le réduire encore l'abîmerait pour quelques kilo-octets.
const targetWidth = Number(widthArg) || cropW;
const scale = Math.min(1, targetWidth / cropW);
const outW = Math.max(1, Math.round(cropW * scale));
const outH = Math.max(1, Math.round(cropH * scale));

/** Luminance perçue : la même pondération que le filtre `grayscale` du navigateur. */
function gris(o) {
  return 0.2126 * src.data[o] + 0.7152 * src.data[o + 1] + 0.0722 * src.data[o + 2];
}

// Réduction par moyenne de boîte, comme dans `chroma-key.js` : chaque pixel de sortie
// est la moyenne du rectangle de source qu'il recouvre, ce qui évite l'escalier d'un
// simple échantillonnage.
const data = Buffer.alloc(outW * outH);
for (let y = 0; y < outH; y += 1) {
  const y0 = cropY + Math.floor((y * cropH) / outH);
  const y1 = cropY + Math.max(y0 + 1 - cropY, Math.floor(((y + 1) * cropH) / outH));
  for (let x = 0; x < outW; x += 1) {
    const x0 = cropX + Math.floor((x * cropW) / outW);
    const x1 = cropX + Math.max(x0 + 1 - cropX, Math.floor(((x + 1) * cropW) / outW));

    let somme = 0;
    let n = 0;
    for (let sy = y0; sy < y1 && sy < src.height; sy += 1) {
      for (let sx = x0; sx < x1 && sx < src.width; sx += 1) {
        somme += gris((sy * src.width + sx) * 4);
        n += 1;
      }
    }
    data[y * outW + x] = n ? Math.round(somme / n) : 0;
  }
}

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(
  outputPath,
  PNG.sync.write({ width: outW, height: outH, data }, { colorType: 0, inputColorType: 0 })
);

const avant = fs.statSync(inputPath).size;
const apres = fs.statSync(outputPath).size;
console.log(`affiche    : ${src.width}x${src.height}, ${(avant / 1024).toFixed(0)} Ko`);
console.log(`recadrage  : ${cropW}x${cropH} à partir de (${cropX}, ${cropY})`);
console.log(`sortie     : ${outW}x${outH}, ${(apres / 1024).toFixed(0)} Ko -> ${outputPath}`);
