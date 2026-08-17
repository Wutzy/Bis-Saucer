# Gold Saucer — BiS de guilde (WoW Retail)

Outil interne : affiche les listes **Best in Slot** par classe/spec pour le roster de la guilde,
avec un bouton qui va rescraper le guide **Icy Veins** correspondant à la demande.

- Backend Node.js + Express, scraping **côté serveur** (Cheerio).
- Cache dans un simple fichier JSON : `data/bis.json`.
- Front vanilla (une page), tooltips d'objets via le script d'embed officiel Wowhead.

## Lancer en local

Prérequis : **Node.js 18+** (le scraper utilise `fetch` natif).

```bash
npm install
```

```bash
npm start
```

Puis ouvrir http://localhost:3000

| Variable | Défaut | Rôle |
| --- | --- | --- |
| `PORT` | `3000` | Port HTTP |
| `SCRAPE_MIN_INTERVAL_MS` | `600000` (10 min) | Délai minimum entre deux scrapes d'une même classe/spec. `0` désactive la limite — utile uniquement pour un rattrapage complet après correction du parseur |

> Node met les modules en cache au démarrage : **toute modification dans `src/` demande un
> redémarrage du serveur**. Le front, lui, se recharge tout seul.

## Mettre en ligne (gratuit)

**GitHub Pages ne sert que des fichiers statiques : il ne peut pas exécuter le serveur Node.**
Les deux actions qui écrivent — scraper une spec, changer la spec d'un membre — n'y sont donc pas
possibles. Comme les données vivent déjà dans des fichiers JSON, la solution est de publier un
**export figé**, destiné à la consultation :

```bash
npm run build:static
```

[`tools/build-static.js`](tools/build-static.js) produit `docs/` : le front, les images, et les
quatre routes de lecture transformées en fichiers JSON de même forme. La page est marquée
`window.BIS_STATIC`, ce qui masque le bouton « Rafraîchir » et verrouille le menu du Roster, avec
la mention « version consultable » en pied de page. Tout le reste fonctionne à l'identique.

### Publier, la première fois

1. Sur github.com : **New repository**, un nom (`bis-saucer`), **Public**, sans cocher
   « Add a README ».
2. Dans le dossier du projet :

```bash
git init && git branch -M main && git add . && git commit -m "BiS Saucer"
```

```bash
git remote add origin https://github.com/<toi>/<depot>.git && git push -u origin main
```

3. Sur GitHub : **Settings → Pages → Source : « Deploy from a branch » → branche `main`,
   dossier `/docs` → Save**.
4. Une minute plus tard, le site est sur `https://<toi>.github.io/<depot>/`.

### Mettre à jour, et vérifier ce qui a changé

```bash
npm run check
```

[`tools/check-bis.js`](tools/check-bis.js) rescrape les specs du roster et **compare au cache sans
rien écrire**. Il dit, spec par spec, si les listes sont inchangées, et détaille sinon :
changement d'objet sur un emplacement, changement de source, passage en « à catalyser », liste
ajoutée ou retirée, et réédition du guide sans changement de BiS. C'est plus fiable que de
rafraîchir 18 specs à la main et de comparer de mémoire.

On peut ne vérifier qu'une partie du roster en passant un filtre — pratique pour tester une
seule spec sans attendre les 18 :

```bash
npm run check -- mage
```

Ensuite, si des changements sont à garder :

```bash
npm run check -- --write && npm run build:static
```

```bash
git add -A && git commit -m "maj BiS" && git push
```

Pages se met à jour tout seul après le push.

À savoir : **un dépôt GitHub public rend le site public**, pseudonymes du roster compris. Un dépôt
privé avec Pages demande un compte payant ; sinon, les alternatives gratuites qui exécutent
vraiment Node (Render, Fly.io…) ont un disque éphémère, donc les caches JSON écrits par le scrape
y seraient perdus à chaque redémarrage — l'export statique reste le plus robuste ici.

## Navigation

La portée sépare les deux niveaux de navigation, et rien ne les mélange :

- **La barre du haut** : le **blason** en tête — l'entrée unique de tout ce qui concerne la
  guilde, et l'écran sur lequel l'application ouvre — puis, après un trait, **une icône par spec
  suivie** (la spec active est en couleur, les autres désaturées ; le survol donne le libellé, qui
  la joue et le nombre de slots en cache).
- **Le bandeau d'onglets** ne porte que les vues de la spec affichée : **Liste BiS**, **M+ opti**,
  **Consommables**, **/rand**.

Le blason ouvre un **écran d'accueil à trois cartes** — /rand Raid, /rand Mythique+, et le
**Roster Mythique (prévisionnel)** — puis une barre reprend ces trois destinations en haut de
chacune, pour passer de l'une à l'autre sans repasser par l'accueil. Cet écran d'accueil se passe
d'en-tête : les cartes se présentent toutes seules. **C'est là que l'application démarre.**

**Le /rand existe des deux côtés**, avec les mêmes tableaux, mais pas avec la même portée :
l'onglet de spec montre **le raid seulement** — ce que cette spec doit rand — alors que le blason
donne accès au raid *et* au Mythique+ de toute la guilde.

Les vues de guilde **masquent le bandeau d'onglets**, qui n'aurait rien à y piloter. La barre du
haut, elle, reste affichée partout : c'est par elle qu'on en sort, de deux façons :

- **le blason**, actif dans toute la partie guilde, qui fonctionne en bascule et ramène
  exactement à la vue d'où l'on venait ;
- **une icône de spec**, qui ouvre la **Liste BiS** de cette spec — les onglets réapparaissent.
  C'est vrai partout : choisir une spec, c'est demander à la voir, et on commence par son
  équipement, jamais sur l'onglet qui se trouvait ouvert.

## Les six vues

### Portée « spec »

- **Liste BiS** — présentation « feuille de personnage » reprise du guide : deux colonnes
  d'emplacements, armes en bas, emplacements vides (chemise, tabard) inclus. Chaque carte porte
  l'objet, son emplacement, sa provenance, son enchantement et ses gemmes. Les pièces de set à
  récupérer **en donjon** ont une bordure ambre plus épaisse : ce sont les plus contraignantes à
  obtenir, puisqu'il faut farmer le donjon puis catalyser.
  Quand le guide publie plusieurs listes (Overall / Mythic+ / Raid, et une déclinaison par talent
  de héros chez certaines specs), un sélecteur apparaît au-dessus.
- **M+ opti** — le classement des donjons par nombre de pièces BiS à y récupérer, avec la liste
  des objets (emplacement, mention Catalyseur quand il faut transformer la pièce). Chaque donjon
  indique aussi **quels camarades ont intérêt à le farmer** : une pastille par joueur, réduite à
  son icône de spec et à son nombre de BiS, le pseudo étant dans l'infobulle.
  Le tri se fait **d'abord sur les BiS généraux**, puis sur le total : une pièce BiS toutes
  sources confondues restera équipée une fois le raid farmé, alors qu'un BiS propre à la liste
  Mythique+ n'est qu'un palier. Les premiers sont **encadrés en vert** avec l'étiquette
  « BiS overall », les seconds portent le tag `liste M+`.
  Les bijoux du haut de classement Bloodmallet qui tombent en donjon y sont ajoutés même quand le
  guide ne les retient pas, avec leur rang par nombre de cibles (`1c #2 · 3c #1 · 5c #2`).
  La vue s'ouvre sur une **grille de donjons illustrée** — de quoi voir d'un coup d'œil où aller
  farmer. Cliquer une carte **descend jusqu'au donjon et estompe les autres**, pour en lire un à
  la fois ; un second clic remet tout à plat.
- **Consommables** — ce que le guide **Wowhead** recommande d'emporter : flacon, potions,
  huile d'arme, rune d'amélioration, nourriture. Une ligne par type ; plusieurs objets sur une
  ligne quand l'auteur les donne comme équivalents ou dépendants de la situation.
- **/rand** — la vue à ouvrir pendant un raid : boss par boss, **uniquement les objets sur
  lesquels la spec affichée doit rand**, avec, sur chaque ligne, **tous les autres joueurs du
  roster qui les convoitent** — ceux contre qui il faudra rand. Un boss qui ne concerne pas la
  spec disparaît de la liste. **Uniquement du raid, et pas de bascule** : en Mythique+ le butin
  est ciblé, personne ne roule dessus. Sur une pièce catalysée, la ligne précise **la pièce qu'on
  ramasse réellement sur ce boss**, car ce n'est pas l'objet de set affiché qui y tombe.

### Portée « guilde »

- **/rand (guilde)** — le même écran, sans filtre de spec : tout ce que le roster convoite,
  boss par boss et donjon par donjon. En Mythique+, chaque carte de donjon porte **une pastille par spec
  concernée, avec son nombre d'objets à récupérer là** : de quoi voir d'un coup d'œil qui a
  intérêt à monter le groupe.
- **Roster Mythique (prévisionnel)** — la composition, **groupée par rôle** : Tank, Soigneur,
  puis DPS scindé en *Distance* et *Corps à corps*. C'est ainsi qu'on lit une compo de raid, pas
  classe par classe : on voit d'un coup si les tanks et les soigneurs sont là. À l'intérieur d'un
  groupe, tri par classe puis par ordre d'arrivée.
  La vue ne montre **que les membres du roster mythique** ; les autres sont dans un repli
  « Hors roster mythique » en bas, d'où on peut les réintégrer. C'est aussi ici qu'on **ajoute et
  retire des membres** (pseudo + classe + spec) et qu'on coche les deux statuts (voir plus bas).

## Bijoux : trois lectures empilées

Le choix d'un bijou ne se tranche pas d'une seule source. La vue **Liste BiS** en montre deux,
dans cet ordre :

1. **Bloodmallet** — le classement par simulation, avec l'écart en % au meilleur. En premier :
   c'est la lecture chiffrée, celle qui tranche.
2. **Une liste éditoriale au choix**, sélecteur dans l'en-tête du panneau :
   - **Wowhead** — la **tier list** du guide, un rang par ligne (S, A, B…), avec les mêmes cases
     de provenance que sur le site : Raid, Mythique+, Gouffres, Artisanat. Décocher une case
     retire les bijoux correspondants de tous les rangs.
   - **Icy Veins** — les bijoux mis en avant par l'auteur, rangés comme lui les range (à utiliser
     / passifs, ou S Tier / A Tier selon les guides). Vient du même scrape que la liste BiS, via
     `trinketAdvice`.

Ces deux-là disent la même chose autrement : les empiler ferait doublon, on en regarde **une à la
fois**. Le choix vaut pour toutes les specs. Une source sans données pour la spec affichée garde
son bouton, désactivé — et la préférence revient dès qu'on retombe sur une spec qui l'a.

Un bijou retenu dans la liste BiS du guide porte un badge **BiS** dans la liste éditoriale.

### Le sélecteur de liste vaut aussi pour les bijoux

Quand le guide publie plusieurs listes (**Overall**, **Mythic+**, **Raid**), le choix ne concerne
plus seulement l'armure : les bijoux suivent.

| Liste | Bijoux affichés |
| --- | --- |
| Overall (ou une déclinaison par talent de héros) | tous, affichage inchangé |
| Mythic+ | uniquement ceux **obtenables en donjon** |
| Raid | uniquement ceux **obtenables en raid** |

Sur une liste ciblée, un bijou de craft ou de PvP disparaît : il n'y est pas obtenable. Le
classement Bloodmallet est **filtré avant d'être coupé au top 5**, pour que les cinq affichés
soient les cinq meilleurs *éligibles* et non un reste de la liste générale ; l'écart en % reste
mesuré par rapport au meilleur toutes provenances confondues, puisque c'est ce qu'on perd à se
limiter à ce contenu. Côté tier list Wowhead, les cases de provenance s'effacent au profit d'une
mention — la liste décide déjà, deux filtres concurrents sur le même panneau seraient illisibles.

La provenance d'un bijou se lit sur **trois signaux, du plus précis au plus général**, chacun
portant sur l'objet lui-même : la catégorie que Bloodmallet lui donne, la provenance lue dans les
listes Icy Veins (arbitrée par `classifySources()`), puis les catégories du guide Wowhead **de la
spec affichée**. Ce dernier point compte : agréger les catégories de tous les guides donnait des
bijoux à la fois « raid » et « donjon », donc visibles partout — les auteurs ne rangent pas
toujours un objet de la même façon. Un bijou qu'aucun signal ne sait ranger **reste affiché** :
on n'écarte que ce qu'on sait appartenir ailleurs.

### Comment la donnée Wowhead est récupérée

[`src/wowhead.js`](src/wowhead.js). Les guides Wowhead sont écrits dans un **balisage maison
servi tel quel dans le HTML**, encapsulé en JSON — rien à exécuter, aucun navigateur à piloter :

```
[tier-list=rows grid]
  [tier][tier-label bg=q5]S[/tier-label][tier-content]
  [icon-badge=270164 quality=4 display-options=raid tooltip="..."]

[table class=grid]
  [tr][td]Flask[/td][td align=center][item=241322][item=241324][/td][/tr]
```

La même page embarque nom, icône et qualité de chaque objet cité (`WH.Gatherer.addData`) : **une
seule requête** suffit par page. Les bijoux viennent de `bis-gear`, les consommables de
`enchants-gems-pve-<rôle>` — où le rôle s'écrit `dps`, `tank` ou `healer` (notre référentiel dit
`healing`, d'où la table de correspondance).

Vérifié sur les 39 specs : **toutes** publient une tier list, de 4 à 6 rangs. Les deux appels
sont **non bloquants** dans `/api/scrape`, comme Bloodmallet : une page qui change de forme ne
doit pas faire échouer la mise à jour du BiS. Cache dans `data/wowhead.json`.

## Roster mythique : deux périmètres, pas deux rosters

Tout le monde fait du Mythique+, mais **tout le monde ne va pas en raid**. Une case
**Roster mythique** par membre tranche, et c'est la seule chose qu'elle change :

| Contenu | Qui est compté |
| --- | --- |
| Sources de **raid** (boss, « Raid — boss non précisé ») | uniquement les membres cochés |
| Sources de **donjon** (Mythique+) | **tout** le roster |
| Craft, Catalyseur, trash | **tout** le roster |

Un membre décoché n'est pas à moitié dans l'outil : il garde sa spec, sa liste BiS, sa place dans
« M+ opti » et dans le /rand Mythique+. Il disparaît seulement des tableaux de butin de raid — et
si **personne** de sa spec n'est dans le roster mythique, la spec entière disparaît des sources de
raid, ce qui est bien le résultat voulu : personne ne roule dessus ce soir-là.

Côté données, c'est le champ `raid` de chaque membre dans [`data/roster.json`](data/roster.json).
**Absent vaut `true`** : un roster écrit avant l'ajout du champ garde exactement son sens. Le
filtrage se fait dans `buildSources()` ([`public/app.js`](public/app.js)), qui classe chaque
source avant de regrouper le butin, précisément pour savoir quel périmètre appliquer.

### Membres à l'essai

Décocher **Roster mythique** retire aussi la personne de l'affichage principal du Roster : elle
bascule dans le repli du bas. Sans ce repli, décocher quelqu'un le ferait disparaître sans aucun
moyen de le remettre.

La répartition Distance / Corps à corps n'existe pas dans [`src/classes.js`](src/classes.js), qui
ne connaît que tank / dps / healing — la distinction n'entre pas dans les URLs Icy Veins. Elle vit
donc dans `DPS_DISTANCE` ([`public/app.js`](public/app.js)), avec le reste du vocabulaire
d'affichage : tout ce qui est DPS sans y figurer est du corps à corps.

### Membres à l'essai

Une seconde case, **En test**, marque les joueurs à l'essai (champ `trial`, absent vaut `false`).
Elle ne se comporte **pas** comme la précédente : elle ne filtre rien du tout. Un joueur à l'essai
raid et roule comme les autres — c'est bien l'intérêt d'un essai. Il est seulement **signalé**,
là où ça sert au moment d'arbitrer :

- un badge `en test` tireté à côté de son pseudo dans le Roster ;
- sa pastille passe en **contour tireté** dans tous les tableaux de butin, sa couleur de classe
  inchangée, et l'infobulle ajoute « à l'essai ».

Les deux cases sont indépendantes : on peut être à l'essai *dans* le roster mythique, à l'essai
en dehors, ou ni l'un ni l'autre.

## Pièces de set et Catalyseur

C'est la subtilité principale de ces listes. Une pièce de set s'obtient de deux façons :

1. elle tombe directement à la source indiquée ;
2. ou il faut ramasser à cette source la pièce du **même emplacement** avec les bonnes stats,
   puis la transformer au **Catalyseur**.

Le parseur croise **deux signaux**, et il en faut bien deux :

1. **La mention écrite** dans le champ de provenance. Chaque auteur l'écrit à sa façon :
   `Coiled Altar + Catalyst`, `Catalyst from Coiled Altar`, `Coiled Altar with Catalyst`,
   `Catalyst or Vashnik`, `Catalyst on the shoulders from Murder Row`, `Catalyst Legs from Den of
   Nalorakk`, ou `Catalyst` tout court. `extractSource()` dans
   [`src/icyveins.js`](src/icyveins.js) sépare le nom de la source de la mention, quelle que soit
   la tournure.
2. **L'attribut `original-item`** du lien Wowhead. Quand Icy Veins écrit
   `item=271565&…&original-item=268243`, l'objet affiché est la **version convertie** d'une autre
   pièce : c'est exactement la catalyse, encodée dans les données.

Le second est indispensable : **certains auteurs n'écrivent jamais « Catalyst »**. Le guide Prêtre
Discipline, par exemple, affiche son torse (`Cosmic Penitent's Eclipsing Robes`) avec pour seule
provenance `Murder Row`, un donjon — sans `original-item`, la pièce passerait pour un drop direct.
Sur l'ensemble du roster, 29 objets sont dans ce cas.

À l'inverse, `original-item` évite les faux positifs qu'un test sur le nom du set produirait : les
jambes `Enveloping Legwraps of the Cosmic Penitent` tombent telles quelles sur Sszorak (boss de
raid) et n'ont pas d'`original-item` — donc pas de badge, à raison.

Une conséquence utile : quand la pièce d'origine est connue, le badge **+ Catalyseur** est un lien
vers elle, avec son tooltip. C'est l'objet à ramasser avant de passer au Catalyseur.

**Ce que le boss laisse tomber n'est pas la pièce de set.** Exemple réel : la tête BiS du Prêtre
Ombre est `Cosmic Penitent's Truesight`, mais ce qui tombe sur Ula'tek est
`Venomkeeper's Horrific Cowl` — on ramasse celle-ci, puis on la transforme.

La vue **Qui roll ? regroupe donc sur l'objet qui tombe**, pas sur celui qui est affiché dans
la liste BiS. Concrètement, sur Ula'tek :

| Ligne | Joueurs |
| --- | --- |
| `Capuche horrifique du gardien de venin` (tête) | **4** — 3 la prennent telle quelle, 1 la catalyse |
| `Regard du guetteur lové` (tête) | **4** — tous la catalysent, chacun vers sa propre pièce de set |

Sans ce regroupement, le même drop apparaissait sur plusieurs lignes sans lien visible, et une
ligne pouvait être intitulée avec la pièce de set d'une classe alors que les autres joueurs
visaient la leur. Les pastilles des joueurs qui catalysent sont en pointillés avec un `⟳`, et leur
infobulle nomme la pièce de set visée.

Seules 9 des 62 pièces d'origine sont présentes ailleurs dans le cache, donc leur nom n'est pas
scrapable : c'est `renameLinks` de l'embed Wowhead qui les nomme, à partir de leur seul
identifiant. C'est pourquoi l'option est active dans les deux langues, et pas seulement en
français. Leur **icône**, elle, reste inconnue : ces lignes portent un point d'interrogation.

> À noter : la catalyse **ne se déduit pas du type de source**. Des pièces à catalyser proviennent
> aussi bien de boss de raid que de donjons — la règle « donjon ⇒ catalyseur » seule donnerait un
> résultat faux.

État vérifié sur le cache actuel, en croisant la classification raid/donjon avec les emplacements
de set (tête, épaules, torse, mains, jambes) :

| Cas | Nombre |
| --- | --- |
| Pièce de set venant d'un **donjon**, badge présent | 96 |
| Pièce de set venant d'un **boss de raid**, sans badge (drop direct) | 24 |
| **Pièce de set venant d'un donjon sans badge (violation)** | **0** |

Enfin, quand la seule provenance donnée par le guide est « Catalyseur » (cas du Paladin Vindicte),
le mot n'est pas répété en gris à côté du badge ambre : seul le badge s'affiche.

## Vérification des bijoux (Bloodmallet)

Les bijoux ne se classent pas pareil selon le nombre de cibles, donc la vue Liste BiS leur
consacre un panneau en trois colonnes — **1 cible, 3 cibles, 5 cibles** — avec les **cinq
meilleurs de chaque catégorie** d'après [Bloodmallet](https://bloodmallet.com). Chaque entrée
donne le rang, l'écart de DPS avec le premier et la source ; un fanion `BiS` marque les bijoux
que le guide Icy Veins retient aussi. Quand la spec n'est pas simulée, les bijoux restent des
cartes classiques dans la grille.

C'est un **point d'intégration prévu par le site** (leur propre script d'import public tape la
même URL), pas du scraping de page :

```
https://bloodmallet.com/chart/get/trinkets/<style>/<classe>/<spec>
```

Les trois styles ont été vérifiés contre l'API : `castingpatchwerk`, `castingpatchwerk3` et
`castingpatchwerk5` répondent ; `castingpatchwerk_3`, `patchwerk`, `hecticaddcleave` et
`beastlord` non.

La réponse fournit `sorted_data_keys` (le classement), `item_ids` — qui permet de joindre
directement avec les données Icy Veins, sans rapprochement de noms — le DPS par niveau d'objet,
les sources, et `translations` d'où viennent les **noms français** de ces bijoux.

Deux pièges vérifiés sur cette API :

- elle répond **HTTP 200 même en erreur**, avec `{"status": "error", …}` : il faut tester le
  champ, pas le code de statut ;
- **toutes les specs ne sont pas simulées.** Sur le roster : 10 sur 18. Aucun soin n'est simulé,
  **toute la classe Moine est absente** (les trois specs, tous les types de données, tous les
  styles de combat — vérifié un par un), et quelques DPS manquent selon les patchs.

### Qui fait foi pour les bijoux

Dans la vue **Qui roll ?**, pour une spec **DPS effectivement simulée**, ce sont les bijoux de
Bloodmallet qui comptent comme BiS, pas ceux du guide : les cinq premiers de chaque catégorie de
cibles (1, 3, 5). Le nombre est réglé par `SIM_TRINKET_COUNT` dans `public/app.js`, partagé entre
le panneau et le calcul des besoins pour qu'ils ne divergent jamais. Les autres cas gardent la liste Icy Veins — **soins et tanks** (Bloodmallet ne
tranche que le DPS) et **DPS non simulés** (le Moine, par exemple).

Une difficulté à connaître : Bloodmallet ne donne qu'une catégorie de provenance (`Raid`,
`Dungeon`, `Profession`), jamais le boss. La provenance précise est donc retrouvée dans les listes
Icy Veins — **22 des 27 bijoux concernés** s'y résolvent. Pour les autres, dans l'ordre :

1. la table `ITEM_SOURCES` (`public/app.js`), à remplir à la main quand on connaît le boss —
   une ligne par identifiant Wowhead ;
2. à défaut, la catégorie Bloodmallet : les bijoux de métier vont dans `Craft`, et les autres
   dans `Raid — boss non précisé` ou `Donjon — non précisé`, ce qui les garde visibles sous le
   bon filtre au lieu de les enterrer dans `Source inconnue`.

L'infobulle d'une pastille distingue les deux origines : *« via Bloodmallet 1c/3c »* contre
*« liste Overall, Raid »*.

### Repli : les recommandations du guide

Quand Bloodmallet ne couvre pas la spec, le panneau affiche à la place la section
« Trinket Recommendations » du guide Icy Veins, avec une bordure ambre et la mention explicite
« Bloodmallet ne simule pas cette spec » — pour qu'on ne confonde pas un avis d'auteur avec un
classement chiffré.

Deux présentations coexistent chez Icy Veins et sont toutes deux gérées :

| Présentation | Exemple | Catégories |
| --- | --- | --- |
| `<fieldset>` intitulé « … Trinkets » | Moine Marche-vent | On-Use / Passive |
| `<details class="trinket-dropdown">` | Guerrier Armes | S / A / B / C Tier |

Un piège à connaître : dans cette section, `data-wowhead` n'est **pas** sur le span extérieur
comme dans les cartes BiS, mais sur le span intérieur du nom. Le parseur teste les deux.

La récupération se fait avec le scrape Icy Veins, sur le même bouton, mais **sans le bloquer** :
une panne de Bloodmallet ou une spec non simulée n'empêche pas la mise à jour du BiS. Le cache
est dans `data/trinkets.json`, servi par `GET /api/trinkets`.

## Langue (FR / EN)

Bascule en haut à droite, mémorisée dans le navigateur. Elle change **les noms d'objets et les
libellés d'emplacements** ; l'interface elle-même reste en français.

Icy Veins n'a pas d'édition française (`fr.icy-veins.com` n'existe pas), donc les noms d'objets
sont localisés par le **mécanisme officiel de l'embed Wowhead** : en français, `renameLinks` est
activé et les liens portent `domain=fr`, Wowhead réécrit alors le texte avec le nom localisé.
Aucun scrape supplémentaire. Le changement recharge la page, car cette configuration est lue au
chargement du script.

Icy Veins pointe ses liens sur `domain=ptr` (le contenu de Midnight n'est pas encore sur le
domaine live) ; en français ce domaine est remplacé. Si un objet n'existait pas côté français,
l'embed ne renommerait rien et le nom anglais scrapé resterait affiché.

**Noms de boss et de donjons : à compléter à la main.** Ce sont des chaînes libres écrites par les
auteurs, sans équivalent français exploitable dans les données. La table `SOURCES_FR` en haut de
[`public/app.js`](public/app.js) contient déjà **toutes les clés** présentes dans le cache, avec
des valeurs vides ; il suffit d'y mettre les noms du client français. Toute entrée laissée vide
retombe sur l'anglais. Les noms d'enchantements restent en anglais (texte scrapé, pas un lien
Wowhead).

## Roster

Le roster de départ est dans [`src/roster.js`](src/roster.js) (numéro, pseudo, classe, spec). Il
est copié dans `data/roster.json` dès la première modification, et c'est ce fichier qui fait foi
ensuite — modifiable à la main ou via la vue Roster.

Les slugs valides par classe sont dans [`src/classes.js`](src/classes.js).

**Ajouter et retirer** des membres se fait dans la vue Roster, **sur l'instance locale
uniquement** : le formulaire du bas demande pseudo, classe et spec (la liste de specs suit la
classe choisie), le `✕` de fin de ligne retire un membre après confirmation. Le serveur revalide
tout — pseudo non vide et inédit, classe connue, spec valide pour cette classe — et attribue un
identifiant unique, y compris pour deux pseudos qui donnent le même slug.

Dans l'export statique, ces deux contrôles **ne sont pas grisés, ils ne sont pas rendus** : ni
colonne d'action, ni formulaire. Composer le roster est une décision d'officier, pas quelque
chose qu'on propose à qui consulte la page. La case **Roster mythique** et le menu de spec, eux,
restent affichés et désactivés comme le reste : leur état est une information utile à lire.

**Changer de classe** reste une opération de fichier : le menu de la vue Roster ne propose que les
specs de la classe du membre, et `PUT /api/roster/:id` refuse une spec qui n'appartient pas à sa
classe. Pour un reroll, éditer `data/roster.json` directement — ou retirer puis rajouter le
membre.

Un membre peut porter `star: true` : il est alors mis en avant partout — pastille dorée avec ★
dans la vue Qui roll ?, ligne surlignée et badge « Mascotte » dans le Roster, et liseré doré
sur sa spec dans le sélecteur du haut. Avec `portrait: 'fichier.png'` (dans `public/img/`), il
gagne en plus un portrait rond dans le Roster et son illustration détourée dans la marge basse
gauche. Rien n'est codé en dur : si l'étoile change de membre, les images suivent.

## API

| Méthode | Route | Description |
| --- | --- | --- |
| `GET` | `/api/specs` | Classes/specs supportées (liste blanche serveur, 39 entrées) |
| `GET` | `/api/roster` | Membres de la guilde + référentiel classes/specs |
| `PUT` | `/api/roster/:id` | Body `{ "spec": "fury" }`, `{ "spec": null }`, `{ "raid": false }` et/ou `{ "trial": true }` |
| `POST` | `/api/roster` | Body `{ "name": "Toto", "class": "mage", "spec": "fire" }` — ajoute un membre |
| `DELETE` | `/api/roster/:id` | Retire un membre |
| `GET` | `/api/bis` | Contenu du cache `data/bis.json` |
| `GET` | `/api/trinkets` | Classements Bloodmallet (`data/trinkets.json`) |
| `GET` | `/api/wowhead` | Tier lists et consommables Wowhead (`data/wowhead.json`) |
| `POST` | `/api/scrape` | Body `{ "class": "warrior", "spec": "arms" }` — scrape et met à jour le cache |

`POST /api/scrape` renvoie `429` avec `retryAfterSeconds` si la spec a déjà été rafraîchie
récemment, `409` si un scrape est déjà en cours, `502` si Icy Veins répond mal ou si la page
n'est plus parsable.

## Liste blanche des pages scrapables

[`src/specs.js`](src/specs.js) dérive la liste de [`src/classes.js`](src/classes.js) : les 13
classes Retail × leurs specs, soit 39 pages. L'URL suit le schéma

```
https://www.icy-veins.com/wow/<spec>-<classe>-pve-<role>-gear-best-in-slot
```

où `role` vaut `dps`, `healing` ou `tank` — d'où le champ `role` sur chaque spec. Les 39 URLs ont
été vérifiées une à une (toutes en 200 ; à noter que c'est `beast-mastery-hunter` et non
`bm-hunter`).

C'est la garde de sécurité du scraper : le serveur ne fetch jamais une URL fournie par le client.
Être dans la liste ne déclenche rien — rien n'est scrapé tant que personne ne clique.

## Comment marche le parseur

Icy Veins rend ses pages côté serveur avec un balisage stable, donc Cheerio suffit — pas de blob
JavaScript à décoder. Un objet ressemble à ça :

```html
<div class="bis_item bis_item--align-right">
  <span class="spell_icon_span" data-wowhead="item=271565&domain=ptr&bonus=13848&original-item=268243">
    <img class="spell_icon" src="//static.icy-veins.com/.../inv_glove_cloth.jpg">
    <span data-wowhead="..." class="q4">Primal Leywarden's Manashapers</span>
  </span>
  <span class="bis_item_slot">Hands</span>
  <div class="bis_item_extras">…gemmes…</div>
  <div class="bis_item_footer">
    <span class="bis_item_drop">Coiled Altar + <a href="…/catalyst-guide">Catalyst</a></span>
    <span class="bis_item_enchant">…</span>
  </div>
</div>
```

Points à connaître pour intervenir dessus :

1. **Les armes sont dans une grille à part**, `bis_items_grid--weapons`, juste après celle de
   l'armure. Le parseur la rattache à la liste courante, sinon les deux armes disparaissent.
2. **Le nom d'une liste ne vient pas du titre qui la précède** mais de l'onglet qui la porte :
   `#bis_0_1` est titré par `#bis_0_1_button` (« Overall », « Mythic+ », « Raid ») et le bloc
   englobant `#area_2` par `#area_2_button` (le talent de héros). Nécessaire : chez le Prêtre
   Discipline, « Overall » apparaît deux fois, une par talent de héros.
3. **`bonus=` est conservé tel quel** dans `data-wowhead`, pour que le tooltip affiche l'ilvl et
   les sockets exacts recommandés par le guide.
4. **`$el.text()` colle les textes des nœuds voisins.** Le parseur joint les enfants avec une
   espace, et rattrape en plus les fautes de frappe du contenu source (`fromAltar of Fangs`,
   vu tel quel sur la page du Prêtre Ombre).

### Si ça casse

| Erreur / symptôme | Cause probable | Où corriger |
| --- | --- | --- |
| `Aucune grille BiS trouvée` | Les classes CSS d'Icy Veins ont changé | `parseGuide()` / sélecteur `.bis_items_grid` |
| Armes manquantes | La grille des armes n'est plus une sœur | test `bis_items_grid--weapons` |
| Listes mal nommées | Le schéma d'onglets `#bis_A_B_button` a changé | `listLabel()` |
| Provenance polluée par du texte de catalyse | Nouvelle tournure d'auteur | `extractSource()` |
| `404` | L'URL a bougé, ou le rôle est faux | `guideUrl()` / `role` dans `classes.js` |

Méthode : télécharger la page à la main et regarder sa vraie structure avant de toucher au code.

```bash
curl -A "GoldSaucer-GuildBiS/0.2" -o guide.html "https://www.icy-veins.com/wow/fire-mage-pve-dps-gear-best-in-slot"
```

## Scraping : cadre

- `robots.txt` d'Icy Veins est en `Allow: /`, et les pages de guide ne sont dans aucun des
  chemins interdits (qui visent `/modules/`, `/util/`, `/sets/`, les forums…).
- Aucun appel automatique ou périodique : scrape **uniquement au clic**, une spec à la fois.
- Rate-limit serveur de 10 min par spec, User-Agent explicite, timeout 20 s, pas de retry.

## Illustrations Footzy

`public/img/footzy.png` et `public/img/footzy1.png` sont détourés depuis `Footzy2.png` et
`footzy1.png` (captures sur fond magenta) par [`tools/chroma-key.js`](tools/chroma-key.js) :

```bash
node tools/chroma-key.js Footzy2.png public/img/footzy.png 280
```

```bash
node tools/chroma-key.js footzy1.png public/img/footzy1.png 320
```

Les deux sont posées **dans les marges, de part et d'autre du conteneur**, calées à 10 px de ses
bords via `calc(50% + 700px + 10px)` — 700 px étant la moitié du `max-width` de la mise en page,
elles restent donc à la même distance quelle que soit la largeur de l'écran.

En dessous de 1780 px les marges deviennent trop étroites : celle de gauche disparaît et celle de
droite se replie dans le coin de la barre du haut. En dessous de 700 px, les deux disparaissent.

Le script calcule un indice de magenta `(rouge + bleu) / 2 - vert`, interpole l'alpha entre deux
seuils pour éviter un contour en escalier, retire la dominante magenta sur les pixels de bord,
recadre sur le sujet et réduit l'image (1370×1148 et 1131 Ko → 280×501 et 125 Ko).

### Détourage sur décor

`public/img/bolderiz.png` et `public/img/ewe.png` viennent de captures **sans fond uni**, donc la
clé chroma ne s'applique pas. [`tools/cutout.js`](tools/cutout.js) procède autrement :

```bash
node tools/cutout.js bol.png public/img/bolderiz.png 360 3
```

```bash
node tools/cutout.js eweeee.png public/img/ewe.png 300 8 1 glow
```

Le fond est atteignable depuis les bords de l'image par petits pas de couleur : on propage donc
depuis le pourtour tant que deux pixels voisins se ressemblent, ce qui suit les dégradés du sol
là où un seuil global échouerait. Restent des îlots de premier plan — le personnage, mais aussi
le décor du fond — et on ne garde que le plus grand.

**La tolérance est le réglage critique** : à 14 le fond déborde sur le sujet et le fragmente
(le plus grand îlot tombe à 71×129) ; à 3 le personnage sort entier (529×526). Un anti-frange
ciblé sur le contour retire ensuite la dominante lavande du décor, sans toucher aux teintes
mauves de l'armure : 0 pixel de frange après correction, contre 595 avant.

Deux options servent sur les décors difficiles :

- **le nettoyage** (5ᵉ argument) : une ouverture morphologique — érosion puis dilatation bornée au
  masque d'origine — qui sectionne les fins ponts de pixels par lesquels du décor reste accroché
  au sujet. Sur `eweeee.png`, fait tomber le nombre d'îlots de 449 à 43 ;
- **le mode halo** (6ᵉ argument, `glow`) : sur une capture où la cible est sélectionnée, le liseré
  jaune du jeu forme un contour fermé qui sert de barrière à la propagation.

Limite honnête : ce qui **occulte** le sujet sur la capture d'origine ne peut pas en être séparé.
Sur `ewe.png`, une feuille passe devant son genou, à l'intérieur même du liseré de sélection —
aucun réglage ne l'enlève, il faudrait un masque à la main ou une autre capture.

C'est un outil ponctuel : le PNG détouré est le livrable, le script n'est jamais appelé au
runtime. Sa seule dépendance, `pngjs`, est en `devDependencies`.

## Tooltips et icônes

Les tooltips d'objets utilisent l'embed officiel Wowhead
(`https://wow.zamimg.com/widgets/power.js` + attributs `data-wowhead`), prévu pour cet usage.
Les icônes viennent du CDN Wowhead (`wow.zamimg.com/images/wow/icons/medium/<slug>.jpg`).

Les slugs d'icônes de classes et de specs sont en dur dans [`src/classes.js`](src/classes.js),
les 52 vérifiés contre le CDN. Attention : les slugs de spec ne sont pas uniques entre classes
(`frost`, `holy`, `protection`, `restoration`), donc un chercher/remplacer global attribue
facilement l'icône d'une classe à une autre.

## Limites connues

- **Regroupement des sources.** Les auteurs écrivent le même boss de plusieurs façons
  (`Vashnik` / `Vashnik the Malignant`, `The Coiled Altar` / `Coiled Altar`). `buildSourceIndex()`
  dans `public/app.js` normalise la ponctuation, fusionne à une faute de frappe près
  (distance ≤ 1) et reconnaît un nom complet contenu dans un autre. Il ne fusionne **pas** deux
  noms réellement différents : `Nymrissa Wavecaller` et `Nymrissa Wavebinder` restent séparés,
  faute de pouvoir le prouver depuis les données. Les rapprochements de ce type se déclarent à la
  main dans `SOURCE_MERGES` (`public/app.js`) — c'est là qu'est fusionné
  `Tidebound Grotto` → `Nymrissa Wavecaller`.
- **Classification raid / donjon** déduite des listes « Raid » et « Mythic+ » de chaque guide,
  pas d'une liste codée en dur. Deux limites connues de cette déduction :
  les **métiers** cités dans une liste Mythique+ passeraient pour des donjons — ils sont donc
  filtrés explicitement (`PROFESSION` dans `public/app.js`) ; et un **boss de raid d'une
  extension précédente** cité uniquement dans une liste Mythique+ reste classé en donjon, faute
  d'apparaître dans une liste Raid (`Nexus King Salhadaar` chez le Moine Marche-vent). À traiter
  au cas par cas si ça devient gênant.
- La vue **Qui roll ?** balaie **toutes** les listes d'une spec (Overall, Mythic+, Raid, et
  chaque talent de héros), pas seulement la principale : un objet BiS uniquement dans la liste
  Raid concerne quand même le joueur devant le boss. L'infobulle d'une pastille indique la ou les
  listes concernées, pour distinguer un BiS général d'un BiS propre au Mythique+.
  Le sélecteur de talent de héros, lui, n'agit que sur la vue Liste BiS.
  Les lignes y sont triées par emplacement, dans l'ordre d'une feuille de personnage
  (`SLOT_ORDER` dans `public/app.js`), puis par nombre de joueurs concernés.
- **Emplacement par consensus.** Les auteurs se trompent : la page DK Sang classe
  `Amulet of the Twin Fangs` en `Ring` alors que trois autres guides la donnent en `Neck` — et son
  icône est bien un collier. `refreshSlotConsensus()` retient l'emplacement majoritaire parmi tous
  les guides ; sans cet arbitrage, le collier était rangé en anneau et paraissait manquant.
- **Pas d'item level** : Icy Veins ne le publie pas en clair dans le balisage.
- **Type d'armure = heuristique** déduite du slug d'icône, sur les 8 emplacements d'armure
  seulement (les capes portent souvent `leather` dans leur icône sans avoir de type d'armure).
- Les noms d'objets sont en anglais ; seuls les libellés d'emplacements sont traduits.
- Pas d'authentification : à ne pas exposer publiquement tel quel.
