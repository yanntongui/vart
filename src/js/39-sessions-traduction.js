    function connectTranslate(persona) {
        if (!getApiKey()) return;
        const url = `wss://api.openai.com/v1/realtime/translations?model=gpt-realtime-translate`;

        ws = new WebSocket(url, [
            'realtime',
            `openai-insecure-api-key.${getApiKey()}`
        ]);

        ws.onopen = () => {
            isConnected = true;
            updateOrbCenterBtn('connected');
            // Mode Traducteur global : on lit la langue depuis le storage.
            // Mode legacy (persona configuré avec model=translate) : fallback
            // sur persona.translateLang pour les anciennes configurations.
            const lang = isTraducteurMode ? getTranslateLang() : (persona && persona.translateLang) || 'en';
            const info = translateLangInfo(lang);
            setStatus(`Traduction en ${info.name.toLowerCase()}, parlez !`, 'connected');

            ws.send(JSON.stringify({
                type: 'session.update',
                session: {
                    audio: {
                        output: {
                            language: lang
                        }
                    }
                }
            }));
            micReady = true;
        };

        ws.onmessage = (e) => handleTranslateServerEvent(JSON.parse(e.data));
        ws.onerror = () => handleConnectionFailure('Erreur de connexion');
        ws.onclose = (e) => {
            if (e.code !== 1000) handleConnectionFailure(`Déconnecté (code ${e.code})`);
            else isConnected = false;
        };
    }

    function handleTranslateServerEvent(data) {
        switch (data.type) {
            case 'session.created':
            case 'session.updated':
                break;

            case 'session.output_audio.delta':
                playAudioChunk(data.delta);
                break;

            case 'session.output_audio.done':
                break;

            case 'session.output_transcript.delta':
                if (!currentTranscriptAi) {
                    currentTranscriptAi = addTranscriptMessage('Traduction', '', 'ai');
                }
                currentTranscriptAi.querySelector('.text').textContent += data.delta;
                scrollTranscript();
                break;

            case 'session.output_transcript.done':
                currentTranscriptAi = null;
                break;

            case 'error':
                console.error('Translate API Error:', data.error);
                handleConnectionFailure(`Erreur : ${data.error?.message || 'inconnue'}`);
                break;
        }
    }

    // ── Traduction via Gemini Live Translate (gemini-3.5-live-translate-preview) ──
    // Modèle « interprète » : flux audio continu, pas de tours, pas d'outils ni
    // d'instructions. Entrée PCM 16 kHz, sortie PCM 24 kHz (comme les autres
    // modèles Gemini). L'audio est envoyé par startMicrophone() via le même
    // chemin `realtimeInput` que le mode conversation Gemini (activeProvider === 'gemini').
    // Traducteur Gemini : même limite qu'ailleurs (une connexion vit ~10 min,
    // une session sans compression 15 min). La reprise de session n'est pas
    // documentée pour ce modèle, et une traduction n'a pas besoin de mémoire :
    // on relaie simplement vers une NOUVELLE session, comme le Transcripteur,
    // au goAway du serveur ou au plus tard au bout de 9 minutes.
    let geminiTranslateRolloverTimer = null;
    let geminiTranslateRollingOver = false;
    const GEMINI_TRANSLATE_ROLLOVER_MS = 9 * 60 * 1000;

    function rolloverGeminiTranslate() {
        if (geminiTranslateRolloverTimer) { clearTimeout(geminiTranslateRolloverTimer); geminiTranslateRolloverTimer = null; }
        if (!isConnected || !isTraducteurMode || activeProvider !== 'gemini' || !ws) return;
        currentTranscriptAi = null; // la traduction suivante ouvre sa propre bulle
        const old = ws;
        old.onopen = old.onmessage = old.onerror = old.onclose = null;
        ws = null;
        try { old.close(1000); } catch (e) {}
        geminiTranslateRollingOver = true;
        connectGeminiTranslate();
    }

    function connectGeminiTranslate() {
        if (!getGeminiApiKey()) return;
        const url = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${getGeminiApiKey()}`;
        const sock = new WebSocket(url);
        ws = sock;

        sock.onopen = () => {
            if (ws !== sock) return;
            if (!geminiTranslateRollingOver) setStatus('Configuration Gemini...');
            // ⚠ Sur l'API WebSocket brute (BidiGenerateContent), les
            // transcriptions se déclarent au niveau `setup`, PAS dans
            // `generationConfig` (contrairement à l'exemple SDK de la doc, qui
            // les remappe). Les y laisser renvoie une erreur 1007 « Unknown name
            // inputAudioTranscription at setup.generation_config ». Le mode
            // conversation Gemini les place déjà correctement au niveau setup.
            const setupMessage = {
                setup: {
                    model: `models/${activeModelId}`,
                    generationConfig: {
                        responseModalities: ['AUDIO'],
                        translationConfig: {
                            targetLanguageCode: getTranslateLang(),
                            // false : reste silencieux si la parole est déjà dans la
                            // langue cible (comportement « traducteur pur »).
                            echoTargetLanguage: false
                        }
                    },
                    inputAudioTranscription: {},
                    outputAudioTranscription: {}
                }
            };
            sock.send(JSON.stringify(setupMessage));
        };

        sock.onmessage = async (e) => {
            if (ws !== sock) return;
            try {
                const text = (e.data instanceof Blob) ? await e.data.text() : e.data;
                if (ws !== sock) return;
                handleGeminiTranslateServerEvent(JSON.parse(text));
            } catch (err) {
                console.error('Erreur parsing Gemini translate:', err, e.data);
            }
        };
        sock.onerror = () => { if (ws === sock) handleConnectionFailure('Erreur de connexion Gemini'); };
        sock.onclose = (e) => {
            if (ws !== sock) return;
            if (e.code !== 1000) handleConnectionFailure(`Gemini déconnecté (code ${e.code}${e.reason ? ' - ' + e.reason : ''})`);
            else isConnected = false;
        };
    }

    function handleGeminiTranslateServerEvent(data) {
        // usageMetadata au top-level (même message que serverContent) → tokens.
        const usage = data.usageMetadata || data.usage_metadata;
        if (usage) {
            const inTok  = usage.promptTokenCount   || usage.prompt_token_count   || 0;
            const outTok = usage.responseTokenCount || usage.response_token_count || 0;
            totalInputTokens  += inTok;
            totalOutputTokens += outTok;
            totalInputTokensRaw  += inTok;
            totalOutputTokensRaw += outTok;
            updateTokenCounter();
        }

        if (data.setupComplete !== undefined) {
            isConnected = true;
            micReady = true;
            updateOrbCenterBtn('connected');
            const info = translateLangInfo(getTranslateLang());
            setStatus(`Traduction en ${info.name.toLowerCase()}, parlez !`, 'connected');
            geminiTranslateRollingOver = false;
            // Relais préventif, avant les limites de connexion et de session.
            if (geminiTranslateRolloverTimer) clearTimeout(geminiTranslateRolloverTimer);
            geminiTranslateRolloverTimer = setTimeout(rolloverGeminiTranslate, GEMINI_TRANSLATE_ROLLOVER_MS);
            return;
        }

        // Le serveur annonce la fin de la connexion : relais immédiat.
        if (data.goAway !== undefined || data.go_away !== undefined) { rolloverGeminiTranslate(); return; }

        if (data.serverContent) {
            const sc = data.serverContent;
            // Audio traduit (inlineData / inline_data selon les cas)
            if (sc.modelTurn && sc.modelTurn.parts) {
                for (const part of sc.modelTurn.parts) {
                    const inline = part.inlineData || part.inline_data;
                    if (inline && inline.data) playAudioChunk(inline.data);
                }
            }
            // Transcription de la sortie (la traduction) → message « Traduction »,
            // comme le mode traducteur OpenAI.
            if (sc.outputTranscription && sc.outputTranscription.text) {
                if (!currentTranscriptAi) currentTranscriptAi = addTranscriptMessage('Traduction', '', 'ai');
                currentTranscriptAi.querySelector('.text').textContent += sc.outputTranscription.text;
                scrollTranscript();
            }
            if (sc.turnComplete) currentTranscriptAi = null;
            return;
        }
    }

