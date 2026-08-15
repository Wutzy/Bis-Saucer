'use strict';

const cheerio = require('cheerio');

/**
 * Extraction des BiS depuis une page de guide Icy Veins.
 *
 * Contrairement a Wowhead, le contenu est rendu cote serveur avec un balisage
 * semantique stable, donc Cheerio suffit — pas de blob JS a decoder.
 *
 * Structure reelle d'un objet (verifiee sur les pages actuelles) :
 *
 *   <div class="bis_item [bis_item--align-right] [bis_item--empty]">
 *     <span class="spell_icon_span" data-wowhead="item=271874&domain=ptr&bonus=...">
 *       <img class="spell_icon" src="//static.icy-veins.com/.../<icone>.jpg">
 *       <span data-wowhead="..." class="q4">Venomkeeper's Horrific Cowl</span>
 *     </span>
 *     <span class="bis_item_slot">Helm</span>
 *     <div class="bis_item_extras">   ... gemmes ...   </div>
 *     <div class="bis_item_footer">
 *       <span class="bis_item_drop">Coiled Altar + <a href=".../catalyst-guide">Catalyst</a></span>
 *       <span class="bis_item_enchant"> ... </span>
 *     </div>
 *   </div>
 *
 * Trois grilles par page : "Overall Best in Slot", "Best Gear from Mythic+",
 * "Best Gear from Raid".
 */

const USER_AGENT =
  'GoldSaucer-GuildBiS/0.2 (outil interne de guilde, scrape manuel a la demande)';

const SLOT_LABELS = {
  head: 'Tête',
  helm: 'Tête',
  neck: 'Cou',
  shoulder: 'Épaules',
  shoulders: 'Épaules',
  back: 'Cape',
  cloak: 'Cape',
  chest: 'Torse',
  shirt: 'Chemise',
  tabard: 'Tabard',
  wrist: 'Poignets',
  wrists: 'Poignets',
  bracers: 'Poignets',
  hands: 'Mains',
  gloves: 'Mains',
  waist: 'Taille',
  belt: 'Taille',
  legs: 'Jambes',
  feet: 'Pieds',
  boots: 'Pieds',
  ring: 'Anneau',
  finger: 'Anneau',
  trinket: 'Bijou',
  weapon: 'Arme',
  'main hand': 'Main droite',
  mainhand: 'Main droite',
  'off hand': 'Main gauche',
  offhand: 'Main gauche',
  'two hand': 'Arme à deux mains',
  ranged: 'Distance',
};

class ScrapeError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'ScrapeError';
    this.code = code || 'SCRAPE_FAILED';
  }
}

/* ------------------------------------------------------------------ */
/* Fetch                                                               */
/* ------------------------------------------------------------------ */

async function fetchGuidePage(url, timeoutMs = 20000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      signal: controller.signal,
      redirect: 'follow',
    });
    if (res.status === 404) {
      throw new ScrapeError(`Page de guide introuvable (404) : ${url}`, 'NOT_FOUND');
    }
    if (!res.ok) {
      throw new ScrapeError(`Icy Veins a répondu ${res.status} sur ${url}`, 'BAD_STATUS');
    }
    return await res.text();
  } catch (err) {
    if (err instanceof ScrapeError) throw err;
    if (err.name === 'AbortError') {
      throw new ScrapeError(`Timeout après ${timeoutMs} ms sur ${url}`, 'TIMEOUT');
    }
    throw new ScrapeError(`Échec du fetch (${err.message})`, 'NETWORK');
  } finally {
    clearTimeout(timer);
  }
}

/* ------------------------------------------------------------------ */
/* Helpers de parsing                                                  */
/* ------------------------------------------------------------------ */

function slotLabel(rawSlot) {
  const key = String(rawSlot || '').toLowerCase().replace(/\s+/g, ' ').trim();
  return SLOT_LABELS[key] || null;
}

/** "//static.icy-veins.com/images/wow/large_icons/inv_helm_x.jpg" -> "inv_helm_x" */
function iconSlug(src) {
  if (!src) return null;
  const file = src.split('/').pop() || '';
  return file.replace(/\.(jpg|jpeg|png|webp)(\?.*)?$/i, '') || null;
}

/** class="q4" -> 4 */
function qualityOf($el) {
  const cls = $el.attr('class') || '';
  const match = cls.match(/\bq(\d)\b/);
  return match ? Number(match[1]) : null;
}

function parseWowhead(raw) {
  const params = String(raw || '');
  const id = params.match(/item=(\d+)/);
  const original = params.match(/original-item=(\d+)/);
  return {
    itemId: id ? Number(id[1]) : null,
    originalItemId: original ? Number(original[1]) : null,
    // Conserve tel quel (bonus=, domain=...) pour que le tooltip affiche
    // exactement la version d'objet recommandee par le guide.
    wowheadParams: params || null,
  };
}

// Mots d'emplacement que les auteurs glissent dans la mention de catalyse
// ("Catalyst Legs from Den of Nalorakk", "Catalyst on the shoulders from Murder Row").
const SLOT_WORDS =
  'helm|helmet|head|chest|legs|leg|hands|gloves|shoulders|shoulder|belt|waist|feet|boots|back|cloak|wrist|bracers|item|piece';

/**
 * Texte d'un element en separant les noeuds enfants par une espace.
 * `$el.text()` colle les textes : "Catalyst from<a>Altar of Fangs</a>" donnerait
 * "Catalyst fromAltar of Fangs".
 */
function textWithSpaces($, $el) {
  return $el
    .contents()
    .map((_, node) => $(node).text())
    .get()
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Separe le nom de la source de la mention de catalyse.
 *
 * Les auteurs Icy Veins ne l'ecrivent pas de la meme facon d'un guide a l'autre :
 * "Coiled Altar + Catalyst", "Catalyst from Coiled Altar", "Coiled Altar with Catalyst",
 * "Catalyst or Vashnik", "Catalyst on the shoulders from Murder Row", "Catalyst" seul...
 * Toutes ces tournures veulent dire la meme chose : ramasser a cette source la piece du
 * meme emplacement, puis la transformer en piece de set au Catalyseur.
 */
function extractSource(rawText) {
  const text = String(rawText || '').replace(/\s+/g, ' ').trim();
  const catalyst = /\bcatalyst\b/i.test(text);

  let source = text;
  if (catalyst) {
    source = source.replace(/\bcatalyst\b/gi, ' ');
    // Fautes de frappe de l'auteur : "Hands fromAltar of Fangs" (espace manquante
    // dans le contenu d'Icy Veins). Sans ca, le connecteur reste colle au nom du boss.
    source = source.replace(/\b(from|or|with|on)(?=[A-Z])/g, '$1 ');
    source = source.replace(new RegExp(`\\bon\\s+the\\s+(${SLOT_WORDS})\\b`, 'gi'), ' ');
    source = source.replace(new RegExp(`^\\s*(${SLOT_WORDS})\\b`, 'i'), ' ');
    source = source.replace(/^\s*(from|or|with|\+|on|the)\b/i, ' ');
    source = source.replace(/\b(from|or|with|\+|on)\s*$/i, ' ');
  }

  // Qualificatif de lieu : "Coiled Altar in Venomous Abyss" -> "Coiled Altar"
  source = source.replace(/\s+in\s+[A-Z][\w' ]*$/, '');
  source = source.replace(/\s+/g, ' ').replace(/^[\s+,-]+|[\s+,-]+$/g, '').trim();

  return { source: source || (catalyst ? 'Catalyseur' : null), catalyst };
}

/**
 * Lit la provenance : nom de source, catalyse eventuelle, craft eventuel.
 *  - "Ula'tek"                   -> la piece tombe telle quelle sur ce boss
 *  - "Coiled Altar + [Catalyst]" -> ramasser la piece la-bas, puis catalyser
 *  - "[Crafted] by [Tailoring]"  -> craft de metier
 */
function parseDrop($, $drop) {
  if (!$drop.length) return { source: null, catalyst: false, crafted: false, profession: null };

  const text = textWithSpaces($, $drop);
  const craftLink = $drop.find('a[href*="crafted"], a[href*="making-gold"]');
  const crafted = craftLink.length > 0 || /^\s*crafted\b/i.test(text);

  let profession = null;
  if (crafted) {
    const professionLink = $drop.find('a[href*="professions-"]').last();
    if (professionLink.length) profession = professionLink.text().trim() || null;
  }

  // Le lien vers le guide du Catalyseur est le signal le plus sur, mais beaucoup
  // d'auteurs l'ecrivent seulement en toutes lettres : on accepte les deux.
  const { source, catalyst } = extractSource(text);
  const hasCatalystLink = $drop.find('a[href*="catalyst"]').length > 0;

  return {
    source: crafted ? (profession ? `Craft (${profession})` : 'Craft') : source,
    catalyst: catalyst || hasCatalystLink,
    crafted,
    profession,
  };
}

function parseEnchant($, $item) {
  const $span = $item.find('.bis_item_enchant .spell_icon_span').first();
  if (!$span.length) return null;
  const { itemId, wowheadParams } = parseWowhead($span.attr('data-wowhead'));
  const $name = $span.find('span').last();
  const name =
    $name.text().trim() ||
    ($span.find('img').attr('alt') || '').replace(/\s*Icon$/i, '').trim() ||
    null;
  return {
    name: name || null,
    itemId,
    wowheadParams,
    icon: iconSlug($span.find('img').attr('src')),
  };
}

function parseGems($, $item) {
  return $item
    .find('.bis_item_extras .spell_icon_span')
    .map((_, el) => {
      const $span = $(el);
      const { itemId, wowheadParams } = parseWowhead($span.attr('data-wowhead'));
      return {
        name: ($span.find('img').attr('alt') || '').replace(/\s*Icon$/i, '').trim() || null,
        itemId,
        wowheadParams,
        icon: iconSlug($span.find('img').attr('src')),
      };
    })
    .get()
    .filter((gem) => gem.itemId);
}

function parseItem($, el) {
  const $item = $(el);
  const rawSlot = $item.find('.bis_item_slot').first().text().trim();
  const align = $item.hasClass('bis_item--align-right') ? 'right' : 'left';

  if ($item.hasClass('bis_item--empty')) {
    return {
      slot: rawSlot,
      slotFr: slotLabel(rawSlot) || rawSlot,
      align,
      empty: true,
    };
  }

  const $main = $item.find('> .spell_icon_span').first();
  const { itemId, originalItemId, wowheadParams } = parseWowhead($main.attr('data-wowhead'));
  if (!itemId) return null;

  const $name = $main.find('span[data-wowhead]').last();
  const drop = parseDrop($, $item.find('.bis_item_drop').first());

  // `original-item` est l'encodage Icy Veins de la catalyse : l'objet affiche est la
  // version convertie d'une autre piece, qu'il faut donc ramasser puis transformer.
  // C'est le signal le plus fiable, car tous les auteurs ne l'ecrivent pas en toutes
  // lettres : le guide Pretre Discipline ne mentionne "Catalyst" nulle part alors que
  // son torse (Murder Row, un donjon) est bien une piece de set a catalyser.
  // A l'inverse, une piece de set qui tombe telle quelle sur un boss n'a pas d'original-item.
  const catalyst = drop.catalyst || Boolean(originalItemId);

  return {
    slot: rawSlot,
    slotFr: slotLabel(rawSlot) || rawSlot,
    align,
    empty: false,
    itemId,
    originalItemId,
    wowheadParams,
    name: $name.text().trim() || `Objet #${itemId}`,
    quality: qualityOf($name),
    icon: iconSlug($main.find('img').first().attr('src')),
    source: drop.source,
    catalyst,
    crafted: drop.crafted,
    profession: drop.profession,
    enchant: parseEnchant($, $item),
    gems: parseGems($, $item),
  };
}

/**
 * Recommandations de bijoux du guide, dans la section "Trinket Recommendations".
 *
 * Ce n'est pas un classement chiffre : l'auteur groupe les bijoux par categorie
 * ("On-Use", "Passive"...) dans un <fieldset>. Sert de repli pour les specs que
 * Bloodmallet ne simule pas — toute la classe Moine, par exemple.
 *
 *   <fieldset>
 *     <legend><strong>Windwalker Monk Trinkets</strong></legend>
 *     <strong>On-Use -</strong>  <span class="spell_icon_span" data-wowhead="item=270175">…
 *     <strong>Passive -</strong> <span class="spell_icon_span" data-wowhead="item=270173">…
 */
function parseTrinketAdvice($) {
  // Deux presentations selon l'auteur : un <fieldset> intitule "... Trinkets",
  // ou un <details class="trinket-dropdown"> en tier list (S Tier / A Tier).
  const containers = [
    ...$('fieldset')
      .filter((_, el) => /trinket/i.test($(el).find('legend').text()))
      .toArray(),
    ...$('details.trinket-dropdown').toArray(),
  ];
  if (!containers.length) return [];

  const $container = $(containers[0]);

  const groups = [];
  let current = null;

  $container.find('strong, .spell_icon_span').each((_, el) => {
    const $el = $(el);
    if ($el.is('strong')) {
      // Le <strong> du <legend> nomme la section, pas une categorie.
      if ($el.closest('legend').length) return;
      const label = $el.text().replace(/\s*[-–:]\s*$/, '').trim();
      current = { category: label || 'Bijoux', items: [] };
      groups.push(current);
      return;
    }

    if (!current) return;

    // Ici, contrairement aux cartes BiS, le span exterieur ne porte pas toujours
    // `data-wowhead` : l'identifiant est alors sur le span interieur du nom.
    const $name = $el.find('span[data-wowhead]').last();
    const { itemId, wowheadParams } = parseWowhead(
      $el.attr('data-wowhead') || $name.attr('data-wowhead')
    );
    if (!itemId || current.items.some((i) => i.itemId === itemId)) return;
    current.items.push({
      itemId,
      wowheadParams,
      name: $name.text().trim() || `Objet #${itemId}`,
      quality: qualityOf($name),
      icon: iconSlug($el.find('img').first().attr('src')),
    });
  });

  return groups.filter((g) => g.items.length);
}

/* ------------------------------------------------------------------ */
/* Parse complet                                                       */
/* ------------------------------------------------------------------ */

/**
 * Nom d'une liste. Les grilles sont dans des onglets dont le libelle est porte par un
 * element separe : #bis_0_1 est titre par #bis_0_1_button ("Overall", "Mythic+", "Raid"),
 * et le bloc englobant #area_2 par #area_2_button (le talent de heros, quand le guide en
 * publie une liste par talent). Plus fiable que de deduire depuis le titre precedent :
 * chez le pretre Discipline, "Overall Best in Slot" apparait deux fois, une par talent.
 */
function listLabel($, $grid, fallback) {
  const buttonText = (id) => (id ? $(`#${id}_button`).first().text().trim() : '');

  const tab = buttonText($grid.closest('[id^="bis_"]').attr('id'));
  const area = buttonText($grid.closest('[id^="area_"]').attr('id'));

  if (area && tab) return `${area} — ${tab}`;
  return tab || area || fallback || null;
}

function parseGuide(html) {
  const $ = cheerio.load(html);

  const lists = [];
  let lastHeading = null;

  $('h2, h3, .bis_items_grid').each((_, el) => {
    const $el = $(el);
    if (!$el.hasClass('bis_items_grid')) {
      lastHeading = $el.text().trim() || lastHeading;
      return;
    }

    const items = $el
      .find('.bis_item')
      .map((__, itemEl) => parseItem($, itemEl))
      .get()
      .filter(Boolean);

    // Les armes sont dans une grille distincte, juste apres celle de l'armure :
    // on la rattache a la liste courante au lieu d'en faire une liste a part.
    if ($el.hasClass('bis_items_grid--weapons') && lists.length) {
      lists[lists.length - 1].items.push(...items);
      return;
    }

    const equipped = items.filter((item) => !item.empty);
    if (equipped.length >= 5) {
      lists.push({
        label: listLabel($, $el, lastHeading) || `Liste ${lists.length + 1}`,
        items,
      });
    }
  });

  if (!lists.length) {
    throw new ScrapeError(
      "Aucune grille BiS trouvée (.bis_items_grid). La structure d'Icy Veins a probablement changé.",
      'UNEXPECTED_STRUCTURE'
    );
  }

  const guideTitle = $('h1').first().text().trim() || null;
  const guideUpdated =
    $('[class*="last-updated"], .page_last_updated, time').first().text().trim() || null;

  return {
    lists,
    trinketAdvice: parseTrinketAdvice($),
    items: lists[0].items,
    tableLabel: lists[0].label,
    guideTitle,
    guideAuthor: null,
    guideUpdated: guideUpdated || null,
  };
}

async function scrapeGuide(url) {
  const html = await fetchGuidePage(url);
  return parseGuide(html);
}

module.exports = {
  scrapeGuide,
  fetchGuidePage,
  parseGuide,
  ScrapeError,
  USER_AGENT,
};
