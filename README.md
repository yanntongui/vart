# Vart

**Assistant vocal d'apprentissage 100 % local.**

> *Crée ton professeur, donne-lui tes cours, et apprends en lui parlant.*

Vart est une application **HTML/CSS/JS vanilla** — sans framework, sans backend,
sans compte, sans serveur. Tes clés API et tes données restent dans ton
navigateur (`localStorage` / IndexedDB). Rien ne transite par un tiers : les
seuls appels réseau vont directement de ton navigateur aux API que tu as
configurées.

---

## ✨ Ce qu'il fait

### Conversation vocale en temps réel
- **OpenAI** : Realtime (WebSocket) et **GPT Live** (WebRTC, délégation backend)
- **Gemini Live** (BidiGenerateContent, reprise de session automatique)
- **Grok Voice** (xAI Realtime, recherche web intégrée)

### Deux modes dédiés
- 🎙️ **Transcripteur** — prise de notes continue (Gemini Transcribe Live, Whisper)
- 🌍 **Traducteur** — interprétation en direct, 13 langues

### Personas augmentés
Chaque persona a une **posture** (Expert / Mentor / Coach), des **règles par
blocs** (comportement, format, conditionnel, interdit) et une **mémoire à long
terme** mise à jour automatiquement après chaque session.

Ses **sources** (PDF, TXT/MD, URL, dossier Obsidian) sont découpées, vectorisées
et interrogées par recherche sémantique — avec **repli BM25 local** si aucune clé
d'embedding n'est disponible.

**11 outils** sont appelables en pleine conversation :
`search_sources`, `search_history`, `save_note`, `calculate`, `fetch_url`,
`create_quiz`, `make_flashcard`, `plan_session`, `update_progress`,
`review_flashcards`, `mark_flashcard_reviewed`.

### Pédagogie active
- **Quiz** générés depuis les sources, **fiches** recto/verso
- **Plans d'apprentissage** par étapes, **suivi de progression** par sujet
- **Répétition espacée** (Leitner 1 → 3 → 7 → 16 → 35 j) : pastille de révision
  à l'accueil, rappel vocal, notification optionnelle
- **Connecteur Obsidian bidirectionnel** : le vault sert de source, et Vart écrit
  ses sessions, fiches (format plugin Spaced Repetition), mémoires et plans
- Exports **CSV Anki**, **Markdown**, et **persona v3** partageable
  (« professeur complet » avec ses sources embarquées)

### Maîtrise des coûts
Grille tarifaire détaillée (audio, texte, image, cache, tarifs à la minute),
budget mensuel avec alerte à 90 % et blocage à 100 %, **plafond par persona**,
et confirmations préventives avant toute opération payante.

### Confort
Thème sombre / clair, trois dispositions de conversation, vision (caméra ou
partage d'écran), raccourcis clavier (`Espace`, `M`, `V`, `P`), dialogues
maison — et un rendu soigné, dans l'esprit des interfaces système modernes.

---

## 🚀 Démarrage

Aucune installation n'est nécessaire pour **utiliser** Vart :

```
1. Télécharge vart.html
2. Ouvre-le dans Chrome, Edge ou Safari (double-clic suffit)
3. Configuration → Clés API : saisis au moins une clé
   (OpenAI, Gemini ou xAI)
4. Crée un persona et parle-lui
```

C'est volontaire : `vart.html` est un fichier **autonome**, ouvrable en
`file://`, sans serveur ni service worker.

---

## 🏗️ Architecture

`vart.html` est un **artefact généré** — la source de vérité est `src/`.

```
src/manifest.json          ordre + rôle de chaque module (l'index à lire)
src/index.template.html    coquille HTML (@@STYLES@@ / @@SCRIPTS@@)
src/styles/   8 fichiers CSS    00-fondations -> 90-surcharge-apple (en dernier)
src/js/      51 fichiers JS     00-noyau-migration -> 50-bootstrap
scripts/build.js           assembleur : src/ -> vart.html
scripts/check.js           dérive, syntaxe, garde-fous, conventions
scripts/vart_shots.js      validation visuelle Playwright
```

### ⚠️ Ne jamais éditer `vart.html` à la main
Le fichier est écrasé au prochain build. Édite le module concerné dans `src/`,
puis :

```bash
npm install       # Playwright, pour la validation visuelle uniquement
npm run build     # src/ -> vart.html          (~50 ms, concaténation pure)
npm run check     # dérive, syntaxe, garde-fous
npm run shots     # captures de non-régression
```

`npm run check` **échoue** si `vart.html` a été modifié directement : c'est le
garde-fou contre la perte de travail.

### Pourquoi pas de modules ES ?

Parce que Vart doit rester ouvrable par **double-clic**. En `file://`,
`<script type="module">` est bloqué par CORS (« origin 'null' ») et ne se charge
jamais, alors qu'un `<script src>` classique charge sans erreur et partage le
scope global. Les modules sont donc des tranches **contiguës** d'un même script,
concaténées dans l'ordre du manifeste. Le découpage est prouvé **sans perte** :
le `vart.html` régénéré est identique octet pour octet à l'original.

---

## 🔒 Vie privée

- **Aucun serveur**, aucun compte, aucune télémétrie.
- Clés API et données en `localStorage` / IndexedDB, dans **ton** navigateur.
- La **mémoire des personas n'est jamais exportée** — c'est explicite dans
  l'interface : elle reste privée.
- Une seule dépendance externe : **pdf.js** (CDN), pour lire les PDF en source.

---

## 📄 Documentation

- `PLAN-VART.md` — plan directeur : vision, décisions actées, phasage, études
  (PWA, architecture modulaire)
- `CLAUDE.md` — conventions du code, pièges connus, état des phases

---

## 👤 Auteur

Créé par **VYT Digital Solutions**.
