    function fmtUsd(n) { return '$' + n.toFixed(2).replace(/\.00$/, ''); }
    // Montant FACTURÉ (session, historique, stats, budget), arrondi au centime.
    // Sous le centime on écrit « < $0.01 » : « $0.00 » laisserait croire que
    // rien n'a été facturé. `approx` préfixe d'un ~ les montants estimés ;
    // inutile sous le centime, où le « < » dit déjà que c'est un ordre de
    // grandeur. À ne pas confondre avec fmtUsd, qui formate des TARIFS et
    // laisse tomber les décimales nulles (« $32 », « $0.05 »).
    function fmtAmount(n, approx) {
        const v = Math.max(0, Number(n) || 0);
        if (v > 0 && v < 0.005) return '< $0.01';
        return (approx ? '~$' : '$') + v.toFixed(2);
    }
    function fmtTokenRate(p) { return `Entrée ${fmtUsd(p.input * 1000)}/1M · Sortie ${fmtUsd(p.output * 1000)}/1M`; }

    // Coûts approximatifs par 1000 tokens
    const PRICING = {
        // Tarifs Realtime OpenAI, par 1K tokens (page tarifs OpenAI, vérifiée
        // le 16/09/2026). Le prix dépend de la MODALITÉ et du CACHE :
        //                 audio            texte            image
        //   2.1 et 2   $32 · $0.40 · $64  $4 · $0.40 · $24  $5 · $0.50
        //   2.1-mini   $10 · $0.30 · $20  $0.60 · $0.06 · $2.40  $0.80 · $0.08
        //   (entrée · entrée en cache · sortie, par million)
        // Le cache compte énormément ici : chaque tour renvoie tout le
        // contexte, dont l'essentiel est déjà en cache, et l'audio en cache
        // coûte 80 fois moins cher que l'audio neuf sur 2.1.
        // `input` / `output` = l'audio, tarif de référence par lequel le reste
        // de l'app multiplie les compteurs ; le reste est converti à la
        // comptabilisation (cf. handleServerEvent, response.done).
        'gpt-realtime-2.1':      { input: 0.032, cachedInput: 0.0004, output: 0.064,
                                   textInput: 0.004,   cachedTextInput: 0.0004,   textOutput: 0.024,
                                   imageInput: 0.005,  cachedImageInput: 0.0005 },
        'gpt-realtime-2.1-mini': { input: 0.010, cachedInput: 0.0003, output: 0.020,
                                   textInput: 0.0006,  cachedTextInput: 0.00006,  textOutput: 0.0024,
                                   imageInput: 0.0008, cachedImageInput: 0.00008 },
        'gpt-realtime-2':        { input: 0.032, cachedInput: 0.0004, output: 0.064,
                                   textInput: 0.004,   cachedTextInput: 0.0004,   textOutput: 0.024,
                                   imageInput: 0.005,  cachedImageInput: 0.0005 },
        // GPT Live 1 (OpenAI) : la couche vocale est facturée à la minute
        // ($0.05/min, à la seconde près) ; le raisonnement et les outils sont
        // délégués à un modèle Responses « backend » facturé aux tokens
        // (cf. backendTokenCost). $0.20/1M entrée · $1.20/1M sortie.
        'gpt-live-1':            { perMinute: 0.05, backendModel: 'gpt-5.6-luna' },
        // Backend de GPT Live : entrée en cache $0.02/1M, écriture en cache
        // $0.25/1M (1,25 fois l'entrée, nouveauté de GPT-5.6).
        'gpt-5.6-luna':          { input: 0.0002, output: 0.0012, cachedInput: 0.00002, cacheWriteInput: 0.00025 },
        // Modèles de transcription (parole utilisateur) — facturés à la minute.
        // gpt-transcribe remplace gpt-4o-mini-transcribe, retiré par OpenAI le
        // 26/02/2027 : même fonctionnement (transcription de chaque tour
        // validé, en WebSocket), facturé à la durée d'audio transcrit.
        'gpt-transcribe':         { perMinute: 0.0045 },
        // Anciens modèles, gardés pour relire les statistiques existantes.
        'gpt-4o-transcribe':      { perMinute: 0.006 },
        'gpt-4o-mini-transcribe': { perMinute: 0.003 },
        'whisper-1':              { perMinute: 0.006 },
        // Recherche web des sessions Realtime (cf. performWebSearch).
        'gpt-4o-mini':            { input: 0.00015, output: 0.0006 },
        // Avatars OpenAI (GPT Image 2.5 Flare) : $5/1M de texte et $8/1M
        // d'image en entrée, $30/1M en sortie. Une image 1024×1024 en qualité
        // medium ≈ 439 tokens de sortie, soit ~$0.013 (calculateur du guide de
        // génération d'images OpenAI, 16/09/2026).
        'gpt-image-2.5-flare':    { textInput: 0.005, imageInput: 0.008, output: 0.03, approxPerImage: 0.0132 },
        // Avatars Gemini (Nano Banana 2) : $0.50/1M en entrée, $3/1M en sortie
        // texte et réflexion, $60/1M en sortie image, soit ~$0.067 l'image 1K,
        // la taille par défaut (page tarifs Gemini API, 16/09/2026).
        'gemini-3.1-flash-image': { input: 0.0005, output: 0.003, imageOutput: 0.06, approxPerImage: 0.067 },
        // Translate et Whisper sont facturés à la minute, pas au token.
        'gpt-realtime-translate': { perMinute: 0.034 },
        // Gemini Live (page tarifs Gemini API, vérifiée le 16/09/2026) — un
        // seul tableau pour 3.8 Live, 3.8 Live Extended Thinking et l'ancien
        // 3.1 Flash Live. Le prix dépend de la MODALITÉ :
        //   entrée  $3/1M audio · $0.75/1M texte · $1/1M image et vidéo
        //   sortie  $12/1M audio · $4.50/1M texte (« réflexion comprise »)
        // `input` / `output` = l'audio, tarif de référence par lequel le reste
        // de l'app multiplie les compteurs ; les autres modalités sont
        // converties à la comptabilisation (cf. handleGeminiServerEvent).
        // Pas de « Gemini 3.8 Flash Live » : « Gemini 3.8 Flash » est un
        // modèle TEXTE, le vocal s'appelle « Gemini 3.8 Live ».
        'gemini-3.8-live':                   { input: 0.003, output: 0.012, textInput: 0.00075, textOutput: 0.0045, imageInput: 0.001 },
        'gemini-3.8-live-extended-thinking': { input: 0.003, output: 0.012, textInput: 0.00075, textOutput: 0.0045, imageInput: 0.001 },
        'gemini-3.1-flash-live-preview':     { input: 0.003, output: 0.012, textInput: 0.00075, textOutput: 0.0045, imageInput: 0.001 },
        // Gemini Live Translate : facturé aux tokens (usageMetadata), $3.50/1M
        // en entrée et $21/1M en sortie (audio), soit ~$0.0368/min d'après
        // Google (25 tokens audio par seconde).
        'gemini-3.5-live-translate-preview': { input: 0.0035, output: 0.021, approxPerMinute: 0.037 },
        'gpt-realtime-whisper': { perMinute: 0.017 },
        // Gemini 3.5 Transcribe Live : $3.50/1M tokens audio en entrée
        // (≈ $0.005/min) + $21/1M tokens texte en sortie (≈ $0.004/min)
        // → ≈ $0.009/min tout compris (cf. page tarifs Gemini API).
        'gemini-3.5-transcribe-live': { perMinute: 0.009 },
        // Grok Voice (xAI) : facturé à la minute d'audio de session.
        'grok-voice-think-fast-2.0': { perMinute: 0.08 },
        // Modèles texte (analyse + génération de titre) — tarifs par 1K tokens
        'gemini-3.5-flash':      { input: 0.0015,  output: 0.009  },
        'gemini-3.5-flash-lite': { input: 0.0003,  output: 0.0025 },
        'gpt-5.5':               { input: 0.005,   output: 0.030  },
        'gpt-5.4':               { input: 0.0025,  output: 0.015  },
        'gpt-5.4-mini':          { input: 0.00075, output: 0.0045 },
        'gpt-5.4-nano':          { input: 0.00020, output: 0.00125 }
    };

    // Catalogue des modèles texte sélectionnables pour les tâches non temps-réel
    // (analyse de discussion + génération du titre). Le `cost` est purement
    // informatif pour la liste déroulante. Ordonné du moins cher au plus cher.
    const TEXT_MODELS = {
        openai: [
            { id: 'gpt-5.4-nano', label: 'GPT-5.4 Nano - le moins cher',    cost: 'Entrée $0.20/1M · Sortie $1.25/1M' },
            { id: 'gpt-5.4-mini', label: 'GPT-5.4 Mini - plus intelligent', cost: 'Entrée $0.75/1M · Sortie $4.50/1M' },
            { id: 'gpt-5.4',      label: 'GPT-5.4 - polyvalent, dernière génération', cost: 'Entrée $2.50/1M · Sortie $15/1M' },
            { id: 'gpt-5.5',      label: 'GPT-5.5 - le plus puissant (cher)', cost: 'Entrée $5/1M · Sortie $30/1M' }
        ],
        gemini: [
            { id: 'gemini-3.5-flash-lite', label: 'Gemini 3.5 Flash Lite - économique', cost: 'Entrée $0.30/1M · Sortie $2.50/1M' },
            { id: 'gemini-3.5-flash',      label: 'Gemini 3.5 Flash - performant',      cost: 'Entrée $1.50/1M · Sortie $9/1M' }
        ]
    };


    // Getters de modèles texte avec garde-fou : si la valeur stockée pointe
    // vers un modèle qui n'existe plus au catalogue (ex. Gemma qui a été
    // retiré parce qu'il ne suivait pas les consignes), on retombe sur le
    // défaut au lieu d'envoyer un id invalide à l'API.
    // Modèles remplacés par leur successeur : un réglage mémorisé (ou restauré
    // depuis une vieille sauvegarde) garde son fournisseur au lieu de retomber
    // sur le défaut, qui peut être chez l'autre fournisseur. Google retire
    // gemini-3.1-flash-lite à partir du 07/05/2027.
    const RENAMED_TEXT_MODELS = { 'gemini-3.1-flash-lite': 'gemini-3.5-flash-lite' };
    function resolveStoredTextModel(key, fallback) {
        let stored = localStorage.getItem(key);
        if (stored && RENAMED_TEXT_MODELS[stored]) {
            stored = RENAMED_TEXT_MODELS[stored];
            localStorage.setItem(key, stored);
        }
        if (stored && findTextModelStrict(stored)) return stored;
        return fallback;
    }
    // Version « strict » de findTextModel disponible avant sa déclaration
    // (elle sert dans les getters). On évite la référence circulaire
    // en faisant une lookup directe sans passer par TEXT_MODEL_GROUPS.
    function findTextModelStrict(id) {
        return (TEXT_MODELS.openai || []).find(m => m.id === id)
            || (TEXT_MODELS.gemini || []).find(m => m.id === id)
            || null;
    }
    // Bascule un modèle texte vers un provider dont la clé EST configurée si
    // celle du modèle demandé manque. Évite que l'analyse (insights) ou la
    // génération de titre échoue chez un utilisateur qui n'a qu'UNE seule clé
    // (le défaut analyse=Gemini / titre=OpenAI, sinon, casserait l'une des deux).
    function ensureUsableTextModel(id) {
        const wantsGemini = isGeminiTextModel(id);
        if (wantsGemini ? getGeminiApiKey() : getApiKey()) return id;
        if (getApiKey())       return 'gpt-5.4-nano';
        if (getGeminiApiKey()) return 'gemini-3.5-flash-lite';
        return id; // aucune clé configurée : renvoyé tel quel (l'appel ne partira pas)
    }
    function getAnalysisModel() { return ensureUsableTextModel(resolveStoredTextModel('vart_analysisModel', 'gemini-3.5-flash-lite')); }
    function setAnalysisModel(m) { localStorage.setItem('vart_analysisModel', m); }
    function getTitleModel()    { return ensureUsableTextModel(resolveStoredTextModel('vart_titleModel',    'gpt-5.4-nano')); }
    function setTitleModel(m)    { localStorage.setItem('vart_titleModel', m); }

    // Détecte si un identifiant de modèle correspond à un modèle texte Gemini/Gemma
    // (par opposition aux modèles OpenAI). Sert au routing dans chatCompletion.
    function isGeminiTextModel(m) {
        return !!m && (m.startsWith('gemini') || m.startsWith('gemma'));
    }

