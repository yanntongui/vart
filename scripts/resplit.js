#!/usr/bin/env node
//  DÉCOUPAGE DE 2e NIVEAU — scinde un module de src/ en plusieurs sous-modules.
//
//  GARANTIE : le vart.html produit doit rester IDENTIQUE octet pour octet à la
//  référence _baseline/vart-avant-modules.html. Sinon, TOUT est annulé
//  (fichiers ET manifeste) et le script sort en erreur. Un découpage ne peut
//  donc pas casser l'application : au pire, il ne s'applique pas.
//
//  Usage :
//    node scripts/resplit.js <module> <ligne1> [<ligne2> ...] \
//         --into <part1> <part2> [<part3> ...]
//
//  Les lignes données sont les DÉBUTS des parties 2, 3, … (numérotation dans le
//  fichier, 1 = première ligne). Ce doivent être des points de coupe propres.
//
//  Exemple : scinder src/js/44-vision.js (687 lignes) en trois, aux lignes 189
//  et 439 :
//    node scripts/resplit.js src/js/44-vision.js 189 439 \
//      --into src/js/44a-vision-capture.js \
//             src/js/44b-vision-stockage.js \
//             src/js/44c-vision-ui.js
//
//  Convention : on garde le numéro d'origine et on suffixe a, b, c… (44a, 44b)
//  pour ne pas renuméroter tous les modules suivants.
const fs = require('fs');
const path = require('path');
const { ROOT, assemble } = require('./build.js');

const MANIFEST_PATH = path.join(ROOT, 'src', 'manifest.json');

// --- Verrou d'exclusion mutuelle ------------------------------------------
//  resplit lit puis RÉÉCRIT src/manifest.json. Lancé deux fois en parallèle,
//  le second écrase les entrées du premier (course sur le manifeste : l'état
//  devient incohérent avec les fichiers sur disque). Ce verrou l'interdit.
//  S'il reste un verrou après un crash, le supprimer à la main.
const LOCK_PATH = path.join(ROOT, '.resplit.lock');
try {
    fs.writeFileSync(LOCK_PATH, String(process.pid), { flag: 'wx' });
} catch {
    console.error('ARRÊT : un autre resplit est en cours.');
    console.error(`        Verrou présent : ${path.relative(ROOT, LOCK_PATH)}`);
    console.error('        Si aucun processus ne tourne, supprimez ce fichier et relancez.');
    process.exit(3);
}
process.on('exit', () => { try { fs.unlinkSync(LOCK_PATH); } catch { /* déjà ôté */ } });

// --- Arguments -------------------------------------------------------------
const argv = process.argv.slice(2);
const intoIdx = argv.indexOf('--into');
if (argv.length < 4 || intoIdx === -1) {
    console.error('Usage : node scripts/resplit.js <module> <ligne1> [...] --into <part1> <part2> [...]');
    process.exit(2);
}
const moduleRel = argv[0];
const cuts = argv.slice(1, intoIdx).map(Number);
const parts = argv.slice(intoIdx + 1);
if (cuts.some(n => !Number.isInteger(n) || n < 2)) {
    console.error('ERREUR : les lignes de coupe doivent être des entiers >= 2');
    process.exit(2);
}
if (parts.length !== cuts.length + 1) {
    console.error(`ERREUR : ${cuts.length} coupe(s) impliquent ${cuts.length + 1} parties, ${parts.length} fournie(s)`);
    process.exit(2);
}
if (new Set(parts).size !== parts.length) {
    console.error('ERREUR : noms de parties en double');
    process.exit(2);
}

// --- Localisation du module dans le manifeste -----------------------------
const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
const groupKey = manifest.styles.some(m => m.file === moduleRel) ? 'styles'
    : manifest.scripts.some(m => m.file === moduleRel) ? 'scripts' : null;
if (!groupKey) {
    console.error(`ERREUR : ${moduleRel} n'est pas dans le manifeste`);
    process.exit(2);
}
const entryIdx = manifest[groupKey].findIndex(m => m.file === moduleRel);
const entry = manifest[groupKey][entryIdx];

const lines = fs.readFileSync(path.join(ROOT, moduleRel), 'utf8').split('\n');
if (lines[lines.length - 1] === '') lines.pop(); // saut de ligne final
const total = lines.length;

if (cuts.some(c => c > total)) {
    console.error(`ERREUR : coupe au-delà de la fin du module (${total} lignes)`);
    process.exit(2);
}
if ([...cuts].sort((a, b) => a - b).join() !== cuts.join()) {
    console.error('ERREUR : les coupes doivent être en ordre croissant');
    process.exit(2);
}

// --- Contrôle « point de coupe propre » (avertissement, non bloquant) ------
//  bounds ne contient que des DÉBUTS de parties, sauf le dernier qui est la fin
//  exclusive (total) : on ne vérifie donc pas ce dernier (ce serait hors bornes).
const bounds = [0, ...cuts.map(c => c - 1), total]; // index 0-based des débuts
for (let i = 1; i < bounds.length - 1; i++) {
    const l = lines[bounds[i]];
    const prev = lines[bounds[i] - 1];
    const startsOk = /^\s*(\/\/|\/\*)/.test(l)
        || /^\s*(async\s+)?(function|const|let|var|class)\b/.test(l)
        || /^\s*@/.test(l)
        || /^\s*[.#:%a-zA-Z\[][^{}]*\{\s*$/.test(l);
    const prevOk = prev === undefined || prev.trim() === '' || /[};]\s*$/.test(prev) || /\*\/\s*$/.test(prev);
    const clean = startsOk && prevOk;
    console.log(`  ${clean ? 'ok ' : 'ATTENTION'} coupe ligne ${bounds[i] + 1} : « ${l.trim().slice(0, 60)} »`);
    if (!clean) console.log(`        ligne précédente : « ${(prev || '').trim().slice(0, 60)} »`);
}

// --- Application, avec sauvegarde complète pour rollback -------------------
const backups = new Map();
const remember = (rel) => {
    const abs = path.join(ROOT, rel);
    backups.set(abs, fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : null);
};
remember(moduleRel);
remember('src/manifest.json');
parts.forEach(remember);

const newEntries = [];
for (let i = 0; i < parts.length; i++) {
    const from = bounds[i];
    const to = bounds[i + 1];          // exclu, index 0-based
    const slice = lines.slice(from, to);
    fs.mkdirSync(path.dirname(path.join(ROOT, parts[i])), { recursive: true });
    fs.writeFileSync(path.join(ROOT, parts[i]), slice.join('\n') + '\n');
    // from/to du manifeste : décalés dans la numérotation du fichier d'origine.
    newEntries.push({ file: parts[i], from: entry.from + from, to: entry.from + to - 1, role: entry.role });
    console.log(`  ok  ${parts[i]}  ← lignes ${from + 1}-${to} du module (${slice.length} l.)`);
}
fs.unlinkSync(path.join(ROOT, moduleRel));

manifest[groupKey].splice(entryIdx, 1, ...newEntries);
fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + '\n');

// --- Épreuve : le vart.html produit doit rester identique à la référence ---
const baseline = fs.readFileSync(path.join(ROOT, manifest.baseline), 'utf8');
const produced = assemble();
if (produced !== baseline) {
    console.error('\nECHEC : le vart.html produit diffère de la référence → ROLLBACK');
    for (const [abs, previous] of backups) {
        if (previous === null) { if (fs.existsSync(abs)) fs.unlinkSync(abs); }
        else fs.writeFileSync(abs, previous);
    }
    console.error('   État restauré : aucun changement appliqué.');
    process.exit(1);
}
fs.writeFileSync(path.join(ROOT, manifest.output), produced);
console.log(`\nok  ${moduleRel} → ${parts.length} modules`);
console.log(`    vart.html IDENTIQUE à la référence (${Buffer.byteLength(produced)} octets) : découpage sans perte.`);

