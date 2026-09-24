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

