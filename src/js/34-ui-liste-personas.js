    let draggedPersonaId = null;

    // La sidebar affiche maintenant l'historique des discussions (au lieu des personas).
    // On garde le nom renderPersonaList pour ne pas casser les appels existants.
    function renderPersonaList() {
        const container = document.getElementById('personaList');
        const allConvs = getConversations().slice().sort((a, b) => {
            return new Date(b.startDate || b.date || 0) - new Date(a.startDate || a.date || 0);
        });
        const viewingId = getViewingConvId();

        // Filtre de recherche : nom du persona, résumé, 1re phrase, tous les messages.
        const searchInput = document.getElementById('convSearchInput');
        const q = (searchInput?.value || '').trim().toLowerCase();
        const conversations = !q ? allConvs : allConvs.filter(c => {
            if ((c.personaName || '').toLowerCase().includes(q)) return true;
            if ((c.summary || '').toLowerCase().includes(q)) return true;
            return (c.messages || []).some(m => (m.text || '').toLowerCase().includes(q));
        });

        container.innerHTML = '';

        if (conversations.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'sidebar-empty';
            empty.textContent = q
                ? `Aucune discussion ne correspond à « ${q} ».`
                : 'Aucune discussion enregistrée pour le moment.';
            container.appendChild(empty);
            return;
        }

        // Regroupement par période : Aujourd'hui / Hier / Cette semaine / Plus ancien.
        // On insère un en-tête de section quand on bascule de groupe (les
        // conversations sont déjà triées par date décroissante).
        const startOfToday = new Date(); startOfToday.setHours(0, 0, 0, 0);
        const startOfYesterday = new Date(startOfToday); startOfYesterday.setDate(startOfYesterday.getDate() - 1);
        const startOfWeek = new Date(startOfToday); startOfWeek.setDate(startOfWeek.getDate() - 7);
        const groupFor = (iso) => {
            const t = new Date(iso || 0).getTime();
            if (t >= startOfToday.getTime())     return 'today';
            if (t >= startOfYesterday.getTime()) return 'yesterday';
            if (t >= startOfWeek.getTime())      return 'week';
            return 'older';
        };
        const groupLabels = { today: 'Aujourd\'hui', yesterday: 'Hier', week: 'Cette semaine', older: 'Plus ancien' };
        let currentGroup = null;

        conversations.forEach(conv => {
            const g = groupFor(conv.startDate || conv.date);
            if (g !== currentGroup) {
                currentGroup = g;
                const header = document.createElement('div');
                header.className = 'conv-group-header';
                header.textContent = groupLabels[g];
                container.appendChild(header);
            }
            const el = document.createElement('div');
            el.className = 'persona-item' + (conv.id === viewingId ? ' active' : '');
            el.dataset.convId = conv.id;
            // Aperçu : résumé court (≤5 mots) si disponible ; sinon placeholder
            // « shimmer » pendant la génération ; sinon repli sur la 1re phrase.
            let preview;
            let previewIsLoading = false;
            if (conv.summary) {
                preview = conv.summary;
            } else if (conv.summarizing) {
                preview = 'Résumé en cours…';
                previewIsLoading = true;
            } else {
                const firstLine = (conv.messages || []).find(m => (m.text || '').trim())?.text || '';
                preview = firstLine.length > 50 ? firstLine.slice(0, 50).trim() + '…' : firstLine;
            }
            const dateLabel = formatConvDate(conv.startDate || conv.date);
            // Pour la silhouette, on remonte le genre depuis le persona réel
            // (il n'est pas stocké sur la conversation pour rester rétrocompatible).
            const linkedPersona = !conv.isTranscripteur && !conv.isTraducteur ? getPersonas().find(pp => pp.id === conv.personaId) : null;
            let avatar;
            if (conv.isTranscripteur) {
                avatar = `<div class="transcripteur-sidebar-icon">T</div>`;
            } else if (conv.isTraducteur) {
                avatar = `<div class="traducteur-sidebar-icon">${TRADUCTEUR_SVG}</div>`;
            } else {
                avatar = safeImgSrc(conv.personaImage)
                    ? `<img class="persona-item-avatar" src="${safeImgSrc(conv.personaImage)}">`
                    : `<div class="persona-item-placeholder">${silhouetteFor(linkedPersona?.gender)}</div>`;
            }
            el.innerHTML = `
                ${avatar}
                <div class="persona-item-info">
                    <div class="persona-item-name">${esc(conv.personaName || '-')}</div>
                    <div class="persona-item-desc${previewIsLoading ? ' is-loading' : ''}">${esc(preview || '-')}</div>
                    <div class="conv-item-date">${esc(dateLabel)}</div>
                </div>
                <button class="persona-item-delete" title="Supprimer">&times;</button>
            `;
            el.addEventListener('click', (e) => {
                if (e.target.closest('.persona-item-delete')) return;
                viewConversation(conv.id);
            });
            el.querySelector('.persona-item-delete').addEventListener('click', async (e) => {
                e.stopPropagation();
                if (!await customConfirm('Supprimer cette discussion ?', { title: 'Supprimer', icon: 'trash', confirmLabel: 'Supprimer', danger: true })) return;
                deleteConversation(conv.id);
                if (getViewingConvId() === conv.id) {
                    setViewingConvId('');
                    showEmptyState();
                }
                renderPersonaList();
            });
            container.appendChild(el);
        });
    }

    function formatConvDate(iso) {
        if (!iso) return '';
        const d = new Date(iso);
        if (isNaN(d.getTime())) return '';
        const now = new Date();
        const sameDay = d.toDateString() === now.toDateString();
        const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1);
        const isYesterday = d.toDateString() === yesterday.toDateString();
        const hh = d.getHours().toString().padStart(2, '0');
        const mm = d.getMinutes().toString().padStart(2, '0');
        if (sameDay) return `Aujourd'hui, ${hh}:${mm}`;
        if (isYesterday) return `Hier, ${hh}:${mm}`;
        return `${d.getDate().toString().padStart(2, '0')}/${(d.getMonth() + 1).toString().padStart(2, '0')}/${d.getFullYear()} ${hh}:${mm}`;
    }

    function esc(s) {
        const d = document.createElement('div');
        d.textContent = s;
        return d.innerHTML;
    }

    // Source d'image insérable dans du HTML : une image en base64 (JPEG, PNG,
    // WebP, GIF) ou une adresse https, rien d'autre. Les avatars viennent
    // parfois de fichiers partagés ou restaurés : un champ image piégé ne doit
    // pas pouvoir refermer l'attribut src et injecter du code (qui lirait les
    // clés API). esc() ne suffit pas ici, il n'échappe pas les guillemets.
    const SAFE_IMG_SRC = /^(?:data:image\/(?:jpeg|png|webp|gif);base64,[A-Za-z0-9+/=]+|https:\/\/[^\s"'<>`]+)$/;
    function safeImgSrc(u) { return (typeof u === 'string' && SAFE_IMG_SRC.test(u)) ? u : ''; }

    // Silhouettes utilisées quand un persona n'a pas d'image. Inline SVG : pas
    // de dépendance externe, héritent de `currentColor` (voir CSS de la carte).
    const SILHOUETTE_SVGS = {
        male: `<svg class="avatar-portrait" viewBox="0 0 625 749" fill="currentColor" aria-hidden="true"><path d="M256.203,19.654c32.985,-17.228 72.215,-25.09 108.732,-15.544c-13.455,6.342 -28.133,9.922 -41.16,17.179c9.975,1.815 20.175,1.194 30.172,2.632c28.448,3.58 57.361,11.066 80.91,28.082c8.895,6.031 16.741,13.877 21.713,23.489c-5.933,1.519 -11.948,2.779 -17.887,4.282c5.122,6.114 11.002,11.573 15.794,17.997c19.583,25.434 30.825,57.243 31.14,89.378c-3.465,0.507 -6.952,0.931 -10.417,1.373c-0.78,22.508 -6.337,44.804 -16.05,65.138c-3.315,6.75 -8.107,12.602 -12.42,18.716c6.765,-1.799 14.235,-3.139 20.82,0.13c9.938,3.842 14.302,15.104 14.618,25.058c0.112,13.91 -3.338,28.18 -11.43,39.671c-6.046,8.549 -13.823,15.823 -22.553,21.56c-3.795,2.664 -8.325,4.757 -10.613,9.023c-9.382,15.332 -19.139,30.469 -27.967,46.111c-0.652,9.546 -0.472,19.141 -0.75,28.704c1.665,20.805 4.17,42.158 -0.637,62.767c-3.593,15.413 -11.063,30.03 -22.163,41.423c-16.95,17.91 -35.13,34.665 -53.962,50.572c-7.531,5.835 -14.64,12.735 -23.745,16.035c-3.766,1.928 -6.953,-1.507 -9.616,-3.682c-24.206,-21.443 -48.25,-43.268 -69.206,-67.943c-19.418,-25.897 -21.576,-60.397 -17.555,-91.425c20.432,9.039 40.668,18.57 61.084,27.623c-11.508,-10.673 -24.093,-20.103 -35.585,-30.81c-7.846,-6.963 -16.329,-14.058 -19.86,-24.323c-6.587,-18.225 -12.226,-36.778 -18.225,-55.199c-3.89,-11.867 -11.703,-22.704 -11.638,-35.601c-0.752,-16.967 -3.776,-34.947 3.743,-50.917c0.964,-15.185 -2.06,-30.37 -1.03,-45.571c2.485,-16.379 7.977,-32.185 10.298,-48.597c-5.95,9.121 -9.873,19.354 -15.61,28.589c-3.515,-4.577 -5.362,-10.069 -7.585,-15.332c-2.746,6.603 -4.462,13.534 -6.865,20.253c-1.455,4.429 -3.612,8.76 -3.694,13.533c-1.439,42.532 -1.978,85.096 -3.367,127.628c-17.049,-8.843 -31.678,-24.306 -35.225,-43.692c-2.256,-12.521 -3.825,-27.821 5.786,-37.808c3.171,-3.858 8.386,-4.397 12.962,-5.296c-12.406,-14.548 -14.302,-34.113 -16.656,-52.306c-1.03,-7.159 -0.752,-14.434 -1.406,-21.625c-4.037,5.606 -5.034,12.52 -7.143,18.928c-5.966,-16.313 -7.404,-34.048 -6.783,-51.325c0.523,-12.832 4.495,-25.124 9.742,-36.729c-6.293,3.301 -9.922,9.529 -14.336,14.808c0.067,-25.466 14.99,-49.968 37.22,-62.195c-5.459,-3.416 -11.017,-6.669 -16.198,-10.461c14.956,-12.014 33.688,-18.912 52.682,-21.021c3.857,0.245 5.508,-3.58 7.649,-6.064c14.973,-19.86 38.446,-33.786 63.373,-35.764c-6.801,5.23 -12.816,11.54 -16.853,19.174c6.244,-2.976 11.606,-7.438 17.752,-10.626Z" style="fill-rule:nonzero;"/><path d="M420.938,503.488c37.394,23.355 76.267,44.182 115.019,65.19c14.895,8.542 30.473,15.982 44.678,25.672c11.752,7.98 20.82,19.523 26.415,32.528c10.852,25.62 14.835,53.49 17.063,81.03c0.344,12.127 0.682,40.92 0.682,40.92l-624.637,-0c0,-0 -0.028,-21.353 -0.158,-32.843c1.128,-24.667 3.988,-49.485 11.377,-73.132c3.988,-12.39 9.186,-24.653 17.408,-34.883c8.336,-10.41 19.696,-17.82 31.024,-24.585c24.551,-14.25 49.233,-28.297 74.177,-41.865c21.135,-11.925 42.76,-22.98 63.552,-35.512c-0.082,29.467 10.853,59.122 31.809,80.107c19.86,19.373 39.654,38.805 59.367,58.32c5.46,5.378 11.736,11.003 19.843,11.31c10.05,0.915 17.85,-6.795 24.376,-13.365c17.549,-18.39 35.219,-36.682 53.152,-54.697c22.2,-22.095 33.18,-53.333 34.853,-84.195Z" style="fill-rule:nonzero;"/></svg>`,
        female: `<svg class="avatar-portrait" viewBox="0 0 624 709" fill="currentColor" aria-hidden="true"><path d="M189.81,183.213c-8.287,7.6 -16.987,15.724 -20.662,26.692c-11.003,29.652 -9.046,62.294 -3.226,92.844c5.266,21.625 12.151,42.842 17.805,64.386c8.07,30.811 16.261,62.457 13.418,94.596c-1.403,16.687 -9.315,32.542 -21.578,43.935c-9.247,10.297 -20.872,17.895 -31.627,26.445c13.793,-3.87 27.105,-9.593 41.37,-11.738c8.993,-1.14 18.03,-3.742 25.665,-8.745c5.947,-9.217 8.04,-20.332 10.088,-30.96c2.955,-21.57 2.287,-43.425 3.51,-65.134c15.3,5.885 29.654,13.812 44.61,20.434c-11.903,-9.482 -24.458,-18.619 -33.495,-31.026c-8.123,-10.756 -13.891,-23.08 -18.308,-35.764c-3.022,-9.677 -11.002,-16.64 -14.842,-25.925c-11.018,-24.355 -14.971,-52.486 -8.386,-78.589c1.051,-14.826 -0.57,-29.848 1.965,-44.575c3.645,-21.528 12.848,-41.584 22.816,-60.823c-10.185,7.372 -19.613,15.741 -29.123,23.947Zm41.61,-174.36c19.028,-6.931 39.772,-11.344 59.955,-7.323c8.16,1.52 15.66,5.182 23.393,8.01c9.217,-1.815 18.029,-6.195 27.645,-6.048c18.322,0.147 36.105,6.554 51.877,15.561c28.118,15.528 50.378,40.047 66.48,67.573c25.515,43.381 39.803,92.86 45.165,142.714c4.05,42.875 -0.953,86.306 6.405,128.919c2.992,21.037 10.035,41.469 20.94,59.727c11.183,19.94 27.232,36.732 37.613,57.162c5.032,9.525 7.192,20.61 5.31,31.298c-6.346,-11.993 -14.843,-23.423 -26.596,-30.533c3.091,6.915 7.568,13.193 10.006,20.415c4.807,12.555 4.905,26.453 2.174,39.495c-1.702,7.83 -1.162,16.77 3.188,23.603c7.485,4.35 15.443,8.137 21.937,14.04c15.818,14.235 23.146,35.175 28.163,55.297c4.365,20.273 8.07,79.343 8.07,79.343l-623.145,-0c0,-0 1.223,-44.835 5.085,-66.87c4.148,-20.775 9.563,-42.3 22.853,-59.303c9.12,-11.902 23.144,-18.6 37.019,-23.325c18.436,-6.705 37.073,-12.862 55.531,-19.515c3.164,-22.965 0.637,-46.387 -5.761,-68.587c-6.27,11.767 -7.237,25.335 -8.264,38.377c-5.138,-16.575 -5.94,-34.62 -14.686,-49.95c-6.532,-11.752 -12.172,-24.195 -14.594,-37.514c-4.838,-26.023 -1.958,-52.699 2.467,-78.558c-11.865,17.653 -12.24,40.129 -12.03,60.659c-5.85,-10.053 -7.65,-21.772 -8.707,-33.166c-0.938,-15.282 -0.735,-30.648 0.847,-45.882c3.338,-38.903 10.575,-77.56 22.717,-114.698c18.031,-51.505 35.213,-105.38 71.498,-147.421c20.76,-23.996 47.73,-42.45 77.445,-53.5Z" style="fill-rule:nonzero;"/></svg>`
    };
    // Genre limité à homme/femme : tout genre inconnu, absent ou « neutral »
    // hérité d'une ancienne version retombe sur la silhouette masculine.
    function silhouetteFor(gender) {
        return SILHOUETTE_SVGS[gender] || SILHOUETTE_SVGS.male;
    }

    // Icône de transcription (document + lignes de texte) pour la carte Transcripteur.
    const TRANSCRIPTEUR_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><polyline points="14 3 14 9 20 9"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="14" y2="17"/></svg>`;

    // ── Affichage d'une discussion sauvegardée (lecture seule) ──
    // URL d'objet créées pour les vignettes de la discussion relue. Révoquées
    // dès qu'on change de discussion ou qu'on quitte la relecture.
