    async function selectTranscripteur() {
        stopConversation();
        exitViewingHistory();
        document.body.classList.add('in-conversation');

        isTranscripteurMode = true;
        isTraducteurMode = false;
        document.body.classList.add('transcripteur-active');
        updateOrbCenterBtn('idle');
        setActiveId(TRANSCRIPTEUR_ID);
        renderPersonaList();

        document.getElementById('emptyState').style.display = 'none';
        const ok = await ensureMicReady();
        if (!ok) return;
        const convArea = document.getElementById('conversationArea');
        convArea.style.display = 'flex';
        playPageTransition(convArea);
        convArea.classList.add('transcripteur-mode');

        // Header — même structure que les personas : avatar rond en --accent
        // avec la lettre T, nom + description. Aucun DOM ne bouge, on garde
        // la structure standard #personaHeader / #aiOrbWrap / ... (l'orb
        // réagira au micro utilisateur, voir animate() dans le VISUALISEURS).
        const avatarContainer = document.getElementById('personaHeaderAvatar');
        avatarContainer.innerHTML = '<div class="transcripteur-placeholder">T</div>';
        document.getElementById('personaHeaderName').textContent = 'Transcripteur';
        // Pilule « moteur + langue » (même composant que le Traducteur).
        renderTranscripteurControls(document.getElementById('personaHeaderDesc'));

        // Cache les boutons persona-spécifiques (éditer/dupliquer)
        document.getElementById('editPersonaBtn').style.display = 'none';
        document.getElementById('duplicatePersonaBtn').style.display = 'none';

        // Libellé du bouton principal + reset
        document.getElementById('startBtn').textContent = 'Démarrer la transcription';
        resetTranscript();
        totalInputTokens = 0;
        totalOutputTokens = 0;
        resetSessionCosts();
        updateTokenCounter();
    }

    // Icône Lucide « languages » (deux systèmes d'écriture croisés) — utilisée
    // pour la carte, l'avatar sidebar et l'avatar header du mode Traducteur.
    const TRADUCTEUR_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 8 6 6"/><path d="m4 14 6-6 2-3"/><path d="M2 5h12"/><path d="M7 2h1"/><path d="m22 22-5-10-5 10"/><path d="M14 18h6"/></svg>';

    async function selectTraducteur() {
        stopConversation();
        exitViewingHistory();
        document.body.classList.add('in-conversation');

        isTraducteurMode = true;
        isTranscripteurMode = false;
        document.body.classList.add('traducteur-active');
        updateOrbCenterBtn('idle');
        setActiveId(TRADUCTEUR_ID);
        renderPersonaList();

        document.getElementById('emptyState').style.display = 'none';
        const ok = await ensureMicReady();
        if (!ok) return;
        const convArea = document.getElementById('conversationArea');
        convArea.style.display = 'flex';
        playPageTransition(convArea);
        // Le traducteur utilise le layout persona standard (orb + wave +
        // transcript), pas le layout épuré du transcripteur.
        convArea.classList.remove('transcripteur-mode');

        // Avatar : icône « languages » sur dégradé propre au mode traducteur
        const avatarContainer = document.getElementById('personaHeaderAvatar');
        avatarContainer.innerHTML = `<div class="traducteur-placeholder">${TRADUCTEUR_SVG}</div>`;
        document.getElementById('personaHeaderName').textContent = 'Traducteur';

        // Description : puces cliquables (moteur + langue cible).
        const desc = document.getElementById('personaHeaderDesc');
        renderTraducteurControls(desc);

        // Cache les boutons persona-spécifiques (éditer/dupliquer)
        document.getElementById('editPersonaBtn').style.display = 'none';
        document.getElementById('duplicatePersonaBtn').style.display = 'none';

        document.getElementById('startBtn').textContent = 'Démarrer la traduction';
        resetTranscript();
        totalInputTokens = 0;
        totalOutputTokens = 0;
        resetSessionCosts();
        updateTokenCounter();
    }

    // Rend le réglage du mode Traducteur dans le header : UNE puce qui montre
    // le moteur actif et la langue cible, et ouvre un panneau à onglets
    // (OpenAI / Gemini) listant les langues propres à chaque API.
    function renderTraducteurControls(container) {
        container.innerHTML = '';
        const engine = translateModelInfo(getTranslateModel());
        const info = translateLangInfo(getTranslateLang());
        const flag = langFlag(info.code);
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'traducteur-lang-btn traducteur-select-btn';
        btn.setAttribute('aria-haspopup', 'listbox');
        btn.innerHTML = `<span class="tl-engine">${engine.name}</span><span class="tl-target">Vers ${info.name.toLowerCase()}</span>${flag ? `<span class="flag" aria-hidden="true">${flag}</span>` : ''}<span class="chev">${ICON_SVG['chevron-down']}</span>`;
        btn.addEventListener('click', (e) => { e.stopPropagation(); openTraducteurSelect(btn); });
        container.appendChild(btn);
    }

    // Même pilule pour le Transcripteur : moteur (OpenAI / Gemini) + langue
    // de transcription (« Automatique » ou une langue fixée).
    function renderTranscripteurControls(container) {
        container.innerHTML = '';
        const engine = transcribeModelInfo(getTranscribeModel());
        const lang = transcribeLangInfo(getTranscribeLang(engine.key), engine.key);
        const flag = transcribeLangFlag(lang.code);
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'traducteur-lang-btn traducteur-select-btn';
        btn.setAttribute('aria-haspopup', 'listbox');
        btn.innerHTML = `<span class="tl-engine">${engine.name}</span><span class="tl-target">${lang.name}</span>${flag ? `<span class="flag" aria-hidden="true">${flag}</span>` : ''}<span class="chev">${ICON_SVG['chevron-down']}</span>`;
        btn.addEventListener('click', (e) => { e.stopPropagation(); openTranscripteurSelect(btn); });
        container.appendChild(btn);
    }

    function refreshTranscripteurControls() {
        const desc = document.getElementById('personaHeaderDesc');
        if (desc && isTranscripteurMode) renderTranscripteurControls(desc);
    }

    function refreshTraducteurControls() {
        const desc = document.getElementById('personaHeaderDesc');
        if (desc) renderTraducteurControls(desc);
    }

    // Panneau unique : onglets moteur en haut, recherche, puis la liste des
    // langues du moteur affiché. Choisir une langue valide À LA FOIS le moteur
    // (= onglet courant) et la langue cible.
    let traducteurDocClick = null; // listener « clic extérieur » courant (nettoyé à chaque ouverture/fermeture)

    // Panneau PARTAGÉ Traducteur / Transcripteur : onglets moteur en haut (seuls
    // éléments à porter l'info-bulle modèle + coût au survol), recherche, puis
    // la liste des langues du moteur affiché. Choisir une langue valide À LA FOIS le moteur (= onglet
    // courant) et la langue.
    //   opts.engines      : [{ key, name, model }]
    //   opts.currentEngine: clé du moteur actif
    //   opts.langsFor(key): liste [{ code, name }] du moteur
    //   opts.currentLang(key): code de la langue active pour ce moteur
    //   opts.flagFor(code): drapeau (emoji) ou ''
    //   opts.onPick(key, code): appliquer le choix (langue cliquée)
    //   opts.onEngine(key): appliquer le moteur dès le clic sur son onglet —
    //     la langue affichée est celle que currentLang(key) résout pour lui,
    //     et la pilule est rafraîchie sans attendre un clic sur une langue.
    function openEngineLangPanel(anchor, opts) {
        document.querySelectorAll('.traducteur-lang-menu').forEach(m => m.remove());
        hideVartTip();
        if (traducteurDocClick) { document.removeEventListener('click', traducteurDocClick); traducteurDocClick = null; }
        const panel = document.createElement('div');
        panel.className = 'traducteur-lang-menu traducteur-select-panel open';
        let viewEngine = opts.currentEngine;

        function closePanel() {
            hideVartTip();
            panel.remove();
            if (traducteurDocClick) { document.removeEventListener('click', traducteurDocClick); traducteurDocClick = null; }
        }

        const tabs = document.createElement('div');
        tabs.className = 'tl-tabs';
        opts.engines.forEach(m => {
            const t = document.createElement('button');
            t.type = 'button';
            t.className = 'tl-tab';
            t.dataset.engine = m.key;
            t.textContent = m.name;
            const hasKey = engineHasKey(m);
            if (!hasKey) {
                t.classList.add('is-disabled');
                t.setAttribute('aria-disabled', 'true');
            }
            attachCostTip(t, m.model, hasKey ? '' : `Clé API ${m.name} manquante`);
            t.addEventListener('click', (e) => {
                e.stopPropagation();
                // Pas de clé pour ce moteur : on n'active rien, on ouvre la
                // configuration sur le bon fournisseur.
                if (!hasKey) { closePanel(); openApiKeyModal({ tab: 'api', provider: m.provider }); return; }
                viewEngine = m.key;
                if (opts.onEngine) opts.onEngine(m.key);
                render();
            });
            tabs.appendChild(t);
        });
        panel.appendChild(tabs);

        const search = document.createElement('input');
        search.type = 'text';
        search.className = 'tl-search';
        search.placeholder = 'Rechercher une langue…';
        search.addEventListener('input', render);
        search.addEventListener('click', (e) => e.stopPropagation());
        panel.appendChild(search);

        const list = document.createElement('div');
        list.className = 'tl-lang-list';
        panel.appendChild(list);

        function render() {
            [...tabs.children].forEach(t => t.classList.toggle('is-active', t.dataset.engine === viewEngine));
            const current = opts.currentLang(viewEngine);
            const q = (search.value || '').trim().toLowerCase();
            list.innerHTML = '';
            opts.langsFor(viewEngine)
                .filter(l => !q || l.name.toLowerCase().includes(q))
                .forEach(l => {
                    const item = document.createElement('div');
                    item.className = 'traducteur-lang-menu-item' + (l.code === current ? ' is-selected' : '');
                    const flag = opts.flagFor(l.code);
                    item.innerHTML = `<span class="flag" aria-hidden="true">${flag}</span><span>${l.name}</span>`;
                    item.addEventListener('click', () => {
                        opts.onPick(viewEngine, l.code);
                        closePanel();
                    });
                    list.appendChild(item);
                });
            if (!list.children.length) {
                const empty = document.createElement('div');
                empty.className = 'tl-empty';
                empty.textContent = 'Aucune langue';
                list.appendChild(empty);
            }
        }
        render();

        document.body.appendChild(panel);
        const rect = anchor.getBoundingClientRect();
        const w = panel.offsetWidth;
        const clampedX = Math.max(8, Math.min(rect.left + rect.width / 2 - w / 2, window.innerWidth - w - 8));
        panel.style.left = `${clampedX}px`;
        panel.style.top  = `${rect.bottom + 6}px`;
        setTimeout(() => { try { search.focus(); } catch (e) {} }, 0);
        setTimeout(() => {
            traducteurDocClick = (e) => {
                if (!panel.contains(e.target) && e.target !== anchor) closePanel();
            };
            document.addEventListener('click', traducteurDocClick);
        }, 0);
    }

    // Traducteur : moteur + langue cible (mémorisée PAR moteur, codes différents).
    function openTraducteurSelect(anchor) {
        openEngineLangPanel(anchor, {
            engines: TRANSLATE_MODELS,
            currentEngine: getTranslateModel(),
            langsFor: translateLangsFor,
            currentLang: getTranslateLang,
            flagFor: langFlag,
            onEngine: (engine) => {
                setTranslateModel(engine);
                refreshTraducteurControls();
                if (isTraducteurMode && !isConnected) updateTokenCounter();
                if (isConnected) setStatus('Réglage changé, arrêtez puis relancez pour appliquer', 'error');
            },
            onPick: (engine, code) => {
                setTranslateModel(engine);
                setTranslateLang(code, engine);
                refreshTraducteurControls();
                // Rafraîchit le badge modèle (le moteur a pu changer).
                if (isTraducteurMode && !isConnected) updateTokenCounter();
                if (isConnected) setStatus('Réglage changé, arrêtez puis relancez pour appliquer', 'error');
            }
        });
    }

    // Transcripteur : moteur + langue de transcription (liste propre à chaque
    // moteur, reliées par la langue de base — cf. getTranscribeLang).
    function openTranscripteurSelect(anchor) {
        openEngineLangPanel(anchor, {
            engines: TRANSCRIBE_MODELS,
            currentEngine: getTranscribeModel(),
            langsFor: transcribeLangsFor,
            currentLang: getTranscribeLang,
            flagFor: transcribeLangFlag,
            // Onglet cliqué = moteur choisi. La langue est résolue par
            // getTranscribeLang (équivalent de la langue de base, sinon
            // « Automatique ») ; la base mémorisée ne change pas, pour retrouver
            // son choix précis en revenant sur l'autre moteur.
            onEngine: (engine) => {
                setTranscribeModel(engine);
                refreshTranscripteurControls();
                if (isTranscripteurMode) updateTokenCounter();
                if (isConnected) setStatus('Réglage changé, arrêtez puis relancez pour appliquer', 'error');
            },
            onPick: (engine, code) => {
                setTranscribeModel(engine);
                setTranscribeLang(code, engine);
                refreshTranscripteurControls();
                if (isTranscripteurMode) updateTokenCounter();
                if (isConnected) setStatus('Réglage changé, arrêtez puis relancez pour appliquer', 'error');
            }
        });
    }

    // Petite transition d'entrée jouée à chaque bascule de vue principale
    // (accueil, nouvelle conversation, transcripteur, traducteur, relecture
    // d'historique) pour éviter les changements de page instantanés. Simple
    // fondu, sans aucun mouvement. S'appuie sur l'API Web Animations : se
    // rejoue à chaque appel, sans toucher au CSS, et ne laisse aucune trace
    // une fois terminée (fill par défaut = none).
    function playPageTransition(el) {
        if (!el) return;
        if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
        try {
            el.animate(
                [{ opacity: 0 }, { opacity: 1 }],
                { duration: 340, easing: 'ease' }
            );
        } catch (e) { /* WAAPI indisponible : bascule instantanée, sans gêne */ }
    }

    function showEmptyState(opts = {}) {
        // Quitter proprement une conversation en cours : ferme le WebSocket et
        // sauvegarde la discussion dans l'historique. À faire AVANT de
        // réinitialiser le contexte (stopConversation lit getActiveId() et les
        // modes). Le micro reste ouvert (stopMicrophone conserve persistentStream)
        // pour ne pas redemander l'autorisation au prochain démarrage.
        if (isConnected || waitingGreeting) stopConversation();
        isTranscripteurMode = false;
        isTraducteurMode = false;
        exitViewingHistory();
        document.body.classList.remove('in-conversation', 'transcripteur-active', 'traducteur-active');
        document.getElementById('conversationArea').classList.remove('transcripteur-mode', 'mic-gated');
        document.getElementById('startBtn').textContent = 'Démarrer la conversation';

        document.getElementById('emptyState').style.display = 'flex';
        document.getElementById('conversationArea').style.display = 'none';
        // Fondu du conteneur (la cascade des cartes assure l'entrée détaillée).
        playPageTransition(document.getElementById('emptyState'));
        setActiveId('');
        renderPersonaList();
        // On anime l'entrée des cartes à chaque arrivée sur l'accueil (chargement
        // initial, bouton « Accueil »), pas lors des simples rafraîchissements.
        renderWelcomeGrid({ animate: opts.animate !== false });
    }

    // Ancien helper — plus nécessaire depuis que le mode transcripteur
    // n'altère plus le DOM (il utilise le même layout que les personas).
    // Conservé comme no-op pour ne rien casser côté callers.
    function restoreTranscripteurLayout() { /* no-op */ }

    function renderWelcomeGrid(opts = {}) {
        const grid = document.getElementById('welcomeGrid');
        const list = getPersonas();
        grid.innerHTML = '';
        grid.classList.remove('is-entering');

        list.forEach(p => {
            const card = document.createElement('div');
            card.className = 'welcome-card';
            card.innerHTML = `
                <button class="welcome-card-menu-btn" title="Options">&hellip;</button>
                <div class="welcome-card-menu">
                    <button data-action="edit"><span class="icon" data-icon="pencil"></span> Éditer</button>
                    <button data-action="duplicate"><span class="icon" data-icon="copy"></span> Dupliquer</button>
                    <button data-action="export"><span class="icon" data-icon="save"></span> Exporter</button>
                    <button data-action="export-full"><span class="icon" data-icon="save"></span> Exporter avec sources</button>
                    <button data-action="delete" class="danger"><span class="icon" data-icon="trash"></span> Supprimer</button>
                </div>
                <div class="welcome-card-avatar">
                    ${safeImgSrc(p.image)
                        ? `<img src="${safeImgSrc(p.image)}">`
                        : `<div class="welcome-card-placeholder">${silhouetteFor(p.gender)}</div>`
                    }
                </div>
                <div class="welcome-card-info">
                    <div class="welcome-card-name">${esc(p.name)}</div>
                    ${p.description ? `<div class="welcome-card-desc">${esc(p.description)}</div>` : ''}
                </div>
                <div class="review-badge" data-persona-id="${esc(p.id)}" hidden title="">🔁 <span class="review-badge-count"></span></div>
            `;

            // Menu "..."
            const menuBtn = card.querySelector('.welcome-card-menu-btn');
            const menu = card.querySelector('.welcome-card-menu');
            menuBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                // Fermer les autres menus
                grid.querySelectorAll('.welcome-card-menu.open').forEach(m => { if (m !== menu) m.classList.remove('open'); });
                menu.classList.toggle('open');
            });

            menu.querySelector('[data-action="edit"]').addEventListener('click', (e) => {
                e.stopPropagation();
                menu.classList.remove('open');
                openPersonaModal(p);
            });

            menu.querySelector('[data-action="duplicate"]').addEventListener('click', (e) => {
                e.stopPropagation();
                menu.classList.remove('open');
                const duplicate = { ...JSON.parse(JSON.stringify(p)), id: 'p_' + Date.now(), name: p.name + ' (copie)' };
                const all = getPersonas();
                all.push(duplicate);
                savePersonas(all);
                renderPersonaList();
                renderWelcomeGrid();
            });

            // Phase 4 : export en deux variantes — léger (persona seul) ou
            // complet « professeur » (sources incluses, vecteurs exclus,
            // re-calculés à l'import). Les deux restent du v3 importable.
            async function doExport(withSources) {
                const srcs = withSources
                    ? (await listPersonaSources(p.id)).map(s => ({ type: s.type, name: s.name, addedAt: s.addedAt, chunks: s.chunks }))
                    : [];
                const personaExport = {
                    type: 'vart-persona',
                    version: 3,
                    exportDate: new Date().toISOString(),
                    sources: srcs,
                    persona: { name: p.name, description: p.description, image: p.image, gender: p.gender || null, model: p.model, voice: p.voice, reactivity: p.reactivity, creativity: p.creativity, greeting: p.greeting, personaInfo: p.personaInfo || '', prompt: p.prompt, posture: p.posture || '', rules: Array.isArray(p.rules) ? p.rules : [], budgetLimit: p.budgetLimit || null }
                };
                const suffix = withSources ? '-complet' : '';
                downloadFile(JSON.stringify(personaExport, null, 2), `Vart-Persona-${p.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}${suffix}-${exportTimestamp()}.json`, 'application/json');
            }
            menu.querySelector('[data-action="export"]').addEventListener('click', async (e) => {
                e.stopPropagation();
                menu.classList.remove('open');
                await doExport(false);
            });
            menu.querySelector('[data-action="export-full"]').addEventListener('click', async (e) => {
                e.stopPropagation();
                menu.classList.remove('open');
                await doExport(true);
            });

            menu.querySelector('[data-action="delete"]').addEventListener('click', async (e) => {
                e.stopPropagation();
                menu.classList.remove('open');
                if (!await customConfirm(`Êtes-vous sûr de vouloir supprimer « ${p.name} » ? Cette action est irréversible.`, { title: 'Supprimer ce persona', icon: 'trash', confirmLabel: 'Supprimer', danger: true })) return;
                const newList = getPersonas().filter(x => x.id !== p.id);
                savePersonas(newList);
                // Phase 2 : purge de ce qui vit hors du JSON des personas
                // (mémoire + sources en IndexedDB) — sinon ces données
                // orphelines resteraient dans la base pour toujours.
                purgePersonaSources(p.id);
                savePersonaMemory(p.id, '');
                delete personaMemoryCache[p.id];
                purgePersonaStudyItems(p.id); // fiches, quiz, plans, progression
                if (getActiveId() === p.id) {
                    setActiveId('');
                    showEmptyState();
                }
                renderPersonaList();
                renderWelcomeGrid();
            });

            card.addEventListener('click', (e) => {
                if (e.target.closest('.welcome-card-menu-btn') || e.target.closest('.welcome-card-menu')) return;
                selectPersona(p.id);
            });
            grid.appendChild(card);
        });

        // Carte "+ Nouveau persona" — À LA SUITE des personas (même rangée qui
        // continue naturellement), avec un fond pointillé et une icône « + ».
        const newCard = document.createElement('div');
        newCard.className = 'welcome-card welcome-card-new';
        newCard.innerHTML = `
            <div class="welcome-card-avatar">
                <div class="welcome-card-new-icon">+</div>
            </div>
            <div class="welcome-card-info">
                <div class="welcome-card-name">Nouveau persona</div>
            </div>
        `;
        newCard.addEventListener('click', () => openNewPersonaChooser());
        grid.appendChild(newCard);

        // Transcripteur & Traducteur : à la suite des cartes, après « Nouveau
        // persona » (dans le flux naturel de la grille auto-fill).
        const trCard = document.createElement('div');
        trCard.className = 'welcome-card';
        trCard.innerHTML = `
            <div class="welcome-card-avatar">
                <div class="transcripteur-card-icon">${TRANSCRIPTEUR_SVG}</div>
            </div>
            <div class="welcome-card-info">
                <div class="welcome-card-name">Transcripteur</div>
                <div class="welcome-card-desc">Note toutes vos idées en continu</div>
            </div>
        `;
        trCard.addEventListener('click', () => selectTranscripteur());
        grid.appendChild(trCard);

        // Carte Traducteur — suit le Transcripteur dans le flux.
        const tlCard = document.createElement('div');
        tlCard.className = 'welcome-card';
        tlCard.innerHTML = `
            <div class="welcome-card-avatar">
                <div class="traducteur-card-icon">${TRADUCTEUR_SVG}</div>
            </div>
            <div class="welcome-card-info">
                <div class="welcome-card-name">Traducteur</div>
                <div class="welcome-card-desc">Interprète en direct, dans la langue de votre choix</div>
            </div>
        `;
        tlCard.addEventListener('click', () => selectTraducteur());
        grid.appendChild(tlCard);
        hydrateIcons(grid);

        // Entrée animée en cascade des cartes (uniquement à l'arrivée sur
        // l'accueil). On indexe chaque carte (--i) pour décaler son animation ;
        // la classe est retirée une fois la cascade terminée pour ne pas gêner
        // les transitions de survol.
        if (opts.animate) {
            const cards = grid.querySelectorAll('.welcome-card');
            cards.forEach((c, i) => c.style.setProperty('--i', i));
            grid.classList.add('is-entering');
            const total = cards.length * 45 + 600;
            setTimeout(() => grid.classList.remove('is-entering'), total);
        }
        // Phase 4 : pastilles « fiches à réviser » (comptage IndexedDB async).
        refreshDueBadges().catch(() => {});
    }


