    function formatModelPricingBadge(model) {
        const p = PRICING[model];
        if (!p) return '';
        if (p.perMinute != null) return `≈ ${fmtUsd(p.perMinute)} / min${p.backendModel ? ' + tokens' : ''}`;
        return `In ${fmtUsd(p.input * 1000)}/M · Out ${fmtUsd(p.output * 1000)}/M`;
    }

    function enhanceSelectAsCustom(select, { getMeta } = {}) {
        if (!select || select.dataset.vartCustom === '1') return;
        select.dataset.vartCustom = '1';
        // On garde le select dans le flux pour préserver l'API DOM
        // (event dispatch, .value, focus programmatique) mais on le rend
        // visuellement inerte.
        Object.assign(select.style, {
            position: 'absolute', opacity: '0', pointerEvents: 'none',
            width: '0', height: '0', margin: '0', padding: '0', border: '0'
        });
        select.setAttribute('aria-hidden', 'true');
        select.tabIndex = -1;

        const wrap = document.createElement('div');
        wrap.className = 'vart-select';
        const trigger = document.createElement('button');
        trigger.type = 'button';
        trigger.className = 'vart-select-trigger';
        const triggerLabel = document.createElement('span');
        triggerLabel.className = 'vart-select-trigger-label';
        const chevron = document.createElement('span');
        chevron.className = 'vart-select-trigger-chevron';
        chevron.innerHTML = ICON_SVG['chevron-down'];
        trigger.append(triggerLabel, chevron);
        const panel = document.createElement('div');
        panel.className = 'vart-select-panel';
        wrap.append(trigger, panel);
        select.after(wrap);

        function makeOption(opt) {
            const item = document.createElement('div');
            item.className = 'vart-select-option';
            item.dataset.value = opt.value;
            const row = document.createElement('div');
            row.className = 'vart-select-option-row';
            const name = document.createElement('span');
            name.className = 'vart-select-option-name';
            const meta = getMeta ? getMeta(opt.value, opt) : null;
            const fullLabel = opt.textContent.trim();
            if (meta && meta.featured) {
                // Modèle mis en avant : le nom en gras, la tagline (après « - ») en clair.
                const [nm, ...rest] = fullLabel.split(' - ');
                name.innerHTML = `<strong>${esc(nm)}</strong>${rest.length ? ' - ' + esc(rest.join(' - ')) : ''}`;
            } else {
                name.textContent = fullLabel;
            }
            row.appendChild(name);
            // Les pastilles s'empilent dans une colonne calée à droite : le
            // tarif d'abord, la vision juste en dessous.
            if (meta && (meta.badge || meta.visionBadge)) {
                const badges = document.createElement('div');
                badges.className = 'vart-select-option-badges';
                if (meta.badge) {
                    const badge = document.createElement('span');
                    badge.className = 'vart-select-option-badge';
                    badge.textContent = meta.badge;
                    badges.appendChild(badge);
                }
                if (meta.visionBadge) {
                    const wrap = document.createElement('span');
                    wrap.innerHTML = meta.visionBadge;
                    badges.appendChild(wrap.firstElementChild);
                }
                row.appendChild(badges);
            }
            item.appendChild(row);
            if (meta && meta.hint) {
                const hint = document.createElement('div');
                hint.className = 'vart-select-option-hint';
                hint.textContent = meta.hint;
                item.appendChild(hint);
            }

            if (opt.disabled) item.classList.add('is-disabled');
            item.addEventListener('click', () => {
                if (opt.disabled) return;
                select.value = opt.value;
                select.dispatchEvent(new Event('change', { bubbles: true }));
                syncTrigger();
                syncSelected();
                close();
            });
            return item;
        }

        // Onglet actif (libellé d'<optgroup>) quand le select a ≥ 2 groupes ;
        // renderList() re-remplit la liste avec les options de cet onglet.
        let activeGroup = '';
        let renderList = () => {};

        function groupOfValue(value) {
            const og = Array.from(select.querySelectorAll('optgroup'))
                .find(g => Array.from(g.children).some(o => o.value === value));
            return og ? og.label : '';
        }

        function rebuildPanel() {
            panel.innerHTML = '';
            const children = Array.from(select.children);
            const groups = children.filter(c => c.tagName === 'OPTGROUP');
            const loose  = children.filter(c => c.tagName === 'OPTION');
            const list = document.createElement('div');
            list.className = 'vart-select-list';

            if (groups.length >= 2) {
                // Onglets par fournisseur (OpenAI / Gemini / Grok). Les options
                // hors groupe (ex. « Utiliser le modèle par défaut ») restent
                // toujours visibles, au-dessus des onglets.
                if (!groups.some(g => g.label === activeGroup)) {
                    activeGroup = groupOfValue(select.value) || groups[0].label;
                }
                const head = document.createElement('div');
                head.className = 'vart-select-head';
                loose.forEach(opt => head.appendChild(makeOption(opt)));
                renderList = () => {
                    list.innerHTML = '';
                    const g = groups.find(x => x.label === activeGroup) || groups[0];
                    Array.from(g.children).forEach(opt => list.appendChild(makeOption(opt)));
                    syncSelected();
                };
                head.appendChild(buildSegmented(
                    groups.map(g => ({ key: g.label, label: g.label })),
                    activeGroup,
                    (key) => { activeGroup = key; renderList(); },
                    { compact: true }
                ));
                panel.append(head, list);
                renderList();
            } else {
                renderList = () => {};
                children.forEach(child => {
                    if (child.tagName === 'OPTGROUP') {
                        const g = document.createElement('div');
                        g.className = 'vart-select-group';
                        g.textContent = child.label;
                        list.appendChild(g);
                        Array.from(child.children).forEach(opt => list.appendChild(makeOption(opt)));
                    } else if (child.tagName === 'OPTION') {
                        list.appendChild(makeOption(child));
                    }
                });
                panel.appendChild(list);
            }
        }

        function syncTrigger() {
            const selected = select.options[select.selectedIndex];
            triggerLabel.textContent = selected ? selected.textContent.trim() : '-';
        }
        function syncSelected() {
            panel.querySelectorAll('.vart-select-option').forEach(o => {
                o.classList.toggle('is-selected', o.dataset.value === select.value);
            });
        }
        function open() {
            document.querySelectorAll('.vart-select.open').forEach(w => w !== wrap && w.classList.remove('open'));
            wrap.classList.add('open');
            // Ouvrir sur l'onglet du modèle sélectionné (s'il est dans un groupe)
            const g = groupOfValue(select.value);
            if (g && g !== activeGroup) {
                activeGroup = g;
                const seg = panel.querySelector('.segmented');
                if (seg) setSegmentedActive(seg, g);
                renderList();
            }
            syncSelected();
            // Amener l'option sélectionnée dans la vue
            const sel = panel.querySelector('.vart-select-option.is-selected');
            if (sel) sel.scrollIntoView({ block: 'nearest' });
        }
        function close() { wrap.classList.remove('open'); }

        trigger.addEventListener('click', (e) => {
            e.stopPropagation();
            if (wrap.classList.contains('open')) close(); else open();
        });
        // Le code externe peut dispatcher 'change' après un `.value = X` pour
        // resynchroniser l'affichage.
        select.addEventListener('change', () => { syncTrigger(); syncSelected(); });

        // Rebuild automatique quand la liste d'options est remplacée
        // dynamiquement (cf. `updatePersonaVoiceList` qui reconstruit
        // `pVoice`) OU quand l'attribut `disabled` d'une option change
        // (cf. `updateModelSelectDisabled` qui grise les modèles sans clé API).
        new MutationObserver(() => { rebuildPanel(); syncTrigger(); syncSelected(); })
            .observe(select, { childList: true, subtree: true, attributes: true, attributeFilter: ['disabled'] });

        rebuildPanel();
        syncTrigger();
        syncSelected();
    }

    // Fermeture au clic à l'extérieur
    document.addEventListener('click', (e) => {
        document.querySelectorAll('.vart-select.open').forEach(w => {
            if (!w.contains(e.target)) w.classList.remove('open');
        });
    });
    // Fermeture à la touche Échap (utile quand le focus est ailleurs)
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            document.querySelectorAll('.vart-select.open').forEach(w => w.classList.remove('open'));
        }
    });

    const personaModal = document.getElementById('personaModal');
    let tempImage = null;

    // Applique le custom select aux <select> de la modale persona. Fait une
    // seule fois au boot ; le composant se resynchronise ensuite tout seul.
    enhanceSelectAsCustom(document.getElementById('pModel'), {
        getMeta: (value) => {
            if (!value) return { hint: 'Utilise le modèle configuré globalement.' };
            const badge = formatModelPricingBadge(value);
            const descriptions = {
                'gpt-live-1':              'Nouveau : écoute et parle en même temps (full duplex), voix dédiées. Minute vocale + tokens du modèle de raisonnement gpt-5.6-luna (très économique). Réactivité et créativité sans effet.',
                'gpt-realtime-2.1':        'Le modèle Realtime le plus intelligent et le plus expressif.',
                'gpt-realtime-2.1-mini':   'Plus léger, réponses rapides, tarif divisé par ~3.',
                'gpt-realtime-2':          'Génération précédente, toujours excellente, tarif identique au 2.1.',
                'gemini-3.8-live':         'Nouveau modèle Google : dialogue fluide, 97 langues, très économique.',
                'gemini-3.8-live-extended-thinking': 'Comme 3.8 Live, avec un raisonnement approfondi pour les tâches complexes, même tarif.',
                'gemini-3.1-flash-live-preview': 'Génération précédente, Google recommande de passer à 3.8 Live.',
                'grok-voice-think-fast-2.0': 'Grok Voice de xAI, speech-to-speech très réactif, facturé à la minute.'
            };
            return { badge, hint: descriptions[value] || '', featured: FEATURED_MODELS.has(value), visionBadge: visionBadgeHtml(value) };
        }
    });
    enhanceSelectAsCustom(document.getElementById('pVoice'));
    enhanceSelectAsCustom(document.getElementById('pReactivity'));
    enhanceSelectAsCustom(document.getElementById('pCreativity'));
    enhanceSelectAsCustom(document.getElementById('pGreeting'));

    // Résout le modèle effectif d'un persona (son modèle propre ou le modèle par défaut)
    function getEffectiveModel(persona) {
        return (persona && persona.model) || getRealtimeModel();
    }

    // Peuple le select des voix selon le fournisseur du modèle sélectionné
    function updatePersonaVoiceList(keepValue) {
        const modelSelect = document.getElementById('pModel');
        const voiceSelect = document.getElementById('pVoice');
        const effectiveModel = modelSelect.value || getRealtimeModel();
        // Famille de voix (openai | live | gemini | xai) : GPT Live a ses voix propres
        const family = getVoiceFamilyForModel(effectiveModel);
        const voices = VOICES[family] || VOICES.openai;
        voiceSelect.innerHTML = voices.map(v =>
            `<option value="${v.value}">${v.label}</option>`
        ).join('');
        // Restaurer la voix si elle existe dans la nouvelle liste
        if (keepValue && voices.some(v => v.value === keepValue)) {
            voiceSelect.value = keepValue;
        } else {
            voiceSelect.value = voices[0].value;
        }
    }

    // ── Sas micro : on demande la permission AVANT d'afficher la page de conversation.
    // Si la permission est déjà accordée (au sein de cette session, ou via l'API
    // Permissions du navigateur), on saute le sas. Sinon on l'affiche par-dessus
    // la zone de conversation et on attend que l'utilisateur clique pour déclencher
    // le prompt natif du navigateur. ──
