#!/usr/bin/env node
// The project map (rule:diagrams; the owner chose a simple, trackable map on 2026-10-31). One data file per project,
// .kit/project-map.json, holds the goal, the success bar, the parts and how they connect, and the progress. The check
// holds it to the repo - every file a part names exists, every link joins known parts with a verb, every "done" has
// evidence - so the page never shows a claim nobody can check. The closeout runs check and render.
//
// Usage (from the project folder):
//   node .claude/project-map.mjs check                 PASS, or every fault (exit 1)
//   node .claude/project-map.mjs render <out.html>     check, then write one self-contained page
//   add --map <file> to either to use a draft kept outside the project
import fs from 'node:fs';
import path from 'node:path';

const MAP = path.join('.kit', 'project-map.json');
const STATES = ['done', 'doing', 'next', 'blocked'];

function check(map, root) {
	const faults = [];
	if (!String(map.goal || '').trim()) faults.push('goal is empty');
	const ids = new Set((map.parts || []).map((p) => p.id));
	for (const p of map.parts || []) {
		if (!p.id || !p.name) faults.push(`part ${p.id || '?'}: needs an id and a name`);
		for (const f of p.files || []) if (!fs.existsSync(path.join(root, f))) faults.push(`part ${p.id}: ${f} does not exist`);
	}
	for (const l of map.links || []) {
		const name = `link ${l.from} -> ${l.to}`;
		for (const end of [l.from, l.to]) if (!ids.has(end)) faults.push(`${name}: unknown part ${end}`);
		if (!String(l.verb || '').trim()) faults.push(`${name}: no verb`);
	}
	for (const it of map.progress || []) {
		if (!STATES.includes(it.state)) faults.push(`progress "${it.item}": state must be done, doing, next or blocked`);
		else if (it.state === 'done' && !String(it.evidence || '').trim()) faults.push(`progress "${it.item}": done needs evidence`);
	}
	return faults;
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// One row per link: [from] -verb-> [to]. Rows never cross, so the map stays readable at phone width as it grows.
function diagram(map) {
	const name = (id) => (map.parts.find((p) => p.id === id) || {}).name;
	return (map.links || []).map((l) => `<div class="flow"><span class="node">${esc(name(l.from))}</span>`
		+ `<span class="edge" aria-hidden="true"></span><span class="verb">${esc(l.verb)}</span>`
		+ `<span class="edge tip" aria-hidden="true"></span><span class="node">${esc(name(l.to))}</span></div>`).join('');
}

function render(map) {
	const progress = map.progress || [];
	const done = progress.filter((p) => p.state === 'done').length;
	const word = (s) => s[0].toUpperCase() + s.slice(1);
	const order = ['doing', 'blocked', 'next', 'done'];
	const rows = [...progress].sort((a, b) => order.indexOf(a.state) - order.indexOf(b.state))
		.map((p) => `<tr><td>${esc(p.item)}</td><td><span class="state ${p.state}">${word(p.state)}</span></td><td>${esc(p.evidence || '')}</td></tr>`).join('');
	return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(map.project)} map</title>
<style>
:root{--bg:#fbfbfa;--fg:#1d1d1b;--muted:#5c5c57;--line:#d6d5d0;--accent:#2f5d8a}
@media (prefers-color-scheme:dark){:root{--bg:#18181a;--fg:#ebebe8;--muted:#a9a9a3;--line:#3a3a3d;--accent:#8fb4dc}}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.5 system-ui,sans-serif}
main{max-width:70ch;margin:0 auto;padding:24px 16px}
h1{font-size:1.6rem;margin:0 0 4px}h2{font-size:1.1rem;margin:32px 0 8px}
p,li{max-width:70ch}.muted{color:var(--muted)}
table{border-collapse:collapse;width:100%}td,th{text-align:left;padding:6px 8px;border-bottom:1px solid var(--line);vertical-align:top}
.state{font-weight:600}.state.blocked{text-decoration:underline}
.flow{display:flex;align-items:center;flex-wrap:wrap;gap:6px;margin:8px 0}
.node{border:1px solid var(--fg);border-radius:6px;padding:4px 10px;font-weight:600}
.edge{flex:0 0 18px;border-top:1.5px solid var(--accent)}.edge.tip{position:relative}
.edge.tip::after{content:"";position:absolute;right:-1px;top:-5px;border:4px solid transparent;border-left:7px solid var(--accent)}
.verb{color:var(--accent);font-style:italic}
.files td:last-child{font-family:ui-monospace,monospace;font-size:13px;word-break:break-all}
</style></head><body><main>
<h1>${esc(map.project)}</h1>
<p>${esc(map.goal)}</p>
${(map.successBar || []).length ? `<h2>Success bar</h2><ul>${map.successBar.map((s) => `<li>${esc(s)}</li>`).join('')}</ul>` : ''}
<h2>Progress</h2>
<p class="muted">${done} of ${progress.length} done.</p>
<table><thead><tr><th>Item</th><th>State</th><th>Evidence</th></tr></thead><tbody>${rows}</tbody></table>
<h2>How the parts connect</h2>
${diagram(map)}
<h2>Parts</h2>
<table class="files"><thead><tr><th>Part</th><th>Does</th><th>Files</th></tr></thead><tbody>${(map.parts || []).map((p) => `<tr><td>${esc(p.name)}</td><td>${esc(p.does)}</td><td>${(p.files || []).map(esc).join('<br>')}</td></tr>`).join('')}</tbody></table>
<p class="muted">Checked against the repo by project-map.mjs${map.updated ? `; updated ${esc(map.updated)}` : ''}.</p>
</main></body></html>
`;
}

function main(argv) {
	// --map <file> checks a draft kept outside the project; its paths are still held to the project folder.
	const at = argv.indexOf('--map');
	const [cmd, out] = argv.filter((a, i) => at < 0 || (i !== at && i !== at + 1));
	const root = process.cwd();
	const file = at >= 0 ? path.resolve(argv[at + 1]) : path.join(root, MAP);
	if (!fs.existsSync(file)) {
		console.log(`No ${MAP.split(path.sep).join('/')} here. Start one from .claude/kit/project-map-example.json.`);
		process.exitCode = 1;
		return;
	}
	const map = JSON.parse(fs.readFileSync(file, 'utf8'));
	const faults = check(map, root);
	if (cmd === 'check' || cmd === 'render') {
		if (faults.length) {
			for (const f of faults) console.log(`FAIL ${f}`);
			process.exitCode = 1;
			return;
		}
		if (cmd === 'check') { console.log('PASS project map'); return; }
		if (!out) throw new Error('usage: node .claude/project-map.mjs render <out.html>');
		fs.writeFileSync(out, render(map));
		console.log(`wrote ${out}`);
		return;
	}
	console.log('Usage: node .claude/project-map.mjs check | render <out.html>');
}

main(process.argv.slice(2));
