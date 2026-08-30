'use strict';

/**
 * Rapproche le roster de l'armurerie et met a jour les vignettes.
 *
 *   node tools/refresh-portraits.js              les entrees vieilles ou nouvelles
 *   node tools/refresh-portraits.js --force      tout le monde, meme le cache frais
 *   node tools/refresh-portraits.js --delay=800  espace davantage les requetes
 *   node tools/refresh-portraits.js --dry        rapproche sans rien ecrire
 *
 * Meme travail que le bouton de la vue Joueurs, sans passer par le serveur : c'est
 * ce script que la mise a jour automatique peut appeler.
 *
 * Il ne telecharge aucune image — seulement l'URL de rendu servie par Blizzard.
 * Les membres qu'on ne sait pas rapprocher sont listes en fin d'execution : leur
 * carte gardera l'icone de spec, et il suffit de leur poser un champ `armory`.
 */

const path = require('path');

const ROOT = path.join(__dirname, '..');
const { readRoster } = require(path.join(ROOT, 'src/roster'));
const { readPortraits, savePortraits } = require(path.join(ROOT, 'src/store'));
const { fetchPortraits } = require(path.join(ROOT, 'src/armory'));

const drapeau = (nom) => process.argv.includes(`--${nom}`);

function option(nom, defaut) {
  const arg = process.argv.find((a) => a.startsWith(`--${nom}=`));
  if (!arg) return defaut;
  const valeur = Number(arg.split('=')[1]);
  return Number.isFinite(valeur) ? valeur : defaut;
}

async function main() {
  const roster = readRoster();
  const precedent = readPortraits();

  const donnees = await fetchPortraits(roster, {
    precedent: precedent.members,
    maxAgeMs: drapeau('force') ? 0 : undefined,
    delayMs: option('delay', 400),
    log: (ligne) => console.log(ligne),
  });

  const trouves = Object.values(donnees.members).filter((m) => m.thumbnail).length;
  console.log(
    `\n${trouves}/${roster.length} portrait(s) — ${donnees.unmatched.length} membre(s) non rapproché(s)`
  );

  for (const rate of donnees.unmatched) {
    console.log(`  · ${rate.name} : ${rate.raison}`);
  }
  if (donnees.unmatched.length) {
    console.log(
      '\nPour trancher, ajoute le nom exact du personnage dans data/roster.json :\n' +
        '  { "name": "Solhan", "class": "paladin", "armory": "Soldun" }\n' +
        'ou saisis-le dans la colonne « Armurerie » de la vue Roster.'
    );
  }

  if (drapeau('dry')) {
    console.log('\n--dry : rien écrit.');
    return;
  }

  savePortraits(donnees);
  console.log('\ndata/portraits.json à jour.');
}

main().catch((err) => {
  console.error(`[armurerie] échec : ${err.message}`);
  process.exitCode = 1;
});
