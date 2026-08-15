'use strict';

const fs = require('fs');
const path = require('path');

const { CLASSES, specInfo } = require('./classes');

const DATA_DIR = path.join(__dirname, '..', 'data');
const ROSTER_PATH = path.join(DATA_DIR, 'roster.json');

/**
 * Roster de depart de la guilde. Le numero est celui de la liste d'origine.
 * `spec: null` = spec pas encore renseignee : le membre est affiche, mais aucune
 * page Wowhead ne lui est associee tant que la spec n'est pas choisie dans l'onglet
 * Roster (ou directement ici).
 */
const DEFAULT_ROSTER = [
  { n: 1, name: 'Wutz', class: 'mage', spec: 'fire' },
  { n: 2, name: 'Ryïms', class: 'death-knight', spec: 'frost' },
  // Star de la guilde : `star` la met en avant partout dans l'interface, et `portrait`
  // designe son illustration detouree dans public/img/.
  {
    n: 3,
    name: 'Bolderiz (Franky)',
    class: 'monk',
    spec: 'windwalker',
    star: true,
    portrait: 'bolderiz.png',
  },
  { n: 4, name: 'lafrustré / elzoska', class: 'paladin', spec: 'retribution' },
  { n: 5, name: 'Kronox', class: 'warlock', spec: 'affliction' },
  { n: 6, name: 'Elgior', class: 'warrior', spec: 'arms' },
  { n: 7, name: 'Solhan', class: 'paladin', spec: 'protection' },
  { n: 8, name: 'Kiyohara', class: 'priest', spec: 'shadow' },
  { n: 9, name: 'Sam', class: 'shaman', spec: 'elemental' },
  { n: 10, name: 'Maowar / Leberger', class: 'warrior', spec: 'arms' },
  { n: 11, name: 'Kao', class: 'death-knight', spec: 'blood' },
  { n: 12, name: 'Xaly', class: 'shaman', spec: 'restoration' },
  { n: 13, name: 'projectbabytattoo', class: 'priest', spec: 'discipline' },
  { n: 14, name: 'Ragelolz', class: 'demon-hunter', spec: 'havoc' },
  { n: 15, name: 'Fólkvangr', class: 'paladin', spec: 'holy' },
  { n: 16, name: 'Ganaï', class: 'druid', spec: 'restoration' },
  { n: 17, name: 'Ezra', class: 'druid', spec: 'balance' },
  { n: 18, name: 'Echodoll', class: 'paladin', spec: 'holy' },
  { n: 19, name: 'Ganôva', class: 'hunter', spec: 'beast-mastery' },
  { n: 20, name: 'Reinox93', class: 'rogue', spec: 'subtlety' },
];

// Accents combinants laisses par normalize('NFD') : Fólkvangr -> folkvangr.
const COMBINING_MARKS = /[̀-ͯ]/g;

function slugify(name) {
  return name
    .normalize('NFD')
    .replace(COMBINING_MARKS, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function withIds(members) {
  return members.map((m) => ({ ...m, id: m.id || slugify(m.name) }));
}

function readRoster() {
  try {
    const parsed = JSON.parse(fs.readFileSync(ROSTER_PATH, 'utf8'));
    if (Array.isArray(parsed.members)) return withIds(parsed.members);
  } catch (err) {
    if (err.code !== 'ENOENT') {
      console.warn(`[roster] data/roster.json illisible (${err.message}), roster par defaut utilise.`);
    }
  }
  return withIds(DEFAULT_ROSTER);
}

function writeRoster(members) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmpPath = `${ROSTER_PATH}.tmp`;
  const payload = { version: 1, updatedAt: new Date().toISOString(), members };
  fs.writeFileSync(tmpPath, JSON.stringify(payload, null, 2), 'utf8');
  fs.renameSync(tmpPath, ROSTER_PATH);
}

/**
 * Change la spec d'un membre. `spec` peut valoir null pour remettre a "non renseignee".
 * Renvoie le membre mis a jour, ou null si l'id est inconnu / la spec invalide pour la classe.
 */
function setMemberSpec(id, spec) {
  const members = readRoster();
  const member = members.find((m) => m.id === id);
  if (!member) return null;
  if (spec !== null && !specInfo(member.class, spec)) return null;

  member.spec = spec;
  writeRoster(members);
  return member;
}

/** Specs effectivement jouees dans le roster, avec les membres correspondants. */
function rosterSpecs(members) {
  const map = new Map();
  for (const member of members) {
    if (!member.spec) continue;
    const key = `${member.class}-${member.spec}`;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(member.name);
  }
  return map;
}

module.exports = {
  DEFAULT_ROSTER,
  CLASSES,
  readRoster,
  writeRoster,
  setMemberSpec,
  rosterSpecs,
  ROSTER_PATH,
};
