    const IMAGE_STATS_LABEL = 'Avatars';
    function isImageStat(s) { return !!s && s.kind === 'image'; }
    // Stat = conversation (comptable en « Conv. ») : pas une image, pas une
    // opération d'embedding (Phase 2 — coûts attribués mais jamais comptés
    // comme des conversations).
    function isConvStat(s) { return !!s && s.kind !== 'image' && s.kind !== 'embedding'; }
    function recordImageGenerationCost(model, dollars) {
        if (!(dollars > 0)) return;
        addStat({
            kind: 'image',
            model,
            personaName: IMAGE_STATS_LABEL,
            date: new Date().toISOString(),
            inputTokens: 0,
            outputTokens: 0,
            durationSeconds: 0,
            costDollars: dollars
        });
        updateBudgetStatus();
    }

    function statCost(s) {
        // Frais hors tokens figés avec la session : transcription de la voix
        // (OpenAI) et recherches web.
        const transc = (s.transcriptionCost || 0) + (s.toolCost || 0);
        if (s.costDollars != null) return s.costDollars + transc;
        const p = PRICING[s.model] || PRICING['gpt-realtime-2.1-mini'];
        // Modèles facturés à la minute (translate, whisper) : le coût est
        // basé sur la durée. Fallback pour les anciennes stats qui n'ont
        // pas encore de `costDollars` figé.
        if (p.perMinute != null) return ((s.durationSeconds || 0) / 60) * p.perMinute + backendTokenCost(s.model, s.inputTokens, s.outputTokens) + transc;
        return ((s.inputTokens || 0) / 1000 * p.input) + ((s.outputTokens || 0) / 1000 * p.output) + transc;
    }

    // Coût total d'une conversation (tokens + transcription OpenAI, ou minute) —
    // « gelé » sur l'objet conversation pour l'afficher en fin de session et en
    // relecture, indépendamment des réglages ultérieurs.
    // Appelée en fin de session : les frais hors tokens (transcription de la
    // voix, recherches web) viennent des compteurs de la session qui s'achève.
    function computeConversationCost(modelId, inTokens, outTokens, activeDurationSec, isTr, isTl) {
        const extras = sessionTranscriptionDollars(modelId, isTr, isTl) + sessionToolCost;
        const cp = PRICING[modelId];
        if (cp && cp.perMinute != null) return (activeDurationSec / 60) * cp.perMinute + backendTokenCost(modelId, inTokens, outTokens) + extras;
        const p = cp || PRICING['gpt-realtime-2.1-mini'];
        return (inTokens / 1000 * p.input) + (outTokens / 1000 * p.output) + extras;
    }
    // Coût d'une conversation stockée (utilise le coût gelé, sinon recalcule).
    function conversationCost(conv) {
        return conv.costDollars != null ? conv.costDollars : statCost(conv);
    }

    function formatTokens(n) {
        if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
        if (n >= 1000) return (n / 1000).toFixed(1) + 'k';
        return n.toString();
    }

    const BAR_COLORS = ['#4fc3f7','#ef5350','#66bb6a','#ffb74d','#ab47bc','#26c6da','#ff7043','#9ccc65'];

    function renderStats(tab) {
        const stats = getStats();
        const now = new Date();
        const container = document.getElementById('statsContent');

        if (tab === 'periods') {
            // Périodes : Aujourd'hui, 7 jours, 30 jours, Total
            const periods = [
                { label: "Aujourd'hui", cutoff: new Date(now.getFullYear(), now.getMonth(), now.getDate()) },
                { label: '7 derniers jours', cutoff: new Date(now.getTime() - 7 * 86400000) },
                { label: '30 derniers jours', cutoff: new Date(now.getTime() - 30 * 86400000) },
                { label: 'Total', cutoff: new Date(0) }
            ];

            let html = `<table class="stats-table stats-periods"><thead><tr>
                <th>Période</th><th>Conv.</th><th>Tokens entrée</th><th>Tokens sortie</th><th>Coût</th>
            </tr></thead><tbody>`;

            periods.forEach((p, i) => {
                const filtered = stats.filter(s => new Date(s.date) >= p.cutoff);
                const convos = filtered.filter(isConvStat).length;
                const inp = filtered.reduce((s, x) => s + (x.inputTokens || 0), 0);
                const out = filtered.reduce((s, x) => s + (x.outputTokens || 0), 0);
                const cost = filtered.reduce((s, x) => s + statCost(x), 0);
                const cls = i === periods.length - 1 ? ' class="stats-total"' : '';
                html += `<tr${cls}><td>${p.label}</td><td>${convos}</td><td>${formatTokens(inp)}</td><td>${formatTokens(out)}</td><td>${fmtAmount(cost)}</td></tr>`;
            });

            html += `</tbody></table>`;

            // Graphiques par mois
            const byMonth = {};
            stats.forEach(s => {
                const d = new Date(s.date);
                const key = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
                if (!byMonth[key]) byMonth[key] = { cost: 0, count: 0 };
                byMonth[key].cost += statCost(s);
                if (isConvStat(s)) byMonth[key].count++;
            });

            const months = Object.keys(byMonth).sort().slice(-6);
            if (months.length > 0) {
                const maxCost = Math.max(...months.map(m => byMonth[m].cost), 0.01);
                const maxCount = Math.max(...months.map(m => byMonth[m].count), 1);
                const monthNames = ['janv.','févr.','mars','avr.','mai','juin','juil.','août','sept.','oct.','nov.','déc.'];

                html += `<div class="stats-charts"><div>`;
                html += `<div class="stats-chart-title">Coût par mois</div>`;
                months.forEach((m, i) => {
                    const [y, mo] = m.split('-');
                    const label = monthNames[parseInt(mo) - 1] + ' ' + y;
                    const pct = (byMonth[m].cost / maxCost * 100).toFixed(1);
                    html += `<div class="stats-bar-row">
                        <span class="stats-bar-label">${label}</span>
                        <div class="stats-bar-track"><div class="stats-bar-fill" style="width:${pct}%;background:${BAR_COLORS[i % BAR_COLORS.length]}"></div></div>
                        <span class="stats-bar-value">${fmtAmount(byMonth[m].cost)}</span>
                    </div>`;
                });
                html += `</div><div>`;
                html += `<div class="stats-chart-title">Conversations par mois</div>`;
                months.forEach((m, i) => {
                    const [y, mo] = m.split('-');
                    const label = monthNames[parseInt(mo) - 1] + ' ' + y;
                    const pct = (byMonth[m].count / maxCount * 100).toFixed(1);
                    html += `<div class="stats-bar-row">
                        <span class="stats-bar-label">${label}</span>
                        <div class="stats-bar-track"><div class="stats-bar-fill" style="width:${pct}%;background:${BAR_COLORS[i % BAR_COLORS.length]}"></div></div>
                        <span class="stats-bar-value">${byMonth[m].count}</span>
                    </div>`;
                });
                html += `</div></div>`;
            }

            container.innerHTML = html;

        } else if (tab === 'personas') {
            const byPersona = {};
            const personaCosts = {};
            // Coût du mois en cours par persona (Phase 1, budget niveau 2) :
            // calculé en parallèle du coût total, même clé de regroupement.
            const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
            const personaMonthCosts = {};
            // Les avatars ont une clé à part : un persona qui s'appellerait
            // « Avatars » ne doit pas fusionner avec leur ligne.
            const IMAGE_ROW_KEY = '\u0000images';
            stats.forEach(s => {
                const key = isImageStat(s) ? IMAGE_ROW_KEY : (s.personaName || s.personaId);
                if (!byPersona[key]) byPersona[key] = { input: 0, output: 0, duration: 0, count: 0 };
                byPersona[key].input += s.inputTokens || 0;
                byPersona[key].output += s.outputTokens || 0;
                byPersona[key].duration += s.durationSeconds || 0;
                // Les embeddings n'incrémentent pas le compteur (coût oui,
                // conversation non) ; les images, si (« n img. »).
                if (s.kind !== 'embedding') byPersona[key].count++;
                if (!personaCosts[key]) personaCosts[key] = 0;
                personaCosts[key] += statCost(s);
                if (new Date(s.date) >= monthStart) {
                    personaMonthCosts[key] = (personaMonthCosts[key] || 0) + statCost(s);
                }
            });

            if (Object.keys(byPersona).length === 0) {
                container.innerHTML = '<div style="text-align:center;padding:30px;color:var(--text-secondary)">Aucune conversation enregistrée.</div>';
                return;
            }

            let html = `<table class="stats-table"><thead><tr>
                <th>Persona</th><th>Conv.</th><th>Durée</th><th>Tokens</th><th>Coût total</th><th>Ce mois</th>
            </tr></thead><tbody>`;

            const entries = Object.entries(byPersona).sort((a, b) => b[1].count - a[1].count);
            let totalConvos = 0, totalDuration = 0, totalTokens = 0, totalCost = 0, totalMonth = 0;
            entries.forEach(([name, d]) => {
                const tokens = d.input + d.output;
                const cost = personaCosts[name] || 0;
                const monthCost = personaMonthCosts[name] || 0;
                totalCost += cost; totalMonth += monthCost;
                // Ligne des avatars : un nombre d'images, pas de conversations,
                // de durée ni de tokens — et hors des totaux correspondants.
                if (name === IMAGE_ROW_KEY) {
                    html += `<tr><td>${esc(IMAGE_STATS_LABEL)}</td><td>${d.count} img.</td><td>-</td><td>-</td><td>${fmtAmount(cost)}</td><td>${fmtAmount(monthCost)}</td></tr>`;
                    return;
                }
                totalConvos += d.count; totalDuration += d.duration; totalTokens += tokens;
                html += `<tr><td>${esc(name)}</td><td>${d.count}</td><td>${formatDuration(d.duration)}</td><td>${formatTokens(tokens)}</td><td>${fmtAmount(cost)}</td><td>${fmtAmount(monthCost)}</td></tr>`;
            });
            html += `</tbody><tfoot><tr class="stats-total"><td>Total</td><td>${totalConvos}</td><td>${formatDuration(totalDuration)}</td><td>${formatTokens(totalTokens)}</td><td>${fmtAmount(totalCost)}</td><td>${fmtAmount(totalMonth)}</td></tr></tfoot></table>`;
            container.innerHTML = html;

        } else if (tab === 'models') {
            const byModel = {};
            stats.forEach(s => {
                if (s.kind === 'embedding') return; // hors onglet Modèles (pas un modèle de conversation)
                const m = s.model || 'gpt-realtime-2.1-mini';
                if (!byModel[m]) byModel[m] = { input: 0, output: 0, duration: 0, count: 0, cost: 0, images: isImageStat(s) };
                byModel[m].input += s.inputTokens || 0;
                byModel[m].output += s.outputTokens || 0;
                byModel[m].duration += s.durationSeconds || 0;
                byModel[m].count++;
                byModel[m].cost += statCost(s);
            });

            if (Object.keys(byModel).length === 0) {
                container.innerHTML = '<div style="text-align:center;padding:30px;color:var(--text-secondary)">Aucune conversation enregistrée.</div>';
                return;
            }

            let html = `<table class="stats-table"><thead><tr>
                <th>Modèle</th><th>Conv.</th><th>Durée</th><th>Tokens</th><th>Coût</th><th>Coût/h</th>
            </tr></thead><tbody>`;

            Object.entries(byModel).sort((a, b) => b[1].cost - a[1].cost).forEach(([model, d]) => {
                if (d.images) {
                    html += `<tr><td>${esc(model)}</td><td>${d.count} img.</td><td>-</td><td>-</td><td>${fmtAmount(d.cost)}</td><td>-</td></tr>`;
                    return;
                }
                const tokens = d.input + d.output;
                const costPerHour = d.duration > 0 ? (d.cost / d.duration * 3600) : 0;
                html += `<tr><td>${esc(model)}</td><td>${d.count}</td><td>${formatDuration(d.duration)}</td><td>${formatTokens(tokens)}</td><td>${fmtAmount(d.cost)}</td><td>${fmtAmount(costPerHour)}/h</td></tr>`;
            });
            html += `</tbody></table>`;
            container.innerHTML = html;

        } else if (tab === 'progress') {
            // Phase 3 : progression pédagogique (store study_items). Chargement
            // asynchrone → on affiche un état d'attente puis on remplit.
            container.innerHTML = '<div style="text-align:center;padding:24px;color:var(--text-secondary)">Chargement…</div>';
            renderProgressStats(container);
        }
    }

    // Onglet Progression : par persona, les sujets suivis (niveau + tendance).
    async function renderProgressStats(container) {
        const all = (await vartDbRun('readonly', 'study_items', st => st.getAll())) || [];
        const progs = all.filter(i => i.type === 'progress');
        if (!progs.length) {
            container.innerHTML = '<div style="text-align:center;padding:30px;color:var(--text-secondary)">Aucune progression enregistrée pour l\'instant.<br><span style="font-size:0.8rem">Elle se remplit quand un persona appelle l\'outil « update_progress » en fin de séance.</span></div>';
            return;
        }
        // Regroupement par persona, sujets triés du plus fragile au plus solide.
        const byPersona = {};
        progs.forEach(p => { (byPersona[p.personaId] = byPersona[p.personaId] || []).push(p); });
        let html = '';
        for (const [personaId, items] of Object.entries(byPersona)) {
            const name = personaNameOf(personaId);
            const avg = Math.round(items.reduce((s, p) => s + p.niveau, 0) / items.length);
            html += `<div class="stats-bar-row" style="margin-top:14px"><span class="stats-bar-label"><strong>${esc(name)}</strong></span>
                <div class="stats-bar-track"><div class="stats-bar-fill" style="width:${avg}%;background:${BAR_COLORS[0]}"></div></div>
                <span class="stats-bar-value">${avg}%</span></div>`;
            items.sort((a, b) => a.niveau - b.niveau).forEach(p => {
                // Tendance : différence avec la mesure précédente de l'historique.
                let delta = '';
                if (Array.isArray(p.history) && p.history.length > 1) {
                    const diff = p.niveau - p.history[p.history.length - 2].niveau;
                    if (diff > 0) delta = ` <span style="color:var(--success)">▲ ${diff}</span>`;
                    else if (diff < 0) delta = ` <span style="color:var(--danger)">▼ ${Math.abs(diff)}</span>`;
                }
                html += `<div class="stats-bar-row">
                    <span class="stats-bar-label" title="${esc(p.commentaire || '')}">${esc(p.sujet)}</span>
                    <div class="stats-bar-track"><div class="stats-bar-fill" style="width:${p.niveau}%;background:${p.niveau >= 70 ? BAR_COLORS[2] : p.niveau >= 40 ? BAR_COLORS[3] : BAR_COLORS[1]}"></div></div>
                    <span class="stats-bar-value">${p.niveau}%${delta}</span>
                </div>`;
            });
        }
        container.innerHTML = html;
    }


    // Fermer les menus contextuels des tuiles au clic extérieur
    document.addEventListener('click', () => {
        document.querySelectorAll('.welcome-card-menu.open').forEach(m => m.classList.remove('open'));
    });

    // Clic en dehors d'une modale → la fermer
    document.querySelectorAll('.modal-overlay').forEach(overlay => {
        overlay.addEventListener('click', (e) => {
            if (e.target !== overlay) return;
            // Config & éditeur de persona : passer par la même confirmation
            // « modifications non enregistrées » que la croix (et, pour la
            // config, le blocage tant qu'aucune clé n'est configurée).
            if (overlay.id === 'apiKeyModal') { requestCloseApiKeyModal(); return; }
            if (overlay.id === 'personaModal') { requestClosePersonaModal(); return; }
            overlay.classList.remove('active');
        });
    });

    // Infobulles d'aide : au survol (ou focus clavier) d'une icône « ? »
    // portant un attribut data-tip, on affiche une bulle positionnée sous
    // l'icône. Appendue au body (position: fixed) pour ne jamais être rognée
    // par le débordement des modales.
