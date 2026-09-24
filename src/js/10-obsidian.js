    const OBSIDIAN_SUPPORTED = typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function';
    let obsidianHandle = null;

    // Options d'écriture automatique (activées par défaut dès que le vault
    // est connecté, désactivables une à une dans Configuration → Obsidian).
    function obsidianOption(name) { return localStorage.getItem(`vart_obsidian_${name}`) !== '0'; }
    function setObsidianOption(name, v) { localStorage.setItem(`vart_obsidian_${name}`, v ? '1' : '0'); }

    async function obsidianRestoreHandle() {
        if (obsidianHandle) return obsidianHandle;
        const h = await vartDbRun('readonly', 'handles', st => st.get('obsidianVault'));
        if (h) obsidianHandle = h;
        return obsidianHandle;
    }

    async function obsidianConnect() {
        if (!OBSIDIAN_SUPPORTED) {
            customAlert("Votre navigateur ne permet pas d'ouvrir un dossier local (API File System Access absente). Utilisez Chrome ou Edge, ou passez par les exports Markdown/CSV.", { title: 'Non disponible', icon: 'x-circle' });
            return null;
        }
        try {
            const handle = await window.showDirectoryPicker({ id: 'vart-obsidian', mode: 'readwrite' });
            obsidianHandle = handle;
            await vartDbRun('readwrite', 'handles', st => { st.put(handle, 'obsidianVault'); return true; });
            return handle;
        } catch (e) {
            return null; // dialogue annulé : pas une erreur
        }
    }

    async function obsidianDisconnect() {
        obsidianHandle = null;
        await vartDbRun('readwrite', 'handles', st => { st.delete('obsidianVault'); return true; });
    }

    // Le handle persisté revient en état « prompt » après rechargement :
    // requestPermission DOIT être appelé depuis une action utilisateur.
    async function obsidianEnsurePermission(handle) {
        if (!handle) return false;
        if (!handle.queryPermission) return false;
        const opts = { mode: 'readwrite' };
        try {
            if (await handle.queryPermission(opts) === 'granted') return true;
            return (await handle.requestPermission(opts)) === 'granted';
        } catch (e) { return false; }
    }

    // Sous-dossier du vault : obsidianDir(['Fiches'], true) → <vault>/Fiches.
    // Renvoie null si le vault n'est pas connecté ou si l'autorisation manque.
    async function obsidianDir(parts = [], create = false) {
        let h = await obsidianRestoreHandle();
        if (!h) return null;
        // Autorisation refusée : on échoue silencieusement (les appelants
        // traitent null comme « vault indisponible »).
        if (!await obsidianEnsurePermission(h)) return null;
        for (const name of parts) {
            try { h = await h.getDirectoryHandle(name, { create }); }
            catch (e) { return null; }
        }
        return h;
    }

    async function obsidianWriteFile(parts, filename, content) {
        const dir = await obsidianDir(parts, true);
        if (!dir) return false;
        try {
            const fh = await dir.getFileHandle(filename, { create: true });
            const w = await fh.createWritable();
            await w.write(content);
            await w.close();
            return true;
        } catch (e) {
            console.error('Écriture Obsidian échouée :', e);
            return false;
        }
    }

    // Nom de fichier compatible avec tous les systèmes (Obsidian interdit
    // aussi # ^ [ ] dans les liens).
    const obsidianFilename = (s) => String(s || '').replace(/[\\/:*?"<>|#^[\]]/g, '-').replace(/\s+/g, ' ').trim().slice(0, 80) || 'sans-titre';
    function obsidianFrontmatter(obj) {
        const lines = Object.entries(obj)
            .filter(([, v]) => v !== undefined && v !== null && v !== '')
            .map(([k, v]) => Array.isArray(v) ? `${k}: [${v.join(', ')}]` : `${k}: ${v}`);
        return `---\n${lines.join('\n')}\n---\n\n`;
    }

    // ── Sens 2 : Vart → Obsidian (écriture dans le vault) ──────────────────
    const OBSIDIAN_TODAY = () => new Date().toISOString().slice(0, 10);

    async function obsidianWriteSessionNote(personaName, transcript, resume) {
        if (!obsidianOption('sessions')) return;
        const iso = OBSIDIAN_TODAY();
        const fm = obsidianFrontmatter({ type: 'vart-session', persona: personaName, date: iso, tags: ['vart/session'] });
        const body = `# Session avec ${personaName} — ${iso}\n\n${resume ? `## Ce qu'il faut retenir\n\n${resume}\n\n` : ''}## Transcription\n\n${transcript}\n`;
        await obsidianWriteFile(['Sessions'], obsidianFilename(`${iso} ${personaName}`) + '.md', fm + body);
    }

    // Format compatible avec le plugin « Spaced Repetition » d'Obsidian :
    // « #Question » suivi de la réponse, fiches séparées par « --- ».
    async function obsidianWriteFlashcards(personaId) {
        if (!obsidianOption('cards') || !personaId) return;
        const cards = await listStudyItems(personaId, 'flashcard');
        if (!cards.length) return;
        const name = personaNameOf(personaId);
        const fm = obsidianFrontmatter({ type: 'vart-flashcards', persona: name, updated: OBSIDIAN_TODAY(), tags: ['vart/fiches'] });
        const body = cards.map(c => `#${c.recto}\n\n${c.verso}\n`).join('\n---\n\n');
        await obsidianWriteFile(['Fiches'], obsidianFilename(name) + '.md', `${fm}# Fiches de révision — ${name}\n\n${body}\n`);
    }

    async function obsidianWriteMemory(personaId) {
        if (!obsidianOption('memory') || !personaId) return;
        const name = personaNameOf(personaId);
        const mem = getPersonaMemoryText(personaId);
        const fm = obsidianFrontmatter({ type: 'vart-memoire', persona: name, updated: OBSIDIAN_TODAY(), tags: ['vart/memoire'] });
        await obsidianWriteFile(['Personas'], obsidianFilename(`${name} - Mémoire`) + '.md', `${fm}# Mémoire de ${name}\n\n${mem || '*(vide pour l\'instant)*'}\n`);
    }

    async function obsidianWritePlan(personaId) {
        const plans = await listStudyItems(personaId, 'plan');
        if (!plans.length) return;
        const plan = plans[0];
        const name = personaNameOf(personaId);
        const fm = obsidianFrontmatter({ type: 'vart-plan', persona: name, date: (plan.createdAt || '').slice(0, 10), tags: ['vart/plan'] });
        const body = `# Plan d'apprentissage — ${name}\n\n**Objectif :** ${plan.objectif}\n\n${plan.etapes.map(e => `- [ ] ${e}`).join('\n')}\n`;
        await obsidianWriteFile(['Plans'], obsidianFilename(`${name} - Plan`) + '.md', fm + body);
    }

    // ── Sens 1 : Obsidian → Vart (le vault comme source) ───────────────────
    async function obsidianCollectMarkdown(dir, out, maxFiles) {
        for await (const entry of dir.values()) {
            if (out.length >= maxFiles) return out;
            if (entry.kind === 'directory') {
                if (entry.name.startsWith('.')) continue; // .obsidian, .trash…
                await obsidianCollectMarkdown(entry, out, maxFiles);
            } else if (/\.md$/i.test(entry.name)) {
                try {
                    const f = await entry.getFile();
                    out.push({ name: entry.name, text: await f.text() });
                } catch (e) { /* note illisible : on l'ignore */ }
            }
        }
        return out;
    }

    // Indexe le vault (toutes les notes .md, récursivement, 300 max) comme
    // UNE source du persona — la recherche sémantique la découpe ensuite.
    async function obsidianImportVaultAsSource() {
        if (!editingPersonaId) return;
        setStatus('Lecture du vault Obsidian…');
        const root = await obsidianDir([], false);
        if (!root) { setStatus(''); customAlert('Aucun vault connecté (ou autorisation refusée). Connectez-le dans Configuration → Obsidian.', { title: 'Vault indisponible', icon: 'folder' }); return; }
        const notes = await obsidianCollectMarkdown(root, [], 300);
        setStatus('');
        if (!notes.length) { customAlert('Aucune note Markdown trouvée dans ce dossier.', { icon: 'x-circle' }); return; }
        const text = notes.map(n => `# ${n.name}\n\n${n.text}`).join('\n\n---\n\n');
        await addSourceText('obsidian', `Vault Obsidian (${notes.length} notes)`, text);
    }


    //  ICÔNES SVG — dictionnaire centralisé, style Lucide
    //  Usage statique  : <span class="icon" data-icon="search"></span>
    //                    → hydraté automatiquement au DOMContentLoaded
    //  Usage dynamique : ICON_SVG.search  (chaîne SVG prête à injecter)
