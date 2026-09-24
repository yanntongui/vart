    async function generateAvatarImage(provider) {
        const name = document.getElementById('pName').value.trim();
        const desc = document.getElementById('pDescription').value.trim();
        if (!desc && !name) { customAlert('Renseignez au moins un nom ou une description.', { icon: 'pencil' }); return; }
        if (provider === 'openai' && !getApiKey()) {
            customAlert('La génération avec GPT Image nécessite une clé API OpenAI.', { title: 'Clé API requise', icon: 'key' });
            return;
        }
        if (provider === 'gemini' && !getGeminiApiKey()) {
            customAlert('La génération avec Gemini nécessite une clé API Gemini.', { title: 'Clé API requise', icon: 'key' });
            return;
        }

        const gptBtn = document.getElementById('generateGptBtn');
        const geminiBtn = document.getElementById('generateGeminiBtn');
        const hint = document.getElementById('imageHint');
        const genPreview = document.getElementById('pImagePreviewPopup');
        gptBtn.disabled = true;
        geminiBtn.disabled = true;
        // Pas de texte : une roue de chargement s'affiche par-dessus l'aperçu.
        hint.textContent = '';
        if (genPreview) genPreview.classList.add('is-generating');
        const myToken = ++imageGenToken; // capture avant l'appel réseau

        try {
            const style = document.getElementById('pImageStyle').value;
            const details = document.getElementById('pImageDetails').value.trim();
            // Couleurs choisies par l'utilisateur (mémorisées comme préférences
            // globales pour rester cohérentes d'un avatar à l'autre).
            const bgHex  = getAvatarBgColor();
            const topHex = getAvatarTopColor();
            // Prompt « gabarit » : on fige cadrage, pose, éclairage, trait,
            // fond et couleur du haut pour que tous les avatars soient quasi
            // identiques ; seuls l'identité du persona, le style choisi et les
            // détails libres varient.
            const subject = desc ? `${name || 'Assistant'}, ${desc}` : (name || 'Assistant');
            const prompt =
`Avatar de persona, portrait carré 1:1. Sujet : ${subject}.
IMPORTANT : déduis l'apparence du personnage, dont son GENRE (homme ou femme), à partir du prénom « ${name || 'Assistant'} »${desc ? ' et de la description' : ''} (ex. un prénom féminin => une femme).${details ? `\nDétails à intégrer au personnage : ${details}.` : ''}

CADRAGE STRICT ET IDENTIQUE pour tous les avatars (cohérence de collection) :
- Buste (tête + épaules), sujet parfaitement CENTRÉ, vu de FACE, regardant droit vers l'objectif.
- Composition symétrique ; sommet de la tête en haut avec une petite marge, épaules coupées par le bord inférieur.
- Même distance et même zoom, mêmes proportions, yeux à la même hauteur.
- Expression neutre et avenante (léger sourire).

Rendu : ${style}. Trait homogène et net, épaisseur de trait constante.
Éclairage doux, frontal et uniforme (studio), identique d'un avatar à l'autre.

Vêtement : le personnage porte un haut (t-shirt/pull) de couleur UNIE exactement ${topHex}.
Fond : couleur UNIE et PLATE, exactement ${bgHex}, aucun dégradé, aucune texture, aucun motif, aucun décor ni accessoire.

Pas de texte, pas de cadre ni bordure, pas de filigrane.`;

            let imgSrc = null;

            if (provider === 'openai') {
                // OpenAI Images API (GPT Image)
                const resp = await fetch('https://api.openai.com/v1/images/generations', {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${getApiKey()}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        model: OPENAI_IMAGE_MODEL,
                        prompt: prompt,
                        n: 1,
                        size: '1024x1024',
                        quality: 'medium'
                    })
                });

                if (!resp.ok) {
                    const err = await resp.json().catch(() => ({}));
                    throw new Error(err.error?.message || `HTTP ${resp.status}`);
                }

                const data = await resp.json();
                if (data.data?.[0]?.b64_json) {
                    imgSrc = 'data:image/png;base64,' + data.data[0].b64_json;
                } else if (data.data?.[0]?.url) {
                    imgSrc = data.data[0].url;
                }
                if (imgSrc) recordImageGenerationCost(OPENAI_IMAGE_MODEL, openaiImageCost(data, prompt));
            } else {
                // Gemini image (cf. GEMINI_IMAGE_MODEL). L'ancien
                // gemini-3-pro-image-preview a été éteint par Google le
                // 25/06/2026.
                const resp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_IMAGE_MODEL}:generateContent?key=${encodeURIComponent(getGeminiApiKey())}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        contents: [{ parts: [{ text: prompt }] }],
                        generationConfig: {
                            responseModalities: ['TEXT', 'IMAGE'],
                            imageConfig: { aspectRatio: '1:1' }
                        }
                    })
                });

                if (!resp.ok) {
                    const err = await resp.json().catch(() => ({}));
                    throw new Error(err.error?.message || `HTTP ${resp.status}`);
                }

                const data = await resp.json();
                // L'API renvoie du camelCase (inlineData/mimeType) sur cet
                // endpoint ; on gère aussi le snake_case par sécurité.
                const imgPart = data.candidates?.[0]?.content?.parts?.find(p => p.inlineData || p.inline_data);
                const inline = imgPart && (imgPart.inlineData || imgPart.inline_data);
                if (inline && inline.data) {
                    imgSrc = `data:${inline.mimeType || inline.mime_type || 'image/png'};base64,${inline.data}`;
                    recordImageGenerationCost(GEMINI_IMAGE_MODEL, geminiImageCost(data));
                }
            }

            if (imgSrc) {
                resizeImageToBase64(imgSrc, 300, (b64) => {
                    if (myToken !== imageGenToken) { if (genPreview) genPreview.classList.remove('is-generating'); return; } // popup fermée / persona changé
                    if (!b64) { if (genPreview) genPreview.classList.remove('is-generating'); hint.textContent = 'Échec du chargement de l\'image générée.'; return; }
                    tempImage = b64;
                    renderImagePreview(); // reconstruit l'aperçu → retire la roue (is-generating)
                    hint.textContent = 'Image générée !';
                });
            } else {
                if (genPreview) genPreview.classList.remove('is-generating');
                hint.textContent = 'Réponse inattendue de l\'API.';
            }
        } catch (err) {
            if (genPreview) genPreview.classList.remove('is-generating');
            hint.textContent = `Erreur : ${err.message}`;
            console.error('Image generation error:', err);
        } finally {
            gptBtn.disabled = false;
            geminiBtn.disabled = false;
        }
    }
    document.getElementById('generateGptBtn').addEventListener('click', async () => {
        // Niveau 3 du budget : confirmation avant action payante (Phase 1).
        if (!await confirmCostEstimate('Générer un avatar avec OpenAI Images', '≈ $0.02 à $0.19 selon la qualité')) return;
        generateAvatarImage('openai');
    });
    document.getElementById('generateGeminiBtn').addEventListener('click', async () => {
        if (!await confirmCostEstimate('Générer un avatar avec Gemini Imagen', '≈ quelques centimes par image')) return;
        generateAvatarImage('gemini');
    });

    // Créer le prompt via API (depuis nom + description)
    document.getElementById('createPromptBtn').addEventListener('click', async () => {
        const name = document.getElementById('pName').value.trim();
        const desc = document.getElementById('pDescription').value.trim();

        if (!name) { customAlert('Renseignez au moins le nom du persona.', { icon: 'pencil' }); return; }
        if (!hasAnyApiKey()) { customAlert('Configurez d\'abord une clé API.', { title: 'Clé API requise', icon: 'key' }); return; }

        const btn = document.getElementById('createPromptBtn');
        const hint = document.getElementById('promptHint');
        btn.disabled = true;
        hint.textContent = 'Création en cours...';

        try {
            const systemMsg = `Tu es un expert en prompt engineering pour l'API Realtime (voix) d'OpenAI.
Tu dois créer un system prompt complet, structuré en markdown, hyper-optimisé pour une conversation vocale temps réel.

Règles IMPÉRATIVES :
- Structure en sections markdown avec des titres #
- Sections obligatoires : Identité, Personnalité (ton, humour, style, énergie, expressivité vocale), Langue, Règles de conversation orale, Outils disponibles
- L'identité doit s'appuyer sur le nom et la description fournis pour créer un persona cohérent et vivant
- Respecte impérativement le genre précisé plus bas : partout où l'IA parle d'elle-même, les accords (assistant/assistante, adjectifs, participes passés) doivent correspondre à ce genre. Précise-le explicitement dans la section Identité.
- Les règles orales doivent insister sur : concision, phrases courtes, pas de markdown/listes dans les réponses, langage naturel, expressivité vocale
- Spécifie des directives de voix : rythme, intonation, usage de mots de remplissage, niveau de formalité
- Inclure une section "Outils" mentionnant l'accès à la recherche web (quand c'est vraiment utile), la météo, et la date/heure actuelle
- Le prompt doit être en français
- Retourne UNIQUEMENT le prompt, sans explication autour`;

            const gender = await resolvePromptGender(name, desc);
            const created = await chatCompletion({
                systemPrompt: systemMsg,
                userPrompt: `Crée un prompt complet pour un persona vocal nommé "${name}". Description : ${desc || 'un assistant vocal sympathique et utile'}.\n\n${promptGenderDirective(name, gender)}`,
                temperature: 0.7,
                maxTokens: 2000
            });
            if (created) {
                document.getElementById('pPrompt').value = created;
                hint.textContent = 'Prompt créé !';
            } else {
                hint.textContent = 'Réponse vide.';
            }
        } catch (err) {
            hint.textContent = `Erreur : ${err.message}`;
        } finally {
            btn.disabled = false;
        }
    });

    // Optimiser le prompt via API
    document.getElementById('optimizePromptBtn').addEventListener('click', async () => {
        const name = document.getElementById('pName').value.trim() || 'Mon assistant';
        const desc = document.getElementById('pDescription').value.trim();
        const currentPrompt = document.getElementById('pPrompt').value.trim();

        if (!currentPrompt && !desc && !name) {
            customAlert('Renseignez au moins un nom, une description ou un début de prompt.', { icon: 'pencil' });
            return;
        }
        if (!hasAnyApiKey()) { customAlert('Configurez d\'abord une clé API.', { title: 'Clé API requise', icon: 'key' }); return; }

        const btn = document.getElementById('optimizePromptBtn');
        const hint = document.getElementById('promptHint');
        btn.disabled = true;
        hint.textContent = 'Optimisation en cours...';

        try {
            const systemMsg = `Tu es un expert en prompt engineering pour des assistants vocaux temps réel.
Tu dois transformer le texte fourni par l'utilisateur en un system prompt complet, structuré en markdown, hyper-optimisé pour une conversation vocale temps réel.

Règles IMPÉRATIVES :
- Structure en sections markdown avec des titres #
- Sections obligatoires : Identité, Personnalité (ton, humour, style, énergie), Langue, Règles de conversation orale, Outils disponibles
- Respecte impérativement le genre précisé plus bas : partout où l'IA parle d'elle-même, les accords (assistant/assistante, adjectifs, participes passés) doivent correspondre à ce genre. Précise-le explicitement dans la section Identité.
- Les règles orales doivent insister sur : concision, phrases courtes, pas de markdown/listes dans les réponses, langage naturel, expressivité vocale
- Spécifie des directives de voix : rythme, intonation, usage de mots de remplissage, niveau de formalité
- Inclure une section "Outils" mentionnant l'accès à la recherche web (quand c'est vraiment utile), la météo, et la date/heure actuelle. Indiquer comment les utiliser naturellement.
- Le prompt doit être en français
- Retourne UNIQUEMENT le prompt optimisé, sans explication ni commentaire autour`;

            const gender = await resolvePromptGender(name, desc);
            const genderDirective = promptGenderDirective(name, gender);
            const userMsg = (currentPrompt
                ? `Voici le prompt brut à optimiser pour le persona "${name}" (${desc || 'pas de description'}) :\n\n${currentPrompt}`
                : `Crée un prompt complet pour un persona vocal nommé "${name}". Description : ${desc || 'un assistant vocal sympathique'}`
            ) + `\n\n${genderDirective}`;

            const optimized = await chatCompletion({
                systemPrompt: systemMsg,
                userPrompt: userMsg,
                temperature: 0.7,
                maxTokens: 2000
            });

            if (optimized) {
                document.getElementById('pPrompt').value = optimized;
                hint.textContent = 'Prompt optimisé !';
            } else {
                hint.textContent = 'Réponse vide de l\'API.';
            }
        } catch (err) {
            hint.textContent = `Erreur : ${err.message}`;
            console.error('Prompt optimization error:', err);
        } finally {
            btn.disabled = false;
        }
    });

    // Sauvegarder le persona
    document.getElementById('savePersonaBtn').addEventListener('click', () => {
        const name = document.getElementById('pName').value.trim();
        if (!name) { customAlert('Le nom est obligatoire.', { icon: 'pencil' }); return; }

        const list = getPersonas();
        const prompt = document.getElementById('pPrompt').value.trim() || DEFAULT_PROMPT(name);
        const description = document.getElementById('pDescription').value.trim();

        // Si on édite, on récupère l'ancien gender pour ne pas l'écraser inutilement.
        const previous = editingPersonaId ? list.find(p => p.id === editingPersonaId) : null;

        const persona = {
            id: editingPersonaId || ('p_' + Date.now()),
            name: name,
            description: description,
            image: tempImage,
            gender: previous?.gender || null,  // inféré plus bas si manquant et pas d'image
            model: document.getElementById('pModel').value || '',
            voice: document.getElementById('pVoice').value,
            reactivity: document.getElementById('pReactivity').value,
            creativity: document.getElementById('pCreativity').value,
            greeting: document.getElementById('pGreeting').value,
            personaInfo: document.getElementById('pPersonaInfo').value.trim(),
            prompt: prompt,
            // Phase 1 : posture + règles par blocs + plafond mensuel du persona
            posture: editingPosture,
            rules: collectRules(),
            budgetLimit: parseFloat(document.getElementById('pBudgetLimit').value) || null
        };
        // Mémoire : stockage IndexedDB séparé du JSON des personas (elle peut
        // être longue et change à chaque session). Fire-and-forget assumé :
        // vartDbRun est best-effort et la mémoire n'est jamais bloquante.
        savePersonaMemory(persona.id, document.getElementById('pMemory').value.trim());

        if (editingPersonaId) {
            const idx = list.findIndex(p => p.id === editingPersonaId);
            if (idx > -1) list[idx] = persona;
        } else {
            list.push(persona);
        }

        savePersonas(list);
        closePersonaModal();
        renderPersonaList();

        // Édité/créé depuis l'accueil : on y RESTE (pas de saut dans la
        // conversation avec ce persona). On rafraîchit juste la grille d'accueil.
        if (personaModalFromHome) {
            renderWelcomeGrid();
        // Persona actif modifié pendant une session en cours : on ne rappelle
        // pas selectPersona() (qui stopperait la conversation via
        // stopConversation()). La session continue avec l'ancienne version du
        // prompt — injectée au démarrage seulement — donc on prévient.
        } else if ((isConnected || waitingGreeting) && editingPersonaId && editingPersonaId === getActiveId() && !isTranscripteurMode && !isTraducteurMode) {
            customAlert('Vos modifications sont enregistrées, mais la conversation en cours continue avec l\'ancienne version du persona. Elles seront prises en compte à la prochaine conversation.', { title: 'Persona modifié', icon: 'pencil' });
        } else {
            selectPersona(persona.id);
        }

        // En arrière-plan : si pas d'image ET pas encore de genre inféré (ou
        // ancien genre « neutral » à re-déterminer), on demande au LLM de
        // deviner (male/female) pour choisir la bonne silhouette. Non bloquant :
        // la carte s'actualise dès la réponse.
        if (!persona.image && (!persona.gender || persona.gender === 'neutral')) {
            inferPersonaGender(persona).then(gender => {
                if (!gender) return;
                const fresh = getPersonas();
                const i = fresh.findIndex(p => p.id === persona.id);
                if (i < 0) return;
                fresh[i] = { ...fresh[i], gender };
                savePersonas(fresh);
                renderWelcomeGrid();
                renderPersonaList();
                // Rafraîchir aussi l'en-tête si ce persona est celui affiché
                // (sinon il garde la silhouette par défaut jusqu'à re-sélection).
                if (getActiveId() === persona.id && !isTranscripteurMode && !isTraducteurMode && !persona.image) {
                    const avatarContainer = document.getElementById('personaHeaderAvatar');
                    if (avatarContainer) avatarContainer.innerHTML = `<div class="persona-header-placeholder">${silhouetteFor(gender)}</div>`;
                }
            });
        }
    });

    // Demande au LLM d'inférer le genre d'un persona (pour choisir la silhouette
    // de remplacement quand il n'a pas d'image). Renvoie 'male' / 'female',
    // ou '' en cas d'échec. Pas d'option « neutre » : on impose un des deux.
    async function inferPersonaGender(persona) {
        if (!hasAnyApiKey()) return '';
        try {
            const raw = await chatCompletion({
                systemPrompt: `Tu reçois un nom et une description courte d'assistant vocal.
Devine son genre apparent. Réponds par UN SEUL mot, en minuscules, sans ponctuation :
- "male" si masculin
- "female" si féminin
Choisis obligatoirement l'un des deux, même en cas de doute (le plus probable d'après le prénom ; pour un objet/animal/abstraction, choisis le genre grammatical ou le plus courant).`,
                userPrompt: `Nom : ${persona.name}\nDescription : ${persona.description || '(aucune)'}`,
                temperature: 0,
                maxTokens: 5
            });
            // « female » testé avant « male » car il le contient.
            const m = (raw || '').toLowerCase().match(/female|male/);
            return m ? m[0] : '';
        } catch (e) {
            console.warn('Inférence genre persona échouée :', e);
            return '';
        }
    }

    // Genre à annoncer au générateur de prompt : réutilise le genre déjà connu du
    // persona (cohérent avec la silhouette affichée sur sa carte), sinon l'infère
    // depuis le nom + la description. Renvoie 'male' / 'female' / '' (indéterminé).
    async function resolvePromptGender(name, description) {
        const existing = editingPersonaId ? getPersonas().find(p => p.id === editingPersonaId) : null;
        if (existing && (existing.gender === 'male' || existing.gender === 'female')) return existing.gender;
        return await inferPersonaGender({ name, description });
    }

    // Directive de genre injectée dans la génération/optimisation du prompt :
    // garantit que l'IA parle d'elle-même avec les bons accords, pour ne pas
    // qu'une voix féminine se présente au masculin (ou l'inverse).
    function promptGenderDirective(name, gender) {
        const who = `« ${name} »`;
        if (gender === 'female') {
            return `Genre de l'IA : FÉMININ. ${who} est une assistante (une femme). Rédige le prompt pour qu'elle parle TOUJOURS d'elle-même au féminin : « une assistante », « je suis ravie », « je suis là pour toi », adjectifs et participes au féminin (attentive, présente, prête…), et JAMAIS au masculin.`;
        }
        if (gender === 'male') {
            return `Genre de l'IA : MASCULIN. ${who} est un assistant (un homme). Rédige le prompt pour qu'il parle TOUJOURS de lui-même au masculin : « un assistant », « je suis ravi », « je suis là pour toi », adjectifs et participes au masculin (attentif, présent, prêt…), et JAMAIS au féminin.`;
        }
        return `Genre de l'IA : déduis d'après le prénom ${who} s'il s'agit d'un assistant (masculin) ou d'une assistante (féminin), puis veille à ce que TOUS les accords que l'IA fait sur elle-même (assistant/assistante, adjectifs, participes) soient cohérents avec ce genre.`;
    }

    // Export persona
    document.getElementById('exportPersonaBtn').addEventListener('click', async () => {
        // Collect current form data as a persona object
        const name = document.getElementById('pName').value.trim();
        if (!name) { customAlert('Renseignez au moins le nom avant d\'exporter.', { icon: 'pencil' }); return; }

        // Phase 3 : export COMPLET — les sources de ce persona voyagent avec
        // lui (texte des chunks, sans les vecteurs d'embedding : plusieurs Mo
        // qui seraient recalculés à l'import après confirmation du coût).
        const sources = editingPersonaId ? (await listPersonaSources(editingPersonaId)).map(s => ({
            type: s.type, name: s.name, addedAt: s.addedAt, chunks: s.chunks
        })) : [];

        const personaExport = {
            type: 'vart-persona',
            // v3 : ajoute les sources au fichier (v2 = postures + règles).
            // L'import accepte v1 (« kast-persona »), v2 et v3.
            version: 3,
            exportDate: new Date().toISOString(),
            sources,
            persona: {
                name: name,
                description: document.getElementById('pDescription').value.trim(),
                image: tempImage,
                model: document.getElementById('pModel').value || '',
                voice: document.getElementById('pVoice').value,
                reactivity: document.getElementById('pReactivity').value,
                creativity: document.getElementById('pCreativity').value,
                greeting: document.getElementById('pGreeting').value,
                personaInfo: document.getElementById('pPersonaInfo').value.trim(),
                gender: (getPersonas().find(x => x.id === editingPersonaId) || {}).gender || null,
                prompt: document.getElementById('pPrompt').value.trim(),
                // Phase 1 : la posture et les règles voyagent avec le persona
                posture: editingPosture,
                rules: collectRules(),
                budgetLimit: parseFloat(document.getElementById('pBudgetLimit').value) || null
            }
        };

        const blob = new Blob([JSON.stringify(personaExport, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `Vart-Persona-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${exportTimestamp()}.json`;
        a.click();
        URL.revokeObjectURL(url);
    });

    // Import persona
    document.getElementById('importPersonaInput').addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (ev) => {
            try {
                const data = JSON.parse(ev.target.result);
                // Rétrocompatibilité : on accepte les exports de l'ancienne
                // application (« kast-persona ») comme les exports Vart.
                if (!data.type || (data.type !== 'vart-persona' && data.type !== 'kast-persona') || !data.persona) {
                    customAlert('Ce fichier n\'est pas un persona Vart valide.', { title: 'Erreur', icon: 'x-circle' });
                    return;
                }
                const p = data.persona;
                const newPersona = {
                    id: 'p_' + Date.now(),
                    name: p.name || 'Persona importé',
                    description: p.description || '',
                    image: p.image || null,
                    gender: p.gender || null,
                    model: p.model || '',
                    voice: p.voice || 'coral',
                    reactivity: p.reactivity || 'balanced',
                    creativity: p.creativity || 'balanced',
                    greeting: p.greeting || 'persona',
                    personaInfo: p.personaInfo || '',
                    prompt: p.prompt || DEFAULT_PROMPT(p.name || 'Mon assistant'),
                    // Champs Phase 1 — absents des anciens exports (v1 /
                    // kast-persona) : valeurs par défaut neutres.
                    posture: p.posture || '',
                    rules: Array.isArray(p.rules) ? p.rules : [],
                    budgetLimit: p.budgetLimit || null
                };

                const list = getPersonas();
                list.push(newPersona);
                savePersonas(list);
                renderPersonaList();
                selectPersona(newPersona.id);

                // Phase 3 : restauration des sources embarquées (export v3).
                const importedSources = Array.isArray(data.sources)
                    ? data.sources.filter(s => s && Array.isArray(s.chunks) && s.chunks.length)
                    : [];
                if (importedSources.length) restoreImportedSources(newPersona, importedSources);

            } catch (err) {
                customAlert('Erreur lors de l\'import : ' + err.message, { title: 'Erreur', icon: 'x-circle' });
            }
        };
        reader.readAsText(file);
        e.target.value = '';
    });


