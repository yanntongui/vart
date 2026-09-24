    // ── Reprise de session Gemini Live (conversation) ─────────────────────
    // Une connexion WebSocket Gemini ne vit qu'une dizaine de minutes : le
    // serveur prévient (goAway), puis coupe. Avec `sessionResumption`, il
    // envoie régulièrement un jeton (sessionResumptionUpdate) qui permet de
    // rouvrir une connexion sur la MÊME session, mémoire comprise (jeton
    // valable 2 h). Vart garde le dernier jeton et se reconnecte sans bruit :
    // transcription, micro, vision et compteur de coût continuent.
    //  • goAway : relais planifié, à la fin de la réplique en cours (sans
    //    dépasser le délai accordé par le serveur) ;
    //  • coupure inattendue (réseau, redémarrage serveur) : jusqu'à 3
    //    tentatives rapprochées, puis on abandonne comme avant.
    let geminiResumeHandle = null;
    let geminiResuming = false;       // la prochaine setupComplete est une reprise
    let geminiResumeAttempts = 0;     // tentatives consécutives sans succès
    let geminiModelSpeaking = false;  // une réplique du modèle est en cours
    let geminiHandoffPending = false; // goAway reçu, relais à faire
    let geminiHandoffTimer = null;
    let geminiResumeTimer = null;
    const GEMINI_RESUME_MAX_ATTEMPTS = 3;
    // Codes de fermeture qui justifient une reprise. Pas 1007 ni 1008 :
    // requête invalide ou refusée (clé, quota, paramètre), qui échoueraient
    // pareil à chaque tentative.
    const GEMINI_RESUMABLE_CLOSE_CODES = new Set([1000, 1001, 1006, 1011, 1012, 1013, 1014]);

    function resetGeminiResumeState() {
        geminiResumeHandle = null;
        geminiResuming = false;
        geminiResumeAttempts = 0;
        geminiModelSpeaking = false;
        geminiHandoffPending = false;
        if (geminiHandoffTimer) { clearTimeout(geminiHandoffTimer); geminiHandoffTimer = null; }
        if (geminiResumeTimer) { clearTimeout(geminiResumeTimer); geminiResumeTimer = null; }
    }

    // Durée protobuf (« 10s », « 9.5s ») en millisecondes.
    function parseProtoDurationMs(d) {
        const m = /^([\d.]+)s$/.exec(String(d || ''));
        return m ? parseFloat(m[1]) * 1000 : 0;
    }

    // Session de conversation Gemini toujours en cours ?
    function geminiConversationLive() {
        return isConnected && activeProvider === 'gemini' && !isTranscripteurMode && !isTraducteurMode;
    }

    // Relais planifié (goAway) : on ferme l'ancienne connexion sans passer
    // par ses gestionnaires et on en ouvre une nouvelle sur la même session.
    // Sans jeton (improbable après 10 min), on repart sur une session neuve :
    // le modèle perd le fil, mais la conversation ne s'arrête pas net.
    function geminiHandoff() {
        geminiHandoffPending = false;
        if (geminiHandoffTimer) { clearTimeout(geminiHandoffTimer); geminiHandoffTimer = null; }
        if (!geminiConversationLive()) return;
        const persona = getPersonas().find(p => p.id === getActiveId());
        if (!persona) return;
        const old = ws;
        if (old) {
            old.onopen = old.onmessage = old.onerror = old.onclose = null;
            try { old.close(1000); } catch (e) {}
        }
        geminiResuming = true;
        connectGemini(persona, geminiResumeHandle);
    }

    // Coupure inattendue : reprise si c'est possible, sinon false (l'appelant
    // signale l'échec comme avant).
    function geminiTryResume(code) {
        if (!geminiConversationLive() || !geminiResumeHandle) return false;
        if (!GEMINI_RESUMABLE_CLOSE_CODES.has(code)) return false;
        if (geminiResumeAttempts >= GEMINI_RESUME_MAX_ATTEMPTS) return false;
        geminiResumeAttempts++;
        const epoch = connectionEpoch;
        setStatus('Connexion interrompue, reprise de la conversation…');
        if (geminiResumeTimer) clearTimeout(geminiResumeTimer);
        geminiResumeTimer = setTimeout(() => {
            geminiResumeTimer = null;
            if (epoch !== connectionEpoch || !geminiConversationLive()) return;
            const persona = getPersonas().find(p => p.id === getActiveId());
            if (!persona) return;
            geminiResuming = true;
            connectGemini(persona, geminiResumeHandle);
        }, 400 * geminiResumeAttempts); // 0,4 s, 0,8 s, 1,2 s
        return true;
    }

    // `resumeHandle` : jeton d'une session à reprendre, ou null pour une
    // nouvelle conversation.
    function connectGemini(persona, resumeHandle = null) {
        if (!getGeminiApiKey()) return;
        const url = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${getGeminiApiKey()}`;

        if (!resumeHandle && !geminiResuming) resetGeminiResumeState(); // nouvelle conversation
        // Les gestionnaires ignorent un socket qui n'est plus le socket
        // courant (ancienne connexion après un relais).
        const sock = new WebSocket(url);
        ws = sock;

        sock.onopen = () => {
            if (ws !== sock) return;
            if (!geminiResuming) setStatus('Configuration Gemini...');

            const fullInstructions = buildFullInstructions(persona);

            // VAD presets adaptés pour Gemini
            const vadPresets = {
                'reactive':      { start: 'START_SENSITIVITY_HIGH', end: 'END_SENSITIVITY_HIGH', silenceDurationMs: 400 },
                'balanced':      { start: 'START_SENSITIVITY_HIGH', end: 'END_SENSITIVITY_LOW', silenceDurationMs: 700 },
                'patient':       { start: 'START_SENSITIVITY_LOW', end: 'END_SENSITIVITY_LOW', silenceDurationMs: 1200 },
                'very-patient':  { start: 'START_SENSITIVITY_LOW', end: 'END_SENSITIVITY_LOW', silenceDurationMs: 2000 }
            };
            const vad = vadPresets[persona.reactivity] || vadPresets['balanced'];

            const temps = { 'precise': 0.5, 'balanced': 0.7, 'creative': 0.9, 'wild': 1.1 };
            const temperature = temps[persona.creativity] || 0.7;

            // Outils Gemini : date/heure + météo en function declarations, recherche web via Google Search intégré
            const tools = [
                {
                    functionDeclarations: [
                        {
                            name: 'get_current_datetime',
                            description: 'Obtenir la date et l\'heure actuelles. Utilise cet outil quand l\'utilisateur demande la date, l\'heure, le jour de la semaine, ou toute information temporelle.',
                            parameters: { type: 'object', properties: {} }
                        },
                        {
                            name: 'get_weather',
                            description: 'Obtenir la météo actuelle et les prévisions pour un lieu donné.',
                            parameters: { type: 'object', properties: { location: { type: 'string', description: 'La ville ou le lieu (ex: Paris, Lyon, Tokyo)' } }, required: ['location'] }
                        },
                        // Outils Phase 2 du persona (format Gemini natif, sans type).
                        ...VART_PERSONA_TOOL_DEFS
                    ]
                },
                { googleSearch: {} }
            ];

            // Message setup (doit être le premier message).
            // ⚠ Gemini Live attend du camelCase strict via WebSocket
            // (contrairement à la REST API qui accepte les deux). Le snake_case
            // déclenche `1011 Internal error encountered` côté serveur.
            // Garde-fou voix : un persona peut avoir été créé avec un modèle
            // OpenAI puis basculé sur Gemini, et garder une voix « alloy » ou
            // autre qui n'existe pas chez Gemini → erreur 1011 immédiate.
            // On valide la voix contre la liste Gemini et on retombe sur
            // « Puck » (voix par défaut conversationnelle) sinon.
            const geminiVoiceNames = VOICES.gemini.map(v => v.value);
            const safeVoice = geminiVoiceNames.includes(persona.voice) ? persona.voice : 'Puck';

            const configMsg = {
                setup: {
                    model: `models/${activeModelId}`,
                    generationConfig: {
                        responseModalities: ['AUDIO'],
                        temperature: temperature,
                        speechConfig: {
                            voiceConfig: {
                                prebuiltVoiceConfig: {
                                    voiceName: safeVoice
                                }
                            }
                        }
                    },
                    systemInstruction: {
                        parts: [{ text: fullInstructions }]
                    },
                    tools: tools,
                    realtimeInputConfig: {
                        automaticActivityDetection: {
                            disabled: false,
                            startOfSpeechSensitivity: vad.start,
                            endOfSpeechSensitivity: vad.end,
                            silenceDurationMs: vad.silenceDurationMs
                        }
                    },
                    inputAudioTranscription: {},
                    outputAudioTranscription: {},
                    // Compression de contexte (fenêtre glissante). Sans elle,
                    // une session est plafonnée à 15 min en audio seul, et à
                    // 2 MINUTES dès qu'on y ajoute de la vidéo (cf. vision).
                    // Les seuils comptent aussi pour le prix : Gemini refacture
                    // à CHAQUE réponse tout ce qui reste en mémoire. Par défaut
                    // la compression ne se déclenche qu'à 80 % d'une très
                    // grande fenêtre ; on applique les valeurs conseillées par
                    // Google (déclenchement à 25 000 tokens, 8 000 conservés).
                    // ⚠ Cela ne lève PAS la limite de ~10 min d'une connexion
                    // WebSocket (message GoAway) : il faudrait pour cela la
                    // reprise de session (sessionResumption).
                    contextWindowCompression: {
                        triggerTokens: GEMINI_CONTEXT_TRIGGER_TOKENS,
                        slidingWindow: { targetTokens: GEMINI_CONTEXT_TARGET_TOKENS }
                    }
                }
            };
            // Gemini 3.8 Live Extended Thinking exige un niveau de réflexion
            // explicite (sinon fermeture 1007 « Thinking level must be specified
            // for this model ») ; le 3.8 Live de base, lui, le REFUSE → ajouté
            // seulement pour le modèle « thinking », sous generationConfig
            // (même emplacement que speechConfig).
            if (isGeminiThinkingModel(activeModelId)) {
                configMsg.setup.generationConfig.thinkingConfig = { thinkingLevel: GEMINI_LIVE_THINKING_LEVEL };
            }
            // Reprise : jeton de la session à continuer ; sinon objet vide,
            // qui demande au serveur d'envoyer des jetons au fil de l'eau.
            configMsg.setup.sessionResumption = resumeHandle ? { handle: resumeHandle } : {};
            sock.send(JSON.stringify(configMsg));
        };

        sock.onmessage = async (e) => {
            if (ws !== sock) return;
            try {
                const text = (e.data instanceof Blob) ? await e.data.text() : e.data;
                if (ws !== sock) return;
                const data = JSON.parse(text);
                handleGeminiServerEvent(data);
            } catch (err) {
                console.error('Erreur parsing Gemini:', err, e.data);
            }
        };
        sock.onerror = (err) => {
            if (ws !== sock) return;
            console.error('[Gemini] WebSocket error:', err);
            // Une erreur est toujours suivie d'une fermeture : si la session
            // peut reprendre, c'est onclose qui s'en charge.
            if (geminiConversationLive() && geminiResumeHandle) return;
            handleConnectionFailure('Erreur de connexion Gemini');
        };
        sock.onclose = (e) => {
            if (ws !== sock) return;
            console.error('[Gemini] WebSocket closed:', e.code, e.reason);
            if (geminiTryResume(e.code)) return;
            if (e.code !== 1000) handleConnectionFailure(`Gemini déconnecté (code ${e.code}${e.reason ? ' - ' + e.reason : ''})`);
            else if (geminiResuming) handleConnectionFailure('Impossible de reprendre la conversation Gemini');
            else isConnected = false;
        };
    }


