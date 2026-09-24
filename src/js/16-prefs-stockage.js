    // ── Historique des discussions ──
    function getConversations() {
        // Synchrone par contrat (listes, stats, budget, export) : on sert le
        // cache mémoire. Il vaut [] le temps du chargement initial, puis l'UI
        // est re-rendue à l'arrivée des données (initConversationsStore).
        return conversationsCache || [];
    }
    function saveConversations(list) {
        conversationsCache = list;
        // Repli localStorage si IndexedDB est injoignable (cf. note plus haut).
        if (convUseLocalStorageFallback) {
            try { localStorage.setItem('vart_conversations', JSON.stringify(list)); }
            catch (e) { console.error('Sauvegarde conversation échouée :', e); }
            return;
        }
        // Persistance IndexedDB asynchrone : on réécrit le store pour qu'il
        // reflète exactement la liste (ajouts, suppressions, mises à jour).
        // File d'écriture obligatoire : voir la note près de convWriteQueue.
        convWriteQueue = convWriteQueue.then(() => vartDbRun('readwrite', 'conversations', st => {
            st.clear();
            (list || []).forEach(c => { if (c && c.id) st.put(c); });
        }));
    }
    function addConversation(conv) {
        const list = getConversations();
        list.push(conv);
        // Plus de gestionnaire de quota ici (Phase 1) : les conversations
        // vivent dans IndexedDB (quota généreux, écriture asynchrone et
        // sérialisée), et le ménage du démarrage + la suppression manuelle
        // gèrent l'espace. saveConversations ne lève plus d'erreur synchrone.
        saveConversations(list);
    }
    function deleteConversation(id) {
        const list = getConversations();
        // Les vignettes de cette discussion n'ont plus de raison d'être : on
        // les sort de la base au passage, sinon elles s'accumuleraient sans
        // que rien ne les référence (le ménage du démarrage les rattraperait,
        // mais autant ne pas attendre le prochain rechargement).
        const doomed = [];
        (list.find(c => c.id === id)?.messages || []).forEach(m => { if (m.imageId) doomed.push(m.imageId); });
        saveConversations(list.filter(c => c.id !== id));
        if (doomed.length) visionImageDrop(doomed);
    }
    function updateConversation(id, patch) {
        const list = getConversations();
        const i = list.findIndex(c => c.id === id);
        if (i < 0) return;
        list[i] = { ...list[i], ...patch };
        try { saveConversations(list); } catch (e) { console.error('Mise à jour conversation échouée :', e); }
    }
    function getViewingConvId() { return localStorage.getItem('vart_viewingConvId') || ''; }
    function setViewingConvId(id) {
        if (id) localStorage.setItem('vart_viewingConvId', id);
        else localStorage.removeItem('vart_viewingConvId');
    }



    // fetch avec timeout — AbortController coupe la requête après `ms` ms pour
    // éviter qu'une API qui pend fasse geler la modale insights, le résumé de
    // conversation ou la recherche web indéfiniment.
