    // ── Budget par persona (niveau 2 du budget hybride) ────────────────────
    // Coût du mois en cours pour UN persona, calculé sur les conversations
    // stockées (coût gelé à l'enregistrement — fiable même si les tarifs
    // changent ensuite).
    function getPersonaMonthCost(personaId) {
        const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
        return getConversations()
            .filter(c => c.personaId === personaId && new Date(c.date) >= monthStart)
            .reduce((sum, c) => sum + conversationCost(c), 0);
    }

    // ── Confirmations préventives (niveau 3 du budget hybride) ─────────────
    // Activées par défaut, désactivables dans Configuration → Budget.
    function getConfirmCostActions() { return localStorage.getItem('vart_confirmCostActions') !== '0'; }
    function setConfirmCostActions(v) { localStorage.setItem('vart_confirmCostActions', v ? '1' : '0'); }
    // Phase 4 : rappels de révision par notification (désactivé par défaut).
    function getReviewNotif() { return localStorage.getItem('vart_reviewNotif') === '1'; }
    function setReviewNotif(v) { localStorage.setItem('vart_reviewNotif', v ? '1' : '0'); }
    // Une notification par jour maximum, seulement si des fiches sont dues.
    async function maybeNotifyDueReviews() {
        if (!getReviewNotif()) return;
        if (!('Notification' in window) || Notification.permission !== 'granted') return;
        const today = new Date().toISOString().slice(0, 10);
        if (localStorage.getItem('vart_reviewNotifLast') === today) return;
        const personas = getPersonas();
        let total = 0;
        for (const p of personas) total += await countDueFlashcards(p.id).catch(() => 0);
        if (!total) return;
        localStorage.setItem('vart_reviewNotifLast', today);
        try {
            new Notification('Vart — révisions du jour', {
                body: `${total} fiche${total > 1 ? 's' : ''} à réviser. Ouvrez un persona et dites « révisons mes fiches ».`,
                icon: 'data:image/svg+xml,%3Csvg viewBox=\'0 0 100 100\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Crect x=\'15\' y=\'25\' width=\'70\' height=\'55\' rx=\'14\' fill=\'%236b8e23\'/%3E%3C/svg%3E'
            });
        } catch (e) { /* certains navigateurs exigent un service worker */ }
    }
    // Demande confirmation avant une action payante. Renvoie true si on
    // continue (confirmé ou confirmations désactivées).
    async function confirmCostEstimate(label, estimateText) {
        if (!getConfirmCostActions()) return true;
        return customConfirm(`${label} — coût estimé : ${estimateText}.\nVous pouvez désactiver ces confirmations dans Configuration → Budget.`, { title: 'Action payante', icon: 'wallet', confirmLabel: 'Continuer', cancelLabel: 'Annuler' });
    }

    // ══════════════════════════════════════════════════════════════════════
    //  PHASE 2 — SOURCES PAR PERSONA (RAG)
    //  Store « sources » de vart-db : { id, personaId, type, name, chunks,
    //  embModel, vectors, hash, addedAt }. Indexation = découpage en chunks
    //  + embeddings (OpenAI ou Gemini) avec repli BM25 local (mots-clés,
    //  gratuit) quand aucune clé compatible n'est configurée.
    // ══════════════════════════════════════════════════════════════════════

    const SOURCE_CHUNK_CHARS = 1800;   // ≈ 450 tokens, calibrés sur 4 chars/token
    const SOURCE_CHUNK_OVERLAP = 0.10; // 10 % de recouvrement : pas de césure perdue
    const EMBED_BATCH = 20;            // appels par lot (limite des APIs)
    // Tarifs embeddings, $ par token (références publiques — affichés en
    // estimation avant l'indexation, jamais facturés à la volée).
    const EMBED_PRICING = {
        'text-embedding-3-small': 0.02 / 1e6,   // OpenAI
        'text-embedding-004':      0.025 / 1e6   // Gemini
    };
    function estimateEmbedTokens(chars) { return Math.max(1, Math.ceil(chars / 4)); }

    // Découpe le texte en chunks de SOURCE_CHUNK_CHARS avec recouvrement.
    // Coupe autant que possible sur les fins de paragraphes/lignes pour
    // garder des extraits lisibles et autonomes.
    function chunkText(text) {
        const clean = String(text || '').replace(/\r\n/g, '\n').replace(/[ \t]+/g, ' ').trim();
        if (!clean) return [];
        const chunks = [];
        let start = 0;
        while (start < clean.length) {
            let end = Math.min(start + SOURCE_CHUNK_CHARS, clean.length);
            if (end < clean.length) {
                const window = clean.slice(start, end);
                const cut = Math.max(window.lastIndexOf('\n\n'), window.lastIndexOf('. '), window.lastIndexOf('\n'));
                if (cut > SOURCE_CHUNK_CHARS * 0.5) end = start + cut + 1;
            }
            const piece = clean.slice(start, end).trim();
            if (piece) chunks.push(piece);
            if (end >= clean.length) break;
            start = end - Math.floor(SOURCE_CHUNK_CHARS * SOURCE_CHUNK_OVERLAP);
            if (start < 0) start = 0;
        }
        return chunks;
    }

    // Choix du moteur d'embeddings : OpenAI de préférence, sinon Gemini,
    // sinon null → BM25. Renvoie { id, key, name }.
    function pickEmbedEngine() {
        if (getApiKey()) return { id: 'openai', key: getApiKey(), name: 'text-embedding-3-small' };
        if (getGeminiApiKey()) return { id: 'gemini', key: getGeminiApiKey(), name: 'text-embedding-004' };
        return null;
    }

    // Embedde tous les textes. Renvoie { model, vectors } ou null (échec →
    // la source reste indexable en BM25, aucune exception lancée).
    async function embedTexts(texts) {
        const eng = pickEmbedEngine();
        if (!eng || !texts.length) return null;
        try {
            const vectors = [];
            if (eng.id === 'openai') {
                for (let i = 0; i < texts.length; i += EMBED_BATCH) {
                    const input = texts.slice(i, i + EMBED_BATCH);
                    const resp = await fetchWithTimeout('https://api.openai.com/v1/embeddings', {
                        method: 'POST',
                        headers: { 'Authorization': `Bearer ${eng.key}`, 'Content-Type': 'application/json' },
                        body: JSON.stringify({ model: eng.name, input })
                    }, 30000);
                    if (!resp.ok) return null;
                    const data = await resp.json();
                    if (!data.data || data.data.length !== input.length) return null;
                    data.data.forEach(d => { vectors[i + d.index] = d.embedding; });
                }
            } else {
                // Gemini : batchEmbedContents (≤ 100 contenus par appel)
                for (let i = 0; i < texts.length; i += 100) {
                    const batch = texts.slice(i, i + 100).map(t => ({ model: `models/${eng.name}`, content: { parts: [{ text: t }] } }));
                    const resp = await fetchWithTimeout(`https://generativelanguage.googleapis.com/v1beta/models/${eng.name}:batchEmbedContents?key=${encodeURIComponent(eng.key)}`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ requests: batch })
                    }, 30000);
                    if (!resp.ok) return null;
                    const data = await resp.json();
                    if (!data.embeddings || data.embeddings.length !== batch.length) return null;
                    data.embeddings.forEach(e => vectors.push(e.values));
                }
            }
            if (vectors.length !== texts.length || vectors.some(v => !v)) return null;
            return { model: eng.name, vectors };
        } catch (e) {
            console.error('Embeddings échoués (repli BM25) :', e);
            return null;
        }
    }

    function cosineSim(a, b) {
        if (!a || !b || a.length !== b.length) return 0;
        let dot = 0, na = 0, nb = 0;
        for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
        return (na && nb) ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : 0;
    }

