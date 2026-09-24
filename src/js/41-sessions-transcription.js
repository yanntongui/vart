    // ── Transcription via Gemini 3.5 Transcribe Live (gemini-3.5-transcribe-live) ──
    // Même WebSocket brut BidiGenerateContent que les modes conversation et
    // traduction Gemini, en sortie TEXT uniquement. L'audio (PCM 16 kHz) part
    // par startMicrophone() via `realtimeInput` (activeProvider === 'gemini').
    // Le modèle renvoie des hypothèses PARTIELLES cumulées pendant la parole
    // (interimInputTranscription) puis le texte FINAL du segment à la pause
    // (inputTranscription) → mêmes paragraphes que le Transcripteur OpenAI.
    // Limite : 10 min de flux continu par session → on rebascule sans bruit
    // sur une nouvelle session un peu avant (rollover), micro inchangé.
    let geminiTranscribeRolloverTimer = null;
    const GEMINI_TRANSCRIBE_ROLLOVER_MS = 9 * 60 * 1000;

    function connectGeminiTranscribe() {
        if (!getGeminiApiKey()) return;
        const url = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${getGeminiApiKey()}`;
        const sock = new WebSocket(url);
        ws = sock;
        // Tous les handlers ignorent un socket qui n'est plus le socket courant
        // (ancienne session après rollover) : sa fermeture ne doit pas écraser
        // l'état de la nouvelle.
        sock.onopen = () => {
            if (ws !== sock) return;
            setStatus('Configuration Gemini...');
            sock.send(JSON.stringify({
                setup: {
                    model: `models/${activeModelId}`,
                    generationConfig: { responseModalities: ['TEXT'] },
                    // Locale BCP-47 de la langue choisie ; liste vide = détection
                    // automatique (85+ langues, changement de langue géré).
                    inputAudioTranscription: { languageCodes: (function () {
                        const code = getTranscribeLang('gemini');
                        return code === 'auto' ? [] : [code];
                    })() },
                    realtimeInputConfig: { automaticActivityDetection: { disabled: false } }
                }
            }));
        };
        sock.onmessage = async (e) => {
            if (ws !== sock) return;
            try {
                const text = (e.data instanceof Blob) ? await e.data.text() : e.data;
                if (ws !== sock) return;
                handleGeminiTranscribeServerEvent(JSON.parse(text));
            } catch (err) {
                console.error('Erreur parsing Gemini transcribe:', err, e.data);
            }
        };
        sock.onerror = () => { if (ws === sock) handleConnectionFailure('Erreur de connexion Gemini'); };
        sock.onclose = (e) => {
            if (ws !== sock) return;
            if (e.code !== 1000) handleConnectionFailure(`Gemini déconnecté (code ${e.code}${e.reason ? ' - ' + e.reason : ''})`);
            else isConnected = false;
        };
    }

    // Bascule sur une nouvelle session Gemini avant la limite des 10 min.
    // Le paragraphe en cours est clos (la nouvelle session repart de zéro),
    // l'ancien socket est fermé SANS passer par ses handlers, puis on
    // reconnecte : isConnected/micReady restent vrais, le micro ne bouge pas
    // (l'envoi audio attend simplement que le nouveau socket soit ouvert).
    function rolloverGeminiTranscribe() {
        if (geminiTranscribeRolloverTimer) { clearTimeout(geminiTranscribeRolloverTimer); geminiTranscribeRolloverTimer = null; }
        if (!isConnected || !isTranscripteurMode || activeProvider !== 'gemini' || !ws) return;
        currentWhisperParagraph = null;
        const old = ws;
        old.onopen = old.onmessage = old.onerror = old.onclose = null;
        ws = null;
        try { old.close(1000); } catch (e) {}
        connectGeminiTranscribe();
    }

    function handleGeminiTranscribeServerEvent(data) {
        if (data.setupComplete !== undefined) {
            isConnected = true;
            micReady = true;
            updateOrbCenterBtn('connected');
            setStatus(isPaused ? 'Pause' : 'Transcription en cours, parlez !', isPaused ? '' : 'connected');
            if (geminiTranscribeRolloverTimer) clearTimeout(geminiTranscribeRolloverTimer);
            geminiTranscribeRolloverTimer = setTimeout(rolloverGeminiTranscribe, GEMINI_TRANSCRIBE_ROLLOVER_MS);
            return;
        }
        if (data.serverContent) {
            const sc = data.serverContent;
            // Hypothèse partielle (cumulée pour le segment en cours) → remplace
            // le texte du paragraphe courant.
            const interim = sc.interimInputTranscription || sc.interim_input_transcription;
            if (interim && interim.text) {
                setTranscriptInterim(interim.text);
                setStatus('Écoute...', 'connected');
            }
            // Texte final du segment (à la pause) → fige le paragraphe.
            const fin = sc.inputTranscription || sc.input_transcription;
            if (fin && fin.text) {
                finalizeTranscriptSegment(fin.text);
                setStatus('Transcription en cours, parlez !', 'connected');
            }
            return;
        }
        // Le serveur annonce la fin imminente de la session → on bascule tout de suite.
        if (data.goAway !== undefined) { rolloverGeminiTranscribe(); return; }
        if (data.error) {
            console.error('[Gemini transcribe] Erreur:', data.error);
            handleConnectionFailure(`Erreur : ${data.error.message || 'inconnue'}`);
        }
    }

    // Remplace le texte du paragraphe en cours (hypothèse partielle Gemini),
    // contrairement à appendTranscriptDelta qui AJOUTE (deltas OpenAI).
    function setTranscriptInterim(text) {
        const el = document.getElementById('transcript');
        const placeholder = el.querySelector('.transcript-empty');
        if (placeholder) placeholder.remove();
        if (!currentWhisperParagraph) {
            currentWhisperParagraph = document.createElement('p');
            currentWhisperParagraph.className = 'transcript-flowing-text';
            el.appendChild(currentWhisperParagraph);
        }
        currentWhisperParagraph.textContent = text;
        scrollTranscript();
    }

    let currentWhisperParagraph = null; // paragraphe en cours de streaming

    async function connectWhisper() {
        if (!getApiKey()) return;
        const myEpoch = connectionEpoch; // capture avant le POST client_secrets
        setStatus('Connexion...', 'connected');

        // 1. Créer une session de transcription et obtenir un token
        let clientSecret;
        try {
            const resp = await fetch('https://api.openai.com/v1/realtime/client_secrets', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${getApiKey()}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    session: {
                        type: 'transcription',
                        audio: {
                            input: {
                                format: { type: 'audio/pcm', rate: 24000 },
                                // Langue fixée (ISO 639-1) ou détection automatique (paramètre omis)
                                transcription: getTranscribeLang('openai') === 'auto'
                                    ? { model: 'gpt-realtime-whisper' }
                                    : { model: 'gpt-realtime-whisper', language: getTranscribeLang('openai') }
                            }
                        }
                    }
                })
            });
            if (!resp.ok) {
                const err = await resp.json().catch(() => ({}));
                throw new Error(err.error?.message || `HTTP ${resp.status}`);
            }
            const data = await resp.json();
            clientSecret = data.value;
            if (!clientSecret) throw new Error('Réponse inattendue : ' + JSON.stringify(data).substring(0, 300));
        } catch (err) {
            // Remet l'UI à l'arrêt (bouton « Démarrer », micro coupé) — sinon
            // la page restait figée sur « Connexion… » avec l'erreur en dessous.
            if (myEpoch === connectionEpoch) handleConnectionFailure(`Erreur : ${err.message}`);
            return;
        }

        // Arrêt demandé pendant l'attente du client-secret → ne pas ouvrir de
        // WebSocket orpheline (elle ne serait référencée par aucune logique d'arrêt).
        if (myEpoch !== connectionEpoch) return;

        // 2. Connexion WebSocket avec le token — la session est déjà configurée
        const url = 'wss://api.openai.com/v1/realtime';
        ws = new WebSocket(url, [
            'realtime',
            `openai-insecure-api-key.${clientSecret}`
        ]);

        ws.onopen = () => {
            isConnected = true;
            micReady = true;
            updateOrbCenterBtn('connected');  // → bouton pill « Terminer » au lieu de « Connexion… »
            setStatus('Transcription en cours, parlez !', 'connected');
        };

        ws.onmessage = (e) => {
            try {
                handleWhisperServerEvent(JSON.parse(e.data));
            } catch (err) {
                console.error('[Whisper] Parse error:', err);
            }
        };
        ws.onerror = () => handleConnectionFailure('Erreur de connexion');
        ws.onclose = (e) => {
            if (e.code !== 1000) handleConnectionFailure(`Déconnecté (code ${e.code})`);
            else isConnected = false;
        };
    }

    function handleWhisperServerEvent(data) {
        switch (data.type) {
            case 'session.created':
            case 'session.updated':
                micReady = true;
                setStatus('Transcription en cours, parlez !', 'connected');
                break;

            // Transcription streaming temps réel (delta)
            case 'conversation.item.input_audio_transcription.delta':
                if (data.delta) {
                    appendTranscriptDelta(data.delta);
                }
                break;

            // Transcription finale d'un segment
            case 'conversation.item.input_audio_transcription.completed':
                finalizeTranscriptSegment(data.transcript || '');
                break;

            case 'input_audio_buffer.speech_started':
                setStatus('Écoute...', 'connected');
                break;

            case 'input_audio_buffer.speech_stopped':
                setStatus('Transcription...', 'connected');
                break;

            case 'input_audio_buffer.committed':
                break;

            case 'error':
                console.error('[Whisper] Erreur:', data.error);
                handleConnectionFailure(`Erreur : ${data.error?.message || 'inconnue'}`);
                break;

            default:
                break;
        }
    }

    function appendTranscriptDelta(delta) {
        const el = document.getElementById('transcript');
        const placeholder = el.querySelector('.transcript-empty');
        if (placeholder) placeholder.remove();

        if (!currentWhisperParagraph) {
            currentWhisperParagraph = document.createElement('p');
            currentWhisperParagraph.className = 'transcript-flowing-text';
            el.appendChild(currentWhisperParagraph);
        }
        currentWhisperParagraph.textContent += delta;
        scrollTranscript();
    }

    function finalizeTranscriptSegment(transcript) {
        if (currentWhisperParagraph) {
            if (transcript.trim()) {
                // Remplacer par le texte final (plus propre que les deltas cumulés)
                const formatted = esc(transcript.trim()).replace(/\[([^\]]+)\]/g, '<span class="non-speech">[$1]</span>');
                currentWhisperParagraph.innerHTML = formatted;
            }
            currentWhisperParagraph = null;
        } else if (transcript.trim()) {
            // Pas de delta reçu avant, ajouter directement
            const el = document.getElementById('transcript');
            const placeholder = el.querySelector('.transcript-empty');
            if (placeholder) placeholder.remove();
            const p = document.createElement('p');
            p.className = 'transcript-flowing-text';
            const formatted = esc(transcript.trim()).replace(/\[([^\]]+)\]/g, '<span class="non-speech">[$1]</span>');
            p.innerHTML = formatted;
            el.appendChild(p);
            scrollTranscript();
        }
    }

    function getTranscripteurText() {
        const elements = document.querySelectorAll('#transcript .transcript-flowing-text, #transcript .transcript-pause-separator');
        let text = '';
        elements.forEach(el => {
            if (el.classList.contains('transcript-pause-separator')) {
                text += '\n\n---\n\n';
            } else {
                if (text && !text.endsWith('\n\n')) text += '\n\n';
                text += el.textContent;
            }
        });
        return text;
    }

