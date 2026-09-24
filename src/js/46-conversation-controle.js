    const statusEl = document.getElementById('status');
    const startBtn = document.getElementById('startBtn');
    const stopBtn = document.getElementById('stopBtn');
    const muteBtn = document.getElementById('muteBtn');

    function setStatus(text, type = '') {
        statusEl.textContent = text;
        statusEl.className = type;
    }

    const pauseBtn = document.getElementById('pauseBtn');

    startBtn.addEventListener('click', async () => {
        if (!getActiveId()) return;
        // Garde contre le double-clic pendant un await (customAlert budget,
        // customConfirm budget presque atteint). Sans ça, deux handlers réveillés
        // à la suite ouvrent deux WebSockets et lancent deux fois startMicrophone.
        if (isConnected || waitingGreeting) return;

        if (isTranscripteurMode) {
            // Mode transcripteur — moteur choisi par l'utilisateur (menu ⚙ :
            // OpenAI Whisper Realtime ou Gemini 3.5 Transcribe)
            const tm = transcribeModelInfo(getTranscribeModel());
            activeModelId = tm.model;
            activeProvider = tm.provider;

            if (activeProvider === 'openai' && !getApiKey()) {
                await customAlert('Le transcripteur OpenAI nécessite une clé API OpenAI. Veuillez en configurer une dans les paramètres.', { title: 'Clé API requise', icon: 'key' });
                openApiKeyModal({ tab: 'api', provider: 'openai' });
                return;
            }
            if (activeProvider === 'gemini' && !getGeminiApiKey()) {
                await customAlert('Le transcripteur Gemini nécessite une clé API Gemini. Veuillez en configurer une dans les paramètres.', { title: 'Clé API requise', icon: 'key' });
                openApiKeyModal({ tab: 'api', provider: 'gemini' });
                return;
            }
        } else if (isTraducteurMode) {
            // Mode traducteur — moteur choisi par l'utilisateur (OpenAI ou Gemini)
            const tm = translateModelInfo(getTranslateModel());
            activeModelId = tm.model;
            activeProvider = tm.provider;

            if (activeProvider === 'openai' && !getApiKey()) {
                await customAlert('Le traducteur OpenAI nécessite une clé API OpenAI. Veuillez en configurer une dans les paramètres.', { title: 'Clé API requise', icon: 'key' });
                openApiKeyModal({ tab: 'api', provider: 'openai' });
                return;
            }
            if (activeProvider === 'gemini' && !getGeminiApiKey()) {
                await customAlert('Le traducteur Gemini nécessite une clé API Gemini. Veuillez en configurer une dans les paramètres.', { title: 'Clé API requise', icon: 'key' });
                openApiKeyModal({ tab: 'api', provider: 'gemini' });
                return;
            }
        } else {
            // Mode persona normal
            const persona = getPersonas().find(p => p.id === getActiveId());
            activeModelId = getEffectiveModel(persona);
            activeProvider = getProviderForModel(activeModelId);

            // Vérifier qu'on a la bonne clé API → ouvre la config sur « Clés API »,
            // au bon sous-onglet (le provider dont la clé manque).
            if (activeProvider === 'openai' && !getApiKey()) { openApiKeyModal({ tab: 'api', provider: 'openai' }); return; }
            if (activeProvider === 'gemini' && !getGeminiApiKey()) { openApiKeyModal({ tab: 'api', provider: 'gemini' }); return; }
            if (activeProvider === 'xai'    && !getXaiApiKey())    { openApiKeyModal({ tab: 'api', provider: 'xai' });    return; }
        }

        // Vérification budget
        const budgetLimit = getBudgetLimit();
        if (budgetLimit) {
            const spent = getMonthCost();
            if (spent >= budgetLimit) {
                await customAlert(`Limite de budget mensuel atteinte (${fmtAmount(spent)} / ${fmtAmount(budgetLimit)}). Modifiez votre limite dans la configuration pour continuer.`, { title: 'Budget épuisé', icon: 'wallet' });
                return;
            }
            if (spent >= budgetLimit * 0.9) {
                if (!await customConfirm(`Vous avez utilisé ${fmtAmount(spent)} sur ${fmtAmount(budgetLimit)} ce mois-ci (${(spent/budgetLimit*100).toFixed(0)}%).`, { title: 'Budget presque atteint', icon: 'wallet', confirmLabel: 'Continuer' })) return;
            }
        }

        // Vérification budget PAR PERSONA (niveau 2, Phase 1). À 100 % on
        // propose de continuer avec le modèle par défaut (moins cher) plutôt
        // que de bloquer sec — sauf si le persona utilise déjà ce modèle.
        if (!isTranscripteurMode && !isTraducteurMode) {
            const persona = getPersonas().find(p => p.id === getActiveId());
            if (persona && persona.budgetLimit) {
                const pSpent = getPersonaMonthCost(persona.id);
                if (pSpent >= persona.budgetLimit) {
                    if (persona.model) {
                        const ok = await customConfirm(`« ${persona.name} » a atteint son plafond mensuel (${fmtAmount(pSpent)} / ${fmtAmount(persona.budgetLimit)}).\nContinuer cette session avec le modèle par défaut, moins cher ?`, { title: 'Budget du persona atteint', icon: 'wallet', confirmLabel: 'Modèle par défaut', cancelLabel: 'Annuler' });
                        if (!ok) return;
                        // Repli une session : on recalcule modèle + provider
                        // (les clés ont été vérifiées pour le modèle d'origine ;
                        // on revérifie pour le modèle par défaut).
                        activeModelId = getRealtimeModel();
                        activeProvider = getProviderForModel(activeModelId);
                        if (activeProvider === 'openai' && !getApiKey()) { openApiKeyModal({ tab: 'api', provider: 'openai' }); return; }
                        if (activeProvider === 'gemini' && !getGeminiApiKey()) { openApiKeyModal({ tab: 'api', provider: 'gemini' }); return; }
                        if (activeProvider === 'xai' && !getXaiApiKey()) { openApiKeyModal({ tab: 'api', provider: 'xai' }); return; }
                    } else {
                        await customAlert(`« ${persona.name} » a atteint son plafond mensuel (${fmtAmount(pSpent)} / ${fmtAmount(persona.budgetLimit)}). Modifiez-le dans la fiche du persona pour continuer.`, { title: 'Budget du persona épuisé', icon: 'wallet' });
                        return;
                    }
                } else if (pSpent >= persona.budgetLimit * 0.9) {
                    if (!await customConfirm(`« ${persona.name} » a utilisé ${fmtAmount(pSpent)} sur ${fmtAmount(persona.budgetLimit)} ce mois-ci (${(pSpent / persona.budgetLimit * 100).toFixed(0)} %).`, { title: 'Budget du persona presque atteint', icon: 'wallet', confirmLabel: 'Continuer' })) return;
                }
            }
        }

        startBtn.style.display = 'none';
        stopBtn.style.display = 'inline-block';
        muteBtn.style.display = 'inline-block';
        if (isTranscripteurMode) pauseBtn.style.display = 'flex';
        isMuted = false;
        isPaused = false;
        pausedTime = 0;
        pauseStartedAt = null;
        muteBtn.classList.remove('muted');
        muteBtn.innerHTML = `<span class="icon">${ICON_SVG.mic}</span>`;
        muteBtn.title = 'Couper le micro (M)';

        // État UI conversation active
        document.getElementById('conversationArea').classList.add('is-running');
        updateOrbCenterBtn('connecting');
        syncBottomMuteBtn();

        resetTranscript();
        totalInputTokens = 0;
        totalOutputTokens = 0;
        resetSessionCosts();
        updateTokenCounter();
        startTimer();

        try {
            if (!isTranscripteurMode) {
                playbackContext = new AudioContext({ sampleRate: 24000 });
                playbackAnalyser = playbackContext.createAnalyser();
                playbackAnalyser.fftSize = 256;
                playbackAnalyser.smoothingTimeConstant = 0.3;
                playbackAnalyser.connect(playbackContext.destination);
                nextPlayTime = 0;
            }

            // Gemini attend du PCM 16 kHz en entrée ; OpenAI accepte 24 kHz.
            const micRate = activeProvider === 'gemini' ? 16000 : 24000;
            const startEpoch = connectionEpoch;
            await startMicrophone(micRate);
            // L'utilisateur a pu cliquer « Terminer » pendant l'attente getUserMedia
            // (stopConversation incrémente connectionEpoch) : on annule proprement
            // — sinon on ouvrirait une WebSocket orpheline avec le micro qui streame
            // alors que l'UI affiche « arrêté ».
            if (startEpoch !== connectionEpoch) { stopMicrophone(); return; }
            connectWebSocket();
        } catch (err) {
            console.error('Erreur démarrage:', err);
            setStatus(`Erreur : ${err.message}`, 'error');
            stopConversation();
        }
    });

    stopBtn.addEventListener('click', () => stopConversation(true));

    pauseBtn.addEventListener('click', () => {
        if (!isTranscripteurMode || !isConnected) return;
        isPaused = !isPaused;
        pauseBtn.classList.toggle('paused', isPaused);
        pauseBtn.innerHTML = isPaused ? ICON_SVG.play : ICON_SVG.pause;
        pauseBtn.title = isPaused ? 'Reprendre (P)' : 'Pause (P)';

        if (isPaused) {
            pauseStartedAt = Date.now();
            currentWhisperParagraph = null;
            // Saut de ligne visible (séparateur de pause)
            const el = document.getElementById('transcript');
            const hr = document.createElement('hr');
            hr.className = 'transcript-pause-separator';
            el.appendChild(hr);
            setStatus('Pause', '');
        } else {
            if (pauseStartedAt) pausedTime += Date.now() - pauseStartedAt;
            pauseStartedAt = null;
            setStatus('Transcription en cours, parlez !', 'connected');
        }
    });

    muteBtn.addEventListener('click', () => {
        isMuted = !isMuted;
        // GPT Live (WebRTC) : le micro part sur une piste média, pas via notre
        // ScriptProcessor → on coupe la piste elle-même (+ commande côté API).
        if (livePc && persistentStream) {
            persistentStream.getAudioTracks().forEach(t => { t.enabled = !isMuted; });
            liveSend({ type: isMuted ? 'session.input_audio.mute' : 'session.input_audio.unmute' });
        }
        muteBtn.classList.toggle('muted', isMuted);
        muteBtn.innerHTML = isMuted ? `<span class="icon">${ICON_SVG['mic-off']}</span>` : `<span class="icon">${ICON_SVG.mic}</span>`;
        muteBtn.title = isMuted ? 'Réactiver le micro (M)' : 'Couper le micro (M)';
        setStatus(isMuted ? 'Micro coupé' : 'Connecté, parlez !', isMuted ? '' : 'connected');
        syncBottomMuteBtn();
    });


    async function askExportFormat() {
        return new Promise(resolve => {
            const overlay = document.createElement('div');
            // `active` pour que la garde clavier (`.modal-overlay.active`) neutralise
            // les raccourcis (Espace/Échap/M/P) tant que ce choix de format est ouvert.
            overlay.className = 'modal-overlay active';
            overlay.style.display = 'flex';
            overlay.innerHTML = `
                <div class="modal" style="max-width:400px;text-align:center;padding:32px 36px">
                    <h3 style="margin-bottom:6px">Exporter la transcription</h3>
                    <p style="color:var(--text-muted);font-size:0.82rem;margin-bottom:8px">Choisissez le format de fichier</p>
                    <div class="export-format-choice">
                        <button data-fmt="txt"><span class="icon">${ICON_SVG['file-text']}</span> Texte brut (.txt)</button>
                        <button data-fmt="md"><span class="icon">${ICON_SVG['file-code']}</span> Markdown (.md)</button>
                    </div>
                    <button class="export-cancel-btn" data-fmt="cancel">Annuler</button>
                </div>
            `;
            overlay.addEventListener('click', (e) => {
                const btn = e.target.closest('[data-fmt]');
                if (btn) { overlay.remove(); resolve(btn.dataset.fmt); }
            });
            document.body.appendChild(overlay);
        });
    }

    function downloadFile(content, filename, mimeType) {
        const blob = new Blob([content], { type: mimeType });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
    }

    // Relecture d'historique → nouvelle discussion avec le même persona (ou
    // le même mode Transcripteur / Traducteur), lancée directement.
    document.getElementById('historyNewConvBtn').addEventListener('click', async () => {
        const conv = getConversations().find(c => c.id === getViewingConvId());
        if (!conv) { showEmptyState(); return; }
        if (conv.isTranscripteur) {
            await selectTranscripteur();
        } else if (conv.isTraducteur) {
            await selectTraducteur();
        } else {
            const persona = getPersonas().find(p => p.id === conv.personaId);
            if (!persona) {
                await customAlert('Ce persona n\'existe plus : impossible de relancer une discussion avec lui.', { title: 'Persona introuvable', icon: 'x-circle' });
                return;
            }
            await selectPersona(persona.id);
        }
        // Démarre la session tout de suite — sauf si le sas micro est encore
        // affiché (permission refusée / en attente) : l'utilisateur la passera
        // lui-même puis cliquera « Démarrer ».
        const convArea = document.getElementById('conversationArea');
        if (getActiveId() && !convArea.classList.contains('mic-gated')) {
            document.getElementById('startBtn').click();
        }
    });

    document.getElementById('copyTranscriptBtn').addEventListener('click', async () => {
        const text = isTranscripteurMode ? getTranscripteurText() : getTranscriptText();
        if (!text.trim()) { customAlert('Rien à copier.', { icon: 'clipboard' }); return; }
        try {
            await navigator.clipboard.writeText(text);
            const btn = document.getElementById('copyTranscriptBtn');
            const original = btn.innerHTML;
            btn.innerHTML = `<span class="icon">${ICON_SVG.check}</span> Copié`;
            setTimeout(() => { btn.innerHTML = original; }, 1500);
        } catch (err) {
            customAlert('Impossible de copier dans le presse-papier.', { icon: 'clipboard' });
        }
    });

    document.getElementById('exportTranscriptBtnConv').addEventListener('click', async () => {
        const date = new Date().toISOString().slice(0, 16).replace('T', ' ');
        const timerText = document.getElementById('sessionTimer')?.textContent || '';
        const costText = document.getElementById('sessionCost')?.textContent || '';

        if (isTranscripteurMode) {
            const text = getTranscripteurText();
            if (!text.trim()) { customAlert('Aucune transcription à exporter.', { icon: 'file-text' }); return; }
            const format = await askExportFormat();
            if (format === 'cancel') return;
            const filename = `Vart-Transcription-${exportTimestamp()}`;
            if (format === 'md') {
                downloadFile(`# Transcription Vart\n\n**Date :** ${date}\n**Durée :** ${timerText}\n**Coût estimé :** ${costText}\n\n---\n\n${text}`, filename + '.md', 'text/markdown;charset=utf-8');
            } else {
                downloadFile(`Transcription Vart\n${date}\nDurée : ${timerText}\nCoût estimé : ${costText}\n${'─'.repeat(40)}\n\n${text}`, filename + '.txt', 'text/plain;charset=utf-8');
            }
        } else {
            const transcriptTxt = getTranscriptText(false);
            if (!transcriptTxt.trim()) { customAlert('Aucune transcription à exporter.', { icon: 'file-text' }); return; }
            const format = await askExportFormat();
            if (format === 'cancel') return;
            // En relecture d'historique, getActiveId() est vide : on lit le
            // persona et le modèle depuis la conversation affichée (sinon le nom
            // de fichier retombe sur « conversation » et le modèle est celui de
            // la session en cours, pas celui de la discussion relue).
            let personaName, model;
            if (document.getElementById('conversationArea').classList.contains('viewing-history')) {
                const conv = getConversations().find(c => c.id === getViewingConvId());
                personaName = (conv && conv.personaName) || 'conversation';
                model = (conv && conv.model) || '';
            } else {
                const persona = getPersonas().find(p => p.id === getActiveId());
                personaName = persona ? persona.name : 'conversation';
                model = activeModelId || getRealtimeModel();
            }
            const filename = `Vart-Discussion-${personaName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${exportTimestamp()}`;
            if (format === 'md') {
                const transcriptMd = getTranscriptText(true);
                downloadFile(`# Conversation avec ${personaName}\n\n**Date :** ${date}\n**Modèle :** ${model}\n**Durée :** ${timerText}\n**Coût estimé :** ${costText}\n\n---\n\n${transcriptMd}`, filename + '.md', 'text/markdown;charset=utf-8');
            } else {
                downloadFile(`Conversation avec ${personaName}\n${date}\nModèle : ${model}\nDurée : ${timerText}\nCoût estimé : ${costText}\n${'─'.repeat(40)}\n\n${transcriptTxt}`, filename + '.txt', 'text/plain;charset=utf-8');
            }
        }
    });

    function stopConversation(analyzeInsights = false) {
        // Si on arrête PENDANT une pause (transcripteur), clore le segment de
        // pause en cours pour que la durée active — donc le coût et la durée
        // enregistrée — n'inclue pas cette pause.
        if (isPaused && pauseStartedAt) { pausedTime += Date.now() - pauseStartedAt; pauseStartedAt = null; }
        // Détecter si une conversation a eu lieu
        const hasTranscriptMessages = document.querySelectorAll('#transcript .transcript-msg').length > 0;
        const hasTranscripteurText = document.querySelectorAll('#transcript .transcript-flowing-text').length > 0;
        const hadConversation = isConnected && (totalInputTokensRaw > 0 || totalInputTokens > 0 || hasTranscriptMessages || hasTranscripteurText);
        const duration = stopTimer();
        // Durée + coût finaux à figer dans la barre de session (état « fin de
        // session ») : renseignés seulement si une conversation exploitable a
        // eu lieu, sinon la barre reste masquée.
        let sessionEndDur = null, sessionEndCost = null;

        // Sauvegarder la discussion (messages + métadonnées) dans l'historique
        if (hadConversation) {
            const messages = [];
            const pendingImages = [];
            if (isTranscripteurMode) {
                document.querySelectorAll('#transcript .transcript-flowing-text').forEach(el => {
                    const t = (el.textContent || '').trim();
                    if (t) messages.push({ sender: 'transcript', text: t });
                });
            } else {
                document.querySelectorAll('#transcript .transcript-msg').forEach(el => {
                    const sender = el.classList.contains('user') ? 'user' : 'ai';
                    const text = (el.querySelector('.text')?.textContent || '').trim();
                    // Image envoyée ponctuellement (photo, capture, fichier) :
                    // la vignette part dans l'historique avec le message, donc
                    // dans l'export de sauvegarde qui sérialise les
                    // conversations telles quelles.
                    const thumb = el.querySelector('.vision-thumb');
                    if (!text && !thumb) return;
                    const msg = { sender, text };
                    if (thumb && thumb.dataset.imageId) {
                        msg.imageId = thumb.dataset.imageId;
                    } else if (thumb && thumb.__stored) {
                        // Écriture en base pas encore terminée : on complètera
                        // le message enregistré dès qu'elle le sera.
                        pendingImages.push({ index: messages.length, stored: thumb.__stored });
                    } else if (thumb && isSafeImageDataUrl(thumb.src)) {
                        msg.image = thumb.src;
                    }
                    messages.push(msg);
                });
            }
            if (messages.length > 0) {
                const persona = (isTranscripteurMode || isTraducteurMode) ? null : getPersonas().find(p => p.id === getActiveId());
                const convId = 'conv_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
                let convPersonaId, convPersonaName;
                if (isTranscripteurMode)      { convPersonaId = 'TRANSCRIPTEUR'; convPersonaName = 'Transcripteur'; }
                else if (isTraducteurMode)    { convPersonaId = 'TRADUCTEUR';    convPersonaName = 'Traducteur';    }
                else                          { convPersonaId = getActiveId() || ''; convPersonaName = persona?.name || '-'; }
                // Coût total « gelé » de la conversation (tokens + transcription
                // OpenAI, ou facturation à la minute) : affiché en fin de session
                // et en relecture d'historique.
                const convModel = activeModelId || (isTranscripteurMode ? transcribeModelInfo(getTranscribeModel()).model : isTraducteurMode ? 'gpt-realtime-translate' : getRealtimeModel());
                const convActiveDur = Math.max(0, duration - Math.floor(pausedTime / 1000));
                const convCost = computeConversationCost(convModel, totalInputTokens, totalOutputTokens, convActiveDur, isTranscripteurMode, isTraducteurMode);
                sessionEndDur = isTranscripteurMode ? convActiveDur : duration;
                sessionEndCost = convCost;
                addConversation({
                    id: convId,
                    personaId: convPersonaId,
                    personaName: convPersonaName,
                    personaImage: (isTranscripteurMode || isTraducteurMode) ? null : (persona?.image || null),
                    isTranscripteur: !!isTranscripteurMode,
                    isTraducteur: !!isTraducteurMode,
                    model: convModel,
                    costDollars: convCost,
                    startDate: conversationStartTime ? new Date(conversationStartTime).toISOString() : new Date().toISOString(),
                    endDate: new Date().toISOString(),
                    durationSeconds: isTranscripteurMode ? Math.max(0, duration - Math.floor(pausedTime / 1000)) : duration,
                    inputTokens: totalInputTokensRaw,
                    outputTokens: totalOutputTokensRaw,
                    messages: messages
                });
                // On marque la conv comme « résumé en cours » immédiatement pour que
                // la sidebar affiche le placeholder shimmer, puis on lance le résumé
                // en arrière-plan. À l'arrivée du résumé (ou en cas d'échec) on
                // retire le flag. Tous les modes génèrent un titre — persona,
                // transcripteur et traducteur (l'aperçu dans la sidebar est plus
                // parlant qu'un extrait brut de la transcription).
                patchPendingImages(convId, pendingImages);
                updateConversation(convId, { summarizing: true });
                renderPersonaList();
                generateConversationSummary(messages).then(summary => {
                    const patch = { summarizing: false };
                    if (summary) patch.summary = summary;
                    updateConversation(convId, patch);
                    renderPersonaList();
                });
            }
        }

        // Sauvegarder les stats
        if (hadConversation) {
            if (isTranscripteurMode) {
                // Coût basé sur la durée (hors temps de pause), au tarif du moteur
                const activeDuration = duration - Math.floor(pausedTime / 1000);
                const trModel = activeModelId || transcribeModelInfo(getTranscribeModel()).model;
                const trPrice = PRICING[trModel];
                const cost = (activeDuration / 60) * ((trPrice && trPrice.perMinute) || 0);
                addStat({
                    personaId: TRANSCRIPTEUR_ID,
                    personaName: 'Transcripteur',
                    model: trModel,
                    date: new Date().toISOString(),
                    inputTokens: 0,
                    outputTokens: 0,
                    durationSeconds: activeDuration,
                    costDollars: cost
                });
            } else if (isTraducteurMode) {
                const activeDuration = duration - Math.floor(pausedTime / 1000);
                const modelId = activeModelId || 'gpt-realtime-translate';
                const modelPricing = PRICING[modelId];
                const stat = {
                    personaId: TRADUCTEUR_ID,
                    personaName: 'Traducteur',
                    model: modelId,
                    date: new Date().toISOString(),
                    inputTokens: totalInputTokensRaw,
                    outputTokens: totalOutputTokensRaw,
                    durationSeconds: activeDuration
                };
                // Coût figé au tarif du jour : OpenAI translate à la minute,
                // Gemini translate aux tokens. Un changement de tarif ultérieur
                // ne réécrit pas les statistiques passées.
                if (modelPricing && modelPricing.perMinute != null) {
                    stat.costDollars = (activeDuration / 60) * modelPricing.perMinute;
                } else if (modelPricing) {
                    stat.costDollars = (totalInputTokens / 1000) * modelPricing.input + (totalOutputTokens / 1000) * modelPricing.output;
                }
                addStat(stat);
            } else {
                const persona = getPersonas().find(p => p.id === getActiveId());
                const modelId = activeModelId || getRealtimeModel();
                const modelPricing = PRICING[modelId];
                const stat = {
                    personaId: getActiveId(),
                    personaName: persona ? persona.name : '?',
                    model: modelId,
                    date: new Date().toISOString(),
                    inputTokens: totalInputTokensRaw,
                    outputTokens: totalOutputTokensRaw,
                    durationSeconds: duration
                };
                // Pour les modèles facturés à la minute (translate), on calcule
                // ici et on fige `costDollars` — sinon getMonthCost/statCost
                // renverraient NaN puisque `perMinute` n'a pas de `input/output`.
                if (modelPricing && modelPricing.perMinute != null) {
                    const activeDuration = duration - Math.floor(pausedTime / 1000);
                    stat.costDollars = (activeDuration / 60) * modelPricing.perMinute
                        + backendTokenCost(modelId, totalInputTokens, totalOutputTokens); // GPT Live : + tokens backend
                } else if (modelPricing) {
                    // Modèles aux tokens : coût figé ici, depuis les compteurs
                    // convertis. Les compteurs enregistrés sont les VRAIS
                    // tokens, qu'un tarif unique ne suffit plus à valoriser.
                    stat.costDollars = (totalInputTokens / 1000) * modelPricing.input + (totalOutputTokens / 1000) * modelPricing.output;
                }
                // Frais hors tokens, figés avec la session : transcription de
                // la voix (OpenAI Realtime, mesurée tour par tour) et
                // recherches web.
                const transcriptionCost = sessionTranscriptionDollars(modelId, false, false);
                if (transcriptionCost > 0) stat.transcriptionCost = transcriptionCost;
                if (sessionToolCost > 0) stat.toolCost = sessionToolCost;
                addStat(stat);
            }
        }

        isConnected = false;
        connectionEpoch++; // invalide une connexion Whisper encore en cours d'établissement
        micReady = false;
        waitingGreeting = false;
        isPaused = false;
        pausedTime = 0;
        pauseStartedAt = null;
        // Vision : couper la caméra / le partage d'écran AVANT de fermer le
        // socket, sinon le timer de flux tenterait un dernier envoi.
        visionStopStream();
        closeVisionMenu();
        if (geminiTranscribeRolloverTimer) { clearTimeout(geminiTranscribeRolloverTimer); geminiTranscribeRolloverTimer = null; }
        if (geminiTranslateRolloverTimer) { clearTimeout(geminiTranslateRolloverTimer); geminiTranslateRolloverTimer = null; }
        geminiTranslateRollingOver = false;
        resetGeminiResumeState();
        currentWhisperParagraph = null;
        // GPT Live (WebRTC) : handlers détachés AVANT de fermer (comme pour le
        // WebSocket ci-dessous), fermeture polie de la session, puis du pair.
        if (liveAiIdleTimer)   { clearTimeout(liveAiIdleTimer);   liveAiIdleTimer = null; }
        if (liveUserIdleTimer) { clearTimeout(liveUserIdleTimer); liveUserIdleTimer = null; }
        if (liveDc) {
            liveDc.onmessage = liveDc.onopen = liveDc.onclose = null;
            try { if (liveDc.readyState === 'open') liveDc.send(JSON.stringify({ type: 'session.close' })); } catch(e){}
            liveDc = null;
        }
        if (livePc) {
            livePc.ontrack = livePc.onconnectionstatechange = null;
            try { livePc.close(); } catch(e){}
            livePc = null;
        }
        if (liveRemoteSource) { try { liveRemoteSource.disconnect(); } catch(e){} liveRemoteSource = null; }
        if (liveAudioEl) liveAudioEl.srcObject = null;
        // La piste micro a pu être coupée par le mute GPT Live : on la réactive
        // pour les sessions suivantes (l'analyseur de la ligne d'onde en dépend).
        if (persistentStream) persistentStream.getAudioTracks().forEach(t => { t.enabled = true; });
        // Détacher les handlers AVANT de fermer : le `onclose` d'un socket qu'on
        // ferme est asynchrone et, sans ça, il arriverait après le démarrage
        // d'une nouvelle session et écraserait son état (isConnected/échec).
        if (ws) { ws.onopen = ws.onmessage = ws.onerror = ws.onclose = null; try { ws.close(1000); } catch(e){} ws = null; }
        stopPlayback();
        if (playbackAnalyser) { playbackAnalyser = null; }
        if (playbackContext) { playbackContext.close(); playbackContext = null; }
        stopMicrophone();
        pendingFunctionCalls = {};
        currentTranscriptAi = null;
        currentTranscriptUser = null;
        resetLiveText(); // purge le texte live + ses timers de fondu (évite une mutation DOM tardive)
        startBtn.style.display = 'inline-block';
        stopBtn.style.display = 'none';
        muteBtn.style.display = 'none';
        pauseBtn.style.display = 'none';
        pauseBtn.classList.remove('paused');
        pauseBtn.innerHTML = ICON_SVG.pause;
        isMuted = false;
        document.getElementById('conversationArea').classList.remove('is-running');
        // Fin de session avec du texte produit : révèle les boutons
        // Copier/Exporter au-dessus du bouton « Démarrer » (classe retirée
        // et barre remise en place au prochain resetTranscript()).
        const showExportBar = hadConversation && (hasTranscriptMessages || hasTranscripteurText);
        document.getElementById('conversationArea').classList.toggle('session-ended', showExportBar);
        // Barre de session en fin de conversation : fige le temps passé et le
        // coût total (visibilité gérée par la classe .session-ended en CSS).
        if (showExportBar && sessionEndDur != null) {
            document.getElementById('sessionTimer').textContent = formatDuration(sessionEndDur);
            document.getElementById('sessionCost').textContent = fmtAmount(sessionEndCost, true);
        }
        if (showExportBar) moveExportBarAboveConnect(); else restoreExportBar();
        updateOrbCenterBtn('idle');
        setStatus('Prêt');

        // Extraire les insights si conversation significative (pas pour transcripteur ni traduction)
        if (analyzeInsights && hadConversation && !isTranscripteurMode && !isTraducteurMode && activeModelId !== 'gpt-realtime-translate') {
            extractInsights();
            // Mémoire du persona (Phase 1) : mise à jour AUTOMATIQUE en
            // arrière-plan, sans modale ni validation — indépendante de
            // l'extraction d'insights globaux (qui, elle, reste validée par
            // l'utilisateur via la modale).
            const memPersona = getPersonas().find(x => x.id === getActiveId());
            if (memPersona) {
                updatePersonaMemory(memPersona.id, memPersona.name);
                // Phase 3 : compte-rendu de session dans le vault Obsidian
                // (si connecté et si l'option est active — vérifié dedans).
                obsidianWriteSessionNote(memPersona.name, getTranscriptText(), getPersonaMemoryText(memPersona.id)).catch(() => {});
            }
        }
    }


