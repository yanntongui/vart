#!/usr/bin/env node
//  ASSEMBLEUR VART : src/ → vart.html
//  Concaténation pure : aucune transformation, aucune minification, aucun
//  bundle. Le fichier produit reste un HTML autonome, ouvrable en file://.
//
//    node scripts/build.js           écrit vart.html
//    node scripts/build.js --check   vérifie sans écrire (détection de dérive)
//
//  En cas de dérive, le message explique la cause la plus probable : quelqu'un
//  a édité vart.html directement au lieu d'éditer un module de src/.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const MANIFEST = path.join(ROOT, 'src/manifest.json');

function load() {
    const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
    const read = (rel) => {
        const p = path.join(ROOT, rel);
        if (!fs.existsSync(p)) throw new Error(`module introuvable : ${rel}`);
        return fs.readFileSync(p, 'utf8');
    };
    return { manifest, read };
}

//  assemble() : le gabarit porte deux marqueurs, remplacés par la concaténation
//  ordonnée des modules. La fonction de remplacement est INDISPENSABLE :
//  passer la chaîne directement ferait interpréter les « $& », « $' », « $1 »
//  qu'elle contient (le code en est plein, notamment dans les regex et les
//  littéraux de gabarit) comme des motifs de remplacement.
function assemble() {
    const { manifest, read } = load();
    const template = read(manifest.template);
    for (const marker of ['@@STYLES@@', '@@SCRIPTS@@']) {
        if (!template.includes(marker + '\n')) throw new Error(`marqueur ${marker} absent du gabarit`);
    }
    const styles = manifest.styles.map(m => read(m.file)).join('');
    const scripts = manifest.scripts.map(m => read(m.file)).join('');
    return template
        .replace('@@STYLES@@\n', () => styles)
        .replace('@@SCRIPTS@@\n', () => scripts);
}

function main() {
    const check = process.argv.includes('--check');
    const { manifest } = load();
    const out = assemble();
    const target = path.join(ROOT, manifest.output);
    const previous = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : null;

    if (check) {
        if (previous === null) {
            console.error(`ECHEC : ${manifest.output} est absent — lancez « node scripts/build.js ».`);
            process.exit(1);
        }
        if (previous !== out) {
            console.error(`ECHEC : ${manifest.output} ne correspond plus à src/.`);
            console.error('           Cause probable : le fichier généré a été modifié à la main.');
            console.error('           Les modules de src/ sont la source de vérité ; vart.html est un artefact.');
            process.exit(1);
        }
        console.log(`ok ${manifest.output} est à jour (${Buffer.byteLength(out)} octets, ${countModules(manifest)} modules).`);
        return;
    }

    fs.writeFileSync(target, out);
    const lines = out.split('\n').length - (out.endsWith('\n') ? 1 : 0);
    console.log(`ok ${manifest.output} généré : ${lines} lignes, ${Buffer.byteLength(out)} octets`);
    console.log(`   styles  : ${manifest.styles.length} modules`);
    console.log(`   scripts : ${manifest.scripts.length} modules`);
    if (previous !== null && previous !== out) {
        console.log('   (contenu différent de la version précédente)');
    }
    console.log('   ATTENTION : fichier GÉNÉRÉ — éditez src/, pas vart.html.');
}

const countModules = (m) => m.styles.length + m.scripts.length;

if (require.main === module) main();
module.exports = { assemble, load, ROOT };
