    const GREETING_DIRECTIVE = `

# Ta toute première phrase
Tu ouvres la conversation. Personne n'a encore parlé et tu n'as reçu aucune demande.
- Salue la personne en une ou deux phrases courtes, dans ton style, et invite-la à parler.
- Ne fais référence à AUCUN échange, message, question ou projet précédent : il n'y en a aucun.
- N'ouvre pas par « d'accord », « très bien », « ah », « je vois », « je vais regarder » ni aucune formule qui répondrait à quelqu'un.
- Ne remercie pas, ne récapitule rien, ne propose pas de reprendre quoi que ce soit.`;

    function buildFullInstructions(persona) {
        // Prompt effectif = prompt libre + posture + règles par blocs (Phase 1).
        let fullInstructions = buildPersonaPrompt(persona);

        const toolSection = activeProvider === 'gemini'
            ? `\n\n# Outils à ta disposition
- **Date et heure** : tu as un outil pour connaître la date et l'heure. Dès le début de la conversation, utilise-le silencieusement pour te situer dans le temps, sans en parler à l'utilisateur.
- **Recherche web** : tu disposes d'un accès à Google Search intégré. Quand c'est pertinent, fais une recherche pour obtenir des infos actuelles.
- **Météo** : tu peux consulter la météo d'un lieu. Utilise cet outil quand l'utilisateur te demande le temps qu'il fait ou qu'il va faire.
- **Sources** : search_sources fouille les documents et notes fournis à ce persona. Dès qu'une question porte sur leur contenu, utilise-le et cite la source de façon naturelle (« d'après ton document X… ») — préfère-le à tes connaissances générales.
- **Historique** : search_history retrouve ce qui a été dit dans vos conversations passées (« c'était quoi déjà que… »).
- **Notes** : save_note écrit durablement dans ta mémoire si l'utilisateur te demande de retenir quelque chose.
- **Calcul** : calculate pour tout calcul exact, plutôt que de calculer de mémoire.
- **Page web** : fetch_url lit le contenu d'une URL à la demande.
- **Quiz** : create_quiz prépare des questions sur un sujet ; pose-les à l'oral une par une, évalue les réponses et corrige, puis note la progression avec update_progress.
- **Fiches** : make_flashcard enregistre une fiche recto/verso pour la révision (utilise-la pour les notions clés).
- **Plan** : plan_session construit un plan d'apprentissage en étapes quand l'utilisateur veut un programme de travail.
- **Progression** : update_progress enregistre le niveau de maîtrise d'un sujet en fin de séance.`
            : `\n\n# Outils à ta disposition
- **Date et heure** : tu as un outil pour connaître la date et l'heure. Dès le début de la conversation, utilise-le silencieusement pour te situer dans le temps, sans en parler à l'utilisateur.
- **Recherche web** : tu peux rechercher sur le web quand c'est vraiment utile (actualités, infos factuelles que tu ne connais pas). Ne l'utilise pas systématiquement, seulement quand c'est explicitement pertinent.
- **Météo** : tu peux consulter la météo d'un lieu. Utilise-le quand l'utilisateur te demande le temps qu'il fait ou qu'il va faire.
- **Sources** : search_sources fouille les documents et notes fournis à ce persona. Dès qu'une question porte sur leur contenu, utilise-le et cite la source de façon naturelle (« d'après ton document X… ») — préfère-le à tes connaissances générales.
- **Historique** : search_history retrouve ce qui a été dit dans vos conversations passées (« c'était quoi déjà que… »).
- **Notes** : save_note écrit durablement dans ta mémoire si l'utilisateur te demande de retenir quelque chose.
- **Calcul** : calculate pour tout calcul exact, plutôt que de calculer de mémoire.
- **Page web** : fetch_url lit le contenu d'une URL à la demande.
- **Quiz** : create_quiz prépare des questions sur un sujet ; pose-les à l'oral une par une, évalue les réponses et corrige, puis note la progression avec update_progress.
- **Fiches** : make_flashcard enregistre une fiche recto/verso pour la révision (utilise-la pour les notions clés).
- **Plan** : plan_session construit un plan d'apprentissage en étapes quand l'utilisateur veut un programme de travail.
- **Progression** : update_progress enregistre le niveau de maîtrise d'un sujet en fin de séance.`;

        fullInstructions += toolSection;

        const userInfo = getUserInfo();
        if (userInfo.trim()) {
            fullInstructions += `\n\n# Informations sur l'utilisateur\nVoici ce que tu sais sur la personne avec qui tu parles. Utilise ces infos naturellement, sans les réciter :\n${userInfo}`;
        }
        const personaInfo = persona.personaInfo || '';
        if (personaInfo.trim()) {
            fullInstructions += `\n\n# Informations spécifiques que tu connais sur l'utilisateur\n${personaInfo}`;
        }
        // Mémoire long terme du persona (Phase 1) : progression, acquis,
        // points fragiles et objectifs retenus des conversations passées.
        fullInstructions += personaMemoryPromptSection(persona.id);
        fullInstructions += personaDuePromptSection(persona.id); // Phase 4
        return fullInstructions;
    }

    // Remet l'UI à l'état initial (bouton Démarrer visible, timer/session bar
    // cachés) et affiche le message d'erreur passé. Utilisé chaque fois qu'une
    // connexion échoue ou qu'un `case 'error'` remonte du serveur : sinon le
    // bouton Terminer reste affiché et le timer continue de tourner alors que
    // rien n'est vraiment connecté.
    function handleConnectionFailure(msg) {
        const alreadyIdle = !isConnected && (startBtn.style.display !== 'none');
        if (!alreadyIdle) stopConversation(false);
        setStatus(msg, 'error');
    }

    function connectWebSocket() {
        setStatus('Connexion...');

        // Filet de sécurité : si un WebSocket précédent traîne (l'utilisateur a
        // relancé une conversation avant que la fermeture propre soit terminée),
        // on le coupe explicitement avant d'en ouvrir un nouveau pour éviter
        // deux sockets ouverts en parallèle.
        if (ws) { try { ws.close(1000); } catch(e){} ws = null; }

        if (isTranscripteurMode) {
            if (activeProvider === 'gemini') connectGeminiTranscribe();
            else connectWhisper();
            return;
        }
        if (isTraducteurMode) {
            if (activeProvider === 'gemini') connectGeminiTranslate();
            else connectTranslate(null);
            return;
        }

        const persona = getPersonas().find(p => p.id === getActiveId());
        if (!persona) return;

        if (activeProvider === 'gemini') {
            connectGemini(persona);
        } else if (activeProvider === 'xai') {
            connectXai(persona);
        } else if (isLiveModel(activeModelId)) {
            connectOpenAILive(persona); // API Live (WebRTC), pas Realtime
        } else if (activeModelId === 'gpt-realtime-translate') {
            connectTranslate(persona);
        } else {
            connectOpenAI(persona);
        }
    }

    function connectOpenAI(persona) {
        if (!getApiKey()) return;
        const url = `wss://api.openai.com/v1/realtime?model=${activeModelId}`;

        // Note : plus de sous-protocole `openai-beta.realtime-v1` — la Realtime
        // Beta API n'est plus supportée par OpenAI. Tous les modèles passent
        // désormais par la GA API (endpoint `/v1/realtime`).
        ws = new WebSocket(url, [
            'realtime',
            `openai-insecure-api-key.${getApiKey()}`
        ]);

        ws.onopen = () => {
            isConnected = true;
            updateOrbCenterBtn('connected');
            setStatus('Connecté, parlez !', 'connected');

            const tools = [];

            tools.push({
                type: 'function',
                name: 'get_current_datetime',
                description: 'Obtenir la date et l\'heure actuelles. Utilise cet outil quand l\'utilisateur demande la date, l\'heure, le jour de la semaine, ou toute information temporelle.',
                parameters: { type: 'object', properties: {}, required: [] }
            });

            tools.push({
                type: 'function',
                name: 'web_search',
                description: 'Recherche sur le web pour obtenir des informations actuelles ou complémentaires. Utilise uniquement quand c\'est vraiment utile et explicitement pertinent.',
                parameters: { type: 'object', properties: { query: { type: 'string', description: 'La requête de recherche' } }, required: ['query'] }
            });

            tools.push({
                type: 'function',
                name: 'get_weather',
                description: 'Obtenir la météo actuelle et les prévisions pour un lieu donné. Utilise cet outil quand l\'utilisateur parle de météo, de temps qu\'il fait, ou veut savoir s\'il fera beau.',
                parameters: { type: 'object', properties: { location: { type: 'string', description: 'La ville ou le lieu (ex: Paris, Lyon, Tokyo)' } }, required: ['location'] }
            });

            // Outils Phase 2 du persona : sources, historique, notes, calcul, URL.
            tools.push(...vartToolDefsAsOpenAI());

            const fullInstructions = buildFullInstructions(persona);

            const turnDetection = (function() {
                const presets = {
                    'reactive':      { threshold: 0.55, prefix_padding_ms: 250, silence_duration_ms: 500 },
                    'balanced':      { threshold: 0.65, prefix_padding_ms: 350, silence_duration_ms: 900 },
                    'patient':       { threshold: 0.7, prefix_padding_ms: 450, silence_duration_ms: 1400 },
                    'very-patient':  { threshold: 0.75, prefix_padding_ms: 550, silence_duration_ms: 2200 }
                };
                const p = presets[persona.reactivity] || presets['balanced'];
                return { type: 'server_vad', ...p, create_response: true, interrupt_response: true };
            })();
            // Tous les modèles Realtime passent désormais par la GA API
            // (endpoint /v1/realtime). Le format de session est identique quel
            // que soit le modèle : `type: 'realtime'` obligatoire, config audio
            // sous `audio.input/output` avec `format` en objet. L'ancien format
            // Beta (modalities, input_audio_format en string, temperature…)
            // n'est plus accepté — la GA rejette entre autres l'absence de
            // `session.type` et ne prend plus `temperature` en paramètre.
            const session = {
                type: 'realtime',
                output_modalities: ['audio'],
                instructions: fullInstructions,
                audio: {
                    input: {
                        format: { type: 'audio/pcm', rate: 24000 },
                        turn_detection: turnDetection,
                        transcription: { model: getTranscriptionModel() }
                    },
                    output: {
                        format: { type: 'audio/pcm', rate: 24000 },
                        voice: persona.voice
                    }
                },
                tools: tools,
                tool_choice: tools.length > 0 ? 'auto' : 'none'
            };
            ws.send(JSON.stringify({ type: 'session.update', session }));
        };

        ws.onmessage = (e) => handleServerEvent(JSON.parse(e.data));
        ws.onerror = () => handleConnectionFailure('Erreur de connexion');
        ws.onclose = (e) => {
            if (e.code !== 1000) handleConnectionFailure(`Déconnecté (code ${e.code})`);
            else isConnected = false;
        };
    }

