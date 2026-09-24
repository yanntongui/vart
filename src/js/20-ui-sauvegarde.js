    const backupModal = document.getElementById('backupModal');

    // Horodatage LOCAL sûr pour un nom de fichier (pas de « : » interdit) :
    // « AAAA-MM-JJ_HHhMM ». Utilisé pour les noms d'export (sauvegarde, persona).
    function exportTimestamp() {
        const d = new Date();
        const p = n => String(n).padStart(2, '0');
        return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}h${p(d.getMinutes())}`;
    }

    document.getElementById('backupBtn').addEventListener('click', () => {
        backupModal.classList.add('active');
    });
    document.getElementById('closeBackupBtn').addEventListener('click', () => {
        backupModal.classList.remove('active');
    });

    // Le fichier de sauvegarde doit rester autonome : les vignettes vivent en
    // base (IndexedDB), donc on les réintègre en base64 dans l'export. Les
    // objets viennent d'un JSON.parse frais, les modifier n'écrit rien.
    // `missing` compte les images introuvables en base : elles ne peuvent pas
    // partir dans le fichier, et l'utilisateur doit le savoir.
    async function conversationsForExport() {
        const list = getConversations();
        let missing = 0;
        for (const c of list) {
            for (const m of (c.messages || [])) {
                if (!m.imageId || m.image) continue;
                const blob = await visionImageBlob(m.imageId);
                const url = blob ? await blobToDataUrl(blob) : null;
                if (url && isSafeImageDataUrl(url)) { m.image = url; delete m.imageId; }
                else { delete m.imageId; missing++; }
            }
        }
        list.missingImages = missing;
        return list;
    }

    document.getElementById('backupExportBtn').addEventListener('click', async () => {
        const exportConversations = await conversationsForExport();
        const missingImages = exportConversations.missingImages || 0;
        const data = {
            version: 2,
            exportDate: new Date().toISOString(),
            theme: getTheme(),
            personas: getPersonas(),
            activePersonaId: getActiveId(),
            userInfo: getUserInfo(),
            stats: getStats(),
            sidebarCollapsed: localStorage.getItem('vart_sidebarCollapsed') === 'true',
            // ── Données ajoutées en v2 ──
            conversations: exportConversations,
            convLayout: getConversationLayout(),
            budgetLimit: getBudgetLimit(),
            avatarBgColor: localStorage.getItem('vart_avatarBgColor'),
            avatarTopColor: localStorage.getItem('vart_avatarTopColor'),
            realtimeModel: localStorage.getItem('vart_realtimeModel'),
            analysisModel: localStorage.getItem('vart_analysisModel'),
            titleModel: localStorage.getItem('vart_titleModel'),
            translateModel: localStorage.getItem('vart_translateModel'),
            transcribeModel: localStorage.getItem('vart_transcribeModel'),
            transcribeLangBase: localStorage.getItem('vart_transcribeLangBase'),
            transcribeLangs: (() => {
                const out = {};
                for (let i = 0; i < localStorage.length; i++) {
                    const k = localStorage.key(i);
                    if (k && k.startsWith('vart_transcribeLang_')) out[k.slice('vart_transcribeLang_'.length)] = localStorage.getItem(k);
                }
                return out;
            })(),
            translateLangs: (() => {
                const out = {};
                for (let i = 0; i < localStorage.length; i++) {
                    const k = localStorage.key(i);
                    if (k && k.startsWith('vart_translateLang_')) out[k.slice('vart_translateLang_'.length)] = localStorage.getItem(k);
                }
                return out;
            })()
        };
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `Vart-Sauvegarde-${exportTimestamp()}.json`;
        a.click();
        URL.revokeObjectURL(url);
        if (missingImages > 0) {
            customAlert(`${missingImages} image(s) de l'historique étaient illisibles dans la base du navigateur et n'ont pas pu être incluses dans la sauvegarde.`, { title: 'Sauvegarde incomplète', icon: 'x-circle' });
        }
    });

    document.getElementById('backupImportInput').addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = async (ev) => {
            try {
                const data = JSON.parse(ev.target.result);
                // Garde de TYPE (pas juste truthy) : un `personas` non-tableau
                // (ex. {}) serait écrit puis casserait getPersonas().find(...) au
                // rechargement — corruption persistée.
                if (!data.version || !Array.isArray(data.personas)) {
                    customAlert('Fichier de sauvegarde invalide.', { title: 'Erreur', icon: 'x-circle' });
                    return;
                }
                if (!await customConfirm('Cela remplacera toutes vos données actuelles (personas, historique des conversations, infos, statistiques et réglages). Votre clé API ne sera pas affectée.', { title: 'Restaurer une sauvegarde ?', icon: 'folder-open', confirmLabel: 'Restaurer', danger: true })) return;

                // Préparation AVANT toute écriture : les images de l'historique
                // partent en base, pour que la liste à enregistrer tienne dans
                // localStorage. Un échec ici n'a encore rien modifié.
                const importedConversations = Array.isArray(data.conversations)
                    ? await visionOffloadImportedImages(data.conversations)
                    : null;
                let importWarning = '';

                if (data.theme) { setThemeStorage(data.theme); applyTheme(data.theme); }
                if (data.personas) savePersonas(data.personas);
                if (data.activePersonaId) setActiveId(data.activePersonaId);
                if (data.userInfo !== undefined) setUserInfo(data.userInfo);
                if (Array.isArray(data.stats)) localStorage.setItem('vart_stats', JSON.stringify(data.stats));
                if (data.sidebarCollapsed !== undefined) {
                    localStorage.setItem('vart_sidebarCollapsed', data.sidebarCollapsed);
                    setSidebarCollapsed(data.sidebarCollapsed);
                }
                syncSidebarToggleIcon(); // aligne l'icône de la poignée sur le mode courant (desktop/mobile)

                // ── Données ajoutées en v2 (absentes des anciennes sauvegardes → ignorées sans erreur) ──
                if (importedConversations) {
                    try {
                        saveConversations(importedConversations);
                    } catch (quotaErr) {
                        // Toujours trop lourd (base indisponible, images restées
                        // en ligne) : on sacrifie ces images, puis au besoin les
                        // plus vieilles discussions, et on le dit.
                        importedConversations.forEach(c => (c.messages || []).forEach(m => { delete m.image; }));
                        let kept = importedConversations.slice();
                        for (;;) {
                            try { saveConversations(kept); break; }
                            catch (e2) {
                                if (kept.length <= 1) { saveConversations([]); kept = []; break; }
                                kept = kept.slice(1);
                            }
                        }
                        importWarning = `La mémoire du navigateur est trop petite pour tout restaurer : ${importedConversations.length - kept.length} conversation(s) et les images non rangées ont été laissées de côté.`;
                    }
                }
                if (data.convLayout && ['classic', 'compact', 'bubbles'].includes(data.convLayout)) {
                    localStorage.setItem('vart_convLayout', data.convLayout);
                    applyConversationLayout(data.convLayout);
                }
                if (data.budgetLimit !== undefined) setBudgetLimit(data.budgetLimit);
                if (data.avatarBgColor) localStorage.setItem('vart_avatarBgColor', data.avatarBgColor);
                if (data.avatarTopColor) localStorage.setItem('vart_avatarTopColor', data.avatarTopColor);
                if (data.realtimeModel) localStorage.setItem('vart_realtimeModel', data.realtimeModel);
                if (data.analysisModel) localStorage.setItem('vart_analysisModel', data.analysisModel);
                if (data.titleModel) localStorage.setItem('vart_titleModel', data.titleModel);
                if (data.translateModel) localStorage.setItem('vart_translateModel', data.translateModel);
                if (data.transcribeModel) localStorage.setItem('vart_transcribeModel', data.transcribeModel);
                if (data.transcribeLangBase) localStorage.setItem('vart_transcribeLangBase', data.transcribeLangBase);
                if (data.transcribeLangs && typeof data.transcribeLangs === 'object') {
                    Object.entries(data.transcribeLangs).forEach(([k, v]) => { if (v) localStorage.setItem('vart_transcribeLang_' + k, v); });
                }
                if (data.translateLangs && typeof data.translateLangs === 'object') {
                    Object.entries(data.translateLangs).forEach(([k, v]) => { if (v) localStorage.setItem('vart_translateLang_' + k, v); });
                }

                // Sauvegarde issue d'une v1.7 : assainit les modèles obsolètes
                // (ex. « gpt-realtime-translate ») qui viennent d'être réécrits.
                migrateLegacyData();

                applyAvatarColors();
                renderPersonaList();
                const activeId = getActiveId();
                if (activeId && getPersonas().find(p => p.id === activeId)) {
                    selectPersona(activeId);
                } else {
                    showEmptyState();
                }

                backupModal.classList.remove('active');
                if (importWarning) customAlert(importWarning, { title: 'Import partiel', icon: 'x-circle' });
                else customAlert('Vos données ont été restaurées avec succès.', { title: 'Import réussi', icon: 'check' });
            } catch (err) {
                customAlert('Erreur lors de l\'import : ' + err.message, { title: 'Erreur', icon: 'x-circle' });
            }
        };
        reader.readAsText(file);
        e.target.value = '';
    });


