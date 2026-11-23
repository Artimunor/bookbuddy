import type { Subprocess } from 'bun';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir, homedir } from 'node:os';
import { dirname, resolve, join, extname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Uses only Bun and existing local Chromium/Mermaid installations. No network or packages.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const design = join(root, 'design');
const output = join(root, 'exports/bookbuddy-design.pdf');
const home = homedir();
const sources = new Map<string, string>();
const running = new Set<Subprocess<'ignore', 'pipe', 'pipe'>>();
const temp = await mkdtemp(join(tmpdir(), 'bookbuddy-design-'));
const escape = (text: string) => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const hash = (text: string) => createHash('sha256').update(text).digest('hex');

async function existing(candidates: string[], label: string): Promise<string> {
  for (const candidate of candidates) if (candidate && await Bun.file(candidate).exists()) return candidate;
  throw new Error(`No installed ${label} found. Set ${label === 'Chromium' ? 'BOOKBUDDY_CHROMIUM' : 'BOOKBUDDY_MERMAID'} to an existing local file; nothing is downloaded.`);
}
async function command(args: string[], seconds = 180): Promise<string> {
  const child = Bun.spawn(args, { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe', cwd: root });
  running.add(child);
  const timer = setTimeout(() => child.kill('SIGTERM'), seconds * 1000);
  try {
    const [stdout, stderr, exit] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    if (exit !== 0) throw new Error(`${args[0]} exited ${exit}: ${stderr.slice(-5000)}`);
    return stdout;
  } finally { clearTimeout(timer); running.delete(child); }
}
async function snapshot(relative: string): Promise<string> {
  const content = await Bun.file(join(design, relative)).text();
  sources.set(relative, content);
  return content;
}
function markdown(text: string, relative: string): string {
  // Mermaid treats literal semicolons as statement separators even inside messages.
  // Its entity syntax preserves the source punctuation without editing the Markdown.
  text = text.replace(/```mermaid\s*\n(sequenceDiagram[\s\S]*?)```/g, (_, diagram: string) =>
    '```mermaid\n' + diagram.split('\n').map(line => line.includes('->') && line.includes(':') ? line.replaceAll(';', '#59;') : line).join('\n') + '```');
  const html = Bun.markdown.html(text);
  return html.replace(/href="([^"#]+)(#[^"]*)?"/g, (_, target: string, anchor = '') => {
    if (/^[a-z][a-z\d+.-]*:/i.test(target)) return `href="${target}${anchor}"`;
    return `href="${pathToFileURL(resolve(design, dirname(relative), target)).href}${anchor}"`;
  }).replace(/<pre><code class="language-mermaid">([\s\S]*?)<\/code><\/pre>/g,
    '<figure class="diagram"><div class="mermaid">$1</div></figure>');
}
function removeImages(text: string): string {
  return text.replace(/^!\[[^\]]*\]\([^\n]*\)\s*$/gm, '').trim();
}
function diagrams(text: string): string[] {
  return [...text.matchAll(/```mermaid\s*\n([\s\S]*?)```/g)].map(match => match[1]);
}
function withoutDiagrams(text: string): string { return text.replace(/```mermaid\s*\n[\s\S]*?```/g, '').trim(); }
const css = `
@page { size: A4; margin: 14mm 14mm 15mm; }
@page map { size: A4 landscape; margin: 13mm 14mm; }
* { box-sizing: border-box; }
html { font-family: Arial, Helvetica, sans-serif; color:#152C26; font-size:9.5pt; line-height:1.36; print-color-adjust:exact; -webkit-print-color-adjust:exact; }
body { margin:0; }
h1,h2,h3,h4 { color:#0B6250; line-height:1.2; break-after:avoid; page-break-after:avoid; }
h1 { font-size:25pt; letter-spacing:-.5pt; margin:0 0 6mm; padding-bottom:4mm; border-bottom:2pt solid #0B6250; }
h2 { font-size:16pt; margin:6mm 0 3mm; }
h3 { font-size:12pt; margin:5mm 0 2.5mm; }
h4 { font-size:10pt; margin:3mm 0 2mm; }
p { margin:0 0 2.6mm; orphans:3; widows:3; }
ul,ol { margin:2mm 0 4mm; padding-left:5mm; }
li { margin:0 0 2.5mm; orphans:3; widows:3; }
a { color:#0B5747; text-decoration:none; overflow-wrap:anywhere; }
code { font-size:.91em; overflow-wrap:anywhere; }
table { table-layout:fixed; border-collapse:collapse; width:100%; margin:3mm 0 5mm; font-size:8pt; line-height:1.36; }
thead { display:table-header-group; }
tr { break-inside:avoid; page-break-inside:avoid; }
th,td { text-align:left; vertical-align:top; padding:1.8mm 2mm; border:.5pt solid #D4E1DB; overflow-wrap:anywhere; }
th { background:#DCF2EA; color:#0B5747; font-weight:700; }
tr:nth-child(even) td { background:#F4F7F6; }
#screens-inventory-md th:nth-child(1) { width:6%; }
#screens-inventory-md th:nth-child(2) { width:15%; }
#screens-inventory-md th:nth-child(3) { width:5%; }
#screens-inventory-md th:nth-child(4) { width:18%; }
#screens-inventory-md th:nth-child(5) { width:15%; }
#screens-inventory-md th:nth-child(6) { width:20%; }
#screens-inventory-md th:nth-child(7) { width:21%; }
blockquote { border-left:2pt solid #0B6250; padding:2mm 4mm; margin:3mm 0; background:#F4F7F6; }
.document,.screen,.appendix { break-before:page; page-break-before:always; }
.screen { display:flow-root; }
.cover { height:260mm; display:flex; flex-direction:column; justify-content:center; }
.cover h1 { font-size:38pt; line-height:1.15; margin-bottom:10mm; padding-bottom:9mm; }
.cover p { max-width:140mm; font-size:14pt; line-height:1.55; color:#425B52; }
.contents { break-before:page; min-height:260mm; }
.contents a { display:block; padding:3mm 0; border-bottom:.5pt solid #D4E1DB; font-size:12pt; }
.screen h1 { font-size:19pt; margin:0 0 5mm; padding-bottom:3mm; }
.mockup { float:left; width:45%; margin:0 6mm 4mm 0; break-inside:avoid; page-break-inside:avoid; }
.mockup img { display:block; width:100%; height:auto; max-height:237mm; object-fit:contain; object-position:top; }
.screen .explanation { display:contents; }
.screen li { margin-bottom:2.6mm; }
.screen ul { padding-left:0; list-style:none; }
.screen table { clear:both; }
.diagram { margin:4mm 0 5mm; padding:3mm; border:.5pt solid #D4E1DB; background:#FAFCFB; border-radius:3mm; break-inside:avoid; page-break-inside:avoid; text-align:center; }
.diagram svg { display:block; max-width:100% !important; width:auto !important; height:auto; max-height:225mm; margin:auto; }
.map-page { page:map; break-before:page; break-after:page; }
.map-page h1 { font-size:18pt; }
.map-page h2 { font-size:12pt; margin:0 0 3mm; }
.map-page .diagram { margin:0; }
.map-page svg { max-height:145mm; max-width:260mm !important; }
`;

try {
  if (typeof Bun.markdown?.html !== 'function') throw new Error('This installed Bun does not support Bun.markdown.html.');
  // Never the user's own Google Chrome: only standalone Chromium or test/headless builds.
  const browserCandidates = [process.env.BOOKBUDDY_CHROMIUM ?? '', '/Applications/Chromium.app/Contents/MacOS/Chromium'];
  for await (const name of new Bun.Glob('chromium_headless_shell-*/chrome-headless-shell-mac-arm64/chrome-headless-shell').scan(join(home, 'Library/Caches/ms-playwright'))) browserCandidates.push(join(home, 'Library/Caches/ms-playwright', name));
  const chromium = await existing(browserCandidates, 'Chromium');
  const mermaidPath = await existing([process.env.BOOKBUDDY_MERMAID ?? '', join(home, 'workspace/projects/mouseion/node_modules/.bun/mermaid@11.14.0/node_modules/mermaid/dist/mermaid.min.js')], 'Mermaid');
  const mermaidBundle = await Bun.file(mermaidPath).text();
  const readme = await snapshot('README.md');
  const documents = ['foundation/personas-and-roles.md', 'foundation/information-architecture.md', 'foundation/core-flows.md', 'system/design-system.md', 'screens/inventory.md'];
  for (const document of documents) await snapshot(document);
  const specFiles = (await Array.fromAsync(new Bun.Glob('screens/**/*-specs.md').scan(design))).sort();
  if (specFiles.length !== 9) throw new Error(`Expected nine specification files, found ${specFiles.length}.`);
  for (const file of specFiles) await snapshot(file);
  const svgFiles = (await Array.fromAsync(new Bun.Glob('screens/**/*.svg').scan(design))).sort();
  for (const file of svgFiles) await snapshot(file);
  const gallery = [...readme.matchAll(/<img\s+src="([^"]+\.svg)"[^>]*alt="([^"]*)"/g)].map(match => ({ file: match[1], title: match[2], id: match[1].match(/\/([CFWSPL]-\d{2})-/)![1] }));
  const galleryFiles = new Set(gallery.map(screen => screen.file));
  if (galleryFiles.size !== gallery.length || svgFiles.some(file => !galleryFiles.has(file)) || galleryFiles.size !== svgFiles.length) throw new Error('The gallery must list every screen SVG exactly once.');
  type Spec = { file: string; title: string; preamble: string; screens: Map<string, string>; questions: string; navigation: string[] };
  const specs: Spec[] = [];
  const screenSpecs = new Map<string, { spec: Spec; text: string }>();
  for (const file of specFiles) {
    const source = sources.get(file)!;
    const title = source.match(/^# (.+)$/m)![1];
    const sections = source.split(/(?=^## )/m);
    const preamble: string[] = []; const appendix: string[] = [];
    const spec: Spec = { file, title, preamble: '', screens: new Map(), questions: '', navigation: diagrams(source) };
    for (const section of sections) {
      const heading = section.match(/^## (.+)$/m)?.[1];
      const id = heading?.match(/^([CFWSPL]-\d{2})\b/)?.[1];
      if (id) {
        if (screenSpecs.has(id)) throw new Error(`Duplicate spec heading for ${id}.`);
        const text = withoutDiagrams(removeImages(section.replace(/^## .+\n/, '')));
        spec.screens.set(id, text); screenSpecs.set(id, { spec, text });
      } else if (heading && /^(Open design questions|Review responses)\b/i.test(heading)) appendix.push(withoutDiagrams(section));
      else if (!heading || !/^Navigation\b/i.test(heading)) preamble.push(withoutDiagrams(section));
    }
    spec.preamble = preamble.filter(Boolean).join('\n\n');
    spec.questions = appendix.filter(Boolean).join('\n\n');
    specs.push(spec);
  }
  for (const screen of gallery) if (!screenSpecs.has(screen.id)) throw new Error(`No specification section matches ${screen.file} (${screen.id}).`);
  for (const id of screenSpecs.keys()) if (!gallery.some(screen => screen.id === id)) throw new Error(`Specification ${id} has no gallery mockup.`);
  const snapshotID = hash([...sources].map(([name, content]) => name + '\0' + hash(content)).join('\n'));
  const chapters = [{ title:'Customer', prefix:'C' }, {title:'Foreman',prefix:'F'}, {title:'Worker',prefix:'W'}, {title:'Shared',prefix:'S'}, {title:'Provider admin (P-)',prefix:'P'}, {title:'Later categories (L-)',prefix:'L'}];
  const links = documents.map(file => ({ id:file.replaceAll(/[^a-z\d]/gi,'-'), title:sources.get(file)!.match(/^# (.+)$/m)![1] }));
  const coverIntro = readme.split('\n\n')[1];
  let body = `<section class="cover"><h1>BookBuddy: app design</h1>${markdown(coverIntro,'README.md')}</section><section class="contents"><h1>BookBuddy app design</h1>${links.map(item => `<a href="#${item.id}">${escape(item.title)}</a>`).join('')}${chapters.map(chapter => `<a href="#chapter-${chapter.prefix}">${escape(chapter.title)}</a>`).join('')}<a href="#questions">Open design questions</a></section>`;
  for (const file of documents) body += `<section class="document" id="${file.replaceAll(/[^a-z\d]/gi,'-')}">${markdown(sources.get(file)!,file)}</section>`;
  for (const chapter of chapters) {
    const chapterSpecs = specs.filter(spec => [...spec.screens.keys()].some(id => id.startsWith(chapter.prefix + '-')));
    let firstMap = true;
    for (const spec of chapterSpecs) for (const diagram of spec.navigation) {
      body += `<section class="map-page"${firstMap ? ` id="chapter-${chapter.prefix}"` : ''}><h1>${escape(firstMap ? chapter.title : spec.title)}</h1>${firstMap ? `<h2>${escape(spec.title)}</h2>` : ''}${markdown('```mermaid\n'+diagram+'\n```',spec.file)}</section>`;
      firstMap = false;
    }
    if (firstMap) throw new Error(`No navigation diagram for ${chapter.title}.`);
    for (const spec of chapterSpecs) if (spec.preamble) body += `<section class="document">${markdown(spec.preamble,spec.file)}</section>`;
    for (const screen of gallery.filter(item => item.id.startsWith(chapter.prefix + '-'))) {
      const { spec, text } = screenSpecs.get(screen.id)!;
      const variant = screen.file.includes('--');
      const blocks = text.split(/\n\s*\n/);
      const tokens = screen.file.split('--')[1]?.replace('.svg','').split('-').filter(token=>token.length > 3) ?? [];
      const relevant = blocks.filter(block => /\*\*[^*]*(?:state|edge|recovery|offline|geofence|platform|RTL|material change|interaction)[^*]*\*\*/i.test(block) || tokens.some(token => block.toLowerCase().includes(token)));
      const explanation = variant && relevant.length ? relevant.join('\n\n') : text;
      body += `<section class="screen" id="${escape(screen.file.replaceAll(/[^a-z\d]/gi,'-'))}"><h1>${escape(screen.title)}</h1><figure class="mockup"><img alt="${escape(screen.title)}" src="data:image/svg+xml;base64,${Buffer.from(sources.get(screen.file)!).toString('base64')}"></figure><div class="explanation">${markdown(explanation,spec.file)}</div></section>`;
    }
  }
  body += '<section class="appendix" id="questions"><h1>Open design questions</h1></section>';
  for (const spec of specs) if (spec.questions) body += `<section class="document"><h1>${escape(spec.title)}</h1>${markdown(spec.questions,spec.file)}</section>`;
  const script = `(async()=>{
    try {
      mermaid.initialize({startOnLoad:false,securityLevel:'loose',theme:'base',fontFamily:'Arial, Helvetica, sans-serif',themeVariables:{primaryColor:'#DCF2EA',primaryTextColor:'#152C26',primaryBorderColor:'#70877D',lineColor:'#425B52',secondaryColor:'#F4F7F6',tertiaryColor:'#EBF2EF',fontSize:'16px',actorBkg:'#DCF2EA',actorTextColor:'#152C26',actorBorder:'#70877D',signalColor:'#425B52',signalTextColor:'#152C26'},flowchart:{htmlLabels:true,curve:'basis',nodeSpacing:18,rankSpacing:35,padding:10,wrappingWidth:155,useMaxWidth:true},sequence:{wrap:true,width:130,actorMargin:30,messageFontSize:15,actorFontSize:16,wrapPadding:8,useMaxWidth:true}});
      for (const [index, element] of [...document.querySelectorAll('.mermaid')].entries()) {
        try { await mermaid.run({nodes:[element]}); }
        catch (error) { throw new Error('Diagram '+(index+1)+': '+JSON.stringify(error)); }
      }
      await document.fonts.ready;
      await Promise.all([...document.images].map(img=>img.decode()));
      document.documentElement.dataset.ready='true';
      document.documentElement.dataset.mockups=String(document.querySelectorAll('.mockup img').length);
      document.documentElement.dataset.diagrams=String(document.querySelectorAll('.mermaid svg').length);
    } catch(error) { document.documentElement.dataset.error=error.message || JSON.stringify(error); }
  })();`;
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; font-src data:;"><title>BookBuddy: app design</title><style>${css}</style></head><body>${body}<script>${mermaidBundle}</script><script>${script}</script></body></html>`;
  await Bun.write(join(temp,'render.html'), html);
  const flags = ['--headless','--no-sandbox','--disable-gpu','--disable-background-networking','--disable-component-update','--no-first-run','--no-default-browser-check',`--user-data-dir=${join(temp,'profile')}`];
  const rendered = await command([chromium,...flags,'--virtual-time-budget=60000','--dump-dom',pathToFileURL(join(temp,'render.html')).href]);
  const error = rendered.match(/data-error="([^"]*)"/)?.[1];
  if (error || !rendered.includes('data-ready="true"')) throw new Error(`Rendering did not finish: ${error ?? 'missing ready flag'}`);
  if (!rendered.includes(`data-mockups="${gallery.length}"`)) throw new Error('Not every mockup decoded.');
  const expectedDiagrams = (body.match(/class="mermaid"/g) ?? []).length;
  if (!rendered.includes(`data-diagrams="${expectedDiagrams}"`)) throw new Error('Not every Mermaid diagram rendered.');
  await Bun.write(join(temp,'print.html'), rendered.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,''));
  await command([chromium,...flags,'--virtual-time-budget=1000','--no-pdf-header-footer',`--print-to-pdf=${join(temp,'book.pdf')}`,pathToFileURL(join(temp,'print.html')).href]);
  const pdf = Bun.file(join(temp,'book.pdf'));
  if (pdf.size < 100_000 || !(await pdf.slice(0,5).text()).startsWith('%PDF-')) throw new Error('Chromium did not produce a non-trivial PDF.');
  for (const [file, content] of sources) if (hash(await Bun.file(join(design,file)).text()) !== hash(content)) throw new Error(`Source changed during export: ${file}. Rebuild after edits settle; prior PDF is untouched.`);
  await mkdir(dirname(output),{recursive:true});
  await Bun.write(output,pdf);
  console.log(JSON.stringify({output,bytes:pdf.size,mockups:gallery.length,screenSpecifications:screenSpecs.size,diagrams:expectedDiagrams,sourceSnapshot:snapshotID,chromium,mermaid:mermaidPath},null,2));
} finally {
  for (const child of running) child.kill('SIGTERM');
  await Promise.all([...running].map(child=>child.exited));
  await rm(temp,{recursive:true,force:true});
}
