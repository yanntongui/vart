    function openVisionMenu() {
        closeVisionMenu();
        const btn = document.getElementById('visionBtn');
        const mode = visionActiveMode();
        if (!btn || !mode) return;

        const menu = document.createElement('div');
        menu.className = 'vision-menu';
        menu.setAttribute('role', 'menu');

        // Bulle 1 : les sources.
        const sources = document.createElement('div');
        sources.className = 'vision-bubble';
        const title = document.createElement('div');
        title.className = 'vision-bubble-title';
        title.textContent = mode === 'video' ? 'Montrer en direct' : 'Envoyer une image';
        sources.appendChild(title);

        // Les intitulés disent ce qui va se passer. Côté OpenAI ils annoncent
        // un ENVOI ponctuel (« Envoyer une photo »), pour qu'on ne croie pas
        // à un direct : le modèle ne voit que l'image qu'on lui tend.
        const items = mode === 'video' ? [
            { key: 'camera', icon: VISION_ICONS.camera, label: 'Caméra',          sub: 'Le modèle vous voit en continu' },
            { key: 'screen', icon: VISION_ICONS.screen, label: "Partage d'écran", sub: 'Le modèle suit votre écran en continu' },
            { key: 'file',   icon: VISION_ICONS.file,   label: 'Fichier image',   sub: 'Depuis votre appareil, PNG ou JPEG' }
        ] : [
            { key: 'camera', icon: VISION_ICONS.camera, label: 'Envoyer une photo (caméra)', sub: 'Vous cadrez, puis vous capturez' },
            { key: 'screen', icon: VISION_ICONS.screen, label: 'Envoyer une capture d\'écran', sub: 'Vous choisissez la fenêtre à montrer' },
            { key: 'file',   icon: VISION_ICONS.file,   label: 'Envoyer un fichier image',    sub: 'Depuis votre appareil, PNG ou JPEG' }
        ];
        items.forEach(it => {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'vision-src' + (visionSource === it.key ? ' is-active' : '');
            b.innerHTML = `<span class="icon">${it.icon}</span>`
                        + `<span class="vision-src-text">${esc(it.label)}<span class="vision-src-sub">${esc(it.sub)}</span></span>`;
            b.addEventListener('click', (e) => {
                e.stopPropagation();
                closeVisionMenu();
                if (it.key === 'file') { document.getElementById('visionFileInput').click(); return; }
                if (visionSource === it.key) { visionStop(); return; }
                visionStart(it.key);
            });
            sources.appendChild(b);
        });
        if (visionSource) {
            const stop = document.createElement('button');
            stop.type = 'button';
            stop.className = 'vision-src is-stop';
            stop.innerHTML = `<span class="icon">${VISION_ICONS.stop}</span>`
                           + `<span class="vision-src-text">Arrêter le partage</span>`;
            stop.addEventListener('click', (e) => { e.stopPropagation(); closeVisionMenu(); visionStop(); });
            sources.appendChild(stop);
        }
        menu.appendChild(sources);

        // Bulle 2, SOUS la première : le surcoût. Affichée seulement si le
        // modèle facture réellement les images.
        const cost = visionCostInfo(activeModelId);
        if (cost) {
            const c = document.createElement('div');
            c.className = 'vision-bubble vision-cost';
            c.innerHTML = `<div class="vision-cost-label"><span class="vision-badge-icon" aria-hidden="true">${cost.icon}</span>Coût supplémentaire</div>`
                        + `<div class="vision-cost-value">${esc(cost.value)}</div>`
                        + `<div class="vision-cost-note">${esc(cost.note)}</div>`;
            menu.appendChild(c);
        }

        document.body.appendChild(menu);
        visionMenuEl = menu;

        // Positionnement : au-dessus du bouton, centré, ramené dans l'écran ;
        // bascule dessous s'il n'y a pas la place au-dessus.
        const r = btn.getBoundingClientRect();
        const w = menu.offsetWidth;
        const left = Math.max(12, Math.min(r.left + r.width / 2 - w / 2, window.innerWidth - w - 12));
        menu.style.left = `${Math.round(left)}px`;
        menu.style.bottom = `${Math.round(window.innerHeight - r.top + 10)}px`;
        if (r.top - 10 - menu.offsetHeight < 8) {
            menu.style.bottom = 'auto';
            menu.style.top = `${Math.round(r.bottom + 10)}px`;
        }

        btn.setAttribute('aria-expanded', 'true');
        visionMenuDocClick = (ev) => {
            if (!menu.contains(ev.target) && !btn.contains(ev.target)) closeVisionMenu();
        };
        setTimeout(() => document.addEventListener('click', visionMenuDocClick), 0);
    }

    document.getElementById('visionBtn').addEventListener('click', (e) => {
        e.stopPropagation();
        if (!visionActiveMode()) return; // bouton grisé : le survol a déjà tout dit
        if (visionMenuEl) closeVisionMenu(); else openVisionMenu();
    });
    window.addEventListener('resize', closeVisionMenu);

    document.getElementById('visionFileInput').addEventListener('change', async (e) => {
        const file = e.target.files && e.target.files[0];
        e.target.value = ''; // permet de renvoyer deux fois le même fichier
        if (!file || !visionActiveMode()) return;
        const archive = await visionFileToJpeg(file, VISION_ARCHIVE_EDGE, VISION_ARCHIVE_QUALITY);
        const pair = await visionCapturePair(archive);
        if (pair) visionSendImage(pair.sent, { label: file.name, archive: pair.archive });
        else setStatus('Image illisible', 'error');
    });

    // S'assure que le canvas a la bonne résolution interne (haute densité)
    function syncCanvasSize(canvas) {
        const dpr = window.devicePixelRatio || 1;
        const rect = canvas.getBoundingClientRect();
        const w = Math.max(1, Math.round(rect.width * dpr));
        const h = Math.max(1, Math.round(rect.height * dpr));
        if (canvas.width !== w || canvas.height !== h) {
            canvas.width = w;
            canvas.height = h;
        }
    }

    function drawRadialViz(ctx, canvas, level, color, time, speaking) {
        const w = canvas.width, h = canvas.height;
        const cx = w / 2, cy = h / 2;
        const unit = Math.min(cx, cy);
        ctx.clearRect(0, 0, w, h);

        // ── Halo (intensifié si speaking) ──
        const speakBoost = speaking ? 2.5 : 1.0;
        const haloR = unit * (0.75 + level * 0.12 * speakBoost);
        const haloA = (0.04 + level * 0.12) * speakBoost;
        const halo = ctx.createRadialGradient(cx, cy, 0, cx, cy, haloR);
        halo.addColorStop(0, rgba(color, Math.min(haloA * 0.8, 0.5)));
        halo.addColorStop(0.3, rgba(color, Math.min(haloA * 0.5, 0.3)));
        halo.addColorStop(0.7, rgba(color, Math.min(haloA * 0.15, 0.12)));
        halo.addColorStop(1, 'transparent');
        ctx.fillStyle = halo;
        ctx.fillRect(0, 0, w, h);

        // ── Halo externe lumineux quand speaking ──
        if (speaking && level > 0.02) {
            const outerR = unit * (0.85 + level * 0.08);
            const outerA = level * 0.25;
            const outer = ctx.createRadialGradient(cx, cy, unit * 0.3, cx, cy, outerR);
            outer.addColorStop(0, rgba(color, outerA * 0.3));
            outer.addColorStop(0.5, rgba(color, outerA * 0.6));
            outer.addColorStop(0.8, rgba(color, outerA));
            outer.addColorStop(1, 'transparent');
            ctx.fillStyle = outer;
            ctx.fillRect(0, 0, w, h);
        }

        // ── Barres centrales (grandes, contrastées) ──
        const numBars = 56;
        const barBaseR = unit * 0.15;
        const barMaxLen = unit * 0.45;
        for (let i = 0; i < numBars; i++) {
            const angle = (i / numBars) * Math.PI * 2;
            const wv = Math.sin(i * 1.3 + time * 3.5) * 0.45
                     + Math.sin(i * 2.9 + time * 2.0) * 0.3
                     + Math.sin(i * 4.3 + time * 5.2) * 0.2;
            const n = 0.1 + (wv + 1) * 0.45;
            const len = 8 + level * barMaxLen * n;
            const x1 = cx + Math.cos(angle) * barBaseR;
            const y1 = cy + Math.sin(angle) * barBaseR;
            const x2 = cx + Math.cos(angle) * (barBaseR + len);
            const y2 = cy + Math.sin(angle) * (barBaseR + len);
            ctx.beginPath();
            ctx.moveTo(x1, y1);
            ctx.lineTo(x2, y2);
            ctx.strokeStyle = rgba(color, 0.2 + level * 0.55 * n);
            ctx.lineWidth = 2.5;
            ctx.lineCap = 'round';
            ctx.stroke();
        }

        // ── Cercles déformés, très serrés, contrastés ──
        const circles = [
            { r: 0.92, a: 0.20, lw: 1.5, spd: 0.3,  def: 0.9, dark: false },
            { r: 0.88, a: 0.55, lw: 2.2, spd: -0.5, def: 0.7, dark: false },
            { r: 0.84, a: 0.30, lw: 1.8, spd: 0.7,  def: 1.1, dark: true },
            { r: 0.80, a: 0.50, lw: 2.0, spd: -0.8, def: 0.6, dark: false },
            { r: 0.76, a: 0.25, lw: 1.2, spd: 1.0,  def: 1.3, dark: true },
            { r: 0.73, a: 0.65, lw: 2.5, spd: -0.4, def: 0.5, dark: false },
            { r: 0.70, a: 0.15, lw: 1.0, spd: 0.6,  def: 1.6, dark: true },
            { r: 0.67, a: 0.45, lw: 2.0, spd: -1.1, def: 0.8, dark: false },
            { r: 0.63, a: 0.35, lw: 1.6, spd: 0.9,  def: 1.0, dark: false },
            { r: 0.60, a: 0.20, lw: 1.3, spd: -0.7, def: 1.4, dark: true },
        ];

        const pts = 180;
        circles.forEach(c => {
            const baseR = unit * c.r;
            ctx.beginPath();
            for (let i = 0; i <= pts; i++) {
                const ang = (i / pts) * Math.PI * 2;
                const d = Math.sin(ang * 2 + time * c.spd * 2.0) * c.def
                        + Math.sin(ang * 3 + time * c.spd * 2.8) * c.def * 0.55
                        + Math.sin(ang * 5 + time * c.spd * 1.5) * c.def * 0.3
                        + Math.sin(ang * 7 + time * c.spd * 3.3) * c.def * 0.15;
                const distort = 1 + level * d * 0.08;
                const r = baseR * distort;
                const x = cx + Math.cos(ang) * r;
                const y = cy + Math.sin(ang) * r;
                if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
            }
            ctx.closePath();
            if (c.dark) {
                ctx.strokeStyle = `rgba(0,0,0, ${Math.min(c.a + level * 0.25, 0.7)})`;
            } else {
                ctx.strokeStyle = rgba(color, Math.min(c.a + level * 0.3, 0.9));
            }
            ctx.lineWidth = c.lw + level * 0.5;
            ctx.stroke();
        });
    }

    // ── Orb central (IA / persona) ──
    function drawAIOrb() {
        syncCanvasSize(aiOrbCanvas);
        const dpr = window.devicePixelRatio || 1;
        const width = aiOrbCanvas.width / dpr;
        const height = aiOrbCanvas.height / dpr;
        const centerX = width / 2;
        const centerY = height / 2;
        const scale = Math.min(width, height) / 360;

        aiOrbCtx.save();
        aiOrbCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
        aiOrbCtx.clearRect(0, 0, width, height);

        // Récupère le spectre de l'IA si dispo
        let volume = 0, bass = 0, mid = 0, high = 0;
        if (playbackAnalyser) {
            playbackAnalyser.getByteFrequencyData(aiFreqData);
            let sum = 0;
            for (let i = 0; i < aiFreqData.length; i++) sum += aiFreqData[i];
            volume = (sum / aiFreqData.length) / 255;
            for (let i = 0; i < 10; i++) bass += aiFreqData[i];
            for (let i = 10; i < 50; i++) mid += aiFreqData[i];
            for (let i = 50; i < 100; i++) high += aiFreqData[i];
            bass = (bass / 10) / 255;
            mid = (mid / 40) / 255;
            high = (high / 50) / 255;
        }

        const isActive = isConnected;
        const targetVolume = isActive ? volume : 0;
        orbVolume += (targetVolume - orbVolume) * 0.15;

        if (isActive && playbackAnalyser) {
            orbPhase += 0.005 + bass * 0.04;
        } else {
            orbPhase += 0.002;
        }

        orbBass += (bass - orbBass) * 0.2;
        orbMid += (mid - orbMid) * 0.2;
        orbHigh += (high - orbHigh) * 0.2;

        // Palette de couleurs adaptée au thème :
        // — mode sombre : couleurs claires + composition "screen" (additive, glow lumineux)
        // — mode clair : couleurs foncées + composition "multiply" (assombrit le fond)
        const isLight = document.documentElement.dataset.theme === 'light';
        const C = isLight ? {
            c1: '126, 34, 206',   // purple-700
            c2: '37, 99, 235',    // blue-600
            c3: '29, 78, 216',    // blue-700
            c4: '162, 28, 175',   // fuchsia-700
            c5: '13, 148, 136',   // teal-600
            c6: '15, 23, 42',     // slate-900
            coreA: '167, 139, 250', // violet-400 (clair : `multiply` assombrit vite)
            coreB: '147, 197, 253'  // blue-300
        } : {
            c1: '216, 180, 254',
            c2: '147, 197, 253',
            c3: '96, 165, 250',
            c4: '232, 121, 249',
            c5: '45, 212, 191',
            c6: '255, 255, 255',
            coreA: '168, 85, 247',
            coreB: '59, 130, 246'
        };

        aiOrbCtx.globalCompositeOperation = isLight ? 'multiply' : 'screen';

        // 1) Cœur lumineux — même couleur de fond allumé/éteint (orbVolume=0 au repos
        // donne automatiquement la teinte calme ; pas de branche distincte)
        const coreRadius = (40 + orbBass * 20) * scale;
        const grad = aiOrbCtx.createRadialGradient(centerX, centerY, 0, centerX, centerY, coreRadius * 2.5);
        if (isLight) {
            // En mode clair, `multiply` noircit vite le centre : on garde des
            // teintes CLAIRES (qui évitent l'effet « foncé ») mais avec assez
            // d'opacité pour que le cœur reste bien perceptible, même au repos.
            grad.addColorStop(0, `rgba(${C.coreA}, ${0.42 + orbVolume * 0.30})`);
            grad.addColorStop(0.5, `rgba(${C.coreB}, ${0.24 + orbVolume * 0.22})`);
            grad.addColorStop(1, 'rgba(255, 255, 255, 0)');
        } else {
            grad.addColorStop(0, `rgba(${C.coreA}, ${0.4 + orbVolume * 0.4})`);
            grad.addColorStop(0.5, `rgba(${C.coreB}, ${0.2 + orbVolume * 0.3})`);
            grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
        }
        aiOrbCtx.fillStyle = grad;
        aiOrbCtx.beginPath();
        aiOrbCtx.arc(centerX, centerY, coreRadius * 2.5, 0, Math.PI * 2);
        aiOrbCtx.fill();

        // 2) Anneaux morphants
        function drawMorphingRing(baseRadius, color, offsetPhase, lineWidth, bMod, mMod, hMod, lobes) {
            aiOrbCtx.beginPath();
            const points = 150;
            for (let i = 0; i <= points; i++) {
                const angle = (i / points) * Math.PI * 2;
                const idle = Math.sin(angle * lobes[0] + orbPhase * offsetPhase) * 2 * scale;
                const bWave = Math.sin(angle * lobes[1] - orbPhase * offsetPhase * 0.8) * (orbBass * bMod * scale);
                const mWave = Math.cos(angle * lobes[2] + orbPhase * offsetPhase * 1.2) * (orbMid * mMod * scale);
                const hWave = Math.sin(angle * lobes[3] - orbPhase * offsetPhase * 1.5) * (orbHigh * hMod * scale);
                const radius = baseRadius * scale + idle + bWave + mWave + hWave;
                const x = centerX + Math.cos(angle) * radius;
                const y = centerY + Math.sin(angle) * radius;
                if (i === 0) aiOrbCtx.moveTo(x, y); else aiOrbCtx.lineTo(x, y);
            }
            aiOrbCtx.closePath();
            aiOrbCtx.strokeStyle = color;
            aiOrbCtx.lineWidth = lineWidth * scale;
            aiOrbCtx.stroke();
        }

        const ringBase = 85;
        const activeMult = isActive ? (1 + orbVolume * 0.2) : 1;
        // En mode clair, l'ombre (glow `multiply`) assombrit le fond autour de
        // l'orb : on la réduit fortement pour garder des anneaux nets et clairs.
        aiOrbCtx.shadowBlur = (isLight ? 4 : 15) * scale;

        aiOrbCtx.shadowColor = `rgba(${C.c1}, 0.8)`;
        drawMorphingRing(ringBase * activeMult, `rgba(${C.c1}, ${0.5 + orbVolume * 0.5})`, 2, 2 + orbVolume * 2, 12, 5, 2, [2, 1, 3, 2]);

        aiOrbCtx.shadowColor = `rgba(${C.c2}, 0.8)`;
        drawMorphingRing((ringBase - 5) * activeMult, `rgba(${C.c2}, ${0.5 + orbVolume * 0.5})`, -3, 1.5 + orbVolume * 1.5, 5, 15, 5, [1, 2, 2, 3]);

        aiOrbCtx.shadowColor = `rgba(${C.c3}, 0.8)`;
        drawMorphingRing((ringBase + 5) * activeMult, `rgba(${C.c3}, ${0.4 + orbVolume * 0.4})`, 4, 1 + orbVolume, 2, 7, 12, [3, 1, 2, 4]);

        aiOrbCtx.shadowColor = `rgba(${C.c4}, 0.6)`;
        drawMorphingRing((ringBase + 10) * activeMult, `rgba(${C.c4}, ${0.3 + orbVolume * 0.4})`, -1.5, 1.2 + orbVolume, 10, 7, 5, [2, 2, 1, 3]);

        aiOrbCtx.shadowColor = `rgba(${C.c5}, 0.6)`;
        drawMorphingRing((ringBase - 10) * activeMult, `rgba(${C.c5}, ${0.3 + orbVolume * 0.4})`, 3.5, 1.2 + orbVolume, 7, 10, 7, [1, 3, 2, 1]);

        aiOrbCtx.shadowColor = `rgba(${C.c6}, 0.8)`;
        drawMorphingRing((ringBase - 15) * activeMult, `rgba(${C.c6}, ${0.2 + orbVolume * 0.5})`, -4, 0.8 + orbVolume * 1.5, 5, 5, 5, [2, 1, 2, 2]);

        aiOrbCtx.restore();
    }

    // ── Ligne d'onde (utilisateur) ──
    // Réagit au niveau audio du micro : ligne horizontale qui oscille
    // verticalement au centre, immobile aux bords (fenêtre sin²).
    function drawUserWave() {
        // Constantes visuelles
        const LINE_WIDTH      = 3;
        const SHADOW_BLUR     = 10;
        const EDGE_SAFETY     = SHADOW_BLUR + LINE_WIDTH / 2 + 1; // marge pour ne pas dépasser le canvas
        // Réactivité au volume
        const SPEAK_THRESHOLD = 0.025; // seuil en dessous duquel on considère "silence"
        const SENSITIVITY     = 7;     // pente initiale de la courbe tanh (réactivité voix basse)
        const SOFT_CAP        = 28;    // amplitude max visée (px), saturée par tanh
        const MIN_VISIBLE     = 3;     // amplitude minimale quand on parle (rester visible)
        const SMOOTHING       = 0.1;   // lissage temporel de l'amplitude

        syncCanvasSize(userWaveCanvas);
        const dpr    = window.devicePixelRatio || 1;
        const width  = userWaveCanvas.width  / dpr;
        const height = userWaveCanvas.height / dpr;

        userWaveCtx.save();
        userWaveCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
        userWaveCtx.clearRect(0, 0, width, height);

        // Analyse spectre micro (basse, médium, aigu — sert à enrichir la wave)
        let bass = 0, mid = 0, high = 0;
        if (userMicAnalyser) {
            userMicAnalyser.getByteFrequencyData(userFreqData);
            for (let i = 0;  i < 10;  i++) bass += userFreqData[i];
            for (let i = 10; i < 50;  i++) mid  += userFreqData[i];
            for (let i = 50; i < 100; i++) high += userFreqData[i];
            bass = (bass / 10) / 255;
            mid  = (mid  / 40) / 255;
            high = (high / 50) / 255;
        }

        // Amplitude cible — courbe tanh : très réactive aux faibles volumes
        // (boost à voix basse) et saturée naturellement vers le haut.
        // EDGE_SAFETY remplace l'ancien `26` magique : dérivé du shadowBlur réel.
        // `Math.max(0, …)` empêche un maxAmp négatif sur les canvas très courts
        // (ex. vue Transcription Simple où le wrap fait 40 px) — c'était le bug
        // qui clouait l'amplitude à 3 px en compact.
        const volume      = smoothUserLevel;
        const isActive    = isConnected;
        const isSpeaking  = volume > SPEAK_THRESHOLD;
        const maxAmp      = Math.max(0, (height / 2) - EDGE_SAFETY);
        const softCap     = Math.min(SOFT_CAP, maxAmp);
        const targetAmp   = (isActive && isSpeaking)
            ? Math.max(MIN_VISIBLE, Math.tanh(volume * SENSITIVITY) * softCap)
            : 0;
        waveAmplitude += (targetAmp - waveAmplitude) * SMOOTHING;

        if (isActive && isSpeaking) wavePhase += 0.02 + bass * 0.03;

        // Tracé — somme de 3 sinusoïdes, atténuée aux bords par une fenêtre sin²
        userWaveCtx.beginPath();
        for (let x = 0; x < width; x++) {
            const w1 = Math.sin(x * 0.008 + wavePhase)         * (1 + bass * 0.5);
            const w2 = Math.sin(x * 0.015 - wavePhase * 1.2)   * (mid  * 0.8);
            const w3 = Math.sin(x * 0.025 + wavePhase * 1.8)   * (high * 1.0);
            const combined = (w1 + w2 + w3) / 2.5;                       // normalise ~[-1.3, 1.3]
            const taper    = Math.sin(Math.PI * x / (width - 1)) ** 2;   // 0 aux bords, 1 au centre
            const y        = height / 2 + combined * waveAmplitude * taper;
            if (x === 0) userWaveCtx.moveTo(x, y); else userWaveCtx.lineTo(x, y);
        }

        // Style de trait :
        // - Mode sombre : amber d'origine (#fde68a stroke + halo orange).
        // - Mode clair : bleu --accent (#1e88e5) — même teinte que le bouton
        //   « + Nouvelle discussion » et que la transcription utilisateur.
        const isLight = document.documentElement.dataset.theme === 'light';
        userWaveCtx.shadowBlur  = SHADOW_BLUR;
        userWaveCtx.shadowColor = isLight ? 'rgba(30, 136, 229, 0.45)' : 'rgba(245, 158, 11, 0.55)';
        userWaveCtx.strokeStyle = isLight ? 'rgba(30, 136, 229, 1)'    : 'rgba(253, 230, 138, 1)';
        userWaveCtx.lineWidth   = LINE_WIDTH;
        userWaveCtx.stroke();
        userWaveCtx.restore();
    }

    function animate() {
        const time = performance.now() / 1000;

        if (playbackAnalyser && isConnected) {
            const buf = new Float32Array(playbackAnalyser.fftSize);
            playbackAnalyser.getFloatTimeDomainData(buf);
            gerardAudioLevel = Math.min(1, computeLevel(buf) * 12);
        } else if (!isConnected) {
            gerardAudioLevel = 0;
        }

        smoothUserLevel += (userAudioLevel - smoothUserLevel) * 0.18;
        smoothPersonaLevel += (gerardAudioLevel - smoothPersonaLevel) * 0.18;

        // La wave est dessinée dans tous les modes. L'orb ne sert qu'au
        // mode conversation (persona) : on skip son rendu en transcripteur
        // pour éviter de tourner en vain sur un canvas caché.
        if (!isTranscripteurMode) drawAIOrb();
        drawUserWave();

        animationId = requestAnimationFrame(animate);
    }

    animate();


