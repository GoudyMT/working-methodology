#!/usr/bin/env node
// The one sanctioned way to delete temp files at a closeout (rule:pre-compact-scan item 5). A session records each
// temp path when it makes it; the closeout deletes exactly those, and only inside the session's own scratch folder
// (<temp>/claude/<project>/<session id>/scratchpad). Never by exclusion, never a parent: the temp folder is shared by
// every session, and one "delete all but mine" wiped other sessions' work (2026-11-01). A recorded path outside the
// scratch folder is never deleted; it is printed for the owner, to go in the handoff.
//
// Usage:
//   node temp-clean.mjs add <scratch folder> <path>    record a temp path this session made
//   node temp-clean.mjs clean <scratch folder>         delete the recorded paths inside it, printing each
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const MANIFEST = '.temp-manifest';
const norm = (p) => path.resolve(p).replace(/\\/g, '/').replace(/\/+$/, '');
const same = (a, b) => (process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b);
const inside = (p, dir) => same(p, dir) || (process.platform === 'win32' ? p.toLowerCase().startsWith(dir.toLowerCase() + '/') : p.startsWith(dir + '/'));

// A session's own scratch folder, and nothing above it.
function isScratch(dir) {
	const rel = path.relative(norm(os.tmpdir()), dir).replace(/\\/g, '/').split('/');
	return rel.length === 4 && rel[0] === 'claude' && rel[3] === 'scratchpad' && !rel.includes('..');
}

function main([cmd, scratchArg, target]) {
	if (!scratchArg || !['add', 'clean'].includes(cmd)) { console.log('Usage: node temp-clean.mjs add <scratch folder> <path> | clean <scratch folder>'); return 2; }
	const scratch = norm(scratchArg);
	if (!isScratch(scratch)) { console.log(`Refused: ${scratch} is not a session's own scratch folder (<temp>/claude/<project>/<session id>/scratchpad).`); return 1; }
	const list = path.join(scratch, MANIFEST);
	if (cmd === 'add') {
		if (!target) { console.log('add needs the path this session made.'); return 2; }
		fs.appendFileSync(list, norm(target) + '\n');
		return 0;
	}
	const paths = fs.existsSync(list) ? [...new Set(fs.readFileSync(list, 'utf8').split('\n').filter(Boolean))] : [];
	const owner = [];
	for (const p of paths) {
		if (!inside(p, scratch) || same(p, scratch)) { owner.push(p); continue; }
		if (!fs.existsSync(p)) continue;
		fs.rmSync(p, { recursive: true, force: true });
		console.log(`deleted ${p}`);
	}
	for (const p of owner) console.log(`for the owner (outside this session's scratch folder, not deleted): ${p}`);
	fs.writeFileSync(list, owner.map((p) => p + '\n').join(''));
	if (!paths.length) console.log('none recorded');
	return 0;
}

process.exitCode = main(process.argv.slice(2));
