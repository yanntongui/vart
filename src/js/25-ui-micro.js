    let micPermissionGranted = false;
    async function isMicAlreadyGranted() {
        if (micPermissionGranted) return true;
        try {
            const p = await navigator.permissions.query({ name: 'microphone' });
            if (p.state === 'granted') { micPermissionGranted = true; return true; }
        } catch { /* Safari/Firefox : Permissions API ne couvre pas tjs le micro */ }
        return false;
    }
    async function ensureMicReady() {
        if (await isMicAlreadyGranted()) return true;
        const convArea = document.getElementById('conversationArea');
        const errEl = document.getElementById('micGateError');
        const btn = document.getElementById('micGateBtn');
        errEl.textContent = '';
        btn.disabled = false;
        convArea.classList.add('mic-gated');
        convArea.style.display = 'flex';
        return new Promise(resolve => {
            const onClick = async () => {
                errEl.textContent = '';
                btn.disabled = true;
                try {
                    // Demande le micro avec les mêmes contraintes audio que
                    // startMicrophone(), et on GARDE le stream ouvert.
                    // startMicrophone() le réutilisera tel quel via
                    // `persistentStream`, ce qui évite un second prompt natif
                    // du navigateur quand l'utilisateur démarre la conversation.
                    const stream = await navigator.mediaDevices.getUserMedia({
                        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 }
                    });
                    persistentStream = stream;
                    micPermissionGranted = true;
                    btn.removeEventListener('click', onClick);
                    convArea.classList.remove('mic-gated');
                    resolve(true);
                } catch (err) {
                    btn.disabled = false;
                    errEl.textContent = err && err.name === 'NotAllowedError'
                        ? 'Accès refusé. Autorisez le micro dans les paramètres du navigateur, puis réessayez.'
                        : `Erreur micro : ${err?.message || err}`;
                }
            };
            btn.addEventListener('click', onClick);
        });
    }

