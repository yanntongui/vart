    function float32ToPcm16Base64(float32Array) {
        const buffer = new ArrayBuffer(float32Array.length * 2);
        const view = new DataView(buffer);
        for (let i = 0; i < float32Array.length; i++) {
            let s = Math.max(-1, Math.min(1, float32Array[i]));
            view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
        }
        const bytes = new Uint8Array(buffer);
        let binary = '';
        for (let i = 0; i < bytes.length; i += 0x8000) {
            binary += String.fromCharCode.apply(null, bytes.subarray(i, Math.min(i + 0x8000, bytes.length)));
        }
        return btoa(binary);
    }

    function pcm16Base64ToFloat32(base64) {
        const binary = atob(base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        const view = new DataView(bytes.buffer);
        const f = new Float32Array(bytes.length / 2);
        for (let i = 0; i < f.length; i++) {
            const v = view.getInt16(i * 2, true);
            f[i] = v / (v < 0 ? 0x8000 : 0x7FFF);
        }
        return f;
    }

    function computeLevel(arr) {
        let sum = 0;
        for (let i = 0; i < arr.length; i++) sum += arr[i] * arr[i];
        return Math.sqrt(sum / arr.length);
    }


    let aiSpeakingTimeout = null;
    function playAudioChunk(base64) {
        if (!base64 || !playbackContext) return;
        const float32 = pcm16Base64ToFloat32(base64);

        const buf = playbackContext.createBuffer(1, float32.length, 24000);
        buf.getChannelData(0).set(float32);

        const source = playbackContext.createBufferSource();
        source.buffer = buf;
        source.connect(playbackAnalyser); // → analyser → destination

        const now = playbackContext.currentTime;
        const start = Math.max(now + 0.05, nextPlayTime);
        source.start(start);
        nextPlayTime = start + buf.duration;

        // Lie le texte IA bufferisé à ce chunk audio pour la synchro affichage/voix
        aiAttachAudioToText(start, buf.duration);

        // Glow central → violet pendant que l'IA parle, retour au bleu après 500ms d'inactivité
        setGlowSpeaking(true);
        clearTimeout(aiSpeakingTimeout);
        aiSpeakingTimeout = setTimeout(() => setGlowSpeaking(false), 500);

        playbackSources.push(source);
        source.onended = () => {
            const idx = playbackSources.indexOf(source);
            if (idx > -1) playbackSources.splice(idx, 1);
        };
    }

    function stopPlayback() {
        playbackSources.forEach(s => { try { s.stop(); } catch(e) {} });
        playbackSources = [];
        nextPlayTime = 0;
        gerardAudioLevel = 0;
        aiClearSync();
        clearTimeout(aiSpeakingTimeout);
        setGlowSpeaking(false);
    }


    async function getWeather(location) {
        setStatus('Consultation météo...', 'searching');
        try {
            const resp = await fetchWithTimeout(`https://wttr.in/${encodeURIComponent(location)}?format=j1&lang=fr`, {}, 10000);
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const data = await resp.json();
            const current = data.current_condition?.[0] || {};
            const area = data.nearest_area?.[0] || {};
            const today = data.weather?.[0] || {};
            const tomorrow = data.weather?.[1] || {};

            return JSON.stringify({
                lieu: area.areaName?.[0]?.value || location,
                actuel: {
                    temperature: `${current.temp_C}°C (ressenti ${current.FeelsLikeC}°C)`,
                    description: current.lang_fr?.[0]?.value || current.weatherDesc?.[0]?.value || '',
                    humidite: `${current.humidity}%`,
                    vent: `${current.windspeedKmph} km/h`,
                    visibilite: `${current.visibility} km`
                },
                aujourdhui: {
                    min: `${today.mintempC}°C`,
                    max: `${today.maxtempC}°C`,
                    description: today.hourly?.[4]?.lang_fr?.[0]?.value || ''
                },
                demain: tomorrow ? {
                    min: `${tomorrow.mintempC}°C`,
                    max: `${tomorrow.maxtempC}°C`,
                    description: tomorrow.hourly?.[4]?.lang_fr?.[0]?.value || ''
                } : null
            });
        } catch (err) {
            return JSON.stringify({ erreur: `Impossible d'obtenir la météo : ${err.message}` });
        }
    }


    // Recherche web des sessions OpenAI Realtime : un appel Responses à
    // gpt-4o-mini avec l'outil `web_search` (l'ancien `web_search_preview`
    // coûtait $25 les 1 000 recherches, contre $10 ici). Facturé : les tokens
    // de l'appel, $10 les 1 000 recherches, et pour gpt-4o-mini un bloc FIXE
    // de 8 000 tokens d'entrée par recherche pour le contenu trouvé.
    // L'API ne dit pas si ce bloc figure déjà dans `usage` : on l'ajoute, ce
    // qui peut surestimer d'au plus $0.0012 par recherche.
    const WEB_SEARCH_MODEL = 'gpt-4o-mini';
    const WEB_SEARCH_FEE = { openai: 0.01, xai: 0.005 }; // par recherche
    const WEB_SEARCH_MINI_CONTENT_TOKENS = 8000;

    function countWebSearchCalls(output) {
        return (Array.isArray(output) ? output : []).filter(i => i && i.type === 'web_search_call').length;
    }
    function webSearchResponseCost(data) {
        const p = PRICING[WEB_SEARCH_MODEL];
        const u = (data && data.usage) || {};
        const calls = countWebSearchCalls(data && data.output);
        return ((u.input_tokens || 0) / 1000) * p.input
             + ((u.output_tokens || 0) / 1000) * p.output
             + calls * (WEB_SEARCH_FEE.openai + (WEB_SEARCH_MINI_CONTENT_TOKENS / 1000) * p.input);
    }

    // Grok : la recherche web tourne côté xAI ($5 les 1 000). Aucun événement
    // n'est documenté pour elle dans l'API vocale ; on compte les éléments de
    // sortie « web_search_call » s'il en arrive (les API compatibles OpenAI en
    // envoient). Dédoublonnés par identifiant, car le même élément peut
    // apparaître dans response.output_item.done puis dans response.done.
    // `responseId` : la réponse d'où viennent les éléments. Un élément sans
    // identifiant n'est compté que dans response.done, et seulement si rien
    // n'a déjà été compté pour cette réponse via response.output_item.done.
    function countGrokSearches(items, fromResponseDone, responseId) {
        let added = false;
        (Array.isArray(items) ? items : []).forEach(it => {
            if (!it || !/web_search/.test(String(it.type || ''))) return;
            const id = it.id || it.call_id;
            if (id) {
                if (sessionSearchIds.has(id)) return;
                sessionSearchIds.add(id);
            } else if (!fromResponseDone || (responseId && sessionSearchResponses.has(responseId))) {
                return;
            }
            if (responseId && !fromResponseDone) sessionSearchResponses.add(responseId);
            sessionToolCost += WEB_SEARCH_FEE.xai;
            added = true;
        });
        if (added) updateTokenCounter();
    }

    async function performWebSearch(query) {
        setStatus('Recherche web...', 'searching');
        const epoch = connectionEpoch; // la session qui a demandé la recherche
        try {
            const resp = await fetchWithTimeout('https://api.openai.com/v1/responses', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${getApiKey()}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    model: WEB_SEARCH_MODEL,
                    tools: [{ type: 'web_search' }],
                    input: `Recherche web concise en français (2-3 paragraphes max). Question : ${query}`
                })
            }, 45000);
            if (!resp.ok) {
                const err = await resp.json().catch(() => ({}));
                throw new Error(err.error?.message || `HTTP ${resp.status}`);
            }
            const data = await resp.json();
            // Imputée à la session qui l'a demandée, si elle est toujours en
            // cours ; sinon perdue (au plus ~$0.01), mais jamais comptée à la
            // session suivante.
            if (isConnected && epoch === connectionEpoch) { sessionToolCost += webSearchResponseCost(data); updateTokenCounter(); }
            let text = '';
            if (data.output) {
                for (const item of data.output) {
                    if (item.type === 'message' && item.content) {
                        for (const part of item.content) {
                            if (part.type === 'output_text') text += part.text;
                        }
                    }
                }
            }
            return text || 'Aucun résultat trouvé.';
        } catch (err) {
            return `Erreur recherche web : ${err.message}`;
        }
    }


    // On garde le stream micro persistant pour éviter de re-demander la permission
    let persistentStream = null;

    let currentMicSampleRate = 24000;

    async function startMicrophone(sampleRate) {
        sampleRate = sampleRate || 24000;
        currentMicSampleRate = sampleRate;
        // Note : on NE recrée PAS le stream si le sample rate demandé diffère,
        // afin de ne pas redemander la permission micro au navigateur.
        // L'AudioContext ci-dessous est créé au taux voulu et resample
        // implicitement le stream — c'est une différence acceptable.
        if (!persistentStream || !persistentStream.active) {
            persistentStream = await navigator.mediaDevices.getUserMedia({
                audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, sampleRate: sampleRate, channelCount: 1 }
            });
        }
        mediaStream = persistentStream;
        audioContext = new AudioContext({ sampleRate: sampleRate });
        sourceNode = audioContext.createMediaStreamSource(mediaStream);
        // Analyseur fréquentiel pour la ligne d'onde
        userMicAnalyser = audioContext.createAnalyser();
        userMicAnalyser.fftSize = 256;
        userMicAnalyser.smoothingTimeConstant = 0.5;
        sourceNode.connect(userMicAnalyser);
        scriptProcessor = audioContext.createScriptProcessor(4096, 1, 1);
        scriptProcessor.onaudioprocess = (e) => {
            if (!isConnected || !micReady) return;
            if (isPaused) { userAudioLevel = 0; return; }
            const input = e.inputBuffer.getChannelData(0);
            if (isMuted) {
                userAudioLevel = 0;
                return;
            }
            userAudioLevel = Math.min(1, computeLevel(input) * 8);
            if (!ws || ws.readyState !== WebSocket.OPEN) return;
            const b64 = float32ToPcm16Base64(input);
            if (activeProvider === 'gemini') {
                ws.send(JSON.stringify({ realtimeInput: { audio: { data: b64, mimeType: `audio/pcm;rate=${currentMicSampleRate}` } } }));
            } else if (activeModelId === 'gpt-realtime-translate') {
                ws.send(JSON.stringify({ type: 'session.input_audio_buffer.append', audio: b64 }));
            } else {
                ws.send(JSON.stringify({ type: 'input_audio_buffer.append', audio: b64 }));
            }
        };
        sourceNode.connect(scriptProcessor);
        scriptProcessor.connect(audioContext.destination);
    }

    function stopMicrophone() {
        if (scriptProcessor) { scriptProcessor.disconnect(); scriptProcessor = null; }
        if (userMicAnalyser) { try { userMicAnalyser.disconnect(); } catch(e){} userMicAnalyser = null; }
        if (sourceNode) { sourceNode.disconnect(); sourceNode = null; }
        if (audioContext) { audioContext.close(); audioContext = null; }
        // On ne coupe PAS le mediaStream pour garder la permission active
        userAudioLevel = 0;
    }


    let pendingFunctionCalls = {};

    // Construit les instructions complètes (system prompt) pour un persona
    // Consigne de la TOUTE PREMIÈRE prise de parole, quand le persona ouvre
    // la conversation. Elle existe parce que, sans elle, le modèle traite une
    // conversation vide comme s'il devait répondre à quelque chose, et
    // fabrique un échange qui n'a pas eu lieu.
