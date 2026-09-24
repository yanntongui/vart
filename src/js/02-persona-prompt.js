    // ── Postures pédagogiques : templates injectés dans le prompt ──────────
    // Chaque posture est un bloc d'instructions ajouté APRÈS le prompt libre.
    // Courtes et impératives : ce sont des règles de conduite, pas une
    // redéfinition de l'identité (qui reste au prompt libre).
    const POSTURES = {
        expert: `# Posture : expert
Tu es un expert de ta discipline. Tes réponses sont factuelles, précises et étayées.
- Tu distingues clairement ce que tu sais de ce dont tu n'es pas sûr, et tu le dis.
- Quand tu t'appuies sur un document fourni, tu le cites (« d'après ton document X »).
- Tu corriges les erreurs de l'utilisateur immédiatement, avec tact mais sans laisser passer.`,
        mentor: `# Posture : mentor
Tu es un mentor qui fait progresser par la méthode socratique.
- Tu guides par des QUESTIONS plutôt que par des réponses directes : aide l'utilisateur à trouver par lui-même.
- Tu valorises les efforts et les bonnes intuitions avant de corriger.
- Tu ne donnes la réponse complète qu'en dernier recours, après avoir laissé l'utilisateur essayer.`,
        coach: `# Posture : coach
Tu es un coach motivant, orienté progression.
- Tu fixes des objectifs concrets et mesurables, et tu suis la progression d'une session à l'autre (appuie-toi sur ta mémoire).
- Tu encourages et célèbres chaque avancée, même petite.
- Tu transformes chaque difficulté en plan d'action simple et immédiat.`
    };

    // Types de règles personnalisées (éditeur par blocs). L'ordre d'assemblage
    // dans le prompt final suit l'ordre de ce tableau.
    const RULE_TYPES = [
        { value: 'comportement', label: 'Comportement' },
        { value: 'format',       label: 'Format de réponse' },
        { value: 'conditionnel', label: 'Conditionnelle (si…)' },
        { value: 'interdit',     label: 'Interdit' }
    ];

    // Assemble le prompt EFFECTIF d'un persona : prompt libre + posture +
    // règles par blocs. Les personas créés avant Vart n'ont ni posture ni
    // règles : la fonction retourne alors leur prompt inchangé.
    function buildPersonaPrompt(persona) {
        let p = persona.prompt || '';
        if (persona.posture && POSTURES[persona.posture]) {
            p += `\n\n${POSTURES[persona.posture]}`;
        }
        const rules = Array.isArray(persona.rules) ? persona.rules.filter(r => r && r.text && r.text.trim()) : [];
        if (rules.length) {
            const byType = {};
            RULE_TYPES.forEach(t => { byType[t.value] = []; });
            rules.forEach(r => { (byType[r.type] || byType.comportement).push(r.text.trim()); });
            let section = '\n\n# Règles personnalisées';
            RULE_TYPES.forEach(t => {
                const items = byType[t.value];
                if (!items.length) return;
                const heading = t.value === 'conditionnel' ? 'Règles conditionnelles' : t.value === 'interdit' ? 'Interdits' : t.label;
                section += `\n## ${heading}\n` + items.map(x => `- ${x}`).join('\n');
            });
            p += section;
        }
        return p;
    }

