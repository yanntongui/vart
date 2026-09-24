    let helpTipEl = null;
    function showHelpTip(icon) {
        hideHelpTip();
        const tip = icon.getAttribute('data-tip');
        if (!tip) return;
        helpTipEl = document.createElement('div');
        helpTipEl.className = 'help-tip';
        helpTipEl.textContent = tip;
        document.body.appendChild(helpTipEl);
        const r = icon.getBoundingClientRect();
        const tw = helpTipEl.offsetWidth, th = helpTipEl.offsetHeight;
        let left = r.left + r.width / 2 - tw / 2;
        left = Math.max(8, Math.min(left, window.innerWidth - tw - 8));
        let top = r.bottom + 8;
        if (top + th > window.innerHeight - 8) top = r.top - th - 8; // bascule au-dessus si ça déborde
        helpTipEl.style.left = `${left}px`;
        helpTipEl.style.top = `${Math.max(8, top)}px`;
    }
    function hideHelpTip() { if (helpTipEl) { helpTipEl.remove(); helpTipEl = null; } }
    document.addEventListener('mouseover', (e) => {
        const ic = e.target.closest && e.target.closest('[data-tip]');
        if (ic) showHelpTip(ic);
    });
    document.addEventListener('mouseout', (e) => {
        const ic = e.target.closest && e.target.closest('[data-tip]');
        if (ic) hideHelpTip();
    });
    document.addEventListener('focusin', (e) => {
        const ic = e.target.closest && e.target.closest('[data-tip]');
        if (ic) showHelpTip(ic);
    });
    document.addEventListener('focusout', (e) => {
        const ic = e.target.closest && e.target.closest('[data-tip]');
        if (ic) hideHelpTip();
    });
    // La bulle est en coordonnées fixes : on la referme si la page défile.
    document.addEventListener('scroll', hideHelpTip, true);

    applyAvatarColors();
    renderPersonaList();
    // Précharge la mémoire du persona actif éventuel : l'utilisateur peut
    // rouvrir l'app et démarrer une session sans recliquer sur le persona
    // (loadPersonaMemory n'est appelé sinon qu'à la sélection).
    if (getPersonas().some(p => p.id === getActiveId())) loadPersonaMemory(getActiveId());
    showEmptyState({ animate: true });
    initSplash();
    // Nettoyage : le mode simulation a été retiré ; on purge l'ancienne clé éventuelle.
    localStorage.removeItem('vart_simulationMode');

    // Splash d'ouverture : clone le logo depuis la sidebar dans l'écran plein
    // écran, puis l'efface après une courte animation. Le clone crée
    // temporairement des IDs de dégradés en double, sans incidence (le splash
    // est retiré du DOM ensuite, et il masque la sidebar pendant ce temps).
