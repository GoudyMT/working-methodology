// T16a (the owner's lock, 2026-11-11): one name for each thing the guards and rules talk about. The word check fails a
// banned variant in the kit's rules, skills, agents and guard texts, the way the name check fails a commit subject.
import { test } from './harness.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import kitTemp from '../project/.claude/kit-temp.cjs';

kitTemp.sessionRoot();
const CHECK = path.resolve('scripts/word-check.mjs');
const run = (dir) => spawnSync(process.execPath, [CHECK, dir], { encoding: 'utf8' });

test('the word check passes the kit and fails each banned variant, naming the file and the one name to use', () => {
	const kit = run(path.resolve('.'));
	assert.equal(kit.status, 0, kit.stdout + kit.stderr);
	for (const [bad, use] of [["wait for the owner's go", "the owner's yes"], ['an Outward action', 'outward act'], ['the owner approves it', "the owner's yes"]]) {
		const dir = kitTemp.makeTemp('words-');
		fs.mkdirSync(path.join(dir, 'rules'));
		fs.writeFileSync(path.join(dir, 'rules', 'x.md'), `Push, then ${bad}.\n`);
		const r = run(dir);
		assert.equal(r.status, 1, `${bad} passed`);
		assert.match(r.stdout, /rules\/x\.md:1/);
		assert.ok(r.stdout.includes(use), `${bad}: ${r.stdout}`);
	}
});
