# Projet Vart (ex-Kast)

Assistant vocal d'apprentissage, HTML/CSS/JS vanilla, aucun framework, aucun
backend. **`vart.html` est un ARTEFACT GÉNÉRÉ** : la source de vérité est le
dossier `src/` (80 modules), assemblée par `node scripts/build.js`.

    npm run build    # src/ → vart.html      concaténation pure, ~50 ms
    npm run check    # dérive, syntaxe, garde-fous file://, conventions
    npm run shots    # 7 captures Playwright de non-régression visuelle

⚠️ **Ne lancez jamais deux de ces scripts en parallèle** : `build`, `check` et
`resplit` lisent puis réécrivent `src/manifest.json` et `vart.html`. Deux
exécutions simultanées se marchent dessus (course sur le manifeste → état
incohérent). Toujours séquentiellement.

@PLAN-VART.md — lire AVANT toute modification. C'est le plan directeur.

## ⚠️ Ne JAMAIS éditer vart.html à la main
Le fichier est écrasé au prochain build. Éditez le module concerné dans `src/`,
puis lancez `npm run build`. `npm run check` **échoue** si le fichier généré a
été modifié directement : c'est le garde-fou contre la perte de travail.

## Architecture modulaire (mise en place le 24/09/2026)
- `src/manifest.json` — ordre d'assemblage, et un champ `role` qui décrit chaque
  module. **C'est l'index à consulter en premier** pour trouver où éditer.
- `src/index.template.html` — coquille HTML avec les marqueurs `@@STYLES@@` et
  `@@SCRIPTS@@`. Contient tout le `<head>`, le `<body>` statique, la balise
  `<script>` unique et la balise pdf.js du CDN.
- `src/styles/` — 25 feuilles CSS. `90-surcharge-apple.css` **doit rester la
  dernière** (calque de surcharge, il gagne à spécificité égale).
- `src/js/` — 55 modules numérotés `00-` à `50-`, dans l'ordre d'exécution.
- **Sous-numérotation `44a`, `44b`, `44c`…** : un module découpé en 2e niveau
  garde son numéro et reçoit un suffixe alphabétique, pour ne pas avoir à
  renuméroter tous les modules suivants.
- `scripts/resplit.js` — découpage de 2e niveau d'un module : découpe, met à
  jour le manifeste, puis **exige** que `vart.html` reste identique à la
  référence ; sinon il annule tout (rollback automatique).
- `_baseline/vart-avant-modules.html` — original d'avant découpage (rollback).
- `kast v2.1.html` — ancêtre Kast, inchangé, **hors dépôt git** (ancien branding).

### Pourquoi des scripts concaténés et pas des ES modules
Vérifié au banc d'essai (Playwright, `file://`) :
`<script type="module" src="…">` est **bloqué par CORS** (« origin 'null' ») et
ne se charge jamais, alors qu'un `<script src>` classique charge sans erreur et
partage le scope global de premier niveau avec les scripts suivants. Vart doit
rester ouvrable par double-clic : les modules sont donc des tranches
**contiguës** du même script, concaténées dans l'ordre du manifeste.
`scripts/check.js` refuse tout `import`/`export` ou `type="module"`.

### Garantie « zéro régression »
La découpe a été prouvée **sans perte** : le `vart.html` régénéré est identique
**octet pour octet** à l'original (même SHA-256, `759962cc1e515abc…`). Toute
modification ultérieure se prouve de la même façon : `npm run check`.

## Principes non négociables
- 100 % local : clés API et données en localStorage/IndexedDB, jamais de serveur.
- Français dans toute l'UI, les commentaires et la documentation.
- Aucune régression sur les fonctionnalités Kast existantes.
- Chaque nouvel appel API intègre le suivi de coûts (budget) existant.
- Le fichier livré reste autonome : une seule dépendance externe, pdf.js (CDN).

## Conventions du code existant
- Commentaires français expliquant le « pourquoi », pas le « quoi ».
- Getters/setters localStorage typés `getX()/setX()` (ex. `getApiKey()`).
- Sécurité : `esc()` pour tout HTML injecté, `safeImgSrc()` pour les images,
  `fetchWithTimeout()` pour tout appel réseau.
- Dialogues : `customAlert()` / `customConfirm()` (jamais `alert()` natif).
- Thèmes : variables CSS `--*` dans `:root` et `[data-theme="light"]` —
  toute nouvelle couleur passe par une variable des DEUX thèmes.

## Pièges connus
- Un module = un domaine : ouvrez directement le fichier de `src/` concerné
  (cf. `role` dans `src/manifest.json`) au lieu de chercher dans 17 600 lignes.
- Ordre d'assemblage : `src/manifest.json`. Ne renommez ni ne déplacez un
  module sans mettre à jour le manifeste.
- `localStorage` en cours de migration vers IndexedDB (`vart-db`) — ne pas
  ajouter de nouvelles données volumineuses dans localStorage.
- Clés `kast_*` : en cours de renommage `vart_*` avec rétrocompatibilité.
- Raccourcis clavier : lire `e.key` (lettre), pas `e.code` (claviers AZERTY).

## Session en cours
Phases 0 ✅, 1 ✅, 2 ✅, 3 ✅ et 4 ✅ terminées (24/09/2026) dans `vart.html` (~17 100 lignes).
Phase 0 : renommage, migration `kast_*`→`vart_*`, IndexedDB `vart-db`,
conversations migrées (cache synchrone + `convWriteQueue` + repli).
Phase 1 : postures + règles par blocs (`buildPersonaPrompt`), mémoire auto
(`updatePersonaMemory`), budget par persona, confirmations payantes.
Phase 2 : sources RAG (`indexPersonaSource`, chunking 1800 chars, embeddings
OpenAI/Gemini, repli BM25), outils `search_sources` / `search_history` /
`save_note` / `calculate` / `fetch_url` via l'exécuteur unique
`executeVartTool` (3 dispatchs, 4 moteurs), pdf.js CDN (defer), stats
`kind:'embedding'` + `isConvStat`, purge sources/mémoire à la suppression.
Phase 3 : outils pédagogiques `create_quiz` / `make_flashcard` / `plan_session`
/ `update_progress` (store IndexedDB `study_items`, purge incluse), progression
dans Stats → Personas, export CSV Anki + dossier d'étude MD, **connecteur
Obsidian** bidirectionnel (vault = source ; écriture sessions/fiches Spaced
Repetition/mémoire/plan ; handle persisté store `handles` ; repli export
fichier si pas de File System Access), **export persona v3** (sources
embarquées sans vecteurs) + import v3 (re-embeddings avec confirmation coût).
Phase 4 : **répétition espacée** (fiches `nextReviewAt`/`intervalDays`,
Leitner 1→3→7→16→35 j, outils `review_flashcards` + `mark_flashcard_reviewed`,
pastille 🔁 accueil, injection dues dans le prompt via `dueCountsCache` +
`personaDuePromptSection`, notification optionnelle 1×/jour, toggle Config →
Affichage `vart_reviewNotif`) ; export dédoublé léger / « avec sources »
(`-complet`) ; PWA = étude §11 PLAN (D7 : métas minimales, SW impossible en
`file://`). Pas de `showToast` dans ce code : dialogues `customAlert`/`customConfirm`.
Conservés : URLs `/c/kast`, base vision `'kast'`. Original : `kast v2.1.html`.
Toutes les phases du plan sont livrées — prochaine étape : tests navigateur
utilisateur (révision orale, pastilles, notifications, exports léger/complet).
Passe design « Apple » (24/09/2026, skill `apple-design` dans `.agents/skills/`) :
courbe `--spring: cubic-bezier(0.32,0.72,0,1)` (ressort amorti critique, sans
rebond) sur boutons/cartes/dialogues ; feedback `:active` à 100 ms au presser
(scale 0.97/0.98) ; scrim `--scrim` (2 thèmes) + `backdrop-filter: blur(20px)
saturate(180%)` sur modales (blur 12px dialogues) ; entrée modales
`modalMaterialize` (opacité+échelle+élévation) ; tracking négatif `-0.01em` sur
titres ≥ 1.2rem ; blocs `prefers-reduced-motion` (fondu, pas de transform) et
`prefers-reduced-transparency` (surfaces opaques). Playwright en devDependency
pour la validation visuelle (node_modules, pas de build).
REFONTE VISUELLE TOTALE « Apple moderne » (24/09/2026, demande utilisateur —
la 1re passe était jugée trop subtile) : nouvelle palette iOS dans `:root` +
`[data-theme="light"]` (sombre = noir pur #000 / gris système #1c1c1e/#2c2c2e,
clair = #f5f5f7 / blanc, accent #0a84ff / #007aff, danger/success iOS) et
nouveaux tokens (`--font-stack`, `--radius-s→xl`, `--shadow-card/-hover/-pop`,
`--accent-glow`, `--brand-gradient` bleu→indigo, `--glass-bg/-border`). Un
calque de surcharge complet a été ajouté EN FIN du `<style>` (aucune règle
d'origine supprimée, aucun HTML/JS touché — à spécificité égale il l'emporte) :
typographie SF, sidebar en verre dépoli (blur 30px saturate 180%), halo radial
accent sur #main, hero 2.5rem/800 à dégradé, cartes d'accueil 22px + ombres
douces + survol -4px, carte « Nouveau persona » teintée accent (icône + en
dégradé), pilules dégradées (connexion, Enregistrer, dialogues), champs iOS
remplis sans bord + anneau focus, bulles de transcription façon iMessage
(user = --accent plein texte blanc, ai = teinte neutre — spécificité ID
requise pour `layout-bubbles`), nav Config en pastilles, segmented control iOS,
menus/toasts en verre, toggles vert système. Validée : accolades CSS 942/942,
jsc checkSyntax OK, 6 captures Playwright (`scripts/vart_shots.js`, attente
splash portée à 4200 ms) sombre/clair/modales/dialogue/reduced-motion.
REBRANDING VYT + ACCENT VERT OLIVE (24/09/2026, demande utilisateur) : tous les
crédits « Renaud Dékode » remplacés par « VYT Digital Solutions » (splash,
logo sidebar, footer .app-footer réduit à « Créé par VYT Digital Solutions. »,
modale Partager ; l'exemple « Je m'appelle Renaud » du placeholder Mes infos
est devenu « Alex »). L'accent par défaut est désormais le vert olive :
sombre #a3b565 (dégradé → #6e8c2a), clair #6b8e23 (dégradé #7a9a2e → #556b1a)
— tokens --accent/--bg-active/--transcript-user/--accent-glow/--brand-gradient
dans :root + [data-theme="light"]. Bleus en dur purgés : favicon + theme-color
(#4fc3f7 → #6b8e23), dégradé .btn-save (#29b6f6 → #556b1a), logo SVG
(#112D4D→#3D4A1F, #2283D5→#6B8E23, #2066B4→#556B1A, #55AEF7→#A3B565).
Restent volontairement : le dégradé cyan→violet du mode Traducteur (identité
propre de la feature), --accent2 orange (couleur secondaire/alerte) et la
palette multicolore BAR_COLORS des stats. Revalidé : accolades 942/942, jsc
OK, 6 captures Playwright.
SUPPRESSION BIBLIOTHÈQUE COMMUNAUTAIRE (24/09/2026, demande utilisateur) : tous
les liens vers renaud-dekode.fr/c/kast retirés — bouton « Bibliothèque de
personas » + « Copier le lien » du panneau Partager (avec son listener JS),
carte « Personas partagés » de la modale Nouveau persona (2 cartes restantes :
Créer / Importer) + branche 'community' du handler. Les mentions « kast »
restantes sont volontaires et purement techniques : migration localStorage
kast_* → vart_*, VISION_DB_NAME = 'kast' (IndexedDB), compat import
« kast-persona ». Revalidé : accolades 4013/4013, jsc OK (pas de SyntaxError),
7 captures Playwright (ajout 02b-panel-partager dans scripts/vart_shots.js).
DÉCOUPAGE EN MODULES (24/09/2026, demande utilisateur — le monolithe de 17 619
lignes devenait ingérable) : `vart.html` est désormais un ARTEFACT GÉNÉRÉ, la
source de vérité est `src/` (8 CSS + 51 JS + `index.template.html`), assemblée
par `scripts/build.js` (concaténation pure, aucun bundler). ES modules ÉCARTÉS
par la preuve : `type="module"` est bloqué par CORS en `file://` (« origin
'null' »), alors qu'un `<script src>` classique charge et partage le scope
global — vérifié au banc d'essai Playwright. La découpe est prouvée sans perte :
`vart.html` régénéré identique octet pour octet à l'original (SHA-256
759962cc…). Outillage : `scripts/split.js` (one-shot, contiguïté vérifiée),
`build.js` (`--check`), `check.js` (dérive, syntaxe via vm.Script, garde-fous
file://, conventions, ordre du calque Apple). Rollback : `_baseline/`.
Les 3 plus gros modules restants : 60-editeurs-config.css (2192 l.),
40-orb-transcript.css (982 l.), 50-modes-lecture.css (706 l.).
DÉCOUPAGE DE 2e NIVEAU (24/09/2026, même demande) : les 5 plus gros modules
scindés via le nouvel outil `scripts/resplit.js`. 60-editeurs-config.css
(2192 l.) → 11 fichiers `60a`-`60k` (le plus gros tombe à 424 l.) ;
40-orb-transcript.css (982 l.) → 5 (`40a`-`40e`) ; 50-modes-lecture.css
(706 l.) → 4 (`50a`-`50d`) ; 44-vision.js (687 l.) → 3 (`44a` capture, `44b`
stockage IndexedDB, `44c` UI) ; 38-sessions-openai.js (646 l.) → 3 (`38a`
Realtime, `38b` GPT Live, `38c` xAI). Bilan : 59 → **80 modules**, plus gros
module **2192 → 623 l.** ; les plages du manifeste couvrent toujours
exactement 5569 l. (CSS) et 11168 l. (JS). Chaque étape reprouvée : vart.html
identique à la baseline (911 583 octets, SHA 759962cc…). Deux incidents réels
traités au passage : (1) `resplit.js` crashait sur la borne de fin exclusive
(`lines[total]` undefined, corrigé) — c'est le **test d'échec volontaire** qui
l'a révélé, pas le chemin nominal ; (2) lancer deux `resplit` **en parallèle**
provoque une course sur `src/manifest.json` (entrées écrasées, état incohérent
avec le disque) → verrou `.resplit.lock` ajouté, rollback prouvé sur échec
forcé. **Ne jamais paralléliser `build`/`check`/`resplit`.**
