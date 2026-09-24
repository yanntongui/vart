    // ── Bloc « Étude » : résumé + exports (Phase 3) ────────────────────────
    async function renderStudySummary() {
        const el = document.getElementById('studySummary');
        if (!el) return;
        if (!editingPersonaId) { el.textContent = 'Enregistrez le persona pour voir ses fiches et sa progression.'; return; }
        const [cards, quizzes, progs, plans] = await Promise.all([
            listStudyItems(editingPersonaId, 'flashcard'),
            listStudyItems(editingPersonaId, 'quiz'),
            listStudyItems(editingPersonaId, 'progress'),
            listStudyItems(editingPersonaId, 'plan')
        ]);
        const avg = progs.length ? Math.round(progs.reduce((s, p) => s + p.niveau, 0) / progs.length) : null;
        el.innerHTML = `${cards.length} fiche(s) · ${quizzes.length} quiz · ${progs.length} sujet(s) suivi(s)` +
            (avg !== null ? ` · maîtrise moyenne ${avg} %` : '') +
            (plans.length ? ' · plan d\'apprentissage actif' : '');
    }
    document.getElementById('exportCardsCsvBtn').addEventListener('click', async () => {
        if (!editingPersonaId) return;
        const cards = await listStudyItems(editingPersonaId, 'flashcard');
        if (!cards.length) { customAlert('Aucune fiche à exporter pour ce persona.', { icon: 'x-circle' }); return; }
        // CSV compatible import Anki (recto;verso, guillemets doublés).
        const q = (s) => '"' + String(s).replace(/"/g, '""') + '"';
        const csv = cards.map(c => `${q(c.recto)};${q(c.verso)}`).join('\n');
        downloadFile(csv, `Vart-Fiches-${studySlug(personaNameOf(editingPersonaId))}-${exportTimestamp()}.csv`, 'text/csv;charset=utf-8');
    });
    document.getElementById('exportStudyMdBtn').addEventListener('click', async () => {
        if (!editingPersonaId) return;
        const name = personaNameOf(editingPersonaId);
        const [cards, quizzes, progs, plans] = await Promise.all([
            listStudyItems(editingPersonaId, 'flashcard'),
            listStudyItems(editingPersonaId, 'quiz'),
            listStudyItems(editingPersonaId, 'progress'),
            listStudyItems(editingPersonaId, 'plan')
        ]);
        if (!cards.length && !quizzes.length && !progs.length && !plans.length) { customAlert('Aucun élément d\'étude pour ce persona.', { icon: 'x-circle' }); return; }
        let md = obsidianFrontmatter({ type: 'vart-dossier-etude', persona: name, date: OBSIDIAN_TODAY(), tags: ['vart/etude'] });
        md += `# Dossier d'étude — ${name}\n\n`;
        md += `## Mémoire\n\n${getPersonaMemoryText(editingPersonaId) || '*(vide)*'}\n\n`;
        if (plans.length) md += `## Plan d'apprentissage\n\n**Objectif :** ${plans[0].objectif}\n\n${plans[0].etapes.map(e => `- [ ] ${e}`).join('\n')}\n\n`;
        if (cards.length) md += `## Fiches de révision\n\n${cards.map(c => `### ${c.recto}\n\n${c.verso}`).join('\n\n')}\n\n`;
        if (progs.length) md += `## Progression\n\n${progs.sort((a, b) => b.niveau - a.niveau).map(p => `- ${p.sujet} : ${p.niveau} %${p.commentaire ? ` — ${p.commentaire}` : ''}`).join('\n')}\n\n`;
        if (quizzes.length) md += `## Quiz passés\n\n${quizzes.map(q2 => `### ${q2.sujet} (${(q2.createdAt || '').slice(0, 10)})\n\n${q2.questions.map(x => `- ${x.question}`).join('\n')}`).join('\n\n')}\n`;
        downloadFile(md, `Vart-Etude-${studySlug(name)}-${exportTimestamp()}.md`, 'text/markdown;charset=utf-8');
    });

