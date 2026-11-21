// K178 (build 23b, Max's D2 gate change): a cloud session may clear a sweep only inside a verified plugin worker,
// where the plugin launcher holds each reviewer as the PC's hooks do. Anywhere else in the cloud it stays refused
// (E24 option C). The owner's yes stays on the card; nothing about the yes changes here.
import { test } from './harness.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { APPROVE, featureContract, makeTemp, sweepRepo } from './kit-helpers.mjs';

const REFUSED = /sweeps run on the owner's PC/;
const COPY = { 'skills/pre-pr-sweep/approve.mjs': APPROVE, 'kit-hooks/prices.cjs': path.resolve('user/kit-hooks/prices.cjs'), 'kit-tools/owner-yes.cjs': path.resolve('user/kit-tools/owner-yes.cjs'),
	'kit-tools/audits/safe-spawn.cjs': path.resolve('user/kit-tools/audits/safe-spawn.cjs') };
// A plugin folder laid out as the plugin build lays it, with the manifest of sha256 hashes its launcher checks.
function plugin() {
	const root = makeTemp('plugin-');
	const files = {};
	for (const [rel, from] of Object.entries(COPY)) {
		fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
		fs.copyFileSync(from, path.join(root, rel));
		files[rel] = crypto.createHash('sha256').update(fs.readFileSync(from)).digest('hex');
	}
	fs.writeFileSync(path.join(root, 'guard-manifest.json'), JSON.stringify({ files }));
	return root;
}
function run(script, env) {
	const dir = sweepRepo();
	const f = path.join(dir, 'sweeps', 'contract.json');
	fs.writeFileSync(f, JSON.stringify(featureContract()));
	return spawnSync(process.execPath, [script, f], { encoding: 'utf8', cwd: dir, env: { PATH: process.env.PATH, CLAUDE_CODE_REMOTE: 'true', ...env } });
}

// planted: {"file":"user/skills/pre-pr-sweep/approve.mjs","was":"process.env.CLAUDE_CODE_REMOTE === 'true' && !pluginWorker()","to":"process.env.CLAUDE_CODE_REMOTE === 'true' && !process.env.CLAUDE_PLUGIN_ROOT"}
// why: guards rule:sweep-auto-approval
test('K178 a cloud session with no plugin is still refused', () => {
	assert.match(run(APPROVE, {}).stdout, REFUSED);
	assert.match(run(APPROVE, { CLAUDE_PLUGIN_ROOT: makeTemp('empty-') }).stdout, REFUSED, 'a plugin root with no manifest');
});

// planted: {"file":"user/skills/pre-pr-sweep/approve.mjs","was":"return Object.hasOwn(files, own) && Object.entries(files).every(([rel, h]) => same(rel, h));","to":"return Object.hasOwn(files, own);"}
// why: guards rule:sweep-auto-approval
test('K178 a plugin whose files differ from its manifest is refused', () => {
	const root = plugin();
	fs.appendFileSync(path.join(root, 'kit-hooks', 'prices.cjs'), '\n// changed\n');
	assert.match(run(path.join(root, 'skills/pre-pr-sweep/approve.mjs'), { CLAUDE_PLUGIN_ROOT: root }).stdout, REFUSED);
});

// planted: {"file":"user/skills/pre-pr-sweep/approve.mjs","was":"return Object.hasOwn(files, own) && Object.entries","to":"return Object.entries"}
// why: guards rule:sweep-auto-approval
test('K178 a verified plugin running another copy of approve.mjs is refused', () => {
	const root = plugin();
	assert.match(run(APPROVE, { CLAUDE_PLUGIN_ROOT: root }).stdout, REFUSED, 'the kit source copy');
	const other = makeTemp('other-');
	for (const rel of Object.keys(COPY)) { fs.mkdirSync(path.dirname(path.join(other, rel)), { recursive: true }); fs.copyFileSync(path.join(root, rel), path.join(other, rel)); }
	assert.match(run(path.join(other, 'skills/pre-pr-sweep/approve.mjs'), { CLAUDE_PLUGIN_ROOT: root }).stdout, REFUSED, 'a same-bytes copy outside the plugin');
	// A copy inside the plugin folder the manifest does not list is not the plugin's own.
	fs.copyFileSync(path.join(root, 'skills/pre-pr-sweep/approve.mjs'), path.join(root, 'skills/pre-pr-sweep/approve2.mjs'));
	assert.match(run(path.join(root, 'skills/pre-pr-sweep/approve2.mjs'), { CLAUDE_PLUGIN_ROOT: root }).stdout, REFUSED, 'an unlisted copy');
});

// why: guards rule:sweep-auto-approval
test('K178 a verified plugin worker\'s own approve.mjs gets past the cloud check', () => {
	const root = plugin();
	const r = run(path.join(root, 'skills/pre-pr-sweep/approve.mjs'), { CLAUDE_PLUGIN_ROOT: root });
	assert.doesNotMatch(r.stdout, REFUSED, r.stdout + r.stderr);
	// The plugin's copy runs to its verdict, so a copy that cannot load does not pass as not refused.
	assert.equal(r.status, 0, r.stdout + r.stderr);
	assert.match(r.stdout, /^APPROVED/);
});
