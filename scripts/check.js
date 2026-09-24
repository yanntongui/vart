#!/usr/bin/env node
//  VALIDATION DE L'ARCHITECTURE MODULAIRE.
//
//    node scripts/check.js     (ou npm run check)
//
//  Contrôles, dans l'ordre d'importance :
//   1. DÉRIVE : vart.html (généré) doit être exactement ce que produit src/.
//      C'est le garde-fou central : si quelqu'un édite vart.html à la main,
//      son travail est perdu au prochain build et ce test le dit.
//   2. SYNTAXE : le JavaScript concaténé est analysé par vm.Script (équivalent
//      de `node --check` / `jsc`, sans exécution et sans fichier temporaire).
//   3. COMPATIBILITÉ file:// : aucun `import`/`export`, aucun `type="module"`,
//      aucun module séparé — sinon l'application ne démarrerait plus quand
//      l'utilisateur ouvre vart.html par double-clic (CORS « origin null »).
//   4. CONVENTIONS du projet : dialogues customAlert/customConfirm seulement.
//   5. ORDRE : le calque de surcharge « Apple » doit rester le dernier CSS.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { assemble, load, ROOT } = require('./build.js');

let failures = 0;
const ok = (msg) => console.log(`  ok   ${msg}`);
const ko = (msg) => { failures++; console.error(`  ECHEC ${msg}`); };

const { manifest } = load();
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

// ---------------------------------------------------------------- 1. dérive
console.log('1. Cohérence src/ → vart.html');
const built = assemble();
const onDisk = fs.existsSync(path.join(ROOT, manifest.output)) ? read(manifest.output) : null;
if (onDisk === null) {
    ko(`${manifest.output} absent — lancez « node scripts/build.js ».`);
} else if (onDisk !== built) {
    ko(`${manifest.output} a dérivé de src/ : le fichier généré a été modifié à la main.`);
    ko('     Corrigez en reportant la modification dans le bon module, puis rebuild.');
} else {
    ok(`${manifest.output} correspond exactement à src/ (${Buffer.byteLength(built)} octets)`);
}

// -------------------------------------------------------------- 2. syntaxe
console.log('2. Syntaxe du JavaScript concaténé');
const jsCode = manifest.scripts.map(m => read(m.file)).join('');
try {
    new vm.Script(jsCode, { filename: 'vart.js' });
    const lines = jsCode.split('\n').length;
    ok(`analyse réussie (${lines} lignes de JS, ${manifest.scripts.length} modules)`);
} catch (e) {
    ko(`erreur de syntaxe : ${e.message}`);
}

// -------------------------------------------- 3. compatibilité ouverture locale
console.log('3. Compatibilité file:// (ouverture par double-clic)');
const esmHits = (jsCode.match(/^[ \t]*(?:import|export)[ \t(]/gm) || []).length;
if (esmHits) ko(`${esmHits} instruction(s) import/export : interdites, elles ne se chargent pas en file://`);
else ok('aucune instruction import/export');

const template = read(manifest.template);
if (/type\s*=\s*["']module["']/.test(template) || /type\s*=\s*["']module["']/.test(built)) {
    ko('un <script type="module"> est présent : bloqué par CORS en file://');
} else {
    ok('aucun <script type="module">');
}

const inlineScripts = (built.match(/<script>\s*\n/g) || []).length;
const externalScripts = (built.match(/<script\b[^>]*\bsrc=/g) || []).length;
if (inlineScripts !== 1) {
    ko(`${inlineScripts} <script> en ligne (1 attendu) : le HTML ne doit pas être fragmenté`);
} else if (externalScripts !== 1) {
    ko(`${externalScripts} <script src=…> (1 attendu : pdf.js) — toute dépendance supplémentaire est une régression`);
} else {
    ok(`1 script en ligne + 1 externe (pdf.js) : ${manifest.scripts.length} modules concaténés dans le script unique`);
}

// ------------------------------------------------------------- 4. conventions
console.log('4. Conventions du projet');
const nativeAlert = jsCode.match(/(?<![\w.$])alert\s*\(/g) || [];
const nativeConfirm = jsCode.match(/(?<![\w.$])confirm\s*\(/g) || [];
if (nativeAlert.length || nativeConfirm.length) {
    ko(`${nativeAlert.length + nativeConfirm.length} appel(s) natif(s) alert/confirm : utilisez customAlert/customConfirm`);
} else {
    ok('dialogue uniquement via customAlert/customConfirm');
}

// ------------------------------------------------------------------ 5. ordre
console.log('5. Ordre des feuilles de style');
const lastStyle = manifest.styles[manifest.styles.length - 1].file;
if (!lastStyle.includes('90-surcharge-apple')) {
    ko(`le dernier CSS doit être le calque de surcharge Apple (actuellement ${lastStyle})`);
} else {
    ok('le calque « Apple » est bien le dernier (il gagne à spécificité égale)');
}

// -------------------------------------------------------------- récapitulatif
const sizes = [
    ...manifest.styles.map(m => ({ ...m, l: read(m.file).split('\n').length - 1 })),
    ...manifest.scripts.map(m => ({ ...m, l: read(m.file).split('\n').length - 1 }))
].sort((a, b) => b.l - a.l);
console.log(`\n${manifest.styles.length} CSS + ${manifest.scripts.length} JS = ${sizes.length} modules.`);
console.log('Les 5 plus gros (candidats à un nouveau découpage) :');
sizes.slice(0, 5).forEach(m => console.log(`   ${String(m.l).padStart(5)} l.  ${m.file}`));

if (failures) {
    console.error(`\n${failures} contrôle(s) en échec.`);
    process.exit(1);
}
console.log('\nTous les contrôles sont au vert.');
