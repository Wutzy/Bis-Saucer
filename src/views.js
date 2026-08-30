'use strict';

/**
 * Compteur de consultations : combien de fois chaque spec a ete ouverte.
 *
 * On compte par SPEC, pas par classe : la classe s'obtient en additionnant ses specs,
 * l'inverse est impossible. C'est la meme raison qui fait stocker le detail plutot que
 * le total partout ailleurs dans l'application.
 *
 * Portee : ce fichier n'enregistre que ce qui est consulte SUR CETTE INSTANCE. La
 * version publiee sur GitHub Pages n'a pas de serveur pour ecrire — elle affiche les
 * compteurs, elle ne les incremente pas.
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const VIEWS_PATH = path.join(DATA_DIR, 'views.json');

function readViews() {
  try {
    const parsed = JSON.parse(fs.readFileSync(VIEWS_PATH, 'utf8'));
    if (parsed && typeof parsed.specs === 'object' && parsed.specs) return parsed;
  } catch (err) {
    if (err.code !== 'ENOENT') {
      console.warn(`[views] data/views.json illisible (${err.message}), compteurs repartis de zéro.`);
    }
  }
  return { version: 1, specs: {} };
}

function writeViews(store) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmpPath = `${VIEWS_PATH}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(store, null, 2), 'utf8');
  fs.renameSync(tmpPath, VIEWS_PATH);
}

/**
 * Incremente une spec. `key` doit avoir ete validee par l'appelant contre la liste
 * blanche : on ne cree pas de compteur pour une cle inventee, sinon n'importe quelle
 * requete peut faire grossir le fichier.
 */
function bumpView(key) {
  const store = readViews();
  const courant = store.specs[key] || { count: 0, lastAt: null };
  const entree = { count: courant.count + 1, lastAt: new Date().toISOString() };
  store.specs[key] = entree;
  store.updatedAt = entree.lastAt;
  writeViews(store);
  return entree;
}

module.exports = { readViews, bumpView, VIEWS_PATH };
