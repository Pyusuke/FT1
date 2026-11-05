// docs/manual.md から docs/manual.pdf を作る（Chromium の印刷機能を使用）。
// 使い方: npm install --no-save marked@12.0.2 playwright && node scripts/build-manual-pdf.mjs
// 日本語フォント（IPA ゴシック等）がある環境で実行すること。
import fs from 'fs';
import { marked } from 'marked';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PW || 'playwright');

const DOCS = new URL('../docs/', import.meta.url).pathname;
let md = fs.readFileSync(DOCS + 'manual.md', 'utf8');
// 先頭のタイトル行は表紙に回す
md = md.replace(/^# .*\n/, '');
const slug = (t) => t.toLowerCase().replace(/<[^>]+>/g, '').replace(/[^\p{L}\p{N}\s-]/gu, '').trim().replace(/\s/g, '-');
const renderer = new marked.Renderer();
renderer.heading = (text, level, raw) => `<h${level} id="${slug(raw)}">${text}</h${level}>`;
let body = marked.parse(md, { renderer });
body = body.replace(/<a href="(?!https?:|#)[^"]*">([^<]*)<\/a>/g, '$1（docs フォルダ内）');
body = body.replace(/src="images\//g, `src="file://${DOCS}images/`);
const today = new Date().toISOString().slice(0, 10);
const html = `<!doctype html><html lang="ja"><head><meta charset="utf-8"><style>
@page { size: A4; margin: 16mm 15mm 18mm; }
body { font-family: 'IPAPGothic','IPAGothic',sans-serif; font-size: 10.5pt; line-height: 1.7; color: #1d2330; }
.cover { height: 250mm; display: flex; flex-direction: column; justify-content: center; page-break-after: always; }
.cover h1 { font-size: 26pt; margin: 0 0 6mm; line-height: 1.3; }
.cover .sub { font-size: 15pt; color: #5d6677; margin-bottom: 14mm; }
.cover .url { font-size: 14pt; border: 2px solid #2a62c9; border-radius: 6px; padding: 5mm 7mm; display: inline-block; color: #2a62c9; }
.cover .meta { margin-top: 14mm; color: #5d6677; }
.cover .disc { margin-top: 30mm; background: #fff4d6; border: 2px solid #e0b030; border-radius: 6px; padding: 4mm 6mm; font-weight: 700; }
h2 { font-size: 16pt; border-bottom: 3px solid #2a62c9; padding-bottom: 1.5mm; margin-top: 0; page-break-before: always; }
h2#目次, h2#ツールを開くhttpsft-1-sixvercelapp { page-break-before: avoid; }
h3 { font-size: 12.5pt; margin: 7mm 0 2mm; border-left: 5px solid #2a62c9; padding-left: 3mm; page-break-after: avoid; }
table { border-collapse: collapse; width: 100%; margin: 3mm 0; font-size: 9.5pt; page-break-inside: avoid; }
th, td { border: 1px solid #cfd5df; padding: 1.5mm 2.5mm; text-align: left; vertical-align: top; }
th { background: #eef3fc; }
img { max-width: 100%; border: 1px solid #d9dde5; border-radius: 4px; page-break-inside: avoid; display: block; margin: 3mm auto; }
p:has(img) { page-break-inside: avoid; }
blockquote { margin: 3mm 0; padding: 2mm 4mm; background: #f3f5f8; border-left: 4px solid #8a93a3; color: #3b4352; }
code { font-family: 'IPAGothic', monospace; background: #f3f5f8; padding: 0 1mm; border-radius: 2px; }
pre { background: #f3f5f8; padding: 3mm; border-radius: 4px; page-break-inside: avoid; }
pre code { padding: 0; }
a { color: #2a62c9; text-decoration: none; }
hr { display: none; }
li { margin: 1mm 0; }
</style></head><body>
<div class="cover">
  <h1>Motor Strategy Playground<br>（運動戦略プレイグラウンド）</h1>
  <div class="sub">使い方ガイド</div>
  <div><span class="url">https://ft-1-six.vercel.app/</span></div>
  <div class="meta">ブラウザで上の URL を開くだけで使えます（インストール不要）<br>作成日：${today}</div>
  <div class="disc">本ツールは研究仮説を理解するための概念モデルです。人の身体や特定の研究結果を再現したものではありません。</div>
</div>
${body}
</body></html>`;
const OUT_HTML = process.env.OUT_HTML || '/tmp/manual-print.html';
fs.writeFileSync(OUT_HTML, html);
const b = await chromium.launch();
const p = await b.newPage();
await p.goto('file://' + OUT_HTML, { waitUntil: 'load' });
await p.pdf({
  path: DOCS + 'manual.pdf', format: 'A4', printBackground: true, preferCSSPageSize: true,
  displayHeaderFooter: true,
  headerTemplate: '<div></div>',
  footerTemplate: '<div style="width:100%;font-size:8pt;color:#8a93a3;text-align:center;font-family:IPAPGothic">Motor Strategy Playground 使い方ガイド ― <span class="pageNumber"></span> / <span class="totalPages"></span></div>',
});
await b.close();
console.log('done');
