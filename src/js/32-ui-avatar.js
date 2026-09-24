    function getAvatarBgColor()  { return localStorage.getItem('vart_avatarBgColor')  || '#3A4256'; }
    function setAvatarBgColor(c)  { localStorage.setItem('vart_avatarBgColor', c); applyAvatarColors(); }
    function getAvatarTopColor() { return localStorage.getItem('vart_avatarTopColor') || '#6B7280'; }
    function setAvatarTopColor(c) { localStorage.setItem('vart_avatarTopColor', c); }

    // Propage la couleur de fond d'avatar aux vignettes « sans image » via la
    // variable CSS --avatar-bg, et calcule un avant-plan (--avatar-fg) lisible
    // selon la luminance du fond (silhouette claire sur fond sombre, et
    // inversement). Appelée à l'init, à chaque changement de couleur et après
    // un import. Aucune re-génération nécessaire : les placeholders lisent la
    // variable et se recolorent instantanément.
    function applyAvatarColors() {
        const bg = getAvatarBgColor();
        const m = /^#?([0-9a-fA-F]{6})$/.exec(bg.trim());
        let fg = 'rgba(255,255,255,0.62)';
        if (m) {
            const n = parseInt(m[1], 16);
            const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
            const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b; // 0–255
            fg = lum > 150 ? 'rgba(0,0,0,0.5)' : 'rgba(255,255,255,0.62)';
        }
        document.documentElement.style.setProperty('--avatar-bg', bg);
        document.documentElement.style.setProperty('--avatar-fg', fg);
    }
    function syncAvatarColorInputs() {
        document.getElementById('pImageBgColor').value  = getAvatarBgColor();
        document.getElementById('pImageTopColor').value = getAvatarTopColor();
    }
    // Sauvegarde en direct à chaque changement (la génération lit la valeur courante).
    document.getElementById('pImageBgColor').addEventListener('input', (e) => setAvatarBgColor(e.target.value));
    document.getElementById('pImageTopColor').addEventListener('input', (e) => setAvatarTopColor(e.target.value));

    // « Générer » (parmi les 3 boutons) : révèle le panneau d'options + le
    // bouton de lancement, et se retire (pour ne pas doublonner avec « Générer
    // l'image »).
    function showGenOptions() {
        document.getElementById('genOptionsPanel').classList.add('open');
        document.getElementById('revealGenBtn').style.display = 'none';
    }
    function resetGenOptions() {
        document.getElementById('genOptionsPanel').classList.remove('open');
        document.getElementById('revealGenBtn').style.display = '';
    }
    document.getElementById('revealGenBtn').addEventListener('click', showGenOptions);

    let imageModalSnapshot = null;
    // Jeton d'invalidation : incrémenté à chaque fermeture de la popup image.
    // Une génération en vol dont le jeton n'est plus courant est ignorée (évite
    // qu'une réponse tardive écrase l'image après annulation ou changement de persona).
    let imageGenToken = 0;
    function openPersonaImageModal() {
        syncAvatarColorInputs();
        resetGenOptions();
        imageModalSnapshot = {
            image: tempImage,
            details: document.getElementById('pImageDetails').value,
            bg: getAvatarBgColor(),
            top: getAvatarTopColor()
        };
        document.getElementById('imageHint').textContent = '';
        renderImagePreview();
        document.getElementById('personaImageModal').classList.add('active');
    }
    // revert = true : rétablit l'image, les détails ET les couleurs d'avant l'ouverture.
    function closePersonaImageModal(revert) {
        // Invalide toute génération d'image encore en cours (annulée par la fermeture).
        imageGenToken++;
        if (revert && imageModalSnapshot) {
            tempImage = imageModalSnapshot.image;
            document.getElementById('pImageDetails').value = imageModalSnapshot.details;
            setAvatarBgColor(imageModalSnapshot.bg);
            setAvatarTopColor(imageModalSnapshot.top);
            syncAvatarColorInputs();
            renderImagePreview();
        }
        document.getElementById('personaImageModal').classList.remove('active');
    }
    document.getElementById('editImageBtn').addEventListener('click', openPersonaImageModal);
    // Annuler / croix / clic sur le fond → on annule les changements.
    document.getElementById('cancelPersonaImageBtn').addEventListener('click', () => closePersonaImageModal(true));
    document.getElementById('closePersonaImageBtn').addEventListener('click', () => closePersonaImageModal(true));
    document.getElementById('personaImageModal').addEventListener('click', (e) => {
        if (e.target === e.currentTarget) closePersonaImageModal(true);
    });
    // Terminé → on garde les changements.
    document.getElementById('donePersonaImageBtn').addEventListener('click', () => closePersonaImageModal(false));

    document.getElementById('pModel').addEventListener('change', () => {
        updatePersonaVoiceList(document.getElementById('pVoice').value);
    });
    document.getElementById('duplicatePersonaBtn').addEventListener('click', () => {
        const original = getPersonas().find(p => p.id === getActiveId());
        if (!original) return;
        const duplicate = {
            ...JSON.parse(JSON.stringify(original)),
            id: 'p_' + Date.now(),
            name: original.name + ' (copie)'
        };
        const list = getPersonas();
        list.push(duplicate);
        savePersonas(list);
        renderPersonaList();
        selectPersona(duplicate.id);
    });
    document.getElementById('editPersonaBtn').addEventListener('click', () => {
        const p = getPersonas().find(p => p.id === getActiveId());
        if (p) openPersonaModal(p);
    });

    document.getElementById('clearImageBtn').addEventListener('click', () => {
        tempImage = null;
        renderImagePreview();
    });

    document.getElementById('importImageInput').addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (ev) => {
            resizeImageToBase64(ev.target.result, 300, (b64) => {
                if (!b64) { customAlert('Impossible de charger cette image.', { title: 'Erreur', icon: 'x-circle' }); return; }
                tempImage = b64;
                renderImagePreview();
            });
        };
        reader.readAsDataURL(file);
        e.target.value = '';
    });

    // Redimensionner image pour économiser localStorage
    function resizeImageToBase64(src, maxSize, cb) {
        const img = new Image();
        img.onload = () => {
            const canvas = document.createElement('canvas');
            const scale = Math.min(maxSize / img.width, maxSize / img.height, 1);
            canvas.width = img.width * scale;
            canvas.height = img.height * scale;
            canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
            cb(canvas.toDataURL('image/jpeg', 0.8));
        };
        img.onerror = () => cb(null); // image illisible → on prévient l'appelant au lieu de rester bloqué
        img.src = src;
    }

    // Modèle d'avatar OpenAI. gpt-image-1.5 est retiré le 01/12/2026 ; GPT
    // Image 2.5 Flare, disponible depuis le 08/09/2026, le remplace sans rien
    // changer à l'appel (même endpoint, mêmes paramètres, même réponse).
    // OpenAI le présente comme le choix par défaut : plus rapide que GPT
    // Image 2, et environ 4 fois moins cher en qualité « medium ».
    const OPENAI_IMAGE_MODEL = 'gpt-image-2.5-flare';

    // Coût d'une génération OpenAI, d'après `usage` quand la réponse le
    // fournit (la référence ne le garantit pas pour tous les modèles). Sinon :
    // le forfait de sortie publié, plus le prompt estimé à 4 caractères par
    // token.
    function openaiImageCost(data, prompt) {
        const p = PRICING[OPENAI_IMAGE_MODEL];
        const u = data && data.usage;
        if (!u || u.output_tokens == null) {
            return p.approxPerImage + (String(prompt || '').length / 4 / 1000) * p.textInput;
        }
        const d = u.input_tokens_details || {};
        const textIn  = d.text_tokens != null ? d.text_tokens : (u.input_tokens || 0);
        const imageIn = d.image_tokens || 0;
        return (textIn / 1000) * p.textInput + (imageIn / 1000) * p.imageInput + (u.output_tokens / 1000) * p.output;
    }

    // Modèle d'avatar Gemini : Nano Banana 2 (version stable), deux fois
    // moins cher que Nano Banana Pro et plus rapide, largement suffisant pour
    // un avatar ramené à 300 px. Image 1K par défaut.
    const GEMINI_IMAGE_MODEL = 'gemini-3.1-flash-image';

    // Coût d'une génération Gemini, d'après usageMetadata : l'image se paie
    // $60/1M en sortie, le texte et la réflexion $3/1M, le prompt $0.50/1M.
    // Sans détail par modalité, l'image n'est pas isolable → forfait publié.
    function geminiImageCost(data) {
        const p = PRICING[GEMINI_IMAGE_MODEL];
        const u = data && (data.usageMetadata || data.usage_metadata);
        if (!u) return p.approxPerImage;
        const prompt = u.promptTokenCount || u.prompt_token_count || 0;
        const outTotal = u.candidatesTokenCount || u.candidates_token_count || 0;
        const thoughts = u.thoughtsTokenCount || u.thoughts_token_count || 0;
        const imgOut = Math.min(geminiModalityCounts(u.candidatesTokensDetails || u.candidates_tokens_details).IMAGE, outTotal);
        const promptCost = (prompt / 1000) * p.input;
        if (!imgOut) return p.approxPerImage + promptCost;
        return promptCost + (imgOut / 1000) * p.imageOutput + ((outTotal - imgOut + thoughts) / 1000) * p.output;
    }

    // Génération d'avatar. `provider` : 'openai' (GPT Image) ou 'gemini'.
