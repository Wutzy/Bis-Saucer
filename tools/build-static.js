'use strict';

/**
 * Construit une version consultable sans serveur, pour un hebergement statique
 * (GitHub Pages et compagnie).
 *
 *   npm run build:static
 *
 * L'app appelle 4 routes en lecture ; on les fige en fichiers JSON de meme forme,
 * et on marque la page en mode statique. Les deux routes en ecriture (scraper,
 * modifier le roster) n'ont pas d'equivalent : elles sont desactivees cote client,
 * ce qui est le bon compromis — la mise a jour se fait en local puis on republie.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'docs'); // GitHub Pages sait servir /docs sans CI

const { SPECS, specKey, guideUrl } = require(path.join(ROOT, 'src/specs'));
const { CLASSES } = require(path.join(ROOT, 'src/classes'));
const { readRoster } = require(path.join(ROOT, 'src/roster'));
const { readLoot } = require(path.join(ROOT, 'src/loot'));
const {
  readStore,
  readTrinkets,
  readWowhead,
  readPowerInfusion,
} = require(path.join(ROOT, 'src/store'));

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, entry.name);
    const dst = path.join(to, entry.name);
    if (entry.isDirectory()) copyDir(src, dst);
    else fs.copyFileSync(src, dst);
  }
}

fs.rmSync(OUT, { recursive: true, force: true });
copyDir(path.join(ROOT, 'public'), OUT);

// Marque la page comme statique, avant le chargement de app.js.
const indexPath = path.join(OUT, 'index.html');
let html = fs.readFileSync(indexPath, 'utf8');
html = html.replace(
  '<script src="app.js"></script>',
  '<script>window.BIS_STATIC = true;</script>\n    <script src="app.js"></script>'
);
fs.writeFileSync(indexPath, html, 'utf8');

// Les routes de lecture, figees.
const apiDir = path.join(OUT, 'api');
fs.mkdirSync(apiDir, { recursive: true });

const write = (name, data) => {
  const file = path.join(apiDir, name);
  fs.writeFileSync(file, JSON.stringify(data), 'utf8');
  return (fs.statSync(file).size / 1024).toFixed(0);
};

const sizes = {
  specs: write(
    'specs.json',
    SPECS.map((entry) => ({
      key: specKey(entry.class, entry.spec),
      class: entry.class,
      spec: entry.spec,
      label: entry.label,
      url: guideUrl(entry),
    }))
  ),
  roster: write('roster.json', { members: readRoster(), classes: CLASSES }),
  bis: write('bis.json', readStore()),
  trinkets: write('trinkets.json', readTrinkets()),
  wowhead: write('wowhead.json', readWowhead()),
  powerinfusion: write('powerinfusion.json', readPowerInfusion()),
  loot: write('loot.json', readLoot()),
};

// GitHub Pages passe le site dans Jekyll par defaut, qui ignore certains fichiers.
fs.writeFileSync(path.join(OUT, '.nojekyll'), '', 'utf8');

const store = readStore();
const specCount = Object.keys(store.specs || {}).length;
console.log(`docs/ prêt — ${specCount} spec(s) en cache`);
for (const [name, size] of Object.entries(sizes)) {
  console.log(`  api/${name}.json`.padEnd(22), `${size} Ko`);
}
console.log('\nÀ publier : commiter docs/ puis activer GitHub Pages sur la branche, dossier /docs.');
