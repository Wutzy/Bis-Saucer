'use strict';

/**
 * Guides Wowhead : tier list de bijoux et consommables.
 *
 *   bijoux       : /guide/classes/<classe>/<spec>/bis-gear
 *   consommables : /guide/classes/<classe>/<spec>/enchants-gems-pve-<role>
 *
 * Ces guides sont ecrits dans un balisage maison que Wowhead sert **tel quel dans le
 * HTML**, encapsule en JSON. Rien a executer, rien a piloter au navigateur : tout est
 * dans la page.
 *
 *   [tier-list=rows grid]
 *     [tier]
 *       [tier-label bg=q5]S[/tier-label]
 *       [tier-content]
 *         [icon-badge=270164 quality=4 display-options=raid tooltip="..."]
 *
 *   [table class=grid]
 *     [tr][td]Flask[/td][td align=center][item=241322][item=241324][/td][/tr]
 *
 * `display-options` porte la provenance (raid / dungeon / delves / crafting), ce qui
 * donne les memes filtres que sur le site.
 *
 * La meme page embarque le nom, l'icone et la qualite de chaque objet cite, via
 * `WH.Gatherer.addData(3, 1, {...})` : une seule requete suffit pour tout.
 *
 * Verifie sur les 39 specs : toutes publient une tier list, de 4 a 6 rangs.
 */

const USER_AGENT =
  'GoldSaucer-GuildBiS/0.2 (outil interne de guilde, requete manuelle a la demande)';

const GUIDE_BASE = 'https://www.wowhead.com/guide/classes';

// Le contenu du guide est encapsule en JSON : les slashs y sont echappes ("[\/tier]"),
// d'ou le backslash optionnel dans toutes les fermetures.
const BLOC_OUVERTURE = /\[tier-list[^\]]*\]/;
const BLOC_FERMETURE = /\[\\?\/tier-list\]/;
const RANG = /\[tier-label[^\]]*\]([^[]*)\[\\?\/tier-label\]([\s\S]*?)(?=\[tier-label|$)/g;
const BADGE = /\[icon-badge=(\d+)([^\]]*)\]/g;
const CATEGORIES = /display-options=([a-z0-9,_-]+)/i;
const GATHERER = /WH\.Gatherer\.addData\(\s*3\s*,\s*1\s*,\s*(\{[\s\S]*?\})\s*\)\s*;/g;

// Tableaux de la page : un [table] dont les lignes sont "libelle -> objets". On les
// repere par le titre qui les precede, la page en contenant plusieurs.
//
// La page s'appelle « Enchants & Consumables » et publie bien deux tableaux : les
// consommables sous un titre Consumables, les enchantements sous un titre que chaque
// auteur ecrit a sa facon — « Enchants » chez les uns, « Gems & Enchants » chez les
// autres. Les guillemets sont echappes dans le HTML servi, d'ou le motif souple.
const TITRE_CONSO = /\[h[23][^\]]*toc=Consumables[^\]]*\]/i;
const TITRE_ENCHANTS = /\[h[23][^\]]*toc=\\?"?(?:Gems ?(?:&|and) ?)?Enchants/i;
const TABLE_OUVERTURE = /\[table[^\]]*\]/;
const TABLE_FERMETURE = /\[\\?\/table\]/;
const LIGNE = /\[tr\]([\s\S]*?)\[\\?\/tr\]/g;
const CELLULE = /\[td[^\]]*\]([\s\S]*?)\[\\?\/td\]/g;
const ITEM = /\[item=(\d+)/g;
const BALISE = /\[[^\]]*\]/g;

// Notre referentiel dit "healing", Wowhead ecrit "healer" dans ses URLs.
const ROLE_URL = { dps: 'dps', tank: 'tank', healing: 'healer' };

class WowheadError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'WowheadError';
    this.code = code || 'WOWHEAD_FAILED';
  }
}

function guideUrl(className, specSlug) {
  return `${GUIDE_BASE}/${className}/${specSlug}/bis-gear`;
}

/** Page "Enchants & Consumables" d'une spec. Le suffixe depend du role. */
function consumablesUrl(className, specSlug, role) {
  const suffixe = ROLE_URL[role] || 'dps';
  return `${GUIDE_BASE}/${className}/${specSlug}/enchants-gems-pve-${suffixe}`;
}

/** Recupere une page de guide. Leve une WowheadError si elle ne repond pas. */
async function fetchGuide(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'text/html' },
      signal: controller.signal,
    });
    if (!res.ok) throw new WowheadError(`Wowhead a répondu ${res.status}`, 'BAD_STATUS');
    return await res.text();
  } catch (err) {
    if (err instanceof WowheadError) throw err;
    if (err.name === 'AbortError') {
      throw new WowheadError('Wowhead n’a pas répondu à temps.', 'TIMEOUT');
    }
    throw new WowheadError(`Wowhead injoignable : ${err.message}`, 'NETWORK');
  } finally {
    clearTimeout(timer);
  }
}

/** Contenu du bloc de tier list, ou null si le guide n'en publie pas. */
function extraireBloc(html) {
  const debut = html.match(BLOC_OUVERTURE);
  if (!debut) return null;
  const apres = html.slice(debut.index + debut[0].length);
  const fin = apres.match(BLOC_FERMETURE);
  return fin ? apres.slice(0, fin.index) : null;
}

/**
 * Noms, icones et qualites des objets cites dans la page.
 *
 * Plusieurs appels a `addData` coexistent ; on les fusionne, le dernier gagnant. Un
 * payload illisible est ignore sans bruit : la page reste exploitable avec les seuls
 * identifiants, l'embed Wowhead sait nommer un objet a partir de son id.
 */
function extraireObjets(html) {
  const objets = new Map();
  for (const m of html.matchAll(GATHERER)) {
    let payload;
    try {
      payload = JSON.parse(m[1]);
    } catch (err) {
      continue;
    }
    for (const [id, data] of Object.entries(payload)) {
      if (!data || typeof data !== 'object') continue;
      objets.set(String(id), {
        name: data.name_enus || data.name || null,
        icon: data.icon || null,
        quality: typeof data.quality === 'number' ? data.quality : null,
      });
    }
  }
  return objets;
}

/** Objet complet a partir de son identifiant, avec ce que la page en sait. */
function objetDe(id, objets) {
  const connu = objets.get(String(id)) || {};
  return {
    itemId: Number(id),
    name: connu.name || null,
    icon: connu.icon || null,
    quality: connu.quality,
  };
}

/** Rangs de la tier list, dans l'ordre de publication (S en premier). */
function parseTiers(bloc, objets) {
  const tiers = [];
  RANG.lastIndex = 0;
  let rang;
  while ((rang = RANG.exec(bloc))) {
    const label = rang[1].replace(/\s+/g, ' ').trim();
    if (!label) continue;

    const items = [];
    const vus = new Set();
    BADGE.lastIndex = 0;
    let badge;
    while ((badge = BADGE.exec(rang[2]))) {
      const id = badge[1];
      if (vus.has(id)) continue;
      vus.add(id);

      const cats = (badge[2] || '').match(CATEGORIES);
      items.push({
        ...objetDe(id, objets),
        // Provenance telle que Wowhead la filtre : raid, dungeon, delves, crafting.
        categories: cats ? cats[1].split(',').filter(Boolean) : [],
      });
    }

    if (items.length) tiers.push({ rank: label, items });
  }
  return tiers;
}

/**
 * Tier list de bijoux d'une spec. Leve une WowheadError si la page ne repond pas ;
 * renvoie `available: false` si elle repond mais ne publie pas de tier list, ce qui
 * est un cas normal et non une panne.
 */
async function fetchTrinketTiers(className, specSlug, timeoutMs = 20000) {
  const url = guideUrl(className, specSlug);
  const html = await fetchGuide(url, timeoutMs);

  const bloc = extraireBloc(html);
  if (!bloc) return { url, available: false, tiers: [] };

  const tiers = parseTiers(bloc, extraireObjets(html));
  return { url, available: tiers.length > 0, tiers };
}

/** Contenu du premier tableau qui suit un titre donne, ou null s'il n'y en a pas. */
function extraireTableConso(html, motifTitre = TITRE_CONSO) {
  const titre = html.match(motifTitre);
  // Sans le titre attendu, on ne devine pas : prendre le premier tableau venu
  // reviendrait a servir les consommables comme enchantements, ou l'inverse. Seul le
  // tableau des consommables garde son repli historique sur le debut de page.
  if (!titre && motifTitre !== TITRE_CONSO) return null;
  const depuis = titre ? html.slice(titre.index) : html;

  const ouverture = depuis.match(TABLE_OUVERTURE);
  if (!ouverture) return null;
  const apres = depuis.slice(ouverture.index + ouverture[0].length);
  const fin = apres.match(TABLE_FERMETURE);
  return fin ? apres.slice(0, fin.index) : null;
}

/**
 * Lignes "type -> objets" du tableau. La ligne d'en-tete (Type / Best) ne porte aucun
 * objet : elle tombe d'elle-meme, sans avoir a la reconnaitre.
 */
function parseConsumables(table, objets) {
  const lignes = [];
  LIGNE.lastIndex = 0;
  let tr;
  while ((tr = LIGNE.exec(table))) {
    const cellules = [];
    CELLULE.lastIndex = 0;
    let td;
    while ((td = CELLULE.exec(tr[1]))) cellules.push(td[1]);
    if (cellules.length < 2) continue;

    // Le libelle peut porter du balisage ([b], [color]) : on ne garde que le texte.
    const type = cellules[0].replace(BALISE, ' ').replace(/\\r|\\n|\s+/g, ' ').trim();
    if (!type) continue;

    const items = [];
    const vus = new Set();
    ITEM.lastIndex = 0;
    let m;
    while ((m = ITEM.exec(cellules[1]))) {
      if (vus.has(m[1])) continue;
      vus.add(m[1]);
      items.push(objetDe(m[1], objets));
    }
    if (items.length) lignes.push({ type, items });
  }
  return lignes;
}

/**
 * Consommables recommandes pour une spec : flacon, potions, huile d'arme, rune,
 * nourriture — et, dans la foulee, les enchantements et gemmes, qui vivent sur la MEME
 * page. Deux tableaux, une seule requete : rien ne justifie de la faire deux fois.
 *
 * Meme contrat que la tier list : `available: false` si la page repond mais ne publie
 * pas le tableau. Les deux sections sont independantes — un guide peut donner ses
 * enchantements sans consommables, et c'est un cas normal, pas une panne.
 */
async function fetchConsumables(className, specSlug, role, timeoutMs = 20000) {
  const url = consumablesUrl(className, specSlug, role);
  const html = await fetchGuide(url, timeoutMs);
  const objets = extraireObjets(html);

  const tableConso = extraireTableConso(html);
  const rows = tableConso ? parseConsumables(tableConso, objets) : [];

  const tableEnchants = extraireTableConso(html, TITRE_ENCHANTS);
  const enchants = tableEnchants ? parseConsumables(tableEnchants, objets) : [];

  return {
    url,
    available: rows.length > 0,
    rows,
    enchants: { available: enchants.length > 0, rows: enchants },
  };
}

module.exports = {
  fetchTrinketTiers,
  fetchConsumables,
  guideUrl,
  consumablesUrl,
  WowheadError,
  // Exportes pour les tests : le parsing se verifie sans requete reseau.
  extraireBloc,
  extraireObjets,
  parseTiers,
  extraireTableConso,
  parseConsumables,
  TITRE_ENCHANTS,
};
