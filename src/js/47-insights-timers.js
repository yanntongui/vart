    function getTranscriptText(markdown = false) {
        const msgs = document.querySelectorAll('#transcript .transcript-msg');
        let text = '';
        msgs.forEach(m => {
            const sender = m.querySelector('.sender')?.textContent || '';
            const content = m.querySelector('.text')?.textContent || '';
            if (markdown) {
                text += `**${sender}**\n${content}\n\n`;
            } else {
                text += `${sender}: ${content}\n`;
            }
        });
        return text;
    }

    async function extractInsights() {
        const transcript = getTranscriptText();
        if (!transcript.trim() || transcript.length < 50) return; // Trop court

        const existingInfo = getUserInfo();
        const modal = document.getElementById('insightsModal');
        const list = document.getElementById('insightsList');
        const loading = document.getElementById('insightsLoading');

        list.innerHTML = '';
        loading.style.display = 'block';
        document.getElementById('addInsightsBtn').style.display = 'none';
        modal.classList.add('active');

        try {
            const insightSystemPrompt = `Tu es un assistant qui analyse des transcriptions de conversations vocales.
Ton rôle : extraire les informations personnelles DURABLES et NOUVELLES sur l'utilisateur (celui qui parle avec l'IA).

Informations déjà connues sur l'utilisateur (NE PAS les répéter) :
${existingInfo || '(aucune)'}

EXTRAIRE UNIQUEMENT des faits DURABLES sur l'utilisateur :
- Identité : prénom, âge, lieu de vie, nationalité
- Vie pro : métier, entreprise, compétences, projets professionnels
- Vie perso : famille, animaux, loisirs, passions, goûts
- Préférences : ce qu'il aime/n'aime pas, habitudes, opinions marquées
- Projets : voyages prévus, déménagement, changement de carrière, etc.

NE JAMAIS EXTRAIRE :
- L'heure, la date, la météo, ou toute info temporelle/éphémère
- Ce que l'utilisateur a fait aujourd'hui, ce matin, hier (sauf si ça révèle une habitude)
- Les questions posées à l'IA ou les sujets de conversation ponctuels
- Les salutations, formules de politesse, blagues du moment
- Les émotions passagères ("je suis fatigué", "j'ai faim")
- Tout ce qui n'est plus vrai demain

Règles de format :
- Chaque info doit être une phrase courte commençant par "- "
- NE répète PAS ce qui est déjà dans les infos connues
- Si aucune info durable détectée, retourne exactement : AUCUNE
- Retourne UNIQUEMENT la liste, sans commentaire`;

            const result = await chatCompletion({
                systemPrompt: insightSystemPrompt,
                userPrompt: `Transcription de la conversation :\n\n${transcript}`,
                temperature: 0.3,
                maxTokens: 1000,
                model: getAnalysisModel()
            }) || 'AUCUNE';

            loading.style.display = 'none';

            if (result === 'AUCUNE' || !result.includes('- ')) {
                list.innerHTML = '<div style="text-align:center;padding:16px;color:var(--text-secondary)">Aucune nouvelle information détectée dans cette conversation.</div>';
                return;
            }

            // Parser les insights
            const insights = result.split('\n')
                .map(l => l.trim())
                .filter(l => l.startsWith('- '))
                .map(l => l.substring(2).trim())
                .filter(l => l.length > 0);

            if (insights.length === 0) {
                list.innerHTML = '<div style="text-align:center;padding:16px;color:var(--text-secondary)">Aucune nouvelle information détectée.</div>';
                return;
            }

            document.getElementById('addInsightsBtn').style.display = 'block';

            insights.forEach((insight, i) => {
                const item = document.createElement('div');
                item.className = 'insight-item';
                item.dataset.dest = 'global';
                item.innerHTML = `
                    <div class="insight-item-top">
                        <input type="checkbox" id="insight_${i}" checked>
                        <label for="insight_${i}">${esc(insight)}</label>
                    </div>
                    <div class="insight-dest-row">
                        <button type="button" class="insight-dest-btn active" data-dest="global">Global</button>
                        <button type="button" class="insight-dest-btn" data-dest="persona">Ce persona</button>
                    </div>
                `;
                item.querySelector('.insight-item-top').addEventListener('click', (e) => {
                    // Exclure aussi LABEL : le <label> bascule déjà nativement la
                    // case ; sans cette exclusion, le clic sur le texte re-bascule
                    // et s'annule (le libellé paraissait ne rien faire).
                    if (e.target.tagName !== 'INPUT' && e.target.tagName !== 'LABEL') {
                        const cb = item.querySelector('input[type="checkbox"]');
                        cb.checked = !cb.checked;
                    }
                });
                item.querySelectorAll('.insight-dest-btn').forEach(btn => {
                    btn.addEventListener('click', () => {
                        item.querySelectorAll('.insight-dest-btn').forEach(b => b.classList.remove('active'));
                        btn.classList.add('active');
                        item.dataset.dest = btn.dataset.dest;
                    });
                });
                list.appendChild(item);
            });

        } catch (err) {
            loading.style.display = 'none';
            list.innerHTML = `<div style="text-align:center;padding:16px;color:var(--danger)">Erreur : ${esc(err.message)}</div>`;
            console.error('Insights error:', err);
        }
    }

    document.getElementById('closeInsightsBtn').addEventListener('click', () => {
        document.getElementById('insightsModal').classList.remove('active');
    });
    document.getElementById('skipInsightsBtn').addEventListener('click', () => {
        document.getElementById('insightsModal').classList.remove('active');
    });
    document.getElementById('addInsightsBtn').addEventListener('click', () => {
        const items = document.querySelectorAll('#insightsList .insight-item');
        const globalInsights = [];
        const personaInsights = [];

        items.forEach(item => {
            const cb = item.querySelector('input[type="checkbox"]');
            if (!cb || !cb.checked) return;
            const label = item.querySelector('label')?.textContent?.trim();
            if (!label) return;
            if (item.dataset.dest === 'persona') {
                personaInsights.push(`- ${label}`);
            } else {
                globalInsights.push(`- ${label}`);
            }
        });

        if (globalInsights.length === 0 && personaInsights.length === 0) {
            document.getElementById('insightsModal').classList.remove('active');
            return;
        }

        // Save global insights
        if (globalInsights.length > 0) {
            let currentInfo = getUserInfo().trim();
            if (currentInfo && !currentInfo.endsWith('\n')) currentInfo += '\n';
            currentInfo += globalInsights.join('\n');
            setUserInfo(currentInfo);
        }

        // Save persona-specific insights
        if (personaInsights.length > 0) {
            const activeId = getActiveId();
            const list = getPersonas();
            const persona = list.find(p => p.id === activeId);
            if (persona) {
                let info = (persona.personaInfo || '').trim();
                if (info && !info.endsWith('\n')) info += '\n';
                info += personaInsights.join('\n');
                persona.personaInfo = info;
                savePersonas(list);
            }
        }

        const total = globalInsights.length + personaInsights.length;
        const parts = [];
        if (globalInsights.length > 0) parts.push(`${globalInsights.length} globale(s)`);
        if (personaInsights.length > 0) parts.push(`${personaInsights.length} pour ce persona`);

        document.getElementById('insightsModal').classList.remove('active');
        setStatus(`${total} info(s) ajoutée(s) : ${parts.join(', ')}`);
    });


    function formatDuration(seconds) {
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        const s = seconds % 60;
        const ss = s.toString().padStart(2, '0');
        if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${ss}`;
        return `${m}:${ss}`;
    }

    function startTimer() {
        conversationStartTime = Date.now();
        document.getElementById('sessionTimer').textContent = '0:00';
        // Visibilité du sessionBar pilotée par la classe .is-running (CSS).
        timerInterval = setInterval(() => {
            const currentPause = isPaused && pauseStartedAt ? Date.now() - pauseStartedAt : 0;
            const elapsed = Math.floor((Date.now() - conversationStartTime - pausedTime - currentPause) / 1000);
            document.getElementById('sessionTimer').textContent = formatDuration(Math.max(0, elapsed));

            // Mise à jour du coût en temps réel pour le transcripteur
            if (isTranscripteurMode) {
                const trModel = activeModelId || transcribeModelInfo(getTranscribeModel()).model;
                const trPrice = PRICING[trModel];
                const cost = (Math.max(0, elapsed) / 60) * ((trPrice && trPrice.perMinute) || 0);
                document.getElementById('sessionModel').textContent = trModel;
                document.getElementById('sessionTokens').textContent = '';
                document.getElementById('sessionCost').textContent = fmtAmount(cost, true);
            } else if (isConnected && activeModelId && PRICING[activeModelId] && PRICING[activeModelId].perMinute != null) {
                // Modèle de conversation facturé à la minute (Grok Voice) : le
                // coût avance avec le temps, pas avec les tokens.
                updateTokenCounter();
            }
        }, 1000);
    }

    function stopTimer() {
        let duration = 0;
        if (conversationStartTime) {
            duration = Math.floor((Date.now() - conversationStartTime) / 1000);
        }
        if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
        conversationStartTime = null;
        return duration;
    }


    // "Statistiques" est maintenant un onglet dans la modale Configuration —
    // les anciens boutons d'ouverture/fermeture ne sont plus nécessaires.

    document.getElementById('statsTabBtns').addEventListener('click', (e) => {
        const btn = e.target.closest('button[data-stats-tab]');
        if (!btn) return;
        document.querySelectorAll('#statsTabBtns button').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        renderStats(btn.dataset.statsTab);
    });

    // Entrée de statistiques qui n'est pas une conversation : la génération
    // d'un avatar. Comptée dans les coûts et le budget, jamais dans le nombre
    // de conversations ni dans les durées.
