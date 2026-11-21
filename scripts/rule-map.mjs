#!/usr/bin/env node
// The rule-to-guard map (T8, build 14): for each rule in the index, the guards, scripts, tests and workflows whose code
// names it (`rule:<id>`). The v2.0 teardown counted 81 rules and only 24 named by any hook, audit or script; the rules
// diet (T9) cuts prose a script already holds, so it needs this list, and a stale list would steer that cut, so CI
// checks it is fresh.
//   node scripts/rule-map.mjs write    writes docs/rule-map.json and prints the counts
//   node scripts/rule-map.mjs check    exit 1 when docs/rule-map.json differs from what write would make
// A name is not proof the code holds the rule; it is where to look. Rule prose (rules/, the built copies) never counts.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const OUT = 'docs/rule-map.json';
const SKIP = new Set(['.git', 'node_modules', 'vendor', 'reports']);
// Where code lives, and the kind it counts as; the first match wins.
const KINDS = [
	['guards', /^(project\/\.claude\/[^/]+\.cjs|user\/kit-hooks\/|project\/\.githooks\/)/],
	['tests', /^tests\//],
	['workflows', /^\.github\//],
	['scripts', /^(scripts\/|project\/\.claude\/[^/]+\.mjs$|user\/kit-tools\/|user\/skills\/.+\.(mjs|cjs)$)/],
];
const CODE = /\.(mjs|cjs|js|sh|ya?ml)$|^project\/\.githooks\/[^/]+$/;

function walk(root, rel = '', out = []) {
	for (const e of fs.readdirSync(path.join(root, rel), { withFileTypes: true })) {
		if (SKIP.has(e.name)) continue;
		const p = rel ? `${rel}/${e.name}` : e.name;
		if (e.isDirectory()) walk(root, p, out);
		else if (e.isFile()) out.push(p);
	}
	return out;
}

/** The map of a repo: { rules: { id: { guards, scripts, tests, workflows } }, prose: [ids no code names] }. */
export function build(root) {
	const index = fs.readFileSync(path.join(root, 'project', 'standards', 'INDEX.md'), 'utf8');
	const ids = [...index.matchAll(/^\| ([a-z0-9-]+) \|/gm)].map((m) => m[1]);
	const rules = Object.fromEntries(ids.map((id) => [id, { guards: [], scripts: [], tests: [], workflows: [] }]));
	// The files git tracks, as CI's checkout has them; an untracked or ignored file never counts (the build 14 sweep).
	// Outside a repo, every file on disk.
	const listed = spawnSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' });
	const files = listed.status === 0 ? listed.stdout.split('\0').filter(Boolean) : walk(root);
	for (const f of files.sort()) {
		if (!fs.existsSync(path.join(root, f))) continue;
		if (!CODE.test(f) || f === OUT) continue;
		const kind = (KINDS.find(([, re]) => re.test(f)) || [])[0];
		if (!kind) continue;
		const text = fs.readFileSync(path.join(root, f), 'utf8');
		for (const id of new Set([...text.matchAll(/\brule:([a-z0-9-]+)/g)].map((m) => m[1]))) if (rules[id]) rules[id][kind].push(f);
	}
	const prose = ids.filter((id) => Object.values(rules[id]).every((l) => !l.length));
	return { rules, prose };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
	const cmd = process.argv[2];
	const root = process.cwd();
	const text = `${JSON.stringify(build(root), null, 1)}\n`;
	if (cmd === 'write') {
		fs.mkdirSync(path.join(root, 'docs'), { recursive: true });
		fs.writeFileSync(path.join(root, OUT), text);
		const map = JSON.parse(text);
		const n = Object.keys(map.rules).length;
		process.stdout.write(`Rule map: ${n} rules: ${n - map.prose.length} held by code, ${map.prose.length} by prose only (${OUT})\n`);
		// K170: the rules no code names, by name, so the diet (T9) sees them without opening the JSON.
		if (map.prose.length) process.stdout.write(`Prose only: ${map.prose.join(', ')}\n`);
	} else if (cmd === 'check') {
		let now = '';
		try { now = fs.readFileSync(path.join(root, OUT), 'utf8').replace(/\r\n/g, '\n'); } catch { /* none */ }
		if (now !== text) { process.stderr.write(`${OUT} is stale: run node scripts/rule-map.mjs write\n`); process.exitCode = 1; }
		else process.stdout.write(`${OUT} is fresh\n`);
	} else {
		process.stderr.write('usage: node scripts/rule-map.mjs write | check\n');
		process.exitCode = 2;
	}
}
