import type { Subprocess } from 'bun';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir, homedir } from 'node:os';
import { dirname, resolve, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

// No dependencies or network: Bun plus existing local Chromium and Mermaid.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { values } = parseArgs({
  args: Bun.argv.slice(2), strict: true, allowPositionals: false,
  options: {
    source: { type: 'string', default: 'design' },
    out: { type: 'string', default: 'exports/bookbuddy-design.pdf' },
    title: { type: 'string', default: 'BookBuddy: app design' },
  },
});
const design = resolve(root, values.source);
const output = resolve(root, values.out);
const bookTitle = values.title;
const sourceLabel = relative(root, design) || '.';
const home = homedir();
const sources = new Map<string, string>();
const running = new Set<Subprocess<'ignore', 'pipe', 'pipe'>>();
const temp = await mkdtemp(join(tmpdir(), 'bookbuddy-design-'));
const escape = (text: string) => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
type Spec = { file: string; title: string; questions: string; navigation: string[] };
type Screen = { file: string; title: string; id: string; purpose: string; ownsSystemChrome: boolean };
type InventoryEntry = { id: string; name: string; purpose: string; deferred: boolean; ownsSystemChrome: boolean };
type Diagram = { title: string; source: string; file: string };
const stateNames: Record<string, string> = {
  rtl: 'RTL', ios: 'iOS', android: 'Android', os: 'OS', ui: 'UI',
  arabic: 'Arabic', english: 'English', spanish: 'Spanish', french: 'French', portuguese: 'Portuguese',
};

function inventoryEntries(text: string): InventoryEntry[] {
  const entries: InventoryEntry[] = [];
  const headings: { depth: number; title: string }[] = [];
  const seen = new Set<string>();
  for (const line of text.split('\n')) {
    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      while (headings.at(-1) && headings.at(-1)!.depth >= heading[1].length) headings.pop();
      headings.push({ depth: heading[1].length, title: heading[2] });
    }
    const row = line.match(/^\|\s*(?:\*\*)?([CFWSPL]-\d{2})(?:\*\*)?(?:\s*★)?\s*\|\s*([^|]+)\|/);
    if (!row) continue;
    if (seen.has(row[1])) throw new Error(`Duplicate inventory ID: ${row[1]}.`);
    seen.add(row[1]);
    const deferred = headings.some(item => /^Later\b/i.test(item.title))
      || /\[Later\]|\blater only\b/i.test(row[2])
      || /\bunbuilt\b|\bnot (?:yet )?(?:built|drawn)\b/i.test(line);
    // OS/System surfaces supply their own platform chrome. Preserve it verbatim:
    // an export-frame Island could hide a native Island or an Android status date.
    // This inventory marker applies to every primary/state, without track-specific IDs.
    const ownsSystemChrome = /\[(?:OS|System)\b/i.test(row[2]);
    entries.push({ id: row[1], name: row[2].trim(), purpose: line.split('|')[4]?.trim() ?? '', deferred, ownsSystemChrome });
  }
  if (!entries.length) throw new Error(`No screen ID rows found in ${sourceLabel}/screens/inventory.md.`);
  return entries;
}

async function existing(candidates: string[], label: string) {
  for (const candidate of candidates) if (candidate && await Bun.file(candidate).exists()) return candidate;
  throw new Error(`No installed ${label}. Set BOOKBUDDY_${label.toUpperCase()} to an existing local file. Nothing is downloaded.`);
}
async function command(args: string[], seconds = 180) {
  const child = Bun.spawn(args, { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe', cwd: root });
  running.add(child);
  const timer = setTimeout(() => child.kill('SIGTERM'), seconds * 1000);
  try {
    const [stdout, stderr, exit] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    if (exit !== 0) throw new Error(`${args[0]} exited ${exit}: ${stderr.slice(-5000)}`);
    return stdout;
  } finally { clearTimeout(timer); running.delete(child); }
}
async function snapshot(relative: string) {
  const text = await Bun.file(join(design, relative)).text();
  sources.set(relative, text);
  return text;
}
function plain(text: string) {
  return text.replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/(?:\*\*|`)/g, '').replace(/^\s*[-*]\s+/gm, '').replace(/\s+/g, ' ').trim();
}
function excerpt(text: string, length = 145) {
  return shortenSentence(plain(text), length);
}
function shortenSentence(cleaned: string, length: number) {
  const sentence = cleaned.split(/(?<=[.!?])\s+(?=[A-Z‘“])/)[0];
  if (sentence.length <= length) return sentence;
  const clause = sentence.split(/[;:]/)[0];
  return clause.length <= length ? clause : clause.slice(0, length).replace(/\s+\S*$/, '');
}
function captionInline(text: string, length = 130) {
  const source = text.replace(/\s+/g, ' ').trim();
  const ignored = { html: () => '', image: () => '' };
  let remaining = shortenSentence(Bun.markdown.render(source, ignored), length).length;
  return Bun.markdown.render(source, {
    ...ignored,
    text: (value: string) => {
      const kept = value.slice(0, remaining);
      remaining -= kept.length;
      return escape(kept);
    },
    strong: (children: string) => children ? `<strong>${children}</strong>` : '',
    emphasis: (children: string) => children ? `<em>${children}</em>` : '',
    codespan: (children: string) => children ? `<code>${children}</code>` : '',
  });
}
function stateLabel(file: string) {
  const suffix = file.split('--')[1]?.replace(/\.svg$/, '');
  if (!suffix) return '';
  return suffix.split('-').map((word, index) =>
    stateNames[word.toLowerCase()] ?? (index === 0 ? word.charAt(0).toUpperCase() + word.slice(1) : word)
  ).join(' ');
}
function markdown(text: string, relative: string) {
  return Bun.markdown.html(text).replace(/href="([^"#]+)(#[^"]*)?"/g, (_, target: string, anchor = '') =>
    `href="${/^[a-z][a-z\d+.-]*:/i.test(target) ? target : pathToFileURL(resolve(design, dirname(relative), target)).href}${anchor}"`);
}
function diagramBlocks(text: string, file: string): Diagram[] {
  const results: Diagram[] = [];
  let title = text.match(/^# (.+)$/m)?.[1] ?? '';
  let active = false; let source: string[] = [];
  for (const line of text.split('\n')) {
    if (!active && /^#{1,3} /.test(line)) title = line.replace(/^#+ /, '');
    if (line.startsWith('```mermaid')) { active = true; source = []; }
    else if (active && line.startsWith('```')) { results.push({ title, source: source.join('\n'), file }); active = false; }
    else if (active) source.push(line);
  }
  return results;
}
function sequencePanels(source: string): string[] {
  if (!source.startsWith('sequenceDiagram')) return [source];
  const lines=source.split('\n').map(line=>line.trim()).filter(Boolean);
  const participants=lines.filter(line=>/^(participant|actor) /.test(line));
  type Context = { id:number; kind:string; label:string };
  type Message = { line:string; phase:string; contexts:Context[] };
  const stack:Context[]=[],events:Message[]=[];
  let blockID=0,currentPhase='';
  const phase=(line:string)=>{
    if(/C-0[2345]\b|F-03\b|Request sent|request.*send/i.test(line))return 'request';
    if(/F-04\b|C-0[67]\b|quote version|review scope/i.test(line))return 'quote';
    if(/F-06\b|C-08\b|service window|assessment/i.test(line))return 'schedule';
    if(/C-09\b|named crew|actual progress/i.test(line))return 'job day';
    if(/F-14\b|C-10\b|C-12\b|sign.off|Close service/i.test(line))return 'completion';
    if(/C-11\b|payment|Pay through|receipt|bill when due/i.test(line))return 'payment';
    if(/C-16\b|reports an issue|unresolved/i.test(line))return 'issue';
    if(/F-11\b|external|Own team exhausted|local provider route/i.test(line))return 'external';
    if(/own.*team|internal offer/i.test(line))return 'own team';
    if(/F-12\b|Confirm named worker|Still valid|confirm assignment|Crew confirmed/i.test(line))return 'confirmation';
    if(/No longer eligible|All offers|escalate|revised plan|No cover confirmed/i.test(line))return 'escalation';
    if(/F-10\b|Set required task/i.test(line))return 'gap';
    if(/S-10\b|preferred translation|source immediately/i.test(line))return 'conversation';
    if(/Source misunderstood|clarification|Post a correction/i.test(line))return 'clarification';
    if(/S-11\b|Display version|Cannot understand/i.test(line))return 'instruction';
    if(/Human briefing|Explain back|Verify understanding/i.test(line))return 'understanding';
    if(/acknowledge|Record named person/i.test(line))return 'acknowledgement';
    if(/L-06\b/i.test(line))return 'publication';
    if(/L-0[12]\b/i.test(line))return 'browse';
    if(/L-03\b|short hold/i.test(line))return 'slot';
    if(/L-04\b|Capacity and payment|L-05\b|occupied capacity/i.test(line))return 'booking';
    if(/Hold expires|not booked|Customer needs a change|Reschedule/i.test(line))return 'change';
    return '';
  };
  for(const line of lines.slice(1)){
    if(/^(participant|actor) /.test(line))continue;
    const block=line.match(/^(opt|alt|loop|critical|break)\s+(.*)$/);
    if(block){stack.push({id:++blockID,kind:block[1],label:block[2]});continue;}
    if(/^else\b/.test(line)){if(stack.at(-1)?.kind!=='alt')return [source];stack.at(-1)!.label=line.replace(/^else\s*/,'');continue;}
    if(line==='end'){if(!stack.length)return [source];stack.pop();continue;}
    if(!/^[\w]+\s*(?:--?>>|--?>|--?x|--?\))\s*[\w]+\s*:/.test(line))return [source];
    currentPhase=phase(line)||phase(stack.at(-1)?.label??'')||currentPhase;
    events.push({line,phase:currentPhase,contexts:stack.map(context=>({...context}))});
  }
  if(stack.length)return [source];
  const groups:Message[][]=[];
  for(const event of events){
    const group=groups.at(-1),previous=group?.at(-1);
    const branchChanged=previous?.contexts.some(old=>event.contexts.some(context=>context.id===old.id&&context.label!==old.label));
    if(!previous||previous.phase!==event.phase||branchChanged)groups.push([event]);else group!.push(event);
  }
  const panels=groups.map(group=>{
    const body=['sequenceDiagram',...participants];let opened:Context[]=[];
    for(const event of group){
      let common=0;
      while(common<opened.length&&common<event.contexts.length&&opened[common].id===event.contexts[common].id&&opened[common].label===event.contexts[common].label)common++;
      for(let i=opened.length;i>common;i--)body.push('end');
      body.push(...event.contexts.slice(common).map(context=>context.kind+' '+context.label),event.line);
      opened=event.contexts;
    }
    body.push(...opened.map(()=>'end'));
    return body.join('\n');
  });
  const originalMessages=lines.filter(line=>/^[\w]+\s*[-]+[>x)]/.test(line)).length;
  if(originalMessages!==events.length)throw new Error('Sequence split lost or duplicated messages.');
  return panels.length?panels:[source];
}
function caption(text: string, screen: Screen) {
  const blocks = text.split(/\n\s*\n|\n(?=\s*-\s+\*\*)/).map(block => {
    const label = block.match(/\*\*([^*]+)\*\*/)?.[1] ?? '';
    return { label, text: block.replace(/^\s*-?\s*\*\*[^*]+\*\*\s*/, '').replace(/\s+/g, ' ').trim() };
  });
  const purpose = blocks.find(block => /purpose/i.test(block.label));
  if (!purpose && !screen.purpose) throw new Error(`Missing spec/inventory purpose: ${screen.id}.`);
  const tokens = screen.file.split('--')[1]?.replace('.svg', '').split('-').filter(token => token.length > 3) ?? [];
  const candidates = blocks.filter(block => /interaction|action|state|recovery|geofence|offline|material change/i.test(block.label))
    .flatMap(block => block.text.split(/(?<=[.!?])\s+(?=[A-Z‘“])/));
  if (tokens.includes('arabic')) candidates.unshift(...blocks.flatMap(block => block.text.split(/(?<=[.!?])\s+(?=[A-Z‘“])/)).filter(sentence => /Arabic artboard/i.test(sentence)));
  const ranked = candidates.map((sentence, index) => ({ sentence, index, score: tokens.reduce((score, token) => score + (sentence.toLowerCase().includes(token) ? 5 : 0), 0) }));
  ranked.sort((a, b) => b.score - a.score || a.index - b.index);
  const bullets = [...new Set(ranked.map(item => captionInline(item.sentence)).filter(Boolean))].slice(0, 4);
  return { purpose: captionInline(purpose?.text ?? screen.purpose), bullets };
}
function phone(source: string, ownsSystemChrome: boolean) {
  if (!/viewBox="0 0 390 844"/.test(source)) throw new Error('Mockups must use the 390×844 display viewport.');
  const mockup = source.replace(/<\?xml[^>]*\?>/g, '').replace(/<svg\b/, '<svg x="30" y="28"');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="450" height="908" viewBox="0 0 450 908">
  <defs>
    <linearGradient id="bb-titanium" x1="0" x2="1"><stop stop-color="#747573"/><stop offset=".08" stop-color="#dedbd4"/><stop offset=".45" stop-color="#a5a29b"/><stop offset=".93" stop-color="#d5d2ca"/><stop offset="1" stop-color="#71726f"/></linearGradient>
    <linearGradient id="bb-edge" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#f3f0e8"/><stop offset=".45" stop-color="#b4b2ac"/><stop offset="1" stop-color="#666862"/></linearGradient>
    <filter id="bb-shadow" x="-25%" y="-15%" width="150%" height="135%"><feDropShadow dx="0" dy="9" stdDeviation="9" flood-color="#152C26" flood-opacity=".19"/></filter>
    <clipPath id="bb-display"><rect x="30" y="28" width="390" height="844" rx="51"/></clipPath>
  </defs>
  <rect x="18" y="16" width="414" height="870" rx="65" fill="#252725" filter="url(#bb-shadow)"/>
  <g fill="url(#bb-titanium)" stroke="#747570" stroke-width=".7">
    <rect x="11" y="155" width="7" height="35" rx="3"/><rect x="10" y="219" width="8" height="62" rx="3"/><rect x="10" y="295" width="8" height="62" rx="3"/>
    <rect x="432" y="217" width="8" height="90" rx="3"/><rect x="432" y="621" width="8" height="53" rx="3"/>
  </g>
  <rect x="17" y="14" width="416" height="872" rx="65" fill="url(#bb-titanium)" stroke="url(#bb-edge)" stroke-width="2"/>
  <rect x="21" y="18" width="408" height="864" rx="61" fill="#090a0a" stroke="#20211f" stroke-width="1"/>
  <g clip-path="url(#bb-display)">${mockup}</g>
  ${ownsSystemChrome ? '' : `<rect x="168" y="36" width="114" height="30" rx="15" fill="#060707"/>
  <circle cx="266" cy="51" r="5" fill="#12161c"/><circle cx="266" cy="51" r="2.4" fill="#1b2330"/>`}
  <rect x="18.5" y="15.5" width="413" height="869" rx="64" fill="none" stroke="#f0eee7" stroke-opacity=".38" stroke-width=".7"/>
  </svg>`;
}
let pageNumber = 0;
function page(content: string, file: string, options: { id?: string; className?: string } = {}) {
  pageNumber++;
  return `<section class="page ${options.className ?? ''}"${options.id ? ` id="${options.id}"` : ''}>${content}<footer><a href="${pathToFileURL(join(design,file)).href}">Full spec: ${escape(relative(root,join(design,file)))}</a><span>${pageNumber}</span></footer></section>`;
}
const css = `
@page { size:A4; margin:0; } @page wide { size:A4 landscape; margin:0; }
* { box-sizing:border-box; } html { font-family:Arial,Helvetica,sans-serif; color:#152C26; font-size:10pt; line-height:1.45; print-color-adjust:exact; -webkit-print-color-adjust:exact; }
body { margin:0; background:#F4F7F6; }
.page { position:relative; width:210mm; height:296mm; padding:14mm; background:#F4F7F6; break-after:page; }
.page:last-of-type { break-after:auto; } .page.wide { page:wide; width:297mm; height:209mm; }
h1,h2,h3 { color:#0B6250; line-height:1.2; margin:0 0 5mm; break-after:avoid; }
h1 { font-size:24pt; letter-spacing:-.4pt; } h2 { font-size:15pt; margin-top:6mm; } h3 { font-size:11pt; margin:3mm 0 2mm; }
p { margin:0 0 4mm; } a { color:#0B5747; text-decoration:none; } ul { padding-left:4mm; margin:4mm 0; } li { margin:0 0 3.5mm; }
footer { position:absolute; left:14mm; right:14mm; bottom:8mm; border-top:.5pt solid #D4E1DB; padding-top:2mm; display:flex; justify-content:space-between; gap:6mm; color:#425B52; font-size:7pt; }
footer a { color:#425B52; } footer span { font-variant-numeric:tabular-nums; }
.cover { display:flex; flex-direction:column; justify-content:center; } .cover h1 { font-size:39pt; max-width:150mm; border-bottom:2pt solid #0B6250; padding-bottom:9mm; } .cover p { font-size:14pt; max-width:145mm; color:#425B52; }
.contents a { display:flex; justify-content:space-between; padding:3mm 0; border-bottom:.5pt solid #D4E1DB; font-size:12pt; } .contents footer a { padding:0; border:0; font-size:7pt; }
.screen-layout { height:253mm; display:grid; grid-template-columns:64% 31%; gap:5%; align-items:center; }
.device { width:100%; display:block; height:auto; } .caption h1 { font-size:20pt; margin-bottom:4mm; } .caption .screen-id { color:#425B52; font-size:11pt; margin:0 0 2mm; letter-spacing:1pt; }
.caption .state { display:inline-block; font-size:12pt; color:#0B5747; background:#DCF2EA; border-radius:2mm; padding:2mm 2.5mm; margin-bottom:4mm; line-height:1.3; }
.caption .purpose { font-size:11pt; line-height:1.45; font-weight:600; } .caption ul { font-size:9.5pt; line-height:1.5; }
table { width:100%; border-collapse:collapse; table-layout:fixed; font-size:9pt; line-height:1.4; margin:4mm 0; } th,td { padding:2.5mm; border-bottom:.5pt solid #D4E1DB; text-align:left; vertical-align:top; overflow-wrap:anywhere; } th { color:#0B5747; background:#DCF2EA; } thead { display:table-header-group; } tr { break-inside:avoid; } tr:nth-child(even) td { background:#EBF2EF; }
.caption code { font-size:.95em; overflow-wrap:anywhere; }
.roles th:first-child { width:24%; } .system-grid { display:grid; grid-template-columns:1fr 1fr; gap:7mm; } .swatches { display:grid; grid-template-columns:1fr 1fr; gap:3mm; margin:4mm 0 7mm; } .swatch { display:flex; gap:2mm; align-items:center; font-size:8pt; } .swatch i { width:12mm; height:10mm; border:.5pt solid #70877D; border-radius:2mm; } .system-grid table { font-size:8pt; } .components { font-size:10pt; line-height:1.8; }
.diagram-stage { width:182mm; height:238mm; display:flex; align-items:center; justify-content:center; } .diagram-stage svg { display:block; margin:auto; max-width:100% !important; max-height:100%; width:auto !important; height:auto; }
.wide h1 { font-size:20pt; } .wide .diagram-stage { width:269mm; height:155mm; } .diagram-stage .mermaid { width:100%; height:100%; display:flex; align-items:center; justify-content:center; }
.zoom-note { position:absolute; bottom:15mm; right:14mm; color:#425B52; font-size:8pt; }
.question-group { break-inside:avoid; } .question-group h2 { font-size:11pt; margin:0 0 2mm; } .question-group ul { font-size:8.5pt; line-height:1.4; margin:2mm 0 4mm; } .question-group li { margin-bottom:2mm; }
`;

try {
  if (typeof Bun.markdown?.html !== 'function') throw new Error('Bun.markdown.html is unavailable.');
  const readme = await snapshot('README.md');
  for (const file of ['foundation/personas-and-roles.md','foundation/information-architecture.md','foundation/core-flows.md','system/design-system.md','screens/inventory.md']) await snapshot(file);
  const specFiles = (await Array.fromAsync(new Bun.Glob('screens/**/*-specs.md').scan(design))).sort();
  for (const file of specFiles) await snapshot(file);
  const svgFiles = (await Array.fromAsync(new Bun.Glob('screens/**/*.svg').scan(design))).sort();
  for (const file of svgFiles) await snapshot(file);
  const specs: Spec[] = [];
  const screenSpecs = new Map<string,{spec:Spec;text:string}>();
  for (const file of specFiles) {
    const source = sources.get(file)!;
    const spec: Spec = {file,title:source.match(/^# (.+)$/m)![1],questions:'',navigation:diagramBlocks(source,file).map(item=>item.source)};
    for (const section of source.split(/(?=^## )/m)) {
      const heading = section.match(/^## (.+)$/m)?.[1] ?? '';
      const id = heading.match(/^([CFWSPL]-\d{2})\b/)?.[1];
      if (id) {
        if (screenSpecs.has(id)) throw new Error(`Duplicate spec heading: ${id}.`);
        screenSpecs.set(id,{spec,text:section.replace(/^## .+\n/,'').replace(/^!\[[^\]]*\]\([^\n]*\)\s*$/gm,'').replace(/```mermaid[\s\S]*?```/g,'').trim()});
      } else if (/^(Open design questions|Review responses)\b/i.test(heading)) spec.questions += section.replace(/```mermaid[\s\S]*?```/g,'')+'\n';
    }
    specs.push(spec);
  }
  const inventory = inventoryEntries(sources.get('screens/inventory.md')!);
  const inventoryIDs = new Set(inventory.map(entry => entry.id));
  const svgByID = new Map<string, string[]>();
  const problems: string[] = [];
  for (const file of svgFiles) {
    const id = file.match(/\/([CFWSPL]-\d{2})-/)?.[1];
    if (!id) { problems.push(`SVG filename has no screen ID: ${file}`); continue; }
    const files = svgByID.get(id) ?? [];
    files.push(file); svgByID.set(id,files);
    if (!inventoryIDs.has(id)) problems.push(`SVG is not in the inventory: ${file}`);
    if (!screenSpecs.has(id)) problems.push(`SVG has no ## ${id} spec section: ${file}`);
  }
  const screenList: Screen[] = [];
  const missing: string[] = [];
  for (const entry of inventory) {
    const files = svgByID.get(entry.id) ?? [];
    const primary = files.filter(file => !file.includes('--'));
    if (entry.deferred) console.warn(`Warning: ${entry.id} is explicitly later/unbuilt${primary.length ? '; including available artwork.' : '; no primary SVG, skipping.'}`);
    if (!primary.length) { if (!entry.deferred) missing.push(entry.id); continue; }
    if (primary.length !== 1) { problems.push(`Multiple primary SVGs for ${entry.id}: ${primary.join(', ')}`); continue; }
    const ordered = [...primary,...files.filter(file => file.includes('--')).sort()];
    for (const file of ordered) {
      const state = stateLabel(file);
      screenList.push({ file, id: entry.id, title: `${entry.id} ${entry.name}${state ? ' — '+state : ''}`, purpose: entry.purpose, ownsSystemChrome: entry.ownsSystemChrome });
    }
  }
  if (missing.length) problems.unshift(`Inventory IDs missing primary SVG (${missing.length}): ${missing.join(', ')}`);
  if (problems.length) throw new Error(`Incomplete source ${sourceLabel}:\n- ${problems.join('\n- ')}`);
  for (const id of screenSpecs.keys()) if (!inventoryIDs.has(id)) throw new Error(`Spec ${id} is absent from the inventory.`);
  if (!screenList.length) throw new Error(`No built screens in ${sourceLabel}.`);
  // Validate all source contracts before loading Mermaid or launching a browser.
  const candidates = [process.env.BOOKBUDDY_CHROMIUM ?? '', '/Applications/Chromium.app/Contents/MacOS/Chromium'];
  for await (const name of new Bun.Glob('chromium_headless_shell-*/chrome-headless-shell-mac-arm64/chrome-headless-shell').scan(join(home,'Library/Caches/ms-playwright'))) candidates.push(join(home,'Library/Caches/ms-playwright',name));
  const chromium = await existing(candidates,'Chromium');
  const mermaidPath = await existing([process.env.BOOKBUDDY_MERMAID ?? '',join(home,'workspace/projects/mouseion/node_modules/.bun/mermaid@11.14.0/node_modules/mermaid/dist/mermaid.min.js')],'Mermaid');
  const mermaid = await Bun.file(mermaidPath).text();
  const chapterTitles: Record<string,string> = {C:'Customer',F:'Foreman',W:'Worker',S:'Shared',P:'Provider admin (P-)',L:'Later categories (L-)'};
  const chapters = [...new Set(screenList.map(screen=>screen.id[0]))].map(prefix=>({title:chapterTitles[prefix],prefix}));
  let body = page(`<h1>${escape(bookTitle)}</h1>${markdown(readme.split('\n\n')[1],'README.md')}`,'README.md',{className:'cover'});
  body += page(`<h1>BookBuddy app design</h1>${[['roles','Personas and roles'],['maps','Information architecture'],['flows','Core flows'],['system','Design system'],...chapters.map(chapter=>['chapter-'+chapter.prefix,chapter.title]),['questions','Open design questions']].map(([id,title])=>`<a href="#${id}"><span>${escape(title)}</span><b class="contents-page" data-target="${id}"></b></a>`).join('')}`,'README.md',{className:'contents'});
  const roleSource = sources.get('foundation/personas-and-roles.md')!;
  const roleRows = roleSource.split('## Mobile roles and guardrails')[1].split('## Internal operations')[0].split('\n').filter(line=>/^\| (Customer|Foreman|Worker|Provider admin) \|/.test(line)).map(line=>line.split('|').slice(1,-1).map(cell=>cell.trim()));
  body += page(`<h1>Personas and roles</h1><p>${escape(excerpt(roleSource.split('## Mobile roles and guardrails')[1].split('\n\n')[1],210))}</p><table class="roles"><thead><tr><th>Role</th><th>Can do within scope</th><th>Must not get by default</th></tr></thead><tbody>${roleRows.map(row=>`<tr><td><strong>${escape(row[0])}</strong></td><td>${escape(excerpt(row[1],230))}</td><td>${escape(excerpt(row[2],180))}</td></tr>`).join('')}</tbody></table>`,'foundation/personas-and-roles.md',{id:'roles'});
  const addDiagram = (diagram: Diagram, id?: string) => {
    const panels=sequencePanels(diagram.source);
    for(const [index,panel]of panels.entries()){
      const encoded=panel.split('\n').map(line=>line.includes('->')&&line.includes(':')?line.replaceAll(';','#59;'):line).join('\n');
      const title=diagram.title+(panels.length>1?` (${index+1}/${panels.length})`:'');
      body+=page(`<h1>${escape(title)}</h1><div class="diagram-stage"><div class="mermaid">${escape(encoded)}</div></div><p class="zoom-note"></p>`,diagram.file,{id:index===0?id:undefined,className:'diagram-page'});
    }
  };
  diagramBlocks(sources.get('foundation/information-architecture.md')!,'foundation/information-architecture.md').forEach((diagram,index)=>addDiagram(diagram,index===0?'maps':undefined));
  diagramBlocks(sources.get('foundation/core-flows.md')!,'foundation/core-flows.md').forEach((diagram,index)=>addDiagram(diagram,index===0?'flows':undefined));
  const system = sources.get('system/design-system.md')!;
  const swatches = system.split('## Colour tokens')[1].split('**WCAG')[0].split('\n').filter(line=>/^\| `(?:canvas|surface|ink|muted|brand|brand-soft|attention-soft|critical-soft)`/.test(line)).map(line=>line.split('|').slice(1,-1).map(cell=>plain(cell)));
  const scale = system.split('## Foundations')[1].split('## Component inventory')[0].split('\n').filter(line=>/^\| (Display|Page title|Section|Label|Body|Supporting|Caption)/.test(line));
  const components = system.split('## Component inventory')[1].split('## iOS')[0].split('\n').filter(line=>/^\| [A-Z]/.test(line)).slice(1).map(line=>line.split('|')[1].trim());
  body += page(`<h1>Design system</h1><p>${escape(excerpt(system.split('## Brand direction')[1].split('\n\n')[1],180))}</p><div class="system-grid"><div><h2>Colour tokens</h2><div class="swatches">${swatches.map(row=>`<div class="swatch"><i style="background:${row[1].split(' / ')[0]}"></i><span>${escape(row[0])}<br>${escape(row[1])}</span></div>`).join('')}</div><h2>Component inventory</h2><p class="components">${components.map(escape).join(' · ')}</p></div><div><h2>Foundations</h2>${markdown('| Style | Size / line height | Weight and use |\n| --- | --- | --- |\n'+scale.join('\n'),'system/design-system.md')}</div></div>`,'system/design-system.md',{id:'system'});
  for (const chapter of chapters) {
    const chapterSpecs = specs.filter(spec=>screenList.some(screen=>screen.id.startsWith(chapter.prefix+'-')&&screenSpecs.get(screen.id)!.spec===spec));
    let first = true;
    for (const spec of chapterSpecs) for (const source of spec.navigation) { addDiagram({title:first?chapter.title:spec.title,source,file:spec.file},first?'chapter-'+chapter.prefix:undefined); first=false; }
    if (first) throw new Error(`Missing navigation diagram: ${chapter.title}.`);
    for (const screen of screenList.filter(item=>item.id.startsWith(chapter.prefix+'-'))) {
      const {spec,text} = screenSpecs.get(screen.id)!;
      const summary = caption(text,screen);
      const [baseName,...stateParts] = screen.title.replace(new RegExp('^'+screen.id+'\\s*'),'').split(' — ');
      const state = stateParts.join(' — ');
      const frame = phone(sources.get(screen.file)!,screen.ownsSystemChrome);
      body += page(`<div class="screen-layout"><img class="device" alt="${escape(screen.title)}" src="data:image/svg+xml;base64,${Buffer.from(frame).toString('base64')}"><div class="caption"><p class="screen-id">${screen.id}</p><h1>${escape(baseName)}</h1>${state?`<p class="state">${escape(state)}</p>`:''}<p class="purpose">${summary.purpose}</p><ul>${summary.bullets.map(bullet=>`<li>${bullet}</li>`).join('')}</ul></div></div>`,spec.file,{id:screen.file.replaceAll(/[^a-z\d]/gi,'-'),className:'screen-page'});
    }
  }
  const orderedSpecs = chapters.flatMap(chapter=>specs.filter(spec=>[...screenSpecs].some(([id,value])=>id.startsWith(chapter.prefix+'-')&&value.spec===spec)));
  for (const [index, spec] of orderedSpecs.entries()) {
    const group = `<div class="question-group"><h2>${escape(spec.title)}</h2><ul>${spec.questions.split('\n').filter(line=>/^\s*-\s+/.test(line)).map(line=>`<li>${escape(excerpt(line,170))}</li>`).join('')}</ul></div>`;
    body += page(`<h1>Open design questions</h1><div class="questions">${group}</div>`,'README.md',{id:index===0?'questions':undefined});
  }
  const renderScript = `(async()=>{try{
    mermaid.initialize({startOnLoad:false,securityLevel:'loose',theme:'base',fontFamily:'Arial, Helvetica, sans-serif',themeVariables:{primaryColor:'#DCF2EA',primaryTextColor:'#152C26',primaryBorderColor:'#70877D',lineColor:'#425B52',secondaryColor:'#F4F7F6',tertiaryColor:'#EBF2EF',fontSize:'18px',actorBkg:'#DCF2EA',actorTextColor:'#152C26',actorBorder:'#70877D',signalColor:'#425B52',signalTextColor:'#152C26'},flowchart:{htmlLabels:true,curve:'basis',nodeSpacing:20,rankSpacing:35,padding:12,wrappingWidth:170,useMaxWidth:true},sequence:{wrap:true,width:210,height:45,actorMargin:35,messageMargin:16,boxMargin:5,boxTextMargin:5,messageFontSize:18,actorFontSize:18,wrapPadding:3,useMaxWidth:true}});
    for(const [index,element] of [...document.querySelectorAll('.mermaid')].entries()){
      try {await mermaid.run({nodes:[element]});}catch(error){throw new Error('Diagram '+(index+1)+': '+JSON.stringify(error));}
      const svg=element.querySelector('svg'); const box=svg.viewBox.baseVal;
      if(box.width/box.height>1.12) element.closest('.page').classList.add('wide');
      const stage=element.closest('.diagram-stage');
      const fittedScale=()=>Math.min(stage.clientWidth/box.width,stage.clientHeight/box.height);
      if(18*fittedScale()<12){element.closest('.page').classList.add('wide');if(18*fittedScale()<12)element.closest('.page').querySelector('.zoom-note').textContent='zoom for detail';}
    }
    await document.fonts.ready; await Promise.all([...document.images].map(image=>image.decode()));
    document.querySelectorAll('body > :not(.page):not(script)').forEach(element=>element.remove());
    const pages=[...document.querySelectorAll('.page')];
    document.querySelectorAll('.contents-page').forEach(label=>{const target=document.getElementById(label.dataset.target);label.textContent=String(pages.indexOf(target)+1);});
    for(const page of pages){const box=page.getBoundingClientRect();for(const element of page.querySelectorAll('.caption,.questions,.system-grid,.roles,.diagram-stage')){const rect=element.getBoundingClientRect();if(rect.bottom>box.bottom-24||rect.right>box.right-24)throw new Error('Page overflow: '+(pages.indexOf(page)+1)+'; '+element.className+'; '+page.querySelector('h1')?.textContent+'; '+page.querySelector('footer a')?.textContent);}}
    document.documentElement.dataset.ready='true';document.documentElement.dataset.mockups=String(document.querySelectorAll('.device').length);document.documentElement.dataset.diagrams=String(document.querySelectorAll('.mermaid svg').length);
  }catch(error){document.documentElement.dataset.error=error.message||JSON.stringify(error);}})();`;
  await Bun.write(join(temp,'render.html'),`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; font-src data:;"><title>${escape(bookTitle)}</title><style>${css}</style></head><body>${body}<script>${mermaid}</script><script>${renderScript}</script></body></html>`);
  const flags=['--headless','--no-sandbox','--disable-gpu','--disable-background-networking','--disable-component-update','--no-first-run','--no-default-browser-check',`--user-data-dir=${join(temp,'profile')}`];
  const rendered=await command([chromium,...flags,'--virtual-time-budget=60000','--dump-dom',pathToFileURL(join(temp,'render.html')).href]);
  const error=rendered.match(/data-error="([^"]*)"/)?.[1];
  if(error||!rendered.includes('data-ready="true"'))throw new Error('Rendering did not finish: '+(error??'missing ready flag'));
  const expectedDiagrams=(body.match(/class="mermaid"/g)??[]).length;
  if(!rendered.includes(`data-mockups="${screenList.length}"`)||!rendered.includes(`data-diagrams="${expectedDiagrams}"`))throw new Error('Incomplete mockup/diagram rendering.');
  await Bun.write(join(temp,'print.html'),rendered.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,''));
  await command([chromium,...flags,'--virtual-time-budget=1000','--no-pdf-header-footer',`--print-to-pdf=${join(temp,'book.pdf')}`,pathToFileURL(join(temp,'print.html')).href]);
  const pdf=Bun.file(join(temp,'book.pdf'));
  if(pdf.size<100_000||!(await pdf.slice(0,5).text()).startsWith('%PDF-'))throw new Error('Chromium did not produce a non-trivial PDF.');
  for(const [file,text]of sources)if(hash(await Bun.file(join(design,file)).text())!==hash(text))throw new Error(`Source changed during export: ${file}. Rebuild; prior PDF is untouched.`);
  await mkdir(dirname(output),{recursive:true});await Bun.write(output,pdf);
  console.log(JSON.stringify({source:sourceLabel,title:bookTitle,output,bytes:pdf.size,pages:pageNumber,mockups:screenList.length,diagrams:expectedDiagrams,nativeChromeScreens:screenList.filter(screen=>screen.ownsSystemChrome).map(screen=>screen.file),sourceSnapshot:hash([...sources].map(([name,text])=>name+'\\0'+hash(text)).join('\\n'))},null,2));
}finally{
  for(const child of running)child.kill('SIGTERM');
  await Promise.all([...running].map(child=>child.exited));
  await rm(temp,{recursive:true,force:true});
}
