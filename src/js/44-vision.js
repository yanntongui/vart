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

    // ── Stockage des vignettes : IndexedDB ────────────────────────────────
    // Les images vont dans la base du navigateur, en Blob, pas dans
    // localStorage. Deux raisons : localStorage plafonne à ~5 Mo sur Safari
    // (donc sur iPhone), partagés avec les avatars et les stats ; et le base64
    // gonfle chaque image de 33 %. Le reste de l'historique (texte, dates,
    // coûts) ne bouge pas : getConversations() doit rester SYNCHRONE, il est
    // appelé partout (listes, stats, budget, export).
    // Un message porte donc `imageId` (nouveau) ou `image` (ancien format,
    // encore lu tel quel : anciennes discussions et vieilles sauvegardes).
    // La base s'appelait « kast » : on CONSERVE ce nom pour ne pas orpheliner
    // les vignettes des utilisateurs de l'ancienne version (renommer une base
    // IndexedDB = en créer une neuve vide, les anciennes images seraient
    // inaccessibles). Nom interne invisible pour l'utilisateur.
    const VISION_DB_NAME = 'kast';
    const VISION_DB_STORE = 'visionImages';
    let visionDbPromise = null;

    // Renvoie la base, ou null si elle est indisponible (navigation privée,
    // stockage bloqué). Tous les appelants retombent alors sur l'ancien
    // format en ligne : on perd le bénéfice, jamais l'image.
    function visionDb() {
        if (visionDbPromise) return visionDbPromise;
        visionDbPromise = new Promise(resolve => {
            let req;
            try { req = indexedDB.open(VISION_DB_NAME, 1); }
            catch (e) { resolve(null); return; }
            req.onupgradeneeded = () => {
                const db = req.result;
                if (!db.objectStoreNames.contains(VISION_DB_STORE)) db.createObjectStore(VISION_DB_STORE);
            };
            req.onsuccess = () => {
                const db = req.result;
                // Connexion fermée (par le navigateur ou pour une mise à jour
                // du schéma depuis un autre onglet) : la prochaine opération en
                // rouvrira une, au lieu de réutiliser une connexion morte.
                db.onclose = () => { visionDbPromise = null; };
                db.onversionchange = () => { try { db.close(); } catch (e) {} visionDbPromise = null; };
                resolve(db);
            };
            req.onerror   = () => { visionDbPromise = null; resolve(null); };
            req.onblocked = () => { visionDbPromise = null; resolve(null); };
        });
        return visionDbPromise;
    }

    // Seules des images JPEG, PNG ou WebP en base64 sont acceptées. Une
    // sauvegarde importée peut contenir n'importe quoi : une « image » de type
    // text/html ou SVG deviendrait, une fois en blob, une page du même
    // domaine que Vart (ouverte via « Ouvrir l'image dans un nouvel onglet »),
    // capable de lire les clés API.
    const SAFE_IMAGE_DATA_URL = /^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/;
    function isSafeImageDataUrl(u) { return typeof u === 'string' && SAFE_IMAGE_DATA_URL.test(u); }

    function visionDbRun(mode, fn) {
        return visionDb().then(db => {
            if (!db) return null;
            return new Promise(resolve => {
                let tx;
                try { tx = db.transaction(VISION_DB_STORE, mode); }
                catch (e) { resolve(null); return; }
                const store = tx.objectStore(VISION_DB_STORE);
                let out = null;
                try { const req = fn(store); if (req) req.onsuccess = () => { out = req.result; }; }
                catch (e) { resolve(null); return; }
                tx.oncomplete = () => resolve(out);
                tx.onerror = tx.onabort = () => resolve(null);
            });
        });
    }

    function dataUrlToBlob(dataUrl) {
        const comma = dataUrl.indexOf(',');
        const mime = (dataUrl.slice(0, comma).match(/:(.*?);/) || [, 'image/jpeg'])[1];
        const bin = atob(dataUrl.slice(comma + 1));
        const arr = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
        return new Blob([arr], { type: mime });
    }
    function blobToDataUrl(blob) {
        return new Promise(resolve => {
            const r = new FileReader();
            r.onload  = () => resolve(r.result);
            r.onerror = () => resolve(null);
            r.readAsDataURL(blob);
        });
    }

    // Range une data URL et renvoie son identifiant, ou null si la base n'a
    // pas voulu (l'appelant garde alors l'image en ligne).
    async function visionImageStore(dataUrl) {
        if (!isSafeImageDataUrl(dataUrl)) return null;
        const id = 'vi_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 9);
        let blob;
        try { blob = dataUrlToBlob(dataUrl); } catch (e) { return null; }
        const db = await visionDb();
        if (!db) return null;
        const ok = await new Promise(resolve => {
            let tx;
            try { tx = db.transaction(VISION_DB_STORE, 'readwrite'); }
            catch (e) { resolve(false); return; }
            tx.objectStore(VISION_DB_STORE).put(blob, id);
            tx.oncomplete = () => resolve(true);
            tx.onerror = tx.onabort = () => resolve(false);
        });
        return ok ? id : null;
    }

    async function visionImageBlob(id)  { return id ? visionDbRun('readonly',  st => st.get(id)) : null; }
    async function visionImageKeys()    { return (await visionDbRun('readonly', st => st.getAllKeys())) || []; }
    async function visionImageDrop(ids) {
        if (!ids || !ids.length) return;
        await visionDbRun('readwrite', st => { ids.forEach(id => st.delete(id)); return null; });
    }

    // Identifiants référencés par l'historique : sert au ménage des orphelins
    // (image envoyée pendant une conversation qui n'a jamais été enregistrée).
    function visionReferencedIds(list) {
        const ids = new Set();
        (list || getConversations()).forEach(c => {
            (c.messages || []).forEach(m => { if (m.imageId) ids.add(m.imageId); });
        });
        return ids;
    }

    // Au démarrage : déplace les images encore en ligne vers la base, puis
    // supprime les blobs que plus aucune discussion ne référence. Silencieux,
    // en arrière-plan : rien n'en dépend à l'écran.
    // Délai de grâce avant de supprimer un blob que rien ne référence : une
    // image envoyée dans une conversation pas encore enregistrée (dans cet
    // onglet ou un autre) est orpheline le temps que la session se termine.
    const VISION_ORPHAN_GRACE_MS = 24 * 3600 * 1000;
    function visionIdTime(id) {
        const m = /^vi_([0-9a-z]+)_/.exec(String(id));
        return m ? parseInt(m[1], 36) : 0;
    }

    async function visionStorageHousekeeping() {
        if (!(await visionDb())) return;
        // 1. Migration. Les écritures en base prennent du temps, pendant
        //    lequel l'historique peut changer (conversation qui se termine,
        //    suppression, titre qui arrive) : on prépare les échanges sur une
        //    copie, puis on les applique sur la liste RELUE, sans rien écraser.
        const swaps = [];
        getConversations().forEach(c => (c.messages || []).forEach((m, index) => {
            if (m.image) swaps.push({ convId: c.id, index, image: m.image });
        }));
        for (const sw of swaps) {
            if (isSafeImageDataUrl(sw.image)) sw.imageId = await visionImageStore(sw.image);
            else sw.drop = true; // type refusé : on retire l'image
        }
        if (swaps.length) {
            const list = getConversations();
            let changed = false;
            swaps.forEach(sw => {
                const conv = list.find(c => c.id === sw.convId);
                const m = conv && conv.messages && conv.messages[sw.index];
                if (!m || m.image !== sw.image) return; // la conversation a changé entre-temps
                if (sw.drop) { delete m.image; changed = true; }
                else if (sw.imageId) { m.imageId = sw.imageId; delete m.image; changed = true; }
            });
            if (changed) {
                try { saveConversations(list); }
                catch (e) { console.error('Migration des vignettes échouée :', e); }
            }
        }
        // 2. Orphelins, sur une liste relue, en épargnant les blobs récents.
        const refs = visionReferencedIds(getConversations());
        const now = Date.now();
        const orphans = (await visionImageKeys())
            .filter(k => !refs.has(k) && now - visionIdTime(k) > VISION_ORPHAN_GRACE_MS);
        if (orphans.length) visionImageDrop(orphans);
    }

    // Import d'une sauvegarde : les images arrivent en base64. On les range en
    // base AVANT d'écrire quoi que ce soit dans localStorage, sinon quelques
    // captures HD suffisent à dépasser son quota (~5 Mo sur Safari). Sans
    // base, repli : image réduite, gardée en ligne.
    async function visionOffloadImportedImages(list) {
        const hasDb = !!(await visionDb());
        for (const c of list) {
            for (const m of (Array.isArray(c.messages) ? c.messages : [])) {
                if (!m || m.image == null) continue;
                if (!isSafeImageDataUrl(m.image)) { delete m.image; continue; }
                const id = hasDb ? await visionImageStore(m.image) : null;
                if (id) { m.imageId = id; delete m.image; continue; }
                m.image = await visionShrink(m.image, VISION_THUMB_EDGE, VISION_THUMB_QUALITY);
            }
        }
        return list;
    }

    // Réduit une data URL JPEG à `maxEdge` de côté long. Renvoie l'original si
    // la conversion échoue : mieux vaut une grosse vignette que pas de trace.
    function visionShrink(dataUrl, maxEdge, quality) {
        return new Promise(resolve => {
            const img = new Image();
            img.onload = () => {
                const scale = Math.min(1, maxEdge / Math.max(img.width, img.height));
                if (scale >= 1) { resolve(dataUrl); return; }
                const c = document.createElement('canvas');
                c.width  = Math.max(1, Math.round(img.width  * scale));
                c.height = Math.max(1, Math.round(img.height * scale));
                c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
                try { resolve(c.toDataURL('image/jpeg', quality)); }
                catch (e) { resolve(dataUrl); }
            };
            img.onerror = () => resolve(dataUrl);
            img.src = dataUrl;
        });
    }

    // Trace de l'image envoyée dans le transcript, côté utilisateur. La
    // vignette affichée EST celle qui part à l'historique (cf. stopConversation,
    // qui la relit dans le src) : une seule image, une seule taille.
    // Seuls les envois PONCTUELS passent ici — les images du flux continu
    // Gemini n'ont pas de libellé et n'appellent jamais cette fonction.
    function addVisionThumb(dataUrl, label) {
        const el = document.getElementById('transcript');
        if (!el) return;
        const ph = el.querySelector('.transcript-empty');
        if (ph) ph.remove();
        const msg = document.createElement('div');
        msg.className = 'transcript-msg user';
        msg.innerHTML = `<div class="sender">Moi</div><div class="text">${esc('[image] ' + (label || 'Image partagée'))}</div>`;
        const img = document.createElement('img');
        img.className = 'vision-thumb';
        img.src = dataUrl;
        img.alt = label || 'Image partagée';
        makeThumbZoomable(img);
        msg.appendChild(Object.assign(document.createElement('span'), { className: 'vision-break' }));
        msg.appendChild(img);
        el.appendChild(msg);
        // L'image part telle quelle dans IndexedDB ; l'identifiant se pose sur
        // l'<img>, où la récolte des messages en fin de session (synchrone) n'a
        // plus qu'à le relire. Si la base refuse, repli : version réduite,
        // gardée en ligne dans localStorage comme avant.
        // La promesse reste accrochée à l'image : si la session s'arrête avant
        // la fin de l'écriture, stopConversation l'attend pour compléter le
        // message enregistré (cf. patchPendingImages), au lieu de glisser la
        // capture HD en base64 dans localStorage.
        img.__stored = visionImageStore(dataUrl).then(id => {
            if (id) { img.dataset.imageId = id; return { imageId: id }; }
            return visionShrink(dataUrl, VISION_THUMB_EDGE, VISION_THUMB_QUALITY)
                .then(small => { img.src = small; return { image: small }; });
        });
        // La prochaine parole ouvrira sa propre bulle, pas celle de l'image.
        currentTranscriptUser = null;
        scrollTranscript();
    }

    // ── Agrandissement d'une image envoyée ───────────────────────────────
    // Marche pour la conversation en cours comme pour une relecture : c'est le
    // même <img>, et l'image gardée est celle envoyée au modèle (768 px), pas
    // la vignette de 220 px qu'affiche le transcript.
    function makeThumbZoomable(img) {
        img.tabIndex = 0;
        img.setAttribute('role', 'button');
        img.title = 'Agrandir';
        img.addEventListener('click', () => openImageLightbox(img));
        img.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openImageLightbox(img); }
        });
    }

    function closeImageLightbox() {
        const old = document.getElementById('imageLightbox');
        if (old) {
            // Le focus est rendu AVANT de retirer l'overlay : retirer l'élément
            // focalisé renvoie le focus au <body> après coup, ce qui écraserait
            // un focus() posé ensuite.
            const opener = old.__opener;
            if (opener && document.contains(opener)) opener.focus();
            old.remove();
        }
    }

    function openImageLightbox(thumb) {
        if (!thumb || !thumb.src) return;
        closeImageLightbox();
        const overlay = document.createElement('div');
        overlay.className = 'image-lightbox';
        overlay.id = 'imageLightbox';
        overlay.setAttribute('role', 'dialog');
        overlay.setAttribute('aria-modal', 'true');
        overlay.__opener = thumb;

        const big = document.createElement('img');
        big.src = thumb.src;
        big.alt = thumb.alt || 'Image partagée';
        overlay.appendChild(big);

        // Le texte du message porte le préfixe « [image] », utile dans la
        // transcription exportée mais inutile ici.
        const caption = (thumb.alt || '').replace(/^\[image\]\s*/, '');
        if (caption) {
            const cap = document.createElement('div');
            cap.className = 'image-lightbox-caption';
            cap.textContent = caption;
            overlay.appendChild(cap);
        }

        const close = document.createElement('button');
        close.type = 'button';
        close.className = 'image-lightbox-close';
        close.setAttribute('aria-label', 'Fermer');
        close.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/></svg>';
        close.addEventListener('click', closeImageLightbox);
        overlay.appendChild(close);

        // Clic n'importe où en dehors de l'image : on referme.
        overlay.addEventListener('click', (e) => { if (e.target === overlay) closeImageLightbox(); });
        document.body.appendChild(overlay);
        close.focus();
    }

    function closeVisionPreview() {
        const old = document.getElementById('visionPreview');
        if (old) old.remove();
    }

    // L'élément <video> est partagé par les deux présentations : c'est LUI que
    // visionCaptureFrame() lit, donc il doit être à l'écran et en lecture.
    function buildVisionVideoEl() {
        const v = document.createElement('video');
        v.muted = true;
        v.playsInline = true;
        v.autoplay = true;
        v.srcObject = visionStream;
        v.play().catch(() => {});
        visionVideoEl = v;
        return v;
    }

    // Gemini : le flux part tout seul → vignette discrète en bas à droite, la
    // conversation reste entièrement visible derrière.
    function buildVisionDock() {
        const box = document.createElement('div');
        box.className = 'vision-preview';
        box.id = 'visionPreview';
        box.appendChild(buildVisionVideoEl());

        const bar = document.createElement('div');
        bar.className = 'vision-preview-bar';
        const dot = document.createElement('span');
        dot.className = 'vision-dot';
        dot.setAttribute('aria-hidden', 'true');
        const label = document.createElement('span');
        label.className = 'label';
        label.textContent = visionSource === 'screen' ? 'Le modèle voit votre écran' : 'Le modèle vous voit';
        const stop = document.createElement('button');
        stop.type = 'button';
        stop.className = 'vision-preview-btn';
        stop.textContent = 'Stop';
        stop.title = 'Arrêter le partage';
        stop.addEventListener('click', () => visionStop());
        bar.append(dot, label, stop);
        box.appendChild(bar);
        document.body.appendChild(box);
    }

    // OpenAI : pas de direct possible, on envoie une image à la fois → grand
    // viseur centré et bouton « Capturer » qu'on ne peut pas manquer. Tant
    // qu'on n'a pas capturé, le modèle ne voit rien.
    function buildVisionCapture() {
        const overlay = document.createElement('div');
        overlay.className = 'vision-capture';
        overlay.id = 'visionPreview';

        const card = document.createElement('div');
        card.className = 'vision-capture-card';

        const title = document.createElement('div');
        title.className = 'vision-capture-title';
        title.textContent = visionSource === 'screen' ? "Envoyer une capture d'écran" : 'Envoyer une photo';
        const hint = document.createElement('div');
        hint.className = 'vision-capture-hint';
        hint.textContent = visionSource === 'screen'
            ? "Le modèle ne voit rien tant que vous n'avez pas capturé."
            : "Cadrez ce que vous voulez montrer. Le modèle ne voit rien avant la capture.";

        const stage = document.createElement('div');
        stage.className = 'vision-capture-stage';
        stage.appendChild(buildVisionVideoEl());

        const actions = document.createElement('div');
        actions.className = 'vision-capture-actions';

        const shoot = document.createElement('button');
        shoot.type = 'button';
        shoot.className = 'vision-capture-btn';
        shoot.innerHTML = `<span class="vision-capture-btn-icon">${VISION_ICONS.shutter}</span>`
                        + `<span class="vision-capture-btn-check">${VISION_ICONS.check}</span>`
                        + `<span class="vision-capture-btn-label">Capturer</span>`;
        let shootTimer = null;
        shoot.addEventListener('click', async () => {
            if (shoot.dataset.busy) return; // double clic : une seule image
            shoot.dataset.busy = '1';
            setTimeout(() => { delete shoot.dataset.busy; }, 700);
            const pair = await visionCapturePair(visionCaptureFrame(VISION_ARCHIVE_EDGE, VISION_ARCHIVE_QUALITY));
            if (!pair || !visionSendImage(pair.sent, { label: visionSource === 'screen' ? "Capture d'écran" : 'Photo', archive: pair.archive })) return;
            // Retour visuel : le bouton confirme puis reprend son libellé. On
            // reste dans le viseur, libre d'enchaîner une deuxième capture.
            shoot.classList.add('is-sent');
            shoot.querySelector('.vision-capture-btn-label').textContent = 'Image envoyée';
            clearTimeout(shootTimer);
            shootTimer = setTimeout(() => {
                shoot.classList.remove('is-sent');
                shoot.querySelector('.vision-capture-btn-label').textContent = 'Capturer';
            }, 1600);
        });

        const done = document.createElement('button');
        done.type = 'button';
        done.className = 'vision-capture-done';
        done.textContent = 'Terminer';
        done.addEventListener('click', () => visionStop());

        actions.append(shoot, done);
        card.append(title, hint, stage, actions);
        overlay.appendChild(card);
        // Clic à côté de la carte : on referme, comme les autres modales.
        overlay.addEventListener('click', (e) => { if (e.target === overlay) visionStop(); });
        document.body.appendChild(overlay);
        shoot.focus();
    }

    function buildVisionPreview() {
        closeVisionPreview();
        if (visionActiveMode() === 'image') buildVisionCapture();
        else buildVisionDock();
    }

    // Chaque demande de source porte un numéro : si une autre est lancée
    // pendant que le navigateur demande l'autorisation, la plus ancienne est
    // abandonnée à son retour au lieu d'écraser la nouvelle (caméra restée
    // allumée, minuteries en double).
    let visionStartSeq = 0;

    async function visionStart(source) {
        if (!visionActiveMode()) return;
        visionStopStream(); // repartir propre (invalide aussi toute demande en attente)
        const seq = ++visionStartSeq;
        let stream;
        try {
            stream = source === 'screen'
                ? await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 5 }, audio: false })
                : await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 1280 } }, audio: false });
        } catch (err) {
            // NotAllowedError / AbortError = refus ou annulation du sélecteur :
            // l'utilisateur sait ce qu'il vient de faire, inutile d'alerter.
            const name = err && err.name;
            if (name !== 'NotAllowedError' && name !== 'AbortError') {
                setStatus(source === 'screen' ? "Partage d'écran indisponible" : 'Caméra indisponible', 'error');
            }
            syncVisionBtn();
            return;
        }
        // Pendant l'autorisation, la session a pu s'arrêter, changer de modèle,
        // ou une autre source a pu être demandée : on relit tout.
        const mode = visionActiveMode();
        if (seq !== visionStartSeq || !mode) {
            stream.getTracks().forEach(t => { try { t.stop(); } catch (e) {} });
            return;
        }
        visionStopStream();
        visionStream = stream;
        visionSource = source;
        // Coupure depuis la barre native du navigateur → on remet l'UI d'aplomb.
        stream.getVideoTracks().forEach(t => t.addEventListener('ended', () => visionStop()));
        buildVisionPreview();
        if (mode === 'video') {
            visionTimer = setInterval(() => {
                if (visionActiveMode() !== 'video') { visionStop(); return; }
                if (isPaused || !visionStream) return;
                visionSendImage(visionCaptureFrame(), { stream: true });
            }, VISION_FPS_MS);
            setStatus(source === 'screen' ? 'Le modèle voit votre écran' : 'Le modèle vous voit', 'connected');
        }
        syncVisionBtn();
    }

    function visionStopStream() {
        visionStartSeq++; // une autorisation encore en attente sera abandonnée
        if (visionTimer) { clearInterval(visionTimer); visionTimer = null; }
        if (visionStream) { visionStream.getTracks().forEach(t => { try { t.stop(); } catch (e) {} }); visionStream = null; }
        if (visionVideoEl) { visionVideoEl.srcObject = null; visionVideoEl = null; }
        closeVisionPreview();
        visionSource = null;
    }
    function visionStop() { visionStopStream(); syncVisionBtn(); }

    function closeVisionMenu() {
        if (visionMenuEl) { visionMenuEl.remove(); visionMenuEl = null; }
        if (visionMenuDocClick) { document.removeEventListener('click', visionMenuDocClick); visionMenuDocClick = null; }
        const btn = document.getElementById('visionBtn');
        if (btn) btn.setAttribute('aria-expanded', 'false');
    }

    // Deux bulles EMPILÉES au-dessus du bouton : les sources, puis le surcoût.
