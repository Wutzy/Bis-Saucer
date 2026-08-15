'use strict';

/**
 * Classement des bijoux par simulation, depuis Bloodmallet.
 *
 * C'est un point d'integration prevu par le site (leur script d'import public tape
 * la meme URL), pas du scraping de page :
 *   https://bloodmallet.com/chart/get/<type>/<style_de_combat>/<classe>/<spec>
 *
 * Deux pieges verifies sur l'API :
 *  - elle repond **HTTP 200 meme en erreur**, avec {"status": "error", ...} ;
 *  - toutes les specs ne sont pas simulees (aucun heal, et quelques DPS manquent
 *    selon les patchs). L'absence de donnees est un cas normal, pas une panne.
 */

const USER_AGENT =
  'GoldSaucer-GuildBiS/0.2 (outil interne de guilde, requete manuelle a la demande)';

const BASE = 'https://bloodmallet.com/chart/get';

// Bloodmallet simule le meme combat sur 1, 3 et 5 cibles. Les suffixes ont ete
// verifies contre l'API : castingpatchwerk / castingpatchwerk3 / castingpatchwerk5
// repondent, castingpatchwerk_3, patchwerk, hecticaddcleave et beastlord non.
const FIGHT_STYLES = [
  { targets: 1, style: 'castingpatchwerk' },
  { targets: 3, style: 'castingpatchwerk3' },
  { targets: 5, style: 'castingpatchwerk5' },
];
const FIGHT_STYLE = FIGHT_STYLES[0].style;

class TrinketError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'TrinketError';
    this.code = code || 'TRINKETS_FAILED';
  }
}

/** Nos slugs utilisent des tirets, ceux de Bloodmallet des underscores. */
function bloodmalletUrl(className, specSlug, style = FIGHT_STYLE) {
  const c = className.replace(/-/g, '_');
  const s = specSlug.replace(/-/g, '_');
  return `${BASE}/trinkets/${style}/${c}/${s}`;
}

async function fetchStyle(className, specSlug, style, timeoutMs = 20000) {
  const url = bloodmalletUrl(className, specSlug, style);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let payload;
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new TrinketError(`Bloodmallet a répondu ${res.status}`, 'BAD_STATUS');
    }
    payload = await res.json();
  } catch (err) {
    if (err instanceof TrinketError) throw err;
    if (err.name === 'AbortError') {
      throw new TrinketError(`Timeout après ${timeoutMs} ms`, 'TIMEOUT');
    }
    throw new TrinketError(`Échec de la requête (${err.message})`, 'NETWORK');
  } finally {
    clearTimeout(timer);
  }

  // Cas normal et frequent : cette spec n'est pas simulee.
  if (payload && payload.status === 'error') {
    return { url, available: false, reason: payload.message || 'Aucune donnée', trinkets: [] };
  }

  if (!payload || !payload.data || !Array.isArray(payload.sorted_data_keys)) {
    throw new TrinketError(
      "Réponse Bloodmallet inattendue (ni données, ni statut d'erreur).",
      'UNEXPECTED_STRUCTURE'
    );
  }

  const itemIds = payload.item_ids || {};
  const sources = payload.data_sources || {};
  // Bloodmallet livre les noms traduits : autant les prendre, ca evite de dependre
  // du renommage cote navigateur pour ces objets.
  const translations = payload.translations || {};

  const trinkets = payload.sorted_data_keys
    .filter((name) => name !== 'baseline')
    .map((name, index) => {
      const byIlvl = payload.data[name] || {};
      // On retient le meilleur ilvl simule pour ce bijou : c'est ce que le
      // classement de Bloodmallet utilise pour l'ordonner.
      const ilvls = Object.keys(byIlvl)
        .map(Number)
        .sort((a, b) => a - b);
      const bestIlvl = ilvls[ilvls.length - 1];
      return {
        rank: index + 1,
        name,
        nameFr: (translations[name] && translations[name].fr_FR) || null,
        itemId: Number(itemIds[name]) || null,
        source: sources[name] || null,
        ilvl: bestIlvl || null,
        dps: bestIlvl ? byIlvl[String(bestIlvl)] : null,
      };
    })
    .filter((t) => t.dps);

  const baselineRow = payload.data.baseline || {};
  const baselineIlvls = Object.keys(baselineRow).map(Number).sort((a, b) => a - b);

  return {
    url,
    available: trinkets.length > 0,
    trinkets,
    baseline: baselineIlvls.length ? baselineRow[String(baselineIlvls[0])] : null,
    fightStyle: (payload.simc_settings && payload.simc_settings.fight_style) || style,
    iterations: (payload.simc_settings && payload.simc_settings.iterations) || null,
    simc: (payload.metadata && payload.metadata.SimulationCraft) || null,
    simulatedAt: payload.timestamp || null,
  };
}

/**
 * Recupere les trois classements (1, 3 et 5 cibles) d'une spec.
 * Les requetes sont espacees et une categorie manquante n'empeche pas les autres.
 */
async function fetchTrinkets(className, specSlug, timeoutMs = 20000) {
  const targets = {};
  let available = false;

  for (const [index, { targets: count, style }] of FIGHT_STYLES.entries()) {
    if (index > 0) await new Promise((resolve) => setTimeout(resolve, 800));
    try {
      const data = await fetchStyle(className, specSlug, style, timeoutMs);
      targets[count] = data;
      if (data.available) available = true;
    } catch (err) {
      targets[count] = { style, available: false, reason: err.message, trinkets: [] };
    }
  }

  return { available, targets };
}

module.exports = {
  fetchTrinkets,
  fetchStyle,
  bloodmalletUrl,
  TrinketError,
  FIGHT_STYLE,
  FIGHT_STYLES,
};
