    // ── Révisions dues (Phase 4) ──────────────────────────────────────────
    // Cache synchrone (même pattern que personaMemoryCache) alimenté par
    // refreshDueBadges / markFlashcardReviewed : permet d'injecter le nombre
    // de fiches dues dans les instructions, qui sont construites en synchrone.
    const dueCountsCache = {};   // personaId → nombre de fiches dues
    function personaDuePromptSection(personaId) {
        const n = dueCountsCache[personaId] || 0;
        if (!n) return '';
        return `\n\n# Révisions en attente\nL'utilisateur a ${n} fiche${n > 1 ? 's' : ''} de révision due${n > 1 ? 's' : ''}. En début de conversation, propose brièvement une petite révision (« Tu as ${n} fiche${n > 1 ? 's' : ''} à revoir, on s'y met ? ») via l'outil review_flashcards — sans insister s'il préfère faire autre chose.`;
    }

    // Réécrit la mémoire d'un persona après une conversation. La mémoire est
    // une SYNTHÈSE réécrite à chaque fois (pas un empilement) : la
    // consolidation/déduplication est donc native et la taille reste bornée.
    // Silencieux par conception : aucune modale, un simple statut en fin.
    async function updatePersonaMemory(personaId, personaName) {
        try {
            const transcript = getTranscriptText();
            if (!transcript.trim() || transcript.length < 50) return;
            const existing = getPersonaMemoryText(personaId);
            const systemPrompt = `Tu maintiens la mémoire à long terme d'un persona pédagogique nommé « ${personaName} ».
À partir de la transcription de la dernière conversation et de la mémoire existante, produis la NOUVELLE mémoire complète (qui remplace l'ancienne).

Mémoire existante (à conserver, mettre à jour ou corriger — ne rien recopier tel quel sans le fusionner) :
${existing || '(vide : première mémorisation)'}

Contenu attendu, en français, sous forme de listes courtes avec EXACTEMENT ces sections (omets une section si rien à y mettre) :
## Sujets abordés — les notions vues, avec la date
## Acquis — ce que l'utilisateur semble maîtriser
## Points fragiles — ce qui reste à retravailler
## Objectifs — ce que l'utilisateur vise (examen, projet, niveau…)
## Progression — évolution d'ensemble en 1 ou 2 phrases

Règles :
- Reste factuel : uniquement ce que révèle la transcription, jamais d'invention.
- Maximum 400 mots au total : fusionne et supprime ce qui devient obsolète.
- Conserve TOUTES les notes explicites (lignes commençant par « - [note ») : elles ont été demandées en conversation par l'utilisateur.
- N'inclus ni salutations, ni météo, ni sujets sans lien avec l'accompagnement.
- Si la conversation n'a RIEN de mémorable pour l'accompagnement, retourne exactement : INCHANGE`;
            const result = await chatCompletion({
                systemPrompt,
                userPrompt: `Transcription de la conversation :\n\n${transcript}`,
                temperature: 0.2,
                maxTokens: 1200,
                model: getAnalysisModel()
            });
            if (!result || result.includes('INCHANGE')) return;
            await savePersonaMemory(personaId, result.trim());
            obsidianWriteMemory(personaId).catch(() => {}); // sync vault (Phase 3)
            setStatus(`Mémoire de ${personaName} mise à jour`);
        } catch (e) {
            // La mémoire est un confort, jamais un point de blocage.
            console.error('Mise à jour mémoire persona échouée :', e);
        }
    }

