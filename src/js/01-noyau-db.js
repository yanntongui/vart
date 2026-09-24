    // ── Conversations : cache mémoire + persistance IndexedDB ──────────────
    // getConversations() DOIT rester synchrone (appelé partout : listes,
    // stats, budget, export). On sert donc un cache mémoire, alimenté depuis
    // la base au démarrage, et chaque sauvegarde réécrit le store en
    // asynchrone. La file `convWriteQueue` sérialise les écritures : sans
    // elle, deux sauvegardes rapprochées pourraient entrelacer leurs
    // clear/put et ressusciter des conversations supprimées.
    let conversationsCache = null;
    let convWriteQueue = Promise.resolve();
    // IndexedDB indisponible (navigation privée, stockage bloqué) : repli sur
    // localStorage comme l'ancienne version — on perd le quota généreux de la
    // base, jamais les conversations.
    let convUseLocalStorageFallback = false;

    async function initConversationsStore() {
        let list = (await vartDbRun('readonly', 'conversations', st => st.getAll()));
        if (list === null) {
            // Base injoignable : mode repli localStorage.
            convUseLocalStorageFallback = true;
            try { conversationsCache = JSON.parse(localStorage.getItem('vart_conversations')) || []; }
            catch (e) { conversationsCache = []; }
            if (typeof renderPersonaList === 'function') renderPersonaList();
            return;
        }
        // Migration : la clé localStorage (vart_conversations après migration
        // de préfixe, kast_conversations sinon) ne sert que si la base est
        // vide — première ouverture de Vart avec un historique Kast existant.
        // La clé localStorage est ensuite LAISSÉE en place (filet de
        // sécurité) mais n'est plus jamais relue ni réécrite.
        if (!list.length) {
            try {
                const raw = localStorage.getItem('vart_conversations') || localStorage.getItem('kast_conversations');
                const legacy = raw ? JSON.parse(raw) : null;
                if (Array.isArray(legacy) && legacy.length) {
                    list = legacy.filter(c => c && c.id);
                    if (list.length) {
                        await vartDbRun('readwrite', 'conversations', st => {
                            list.forEach(c => st.put(c));
                        });
                    }
                }
            } catch (e) { /* base vide : on démarre proprement */ }
        }
        conversationsCache = list;
        // L'UI s'est peut-être rendue avant la fin du chargement (base lente) :
        // on re-affiche les listes pour faire apparaître l'historique.
        if (typeof renderPersonaList === 'function') renderPersonaList();
    }
    initConversationsStore();

    // ══════════════════════════════════════════════════════════════════════
    //  PHASE 1 — PERSONA AUGMENTÉ : postures, règles, mémoire, budget
    // ══════════════════════════════════════════════════════════════════════

