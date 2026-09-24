    // ── Vision : quels modèles voient, et à quel prix ────────────────────
    // Deux natures de vision selon l'API du modèle :
    //  • 'video' (Gemini Live) : un VRAI flux. Les images partent en continu
    //    sur le WebSocket déjà ouvert pour l'audio (realtimeInput.video), à
    //    1 image/seconde — la cadence maximale acceptée par l'API.
    //  • 'image' (OpenAI Realtime) : des images FIXES uniquement. On insère un
    //    message utilisateur contenant un input_image dans la conversation,
    //    puis on demande la réponse. Pas de flux : la caméra et l'écran
    //    servent de viseur, chaque envoi est déclenché par l'utilisateur.
    // GPT Live 1 et Grok Voice ne prennent ni l'un ni l'autre → bouton Vision
    // masqué pour eux.
    //  • GPT Live 1 : sa fiche modèle donne image et vidéo comme non
    //    supportées en entrée.
    //  • Grok Voice : vérifié dans le schéma WebSocket officiel de xAI
    //    (voice-realtime.ws.json), où le type d'un contenu de
    //    conversation.item.create est un enum FERMÉ : input_text, input_audio,
    //    text, audio. Pas d'input_image, et la fiche du modèle annonce
    //    « Text, Audio -> Text, Audio ». Les options enable_image_understanding
    //    / enable_video_understanding qu'on trouve dans ces docs portent sur
    //    les outils de recherche web, pas sur une image qu'on lui enverrait.
    //    (La vision existe chez xAI, mais côté modèles CHAT — grok-4.6.)
    const VISION_VIDEO_MODELS = new Set(['gemini-3.8-live', 'gemini-3.8-live-extended-thinking', 'gemini-3.1-flash-live-preview']);
    const VISION_IMAGE_MODELS = new Set(['gpt-realtime-2.1', 'gpt-realtime-2.1-mini', 'gpt-realtime-2']);
    function getVisionMode(model) {
        if (VISION_VIDEO_MODELS.has(model)) return 'video';
        if (VISION_IMAGE_MODELS.has(model)) return 'image';
        return null;
    }
    // Tokens d'une image du flux côté Gemini 3 : 70 à la résolution média par
    // défaut (280 seulement en « high », réservé à l'OCR). À 1 image/seconde,
    // ça fait 4 200 tokens d'entrée par minute de vidéo.
    const VISION_GEMINI_TOKENS_PER_FRAME = 70;
    // Mémoire (contexte) d'une session Gemini Live : compression déclenchée à
    // 25 000 tokens, 8 000 conservés (valeurs conseillées par Google).
    const GEMINI_CONTEXT_TRIGGER_TOKENS = 25000;
    const GEMINI_CONTEXT_TARGET_TOKENS = 8000;
    // OpenAI ne publie PAS le nombre de tokens d'une image pour les modèles
    // Realtime. 1 000 est un ordre de grandeur (image ramenée à 768 px de
    // petit côté, règle des tuiles de 512 px des modèles GPT-5), utilisé
    // UNIQUEMENT pour l'estimation affichée. Le coût réellement compté, lui,
    // vient des tokens renvoyés par l'API (input_token_details.image_tokens).
    const VISION_OPENAI_TOKENS_PER_IMAGE = 1000;

    // Icône de la MODALITÉ acceptée, pour repérer d'un coup d'oeil ce que le
    // modèle sait voir : caméscope = flux vidéo en direct, cadre photo =
    // images fixes. La forme seule porte l'information (aucune couleur).
    const VISION_MODE_ICONS = {
        video: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m23 7-7 5 7 5V7z"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg>',
        image: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/></svg>'
    };

    // Surcoût de la vision pour ce modèle, ou null s'il n'en a pas.
    //   badge : texte de la pastille affichée sous le tarif, dans les listes
    //   icon  : l'icône de modalité qui va dans cette pastille
    //   label : ce que l'icône veut dire, pour les lecteurs d'écran
    //   value : le montant, mis en avant dans la bulle de la conversation
    //   note  : la base de calcul
    function visionCostInfo(model) {
        const mode = getVisionMode(model);
        const p = PRICING[model];
        if (!mode || !p || p.imageInput == null) return null;
        const rate = fmtUsd(p.imageInput * 1000);
        if (mode === 'video') {
            // Gemini refacture à CHAQUE réponse tout ce qui reste en mémoire,
            // images comprises : le coût de la vidéo se compte par réponse,
            // pas à l'heure. La mémoire étant plafonnée à 25 000 tokens, la
            // part vidéo d'une réponse ne peut pas dépasser ce plafond.
            const maxPerReply = (GEMINI_CONTEXT_TRIGGER_TOKENS / 1000) * p.imageInput;
            return {
                mode: 'video',
                icon: VISION_MODE_ICONS.video,
                label: 'Vidéo en direct',
                badge: `Vidéo ≤ ${fmtUsd(maxPerReply)}/réponse`,
                value: `jusqu'à ~${fmtUsd(maxPerReply)} par réponse`,
                note: `Chaque image (1 par seconde) reste en mémoire et Gemini la refacture à chaque réponse, à ${rate}/1M tokens. Vart plafonne cette mémoire à ${(GEMINI_CONTEXT_TRIGGER_TOKENS / 1000)} 000 tokens, d'où ce maximum. Le compteur de la session affiche le coût réel.`
            };
        }
        const perImage = (VISION_OPENAI_TOKENS_PER_IMAGE / 1000) * p.imageInput;
        return {
            mode: 'image',
            icon: VISION_MODE_ICONS.image,
            label: 'Images fixes',
            badge: `Images + ${rate}/M`,
            value: perImage < 0.005 ? 'moins de $0.01 par image' : `≈ ${fmtUsd(perImage)} par image`,
            note: `Tokens image facturés ${rate}/1M en entrée, en plus du tarif audio. OpenAI ne publie pas le nombre de tokens par image en Realtime : l'estimation part de ${VISION_OPENAI_TOKENS_PER_IMAGE} tokens.`
        };
    }

    // Un même compteur de tokens regroupe des tokens qui ne coûtent pas le
    // même prix : texte, audio, image, en cache ou non. Plutôt que de
    // dupliquer toute la chaîne de calcul du coût (session, historique,
    // stats, budget), on convertit chaque part en « équivalent » du tarif de
    // référence du modèle au moment de la comptabiliser : le reste de l'app
    // continue de multiplier totalInputTokens par le seul tarif d'entrée, et
    // tombe juste. Sans tarif propre connu, les tokens restent au tarif de
    // référence (surestimation plutôt que sous-estimation).
    function tokensAtRate(tokens, rate, base) {
        if (!tokens) return 0;
        if (rate == null || !base) return tokens;
        return tokens * (rate / base);
    }

    // Additionne un tableau ModalityTokenCount (usageMetadata Gemini) par
    // modalité : { TEXT, AUDIO, IMAGE, VIDEO, DOCUMENT }.
    function geminiModalityCounts(details) {
        const out = { TEXT: 0, AUDIO: 0, IMAGE: 0, VIDEO: 0, DOCUMENT: 0 };
        if (Array.isArray(details)) details.forEach(d => {
            const m = String((d && (d.modality || d.Modality)) || '').toUpperCase();
            const n = (d && (d.tokenCount || d.token_count)) || 0;
            if (m in out) out[m] += n;
        });
        return out;
    }

    // Voix disponibles par fournisseur
    const VOICES = {
        openai: [
            { value: 'alloy',   label: 'Alloy - neutre, polyvalente' },
            { value: 'ash',     label: 'Ash - masculin, claire' },
            { value: 'ballad',  label: 'Ballad - masculin, douce' },
            { value: 'cedar',   label: 'Cedar - masculin, chaleureuse' },
            { value: 'coral',   label: 'Coral - féminin, chaleureuse' },
            { value: 'echo',    label: 'Echo - masculin, profonde' },
            { value: 'marin',   label: 'Marin - féminin, vive' },
            { value: 'sage',    label: 'Sage - féminin, calme' },
            { value: 'shimmer', label: 'Shimmer - féminin, pétillante' },
            { value: 'verse',   label: 'Verse - masculin, expressive' }
        ],
        // Voix GPT Live (OpenAI) — jeu distinct des voix Realtime. « marin »
        // est la voix par défaut de l'API Live ; les autres sont les voix
        // annoncées au lancement de gpt-live-1 (septembre 2026).
        live: [
            { value: 'marin',    label: 'Marin - voix par défaut' },
            { value: 'quartz',   label: 'Quartz - féminin' },
            { value: 'willow',   label: 'Willow - féminin' },
            { value: 'gleam',    label: 'Gleam - féminin' },
            { value: 'bossa',    label: 'Bossa - féminin' },
            { value: 'delta',    label: 'Delta - féminin' },
            { value: 'ripple',   label: 'Ripple - masculin' },
            { value: 'vesper',   label: 'Vesper - masculin' },
            { value: 'stone',    label: 'Stone - masculin' },
            { value: 'meridian', label: 'Meridian - masculin' },
            { value: 'tempo',    label: 'Tempo - masculin' },
            { value: 'beacon',   label: 'Beacon - masculin' },
            { value: 'cinder',   label: 'Cinder - masculin' }
        ],
        gemini: [
            { value: 'Puck',    label: 'Puck - conversationnel, amical' },
            { value: 'Kore',    label: 'Kore - neutre, professionnel' },
            { value: 'Charon',  label: 'Charon - profond, autoritaire' },
            { value: 'Fenrir',  label: 'Fenrir - chaleureux, accessible' },
            { value: 'Aoede',   label: 'Aoede - douce, mélodieuse' },
            { value: 'Leda',    label: 'Leda - féminin, posée' },
            { value: 'Orus',    label: 'Orus - masculin, dynamique' },
            { value: 'Zephyr',  label: 'Zephyr - léger, expressif' }
        ],
        // Voix Grok (xAI) — identifiants en minuscules (insensibles à la casse
        // côté API). Les cinq voix historiques puis quelques-unes des voix
        // « flagship » ajoutées en 2026.
        xai: [
            { value: 'eve',    label: 'Eve - féminin, énergique' },
            { value: 'ara',    label: 'Ara - féminin, chaleureuse' },
            { value: 'rex',    label: 'Rex - masculin, chaleureux' },
            { value: 'sal',    label: 'Sal - neutre, posée' },
            { value: 'leo',    label: 'Leo - masculin, assuré' },
            { value: 'aurora', label: 'Aurora - nouvelle voix' },
            { value: 'luna',   label: 'Luna - nouvelle voix' },
            { value: 'atlas',  label: 'Atlas - nouvelle voix' },
            { value: 'orion',  label: 'Orion - nouvelle voix' },
            { value: 'carina', label: 'Carina - nouvelle voix, support' }
        ]
    };


    function getApiKey() { return localStorage.getItem('vart_apiKey') || ''; }
    function setApiKey(k) { localStorage.setItem('vart_apiKey', k); }

    function getGeminiApiKey() { return localStorage.getItem('vart_geminiApiKey') || ''; }
    function setGeminiApiKey(k) { localStorage.setItem('vart_geminiApiKey', k); }

    function getXaiApiKey() { return localStorage.getItem('vart_xaiApiKey') || ''; }
    function setXaiApiKey(k) { localStorage.setItem('vart_xaiApiKey', k); }

    function getTheme() { return localStorage.getItem('vart_theme') || 'dark'; }
    function setThemeStorage(t) { localStorage.setItem('vart_theme', t); }

    function getRealtimeModel() {
        const saved = localStorage.getItem('vart_realtimeModel') || 'gpt-realtime-2.1-mini';
        // Si le modèle sauvegardé pointe vers un provider dont la clé n'est pas
        // configurée, on bascule vers le premier modèle utilisable (sinon le
        // sélecteur reste grisé et l'utilisateur ne comprend pas).
        const provider = getProviderForModel(saved);
        const hasKey = (provider === 'openai' && !!getApiKey())
                    || (provider === 'gemini' && !!getGeminiApiKey())
                    || (provider === 'xai'    && !!getXaiApiKey());
        if (hasKey) return saved;
        if (getApiKey())       return 'gpt-realtime-2.1-mini';
        if (getGeminiApiKey()) return 'gemini-3.8-live';
        if (getXaiApiKey())    return 'grok-voice-think-fast-2.0';
        return saved;
    }
    function setRealtimeModel(m) { localStorage.setItem('vart_realtimeModel', m); }

    // Modèle de transcription de la PAROLE UTILISATEUR (input) sur le chemin
    // OpenAI Realtime. Fixé à gpt-transcribe (le choix côté UI a été retiré) :
    // il remplace gpt-4o-mini-transcribe, qu'OpenAI retire le 26/02/2027, avec
    // le même fonctionnement (un tour validé par le VAD, puis sa
    // transcription, en WebSocket). Sans effet sur Gemini (qui transcrit
    // lui-même) ni sur le mode Transcripteur (gpt-realtime-whisper).
    function getTranscriptionModel() { return 'gpt-transcribe'; }

    // Transcription de la voix de l'utilisateur, en dollars, pour la session
    // en cours. Seules les sessions OpenAI Realtime en mode persona la paient :
    // Gemini, GPT Live et Grok transcrivent eux-mêmes, le Transcripteur et le
    // Traducteur ont leur propre tarif.
    function sessionTranscriptionDollars(modelId, isTr, isTl) {
        if (isTr || isTl) return 0;
        if (getProviderForModel(modelId) !== 'openai' || isLiveModel(modelId)) return 0;
        return sessionTranscriptionCost;
    }

    // Relevé de la transcription d'un tour. OpenAI ne facture que l'audio
    // réellement transcrit (pas les silences), et renvoie la durée dans
    // `usage`. Sans relevé exploitable, on estime depuis le texte : environ
    // 900 caractères par minute de parole.
    function recordTranscriptionUsage(usage, transcript) {
        const tp = PRICING[getTranscriptionModel()];
        if (!tp || tp.perMinute == null) return;
        let seconds;
        if (usage && usage.type === 'duration' && usage.seconds != null) {
            seconds = usage.seconds;
        } else if (usage && usage.type === 'tokens' && usage.input_token_details
                   && usage.input_token_details.audio_tokens != null) {
            seconds = usage.input_token_details.audio_tokens / 10; // 1 token audio = 100 ms
        } else {
            seconds = String(transcript || '').length / 15;
        }
        sessionTranscriptionCost += (seconds / 60) * tp.perMinute;
        updateTokenCounter();
    }

    function getBudgetLimit() { const v = localStorage.getItem('vart_budgetLimit'); return v ? parseFloat(v) : null; }
    function setBudgetLimit(v) { if (v === null || v === '') localStorage.removeItem('vart_budgetLimit'); else localStorage.setItem('vart_budgetLimit', v); }

    function getMonthCost() {
        const stats = getStats();
        const now = new Date();
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
        return stats.filter(s => new Date(s.date) >= monthStart).reduce((sum, s) => {
            const transc = (s.transcriptionCost || 0) + (s.toolCost || 0); // transcription (OpenAI) + recherches web
            if (s.costDollars != null) return sum + s.costDollars + transc;
            const p = PRICING[s.model] || PRICING['gpt-realtime-2.1-mini'];
            // Modèles à la minute (translate, whisper) : coût basé sur la durée.
            if (p.perMinute != null) return sum + ((s.durationSeconds || 0) / 60) * p.perMinute + backendTokenCost(s.model, s.inputTokens, s.outputTokens) + transc;
            return sum + ((s.inputTokens || 0) / 1000 * p.input) + ((s.outputTokens || 0) / 1000 * p.output) + transc;
        }, 0);
    }

    function getPersonas() {
        try { return JSON.parse(localStorage.getItem('vart_personas')) || []; }
        catch { return []; }
    }
    function savePersonas(list) { localStorage.setItem('vart_personas', JSON.stringify(list)); }

    function getActiveId() { return localStorage.getItem('vart_activePersonaId') || ''; }
    function setActiveId(id) { localStorage.setItem('vart_activePersonaId', id); }

    function getUserInfo() { return localStorage.getItem('vart_userInfo') || ''; }
    function setUserInfo(info) { localStorage.setItem('vart_userInfo', info); }

    function getStats() {
        try { return JSON.parse(localStorage.getItem('vart_stats')) || []; }
        catch { return []; }
    }
    function addStat(entry) {
        const stats = getStats();
        stats.push(entry);
        localStorage.setItem('vart_stats', JSON.stringify(stats));
    }

