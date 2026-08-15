'use strict';

const { CLASSES, specLabel } = require('./classes');

/**
 * Liste blanche des pages scrapables : toutes les classes/specs Retail.
 * C'est la garde de securite du scraper : on ne fetch QUE des URLs construites
 * a partir d'ici, jamais une URL fournie par le client.
 *
 * Etre dans cette liste ne declenche rien : rien n'est scrape tant que personne
 * ne clique. Le front n'affiche que les specs jouees dans le roster ou deja en cache.
 */
const SPECS = Object.entries(CLASSES).flatMap(([className, info]) =>
  info.specs.map((spec) => ({
    class: className,
    spec: spec.slug,
    role: spec.role,
    label: specLabel(className, spec.slug),
  }))
);

const GUIDE_BASE = 'https://www.icy-veins.com/wow';

function specKey(className, specName) {
  return `${className}-${specName}`;
}

function findSpec(className, specName) {
  if (typeof className !== 'string' || typeof specName !== 'string') return null;
  const c = className.toLowerCase().trim();
  const s = specName.toLowerCase().trim();
  return SPECS.find((entry) => entry.class === c && entry.spec === s) || null;
}

/** icy-veins.com/wow/<spec>-<classe>-pve-<role>-gear-best-in-slot */
function guideUrl(entry) {
  const spec = findSpec(entry.class, entry.spec);
  const role = (spec && spec.role) || entry.role || 'dps';
  return `${GUIDE_BASE}/${entry.spec}-${entry.class}-pve-${role}-gear-best-in-slot`;
}

module.exports = { SPECS, specKey, findSpec, guideUrl };
