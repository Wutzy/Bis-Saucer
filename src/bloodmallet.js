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

/* ------------------------------------------------------------------ */
/* Power Infusion : quelle spec profite le plus du buff du pretre       */
/* ------------------------------------------------------------------ */

/**
 * Bloodmallet publie un classement Power Infusion sous le profil du pretre ombre :
 *   https://bloodmallet.com/chart/get/power_infusion/<style>/priest/shadow
 * Ce n'est pas une donnee par spec — c'est un tableau unique qui compare toutes les
 * specs entre elles, qu'on lit pour les trois nombres de cibles.
 *
 * Trois choses a savoir sur ce jeu de donnees, verifiees dans leur script d'import
 * public (`bloodmallet_chart_import.js`) :
 *
 *  - `data` contient DEUX entrees par spec : "Fire Mage" (avec PI) et "{Fire Mage}"
 *    (sans). Le gain est la difference ; la valeur brute seule ne veut rien dire.
 *  - `sorted_data_keys_2` range par gain ABSOLU, `sorted_data_keys` par gain RELATIF.
 *    Le site affiche l'absolu par defaut, on garde le meme ordre pour ne pas dire
 *    autre chose que la source.
 *  - `profile_without_pi_support` liste les specs dont la rotation simulee ne sait pas
 *    recevoir un PI externe : leur chiffre vient d'un PI a heure fixe, il est indicatif.
 */
const PI_SPEC = { class: 'priest', spec: 'shadow' };

function powerInfusionUrl(style) {
  return `${BASE}/power_infusion/${style}/${PI_SPEC.class}/${PI_SPEC.spec}`;
}

/** "Beast_Mastery Hunter" -> { class: 'hunter', spec: 'beast-mastery' }. */
function parseSpecName(nom) {
  const morceaux = String(nom || '').trim().split(/\s+/);
  if (morceaux.length < 2) return null;
  const [spec, ...classe] = morceaux;
  return {
    class: classe.join('-').toLowerCase(),
    spec: spec.replace(/_/g, '-').toLowerCase(),
  };
}

async function fetchPowerInfusionStyle(style, top, timeoutMs) {
  const url = powerInfusionUrl(style);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let payload;
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      signal: controller.signal,
    });
    if (!res.ok) throw new TrinketError(`Bloodmallet a répondu ${res.status}`, 'BAD_STATUS');
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

  if (payload && payload.status === 'error') {
    return { style, url, available: false, reason: payload.message || 'Aucune donnée', top: [] };
  }
  if (!payload || !payload.data || !Array.isArray(payload.sorted_data_keys_2)) {
    throw new TrinketError(
      "Réponse Power Infusion inattendue (ni données, ni statut d'erreur).",
      'UNEXPECTED_STRUCTURE'
    );
  }

  const sansSupport = new Set(payload.profile_without_pi_support || []);
  const entrees = [];
  for (const nom of payload.sorted_data_keys_2) {
    const avec = payload.data[nom];
    const sans = payload.data[`{${nom}}`];
    if (!Number.isFinite(avec) || !Number.isFinite(sans) || sans <= 0) continue;
    const gain = Math.round(avec - sans);
    entrees.push({
      name: nom,
      ...(parseSpecName(nom) || {}),
      gain,
      pct: Number(((100 * (avec - sans)) / sans).toFixed(2)),
      sansSupport: sansSupport.has(nom),
    });
    if (entrees.length >= top) break;
  }

  return {
    style,
    url,
    available: entrees.length > 0,
    simulatedAt: payload.timestamp || null,
    top: entrees,
  };
}

/**
 * Le classement pour les trois nombres de cibles. Les trois appels sont espaces comme
 * ceux des bijoux : on ne martele pas un site qui nous rend service.
 */
async function fetchPowerInfusion(top = 5, timeoutMs = 20000) {
  const targets = {};
  let available = false;

  for (const [index, { targets: count, style }] of FIGHT_STYLES.entries()) {
    if (index > 0) await new Promise((resolve) => setTimeout(resolve, 800));
    try {
      const data = await fetchPowerInfusionStyle(style, top, timeoutMs);
      targets[count] = data;
      if (data.available) available = true;
    } catch (err) {
      targets[count] = { style, available: false, reason: err.message, top: [] };
    }
  }

  return { available, targets };
}

module.exports = {
  fetchTrinkets,
  fetchPowerInfusion,
  powerInfusionUrl,
  fetchStyle,
  bloodmalletUrl,
  TrinketError,
  FIGHT_STYLE,
  FIGHT_STYLES,
};
