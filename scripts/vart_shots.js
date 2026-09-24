// Validation visuelle de la passe design « Apple » sur vart.html (file://).
// Captures : accueil sombre/clair, modale Configuration (matériau + materialize),
// dialogue customAlert (scrim + blur), et reduced-motion (non-régression).
const { chromium } = require('playwright');
const path = 'file:///Users/macuser/Desktop/DEV/Cline App/Vart/vart.html';
const OUT = '/tmp/vart-shots';
require('fs').mkdirSync(OUT, { recursive: true });

(async () => {
    const browser = await chromium.launch();

    // Thème sombre — accueil + modale + dialogue
    let ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    let page = await ctx.newPage();
    // Fausses clés pour sauter l'alerte « clé requise » au démarrage
    await page.addInitScript(() => {
        localStorage.setItem('vart_apiKey', 'sk-test-visuel');
        localStorage.setItem('vart_geminiKey', 'test');
    });
    await page.goto(path);
    await page.waitForTimeout(4200); // laisser passer le splash
    await page.screenshot({ path: `${OUT}/01-accueil-dark.png` });

    // Modale « Nouveau persona » : matériau translucide + animation materialize
    await page.evaluate(() => openNewPersonaChooser());
    await page.waitForTimeout(600); // fin de modalMaterialize (0.35s) + marge
    await page.screenshot({ path: `${OUT}/02-modale-chooser-dark.png` });
    await page.evaluate(() => closeNewPersonaChooser());
    await page.waitForTimeout(400);

    // Panneau Partager (valide la suppression du bouton bibliothèque)
    await page.evaluate(() => {
        document.getElementById('apiKeyModal').classList.add('active');
        document.querySelectorAll('.config-nav-item').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.config-panel').forEach(p => p.classList.remove('active'));
        const btn = document.querySelector('[data-config-tab="share"]');
        if (btn) btn.classList.add('active');
        document.getElementById('configPanelShare').classList.add('active');
    });
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${OUT}/02b-panel-partager-dark.png` });
    await page.evaluate(() => document.getElementById('apiKeyModal').classList.remove('active'));
    await page.waitForTimeout(400);

    // Dialogue customAlert (validation du nouveau dialog-overlay/dialog-box)
    await page.evaluate(() => { customAlert('Ceci est une alerte de test pour valider le matériau translucide et la courbe spring.', { title: 'Test visuel', icon: 'check' }); });
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${OUT}/03-dialogue-dark.png` });
    await page.keyboard.press('Enter');
    await ctx.close();

    // Thème clair — accueil + modale (vérifie --scrim clair + variables)
    ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    page = await ctx.newPage();
    await page.addInitScript(() => {
        localStorage.setItem('vart_apiKey', 'sk-test-visuel');
        localStorage.setItem('vart_theme', 'light');
    });
    await page.goto(path);
    await page.waitForTimeout(4200);
    await page.screenshot({ path: `${OUT}/04-accueil-light.png` });
    await page.evaluate(() => openNewPersonaChooser());
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${OUT}/05-modale-chooser-light.png` });
    await ctx.close();

    // Reduced motion : les animations d'entrée doivent être neutralisées
    ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce' });
    page = await ctx.newPage();
    await page.addInitScript(() => localStorage.setItem('vart_apiKey', 'sk-test-visuel'));
    await page.goto(path);
    await page.waitForTimeout(4200);
    await page.evaluate(() => { customAlert('Test reduced motion.', { title: 'Accessibilité' }); });
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${OUT}/06-dialogue-reduced-motion.png` });
    await ctx.close();

    await browser.close();
    console.log('CAPTURES OK dans ' + OUT);
})().catch(e => { console.error('ECHEC:', e.message); process.exit(1); });
