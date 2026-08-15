'use strict';

/**
 * Compare les listes BiS en ligne avec celles du cache, et dit ce qui a bougé.
 *
 *   npm run check                  # rapport seul, n'écrit rien
 *   npm run check -- --write       # applique les changements au cache
 *   npm run check -- mage          # ne vérifie que les specs dont la clé contient "mage"
 *   npm run check -- --write mage  # les deux à la fois
 *
 * Sert avant une republication : on voit d'un coup d'œil si un guide a été mis à
 * jour, quelle spec est touchée et sur quel emplacement — au lieu de rafraîchir
 * chaque spec à la main et de comparer de mémoire.
 */

const path = require('path');

const ROOT = path.join(__dirname, '..');
const { findSpec, guideUrl, specKey } = require(path.join(ROOT, 'src/specs'));
const { readRoster } = require(path.join(ROOT, 'src/roster'));
const { readStore, saveSpecEntry, saveTrinketEntry } = require(path.join(ROOT, 'src/store'));
const { scrapeGuide } = require(path.join(ROOT, 'src/icyveins'));
const { fetchTrinkets } = require(path.join(ROOT, 'src/bloodmallet'));

const WRITE = process.argv.includes('--write');
// Tout argument qui n'est pas une option filtre les specs : « mage », « paladin »...
const FILTER = process.argv.slice(2).filter((a) => !a.startsWith('--'))[0] || null;
const DELAY_MS = 3000; // même politesse que le bouton de l'interface

/** Empreinte lisible d'une liste : un objet par emplacement. */
function snapshot(list) {
  const map = new Map();
  for (const item of list.items || []) {
    if (item.empty || !item.itemId) continue;
    const key = `${item.slotFr || item.slot}#${map.size}`;
    map.set(key, {
      slot: item.slotFr || item.slot,
      name: item.name,
      itemId: item.itemId,
      source: item.source,
      catalyst: Boolean(item.catalyst),
    });
  }
  return map;
}

function compareLists(before, after) {
  const changes = [];
  const beforeLists = new Map((before.lists || []).map((l) => [l.label, l]));
  const afterLists = new Map((after.lists || []).map((l) => [l.label, l]));

  for (const [label, list] of afterLists) {
    if (!beforeLists.has(label)) {
      changes.push(`liste ajoutée : « ${label} »`);
      continue;
    }
    const a = snapshot(beforeLists.get(label));
    const b = snapshot(list);
    const keys = new Set([...a.keys(), ...b.keys()]);
    for (const key of keys) {
      const x = a.get(key);
      const y = b.get(key);
      if (!x) changes.push(`${label} · ${y.slot} : + ${y.name}`);
      else if (!y) changes.push(`${label} · ${x.slot} : − ${x.name}`);
      else if (x.itemId !== y.itemId) {
        changes.push(`${label} · ${y.slot} : ${x.name} → ${y.name}`);
      } else if (x.source !== y.source) {
        changes.push(`${label} · ${y.slot} · ${y.name} : source ${x.source} → ${y.source}`);
      } else if (x.catalyst !== y.catalyst) {
        changes.push(
          `${label} · ${y.slot} · ${y.name} : ${y.catalyst ? 'devient' : 'n’est plus'} à catalyser`
        );
      }
    }
  }
  for (const label of beforeLists.keys()) {
    if (!afterLists.has(label)) changes.push(`liste retirée : « ${label} »`);
  }
  return changes;
}

(async () => {
  const store = readStore();
  const keys = new Map();
  for (const member of readRoster()) {
    if (!member.spec) continue;
    const entry = findSpec(member.class, member.spec);
    if (!entry) continue;
    const key = specKey(entry.class, entry.spec);
    if (FILTER && !key.includes(FILTER.toLowerCase())) continue;
    keys.set(key, entry);
  }

  if (!keys.size) {
    console.log(`Aucune spec du roster ne correspond à « ${FILTER} ».`);
    return;
  }

  console.log(
    `${keys.size} spec(s) à vérifier${FILTER ? ` (filtre « ${FILTER} »)` : ''} — ` +
      `${WRITE ? 'le cache sera mis à jour' : 'lecture seule'}\n`
  );

  let changed = 0;
  let failed = 0;
  const report = [];

  for (const [key, entry] of [...keys].sort()) {
    process.stdout.write(`${key.padEnd(24)} `);
    try {
      const parsed = await scrapeGuide(guideUrl(entry));
      const before = store.specs[key];

      if (!before) {
        console.log('nouveau dans le cache');
        changed += 1;
        report.push({ key, changes: ['spec absente du cache jusqu’ici'] });
      } else {
        const changes = compareLists(before, parsed);
        const dateChanged =
          before.guideUpdated !== parsed.guideUpdated
            ? [`date du guide : ${before.guideUpdated} → ${parsed.guideUpdated}`]
            : [];
        if (changes.length) {
          console.log(`${changes.length} changement(s)`);
          changed += 1;
          report.push({ key, changes: [...dateChanged, ...changes] });
        } else if (dateChanged.length) {
          console.log('guide réédité, BiS inchangé');
          report.push({ key, changes: dateChanged });
        } else {
          console.log('inchangé');
        }
      }

      if (WRITE) {
        saveSpecEntry(key, {
          key,
          class: entry.class,
          spec: entry.spec,
          label: entry.label,
          url: guideUrl(entry),
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
        try {
          const sim = await fetchTrinkets(entry.class, entry.spec);
          saveTrinketEntry(key, { key, ...sim, fetchedAt: new Date().toISOString() });
        } catch (err) {
          console.log(`   (bijoux indisponibles : ${err.message})`);
        }
      }
    } catch (err) {
      console.log(`ÉCHEC — ${err.message}`);
      failed += 1;
    }
    await new Promise((resolve) => setTimeout(resolve, DELAY_MS));
  }

  console.log('\n' + '─'.repeat(60));
  if (!report.length) {
    console.log('Aucun changement : les BiS en ligne sont identiques au cache.');
  } else {
    for (const { key, changes } of report) {
      console.log(`\n${key}`);
      for (const line of changes) console.log(`   ${line}`);
    }
  }
  console.log(
    `\n${changed} spec(s) modifiée(s), ${failed} en échec.` +
      (WRITE
        ? '\nCache mis à jour. Pensez à relancer : npm run build:static'
        : '\nRien n’a été écrit. Pour appliquer : npm run check -- --write')
  );
})();
