    // ── Grok Voice (xAI) — API compatible OpenAI Realtime ──
    // Même protocole d'événements que connectOpenAI (session.update,
    // input_audio_buffer.append, response.output_audio.delta…) et même
    // handleServerEvent. Deux différences :
    //  1. Auth navigateur : xAI n'accepte pas de sous-protocole « clé
    //     insecure ». On demande d'abord un jeton éphémère avec la clé
    //     (POST /v1/realtime/client_secrets, CORS ouvert — même schéma que le
    //     Transcripteur OpenAI) puis on ouvre le WebSocket avec le
    //     sous-protocole `xai-client-secret.<jeton>`.
    //  2. Recherche web NATIVE (`{ type: 'web_search' }`) au lieu de notre
    //     fonction web_search, qui passe par l'API OpenAI.
    // Le format de session est celui documenté par xAI : pas de `type`, ni
    // d'`output_modalities`, ni de modèle de transcription (xAI transcrit
    // lui-même la parole utilisateur et l'envoie en événements `.updated`).
    async function connectXai(persona) {
        if (!getXaiApiKey()) return;
        const myEpoch = connectionEpoch; // capture avant le POST client_secrets
        setStatus('Connexion...', 'connected');

        // 1. Jeton éphémère
        let token;
        try {
            const resp = await fetch('https://api.x.ai/v1/realtime/client_secrets', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${getXaiApiKey()}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ expires_after: { seconds: 600 } })
            });
            if (!resp.ok) {
                const err = await resp.json().catch(() => ({}));
                const msg = (err.error && (err.error.message || err.error)) || err.code || `HTTP ${resp.status}`;
                throw new Error(typeof msg === 'string' ? msg : `HTTP ${resp.status}`);
            }
            const data = await resp.json();
            token = data.value || (data.client_secret && data.client_secret.value) || data.token;
            if (!token) throw new Error('Réponse inattendue : ' + JSON.stringify(data).substring(0, 300));
        } catch (err) {
            if (myEpoch === connectionEpoch) handleConnectionFailure(`Erreur xAI : ${err.message}`);
            return;
        }
        // L'utilisateur a pu cliquer « Terminer » pendant l'attente réseau.
        if (myEpoch !== connectionEpoch) return;

        // 2. WebSocket avec le jeton en sous-protocole
        const url = `wss://api.x.ai/v1/realtime?model=${encodeURIComponent(activeModelId)}`;
        ws = new WebSocket(url, [`xai-client-secret.${token}`]);

        ws.onopen = () => {
            isConnected = true;
            updateOrbCenterBtn('connected');
            setStatus('Connecté, parlez !', 'connected');

            const tools = [
                {
                    type: 'function',
                    name: 'get_current_datetime',
                    description: 'Obtenir la date et l\'heure actuelles. Utilise cet outil quand l\'utilisateur demande la date, l\'heure, le jour de la semaine, ou toute information temporelle.',
                    parameters: { type: 'object', properties: {}, required: [] }
                },
                {
                    type: 'function',
                    name: 'get_weather',
                    description: 'Obtenir la météo actuelle et les prévisions pour un lieu donné. Utilise cet outil quand l\'utilisateur parle de météo, de temps qu\'il fait, ou veut savoir s\'il fera beau.',
                    parameters: { type: 'object', properties: { location: { type: 'string', description: 'La ville ou le lieu (ex: Paris, Lyon, Tokyo)' } }, required: ['location'] }
                },
                // Outils Phase 2 du persona : sources, historique, notes, calcul, URL.
                ...vartToolDefsAsOpenAI(),
                // Recherche web intégrée côté xAI (pas d'aller-retour client).
                { type: 'web_search' }
            ];

            const presets = {
                'reactive':      { threshold: 0.55, prefix_padding_ms: 250, silence_duration_ms: 500 },
                'balanced':      { threshold: 0.65, prefix_padding_ms: 350, silence_duration_ms: 900 },
                'patient':       { threshold: 0.7,  prefix_padding_ms: 450, silence_duration_ms: 1400 },
                'very-patient':  { threshold: 0.75, prefix_padding_ms: 550, silence_duration_ms: 2200 }
            };
            const vad = presets[persona.reactivity] || presets['balanced'];

            // Garde-fou voix : un persona créé avec un modèle OpenAI/Gemini peut
            // garder une voix inconnue chez xAI → repli sur « eve » (voix par défaut).
            const xaiVoiceNames = VOICES.xai.map(v => v.value);
            const safeVoice = xaiVoiceNames.includes(String(persona.voice || '').toLowerCase()) ? String(persona.voice).toLowerCase() : 'eve';

            const session = {
                voice: safeVoice,
                instructions: buildFullInstructions(persona),
                turn_detection: { type: 'server_vad', ...vad },
                audio: {
                    input:  { format: { type: 'audio/pcm', rate: 24000 } },
                    output: { format: { type: 'audio/pcm', rate: 24000 } }
                },
                tools: tools
            };
            ws.send(JSON.stringify({ type: 'session.update', session }));
        };

        ws.onmessage = (e) => handleServerEvent(JSON.parse(e.data));
        ws.onerror = () => handleConnectionFailure('Erreur de connexion xAI');
        ws.onclose = (e) => {
            if (e.code !== 1000) handleConnectionFailure(`xAI déconnecté (code ${e.code}${e.reason ? ' - ' + e.reason : ''})`);
            else isConnected = false;
        };
    }

