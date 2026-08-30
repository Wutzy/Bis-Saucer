'use strict';

/**
 * Portraits de personnages, depuis l'armurerie — en passant par Raider.IO.
 *
 * Blizzard sert bien les vignettes (`render.worldofwarcraft.com`), mais son API
 * profil demande des identifiants OAuth Battle.net que chacun devrait creer de son
 * cote. Raider.IO expose la meme information **sans clef** et renvoie justement
 * l'URL de rendu Blizzard :
 *
 *   /api/v1/characters/profile?region=eu&realm=hyjal&name=Wutzwutz
 *     -> { thumbnail_url: "https://render.worldofwarcraft.com/eu/character/...jpg", ... }
 *
 * On ne telecharge donc aucune image : on garde l'URL de Blizzard, que la page
 * affiche directement. Le cache (data/portraits.json) ne contient que du texte.
 *
 * Deux appels differents :
 *  - le **roster de guilde** (une requete) donne les noms exacts des personnages,
 *    avec leur classe : c'est ce qui permet de retrouver qui est qui sans rien
 *    saisir a la main ;
 *  - le **profil de personnage** (une requete par membre) donne la vignette.
 *
 * Le rapprochement pseudo -> personnage n'est jamais devine au petit bonheur : un
 * pseudo qui correspond a plusieurs personnages de la meme classe est déclaré
 * ambigu et laisse sans portrait, jusqu'a ce qu'on tranche avec le champ `armory`
 * du membre. Mieux vaut une carte sans photo qu'une carte avec la mauvaise.
 */

const USER_AGENT =
  'GoldSaucer-GuildBiS/0.2 (outil interne de guilde, requete manuelle a la demande)';

const RIO = 'https://raider.io/api/v1';

/**
 * Guilde interrogee. Modifiable sans toucher au code par les variables
 * d'environnement, pour qu'un fork n'ait pas a editer ce fichier.
 */
const GUILD = {
  region: (process.env.GUILD_REGION || 'eu').toLowerCase(),
  realm: process.env.GUILD_REALM || 'hyjal',
  name: process.env.GUILD_NAME || 'Gold Saucer',
};

/** Classes telles que Raider.IO les ecrit -> nos slugs. */
const CLASSE_RIO = {
  'Death Knight': 'death-knight',
  'Demon Hunter': 'demon-hunter',
  Druid: 'druid',
  Evoker: 'evoker',
  Hunter: 'hunter',
  Mage: 'mage',
  Monk: 'monk',
  Paladin: 'paladin',
  Priest: 'priest',
  Rogue: 'rogue',
  Shaman: 'shaman',
  Warlock: 'warlock',
  Warrior: 'warrior',
};

class ArmoryError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'ArmoryError';
    this.code = code || 'ARMORY_FAILED';
  }
}

/**
 * Forme comparable d'un nom : sans accent, sans ponctuation, en minuscules.
 *
 * Les pseudos de la guilde sont pleins de lettres decoratives — Fólkvangr, Ganöva,
 * Bølederiz. `normalize('NFD')` en retire la plupart, mais pas o/O barres ni ae/oe
 * lies : ils n'ont pas de forme decomposee, d'ou la table qui suit.
 */
const LETTRES_LIEES = { ø: 'o', Ø: 'o', æ: 'ae', Æ: 'ae', œ: 'oe', Œ: 'oe', ð: 'd', þ: 'th', ß: 'ss' };

function normaliser(nom) {
  return String(nom || '')
    .replace(/[øØæÆœŒðþß]/g, (c) => LETTRES_LIEES[c])
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

/**
 * Pseudos possibles d'un membre. La liste de la guilde note les doubles comptes
 * « lafrustré / elzoska » ou « Bolderiz (Franky) » : chaque morceau est un nom a
 * essayer, pas un seul pseudo a rallonge.
 */
function pseudosDe(member) {
  return String(member.name || '')
    .split(/[/()|,]/)
    .map((part) => normaliser(part))
    .filter(Boolean);
}

async function getJson(url, timeoutMs = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      signal: controller.signal,
    });
    // Raider.IO repond 400 avec un message clair pour un personnage inconnu :
    // c'est un cas normal (reroll, transfert, renommage), pas une panne.
    const payload = await res.json().catch(() => null);
    if (!res.ok) {
      const message = (payload && payload.message) || `HTTP ${res.status}`;
      throw new ArmoryError(message, res.status === 400 ? 'NOT_FOUND' : 'BAD_STATUS');
    }
    return payload;
  } catch (err) {
    if (err instanceof ArmoryError) throw err;
    if (err.name === 'AbortError') {
      throw new ArmoryError(`Raider.IO n'a pas répondu en ${timeoutMs} ms`, 'TIMEOUT');
    }
    throw new ArmoryError(`Raider.IO injoignable : ${err.message}`, 'NETWORK');
  } finally {
    clearTimeout(timer);
  }
}

/** Roster de la guilde : nom exact et classe de chaque personnage, en une requete. */
async function fetchGuildMembers(guild = GUILD) {
  const url =
    `${RIO}/guilds/profile?region=${encodeURIComponent(guild.region)}` +
    `&realm=${encodeURIComponent(guild.realm)}` +
    `&name=${encodeURIComponent(guild.name)}&fields=members`;
  const data = await getJson(url);
  if (!data || !Array.isArray(data.members)) {
    throw new ArmoryError('Réponse de guilde inattendue (pas de membres).', 'BAD_SHAPE');
  }
  return data.members
    .map((entry) => entry.character)
    .filter(Boolean)
    .map((c) => ({
      name: c.name,
      realm: c.realm,
      region: c.region,
      classe: CLASSE_RIO[c.class] || null,
      normalise: normaliser(c.name),
    }));
}

/**
 * Rendu « inset » a partir de l'avatar.
 *
 * Blizzard sert plusieurs tailles sous le meme identifiant de rendu :
 *   ...-avatar.jpg    84 x 84    la pastille ronde des sites de classement
 *   ...-inset.jpg     230 x 116  le buste, cadre pour une carte
 *   ...-main-raw.png  pleine taille, 400 Ko : hors de question pour vingt cartes
 *
 * Raider.IO ne donne que l'avatar : a 84 px il est illisible des qu'on l'agrandit.
 * On derive donc l'inset, en laissant l'avatar en repli — un personnage sans rendu
 * publie n'a que lui.
 *
 * Le `?alt=` de l'avatar designe une image generique de remplacement ; il ne vaut
 * que pour l'avatar, on ne le recopie pas sur l'inset.
 */
function insetDepuisAvatar(avatarUrl) {
  if (typeof avatarUrl !== 'string') return null;
  const sansAlt = avatarUrl.split('?')[0];
  if (!sansAlt.endsWith('-avatar.jpg')) return null;
  return `${sansAlt.slice(0, -'-avatar.jpg'.length)}-inset.jpg`;
}

/**
 * Profil d'un personnage : `thumbnail_url` et, via le champ `gear`, l'ilvl equipe.
 *
 * L'ilvl vient de la derniere fois que Blizzard a publie l'equipement du personnage
 * (`gear.updated_at`), pas de l'instant present : quelqu'un qui vient de recevoir
 * une piece n'apparaitra pas plus haut tant que l'armurerie n'a pas suivi.
 */
async function fetchCharacter(name, realm, region) {
  const url =
    `${RIO}/characters/profile?region=${encodeURIComponent(region)}` +
    `&realm=${encodeURIComponent(realm)}&name=${encodeURIComponent(name)}&fields=gear`;
  return getJson(url);
}

/**
 * Deux noms se ressemblent-ils assez pour qu'on les tienne pour le meme personnage ?
 *
 * Les deux sens n'ont pas la meme valeur, et c'est tout l'interet de les separer :
 *
 *  - le personnage RALLONGE le pseudo (Wutz -> Wutzwutz, Kao -> Kaoblood) : c'est la
 *    facon normale de nommer un reroll, on l'accepte des trois lettres ;
 *  - le pseudo rallonge le personnage (Reinox93 -> Reinox) : la, un prefixe court
 *    rapproche n'importe quoi. « Ràge » happait « Ragelolz » et « Èchø » happait
 *    « Echodoll », deux personnages differents. On exige cinq lettres.
 *
 * Un faux portrait est pire que pas de portrait : dans le doute, on renonce et le
 * membre part dans la liste des non rapproches, ou une saisie tranche.
 */
const MIN_RALLONGE = 3;
const MIN_RACCOURCI = 5;

function prefixeCredible(pseudo, personnage) {
  if (personnage.startsWith(pseudo)) return pseudo.length >= MIN_RALLONGE;
  if (pseudo.startsWith(personnage)) return personnage.length >= MIN_RACCOURCI;
  return false;
}

/**
 * Personnage vise par un membre du roster.
 *
 * Trois cas, du plus sûr au plus flou :
 *  1. le membre porte un champ `armory` : on le croit sur parole, c'est justement
 *     la pour trancher ce que la recherche automatique ne saurait pas faire ;
 *  2. un seul personnage de la guilde porte ce pseudo ET cette classe : c'est lui ;
 *  3. plusieurs, ou aucun : on ne devine pas. Le membre est signale en retour, sa
 *     carte gardera l'icone de spec.
 *
 * Le filtre par classe fait tout le travail dans une guilde pleine de rerolls :
 * « Ryims » existe en chasseur de demons comme en chevalier de la mort.
 */
function resoudrePersonnage(member, guildMembers, guild = GUILD) {
  const manuel = typeof member.armory === 'string' ? member.armory.trim() : '';
  if (manuel) {
    // Accepte « Nom », « Nom-Royaume » et « region/royaume/Nom ». Le decoupage se
    // fait sur le PREMIER tiret seulement : un nom de personnage n'en contient pas,
    // un nom de royaume si (Conseil-des-Ombres).
    const morceaux = manuel.split('/').map((x) => x.trim()).filter(Boolean);
    const dernier = morceaux[morceaux.length - 1];
    const tiret = dernier.indexOf('-');
    const nom = (tiret === -1 ? dernier : dernier.slice(0, tiret)).trim();
    const royaumeEcrit = tiret === -1 ? '' : dernier.slice(tiret + 1).trim();

    // Royaume tu : on le cherche dans la guilde avant de supposer le royaume
    // d'attache. La guilde s'etend sur plusieurs royaumes connectes — Sheechy et
    // Maosham sont sur Ysondre, Reinox sur Archimonde — et supposer Hyjal donnait
    // un « personnage introuvable » pour un nom pourtant exact.
    const connu = guildMembers.find((c) => c.normalise === normaliser(nom));
    return {
      name: nom,
      realm: royaumeEcrit || morceaux[1] || (connu && connu.realm) || guild.realm,
      region:
        (morceaux.length >= 3 ? morceaux[0] : null) ||
        (connu && connu.region) ||
        guild.region,
      origine: 'manuel',
    };
  }

  const pseudos = pseudosDe(member);
  if (!pseudos.length) return { erreur: 'pseudo vide' };

  const memeClasse = guildMembers.filter((c) => c.classe === member.class);
  const exacts = memeClasse.filter((c) => pseudos.includes(c.normalise));
  const approchants = memeClasse.filter((c) =>
    pseudos.some((p) => prefixeCredible(p, c.normalise))
  );
  // Un nom identique l'emporte toujours sur un nom qui commence pareil.
  const candidats = exacts.length ? exacts : approchants;

  if (!candidats.length) return { erreur: 'aucun personnage de cette classe à ce nom' };
  if (candidats.length > 1) {
    return { erreur: `ambigu : ${candidats.map((c) => c.name).join(', ')}` };
  }

  const trouve = candidats[0];
  return {
    name: trouve.name,
    realm: trouve.realm || guild.realm,
    region: trouve.region || guild.region,
    origine: exacts.length ? 'auto' : 'auto-approchant',
  };
}

const pause = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Rapproche tout le roster de l'armurerie et renvoie le cache a ecrire.
 *
 * Un membre deja resolu et toujours identique n'est pas re-interroge si son entree
 * est fraiche : ces vignettes ne changent qu'au relookage du personnage, les
 * retaper a chaque clic ne servirait qu'a marteler Raider.IO.
 */
async function fetchPortraits(members, options = {}) {
  const guild = { ...GUILD, ...(options.guild || {}) };
  const precedent = options.precedent || {};
  const maxAgeMs = options.maxAgeMs === undefined ? 7 * 24 * 60 * 60 * 1000 : options.maxAgeMs;
  const delai = options.delayMs === undefined ? 400 : options.delayMs;
  const journal = options.log || (() => {});

  const guildMembers = await fetchGuildMembers(guild);
  journal(`[armurerie] guilde ${guild.name} (${guild.region}-${guild.realm}) : ${guildMembers.length} personnages`);

  const resultat = {};
  const irresolus = [];

  /**
   * Ce qu'on propose quand on a renonce : les personnages de la guilde qui ont la
   * classe du membre. On ne devine pas a sa place, mais on lui evite de retaper un
   * nom exact — les pseudos de la guilde sont pleins de lettres decoratives.
   */
  const suggestionsPour = (member) =>
    guildMembers
      .filter((c) => c.classe === member.class)
      .map((c) => c.name)
      .sort((a, b) => a.localeCompare(b, 'fr'));

  for (const member of members) {
    const cible = resoudrePersonnage(member, guildMembers, guild);
    if (cible.erreur) {
      irresolus.push({
        id: member.id,
        name: member.name,
        raison: cible.erreur,
        suggestions: suggestionsPour(member),
      });
      journal(`[armurerie] ${member.name} : ${cible.erreur}`);
      continue;
    }

    // Entree encore valable pour le meme personnage : on la garde telle quelle.
    const ancien = precedent[member.id];
    const memeCible =
      ancien &&
      ancien.character === cible.name &&
      ancien.realm === cible.realm &&
      ancien.thumbnail;
    const age = ancien && ancien.fetchedAt ? Date.now() - new Date(ancien.fetchedAt).getTime() : Infinity;
    if (memeCible && age >= 0 && age < maxAgeMs) {
      resultat[member.id] = ancien;
      continue;
    }

    try {
      const profil = await fetchCharacter(cible.name, cible.realm, cible.region);
      resultat[member.id] = {
        character: profil.name || cible.name,
        realm: profil.realm || cible.realm,
        region: profil.region || cible.region,
        thumbnail: profil.thumbnail_url || null,
        inset: insetDepuisAvatar(profil.thumbnail_url),
        profileUrl: profil.profile_url || null,
        race: profil.race || null,
        faction: profil.faction || null,
        activeSpec: profil.active_spec_name || null,
        // Arrondi : l'armurerie donne des decimales (310.688) dont personne ne parle.
        ilvl: profil.gear && profil.gear.item_level_equipped
          ? Math.round(profil.gear.item_level_equipped)
          : null,
        ilvlAt: (profil.gear && profil.gear.updated_at) || null,
        match: cible.origine,
        fetchedAt: new Date().toISOString(),
      };
      journal(`[armurerie] ${member.name} -> ${profil.name} (${cible.origine})`);
    } catch (err) {
      // Un personnage introuvable n'est pas une panne : on garde ce qu'on avait, et
      // on signale le membre pour qu'on puisse corriger son champ `armory`.
      if (ancien) resultat[member.id] = ancien;
      irresolus.push({
        id: member.id,
        name: member.name,
        raison: `${cible.name} : ${err.message}`,
        suggestions: suggestionsPour(member),
      });
      journal(`[armurerie] ${member.name} -> ${cible.name} : ${err.message}`);
    }

    if (delai) await pause(delai);
  }

  return {
    version: 1,
    guild,
    members: resultat,
    unmatched: irresolus,
    updatedAt: new Date().toISOString(),
  };
}

module.exports = {
  GUILD,
  ArmoryError,
  normaliser,
  pseudosDe,
  resoudrePersonnage,
  insetDepuisAvatar,
  fetchGuildMembers,
  fetchCharacter,
  fetchPortraits,
};
