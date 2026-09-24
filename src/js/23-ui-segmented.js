    function setSegmentedActive(seg, key) {
        const items = Array.from(seg.querySelectorAll('.segmented-item'));
        if (!items.length) return '';
        let index = items.findIndex(b => b.dataset.segTab === key);
        if (index < 0) index = 0;
        items.forEach((b, i) => {
            b.classList.toggle('active', i === index);
            b.setAttribute('aria-selected', i === index ? 'true' : 'false');
        });
        seg.dataset.active = items[index].dataset.segTab;
        seg.style.setProperty('--seg-count', items.length);
        seg.style.setProperty('--seg-index', index);
        return seg.dataset.active;
    }

    // Construit un .segmented à partir de `tabs` ([{ key, label }]) ;
    // `onChange(key)` est appelé à chaque clic sur un onglet. Sert aux
    // sélecteurs de modèle (onglets OpenAI / Gemini / Grok) de la config
    // et de la modale persona.
    function buildSegmented(tabs, activeKey, onChange, { compact = false, ariaLabel = 'Fournisseur' } = {}) {
        const seg = document.createElement('div');
        seg.className = 'segmented' + (compact ? ' segmented-compact' : '');
        seg.setAttribute('role', 'tablist');
        seg.setAttribute('aria-label', ariaLabel);
        tabs.forEach(t => {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'segmented-item';
            b.dataset.segTab = t.key;
            b.setAttribute('role', 'tab');
            b.textContent = t.label;
            seg.appendChild(b);
        });
        const thumb = document.createElement('span');
        thumb.className = 'segmented-thumb';
        thumb.setAttribute('aria-hidden', 'true');
        seg.appendChild(thumb);
        setSegmentedActive(seg, activeKey);
        seg.addEventListener('click', (e) => {
            const btn = e.target.closest('.segmented-item');
            if (!btn) return;
            onChange(setSegmentedActive(seg, btn.dataset.segTab));
        });
        return seg;
    }

    // Contrôle segmenté du panneau Clé API (OpenAI / Gemini / xAI)
    document.querySelectorAll('#configPanelApi .segmented').forEach(seg => {
        seg.addEventListener('click', (e) => {
            const btn = e.target.closest('[data-api-tab]');
            if (!btn) return;
            const tab = setSegmentedActive(seg, btn.dataset.apiTab);
            document.querySelectorAll('#configPanelApi .api-tab-panel').forEach(p => {
                p.classList.toggle('active', p.dataset.apiPanel === tab);
            });
        });
    });

    document.getElementById('saveApiKeyBtn').addEventListener('click', async () => {
        const openaiKey = apiKeyInput.value.trim();
        const geminiKey = geminiApiKeyInput.value.trim();
        const xaiKey = xaiApiKeyInput.value.trim();

        if (!openaiKey && !geminiKey && !xaiKey) {
            customAlert('Au moins une clé API (OpenAI, Gemini ou xAI) est requise pour utiliser Vart.', { title: 'Clé API requise', icon: 'key' });
            return;
        }

        // Vérifier la clé OpenAI si elle a changé
        if (openaiKey && openaiKey !== getApiKey()) {
            const valid = await checkApiKey(openaiKey);
            if (!valid) return;
        }

        // Vérifier la clé Gemini si elle a changé
        if (geminiKey && geminiKey !== getGeminiApiKey()) {
            const valid = await checkGeminiApiKey(geminiKey);
            if (!valid) return;
        }

        // Vérifier la clé xAI si elle a changé
        if (xaiKey && xaiKey !== getXaiApiKey()) {
            const valid = await checkXaiApiKey(xaiKey);
            if (!valid) return;
        }

        setApiKey(openaiKey);
        setGeminiApiKey(geminiKey);
        setXaiApiKey(xaiKey);
        setRealtimeModel(document.getElementById('realtimeModelSelect').value);
        const budgetNum = parseFloat(document.getElementById('budgetLimitInput').value);
        setBudgetLimit(!isNaN(budgetNum) && budgetNum > 0 ? budgetNum : null);
        // Confirmations préventives avant actions payantes (niveau 3, Phase 1).
        setConfirmCostActions(document.getElementById('confirmCostActionsInput').checked);
        // Rappels de révision (Phase 4).
        setReviewNotif(document.getElementById('reviewNotifInput').checked);
        // Persiste aussi l'onglet « Mes infos » (le bouton Sauvegarder global
        // gère désormais tous les onglets de Configuration).
        const myInfoEl = document.getElementById('myInfoInput');
        if (myInfoEl) setUserInfo(myInfoEl.value);
        document.getElementById('apiKeyRequired').style.display = 'none';
        document.getElementById('closeApiKeyBtn').style.display = 'block';
        closeApiKeyModal();
    });

    if (!hasAnyApiKey()) openApiKeyModal();

    // Phase 4 : rappel de révision au démarrage (différé pour ne pas
    // concurrencer l'initialisation ; 1 notification/jour max, si activé).
    setTimeout(() => maybeNotifyDueReviews().catch(() => {}), 4000);


    // "Mes infos" est maintenant un onglet dans la modale Configuration ; son
    // contenu est persisté par le bouton « Sauvegarder » global (cf. saveApiKeyBtn).


    // ── Custom select (utilisé pour les sélecteurs de la modale persona) ──
    // Le <select> natif reste dans le DOM et sert de source de vérité : tout
    // le code qui lit `.value` continue de marcher. On le rend juste
    // invisible et on affiche à sa place un bouton + un panel construits en
    // JS, capables d'afficher un badge (prix) et un sous-libellé par option.

    // Formatte l'entrée PRICING d'un modèle en un badge tarif lisible.
    // Renvoie '' si le modèle n'est pas tarifé.
