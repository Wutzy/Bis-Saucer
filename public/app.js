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
    }
  : { specs: '/api/specs', roster: '/api/roster', bis: '/api/bis', trinkets: '/api/trinkets' };

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
  // Raid — The Venomous Abyss
  "Ula'tek": '',
  'The Coiled Altar': '',
  "Nek'zali the Soulcoiler": '',
  'Vashnik the Malignant': '',
  Sszorak: '',
  'The Twin Fangs': '',
  'Entombed Sentinels': '',
  'The Lost Explorers': '',
  'Nymrissa Wavecaller': '',
  'Tidebound Grotto': '',
  // Donjons Mythique+
  'Murder Row': '',
  "King's Rest": '',
  'Temple of Sethraliss': '',
  'Voidscar Arena': '',
  'Altar of Fangs': '',
  'Den of Nalorakk': '',
  'The Blinding Vale': '',
  'Ruby Life Pools': '',
  // Divers
  'BoE Trash Drop': '',
  Catalyseur: 'Catalyseur',
};

/** Nom de source dans la langue courante, repli sur l'anglais si non traduit. */
function translateSource(source) {
  if (!source) return source;
  if (LANG !== 'fr') return source;
  return SOURCES_FR[source] || source;
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
  listPicker: document.getElementById('list-picker'),
  tabs: Array.from(document.querySelectorAll('.tab')),
};

let specs = [];
let store = { specs: {} };
let trinketStore = { specs: {} };
let roster = [];
let classes = {};
let activeKey = null;
let activeBoss = null;
let activeView = 'list';
// Vue butin : 'raid' (par defaut), 'dungeon' ou 'all'.
let bossFilter = 'raid';
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
// Liste BiS comme au calcul des besoins dans la vue Butin par boss : les deux
// doivent dire la meme chose.
const SIM_TRINKET_COUNT = 3;

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
      if (!byId.has(id)) byId.set(id, { trinket, targets: [] });
      byId.get(id).targets.push(targets);
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
function renderTrinketAdvice(entry, guideTrinkets) {
  const advice = entry && entry.trinketAdvice;
  if (!advice || !advice.length) return null;

  const panel = document.createElement('div');
  panel.className = 'trinket-panel trinket-panel--advice';

  const head = document.createElement('div');
  head.className = 'tp-head';
  head.textContent = 'Bijoux — recommandations du guide';

  const note = document.createElement('span');
  note.className = 'tp-source';
  note.textContent = 'Bloodmallet ne simule pas cette spec';
  note.title =
    'Aucune donnée Bloodmallet pour cette spécialisation (toute la classe Moine, les spés de soin et quelques DPS ne sont pas simulés). Ces bijoux viennent du guide Icy Veins.';
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

function renderTrinketPanel(sim, guideTrinkets) {
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

    const best = data.trinkets[0];
    for (const trinket of data.trinkets.slice(0, SIM_TRINKET_COUNT)) {
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
      'Clique sur « Rafraîchir depuis Icy Veins » pour remplir cette spec.'
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

  const grid = document.createElement('div');
  grid.className = 'pd-grid';
  for (const item of items.filter((i) => !isWeapon(i) && !(useSimPanel && isTrinket(i)))) {
    grid.appendChild(paperdollCard(item, sourceKinds, key));
  }
  wrap.appendChild(grid);

  if (useSimPanel) {
    wrap.appendChild(renderTrinketPanel(sim, items.filter(isTrinket)));
  } else {
    const advice = renderTrinketAdvice(entry, items.filter(isTrinket));
    if (advice) wrap.appendChild(advice);
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
  const { played, specs: usedSpecs } = scoredSpecs();

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
      if (!items.has(id)) items.set(id, { item, lists: new Set() });
      items.get(id).lists.add(listLabel);
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
        : 'Rafraîchis cette spec pour remplir ses listes BiS.'
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

  // `position` et non `index` : le second masquerait l'index des donjons ci-dessus.
  ranking.forEach((dungeon, position) => {
    const block = document.createElement('section');
    block.className = 'mplus-block';

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
      for (const { member, count: n } of companions) {
        const chip = document.createElement('span');
        chip.className = `companion${member.star ? ' companion--star' : ''}`;
        chip.style.setProperty('--spec', classColor(member.class));
        chip.appendChild(iconEl(specIcon(member.class, member.spec), 'companion-icon', ''));

        const badge = document.createElement('span');
        badge.className = 'companion-count';
        badge.textContent = n;
        chip.appendChild(badge);

        chip.title = `${member.name} — ${specLabelOf(member)} — ${n} pièce(s) BiS ici`;
        row.appendChild(chip);
      }

      block.appendChild(row);
    }

    const list = document.createElement('div');
    list.className = 'mplus-items';

    for (const { item, lists } of dungeon.items) {
      const row = document.createElement('div');
      row.className = 'mplus-item';

      row.appendChild(iconEl(item.icon, 'mplus-icon', ''));

      const body = document.createElement('div');
      body.className = 'mplus-body';
      body.appendChild(itemLink(item));

      const meta = document.createElement('div');
      meta.className = 'mplus-meta';
      meta.textContent = slotName(item);

      // Un objet BiS uniquement dans la liste Mythic+ n'a pas le meme poids qu'un
      // BiS toutes sources confondues : on le precise.
      const onlyMplus = !Array.from(lists).some((l) => /overall/i.test(l));
      if (onlyMplus) {
        const tag = document.createElement('span');
        tag.className = 'mplus-tag';
        tag.textContent = 'liste M+';
        tag.title = `BiS dans la liste ${Array.from(lists).join(', ')} uniquement`;
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
  const { specs: usedSpecs } = scoredSpecs();
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
 */
const ITEM_SOURCES = {
  270169: 'Coiled Altar', // Idole funeste du seigneur des maléfices
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

  for (const spec of usedSpecs) {
    const members = played.get(spec.key) || [];

    // Sur une spec DPS simulee, c'est Bloodmallet qui fait foi pour les bijoux :
    // on ignore ceux du guide et on injecte les siens plus bas.
    const simRules =
      specRoleOf(spec.class, spec.spec) === 'dps' && simulatedTrinkets(spec.key).length > 0;

    for (const { item, listLabel } of allBisEntries(entryFor(spec.key))) {
      if (simRules && slotFrOf(item) === 'Bijou') continue;
      const raw = item.source || 'Source inconnue';
      const source = sourceIndex.get(raw) || raw;
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
        });
      }
      const row = byItem.get(dropId);

      if (viaCatalyst) {
        if (!row.viaItems.some((i) => i.itemId === item.itemId)) row.viaItems.push(item);
      } else if (!row.direct) {
        row.direct = item;
      }

      for (const member of members) {
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
        });
      }
      const row = byItem.get(id);

      const label = `Bloodmallet ${targets.map((t) => `${t}c`).join('/')}`;
      for (const member of members) {
        if (!row.members.some((m) => m.id === member.id)) row.members.push(member);
        if (!row.listsBy.has(member.id)) row.listsBy.set(member.id, new Set());
        row.listsBy.get(member.id).add(label);
      }
    }
  }

  // La classification se fait sur le libelle brut : on la reporte sur le libelle
  // canonique (le regroupement a pu fusionner "Vashnik" et "Vashnik the Malignant").
  const rawKinds = classifySources();
  const kinds = new Map();
  for (const [raw, kind] of rawKinds) {
    const canonical = sourceIndex.get(raw) || raw;
    if (kind === 'raid' || !kinds.has(canonical)) kinds.set(canonical, kind);
  }

  // Ces deux libelles ne viennent d'aucun guide : leur nature est connue d'avance.
  kinds.set(RAID_UNKNOWN, 'raid');
  kinds.set(DUNGEON_UNKNOWN, 'dungeon');

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

function renderBoss() {
  const sources = buildSources().filter(
    (s) => bossFilter === 'all' || s.kind === bossFilter
  );
  if (!sources.length) {
    return emptyState(
      'Aucune donnée en cache',
      'Rafraîchis au moins une spec pour voir le butin par boss.'
    );
  }

  const source = sources.find((s) => s.name === activeBoss) || sources[0];

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


/* ---------------- vue roster ---------------- */

async function updateMemberSpec(member, spec) {
  if (STATIC) {
    showMessage(
      'Version consultable : la modification du roster se fait sur l’instance locale.',
      'info'
    );
    return;
  }

  const res = await fetch(`/api/roster/${encodeURIComponent(member.id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ spec: spec || null }),
  });
  const data = await res.json();
  if (!res.ok) {
    showMessage(data.error || 'Impossible d’enregistrer la spec.', 'error');
    return;
  }
  member.spec = data.member.spec;
  showMessage(
    spec
      ? `${member.name} : spec enregistrée. Pense à rafraîchir cette spec depuis Icy Veins.`
      : `${member.name} : spec effacée.`,
    'info'
  );
  render();
}

function renderRoster() {
  const wrap = document.createElement('div');

  const byClass = new Map();
  for (const member of roster) {
    if (!byClass.has(member.class)) byClass.set(member.class, []);
    byClass.get(member.class).push(member);
  }

  const table = document.createElement('table');
  const thead = document.createElement('thead');
  thead.innerHTML = '<tr><th>#</th><th>Membre</th><th>Spec</th><th>Données BiS</th></tr>';
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  const sortedClasses = Array.from(byClass.entries()).sort((a, b) =>
    classInfo(a[0]).label.localeCompare(classInfo(b[0]).label, 'fr')
  );

  for (const [className, members] of sortedClasses) {
    const info = classInfo(className);

    const groupTr = document.createElement('tr');
    groupTr.className = 'group-row';
    const groupTd = document.createElement('td');
    groupTd.colSpan = 4;
    const classIcon = iconEl(info.icon, 'row-icon', info.label);
    const label = document.createElement('span');
    label.textContent = `${info.label} · ${members.length}`;
    groupTd.append(classIcon, label);
    groupTr.appendChild(groupTd);
    tbody.appendChild(groupTr);

    for (const member of members.sort((a, b) => a.n - b.n)) {
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

      const dataTd = document.createElement('td');
      if (!member.spec) {
        dataTd.appendChild(badge('none', '-'));
      } else {
        const entry = entryFor(`${member.class}-${member.spec}`);
        dataTd.appendChild(
          entry
            ? badge('bis', `${entry.items.length} slots`)
            : badge('bis-multi', 'à scraper')
        );
      }

      tr.append(nTd, nameTd, specTd, dataTd);
      tbody.appendChild(tr);
    }
  }

  table.appendChild(tbody);
  wrap.appendChild(table);

  const missing = roster.filter((m) => !m.spec).length;
  const note = document.createElement('p');
  note.className = 'roster-note';
  note.textContent = missing
    ? `${missing} membre(s) sans spec renseignée. Les icônes de spec du roster d'origine étaient trop petites pour être lues de façon fiable : choisis la spec ici, elle est enregistrée dans data/roster.json.`
    : 'Toutes les specs sont renseignées.';
  wrap.appendChild(note);

  return wrap;
}

/* ---------------- rendu global ---------------- */

/** En vue "butin par boss", la barre du haut liste les sources au lieu des specs. */
function renderBossSelector() {
  const all = buildSources();
  const sources = all.filter((s) => bossFilter === 'all' || s.kind === bossFilter);

  if (!sources.some((s) => s.name === activeBoss)) {
    activeBoss = sources.length ? sources[0].name : null;
  }

  // Filtre raid / donjons / tout : par defaut on ne montre que le raid.
  const filters = document.createElement('div');
  filters.className = 'boss-filters';
  for (const [value, label] of [
    ['raid', 'Raid'],
    ['dungeon', 'Donjons'],
    ['all', 'Tout'],
  ]) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `boss-filter${bossFilter === value ? ' is-active' : ''}`;
    btn.textContent = `${label} (${
      value === 'all' ? all.length : all.filter((s) => s.kind === value).length
    })`;
    btn.addEventListener('click', () => {
      bossFilter = value;
      activeBoss = null;
      render();
    });
    filters.appendChild(btn);
  }
  els.selector.appendChild(filters);

  if (!sources.length) {
    const hint = document.createElement('p');
    hint.className = 'selector-hint';
    hint.textContent = 'Aucune source : rafraîchis au moins une spec.';
    els.selector.appendChild(hint);
    return;
  }

  const chips = document.createElement('div');
  chips.className = 'boss-chips';
  for (const source of sources) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `boss-chip${source.name === activeBoss ? ' is-active' : ''}`;
    btn.title = `${source.items.length} objet(s) · ${source.playerCount} joueur(s)`;

    const name = document.createElement('span');
    name.textContent = source.name;
    const count = document.createElement('span');
    count.className = 'boss-chip-count';
    count.textContent = source.playerCount;
    btn.append(name, count);

    btn.addEventListener('click', () => {
      activeBoss = source.name;
      showMessage(null);
      render();
    });
    chips.appendChild(btn);
  }
  els.selector.appendChild(chips);
}

/**
 * Barre de selection en haut de page : une icone par spec suivie.
 * Le libelle complet est dans l'entete du panneau juste en dessous, l'icone suffit ici.
 */
function renderSelector() {
  els.selector.innerHTML = '';

  if (activeView === 'roster') {
    els.selector.hidden = true;
    return;
  }
  els.selector.hidden = false;

  if (activeView === 'boss') return renderBossSelector();

  const visible = visibleSpecs();
  const played = membersBySpec();

  if (!visible.some((s) => s.key === activeKey)) {
    activeKey = visible.length ? visible[0].key : null;
  }

  if (!visible.length) {
    const hint = document.createElement('p');
    hint.className = 'selector-hint';
    hint.textContent =
      'Aucune spec suivie. Renseigne les specs du roster dans l’onglet Roster.';
    els.selector.appendChild(hint);
    return;
  }

  const row = document.createElement('div');
  row.className = 'spec-chips';

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
      showMessage(null);
      render();
    });
    row.appendChild(btn);
  }

  els.selector.appendChild(row);
}

function renderHeader() {
  const spec = activeSpec();
  const entry = spec ? entryFor(spec.key) : null;
  const color = spec ? classColor(spec.class) : '#d9a441';

  document.querySelector('.panel').style.setProperty('--spec', color);
  els.avatar.className = 'avatar lg';
  els.avatar.innerHTML = '';
  els.avatar.hidden = activeView === 'boss' || activeView === 'roster';
  if (spec && !els.avatar.hidden) {
    els.avatar.title = spec.label;
    els.avatar.appendChild(iconEl(specIcon(spec.class, spec.spec), null, spec.label));
  }

  if (activeView === 'roster') els.name.textContent = 'Roster';
  else if (activeView === 'boss') els.name.textContent = activeBoss || 'Butin par boss';
  else els.name.textContent = spec ? spec.label : '—';

  // Le bouton agit sur une spec : il n'a pas de sens dans les vues roster / boss,
  // ni en hebergement statique ou aucun scrape n'est possible.
  els.refresh.hidden = STATIC || activeView === 'roster' || activeView === 'boss';
  els.refresh.disabled = !spec;

  els.sub.innerHTML = '';
  if (activeView === 'roster') {
    els.sub.textContent = `${roster.length} membres · specs enregistrées dans data/roster.json`;
  } else if (activeView === 'boss') {
    const source = buildSources().find((s) => s.name === activeBoss);
    els.sub.textContent = source
      ? `${source.items.length} objet(s) convoité(s) par ${source.playerCount} membre(s) du roster`
      : 'Sélectionne une source dans la colonne de gauche';
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
  els.storeStatus.textContent =
    `${cachedCount}/${visible.length} spec(s) en cache · ${withSpec}/${roster.length} membres renseignés` +
    (STATIC ? ' · version consultable' : '');

  if (activeView === 'boss' || activeView === 'roster') {
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
  else if (activeView === 'boss') els.content.appendChild(renderBoss());
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

function render() {
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
  els.refresh.textContent = 'Scraping en cours…';
  showMessage(`Récupération du guide ${spec.label} sur Icy Veins…`, 'info');

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
    // Le scrape rapatrie aussi le classement Bloodmallet quand il existe.
    if (data.trinkets) trinketStore.specs[spec.key] = data.trinkets;

    if (res.ok) {
      showMessage(`${data.entry.items.length} slots mis à jour.`, 'info');
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
    activeView = tab.dataset.view;
    for (const other of els.tabs) other.classList.toggle('is-active', other === tab);
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
    await Promise.all([loadSpecs(), loadRoster(), loadStore(), loadTrinkets()]);
    render();
  } catch (err) {
    showMessage(`Erreur au chargement : ${err.message}`, 'error');
  }
})();
