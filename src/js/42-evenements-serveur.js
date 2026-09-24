    function handleServerEvent(data) {
        const persona = getPersonas().find(p => p.id === getActiveId());
        const personaName = persona ? persona.name : 'IA';

        switch (data.type) {
            case 'session.created':
                break;
            case 'session.updated':
                // Salutation initiale. ⚠ Un `response.create` NU demande au
                // modèle de parler dans une conversation VIDE : il invente
                // alors un tour utilisateur qui n'a jamais eu lieu et répond à
                // côté (« D'accord, je vais jeter un oeil à ton idée… »,
                // « Ah, très bien ! »), surtout sur les petits modèles comme
                // gpt-realtime-2.1-mini. On lui dit donc explicitement ce
                // qu'est cette prise de parole.
                // `response.instructions` REMPLACE les instructions de session
                // pour cette réponse : on renvoie le prompt complet du persona,
                // sinon la salutation sortirait hors personnage.
                if (persona && persona.greeting !== 'user' && ws && ws.readyState === WebSocket.OPEN) {
                    waitingGreeting = true;
                    requestRealtimeResponse({ instructions: buildFullInstructions(persona) + GREETING_DIRECTIVE });
                } else {
                    micReady = true;
                }
                break;

            case 'response.audio.delta':
            case 'response.output_audio.delta':
                playAudioChunk(data.delta);
                break;

            case 'response.audio.done':
            case 'response.output_audio.done':
                break;

            // Transcription IA (streaming)
            case 'response.audio_transcript.delta':
            case 'response.output_audio_transcript.delta':
                if (!currentTranscriptAi) {
                    currentTranscriptAi = addTranscriptMessage(personaName, '', 'ai');
                    turnAiBubble = currentTranscriptAi; // ancre pour une transcription user tardive
                    aiStartTurn(); // nouveau tour : on vide le buffer + le DOM
                }
                currentTranscriptAi.querySelector('.text').textContent += data.delta;
                aiQueueText(data.delta);
                scrollTranscript();
                break;

            case 'response.audio_transcript.done':
            case 'response.output_audio_transcript.done':
                currentTranscriptAi = null;
                endAITurn();
                break;

            // Transcription user — delta (streaming temps réel quand le modèle de transcription le supporte)
            case 'conversation.item.input_audio_transcription.delta':
                if (data.delta) appendUserLive(data.delta);
                break;

            // Transcription user — xAI envoie le transcript CUMULÉ du tour (il peut
            // corriger ce qu'il a déjà envoyé) → on remplace au lieu d'ajouter.
            case 'conversation.item.input_audio_transcription.updated': {
                const full = data.transcript ?? data.delta ?? data.text;
                if (full) {
                    if (!userTurnActive) userStartTurn();
                    userLiveBuffer = '';
                    appendUserLive(full);
                }
                break;
            }

            // Transcription user — version finale propre
            case 'conversation.item.input_audio_transcription.completed':
                // Chaque tour transcrit est facturé à sa durée (OpenAI
                // seulement : Grok passe aussi par ce gestionnaire).
                if (activeProvider === 'openai') recordTranscriptionUsage(data.usage, data.transcript);
                if (data.transcript && data.transcript.trim()) {
                    // Insert user message BEFORE the current AI response to maintain correct order
                    const el = document.getElementById('transcript');
                    const placeholder = el.querySelector('.transcript-empty');
                    if (placeholder) placeholder.remove();

                    const msg = document.createElement('div');
                    msg.className = 'transcript-msg user';
                    msg.innerHTML = `<div class="sender">${esc('Moi')}</div><div class="text">${esc(data.transcript.trim())}</div>`;

                    // Ordre correct : insérer AVANT la réponse IA de CE tour.
                    // - réponse en cours de streaming → currentTranscriptAi ;
                    // - réponse déjà terminée mais transcription user en retard →
                    //   turnAiBubble (même tour) ;
                    // - IA pas encore répondu → append (elle viendra après).
                    const anchor = (currentTranscriptAi && currentTranscriptAi.parentNode === el) ? currentTranscriptAi
                                 : (turnAiBubble && turnAiBubble.parentNode === el) ? turnAiBubble
                                 : null;
                    if (anchor) el.insertBefore(msg, anchor);
                    else el.appendChild(msg);
                    setUserLive(data.transcript.trim());
                    scrollTranscript();
                }
                break;

            case 'input_audio_buffer.speech_started':
                stopPlayback();
                turnAiBubble = null; // nouveau tour utilisateur : on oublie l'ancre du tour précédent
                userStartTurn();
                setStatus('Vous parlez...', 'connected');
                break;

            case 'input_audio_buffer.speech_stopped':
                setStatus(`${personaName} réfléchit...`, 'connected');
                break;

            case 'response.created':
                realtimeResponseActive = true;
                setStatus(`${personaName} parle...`, 'connected');
                break;

            case 'response.output_item.done':
                if (activeProvider === 'xai' && data.item) countGrokSearches([data.item], false, data.response_id);
                break;

            case 'response.done':
                if (activeProvider === 'xai') countGrokSearches(data.response && data.response.output, true, data.response && data.response.id);
                setStatus('Connecté, parlez !', 'connected');
                // Tokens
                if (data.response?.usage) {
                    const u = data.response.usage;
                    const p = PRICING[activeModelId] || {};
                    // Entrée, ventilée par modalité ET par cache. D'après la
                    // référence OpenAI, les tokens en cache sont un SOUS-
                    // ENSEMBLE des tokens d'entrée : text_tokens inclut le texte
                    // en cache, qu'on retire donc avant de facturer le reste au
                    // plein tarif. Sans détail, tout reste en audio non caché,
                    // comme avant (surestimation, jamais l'inverse).
                    const total = u.input_tokens || 0;
                    const det = u.input_token_details || {};
                    const cd  = det.cached_tokens_details || {};
                    const text  = Math.min(det.text_tokens  || 0, total);
                    const image = Math.min(det.image_tokens || 0, total - text);
                    const audio = total - text - image;
                    const cText  = Math.min(cd.text_tokens  || 0, text);
                    const cImage = Math.min(cd.image_tokens || 0, image);
                    const cAudio = Math.min(cd.audio_tokens || 0, audio);
                    totalInputTokens += Math.round(
                          (audio - cAudio)
                        + tokensAtRate(cAudio,         p.cachedInput,      p.input)
                        + tokensAtRate(text - cText,   p.textInput,        p.input)
                        + tokensAtRate(cText,          p.cachedTextInput,  p.input)
                        + tokensAtRate(image - cImage, p.imageInput,       p.input)
                        + tokensAtRate(cImage,         p.cachedImageInput, p.input));
                    // Sortie : l'audio au tarif de référence, le texte au sien.
                    const outTotal = u.output_tokens || 0;
                    const outText = Math.min((u.output_token_details || {}).text_tokens || 0, outTotal);
                    totalOutputTokens += Math.round((outTotal - outText)
                        + tokensAtRate(outText, p.textOutput, p.output));
                    totalInputTokensRaw  += total;
                    totalOutputTokensRaw += outTotal;
                    updateTokenCounter();
                }
                // Activer le micro après le greeting initial — sauf si la
                // salutation a commencé par un appel d'outil : elle n'est pas
                // encore prononcée, sa suite arrive dans la réponse suivante.
                const calledTool = (data.response && Array.isArray(data.response.output) ? data.response.output : [])
                    .some(it => it && it.type === 'function_call');
                if (waitingGreeting && !calledTool) {
                    waitingGreeting = false;
                    setTimeout(() => { micReady = true; }, 500);
                }
                currentTranscriptAi = null;
                // Réponse terminée : on rejoue la demande mise en attente.
                flushPendingResponse();
                break;

            // Function calling
            case 'response.function_call_arguments.delta':
                if (!pendingFunctionCalls[data.item_id]) pendingFunctionCalls[data.item_id] = { args: '' };
                pendingFunctionCalls[data.item_id].args += data.delta;
                break;

            case 'response.function_call_arguments.done':
                handleFunctionCall(data);
                break;

            case 'error': {
                const err = data.error || {};
                const origin = String(err.event_id || '');
                // Réponse déjà en cours : la demande sera rejouée à la fin de
                // celle-ci. Pas une panne.
                if (err.code === 'conversation_already_has_active_response') {
                    realtimeResponseActive = true;
                    if (!pendingResponseCreate) pendingResponseCreate = {};
                    break;
                }
                // Image refusée par le modèle : on le dit, la conversation continue.
                if (origin.startsWith('vart_img_')) {
                    console.warn('Image refusée :', err);
                    setStatus('Image refusée par le modèle', 'error');
                    break;
                }
                // Une de nos demandes de réponse a échoué : on libère la file.
                if (origin.startsWith('vart_resp_')) {
                    console.warn('Demande de réponse refusée :', err);
                    flushPendingResponse();
                    break;
                }
                console.error('API Error:', err);
                handleConnectionFailure(`Erreur : ${err.message || 'inconnue'}`);
                break;
            }
        }
    }

    async function handleFunctionCall(data) {
        let args;
        try { args = JSON.parse(data.arguments); } catch { args = {}; }

        // web_search est propre au Realtime OpenAI (performWebSearch maison) ;
        // tout le reste passe par l'exécuteur unique Vart (Phase 2).
        let result = '';
        if (data.name === 'web_search') {
            result = await performWebSearch(args.query || '');
        } else {
            result = await executeVartTool(data.name, args);
        }

        delete pendingFunctionCalls[data.item_id];

        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
                type: 'conversation.item.create',
                item: { type: 'function_call_output', call_id: data.call_id, output: result }
            }));
            // Si la salutation a commencé par cet outil, sa suite garde la
            // consigne d'ouverture ; sinon le modèle réinvente un échange.
            const persona = waitingGreeting ? getPersonas().find(p => p.id === getActiveId()) : null;
            requestRealtimeResponse(persona ? { instructions: buildFullInstructions(persona) + GREETING_DIRECTIVE } : null);
        }
    }


    function handleGeminiServerEvent(data) {
        const persona = getPersonas().find(p => p.id === getActiveId());
        const personaName = persona ? persona.name : 'IA';

        // usageMetadata — comptage de tokens.
        // ⚠ Gemini envoie usageMetadata DANS LE MÊME message que serverContent
        // (voir docs Live API : « usageMetadata appears at the top-level of
        // the message »). Il faut donc le lire AVANT les early returns des
        // autres handlers, sinon les tokens ne sont jamais comptés et le coût
        // reste à $0.0000.
        const usage = data.usageMetadata || data.usage_metadata;
        if (usage) {
            // Le prix dépend de la modalité ($3 audio, $0.75 texte, $1 image
            // en entrée ; $12 audio, $4.50 texte en sortie). Le détail par
            // modalité permet de convertir chaque part en « équivalent audio »
            // pour que le coût reste juste sans dupliquer la chaîne de calcul.
            // Détail absent → tout reste au tarif audio, comme avant.
            const p = PRICING[activeModelId] || {};

            // Entrée. Le texte compte à CHAQUE tour (le contexte, instructions
            // du persona comprises, est refacturé à chaque génération) : le
            // facturer au tarif audio le surestimait d'un facteur 4.
            const prompt = usage.promptTokenCount || usage.prompt_token_count || 0;
            const pd = geminiModalityCounts(usage.promptTokensDetails || usage.prompt_tokens_details);
            const inText = Math.min(pd.TEXT, prompt);
            const inImg  = Math.min(pd.IMAGE + pd.VIDEO, prompt - inText);
            totalInputTokens += Math.round((prompt - inText - inImg)
                + tokensAtRate(inText, p.textInput, p.input)
                + tokensAtRate(inImg,  p.imageInput, p.input));

            // Sortie. La réflexion (Extended Thinking) arrive dans
            // thoughtsTokenCount, À CÔTÉ de responseTokenCount — Google : « la
            // réponse est facturée comme la somme des tokens de sortie et de
            // réflexion ». Elle était jusqu'ici ignorée. C'est du texte, donc
            // au tarif de sortie texte ; le tableau de prix ne distingue la
            // sortie que par modalité.
            const resp = usage.responseTokenCount || usage.response_token_count || 0;
            const rd = geminiModalityCounts(usage.responseTokensDetails || usage.response_tokens_details);
            const outText  = Math.min(rd.TEXT, resp);
            const thoughts = usage.thoughtsTokenCount || usage.thoughts_token_count || 0;
            totalOutputTokens += Math.round((resp - outText)
                + tokensAtRate(outText + thoughts, p.textOutput, p.output));
            totalInputTokensRaw  += prompt;
            totalOutputTokensRaw += resp + thoughts;
            updateTokenCounter();
        }

        // Jeton de reprise : le dernier reçu permet de rouvrir la session.
        const sru = data.sessionResumptionUpdate || data.session_resumption_update;
        if (sru) {
            const handle = sru.newHandle || sru.new_handle || sru.token;
            if (sru.resumable !== false && handle) geminiResumeHandle = handle;
        }

        // Le serveur va fermer la connexion : relais dès que le modèle a fini
        // sa réplique, et au plus tard un peu avant l'échéance annoncée.
        const goAway = data.goAway || data.go_away;
        if (goAway) {
            geminiHandoffPending = true;
            if (!geminiModelSpeaking) {
                geminiHandoff();
            } else {
                const left = parseProtoDurationMs(goAway.timeLeft || goAway.time_left);
                if (geminiHandoffTimer) clearTimeout(geminiHandoffTimer);
                geminiHandoffTimer = setTimeout(geminiHandoff, Math.max(0, left - 1500));
            }
            return;
        }

        // setupComplete — session prête
        if (data.setupComplete !== undefined) {
            // Connexion rouverte sur une session existante : la conversation
            // continue telle quelle (pas de salutation, rien à réinitialiser).
            if (geminiResuming) {
                geminiResuming = false;
                geminiResumeAttempts = 0;
                updateOrbCenterBtn('connected');
                setStatus('Connecté, parlez !', 'connected');
                return;
            }
            isConnected = true;
            geminiResumeAttempts = 0;
            updateOrbCenterBtn('connected');
            setStatus('Connecté, parlez !', 'connected');
            // (Plus d'avertissement « limitée à 15 min » : la compression de
            // contexte et la reprise de session lèvent ces limites.)

            // Greeting initial
            if (persona && persona.greeting !== 'user' && ws && ws.readyState === WebSocket.OPEN) {
                waitingGreeting = true;
                // Demander à Gemini de parler en premier avec un message texte vide
                ws.send(JSON.stringify({
                    clientContent: {
                        turns: [{ role: 'user', parts: [{ text: 'Commence la conversation en me saluant.' }] }],
                        turnComplete: true
                    }
                }));
            } else {
                micReady = true;
            }
            return;
        }

        // serverContent — audio, transcription, fin de tour, interruption
        if (data.serverContent) {
            const sc = data.serverContent;

            // Interruption
            if (sc.interrupted) {
                geminiModelSpeaking = false;
                if (geminiHandoffPending) geminiHandoff();
                stopPlayback();
                setStatus(`${personaName} interrompu`, 'connected');
                // Clore les bulles en cours : sans ça, le tour IA suivant
                // s'ajouterait dans l'ancienne bulle abandonnée (fusion des tours).
                currentTranscriptAi = null;
                currentTranscriptUser = null;
                return;
            }

            // Audio du modèle (traiter EN PREMIER, avant les transcriptions)
            if (sc.modelTurn && sc.modelTurn.parts) {
                geminiModelSpeaking = true;
                setStatus(`${personaName} parle...`, 'connected');
                for (const part of sc.modelTurn.parts) {
                    // Gemini peut utiliser inlineData (camelCase) ou inline_data (snake_case)
                    const inline = part.inlineData || part.inline_data;
                    if (inline && inline.data) {
                        playAudioChunk(inline.data);
                    }
                }
            }

            // Transcription de l'entrée utilisateur : Gemini envoie des DELTAS,
            // on les accumule dans UNE SEULE bulle (comme pour la sortie IA),
            // au lieu de créer une nouvelle bulle par fragment.
            if (sc.inputTranscription && sc.inputTranscription.text) {
                const delta = sc.inputTranscription.text;
                const el = document.getElementById('transcript');
                const placeholder = el.querySelector('.transcript-empty');
                if (placeholder) placeholder.remove();
                if (!currentTranscriptUser) {
                    currentTranscriptUser = document.createElement('div');
                    currentTranscriptUser.className = 'transcript-msg user';
                    currentTranscriptUser.innerHTML = `<div class="sender">${esc('Moi')}</div><div class="text"></div>`;
                    if (currentTranscriptAi && currentTranscriptAi.parentNode === el) {
                        el.insertBefore(currentTranscriptUser, currentTranscriptAi);
                    } else {
                        el.appendChild(currentTranscriptUser);
                    }
                }
                currentTranscriptUser.querySelector('.text').textContent += delta;
                appendUserLive(delta);
                scrollTranscript();
            }

            // Transcription de la sortie IA
            if (sc.outputTranscription && sc.outputTranscription.text) {
                if (!currentTranscriptAi) {
                    currentTranscriptAi = addTranscriptMessage(personaName, '', 'ai');
                    aiStartTurn();
                }
                currentTranscriptAi.querySelector('.text').textContent += sc.outputTranscription.text;
                aiQueueText(sc.outputTranscription.text);
                scrollTranscript();
            }

            // Fin de tour
            if (sc.turnComplete) {
                geminiModelSpeaking = false;
                setStatus('Connecté, parlez !', 'connected');
                currentTranscriptAi = null;
                currentTranscriptUser = null;
                endAITurn();
                if (waitingGreeting) {
                    waitingGreeting = false;
                    setTimeout(() => { micReady = true; }, 500);
                }
                // Relais demandé pendant la réplique : c'est le moment.
                if (geminiHandoffPending) geminiHandoff();
            }
            return;
        }

        // toolCall — appels de fonctions
        if (data.toolCall) {
            handleGeminiFunctionCall(data.toolCall);
            return;
        }

        // toolCallCancellation — annulation d'appel de fonction
        if (data.toolCallCancellation) {
            return;
        }
        // (usageMetadata est traité en tête de la fonction — voir plus haut.)
    }

    async function handleGeminiFunctionCall(toolCall) {
        if (!toolCall.functionCalls || !toolCall.functionCalls.length) return;

        const responses = [];

        for (const fc of toolCall.functionCalls) {
            // Exécuteur unique Vart (Phase 2) : météo, date, sources,
            // historique, notes, calcul, URL — Gemini attend un objet.
            const result = await executeVartToolObj(fc.name, fc.args || {});
            responses.push({ name: fc.name, id: fc.id, response: { result: result } });
        }

        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
                toolResponse: { functionResponses: responses }
            }));
        }
    }


