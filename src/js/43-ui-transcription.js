    // ── Barre Copier/Exporter de fin de session ──────────────────────
    // La barre (.transcript-header) est authored juste avant #transcript.
    // En fin de session, on la déplace DANS .bottom-controls (au-dessus du
    // bouton « Démarrer ») ; on la remet à sa place pour la relecture
    // d'historique (où elle coiffe la transcription) et à chaque reset.
    function moveExportBarAboveConnect() {
        const header  = document.querySelector('.transcript-header');
        const controls = document.querySelector('.bottom-controls');
        const connect = document.getElementById('connectBtn');
        if (header && controls && connect && header.parentElement !== controls) {
            controls.insertBefore(header, connect);
        }
    }
    function restoreExportBar() {
        const header = document.querySelector('.transcript-header');
        const transcript = document.getElementById('transcript');
        if (header && transcript && header.nextElementSibling !== transcript) {
            transcript.parentElement.insertBefore(header, transcript);
        }
    }

    function resetTranscript() {
        const el = document.getElementById('transcript');
        el.innerHTML = '';
        currentTranscriptAi = null;
        resetLiveText();
        document.getElementById('conversationArea').classList.remove('session-ended');
        restoreExportBar();
    }

    // ── Textes superposés en gros (overlay) ──
    let aiLiveTimeout = null;
    let userLiveTimeout = null;
    let userLiveBuffer = '';
    let userTurnActive = false;          // accumule-t-on un tour utilisateur en cours ?
    const USER_FADE_MS = 9000;           // durée d'affichage du texte utilisateur après dernier delta
    const AI_FADE_MS = 7000;             // durée d'affichage du texte IA après fin du tour

    function resetLiveText() {
        const ai = document.getElementById('aiLiveText');
        const user = document.getElementById('userLiveText');
        if (ai) { ai.textContent = ''; ai.classList.remove('visible'); }
        if (user) {
            user.querySelector('span').textContent = '';
            user.classList.remove('visible', 'ready-prompt');
        }
        userLiveBuffer = '';
        userTurnActive = false;
        if (typeof aiClearSync === 'function') aiClearSync();
        clearTimeout(aiLiveTimeout);
        clearTimeout(userLiveTimeout);
    }

    // ── Invite « Prêt, vous pouvez parler » retirée à la demande : la fonction
    // est conservée en no-op pour ne pas casser ses appelants. ──
    function showReadyPrompt() { /* volontairement vide */ }
    function clearReadyPrompt() {
        const user = document.getElementById('userLiveText');
        if (!user) return;
        if (user.classList.contains('ready-prompt')) {
            user.classList.remove('ready-prompt', 'visible');
            user.querySelector('span').textContent = '';
        }
    }

    // ── Synchronisation texte IA ↔ audio ──
    // Au lieu d'afficher le texte instantanément à la réception, on l'associe aux
    // chunks audio (startTime + duration). Un tick révèle les caractères au prorata
    // du temps de lecture audio — comme la classe AudioPlayer de la version React.
    let aiSyncChunks = [];       // { startTime, duration, text }
    let aiPendingText = '';      // texte reçu en attente d'un chunk audio à lier
    let aiRevealedLen = 0;       // nb total de chars déjà ajoutés au DOM
    let aiSyncInterval = null;

    function aiClearSync() {
        if (aiSyncInterval) { clearInterval(aiSyncInterval); aiSyncInterval = null; }
        aiSyncChunks = [];
        aiPendingText = '';
        aiRevealedLen = 0;
    }

    function aiStartTurn() {
        aiClearSync();
        const ai = document.getElementById('aiLiveText');
        if (ai) ai.textContent = '';
    }

    function aiQueueText(delta) {
        if (!delta) return;
        userTurnActive = false;
        clearReadyPrompt();
        aiPendingText += delta;
        const ai = document.getElementById('aiLiveText');
        if (ai) ai.classList.add('visible');
        clearTimeout(aiLiveTimeout);
        aiEnsureSyncInterval();
    }

    function aiAttachAudioToText(startTime, duration) {
        // Lie le texte bufferisé à ce chunk audio. Le texte est révélé pendant la lecture.
        aiSyncChunks.push({ startTime, duration, text: aiPendingText });
        aiPendingText = '';
        aiEnsureSyncInterval();
    }

    function aiFlushPending() {
        // Fin du tour IA : s'il reste du texte non lié à un audio, on lui attribue
        // une durée estimée pour qu'il défile à un rythme naturel.
        if (!aiPendingText) return;
        const charsPerSec = 14; // débit naturel ~14 caractères/seconde
        const dur = Math.max(0.4, aiPendingText.length / charsPerSec);
        const start = playbackContext
            ? Math.max(playbackContext.currentTime, nextPlayTime)
            : 0;
        aiSyncChunks.push({ startTime: start, duration: dur, text: aiPendingText });
        aiPendingText = '';
        aiEnsureSyncInterval();
    }

    function aiEnsureSyncInterval() {
        if (aiSyncInterval) return;
        aiSyncInterval = setInterval(aiTickReveal, 40);
    }

    function aiTickReveal() {
        if (aiSyncChunks.length === 0 && !aiPendingText) {
            clearInterval(aiSyncInterval); aiSyncInterval = null;
            return;
        }
        const currentTime = playbackContext ? playbackContext.currentTime : 0;
        let targetLen = 0;
        let fullText = '';
        for (const chunk of aiSyncChunks) {
            fullText += chunk.text;
            if (currentTime >= chunk.startTime + chunk.duration) {
                targetLen += chunk.text.length;
            } else if (currentTime >= chunk.startTime) {
                const progress = (currentTime - chunk.startTime) / chunk.duration;
                targetLen += Math.floor(progress * chunk.text.length);
            }
        }
        if (targetLen > aiRevealedLen) {
            const newChars = fullText.substring(aiRevealedLen, targetLen);
            appendAICharsToDisplay(newChars);
            aiRevealedLen = targetLen;
        }
    }

    function appendAICharsToDisplay(chars) {
        const ai = document.getElementById('aiLiveText');
        if (!ai) return;
        for (const char of chars) {
            if (char === '\n') {
                ai.appendChild(document.createElement('br'));
                continue;
            }
            const span = document.createElement('span');
            span.className = 'ai-char';
            span.textContent = char;
            ai.appendChild(span);
        }
    }

    function endAITurn() {
        // Marque la fin de la production texte côté serveur. On vide le buffer en
        // attente, puis on planifie le fade-out APRÈS la fin de la lecture audio.
        aiFlushPending();
        const ai = document.getElementById('aiLiveText');
        if (!ai) return;
        clearTimeout(aiLiveTimeout);
        // Attendre la fin de la lecture audio + la durée de fade
        const remainingAudioMs = playbackContext
            ? Math.max(0, (nextPlayTime - playbackContext.currentTime) * 1000)
            : 0;
        aiLiveTimeout = setTimeout(() => {
            ai.classList.remove('visible');
            setTimeout(() => { if (!ai.classList.contains('visible')) { ai.textContent = ''; aiRevealedLen = 0; } }, 500);
        }, AI_FADE_MS + remainingAudioMs);
    }

    function userStartTurn() {
        userTurnActive = true;
        userLiveBuffer = '';
        clearReadyPrompt();
        const user = document.getElementById('userLiveText');
        if (user) user.querySelector('span').textContent = '';
        clearTimeout(userLiveTimeout);
    }

    function appendUserLive(delta, verbatim = false) {
        if (!delta) return;
        const user = document.getElementById('userLiveText');
        if (!user) return;
        if (!userTurnActive) userStartTurn();
        if (verbatim) {
            // GPT Live : fragments infra-mot (« Parl » + « ons ») qui portent
            // déjà leurs espaces → surtout pas de séparateur ajouté.
            userLiveBuffer = (userLiveBuffer + delta).replace(/^\s+/, '');
        } else {
            // Concatène intelligemment (les deltas Gemini peuvent ou non contenir leur espace de fin)
            const sep = (userLiveBuffer && !/[\s\-']$/.test(userLiveBuffer) && !/^[\s,.;:!?\)\]]/.test(delta)) ? ' ' : '';
            userLiveBuffer = (userLiveBuffer + sep + delta).replace(/\s{2,}/g, ' ').trim();
        }
        user.querySelector('span').textContent = userLiveBuffer;
        user.classList.add('visible');
        clearTimeout(userLiveTimeout);
        userLiveTimeout = setTimeout(() => {
            user.classList.remove('visible');
            userTurnActive = false;
        }, USER_FADE_MS);
    }

    function setUserLive(text) {
        // Version finale propre (après .completed) — remplace tout delta accumulé
        const user = document.getElementById('userLiveText');
        if (!user) return;
        clearReadyPrompt();
        userLiveBuffer = (text || '').trim();
        user.querySelector('span').textContent = userLiveBuffer;
        user.classList.toggle('visible', !!userLiveBuffer);
        userTurnActive = false; // la phrase est finalisée
        clearTimeout(userLiveTimeout);
        if (userLiveBuffer) {
            userLiveTimeout = setTimeout(() => {
                user.classList.remove('visible');
            }, USER_FADE_MS);
        }
    }

    function addTranscriptMessage(sender, text, type) {
        const el = document.getElementById('transcript');
        // Supprimer le placeholder
        const placeholder = el.querySelector('.transcript-empty');
        if (placeholder) placeholder.remove();

        const msg = document.createElement('div');
        msg.className = `transcript-msg ${type}`;
        msg.innerHTML = `<div class="sender">${esc(sender)}</div><div class="text">${esc(text)}</div>`;
        el.appendChild(msg);
        return msg;
    }

    // Auto-scroll « sticky bottom » :
    // - Flag `isAtBottom` mis à jour par les events scroll (user wheel/drag).
    //   Seuil très serré (10 px) — il faut être VRAIMENT tout en bas pour que
    //   l'auto-scroll s'applique.
    // - Tant que `isAtBottom` est true, chaque mutation du transcript
    //   (nouveau message, streaming) re-scrolle vers le bas via un
    //   MutationObserver (couvre les chemins qui oublient scrollTranscript()).
    // - Dès que l'utilisateur scrolle au-delà du seuil, `isAtBottom` passe à
    //   false → on respecte sa position pour lire l'historique.
    // - Quand il revient à moins de 10 px du bas, `isAtBottom` repasse à
    //   true → l'auto-scroll redémarre sur le prochain message.
    const STICKY_THRESHOLD = 10;
    let isAtBottom = true;

    function scrollTranscript() {
        const el = document.getElementById('transcript');
        if (!el) return;
        if (!isAtBottom) return;
        el.scrollTop = el.scrollHeight;
    }

    (function attachTranscriptAutoScroll() {
        const el = document.getElementById('transcript');
        if (!el) return;

        // Met à jour le flag à chaque scroll utilisateur (et programmatique,
        // mais dans ce cas distFromBottom=0 donc flag reste true).
        el.addEventListener('scroll', () => {
            const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
            isAtBottom = distFromBottom <= STICKY_THRESHOLD;
        }, { passive: true });

        if (typeof MutationObserver !== 'function') return;
        let scheduled = false;
        const observer = new MutationObserver(() => {
            if (scheduled) return;
            scheduled = true;
            requestAnimationFrame(() => {
                scheduled = false;
                // Re-check au moment de l'exécution : l'utilisateur peut avoir
                // scrollé entre le fire du MutationObserver et le rAF.
                if (isAtBottom) el.scrollTop = el.scrollHeight;
            });
        });
        observer.observe(el, {
            childList:     true,  // nouveaux <div class="transcript-msg">
            subtree:       true,  // text streamé profond dans les .text
            characterData: true   // modifs de textContent
        });
    })();


    function updateTokenCounter() {
        const total = totalInputTokensRaw + totalOutputTokensRaw;
        const model = activeModelId || getRealtimeModel();
        const price = PRICING[model] || PRICING['gpt-realtime-2.1-mini'];
        const activeSec = (isConnected && conversationStartTime)
            ? Math.max(0, (Date.now() - conversationStartTime) / 1000 - (pausedTime || 0) / 1000)
            : 0;
        // Modèles facturés à la minute (Grok Voice, translate…) : coût sur la
        // durée active, indépendant des tokens.
        const perMinuteModel = price.perMinute != null;
        let cost = perMinuteModel
            ? (activeSec / 60) * price.perMinute + backendTokenCost(model, totalInputTokens, totalOutputTokens)
            : (totalInputTokens / 1000 * price.input) + (totalOutputTokens / 1000 * price.output);
        // Frais hors tokens : transcription de la voix (mesurée tour par
        // tour) et recherches web.
        cost += sessionTranscriptionDollars(model, isTranscripteurMode, isTraducteurMode) + sessionToolCost;

        const showCost = total > 0 || (perMinuteModel && isConnected) || sessionToolCost > 0;
        document.getElementById('sessionModel').textContent = model;
        document.getElementById('sessionTokens').textContent = total > 0 ? `${total.toLocaleString()} tokens` : '';
        document.getElementById('sessionCost').textContent = showCost ? fmtAmount(cost, true) : '';

        // Badge modèle sous le nom : TOUJOURS visible, avec le VRAI modèle du
        // contexte (jamais un résidu d'une session/relecture précédente).
        // - Session en cours : le modèle actif.
        // - Transcripteur / Traducteur : le moteur choisi (OpenAI/Gemini).
        // - Persona : son modèle effectif.
        const phm = document.getElementById('personaHeaderModel');
        if (phm) {
            let badgeModel;
            if (isConnected) {
                badgeModel = model;
            } else if (isTranscripteurMode) {
                badgeModel = transcribeModelInfo(getTranscribeModel()).model;
            } else if (isTraducteurMode) {
                badgeModel = translateModelInfo(getTranslateModel()).model;
            } else {
                const persona = getPersonas().find(p => p.id === getActiveId());
                badgeModel = persona ? getEffectiveModel(persona) : (activeModelId || getRealtimeModel());
            }
            phm.textContent = badgeModel || '';
        }
    }

    //  Mode discussion : orb central (IA) + ligne d'onde (utilisateur)
    //  Mode transcripteur : reuse drawRadialViz sur #userViz

    const userCanvas = document.getElementById('userViz');
    const userCtx = userCanvas.getContext('2d');
    const aiOrbCanvas = document.getElementById('aiOrbCanvas');
    const aiOrbCtx = aiOrbCanvas.getContext('2d');
    const userWaveCanvas = document.getElementById('userWaveCanvas');
    const userWaveCtx = userWaveCanvas.getContext('2d');

    let smoothUserLevel = 0;
    let smoothPersonaLevel = 0;

    // Analyseur fréquentiel pour le micro utilisateur (alimente la ligne d'onde)
    let userMicAnalyser = null;
    const userFreqData = new Uint8Array(128);
    const aiFreqData = new Uint8Array(128);

    // État interne de l'orb (lissage)
    let orbPhase = 0;
    let orbVolume = 0, orbBass = 0, orbMid = 0, orbHigh = 0;

    // État interne de la ligne d'onde (lissage)
    let wavePhase = 0;
    let waveAmplitude = 0;

    function rgba(color, a) {
        return color.replace('rgb', 'rgba').replace(')', `, ${a})`);
    }

    // ── Bouton "Initialiser / Déconnecter" + glow central ──
    function updateOrbCenterBtn(state) {
        // state : 'idle' | 'connecting' | 'connected'
        const btn = document.getElementById('connectBtn');
        const glow = document.getElementById('centralGlow');
        if (!btn) return;
        btn.classList.remove('connected', 'connecting');
        const labelEl = btn.querySelector('.connect-btn-label');

        // Libellés contextualisés : « transcription » en mode Transcripteur,
        // « conversation » sinon.
        const startLabel = isTranscripteurMode ? 'Démarrer la transcription' : 'Démarrer la conversation';
        const startTitle = isTranscripteurMode ? 'Démarrer la transcription (Espace)' : 'Démarrer la discussion (Espace)';

        if (state === 'connecting') {
            btn.classList.add('connecting');
            btn.title = 'Connexion...';
            if (labelEl) labelEl.textContent = 'Connexion…';
        } else if (state === 'connected') {
            btn.classList.add('connected');
            btn.title = isTranscripteurMode ? 'Arrêter la transcription (Espace)' : 'Arrêter la discussion (Espace)';
            if (labelEl) labelEl.textContent = isTranscripteurMode ? 'Arrêter la transcription' : 'Arrêter la conversation';
            showReadyPrompt();
        } else {
            btn.title = startTitle;
            if (labelEl) labelEl.textContent = startLabel;
            clearReadyPrompt();
        }
        // Glow central
        if (glow) {
            glow.classList.remove('connected', 'speaking');
            if (state === 'connected') glow.classList.add('connected');
        }
        // Le bouton mute du bas suit l'état de la connexion
        if (typeof syncBottomMuteBtn === 'function') syncBottomMuteBtn();
    }

    document.getElementById('connectBtn').addEventListener('click', () => {
        if (isConnected) {
            document.getElementById('stopBtn').click();
        } else {
            document.getElementById('startBtn').click();
        }
    });

    // Bascule le glow en "speaking" (violet) quand l'IA parle, retour en bleu sinon
    function setGlowSpeaking(isSpeaking) {
        const glow = document.getElementById('centralGlow');
        if (!glow || !glow.classList.contains('connected')) return;
        glow.classList.toggle('speaking', !!isSpeaking);
    }

