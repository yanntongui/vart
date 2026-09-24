#!/usr/bin/env node
//  DÉCOUPAGE ONE-SHOT : _baseline/vart-avant-modules.html → src/
//  Exécuté une seule fois (24/09/2026) pour créer l'arborescence de modules.
//  Ensuite, la source de vérité est src/ : ne plus jamais éditer vart.html à la
//  main, lancer `node scripts/build.js` (ou `npm run build`).
//
//  POURQUOI DES SCRIPTS CLASSIQUES CONCATÉNÉS ET NON DES ES MODULES ?
//    Vérifié au banc d'essai (Playwright, file://) :
//      • <script type="module" src="m.js"> → CORS : « origin 'null' is not
//        allowed » — le module ne se charge JAMAIS en file://.
//      • <script src="a.js"> classique → charge sans erreur, et un `const`
//        de premier niveau reste visible du script suivant (scope global
//        partagé). C'est donc la seule découpe compatible avec l'ouverture
//        de vart.html par double-clic, qui est la raison d'être du produit.
//  Les modules sont donc des tranches contiguës, concaténées dans l'ordre du
//  manifeste — le fichier produit est STRICTEMENT identique à l'original.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'src', 'manifest.json'), 'utf8'));

const raw = fs.readFileSync(path.join(ROOT, manifest.baseline), 'utf8').split('\n');
if (raw[raw.length - 1] === '') raw.pop(); // le fichier finit par un saut de ligne

//  Tranche inclusive : les sauts de ligne d'origine sont conservés, donc
//  concaténer deux tranches voisines restitue exactement les octets d'origine.
function sliceLines(a, b) {
    if (!(a >= 1 && b >= a && b <= raw.length)) throw new Error(`plage invalide : ${a}-${b}`);
    return raw.slice(a - 1, b).join('\n') + '\n';
}

//  Contiguïté : aucune ligne perdue, aucune dupliquée. C'est le cœur de la
//  garantie « zéro régression » : si ce test passe, la découpe est sans perte.
function validateCoverage(list, start, end, label) {
    let expected = start;
    for (const m of list) {
        if (m.from !== expected) {
            throw new Error(`${label} : trou/chevauchement avant « ${m.file} » (attendu ${expected}, trouvé ${m.from})`);
        }
        expected = m.to + 1;
    }
    if (expected !== end + 1) {
        throw new Error(`${label} : couverture incomplète (fin ${expected - 1}, attendu ${end})`);
    }
    console.log(`  ok ${label} : ${list.length} modules, lignes ${start}-${end} contiguës`);
}

console.log(`Découpage de ${manifest.baseline} (${raw.length} lignes)`);

//  Garde-fou : ce script ÉCRASE src/. Le relancer après le découpage initial
//  détruirait tout travail fait dans les modules. Exiger --force pour passer.
const guard = path.join(ROOT, 'src', 'js');
const alreadySplit = fs.existsSync(guard) && fs.readdirSync(guard).length > 0;
if (alreadySplit && !process.argv.includes('--force')) {
    console.error('ARRÊT : src/js/ contient déjà des modules.');
    console.error('        Ce script est un découpage ONE-SHOT : le relancer écraserait');
    console.error('        tout le travail fait dans src/. Pour éditer, modifiez les modules');
    console.error('        puis lancez « npm run build ». Pour forcer : --force (destructif).');
    process.exit(1);
}

validateCoverage(manifest.styles, 20, 5588, 'styles');
validateCoverage(manifest.scripts, 6449, 17616, 'scripts');

for (const m of [...manifest.styles, ...manifest.scripts]) {
    const dest = path.join(ROOT, m.file);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, sliceLines(m.from, m.to));
}
console.log(`  ok ${manifest.styles.length + manifest.scripts.length} fichiers écrits`);

//  Gabarit : coquille HTML avec deux marqueurs. Il contient tout le <head>,
//  tout le <body> statique et la balise <script> unique.
const template =
    sliceLines(1, 19) +            // doctype → <style>
    '@@STYLES@@\n' +
    sliceLines(5589, 6448) +       // </style> </head> <body> … <script>
    '@@SCRIPTS@@\n' +
    sliceLines(17617, 17619);      // </script> </body> </html>
fs.writeFileSync(path.join(ROOT, manifest.template), template);
console.log(`  ok gabarit écrit : ${manifest.template}`);

//  Auto-vérification : la réassemblage doit être identique à l'octet près.
const rebuilt =
    template
        .replace('@@STYLES@@\n', () => manifest.styles.map(m => fs.readFileSync(path.join(ROOT, m.file), 'utf8')).join(''))
        .replace('@@SCRIPTS@@\n', () => manifest.scripts.map(m => fs.readFileSync(path.join(ROOT, m.file), 'utf8')).join(''));
const original = raw.join('\n') + '\n';
if (rebuilt !== original) throw new Error('ÉCHEC : le réassemblage diffère de l\'original');
console.log(`  ok réassemblage identique (${Buffer.byteLength(original)} octets)`);
