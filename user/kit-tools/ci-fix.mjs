#!/usr/bin/env node
// K399 U21 (patch 1.51.4): ci-fix.mjs, the only way to clear a red CI run. The state file <git common dir>/kit-ci-state.json
// (written by ci-wait.mjs) holds the red run's failing items; this script lists them, records a diagnosis for each, and
// runs the fixers of the fixable ones. Each refusal goes to stderr, exits 1, and appends {at, hook: "ci-fix", cause} to
// <git common dir>/kit-guard-open.log.
//   node user/kit-tools/ci-fix.mjs list
//   node user/kit-tools/ci-fix.mjs digest --jobs <jobs.json> --logs <dir>
//   node user/kit-tools/ci-fix.mjs digest --run <id> --repo <owner/name>
//   node user/kit-tools/ci-fix.mjs diagnose <n> --cause code|pin|env --fix "<6 or more words>" --files <a,b> [--grant <id>]
//   node user/kit-tools/ci-fix.mjs gate-yes <file> <line>
//   node user/kit-tools/ci-fix.mjs fix
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import safeSpawn from './safe-spawn.cjs';
import { digest, gitDirs, headSha, readCifix, readText, ghRun, popUpAnswer, popUpFresh, attempt2Acts } from './ci-digest.mjs';

const CAUSES = ['code', 'pin', 'env'];
const TEST_FILE = /^tests\/.+\.test\.mjs$/;
const CI_FILE = /^(\.github|scripts)\//;
// A fixer runs one deterministic command and may change only the files listed. Its items are fixable, by item name.
const FIXERS = {
	'rule-map': { script: 'scripts/rule-map.mjs', args: ['write'], out: ['docs/rule-map.json'], fix: 'regenerate the stale rule map with node scripts/rule-map.mjs write' },
};

const normFile = (f) => path.posix.normalize(String(f).trim().replace(/\\/g, '/')).replace(/^(\.\/)+/, '');
const isTest = (f) => TEST_FILE.test(f.toLowerCase());
const isCi = (f) => CI_FILE.test(f.toLowerCase());
const words = (s) => String(s ?? '').trim().split(/\s+/).filter(Boolean).length;

// The owner's latest accepted pop-up that quotes one of the acts: through owner-yes.cjs's reader only (exact act span,
// one act per question, exact Yes, latest answer wins, a plain-UUID session), fresh, and spent once (no cifix line holds the
// id yet). Null when there is none; else { id, act, at }, the grant, the act it quoted and the answer time (the line's proof).
function acceptedYes(root, acts, lines) {
	const ans = popUpAnswer(acts, root);
	if (!ans || !ans.yes || !popUpFresh(ans)) return null;
	return lines.some((l) => l && l.grant === ans.id) ? null : { id: ans.id, act: ans.act, at: ans.at };
}

// The proof a line carries: the session the pop-up was read from, the pop-up id (the grant), the act it quoted, the answer time.
const proofOf = (ok) => ({ session: process.env.CLAUDE_CODE_SESSION_ID, id: ok.id, act: ok.act, at: ok.at });

// The origin remote's owner/name, read from the repo's config with fs; null when there is none.
function originRepo(common) {
	const cfg = readText(path.join(common, 'config')) || '';
	const m = /\[remote "origin"\][^[]*?\burl\s*=\s*(\S+)/.exec(cfg);
	if (!m) return null;
	const r = /[:/]([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+?)(?:\.git)?\/?$/.exec(m[1]);
	return r ? `${r[1]}/${r[2]}` : null;
}

function parse(argv) {
	const flags = {};
	const pos = [];
	for (let i = 0; i < argv.length; i++) {
		if (argv[i].startsWith('--')) {
			flags[argv[i].slice(2)] = argv[i + 1];
			i++;
		} else {
			pos.push(argv[i]);
		}
	}
	return { flags, pos };
}

// A refusal: one line to stderr, one line in the fail log when the repo has a git folder, exit 1.
function refuse(root, cause, msg) {
	process.stderr.write(`ci-fix: ${msg}\n`);
	const d = root ? gitDirs(root) : null;
	if (d) {
		try {
			fs.appendFileSync(path.join(d.common, 'kit-guard-open.log'), `${JSON.stringify({ at: new Date().toISOString(), hook: 'ci-fix', cause })}\n`);
		} catch (e) {
			process.stderr.write(`ci-fix: the refusal could not be logged: ${e.code || e.message}\n`);
		}
	}
	return 1;
}

// The state file, read whole: a missing, empty or unreadable one throws (the caller refuses).
function readState(d) {
	const text = readText(path.join(d.common, 'kit-ci-state.json'));
	if (text === null) throw new Error('no kit-ci-state.json: run ci-wait.mjs on the pushed commit first');
	let s;
	try {
		s = JSON.parse(text);
	} catch {
		throw new Error('kit-ci-state.json is not readable JSON');
	}
	if (!s || typeof s.sha !== 'string' || !Array.isArray(s.failed)) throw new Error('kit-ci-state.json has no sha and no failed list');
	return s;
}

function cmdList(d, root) {
	let s;
	try {
		s = readState(d);
	} catch (e) {
		return refuse(root, 'list', e.message);
	}
	const out = [`CI run ${s.run} on ${s.sha.slice(0, 12)}: ${s.verdict}, settled: ${s.settled === false ? 'no' : 'yes'}`];
	const head = headSha(root);
	if (head !== s.sha) out.push(`note: this state is for ${s.sha.slice(0, 12)}, not HEAD: run ci-wait.mjs on HEAD`);
	if (s.settled === false) out.push('wait for settle before pushing: the run has not ended');
	for (const it of s.failed) out.push(`${it.n}  ${it.key}  [${it.kind}]  ${it.message}`);
	if (s.failed.length === 0) out.push('no failing items');
	process.stdout.write(`${out.join('\n')}\n`);
	return 0;
}

function cmdDigest(root, argv, d) {
	const { flags } = parse(argv);
	let prior;
	try {
		prior = new Set(readCifix(root).lines.map((l) => l && l.key));
	} catch (e) {
		return refuse(root, 'digest', e.message);
	}
	let doc;
	let readLog;
	if (flags.jobs) {
		const text = readText(flags.jobs);
		if (text === null) return refuse(root, 'digest', `cannot read the jobs file ${flags.jobs}`);
		try {
			doc = JSON.parse(text);
		} catch {
			return refuse(root, 'digest', `the jobs file ${flags.jobs} is not readable JSON`);
		}
		const logs = flags.logs || path.dirname(flags.jobs);
		readLog = (job) => (job.log ? readText(path.join(logs, String(job.log))) : '');
	} else {
		// No flags: the run is the state's and the repo is origin's (F12).
		let stateRun = null;
		try { stateRun = d ? readState(d).run : null; } catch { stateRun = null; }
		const run = flags.run ?? (stateRun === null || stateRun === undefined ? undefined : String(stateRun));
		const repo = flags.repo ?? (d ? originRepo(d.common) : null);
		if (!/^\d+$/.test(String(run || '')) || !/^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/.test(String(repo || ''))) {
			return refuse(root, 'digest', 'digest needs --jobs <file> --logs <dir>, or --run <id> --repo <owner/name>');
		}
		const r = ghRun(['run', 'view', String(run), '-R', repo, '--json', 'jobs']);
		try {
			doc = r.status === 0 ? JSON.parse(r.stdout) : null;
		} catch {
			doc = null;
		}
		if (!doc) return refuse(root, 'digest', 'the jobs of the run could not be read from gh');
		readLog = (job) => {
			const g = ghRun(['run', 'view', String(run), '-R', repo, '--log-failed', '--job', String(job.databaseId ?? job.id)]);
			return g.status === 0 ? g.stdout : null;
		};
	}
	process.stdout.write(`${JSON.stringify(digest(doc, readLog, prior))}\n`);
	return 0;
}

// Every file of a diagnosis must sit inside the cause's class: code = source, pin = that test's own file, env = CI or setup.
function causeFault(cause, files, item) {
	const itemFile = normFile(item.file || '');
	if (cause === 'code') return files.every((f) => !isTest(f) && !isCi(f)) ? null : 'code: files must be source files, with no test file and no CI or setup file';
	if (cause === 'pin') {
		return isTest(itemFile) && files.every((f) => f.toLowerCase() === itemFile.toLowerCase()) ? null : `pin: files must be only that test's own file, ${itemFile || 'none named'}`;
	}
	return files.every(isCi) ? null : 'env: files must be CI or setup files (.github or scripts)';
}

function cmdDiagnose(d, root, argv) {
	const { flags, pos } = parse(argv);
	let s;
	try {
		s = readState(d);
	} catch (e) {
		return refuse(root, 'diagnose', e.message);
	}
	const head = headSha(root);
	if (head === null || s.sha !== head) return refuse(root, 'diagnose', `the state is for ${s.sha.slice(0, 12)}, not HEAD: run ci-wait.mjs on HEAD`);
	const n = /^[1-9]\d*$/.test(pos[0] || '') ? Number(pos[0]) : NaN;
	const item = s.failed.find((i) => i && i.n === n);
	if (!item) return refuse(root, 'diagnose', `item ${pos[0] ?? ''} is not in the run's failed list (ci-fix.mjs list)`);
	const cause = flags.cause;
	if (!CAUSES.includes(cause)) return refuse(root, 'diagnose', `cause ${cause} is not code, pin or env`);
	const fix = String(flags.fix ?? '').trim();
	if (words(fix) < 6) return refuse(root, 'diagnose', `the fix has ${words(fix)} words: 6 or more name what changes`);
	const raw = String(flags.files ?? '').split(',').map((x) => x.trim()).filter(Boolean);
	if (raw.length === 0) return refuse(root, 'diagnose', 'name the files with --files <a,b>');
	const files = raw.map(normFile);
	if (files.some((f) => f === '' || f === '.' || f.startsWith('../') || f.startsWith('/') || /^[a-z]:/i.test(f))) return refuse(root, 'diagnose', 'a file is outside the repo');
	const fault = causeFault(cause, files, item);
	if (fault) return refuse(root, 'diagnose', `${fault}; got ${files.join(', ')}`);
	let cf;
	try {
		cf = readCifix(root);
	} catch (e) {
		return refuse(root, 'diagnose', e.message);
	}
	if (cf.version === null) return refuse(root, 'diagnose', 'no VERSION file: there is no build record to write the diagnosis in');
	const earlier = cf.lines.filter((l) => l && l.key === item.key && l.run !== s.run);
	if (earlier.length >= 2) return refuse(root, 'diagnose', `${item.key} was diagnosed twice before: a third attempt is the owner's call`);
	const attempt = earlier.length + 1;
	const grant = typeof flags.grant === 'string' ? flags.grant.trim() : '';
	if (attempt === 2 && !grant) return refuse(root, 'diagnose', `${item.key} was diagnosed in an earlier run: attempt 2 needs --grant <id> (the owner's yes)`);
	// The grant is the id of the owner's accepted pop-up quoting this item's key; a made-up id is no yes (F6). Its proof is written with it.
	let ok = null;
	if (attempt === 2) {
		ok = acceptedYes(root, attempt2Acts(item.key), cf.lines);
		if (!ok || ok.id !== grant) return refuse(root, 'diagnose', `grant ${grant} is not an accepted pop-up from the owner quoting ${item.key}: ask first`);
	}
	const line = { run: s.run, key: item.key, cause, fix, files, attempt, ...(grant ? { grant } : {}), ...(ok ? { proof: proofOf(ok) } : {}) };
	fs.mkdirSync(path.dirname(cf.file), { recursive: true });
	fs.appendFileSync(cf.file, `${JSON.stringify(line)}\n`);
	process.stdout.write(`${item.name}: ${cause}, ${fix}\n`);
	return 0;
}

// The files git reports as changed or new in the working tree; null when git cannot say.
function changedFiles(root) {
	const a = safeSpawn.gitRead(root, ['diff', '--name-only'], { encoding: 'utf8' });
	const b = safeSpawn.gitRead(root, ['ls-files', '--others', '--exclude-standard'], { encoding: 'utf8' });
	if (a.status !== 0 || b.status !== 0) return null;
	return [...new Set([...a.stdout.split('\n'), ...b.stdout.split('\n')].map((x) => x.trim()).filter(Boolean).map(normFile))];
}

// Writes the gate's owner-yes line for one gate-line change, only with the owner's accepted pop-up quoting that line; else refuses
// and logs (F5). The line's key is gate:<file>:<trimmed new line>, its grant the pop-up's id.
function cmdGateYes(d, root, argv) {
	const file = normFile(argv[0] || '');
	const line = String(argv[1] ?? '').trim();
	if (!file || file.startsWith('../') || line === '') return refuse(root, 'gate-yes', 'gate-yes needs <file> <line>');
	let cf;
	try {
		cf = readCifix(root);
	} catch (e) {
		return refuse(root, 'gate-yes', e.message);
	}
	if (cf.version === null) return refuse(root, 'gate-yes', 'no VERSION file: there is no build record to write the owner-yes line in');
	let run = 0;
	let named = [];
	let bareOk = false;
	let stateSha = null;
	try {
		const s = readState(d);
		run = s.run ?? 0;
		stateSha = s.sha;
		named = s.failed.map((i) => normFile((i && i.file) || ''));
		// Ruling 5: the bare-line act counts only for a red state of the current head; the full act always counts.
		bareOk = s.verdict === 'red' && s.sha === headSha(root);
	} catch { run = 0; }
	// The act names the file and the line. A pop-up that quotes the line alone binds to a file only when the red run's own
	// failing item names that file (the gate item the change answers), and only for the red state of HEAD.
	const acts = [`ci-fix gate-yes ${file}:${line}`, ...(bareOk && named.includes(file) ? [line] : [])];
	const ok = acceptedYes(root, acts, cf.lines);
	if (ok === null) return refuse(root, 'gate-yes', `no fresh accepted pop-up from the owner quotes \`ci-fix gate-yes ${file}:${line}\`: ask first`);
	// A bare-line proof carries the file it binds to and the CI state's head at write time; closeout accepts it only for that file.
	const proof = ok.act === line ? { ...proofOf(ok), file, sha: stateSha } : proofOf(ok);
	const rec = { run, key: `gate:${file}:${line}`, cause: 'env', fix: 'the owner accepted this gate line change', files: [file], attempt: 1, grant: ok.id, proof };
	fs.mkdirSync(path.dirname(cf.file), { recursive: true });
	fs.appendFileSync(cf.file, `${JSON.stringify(rec)}\n`);
	process.stdout.write(`owner-yes written for ${rec.key}\n`);
	return 0;
}

function cmdFix(d, root) {
	let s;
	try {
		s = readState(d);
	} catch (e) {
		return refuse(root, 'fix', e.message);
	}
	const head = headSha(root);
	if (head === null || s.sha !== head) return refuse(root, 'fix', `the state is for ${s.sha.slice(0, 12)}, not HEAD: run ci-wait.mjs on HEAD`);
	const fixable = s.failed.filter((i) => i && i.kind === 'fixable');
	if (fixable.length === 0) {
		process.stdout.write('no fixable items: diagnose the others with ci-fix.mjs diagnose\n');
		return 0;
	}
	let cf;
	try {
		cf = readCifix(root);
	} catch (e) {
		return refuse(root, 'fix', e.message);
	}
	const allowed = new Set();
	const ran = new Set();
	for (const it of fixable) {
		const fx = FIXERS[it.name];
		if (!fx) return refuse(root, 'fix', `no fixer for ${it.key}: diagnose it instead`);
		if (ran.has(fx.script)) continue;
		ran.add(fx.script);
		const script = path.join(root, fx.script);
		if (!fs.existsSync(script)) return refuse(root, 'fix', `${fx.script} is missing`);
		const r = spawnSync(process.execPath, [script, ...fx.args], { cwd: root, encoding: 'utf8', windowsHide: true, timeout: 120000 });
		if (r.status !== 0) return refuse(root, 'fix', `node ${fx.script} ${fx.args.join(' ')} exited ${r.status}: ${String(r.stderr || '').trim().split('\n')[0]}`);
		for (const f of fx.out) allowed.add(f);
	}
	const changed = changedFiles(root);
	if (changed === null) return refuse(root, 'fix', 'git could not list the changed files');
	if (changed.length === 0) return refuse(root, 'fix', 'the fixers changed nothing: the red is not a stale file any more');
	const stray = changed.filter((f) => !allowed.has(f));
	if (stray.length) return refuse(root, 'fix', `the fixers changed ${stray.join(', ')}, outside their files: nothing committed`);
	const lines = fixable.map((it) => ({ run: s.run, key: it.key, cause: 'code', fix: FIXERS[it.name].fix, files: FIXERS[it.name].out, attempt: 1 }));
	fs.mkdirSync(path.dirname(cf.file), { recursive: true });
	for (const l of lines) fs.appendFileSync(cf.file, `${JSON.stringify(l)}\n`);
	const record = path.relative(root, cf.file).split(path.sep).join('/');
	const add = safeSpawn.git(root, ['add', '--', ...changed, record], { encoding: 'utf8' });
	if (add.status !== 0) return refuse(root, 'fix', `git add failed: ${String(add.stderr).trim().split('\n')[0]}`);
	const commit = safeSpawn.git(root, ['commit', '-q', '-m', 'fix: regenerate the stale rule map'], { encoding: 'utf8' });
	if (commit.status !== 0) return refuse(root, 'fix', `git commit failed: ${String(commit.stderr).trim().split('\n')[0]}`);
	process.stdout.write(`fixed ${lines.length} item(s): ${lines.map((l) => l.key).join(', ')}\n`);
	return 0;
}

export function main(argv, { cwd = process.cwd() } = {}) {
	const d = gitDirs(cwd);
	const root = d ? d.root : path.resolve(cwd);
	const [cmd, ...rest] = argv;
	if (cmd === 'digest') return cmdDigest(root, rest, d);
	if (cmd === 'gate-yes') return d ? cmdGateYes(d, root, rest) : refuse(root, 'gate-yes', 'not in a git repo');
	if (!d) return refuse(root, cmd || 'usage', 'not in a git repo');
	if (cmd === 'list') return cmdList(d, root);
	if (cmd === 'diagnose') return cmdDiagnose(d, root, rest);
	if (cmd === 'fix') return cmdFix(d, root);
	process.stderr.write('usage: node user/kit-tools/ci-fix.mjs list | digest (--jobs <file> --logs <dir> | --run <id> --repo <owner/name>) | diagnose <n> --cause code|pin|env --fix "<6 or more words>" --files <a,b> [--grant <id>] | gate-yes <file> <line> | fix\n');
	return 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) process.exitCode = main(process.argv.slice(2));
