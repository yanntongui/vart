    // ── Panneau Configuration → Obsidian (Phase 3) ────────────────────────
    async function refreshObsidianPanel() {
        const statusEl = document.getElementById('obsidianStatus');
        const hintEl = document.getElementById('obsidianBrowserHint');
        if (!statusEl) return;
        document.getElementById('obsidianOptSessions').checked = obsidianOption('sessions');
        document.getElementById('obsidianOptCards').checked = obsidianOption('cards');
        document.getElementById('obsidianOptMemory').checked = obsidianOption('memory');
        document.getElementById('obsidianConnectBtn').disabled = !OBSIDIAN_SUPPORTED;
        hintEl.textContent = OBSIDIAN_SUPPORTED
            ? 'Astuce : Vart crée les dossiers Vart/Sessions, Vart/Fiches, Vart/Personas et Vart/Plans dans votre vault.'
            : "L'API d'accès aux dossiers locaux n'existe pas dans ce navigateur (Chrome ou Edge requis). Les exports Markdown/CSV restent disponibles dans la fiche de chaque persona.";
        const h = await obsidianRestoreHandle();
        if (!h) { statusEl.textContent = 'Aucun vault connecté.'; return; }
        let perm = 'inconnue';
        try { perm = h.queryPermission ? await h.queryPermission({ mode: 'readwrite' }) : 'inconnue'; } catch (e) {}
        statusEl.textContent = `Vault connecté : « ${h.name} »${perm === 'granted' ? '' : ' — autorisation à reconfirmer au prochain accès'}.`;
    }
    document.getElementById('obsidianConnectBtn').addEventListener('click', async () => {
        const h = await obsidianConnect();
        if (h) setStatus(`Vault « ${h.name} » connecté`);
        refreshObsidianPanel();
    });
    document.getElementById('obsidianDisconnectBtn').addEventListener('click', async () => {
        if (!await customConfirm('Déconnecter le vault Obsidian ? Aucune donnée ne sera supprimée, ni dans Vart ni dans le vault.', { title: 'Déconnecter Obsidian', icon: 'folder', confirmLabel: 'Déconnecter' })) return;
        await obsidianDisconnect();
        setStatus('Vault Obsidian déconnecté');
        refreshObsidianPanel();
    });
    [['sessions', 'obsidianOptSessions'], ['cards', 'obsidianOptCards'], ['memory', 'obsidianOptMemory']].forEach(([name, id]) => {
        document.getElementById(id).addEventListener('change', (e) => setObsidianOption(name, e.target.checked));
    });

