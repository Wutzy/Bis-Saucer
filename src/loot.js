'use strict';

/**
 * Journal du butin : qui a recu quoi, et quand.
 *
 * C'est le seul jeu de donnees de l'application que personne ne scrape — il est saisi
 * a la main apres un raid ou une cle. Il ne se recalcule pas : perdre ce fichier, c'est
 * perdre l'historique, d'ou l'ecriture atomique comme pour le roster.
 *
 * Une entree est volontairement plate et autonome (nom, icone, source recopies au
 * moment de la saisie) : le butin de mardi ne doit pas changer d'affichage parce qu'une
 * liste BiS a ete rescrapee depuis, ni disparaitre parce qu'un membre a quitte le roster.
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const LOOT_PATH = path.join(DATA_DIR, 'loot.json');

function readLoot() {
  try {
    const parsed = JSON.parse(fs.readFileSync(LOOT_PATH, 'utf8'));
    if (parsed && Array.isArray(parsed.entries)) return parsed;
  } catch (err) {
    if (err.code !== 'ENOENT') {
      console.warn(`[loot] data/loot.json illisible (${err.message}), journal vide utilisé.`);
    }
  }
  return { version: 1, entries: [] };
}

function writeLoot(entries) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmpPath = `${LOOT_PATH}.tmp`;
  const payload = { version: 1, updatedAt: new Date().toISOString(), entries };
  fs.writeFileSync(tmpPath, JSON.stringify(payload, null, 2), 'utf8');
  fs.renameSync(tmpPath, LOOT_PATH);
}

/** Identifiant d'entree : horodatage + suffixe, pour ne jamais collisionner. */
function nextId(entries) {
  const base = `l${Date.now().toString(36)}`;
  if (!entries.some((e) => e.id === base)) return base;
  let i = 2;
  while (entries.some((e) => e.id === `${base}-${i}`)) i += 1;
  return `${base}-${i}`;
}

const texte = (valeur, max) => String(valeur == null ? '' : valeur).trim().slice(0, max);

/**
 * Ajoute une entree. Le membre et le nom de l'objet sont les seuls champs obligatoires :
 * on prefere une ligne incomplete a un butin non note. Renvoie { entry } ou { error }.
 */
function addLoot(patch) {
  const memberId = texte(patch.memberId, 80);
  const name = texte(patch.name, 120);
  if (!memberId) return { error: 'Membre manquant.' };
  if (!name) return { error: "Nom de l'objet manquant." };

  // Une date fournie est prise telle quelle si elle est valide (butin saisi apres coup),
  // sinon on horodate maintenant.
  const date = /^\d{4}-\d{2}-\d{2}$/.test(texte(patch.date, 10))
    ? texte(patch.date, 10)
    : new Date().toISOString().slice(0, 10);

  const entry = {
    id: '',
    memberId,
    name,
    nameFr: texte(patch.nameFr, 120) || null,
    itemId: Number.isFinite(Number(patch.itemId)) && Number(patch.itemId) > 0 ? Number(patch.itemId) : null,
    icon: texte(patch.icon, 120) || null,
    slot: texte(patch.slot, 60) || null,
    source: texte(patch.source, 120) || null,
    // `bis` dit que l'objet figure dans la liste BiS de la spec du membre au moment de
    // la saisie. C'est l'information qui rend le journal utile en conseil de butin.
    bis: Boolean(patch.bis),
    date,
    note: texte(patch.note, 200) || null,
  };

  const store = readLoot();
  entry.id = nextId(store.entries);
  const entries = [...store.entries, entry];
  writeLoot(entries);
  return { entry };
}

function removeLoot(id) {
  const store = readLoot();
  const entry = store.entries.find((e) => e.id === id);
  if (!entry) return null;
  writeLoot(store.entries.filter((e) => e.id !== id));
  return entry;
}

module.exports = { readLoot, addLoot, removeLoot, LOOT_PATH };
