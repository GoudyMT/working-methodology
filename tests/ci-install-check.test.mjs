// T15 D1 and D2 (the owner, 2026-11-10): the install check proves in CI what the release verify proves on the
// owner's PC, so it must go red on a broken install and on a guard that lets a push through.
import { test } from './harness.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import kitTemp from '../project/.claude/kit-temp.cjs';

kitTemp.sessionRoot();

// why: guards rule:outward-acts and the owner's rule never to lower a gate (2026-11-10): a check that passes a kit
// whose push guard holds nothing, or whose install leaves a part unwired, is no check.
test('the install check fails on a missing git hook, a push guard that holds nothing, and a hold of the wrong kind', () => {
	const kit = kitTemp.makeTemp('ici-kit-');
	const clone = spawnSync('git', ['clone', '--quiet', '--no-hardlinks', path.resolve('.'), kit], { encoding: 'utf8' });
	assert.equal(clone.status, 0, clone.stderr);
	spawnSync('git', ['-C', kit, 'checkout', '--quiet', '--detach', spawnSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim()], { encoding: 'utf8' });
	// The working tree's own changes too, so a run before a commit checks the code as it is, not as last committed (K10).
	const diff = spawnSync('git', ['diff', '--binary', 'HEAD'], { encoding: 'buffer', maxBuffer: 256 * 1024 * 1024 }).stdout;
	if (diff.length) assert.equal(spawnSync('git', ['-C', kit, 'apply', '--whitespace=nowarn', '-'], { input: diff }).status, 0, 'the working tree did not apply');
	// Two planted faults: the pre-push hook is gone, and the push guard's decision always lets the call go.
	fs.rmSync(path.join(kit, 'project', '.githooks', 'pre-push'));
	const guard = path.join(kit, 'project', '.claude', 'guard-outward.cjs');
	fs.writeFileSync(guard, fs.readFileSync(guard, 'utf8').replace(/^function decide\(input\) \{$/m, 'function decide(input) {\n\treturn \'\';'));
	// A third (pass bar 1 of build 2b): a guard file write still held, but as an owner's yes instead of never by a tool.
	const proof = path.join(kit, 'project', '.claude', 'owner-proof.cjs');
	fs.writeFileSync(proof, fs.readFileSync(proof, 'utf8').replace("const GUARD_REASON = 'Never by a tool:", "const GUARD_REASON = 'Owner\\'s yes needed:"));
	const root = kitTemp.makeTemp('ici-root-');
	const r = spawnSync(process.execPath, [path.join(kit, 'scripts', 'ci-install-check.mjs'), '--root', root], { encoding: 'utf8', timeout: 280000 });
	assert.equal(r.status, 1, r.stdout + r.stderr);
	assert.match(r.stdout, /^FAIL {2}fresh: install project/m);
	assert.match(r.stdout, /^FAIL {2}every command the proof holds.*missed \d+/m);
	assert.match(r.stdout, /^ {4}echo x > \.claude\/guard\.cjs: ask, not never$/m, 'a hold of the wrong kind was not named');
	assert.match(r.stdout, /^PASS {2}fresh: install user exits 0/m, 'the check failed for a reason it does not name');
});
