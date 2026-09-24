    async function fetchWithTimeout(url, options = {}, ms = 30000) {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), ms);
        try {
            return await fetch(url, { ...options, signal: ctrl.signal });
        } catch (err) {
            if (err.name === 'AbortError') throw new Error(`Délai dépassé (${Math.round(ms/1000)}s)`);
            throw err;
        } finally {
            clearTimeout(t);
        }
    }

    // Modèles texte Gemini qui acceptent le niveau de réflexion « minimal »
    // (guide « thinking » de l'API Gemini, 16/09/2026).
    const GEMINI_TEXT_MINIMAL_THINKING = new Set(['gemini-3.5-flash-lite', 'gemini-3.5-flash']);

    // Appelle un LLM texte. Si `model` est passé, on respecte ce choix (route
    // vers OpenAI ou Gemini selon le préfixe). Sinon : OpenAI si la clé est
    // dispo (gpt-4o-mini), sinon Gemini (gemini-3.5-flash-lite).
    async function chatCompletion({ systemPrompt, userPrompt, temperature = 0.7, maxTokens = 2000, model = null }) {
        // Résolution du modèle effectif + provider
        let effectiveModel = model;
        if (!effectiveModel) {
            effectiveModel = getApiKey() ? 'gpt-4o-mini'
                          : getGeminiApiKey() ? 'gemini-3.5-flash-lite'
                          : null;
        }
        if (!effectiveModel) throw new Error('Aucune clé API configurée.');

        if (isGeminiTextModel(effectiveModel)) {
            if (!getGeminiApiKey()) throw new Error('Clé API Gemini requise pour ce modèle.');
            // Gemma (contrairement à Gemini) n'honore pas fiablement
            // `systemInstruction` — le modèle a tendance à répéter/paraphraser
            // les consignes dans sa réponse. On fusionne les instructions
            // système dans le message user pour les modèles Gemma.
            const isGemma = effectiveModel.startsWith('gemma');
            // Réflexion : les modèles Gemini 3 réfléchissent par défaut, et ces
            // tokens comptent dans maxOutputTokens. Un plafond serré (5 tokens
            // pour deviner un genre, 30 pour un titre) pouvait être avalé par
            // la réflexion, d'où une réponse vide. Ces tâches courtes n'en ont
            // pas besoin : niveau minimal là où il existe, et un plafond d'au
            // moins 256 tokens (le prompt borne déjà la longueur de la réponse,
            // et le chemin OpenAI n'envoie aucun plafond).
            const generationConfig = { temperature, maxOutputTokens: Math.max(maxTokens, 256) };
            if (GEMINI_TEXT_MINIMAL_THINKING.has(effectiveModel)) {
                generationConfig.thinkingConfig = { thinkingLevel: 'minimal' };
            }
            const body = isGemma
                ? {
                    contents: [{ role: 'user', parts: [{ text: `${systemPrompt}\n\n${userPrompt}` }] }],
                    generationConfig
                  }
                : {
                    systemInstruction: { parts: [{ text: systemPrompt }] },
                    contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
                    generationConfig
                  };
            const post = () => fetchWithTimeout(`https://generativelanguage.googleapis.com/v1beta/models/${effectiveModel}:generateContent?key=${encodeURIComponent(getGeminiApiKey())}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });
            let resp = await post();
            // Réglage de réflexion refusé (400) : on retente sans, plutôt que
            // de priver l'utilisateur de son titre ou de son analyse.
            if (!resp.ok && resp.status === 400 && generationConfig.thinkingConfig) {
                delete generationConfig.thinkingConfig;
                resp = await post();
            }
            if (!resp.ok) {
                const err = await resp.json().catch(() => ({}));
                throw new Error(err.error?.message || `HTTP ${resp.status}`);
            }
            const data = await resp.json();
            return data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
        }

        // OpenAI
        if (!getApiKey()) throw new Error('Clé API OpenAI requise pour ce modèle.');
        const resp = await fetchWithTimeout('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${getApiKey()}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: effectiveModel,
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: userPrompt }
                ],
                temperature
            })
        });
        if (!resp.ok) {
            const err = await resp.json().catch(() => ({}));
            throw new Error(err.error?.message || `HTTP ${resp.status}`);
        }
        const data = await resp.json();
        return data.choices?.[0]?.message?.content?.trim() || '';
    }

    // Génère un résumé court (≤5 mots) du contenu d'une conversation, en français.
    // Renvoie une chaîne nettoyée ou '' en cas d'échec / contenu trop maigre.
    async function generateConversationSummary(messages) {
        if (!Array.isArray(messages) || messages.length === 0) return '';
        // Reconstruire un transcript court (limiter pour rester économe)
        const transcript = messages
            .map(m => {
                const who = m.sender === 'user' ? 'Moi' : (m.sender === 'ai' ? 'IA' : 'Note');
                return `${who}: ${m.text || ''}`;
            })
            .join('\n')
            .slice(0, 6000);
        if (transcript.trim().length < 20) return '';
        try {
            const raw = await chatCompletion({
                systemPrompt: `Tu génères un titre court en français pour une conversation vocale.

Règles :
- Exactement 3 à 5 mots
- En français
- Pas de guillemets, pas de point final, pas de puce (*, -)
- Pas de préfixe ("Titre :", "Sujet :", "Output :", etc.)
- Droit au sujet, sans « Conversation sur… »
- Si la conversation est vide/triviale, réponds exactement : VIDE

Exemples de bons titres :
- Vacances en Italie cet été
- Configuration serveur Docker
- Recette de tarte au citron
- Débat sur l'IA

Réponds UNIQUEMENT avec le titre, rien d'autre.`,
                userPrompt: `Transcription :\n\n${transcript}\n\nTitre :`,
                temperature: 0.3,
                maxTokens: 30,
                model: getTitleModel()
            });

            // Nettoyage agressif : les petits modèles (Gemma notamment) ajoutent
            // souvent des préfixes parasites (« * Input:… », « Titre : … »,
            // « Output: … », des puces, des mise en forme markdown, etc.).
            // On strip ligne par ligne et on garde la première ligne qui
            // ressemble à un titre.
            const stripLine = (line) => line
                // Puces markdown en tête
                .replace(/^\s*[*•\-–—]+\s*/, '')
                // Préfixes du type « Input: », « Output: », « Titre : », « Sujet : », etc.
                .replace(/^\s*(?:input|output|titre|title|sujet|subject|résumé|resume|topic|conversation)\s*[:\-–]\s*/i, '')
                // Guillemets et espaces autour
                .replace(/^["'«»\s]+|["'«»\s.]+$/g, '')
                .trim();

            const looksLikeTitle = (s) => {
                if (!s) return false;
                if (/^vide$/i.test(s)) return false;
                // Rejette les phrases explicatives (« A transcription of… », etc.)
                if (/^(a|an|the|un|une|le|la|les|des|voici|here|this)\s/i.test(s)) return false;
                const words = s.split(/\s+/).filter(Boolean);
                return words.length >= 1 && words.length <= 8;
            };

            const candidates = (raw || '')
                .split(/\r?\n/)
                .map(stripLine)
                .filter(Boolean);
            let summary = candidates.find(looksLikeTitle) || '';

            if (!summary || /^vide$/i.test(summary)) return '';
            // Garde-fou : tronque à 5 mots max
            const words = summary.split(/\s+/);
            if (words.length > 5) summary = words.slice(0, 5).join(' ');
            return summary;
        } catch (e) {
            console.warn('Résumé de conversation échoué :', e);
            return '';
        }
    }


