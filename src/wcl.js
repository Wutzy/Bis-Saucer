'use strict';

/**
 * Parses Warcraft Logs : le percentile de chaque membre sur le raid en cours.
 *
 * Rien n'est scrape ici. Warcraft Logs renvoie tout visiteur automatise vers sa page
 * de verification anti-bot, et son API v2 demande des identifiants OAuth que chacun
 * devrait creer de son cote — comme l'armurerie de Blizzard, en pire, puisque la
 * verification bloque aussi la simple lecture d'une fiche.
 *
 * Le releve est donc ecrit a la main dans data/wcl.json, sur le modele de la gazette :
 * un fichier qu'on met a jour quand on le decide, pas une source qui se rafraichit
 * toute seule. Le bouton « Mettre a jour » de l'application ne le touche pas.
 *
 * Une entree est indexee par l'`id` du membre du roster, jamais par son nom de
 * personnage : c'est le roster qui porte le pseudo, la classe et la spec, et les
 * recopier ici les ferait diverger des le premier changement de main. Le fichier ne
 * garde que ce que le roster ne sait pas — le personnage effectivement logge, son
 * royaume, la metrique retenue et les trois chiffres.
 *
 * `best` et `median` valent `null` pour un membre sans aucun parse : c'est une
 * information, pas une absence de donnee, et le front l'affiche comme telle.
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const WCL_PATH = path.join(DATA_DIR, 'wcl.json');

const VIDE = { version: 1, members: {} };

function readWcl() {
  try {
    const parsed = JSON.parse(fs.readFileSync(WCL_PATH, 'utf8'));
    if (parsed && typeof parsed.members === 'object' && parsed.members) return parsed;
  } catch (err) {
    if (err.code !== 'ENOENT') {
      console.warn(`[wcl] data/wcl.json illisible (${err.message}), aucun parse affiché.`);
    }
  }
  return VIDE;
}

module.exports = { readWcl, WCL_PATH };
