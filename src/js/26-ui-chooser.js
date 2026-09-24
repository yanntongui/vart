    // ── Modale "Nouveau persona" (2 cartes : Créer / Importer) ──
    function openNewPersonaChooser() {
        document.getElementById('newPersonaChooserModal').classList.add('active');
    }
    function closeNewPersonaChooser() {
        document.getElementById('newPersonaChooserModal').classList.remove('active');
    }
    document.getElementById('closeNewPersonaChooserBtn').addEventListener('click', closeNewPersonaChooser);
    document.querySelectorAll('#newPersonaChooserModal .chooser-card').forEach(card => {
        card.addEventListener('click', () => {
            const action = card.dataset.chooser;
            closeNewPersonaChooser();
            if (action === 'create') {
                openPersonaModal();
            } else if (action === 'import') {
                document.getElementById('importPersonaInput').click();
            }
        });
    });

    // ── Éditeur de posture et de règles par blocs (Phase 1) ────────────────
    // État local de l'éditeur (pas d'effet tant qu'on ne sauvegarde pas).
