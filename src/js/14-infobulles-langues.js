    let vartTipEl = null;
    function hideVartTip() { if (vartTipEl) { vartTipEl.remove(); vartTipEl = null; } }
    function showVartTip(anchor, html) {
        hideVartTip();
        const tip = document.createElement('div');
        tip.className = 'vart-tip';
        tip.innerHTML = html;
        document.body.appendChild(tip);
        const r = anchor.getBoundingClientRect();
        const w = tip.offsetWidth, h = tip.offsetHeight;
        const x = Math.max(8, Math.min(r.left + r.width / 2 - w / 2, window.innerWidth - w - 8));
        let y = r.top - h - 10;
        if (y < 8) { y = r.bottom + 10; tip.classList.add('below'); }
        tip.style.left = `${x}px`;
        tip.style.top  = `${y}px`;
        vartTipEl = tip;
    }
    // Contenu : identifiant du modèle + tarif. Les modèles à la minute
    // affichent leur tarif ; ceux facturés aux tokens (Gemini Live Translate)
    // un équivalent minute approximatif (`approxPerMinute`).
    function costTipHtml(modelId, note) {
        const p = PRICING[modelId];
        let price;
        if (p && p.perMinute != null)            price = `≈ ${fmtUsd(p.perMinute)} / min`;
        else if (p && p.approxPerMinute != null) price = `≈ ${fmtUsd(p.approxPerMinute)} / min`;
        else if (p)                              price = fmtTokenRate(p);
        else                                     price = 'Tarif non renseigné';
        return `<span class="vart-tip-model">${esc(modelId)}</span><span class="vart-tip-price">${esc(price)}</span>`
             + (note ? `<span class="vart-tip-note">${esc(note)}</span>` : '');
    }
    function attachCostTip(el, modelId, note) {
        if (!el) return;
        el.addEventListener('mouseenter', () => showVartTip(el, costTipHtml(modelId, note)));
        el.addEventListener('mouseleave', hideVartTip);
        el.addEventListener('click', hideVartTip);
    }

    // Liste des langues du moteur donné (ou du moteur actif par défaut).
    function translateLangsFor(engine) {
        return (engine || getTranslateModel()) === 'gemini' ? TRANSLATE_LANGS_GEMINI : TRANSLATE_LANGS_OPENAI;
    }
    // Langue cible mémorisée PAR MOTEUR (les codes diffèrent : ex. « zh » côté
    // OpenAI vs « zh-Hans » côté Gemini). Valide contre la liste du moteur.
    function getTranslateLang(engine) {
        engine = engine || getTranslateModel();
        const list = translateLangsFor(engine);
        const stored = localStorage.getItem('vart_translateLang_' + engine);
        if (stored && list.some(l => l.code === stored)) return stored;
        return list.some(l => l.code === 'en') ? 'en' : list[0].code;
    }
    function setTranslateLang(code, engine) {
        engine = engine || getTranslateModel();
        localStorage.setItem('vart_translateLang_' + engine, code);
    }
    function translateLangInfo(code, engine) {
        const list = translateLangsFor(engine);
        return list.find(l => l.code === code) || list[0];
    }

    function getProviderForModel(model) {
        if (model && model.startsWith('gemini')) return 'gemini';
        if (model && model.startsWith('grok'))   return 'xai';
        return 'openai';
    }
    // GPT Live (gpt-live-*) : même clé OpenAI que Realtime, mais API « Live »
    // distincte (WebRTC, full duplex, voix propres) — cf. connectOpenAILive.
    function isLiveModel(model) { return !!model && model.startsWith('gpt-live'); }
    // Modèles mis en avant (nom en gras dans les sélecteurs) : les nouveautés
    // + Grok, pour qu'ils ressortent dans une liste qui s'allonge.
    const FEATURED_MODELS = new Set(['gpt-live-1', 'gemini-3.8-live', 'gemini-3.8-live-extended-thinking', 'grok-voice-think-fast-2.0']);
    // Famille de voix d'un modèle : les voix GPT Live ne sont pas celles de
    // Realtime, d'où une famille « live » à part (clé de VOICES).
    function getVoiceFamilyForModel(model) {
        return isLiveModel(model) ? 'live' : getProviderForModel(model);
    }
    // Gemini 3.8 Live Extended Thinking : seul modèle Live qui EXIGE un
    // thinkingConfig au setup (le 3.8 Live de base le refuse).
    function isGeminiThinkingModel(model) { return !!model && model.startsWith('gemini') && model.includes('thinking'); }
    // Niveau de réflexion : low | medium | high (« minimal » n'existe pas sur ce
    // modèle). « medium » = compromis latence / profondeur pour la voix.
    const GEMINI_LIVE_THINKING_LEVEL = 'medium';
    // Coût des tokens du modèle « backend » d'un modèle facturé à la minute
    // (GPT Live délègue son raisonnement à gpt-5.6-luna, facturé aux tokens,
    // en plus de la minute vocale). 0 pour tous les autres modèles.
    function backendTokenCost(modelId, inTokens, outTokens) {
        const p = PRICING[modelId];
        const bp = p && p.backendModel && PRICING[p.backendModel];
        if (!bp) return 0;
        return ((inTokens || 0) / 1000 * bp.input) + ((outTokens || 0) / 1000 * bp.output);
    }

