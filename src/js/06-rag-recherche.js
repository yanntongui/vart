    // ── BM25 : fallback local sans API (mots-clés, gratuit) ─────────────────
    function bm25Tokens(s) {
        return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').match(/[a-z0-9]{3,}/g) || [];
    }
    function bm25Search(chunks, query, k) {
        const q = bm25Tokens(query);
        if (!q.length || !chunks.length) return [];
        const k1 = 1.5, b = 0.75;
        const N = chunks.length;
        const avgLen = chunks.reduce((s, c) => s + c.length, 0) / N;
        const df = {};
        const toks = chunks.map(c => {
            const t = bm25Tokens(c);
            const seen = {};
            t.forEach(w => { if (!seen[w]) { seen[w] = 1; df[w] = (df[w] || 0) + 1; } });
            return t;
        });
        return chunks.map((c, i) => {
            const tf = {};
            toks[i].forEach(w => { tf[w] = (tf[w] || 0) + 1; });
            let score = 0;
            q.forEach(w => {
                if (!tf[w]) return;
                const idf = Math.log(1 + (N - (df[w] || 0) + 0.5) / ((df[w] || 0) + 0.5));
                score += idf * (tf[w] * (k1 + 1)) / (tf[w] + k1 * (1 - b + b * c.length / avgLen));
            });
            return { text: c, score };
        }).filter(x => x.score > 0).sort((a, b2) => b2.score - a.score).slice(0, k);
    }

    // ── Recherche dans les sources d'un persona ────────────────────────────
    // Stratégie : embeddings (cosinus, top-k) si les vecteurs existent et une
    // clé disponible pour embedder la requête avec le BON modèle ; sinon BM25
    // sur tous les chunks. Renvoie [{ text, source, score, via }].
    async function searchPersonaSources(personaId, query, k = 5) {
        const all = (await vartDbRun('readonly', 'sources', st => st.getAll())) || [];
        const docs = all.filter(s => s.personaId === personaId && s.chunks && s.chunks.length);
        if (!docs.length) return [];
        const flat = [];
        docs.forEach(s => s.chunks.forEach((c, i) => flat.push({ text: c, source: s.name, emb: s.embModel, vec: (s.vectors || [])[i] })));
        // Regroupe les vecteurs par modèle d'embedding (dimensions différentes
        // : on ne peut comparer que dans le même espace).
        const modelGroups = {};
        flat.forEach(f => { if (f.emb && f.vec) (modelGroups[f.emb] = modelGroups[f.emb] || []).push(f); });
        for (const model of Object.keys(modelGroups)) {
            const embedded = await embedTexts([query]).catch(() => null);
            if (embedded && embedded.model === model) {
                const scored = modelGroups[model]
                    .map(f => ({ ...f, score: cosineSim(embedded.vectors[0], f.vec), via: 'vector' }))
                    .sort((a, b) => b.score - a.score)
                    .slice(0, k);
                if (scored.length && scored[0].score > 0.15) return scored;
            }
            break; // une seule tentative : on a essayé le premier modèle présent
        }
        return bm25Search(flat.map(f => f.text), query, k).map(r => {
            const owner = flat.find(f => f.text === r.text);
            return { text: r.text, source: owner ? owner.source : '', score: r.score, via: 'keyword' };
        });
    }

    // Estimation de coût d'indexation (tokens + $) — affichée AVANT le lancement.
    function estimateIndexingCost(text) {
        const tokens = estimateEmbedTokens(text.length);
        const eng = pickEmbedEngine();
        const price = eng ? EMBED_PRICING[eng.name] : 0;
        return { tokens, dollars: tokens * price, engine: eng ? eng.name : null };
    }

