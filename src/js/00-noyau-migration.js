    //  RENOMMAGE KAST → VART : les clés localStorage s'appelaient « kast_* ».
    //  Au premier lancement de Vart on les COPIE vers « vart_* » (sans écraser
    //  une valeur « vart_* » déjà présente). On ne supprime PAS les anciennes :
    //  l'utilisateur peut ainsi rouvrir l'ancien fichier Kast sans rien perdre.
    //  Le filtrage par préfixe couvre aussi les clés dynamiques
    //  (« kast_transcribeLang_openai », « kast_translateLang_gemini »…).
    //  À exécuter AVANT migrateLegacyData() et avant toute lecture de clé.
    function migrateStoragePrefix() {
        try {
            for (let i = 0; i < localStorage.length; i++) {
                const k = localStorage.key(i);
                if (!k || !k.startsWith('kast_')) continue;
                const nk = 'vart_' + k.slice('kast_'.length);
                if (localStorage.getItem(nk) === null) {
                    localStorage.setItem(nk, localStorage.getItem(k));
                }
            }
        } catch (e) { /* best-effort : ne jamais bloquer le démarrage */ }
    }
    migrateStoragePrefix();

    //  Exécutée AVANT tout le reste : assainit les données localStorage d'une
    //  v1.7 pour qu'une mise à niveau se passe sans accroc.
    function migrateLegacyData() {
        // Modèles de conversation SÉLECTIONNABLES actuels. Tout modèle enregistré
        // hors de cette liste (ancien « gpt-realtime-translate » de la v1.7, ou
        // anciens realtime « gpt-realtime-1.5 » / « gpt-realtime-mini » remplacés)
        // est ramené vers un modèle valide, pour éviter connexions cassées et
        // sélecteur vide après mise à niveau.
        const VALID_CONV_MODELS = [
            'gpt-live-1', 'gpt-realtime-2.1', 'gpt-realtime-2.1-mini', 'gpt-realtime-2',
            'gemini-3.8-live', 'gemini-3.8-live-extended-thinking', 'gemini-3.1-flash-live-preview',
            'grok-voice-think-fast-2.0'
        ];
        try {
            const savedModel = localStorage.getItem('vart_realtimeModel');
            if (savedModel && !VALID_CONV_MODELS.includes(savedModel)) {
                localStorage.setItem('vart_realtimeModel', 'gpt-realtime-2.1-mini');
            }
            const raw = localStorage.getItem('vart_personas');
            if (raw) {
                const personas = JSON.parse(raw);
                let changed = false;
                if (Array.isArray(personas)) {
                    personas.forEach(p => {
                        if (p && p.model && !VALID_CONV_MODELS.includes(p.model)) {
                            p.model = ''; // repli sur le modèle par défaut
                            changed = true;
                        }
                    });
                }
                if (changed) localStorage.setItem('vart_personas', JSON.stringify(personas));
            }
        } catch (e) { /* best-effort : ne jamais bloquer le démarrage */ }
    }
    migrateLegacyData();

    // ══════════════════════════════════════════════════════════════════════
    //  BASE DE DONNÉES VART (IndexedDB) — « vart-db »
    //  Nouvelle couche de stockage (Phase 0). localStorage reste réservé aux
    //  clés API et réglages légers ; les données volumineuses vivent ici :
    //    - conversations     : historique complet (migré depuis localStorage)
    //    - persona_memories  : mémoire par persona (Phase 1)
    //    - sources           : documents indexés des personas (Phase 2)
    //  La base « kast » des vignettes vision (VISION_DB_NAME) est conservée
    //  telle quelle, pour ne pas orpheliner les images existantes.
    // ══════════════════════════════════════════════════════════════════════
    const VART_DB_NAME = 'vart-db';
    // v2 (Phase 3) : ajoute « study_items » (quiz, fiches, plans, progression)
    // et « handles » (poignée du dossier Obsidian, clé hors-ligne). La montée
    // de version est additive : les stores existants sont conservés.
    const VART_DB_VERSION = 2;
    let vartDbPromise = null;

    // Ouvre (et crée au besoin) la base. Renvoie null si IndexedDB est
    // indisponible (navigation privée, stockage bloqué) : les appelants
    // retombent alors sur le comportement précédent, sans rien casser.
    function vartDb() {
        if (vartDbPromise) return vartDbPromise;
        vartDbPromise = new Promise(resolve => {
            let req;
            try { req = indexedDB.open(VART_DB_NAME, VART_DB_VERSION); }
            catch (e) { resolve(null); return; }
            req.onupgradeneeded = () => {
                const db = req.result;
                if (!db.objectStoreNames.contains('conversations')) {
                    const st = db.createObjectStore('conversations', { keyPath: 'id' });
                    st.createIndex('by_persona', 'personaId', { unique: false });
                    st.createIndex('by_date', 'date', { unique: false });
                }
                if (!db.objectStoreNames.contains('persona_memories')) {
                    db.createObjectStore('persona_memories', { keyPath: 'personaId' });
                }
                if (!db.objectStoreNames.contains('sources')) {
                    const st = db.createObjectStore('sources', { keyPath: 'id' });
                    st.createIndex('by_persona', 'personaId', { unique: false });
                }
                // Phase 3 : éléments d'étude (quiz, fiches de révision, plans,
                // progression). Une seule table, discriminée par `type`, pour
                // n'avoir qu'une purge à gérer à la suppression du persona.
                if (!db.objectStoreNames.contains('study_items')) {
                    const st = db.createObjectStore('study_items', { keyPath: 'id' });
                    st.createIndex('by_persona', 'personaId', { unique: false });
                }
                // Poignée du dossier Obsidian (File System Access) : clé
                // hors-ligne (on écrit put(handle, 'obsidianVault')).
                if (!db.objectStoreNames.contains('handles')) {
                    db.createObjectStore('handles');
                }
            };
            req.onsuccess = () => {
                const db = req.result;
                // Connexion morte (fermée par le navigateur ou pour une mise à
                // jour de schéma depuis un autre onglet) : on en rouvrira une
                // à la prochaine opération au lieu de réutiliser celle-ci.
                db.onclose = () => { vartDbPromise = null; };
                db.onversionchange = () => { try { db.close(); } catch (e) {} vartDbPromise = null; };
                resolve(db);
            };
            req.onerror   = () => { vartDbPromise = null; resolve(null); };
            req.onblocked = () => { vartDbPromise = null; resolve(null); };
        });
        return vartDbPromise;
    }

    // Exécute `fn(store)` dans une transaction sur `storeName`. Renvoie le
    // résultat de la requête (ou null en cas de problème) — même philosophie
    // « best-effort » que visionDbRun : jamais d'exception vers l'appelant.
    function vartDbRun(mode, storeName, fn) {
        return vartDb().then(db => {
            if (!db) return null;
            return new Promise(resolve => {
                let tx;
                try { tx = db.transaction(storeName, mode); }
                catch (e) { resolve(null); return; }
                const store = tx.objectStore(storeName);
                let out = null;
                try { const req = fn(store); if (req) req.onsuccess = () => { out = req.result; }; }
                catch (e) { resolve(null); return; }
                tx.oncomplete = () => resolve(out);
                tx.onerror = tx.onabort = () => resolve(null);
            });
        });
    }

