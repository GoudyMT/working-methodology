// U11 (lane F, K376): the score gate runs the candidate and release arms side by side, under the load line.
// Every test runs scripts/recall-arms.mjs as a child process: KIT_LOAD_SAMPLE stands in for sampling, the probe folder
// holds a fixture login, and KIT_RECALL_SCRIPT points at a stub that records its env and args. No model call, no login.
import { test } from './harness.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import kitTemp from '../project/.claude/kit-temp.cjs';

kitTemp.sessionRoot();
const RUNNER = fileURLToPath(new URL('../scripts/recall-arms.mjs', import.meta.url));
// The kit source is the folder that holds scripts/recall-arms.mjs; the candidate arm runs that kit.
const KIT_SOURCE = path.resolve(path.dirname(RUNNER), '..');
const LOGIN_PHRASE = 'run claude, then /login, with CLAUDE_CONFIG_DIR set to';
const HOUR = 3600 * 1000;
const login = (expiresAt) => JSON.stringify({ claudeAiOauth: { expiresAt } });
const QUIET = [{ cpu: 10, gpu: 10 }, { cpu: 12, gpu: 11 }, { cpu: 9, gpu: 10 }];
const LABEL = () => `arms${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const out = (r) => `${r.stdout ?? ''}${r.stderr ?? ''}`;

// The stub stands in for scripts/recall.mjs. It records its start (argv, config folder, the login it finds there),
// can wait for the other arm to start, can rewrite its own login copy (a token refresh), saves its run the way
// recall.mjs does (a When: line in KIT_RECALL_RUNS, on success), and exits as STUB_* says.
const STUB = `import fs from 'node:fs';
import path from 'node:path';
const dir = process.env.STUB_DIR;
const name = process.argv[2];
const peer = name.startsWith('cand-') ? 'base-' + name.slice(5) : 'cand-' + name.slice(5);
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const credFile = path.join(process.env.CLAUDE_CONFIG_DIR || '', '.credentials.json');
const readCreds = () => (fs.existsSync(credFile) ? fs.readFileSync(credFile, 'utf8') : null);
const put = (suffix, data) => fs.writeFileSync(path.join(dir, name + suffix), JSON.stringify(data));
const startedAt = new Date().toISOString();
put('.start.json', { argv: process.argv.slice(2), claudeConfigDir: process.env.CLAUDE_CONFIG_DIR ?? null, kitClaudeHome: process.env.KIT_CLAUDE_HOME ?? null, startedAt, credentialsAtStart: readCreds() });
const finish = (exit, extra) => {
	if (exit === 0 && process.env.KIT_RECALL_RUNS) fs.writeFileSync(path.join(process.env.KIT_RECALL_RUNS, name + '.md'), '# Recall run: ' + name + '\\n\\nWhen: ' + startedAt + '\\n');
	put('.done.json', { exit, ...extra });
	process.exit(exit);
};
if (process.env.STUB_FAIL_PREFIX && name.startsWith(process.env.STUB_FAIL_PREFIX)) finish(4, {});
if (process.env.STUB_HOLD_PREFIX && name.startsWith(process.env.STUB_HOLD_PREFIX)) sleep(30000);
let sawPeer = null;
if (process.env.STUB_BARRIER) {
	fs.writeFileSync(path.join(dir, name + '.up'), '');
	const until = Date.now() + 15000;
	while (!fs.existsSync(path.join(dir, peer + '.up')) && Date.now() < until) sleep(25);
	sawPeer = fs.existsSync(path.join(dir, peer + '.up'));
}
if (process.env.STUB_REFRESH) fs.writeFileSync(credFile, 'refreshed by ' + name);
finish(sawPeer === false ? 7 : 0, { sawPeer });
`;

function setup(label) {
	const root = kitTemp.makeTemp('recall-arms-');
	const ctx = {
		label,
		home: path.join(root, 'home'),
		probe: path.join(root, 'probe'),
		release: path.join(root, 'release-kit'),
		stubDir: path.join(root, 'stub-out'),
		runs: path.join(root, 'runs'),
		stub: path.join(root, 'stub-recall.mjs'),
	};
	for (const dir of [ctx.home, ctx.probe, ctx.release, ctx.stubDir, ctx.runs]) fs.mkdirSync(dir, { recursive: true });
	fs.writeFileSync(ctx.stub, STUB);
	return ctx;
}

function writeLogin(ctx, text) {
	fs.writeFileSync(path.join(ctx.probe, '.credentials.json'), text);
}

function runArms(ctx, { samples = QUIET, extra = {}, timeout = 60000 } = {}) {
	const env = {
		...process.env,
		HOME: ctx.home,
		USERPROFILE: ctx.home,
		KIT_LOAD_SAMPLE: JSON.stringify(samples),
		KIT_RECALL_SCRIPT: ctx.stub,
		KIT_RECALL_RUNS: ctx.runs,
		STUB_DIR: ctx.stubDir,
		...extra,
	};
	delete env.CLAUDE_CONFIG_DIR;
	delete env.KIT_CLAUDE_HOME;
	delete env.KIT_PROBE_ROOT;
	return spawnSync(process.execPath, [RUNNER, ctx.label, '--release', ctx.release, '--probe', ctx.probe], { encoding: 'utf8', env, timeout });
}

function recordOf(ctx, prefix, suffix) {
	const file = fs.readdirSync(ctx.stubDir).find((f) => f.startsWith(prefix) && f.endsWith(suffix));
	return file ? JSON.parse(fs.readFileSync(path.join(ctx.stubDir, file), 'utf8')) : null;
}
const startOf = (ctx, prefix) => recordOf(ctx, prefix, '.start.json');
const armsStarted = (ctx) => fs.readdirSync(ctx.stubDir).filter((f) => f.endsWith('.start.json'));

// why: catches three load samples with CPU over 40% or GPU at 50% or more hold the run, exit 3, naming the reading (K376 S1)
test('three load samples with CPU over 40% or GPU at 50% or more hold the run, exit 3, naming the reading', () => {
	const ctx = setup(LABEL());
	writeLogin(ctx, login(Date.now() + HOUR));
	const cpuHot = runArms(ctx, { samples: [QUIET[0], { cpu: 45, gpu: 10 }, QUIET[2]] });
	assert.equal(cpuHot.status, 3, `CPU 45 in one sample: exit 3 expected\n${out(cpuHot)}`);
	assert.match(out(cpuHot), /45/, 'the held run does not name the CPU reading');
	assert.match(out(cpuHot), /40/, 'the held run does not name the 40% rule');
	assert.deepEqual(armsStarted(ctx), [], 'a held run started an arm');

	const gpuHot = runArms(ctx, { samples: [QUIET[0], QUIET[1], { cpu: 10, gpu: 50 }] });
	assert.equal(gpuHot.status, 3, `GPU 50 in one sample: exit 3 expected\n${out(gpuHot)}`);
	assert.match(out(gpuHot), /50/, 'the held run does not name the GPU reading');
	assert.deepEqual(armsStarted(ctx), [], 'a held run started an arm');

	const nullGpuHot = runArms(ctx, { samples: [{ cpu: 45, gpu: null }, QUIET[1], QUIET[2]] });
	assert.equal(nullGpuHot.status, 3, `CPU 45 with no GPU reading: exit 3 expected\n${out(nullGpuHot)}`);
	assert.deepEqual(armsStarted(ctx), [], 'a held run started an arm');

	const edge = runArms(ctx, { samples: [{ cpu: 40, gpu: 49 }, { cpu: 40, gpu: 49 }, { cpu: 40, gpu: 49 }] });
	assert.equal(edge.status, 0, `CPU at 40 and GPU at 49 are under the line\n${out(edge)}`);
});

// why: catches under the line, the candidate and release arms start side by side, each with its own config folder (K376 S2)
test('under the line, the candidate and release arms start side by side, each with its own config folder', () => {
	const ctx = setup(LABEL());
	writeLogin(ctx, login(Date.now() + HOUR));
	const res = runArms(ctx, { extra: { STUB_BARRIER: '1' } });
	assert.equal(res.status, 0, out(res));
	const cand = startOf(ctx, 'cand-');
	const base = startOf(ctx, 'base-');
	assert.ok(cand && base, `both arms must start; started: ${armsStarted(ctx).join(', ') || 'none'}`);
	for (const prefix of ['cand-', 'base-']) {
		const done = recordOf(ctx, prefix, '.done.json');
		assert.ok(done && done.sawPeer === true, `${prefix} arm ran without its peer alive: not side by side`);
	}
	assert.notEqual(cand.claudeConfigDir, base.claudeConfigDir, 'the two arms share one config folder');
	assert.equal(cand.kitClaudeHome, cand.claudeConfigDir, 'the candidate arm KIT_CLAUDE_HOME is not its config folder');
	assert.equal(base.kitClaudeHome, base.claudeConfigDir, 'the release arm KIT_CLAUDE_HOME is not its config folder');
	const probes = path.join(ctx.home, 'kit-probes');
	for (const arm of [cand, base]) {
		assert.ok(arm.claudeConfigDir && arm.claudeConfigDir.startsWith(probes), `config folder ${arm.claudeConfigDir} is not under kit-probes`);
	}
	assert.equal(base.argv[1], ctx.release, 'the release arm does not run the --release kit folder');
	assert.equal(cand.argv[1], KIT_SOURCE, 'the candidate arm does not run the kit source folder');
});

// why: catches each arm's folder gets a fresh copy of the probe login before it starts, and the source is never written (K376 S3)
test("each arm's folder gets a fresh copy of the probe login before it starts, and the source is never written", () => {
	const ctx = setup(LABEL());
	const text = login(Date.now() + HOUR);
	writeLogin(ctx, text);
	const src = path.join(ctx.probe, '.credentials.json');
	const mtimeBefore = fs.statSync(src).mtimeMs;
	const res = runArms(ctx, { extra: { STUB_BARRIER: '1', STUB_REFRESH: '1' } });
	assert.equal(res.status, 0, out(res));
	for (const prefix of ['cand-', 'base-']) {
		const arm = startOf(ctx, prefix);
		assert.ok(arm, `${prefix} arm did not start`);
		assert.equal(arm.credentialsAtStart, text, `${prefix} arm found no fresh copy of the probe login when it started`);
	}
	assert.equal(fs.readFileSync(src, 'utf8'), text, 'the probe login source was written (a refresh spoiled it)');
	assert.equal(fs.statSync(src).mtimeMs, mtimeBefore, 'the probe login source was touched');
});

// why: catches a missing or expired probe login stops before any arm starts, naming the /login step (K376 S3)
test('a missing or expired probe login stops before any arm starts, naming the /login step', () => {
	const cases = [
		{ what: 'no login file', text: null, named: true },
		{ what: 'a login past its expiry', text: login(Date.now() - 1000), named: true },
		{ what: 'an unreadable login', text: '{not json', named: false },
		{ what: 'a login with no expiry', text: JSON.stringify({ claudeAiOauth: {} }), named: false },
	];
	for (const c of cases) {
		const ctx = setup(LABEL());
		if (c.text !== null) writeLogin(ctx, c.text);
		const res = runArms(ctx);
		assert.notEqual(res.status, 0, `${c.what}: the run went on`);
		assert.deepEqual(armsStarted(ctx), [], `${c.what}: an arm started`);
		if (c.named) {
			assert.ok(out(res).includes(LOGIN_PHRASE), `${c.what}: the /login step is not named\n${out(res)}`);
			const shown = out(res).includes(ctx.probe) || out(res).includes(ctx.probe.split(path.sep).join('/'));
			assert.ok(shown, `${c.what}: the probe folder is not named\n${out(res)}`);
		}
	}
});

// why: catches arm runs are named cand-* and base-* with When: times on the same day, as recall-score reads them (K376 S4)
test('arm runs are named cand-* and base-* with When: times on the same day, as recall-score reads them', () => {
	const label = LABEL();
	const ctx = setup(label);
	writeLogin(ctx, login(Date.now() + HOUR));
	const when = '2026-01-01T09:00:00.000Z';
	const saved = (name) => `# Recall run: ${name}\n\nWhen: ${when}\n`;
	// Saved runs the same label already has: the highest n is 5, so this pair is n=6. The decoy label must not count.
	fs.writeFileSync(path.join(ctx.runs, `cand-${label}-2.md`), saved(`cand-${label}-2`));
	fs.writeFileSync(path.join(ctx.runs, `base-${label}-5.md`), saved(`base-${label}-5`));
	fs.writeFileSync(path.join(ctx.runs, `cand-decoy${label}-9.md`), saved(`cand-decoy${label}-9`));
	const res = runArms(ctx, { extra: { STUB_BARRIER: '1' } });
	assert.equal(res.status, 0, out(res));
	const cand = startOf(ctx, 'cand-');
	const base = startOf(ctx, 'base-');
	assert.ok(cand && base, `both arms must start; started: ${armsStarted(ctx).join(', ') || 'none'}`);
	assert.equal(cand.argv[0], `cand-${label}-6`, 'the candidate run is not one more than the highest saved n');
	assert.equal(base.argv[0], `base-${label}-6`, 'the release run is not one more than the highest saved n');
	// The saved runs' When: lines are what recall-score reads, so the same-day check reads them, not the stub clock.
	const whenOf = (name) => {
		const file = path.join(ctx.runs, `${name}.md`);
		assert.ok(fs.existsSync(file), `${name} was not saved in the runs folder`);
		const m = fs.readFileSync(file, 'utf8').match(/^When: (\S+)$/m);
		assert.ok(m, `${name} has no When: line`);
		const at = new Date(m[1]);
		assert.ok(!Number.isNaN(at.getTime()), `${name} When: is not a time: ${m[1]}`);
		return at;
	};
	assert.equal(whenOf(`cand-${label}-6`).toDateString(), whenOf(`base-${label}-6`).toDateString(), 'the saved runs were not begun on the same day');
});

// why: catches one arm failing stops the other and reports both (K376 S5)
test('one arm failing stops the other and reports both', () => {
	const label = LABEL();
	const ctx = setup(label);
	writeLogin(ctx, login(Date.now() + HOUR));
	const res = runArms(ctx, { extra: { STUB_FAIL_PREFIX: 'base-', STUB_HOLD_PREFIX: 'cand-' }, timeout: 20000 });
	assert.equal(res.signal, null, 'the runner kept waiting on the held arm after the other failed');
	assert.match(out(res), new RegExp(`arm base-${label}-1: exit 4`), 'the failed arm exit is not reported');
	assert.match(out(res), new RegExp(`arm cand-${label}-1: exit`), 'the stopped arm exit is not reported');
	assert.equal(fs.existsSync(path.join(ctx.stubDir, `cand-${label}-1.done.json`)), false, 'the held arm ran to its end');
	assert.notEqual(res.status, 0, 'one arm failed but the run exited 0');
});

// why: catches an arm starting with only the login in its folder, so recall.mjs refuses it, with no install from its own kit (S11F1)
test("each arm's config folder holds a kit-install.json from its own kit before the recall script starts", () => {
	const ctx = setup(LABEL());
	writeLogin(ctx, login(Date.now() + HOUR));
	// The release fixture is a kit folder with its own version, so an install from it reads differently from the candidate's.
	const releaseVersion = '0.0.1-release-fixture';
	fs.writeFileSync(path.join(ctx.release, 'VERSION'), `${releaseVersion}\n`);
	fs.writeFileSync(path.join(ctx.release, 'kit.config.json'), '{}\n');
	fs.mkdirSync(path.join(ctx.release, 'user'), { recursive: true });
	// This stub records the folder's kit-install.json at the moment it starts, which is when recall.mjs checks the user layer.
	const probeStub = path.join(path.dirname(ctx.stub), 'stub-install-probe.mjs');
	fs.writeFileSync(probeStub, `import fs from 'node:fs';
import path from 'node:path';
const file = path.join(process.env.CLAUDE_CONFIG_DIR, 'kit-install.json');
const text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
fs.writeFileSync(path.join(process.env.STUB_DIR, process.argv[2] + '.install.json'), JSON.stringify({ text }));
`);
	const res = runArms(ctx, { extra: { KIT_RECALL_SCRIPT: probeStub } });
	assert.equal(res.status, 0, out(res));
	const stampOf = (prefix) => {
		const rec = recordOf(ctx, prefix, '.install.json');
		assert.ok(rec, `${prefix} arm did not start`);
		assert.notEqual(rec.text, null, `${prefix} arm folder holds no kit-install.json when the recall script starts (only the login)`);
		return JSON.parse(rec.text);
	};
	const candVersion = fs.readFileSync(path.join(KIT_SOURCE, 'VERSION'), 'utf8').trim();
	assert.equal(stampOf('cand-').version, candVersion, 'the candidate arm install is not from the candidate kit');
	assert.equal(stampOf('base-').version, releaseVersion, 'the release arm install is not from the release kit');
});
