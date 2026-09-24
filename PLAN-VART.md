# 🗺️ PLAN D'IMPLÉMENTATION — VART v1.0

> Transformation de **Kast v2.1** en **Vart** : plateforme vocale d'apprentissage
> personnalisé, 100 % locale. *« Crée ton professeur, donne-lui tes cours,
> et apprends en lui parlant. »*
>
> Fichier source : `kast v2.1.html` (15 143 lignes, monolithe HTML/CSS/JS)
> Document de référence — ne pas coder sans suivre ce plan.

---

## 1. Vision & principes fondateurs

- **100 % local** : vos clés API, vos données, aucun serveur, aucun compte.
- **Évolution, pas réécriture** : 100 % des fonctionnalités Kast sont conservées.
- **Migration transparente** : un utilisateur Kast retrouve tout (personas, clés, historique).
- **Budget maîtrisé** : chaque nouvel appel API intègre le suivi de coûts existant.
- **Persona augmenté** : chaque persona a une **mémoire**, des **règles**, des **outils** (inspiré de l'architecture Claude Code).

---

## 2. Décisions actées (validées)

| # | Décision | Choix |
|---|---|---|
| D1 | Mémoire persona | **Automatique** — écrite après chaque session, sans validation utilisateur ; éditable a posteriori (onglet Mémoire) |
| D2 | Outils du persona | **Tous activés par défaut** sur les nouveaux personas, désactivables individuellement |
| D3 | Budget | **Hybride 3 niveaux** (cf. §7) |
| D4 | Base de données | **IndexedDB** (native navigateur, pattern déjà utilisé pour la vision) |
| D5 | Mémoire des conversations passées | Réinjection mémoire compressée + outil `search_history` |
| D6 | Obsidian | Connecteur F10 (Phase 3) via File System Access API |

---

## 3. Ce qui est conservé à l'identique (inventaire Kast)

- Conversations vocales temps réel : **OpenAI GPT Live** (WebRTC, délégation backend), **Gemini Live** (WebSocket), **Grok Voice** (xAI realtime)
- Personas : création/édition/duplication/export-import JSON, avatars IA, bibliothèque communautaire
- Modes **Transcripteur** 🎙️ et **Traducteur** 🌍
- Vision (caméra/écran, captures, IndexedDB, lightbox)
- Suivi des coûts : grilles tarifaires, budget mensuel, stats, infobulles
- Historique + titres auto + recherche ; insights globaux « Mes infos »
- Thèmes sombre/clair, raccourcis clavier, splash screen, dialogues custom

---

## 4. Architecture technique cible

### 4.1 Base de données IndexedDB `vart-db`

```
IndexedDB "vart-db" (version 1)
├── conversations     → historique complet { id, personaId, date, messages[], title, cost }
│                        index : by_persona, by_date
├── persona_memories  → { personaId, notes[], consolidated, updatedAt }
├── sources           → { id, personaId, type(pdf|text|url|obsidian), name,
│                         chunks[], embeddings[], hash, addedAt }
│                        index : by_persona
└── vision_images     → (existe déjà, inchangé)
```

- `localStorage` conservé UNIQUEMENT pour : clés API, réglages, thème, préférences légères.
- Migration automatique au 1er lancement (pattern `migrateLegacyData()` existant).

### 4.2 Pipeline mémoire persona (automatique — D1)

```
Fin de conversation
  └─> Modèle d'analyse (kast_analysisModel) produit DEUX sorties :
       1. Insights globaux → « Mes infos » (comportement actuel, inchangé)
       2. Mémoire persona → notes { sujets, difficultés, progression, objectifs }
  └─> Consolidation si > ~2000 tokens (fusion/dédup par le modèle d'analyse)
  └─> Sauvegarde dans persona_memories (IndexedDB)

Début de session
  └─> Prompt = identité + règles + mémoire persona + Mes infos + extraits sources
```

- Onglet **« Mémoire »** dans la modale d'édition du persona : lecture/édition/suppression.

### 4.3 Règles structurées du persona

Blocs typés dans l'éditeur (ajout/suppression/réordonnancement) :

| Type | Exemple |
|---|---|
| Identité / posture | « Tu es un mentor socratique en physique » |
| Comportement | « Pose 2 questions avant de donner une réponse » |
| Format | « Termine par un résumé en 3 points » |
| Conditionnel | « Si 2 échecs → propose un exemple concret » |
| Interdits | « Jamais de jargon sans définition » |

- **Presets de postures** : 🎓 Expert / 🧭 Mentor / 🏋️ Coach = templates pré-remplis.
- Mode « prompt libre » conservé pour utilisateurs avancés.
- Le prompt final est **généré** par assemblage des blocs (ordre fixe documenté).

### 4.4 Outils du persona (activés par défaut — D2)

Globaux existants → configurables par persona : 🌐 web · 🌦️ météo · 📷 vision · 📅 date.

Nouveaux outils :

| Outil | Fonction | Réutilise |
|---|---|---|
| 📚 `search_sources` | RAG dans les sources du persona | IndexedDB + embeddings |
| 🔍 `search_history` | Recherche dans les conversations passées du persona | IndexedDB conversations |
| 💾 `save_note` | Écrit dans la mémoire persona (« retiens ça ») | persona_memories |
| 📝 `create_quiz` | Quiz vocal généré depuis les sources | chatCompletion() |
| 🗂️ `make_flashcard` | Fiche de révision (+ export Anki/CSV/Obsidian) | stockage local |
| 📊 `update_progress` | Note la maîtrise d'un sujet | panneau Stats |
| 📅 `plan_session` | Plan d'apprentissage + rappels | planning local |
| 🧮 `calculate` | Calculs fiables en JS | zéro coût API |
| 🔗 `fetch_url` | Lit une page web à la demande | fetch + extraction |

Chaque outil affiche son **impact coût** (infobulles existantes) ; les actions coûteuses demandent confirmation (cf. §7).

---

## 5. Sources par persona (RAG) — F1

- **Types** : PDF (pdf.js via CDN), TXT/MD, URL (fetch + extraction), notes manuelles, dossier Obsidian (Phase 3).
- **Indexation** : découpage en chunks (~500 tokens, recouvrement 10 %) + embeddings via API OpenAI (`text-embedding`) ou Gemini ; **fallback BM25** (mots-clés, local, gratuit) si aucune clé compatible.
- **Stockage** : store `sources` (IndexedDB) ; hash pour détecter les doublons/modifications.
- **Runtime** : à chaque question utilisateur → recherche top-k (k=5) → injection des extraits dans le contexte + **citation** de la source dans la réponse.
- **UI** : onglet « Sources » dans l'éditeur de persona (liste, poids, état d'indexation, suppression avec purge).
- **Garde-fous** : taille max par persona (ex. 20 Mo texte), estimation de coût d'indexation AVANT lancement (dialogue de confirmation).

---

## 6. Connecteur Obsidian — F10 (Phase 3)

- **Accès** : File System Access API (`showDirectoryPicker`), handle persisté dans IndexedDB, permission re-demandée si expirée.
- **Navigateurs** : Chrome/Edge complet ; Firefox/Safari → fallback export `.md` téléchargé.
- **Sens 1 (Obsidian → Vart)** : source « Dossier Obsidian » — indexation des notes `.md`, resynchronisation incrémentale (hash).
- **Sens 2 (Vart → Obsidian)** : écriture automatique dans le vault :
  - `Vart/Sessions/` → comptes-rendus de session (frontmatter YAML + wikilinks)
  - `Vart/Flashcards/` → format compatible plugin « Spaced Repetition »
  - `Vart/Personas/<nom> - Mémoire.md` → mémoire persona lisible/éditable
  - Plan d'apprentissage en checklist `- [ ]` relue par le persona à la session suivante

---

## 7. Budget hybride 3 niveaux — D3

1. **Plafond global mensuel** : inchangé (alerte 90 %, blocage 100 %).
2. **Plafond par persona** *(nouveau, optionnel, vide = illimité)* : à 100 %, proposition de **basculer sur un modèle moins cher** plutôt que blocage sec.
3. **Confirmation préventive** : avant indexation de sources, génération d'avatar, import massif → dialogue *« ≈ 0,04 $. Continuer ? »* avec case « ne plus demander ».
- **Stats** : colonne « coût mensuel » par persona dans l'onglet Personas du panneau Stats.

---

## 8. Phasage détaillé

### 🔵 Phase 0 — Renommage & fondations ✅ *(terminée le 23/09/2026)*
**Objectif : Vart démarre, toutes les données Kast migrées, aucune régression.**

- [x] 0.1 Renommage : titre, logo SVG, splash (K-A-S-T → V-A-R-T), textes UI, version (→ v1.0)
- [x] 0.2 Clés localStorage `kast_*` → `vart_*` avec migration (`migrateStoragePrefix()`, copie non destructive, idempotente — testée : 9/9 ✅)
- [x] 0.3 Format export `vart-persona` (v2) + import rétrocompatible `kast-persona`
- [x] 0.4 Création couche IndexedDB `vart-db` + wrapper `vartDb()`/`vartDbRun()` (pattern `visionDb()`), stores : conversations, persona_memories, sources
- [x] 0.5 Migration conversations localStorage → IndexedDB (cache synchrone + file d'écriture sérialisée + repli localStorage si IndexedDB indisponible)
- [x] 0.6 Crédits : Renaud Dékode conservé. URLs `/c/kast` **conservées volontairement** (site externe, pas de page /c/vart connue — à faire évoluer avec Renaud). Base vision IndexedDB `'kast'` conservée pour ne pas orpheliner les images existantes.
- **Critères d'acceptation** ✅ : syntaxe JS validée (jsc), identifiants renommés cohérents (49 classes vart-select, data-vart-custom ↔ dataset.vartCustom, 3 gradients vartlogo × 2), tests unitaires du stockage 9/9.
- **Note Phase 1** : le fallback « quota localStorage » d'`addConversation()` est désormais du code mort (IndexedDB ne jette plus d'erreur synchrone) — à nettoyer lors de la Phase 1.

### 🟢 Phase 1 — Persona augmenté (quick wins) ✅ *(terminée le 23/09/2026)*
- [x] 1.1 Postures Expert / Mentor / Coach (presets de règles) à la création — cartes cliquables dans l'éditeur, templates `POSTURES`, assemblés par `buildPersonaPrompt()`
- [x] 1.2 Éditeur de règles par blocs (4 types : comportement/format/conditionnel/interdit, ajout/suppression) + mode prompt libre conservé — testé 9/9 ✅
- [x] 1.3 Mémoire persona : `updatePersonaMemory()` après chaque session (synthèse réécrite = consolidation native, silencieuse, sans validation → D1), injection dans `buildFullInstructions()` ET `buildLiveInstructions()` (tous moteurs), cache synchrone alimenté par `loadPersonaMemory()` à la sélection + au démarrage
- [x] 1.4 Onglet « Mémoire » : textarea éditable + bouton « Effacer » (confirmé, immédiat), chargement async sans faux « modifié » (signature recalculée)
- [x] 1.5 Résumés enrichis : la mémoire suit le format Sujets abordés / Acquis / Points fragiles / Objectifs / Progression (« appris / fragile »)
- [x] 1.6 Budget : niveau 2 = plafond par persona (champ dans la fiche, alerte 90 %, repli modèle par défaut à 100 %) ; niveau 3 = confirmations avant actions payantes (case dans Configuration → Budget, branchée sur la génération d'avatars) ; Stats → Personas : colonne « Ce mois »
- [x] Nettoyage : fallback quota mort d'`addConversation()` retiré (note Phase 0)
- **Validations** : syntaxe jsc OK (9 891 lignes), tests buildPersonaPrompt 9/9, tests stockage Phase 0 toujours verts, 7/7 IDs HTML présents

### 🟡 Phase 2 — Sources & RAG (chantier structurant) ✅ *(terminée le 23/09/2026)*
- [x] 2.1 Ingestion : PDF (pdf.js 3.11.174 en CDN, chargé en `defer`), TXT/MD/CSV/JSON, URL (fetch + DOMParser + nettoyage), notes collées
- [x] 2.2 Chunking (~1800 chars, recouvrement 10 %, coupe sur paragraphes/phrases) + embeddings OpenAI (`text-embedding-3-small`, lots de 20) / Gemini (`text-embedding-004`, `batchEmbedContents`) + **repli BM25 local** (gratuit, sans clé)
- [x] 2.3 Outil `search_sources` : cosinus top-5 par modèle d'embedding (repli BM25 si score < 0.15 ou pas de clé), consigne de **citation** de la source dans le retour d'outil
- [x] 2.4 Outil `search_history` : recherche mots-clés dans les conversations passées DU persona, top 3 passages datés
- [x] 2.5 UI **section « Sources »** dans la fiche persona (liste : type, nom, nb d'extraits, mode sémantique/mots-clés, suppression confirmée) + **estimation de coût** avant indexation (confirmation niveau 3)
- [x] 2.6 Outils `save_note` (note datée `[note]` en mémoire, conservation imposée au modèle de consolidation), `calculate` (parseur shunting-yard sans eval — 22 tests), `fetch_url` (texte de la page, 3000 chars)
- [x] Intégration : exécuteur unique `executeVartTool` branché sur les **3 dispatchs** et déclaré dans les **4 moteurs** (Live délégué, Realtime, Grok, Gemini) ; instructions de prompts mises à jour
- [x] Comptabilité : coûts d'embedding en stats `kind: 'embedding'` (visibles budget global / budget persona / Stats, exclus des compteurs « Conv. » via `isConvStat`)
- [x] Purge à la suppression d'un persona (sources + mémoire) ; déviation assumée : « section Sources » au lieu d'un onglet (la modale persona n'a pas de système d'onglets)
- **Validations** : syntaxe jsc OK (10 471 lignes), structure HTML équilibrée, 26 tests (chunk/BM25/cosinus/calcul) + suites Phases 0-1 toujours vertes

### 🟠 Phase 3 — Pédagogie active & Obsidian ✅ LIVRÉE
- [x] 3.1 Outils `create_quiz` (questions générées via modèle d'analyse, stockées en IndexedDB) + `make_flashcard` + **export CSV Anki** (bouton dans la fiche persona, recto;verso guillemets doublés)
- [x] 3.2 Outil `plan_session` : plan d'apprentissage en étapes (checklist), affiché dans la fiche + export
- [x] 3.3 Outil `update_progress` (sujet + niveau %) + **section Progression dans Stats → Personas** (barres par sujet)
- [x] 3.4 **Connecteur Obsidian complet** : sens 1 = dossier vault comme source (récursion `.md`, exclusion dotfolders, indexation RAG standard) ; sens 2 = écriture auto (sessions, fiches au format plugin « Spaced Repetition », mémoire persona, plan en checklist) ; panneau Configuration → Obsidian (connecter/déconnecter, 3 options, handle persisté en IndexedDB store `handles`, re-permission via geste utilisateur) ; **repli** navigateurs sans File System Access = export `.md`/`.csv` téléchargé ; dossier d'étude global exportable (mémoire + plan + fiches + progression + quiz)
- [x] 3.5 **Export persona v3** : sources embarquées (chunks, **vecteurs exclus** pour la taille) + tous champs Phase 1 ; **import v3** : restauration des sources avec re-calcul des embeddings (confirmation de coût niveau 3) ou repli mots-clés ; rétrocompatibilité v1/v2/kast-persona conservée

### 🔴 Phase 4 — Rétention & communauté ✅ *(terminée le 24/09/2026)*
- [x] 4.1 **Rappels de révision espacée** : fiches horodatées `nextReviewAt`/`reviewCount`/`intervalDays` (migration douce : anciennes fiches = dues) ; Leitner simplifié 1→3→7→16→35 j (échec = retour 1 j) ; 2 nouveaux outils vocaux `review_flashcards` (interroge à l'oral, 1 question à la fois, max 10) + `mark_flashcard_reviewed` (reprogramme) ; pastille « 🔁 N » sur les cartes d'accueil + injection du nombre de fiches dues dans le prompt (le persona propose la révision) ; notification navigateur optionnelle (toggle Configuration → Affichage, permission demandée au clic, 1×/jour max)
- [x] 4.2 **Partage bibliothèque** : menu ⋯ dédoublé — « Exporter » (v3 léger, `sources: []`) / « Exporter avec sources » (v3 « professeur complet », suffixe `-complet`) ; note explicative dans Configuration → Partager (mémoire explicitement privée, jamais exportée)
- [x] 4.3 **PWA — étude préalable** (§11, décision D7) : SW impossible en `file://` + valeur métier en ligne par nature → métas « app-like » minimales livrées (theme-color, mobile-web-app-capable, titres Apple), variante hébergée documentée comme chemin d'upgrade, wrapper natif écarté

---

## 9. Risques & parades

| Risque | Parade |
|---|---|
| Fichier monolithe 15k lignes ingérable | Sections délimitées par phase ; si trop lourd → découpage modules (décision en Phase 2) |
| Quota IndexedDB dépassé | Housekeeping (pattern vision existant) + alerte + export backup |
| Perte de données (reset navigateur) | Export/import JSON complet + rappel périodique |
| Coûts embeddings incontrôlés | Estimation préventive + plafond par persona |
| Régression thème/UX au renommage | Tests visuels manuels sombre+clair à chaque phase |
| File System Access indisponible | Fallback export .md (Firefox/Safari) |

## 11. Étude PWA (Phase 4.3) — faisabilité & décision

**Question** : rendre Vart installable (icône écran d'accueil, fenêtre dédiée) et utilisable hors-ligne, tout en restant un fichier HTML unique ouvert en `file://`.

### Contraintes techniques

| Exigence PWA | Réalité |
|---|---|
| Manifest | Inlinable en `data:application/manifest+json` (Chrome/Edge ; Safari l'ignore) |
| Service worker | **Impossible en `file://`** — exige une origine HTTP(S) ET un fichier `.js` séparé (l'enregistrement depuis un blob est bloqué) |
| Installabilité Chrome | Manifest + SW avec handler `fetch` + HTTPS + icônes ≥ 192 px |
| HTTPS | Obligatoire pour tout ce qui précède |

### Constat clé

**La valeur de Vart est en ligne par nature** : tous les moteurs vocaux (OpenAI Realtime, Gemini Live, xAI Grok) et les embeddings sont des API réseau. Hors-ligne, un service worker ne pourrait cacher que la coquille UI — pas de conversation possible. Le bénéfice réel d'une PWA serait donc : installation (icône, fenêtre sans chrome navigateur) et démarrage rapide, **pas** le hors-ligne.

### Options

- **(a) Métas minimales** — ✅ retenue et livrée : `theme-color`, `mobile-web-app-capable`, titres Apple. « Ajouter à l'écran d'accueil » amélioré, zéro risque, compatible `file://`.
- **(b) Variante hébergée** — servir `vart.html` + `manifest.webmanifest` + `sw.js` (cache coquille) depuis un hébergement statique HTTPS (GitHub Pages, Netlify…). Faisable sans backend : toutes les clés API restent côté client. Le fichier local reste la référence ; la copie hébergée ajoute 2 fichiers compagnons. **Différée** — à activer si la demande d'installation se confirme.
- **(c) Wrapper natif** (Electron/Tauri/Capacitor) — distribution « vraie app ». Coût de maintenance élevé. **Écartée** pour l'instant.

### Décision D7

L'option (a) est livrée en Phase 4 ; (b) reste documentée ici comme chemin d'upgrade, (c) écartée. Aucune régression possible sur l'usage `file://`.

## 10. Hors scope (pour l'instant)

- Backend / comptes utilisateurs / synchro cloud
- Applications mobiles natives
- Mode collaboratif multi-utilisateurs en direct

## 12. Architecture modulaire — découpage du monolithe *(livré le 24/09/2026)*

### Le problème

`vart.html` atteignait **17 619 lignes** (911 583 octets) : un seul `<style>` de
5 571 lignes et un seul `<script>` de 11 170 lignes contenant 392 fonctions et
204 déclarations dans le même scope global. Le risque identifié au §9 (« fichier
monolithe ingérable ») était devenu réel : chaque intervention imposait un
`grep` dans 17 000 lignes, et une édition mal ciblée pouvait casser un domaine
sans rapport.

### Contrainte bloquante : `file://`

Vart s'ouvre par **double-clic**, sans serveur. Or les ES modules
(`<script type="module">`) sont **bloqués par CORS** en `file://` : la console
renvoie « Access to script at 'file:///…' from origin 'null' has been blocked by
CORS policy ». Un découpage en modules ES aurait donc **détruit le produit**.

Vérifié au banc d'essai (Playwright, deux fichiers de test) :

| Mécanisme | Résultat en `file://` |
|---|---|
| `<script type="module" src="m.js">` | ❌ bloqué (CORS), le module ne charge jamais |
| `<script src="a.js">` classique | ✅ charge sans erreur ; un `const` de premier niveau reste visible du script suivant |

### Décision (D8)

**Concaténation de modules en scripts classiques.** Les modules sont des
tranches **contiguës** d'un même script, assemblées dans l'ordre d'un manifeste.
Le fichier livré reste un HTML autonome, ouvrable par double-clic, avec une
seule dépendance externe (pdf.js).

### Arborescence

```
src/manifest.json          ordre + rôle de chaque module (l'index à lire)
src/index.template.html    coquille HTML, marqueurs @@STYLES@@ / @@SCRIPTS@@
src/styles/  8 fichiers    00-fondations → 90-surcharge-apple (DERNIER)
src/js/     51 fichiers    00-noyau-migration → 50-bootstrap (ordre d'exécution)
scripts/build.js           assembleur (concaténation pure, ~50 ms)
scripts/check.js           dérive, syntaxe, garde-fous file://, conventions
scripts/split.js           découpage one-shot (conservé pour trace)
_baseline/                 original d'avant découpage (rollback)
```

### Garantie de non-régression

La découpe a été validée **par preuve, pas par confiance** :

1. **Contiguïté** : les 59 plages de lignes couvrent exactement les lignes
   20-5588 (CSS) et 6449-17616 (JS), sans trou ni chevauchement.
2. **Identité** : le `vart.html` régénéré est identique **octet pour octet** à
   l'original — même SHA-256 (`759962cc1e515abc…`), vérifié par `cmp`.
3. **Exécution** : les 7 captures Playwright (accueil sombre/clair, modales,
   dialogues, reduced-motion) sont conformes.

`npm run check` rejoue les contrôles 1 et la syntaxe à chaque exécution :
- dérive de `vart.html` par rapport à `src/` (détecte une édition directe) ;
- analyse syntaxique du JS concaténé via `vm.Script` ;
- refus de tout `import`/`export` ou `type="module"` (casserait `file://`) ;
- dialogue limité à `customAlert`/`customConfirm` ;
- `90-surcharge-apple.css` doit rester le dernier CSS.

### Découpage de 2e niveau *(livré le 24/09/2026)*

Les cinq plus gros modules ont été scindés à leur tour, avec un nouvel outil :
`scripts/resplit.js`. Sa particularité est son **filet de sécurité** : il découpe,
met à jour le manifeste, puis exige que `vart.html` reste identique à la
référence. Sinon il **annule tout** (fichiers et manifeste) et sort en erreur —
un découpage ne peut donc pas casser l'application.

| Module d'origine | Lignes | Découpé en | Plus gros morceau |
|---|---|---|---|
| `60-editeurs-config.css` | 2 192 | 11 fichiers `60a`-`60k` | 424 l. |
| `40-orb-transcript.css` | 982 | 5 fichiers `40a`-`40e` | 393 l. |
| `50-modes-lecture.css` | 706 | 4 fichiers `50a`-`50d` | 255 l. |
| `44-vision.js` | 687 | `44a` capture / `44b` stockage / `44c` UI | 250 l. |
| `38-sessions-openai.js` | 646 | `38a` Realtime / `38b` GPT Live / `38c` xAI | 343 l. |

**Convention de nommage** : un module découpé garde son numéro et reçoit un
suffixe alphabétique (`44a`, `44b`, `44c`), pour ne pas avoir à renuméroter
tous les modules suivants.

**Bilan** : 59 → **80 modules** ; le plus gros passe de **2 192 à 623 lignes**.
Les plages du manifeste couvrent toujours exactement les totaux d'origine
(5 569 lignes de CSS, 11 168 lignes de JS) et `vart.html` reste identique
octet pour octet.

### Deux incidents réels, et ce qu'ils ont appris

1. **Crash sur la borne de fin.** La boucle de contrôle des points de coupe
   traitait la dernière borne (la fin exclusive) comme un début de partie →
   `lines[total]` vaut `undefined` → `TypeError`. Découvert par un **test
   d'échec volontaire** (référence volontairement corrompue pour vérifier le
   rollback), jamais par le chemin nominal. Leçon : tester le chemin d'échec,
   pas seulement le chemin heureux.
2. **Course sur le manifeste.** Lancer deux `resplit` **en parallèle** : chacun
   lit `src/manifest.json`, le modifie en mémoire, puis l'écrit — le dernier
   écrase les entrées du premier. Résultat : manifeste incohérent avec les
   fichiers sur disque. Réparé par un retour à l'état commité, puis prévenu par
   un **verrou** (`.resplit.lock`) et documenté dans `CLAUDE.md`. Leçon : ces
   scripts ne sont pas réentrants, ils se lancent **en séquence**.

### Suite

Plus gros modules restants : `22-ui-config-pickers.js` (623 l.),
`46-conversation-controle.js` (580 l.), `36-ui-modes.js` (524 l.). Le même
outil s'applique, sans risque, module par module.



