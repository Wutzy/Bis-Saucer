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

/**
 * Normalise un membre lu du disque.
 *
 * `raid` dit s'il fait partie du ROSTER MYTHIQUE, c'est-a-dire de l'equipe qui va en
 * raid. Un membre a `false` reste un membre a part entiere — il compte pour tout le
 * Mythique+ — mais il est ignore partout ou l'on parle de butin de raid.
 * Absent = `true` : les rosters ecrits avant l'ajout du champ gardent leur sens.
 *
 * `trial` dit qu'il est EN TEST. Contrairement a `raid`, ce statut ne filtre rien : un
 * joueur en test raid et roule comme les autres, c'est bien l'interet d'un essai. Il est
 * seulement signale, pour qu'on sache a qui on a affaire au moment d'arbitrer.
 * Absent = `false` : un membre sans mention n'est pas a l'essai.
 *
 * `armory` nomme le PERSONNAGE a l'armurerie, quand le pseudo de la guilde ne suffit
 * pas a le retrouver (surnom, double compte, reroll homonyme). Trois ecritures sont
 * acceptees : 'Wutzwutz', 'Wutzwutz-Hyjal', 'eu/hyjal/Wutzwutz'. Absent : le
 * rapprochement automatique s'en charge, ou renonce (voir src/armory.js).
 */
function withIds(members) {
  return members.map((m) => ({
    ...m,
    id: m.id || slugify(m.name),
    raid: m.raid !== false,
    trial: m.trial === true,
  }));
}

/** Id unique : deux "Sam" ne peuvent pas partager la meme clef. */
function uniqueId(base, members) {
  const racine = base || 'membre';
  if (!members.some((m) => m.id === racine)) return racine;
  let i = 2;
  while (members.some((m) => m.id === `${racine}-${i}`)) i += 1;
  return `${racine}-${i}`;
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
 * Met a jour un membre. `spec` peut valoir null pour remettre a "non renseignee",
 * `raid` dit s'il est dans le roster mythique, `trial` s'il est a l'essai. Les champs
 * absents ne sont pas touches.
 * Renvoie le membre mis a jour, ou null si l'id est inconnu / la spec invalide pour la classe.
 */
function updateMember(id, patch) {
  const members = readRoster();
  const member = members.find((m) => m.id === id);
  if (!member) return null;

  if ('spec' in patch) {
    if (patch.spec !== null && !specInfo(member.class, patch.spec)) return null;
    member.spec = patch.spec;
  }
  if ('raid' in patch) member.raid = Boolean(patch.raid);
  if ('trial' in patch) member.trial = Boolean(patch.trial);
  if ('armory' in patch) {
    // Champ vide = on retire la correction et on repasse au rapprochement automatique.
    const personnage = typeof patch.armory === 'string' ? patch.armory.trim() : '';
    if (personnage) member.armory = personnage;
    else delete member.armory;
  }

  writeRoster(members);
  return member;
}

/** Compatibilite : ancienne signature, un seul champ. */
function setMemberSpec(id, spec) {
  return updateMember(id, { spec });
}

/**
 * Ajoute un membre. Renvoie { member } ou { error } : le nom doit etre non vide et
 * inedit, la classe connue, et la spec valide pour cette classe (ou absente).
 */
function addMember({ name, class: className, spec, raid, trial }) {
  const nom = typeof name === 'string' ? name.trim() : '';
  if (!nom) return { error: 'Un pseudo est nécessaire.' };
  if (nom.length > 40) return { error: 'Pseudo trop long (40 caractères maximum).' };
  if (!CLASSES[className]) return { error: 'Classe inconnue.' };

  const specSlug = spec || null;
  if (specSlug !== null && !specInfo(className, specSlug)) {
    return { error: 'Spec invalide pour cette classe.' };
  }

  const members = readRoster();
  if (members.some((m) => m.name.toLowerCase() === nom.toLowerCase())) {
    return { error: 'Ce pseudo est déjà dans le roster.' };
  }

  const member = {
    // Le numero prolonge la liste d'origine de la guilde, il ne comble pas les trous :
    // il sert a garder l'ordre d'arrivee, pas a numeroter les places.
    n: members.reduce((max, m) => Math.max(max, Number(m.n) || 0), 0) + 1,
    name: nom,
    class: className,
    spec: specSlug,
    raid: raid !== false,
    trial: trial === true,
    id: uniqueId(slugify(nom), members),
  };

  members.push(member);
  writeRoster(members);
  return { member };
}

/** Retire un membre. Renvoie le membre supprime, ou null si l'id est inconnu. */
function removeMember(id) {
  const members = readRoster();
  const index = members.findIndex((m) => m.id === id);
  if (index === -1) return null;
  const [member] = members.splice(index, 1);
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
  updateMember,
  setMemberSpec,
  addMember,
  removeMember,
  rosterSpecs,
  ROSTER_PATH,
};
