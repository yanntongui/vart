    let editingPosture = '';   // '' | 'expert' | 'mentor' | 'coach'

    function renderPostureCards() {
        document.querySelectorAll('#pPostureCards .posture-card').forEach(c => {
            const on = c.dataset.posture === editingPosture;
            c.classList.toggle('active', on);
            c.setAttribute('aria-checked', on ? 'true' : 'false');
        });
    }
    document.querySelectorAll('#pPostureCards .posture-card').forEach(c => {
        c.addEventListener('click', () => {
            // Re-cliquer la carte active la désélectionne (posture optionnelle).
            editingPosture = (editingPosture === c.dataset.posture) ? '' : c.dataset.posture;
            renderPostureCards();
        });
    });

    // Une ligne de règle = type + texte + suppression. Le DOM est la source
    // de vérité pendant l'édition ; collectRules() le relit à la sauvegarde.
    function addRuleRow(rule = { type: 'comportement', text: '' }) {
        const row = document.createElement('div');
        row.className = 'rule-row';
        const sel = document.createElement('select');
        RULE_TYPES.forEach(t => {
            const o = document.createElement('option');
            o.value = t.value; o.textContent = t.label;
            sel.appendChild(o);
        });
        sel.value = RULE_TYPES.some(t => t.value === rule.type) ? rule.type : 'comportement';
        const ta = document.createElement('textarea');
        ta.placeholder = 'Ex : termine chaque explication par un résumé en 3 points';
        ta.value = rule.text || '';
        const del = document.createElement('button');
        del.type = 'button';
        del.className = 'rule-delete';
        del.title = 'Supprimer cette règle';
        del.innerHTML = '&times;';
        del.addEventListener('click', () => row.remove());
        row.appendChild(sel); row.appendChild(ta); row.appendChild(del);
        document.getElementById('pRulesList').appendChild(row);
    }
    document.getElementById('addRuleBtn').addEventListener('click', () => {
        addRuleRow();
        // Focus sur le texte de la nouvelle règle : gain de temps à la frappe.
        const rows = document.querySelectorAll('#pRulesList .rule-row textarea');
        if (rows.length) rows[rows.length - 1].focus();
    });

    function collectRules() {
        return [...document.querySelectorAll('#pRulesList .rule-row')].map(row => ({
            type: row.querySelector('select').value,
            text: row.querySelector('textarea').value.trim()
        })).filter(r => r.text);
    }
    function rulesSignature() { return JSON.stringify(collectRules()); }

    // Effacement de la mémoire : confirmé, immédiat (stockage IndexedDB
    // séparé du persona — pas besoin d'attendre « Sauvegarder »).
    document.getElementById('clearMemoryBtn').addEventListener('click', async () => {
        if (!document.getElementById('pMemory').value.trim()) return;
        if (!await customConfirm('Effacer définitivement la mémoire de ce persona ? Il ne se souviendra plus de vos conversations passées.', { title: 'Effacer la mémoire', icon: 'trash', confirmLabel: 'Effacer', danger: true })) return;
        document.getElementById('pMemory').value = '';
        if (editingPersonaId) await savePersonaMemory(editingPersonaId, '');
    });

