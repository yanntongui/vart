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

