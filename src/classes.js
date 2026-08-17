'use strict';

/**
 * Classes et specs WoW Retail.
 *
 * `slug` est le slug de spec, `role` sert a construire l'URL Icy Veins :
 *   icy-veins.com/wow/<spec>-<classe>-pve-<role>-gear-best-in-slot
 * Les 40 combinaisons ont ete verifiees une a une (toutes en 200).
 *
 * `icon` : slug d'icone sur le CDN Wowhead. Attention, les slugs de spec ne sont pas
 * uniques entre classes (frost, holy, protection, restoration) : ne jamais faire de
 * chercher/remplacer global sur ce fichier.
 */
const CLASSES = {
  'death-knight': {
    icon: 'classicon_deathknight',
    label: 'Chevalier de la mort',
    short: 'DK',
    color: '#C41E3A',
    specs: [
      { slug: 'blood', label: 'Sang', role: 'tank', icon: 'spell_deathknight_bloodpresence' },
      { slug: 'frost', label: 'Givre', role: 'dps', icon: 'spell_deathknight_frostpresence' },
      { slug: 'unholy', label: 'Impie', role: 'dps', icon: 'spell_deathknight_unholypresence' },
    ],
  },
  'demon-hunter': {
    icon: 'classicon_demonhunter',
    label: 'Chasseur de démons',
    short: 'DH',
    color: '#A330C9',
    specs: [
      { slug: 'havoc', label: 'Dévastation', role: 'dps', icon: 'ability_demonhunter_specdps' },
      { slug: 'vengeance', label: 'Vengeance', role: 'tank', icon: 'ability_demonhunter_spectank' },
      { slug: 'devourer', label: 'Dévoration', role: 'dps', icon: 'classicon_demonhunter_void' },
    ],
  },
  druid: {
    icon: 'classicon_druid',
    label: 'Druide',
    short: 'Dru',
    color: '#FF7C0A',
    specs: [
      { slug: 'balance', label: 'Équilibre', role: 'dps', icon: 'spell_nature_starfall' },
      { slug: 'feral', label: 'Farouche', role: 'dps', icon: 'ability_druid_catform' },
      { slug: 'guardian', label: 'Gardien', role: 'tank', icon: 'ability_racial_bearform' },
      { slug: 'restoration', label: 'Restauration', role: 'healing', icon: 'spell_nature_healingtouch' },
    ],
  },
  evoker: {
    icon: 'classicon_evoker',
    label: 'Évocateur',
    short: 'Evo',
    color: '#33937F',
    specs: [
      { slug: 'devastation', label: 'Dévastation', role: 'dps', icon: 'classicon_evoker_devastation' },
      { slug: 'preservation', label: 'Préservation', role: 'healing', icon: 'classicon_evoker_preservation' },
      { slug: 'augmentation', label: 'Augmentation', role: 'dps', icon: 'classicon_evoker_augmentation' },
    ],
  },
  hunter: {
    icon: 'classicon_hunter',
    label: 'Chasseur',
    short: 'Hun',
    color: '#AAD372',
    specs: [
      { slug: 'beast-mastery', label: 'Maîtrise des bêtes', role: 'dps', icon: 'ability_hunter_bestialdiscipline' },
      { slug: 'marksmanship', label: 'Précision', role: 'dps', icon: 'ability_hunter_focusedaim' },
      { slug: 'survival', label: 'Survie', role: 'dps', icon: 'ability_hunter_camouflage' },
    ],
  },
  mage: {
    icon: 'classicon_mage',
    label: 'Mage',
    short: 'Mag',
    color: '#3FC7EB',
    specs: [
      { slug: 'arcane', label: 'Arcanes', role: 'dps', icon: 'spell_holy_magicalsentry' },
      { slug: 'fire', label: 'Feu', role: 'dps', icon: 'spell_fire_firebolt02' },
      { slug: 'frost', label: 'Givre', role: 'dps', icon: 'spell_frost_frostbolt02' },
    ],
  },
  monk: {
    icon: 'classicon_monk',
    label: 'Moine',
    short: 'Mnk',
    color: '#00FF98',
    specs: [
      { slug: 'brewmaster', label: 'Maître brasseur', role: 'tank', icon: 'spell_monk_brewmaster_spec' },
      { slug: 'mistweaver', label: 'Tisse-brume', role: 'healing', icon: 'spell_monk_mistweaver_spec' },
      { slug: 'windwalker', label: 'Marche-vent', role: 'dps', icon: 'spell_monk_windwalker_spec' },
    ],
  },
  paladin: {
    icon: 'classicon_paladin',
    label: 'Paladin',
    short: 'Pal',
    color: '#F48CBA',
    specs: [
      { slug: 'holy', label: 'Sacré', role: 'healing', icon: 'spell_holy_holybolt' },
      { slug: 'protection', label: 'Protection', role: 'tank', icon: 'ability_paladin_shieldofthetemplar' },
      { slug: 'retribution', label: 'Vindicte', role: 'dps', icon: 'spell_holy_auraoflight' },
    ],
  },
  priest: {
    icon: 'classicon_priest',
    label: 'Prêtre',
    short: 'Pri',
    color: '#FFFFFF',
    specs: [
      { slug: 'discipline', label: 'Discipline', role: 'healing', icon: 'spell_holy_powerwordshield' },
      { slug: 'holy', label: 'Sacré', role: 'healing', icon: 'spell_holy_guardianspirit' },
      { slug: 'shadow', label: 'Ombre', role: 'dps', icon: 'spell_shadow_shadowwordpain' },
    ],
  },
  rogue: {
    icon: 'classicon_rogue',
    label: 'Voleur',
    short: 'Rog',
    color: '#FFF468',
    specs: [
      { slug: 'assassination', label: 'Assassinat', role: 'dps', icon: 'ability_rogue_eviscerate' },
      { slug: 'outlaw', label: 'Hors-la-loi', role: 'dps', icon: 'inv_sword_30' },
      { slug: 'subtlety', label: 'Finesse', role: 'dps', icon: 'ability_stealth' },
    ],
  },
  shaman: {
    icon: 'classicon_shaman',
    label: 'Chaman',
    short: 'Cha',
    color: '#0070DD',
    specs: [
      { slug: 'elemental', label: 'Élémentaire', role: 'dps', icon: 'spell_nature_lightning' },
      { slug: 'enhancement', label: 'Amélioration', role: 'dps', icon: 'spell_shaman_improvedstormstrike' },
      { slug: 'restoration', label: 'Restauration', role: 'healing', icon: 'spell_nature_magicimmunity' },
    ],
  },
  warlock: {
    icon: 'classicon_warlock',
    label: 'Démoniste',
    short: 'Dmn',
    color: '#8788EE',
    specs: [
      { slug: 'affliction', label: 'Affliction', role: 'dps', icon: 'spell_shadow_deathcoil' },
      { slug: 'demonology', label: 'Démonologie', role: 'dps', icon: 'spell_shadow_metamorphosis' },
      { slug: 'destruction', label: 'Destruction', role: 'dps', icon: 'spell_shadow_rainoffire' },
    ],
  },
  warrior: {
    icon: 'classicon_warrior',
    label: 'Guerrier',
    short: 'War',
    color: '#C69B6D',
    specs: [
      { slug: 'arms', label: 'Armes', role: 'dps', icon: 'ability_warrior_savageblow' },
      { slug: 'fury', label: 'Fureur', role: 'dps', icon: 'ability_warrior_innerrage' },
      { slug: 'protection', label: 'Protection', role: 'tank', icon: 'ability_warrior_defensivestance' },
    ],
  },
};

function classInfo(className) {
  return CLASSES[className] || null;
}

function specInfo(className, specSlug) {
  const info = CLASSES[className];
  if (!info) return null;
  return info.specs.find((s) => s.slug === specSlug) || null;
}

/** "Guerrier — Fureur" */
function specLabel(className, specSlug) {
  const info = CLASSES[className];
  const spec = specInfo(className, specSlug);
  if (!info || !spec) return `${className} — ${specSlug}`;
  return `${info.label} — ${spec.label}`;
}

module.exports = { CLASSES, classInfo, specInfo, specLabel };
