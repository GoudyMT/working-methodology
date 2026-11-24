// K388 (patch 1.51.4, U24): release-check reads GitHub's replies with spawnSync's 1 MB default buffer, so a reply over 1 MB
// (build 24's API reply is 1.08 MB) reads as "no tag", and the tag and copy steps fail falsely. The raised buffer must
// still name a reply too large to read, never a missing fact. The v1.51.3 record's limits line says a renamed job starts
// its trend afresh, which the live notes no longer say, so the notes step fails until the record matches them.
// The fake gh is a copy of node with a preload: it runs only as gh, so release-check's own spawn finds it on PATH.
import { test } from './harness.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import kitTemp from '../project/.claude/kit-temp.cjs';
import { releaseCheck } from '../project/.claude/release-check.mjs';
import { notes } from '../scripts/build-record.mjs';

kitTemp.sessionRoot();
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(HERE, '..');
const RECORD = path.join(REPO, 'docs', 'builds', '1.51.3.json');
// The live v1.51.3 limits line, read from the release with gh release view v1.51.3 (the plan's U24 base line).
const LIVE = 'The trend reads only the 2 main runs before this one, matching a job by its name without its matrix leg. Projects get no trend line in CI yet; their lane report keeps its own 3-run check.';

const sh = (cwd, ...a) => {
	const r = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd, encoding: 'utf8' });
	if (r.status !== 0) throw new Error(`git ${a.join(' ')}: ${r.stderr}`);
	return r.stdout.trim();
};

// A GitHub with one PR merged as v1.1.0, and a release copy and a project cloned at that tag.
function setup() {
	const work = kitTemp.makeTemp('k388-src-');
	sh(work, 'init', '-q', '-b', 'main');
	fs.writeFileSync(path.join(work, 'VERSION'), '1.1.0\n');
	sh(work, 'add', '.');
	sh(work, 'commit', '-qm', 'feat: one');
	sh(work, 'tag', 'v1.1.0');
	const merged = sh(work, 'rev-parse', 'HEAD');
	const tree = sh(work, 'rev-parse', `${merged}^{tree}`);
	const copy = path.join(kitTemp.makeTemp('k388-copy-'), 'release');
	sh(path.dirname(copy), 'clone', '-q', work, copy);
	sh(copy, 'checkout', '-q', '--detach', 'v1.1.0');
	const project = path.join(kitTemp.makeTemp('k388-proj-'), 'p');
	sh(path.dirname(project), 'clone', '-q', work, project);
	return { merged, tree, copy, project };
}

// The fake gh: a copy of node, whose preload runs only under a gh name (every other node child is untouched). The
// preload answers gh's own command (pr, run, api, release) from the spec file, writes the reply synchronously, and
// exits before node would look for a script named by gh's first argument.
const PRELOAD = `const path = require('node:path');
const fs = require('node:fs');
if (/^gh(\\.exe)?$/i.test(path.basename(process.execPath))) {
	const spec = JSON.parse(fs.readFileSync(process.env.K388_GH_SPEC, 'utf8'));
	const a = [path.basename(process.argv[1]), ...process.argv.slice(2)];
	let out = '';
	let code = 0;
	if (a[0] === 'pr') out = JSON.stringify(spec.pr);
	else if (a[0] === 'run') out = JSON.stringify(spec.runs);
	else if (a[0] === 'release') out = JSON.stringify(spec.release);
	else if (a[0] === 'api') out = JSON.stringify({ sha: spec.sha, commit: { tree: { sha: spec.tree } }, message: 'x'.repeat(spec.pad || 0) });
	else code = 1;
	const buf = Buffer.from(out);
	for (let off = 0; off < buf.length;) {
		try { off += fs.writeSync(1, buf, off, Math.min(65536, buf.length - off)); } catch (e) { if (e.code !== 'EAGAIN') throw e; }
	}
	process.exit(code);
}
`;

// One fake-gh folder for the whole file: the node copy under the gh name (a hard link when the disk allows) and the
// preload. Each call writes only its own spec file there. The folder is removed when the test process exits.
let FAKE = null;
let calls = 0;
function fakeDir() {
	if (FAKE) return FAKE;
	const dir = kitTemp.makeTemp('k388-gh-');
	const exe = path.join(dir, process.platform === 'win32' ? 'gh.exe' : 'gh');
	try { fs.linkSync(process.execPath, exe); } catch { fs.copyFileSync(process.execPath, exe); }
	fs.writeFileSync(path.join(dir, 'gh-pre.cjs'), PRELOAD);
	process.on('exit', () => kitTemp.removeTemp(dir));
	FAKE = dir;
	return dir;
}

// Runs fn with a fake gh first on PATH, answering from spec; the environment is put back after.
function withFakeGh(spec, fn) {
	const dir = fakeDir();
	const pre = path.join(dir, 'gh-pre.cjs');
	const specFile = path.join(dir, `spec-${++calls}.json`);
	fs.writeFileSync(specFile, JSON.stringify(spec));
	const keys = ['PATH', 'NODE_OPTIONS', 'K388_GH_SPEC'];
	const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
	process.env.PATH = dir + path.delimiter + (saved.PATH || '');
	process.env.NODE_OPTIONS = `${saved.NODE_OPTIONS ? `${saved.NODE_OPTIONS} ` : ''}--require ${pre.split(path.sep).join('/')}`;
	process.env.K388_GH_SPEC = specFile;
	try {
		return fn();
	} finally {
		for (const k of keys) if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
	}
}

// The answers for a merged v1.1.0 with a release; the api reply carries pad bytes of message.
const spec = (s, pad, release = { tagName: 'v1.1.0', name: 'Methodology Kit v1.1.0', isDraft: false, body: 'One thing.' }) => ({
	sha: s.merged,
	tree: s.tree,
	pad,
	pr: { state: 'MERGED', mergeCommit: { oid: s.merged }, baseRefName: 'main' },
	runs: [{ name: 'CI', status: 'completed', conclusion: 'success', headBranch: 'main', event: 'push' }],
	release,
});

// why: catches a fixture gh reply over 1 MB still finds the present tag, so the tag and copy steps pass (K388 S1)
test('a fixture gh reply over 1 MB still finds the present tag, so the tag and copy steps pass', () => {
	const s = setup();
	const lines = [];
	withFakeGh(spec(s, Math.round(1.1 * 1024 * 1024)), () => releaseCheck(
		{ tag: 'v1.1.0', pr: 5, repo: 'o/r', project: s.project, copy: s.copy },
		{ audit: () => [], state: () => ({ status: 0, stdout: 'PASS state' }), log: (l) => lines.push(l) },
	));
	const out = lines.join('\n');
	assert.match(out, /PASS tag v1\.1\.0 on the merge/, out);
	assert.match(out, /PASS release copy on v1\.1\.0/, out);
});

// why: catches a reply too large for the raised buffer reported as a missing tag (K388 S2)
test('a reply too large even for the raised buffer is named too large, never as MISSING', () => {
	const s = setup();
	const lines = [];
	withFakeGh(spec(s, 64 * 1024 * 1024 + 1024), () => releaseCheck(
		{ tag: 'v1.1.0', pr: 5, repo: 'o/r', project: s.project, copy: s.copy },
		{ audit: () => [], state: () => ({ status: 0, stdout: 'PASS state' }), log: (l) => lines.push(l) },
	));
	const out = lines.join('\n');
	assert.match(out, /the GitHub reply was too large to read/, out); // pin: 2 the check says why it cannot read
	assert.doesNotMatch(out, /no tag v1\.1\.0 on GitHub/, out);
	assert.doesNotMatch(out, /PASS tag v1\.1\.0 on the merge/, out);
});

// why: doc claim: the 1.51.3 notes no longer say a renamed job starts its trend afresh (K388 S3)
test('the notes from docs/builds/1.51.3.json no longer say a renamed job starts its trend afresh', () => {
	const text = notes(JSON.parse(fs.readFileSync(RECORD, 'utf8')));
	assert.doesNotMatch(text, /starts its trend afresh/);
	assert.equal(text.includes(LIVE), true, `the notes do not carry the live limits line:\n${text}`);
});

// why: catches the notes step failing on a matching live body, or passing a differing one (K388 S3)
test('the notes step passes on a record and body that match, and a body that differs is still MISSING', () => {
	const s = setup();
	const live = notes({ ...JSON.parse(fs.readFileSync(RECORD, 'utf8')), limits: LIVE });
	const deps = (lines) => ({ audit: () => [], state: () => ({ status: 0, stdout: 'PASS state' }), log: (l) => lines.push(l) });
	const check = (body) => withFakeGh(spec(s, 0, { tagName: 'v1.51.3', name: 'Methodology Kit v1.51.3', isDraft: false, body }), () => {
		const lines = [];
		releaseCheck({ tag: 'v1.51.3', pr: 5, repo: 'o/r', project: s.project, copy: REPO }, deps(lines));
		return lines.join('\n');
	});
	assert.match(check(live), /PASS release title and notes from the build record/, 'a matching body'); // pin: 1 the release-step check reads it
	assert.match(check(live.replace(LIVE, 'Limits differ.')), /MISSING release title and notes from the build record: the live notes are not the ones the build record writes/); // pin: 1 the release-step check reads it
});
