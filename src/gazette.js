'use strict';

/**
 * News Saucer : les numeros de la gazette de guilde.
 *
 * Rien n'est scrape ici, et rien ne se recalcule : un numero est ecrit a la main dans
 * data/gazette.json, comme le roster de depart. C'est volontairement en lecture seule
 * cote application — un article se relit, se corrige, se date, et ces gestes-la sont
 * ceux d'un fichier qu'on edite, pas d'un formulaire.
 *
 * Une entree est autonome : elle recopie son titre, ses encadres et son illustration
 * plutot que de les deduire des donnees du moment. Un numero de septembre ne doit pas
 * changer de contenu parce que le roster a bouge depuis.
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const GAZETTE_PATH = path.join(DATA_DIR, 'gazette.json');

function readGazette() {
  try {
    const parsed = JSON.parse(fs.readFileSync(GAZETTE_PATH, 'utf8'));
    if (parsed && Array.isArray(parsed.articles)) return parsed;
  } catch (err) {
    if (err.code !== 'ENOENT') {
      console.warn(`[gazette] data/gazette.json illisible (${err.message}), aucun numéro affiché.`);
    }
  }
  return { version: 1, articles: [] };
}

module.exports = { readGazette, GAZETTE_PATH };
