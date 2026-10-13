// Copia l'app web (cartella principale del repository) in nativa/www
// per impacchettarla nell'app per App Store e Google Play.
import fs from 'fs';
import path from 'path';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const OUT = path.resolve(ROOT, 'nativa/www');
const FILE = ['index.html', 'i18n.js', 'app.js', 'ai.js', 'style.css', 'lib-supabase.js', 'lib-pdf.min.js', 'lib-pdf.worker.min.js', 'lib-pdf-lib.min.js',
  'logo.svg', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png', 'apple-touch-icon.png', 'manifest.json'];
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
for (const f of FILE) fs.copyFileSync(path.join(ROOT, f), path.join(OUT, f));
// traduzioni (inglese, spagnolo, francese, tedesco)
fs.mkdirSync(path.join(OUT, 'i18n'), { recursive: true });
for (const f of fs.readdirSync(path.join(ROOT, 'i18n')).filter(x => x.endsWith('.js'))) fs.copyFileSync(path.join(ROOT, 'i18n', f), path.join(OUT, 'i18n', f));
// nell'app nativa non serve il service worker del sito
let html = fs.readFileSync(path.join(OUT, 'index.html'), 'utf8');
html = html.replace('<html', '<html data-native="1"');
fs.writeFileSync(path.join(OUT, 'index.html'), html);
console.log('Copiati ' + FILE.length + ' file in nativa/www');
