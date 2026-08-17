'use strict';

/* ---------------- mode ---------------- */

/**
 * En hebergement statique (GitHub Pages), il n'y a pas de serveur : les routes de
 * lecture sont des fichiers JSON figes, et les deux actions qui ecrivent — scraper
 * une spec, changer la spec d'un membre — sont desactivees. Elles se font en local,
 * puis on republie.
 */
const STATIC = Boolean(window.BIS_STATIC);
const API = STATIC
  ? {
      specs: 'api/specs.json',
      roster: 'api/roster.json',
      bis: 'api/bis.json',
      trinkets: 'api/trinkets.json',
      wowhead: 'api/wowhead.json',
    }
  : {
      specs: '/api/specs',
      roster: '/api/roster',
      bis: '/api/bis',
      trinkets: '/api/trinkets',
      wowhead: '/api/wowhead',
    };

/* ---------------- langue ---------------- */

// Langue lue dans index.html avant le chargement de l'embed Wowhead.
const LANG = window.BIS_LANG === 'en' ? 'en' : 'fr';

// Domaine Wowhead : en francais, tooltips ET noms d'objets sont localises par
// l'embed officiel (voir `renameLinks` dans index.html).
const WOWHEAD_DOMAIN = LANG === 'fr' ? 'fr' : '';

/**
 * Noms de donjons et de boss en francais.
 *
 * Icy Veins n'a pas d'edition francaise et ecrit ces noms en texte libre dans ses
 * guides : il n'existe aucune source fiable pour les traduire automatiquement.
 * Cette table est donc a completer a la main, avec les noms du client francais.
 * Toute entree laissee vide retombe sur le nom anglais, sans rien casser.
 *
 * Les clefs ci-dessous sont toutes les sources presentes dans le cache actuel.
 */
const SOURCES_FR = {
  // Raid — l'abime Venimeux (noms officiels des annonces Blizzard FR)
  "Ula'tek": "Ula'tek",
  'The Coiled Altar': 'L’Autel annelé',
  "Nek'zali the Soulcoiler": 'Nek’zali l’Entortillâme',
  "Nek'zali": 'Nek’zali l’Entortillâme',
  'Vashnik the Malignant': 'Vashnik le Malveillant',
  Vashnik: 'Vashnik le Malveillant',
  Sszorak: 'Sszorak',
  'The Twin Fangs': 'Les crochets jumeaux',
  'Entombed Sentinels': 'Sentinelles inhumées',
  'The Lost Explorers': 'L’expédition perdue',
  // Repaire (boss hors instance) : pas encore de nom FR publie, on garde l'anglais.
  'Nymrissa Wavecaller': '',
  'Tidebound Grotto': '',
  // Donjons Mythique+ (rotation saison 2)
  'Murder Row': 'Allée du meurtre',
  "King's Rest": 'Repos des rois',
  'Temple of Sethraliss': 'Temple de Sephraliss',
  'Voidscar Arena': 'Arène de la Cicatrice du Vide',
  'Altar of Fangs': 'Autel des crochets',
  'Den of Nalorakk': 'Antre de Nalorakk',
  'The Blinding Vale': 'Le val Aveuglant',
  'Ruby Life Pools': 'Bassins de l’Essence rubis',
  // Raid precedent, encore cite par quelques guides
  'Nexus King Salhadaar': 'Roi-nexus Salhadaar',
  // Divers
  'BoE Trash Drop': 'Trash — objet LQE',
  'Trash Drop': 'Trash',
  Craft: 'Artisanat',
  'Craft (Blacksmithing)': 'Artisanat (Forge)',
  'Craft (Inscription)': 'Artisanat (Calligraphie)',
  'Craft (Jewelcrafting)': 'Artisanat (Joaillerie)',
  'Craft (Leatherworking)': 'Artisanat (Travail du cuir)',
  'Craft (Tailoring)': 'Artisanat (Couture)',
  Leatherworking: 'Travail du cuir',
  Tailoring: 'Couture',
  Catalyseur: 'Catalyseur',
};

/** Nom de source dans la langue courante, repli sur l'anglais si non traduit. */
function translateSource(source) {
  if (!source) return source;
  if (LANG !== 'fr') return source;
  if (SOURCES_FR[source]) return SOURCES_FR[source];
  // Les guides ecrivent le meme nom avec ou sans article ("Coiled Altar" et
  // "The Coiled Altar") : une seule entree dans la table couvre les deux formes.
  const sansArticle = source.replace(/^Thes+/i, '');
  return SOURCES_FR[sansArticle] || SOURCES_FR[`The ${sansArticle}`] || source;
}

/**
 * Emplacement retenu pour chaque objet, par consensus entre les guides.
 *
 * Les auteurs se trompent parfois : la page DK Sang classe "Amulet of the Twin Fangs"
 * en `Ring` alors que trois autres guides la donnent en `Neck` (et que son icone est
 * bien un collier). Sans arbitrage, l'objet se retrouvait range en anneau.
 * Rempli par `refreshSlotConsensus()` a chaque chargement des donnees.
 */
let slotConsensus = new Map();

function refreshSlotConsensus() {
  const counts = new Map();
  for (const entry of Object.values(store.specs || {})) {
    for (const list of listsOf(entry)) {
      for (const item of list.items) {
        if (item.empty || !item.itemId || !item.slotFr) continue;
        const id = String(item.itemId);
        if (!counts.has(id)) counts.set(id, new Map());
        const bySlot = counts.get(id);
        const key = item.slotFr;
        if (!bySlot.has(key)) bySlot.set(key, { n: 0, slot: item.slot, slotFr: item.slotFr });
        bySlot.get(key).n += 1;
      }
    }
  }

  slotConsensus = new Map();
  for (const [id, bySlot] of counts) {
    const best = Array.from(bySlot.values()).sort((a, b) => b.n - a.n)[0];
    slotConsensus.set(id, best);
  }
}

/** Emplacement francais d'un objet, apres arbitrage. */
function slotFrOf(item) {
  const consensus = slotConsensus.get(String(item.itemId));
  return (consensus && consensus.slotFr) || item.slotFr || item.slot;
}

/**
 * Vocabulaire d'affichage. Le parseur stocke les termes des guides ("Poignets",
 * "Taille", "Cou") ; on affiche ceux de la guilde. Uniquement cosmetique : les
 * comparaisons internes (ordre des emplacements, type d'armure) restent sur les
 * valeurs stockees, donc pas besoin de rescraper.
 */
const SLOT_ALIASES_FR = {
  Poignets: 'Brassards',
  Taille: 'Ceinture',
  Cou: 'Collier',
};

/** Libelle d'emplacement dans la langue courante. */
function slotName(item) {
  const consensus = slotConsensus.get(String(item.itemId));
  if (LANG === 'fr') {
    const stored = (consensus && consensus.slotFr) || item.slotFr || item.slot;
    return SLOT_ALIASES_FR[stored] || stored;
  }
  return (consensus && consensus.slot) || item.slot || item.slotFr;
}

// Type d'armure deduit du slug d'icone (inv_helm_plate_..., inv_chest_leather_...).
// Wowhead ne publie pas la classe d'armure dans les donnees embarquees, c'est donc une
// heuristique purement cosmetique : si le slug ne dit rien, on n'affiche rien.
const ARMOR_TOKENS = {
  plate: 'Plaques',
  mail: 'Mailles',
  leather: 'Cuir',
  cloth: 'Tissu',
};

// Slots reellement concernes par une classe d'armure. Les capes portent souvent
// "leather" dans leur slug d'icone alors qu'elles n'ont pas de type d'armure.
const ARMOR_SLOTS = new Set([
  'Tête',
  'Épaules',
  'Torse',
  'Poignets',
  'Mains',
  'Taille',
  'Jambes',
  'Pieds',
]);

const els = {
  selector: document.getElementById('selector-bar'),
  storeStatus: document.getElementById('store-status'),
  avatar: document.getElementById('spec-avatar'),
  name: document.getElementById('spec-name'),
  sub: document.getElementById('spec-sub'),
  refresh: document.getElementById('refresh-btn'),
  message: document.getElementById('message'),
  content: document.getElementById('content'),
  legendMeta: document.getElementById('legend-meta'),
  majDonnees: document.getElementById('maj-donnees'),
  listPicker: document.getElementById('list-picker'),
  tabs: Array.from(document.querySelectorAll('.tab')),
  tabsNav: document.querySelector('.tabs'),
  panelHead: document.querySelector('.panel-head'),
  panelTitle: document.querySelector('.panel-title'),
};

let specs = [];
let store = { specs: {} };
let trinketStore = { specs: {} };
let wowheadStore = { specs: {} };
let roster = [];
let classes = {};
let activeKey = null;
let activeBoss = null;
// L'application ouvre sur la partie guilde : elle concerne tout le monde, alors que la
// premiere spec de la liste n'est que la premiere par ordre alphabetique.
let activeView = 'rand';
// Vue /rand : null (ecran de choix), 'raid' ou 'mplus'.
let randMode = null;
// Portee de la vue /rand : 'guild' (blason, tout le roster) ou 'spec' (onglet du
// groupe Spec, seulement ce que la spec affichee doit rand).
let randScope = 'guild';
// Le roster sert a preparer la composition mythique : son libelle le dit, et il est
// le meme partout (carte d'entree, barre de guilde, titre du panneau).
const ROSTER_LABEL = 'Roster Mythique (prévisionnel)';

// Vue a rouvrir en quittant une vue de guilde (/rand ou Roster) : leurs onglets etant
// masques, ce sont les carres de la barre du haut qui servent de porte de sortie, et
// ils doivent ramener la ou on etait.
let vueAvantGuilde = 'list';

/**
 * Visuel par donjon. Clef = nom canonique de la source (celui des guides, en anglais),
 * valeur = fichier dans public/img/. Sans entree, la carte affiche un cadre neutre :
 * une source sans image reste affichable, elle n'a simplement pas d'illustration.
 */
/**
 * Specs DPS qui tapent a distance. Le referentiel de `src/classes.js` ne connait que
 * tank / dps / healing — la distinction distance / corps a corps n'y sert a rien, elle
 * n'entre pas dans les URLs Icy Veins. Elle ne sert qu'a ranger le roster, d'ou sa
 * place ici, avec le reste du vocabulaire d'affichage.
 *
 * Tout ce qui est DPS sans etre dans cette liste est du corps a corps.
 */
const DPS_DISTANCE = new Set([
  'druid-balance',
  'evoker-augmentation',
  'evoker-devastation',
  'hunter-beast-mastery',
  'hunter-marksmanship',
  'mage-arcane',
  'mage-fire',
  'mage-frost',
  'priest-shadow',
  'shaman-elemental',
  'warlock-affliction',
  'warlock-demonology',
  'warlock-destruction',
]);

// Liste de bijoux editoriale affichee : 'wowhead' ou 'icy'. Les deux disent la meme
// chose autrement — on en regarde une a la fois, pas les deux empilees. Le choix vaut
// pour toutes les specs, on compare en general de la meme facon.
let trinketSource = 'wowhead';

// Section "hors roster mythique" depliee ou non. Repliee par defaut : la vue montre
// la composition mythique, ces membres-la n'en font pas partie.
let rosterHorsVisible = false;

// Donjon mis en avant dans la vue M+ opti : les autres blocs sont estompes, pour
// lire un donjon a la fois. null = tout est lisible.
let mplusFocus = null;

const DUNGEON_IMAGES = {
  'Altar of Fangs': 'AlterOfFangs.jpg',
  'Den of Nalorakk': 'DenOfNalorakk.jpg',
  "King's Rest": 'KingRestjpg.jpg',
  'Murder Row': 'MurderRow.jpg',
  'Ruby Life Pools': 'RubyLifePools.jpg',
  'Temple of Sethraliss': 'SephralisTemple.jpg',
  'The Blinding Vale': 'TheBlindingVal.jpg',
  'Voidscar Arena': 'VoidScareArena.jpg',
};

/**
 * Image d'une source. Meme tolerance a l'article que `translateSource` : les guides
 * ecrivent aussi bien "Blinding Vale" que "The Blinding Vale", et le nom canonique
 * retenu peut basculer de l'un a l'autre selon ce qui a ete scrape.
 */
function dungeonImage(name) {
  if (!name) return null;
  if (DUNGEON_IMAGES[name]) return DUNGEON_IMAGES[name];
  const sansArticle = name.replace(/^Thes+/i, '');
  return DUNGEON_IMAGES[sansArticle] || DUNGEON_IMAGES[`The ${sansArticle}`] || null;
}
// Index de la liste BiS affichee, par spec : certains guides en publient plusieurs
// (une par talent de heros). Cle de spec -> index dans entry.lists.
const selectedList = {};

/* ---------------- helpers ---------------- */

function classInfo(className) {
  return classes[className] || { label: className, short: '??', color: '#d9a441', specs: [] };
}

function classColor(className) {
  return classInfo(className).color;
}

/** Slug d'icone d'une spec (repli : icone de classe). */
function specIcon(className, specSlug) {
  const info = classInfo(className);
  const spec = (info.specs || []).find((s) => s.slug === specSlug);
  return (spec && spec.icon) || info.icon || null;
}

function iconEl(slug, cssClass, alt) {
  const img = document.createElement('img');
  img.src = iconUrl(slug);
  img.alt = alt || '';
  img.loading = 'lazy';
  if (cssClass) img.className = cssClass;
  return img;
}

function armorType(item) {
  if (!item.icon || !ARMOR_SLOTS.has(slotFrOf(item))) return null;
  const slug = item.icon.toLowerCase();
  for (const [token, label] of Object.entries(ARMOR_TOKENS)) {
    if (slug.includes(`_${token}_`)) return label;
  }
  return null;
}

function iconUrl(icon) {
  return icon
    ? `https://wow.zamimg.com/images/wow/icons/medium/${icon}.jpg`
    : 'https://wow.zamimg.com/images/wow/icons/medium/inv_misc_questionmark.jpg';
}

function itemUrl(id) {
  const base = WOWHEAD_DOMAIN
    ? `https://${WOWHEAD_DOMAIN}.wowhead.com`
    : 'https://www.wowhead.com';
  return `${base}/item=${id}`;
}

/**
 * Date de la derniere mise a jour des donnees, toutes sources confondues.
 *
 * Les trois caches sont ecrits separement et portent chacun leur `updatedAt` : ce qui
 * interesse le lecteur est la plus recente des trois — « ces donnees datent de quand ? »
 * Repli sur le scrape le plus recent pour un cache ecrit avant l'ajout du champ.
 */
function derniereMaj() {
  const dates = [store.updatedAt, trinketStore.updatedAt, wowheadStore.updatedAt];
  for (const entry of Object.values(store.specs || {})) dates.push(entry.scrapedAt);

  const valides = dates
    .filter(Boolean)
    .map((d) => new Date(d))
    .filter((d) => !Number.isNaN(d.getTime()));
  if (!valides.length) return null;

  return new Date(Math.max(...valides.map((d) => d.getTime()))).toISOString();
}

/** Date courte : 17/08/2026. */
function formatDateCourte(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

/** Ecart lisible avec maintenant : « aujourd'hui », « il y a 3 jours ». */
function ilYA(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;

  const jours = Math.floor((Date.now() - date.getTime()) / 86400000);
  if (jours <= 0) return 'aujourd’hui';
  if (jours === 1) return 'hier';
  return `il y a ${jours} jours`;
}

function formatDate(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' });
}

function showMessage(text, kind) {
  if (!text) {
    els.message.hidden = true;
    els.message.textContent = '';
    return;
  }
  els.message.hidden = false;
  els.message.className = `message ${kind || 'info'}`;
  els.message.textContent = text;
}

function entryFor(key) {
  return store.specs[key] || null;
}

/** Listes BiS d'une entree (les entrees scrapees avant le multi-listes n'ont que `items`). */
function listsOf(entry) {
  if (!entry) return [];
  if (Array.isArray(entry.lists) && entry.lists.length) return entry.lists;
  return [{ label: entry.tableLabel || 'Liste BiS', items: entry.items || [] }];
}

/** Objets reellement equipes : les emplacements vides (chemise, tabard) sont exclus. */
function equippedItems(entry) {
  if (!entry || !Array.isArray(entry.items)) return [];
  return entry.items.filter((item) => !item.empty && item.itemId);
}

function itemsOf(entry, key) {
  const lists = listsOf(entry);
  if (!lists.length) return [];
  const index = Math.min(selectedList[key] || 0, lists.length - 1);
  return lists[index].items;
}

function specByKey(key) {
  return specs.find((s) => s.key === key) || null;
}

/** Membres jouant une spec donnee, indexes par cle de spec. */
function membersBySpec() {
  const map = new Map();
  for (const member of roster) {
    if (!member.spec) continue;
    const key = `${member.class}-${member.spec}`;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(member);
  }
  return map;
}

/** Specs affichees : celles jouees dans le roster + celles deja en cache. */
function visibleSpecs() {
  const played = membersBySpec();
  return specs
    .filter((s) => played.has(s.key) || entryFor(s.key))
    .sort((a, b) => a.label.localeCompare(b.label, 'fr'));
}

function activeSpec() {
  return specByKey(activeKey);
}

function refreshTooltips() {
  if (window.$WowheadPower && typeof window.$WowheadPower.refreshLinks === 'function') {
    window.$WowheadPower.refreshLinks();
  }
}

/**
 * Paramètres `data-wowhead` d'un objet.
 * Icy Veins pointe ses liens sur `domain=ptr` (le contenu de Midnight n'est pas encore
 * sur le domaine live). En français on remplace ce domaine pour obtenir les noms
 * localisés ; si l'objet n'existe pas encore côté français, l'embed ne renomme rien et
 * le nom anglais scrapé reste affiché.
 */
function wowheadParams(item) {
  const base =
    item.wowheadParams || `item=${item.itemId}`;
  if (LANG !== 'fr') return base;
  return /domain=/.test(base)
    ? base.replace(/domain=[^&]*/, 'domain=fr')
    : `${base}&domain=fr`;
}

function itemLink(item) {
  const link = document.createElement('a');
  link.className = `item-link${item.quality ? ` q${item.quality}` : ''}`;
  link.href = itemUrl(item.itemId);
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  // Icy Veins fournit les bonus ids (ilvl, sockets) : on les garde tels quels pour
  // que le tooltip affiche exactement la version d'objet recommandee par le guide.
  link.dataset.wowhead = wowheadParams(item);
  link.textContent = item.name;
  return link;
}

function itemCell(item, subtitle) {
  const wrap = document.createElement('div');
  wrap.className = 'item-cell';

  const img = document.createElement('img');
  img.className = 'item-icon';
  img.src = iconUrl(item.icon);
  img.alt = '';
  img.loading = 'lazy';

  const text = document.createElement('div');
  text.appendChild(itemLink(item));
  if (subtitle) {
    const small = document.createElement('span');
    small.className = 'item-slot';
    small.textContent = subtitle;
    text.appendChild(small);
  }

  wrap.append(img, text);
  return wrap;
}

function badge(kind, text) {
  const el = document.createElement('i');
  el.className = `badge ${kind}`;
  el.textContent = text;
  return el;
}

function emptyState(title, message) {
  const div = document.createElement('div');
  div.className = 'empty';
  const strong = document.createElement('strong');
  strong.textContent = title;
  const p = document.createElement('span');
  p.textContent = message;
  div.append(strong, p);
  return div;
}

/* ---------------- provenance des bijoux ---------------- */

/**
 * Contenu vise par la liste BiS affichee : 'raid', 'dungeon', ou null quand la liste
 * ne cible rien en particulier (Overall, ou une declinaison par talent de heros).
 *
 * C'est ce que le selecteur de liste dit deja pour l'armure ; les bijoux doivent
 * suivre, sinon la liste "Raid" propose des bijoux qu'on ne peut pas y obtenir.
 */
function contenuListe(entry, specKey) {
  const lists = listsOf(entry);
  if (lists.length < 2) return null;
  const label = (lists[selectedList[specKey] || 0] || {}).label || '';
  if (/overall|general|général/i.test(label)) return null;
  if (/mythic|m\+|donjon|dungeon/i.test(label)) return 'dungeon';
  if (/raid/i.test(label)) return 'raid';
  return null;
}

/**
 * Provenance des bijoux selon le guide Wowhead **d'une spec donnee**.
 *
 * Surtout pas tous guides confondus : les auteurs ne rangent pas toujours un objet de
 * la meme facon, et l'union des categories finissait par donner des bijoux a la fois
 * "raid" et "donjon", donc visibles partout. Un seul guide reste coherent avec lui-meme.
 */
const categoriesParSpec = new Map();

function categoriesBijouxDeSpec(specKey) {
  if (categoriesParSpec.has(specKey)) return categoriesParSpec.get(specKey);

  const index = new Map();
  const entree = wowheadStore.specs[specKey];
  for (const tier of (entree && entree.trinkets && entree.trinkets.tiers) || []) {
    for (const item of tier.items) {
      index.set(String(item.itemId), new Set(item.categories || []));
    }
  }
  categoriesParSpec.set(specKey, index);
  return index;
}

/**
 * Ce bijou est-il **obtenable** dans le contenu vise ?
 *
 * Trois signaux, du plus precis au plus general — chacun porte sur l'objet lui-meme,
 * jamais sur une moyenne entre guides :
 *
 *  1. la categorie que Bloodmallet donne a l'objet (Raid / Dungeon / Profession) ;
 *  2. la provenance lue dans les listes Icy Veins, arbitree par `classifySources()` ;
 *  3. les categories du guide Wowhead de la spec affichee.
 *
 * Un objet craft ou PvP n'est obtenable ni en raid ni en donjon : il sort des deux
 * listes ciblees. **Un objet qu'aucun signal ne sait ranger reste affiche** : on
 * n'ecarte que ce qu'on sait appartenir ailleurs, jamais ce qu'on ignore.
 */
function bijouDansContenu(itemId, contenu, sourceKinds, sourceSim, specKey) {
  if (!contenu) return true;

  if (sourceSim) {
    if (/raid/i.test(sourceSim)) return contenu === 'raid';
    if (/dungeon|mythic/i.test(sourceSim)) return contenu === 'dungeon';
    return false;
  }

  const info = itemInfoById(itemId);
  const raw = (info && info.source) || ITEM_SOURCES[itemId];
  if (raw && sourceKinds) {
    const kind = sourceKinds.get(raw) || sourceKinds.get(cleanSourceLabel(raw));
    if (kind === 'raid' || kind === 'dungeon') return kind === contenu;
    if (kind === 'other') return false;
  }

  const cats = specKey && categoriesBijouxDeSpec(specKey).get(String(itemId));
  if (cats && cats.size) return cats.has(contenu === 'raid' ? 'raid' : 'dungeon');

  return true;
}

/* ---------------- vue liste ---------------- */

/** Ligne "provenance" d'une carte : source du drop + mention de catalyse si besoin. */
function sourceLine(item) {
  const wrap = document.createElement('div');
  wrap.className = 'pd-source';

  if (!item.source) {
    wrap.textContent = '—';
    return wrap;
  }

  // Quand la seule provenance donnee par le guide est "Catalyseur" (Paladin Vindicte),
  // ne pas l'ecrire en gris a cote du badge ambre : ce serait deux fois le meme mot,
  // dans deux couleurs differentes.
  if (!(item.catalyst && /^catalyseur$/i.test(item.source))) {
    const source = document.createElement('span');
    source.textContent = translateSource(item.source);
    wrap.appendChild(source);
  }

  if (item.catalyst) {
    // Piece de set : l'objet ne tombe pas tel quel, il faut ramasser la piece
    // correspondante a cette source puis la transformer au Catalyseur.
    // Quand le guide donne la piece d'origine, le badge pointe dessus : c'est
    // exactement l'objet a ramasser en donjon ou en raid.
    const chip = document.createElement(item.originalItemId ? 'a' : 'span');
    chip.className = 'pd-catalyst';
    chip.textContent = '+ Catalyseur';
    chip.title = item.originalItemId
      ? 'Pièce de set : ramasser la pièce d’origine à cette source (survoler pour la voir), puis la transformer au Catalyseur.'
      : 'Pièce de set : ramasser la pièce du même emplacement à cette source, puis la transformer au Catalyseur.';

    if (item.originalItemId) {
      chip.href = itemUrl(item.originalItemId);
      chip.target = '_blank';
      chip.rel = 'noopener noreferrer';
      chip.dataset.wowhead = `item=${item.originalItemId}`;
    }

    wrap.appendChild(chip);
  }

  return wrap;
}

/** Ce que le cache BiS sait d'un objet, a partir de son seul identifiant. */
function itemInfoById(itemId) {
  for (const entry of Object.values(store.specs || {})) {
    for (const list of listsOf(entry)) {
      for (const item of list.items) {
        if (!item.empty && item.itemId === itemId) return item;
      }
    }
  }
  return null;
}

function iconForItemId(itemId) {
  const found = itemInfoById(itemId);
  return (found && found.icon) || null;
}

/** Role d'une spec (dps / healing / tank), depuis le referentiel servi par l'API. */
function specRoleOf(className, specSlug) {
  const spec = (classInfo(className).specs || []).find((s) => s.slug === specSlug);
  return (spec && spec.role) || null;
}

// Nombre de bijoux retenus par categorie de cibles. Sert au panneau de la vue
// Liste BiS comme au calcul des besoins dans la vue Qui roll ? : les deux
// doivent dire la meme chose.
const SIM_TRINKET_COUNT = 5;

/**
 * Bijoux retenus pour une spec DPS simulee : le haut du classement de chaque
 * categorie de cibles chez Bloodmallet. Pour ces specs, la simulation prime sur
 * le choix du guide.
 */
function simulatedTrinkets(specKey) {
  const sim = trinketStore.specs[specKey];
  if (!sim || !sim.available) return [];

  const byId = new Map();
  for (const targets of [1, 3, 5]) {
    const data = sim.targets && sim.targets[String(targets)];
    if (!data || !data.available) continue;
    for (const trinket of data.trinkets.slice(0, SIM_TRINKET_COUNT)) {
      const id = String(trinket.itemId);
      // Le rang change d'une categorie a l'autre : on les garde tous.
      if (!byId.has(id)) byId.set(id, { trinket, targets: [], ranks: {} });
      const entry = byId.get(id);
      entry.targets.push(targets);
      entry.ranks[targets] = trinket.rank;
    }
  }
  return Array.from(byId.values());
}

/**
 * Panneau des bijoux : les deux meilleurs de chaque categorie de cibles.
 *
 * Bloodmallet simule le meme combat sur 1, 3 et 5 cibles, et le classement change
 * d'une categorie a l'autre : afficher les trois evite de choisir un bijou mono-cible
 * pour du donjon, ou l'inverse. Les bijoux retenus par le guide sont marques.
 */
/**
 * Repli quand Bloodmallet ne simule pas la spec (toute la classe Moine, les soins,
 * et quelques DPS selon les patchs) : les recommandations du guide lui-meme.
 * Presente separement, car ce sont des conseils d'auteur, pas un classement chiffre.
 */
function renderTrinketAdvice(entry, guideTrinkets, contenu, sourceKinds, specKey) {
  const brut = (entry && entry.trinketAdvice) || [];
  // Sur une liste ciblee, un groupe vide de ses bijoux hors contenu disparait.
  const advice = brut
    .map((g) => ({
      ...g,
      items: g.items.filter((i) =>
        bijouDansContenu(i.itemId, contenu, sourceKinds, null, specKey)
      ),
    }))
    .filter((g) => g.items.length);
  if (!advice.length) return null;

  const panel = document.createElement('div');
  panel.className = 'trinket-panel trinket-panel--advice';

  const head = document.createElement('div');
  head.className = 'tp-head';
  head.textContent = 'Bijoux — Icy Veins';

  const note = document.createElement('span');
  note.className = 'tp-source';
  note.textContent = 'recommandations du guide';
  note.title =
    'Bijoux mis en avant par l’auteur du guide Icy Veins, rangés comme lui les range (à utiliser / passifs).';
  head.appendChild(note);
  panel.appendChild(head);

  const cols = document.createElement('div');
  cols.className = 'tp-cols';
  cols.style.gridTemplateColumns = `repeat(${Math.min(advice.length, 3)}, 1fr)`;

  const guideIds = new Set(guideTrinkets.map((t) => t.itemId));

  for (const group of advice) {
    const col = document.createElement('div');
    col.className = 'tp-col';

    const title = document.createElement('div');
    title.className = 'tp-title';
    title.textContent = group.category;
    col.appendChild(title);

    for (const trinket of group.items) {
      const row = document.createElement('div');
      row.className = `tp-item${guideIds.has(trinket.itemId) ? ' tp-item--bis' : ''}`;
      row.appendChild(iconEl(trinket.icon || iconForItemId(trinket.itemId), 'tp-icon', ''));

      const body = document.createElement('div');
      body.className = 'tp-body';
      body.appendChild(itemLink(trinket));
      col.appendChild(row);
      row.appendChild(body);

      if (guideIds.has(trinket.itemId)) {
        const flag = document.createElement('span');
        flag.className = 'tp-flag';
        flag.textContent = 'BiS';
        flag.title = 'Retenu dans la liste BiS du guide';
        row.appendChild(flag);
      }
    }

    cols.appendChild(col);
  }

  panel.appendChild(cols);
  return panel;
}

/**
 * Liste de bijoux editoriale, au choix : la tier list Wowhead ou les recommandations
 * Icy Veins. Les deux disent la meme chose autrement, les empiler ferait doublon —
 * on affiche celle qu'on demande, avec un selecteur dans son en-tete.
 *
 * Chaque panneau garde exactement sa mise en forme : rangs colores pour Wowhead,
 * colonnes par categorie pour Icy Veins.
 */
function renderListeBijoux(entry, specKey, guideTrinkets, contenu, sourceKinds) {
  const panneaux = {
    wowhead: renderWowheadTiers(specKey, guideTrinkets, contenu),
    icy: renderTrinketAdvice(entry, guideTrinkets, contenu, sourceKinds, specKey),
  };
  if (!panneaux.wowhead && !panneaux.icy) return null;

  // Une source sans donnees pour cette spec ne peut pas etre affichee : on bascule
  // sur l'autre sans changer la preference, qui vaudra de nouveau des qu'elle revient.
  const actif = panneaux[trinketSource] ? trinketSource : panneaux.wowhead ? 'wowhead' : 'icy';
  const panneau = panneaux[actif];

  const choix = document.createElement('div');
  choix.className = 'tp-choix';
  for (const [source, label] of [
    ['wowhead', 'Wowhead'],
    ['icy', 'Icy Veins'],
  ]) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `tp-choix-btn${actif === source ? ' is-active' : ''}`;
    btn.textContent = label;
    if (!panneaux[source]) {
      btn.disabled = true;
      btn.title = `Aucune donnée ${label} pour cette spec`;
    } else {
      btn.addEventListener('click', () => {
        trinketSource = source;
        renderContent();
      });
    }
    choix.appendChild(btn);
  }

  const head = panneau.querySelector('.tp-head');
  if (head) head.appendChild(choix);
  return panneau;
}

/* ---------------- tier list Wowhead ---------------- */

// Provenances telles que Wowhead les filtre, dans l'ordre de ses propres cases.
const WOWHEAD_CATEGORIES = [
  { slug: 'raid', label: 'Raid' },
  { slug: 'dungeon', label: 'Mythique+' },
  { slug: 'delves', label: 'Gouffres' },
  { slug: 'crafting', label: 'Artisanat' },
];

// Filtres actifs de la tier list, partages par toutes les specs : on regarde en
// general le meme contenu d'une spec a l'autre.
const wowheadFiltres = new Set(WOWHEAD_CATEGORIES.map((c) => c.slug));

/**
 * Un objet sans provenance connue reste visible : on ne masque que ce qu'on sait ranger.
 *
 * Sur une liste ciblee (Raid, Mythic+), c'est elle qui decide et les cases s'effacent :
 * deux filtres concurrents sur le meme panneau seraient illisibles.
 */
function bijouVisible(item, contenu) {
  if (!item.categories || !item.categories.length) return true;
  if (contenu) return item.categories.includes(contenu === 'raid' ? 'raid' : 'dungeon');
  return item.categories.some((c) => wowheadFiltres.has(c));
}

/**
 * Tier list de bijoux du guide Wowhead : un rang par ligne (S, A, B...), filtrable
 * par provenance comme sur le site. Le classement est celui de l'auteur, pas une
 * simulation — c'est la lecture qui complete le mieux Bloodmallet.
 */
function renderWowheadTiers(specKey, guideTrinkets, contenu) {
  const entree = wowheadStore.specs[specKey];
  const data = entree && entree.trinkets;
  if (!data || !data.available || !data.tiers || !data.tiers.length) return null;

  const panel = document.createElement('div');
  panel.className = 'trinket-panel trinket-panel--tiers';

  const head = document.createElement('div');
  head.className = 'tp-head';
  head.textContent = 'Bijoux — tier list Wowhead';

  const note = document.createElement('span');
  note.className = 'tp-source';
  note.textContent = 'classement du guide';
  note.title = data.url
    ? `Rangs publiés par l’auteur du guide Wowhead — ${data.url}`
    : 'Rangs publiés par l’auteur du guide Wowhead.';
  head.appendChild(note);
  panel.appendChild(head);

  if (contenu) {
    // La liste BiS choisie fait deja le tri : on l'annonce plutot que de laisser
    // croire a des cases qui ne serviraient a rien.
    const note = document.createElement('p');
    note.className = 'wh-note-filtre';
    note.textContent =
      contenu === 'raid'
        ? 'Limité aux bijoux de raid, comme la liste BiS affichée.'
        : 'Limité aux bijoux de Mythique+, comme la liste BiS affichée.';
    panel.appendChild(note);
  } else {
    // Cases de provenance, comme sur Wowhead. Une categorie absente de cette spec
    // n'est pas proposee : elle ne filtrerait rien.
    const presentes = new Set(
      data.tiers.flatMap((t) => t.items).flatMap((i) => i.categories || [])
    );
    const filtres = document.createElement('div');
    filtres.className = 'wh-filtres';
    for (const cat of WOWHEAD_CATEGORIES) {
      if (!presentes.has(cat.slug)) continue;
      const label = document.createElement('label');
      label.className = `wh-filtre wh-filtre--${cat.slug}`;
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.checked = wowheadFiltres.has(cat.slug);
      box.addEventListener('change', () => {
        if (box.checked) wowheadFiltres.add(cat.slug);
        else wowheadFiltres.delete(cat.slug);
        renderContent();
      });
      const texte = document.createElement('span');
      texte.textContent = cat.label;
      label.append(box, texte);
      filtres.appendChild(label);
    }
    if (filtres.children.length > 1) panel.appendChild(filtres);
  }

  const guideIds = new Set(guideTrinkets.map((t) => t.itemId));

  const grille = document.createElement('div');
  grille.className = 'wh-tiers';

  for (const tier of data.tiers) {
    const visibles = tier.items.filter((item) => bijouVisible(item, contenu));

    const ligne = document.createElement('div');
    ligne.className = 'wh-tier';

    const rang = document.createElement('div');
    // Le rang colore la ligne : S en tete, puis on descend. Au-dela de la 5e lettre
    // on retombe sur le style neutre plutot que d'inventer une couleur.
    rang.className = `wh-rang wh-rang--${(tier.rank || '?').toLowerCase().replace(/[^a-z0-9]/g, '') || 'x'}`;
    rang.textContent = tier.rank;
    ligne.appendChild(rang);

    const corps = document.createElement('div');
    corps.className = 'wh-contenu';

    if (!visibles.length) {
      const vide = document.createElement('span');
      vide.className = 'wh-vide';
      vide.textContent = contenu ? 'rien dans ce contenu' : 'rien avec ces filtres';
      corps.appendChild(vide);
    }

    for (const item of visibles) {
      const carte = document.createElement('span');
      carte.className = `wh-bijou${guideIds.has(item.itemId) ? ' wh-bijou--bis' : ''}`;
      // Une categorie donne sa couleur de contour, comme les cases de filtre.
      const cat = (item.categories || []).find((c) =>
        contenu ? c === (contenu === 'raid' ? 'raid' : 'dungeon') : wowheadFiltres.has(c)
      );
      if (cat) carte.classList.add(`wh-bijou--${cat}`);

      carte.appendChild(iconEl(item.icon || iconForItemId(item.itemId), 'wh-icone', ''));

      // Meme mecanique que partout ailleurs : l'embed Wowhead nomme et colore le lien,
      // et le localise en francais quand la langue l'est.
      const lien = document.createElement('a');
      lien.className = 'wh-nom';
      lien.href = itemUrl(item.itemId);
      lien.target = '_blank';
      lien.rel = 'noopener noreferrer';
      lien.dataset.wowhead = `item=${item.itemId}${LANG === 'fr' ? '&domain=fr' : ''}`;
      lien.textContent = item.name || `objet ${item.itemId}`;
      carte.appendChild(lien);

      if (guideIds.has(item.itemId)) {
        const flag = document.createElement('span');
        flag.className = 'tp-flag';
        flag.textContent = 'BiS';
        flag.title = 'Retenu dans la liste BiS du guide Icy Veins';
        carte.appendChild(flag);
      }

      const provenance = (item.categories || [])
        .map((c) => (WOWHEAD_CATEGORIES.find((x) => x.slug === c) || {}).label || c)
        .join(', ');
      carte.title = [`Rang ${tier.rank}`, provenance || null].filter(Boolean).join(' — ');
      corps.appendChild(carte);
    }

    ligne.appendChild(corps);
    grille.appendChild(ligne);
  }

  panel.appendChild(grille);
  return panel;
}

function renderTrinketPanel(sim, guideTrinkets, contenu, sourceKinds) {
  const panel = document.createElement('div');
  panel.className = 'trinket-panel';

  const head = document.createElement('div');
  head.className = 'tp-head';
  head.textContent = 'Bijoux — meilleurs choix simulés';

  const source = document.createElement('span');
  source.className = 'tp-source';
  const oneTarget = sim.targets && sim.targets['1'];
  source.textContent = oneTarget && oneTarget.simulatedAt
    ? `Bloodmallet · simulé le ${oneTarget.simulatedAt} UTC`
    : 'Bloodmallet';
  head.appendChild(source);
  panel.appendChild(head);

  const cols = document.createElement('div');
  cols.className = 'tp-cols';

  const guideIds = new Set(guideTrinkets.map((t) => t.itemId));

  for (const count of [1, 3, 5]) {
    const col = document.createElement('div');
    col.className = 'tp-col';

    const title = document.createElement('div');
    title.className = 'tp-title';
    title.textContent = `${count} cible${count > 1 ? 's' : ''}`;
    col.appendChild(title);

    const data = sim.targets && sim.targets[String(count)];
    if (!data || !data.available || !data.trinkets.length) {
      const none = document.createElement('div');
      none.className = 'tp-empty';
      none.textContent = 'non simulé';
      col.appendChild(none);
      cols.appendChild(col);
      continue;
    }

    const eligibles = data.trinkets.filter((t) =>
      bijouDansContenu(t.itemId, contenu, sourceKinds, t.source, sim.key)
    );
    if (!eligibles.length) {
      const none = document.createElement('div');
      none.className = 'tp-empty';
      none.textContent = 'aucun dans ce contenu';
      col.appendChild(none);
      cols.appendChild(col);
      continue;
    }

    // L'ecart en % se lit toujours par rapport au meilleur bijou toutes provenances
    // confondues : c'est ce qu'on perd a se limiter a ce contenu.
    const best = data.trinkets[0];
    for (const trinket of eligibles.slice(0, SIM_TRINKET_COUNT)) {
      const row = document.createElement('div');
      row.className = `tp-item${guideIds.has(trinket.itemId) ? ' tp-item--bis' : ''}`;

      row.appendChild(iconEl(iconForItemId(trinket.itemId), 'tp-icon', ''));

      const body = document.createElement('div');
      body.className = 'tp-body';

      const link = document.createElement('a');
      link.className = 'item-link';
      link.href = itemUrl(trinket.itemId);
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.dataset.wowhead = `item=${trinket.itemId}${LANG === 'fr' ? '&domain=fr' : ''}`;
      link.textContent = (LANG === 'fr' && trinket.nameFr) || trinket.name;
      body.appendChild(link);

      const meta = document.createElement('div');
      meta.className = 'tp-meta';
      // En dessous de 0,05 % l'ecart s'affiche "-0,0 %" : autant ne rien mettre.
      const gap = best.dps ? ((trinket.dps - best.dps) / best.dps) * 100 : 0;
      const delta =
        Math.abs(gap) >= 0.05 ? ` · ${gap.toFixed(1).replace('.', ',')} %` : '';
      meta.textContent = `#${trinket.rank}${delta}`;
      if (trinket.source) meta.textContent += ` · ${trinket.source}`;
      body.appendChild(meta);

      row.appendChild(body);

      if (guideIds.has(trinket.itemId)) {
        const flag = document.createElement('span');
        flag.className = 'tp-flag';
        flag.textContent = 'BiS';
        flag.title = 'Également retenu par le guide Icy Veins';
        row.appendChild(flag);
      }

      row.title = `${trinket.name} — ilvl ${trinket.ilvl} · ${trinket.dps} dps simulés`;
      col.appendChild(row);
    }

    cols.appendChild(col);
  }

  panel.appendChild(cols);
  return panel;
}

function paperdollCard(item, sourceKinds, specKey) {
  const card = document.createElement('div');
  card.className = `pd-item pd-item--${item.align === 'right' ? 'right' : 'left'}`;
  if (item.empty) card.classList.add('pd-item--empty');
  if (item.catalyst) card.classList.add('pd-item--catalyst');

  // Provenance de la pièce : raid ou donjon. Elle colore un liseré sur le bord de
  // la carte — pas la bordure, déjà prise par la mention Catalyseur. Les mêmes
  // couleurs que la tier list Wowhead, pour qu'un bleu veuille dire « donjon » partout.
  const provenance = sourceKinds && item.source ? sourceKinds.get(item.source) : null;
  if (provenance === 'raid' || provenance === 'dungeon') {
    card.classList.add(`pd-item--${provenance}`);
  }

  // Pièce de set à récupérer en donjon : c'est la plus contraignante à obtenir
  // (il faut farmer le donjon puis catalyser), donc elle est mise en avant.
  if (item.catalyst && sourceKinds && sourceKinds.get(item.source) === 'dungeon') {
    card.classList.add('pd-item--dungeon-set');
    card.title = 'Pièce de set à récupérer en donjon, puis à transformer au Catalyseur.';
  }

  const icon = document.createElement('img');
  icon.className = 'pd-icon';
  icon.loading = 'lazy';
  icon.alt = '';
  icon.src = item.empty
    ? iconUrl('inv_misc_questionmark')
    : iconUrl(item.icon);

  const body = document.createElement('div');
  body.className = 'pd-body';

  if (item.empty) {
    const slot = document.createElement('div');
    slot.className = 'pd-slot';
    slot.textContent = slotName(item);
    body.appendChild(slot);
    card.append(icon, body);
    return card;
  }

  const nameRow = document.createElement('div');
  nameRow.className = 'pd-name';
  nameRow.appendChild(itemLink(item));

  const slot = document.createElement('div');
  slot.className = 'pd-slot';
  slot.textContent = slotName(item);

  const footer = document.createElement('div');
  footer.className = 'pd-footer';
  footer.appendChild(sourceLine(item));


  if (item.enchant) {
    const ench = document.createElement('span');
    ench.className = 'pd-enchant';
    ench.appendChild(iconEl(item.enchant.icon, 'pd-mini-icon', ''));
    const name = document.createElement('span');
    name.textContent = item.enchant.name || 'Enchantement';
    ench.appendChild(name);
    ench.title = `Enchantement : ${item.enchant.name || ''}`;
    footer.appendChild(ench);
  }

  body.append(nameRow, slot, footer);
  card.append(icon, body);

  if (item.gems && item.gems.length) {
    const gems = document.createElement('div');
    gems.className = 'pd-gems';
    for (const gem of item.gems) {
      const gemIcon = iconEl(gem.icon, 'pd-mini-icon', gem.name || '');
      gemIcon.title = gem.name || 'Gemme';
      gems.appendChild(gemIcon);
    }
    card.appendChild(gems);
  }

  return card;
}

/**
 * Presentation "feuille de personnage" : deux colonnes d'emplacements, armes en bas,
 * reprise de la mise en page du guide Icy Veins. L'ordre des objets alterne deja
 * gauche/droite, on le conserve tel quel dans une grille a deux colonnes.
 */
function renderList(entry, key) {
  if (!entry) {
    return emptyState(
      'Aucune donnée en cache',
      'Clique sur « Mettre à jour » pour remplir cette spec.'
    );
  }

  const items = itemsOf(entry, key);
  const isWeapon = (item) =>
    ['Main droite', 'Main gauche', 'Arme', 'Arme à deux mains', 'Bouclier'].includes(
      item.slotFr
    );

  const sourceKinds = classifySources();
  const sim = trinketStore.specs[key];
  const isTrinket = (item) => slotFrOf(item) === 'Bijou';
  // Quand la spec est simulee, les bijoux quittent la grille pour leur propre
  // panneau a trois colonnes ; sinon ils restent des cartes comme les autres,
  // completees par les recommandations du guide.
  const useSimPanel = Boolean(sim && sim.available);

  const wrap = document.createElement('div');
  wrap.className = 'paperdoll';

  // Une couleur sans mode d'emploi ne dit rien : la légende n'apparaît que si les
  // deux provenances sont effectivement représentées dans la liste affichée.
  const provenances = new Set(
    items
      .filter((i) => !i.empty && i.source)
      .map((i) => sourceKinds.get(i.source))
      .filter((k) => k === 'raid' || k === 'dungeon')
  );
  if (provenances.size > 1) {
    const legende = document.createElement('div');
    legende.className = 'pd-legende';
    for (const [kind, label] of [
      ['raid', 'Raid'],
      ['dungeon', 'Mythique+'],
    ]) {
      const chip = document.createElement('span');
      chip.className = `pd-legende-item pd-legende-item--${kind}`;
      chip.textContent = label;
      legende.appendChild(chip);
    }
    wrap.appendChild(legende);
  }

  const grid = document.createElement('div');
  grid.className = 'pd-grid';
  for (const item of items.filter((i) => !isWeapon(i) && !(useSimPanel && isTrinket(i)))) {
    grid.appendChild(paperdollCard(item, sourceKinds, key));
  }
  wrap.appendChild(grid);

  // La simulation d'abord — c'est la lecture chiffree, celle qui tranche — puis une
  // seule des deux listes editoriales, au choix.
  // La liste choisie (Overall / Mythic+ / Raid) vaut aussi pour les bijoux : sur une
  // liste ciblee, on ne propose que ce qui tombe dans ce contenu.
  const contenu = contenuListe(entry, key);
  const bijoux = items.filter(isTrinket);
  for (const panneau of [
    useSimPanel ? renderTrinketPanel(sim, bijoux, contenu, sourceKinds) : null,
    renderListeBijoux(entry, key, bijoux, contenu, sourceKinds),
  ]) {
    if (panneau) wrap.appendChild(panneau);
  }

  const weapons = items.filter(isWeapon);
  if (weapons.length) {
    const row = document.createElement('div');
    row.className = 'pd-weapons';
    for (const item of weapons) row.appendChild(paperdollCard(item, sourceKinds, key));
    wrap.appendChild(row);
  }

  return wrap;
}

/* ---------------- normalisation des sources ---------------- */

/**
 * Chaque guide ecrit ses sources a sa facon : "The Coiled Altar", "The Coiled Alter (Raid)"
 * (faute de frappe de l'auteur), "Tier Set | The Coiled Altar"... Sans regroupement, un meme
 * boss se retrouve eclate en 3 ou 4 entrees et les comptages de joueurs sont faux.
 *
 * On ne fusionne que ce qui est demontrable : qualificatifs entre parentheses, suffixes
 * generiques, ponctuation, et fautes de frappe a une lettre pres. Deux noms reellement
 * differents (ex. "Nymrissa Wavecaller" et "Nymrissa Wavebinder") restent separes.
 */
const GENERIC_SOURCE_PART = /^(tier set|catalyst|raid|vault|great vault|trash|misc)$/i;
const CRAFT_SYNONYM = /^(craft|crafted|crafting|crafting\/misc)$/i;
const COMBINING = /[̀-ͯ]/g;

/**
 * Fusions que les donnees ne permettent pas de deduire : deux auteurs designent la
 * meme rencontre par des noms sans rapport. A completer a la main, connaissance du
 * jeu a l'appui — c'est la seule facon de trancher ces cas.
 */
const SOURCE_MERGES = {
  'Tidebound Grotto': 'Nymrissa Wavecaller',
};

function cleanSourceLabel(raw) {
  let label = String(raw || '').trim();
  if (SOURCE_MERGES[label]) return SOURCE_MERGES[label];
  label = label.replace(/\([^)]*\)/g, ' '); // "(Raid)", "(Heroic & Mythic)"
  label = label.replace(/&\s*catalyst/gi, ' ');
  label = label.replace(/\s+/g, ' ').trim();

  // "Tier Set | The Coiled Altar", "Tier Set - Ula'tek" : on garde la partie specifique.
  // Separateurs espaces uniquement : des noms de boss contiennent un tiret (Nexus-King).
  const parts = label.split(/\s+\|\s+|\s+-\s+/).map((p) => p.trim()).filter(Boolean);
  if (parts.length > 1) label = parts.find((p) => !GENERIC_SOURCE_PART.test(p)) || parts[0];

  if (CRAFT_SYNONYM.test(label)) label = 'Craft';
  return label || 'Source inconnue';
}

function sourceKey(label) {
  return label
    .normalize('NFD')
    .replace(COMBINING, '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, '')
    .replace(/^the /, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Distance d'edition <= 1, pour rattraper "Altar"/"Alter" ou "Entombed"/"Entomed". */
function withinOneEdit(a, b) {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < short.length && j < long.length) {
    if (short[i] === long[j]) {
      i += 1;
      j += 1;
      continue;
    }
    edits += 1;
    if (edits > 1) return false;
    if (short.length === long.length) i += 1;
    j += 1;
  }
  return true;
}

/**
 * Un nom en contient un autre, aux frontieres de mots : les auteurs tronquent les noms
 * de boss ("Vashnik" / "Vashnik the Malignant", "Trash Drop" / "BoE Trash Drop").
 */
function containsName(long, short) {
  if (long === short) return true;
  // Seuil plus bas que pour la distance d'edition : reconnaitre un nom complet a
  // l'interieur d'un autre est bien moins risque que de tolerer une faute de frappe.
  if (short.length < 6 || short.length >= long.length) return false;
  const index = long.indexOf(short);
  if (index === -1) return false;
  const startsOnWord = index === 0 || long[index - 1] === ' ';
  const endsOnWord =
    index + short.length === long.length || long[index + short.length] === ' ';
  return startsOnWord && endsOnWord;
}

/**
 * Construit la table "libelle brut -> libelle canonique".
 * Le libelle retenu est la variante la plus frequente, et les cles trop courtes ne sont
 * jamais fusionnees par distance d'edition (trop risque sur des noms courts).
 */
function buildSourceIndex(rawLabels) {
  const counts = new Map();
  for (const raw of rawLabels) {
    const label = cleanSourceLabel(raw);
    const key = sourceKey(label);
    if (!counts.has(key)) counts.set(key, new Map());
    const variants = counts.get(key);
    variants.set(label, (variants.get(label) || 0) + 1);
  }

  const canonical = new Map(); // cle -> cle canonique
  const ordered = Array.from(counts.keys()).sort((a, b) => {
    const ca = Array.from(counts.get(a).values()).reduce((s, n) => s + n, 0);
    const cb = Array.from(counts.get(b).values()).reduce((s, n) => s + n, 0);
    return cb - ca || a.localeCompare(b);
  });

  for (const key of ordered) {
    const match = Array.from(canonical.values()).find(
      (existing) =>
        (key.length >= 8 && existing.length >= 8 && withinOneEdit(key, existing)) ||
        containsName(existing, key) ||
        containsName(key, existing)
    );
    canonical.set(key, match || key);
  }

  // Libelle affiche : la variante la plus frequente du groupe canonique.
  const labelByCanonical = new Map();
  for (const [key, variants] of counts) {
    const target = canonical.get(key);
    if (!labelByCanonical.has(target)) labelByCanonical.set(target, new Map());
    const bucket = labelByCanonical.get(target);
    for (const [label, n] of variants) bucket.set(label, (bucket.get(label) || 0) + n);
  }

  const index = new Map();
  for (const raw of rawLabels) {
    const target = canonical.get(sourceKey(cleanSourceLabel(raw)));
    const bucket = labelByCanonical.get(target);
    // Libelle affiche : le nom le plus complet du groupe ("Vashnik the Malignant"
    // plutot que "Vashnik"), la frequence ne servant qu'a departager.
    const best = Array.from(bucket.entries()).sort(
      (a, b) => b[0].length - a[0].length || b[1] - a[1] || a[0].localeCompare(b[0], 'fr')
    )[0][0];
    index.set(raw, best);
  }
  return index;
}

/* ---------------- vue M+ opti ---------------- */

/**
 * Butin de donjon de TOUTES les specs jouees, en une passe.
 *
 * La normalisation des sources est couteuse : on la fait une fois pour tout le
 * monde, au lieu de la refaire par spec. Sert a la fois au classement de la spec
 * affichee et au reperage des copains qui ont interet a farmer le meme donjon.
 */
function buildDungeonIndex() {
  // `played` sert uniquement a nommer les camarades ; l'indexation, elle, couvre toutes
  // les specs en cache, une spec sans joueur gardant ses propres donjons a farmer.
  const played = membersBySpec();
  const usedSpecs = specsAvecCache();

  const sourceIndex = buildSourceIndex(
    usedSpecs.flatMap((spec) =>
      allBisEntries(entryFor(spec.key)).map((e) => e.item.source || 'Source inconnue')
    )
  );

  // La nature d'une source est deduite de l'ensemble des guides, puis reportee
  // sur le libelle canonique utilise ici.
  const kinds = new Map();
  for (const [raw, kind] of classifySources()) {
    const canonical = sourceIndex.get(raw) || cleanSourceLabel(raw);
    if (kind === 'raid' || !kinds.has(canonical)) kinds.set(canonical, kind);
  }

  const bySpec = new Map();
  for (const spec of usedSpecs) {
    const byDungeon = new Map();
    for (const { item, listLabel } of allBisEntries(entryFor(spec.key))) {
      const raw = item.source || 'Source inconnue';
      const source = sourceIndex.get(raw) || raw;
      if (kinds.get(source) !== 'dungeon') continue;

      if (!byDungeon.has(source)) byDungeon.set(source, new Map());
      const items = byDungeon.get(source);
      const id = String(item.itemId);
      if (!items.has(id)) items.set(id, { item, lists: new Set(), sim: null });
      items.get(id).lists.add(listLabel);
    }

    // Bijoux du haut de classement Bloodmallet qui tombent en donjon : ils
    // comptent aussi pour le farm, avec leur rang par nombre de cibles.
    if (specRoleOf(spec.class, spec.spec) === 'dps') {
      for (const { trinket, ranks } of simulatedTrinkets(spec.key)) {
        const known = itemInfoById(trinket.itemId);
        const raw = (known && known.source) || ITEM_SOURCES[trinket.itemId];
        if (!raw) continue;
        const source = sourceIndex.get(raw) || cleanSourceLabel(raw);
        if (kinds.get(source) !== 'dungeon') continue;

        if (!byDungeon.has(source)) byDungeon.set(source, new Map());
        const items = byDungeon.get(source);
        const id = String(trinket.itemId);

        if (!items.has(id)) {
          items.set(id, {
            item: known || {
              itemId: trinket.itemId,
              name: (LANG === 'fr' && trinket.nameFr) || trinket.name,
              icon: null,
              slot: 'Trinket',
              slotFr: 'Bijou',
              source: raw,
            },
            lists: new Set(),
            sim: null,
          });
        }
        items.get(id).sim = ranks;
      }
    }

    bySpec.set(spec.key, byDungeon);
  }

  return { bySpec, played, usedSpecs };
}

// Reduites a l'icone de spec et au compte, les pastilles tiennent toutes sur une
// ligne : plus besoin d'ecarter les petits scores ni d'en replier une partie.
const COMPANION_MIN = 1;

/**
 * Autres joueurs ayant du BiS dans ce donjon, le plus fourni d'abord.
 * C'est ce qui permet de voir avec qui grouper.
 */
function dungeonCompanions(index, dungeon, exceptKey) {
  const rows = [];
  for (const [specKey, byDungeon] of index.bySpec) {
    if (specKey === exceptKey) continue;
    const items = byDungeon.get(dungeon);
    if (!items || items.size < COMPANION_MIN) continue;
    for (const member of index.played.get(specKey) || []) {
      rows.push({ member, count: items.size });
    }
  }
  return rows.sort(
    (a, b) => b.count - a.count || a.member.name.localeCompare(b.member.name, 'fr')
  );
}

/**
 * Pastille "icone de spec + nombre de BiS ici", le pseudo restant dans l'infobulle.
 * Sert aussi bien dans les cartes de donjon que sous l'en-tete d'un bloc M+ opti.
 */
function companionChip(member, total) {
  const chip = document.createElement('span');
  chip.className = `companion${member.star ? ' companion--star' : ''}`;
  chip.style.setProperty('--spec', classColor(member.class));
  chip.appendChild(iconEl(specIcon(member.class, member.spec), 'companion-icon', ''));

  const compte = document.createElement('span');
  compte.className = 'companion-count';
  compte.textContent = total;
  chip.appendChild(compte);

  chip.title = `${member.name} — ${specLabelOf(member)} — ${total} pièce(s) BiS ici`;
  return chip;
}

/**
 * Classement des donjons pour une spec : dans lequel y a-t-il le plus de BiS a aller
 * chercher ? On balaie toutes les listes du guide (Overall, Mythic+, talents de heros),
 * on ne garde que les sources classees "donjon", et on dedoublonne par objet.
 */
function dungeonRanking(specKey, index) {
  const byDungeon = (index || buildDungeonIndex()).bySpec.get(specKey);
  if (!byDungeon) return [];

  return Array.from(byDungeon.entries())
    .map(([name, items]) => {
      const list = Array.from(items.values()).sort(
        (a, b) => slotRank(a.item) - slotRank(b.item)
      );
      // Un objet BiS toutes sources confondues vaut plus qu'un BiS propre au
      // Mythique+ : c'est lui qui restera equipe une fois le raid farme.
      const overall = list.filter((x) =>
        Array.from(x.lists).some((l) => /overall/i.test(l))
      ).length;
      return { name, items: list, overall };
    })
    .sort(
      (a, b) =>
        b.overall - a.overall ||
        b.items.length - a.items.length ||
        a.name.localeCompare(b.name, 'fr')
    );
}

/**
 * Carte d'un donjon en tete de M+ opti : visuel, rang, nombre de BiS pour la spec
 * affichee, et les camarades qui ont interet a le farmer aussi. Un clic amene au bloc
 * detaille plus bas et estompe les autres ; un second clic remet tout a plat.
 */
function mplusCard(dungeon, position, index, specKey) {
  const cible = mplusFocus === dungeon.name;
  const card = document.createElement('button');
  card.type = 'button';
  card.className = [
    'dungeon-card',
    cible ? 'dungeon-card--cible' : '',
    mplusFocus && !cible ? 'dungeon-card--estompe' : '',
  ]
    .filter(Boolean)
    .join(' ');

  const visuel = document.createElement('div');
  visuel.className = 'dungeon-visuel';
  const img = dungeonImage(dungeon.name);
  if (img) {
    const el = document.createElement('img');
    el.src = `img/${img}`;
    el.alt = '';
    el.loading = 'lazy';
    visuel.appendChild(el);
  } else {
    visuel.classList.add('dungeon-visuel--vide');
  }

  const nom = document.createElement('div');
  nom.className = 'dungeon-nom';
  nom.textContent = `#${position + 1} · ${translateSource(dungeon.name)}`;

  const compte = document.createElement('span');
  compte.className = 'dungeon-compte';
  compte.textContent = dungeon.overall
    ? `${dungeon.items.length} BiS · dont ${dungeon.overall} général`
    : `${dungeon.items.length} BiS`;

  const specs = document.createElement('div');
  specs.className = 'dungeon-specs';
  for (const { member, count } of dungeonCompanions(index, dungeon.name, specKey)) {
    specs.appendChild(companionChip(member, count));
  }

  card.title = cible ? 'Revenir à la liste complète' : 'Aller à ce donjon';
  card.append(visuel, nom, compte, specs);
  card.addEventListener('click', () => {
    mplusFocus = cible ? null : dungeon.name;
    render();
    if (!mplusFocus) return;
    // Le rendu vient de recreer les blocs : on cherche la cible dans le DOM neuf.
    // Comparaison sur le dataset plutot qu'un selecteur : les noms de donjons
    // contiennent des apostrophes ("King's Rest").
    const bloc = Array.from(els.content.querySelectorAll('.mplus-block')).find(
      (b) => b.dataset.donjon === mplusFocus
    );
    if (bloc) bloc.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  return card;
}

function renderMplus() {
  const spec = activeSpec();
  if (!spec) {
    return emptyState('Aucune spec sélectionnée', 'Choisis une spec en haut de page.');
  }

  const index = buildDungeonIndex();
  const ranking = dungeonRanking(spec.key, index);
  if (!ranking.length) {
    return emptyState(
      'Aucun donjon à optimiser',
      entryFor(spec.key)
        ? 'Aucune pièce BiS de cette spec ne vient d’un donjon.'
        : 'Mets cette spec à jour pour remplir ses listes BiS.'
    );
  }

  const total = ranking.reduce((n, d) => n + d.items.length, 0);
  const totalOverall = ranking.reduce((n, d) => n + d.overall, 0);

  const wrap = document.createElement('div');
  wrap.className = 'mplus';

  const intro = document.createElement('p');
  intro.className = 'mplus-intro';
  intro.textContent =
    `${total} pièce(s) BiS à récupérer en donjon sur ${ranking.length} donjon(s), ` +
    `dont ${totalOverall} qui reste(nt) BiS toutes sources confondues. ` +
    'Classement par nombre de BiS généraux, puis par total.';
  wrap.appendChild(intro);

  // Le donjon mis en avant peut avoir disparu (changement de spec, nouveau scrape).
  if (mplusFocus && !ranking.some((d) => d.name === mplusFocus)) mplusFocus = null;

  // Index visuel en tete : de quels donjons faut-il faire tomber du stuff.
  const grille = document.createElement('div');
  grille.className = 'dungeon-grid mplus-grid';
  ranking.forEach((dungeon, position) =>
    grille.appendChild(mplusCard(dungeon, position, index, spec.key))
  );
  wrap.appendChild(grille);

  // `position` et non `index` : le second masquerait l'index des donjons ci-dessus.
  ranking.forEach((dungeon, position) => {
    const block = document.createElement('section');
    const cible = mplusFocus === dungeon.name;
    block.className = `mplus-block${mplusFocus && !cible ? ' mplus-block--estompe' : ''}${
      cible ? ' mplus-block--cible' : ''
    }`;
    block.dataset.donjon = dungeon.name;

    const head = document.createElement('div');
    head.className = 'mplus-head';

    const rank = document.createElement('span');
    rank.className = 'mplus-rank';
    rank.textContent = `#${position + 1}`;

    const name = document.createElement('span');
    name.className = 'mplus-name';
    name.textContent = translateSource(dungeon.name);

    const count = document.createElement('span');
    count.className = 'mplus-count';
    count.textContent = `${dungeon.items.length} BiS`;
    head.append(rank, name, count);

    if (dungeon.overall) {
      const strong = document.createElement('span');
      strong.className = 'mplus-count mplus-count--overall';
      strong.textContent = `dont ${dungeon.overall} général`;
      strong.title =
        'Pièces BiS toutes sources confondues : elles resteront équipées même une fois le raid farmé.';
      head.appendChild(strong);
    }
    block.appendChild(head);

    // Qui d'autre a interet a farmer ce donjon : de quoi monter un groupe.
    const companions = dungeonCompanions(index, dungeon.name, spec.key);
    if (companions.length) {
      const row = document.createElement('div');
      row.className = 'mplus-companions';

      const label = document.createElement('span');
      label.className = 'mplus-companions-label';
      label.textContent = 'à farmer aussi pour :';
      row.appendChild(label);

      // Icone de spec + nombre de BiS, sans le pseudo : le nom reste dans
      // l'infobulle, et tout le roster concerne tient sur une ligne ou deux.
      for (const { member, count } of companions) row.appendChild(companionChip(member, count));

      block.appendChild(row);
    }

    const list = document.createElement('div');
    list.className = 'mplus-items';

    for (const { item, lists, sim } of dungeon.items) {
      // Un BiS toutes sources confondues restera équipé une fois le raid farmé :
      // on l'encadre pour le distinguer d'un BiS propre au Mythique+.
      const overall = Array.from(lists).some((l) => /overall/i.test(l));

      const row = document.createElement('div');
      row.className = `mplus-item${overall ? ' mplus-item--overall' : ''}`;
      if (overall) row.title = 'BiS toutes sources confondues';

      row.appendChild(iconEl(item.icon, 'mplus-icon', ''));

      const body = document.createElement('div');
      body.className = 'mplus-body';
      body.appendChild(itemLink(item));

      const meta = document.createElement('div');
      meta.className = 'mplus-meta';
      meta.textContent = slotName(item);

      // Un objet BiS uniquement dans la liste Mythic+ n'a pas le meme poids qu'un
      // BiS toutes sources confondues : on le precise. Sans liste du tout, l'objet
      // vient uniquement de la simulation, et le tag n'aurait pas de sens.
      if (!overall && lists.size) {
        const tag = document.createElement('span');
        tag.className = 'mplus-tag';
        tag.textContent = 'liste M+';
        tag.title = `BiS dans la liste ${Array.from(lists).join(', ')} uniquement`;
        meta.appendChild(document.createTextNode(' · '));
        meta.appendChild(tag);
      }

      // Rang Bloodmallet par nombre de cibles : « 1c #2 · 3c #1 ».
      if (sim) {
        const tag = document.createElement('span');
        tag.className = 'mplus-tag mplus-tag--sim';
        tag.textContent = [1, 3, 5]
          .filter((t) => sim[t])
          .map((t) => `${t}c #${sim[t]}`)
          .join(' · ');
        tag.title = 'Classement Bloodmallet, par nombre de cibles simulées';
        meta.appendChild(document.createTextNode(' · '));
        meta.appendChild(tag);
      }

      body.appendChild(meta);
      row.appendChild(body);

      if (item.catalyst) {
        const chip = document.createElement('span');
        chip.className = 'pd-catalyst';
        chip.textContent = 'Catalyseur';
        chip.title =
          'Ramasser la pièce du même emplacement dans ce donjon, puis la transformer au Catalyseur.';
        row.appendChild(chip);
      }

      list.appendChild(row);
    }

    block.appendChild(list);
    wrap.appendChild(block);
  });

  return wrap;
}

/* ---------------- vue butin par boss ---------------- */

/** Specs prises en compte : celles jouees dans le roster, sinon tout ce qui est en cache. */
/**
 * Specs dont on a les listes, qu'elles soient jouees ou non.
 *
 * A distinguer de `scoredSpecs()` : le butin de guilde n'a de sens qu'avec des joueurs
 * devant, mais tout ce qui decrit une spec pour elle-meme — sa liste BiS, ses donjons a
 * farmer, ses consommables — reste valable meme si personne ne la joue en ce moment.
 * Un reroll ne doit pas vider ses vues.
 */
function specsAvecCache() {
  return visibleSpecs().filter((s) => entryFor(s.key));
}

function scoredSpecs() {
  const played = membersBySpec();
  const cached = visibleSpecs().filter((s) => entryFor(s.key));
  return {
    played,
    specs: played.size ? cached.filter((s) => played.has(s.key)) : cached,
  };
}

/**
 * Classe chaque source en raid / donjon / autre.
 *
 * Pas de liste codee en dur : chaque guide publie une liste "Raid" et une liste
 * "Mythic+", donc la nature d'une source se deduit de la liste ou elle apparait.
 * (C'est ainsi qu'on voit que Tidebound Grotto est bien une source de raid.)
 */
function classifySources() {
  // Toutes les specs en cache : la nature d'une source est un fait des guides, pas
  // une consequence de la composition du roster.
  const usedSpecs = specsAvecCache();
  const counts = new Map();

  for (const spec of usedSpecs) {
    for (const list of listsOf(entryFor(spec.key))) {
      const isRaid = /raid/i.test(list.label || '');
      const isDungeon = /mythic|m\+/i.test(list.label || '');
      if (!isRaid && !isDungeon) continue;

      for (const item of list.items) {
        if (item.empty || !item.source) continue;
        if (!counts.has(item.source)) counts.set(item.source, { raid: 0, dungeon: 0 });
        counts.get(item.source)[isRaid ? 'raid' : 'dungeon'] += 1;
      }
    }
  }

  // Les metiers ne sont pas des donjons, meme quand un auteur les cite dans sa
  // liste Mythique+ (le Marche-vent y met "Tailoring" pour sa cape).
  const PROFESSION =
    /^(tailoring|blacksmithing|leatherworking|jewelcrafting|inscription|alchemy|enchanting|engineering|couture|forge)$/i;

  const kinds = new Map();
  for (const [source, { raid, dungeon }] of counts) {
    if (/^craft|catalyseur|trash/i.test(source) || PROFESSION.test(source)) {
      kinds.set(source, 'other');
    }
    else if (raid > dungeon) kinds.set(source, 'raid');
    else if (dungeon > 0) kinds.set(source, 'dungeon');
    else kinds.set(source, 'other');
  }
  return kinds;
}

/**
 * Regroupe le butin par source (boss / donjon / craft) en nommant, pour chaque objet,
 * les membres du roster pour qui il est BiS.
 */
// Ordre d'affichage des emplacements dans la vue butin par boss.
// Valeurs telles que stockees par le parseur ; l'affichage passe par SLOT_ALIASES_FR
// (Poignets -> Brassards, Taille -> Ceinture, Cou -> Collier).
const SLOT_ORDER = [
  'Tête',
  'Épaules',
  'Cape',
  'Torse',
  'Poignets', // brassards
  'Mains',
  'Taille', // ceinture
  'Jambes',
  'Pieds',
  'Cou', // collier
  'Anneau',
  'Bijou',
  // Les armes ferment la marche, toutes catégories confondues.
  'Main droite',
  'Main gauche',
  'Arme',
  'Arme à une main',
  'Arme à deux mains',
  'Bouclier',
  'Distance',
];

function slotRank(item) {
  const index = SLOT_ORDER.indexOf(slotFrOf(item));
  return index === -1 ? SLOT_ORDER.length : index;
}

/** Toutes les entrees BiS d'une spec, avec le nom de la liste d'ou elles viennent. */
function allBisEntries(entry) {
  return listsOf(entry).flatMap((list) =>
    list.items
      .filter((item) => !item.empty && item.itemId)
      .map((item) => ({ item, listLabel: list.label }))
  );
}

// Bijoux que Bloodmallet situe seulement par categorie, sans boss precis.
const RAID_UNKNOWN = 'Raid — boss non précisé';
const DUNGEON_UNKNOWN = 'Donjon — non précisé';

/**
 * Provenances renseignees a la main, pour les objets qu'aucune liste Icy Veins ne
 * mentionne : Bloodmallet ne donne alors que la categorie ("Raid"), jamais le boss.
 * Une ligne par objet, la clef est son identifiant Wowhead.
 *
 * La provenance se lit sur la fiche Wowhead de l'objet, section « Dropped by » : elle
 * nomme le PNJ et son donjon. On note ici le donjon ou le boss, tel qu'ecrit par les
 * guides, pas le PNJ — c'est ce libelle qui regroupe l'objet avec les autres drops.
 */
const ITEM_SOURCES = {
  270169: 'Coiled Altar', // Idole funeste du seigneur des maléfices
  // Bannière de guerre amani en lambeaux : lâchée par Zul'jan, à l'Autel des crochets.
  273797: 'Altar of Fangs',
};

function buildSources() {
  const { played, specs: usedSpecs } = scoredSpecs();
  const sources = new Map();

  // On balaie TOUTES les listes, pas seulement la principale : un objet qui n'est BiS
  // que dans la liste "Raid" ou "Mythic+" concerne quand meme le joueur devant le boss.
  const rawLabels = usedSpecs.flatMap((spec) =>
    allBisEntries(entryFor(spec.key)).map((e) => e.item.source || 'Source inconnue')
  );
  const sourceIndex = buildSourceIndex(rawLabels);

  // La nature de chaque source doit etre connue des le regroupement : le butin de raid
  // ne concerne que le roster mythique, alors que les donjons concernent tout le monde.
  // La classification se fait sur le libelle brut, on la reporte sur le canonique (le
  // regroupement a pu fusionner "Vashnik" et "Vashnik the Malignant").
  const kinds = new Map();
  for (const [raw, kind] of classifySources()) {
    const canonical = sourceIndex.get(raw) || raw;
    if (kind === 'raid' || !kinds.has(canonical)) kinds.set(canonical, kind);
  }
  // Ces deux libelles ne viennent d'aucun guide : leur nature est connue d'avance.
  kinds.set(RAID_UNKNOWN, 'raid');
  kinds.set(DUNGEON_UNKNOWN, 'dungeon');

  for (const spec of usedSpecs) {
    const members = played.get(spec.key) || [];
    // Ceux de la spec qui vont effectivement en raid. Un membre hors roster mythique
    // reste compte partout ailleurs : il fait toujours son Mythique+.
    const enRaid = members.filter((m) => m.raid !== false);

    // Sur une spec DPS simulee, c'est Bloodmallet qui fait foi pour les bijoux :
    // on ignore ceux du guide et on injecte les siens plus bas.
    const simRules =
      specRoleOf(spec.class, spec.spec) === 'dps' && simulatedTrinkets(spec.key).length > 0;

    for (const { item, listLabel } of allBisEntries(entryFor(spec.key))) {
      if (simRules && slotFrOf(item) === 'Bijou') continue;
      const raw = item.source || 'Source inconnue';
      const source = sourceIndex.get(raw) || raw;
      // Devant un boss de raid, seul le roster mythique roule : si personne de la spec
      // n'y va, l'objet ne concerne pas cette spec ici.
      const concernes = kinds.get(source) === 'raid' ? enRaid : members;
      if (!concernes.length) continue;
      if (!sources.has(source)) sources.set(source, new Map());
      const byItem = sources.get(source);

      // Regroupement sur l'objet qui TOMBE ici, pas sur celui qui est affiche :
      // une piece catalysee est obtenue en ramassant sa piece d'origine sur ce boss.
      // Les joueurs qui la catalysent convoitent donc le meme drop que ceux qui la
      // prennent telle quelle, et doivent compter sur la meme ligne.
      const viaCatalyst = Boolean(item.catalyst && item.originalItemId);
      const dropId = String(viaCatalyst ? item.originalItemId : item.itemId);

      if (!byItem.has(dropId)) {
        byItem.set(dropId, {
          dropId,
          direct: null, // l'objet tel qu'il tombe, quand une spec le prend sans catalyser
          viaItems: [], // les pieces de set obtenues en catalysant ce drop
          members: [],
          catalystBy: new Map(), // id de membre -> piece de set visee
          listsBy: new Map(), // id de membre -> listes BiS concernees
          specKeys: new Set(), // specs pour qui cette ligne est BiS
        });
      }
      const row = byItem.get(dropId);
      row.specKeys.add(spec.key);

      if (viaCatalyst) {
        if (!row.viaItems.some((i) => i.itemId === item.itemId)) row.viaItems.push(item);
      } else if (!row.direct) {
        row.direct = item;
      }

      for (const member of concernes) {
        if (!row.members.some((m) => m.id === member.id)) row.members.push(member);
        if (viaCatalyst) row.catalystBy.set(member.id, item);
        if (!row.listsBy.has(member.id)) row.listsBy.set(member.id, new Set());
        row.listsBy.get(member.id).add(listLabel);
      }
    }

    if (!simRules) continue;

    // Bijoux issus de la simulation. Bloodmallet ne donne qu'une categorie
    // ("Raid", "Dungeon", "Profession") : la provenance precise est retrouvee dans
    // les listes Icy Veins, ou a defaut ramenee au craft / a l'inconnu.
    for (const { trinket, targets } of simulatedTrinkets(spec.key)) {
      const known = itemInfoById(trinket.itemId);
      let raw = (known && known.source) || ITEM_SOURCES[trinket.itemId];
      if (!raw) {
        // Aucune liste Icy Veins ne mentionne cet objet : on se rabat sur la
        // categorie donnee par Bloodmallet, qui suffit a le ranger du bon cote du
        // filtre. Sans ca il finissait en "Source inconnue", donc invisible en
        // vue Raid alors que c'est bien un bijou de raid.
        if (/profession|craft/i.test(trinket.source || '')) raw = 'Craft';
        else if (/raid/i.test(trinket.source || '')) raw = RAID_UNKNOWN;
        else if (/dungeon|mythic/i.test(trinket.source || '')) raw = DUNGEON_UNKNOWN;
        else raw = 'Source inconnue';
      }
      const source = sourceIndex.get(raw) || cleanSourceLabel(raw);
      const concernes = kinds.get(source) === 'raid' ? enRaid : members;
      if (!concernes.length) continue;

      if (!sources.has(source)) sources.set(source, new Map());
      const byItem = sources.get(source);
      const id = String(trinket.itemId);

      if (!byItem.has(id)) {
        byItem.set(id, {
          dropId: id,
          direct: {
            itemId: trinket.itemId,
            name: (LANG === 'fr' && trinket.nameFr) || trinket.name,
            icon: (known && known.icon) || null,
            quality: known ? known.quality : null,
            slot: 'Trinket',
            slotFr: 'Bijou',
            source: raw,
            wowheadParams: known ? known.wowheadParams : null,
          },
          viaItems: [],
          members: [],
          catalystBy: new Map(),
          listsBy: new Map(),
          specKeys: new Set(),
        });
      }
      const row = byItem.get(id);
      row.specKeys.add(spec.key);

      const label = `Bloodmallet ${targets.map((t) => `${t}c`).join('/')}`;
      for (const member of concernes) {
        if (!row.members.some((m) => m.id === member.id)) row.members.push(member);
        if (!row.listsBy.has(member.id)) row.listsBy.set(member.id, new Set());
        row.listsBy.get(member.id).add(label);
      }
    }
  }

  return Array.from(sources.entries())
    .map(([name, byItem]) => {
      const items = Array.from(byItem.values())
        .map((row) => ({
          ...row,
          // Representant de la ligne : l'objet tel qu'il tombe si une spec le prend
          // sans catalyser, sinon la piece de set (et la note nommera le drop reel).
          item: row.direct || row.viaItems[0],
          resolved: Boolean(row.direct),
        }))
        // Tri par emplacement (ordre d'une feuille de personnage), puis par nombre
        // de joueurs concernes : on lit le butin d'un boss slot par slot.
        .sort(
          (a, b) =>
            slotRank(a.item) - slotRank(b.item) ||
            b.members.length - a.members.length ||
            (a.item.name || '').localeCompare(b.item.name || '', 'fr')
        );
      const players = new Set();
      for (const row of items) for (const m of row.members) players.add(m.id);
      return { name, items, playerCount: players.size, kind: kinds.get(name) || 'other' };
    })
    .sort(
      (a, b) =>
        b.playerCount - a.playerCount ||
        b.items.length - a.items.length ||
        a.name.localeCompare(b.name, 'fr')
    );
}

/**
 * Pastille "icone de spec + pseudo", coloree par la classe du joueur.
 * `viaItem` est renseigne quand le joueur ne prend pas l'objet tel quel mais le
 * transforme au Catalyseur : la pastille le signale.
 */
function playerChip(member, viaItem, lists) {
  const chip = document.createElement('span');
  chip.className = [
    'player-chip',
    viaItem ? 'player-chip--catalyst' : '',
    member.star ? 'player-chip--star' : '',
    member.trial ? 'player-chip--trial' : '',
  ]
    .filter(Boolean)
    .join(' ');
  const color = classColor(member.class);
  chip.style.setProperty('--spec', color);
  chip.appendChild(iconEl(specIcon(member.class, member.spec), 'chip-icon', ''));

  if (member.star) {
    const star = document.createElement('span');
    star.className = 'chip-star';
    star.textContent = '★';
    chip.appendChild(star);
  }

  const name = document.createElement('span');
  name.textContent = member.name;
  name.style.color = color;

  chip.appendChild(name);

  if (viaItem) {
    const mark = document.createElement('span');
    mark.className = 'chip-catalyst';
    mark.textContent = '⟳';
    chip.appendChild(mark);
  }

  // La liste d'origine compte : un objet BiS seulement dans la liste "Raid" n'a pas
  // le meme poids qu'un BiS toutes sources confondues.
  const parts = [specLabelOf(member)];
  if (member.trial) parts.push('à l’essai');
  if (lists && lists.size) {
    const labels = Array.from(lists);
    // Les bijoux d'une spec DPS simulee viennent de Bloodmallet, pas d'une liste du guide.
    const fromSim = labels.every((l) => /^Bloodmallet/.test(l));
    parts.push(`${fromSim ? 'via' : 'liste'} ${labels.join(', ')}`);
  }
  if (viaItem) parts.push(`à catalyser en « ${viaItem.name} »`);
  chip.title = parts.join(' — ');
  return chip;
}

function specLabelOf(member) {
  const info = classInfo(member.class);
  const spec = (info.specs || []).find((s) => s.slug === member.spec);
  return spec ? `${info.label} — ${spec.label}` : info.label;
}

/** Tableau « qui roll » d'une source donnee. */
function renderLootTable(source) {
  const table = document.createElement('table');
  const thead = document.createElement('thead');
  thead.innerHTML =
    '<tr><th>Objet</th><th>Type</th><th class="col-center">Joueurs</th><th>BiS pour</th></tr>';
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  for (const row of source.items) {
    const tr = document.createElement('tr');

    // La ligne represente ce qui TOMBE sur ce boss. Si aucune spec ne le prend tel
    // quel, on n'a que son identifiant : on affiche un objet de remplacement dont
    // Wowhead resoudra le nom (renameLinks), plutot que d'intituler la ligne avec la
    // piece de set d'une classe alors que les autres joueurs visent la leur.
    const displayItem = row.resolved
      ? row.item
      : {
          itemId: row.item.originalItemId,
          name: `objet ${row.item.originalItemId}`,
          icon: null,
          quality: null,
          slot: row.item.slot,
          slotFr: row.item.slotFr,
        };

    const objTd = document.createElement('td');
    const cell = itemCell(displayItem, slotName(displayItem));

    if (row.catalystBy.size) {
      const note = document.createElement('div');
      note.className = 'drop-note';
      note.textContent = row.resolved
        ? `dont ${row.catalystBy.size} à catalyser en pièce de set`
        : `à catalyser en pièce de set (${row.catalystBy.size} joueur${
            row.catalystBy.size > 1 ? 's' : ''
          })`;
      cell.querySelector('.item-cell > div').appendChild(note);
    }

    objTd.appendChild(cell);

    const typeTd = document.createElement('td');
    typeTd.className = 'col-muted';
    if (row.catalystBy.size) {
      const chip = document.createElement('span');
      chip.className = 'pd-catalyst';
      chip.textContent = 'Catalyseur';
      chip.title =
        'Cet objet tombe ici ; certains joueurs le transforment ensuite en pièce de set au Catalyseur.';
      typeTd.appendChild(chip);
    } else {
      typeTd.textContent = armorType(displayItem) || '—';
    }

    const countTd = document.createElement('td');
    countTd.className = 'col-center';
    countTd.appendChild(
      row.members.length ? badge('players', String(row.members.length)) : badge('none', '-')
    );

    const forTd = document.createElement('td');
    const chips = document.createElement('div');
    chips.className = 'chips';
    for (const member of row.members) {
      chips.appendChild(
        playerChip(member, row.catalystBy.get(member.id), row.listsBy.get(member.id))
      );
    }
    if (!row.members.length) {
      const none = document.createElement('span');
      none.className = 'col-muted';
      none.textContent = 'personne';
      chips.appendChild(none);
    }
    forTd.appendChild(chips);

    tr.append(objTd, typeTd, countTd, forTd);
    tbody.appendChild(tr);
  }

  table.appendChild(tbody);
  return table;
}

/* ---------------- vue /rand ---------------- */

/**
 * Vue de guilde, atteinte par le blason en haut de page. Elle a sa propre
 * navigation — Raid ou Mythique+ — pour ne plus emprunter le selecteur de spec,
 * qui laissait croire qu'elle dependait de la spec affichee.
 */
function randChoice() {
  const wrap = document.createElement('div');
  wrap.className = 'rand-choice';

  // Le roster n'est pas propose ici : il s'ouvre par cinq clics sur la mascotte
  // (voir `armerAccesRoster`). C'est volontairement introuvable sans le savoir.
  for (const [mode, titre, soustitre] of [
    ['raid', 'Raid', 'Rand par boss de raid'],
    ['mplus', 'Mythique+', 'Les BiS des membres de la guilde, triés par donjon'],
  ]) {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'rand-card';

    const t = document.createElement('span');
    t.className = 'rand-card-title';
    t.textContent = titre;

    const s = document.createElement('span');
    s.className = 'rand-card-sub';
    s.textContent = soustitre;

    card.append(t, s);
    card.addEventListener('click', () => {
      randMode = mode;
      activeBoss = null;
      render();
    });
    wrap.appendChild(card);
  }

  return wrap;
}

/**
 * Sources affichees par la vue /rand.
 *
 * En portee 'spec', on ne garde que les lignes dont la spec affichee est preneuse,
 * mais on laisse la ligne entiere : les autres joueurs sont justement ceux contre
 * qui il faudra rand. Une source qui ne concerne plus la spec disparait.
 */
function randSources(kind) {
  const sources = buildSources().filter((s) => s.kind === kind);
  if (randScope !== 'spec' || !activeKey) return sources;

  return sources
    .map((source) => {
      const items = source.items.filter((row) => row.specKeys.has(activeKey));
      if (!items.length) return null;
      const players = new Set();
      for (const row of items) for (const m of row.members) players.add(m.id);
      return { ...source, items, playerCount: players.size };
    })
    .filter(Boolean);
}

/**
 * Bascule Raid / Mythique+ des vues de guilde. Le roster n'y figure pas : c'est une
 * vue cachee, l'annoncer dans une barre la rendrait trouvable.
 */
function randNav() {
  const portee = activeView === 'roster' ? 'guild' : randScope;
  const nav = document.createElement('div');
  nav.className = 'rand-nav';

  for (const [mode, label] of [
    ['raid', 'Raid'],
    ['mplus', 'Mythique+'],
  ]) {
    const btn = document.createElement('button');
    btn.type = 'button';
    const actif = activeView === 'rand' && randMode === mode;
    btn.className = `rand-tab${actif ? ' is-active' : ''}`;
    btn.textContent = label;
    btn.addEventListener('click', () => {
      selectView('rand', portee);
      randMode = mode;
      activeBoss = null;
      render();
    });
    nav.appendChild(btn);
  }

  return nav;
}

/** Carte d'un donjon : visuel, nom, specs concernees, nombre de BiS. */
function dungeonCard(source) {
  const card = document.createElement('button');
  card.type = 'button';
  card.className = 'dungeon-card';

  const visuel = document.createElement('div');
  visuel.className = 'dungeon-visuel';
  const img = dungeonImage(source.name);
  if (img) {
    const el = document.createElement('img');
    el.src = `img/${img}`;
    el.alt = '';
    el.loading = 'lazy';
    visuel.appendChild(el);
  } else {
    visuel.classList.add('dungeon-visuel--vide');
  }

  const nom = document.createElement('div');
  nom.className = 'dungeon-nom';
  nom.textContent = translateSource(source.name);

  const compte = document.createElement('span');
  compte.className = 'dungeon-compte';
  compte.textContent = `${source.items.length} BiS · ${source.playerCount} joueur(s)`;

  // Une pastille par spec concernee, avec SON nombre d'objets ici : une icone seule
  // disait juste « quelqu'un y a un BiS », sans dire si le donjon vaut le detour.
  const parSpec = new Map();
  for (const row of source.items) {
    for (const key of row.specKeys) parSpec.set(key, (parSpec.get(key) || 0) + 1);
  }

  const joueurs = membersBySpec();
  const specs = document.createElement('div');
  specs.className = 'dungeon-specs';

  const classement = Array.from(parSpec.entries())
    .map(([key, total]) => ({ spec: specByKey(key), total }))
    .filter((x) => x.spec)
    .sort((a, b) => b.total - a.total || a.spec.label.localeCompare(b.spec.label, 'fr'));

  for (const { spec, total } of classement) {
    const membres = joueurs.get(spec.key) || [];
    const pastille = document.createElement('span');
    pastille.className = `companion${membres.some((m) => m.star) ? ' companion--star' : ''}`;
    pastille.style.setProperty('--spec', classColor(spec.class));
    pastille.appendChild(iconEl(specIcon(spec.class, spec.spec), 'companion-icon', ''));

    const badge = document.createElement('span');
    badge.className = 'companion-count';
    badge.textContent = total;
    pastille.appendChild(badge);

    pastille.title = [
      spec.label,
      membres.length ? membres.map((m) => m.name).join(', ') : 'personne',
      `${total} objet(s) BiS ici`,
    ].join(' — ');
    specs.appendChild(pastille);
  }

  card.append(visuel, nom, compte, specs);
  card.addEventListener('click', () => {
    activeBoss = source.name;
    render();
  });
  return card;
}

// Point unique de changement de vue : l'onglet actif doit toujours refleter
// activeView, y compris quand le changement vient d'ailleurs que d'un clic d'onglet.
function selectView(view, scope) {
  // La mise en avant d'un donjon n'a de sens que dans M+ opti, et pour la spec qui
  // l'a demandee : elle ne survit pas a un changement de vue.
  if (view !== 'mplus') mplusFocus = null;
  activeView = view;
  if (view === 'rand') randScope = scope || 'spec';
  for (const tab of els.tabs) {
    // L'onglet /rand est dans le groupe Spec : il ne s'allume pas quand la vue vient
    // du blason de guilde, qui ne depend d'aucune spec.
    const actif = tab.dataset.view === view && (view !== 'rand' || randScope === 'spec');
    tab.classList.toggle('is-active', actif);
  }
}

/**
 * Ouvre le /rand de la spec affichee.
 *
 * On ne rand qu'en raid : en Mythique+ le butin est cible, personne ne roule dessus.
 * Cette vue n'a donc ni ecran de choix ni bascule, elle va droit aux boss.
 */
function ouvrirRandSpec() {
  randMode = 'raid';
  selectView('rand', 'spec');
}

// En raid, la table est toujours affichee : on fixe le boss courant avant le rendu
// pour que l'en-tete nomme bien ce qu'on regarde. Changer de spec ou de portee peut
// faire disparaitre la source affichee : on repart alors du premier boss (raid) ou
// de la grille de donjons (Mythique+).
function normaliserRand() {
  if (activeView !== 'rand' || !randMode) return;
  const sources = randSources(randMode === 'raid' ? 'raid' : 'dungeon');
  if (sources.some((s) => s.name === activeBoss)) return;
  activeBoss = randMode === 'raid' && sources.length ? sources[0].name : null;
}

function renderRand() {
  const wrap = document.createElement('div');
  wrap.className = 'rand';

  if (!randMode) {
    wrap.appendChild(randChoice());
    return wrap;
  }

  // La bascule n'existe que cote guilde : le /rand d'une spec n'a qu'une destination.
  if (randScope === 'guild') wrap.appendChild(randNav());

  const kind = randMode === 'raid' ? 'raid' : 'dungeon';
  const sources = randSources(kind);
  if (!sources.length) {
    const spec = activeSpec();
    // En raid, la raison la plus probable n'est pas l'absence de BiS mais l'absence
    // de la spec dans le roster mythique : on le dit, sinon la vue semble cassee.
    const raison =
      kind === 'raid'
        ? `Aucun objet de raid convoité par ${spec && spec.label} : soit personne de cette spec n'est dans le roster mythique, soit elle n'est pas jouée dans le roster.`
        : `Aucun objet de donjon convoité par ${spec && spec.label} — soit la spec n'est pas jouée dans le roster, soit son BiS vient d'ailleurs.`;
    wrap.appendChild(
      randScope === 'spec' && spec
        ? emptyState('Rien à rand ici', raison)
        : emptyState(
            'Aucune donnée en cache',
            'Mets au moins une spec à jour pour remplir cette vue.'
          )
    );
    return wrap;
  }

  // En Mythique+, on entre par une grille de donjons ; en raid, par la liste des boss.
  if (randMode === 'mplus' && !activeBoss) {
    const grid = document.createElement('div');
    grid.className = 'dungeon-grid';
    for (const source of sources) grid.appendChild(dungeonCard(source));
    wrap.appendChild(grid);
    return wrap;
  }

  const chips = document.createElement('div');
  chips.className = 'boss-chips rand-chips';
  for (const source of sources) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `boss-chip${source.name === activeBoss ? ' is-active' : ''}`;
    btn.title = `${source.items.length} objet(s) · ${source.playerCount} joueur(s)`;
    const nom = document.createElement('span');
    nom.textContent = translateSource(source.name);
    const compte = document.createElement('span');
    compte.className = 'boss-chip-count';
    compte.textContent = source.playerCount;
    btn.append(nom, compte);
    btn.addEventListener('click', () => {
      activeBoss = source.name;
      render();
    });
    chips.appendChild(btn);
  }
  wrap.appendChild(chips);

  const source = sources.find((s) => s.name === activeBoss) || sources[0];
  wrap.appendChild(renderLootTable(source));
  return wrap;
}

/* ---------------- vue consommables ---------------- */

/**
 * Libelles francais des types de consommables. Wowhead les ecrit en anglais dans son
 * tableau ; la table est a completer si un guide en introduit un nouveau, une entree
 * manquante retombant sur le libelle d'origine sans rien casser.
 */
const CONSO_FR = {
  Flask: 'Flacon',
  'Combat Potion': 'Potion de combat',
  'Health Potion': 'Potion de soins',
  'Weapon Buff': 'Huile d’arme',
  'Augment Rune': 'Rune d’amélioration',
  Food: 'Nourriture',
  Phial: 'Fiole',
  Rune: 'Rune',
  Oil: 'Huile',
  Potion: 'Potion',
  Enchant: 'Enchantement',
  Gem: 'Gemme',
};

function typeConso(type) {
  if (LANG !== 'fr') return type;
  return CONSO_FR[type] || type;
}

/**
 * Consommables recommandes par le guide Wowhead de la spec : une ligne par type,
 * plusieurs objets quand l'auteur en propose plusieurs.
 */
function renderConsumables() {
  const spec = activeSpec();
  if (!spec) return emptyState('Aucune spec sélectionnée', 'Choisis une spec en haut de page.');

  const entree = wowheadStore.specs[spec.key];
  const conso = entree && entree.consumables;

  if (!conso || !conso.available || !conso.rows.length) {
    return emptyState(
      'Aucun consommable en cache',
      STATIC
        ? 'Cette spec n’a pas encore été rafraîchie depuis l’ajout des consommables.'
        : 'Clique « Mettre à jour » : les consommables du guide Wowhead sont récupérés dans la foulée.'
    );
  }

  const wrap = document.createElement('div');
  wrap.className = 'conso';

  const intro = document.createElement('p');
  intro.className = 'mplus-intro';
  intro.textContent =
    'Ce que le guide Wowhead recommande d’emporter. Plusieurs objets sur une ligne : ' +
    'l’auteur les donne comme équivalents ou dépendants de la situation.';
  wrap.appendChild(intro);

  const table = document.createElement('table');
  table.className = 'conso-table';

  const thead = document.createElement('thead');
  thead.innerHTML = '<tr><th>Type</th><th>Recommandé</th></tr>';
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  for (const row of conso.rows) {
    const tr = document.createElement('tr');

    const typeTd = document.createElement('td');
    typeTd.className = 'conso-type';
    typeTd.textContent = typeConso(row.type);
    if (typeConso(row.type) !== row.type) typeTd.title = row.type;

    const itemsTd = document.createElement('td');
    const liste = document.createElement('div');
    liste.className = 'conso-items';

    for (const item of row.items) {
      const carte = document.createElement('span');
      carte.className = 'conso-item';
      carte.appendChild(iconEl(item.icon || iconForItemId(item.itemId), 'conso-icone', ''));

      // Meme mecanique que partout ailleurs : l'embed Wowhead nomme, colore et
      // localise le lien a partir du seul identifiant.
      const lien = document.createElement('a');
      lien.className = 'conso-nom';
      lien.href = itemUrl(item.itemId);
      lien.target = '_blank';
      lien.rel = 'noopener noreferrer';
      lien.dataset.wowhead = `item=${item.itemId}${LANG === 'fr' ? '&domain=fr' : ''}`;
      lien.textContent = item.name || `objet ${item.itemId}`;
      carte.appendChild(lien);

      liste.appendChild(carte);
    }

    itemsTd.appendChild(liste);
    tr.append(typeTd, itemsTd);
    tbody.appendChild(tr);
  }

  table.appendChild(tbody);
  wrap.appendChild(table);

  if (conso.url) {
    const note = document.createElement('p');
    note.className = 'roster-note';
    const texte = document.createElement('span');
    texte.textContent = 'Source : ';
    const lien = document.createElement('a');
    lien.href = conso.url;
    lien.target = '_blank';
    lien.rel = 'noopener noreferrer';
    lien.textContent = 'guide Wowhead — Enchants & Consumables';
    note.append(texte, lien);
    wrap.appendChild(note);
  }

  return wrap;
}

/* ---------------- vue roster ---------------- */

const MSG_STATIC = 'Version consultable : la modification du roster se fait sur l’instance locale.';

/**
 * Ecriture sur le roster. Renvoie la reponse, ou null si l'appel n'a pas abouti.
 * En version publiee il n'y a pas de serveur : le garde-fou repond a la place, pour
 * les deux champs dont les controles restent affiches (spec et roster mythique).
 */
async function ecrireRoster(url, options, erreurParDefaut) {
  if (STATIC) {
    showMessage(MSG_STATIC, 'info');
    return null;
  }
  let data = null;
  try {
    const res = await fetch(url, options);
    data = await res.json();
    if (!res.ok) {
      showMessage((data && data.error) || erreurParDefaut, 'error');
      return null;
    }
  } catch (err) {
    showMessage(`${erreurParDefaut} (${err.message})`, 'error');
    return null;
  }
  return data;
}

function urlMembre(member) {
  return `/api/roster/${encodeURIComponent(member.id)}`;
}

function corpsJson(body) {
  return {
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

async function updateMemberSpec(member, spec) {
  const data = await ecrireRoster(
    urlMembre(member),
    { method: 'PUT', ...corpsJson({ spec: spec || null }) },
    'Impossible d’enregistrer la spec.'
  );
  if (!data) return render();

  member.spec = data.member.spec;
  showMessage(
    spec
      ? `${member.name} : spec enregistrée. Pense à la mettre à jour depuis la barre du haut.`
      : `${member.name} : spec effacée.`,
    'info'
  );
  render();
}

/** Entree / sortie du roster mythique : ne change que le butin de raid. */
async function updateMemberRaid(member, raid) {
  const data = await ecrireRoster(
    urlMembre(member),
    { method: 'PUT', ...corpsJson({ raid }) },
    'Impossible d’enregistrer le roster mythique.'
  );
  if (!data) return render();

  member.raid = data.member.raid;
  showMessage(
    raid
      ? `${member.name} entre dans le roster mythique : il compte de nouveau pour le butin de raid.`
      : `${member.name} sort du roster mythique : il reste compté en Mythique+, mais plus en raid.`,
    'info'
  );
  render();
}

/** Marque un membre a l'essai. Purement indicatif : ne filtre aucun butin. */
async function updateMemberTrial(member, trial) {
  const data = await ecrireRoster(
    urlMembre(member),
    { method: 'PUT', ...corpsJson({ trial }) },
    'Impossible d’enregistrer le statut d’essai.'
  );
  if (!data) return render();

  member.trial = data.member.trial;
  showMessage(
    trial
      ? `${member.name} passe en test : signalé partout, mais compté comme les autres.`
      : `${member.name} n’est plus en test.`,
    'info'
  );
  render();
}

async function ajouterMembre(nom, className, spec) {
  const data = await ecrireRoster(
    '/api/roster',
    { method: 'POST', ...corpsJson({ name: nom, class: className, spec: spec || null }) },
    'Impossible d’ajouter ce membre.'
  );
  if (!data) return;

  await loadRoster();
  showMessage(
    spec
      ? `${data.member.name} ajouté au roster. Pense à mettre à jour sa spec.`
      : `${data.member.name} ajouté au roster, spec à renseigner.`,
    'info'
  );
  render();
}

async function retirerMembre(member) {
  // Une suppression ne se rattrape pas depuis l'interface : on demande confirmation.
  if (!window.confirm(`Retirer ${member.name} du roster ?`)) return;

  const data = await ecrireRoster(
    urlMembre(member),
    { method: 'DELETE' },
    'Impossible de retirer ce membre.'
  );
  if (!data) return;

  await loadRoster();
  showMessage(`${member.name} retiré du roster.`, 'info');
  render();
}

/** Role d'affichage d'un membre : c'est ainsi que le roster est range. */
function roleDe(member) {
  if (!member.spec) return 'sans-spec';
  const role = specRoleOf(member.class, member.spec);
  if (role === 'tank') return 'tank';
  if (role === 'healing') return 'heal';
  return DPS_DISTANCE.has(`${member.class}-${member.spec}`) ? 'dps-distance' : 'dps-melee';
}

/**
 * Range les membres par role, DPS scinde en distance / corps a corps. Une composition
 * de raid se lit comme ca, pas classe par classe : ce qui compte est de voir d'un coup
 * si les tanks et les soigneurs sont la.
 */
function grouperParRole(membres) {
  const par = { tank: [], heal: [], 'dps-distance': [], 'dps-melee': [], 'sans-spec': [] };
  for (const m of membres) par[roleDe(m)].push(m);

  // A l'interieur d'un groupe : par classe, puis par numero d'arrivee.
  for (const liste of Object.values(par)) {
    liste.sort(
      (a, b) =>
        classInfo(a.class).label.localeCompare(classInfo(b.class).label, 'fr') ||
        (Number(a.n) || 0) - (Number(b.n) || 0)
    );
  }

  const groupes = [
    { label: 'Tank', membres: par.tank },
    { label: 'Soigneur', membres: par.heal },
    {
      label: 'DPS',
      sous: [
        { label: 'Distance', membres: par['dps-distance'] },
        { label: 'Corps à corps', membres: par['dps-melee'] },
      ],
    },
    { label: 'Spec à renseigner', membres: par['sans-spec'] },
  ];

  // Un groupe vide n'a rien a dire ; DPS disparait si ses deux sous-groupes le sont.
  return groupes.filter((g) =>
    g.sous ? g.sous.some((s) => s.membres.length) : g.membres.length
  );
}

/** Nombre de colonnes du tableau, selon que les actions sont rendues ou non. */
function colonnesRoster() {
  return STATIC ? 6 : 7;
}

/** Ligne d'en-tete d'un groupe, ou d'un sous-groupe en retrait. */
function ligneGroupe(label, total, sous) {
  const tr = document.createElement('tr');
  tr.className = `group-row${sous ? ' group-row--sous' : ''}`;
  const td = document.createElement('td');
  td.colSpan = colonnesRoster();
  const texte = document.createElement('span');
  texte.textContent = `${label} · ${total}`;
  td.appendChild(texte);
  tr.appendChild(td);
  return tr;
}

/** Cellule a case a cocher du roster, verrouillee en version consultable. */
function caseRoster(coche, auChangement, infobulle) {
  const td = document.createElement('td');
  td.className = 'col-center';
  const label = document.createElement('label');
  label.className = 'roster-raid';
  const box = document.createElement('input');
  box.type = 'checkbox';
  box.checked = coche;
  box.disabled = STATIC;
  label.title = STATIC ? MSG_STATIC : infobulle;
  box.addEventListener('change', () => auChangement(box.checked));
  label.appendChild(box);
  td.appendChild(label);
  return td;
}

/** Une ligne de membre, identique dans le roster mythique et dans le repli. */
function ligneMembre(member) {
  const info = classInfo(member.class);
  const tr = document.createElement('tr');
  if (member.star) tr.className = 'roster-star';

  const nTd = document.createElement('td');
  nTd.className = 'col-muted';
  nTd.textContent = member.n;

  // Icone de spec collee au nom, comme dans la liste d'origine de la guilde.
  const nameTd = document.createElement('td');
  const memberIcon = iconEl(
    member.spec ? specIcon(member.class, member.spec) : info.icon,
    'row-icon',
    member.spec || info.label
  );
  const memberName = document.createElement('span');
  memberName.textContent = member.name;
  memberName.style.color = info.color;
  nameTd.append(memberIcon, memberName);

  if (member.star) {
    const star = document.createElement('span');
    star.className = 'roster-star-badge';
    star.textContent = '★ Mascotte';
    star.title = 'Star de la guilde';
    nameTd.appendChild(star);
  }

  if (member.trial) {
    const essai = document.createElement('span');
    essai.className = 'roster-trial-badge';
    essai.textContent = 'en test';
    essai.title = 'À l’essai — compté comme les autres, mais signalé';
    nameTd.appendChild(essai);
  }

  // Portrait détouré, en tête de ligne, pour les membres qui en ont un.
  if (member.portrait) {
    const portrait = document.createElement('img');
    portrait.className = 'roster-portrait';
    portrait.src = `img/${member.portrait}`;
    portrait.alt = '';
    portrait.title = member.name;
    portrait.loading = 'lazy';
    nameTd.insertBefore(portrait, nameTd.firstChild);
  }

  const specTd = document.createElement('td');
  const select = document.createElement('select');
  select.className = 'spec-select';
  if (STATIC) {
    select.disabled = true;
    select.title = 'Version consultable : modification possible sur l’instance locale.';
  }
  const empty = document.createElement('option');
  empty.value = '';
  empty.textContent = '— à renseigner —';
  select.appendChild(empty);
  for (const spec of info.specs) {
    const option = document.createElement('option');
    option.value = spec.slug;
    option.textContent = spec.label;
    if (member.spec === spec.slug) option.selected = true;
    select.appendChild(option);
  }
  select.addEventListener('change', () => updateMemberSpec(member, select.value));
  specTd.appendChild(select);

  const raidTd = caseRoster(
    member.raid !== false,
    (coche) => updateMemberRaid(member, coche),
    member.raid !== false
      ? `${member.name} est dans le roster mythique : il compte pour le butin de raid.`
      : `${member.name} est hors roster mythique : ignoré en raid, compté en Mythique+.`
  );

  // En test : contrairement au roster mythique, ce statut ne filtre rien. Il ne fait
  // que signaler la personne, ici et sur les pastilles des tableaux de butin.
  const trialTd = caseRoster(
    member.trial === true,
    (coche) => updateMemberTrial(member, coche),
    member.trial
      ? `${member.name} est à l’essai : signalé partout, compté comme les autres.`
      : `${member.name} n’est pas à l’essai.`
  );

  const dataTd = document.createElement('td');
  if (!member.spec) {
    dataTd.appendChild(badge('none', '-'));
  } else {
    const entry = entryFor(`${member.class}-${member.spec}`);
    dataTd.appendChild(
      entry ? badge('bis', `${entry.items.length} slots`) : badge('bis-multi', 'à scraper')
    );
  }

  tr.append(nTd, nameTd, specTd, raidTd, trialTd, dataTd);

  if (!STATIC) {
    const actionTd = document.createElement('td');
    actionTd.className = 'col-center';
    const retirer = document.createElement('button');
    retirer.type = 'button';
    retirer.className = 'roster-retirer';
    retirer.textContent = '✕';
    retirer.title = `Retirer ${member.name} du roster`;
    retirer.addEventListener('click', () => retirerMembre(member));
    actionTd.appendChild(retirer);
    tr.appendChild(actionTd);
  }

  return tr;
}

/** Tableau du roster, groupes en tete de section. */
function tableauRoster(groupes) {
  const table = document.createElement('table');
  const thead = document.createElement('thead');
  // Composer et retirer des membres se fait sur l'instance locale, jamais sur la
  // version publiee : la-bas les controles ne sont pas grises, ils n'existent pas.
  const colonnes =
    '<th>#</th><th>Membre</th><th>Spec</th><th class="col-center">Roster mythique</th>' +
    '<th class="col-center">En test</th><th>Données BiS</th>';
  thead.innerHTML = `<tr>${colonnes}${STATIC ? '' : '<th></th>'}</tr>`;
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  for (const groupe of groupes) {
    if (!groupe.sous) {
      tbody.appendChild(ligneGroupe(groupe.label, groupe.membres.length));
      for (const member of groupe.membres) tbody.appendChild(ligneMembre(member));
      continue;
    }
    const total = groupe.sous.reduce((somme, s) => somme + s.membres.length, 0);
    tbody.appendChild(ligneGroupe(groupe.label, total));
    for (const sous of groupe.sous) {
      if (!sous.membres.length) continue;
      tbody.appendChild(ligneGroupe(sous.label, sous.membres.length, true));
      for (const member of sous.membres) tbody.appendChild(ligneMembre(member));
    }
  }
  table.appendChild(tbody);
  return table;
}

/**
 * Vue Roster Mythique : elle montre la composition, donc uniquement les membres qui en
 * font partie. Les autres restent atteignables dans un repli en bas — sans quoi
 * decocher quelqu'un le ferait disparaitre pour de bon, sans moyen de le remettre.
 */
function renderRoster() {
  const wrap = document.createElement('div');
  // Le roster est une des trois entrees de guilde : on garde la barre pour passer
  // aux deux autres sans repasser par l'ecran d'accueil.
  wrap.appendChild(randNav());

  const mythique = roster.filter((m) => m.raid !== false);
  const horsRoster = roster.filter((m) => m.raid === false);

  wrap.appendChild(
    mythique.length
      ? tableauRoster(grouperParRole(mythique))
      : emptyState(
          'Roster mythique vide',
          'Personne n’est coché « Roster mythique ». Déplie la section ci-dessous pour en réintégrer.'
        )
  );

  if (horsRoster.length) {
    const repli = document.createElement('section');
    repli.className = 'roster-repli';

    const bouton = document.createElement('button');
    bouton.type = 'button';
    bouton.className = `roster-repli-titre${rosterHorsVisible ? ' is-open' : ''}`;
    bouton.textContent = `${
      rosterHorsVisible ? '▾' : '▸'
    } Hors roster mythique · ${horsRoster.length}`;
    bouton.title = 'Ces membres comptent en Mythique+, mais pas sur le butin de raid';
    bouton.addEventListener('click', () => {
      rosterHorsVisible = !rosterHorsVisible;
      render();
    });
    repli.appendChild(bouton);

    if (rosterHorsVisible) repli.appendChild(tableauRoster(grouperParRole(horsRoster)));
    wrap.appendChild(repli);
  }

  if (!STATIC) wrap.appendChild(formulaireAjout());

  const missing = roster.filter((m) => !m.spec).length;
  const essais = roster.filter((m) => m.trial).length;
  const note = document.createElement('p');
  note.className = 'roster-note';
  const phrases = [
    `${mythique.length} membre(s) dans le roster mythique.`,
    horsRoster.length
      ? `${horsRoster.length} hors roster mythique : masqué(s) ci-dessus et ignoré(s) sur tout le butin de raid, mais comptés normalement en Mythique+.`
      : 'Tout le roster en fait partie.',
    essais
      ? `${essais} membre(s) en test : signalé(s) sur les tableaux de butin, mais comptés comme les autres.`
      : '',
    missing
      ? `${missing} membre(s) sans spec renseignée : choisis-la ici, elle est enregistrée dans data/roster.json.`
      : '',
  ].filter(Boolean);
  note.textContent = phrases.join(' ');
  wrap.appendChild(note);

  return wrap;
}

/**
 * Ajout d'un membre : pseudo, classe, spec. La liste de specs suit la classe choisie,
 * puisqu'elle n'a de sens que pour elle.
 */
function formulaireAjout() {
  const form = document.createElement('form');
  form.className = 'roster-ajout';

  const titre = document.createElement('span');
  titre.className = 'roster-ajout-titre';
  titre.textContent = 'Ajouter un membre';

  const nom = document.createElement('input');
  nom.type = 'text';
  nom.className = 'roster-champ';
  nom.placeholder = 'Pseudo';
  nom.maxLength = 40;
  nom.required = true;

  const classeSelect = document.createElement('select');
  classeSelect.className = 'spec-select';
  const classeVide = document.createElement('option');
  classeVide.value = '';
  classeVide.textContent = '— classe —';
  classeSelect.appendChild(classeVide);
  for (const [slug, info] of Object.entries(classes).sort((a, b) =>
    a[1].label.localeCompare(b[1].label, 'fr')
  )) {
    const option = document.createElement('option');
    option.value = slug;
    option.textContent = info.label;
    classeSelect.appendChild(option);
  }

  const specSelect = document.createElement('select');
  specSelect.className = 'spec-select';

  // La spec depend de la classe : tant qu'aucune classe n'est choisie, il n'y a rien
  // a proposer, et changer de classe remet la liste a jour.
  function remplirSpecs() {
    specSelect.innerHTML = '';
    const vide = document.createElement('option');
    vide.value = '';
    vide.textContent = classeSelect.value ? '— spec (facultatif) —' : '— classe d’abord —';
    specSelect.appendChild(vide);
    specSelect.disabled = !classeSelect.value;
    if (!classeSelect.value) return;
    for (const spec of classInfo(classeSelect.value).specs || []) {
      const option = document.createElement('option');
      option.value = spec.slug;
      option.textContent = spec.label;
      specSelect.appendChild(option);
    }
  }
  classeSelect.addEventListener('change', remplirSpecs);
  remplirSpecs();

  const valider = document.createElement('button');
  valider.type = 'submit';
  valider.className = 'roster-valider';
  valider.textContent = 'Ajouter';

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (!classeSelect.value) {
      showMessage('Choisis une classe pour ce membre.', 'error');
      return;
    }
    ajouterMembre(nom.value, classeSelect.value, specSelect.value);
  });

  form.append(titre, nom, classeSelect, specSelect, valider);
  return form;
}

/* ---------------- rendu global ---------------- */


/**
 * Barre de selection en haut de page : une icone par spec suivie.
 * Le libelle complet est dans l'entete du panneau juste en dessous, l'icone suffit ici.
 */
function renderSelector() {
  els.selector.innerHTML = '';
  // Affiche partout, Roster compris : les vues de guilde n'ont plus d'onglets, on en
  // sort par une icone de spec ou par le carre correspondant.
  els.selector.hidden = false;

  const visible = visibleSpecs();
  const played = membersBySpec();

  if (!visible.some((s) => s.key === activeKey)) {
    activeKey = visible.length ? visible[0].key : null;
  }

  const row = document.createElement('div');
  row.className = 'spec-chips';

  // La partie guilde ouvre la barre : c'est la porte d'entree de l'outil, et l'ecran
  // sur lequel on arrive. Le trait la separe des specs qui la suivent.
  const groupe = document.createElement('div');
  groupe.className = 'guild-group';

  const dansGuilde = estVueGuilde();
  const guilde = document.createElement('button');
  guilde.type = 'button';
  guilde.className = `guild-chip${dansGuilde ? ' is-active' : ''}`;
  guilde.title = dansGuilde
    ? 'Revenir aux vues de spec'
    : 'Guilde — /rand raid, /rand Mythique+ et roster';
  const blason = document.createElement('img');
  blason.src = 'img/guild.png';
  blason.alt = 'Guilde';
  guilde.appendChild(blason);
  guilde.addEventListener('click', () => {
    // Blason actif : on est dans la partie guilde, ce clic en ressort.
    if (dansGuilde) return quitterVueGuilde();
    ouvrirVueGuilde(() => {
      selectView('rand', 'guild');
      randMode = null;
      activeBoss = null;
    });
  });

  groupe.appendChild(guilde);
  row.appendChild(groupe);

  if (!visible.length) {
    const hint = document.createElement('p');
    hint.className = 'selector-hint';
    hint.textContent =
      'Aucune spec suivie. Renseigne les specs du roster dans la vue Roster.';
    row.appendChild(hint);
    els.selector.appendChild(row);
    return;
  }

  for (const spec of visible) {
    const entry = entryFor(spec.key);
    const members = played.get(spec.key) || [];

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `spec-chip${spec.key === activeKey ? ' is-active' : ''}`;
    btn.style.setProperty('--spec', classColor(spec.class));
    btn.title = [
      spec.label,
      members.length ? members.map((m) => m.name).join(', ') : 'personne',
      entry ? `${entry.items.length} slots` : 'jamais scrapé',
    ].join(' · ');

    // La spec de la mascotte est signalee jusque dans le selecteur du haut.
    if (members.some((m) => m.star)) btn.classList.add('spec-chip--star');

    btn.appendChild(iconEl(specIcon(spec.class, spec.spec), null, spec.label));
    btn.addEventListener('click', () => {
      activeKey = spec.key;
      mplusFocus = null;
      // Choisir une spec, c'est demander a la voir : on ouvre sa liste BiS, quelle que
      // soit la vue d'ou l'on vient. Rester sur l'onglet courant faisait atterrir sur
      // un /rand ou un M+ opti alors qu'on voulait d'abord regarder l'equipement.
      selectView('list');
      showMessage(null);
      render();
    });
    row.appendChild(btn);
  }

  els.selector.appendChild(row);
}

/** Vrai dans les vues qui concernent tout le roster, pas la spec affichee. */
function estVueGuilde() {
  return activeView === 'roster' || (activeView === 'rand' && randScope === 'guild');
}

/** Entre dans une vue de guilde en retenant d'ou l'on vient. */
function ouvrirVueGuilde(basculer) {
  if (!estVueGuilde()) vueAvantGuilde = activeView;
  basculer();
  showMessage(null);
  render();
}

/** Deuxieme clic sur le carre actif : on ressort par ou on est entre. */
function quitterVueGuilde() {
  selectView(vueAvantGuilde);
  showMessage(null);
  render();
}

function renderHeader() {
  const spec = activeSpec();
  const entry = spec ? entryFor(spec.key) : null;
  const color = spec ? classColor(spec.class) : '#d9a441';

  // Ecran d'accueil de la guilde : les trois cartes se presentent toutes seules, un
  // titre « /rand » au-dessus ne dirait rien de plus. L'en-tete ne subsiste alors que
  // s'il lui reste quelque chose a montrer — la date, sur la version publiee — sinon
  // il ne serait qu'une bande vide.
  const maj = derniereMaj();
  const accueilGuilde = activeView === 'rand' && randScope === 'guild' && !randMode;
  els.panelTitle.hidden = accueilGuilde;
  els.panelHead.hidden = accueilGuilde && !(STATIC && maj);

  document.querySelector('.panel').style.setProperty('--spec', color);
  els.avatar.className = 'avatar lg';
  els.avatar.innerHTML = '';
  // Le /rand d'une spec reste une vue de spec : son icone garde son sens. Celui de
  // la guilde ne depend d'aucune spec, l'icone n'y a rien a dire.
  els.avatar.hidden =
    activeView === 'roster' || (activeView === 'rand' && randScope === 'guild');
  if (spec && !els.avatar.hidden) {
    els.avatar.title = spec.label;
    els.avatar.appendChild(iconEl(specIcon(spec.class, spec.spec), null, spec.label));
  }

  if (activeView === 'roster') els.name.textContent = ROSTER_LABEL;
  else if (activeView === 'rand') {
    els.name.textContent = activeBoss ? translateSource(activeBoss) : '/rand';
  } else els.name.textContent = spec ? spec.label : '—';

  // Les onglets ne pilotent que des vues de spec : dans les vues de guilde ils n'ont
  // rien à piloter. On en sort par les carrés du haut ou par une icône de spec.
  els.tabsNav.hidden = estVueGuilde();

  // Le bouton agit sur une spec : il n'a pas de sens dans les vues roster / boss,
  // ni en hebergement statique ou aucun scrape n'est possible.
  els.refresh.hidden = STATIC || activeView === 'roster' || activeView === 'rand';
  els.refresh.disabled = !spec;

  els.sub.innerHTML = '';
  if (activeView === 'roster') {
    els.sub.textContent = `${roster.length} membres · specs enregistrées dans data/roster.json`;
  } else if (activeView === 'rand') {
    const pourSpec = randScope === 'spec' && spec;
    const source =
      activeBoss && randMode
        ? randSources(randMode === 'raid' ? 'raid' : 'dungeon').find((s) => s.name === activeBoss)
        : null;
    // Devant un boss, "le roster" veut dire le roster mythique : les autres n'y sont pas.
    const quiRoule = source && source.kind === 'raid' ? 'du roster mythique' : 'du roster';
    if (source && pourSpec) {
      els.sub.textContent = `${source.items.length} objet(s) à rand pour ${spec.label} · ${source.playerCount} membre(s) ${quiRoule} sur ces objets`;
    } else if (source) {
      els.sub.textContent = `${source.items.length} objet(s) convoité(s) par ${source.playerCount} membre(s) ${quiRoule}`;
    } else if (pourSpec) {
      els.sub.textContent = `Sur quoi ${spec.label} doit rand · choisis une source ci-dessous`;
    } else {
      els.sub.textContent = randMode
        ? 'Choisis une source ci-dessous'
        : 'Sur quoi votre guilde doit rand — choisis raid ou Mythique+';
    }
  } else if (activeView === 'conso' && spec) {
    const entree = wowheadStore.specs[spec.key];
    const conso = entree && entree.consumables;
    els.sub.textContent = conso && conso.available
      ? `Flacon, potions, huile d'arme, rune et nourriture — guide Wowhead`
      : 'Aucun tableau de consommables en cache pour cette spec';
  } else if (activeView === 'mplus' && spec) {
    const played = membersBySpec().get(spec.key) || [];
    els.sub.textContent = played.length
      ? `Donjons à prioriser pour ${played.map((m) => m.name).join(', ')}`
      : 'Donjons à prioriser pour cette spec';
  } else if (spec) {
    const parts = [];
    if (entry && entry.guideTitle) parts.push(entry.guideTitle);
    if (entry && entry.guideUpdated) parts.push(`guide MAJ ${entry.guideUpdated}`);
    if (entry && entry.guideAuthor) parts.push(entry.guideAuthor);
    const label = document.createElement('span');
    label.textContent = parts.length ? `${parts.join(' · ')} · ` : 'Pas encore scrapé · ';
    const link = document.createElement('a');
    link.href = spec.url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = 'guide source';
    els.sub.append(label, link);
  }

  const visible = visibleSpecs();
  const cachedCount = visible.filter((s) => entryFor(s.key)).length;
  const withSpec = roster.filter((m) => m.spec).length;
  // Version publiee : la fraicheur prend la place du bouton « Mettre a jour », que
  // personne ne peut y actionner. En local elle reste en pied de page, ou le bouton
  // est juste a cote.
  els.majDonnees.hidden = !STATIC || !maj;
  if (STATIC && maj) {
    // Date en clair plutot que « aujourd'hui » : sur la version publiee on veut
    // pouvoir citer le jour, pas seulement sentir que c'est recent.
    els.majDonnees.textContent = `Données du ${formatDateCourte(maj)}`;
    els.majDonnees.title = `Dernière mise à jour : ${formatDate(maj)} (${ilYA(maj)})`;
  }

  els.storeStatus.textContent =
    `${cachedCount}/${visible.length} spec(s) en cache · ${withSpec}/${roster.length} membres renseignés` +
    (maj && !STATIC ? ` · données ${ilYA(maj)}` : '') +
    (STATIC ? ' · version consultable' : '');
  els.storeStatus.title = maj
    ? `Dernière mise à jour des données : ${formatDate(maj)}`
    : 'Aucune donnée en cache';

  if (activeView === 'rand' || activeView === 'roster') {
    els.legendMeta.textContent = '';
  } else {
    els.legendMeta.textContent = entry
      ? `Cache mis à jour le ${formatDate(entry.scrapedAt)}`
      : 'Aucune donnée en cache pour cette spec';
  }
}

/**
 * Selecteur de liste, visible seulement quand le guide en publie plusieurs
 * (ex. "Deathbringer BiS" / "San'layn BiS" chez le DK sang).
 */
function renderListPicker() {
  const spec = activeSpec();
  const entry = spec ? entryFor(spec.key) : null;
  const lists = listsOf(entry);

  if (activeView !== 'list' || lists.length < 2) {
    els.listPicker.hidden = true;
    els.listPicker.innerHTML = '';
    return;
  }

  els.listPicker.hidden = false;
  els.listPicker.innerHTML = '';

  // Les choix sont peu nombreux (2 a 6) : on les affiche tous plutot que de les
  // cacher derriere un menu deroulant.
  const choices = document.createElement('div');
  choices.className = 'list-choices';
  lists.forEach((list, index) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `list-choice${(selectedList[spec.key] || 0) === index ? ' is-active' : ''}`;
    btn.textContent = list.label;

    const count = document.createElement('span');
    count.className = 'list-choice-count';
    count.textContent = `${list.items.length} slots`;
    btn.appendChild(count);

    btn.addEventListener('click', () => {
      selectedList[spec.key] = index;
      renderContent();
    });
    choices.appendChild(btn);
  });

  els.listPicker.appendChild(choices);
}

function renderContent() {
  const spec = activeSpec();
  els.content.innerHTML = '';
  renderListPicker();
  if (activeView === 'roster') els.content.appendChild(renderRoster());
  else if (activeView === 'rand') els.content.appendChild(renderRand());
  else if (activeView === 'conso') els.content.appendChild(renderConsumables());
  else if (activeView === 'mplus') els.content.appendChild(renderMplus());
  else els.content.appendChild(renderList(spec ? entryFor(spec.key) : null, spec && spec.key));
  refreshTooltips();
}

/**
 * La mascotte n'apparait que si elle est bien dans le roster : si le membre etoile
 * change ou disparait, l'illustration suit, sans retouche du HTML.
 */
function renderMascotte() {
  const el = document.getElementById('mascotte');
  if (!el) return;
  const star = roster.find((m) => m.star && m.portrait);
  el.hidden = !star;
  if (star) {
    el.src = `img/${star.portrait}`;
    el.title = `${star.name} — mascotte de la guilde`;
  }
}

/**
 * Acces cache au roster : cinq clics sur la mascotte.
 *
 * Rien ne le signale — pas de curseur main, pas d'infobulle qui vende la meche :
 * c'est justement le but, cette vue n'a pas a etre sous les yeux de tout le monde.
 *
 * Le compteur se remet a zero apres deux secondes sans clic. Sans ce delai, cinq
 * clics eparpilles au fil d'une soiree finiraient par ouvrir la vue par accident.
 */
const CLICS_ROSTER = 5;
let clicsMascotte = 0;
let dernierClicMascotte = 0;

function armerAccesRoster() {
  const el = document.getElementById('mascotte');
  if (!el) return;

  el.addEventListener('click', () => {
    const maintenant = Date.now();
    clicsMascotte = maintenant - dernierClicMascotte > 2000 ? 1 : clicsMascotte + 1;
    dernierClicMascotte = maintenant;
    if (clicsMascotte < CLICS_ROSTER) return;

    clicsMascotte = 0;
    ouvrirVueGuilde(() => selectView('roster'));
  });
}

function render() {
  normaliserRand();
  renderMascotte();
  renderSelector();
  renderHeader();
  renderContent();
}

/* ---------------- data ---------------- */

async function loadSpecs() {
  const res = await fetch(API.specs);
  specs = await res.json();
}

async function loadRoster() {
  const res = await fetch(API.roster);
  const data = await res.json();
  roster = data.members || [];
  classes = data.classes || {};
}

async function loadTrinkets() {
  const res = await fetch(API.trinkets);
  const data = await res.json();
  trinketStore = data && typeof data.specs === 'object' ? data : { specs: {} };
}

/**
 * Tier lists Wowhead. Le fichier peut ne pas exister encore (aucune spec rafraichie
 * depuis l'ajout de cette source) : c'est un complement, son absence ne doit pas
 * empecher le reste de s'afficher.
 */
async function loadWowhead() {
  try {
    const res = await fetch(API.wowhead);
    if (!res.ok) return;
    const data = await res.json();
    wowheadStore = data && typeof data.specs === 'object' ? data : { specs: {} };
  } catch (err) {
    wowheadStore = { specs: {} };
  }
  categoriesParSpec.clear();
}

async function loadStore() {
  const res = await fetch(API.bis);
  const data = await res.json();
  store = data && typeof data.specs === 'object' ? data : { specs: {} };
  refreshSlotConsensus();
}

async function refresh() {
  const spec = activeSpec();
  if (!spec) return;

  els.refresh.disabled = true;
  const label = els.refresh.textContent;
  els.refresh.textContent = 'Mise à jour…';
  showMessage(
    `${spec.label} : récupération depuis Icy Veins, Wowhead et Bloodmallet…`,
    'info'
  );

  try {
    const res = await fetch('/api/scrape', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ class: spec.class, spec: spec.spec }),
    });
    const data = await res.json();
    if (data.entry) {
      store.specs[spec.key] = data.entry;
      refreshSlotConsensus();
    }
    // Le meme appel rapatrie Bloodmallet et les guides Wowhead. Chacun peut manquer
    // sans empecher les autres : on n'ecrase que ce qui est effectivement revenu.
    if (data.trinkets) trinketStore.specs[spec.key] = data.trinkets;
    if (data.wowhead) {
      wowheadStore.specs[spec.key] = data.wowhead;
      // La provenance des bijoux de cette spec vient d'etre remplacee.
      categoriesParSpec.delete(spec.key);
    }

    if (res.ok) {
      // On nomme ce qui est revenu : une source muette est un cas normal (Bloodmallet
      // ne simule pas tout), mais il faut pouvoir le constater.
      const sources = [`${data.entry.items.length} slots`];
      if (data.trinkets && data.trinkets.available) sources.push('bijoux simulés');
      if (data.wowhead && data.wowhead.trinkets && data.wowhead.trinkets.available) {
        sources.push('tier list');
      }
      if (data.wowhead && data.wowhead.consumables && data.wowhead.consumables.available) {
        sources.push('consommables');
      }
      showMessage(`${spec.label} à jour : ${sources.join(', ')}.`, 'info');
    } else if (data.code === 'RATE_LIMITED') {
      const minutes = Math.ceil((data.retryAfterSeconds || 0) / 60);
      showMessage(
        `${data.error} Réessaie dans ~${minutes} min (données en cache affichées).`,
        'info'
      );
    } else {
      showMessage(data.error || 'Échec du scraping.', 'error');
    }
  } catch (err) {
    showMessage(`Impossible de contacter le serveur : ${err.message}`, 'error');
  } finally {
    els.refresh.disabled = false;
    els.refresh.textContent = label;
    render();
  }
}

/* ---------------- init ---------------- */

for (const tab of els.tabs) {
  tab.addEventListener('click', () => {
    if (tab.dataset.view === 'rand') ouvrirRandSpec();
    else selectView(tab.dataset.view);
    // La colonne de gauche change de contenu selon la vue (specs ou boss).
    render();
  });
}

els.refresh.addEventListener('click', refresh);

// Bascule de langue. La configuration de l'embed Wowhead est lue au chargement,
// donc changer de langue recharge la page.
for (const btn of document.querySelectorAll('#lang-switch button')) {
  btn.classList.toggle('is-active', btn.dataset.lang === LANG);
  btn.addEventListener('click', () => {
    if (btn.dataset.lang === LANG) return;
    localStorage.setItem('bis-lang', btn.dataset.lang);
    location.reload();
  });
}

(async function init() {
  try {
    await Promise.all([loadSpecs(), loadRoster(), loadStore(), loadTrinkets(), loadWowhead()]);
    // Etat de depart : l'ecran d'accueil de la guilde, onglets masques.
    selectView('rand', 'guild');
    render();
    // Une seule fois : `renderMascotte` passe a chaque rendu, l'ecouteur non.
    armerAccesRoster();
  } catch (err) {
    showMessage(`Erreur au chargement : ${err.message}`, 'error');
  }
})();
