    const ICON_SVG = (() => {
        const SVG = (paths, sw = '1.7') =>
            `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" width="1em" height="1em" aria-hidden="true">${paths}</svg>`;
        return {
            'search':       SVG('<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>'),
            'settings':     SVG('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h.01a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.01a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>'),
            'save':         SVG('<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/>'),
            'chevron-left': SVG('<polyline points="15 18 9 12 15 6"/>', '2'),
            'chevron-right':SVG('<polyline points="9 18 15 12 9 6"/>', '2'),
            'chevron-down': SVG('<polyline points="6 9 12 15 18 9"/>', '2'),
            'pencil':       SVG('<path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>'),
            'check':        SVG('<polyline points="20 6 9 17 4 12"/>', '2'),
            'x':            SVG('<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>', '2'),
            'x-circle':     SVG('<circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>', '2'),
            'moon':         SVG('<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>'),
            'sun':          SVG('<circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>'),
            'copy':         SVG('<rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>'),
            'pause':        SVG('<rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/>'),
            'mic':          SVG('<rect x="9" y="2" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0"/><line x1="12" y1="18" x2="12" y2="22"/><line x1="8" y1="22" x2="16" y2="22"/>'),
            'clipboard':    SVG('<path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1" ry="1"/>'),
            'file-text':    SVG('<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/>'),
            'key':          SVG('<path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/>'),
            'wallet':       SVG('<path d="M21 12V7H5a2 2 0 0 1 0-4h14v4"/><path d="M3 5v14a2 2 0 0 0 2 2h16v-5"/><path d="M18 12a2 2 0 0 0 0 4h4v-4Z"/>'),
            'user':         SVG('<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>'),
            'bar-chart':    SVG('<line x1="12" y1="20" x2="12" y2="10"/><line x1="18" y1="20" x2="18" y2="4"/><line x1="6" y1="20" x2="6" y2="16"/>'),
            'link':         SVG('<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>'),
            'globe':        SVG('<circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>'),
            'home':         SVG('<path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>'),
            'plus':         SVG('<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>', '2'),
            'folder':       SVG('<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>'),
            'folder-open':  SVG('<path d="M6 14l1.45-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.55 6a2 2 0 0 1-1.94 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.93a2 2 0 0 1 1.66.9l.82 1.2a2 2 0 0 0 1.66.9H18a2 2 0 0 1 2 2v2"/>'),
            'sparkles':     SVG('<path d="M12 3l1.9 4.6L18.5 9l-4.6 1.9L12 15.5l-1.9-4.6L5.5 9l4.6-1.4L12 3z"/><path d="M19 14l.7 1.7L21.5 16l-1.8.7L19 18l-.7-1.3L16.5 16l1.8-.3L19 14z"/><path d="M5 17l.7 1.7L7.5 19l-1.8.7L5 21l-.7-1.3L2.5 19l1.8-.3L5 17z"/>'),
            'zap':          SVG('<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>'),
            'alert':        SVG('<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>'),
            'arrow-up':     SVG('<line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/>', '2'),
            'arrow-down':   SVG('<line x1="12" y1="5" x2="12" y2="19"/><polyline points="19 12 12 19 5 12"/>', '2'),
            'message':      SVG('<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>'),
            'hourglass':    SVG('<path d="M5 22h14M5 2h14M17 22v-4.172a2 2 0 0 0-.586-1.414L12 12l-4.414 4.414A2 2 0 0 0 7 17.828V22M7 2v4.172a2 2 0 0 0 .586 1.414L12 12l4.414-4.414A2 2 0 0 0 17 6.172V2"/>'),
            'trash':        SVG('<polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>'),
            'mic-off':      SVG('<line x1="2" y1="2" x2="22" y2="22"/><path d="M18.89 13.23A7 7 0 0 0 19 12"/><path d="M5 12a7 7 0 0 0 10.86 5.86"/><path d="M9 9v3a3 3 0 0 0 5.12 2.12"/><path d="M15 9.34V4a3 3 0 0 0-5.94-.6"/><line x1="12" y1="19" x2="12" y2="22"/>'),
            'play':         SVG('<polygon points="5 3 19 12 5 21 5 3"/>'),
            'file-code':    SVG('<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><polyline points="10 13 8 15 10 17"/><polyline points="14 13 16 15 14 17"/>'),
        };
    })();

    // Hydrate tous les éléments [data-icon] non encore traités. Appelée au
    // DOMContentLoaded et à chaque fois qu'on insère du HTML dynamiquement
    // qui contient des [data-icon].
    function hydrateIcons(root) {
        (root || document).querySelectorAll('[data-icon]').forEach(el => {
            if (el.firstElementChild && el.firstElementChild.tagName === 'svg') return;
            const svg = ICON_SVG[el.dataset.icon];
            if (svg) el.innerHTML = svg;
        });
    }
    document.addEventListener('DOMContentLoaded', () => hydrateIcons());


    // Construit un dialogue custom sans jamais injecter de texte utilisateur en
    // HTML. Les libellés (message, titre, boutons) passent par textContent, seule
    // l'icône SVG (dictionnaire interne contrôlé) est mise via innerHTML.
    function buildDialog({ title, message, icon, buttons }) {
        const overlay = document.createElement('div');
        overlay.className = 'dialog-overlay';
        const box = document.createElement('div');
        box.className = 'dialog-box';
        const iconWrap = document.createElement('div');
        iconWrap.className = 'dialog-icon';
        iconWrap.innerHTML = ICON_SVG[icon] || ICON_SVG.message;
        box.appendChild(iconWrap);
        if (title) {
            const t = document.createElement('div');
            t.className = 'dialog-title';
            t.textContent = title;
            box.appendChild(t);
        }
        const msg = document.createElement('div');
        msg.className = 'dialog-message';
        msg.textContent = message;
        box.appendChild(msg);
        const btnRow = document.createElement('div');
        btnRow.className = 'dialog-buttons';
        const btnEls = buttons.map(b => {
            const el = document.createElement('button');
            el.type = 'button';
            el.className = 'dialog-btn' + (b.className ? ' ' + b.className : '');
            if (b.action) el.dataset.action = b.action;
            el.textContent = b.label;
            btnRow.appendChild(el);
            return el;
        });
        box.appendChild(btnRow);
        overlay.appendChild(box);
        return { overlay, buttons: btnEls };
    }

    function customAlert(message, { title = '', icon = 'message', btnLabel = 'OK' } = {}) {
        return new Promise(resolve => {
            const { overlay, buttons } = buildDialog({
                title, message, icon,
                buttons: [{ label: btnLabel, className: 'dialog-btn-primary' }]
            });
            document.body.appendChild(overlay);
            const close = () => { overlay.remove(); resolve(); };
            buttons[0].addEventListener('click', close);
            overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
            buttons[0].focus();
        });
    }

    function customConfirm(message, { title = '', icon = 'alert', confirmLabel = 'Confirmer', cancelLabel = 'Annuler', danger = false } = {}) {
        return new Promise(resolve => {
            const btnClass = danger ? 'dialog-btn-danger' : 'dialog-btn-primary';
            const { overlay, buttons } = buildDialog({
                title, message, icon,
                buttons: [
                    { label: cancelLabel, action: 'cancel' },
                    { label: confirmLabel, action: 'confirm', className: btnClass }
                ]
            });
            document.body.appendChild(overlay);
            const close = (result) => { overlay.remove(); resolve(result); };
            buttons[0].addEventListener('click', () => close(false));
            buttons[1].addEventListener('click', () => close(true));
            overlay.addEventListener('click', (e) => { if (e.target === overlay) close(false); });
            buttons[1].focus();
        });
    }

    // Dialogue « modifications non enregistrées » : 3 choix →
    // 'save' | 'discard' | 'cancel'. Utilisé à la fermeture des popups
    // Configuration et Éditeur de persona quand des champs ont changé.
    function confirmUnsavedChanges() {
        return new Promise(resolve => {
            const { overlay, buttons } = buildDialog({
                title: 'Modifications non enregistrées',
                message: 'Vous avez des modifications non sauvegardées. Voulez-vous les enregistrer avant de fermer ?',
                icon: 'alert',
                buttons: [
                    { label: 'Sauvegarder', action: 'save', className: 'dialog-btn-primary' },
                    { label: 'Quitter sans sauvegarder', action: 'discard', className: 'dialog-btn-danger' },
                    { label: 'Continuer l\'édition', action: 'cancel' }
                ]
            });
            overlay.querySelector('.dialog-buttons').classList.add('dlg-stack');
            document.body.appendChild(overlay);
            const close = (r) => { overlay.remove(); resolve(r); };
            buttons[0].addEventListener('click', () => close('save'));
            buttons[1].addEventListener('click', () => close('discard'));
            buttons[2].addEventListener('click', () => close('cancel'));
            // Clic hors du dialogue = annulation (on ne perd rien).
            overlay.addEventListener('click', (e) => { if (e.target === overlay) close('cancel'); });
            buttons[0].focus();
        });
    }


    const DEFAULT_PROMPT = (name) => `# Identité
Tu es ${name || 'un assistant vocal'}, un assistant vocal amical et bienveillant.

# Personnalité
- Ton : chaleureux, naturel, décontracté
- Humour : tu aimes bien glisser une petite touche d'humour quand c'est approprié
- Style : conversationnel, comme un ami qui discute
- Énergie : modérée, ni trop calme ni trop enthousiaste
- Expressivité vocale : utilise des intonations variées, ris légèrement quand c'est drôle

# Langue
Tu parles en français. Tu utilises un langage courant, pas trop formel.
Tu peux utiliser des expressions familières et des interjections naturelles ("ah", "eh bien", "voyons voir...").

# Règles pour la conversation orale
- Sois concis : en conversation orale, les réponses longues sont pénibles. 2-3 phrases max sauf si on te demande un développement.
- Pas de listes à puces, pas de markdown, pas de formatage, tu PARLES, tu n'écris pas
- Utilise des phrases courtes et naturelles
- Ne répète pas la question qu'on te pose
- Si tu ne sais pas, dis-le simplement et propose de chercher
- Adapte ton rythme : parle un peu plus lentement pour les sujets complexes
- Utilise des transitions naturelles ("d'ailleurs", "au fait", "pour répondre à ta question")

# Outils disponibles
## Date et heure
- Tu as accès à un outil qui te donne la date et l'heure actuelles. Dès le début de la conversation, utilise-le discrètement pour te situer dans le temps, sans en parler.
- Utilise-le aussi quand on te pose une question liée au temps.

## Recherche web
- Tu as accès à un outil de recherche web. Utilise-le uniquement quand c'est vraiment utile : actualités, infos factuelles que tu ne connais pas.
- Quand tu lances une recherche, préviens brièvement l'utilisateur (ex: "je vais vérifier ça...")
- Intègre les résultats naturellement dans ta réponse orale, sans réciter les sources.

## Météo
- Tu peux consulter la météo d'un lieu. Utilise cet outil quand l'utilisateur te demande le temps qu'il fait ou qu'il va faire.`;

    // Montant affiché arrondi au CENTIME (au-delà, ça n'apporte rien) :
    // « $32 », « $0.20 », « $0.05 ». Les tarifs aux tokens s'affichent par
    // million (PRICING est stocké par 1K tokens).
