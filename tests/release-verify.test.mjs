// Tests for the release verify (scripts/release-verify.mjs, E10): moving the release copy to a new tag, both
// installs and the status check, as one plain script with fixed checks that stops at the first failure.
import { test } from './harness.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import kitTemp from '../project/.claude/kit-temp.cjs';
import { verify } from '../scripts/release-verify.mjs';

kitTemp.sessionRoot();
const sh = (cwd, ...a) => {
	const r = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd, encoding: 'utf8' });
	if (r.status !== 0) throw new Error(`git ${a.join(' ')}: ${r.stderr}`);
	return r.stdout.trim();
};

// The kit's GitHub repo (a bare origin) with v1.0.0 and a merged v1.1.0, and a release copy cloned at v1.0.0.
function setup() {
	const work = kitTemp.makeTemp('kitsrc-');
	sh(work, 'init', '-q', '-b', 'main');
	fs.writeFileSync(path.join(work, 'VERSION'), '1.0.0\n');
	sh(work, 'add', '.');
	sh(work, 'commit', '-qm', 'one');
	sh(work, 'tag', 'v1.0.0');
	fs.writeFileSync(path.join(work, 'VERSION'), '1.1.0\n');
	sh(work, 'commit', '-qam', 'two');
	sh(work, 'tag', 'v1.1.0');
	const merged = sh(work, 'rev-parse', 'HEAD');
	const origin = path.join(kitTemp.makeTemp('origin-'), 'kit.git');
	sh(work, 'clone', '-q', '--bare', work, origin);
	const copy = path.join(kitTemp.makeTemp('copy-'), 'release');
	sh(path.dirname(copy), 'clone', '-q', origin, copy);
	sh(copy, 'checkout', '-q', '--detach', 'v1.0.0');
	const project = kitTemp.makeTemp('bench-');
	const calls = [];
	const deps = {
		env: {},
		gh: () => ({ status: 0, stdout: JSON.stringify({ state: 'MERGED', mergeCommit: { oid: merged } }) }),
		node: (args, cwd) => { calls.push([...args.slice(1), cwd]); return { status: 0, stdout: args[1] === 'status' ? 'Current: everything matches kit 1.1.0.' : 'ok' }; },
		log: () => {},
	};
	return { copy, project, merged, calls, deps };
}
const head = (copy) => sh(copy, 'rev-parse', 'HEAD');

// why: guards rule:outward-acts
test('the release verify moves the copy to the tag of the merged PR, installs both and reads status current', () => {
	const s = setup();
	const lines = [];
	const r = verify({ tag: 'v1.1.0', pr: 26, copy: s.copy, project: s.project }, { ...s.deps, log: (l) => lines.push(l) });
	assert.equal(r.ok, true, lines.join('\n'));
	assert.equal(head(s.copy), s.merged);
	assert.deepEqual(s.calls.map((c) => c.slice(0, -1).join(' ')), ['install user', `install project ${s.project}`, `status ${s.project}`]);
	assert.match(lines.join('\n'), /\[7\/7\] Status/);
});

// why: catches a break at scripts/release-verify.mjs:31 that no other test catches
test('the release verify stops at the first failed check, names it, and installs nothing after it', () => {
	const cases = [
		['a cloud session', (s) => { s.deps.env = { CLAUDE_CODE_REMOTE: 'true' }; }, 1, /owner's PC/],
		['a changed release copy', (s) => fs.writeFileSync(path.join(s.copy, 'VERSION'), 'edited\n'), 2, /not clean/],
		['a tag that does not exist', (s) => { s.tag = 'v9.9.9'; }, 3, /no tag v9\.9\.9/],
		['a PR that is not merged', (s) => { s.deps.gh = () => ({ status: 0, stdout: JSON.stringify({ state: 'OPEN', mergeCommit: null }) }); }, 4, /not merged/],
		['a tag on another tree than the merge', (s) => { s.tag = 'v1.0.0'; }, 4, /tree .* is not the merge commit's/],
		['an install that fails', (s) => { const node = s.deps.node; s.deps.node = (a, c) => (a[1] === 'install' && a[2] === 'project' ? { status: 1, stdout: 'Install refused' } : node(a, c)); }, 6, /install project failed/],
		['a status that is not current', (s) => { const node = s.deps.node; s.deps.node = (a, c) => (a[1] === 'status' ? { status: 1, stdout: 'Not current: x' } : node(a, c)); }, 7, /Not current/],
	];
	for (const [name, change, step, why] of cases) {
		const s = setup();
		s.tag = 'v1.1.0';
		const before = head(s.copy);
		change(s);
		const r = verify({ tag: s.tag, pr: 26, copy: s.copy, project: s.project }, s.deps);
		assert.equal(r.ok, false, name);
		assert.equal(r.step, step, `${name}: ${r.why}`);
		assert.match(r.why, why, name);
		if (step < 5) assert.equal(head(s.copy), before, `${name}: the copy did not move`);
		if (step < 6) assert.deepEqual(s.calls, [], `${name}: nothing installed`);
		if (step === 6) assert.equal(s.calls.some((c) => c[0] === 'status'), false, `${name}: status not read`);
	}
});
