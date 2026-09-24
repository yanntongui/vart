    // ── Mémoire du persona (IndexedDB, store « persona_memories ») ─────────
    // Écrite AUTOMATIQUEMENT après chaque conversation (updatePersonaMemory),
    // jamais soumise à validation ; l'utilisateur peut la lire, la corriger
    // ou l'effacer dans l'éditeur de persona. Cache synchrone pour
    // l'injection dans les prompts (buildFullInstructions / buildLiveInstructions
    // sont synchrones) ; alimenté par loadPersonaMemory() à la sélection.
    const personaMemoryCache = {};   // personaId → texte (string)

    async function loadPersonaMemory(personaId) {
        if (!personaId) return '';
        const rec = await vartDbRun('readonly', 'persona_memories', st => st.get(personaId));
        personaMemoryCache[personaId] = (rec && rec.text) || '';
        return personaMemoryCache[personaId];
    }
    function getPersonaMemoryText(personaId) { return personaMemoryCache[personaId] || ''; }
    async function savePersonaMemory(personaId, text) {
        personaMemoryCache[personaId] = text || '';
        if (!text || !text.trim()) {
            await vartDbRun('readwrite', 'persona_memories', st => st.delete(personaId));
        } else {
            await vartDbRun('readwrite', 'persona_memories', st => st.put({ personaId, text, updatedAt: new Date().toISOString() }));
        }
    }
    // Bloc prompt prêt à injecter, ou '' si pas de mémoire.
    function personaMemoryPromptSection(personaId) {
        const mem = getPersonaMemoryText(personaId).trim();
        if (!mem) return '';
        return `\n\n# Ta mémoire de vos conversations précédentes\nVoici ce que tu as retenu de vos échanges passés (progression, acquis, points fragiles, objectifs). Appuie-toi dessus pour personnaliser l'accompagnement et reprendre où vous en étiez, sans jamais réciter cette liste :\n${mem}`;
    }

