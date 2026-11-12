// T16a (the owner's lock, 2026-11-11): one name for each thing the guards and rules talk about. The word check fails a
// banned variant in the kit's rules, skills, agents, guard texts and top-level docs, the way the name check fails a
// commit subject.
import { test } from './harness.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import kitTemp from '../project/.claude/kit-temp.cjs';

kitTemp.sessionRoot();
const CHECK = path.resolve('scripts/word-check.mjs');
const run = (dir) => spawnSync(process.execPath, [CHECK, dir], { encoding: 'utf8' });

// why: guards the owner's lock 2026-11-11 (one vocabulary). The 1.26.0 carry-overs C8 and C20: the check knew variants
// of two of the five names, and never read the top-level docs.
test('the word check passes the kit and fails a variant of each of the five names, in rules and top-level docs', () => {
	const kit = run(path.resolve('.'));
	assert.equal(kit.status, 0, kit.stdout + kit.stderr);
	const cases = [
		["wait for the owner's go", "the owner's yes"],
		['an Outward action', 'outward act'],
		["inside the owner's bounds", 'the push bound'],
		['a hook bypass', 'gate bypass'],
		['a guarded file', 'protected file'],
	];
	for (const [bad, use] of cases) {
		for (const file of [path.join('rules', 'x.md'), 'README.md']) {
			const dir = kitTemp.makeTemp('words-');
			fs.mkdirSync(path.join(dir, 'rules'));
			fs.writeFileSync(path.join(dir, file), `Push, then ${bad}.\n`);
			const r = run(dir);
			assert.equal(r.status, 1, `${bad} passed in ${file}`);
			assert.ok(r.stdout.includes(`${file.split(path.sep).join('/')}:1`), `${bad}: ${r.stdout}`);
			assert.ok(r.stdout.includes(use), `${bad}: ${r.stdout}`);
		}
	}
});
