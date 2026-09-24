    // ── Bouton mute en bas (délégué au muteBtn existant pour préserver la logique) ──
    function syncBottomMuteBtn() {
        const btn = document.getElementById('bottomMuteBtn');
        if (!btn) return;
        btn.classList.toggle('visible', isConnected);
        btn.classList.toggle('muted', isMuted);
        btn.querySelector('.label').textContent = isMuted ? 'Réactiver le micro' : 'Couper le micro';
        btn.title = isMuted ? 'Réactiver le micro (M)' : 'Couper le micro (M)';
        // Le bouton Vision suit exactement les mêmes points d'appel : on le
        // resynchronise ici plutôt que de doubler chaque syncBottomMuteBtn().
        syncVisionBtn();
    }

    document.getElementById('bottomMuteBtn').addEventListener('click', () => {
        document.getElementById('muteBtn').click();
        syncBottomMuteBtn();
    });

    // ══ Vision : caméra, partage d'écran ou fichier ═══════════════════════
    // En mode 'video' (Gemini) le flux part tout seul à 1 image/seconde ; en
    // mode 'image' (OpenAI Realtime) chaque envoi est explicite. La vignette
    // en bas à droite montre EXACTEMENT ce qui est transmis, avec un point qui
    // pulse tant que le partage tourne.
    const VISION_FPS_MS = 1000;        // 1 img/s : plafond documenté du Live API
    // Ce qu'on ENVOIE au modèle est plafonné à 768 px : au-delà on paie des
    // tokens image pour un gain nul. Ce qu'on GARDE dans l'historique est bien
    // plus défini, pour rester net une fois agrandi au clic — la place ne
    // manque pas en base (IndexedDB), contrairement à localStorage.
    const VISION_MAX_EDGE = 768;
    const VISION_JPEG_QUALITY = 0.7;
    const VISION_ARCHIVE_EDGE = 1920;
    const VISION_ARCHIVE_QUALITY = 0.82;
    let visionSource = null;           // 'camera' | 'screen' | null
    let visionStream = null;
    let visionVideoEl = null;
    let visionTimer = null;
    let visionMenuEl = null;
    let visionMenuDocClick = null;

    const VISION_ICONS = {
        camera: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>',
        screen: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>',
        file: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/></svg>',
        stop: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><line x1="8" y1="12" x2="16" y2="12"/></svg>',
        shutter: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4"/></svg>',
        check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>'
    };

    // Mode vision utilisable ICI ET MAINTENANT : il faut une session en cours,
    // en mode persona (ni transcripteur ni traducteur), sur un modèle qui voit.
    function visionActiveMode() {
        if (!isConnected || isTranscripteurMode || isTraducteurMode) return null;
        return getVisionMode(activeModelId);
    }

    function syncVisionBtn() {
        const btn = document.getElementById('visionBtn');
        if (!btn) return;
        const mode = visionActiveMode();
        // Le bouton reste AFFICHÉ toute la conversation, y compris quand le
        // modèle ne voit pas : il est alors grisé et dit pourquoi au survol.
        // Le cacher laisserait croire que la fonction n'existe pas.
        btn.classList.toggle('visible', isConnected);
        btn.classList.toggle('is-unavailable', !mode);
        btn.classList.toggle('active', !!visionSource);
        btn.setAttribute('aria-disabled', mode ? 'false' : 'true');
        btn.setAttribute('aria-pressed', visionSource ? 'true' : 'false');
        btn.querySelector('.label').textContent =
            visionSource === 'camera' ? 'Caméra active' :
            visionSource === 'screen' ? 'Écran partagé' : 'Vision';
        btn.setAttribute('data-tip', visionUnavailableReason() || (visionSource
            ? 'Arrêter le partage (V)'
            : mode === 'video'
                ? 'Montrer la caméra, votre écran ou une image, en direct (V)'
                : 'Envoyer une photo, une capture d\'écran ou un fichier image (V)'));
        if (!mode) { closeVisionMenu(); if (visionStream) visionStopStream(); }
    }

    // Pourquoi la vision est indisponible, ou null si elle l'est. Sert au
    // texte de survol du bouton grisé : dire « non » sans dire pourquoi
    // laisserait chercher un réglage qui n'existe pas.
    function visionUnavailableReason() {
        if (visionActiveMode()) return null;
        if (!isConnected) return 'Démarrez une conversation pour montrer quelque chose au modèle.';
        if (isTranscripteurMode) return "La vision n'est pas disponible en mode Transcripteur.";
        if (isTraducteurMode)    return "La vision n'est pas disponible en mode Traducteur.";
        const m = activeModelId || getRealtimeModel();
        return `La vision n'est pas disponible avec ${m}. Les modèles Gemini Live acceptent la vidéo en direct et les images, et les modèles gpt-realtime-2 acceptent les images.`;
    }

    // Image courante du flux, en JPEG redimensionné (data URL complète).
    function visionCaptureFrame(maxEdge = VISION_MAX_EDGE, quality = VISION_JPEG_QUALITY) {
        const v = visionVideoEl;
        if (!v || !v.videoWidth || !v.videoHeight) return null;
        const scale = Math.min(1, maxEdge / Math.max(v.videoWidth, v.videoHeight));
        const c = document.createElement('canvas');
        c.width  = Math.max(1, Math.round(v.videoWidth  * scale));
        c.height = Math.max(1, Math.round(v.videoHeight * scale));
        c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
        return c.toDataURL('image/jpeg', quality);
    }

    // Prépare un envoi PONCTUEL : une seule lecture de la source, en grande
    // définition pour l'historique, puis sa réduction pour le modèle. Deux
    // captures séparées ne montreraient pas exactement la même image.
    async function visionCapturePair(sourceHd) {
        if (!sourceHd) return null;
        const sent = await visionShrink(sourceHd, VISION_MAX_EDGE, VISION_JPEG_QUALITY);
        return { sent, archive: sourceHd };
    }

    // Fichier → JPEG redimensionné. Les deux API acceptent le JPEG, et réduire
    // à VISION_MAX_EDGE évite d'expédier 8 Mo sur le WebSocket de la session.
    function visionFileToJpeg(file, maxEdge = VISION_MAX_EDGE, quality = 0.85) {
        return new Promise(resolve => {
            const reader = new FileReader();
            reader.onload = () => {
                const img = new Image();
                img.onload = () => {
                    const scale = Math.min(1, maxEdge / Math.max(img.width, img.height));
                    const c = document.createElement('canvas');
                    c.width  = Math.max(1, Math.round(img.width  * scale));
                    c.height = Math.max(1, Math.round(img.height * scale));
                    const ctx = c.getContext('2d');
                    // Fond blanc : sans ça un PNG transparent vire au noir en JPEG.
                    ctx.fillStyle = '#ffffff';
                    ctx.fillRect(0, 0, c.width, c.height);
                    ctx.drawImage(img, 0, 0, c.width, c.height);
                    resolve(c.toDataURL('image/jpeg', quality));
                };
                img.onerror = () => resolve(null);
                img.src = reader.result;
            };
            reader.onerror = () => resolve(null);
            reader.readAsDataURL(file);
        });
    }

    // Envoi d'une image au modèle de la session.
    //   opts.stream  : image du flux continu (Gemini) → aucune réponse demandée
    //   opts.label   : libellé de la vignette ajoutée au transcript
    //   opts.archive : version grande définition à conserver dans l'historique
    //                  (par défaut, celle qui est envoyée)
    function visionSendImage(dataUrl, opts) {
        opts = opts || {};
        const mode = visionActiveMode();
        if (!mode || !dataUrl || !ws || ws.readyState !== WebSocket.OPEN) return false;
        // Le flux continu n'existe que chez Gemini : chez OpenAI, chaque image
        // déclencherait une réponse.
        if (opts.stream && mode !== 'video') return false;
        const b64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
        if (mode === 'video') {
            if (opts.stream) {
                // Flux : même canal que l'audio, le modèle intègre les images
                // au fil de la conversation sans qu'on lui demande de parler.
                ws.send(JSON.stringify({ realtimeInput: { video: { data: b64, mimeType: 'image/jpeg' } } }));
            } else {
                // Envoi unique : un tour utilisateur complet, pour que le
                // modèle réagisse tout de suite à l'image.
                ws.send(JSON.stringify({ clientContent: {
                    turns: [{ role: 'user', parts: [{ inlineData: { mimeType: 'image/jpeg', data: b64 } }] }],
                    turnComplete: true
                } }));
            }
        } else {
            // Realtime : l'image devient un message utilisateur, puis on
            // demande explicitement la réponse (le VAD ne la déclenche pas).
            // L'identifiant d'origine permet de reconnaître une erreur liée à
            // l'image (cf. handleServerEvent, case 'error') sans couper la
            // session ; la réponse passe par la file d'attente.
            ws.send(JSON.stringify({
                type: 'conversation.item.create',
                event_id: 'vart_img_' + Date.now().toString(36),
                item: { type: 'message', role: 'user', content: [{ type: 'input_image', image_url: dataUrl, detail: 'auto' }] }
            }));
            requestRealtimeResponse(null);
        }
        if (opts.label) addVisionThumb(opts.archive || dataUrl, opts.label);
        return true;
    }

    // Repli quand IndexedDB est indisponible : l'image atterrit alors dans
    // localStorage, où chaque kilo-octet compte, donc on la réduit. Avec la
    // base, on garde l'image TELLE QU'ENVOYÉE au modèle (768 px) : la place ne
    // manque pas et le clic sur la vignette l'affiche en grand.
    const VISION_THUMB_EDGE = 480;
    const VISION_THUMB_QUALITY = 0.65;

