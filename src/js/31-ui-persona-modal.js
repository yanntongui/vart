    function openPersonaModal(persona = null) {
        editingPersonaId = persona ? persona.id : null;
        // Mémorise si on ouvre l'éditeur depuis l'accueil (aucune conversation active).
        personaModalFromHome = !document.body.classList.contains('in-conversation');
        document.getElementById('personaModalTitle').textContent =
            persona ? 'Modifier le persona' : 'Nouveau persona';

        document.getElementById('pName').value = persona ? persona.name : '';
        document.getElementById('pDescription').value = persona ? persona.description : '';

        // Modèle par persona
        const pModelSelect = document.getElementById('pModel');
        pModelSelect.value = persona ? (persona.model || '') : '';
        updateModelSelectDisabled(pModelSelect);

        // Voix (dynamique selon le modèle)
        updatePersonaVoiceList(persona ? persona.voice : null);

        document.getElementById('pReactivity').value = persona ? (persona.reactivity || 'balanced') : 'balanced';
        document.getElementById('pCreativity').value = persona ? (persona.creativity || 'balanced') : 'balanced';
        document.getElementById('pGreeting').value = persona ? (persona.greeting || 'persona') : 'persona';
        document.getElementById('pPersonaInfo').value = persona ? (persona.personaInfo || '') : '';

        // ── Phase 1 : posture, règles, budget, mémoire ──
        editingPosture = persona ? (persona.posture || '') : '';
        renderPostureCards();
        document.getElementById('pRulesList').innerHTML = '';
        (persona && Array.isArray(persona.rules) ? persona.rules : []).forEach(r => addRuleRow(r));
        document.getElementById('pBudgetLimit').value = persona && persona.budgetLimit ? persona.budgetLimit : '';
        // Sources (Phase 2) : formulaires repliés, liste rafraîchie.
        document.getElementById('sourceUrlRow').style.display = 'none';
        document.getElementById('sourceNoteRow').style.display = 'none';
        document.getElementById('sourceUrlInput').value = '';
        document.getElementById('sourceNoteInput').value = '';
        renderSourcesList();
        // Étude (Phase 3) : compteurs fiches / quiz / sujets / plan.
        renderStudySummary();
        // Mémoire : chargement asynchrone (IndexedDB). La signature de
        // fermeture est RECALCULÉE à l'arrivée : sinon le remplissage tardif
        // du champ serait pris pour une modification non sauvegardée.
        document.getElementById('pMemory').value = '';
        if (persona) {
            loadPersonaMemory(persona.id).then(text => {
                if (editingPersonaId === persona.id && personaModal.classList.contains('active')) {
                    document.getElementById('pMemory').value = text;
                    personaOpenSignature = personaFieldsSignature();
                }
            });
        }

        document.getElementById('pPrompt').value = persona ? persona.prompt : DEFAULT_PROMPT(document.getElementById('pName').value || 'Mon assistant');
        document.getElementById('imageHint').textContent = '';
        document.getElementById('promptHint').textContent = '';
        // Détails d'image = aide ponctuelle à la génération, non persistée : on
        // repart d'un champ vide à chaque ouverture.
        document.getElementById('pImageDetails').value = '';

        tempImage = persona ? persona.image : null;
        renderImagePreview();

        // Notifier les custom-selects (vart-select) que la valeur des <select>
        // a changé par assignation directe — le setter natif ne déclenche pas
        // d'événement 'change'. Sans ça, le bouton du custom select afficherait
        // la valeur précédente au lieu de la valeur restaurée.
        personaModal.querySelectorAll('select[data-vart-custom="1"]').forEach(s => {
            s.dispatchEvent(new Event('change', { bubbles: true }));
        });

        personaModal.classList.add('active');
        personaOpenSignature = personaFieldsSignature();
    }

    // Signature des champs éditables du persona (+ image) : sert à détecter des
    // modifications non enregistrées à la fermeture.
    let personaOpenSignature = '';
    function personaFieldsSignature() {
        const ids = ['pName', 'pDescription', 'pModel', 'pVoice', 'pReactivity', 'pCreativity', 'pGreeting', 'pPersonaInfo', 'pPrompt', 'pBudgetLimit', 'pMemory'];
        return ids.map(id => (document.getElementById(id)?.value ?? '')).join('') + '' + (tempImage || '') + '' + editingPosture + '' + rulesSignature();
    }

    function closePersonaModal() { personaModal.classList.remove('active'); }

    // Fermeture demandée (Annuler / croix) : si des champs ont changé sans
    // sauvegarde, on propose Sauvegarder / Quitter sans sauvegarder / Continuer.
    async function requestClosePersonaModal() {
        if (personaFieldsSignature() !== personaOpenSignature) {
            const choice = await confirmUnsavedChanges();
            if (choice === 'cancel') return;
            if (choice === 'save') { document.getElementById('savePersonaBtn').click(); return; }
            // 'discard' → on ferme sans sauvegarder
        }
        closePersonaModal();
    }

    // Met à jour les DEUX aperçus (miniature de l'en-tête + grand aperçu dans
    // la popup image) depuis `tempImage`. Sans échange d'id : on repeuple juste
    // le contenu de chaque conteneur `.persona-avatar-preview`.
    function renderImagePreview() {
        ['pImagePreview', 'pImagePreviewPopup'].forEach(id => {
            const el = document.getElementById(id);
            if (!el) return;
            // Conserve la classe de taille (-lg) propre à chaque aperçu.
            const isLarge = el.classList.contains('persona-avatar-preview-lg');
            el.className = 'persona-avatar-preview' + (isLarge ? ' persona-avatar-preview-lg' : '');
            if (safeImgSrc(tempImage)) {
                el.innerHTML = `<img src="${safeImgSrc(tempImage)}" alt="">`;
            } else {
                el.classList.add('is-empty');
                el.textContent = 'Pas d\'image';
            }
        });
        // Texte de survol de la miniature : « Ajouter » si vide, « Modifier » sinon.
        const editText = document.getElementById('editImageText');
        if (editText) editText.textContent = tempImage ? 'Modifier l\'image' : 'Ajouter l\'image';
    }

    // « Accueil » : revient à la page d'accueil pour choisir un persona.
    document.getElementById('newPersonaBtn').addEventListener('click', () => showEmptyState());
    document.querySelector('.logo').addEventListener('click', () => showEmptyState());
    document.getElementById('cancelPersonaBtn').addEventListener('click', requestClosePersonaModal);
    document.getElementById('closePersonaBtn').addEventListener('click', requestClosePersonaModal);

    // Popup « Image du persona » (par-dessus l'éditeur). Les changements
    // (générer / importer / supprimer) modifient `tempImage` en direct ; on
    // mémorise l'état à l'ouverture pour pouvoir l'ANNULER.
    // Couleurs d'avatar : préférences globales mémorisées (mêmes couleurs pour
    // tous les personas = collection cohérente), modifiables à chaque génération.
