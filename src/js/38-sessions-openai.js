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

    // ── GPT Live (OpenAI) — API Live, full duplex, via WebRTC ──
    // L'API Live (/v1/live) n'accepte PAS le sous-protocole « clé insecure »
    // des WebSockets navigateur : seul un en-tête Authorization est lu, et un
    // navigateur ne peut pas en poser sur un WebSocket. On passe donc par le
    // transport WebRTC, prévu pour les clients : la session est créée par un
    // simple fetch POST /v1/live/sessions (CORS ouvert, comme nos appels
    // /v1/responses) qui reçoit notre offre SDP et renvoie la réponse ; l'audio
    // circule ensuite sur la piste média négociée (rien à encoder ni à
    // décoder), et les événements JSON (transcriptions, délégation, usage,
    // erreurs) sur un data channel « oai-events ».
    // Modèle « deux étages » : gpt-live-1 écoute et parle (facturé à la
    // minute) et délègue raisonnement + outils à un modèle Responses backend
    // (gpt-5.6-luna, facturé aux tokens) : recherche web hébergée + nos
    // fonctions météo/date, dont les appels reviennent ici (response.event).
    const GPT_LIVE_BACKEND_MODEL = 'gpt-5.6-luna';

    function liveSend(obj) {
        if (liveDc && liveDc.readyState === 'open') liveDc.send(JSON.stringify(obj));
    }

    // Instructions du modèle VOCAL : prompt du persona + contexte (date) +
    // règles de délégation (structure recommandée par la doc GPT-Live :
    // « délègue quand / ne délègue pas quand »). Pas d'outil côté voix.
    function buildLiveInstructions(persona) {
        const now = new Date();
        const dateStr = now.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
        const timeStr = now.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
        // Prompt effectif = prompt libre + posture + règles par blocs (Phase 1).
        let s = buildPersonaPrompt(persona);
        s += `\n\n# Contexte\nAu début de cette conversation, nous sommes le ${dateStr} et il est ${timeStr} (heure locale de l'utilisateur).`;
        s += `\n\n# Délégation au backend
Tu disposes d'un backend qui a accès à des outils : recherche web (actualités, informations récentes ou que tu ne connais pas), météo d'un lieu, les DOCUMENTS ET NOTES fournis à ce persona, vos CONVERSATIONS PASSÉES, l'enregistrement de notes durables, le calcul exact et la lecture d'une URL.
## Délègue au backend quand
- L'utilisateur demande la météo, une information d'actualité ou un fait précis dont tu n'es pas sûr.
- La question demande un raisonnement approfondi, un calcul ou une vérification.
- Une question porte sur le contenu de ses documents/cours/notes (« d'après mon PDF… ») ou sur ce qui a été dit plus tôt.
- L'utilisateur veut être interrogé (quiz), demande des fiches de révision ou un plan de travail — le backend dispose des outils correspondants.
## Ne délègue pas au backend quand
- C'est de la conversation courante, une opinion, une reformulation ou une question simple à laquelle tu sais répondre.
Quand tu délègues, préviens brièvement l'utilisateur et n'invente jamais le résultat en attendant.`;
        const userInfo = getUserInfo();
        if (userInfo.trim()) {
            s += `\n\n# Informations sur l'utilisateur\nVoici ce que tu sais sur la personne avec qui tu parles. Utilise ces infos naturellement, sans les réciter :\n${userInfo}`;
        }
        const personaInfo = persona.personaInfo || '';
        if (personaInfo.trim()) {
            s += `\n\n# Informations spécifiques que tu connais sur l'utilisateur\n${personaInfo}`;
        }
        // Mémoire long terme du persona (Phase 1), comme dans buildFullInstructions.
        s += personaMemoryPromptSection(persona.id);
        s += personaDuePromptSection(persona.id); // Phase 4
        return s;
    }

    // Instructions du modèle BACKEND (raisonnement + outils) : réponses
    // courtes, directement prononçables par le modèle vocal.
    function buildLiveBackendInstructions(persona) {
        let s = `Tu es le backend de raisonnement de « ${persona.name} », un assistant vocal. Le modèle vocal te délègue les questions qui demandent une recherche, la météo, un raisonnement approfondi, un calcul, les documents de ce persona, vos conversations passées ou une page web. Réponds en français, de façon concise et directement exploitable à l'oral : phrases courtes, pas de listes à puces, pas de Markdown, pas de liens. Utilise la recherche web pour toute information récente ou incertaine, get_weather pour la météo, get_current_datetime pour la date ou l'heure, search_sources pour les documents/notes de ce persona (en citant la source), search_history pour vos échanges passés, save_note pour retenir durablement une info, calculate pour les calculs, fetch_url pour lire une URL, create_quiz pour interroger l'utilisateur, make_flashcard pour créer une fiche de révision, review_flashcards puis mark_flashcard_reviewed pour faire réviser les fiches dues à l'oral, plan_session pour bâtir un plan d'apprentissage et update_progress pour noter sa maîtrise d'un sujet.`;
        const userInfo = getUserInfo();
        if (userInfo.trim()) s += `\n\nInformations sur l'utilisateur :\n${userInfo}`;
        return s;
    }

    async function connectOpenAILive(persona) {
        if (!getApiKey()) return;
        const myEpoch = connectionEpoch; // capture avant les await (négociation, POST)
        setStatus('Connexion...');

        // Voix : jeu propre à GPT Live → repli sur « marin » (voix par défaut
        // de l'API) si le persona a été créé avec une voix Realtime/Gemini/xAI.
        const liveVoiceNames = VOICES.live.map(v => v.value);
        const wanted = String(persona.voice || '').toLowerCase();
        const voice = liveVoiceNames.includes(wanted) ? wanted : 'marin';

        const pc = new RTCPeerConnection();
        livePc = pc;

        // Micro : on envoie la piste du flux déjà ouvert par startMicrophone()
        // (persistentStream), qui alimente aussi l'analyseur de la ligne d'onde.
        const micTrack = persistentStream && persistentStream.getAudioTracks()[0];
        if (micTrack) {
            micTrack.enabled = !isMuted;
            pc.addTrack(micTrack, persistentStream);
        } else {
            pc.addTransceiver('audio', { direction: 'sendrecv' });
        }

        // Audio distant → analyser de l'orbe → haut-parleurs. Un <audio> muet
        // reste lié au flux : Chrome ne décode un flux WebRTC distant que s'il
        // est « consommé » par un élément média.
        pc.ontrack = (e) => {
            if (livePc !== pc) return;
            const stream = (e.streams && e.streams[0]) || new MediaStream([e.track]);
            if (!liveAudioEl) {
                liveAudioEl = document.createElement('audio');
                liveAudioEl.autoplay = true;
                liveAudioEl.muted = true;
                liveAudioEl.style.display = 'none';
                document.body.appendChild(liveAudioEl);
            }
            liveAudioEl.srcObject = stream;
            liveAudioEl.play().catch(() => {});
            if (playbackContext && playbackAnalyser) {
                try {
                    liveRemoteSource = playbackContext.createMediaStreamSource(stream);
                    liveRemoteSource.connect(playbackAnalyser);
                    if (playbackContext.state === 'suspended') playbackContext.resume().catch(() => {});
                } catch (err) { console.error('[Live] Audio distant :', err); }
            }
        };
        pc.onconnectionstatechange = () => {
            if (livePc !== pc) return;
            const st = pc.connectionState;
            if (st === 'failed' || st === 'disconnected' || st === 'closed') {
                handleConnectionFailure('GPT Live déconnecté');
            }
        };

        const dc = pc.createDataChannel('oai-events');
        liveDc = dc;
        dc.onmessage = (e) => {
            try { handleLiveServerEvent(JSON.parse(e.data)); }
            catch (err) { console.error('[Live] Erreur parsing :', err, e.data); }
        };
        // Le canal ouvert vaut « session prête » si session.started n'arrive
        // pas sur le data channel (la session est créée côté REST).
        dc.onopen = () => { if (livePc === pc) liveMarkConnected(persona); };
        dc.onclose = () => { if (livePc === pc && isConnected) handleConnectionFailure('GPT Live déconnecté'); };

        // Configuration de session : objet STRICT (tout champ inconnu est
        // rejeté), envoyé avec l'offre SDP à la création.
        const session = {
            model: activeModelId,
            instructions: buildLiveInstructions(persona),
            audio: { output: { voice } },
            delegation: {
                type: 'responses',
                responses: {
                    model: GPT_LIVE_BACKEND_MODEL,
                    instructions: buildLiveBackendInstructions(persona),
                    tools: [
                        { type: 'web_search' },
                        {
                            type: 'function',
                            name: 'get_weather',
                            description: 'Obtenir la météo actuelle et les prévisions pour un lieu donné.',
                            parameters: { type: 'object', properties: { location: { type: 'string', description: 'La ville ou le lieu (ex: Paris, Lyon, Tokyo)' } }, required: ['location'], additionalProperties: false }
                        },
                        {
                            type: 'function',
                            name: 'get_current_datetime',
                            description: 'Obtenir la date et l\'heure actuelles de l\'utilisateur.',
                            parameters: { type: 'object', properties: {}, additionalProperties: false }
                        },
                        // Outils Phase 2 du persona (sources, historique, notes…)
                        ...vartToolDefsAsOpenAI()
                    ],
                    tool_choice: 'auto',
                    parallel_tool_calls: false,
                    reasoning: { effort: 'low' },
                    text: { verbosity: 'low' }
                }
            }
        };

        try {
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);
            if (myEpoch !== connectionEpoch) return; // « Terminer » cliqué entre-temps
            const resp = await fetchWithTimeout('https://api.openai.com/v1/live/sessions', {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${getApiKey()}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ session, transport: { type: 'webrtc', sdp: offer.sdp } })
            }, 20000);
            if (!resp.ok) {
                const err = await resp.json().catch(() => ({}));
                throw new Error((err.error && err.error.message) || `HTTP ${resp.status}`);
            }
            const data = await resp.json();
            const answerSdp = data.transport && data.transport.sdp;
            if (!answerSdp) throw new Error('Réponse inattendue : ' + JSON.stringify(data).substring(0, 300));
            if (myEpoch !== connectionEpoch) return;
            await pc.setRemoteDescription({ type: 'answer', sdp: answerSdp });
        } catch (err) {
            if (myEpoch === connectionEpoch) handleConnectionFailure(`Erreur GPT Live : ${err.message}`);
        }
    }

    // Session prête (data channel ouvert ou session.started) — idempotent.
    function liveMarkConnected(persona) {
        if (isConnected) return;
        isConnected = true;
        micReady = true; // full duplex : on peut parler tout de suite, même pendant la salutation
        updateOrbCenterBtn('connected');
        setStatus('Connecté, parlez !', 'connected');
        // Salutation : pas de response.create ici — on ajoute une consigne
        // (technique recommandée par la doc) demandant de parler en premier.
        if (persona && persona.greeting !== 'user') {
            liveSend({
                type: 'session.instructions.append',
                delegation_id: null,
                content: 'Commence la conversation maintenant : salue immédiatement l\'utilisateur en français, sans attendre qu\'il parle, puis laisse-le parler.'
            });
        }
    }

    // Les fragments de transcription GPT-Live suivent la cadence AUDIO, pas les
    // mots : « Tu m » + « 'ent » + « ends ». Ils portent leurs propres espaces
    // (comme les deltas Realtime) → concaténation VERBATIM, surtout pas
    // d'espace « intelligent » entre fragments (ça donnait « Tu m 'ent ends »).
    // Pas d'événement de fin de tour non plus : une bulle par locuteur reste
    // ouverte tant que ce locuteur ne s'est pas tu pendant LIVE_TURN_GAP_MS,
    // même si l'autre parle entre-temps (full duplex : les deux se chevauchent).
    const LIVE_TURN_GAP_MS = 2500;

    function liveAppendAi(delta, personaName) {
        if (!delta) return;
        if (!currentTranscriptAi) {
            currentTranscriptAi = addTranscriptMessage(personaName, '', 'ai');
            aiStartTurn();
            setStatus(`${personaName} parle...`, 'connected');
            delta = delta.replace(/^\s+/, ''); // pas d'espace en tête de bulle
        }
        currentTranscriptAi.querySelector('.text').textContent += delta;
        // Texte live : sans chunks audio à lier, on révèle au rythme estimé
        // de la parole (aiFlushPending).
        aiQueueText(delta);
        aiFlushPending();
        scrollTranscript();
        clearTimeout(liveAiIdleTimer);
        liveAiIdleTimer = setTimeout(() => {
            currentTranscriptAi = null;
            endAITurn();
            if (isConnected) setStatus('Connecté, parlez !', 'connected');
        }, LIVE_TURN_GAP_MS);
    }

    function liveAppendUser(delta) {
        if (!delta) return;
        const el = document.getElementById('transcript');
        if (!currentTranscriptUser) {
            const placeholder = el.querySelector('.transcript-empty');
            if (placeholder) placeholder.remove();
            currentTranscriptUser = document.createElement('div');
            currentTranscriptUser.className = 'transcript-msg user';
            currentTranscriptUser.innerHTML = `<div class="sender">${esc('Moi')}</div><div class="text"></div>`;
            el.appendChild(currentTranscriptUser);
            userStartTurn();
            delta = delta.replace(/^\s+/, '');
        }
        currentTranscriptUser.querySelector('.text').textContent += delta;
        appendUserLive(delta, true); // true : verbatim, sans espace ajouté
        scrollTranscript();
        clearTimeout(liveUserIdleTimer);
        liveUserIdleTimer = setTimeout(() => { currentTranscriptUser = null; }, LIVE_TURN_GAP_MS);
    }

    function handleLiveServerEvent(data) {
        const persona = getPersonas().find(p => p.id === getActiveId());
        const personaName = persona ? persona.name : 'IA';

        switch (data.type) {
            case 'session.started':
                liveMarkConnected(persona);
                break;

            case 'session.output_transcript.delta':
                liveAppendAi(data.delta, personaName);
                break;

            case 'session.input_transcript.delta':
                liveAppendUser(data.delta);
                break;

            case 'session.delegation.created':
                setStatus(`${personaName} réfléchit...`, 'connected');
                break;

            // Enveloppe des événements Responses du backend : appels de
            // fonction à exécuter ici, et usage (tokens) en fin de réponse.
            case 'response.event': {
                const ev = data.event || {};
                if (ev.type === 'response.output_item.done' && ev.item && ev.item.type === 'function_call') {
                    handleLiveFunctionCall(ev.item);
                } else if (ev.type === 'response.completed' && ev.response && ev.response.usage) {
                    // Formule d'OpenAI : entrée ordinaire = input_tokens
                    // − cached_tokens − cache_write_tokens ; le cache se paie
                    // 10 fois moins, l'écriture en cache 1,25 fois plus.
                    // Les tokens de raisonnement sont déjà dans output_tokens.
                    const u = ev.response.usage;
                    const bp = PRICING[GPT_LIVE_BACKEND_MODEL] || {};
                    const d = u.input_tokens_details || {};
                    const inTok  = u.input_tokens || 0;
                    const cached = Math.min(d.cached_tokens || 0, inTok);
                    const write  = Math.min(d.cache_write_tokens || 0, inTok - cached);
                    totalInputTokens += Math.round((inTok - cached - write)
                        + tokensAtRate(cached, bp.cachedInput,     bp.input)
                        + tokensAtRate(write,  bp.cacheWriteInput, bp.input));
                    totalOutputTokens += u.output_tokens || 0;
                    totalInputTokensRaw  += inTok;
                    totalOutputTokensRaw += u.output_tokens || 0;
                    // Recherches web du backend : $10 les 1 000, en plus des
                    // tokens de contenu, déjà dans usage.
                    sessionToolCost += countWebSearchCalls(ev.response.output) * WEB_SEARCH_FEE.openai;
                    updateTokenCounter();
                } else if (ev.type === 'response.failed' || ev.type === 'error') {
                    console.error('[Live] Erreur backend :', ev);
                }
                break;
            }

            case 'session.usage.updated':
                // Durée cumulée côté serveur — on la calcule déjà localement.
                break;

            case 'session.closed':
                handleConnectionFailure(data.reason === 'expired'
                    ? 'Session GPT Live expirée (durée maximale atteinte)'
                    : `Session GPT Live terminée (${data.reason || 'fermée'})`);
                break;

            case 'error':
                console.error('[Live] Erreur :', data.error);
                // Une erreur de commande ne ferme pas forcément une session déjà
                // démarrée ; une erreur AVANT le démarrage, si.
                if (isConnected) setStatus(`Erreur GPT Live : ${data.error?.message || 'inconnue'}`, 'error');
                else handleConnectionFailure(`Erreur GPT Live : ${data.error?.message || 'inconnue'}`);
                break;
        }
    }

    // Appel de fonction délégué : exécuté par l'exécuteur unique Vart (météo,
    // date, sources, historique, notes, calcul, URL), puis renvoyé au backend
    // (response.item.create) suivi d'une relance (response.create) — l'ajout
    // seul ne relance pas la réponse.
    async function handleLiveFunctionCall(item) {
        let args;
        try { args = JSON.parse(item.arguments || '{}'); } catch { args = {}; }
        const output = await executeVartTool(item.name, args);
        liveSend({ type: 'response.item.create', item: { type: 'function_call_output', call_id: item.call_id, output } });
        liveSend({ type: 'response.create' });
    }

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

