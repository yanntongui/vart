    let historyObjectUrls = [];
    let historyViewToken = 0; // change à chaque relecture ou sortie de relecture
    function releaseHistoryObjectUrls() {
        historyViewToken++;
        // Une visionneuse ouverte afficherait une URL révoquée, donc une image
        // cassée : on la ferme avant de libérer.
        closeImageLightbox();
        historyObjectUrls.forEach(u => { try { URL.revokeObjectURL(u); } catch (e) {} });
        historyObjectUrls = [];
    }

    function viewConversation(id) {
        const conv = getConversations().find(c => c.id === id);
        if (!conv) { showEmptyState(); return; }
        releaseHistoryObjectUrls();

        // Arrêter toute discussion en cours sans déclencher la sauvegarde
        stopConversation();

        // Sortir des modes transcripteur / traducteur si besoin
        restoreTranscripteurLayout();
        isTranscripteurMode = false;
        isTraducteurMode = false;
        document.body.classList.remove('transcripteur-active', 'traducteur-active');
        const convArea = document.getElementById('conversationArea');
        convArea.classList.remove('transcripteur-mode', 'is-running', 'mic-gated', 'session-ended');
        // La barre Copier/Exporter coiffe la transcription en relecture :
        // on la remet à sa place d'origine si une fin de session l'avait
        // déplacée dans .bottom-controls.
        restoreExportBar();

        setViewingConvId(id);
        setActiveId('');
        document.body.classList.add('in-conversation');
        renderPersonaList();

        document.getElementById('emptyState').style.display = 'none';
        convArea.style.display = 'flex';
        convArea.classList.add('viewing-history');
        playPageTransition(convArea);

        // Header — avatar + nom + date + modèle
        const avatarContainer = document.getElementById('personaHeaderAvatar');
        if (conv.isTranscripteur) {
            avatarContainer.innerHTML = '<div class="transcripteur-placeholder">T</div>';
        } else if (conv.isTraducteur) {
            avatarContainer.innerHTML = `<div class="traducteur-placeholder">${TRADUCTEUR_SVG}</div>`;
        } else if (safeImgSrc(conv.personaImage)) {
            avatarContainer.innerHTML = `<img src="${safeImgSrc(conv.personaImage)}">`;
        } else {
            const linked = getPersonas().find(pp => pp.id === conv.personaId);
            avatarContainer.innerHTML = `<div class="persona-header-placeholder">${silhouetteFor(linked?.gender)}</div>`;
        }
        document.getElementById('personaHeaderName').textContent = conv.personaName || '-';
        document.getElementById('personaHeaderModel').textContent = conv.model || '';
        document.getElementById('personaHeaderDesc').textContent = formatConvDate(conv.startDate || conv.date);
        // Barre de session en relecture d'historique : temps passé + coût figés.
        document.getElementById('sessionTimer').textContent = formatDuration(Math.max(0, conv.durationSeconds || 0));
        document.getElementById('sessionCost').textContent = fmtAmount(conversationCost(conv), true);
        // Bouton du bas : nommé d'après le persona (ou le mode) de la discussion relue.
        document.getElementById('historyNewConvBtn').textContent = conv.isTranscripteur
            ? 'Nouvelle transcription'
            : conv.isTraducteur ? 'Nouvelle traduction'
            : `Nouvelle conversation avec ${conv.personaName || 'ce persona'}`;

        // Reconstruit le contenu du #transcript depuis les messages sauvegardés
        const el = document.getElementById('transcript');
        el.innerHTML = '';
        if (!conv.messages || conv.messages.length === 0) {
            el.innerHTML = '<div class="transcript-empty">Aucun message dans cette discussion.</div>';
        } else {
            if (conv.isTranscripteur) {
                conv.messages.forEach(m => {
                    const p = document.createElement('p');
                    p.className = 'transcript-flowing-text';
                    p.textContent = m.text || '';
                    el.appendChild(p);
                });
            } else {
                conv.messages.forEach(m => {
                    const div = document.createElement('div');
                    div.className = `transcript-msg ${m.sender === 'user' ? 'user' : 'ai'}`;
                    const senderLabel = m.sender === 'user' ? 'Moi' : (conv.personaName || 'IA');
                    div.innerHTML = `<div class="sender">${esc(senderLabel)}</div><div class="text">${esc(m.text || '')}</div>`;
                    // Image envoyée pendant la discussion : on la remet sous le
                    // message. `src` est posé en JS, jamais interpolé dans le
                    // HTML, pour qu'une donnée d'import ne puisse rien injecter.
                    if (m.imageId || isSafeImageDataUrl(m.image)) {
                        const img = document.createElement('img');
                        img.className = 'vision-thumb';
                        img.alt = m.text || 'Image partagée';
                        makeThumbZoomable(img);
                        div.appendChild(Object.assign(document.createElement('span'), { className: 'vision-break' }));
                        div.appendChild(img);
                        if (m.image && !m.imageId) {
                            img.src = m.image; // ancien format, encore en ligne (type vérifié)
                        } else {
                            // Le blob vient de la base : lecture asynchrone,
                            // URL d'objet révoquée quand on quitte la relecture
                            // (sinon elle vit jusqu'au rechargement de l'onglet).
                            // Si l'utilisateur a changé de discussion entre-temps,
                            // l'URL est libérée aussitôt.
                            const token = historyViewToken;
                            visionImageBlob(m.imageId).then(blob => {
                                if (!blob) { img.remove(); return; }
                                // Type forcé : un blob n'est jamais servi autrement
                                // que comme image.
                                const safe = /^image\/(jpeg|png|webp)$/.test(blob.type) ? blob : new Blob([blob], { type: 'image/jpeg' });
                                const url = URL.createObjectURL(safe);
                                if (token !== historyViewToken) { URL.revokeObjectURL(url); return; }
                                historyObjectUrls.push(url);
                                img.src = url;
                            });
                        }
                    }
                    el.appendChild(div);
                });
            }
        }
    }

    // Complète les messages d'une conversation enregistrée pendant qu'une de
    // ses images était encore en cours d'écriture. Relit la liste au moment de
    // la mise à jour : le titre a pu arriver entre-temps.
    function patchPendingImages(convId, pending) {
        pending.forEach(({ index, stored }) => {
            stored.then(res => {
                if (!res) return;
                const conv = getConversations().find(c => c.id === convId);
                if (!conv || !conv.messages || !conv.messages[index]) return;
                const messages = conv.messages.slice();
                messages[index] = { ...messages[index], ...res };
                updateConversation(convId, { messages });
            }).catch(() => {});
        });
    }

    function exitViewingHistory() {
        releaseHistoryObjectUrls();
        setViewingConvId('');
        document.getElementById('conversationArea').classList.remove('viewing-history');
    }


    async function selectPersona(id) {
        // Arrêter toute conversation en cours
        stopConversation();
        exitViewingHistory();
        document.body.classList.add('in-conversation');

        // Quitter les modes transcripteur / traducteur si actifs.
        isTranscripteurMode = false;
        isTraducteurMode = false;
        document.body.classList.remove('transcripteur-active', 'traducteur-active');
        document.getElementById('conversationArea').classList.remove('transcripteur-mode');
        document.getElementById('startBtn').textContent = 'Démarrer la conversation';
        updateOrbCenterBtn('idle');  // resynchronise le libellé du bouton principal

        setActiveId(id);
        renderPersonaList();
        // Charge la mémoire long terme du persona (IndexedDB → cache synchrone)
        // pour qu'elle soit prête au moment de construire le prompt de session.
        loadPersonaMemory(id);

        const p = getPersonas().find(x => x.id === id);
        if (!p) { showEmptyState(); return; }

        document.getElementById('emptyState').style.display = 'none';

        // Préparer le contenu de la page DANS le DOM (encore caché). Comme ça,
        // dès que le sas micro disparaît, l'utilisateur voit une page prête.
        document.getElementById('editPersonaBtn').style.display = '';
        document.getElementById('duplicatePersonaBtn').style.display = '';
        document.getElementById('personaHeader').style.display = '';
        const avatarContainer = document.getElementById('personaHeaderAvatar');
        if (safeImgSrc(p.image)) {
            avatarContainer.innerHTML = `<img src="${safeImgSrc(p.image)}">`;
        } else {
            avatarContainer.innerHTML = `<div class="persona-header-placeholder">${silhouetteFor(p.gender)}</div>`;
        }
        document.getElementById('personaHeaderName').textContent = p.name;
        document.getElementById('personaHeaderDesc').textContent = p.description || '';
        resetTranscript();
        totalInputTokens = 0;
        totalOutputTokens = 0;
        resetSessionCosts();
        updateTokenCounter();

        // Sas micro : si la permission n'est pas déjà accordée, on affiche le sas
        // par-dessus la page (déjà peuplée). À la validation, on révèle la page.
        const ok = await ensureMicReady();
        if (!ok) return;
        const convArea = document.getElementById('conversationArea');
        convArea.style.display = 'flex';
        playPageTransition(convArea);
    }

