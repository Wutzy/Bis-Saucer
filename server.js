'use strict';

const path = require('path');
const express = require('express');

const { SPECS, specKey, findSpec, guideUrl } = require('./src/specs');
const { CLASSES } = require('./src/classes');
const { readRoster, updateMember, addMember, removeMember } = require('./src/roster');
const { readLoot, addLoot, removeLoot } = require('./src/loot');
const {
  readStore,
  saveSpecEntry,
  readTrinkets,
  saveTrinketEntry,
  readWowhead,
  saveWowheadEntry,
  readPowerInfusion,
  savePowerInfusion,
} = require('./src/store');
const { scrapeGuide, ScrapeError } = require('./src/icyveins');
const { fetchTrinkets, fetchPowerInfusion } = require('./src/bloodmallet');
const { fetchTrinketTiers, fetchConsumables } = require('./src/wowhead');

const app = express();
const PORT = Number(process.env.PORT) || 3000;

// Anti-spam : une meme classe/spec ne peut pas etre re-scrapee plus souvent que ca.
// On ne fait AUCUN appel automatique a Icy Veins : uniquement sur clic explicite.
// `|| valeur_par_defaut` ne conviendrait pas : 0 est une valeur valide (desactive
// la limite, utile pour un rattrapage complet apres correction du parseur).
const rawInterval = Number(process.env.SCRAPE_MIN_INTERVAL_MS);
const MIN_INTERVAL_MS = Number.isFinite(rawInterval) && rawInterval >= 0
  ? rawInterval
  : 10 * 60 * 1000;

// Scrapes en cours, pour eviter deux requetes simultanees sur la meme spec.
const inFlight = new Set();

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

/** Liste des classes/specs supportees (alimente le selecteur du front). */
app.get('/api/specs', (req, res) => {
  res.json(
    SPECS.map((entry) => ({
      key: specKey(entry.class, entry.spec),
      class: entry.class,
      spec: entry.spec,
      label: entry.label,
      url: guideUrl(entry),
    }))
  );
});

/** Roster de la guilde + referentiel classes/specs (alimente l'onglet Roster). */
app.get('/api/roster', (req, res) => {
  res.json({ members: readRoster(), classes: CLASSES });
});

/**
 * Met a jour un membre. Body : { "spec": "fury" } ou { "spec": null } pour la spec,
 * { "raid": false } pour le sortir du roster mythique, { "trial": true } pour le
 * marquer a l'essai. Les champs peuvent etre combines.
 */
app.put('/api/roster/:id', (req, res) => {
  const body = req.body || {};
  const patch = {};

  if ('spec' in body) {
    if (body.spec !== null && typeof body.spec !== 'string') {
      return res.status(400).json({ error: 'Champ "spec" attendu (slug ou null).' });
    }
    patch.spec = body.spec;
  }
  for (const champ of ['raid', 'trial']) {
    if (!(champ in body)) continue;
    if (typeof body[champ] !== 'boolean') {
      return res.status(400).json({ error: `Champ "${champ}" attendu (booléen).` });
    }
    patch[champ] = body[champ];
  }
  if (!Object.keys(patch).length) {
    return res
      .status(400)
      .json({ error: 'Rien à modifier : "spec", "raid" ou "trial" attendu.' });
  }

  const member = updateMember(req.params.id, patch);
  if (!member) {
    return res.status(404).json({
      error: 'Membre inconnu, ou spec invalide pour sa classe.',
    });
  }
  res.json({ member });
});

/** Ajoute un membre. Body : { "name": "Toto", "class": "mage", "spec": "fire" }. */
app.post('/api/roster', (req, res) => {
  const body = req.body || {};
  const { member, error } = addMember({
    name: body.name,
    class: body.class,
    spec: body.spec,
    raid: body.raid,
    trial: body.trial,
  });
  if (error) return res.status(400).json({ error });
  res.status(201).json({ member });
});

/** Retire un membre du roster. */
app.delete('/api/roster/:id', (req, res) => {
  const member = removeMember(req.params.id);
  if (!member) return res.status(404).json({ error: 'Membre inconnu.' });
  res.json({ member });
});

/** Contenu actuel du cache (data/bis.json). Aucun appel reseau. */
app.get('/api/bis', (req, res) => {
  res.json(readStore());
});

/** Classements de bijoux simules (data/trinkets.json). Aucun appel reseau. */
app.get('/api/trinkets', (req, res) => {
  res.json(readTrinkets());
});

/** Tier lists de bijoux Wowhead (data/wowhead.json). Aucun appel reseau. */
app.get('/api/wowhead', (req, res) => {
  res.json(readWowhead());
});

/** Journal du butin (data/loot.json). Aucun appel reseau. */
app.get('/api/loot', (req, res) => {
  res.json(readLoot());
});

/** Note un objet recu par un membre. */
app.post('/api/loot', (req, res) => {
  const { entry, error } = addLoot(req.body || {});
  if (error) return res.status(400).json({ error });
  res.status(201).json({ entry });
});

/** Retire une ligne du journal : une saisie ratee doit pouvoir s'annuler. */
app.delete('/api/loot/:id', (req, res) => {
  const entry = removeLoot(req.params.id);
  if (!entry) return res.status(404).json({ error: 'Ligne inconnue.' });
  res.json({ entry });
});

/** Classement Power Infusion (data/powerinfusion.json). Aucun appel reseau. */
app.get('/api/powerinfusion', (req, res) => {
  res.json(readPowerInfusion());
});

/**
 * Le classement PI ne depend d'aucune spec : il n'a pas sa place dans la boucle de
 * scrape, mais il doit suivre les mises a jour. On le rafraichit au passage, et
 * seulement si celui en cache date de plus de 12 h — Bloodmallet ne le resimule
 * qu'une fois par jour, le retaper a chaque clic n'apporterait rien.
 */
const PI_MAX_AGE_MS = 12 * 60 * 60 * 1000;

async function rafraichirPowerInfusionSiVieux() {
  const cache = readPowerInfusion();
  const age = cache.updatedAt ? Date.now() - new Date(cache.updatedAt).getTime() : Infinity;
  if (age >= 0 && age < PI_MAX_AGE_MS) return;
  try {
    const classement = await fetchPowerInfusion();
    if (classement.available) savePowerInfusion(classement);
  } catch (err) {
    // Le classement PI est un bonus : son echec ne doit jamais faire echouer un scrape.
    console.warn(`[power-infusion] mise à jour ignorée (${err.message})`);
  }
}

/** Scrape a la demande d'une classe/spec. */
app.post('/api/scrape', async (req, res) => {
  const body = req.body || {};
  const entry = findSpec(body.class, body.spec);

  if (!entry) {
    return res.status(400).json({
      error: 'Classe/spec inconnue ou non supportée.',
      code: 'UNKNOWN_SPEC',
    });
  }

  const key = specKey(entry.class, entry.spec);
  const store = readStore();
  const cached = store.specs[key];

  if (cached && cached.scrapedAt) {
    const elapsed = Date.now() - new Date(cached.scrapedAt).getTime();
    if (elapsed >= 0 && elapsed < MIN_INTERVAL_MS) {
      const retryAfterSeconds = Math.ceil((MIN_INTERVAL_MS - elapsed) / 1000);
      res.set('Retry-After', String(retryAfterSeconds));
      return res.status(429).json({
        error: `Déjà rafraîchi il y a moins de ${Math.round(MIN_INTERVAL_MS / 60000)} min.`,
        code: 'RATE_LIMITED',
        retryAfterSeconds,
        entry: cached,
      });
    }
  }

  if (inFlight.has(key)) {
    return res.status(409).json({
      error: 'Un rafraîchissement est déjà en cours pour cette spec.',
      code: 'IN_FLIGHT',
    });
  }

  inFlight.add(key);
  const url = guideUrl(entry);

  try {
    const parsed = await scrapeGuide(url);
    const record = {
      key,
      class: entry.class,
      spec: entry.spec,
      label: entry.label,
      url,
      guideTitle: parsed.guideTitle,
      guideAuthor: parsed.guideAuthor,
      guideUpdated: parsed.guideUpdated,
      tableLabel: parsed.tableLabel,
      lists: parsed.lists,
      trinketAdvice: parsed.trinketAdvice,
      provider: 'icy-veins',
      scrapedAt: new Date().toISOString(),
      items: parsed.items,
    };
    saveSpecEntry(key, record);
    console.log(`[scrape] ${key} : ${record.items.length} slots depuis ${url}`);

    // Verification des bijoux par simulation. Volontairement non bloquante :
    // Bloodmallet ne couvre pas toutes les specs (aucun heal), et une panne de
    // leur cote ne doit pas faire echouer la mise a jour du BiS.
    let trinkets = null;
    try {
      const sim = await fetchTrinkets(entry.class, entry.spec);
      trinkets = { key, ...sim, fetchedAt: new Date().toISOString() };
      saveTrinketEntry(key, trinkets);
      // fetchTrinkets renvoie un classement par nombre de cibles, pas une liste plate.
      const compte = Object.entries(sim.targets)
        .filter(([, data]) => data.available)
        .map(([cibles, data]) => `${data.trinkets.length} à ${cibles} cible(s)`)
        .join(', ');
      console.log(`[bloodmallet] ${key} : ${sim.available ? compte : 'non simulé'}`);
    } catch (err) {
      console.warn(`[bloodmallet] ${key} indisponible : ${err.message}`);
    }

    // Guides Wowhead : tier list de bijoux et consommables. Non bloquants pour les
    // memes raisons que Bloodmallet — ce sont des complements, et une page qui change
    // de forme ne doit pas faire echouer la mise a jour du BiS.
    let wowhead = null;
    const partiel = { key, fetchedAt: new Date().toISOString() };

    try {
      partiel.trinkets = await fetchTrinketTiers(entry.class, entry.spec);
      const total = partiel.trinkets.tiers.reduce((s, t) => s + t.items.length, 0);
      console.log(
        `[wowhead] ${key} bijoux : ${
          partiel.trinkets.available
            ? `${partiel.trinkets.tiers.length} rangs, ${total} bijoux`
            : 'pas de tier list'
        }`
      );
    } catch (err) {
      console.warn(`[wowhead] ${key} bijoux indisponibles : ${err.message}`);
    }

    try {
      partiel.consumables = await fetchConsumables(entry.class, entry.spec, entry.role);
      console.log(
        `[wowhead] ${key} conso : ${
          partiel.consumables.available
            ? `${partiel.consumables.rows.length} ligne(s)`
            : 'pas de tableau'
        }`
      );
    } catch (err) {
      console.warn(`[wowhead] ${key} conso indisponibles : ${err.message}`);
    }

    if (partiel.trinkets || partiel.consumables) {
      wowhead = partiel;
      saveWowheadEntry(key, wowhead);
    }

    // Le classement Power Infusion ne depend d'aucune spec, mais mettre a jour, c'est
    // tout mettre a jour : on le rafraichit ici aussi, s'il a vieilli.
    await rafraichirPowerInfusionSiVieux();

    return res.json({ entry: record, trinkets, wowhead });
  } catch (err) {
    const isScrapeError = err instanceof ScrapeError;
    console.error(`[scrape] echec ${key} : ${err.message}`);
    return res.status(isScrapeError ? 502 : 500).json({
      error: isScrapeError
        ? err.message
        : `Erreur inattendue pendant le scrape : ${err.message}`,
      code: isScrapeError ? err.code : 'INTERNAL',
      // On renvoie le cache existant pour que le front puisse rester affichable.
      entry: cached || null,
    });
  } finally {
    inFlight.delete(key);
  }
});

app.listen(PORT, () => {
  console.log(`GoldSaucer BiS : http://localhost:${PORT}`);
  console.log(
    `Intervalle mini entre deux scrapes d'une meme spec : ${Math.round(
      MIN_INTERVAL_MS / 60000
    )} min`
  );
});
