    const apiKeyModal = document.getElementById('apiKeyModal');
    const apiKeyInput = document.getElementById('apiKeyInput');
    const geminiApiKeyInput = document.getElementById('geminiApiKeyInput');
    const xaiApiKeyInput = document.getElementById('xaiApiKeyInput');

    function updateModelSelectDisabled(selectEl) {
        const isConfigSelect = !selectEl;
        if (!selectEl) selectEl = document.getElementById('realtimeModelSelect');
        const hasOpenAI = isConfigSelect
            ? !!(apiKeyInput ? apiKeyInput.value.trim() : getApiKey())
            : !!getApiKey();
        const hasGemini = isConfigSelect
            ? !!(geminiApiKeyInput ? geminiApiKeyInput.value.trim() : getGeminiApiKey())
            : !!getGeminiApiKey();
        const hasXai = isConfigSelect
            ? !!(xaiApiKeyInput ? xaiApiKeyInput.value.trim() : getXaiApiKey())
            : !!getXaiApiKey();
        selectEl.querySelectorAll('option').forEach(opt => {
            const provider = getProviderForModel(opt.value);
            opt.disabled = (provider === 'openai' && !hasOpenAI)
                        || (provider === 'gemini' && !hasGemini)
                        || (provider === 'xai'    && !hasXai);
        });
        // Si on rafraîchit le <select> de la config, on rebuild le menu custom
        if (isConfigSelect && document.getElementById('modelPickerMenu')) {
            buildModelPickerMenu();
        }
    }

    // Texte court formaté du coût d'un modèle (utilisé dans le sélecteur custom)
    function formatModelCost(modelId) {
        const p = PRICING[modelId];
        if (!p) return '';
        if (p.perMinute != null) {
            // GPT Live : minute vocale + tokens du modèle de raisonnement backend
            const backend = p.backendModel ? ` + tokens ${p.backendModel}` : '';
            return `${fmtUsd(p.perMinute)} / minute${backend}`;
        }
        return fmtTokenRate(p);
    }

    // Pastille « vision », de la même famille que la pastille de tarif et
    // posée juste en dessous : icône de modalité + surcoût. Chaîne vide pour
    // les modèles qui ne voient pas — l'absence de pastille EST l'information.
    function visionBadgeHtml(modelId) {
        const v = visionCostInfo(modelId);
        if (!v) return '';
        return `<span class="vision-badge" title="${esc(v.label)}">`
             + `<span class="vision-badge-icon" role="img" aria-label="${esc(v.label)}">${v.icon}</span>`
             + `${esc(v.badge)}</span>`;
    }

    function updateModelPricingInfo() {
        const sel = document.getElementById('realtimeModelSelect');
        const model = sel.value;
        const opt = sel.querySelector(`option[value="${CSS.escape(model)}"]`);
        const name = opt ? (opt.textContent.split(' - ')[0]) : model;
        const cost = formatModelCost(model) || formatModelCost('gpt-realtime-2.1-mini');
        const nameEl = document.getElementById('modelPickerName');
        const costEl = document.getElementById('modelPickerCost');
        if (nameEl) nameEl.textContent = name;
        if (costEl) costEl.textContent = cost;
        // Pastille vision, juste sous le tarif, si le modèle voit.
        const visionEl = document.getElementById('modelPickerVision');
        if (visionEl) {
            const html = visionBadgeHtml(model);
            visionEl.innerHTML = html;
            visionEl.style.display = html ? '' : 'none';
        }
        // Mettre à jour la sélection visible dans le menu
        document.querySelectorAll('.model-picker-option').forEach(o => {
            o.classList.toggle('selected', o.dataset.value === model);
        });
    }

    // Construit le menu custom à partir des optgroup/option du <select> caché
    function buildModelPickerMenu() {
        const sel = document.getElementById('realtimeModelSelect');
        const menu = document.getElementById('modelPickerMenu');
        if (!sel || !menu) return;
        menu.innerHTML = '';
        Array.from(sel.children).forEach(child => {
            if (child.tagName === 'OPTGROUP') {
                const label = document.createElement('div');
                label.className = 'model-picker-group';
                label.textContent = child.label;
                menu.appendChild(label);
                Array.from(child.children).forEach(opt => menu.appendChild(buildModelPickerOption(opt)));
            } else if (child.tagName === 'OPTION') {
                menu.appendChild(buildModelPickerOption(child));
            }
        });
    }
    function buildModelPickerOption(opt) {
        const el = document.createElement('div');
        el.className = 'model-picker-option';
        el.dataset.value = opt.value;
        if (opt.disabled) el.classList.add('disabled');
        if (FEATURED_MODELS.has(opt.value)) el.classList.add('is-featured');
        const fullLabel = opt.textContent.trim();
        const name = fullLabel.split(' - ')[0];
        const tagline = fullLabel.includes(' - ') ? fullLabel.split(' - ').slice(1).join(' - ') : '';
        el.innerHTML = `
            <div class="model-picker-option-name">${esc(name)}${tagline ? ` <span style="font-weight:400;color:var(--text-secondary);font-size:0.85em">- ${esc(tagline)}</span>` : ''}</div>
            <div class="model-picker-option-cost">${esc(formatModelCost(opt.value) || 'Tarification non spécifiée')}</div>
            ${(v => v ? `<div class="model-picker-option-vision">${v}</div>` : '')(visionBadgeHtml(opt.value))}
        `;
        el.addEventListener('click', () => {
            if (el.classList.contains('disabled')) return;
            const sel = document.getElementById('realtimeModelSelect');
            sel.value = opt.value;
            sel.dispatchEvent(new Event('change'));
            document.getElementById('modelPicker').classList.remove('open');
            document.getElementById('modelPickerTrigger').setAttribute('aria-expanded', 'false');
        });
        return el;
    }

    function updateBudgetStatus() {
        const el = document.getElementById('budgetStatus');
        const limit = getBudgetLimit();
        if (!limit) { el.innerHTML = ''; return; }
        const spent = getMonthCost();
        const pct = Math.min((spent / limit) * 100, 100);
        const color = pct >= 90 ? 'var(--danger)' : pct >= 70 ? 'var(--accent2)' : 'var(--success)';
        el.innerHTML = `
            <div style="font-size:0.8rem;color:var(--text-secondary);margin-top:4px">Ce mois : <strong>${fmtAmount(spent)}</strong> / ${fmtAmount(limit)} (${pct.toFixed(1)}%)</div>
            <div class="budget-bar"><div class="budget-bar-fill" style="width:${pct}%;background:${color}"></div></div>`;
    }

    async function checkApiKey(key) {
        const statusEl = document.getElementById('apiKeyStatus');
        if (!key) { statusEl.innerHTML = ''; return false; }
        statusEl.innerHTML = `<span class="api-key-status checking">${ICON_SVG.hourglass} Vérification...</span>`;
        try {
            const res = await fetch('https://api.openai.com/v1/models', {
                headers: { 'Authorization': `Bearer ${key}` }
            });
            if (res.ok) {
                statusEl.innerHTML = `<span class="api-key-status valid">${ICON_SVG.check} Clé valide</span>`;
                return true;
            } else {
                statusEl.innerHTML = `<span class="api-key-status invalid">${ICON_SVG.x} Clé invalide ou expirée</span>`;
                return false;
            }
        } catch {
            statusEl.innerHTML = `<span class="api-key-status invalid">${ICON_SVG.x} Erreur de connexion</span>`;
            return false;
        }
    }

    async function checkGeminiApiKey(key) {
        const statusEl = document.getElementById('geminiApiKeyStatus');
        if (!key) { statusEl.innerHTML = ''; return false; }
        statusEl.innerHTML = `<span class="api-key-status checking">${ICON_SVG.hourglass} Vérification...</span>`;
        try {
            const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}`);
            if (res.ok) {
                statusEl.innerHTML = `<span class="api-key-status valid">${ICON_SVG.check} Clé valide</span>`;
                return true;
            } else {
                statusEl.innerHTML = `<span class="api-key-status invalid">${ICON_SVG.x} Clé invalide</span>`;
                return false;
            }
        } catch {
            statusEl.innerHTML = `<span class="api-key-status invalid">${ICON_SVG.x} Erreur de connexion</span>`;
            return false;
        }
    }

    async function checkXaiApiKey(key) {
        const statusEl = document.getElementById('xaiApiKeyStatus');
        if (!key) { statusEl.innerHTML = ''; return false; }
        statusEl.innerHTML = `<span class="api-key-status checking">${ICON_SVG.hourglass} Vérification...</span>`;
        try {
            const res = await fetch('https://api.x.ai/v1/models', {
                headers: { 'Authorization': `Bearer ${key}` }
            });
            if (res.ok) {
                statusEl.innerHTML = `<span class="api-key-status valid">${ICON_SVG.check} Clé valide</span>`;
                return true;
            } else {
                statusEl.innerHTML = `<span class="api-key-status invalid">${ICON_SVG.x} Clé invalide ou expirée</span>`;
                return false;
            }
        } catch {
            statusEl.innerHTML = `<span class="api-key-status invalid">${ICON_SVG.x} Erreur de connexion</span>`;
            return false;
        }
    }

    function hasAnyApiKey() { return !!(getApiKey() || getGeminiApiKey() || getXaiApiKey()); }

    // Bindings storage pour chaque type de picker texte (identifiés par
    // l'attribut data-text-picker sur .model-picker).
    const TEXT_PICKER_STORAGE = {
        analysis: { get: getAnalysisModel, set: setAnalysisModel },
        title:    { get: getTitleModel,    set: setTitleModel }
    };

    // Groupes de modèles à afficher pour un picker donné (par provider).
    function pickerGroups(kind) {
        return TEXT_MODEL_GROUPS.map(g => ({ key: g.key, label: g.label, models: TEXT_MODELS[g.key] || [] }));
    }

    // Ordre d'affichage des groupes dans les pickers texte.
    // Sert aussi de source unique pour la recherche « à quel provider
    // appartient ce modèle ? » via findTextModel().
    const TEXT_MODEL_GROUPS = [
        { key: 'openai', label: 'OpenAI' },
        { key: 'gemini', label: 'Gemini' }
    ];

    // Trouve la définition d'un modèle texte (label + cost) quel que soit
    // son provider. Renvoie null si l'id n'est pas dans le catalogue.
    function findTextModel(id) {
        for (const g of TEXT_MODEL_GROUPS) {
            const m = (TEXT_MODELS[g.key] || []).find(x => x.id === id);
            if (m) return m;
        }
        return null;
    }

    // Détecte si le provider (openai | gemini) a une clé API disponible.
    // Comme pour le sélecteur vocal, on lit la valeur COURANTE des inputs
    // du modal (ils reflètent l'état non-sauvegardé) si dispo, sinon la
    // clé stockée dans localStorage.
    function hasProviderKey(providerKey) {
        if (providerKey === 'openai') {
            return !!(apiKeyInput ? apiKeyInput.value.trim() : getApiKey());
        }
        if (providerKey === 'gemini') {
            return !!(geminiApiKeyInput ? geminiApiKeyInput.value.trim() : getGeminiApiKey());
        }
        return false;
    }

    // (Re)construit le menu d'un picker texte avec un groupe par provider,
    // marque l'option courante comme sélectionnée, grise les modèles dont
    // le provider n'a pas de clé API, et attache les listeners de clic.
    // Idempotent : peut être rappelé à chaque ouverture/modification de clé.
    function buildTextModelPickerMenu(picker) {
        const menu = picker.querySelector('.model-picker-menu');
        const storage = TEXT_PICKER_STORAGE[picker.dataset.textPicker];
        if (!menu || !storage) return;
        const current = storage.get();
        menu.innerHTML = '';
        pickerGroups(picker.dataset.textPicker).forEach(group => {
            const models = group.models;
            if (!models.length) return;
            const providerHasKey = hasProviderKey(group.key);
            const header = document.createElement('div');
            header.className = 'model-picker-group';
            header.textContent = group.label;
            menu.appendChild(header);
            models.forEach(m => {
                const el = document.createElement('div');
                el.className = 'model-picker-option';
                if (m.id === current) el.classList.add('selected');
                if (!providerHasKey) el.classList.add('disabled');
                el.dataset.value = m.id;
                // Même style que « Modèle par défaut » : nom en gras + tagline
                // « — … » en gris discret et plus petit.
                const nm = m.label.split(' - ')[0];
                const tagline = m.label.includes(' - ') ? m.label.split(' - ').slice(1).join(' - ') : '';
                el.innerHTML = `
                    <div class="model-picker-option-name">${esc(nm)}${tagline ? ` <span style="font-weight:400;color:var(--text-secondary);font-size:0.85em">- ${esc(tagline)}</span>` : ''}</div>
                    <div class="model-picker-option-cost">${esc(m.cost)}</div>
                `;
                el.addEventListener('click', () => {
                    // Ignore les clics sur les options grisées (provider sans clé).
                    if (el.classList.contains('disabled')) return;
                    storage.set(m.id);
                    syncTextModelPicker(picker);
                    closeAllModelPickers();
                });
                menu.appendChild(el);
            });
        });
    }

    // Met à jour le libellé du trigger (nom + coût) + la classe .selected
    // sur les options du menu, en fonction de la valeur actuelle en storage.
    function syncTextModelPicker(picker) {
        const storage = TEXT_PICKER_STORAGE[picker.dataset.textPicker];
        if (!storage) return;
        const current = storage.get();
        const model = findTextModel(current);
        // Trigger : seulement le nom (le tagline « — … » reste dans le menu),
        // comme le picker « Modèle par défaut ».
        picker.querySelector('.model-picker-name').textContent = model ? model.label.split(' - ')[0] : current;
        picker.querySelector('.model-picker-cost').textContent = model ? model.cost : (formatModelCost(current) || '-');
        picker.querySelectorAll('.model-picker-option').forEach(o => {
            o.classList.toggle('selected', o.dataset.value === current);
        });
    }

    // Rebuild + sync tous les pickers texte. Appelé à l'ouverture de la modale.
    function syncTextModelPickers() {
        document.querySelectorAll('.model-picker[data-text-picker]').forEach(picker => {
            buildTextModelPickerMenu(picker);
            syncTextModelPicker(picker);
        });
    }

    // Legacy no-op : les anciens dropdowns sont remplacés par la page push
    // (openPushPagePicker). Conservé au cas où d'autres endroits l'appellent.
    function closeAllModelPickers() { /* no-op */ }


    // Ouvre la page push et la peuple selon le trigger cliqué.
    // Le picker source (`.model-picker`) identifie la source :
    //   - #modelPicker              → modèle vocal par défaut
    //   - [data-text-picker=...]    → modèles texte (analyse / titre)
    function openPushPagePicker(picker) {
        const modal = picker.closest('.modal');
        if (!modal) return;
        const list  = document.getElementById('modalPageList');
        const title = document.getElementById('modalPageTitle');
        const tabs  = document.getElementById('modalPageTabs');
        list.innerHTML = '';
        tabs.innerHTML = '';

        let onSelect = () => {};
        // Un onglet par fournisseur : `groups` = [{ key, label, render,
        // hasCurrent }], où render() remplit la liste avec les modèles du
        // fournisseur. Seul le fournisseur actif est affiché (la liste
        // s'allonge…) ; on ouvre sur celui du modèle actuellement choisi.
        let groups = [];

        if (picker.id === 'modelPicker') {
            title.textContent = 'Modèle par défaut';
            const sel = document.getElementById('realtimeModelSelect');
            const current = sel.value;
            groups = Array.from(sel.querySelectorAll('optgroup')).map(og => ({
                key: og.label,
                label: og.label,
                render: () => Array.from(og.children).forEach(opt => list.appendChild(buildPushOptionForVoice(opt, current))),
                hasCurrent: Array.from(og.children).some(opt => opt.value === current)
            }));
            onSelect = (id) => {
                sel.value = id;
                sel.dispatchEvent(new Event('change'));
            };
        } else if (picker.dataset.textPicker) {
            const kind = picker.dataset.textPicker;
            title.textContent = kind === 'analysis' ? "Analyse des conversations"
                : "Génération du nom de conversation";
            const storage = TEXT_PICKER_STORAGE[kind];
            const current = storage.get();
            groups = pickerGroups(kind).filter(g => g.models.length).map(g => ({
                key: g.key,
                label: g.label,
                render: () => {
                    const providerHasKey = hasProviderKey(g.key);
                    g.models.forEach(m => list.appendChild(buildPushOptionForText(m, current, providerHasKey)));
                },
                hasCurrent: g.models.some(m => m.id === current)
            }));
            onSelect = (id) => {
                storage.set(id);
                syncTextModelPicker(picker);
            };
        }

        const showGroup = (key) => {
            const group = groups.find(g => g.key === key) || groups[0];
            list.innerHTML = '';
            if (group) group.render();
            // Sélectionner un modèle sauve la valeur et revient à la page
            // config (slide back).
            list.querySelectorAll('.model-picker-option').forEach(el => {
                el.addEventListener('click', () => {
                    if (el.classList.contains('disabled')) return;
                    onSelect(el.dataset.value);
                    closePushPagePicker();
                });
            });
            hydrateIcons(list);
        };
        const activeKey = (groups.find(g => g.hasCurrent) || groups[0] || {}).key || '';
        if (groups.length > 1) {
            tabs.appendChild(buildSegmented(groups.map(g => ({ key: g.key, label: g.label })), activeKey, showGroup));
        }
        showGroup(activeKey);

        modal.classList.add('picker-open');
        document.getElementById('modalPagePicker').setAttribute('aria-hidden', 'false');
    }

    function closePushPagePicker() {
        const modal = document.querySelector('.modal.picker-open');
        if (!modal) return;
        modal.classList.remove('picker-open');
        document.getElementById('modalPagePicker').setAttribute('aria-hidden', 'true');
    }

    function buildPushOptionForVoice(opt, currentValue) {
        const el = document.createElement('div');
        el.className = 'model-picker-option';
        if (opt.value === currentValue) el.classList.add('selected');
        if (opt.disabled) el.classList.add('disabled');
        if (FEATURED_MODELS.has(opt.value)) el.classList.add('is-featured'); // nouveautés + Grok en gras
        el.dataset.value = opt.value;
        const fullLabel = opt.textContent.trim();
        const name = fullLabel.split(' - ')[0];
        const tagline = fullLabel.includes(' - ') ? fullLabel.split(' - ').slice(1).join(' - ') : '';
        el.innerHTML = `
            <div class="model-picker-option-name">${esc(name)}${tagline ? ` <span style="font-weight:400;color:var(--text-secondary);font-size:0.85em">- ${esc(tagline)}</span>` : ''}</div>
            <div class="model-picker-option-cost">${esc(formatModelCost(opt.value) || 'Tarification non spécifiée')}</div>
            ${(v => v ? `<div class="model-picker-option-vision">${v}</div>` : '')(visionBadgeHtml(opt.value))}
        `;
        return el;
    }

    function buildPushOptionForText(m, currentValue, providerHasKey) {
        const el = document.createElement('div');
        el.className = 'model-picker-option';
        if (m.id === currentValue) el.classList.add('selected');
        if (!providerHasKey) el.classList.add('disabled');
        el.dataset.value = m.id;
        // Même présentation que la page « Modèle par défaut » : à partir du tiret
        // cadratin, le tagline passe en gris léger et plus petit (pas en gras).
        const name = m.label.split(' - ')[0];
        const tagline = m.label.includes(' - ') ? m.label.split(' - ').slice(1).join(' - ') : '';
        el.innerHTML = `
            <div class="model-picker-option-name">${esc(name)}${tagline ? ` <span style="font-weight:400;color:var(--text-secondary);font-size:0.85em">- ${esc(tagline)}</span>` : ''}</div>
            <div class="model-picker-option-cost">${esc(m.cost)}</div>
        `;
        return el;
    }

    // opts.tab : force un onglet (ex. 'api'). opts.provider : 'openai' | 'gemini'
    // pour positionner le sous-onglet des clés (utile quand on démarre une
    // discussion et qu'il manque LA clé d'un provider précis).
    function openApiKeyModal(opts = {}) {
        if (opts instanceof Event) opts = {}; // appelé directement comme handler de clic
        // S'assure qu'on ouvre TOUJOURS sur la page config principale,
        // jamais sur une page push oubliée d'une session précédente.
        closePushPagePicker();
        apiKeyInput.value = getApiKey();
        geminiApiKeyInput.value = getGeminiApiKey();
        xaiApiKeyInput.value = getXaiApiKey();
        document.getElementById('realtimeModelSelect').value = getRealtimeModel();
        updateModelSelectDisabled();
        syncTextModelPickers();
        const limit = getBudgetLimit();
        document.getElementById('budgetLimitInput').value = limit !== null ? limit : '';
        document.getElementById('confirmCostActionsInput').checked = getConfirmCostActions();
        document.getElementById('reviewNotifInput').checked = getReviewNotif();
        refreshObsidianPanel(); // Phase 3 : état du vault connecté
        updateModelPricingInfo();
        updateBudgetStatus();
        document.getElementById('apiKeyStatus').innerHTML = '';
        document.getElementById('geminiApiKeyStatus').innerHTML = '';
        document.getElementById('xaiApiKeyStatus').innerHTML = '';
        // Onglet par défaut : « Mes infos » (placé en premier). Exception : si
        // aucune clé n'est encore configurée, on force « Clé API » pour la saisir.
        document.getElementById('myInfoInput').value = getUserInfo();
        document.querySelectorAll('.config-nav-item').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.config-panel').forEach(p => p.classList.remove('active'));
        const defaultTab = opts.tab || (hasAnyApiKey() ? 'myinfo' : 'api');
        document.querySelector(`[data-config-tab="${defaultTab}"]`).classList.add('active');
        document.getElementById(configTabMap[defaultTab]).classList.add('active');
        // Repositionner le contrôle segmenté sur le provider demandé (OpenAI par défaut)
        const provider = (opts.provider === 'gemini' || opts.provider === 'xai') ? opts.provider : 'openai';
        const seg = document.querySelector('#configPanelApi .segmented');
        if (seg) {
            setSegmentedActive(seg, provider);
            document.querySelectorAll('#configPanelApi .api-tab-panel').forEach(p => {
                p.classList.toggle('active', p.dataset.apiPanel === provider);
            });
        }
        const isRequired = !hasAnyApiKey();
        document.getElementById('apiKeyRequired').style.display = isRequired ? 'block' : 'none';
        document.getElementById('closeApiKeyBtn').style.display = isRequired ? 'none' : 'block';
        apiKeyModal.classList.add('active');
        configOpenSignature = configFieldsSignature();
    }

    // Signature des champs de Configuration persistés par « Sauvegarder »
    // (clés API, modèle vocal, budget, Mes infos). Les réglages qui se
    // sauvegardent en direct (thème, disposition) n'en font pas partie : ils
    // sont déjà appliqués, donc pas « en attente ».
    let configOpenSignature = '';
    function configFieldsSignature() {
        return [
            apiKeyInput.value,
            geminiApiKeyInput.value,
            xaiApiKeyInput.value,
            document.getElementById('realtimeModelSelect').value,
            document.getElementById('budgetLimitInput').value,
            document.getElementById('confirmCostActionsInput').checked,
            document.getElementById('reviewNotifInput').checked,
            document.getElementById('myInfoInput').value
        ].join('\x1f');
    }

    function closeApiKeyModal() {
        if (!hasAnyApiKey()) return;
        closePushPagePicker(); // ne pas laisser une page « push » ouverte en état résiduel
        apiKeyModal.classList.remove('active');
    }

    // Fermeture demandée (croix) : si des champs ont changé sans sauvegarde,
    // on propose Sauvegarder / Quitter sans sauvegarder / Continuer.
    async function requestCloseApiKeyModal() {
        if (!hasAnyApiKey()) return; // clé requise → fermeture bloquée de toute façon
        if (configFieldsSignature() !== configOpenSignature) {
            const choice = await confirmUnsavedChanges();
            if (choice === 'cancel') return;
            if (choice === 'save') { document.getElementById('saveApiKeyBtn').click(); return; }
            // 'discard' → on ferme sans sauvegarder
        }
        closeApiKeyModal();
    }

    document.getElementById('apiConfigBtn').addEventListener('click', openApiKeyModal);
    document.getElementById('closeApiKeyBtn').addEventListener('click', requestCloseApiKeyModal);
    document.getElementById('realtimeModelSelect').addEventListener('change', updateModelPricingInfo);
    // Sélecteur custom du modèle vocal : construction du menu.
    // Les pickers texte (analyse + titre) sont construits à l'ouverture de la
    // modale via syncTextModelPickers().
    buildModelPickerMenu();

    // Toggle du trigger — délégué pour couvrir : le picker vocal (#modelPicker)
    // ET les pickers texte (.model-picker[data-text-picker]). On ferme les
    // autres pickers pour ne pas superposer deux menus ouverts.
    document.addEventListener('click', (e) => {
        // Bouton retour de la page push → ferme la page (revient au config).
        if (e.target.closest('#modalPageBack')) {
            e.stopPropagation();
            closePushPagePicker();
            return;
        }
        // Trigger d'un picker → ouvre la page push avec la bonne liste.
        const trigger = e.target.closest('.model-picker-trigger');
        if (trigger) {
            e.stopPropagation();
            const picker = trigger.closest('.model-picker');
            openPushPagePicker(picker);
            return;
        }
    });
    document.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape') return;
        // Prioritaire sur la fermeture du modal : si une page push est ouverte,
        // ESC revient à la page config au lieu de fermer tout.
        if (document.querySelector('.modal.picker-open')) {
            e.stopPropagation();
            closePushPagePicker();
            return;
        }
    });
    // Mettre à jour le grisage des modèles quand on tape une clé
    apiKeyInput.addEventListener('input', () => {
        updateModelSelectDisabled();
        syncTextModelPickers();
    });
    geminiApiKeyInput.addEventListener('input', () => {
        updateModelSelectDisabled();
        syncTextModelPickers();
    });

    // Navigation onglets config
    const configTabMap = { api: 'configPanelApi', model: 'configPanelModel', budget: 'configPanelBudget', share: 'configPanelShare', myinfo: 'configPanelMyInfo', stats: 'configPanelStats', display: 'configPanelDisplay', obsidian: 'configPanelObsidian' };

    document.querySelector('.config-nav').addEventListener('click', (e) => {
        const btn = e.target.closest('[data-config-tab]');
        if (!btn) return;
        document.querySelectorAll('.config-nav-item').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.config-panel').forEach(p => p.classList.remove('active'));
        btn.classList.add('active');
        const tab = btn.dataset.configTab;
        document.getElementById(configTabMap[tab]).classList.add('active');
        // Lazy load des panneaux qui ont besoin de données fraîches
        if (tab === 'myinfo') {
            document.getElementById('myInfoInput').value = getUserInfo();
        } else if (tab === 'stats') {
            renderStats('periods');
            document.querySelectorAll('#statsTabBtns button').forEach(b => b.classList.toggle('active', b.dataset.statsTab === 'periods'));
        } else if (tab === 'display') {
            // Resynchronise l'état actif des cartes (thème/disposition).
            applyTheme(getTheme());
            applyConversationLayout(getConversationLayout());
        }
    });

    // Onglet Affichage : cartes thème + disposition.
    document.getElementById('configPanelDisplay').addEventListener('click', (e) => {
        const themeCard = e.target.closest('[data-theme-choice]');
        if (themeCard) { applyTheme(themeCard.dataset.themeChoice); return; }
        const layoutCard = e.target.closest('[data-layout-choice]');
        if (layoutCard) { setConversationLayout(layoutCard.dataset.layoutChoice); applyConversationLayout(layoutCard.dataset.layoutChoice); }
    });

    // Rappels de révision (Phase 4) : cocher la case demande la permission
    // Notification dans le geste utilisateur (exigé par les navigateurs).
    // Refus ou absence d'API → on décoche visuellement, rien n'est cassé.
    document.getElementById('reviewNotifInput').addEventListener('change', async (e) => {
        if (!e.target.checked) return;
        if (!('Notification' in window)) {
            e.target.checked = false;
            customAlert('Ce navigateur ne supporte pas les notifications. Les pastilles 🔁 sur les cartes restent disponibles.', { title: 'Notifications', icon: 'message' });
            return;
        }
        if (Notification.permission === 'default') {
            const perm = await Notification.requestPermission().catch(() => 'denied');
            if (perm !== 'granted') {
                e.target.checked = false;
                customAlert('Notifications refusées. Les pastilles 🔁 sur les cartes restent visibles quelle que soit cette option.', { title: 'Notifications', icon: 'message' });
            }
        } else if (Notification.permission === 'denied') {
            e.target.checked = false;
            customAlert('Les notifications sont bloquées pour ce site dans les réglages du navigateur.', { title: 'Notifications', icon: 'message' });
        }
    });

    // ── Contrôle segmenté (onglets) ──
    // Positionne un .segmented sur l'onglet `key` : classe active,
    // aria-selected, et variables CSS --seg-count / --seg-index qui pilotent
    // la largeur et la translation du « pouce » (cf. CSS .segmented-thumb).
    // Renvoie la clé effectivement activée (la première si `key` est inconnue).
