'use strict';

/**
 * Met a jour toutes les specs suivies, sans passer par le serveur.
 *
 *   node tools/refresh-all.js            toutes les specs suivies
 *   node tools/refresh-all.js --limit=2  les 2 premieres (mise au point)
 *   node tools/refresh-all.js --delay=2000
 *
 * Meme travail que le bouton « Mettre a jour », spec par spec : Icy Veins pour la
 * liste BiS, Bloodmallet pour les bijoux simules, Wowhead pour la tier list et les
 * consommables. C'est ce script que la GitHub Action appelle une fois par jour.
 *
 * Trois principes :
 *
 *  - **Un echec n'ecrase rien.** Une source muette laisse en place ce qui etait deja
 *    en cache ; on prefere une donnee d'hier a un trou.
 *  - **Le script ne sort en erreur que si tout echoue.** Une spec qui casse ne doit
 *    pas empecher les 18 autres d'etre publiees.
 *  - **On espace les requetes.** Ces sites nous rendent service, on ne les martele pas.
 */

const path = require('path');

const ROOT = path.join(__dirname, '..');
const { SPECS, specKey, guideUrl, findSpec } = require(path.join(ROOT, 'src/specs'));
const { readRoster } = require(path.join(ROOT, 'src/roster'));
const {
  readStore,
  saveSpecEntry,
  saveTrinketEntry,
  saveWowheadEntry,
  savePowerInfusion,
} = require(path.join(ROOT, 'src/store'));
const { scrapeGuide } = require(path.join(ROOT, 'src/icyveins'));
const { fetchTrinkets, fetchPowerInfusion } = require(path.join(ROOT, 'src/bloodmallet'));
const { fetchTrinketTiers, fetchConsumables } = require(path.join(ROOT, 'src/wowhead'));

function option(nom, defaut) {
  const arg = process.argv.find((a) => a.startsWith(`--${nom}=`));
  if (!arg) return defaut;
  const valeur = Number(arg.split('=')[1]);
  return Number.isFinite(valeur) ? valeur : defaut;
}

const LIMITE = option('limit', Infinity);
const DELAI = option('delay', 1500);

const pause = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Specs a mettre a jour : celles jouees dans le roster, plus celles deja en cache.
 * C'est exactement ce que le front affiche — inutile de scraper les 39.
 */
function specsSuivies() {
  const jouees = new Set(
    readRoster()
      .filter((m) => m.spec)
      .map((m) => specKey(m.class, m.spec))
  );
  const enCache = new Set(Object.keys(readStore().specs || {}));

  return SPECS.filter((s) => {
    const key = specKey(s.class, s.spec);
    return jouees.has(key) || enCache.has(key);
  });
}

async function majSpec(entry) {
  const key = specKey(entry.class, entry.spec);
  const resultat = { key, sources: [], echecs: [] };

  // 1. Icy Veins : la liste BiS elle-meme. Si elle echoue, on ne touche a rien
  // d'autre pour cette spec — le reste n'a de sens qu'accroche a une liste.
  try {
    const url = guideUrl(entry);
    const parsed = await scrapeGuide(url);
    saveSpecEntry(key, {
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
    });
    resultat.sources.push(`${parsed.items.length} slots`);
  } catch (err) {
    resultat.echecs.push(`Icy Veins : ${err.message}`);
    return resultat;
  }

  // 2. Bloodmallet. Absent pour les soins et quelques DPS : c'est normal.
  try {
    const sim = await fetchTrinkets(entry.class, entry.spec);
    saveTrinketEntry(key, { key, ...sim, fetchedAt: new Date().toISOString() });
    // Le classement est publie par nombre de cibles ({ '1': {...}, '3', '5' }) : il
    // n'y a pas de liste a plat, on compte celui a une cible.
    const monoCible = (sim.targets && sim.targets['1'] && sim.targets['1'].trinkets) || [];
    if (sim.available) resultat.sources.push(`${monoCible.length} bijoux simulés`);
  } catch (err) {
    resultat.echecs.push(`Bloodmallet : ${err.message}`);
  }

  // 3. Wowhead : tier list et consommables, deux pages distinctes.
  const wowhead = { key, fetchedAt: new Date().toISOString() };
  try {
    wowhead.trinkets = await fetchTrinketTiers(entry.class, entry.spec);
    if (wowhead.trinkets.available) {
      const total = wowhead.trinkets.tiers.reduce((s, t) => s + t.items.length, 0);
      resultat.sources.push(`tier list ${total}`);
    }
  } catch (err) {
    resultat.echecs.push(`Wowhead bijoux : ${err.message}`);
  }
  try {
    wowhead.consumables = await fetchConsumables(entry.class, entry.spec, entry.role);
    if (wowhead.consumables.available) {
      resultat.sources.push(`${wowhead.consumables.rows.length} conso`);
    }
  } catch (err) {
    resultat.echecs.push(`Wowhead conso : ${err.message}`);
  }
  if (wowhead.trinkets || wowhead.consumables) saveWowheadEntry(key, wowhead);

  return resultat;
}

/**
 * Classement Power Infusion : une seule requete pour toute l'application, hors de la
 * boucle des specs puisqu'il n'appartient a aucune. Il echoue seul — le reste de la
 * mise a jour reste publiable.
 */
async function majPowerInfusion() {
  try {
    const classement = await fetchPowerInfusion();
    if (!classement.available) return 'Power Infusion : aucune donnée';
    savePowerInfusion(classement);
    const compte = Object.entries(classement.targets)
      .filter(([, d]) => d.available)
      .map(([cibles, d]) => `${d.top.length} à ${cibles} cible(s)`)
      .join(', ');
    return `Power Infusion : ${compte}`;
  } catch (err) {
    return `Power Infusion : ÉCHEC (${err.message})`;
  }
}

(async () => {
  const cibles = specsSuivies().slice(0, LIMITE);
  if (!cibles.length) {
    console.log('Aucune spec suivie : rien à mettre à jour.');
    return;
  }

  console.log(`${cibles.length} spec(s) à mettre à jour, ${DELAI} ms entre chaque.\n`);

  const echecsComplets = [];
  const avertissements = [];

  for (const [index, entry] of cibles.entries()) {
    const r = await majSpec(entry);
    const etat = r.sources.length ? r.sources.join(', ') : 'ÉCHEC';
    console.log(`  ${String(index + 1).padStart(2)}. ${r.key.padEnd(24)} ${etat}`);
    for (const e of r.echecs) console.log(`      ! ${e}`);

    if (!r.sources.length) echecsComplets.push(r.key);
    else if (r.echecs.length) avertissements.push(...r.echecs.map((e) => `${r.key} — ${e}`));

    if (index < cibles.length - 1) await pause(DELAI);
  }

  console.log(`  ${await majPowerInfusion()}`);

  console.log(
    `\n${cibles.length - echecsComplets.length}/${cibles.length} spec(s) à jour, ` +
      `${avertissements.length} avertissement(s), ${echecsComplets.length} échec(s) complet(s).`
  );

  // Tout casser signale un vrai probleme (site en panne, parseur a revoir) : la CI
  // doit le voir. Quelques specs en echec ne doivent pas bloquer la publication des
  // autres, dont les donnees restent celles d'avant.
  if (echecsComplets.length === cibles.length) {
    console.error('\nToutes les specs ont échoué — rien de publiable.');
    process.exit(1);
  }
})();
