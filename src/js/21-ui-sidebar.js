    const sidebarToggle = document.getElementById('sidebarToggle');
    const sidebarMobileMedia = window.matchMedia('(max-width: 900px)');
    const isSidebarMobile = () => sidebarMobileMedia.matches;

    // Fond d'obscurcissement du tiroir mobile (créé à la volée ; tap = fermer).
    const sidebarBackdrop = document.createElement('div');
    sidebarBackdrop.id = 'sidebarBackdrop';
    document.body.appendChild(sidebarBackdrop);
    sidebarBackdrop.addEventListener('click', () => setSidebarMobileOpen(false));

    // Desktop : repli de la colonne via .sidebar-collapsed (état mémorisé).
    function setSidebarCollapsed(collapsed) {
        document.body.classList.toggle('sidebar-collapsed', collapsed);
        sidebarToggle.innerHTML = collapsed ? ICON_SVG['chevron-right'] : ICON_SVG['chevron-left'];
        localStorage.setItem('vart_sidebarCollapsed', collapsed);
    }

    // Mobile/tablette (<900px) : la sidebar est masquée par défaut (media query)
    // et s'ouvre en superposition via .sidebar-mobile-open ; la poignée se
    // décale via .sidebar-open. Sans ça, le bouton ne pouvait pas ouvrir le
    // volet sur petit écran (il ne basculait que .sidebar-collapsed, sans effet
    // sous la media query).
    function setSidebarMobileOpen(open) {
        document.body.classList.toggle('sidebar-mobile-open', open);
        sidebarToggle.classList.toggle('sidebar-open', open);
        sidebarToggle.innerHTML = open ? ICON_SVG['chevron-left'] : ICON_SVG['chevron-right'];
    }

    // Icône de la poignée cohérente avec l'état courant selon le mode.
    function syncSidebarToggleIcon() {
        if (isSidebarMobile()) {
            const open = document.body.classList.contains('sidebar-mobile-open');
            sidebarToggle.innerHTML = open ? ICON_SVG['chevron-left'] : ICON_SVG['chevron-right'];
        } else {
            const collapsed = document.body.classList.contains('sidebar-collapsed');
            sidebarToggle.innerHTML = collapsed ? ICON_SVG['chevron-right'] : ICON_SVG['chevron-left'];
        }
    }

    sidebarToggle.addEventListener('click', () => {
        if (isSidebarMobile()) {
            setSidebarMobileOpen(!document.body.classList.contains('sidebar-mobile-open'));
        } else {
            setSidebarCollapsed(!document.body.classList.contains('sidebar-collapsed'));
        }
    });

    // Sur mobile, refermer le volet après avoir choisi un persona / une
    // discussion / « Nouvelle discussion », pour révéler la conversation.
    document.getElementById('sidebar').addEventListener('click', (e) => {
        if (!isSidebarMobile()) return;
        if (e.target.closest('.persona-item-delete')) return;
        if (e.target.closest('.persona-item') || e.target.closest('#newPersonaBtn')) {
            setSidebarMobileOpen(false);
        }
    });

    // Restaurer l'état de repli (desktop ; sans effet visible sous la media query).
    if (localStorage.getItem('vart_sidebarCollapsed') === 'true') {
        setSidebarCollapsed(true);
    }

    // Au franchissement du seuil responsive, remettre un état cohérent pour
    // éviter qu'un volet reste bloqué dans le mode précédent.
    sidebarMobileMedia.addEventListener('change', () => {
        document.body.classList.remove('sidebar-mobile-open');
        sidebarToggle.classList.remove('sidebar-open');
        syncSidebarToggleIcon();
    });

    // Icône initiale correcte selon le mode au chargement.
    syncSidebarToggleIcon();


