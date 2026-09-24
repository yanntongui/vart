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
