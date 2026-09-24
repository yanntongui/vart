    function initSplash() {
        const splash = document.getElementById('splashScreen');
        if (!splash) return;
        const host = document.getElementById('splashLogo');
        const src = document.querySelector('#sidebar .vart-logo-svg');
        if (host && src && !host.firstChild) host.appendChild(src.cloneNode(true));
        const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        const hold = reduce ? 1350 : 2650;
        setTimeout(() => {
            splash.classList.add('splash-done');
            setTimeout(() => splash.remove(), 650);
        }, hold);
    }


    document.addEventListener('keydown', (e) => {
        // Ignorer si on est dans un champ de saisie ou une modale ouverte
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;
        if (e.target.isContentEditable) return;
        // Toute modale (.modal-overlay.active) ou dialogue custom (.dialog-overlay)
        // bloque les raccourcis pour éviter qu'un Espace démarre une conversation
        // pendant qu'une confirmation est affichée.
        if (document.querySelector('.modal-overlay.active, .dialog-overlay')) return;
        // Viseur de capture et visionneuse d'image sont modaux : rien d'autre
        // qu'Échap ne doit passer (une barre d'espace y couperait la
        // conversation).
        // Échap a la même place sur tous les claviers : on accepte sa lettre
        // comme sa position (et l'ancien nom « Esc »).
        const isEscape = e.key === 'Escape' || e.key === 'Esc' || e.code === 'Escape';
        if (document.querySelector('.vision-capture, .image-lightbox') && !isEscape) return;
        // Les combinaisons (Cmd+V, Ctrl+M…) restent au système.
        if (e.metaKey || e.ctrlKey || e.altKey) return;

        if (e.code === 'Space') {
            // Espace sur un bouton focalisé active CE bouton (comportement
            // natif), pas le démarrage ou l'arrêt de la conversation.
            if (e.target.closest && e.target.closest('button, [role="button"], a[href]')) return;
            e.preventDefault();
            if (isConnected) {
                stopBtn.click();
            } else if (getActiveId()) {
                startBtn.click();
            }
            return;
        }

        if (isEscape) {
            // Échap progressif : l'image agrandie, puis le menu Vision, puis le
            // partage vidéo, et la conversation seulement en dernier recours.
            if (document.getElementById('imageLightbox')) {
                e.preventDefault();
                closeImageLightbox();
            } else if (visionMenuEl) {
                e.preventDefault();
                closeVisionMenu();
            } else if (visionSource) {
                e.preventDefault();
                visionStop();
            } else if (isConnected) {
                e.preventDefault();
                stopBtn.click();
            }
            return;
        }

        // Raccourcis à une lettre : on lit la LETTRE produite (e.key), pas la
        // position physique de la touche (e.code). Sur un clavier AZERTY, la
        // touche « M » envoie le code « Semicolon » : lue par sa position,
        // elle ne coupait pas le micro, et c'est la virgule qui le faisait.
        const letter = (e.key && e.key.length === 1) ? e.key.toLowerCase() : '';
        if (letter === 'm') {
            if (isConnected && muteBtn.style.display !== 'none') {
                e.preventDefault();
                muteBtn.click();
            }
        } else if (letter === 'v') {
            // V ouvre ou ferme le menu Vision ; pendant un partage, il l'arrête.
            if (visionActiveMode()) {
                e.preventDefault();
                if (visionMenuEl) closeVisionMenu();
                else if (visionSource) visionStop();
                else openVisionMenu();
            }
        } else if (letter === 'p') {
            if (isConnected && isTranscripteurMode && pauseBtn.style.display !== 'none') {
                e.preventDefault();
                pauseBtn.click();
            }
        }
    });

