'use strict';

const path = require('path');
const express = require('express');

const { SPECS, specKey, findSpec, guideUrl } = require('./src/specs');
const { CLASSES } = require('./src/classes');
const { readRoster, setMemberSpec } = require('./src/roster');
const { readStore, saveSpecEntry, readTrinkets, saveTrinketEntry } = require('./src/store');
const { scrapeGuide, ScrapeError } = require('./src/icyveins');
const { fetchTrinkets } = require('./src/bloodmallet');

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

/** Renseigne (ou efface) la spec d'un membre. Body : { "spec": "fury" } ou { "spec": null }. */
app.put('/api/roster/:id', (req, res) => {
  const spec = req.body && 'spec' in req.body ? req.body.spec : undefined;
  if (spec !== null && typeof spec !== 'string') {
    return res.status(400).json({ error: 'Champ "spec" attendu (slug ou null).' });
  }

  const member = setMemberSpec(req.params.id, spec);
  if (!member) {
    return res.status(404).json({
      error: 'Membre inconnu, ou spec invalide pour sa classe.',
    });
  }
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
      console.log(
        `[bloodmallet] ${key} : ${
          sim.available ? `${sim.trinkets.length} bijoux classés` : 'non simulé'
        }`
      );
    } catch (err) {
      console.warn(`[bloodmallet] ${key} indisponible : ${err.message}`);
    }

    return res.json({ entry: record, trinkets });
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
