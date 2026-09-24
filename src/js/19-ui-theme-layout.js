    function applyTheme(t) {
        document.documentElement.setAttribute('data-theme', t);
        setThemeStorage(t);
        // Reflète le thème sur les cartes de l'onglet Affichage (Configuration)
        document.querySelectorAll('.display-card[data-theme-choice]').forEach(c => {
            c.classList.toggle('is-active', c.dataset.themeChoice === t);
        });
    }

    applyTheme(getTheme());
    // Vignettes : migration de l'ancien format (images en ligne dans
    // localStorage) vers IndexedDB, puis purge des blobs orphelins — une image
    // envoyée dans une conversation jamais enregistrée n'a plus de référence.
    // En arrière-plan : rien à l'écran n'en dépend.
    setTimeout(() => { visionStorageHousekeeping(); }, 0);


    function getConversationLayout() {
        return localStorage.getItem('vart_convLayout') || 'classic';
    }
    function setConversationLayout(layout) {
        localStorage.setItem('vart_convLayout', layout);
        animateLayoutSwitch(layout);
        // Au changement de vue, on force un retour en bas pour voir le dernier
        // message dans la nouvelle disposition (scrollTranscript respecte la
        // règle sticky-bottom : ne scroll que si déjà < 60 px du bas, donc on
        // setTop = scrollHeight directement ici, sans condition).
        requestAnimationFrame(() => {
            const el = document.getElementById('transcript');
            if (el) el.scrollTop = el.scrollHeight;
        });
    }

    // FLIP (First-Last-Invert-Play) — anime les éléments visibles entre deux
    // layouts depuis leur ancienne position vers la nouvelle, via un transform
    // appliqué puis annulé. Ce sont les éléments réels qui se déplacent (pas
    // des snapshots), donc le canvas continue de dessiner pendant l'animation.
    //
    // ⚠ Important : on cible le CANVAS et pas le WRAP, et on n'utilise que
    // translate (jamais scale). Sinon le `getBoundingClientRect()` utilisé
    // par syncCanvasSize() inclut le scale, le buffer du canvas est resizé
    // à chaque frame de l'animation → clignotement et faux zoom.
    // Le canvas de l'orb est 450×450 dans les 3 layouts (taille visuelle stable),
    // donc translate seul suffit pour un morph propre.
    //
    // Les éléments qui changent de visibilité (transcript, textes overlay) sont
    // cross-fadés via une animation d'opacité sur #conversationBody pour
    // adoucir les apparitions/disparitions.
    function animateLayoutSwitch(layout) {
        const REDUCED = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        const orbCanvas   = document.getElementById('aiOrbCanvas');
        const centralGlow = document.getElementById('centralGlow');
        const waveWrap    = document.getElementById('userWaveWrap');
        const bottom      = document.querySelector('.bottom-controls');
        const transcript  = document.getElementById('transcript');
        // centralGlow suit l'orb (même delta que le canvas → animation synchrone).
        const targets = [orbCanvas, centralGlow, waveWrap, bottom]
            .filter(el => el && el.offsetParent && el.getClientRects().length);

        // Fallback : pas d'API d'animation ou prefers-reduced-motion → switch direct.
        if (REDUCED || !targets.length || typeof Element.prototype.animate !== 'function') {
            applyConversationLayout(layout);
            return;
        }

        // Détecte si le transcript va apparaître/disparaître pour adoucir la transition.
        const wasTranscriptVisible = transcript && getComputedStyle(transcript).display !== 'none';

        // Snapshot de l'état visuel du transcript AVANT le changement de layout.
        // On capture le rect + toutes les propriétés flex/padding qui pilotent
        // l'alignement des bulles à l'intérieur : sinon en passant de bubbles
        // à classic, on perd `justify-content: flex-end` et les bulles
        // remontent brutalement en haut pendant le fade-out.
        let oldTranscriptRect = null;
        let oldTranscriptStyles = null;
        if (transcript && wasTranscriptVisible) {
            oldTranscriptRect = transcript.getBoundingClientRect();
            const cs = getComputedStyle(transcript);
            oldTranscriptStyles = {
                backgroundColor: cs.backgroundColor,
                flexDirection:   cs.flexDirection,
                justifyContent:  cs.justifyContent,
                alignItems:      cs.alignItems,
                padding:         cs.padding,
                gap:             cs.gap,
                borderRadius:    cs.borderRadius
            };
        }

        // FIRST : mesure la position de chaque élément avant le changement
        const oldRects = new Map();
        targets.forEach(el => oldRects.set(el, el.getBoundingClientRect()));

        // LAST : applique le nouveau layout (les éléments sautent à leur nouvelle place)
        applyConversationLayout(layout);

        // Fade in / fade out du transcript pour éviter le snap dû à display:none.
        const isTranscriptVisible = transcript && getComputedStyle(transcript).display !== 'none';
        if (transcript && !wasTranscriptVisible && isTranscriptVisible) {
            // APPARITION : fade in après que le layout a appliqué display:flex.
            transcript.animate(
                [{ opacity: 0 }, { opacity: 1 }],
                { duration: 450, easing: 'ease-out' }
            );
        } else if (transcript && wasTranscriptVisible && !isTranscriptVisible && oldTranscriptRect) {
            // DISPARITION : on FIGE le transcript visuellement à sa position et
            // son apparence d'avant le changement (position: fixed sur le rect
            // capturé, fond transparent, pas de bordure) — sinon le style de
            // base du `#transcript` (cadre avec border + background) ressurgit
            // pendant le fade-out et on voit un cadre apparaître de nulle part.
            // Toutes les overrides sont en !important pour gagner sur le CSS
            // classic qui impose `display: none !important`.
            const frozen = {
                display:           'flex',
                position:          'fixed',
                left:              oldTranscriptRect.left   + 'px',
                top:               oldTranscriptRect.top    + 'px',
                width:             oldTranscriptRect.width  + 'px',
                height:            oldTranscriptRect.height + 'px',
                margin:            '0',
                transform:         'none',
                'max-width':       'none',
                background:        oldTranscriptStyles.backgroundColor,
                border:            'none',
                'border-radius':   oldTranscriptStyles.borderRadius,
                padding:           oldTranscriptStyles.padding,
                gap:               oldTranscriptStyles.gap,
                'flex-direction':  oldTranscriptStyles.flexDirection,
                'justify-content': oldTranscriptStyles.justifyContent,
                'align-items':     oldTranscriptStyles.alignItems,
                'overflow-y':      'hidden',
                'z-index':         '4',
                'pointer-events':  'none'
            };
            Object.entries(frozen).forEach(([k, v]) => transcript.style.setProperty(k, v, 'important'));
            transcript.style.opacity = '1';

            transcript.animate(
                [{ opacity: 1 }, { opacity: 0 }],
                { duration: 300, easing: 'ease-out' }
            ).onfinish = () => {
                Object.keys(frozen).forEach(k => transcript.style.removeProperty(k));
                transcript.style.removeProperty('opacity');
            };
        }

        // INVERT + PLAY : on calcule le delta de POSITION (pas de taille), on
        // place visuellement l'élément à son ancienne position via translate,
        // puis on anime vers translate(0,0) — glissement propre vers la nouvelle.
        // ⚠ Pas de cross-fade d'opacité sur #conversationBody : ça faisait
        // clignoter le fond (le glow central s'estompait à chaque changement).
        // ⚠ On PRÉSERVE le transform CSS existant (ex. #centralGlow a un
        // translate(-50%, -50%) pour son centrage), sinon el.animate l'écrase
        // et l'élément perd son centrage → il atterrit au coin bas-droite.
        requestAnimationFrame(() => {
            targets.forEach(el => {
                const oldRect = oldRects.get(el);
                const newRect = el.getBoundingClientRect();
                if (!oldRect || !oldRect.width || !newRect.width) return;

                const dx = oldRect.left - newRect.left;
                const dy = oldRect.top  - newRect.top;

                if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;

                const computed = getComputedStyle(el).transform;
                const base = (computed && computed !== 'none') ? computed + ' ' : '';

                el.animate(
                    [
                        { transform: `${base}translate(${dx}px, ${dy}px)` },
                        { transform: `${base}translate(0, 0)` }
                    ],
                    { duration: 500, easing: 'cubic-bezier(0.4, 0, 0.2, 1)' }
                );
            });
        });
    }
    function applyConversationLayout(layout) {
        const area = document.getElementById('conversationArea');
        if (!area) return;
        area.classList.remove('layout-classic', 'layout-compact', 'layout-bubbles');
        area.classList.add('layout-' + layout);
        // Reflète la sélection dans le menu
        document.querySelectorAll('#settingsMenu [data-action="layout"]').forEach(b => {
            b.classList.toggle('active', b.dataset.layout === layout);
        });
        // ...et sur les cartes de l'onglet Affichage
        document.querySelectorAll('.display-card[data-layout-choice]').forEach(c => {
            c.classList.toggle('is-active', c.dataset.layoutChoice === layout);
        });
    }
    // Applique le layout sauvegardé dès le chargement
    applyConversationLayout(getConversationLayout());

    (() => {
        const btn = document.getElementById('settingsBtn');
        const menu = document.getElementById('settingsMenu');
        if (!btn || !menu) return;
        const open = () => {
            // « Paramètres du persona » : visible uniquement dans une conversation
            // avec un vrai persona (pas transcripteur/traducteur/historique/accueil).
            const activePersona = getActiveId() && getPersonas().find(p => p.id === getActiveId());
            const psItem = menu.querySelector('[data-action="persona-settings"]');
            if (psItem) psItem.style.display = activePersona ? '' : 'none';
            menu.classList.add('open');
            menu.setAttribute('aria-hidden', 'false');
            btn.setAttribute('aria-expanded', 'true');
        };
        const close = () => {
            menu.classList.remove('open');
            menu.setAttribute('aria-hidden', 'true');
            btn.setAttribute('aria-expanded', 'false');
        };
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            menu.classList.contains('open') ? close() : open();
        });
        document.addEventListener('click', (e) => {
            if (!menu.classList.contains('open')) return;
            if (e.target === btn || btn.contains(e.target) || menu.contains(e.target)) return;
            close();
        });
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && menu.classList.contains('open')) close();
        });

        menu.addEventListener('click', (e) => {
            const item = e.target.closest('[data-action]');
            if (!item) return;
            const action = item.dataset.action;
            if (action === 'persona-settings') {
                close();
                const id = getActiveId();
                const persona = id && getPersonas().find(p => p.id === id);
                if (persona) {
                    openPersonaModal(persona);
                } else {
                    customAlert('Sélectionnez d\'abord un persona pour modifier ses paramètres.', { icon: 'pencil' });
                }
            } else if (action === 'layout') {
                setConversationLayout(item.dataset.layout);
                // On ne ferme PAS le menu — l'utilisateur voit le changement et
                // peut tester un autre layout sans rouvrir.
            }
        });

        // Marquer le layout actif à l'ouverture (au cas où il a été modifié ailleurs)
        applyConversationLayout(getConversationLayout());
    })();

    // Recherche dans l'historique
    (() => {
        const input = document.getElementById('convSearchInput');
        const wrap = input.parentElement;
        const clear = document.getElementById('convSearchClear');
        const sync = () => {
            wrap.classList.toggle('has-text', input.value.length > 0);
            renderPersonaList();
        };
        input.addEventListener('input', sync);
        clear.addEventListener('click', () => { input.value = ''; input.focus(); sync(); });
    })();


