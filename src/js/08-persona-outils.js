    function safeCalc(expr) {
        const src = String(expr || '').replace(/\s+/g, '');
        if (!src || !/^[0-9+\-*/^().,a-z]+$/i.test(src)) return null;
        const FUNCS = { sqrt: Math.sqrt, abs: Math.abs, round: Math.round, min: Math.min, max: Math.max, floor: Math.floor, ceil: Math.ceil };
        const CONSTS = { pi: Math.PI, e: Math.E };
        const out = [], ops = [];
        const prec = { '+': 1, '-': 1, '*': 2, '/': 2, '^': 3, 'u-': 4 };
        const rightAssoc = { '^': true, 'u-': true };
        // Piste de contexte des parenthèses : 'func' = ouverte après un nom
        // de fonction. Dédouane l'ambiguïté « 3,7 » : à l'intérieur d'une
        // fonction c'est 3 SÉPARÉ DE 7 (min(3,7)), à l'extérieur un décimal
        // à la française (1,5 + 2,5).
        const parenKind = [];
        const inFuncParen = () => parenKind[parenKind.length - 1] === 'func';
        let i = 0, prev = '';
        while (i < src.length) {
            const c = src[i];
            // Nombre : décimal « .5 » accepté en tête ; dans une fonction la
            // décimale n'accepte que le point (la virgule y = séparateur
            // d'arguments et doit suivre son propre chemin).
            const funcCtx = inFuncParen();
            const asLeadingDecimal = (c === '.' || (c === ',' && !funcCtx));
            if (/[0-9]/.test(c) || (asLeadingDecimal && /[0-9]/.test(src[i + 1] || ''))) {
                const re = funcCtx ? /^(?:\d+(?:\.\d+)?|\.\d+)/ : /^(?:\d+(?:[.,]\d+)?|[.,]\d+)/;
                const m = src.slice(i).match(re);
                if (!m) return null;
                out.push(parseFloat(m[0].replace(',', '.'))); i += m[0].length; prev = 'num'; continue;
            }
            if (/[a-z]/i.test(c)) {
                const m = src.slice(i).match(/^[a-z]+/i);
                const w = m[0].toLowerCase(); i += w.length;
                if (FUNCS[w]) { ops.push(w); prev = 'func'; }
                else if (CONSTS[w] !== undefined) { out.push(CONSTS[w]); prev = 'num'; }
                else return null;
                continue;
            }
            if (c === '(') { ops.push(c); parenKind.push(prev === 'func' ? 'func' : 'paren'); prev = '('; i++; continue; }
            // Virgule : séparateur d'arguments UNIQUEMENT dans une fonction
            // (min(3,7)) ; sinon elle est déjà avalée par le nombre décimal.
            if (c === ',') {
                if (!inFuncParen()) return null;
                while (ops.length && ops[ops.length - 1] !== '(') out.push(ops.pop());
                if (!ops.length) return null;
                prev = 'op'; i++; continue;
            }
            if (c === ')') {
                while (ops.length && ops[ops.length - 1] !== '(') out.push(ops.pop());
                if (!ops.length) return null;
                ops.pop();
                parenKind.pop();
                if (ops.length && typeof ops[ops.length - 1] === 'string' && FUNCS[ops[ops.length - 1]]) out.push(ops.pop());
                prev = 'num'; i++; continue;
            }
            if ('+-*/^'.includes(c)) {
                const op = (c === '-' && (prev === '' || prev === 'op' || prev === '(' || prev === 'func')) ? 'u-' : c;
                while (ops.length) {
                    const t = ops[ops.length - 1];
                    if (t === '(') break;
                    const pt = prec[t], pc = prec[op];
                    if (pt === undefined || pc === undefined) break;
                    if (pt > pc || (pt === pc && !rightAssoc[op])) out.push(ops.pop()); else break;
                }
                ops.push(op); prev = 'op'; i++; continue;
            }
            return null;
        }
        while (ops.length) { const t = ops.pop(); if (t === '(') return null; out.push(t); }
        const st = [];
        for (const t of out) {
            if (typeof t === 'number') { st.push(t); continue; }
            if (FUNCS[t]) {
                // min/max sont BINAIRES dans notre grammaire (min(a,b)) :
                // les autres fonctions sont unaires (sqrt(4)).
                if (t === 'min' || t === 'max') {
                    const b = st.pop(), a = st.pop();
                    if (a === undefined || b === undefined) return null;
                    st.push(FUNCS[t](a, b));
                    continue;
                }
                if (!st.length) return null;
                st.push(FUNCS[t](st.pop())); continue;
            }
            if (t === 'u-') { if (!st.length) return null; st.push(-st.pop()); continue; }
            const b = st.pop(), a = st.pop();
            if (a === undefined || b === undefined) return null;
            st.push(t === '+' ? a + b : t === '-' ? a - b : t === '*' ? a * b : t === '/' ? a / b : Math.pow(a, b));
        }
        if (st.length !== 1 || !isFinite(st[0])) return null;
        return st[0];
    }

    // Outil save_note : écrit une note datée dans la mémoire (consolidée à la
    // prochaine session par updatePersonaMemory, qui est priée de la conserver).
    async function saveNoteToMemory(personaId, note) {
        if (!note || !note.trim() || !personaId) return { ok: false };
        const d = new Date();
        const stamp = `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;
        const current = getPersonaMemoryText(personaId);
        const addition = `- [note ${stamp}] ${note.trim()}`;
        await savePersonaMemory(personaId, current.trim() ? current + '\n' + addition : `## Notes\n${addition}`);
        obsidianWriteMemory(personaId).catch(() => {}); // sync vault (Phase 3)
        return { ok: true, ajoute: note.trim() };
    }

    // Outil search_history : fouille les conversations passées DE CE persona
    // (cache synchrone). Top 3 passages pertinents, extraits contextualisés.
    function searchPersonaHistory(personaId, query, k = 3) {
        const terms = bm25Tokens(query);
        if (!terms.length) return [];
        const convs = getConversations().filter(c => c.personaId === personaId && Array.isArray(c.messages));
        const hits = [];
        convs.forEach(c => {
            (c.messages || []).forEach(m => {
                const text = String(m.text || '');
                const low = text.toLowerCase();
                let score = 0;
                terms.forEach(t => { if (low.includes(t)) score++; });
                if (score > 0) hits.push({ date: c.date, title: c.title || '', sender: m.sender || '', text, score });
            });
        });
        hits.sort((a, b) => b.score - a.score);
        return hits.slice(0, k).map(h => ({
            date: (h.date || '').slice(0, 10),
            auteur: h.sender,
            extrait: h.text.length > 400 ? h.text.slice(0, 400) + '…' : h.text
        }));
    }

    // Définitions des 5 outils Phase 2, écrites UNE fois puis projetées au
    // format de chaque moteur : { type:'function', … } pour Live/Realtime/
    // Grok, sans `type` pour les functionDeclarations Gemini.
    const VART_PERSONA_TOOL_DEFS = [
        {
            name: 'search_sources',
            description: 'Cherche des extraits pertinents dans les documents et notes fournis à ce persona (cours, PDF, articles, notes personnelles). À utiliser dès qu\'une question porte sur leur contenu — préfère cet outil à tes connaissances générales pour tout ce qui vient de ses sources.',
            parameters: { type: 'object', properties: { query: { type: 'string', description: 'La question ou les mots-clés à chercher' } }, required: ['query'] }
        },
        {
            name: 'search_history',
            description: 'Recherche dans les conversations passées avec cet utilisateur pour retrouver un échange antérieur (« c\'était quoi déjà que tu m\'as dit… »).',
            parameters: { type: 'object', properties: { query: { type: 'string', description: 'Ce qu\'il faut retrouver' } }, required: ['query'] }
        },
        {
            name: 'save_note',
            description: 'Enregistre une note durable dans ta mémoire à long terme. Utilise quand l\'utilisateur demande explicitement de retenir quelque chose, ou quand une information doit survivre à cette conversation.',
            parameters: { type: 'object', properties: { note: { type: 'string', description: 'La note à retenir, concise' } }, required: ['note'] }
        },
        {
            name: 'calculate',
            description: 'Calcule une expression arithmétique de façon exacte (+ - * / ^, parenthèses, min/max/sqrt/round). Utilise pour tout calcul plutôt que de le faire de mémoire.',
            parameters: { type: 'object', properties: { expression: { type: 'string', description: 'L\'expression à calculer, ex: (12+8)*3.5' } }, required: ['expression'] }
        },
        {
            name: 'fetch_url',
            description: 'Récupère le texte d\'une page web pour en lire le contenu à la demande.',
            parameters: { type: 'object', properties: { url: { type: 'string', description: 'L\'URL complète (https://…)' } }, required: ['url'] }
        },
        // ── Phase 3 : pédagogie active ──
        {
            name: 'create_quiz',
            description: 'Prépare un quiz sur un sujet (à partir des sources du persona quand il y en a) et te renvoie les questions à poser à l\'oral, une par une. Utilise-le quand l\'utilisateur demande à être interrogé ou veut tester ses connaissances.',
            parameters: { type: 'object', properties: { sujet: { type: 'string', description: 'Le sujet du quiz' }, nombre: { type: 'number', description: 'Nombre de questions (3 par défaut, 10 max)' } }, required: ['sujet'] }
        },
        {
            name: 'make_flashcard',
            description: 'Crée une fiche de révision (recto/verso) à partir de ce que vous venez de voir. Utilise-la quand une notion clé mérite d\'être révisée plus tard.',
            parameters: { type: 'object', properties: { recto: { type: 'string', description: 'La question ou le terme (recto)' }, verso: { type: 'string', description: 'La réponse ou la définition (verso)' } }, required: ['recto', 'verso'] }
        },
        {
            name: 'plan_session',
            description: 'Établit un plan d\'apprentissage en étapes pour atteindre un objectif, en s\'appuyant sur ta mémoire et les sources du persona. Utilise-le quand l\'utilisateur veut un programme de travail ou demande par où commencer.',
            parameters: { type: 'object', properties: { objectif: { type: 'string', description: 'L\'objectif visé (examen, projet, niveau à atteindre)' } }, required: ['objectif'] }
        },
        {
            name: 'update_progress',
            description: 'Note le niveau de maîtrise d\'un sujet pour suivre la progression dans le temps (visible dans Statistiques → Progression). Utilise-le en fin de séance pour les sujets travaillés.',
            parameters: { type: 'object', properties: { sujet: { type: 'string', description: 'Le sujet évalué' }, niveau: { type: 'number', description: 'Niveau de maîtrise de 0 à 100' }, commentaire: { type: 'string', description: 'Précision courte (facultatif)' } }, required: ['sujet', 'niveau'] }
        },
        // ── Phase 4 : répétition espacée ──
        {
            name: 'review_flashcards',
            description: 'Récupère les fiches de révision dues aujourd\'hui pour faire réviser l\'utilisateur à l\'oral (une question à la fois). Utilise-le quand l\'utilisateur demande à réviser ses fiches, ou propose-le en début de conversation quand un badge de révision est affiché.',
            parameters: { type: 'object', properties: {} }
        },
        {
            name: 'mark_flashcard_reviewed',
            description: 'Note le résultat d\'une fiche après que l\'utilisateur a répondu à l\'oral, pour programmer sa prochaine révision (répétition espacée). À appeler après CHAQUE question posée via review_flashcards.',
            parameters: { type: 'object', properties: { card_id: { type: 'string', description: 'L\'id de la fiche (fourni par review_flashcards)' }, success: { type: 'boolean', description: 'true si la réponse était correcte' } }, required: ['card_id', 'success'] }
        }
    ];
    // Format OpenAI (Live / Realtime / Grok)
    function vartToolDefsAsOpenAI() { return VART_PERSONA_TOOL_DEFS.map(t => ({ type: 'function', name: t.name, description: t.description, parameters: t.parameters })); }
    // Format Gemini : le tableau brut est déjà dans le bon format.

    // Exécuteur unique. Renvoie toujours une chaîne JSON.
    async function executeVartTool(name, args) {
        args = args || {};
        const personaId = getActiveId();
        try {
            if (name === 'search_sources') {
                const hits = await searchPersonaSources(personaId, args.query || '', 5);
                if (!hits.length) return JSON.stringify({ resultats: [], note: 'Aucune source indexée pour ce persona, ou rien de pertinent trouvé. Dis-le honnêtement à l\'utilisateur.' });
                return JSON.stringify({
                    resultats: hits.map(h => ({ source: h.source, extrait: h.text.length > 600 ? h.text.slice(0, 600) + '…' : h.text })),
                    consigne: 'Utilise ces extraits pour répondre. Cite la source de façon naturelle (« d\'après ton document X… »). N\'invente rien hors de ces extraits.'
                });
            }
            if (name === 'search_history') {
                const hits = searchPersonaHistory(personaId, args.query || '');
                if (!hits.length) return JSON.stringify({ resultats: [], note: 'Rien trouvé dans vos conversations passées.' });
                return JSON.stringify({ resultats: hits, consigne: 'Rappelle ce passage à l\'utilisateur de façon naturelle.' });
            }
            if (name === 'save_note') {
                const r = await saveNoteToMemory(personaId, args.note || '');
                return JSON.stringify(r.ok ? { ok: true, message: 'Note enregistrée dans ta mémoire.' } : { ok: false, message: 'Note vide ou persona introuvable.' });
            }
            if (name === 'calculate') {
                const v = safeCalc(args.expression || '');
                return v === null ? JSON.stringify({ erreur: 'Expression invalide.' }) : JSON.stringify({ resultat: v });
            }
            if (name === 'fetch_url') {
                const text = await fetchUrlAsText(args.url || '');
                return JSON.stringify({ contenu: text.slice(0, 3000) + (text.length > 3000 ? '…' : '') });
            }
            // ── Phase 3 : pédagogie active ──
            if (name === 'create_quiz') {
                return await createQuizForPersona(personaId, args.sujet || '', args.nombre);
            }
            if (name === 'make_flashcard') {
                return await makeFlashcardForPersona(personaId, args.recto || '', args.verso || '');
            }
            if (name === 'plan_session') {
                return await buildStudyPlanForPersona(personaId, args.objectif || '');
            }
            if (name === 'update_progress') {
                return await recordProgressForPersona(personaId, args.sujet || '', args.niveau, args.commentaire || '');
            }
            // ── Phase 4 : répétition espacée ──
            if (name === 'review_flashcards') {
                return await reviewFlashcardsForPersona(personaId);
            }
            if (name === 'mark_flashcard_reviewed') {
                return await markFlashcardReviewed(personaId, args.card_id || '', args.success);
            }
            if (name === 'get_current_datetime') {
                const now = new Date();
                const jours = ['dimanche','lundi','mardi','mercredi','jeudi','vendredi','samedi'];
                const mois = ['janvier','février','mars','avril','mai','juin','juillet','août','septembre','octobre','novembre','décembre'];
                return JSON.stringify({ date: `${jours[now.getDay()]} ${now.getDate()} ${mois[now.getMonth()]} ${now.getFullYear()}`, heure: `${now.getHours().toString().padStart(2,'0')}h${now.getMinutes().toString().padStart(2,'0')}`, timestamp: now.toISOString() });
            }
            if (name === 'get_weather') return await getWeather(args.location || 'Paris');
            return JSON.stringify({ error: `Fonction inconnue : ${name}` });
        } catch (e) {
            return JSON.stringify({ erreur: e.message || 'échec de l\'outil' });
        }
    }
    // Variante objet (Gemini : toolResponse attend du JSON parsé).
    async function executeVartToolObj(name, args) {
        const raw = await executeVartTool(name, args);
        try { return JSON.parse(raw); } catch { return { data: raw }; }
    }

    // ══════════════════════════════════════════════════════════════════════
    //  PHASE 3 — PÉDAGOGIE ACTIVE (store « study_items »)
    //  Un seul store discriminé par `type` : 'quiz' | 'flashcard' | 'plan' |
    //  'progress'. Une seule purge à gérer à la suppression du persona.
    // ══════════════════════════════════════════════════════════════════════

    async function listStudyItems(personaId, type) {
        const all = (await vartDbRun('readonly', 'study_items', st => st.getAll())) || [];
        return all.filter(i => i.personaId === personaId && (!type || i.type === type));
    }
    async function putStudyItem(item) {
        return await vartDbRun('readwrite', 'study_items', st => { st.put(item); return true; });
    }
    async function purgePersonaStudyItems(personaId) {
        const mine = await listStudyItems(personaId);
        if (mine.length) await vartDbRun('readwrite', 'study_items', st => { mine.forEach(i => st.delete(i.id)); });
    }
    function studySlug(s) {
        return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
    }
    function personaNameOf(personaId) {
        const p = getPersonas().find(x => x.id === personaId);
        return p ? p.name : 'Persona';
    }

    // Contexte pédagogique : extraits des sources les plus pertinentes +
    // mémoire du persona. Alimente quiz et plans d'apprentissage.
    async function studyContextFor(personaId, sujet) {
        const hits = sujet ? await searchPersonaSources(personaId, sujet, 4).catch(() => []) : [];
        const mem = getPersonaMemoryText(personaId).trim();
        let ctx = '';
        if (hits.length) ctx += `\n\nExtraits des sources du persona (appuie-toi dessus en priorité) :\n${hits.map(h => `[${h.source}] ${h.text.slice(0, 900)}`).join('\n---\n')}`;
        if (mem) ctx += `\n\nMémoire du persona (progression, acquis, points fragiles) :\n${mem}`;
        return ctx;
    }

    // Outil create_quiz : génère les questions (et leurs réponses, que le
    // modèle utilise pour ÉVALUER sans les révéler d'avance) puis les stocke.
    async function createQuizForPersona(personaId, sujet, nombre) {
        if (!sujet.trim()) return JSON.stringify({ erreur: 'Sujet manquant.' });
        const n = Math.min(Math.max(parseInt(nombre, 10) || 3, 1), 10);
        const ctx = await studyContextFor(personaId, sujet);
        const raw = await chatCompletion({
            systemPrompt: `Tu prépares un quiz ORAL de ${n} questions sur « ${sujet} ».
Format STRICT, une ligne par question, sans numérotation ni markdown :
Q: la question
R: la réponse attendue, très courte
Niveau progressif (facile → difficile). Aucun commentaire autour.${ctx}`,
            userPrompt: `Sujet du quiz : ${sujet}`,
            temperature: 0.5, maxTokens: 900, model: getAnalysisModel()
        });
        const questions = String(raw || '').split('\n').map(l => l.trim()).filter(l => /^Q\s*:/i.test(l)).map(l => {
            const m = l.match(/^Q\s*:\s*(.*?)\s*(?:R\s*:\s*(.*))?$/i);
            return { question: (m ? m[1] : l).trim(), reponse: m && m[2] ? m[2].trim() : '' };
        }).filter(q => q.question);
        if (!questions.length) return JSON.stringify({ erreur: 'Génération du quiz impossible.' });
        await putStudyItem({ id: `quiz_${personaId}_${Date.now()}`, type: 'quiz', personaId, sujet: sujet.trim(), questions, createdAt: new Date().toISOString() });
        return JSON.stringify({
            sujet: sujet.trim(),
            questions: questions.map(q => ({ question: q.question, reponse_attendue: q.reponse })),
            consigne: 'Pose ces questions UNE PAR UNE à l\'oral. Attends la réponse de l\'utilisateur, évalue-la avec la réponse attendue (sans la donner d\'avance), corrige si besoin, puis passe à la suivante. Termine par un bilan des points à revoir et appelle update_progress pour les sujets travaillés.'
        });
    }

    // Outil make_flashcard : fiche recto/verso persistée + resynchronisation
    // du fichier de fiches dans le vault Obsidian (si connecté).
    async function makeFlashcardForPersona(personaId, recto, verso) {
        if (!recto.trim() || !verso.trim()) return JSON.stringify({ erreur: 'Recto ou verso manquant.' });
        // Phase 4 : une fiche neuve est due immédiatement (on révise ce qu'on
        // vient d'apprendre), puis l'intervalle grandit à chaque réussite.
        await putStudyItem({ id: `card_${personaId}_${Date.now()}`, type: 'flashcard', personaId, recto: recto.trim(), verso: verso.trim(), createdAt: new Date().toISOString(), nextReviewAt: new Date().toISOString(), reviewCount: 0, intervalDays: 0 });
        const count = (await listStudyItems(personaId, 'flashcard')).length;
        obsidianWriteFlashcards(personaId).catch(() => {});
        dueCountsCache[personaId] = await countDueFlashcards(personaId).catch(() => 0); // Phase 4
        refreshDueBadges().catch(() => {});
        return JSON.stringify({ ok: true, total_fiches: count, message: `Fiche enregistrée (${count} au total pour ce persona).` });
    }

