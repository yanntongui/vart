    // ── Ingestion d'une source ─────────────────────────────────────────────
    // Chunk → confirmation de coût (niveau 3) → embeddings → stockage.
    // Le coût d'embedding part dans les stats (kind 'embedding') : budget
    // global, budget par persona et Stats le voient, sans être compté comme
    // une conversation (cf. isConvStat dans renderStats).
    async function indexPersonaSource(personaId, personaName, type, name, text) {
        const chunks = chunkText(text);
        if (!chunks.length) { customAlert('Ce contenu est vide : rien à indexer.', { icon: 'x-circle' }); return false; }
        const est = estimateIndexingCost(text);
        const eng = pickEmbedEngine();
        const estText = eng
            ? `≈ ${formatTokens(est.tokens)} tokens · ≈ ${fmtAmount(est.dollars, true)} (${eng.name})`
            : 'gratuit (BM25 local : aucune clé OpenAI/Gemini → indexation par mots-clés)';
        if (!await confirmCostEstimate(`Indexer « ${name} » pour ${personaName}`, estText)) return false;

        const emb = await embedTexts(chunks); // null → BM25 au moment de la recherche
        const rec = {
            id: `src_${personaId}_${Date.now()}`,
            personaId, type, name,
            chunks,
            embModel: emb ? emb.model : null,
            vectors: emb ? emb.vectors : [],
            hash: null, // réservé à la resynchronisation (Obsidian, Phase 3)
            addedAt: new Date().toISOString()
        };
        // vartDbRun résout true si fn a bien tourné, null en cas d'échec :
        // put() lui-même résout undefined, on le saute donc via un booléen.
        const stored = await vartDbRun('readwrite', 'sources', st => { st.put(rec); return true; });
        if (stored !== true) {
            customAlert('Impossible d\'enregistrer la source dans la base (stockage indisponible).', { title: 'Échec', icon: 'x-circle' });
            return false;
        }
        if (emb && est.dollars > 0) {
            addStat({
                kind: 'embedding', model: emb.model,
                personaId, personaName,
                date: new Date().toISOString(),
                inputTokens: 0, outputTokens: 0, durationSeconds: 0,
                costDollars: est.dollars
            });
            updateBudgetStatus();
        }
        setStatus(`Source « ${name} » indexée (${chunks.length} extraits${emb ? '' : ', recherche par mots-clés'})`);
        return true;
    }

    async function purgePersonaSources(personaId) {
        const all = (await vartDbRun('readonly', 'sources', st => st.getAll())) || [];
        const doomed = all.filter(s => s.personaId === personaId).map(s => s.id);
        if (doomed.length) await vartDbRun('readwrite', 'sources', st => { doomed.forEach(id => st.delete(id)); });
    }

    async function listPersonaSources(personaId) {
        const all = (await vartDbRun('readonly', 'sources', st => st.getAll())) || [];
        return all.filter(s => s.personaId === personaId);
    }

    // Import d'un persona « complet » (Phase 3, v3) : les sources arrivent sous
    // forme de chunks, sans vecteurs. On repropose de recalculer les
    // embeddings (payant → confirmation niveau 3) ; sinon la recherche
    // retombe sur BM25, toujours fonctionnelle et gratuite.
    async function restoreImportedSources(persona, sources) {
        const totalChars = sources.reduce((n, s) => n + s.chunks.join('').length, 0);
        const eng = pickEmbedEngine();
        const tokens = estimateEmbedTokens(totalChars);
        const dollars = eng ? tokens * (EMBED_PRICING[eng.name] || 0) : 0;
        const doEmbed = !!eng && await confirmCostEstimate(
            `Recalculer la recherche sémantique des ${sources.length} source(s) importée(s)`,
            `≈ ${formatTokens(tokens)} tokens · ≈ ${fmtAmount(dollars, true)} (${eng.name})`
        );
        setStatus('Restauration des sources…');
        let done = 0;
        for (const s of sources) {
            const emb = doEmbed ? await embedTexts(s.chunks) : null;
            const rec = {
                id: `src_${persona.id}_${Date.now()}_${done}`,
                personaId: persona.id,
                type: s.type || 'text',
                name: s.name || 'Source importée',
                chunks: s.chunks,
                embModel: emb ? emb.model : null,
                vectors: emb ? emb.vectors : [],
                hash: null,
                addedAt: s.addedAt || new Date().toISOString()
            };
            await vartDbRun('readwrite', 'sources', st => { st.put(rec); return true; });
            done++;
        }
        if (doEmbed && dollars > 0) {
            addStat({ kind: 'embedding', model: eng.name, personaId: persona.id, personaName: persona.name, date: new Date().toISOString(), inputTokens: 0, outputTokens: 0, durationSeconds: 0, costDollars: dollars });
            updateBudgetStatus();
        }
        setStatus(`${done} source(s) restaurée(s) pour ${persona.name}${done && !doEmbed ? ' (recherche par mots-clés)' : ''}`);
    }

    // ── Extraction de texte ────────────────────────────────────────────────
    // URL → texte via fetch + DOMParser. Les sites sans CORS renvoient une
    // erreur réseau : on remonte un message explicite (coller le texte à la
    // main reste possible via l'ajout de note).
    async function fetchUrlAsText(url) {
        const resp = await fetchWithTimeout(url, { headers: { 'Accept': 'text/html,application/xhtml+xml' } }, 15000);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const ctype = resp.headers.get('content-type') || '';
        if (ctype.includes('text/html') || ctype.includes('application/xhtml')) {
            const html = await resp.text();
            const doc = new DOMParser().parseFromString(html, 'text/html');
            doc.querySelectorAll('script, style, noscript, template, svg').forEach(el => el.remove());
            const main = doc.querySelector('article, main') || doc.body;
            return (main ? main.textContent : '').replace(/\n{3,}/g, '\n\n').trim();
        }
        return (await resp.text()).trim();
    }

    // PDF → texte (pdf.js chargé depuis le CDN, cf. <script> en tête de page).
    async function extractPdfText(file) {
        if (typeof pdfjsLib === 'undefined') throw new Error('pdf.js indisponible (connexion requise une première fois)');
        pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
        const buf = await file.arrayBuffer();
        const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
        let out = '';
        for (let p = 1; p <= pdf.numPages; p++) {
            const page = await pdf.getPage(p);
            const content = await page.getTextContent();
            out += content.items.map(it => it.str).join(' ') + '\n\n';
        }
        return out.trim();
    }

    // ══════════════════════════════════════════════════════════════════════
    //  OUTILS DU PERSONA — exécuteur unique appelé par les 3 dispatchs
    //  (handleLiveFunctionCall, handleFunctionCall, handleGeminiFunctionCall).
    //  executeVartTool renvoie une chaîne JSON (format Live/Realtime/Grok) ;
    //  executeVartToolObj la reparse pour Gemini qui attend un objet.
    // ══════════════════════════════════════════════════════════════════════

    // Calculatrice sûre : parseur shunting-yard, sans eval. + - * / ^ ( ),
    // décimales (point ET virgule française), fonctions min/max/sqrt/... , pi/e.
