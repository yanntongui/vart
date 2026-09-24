    let ws = null;
    // GPT Live (OpenAI) passe par WebRTC, pas par WebSocket : `ws` reste null
    // dans ce mode, et la session vit dans ces variables (cf. connectOpenAILive).
    let livePc = null;           // RTCPeerConnection
    let liveDc = null;           // RTCDataChannel « oai-events » (événements JSON)
    let liveAudioEl = null;      // <audio> caché qui « consomme » le flux distant
    let liveRemoteSource = null; // flux distant → analyser de l'orbe
    let liveAiIdleTimer = null;   // fin de « tour » IA estimée (pas d'événement de fin)
    let liveUserIdleTimer = null; // idem côté utilisateur (regroupement des bulles)
    // Époque de connexion : incrémentée à chaque arrêt. connectWhisper la
    // capture avant son `await` et vérifie après : si un arrêt a eu lieu
    // entre-temps, on n'ouvre pas de WebSocket orpheline.
    let connectionEpoch = 0;
    let audioContext = null;
    let mediaStream = null;
    let scriptProcessor = null;
    let sourceNode = null;

    let playbackContext = null;
    let playbackAnalyser = null;
    let nextPlayTime = 0;
    let playbackSources = [];

    let userAudioLevel = 0;
    let gerardAudioLevel = 0;
    let animationId = null;
    let isConnected = false;
    let isMuted = false;
    let micReady = false;
    let waitingGreeting = false;
    // Une réponse OpenAI Realtime est-elle en cours ? L'API refuse un second
    // response.create tant que la première n'est pas terminée (erreur
    // conversation_already_has_active_response), ce qui coupait la session :
    // la demande est alors mise en attente et rejouée au response.done.
    let realtimeResponseActive = false;
    let pendingResponseCreate = null;
    function resetRealtimeResponseState() {
        realtimeResponseActive = false;
        pendingResponseCreate = null;
    }
    // `response` : options de la réponse (ex. { instructions }) ou null.
    function requestRealtimeResponse(response) {
        if (!ws || ws.readyState !== WebSocket.OPEN) return;
        if (realtimeResponseActive) {
            // Une seule demande en attente ; une demande avec consignes (la
            // salutation) n'est jamais écrasée par une demande nue.
            if (response || !pendingResponseCreate) pendingResponseCreate = response || {};
            return;
        }
        realtimeResponseActive = true; // avant même le response.created
        const ev = { type: 'response.create', event_id: 'vart_resp_' + Date.now().toString(36) };
        if (response) ev.response = response;
        ws.send(JSON.stringify(ev));
    }
    function flushPendingResponse() {
        realtimeResponseActive = false;
        if (!pendingResponseCreate) return;
        const next = pendingResponseCreate;
        pendingResponseCreate = null;
        requestRealtimeResponse(Object.keys(next).length ? next : null);
    }

    // Deux paires de compteurs. `total*Tokens` sert au COÛT : les tokens y
    // sont convertis en équivalent du tarif de référence du modèle (cache,
    // texte, image… cf. tokensAtRate). `total*TokensRaw` compte les VRAIS
    // tokens, ceux qu'affichent l'historique, les statistiques et les
    // tableaux de bord des fournisseurs.
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let totalInputTokensRaw = 0;
    let totalOutputTokensRaw = 0;
    // Frais d'une session qui ne sont PAS des tokens du modèle vocal, en
    // dollars déjà calculés : recherches web (OpenAI Realtime, backend GPT
    // Live, Grok) et transcription de la voix (OpenAI Realtime). Ajoutés
    // partout où le coût d'une session est calculé — compteur en direct,
    // historique, statistiques, budget. La recherche Google de Gemini n'est
    // volontairement pas comptée (5 000 requêtes gratuites par mois).
    let sessionToolCost = 0;
    let sessionTranscriptionCost = 0;
    let sessionSearchIds = new Set();       // recherches Grok déjà comptées
    let sessionSearchResponses = new Set(); // réponses Grok où elles l'ont été
    function resetSessionCosts() {
        totalInputTokensRaw = 0;
        totalOutputTokensRaw = 0;
        sessionToolCost = 0;
        sessionTranscriptionCost = 0;
        sessionSearchIds = new Set();
        sessionSearchResponses = new Set();
        // Même moment de vie que la session : l'état des réponses Realtime.
        resetRealtimeResponseState();
    }

    let currentTranscriptAi = null; // élément en cours de streaming
    let currentTranscriptUser = null; // bulle utilisateur en cours (deltas Gemini)
    // Bulle de réponse IA du TOUR courant (OpenAI) : conservée même après la fin
    // de la réponse, pour pouvoir insérer AVANT elle une transcription utilisateur
    // qui arriverait en retard. Réinitialisée au début de chaque tour utilisateur.
    let turnAiBubble = null;
    let activeProvider = 'openai'; // 'openai' ou 'gemini' pour la session en cours
    let activeModelId = '';        // modèle effectif de la session en cours
    let editingPersonaId = null;
    // Vrai si l'éditeur de persona a été ouvert depuis l'accueil (pas depuis une
    // conversation) : dans ce cas, après sauvegarde on RESTE sur l'accueil au
    // lieu d'ouvrir la conversation avec ce persona.
    let personaModalFromHome = false;
    let conversationStartTime = null;
    let timerInterval = null;

    let isTranscripteurMode = false;
    let isTraducteurMode = false;
    let isPaused = false;
    let pausedTime = 0;
    let pauseStartedAt = null;


