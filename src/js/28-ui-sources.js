    // ── Sources du persona : liste + actions d'indexation (Phase 2) ────────
    // Les sources vivent en IndexedDB (store « sources »), identifiées par
    // l'ID du persona : elles n'existent donc qu'après le premier
    // enregistrement — actions désactivées tant que editingPersonaId est vide.
    const SOURCES_FILE_TYPES = /\.(pdf|txt|md|markdown|csv|json)$/i;

    async function renderSourcesList() {
        const listEl = document.getElementById('sourcesList');
        if (!listEl) return;
        const hasId = !!editingPersonaId;
        document.getElementById('sourcesEmptyHint').style.display = hasId ? 'none' : 'block';
        // Seuls les contrôles du bloc Sources sont concernés (le bloc Étude a
        // ses propres boutons, désactivés séparément).
        document.querySelectorAll('.persona-sources-box .sources-actions button, #addSourceUrlBtn, #addSourceNoteBtn').forEach(b => { b.disabled = !hasId; });
        listEl.innerHTML = '';
        if (!hasId) return;
        const all = (await vartDbRun('readonly', 'sources', st => st.getAll())) || [];
        const mine = all.filter(s => s.personaId === editingPersonaId);
        if (!mine.length) {
            listEl.innerHTML = '<div class="hint" style="font-size:0.75rem;color:var(--text-muted);margin-top:6px">Aucune source. Ajoutez un cours PDF, un article ou une note.</div>';
            return;
        }
        mine.forEach(s => {
            const row = document.createElement('div');
            row.className = 'source-row';
            const icon = s.type === 'url' ? '🔗' : s.type === 'note' ? '📝' : '📄';
            row.innerHTML = `
                <span aria-hidden="true">${icon}</span>
                <span class="source-name">${esc(s.name)}</span>
                <span class="source-meta">${s.chunks.length} extraits · ${s.embModel ? 'sémantique' : 'mots-clés'}</span>
                <button type="button" class="rule-delete" title="Supprimer cette source">&times;</button>`;
            row.querySelector('.rule-delete').addEventListener('click', async () => {
                if (!await customConfirm(`Supprimer la source « ${s.name} » ?`, { title: 'Supprimer la source', icon: 'trash', confirmLabel: 'Supprimer', danger: true })) return;
                await vartDbRun('readwrite', 'sources', st => st.delete(s.id));
                renderSourcesList();
            });
            listEl.appendChild(row);
        });
    }

    async function addSourceText(type, name, text) {
        if (!editingPersonaId) return;
        const persona = getPersonas().find(p => p.id === editingPersonaId);
        if (!persona) return;
        const ok = await indexPersonaSource(persona.id, persona.name, type, name, text);
        if (ok) renderSourcesList();
    }

    document.getElementById('addSourceFileBtn').addEventListener('click', () => {
        if (!editingPersonaId) return;
        document.getElementById('sourcesFileInput').click();
    });
    document.getElementById('sourcesFileInput').addEventListener('change', async (e) => {
        const files = [...(e.target.files || [])];
        e.target.value = '';
        for (const f of files) {
            if (!SOURCES_FILE_TYPES.test(f.name)) { customAlert(`Format non supporté : ${f.name} (attendu : PDF, TXT, MD, CSV, JSON)`, { icon: 'x-circle' }); continue; }
            try {
                setStatus(`Extraction de ${f.name}…`);
                const isPdf = /\.pdf$/i.test(f.name);
                const text = isPdf ? await extractPdfText(f) : await f.text();
                setStatus('');
                await addSourceText(isPdf ? 'pdf' : 'text', f.name, text);
            } catch (err) {
                setStatus('');
                customAlert(`Impossible de lire ${f.name} : ${err.message}`, { title: 'Échec', icon: 'x-circle' });
            }
        }
    });
    document.getElementById('addSourceUrlToggle').addEventListener('click', () => {
        const row = document.getElementById('sourceUrlRow');
        const show = row.style.display === 'none';
        row.style.display = show ? 'flex' : 'none';
        document.getElementById('sourceNoteRow').style.display = 'none';
        if (show) document.getElementById('sourceUrlInput').focus();
    });
    document.getElementById('addSourceNoteToggle').addEventListener('click', () => {
        const row = document.getElementById('sourceNoteRow');
        const show = row.style.display === 'none';
        row.style.display = show ? 'flex' : 'none';
        document.getElementById('sourceUrlRow').style.display = 'none';
        if (show) document.getElementById('sourceNoteInput').focus();
    });
    document.getElementById('addSourceUrlBtn').addEventListener('click', async () => {
        if (!editingPersonaId) return;
        const url = document.getElementById('sourceUrlInput').value.trim();
        if (!/^https?:\/\//i.test(url)) { customAlert('Entrez une URL complète commençant par https://', { icon: 'x-circle' }); return; }
        try {
            setStatus(`Récupération de ${url}…`);
            const text = await fetchUrlAsText(url);
            setStatus('');
            document.getElementById('sourceUrlInput').value = '';
            await addSourceText('url', new URL(url).hostname, text);
        } catch (err) {
            setStatus('');
            customAlert(`Impossible de récupérer ce site : ${err.message}.\n\n(Si le site bloque les requêtes croisées — erreur « CORS » — copiez-collez le contenu via le bouton Note.)`, { title: 'Échec de récupération', icon: 'globe' });
        }
    });
    document.getElementById('addSourceNoteBtn').addEventListener('click', async () => {
        if (!editingPersonaId) return;
        const ta = document.getElementById('sourceNoteInput');
        const text = ta.value.trim();
        if (!text) { customAlert('Le texte de la note est vide.', { icon: 'x-circle' }); return; }
        ta.value = '';
        await addSourceText('note', `Note du ${new Date().toLocaleDateString('fr-FR')}`, text);
    });

    // Vault Obsidian comme source (Phase 3) : toutes les notes .md du vault.
    document.getElementById('addSourceObsidianBtn').addEventListener('click', () => { obsidianImportVaultAsSource(); });

