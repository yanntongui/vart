    // ── Phase 4 : répétition espacée (Leitner simplifié) ──────────────────
    // Intervalles en jours : succès → cran suivant, échec → retour à 1 jour.
    const REVIEW_INTERVALS = [1, 3, 7, 16, 35];
    function scheduleCard(card, success) {
        const now = new Date();
        let idx = REVIEW_INTERVALS.indexOf(card.intervalDays);
        if (idx === -1) idx = success ? 0 : -1; // fiche ancienne sans intervalle
        const nextIdx = success ? Math.min(idx + 1, REVIEW_INTERVALS.length - 1) : 0;
        card.intervalDays = REVIEW_INTERVALS[nextIdx];
        card.reviewCount = (card.reviewCount || 0) + 1;
        card.lastReviewedAt = now.toISOString();
        card.nextReviewAt = new Date(now.getTime() + card.intervalDays * 86400000).toISOString();
        return card;
    }
    // Fiches dues : nextReviewAt absent (anciennes fiches) ou dépassé.
    async function getDueFlashcards(personaId) {
        const cards = await listStudyItems(personaId, 'flashcard');
        const now = Date.now();
        return cards.filter(c => !c.nextReviewAt || new Date(c.nextReviewAt).getTime() <= now)
            .sort((a, b) => new Date(a.nextReviewAt || a.createdAt || 0) - new Date(b.nextReviewAt || b.createdAt || 0));
    }
    async function countDueFlashcards(personaId) { return (await getDueFlashcards(personaId)).length; }
    // Badges 🔁 sur les cartes d'accueil : mise à jour asynchrone post-render
    // (renderWelcomeGrid est synchrone, le comptage IndexedDB ne l'est pas).
    async function refreshDueBadges() {
        const badges = document.querySelectorAll('.review-badge[data-persona-id]');
        for (const b of badges) {
            const n = await countDueFlashcards(b.dataset.personaId).catch(() => 0);
            dueCountsCache[b.dataset.personaId] = n; // alimente personaDuePromptSection
            b.hidden = !n;
            if (n) {
                b.querySelector('.review-badge-count').textContent = n;
                b.title = `${n} fiche${n > 1 ? 's' : ''} à réviser — dites « révisons mes fiches » en conversation`;
            }
        }
    }
    // Outil review_flashcards : renvoie les fiches dues au modèle, qui doit
    // interroger l'utilisateur À L'ORAL puis noter chaque réponse.
    async function reviewFlashcardsForPersona(personaId) {
        const due = await getDueFlashcards(personaId);
        if (!due.length) return JSON.stringify({ fiches: [], message: 'Aucune fiche à réviser pour l\'instant. Propose d\'en créer avec ce que vous avez vu récemment.' });
        const batch = due.slice(0, 10);
        return JSON.stringify({
            fiches: batch.map(c => ({ id: c.id, question: c.recto, reponse_attendue: c.verso })),
            restantes_apres_ce_lot: due.length - batch.length,
            consigne: 'Interroge l\'utilisateur à l\'oral, UNE question à la fois : lis la question, attends sa réponse, évalue-la par rapport à la réponse attendue, donne un feedback court, puis appelle mark_flashcard_reviewed avec l\'id et success=true/false avant de passer à la suivante. Ne lis JAMAIS la réponse attendue avant que l\'utilisateur ait répondu.'
        });
    }
    async function markFlashcardReviewed(personaId, cardId, success) {
        const cards = await listStudyItems(personaId, 'flashcard');
        const card = cards.find(c => c.id === cardId && c.personaId === personaId);
        if (!card) return JSON.stringify({ erreur: 'Fiche introuvable.' });
        scheduleCard(card, !!success);
        await putStudyItem(card);
        // Cache à jour même hors écran d'accueil (le badge n'y existe pas).
        dueCountsCache[personaId] = await countDueFlashcards(personaId).catch(() => 0);
        refreshDueBadges().catch(() => {});
        return JSON.stringify({ ok: true, prochaine_revision_dans_jours: card.intervalDays });
    }

    // Outil plan_session : plan en étapes, persisté ET recopié en mémoire
    // (c'est la mémoire qui est relue au début des sessions suivantes).
    async function buildStudyPlanForPersona(personaId, objectif) {
        if (!objectif.trim()) return JSON.stringify({ erreur: 'Objectif manquant.' });
        const ctx = await studyContextFor(personaId, objectif);
        const raw = await chatCompletion({
            systemPrompt: `Tu conçois un plan d'apprentissage en étapes pour atteindre un objectif. Appuie-toi sur les documents et la progression disponibles ci-dessous.
Format STRICT : 3 à 6 étapes, une par ligne, commençant par « - » puis un verbe d'action, une phrase courte chacune.
Pas de titre, pas de markdown, aucun commentaire.${ctx}`,
            userPrompt: `Objectif : ${objectif}`,
            temperature: 0.4, maxTokens: 600, model: getAnalysisModel()
        });
        const etapes = String(raw || '').split('\n')
            .map(l => l.trim().replace(/^[-•*]\s*/, '').replace(/^\d+[.)]\s*/, '').trim())
            .filter(l => l.length > 3);
        if (!etapes.length) return JSON.stringify({ erreur: 'Plan impossible à générer.' });
        await putStudyItem({ id: `plan_${personaId}`, type: 'plan', personaId, objectif: objectif.trim(), etapes, createdAt: new Date().toISOString() });
        // Remplace l'ancien bloc « Plan d'apprentissage » de la mémoire, sans
        // toucher au reste (notes, acquis, points fragiles…).
        const mem = getPersonaMemoryText(personaId);
        const clean = mem.replace(/\n## Plan d'apprentissage[\s\S]*?(?=\n## |$)/, '').trim();
        const block = `## Plan d'apprentissage\n${etapes.map(e => `- ${e}`).join('\n')}`;
        await savePersonaMemory(personaId, clean ? `${clean}\n${block}` : block);
        obsidianWritePlan(personaId).catch(() => {});
        return JSON.stringify({
            objectif: objectif.trim(), etapes,
            consigne: 'Présente ce plan à l\'oral en 3 ou 4 phrases, puis propose de commencer par la première étape.'
        });
    }

    // Outil update_progress : une entrée par (persona, sujet), avec un
    // historique court — sert l'onglet Statistiques → Progression.
    async function recordProgressForPersona(personaId, sujet, niveau, commentaire) {
        if (!sujet.trim()) return JSON.stringify({ erreur: 'Sujet manquant.' });
        const n = Math.min(Math.max(Math.round(Number(niveau) || 0), 0), 100);
        const slug = studySlug(sujet) || 'sujet';
        const existing = (await listStudyItems(personaId, 'progress')).find(i => i.slug === slug);
        const item = {
            id: `prog_${personaId}_${slug}`, type: 'progress', personaId, slug,
            sujet: sujet.trim(), niveau: n, commentaire: String(commentaire || '').trim(),
            createdAt: existing ? existing.createdAt : new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            history: [...((existing && existing.history) || []), { date: new Date().toISOString(), niveau: n }].slice(-12)
        };
        await putStudyItem(item);
        return JSON.stringify({ ok: true, sujet: item.sujet, niveau: n });
    }

    // ══════════════════════════════════════════════════════════════════════
    //  PHASE 3 — CONNECTEUR OBSIDIAN (File System Access API)
    //  On lit et on écrit des .md DANS le vault choisi par l'utilisateur.
    //  Chrome/Edge uniquement ; Firefox/Safari → repli exports Markdown/CSV.
    //  Aucun serveur : la poignée de dossier est stockée dans IndexedDB.
    // ══════════════════════════════════════════════════════════════════════

