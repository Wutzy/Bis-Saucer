'use strict';

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const STORE_PATH = path.join(DATA_DIR, 'bis.json');
const TRINKETS_PATH = path.join(DATA_DIR, 'trinkets.json');
const WOWHEAD_PATH = path.join(DATA_DIR, 'wowhead.json');
const POWER_INFUSION_PATH = path.join(DATA_DIR, 'powerinfusion.json');

const EMPTY_STORE = { version: 1, specs: {} };

function readStore() {
  try {
    const raw = fs.readFileSync(STORE_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || typeof parsed.specs !== 'object') {
      return { ...EMPTY_STORE, specs: {} };
    }
    return parsed;
  } catch (err) {
    // Fichier absent au premier lancement, ou JSON corrompu : on repart d'un cache vide
    // plutot que de faire tomber le serveur.
    if (err.code !== 'ENOENT') {
      console.warn(`[store] data/bis.json illisible (${err.message}), cache reinitialise en memoire.`);
    }
    return { ...EMPTY_STORE, specs: {} };
  }
}

/** Ecriture atomique : on ecrit un .tmp puis on renomme, pour ne jamais laisser un JSON tronque. */
function writeStore(store) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmpPath = `${STORE_PATH}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(store, null, 2), 'utf8');
  fs.renameSync(tmpPath, STORE_PATH);
}

function saveSpecEntry(key, entry) {
  const store = readStore();
  store.specs[key] = entry;
  store.updatedAt = new Date().toISOString();
  writeStore(store);
  return store;
}

/* ------------------------------------------------------------------ */
/* Classements de bijoux (Bloodmallet), meme mecanique, fichier separe  */
/* ------------------------------------------------------------------ */

function readTrinkets() {
  try {
    const parsed = JSON.parse(fs.readFileSync(TRINKETS_PATH, 'utf8'));
    if (parsed && typeof parsed.specs === 'object') return parsed;
  } catch (err) {
    if (err.code !== 'ENOENT') {
      console.warn(`[store] data/trinkets.json illisible (${err.message}), cache ignoré.`);
    }
  }
  return { version: 1, specs: {} };
}

function saveTrinketEntry(key, entry) {
  const store = readTrinkets();
  store.specs[key] = entry;
  store.updatedAt = new Date().toISOString();

  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmpPath = `${TRINKETS_PATH}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(store, null, 2), 'utf8');
  fs.renameSync(tmpPath, TRINKETS_PATH);
  return store;
}

/* ------------------------------------------------------------------ */
/* Tier lists de bijoux (Wowhead), meme mecanique, fichier separe       */
/* ------------------------------------------------------------------ */

function readWowhead() {
  try {
    const parsed = JSON.parse(fs.readFileSync(WOWHEAD_PATH, 'utf8'));
    if (parsed && typeof parsed.specs === 'object') return parsed;
  } catch (err) {
    if (err.code !== 'ENOENT') {
      console.warn(`[store] data/wowhead.json illisible (${err.message}), cache ignoré.`);
    }
  }
  return { version: 1, specs: {} };
}

function saveWowheadEntry(key, entry) {
  const store = readWowhead();
  store.specs[key] = entry;
  store.updatedAt = new Date().toISOString();

  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmpPath = `${WOWHEAD_PATH}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(store, null, 2), 'utf8');
  fs.renameSync(tmpPath, WOWHEAD_PATH);
  return store;
}

/* ------------------------------------------------------------------ */
/* Power Infusion : un classement unique, pas un cache par spec         */
/* ------------------------------------------------------------------ */

/**
 * Contrairement aux trois autres, ce fichier n'a pas de `specs` : le classement
 * Power Infusion compare toutes les specs entre elles, il n'appartient a aucune.
 * D'ou un objet unique, remplace en entier a chaque mise a jour.
 */
function readPowerInfusion() {
  try {
    const parsed = JSON.parse(fs.readFileSync(POWER_INFUSION_PATH, 'utf8'));
    if (parsed && typeof parsed === 'object' && parsed.targets) return parsed;
  } catch (err) {
    if (err.code !== 'ENOENT') {
      console.warn(`[store] data/powerinfusion.json illisible (${err.message}), cache ignoré.`);
    }
  }
  return { version: 1, available: false, targets: {} };
}

function savePowerInfusion(donnees) {
  const store = { version: 1, ...donnees, updatedAt: new Date().toISOString() };
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmpPath = `${POWER_INFUSION_PATH}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(store, null, 2), 'utf8');
  fs.renameSync(tmpPath, POWER_INFUSION_PATH);
  return store;
}

module.exports = {
  readStore,
  writeStore,
  saveSpecEntry,
  readTrinkets,
  saveTrinketEntry,
  readWowhead,
  saveWowheadEntry,
  readPowerInfusion,
  savePowerInfusion,
  STORE_PATH,
  TRINKETS_PATH,
  WOWHEAD_PATH,
  POWER_INFUSION_PATH,
};
