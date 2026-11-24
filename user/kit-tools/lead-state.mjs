#!/usr/bin/env node
// The lead state record: one JSON file in the plan folder, so a fresh lead reads the build's state from files instead of
// the old lead's context. Usage: node user/kit-tools/lead-state.mjs write <plan.md> [--transcript <file>] | check <plan.md> [--session <id>]
// - write builds the record from the plan, its locks file, the flow log, the lead checklist, the hook log, the VERSION file,
//   the closeout file and git, and writes <plan dir>/lead-state.json. No field is typed in; the record seals itself with a sha.
//   With --transcript (the context watch passes the lead's), agents lists that session's open warm agents; none without it.
// - check refuses a record whose sha does not match its fields, rebuilds the record from the live sources, prints one line per
//   field (same or CHANGED) and one VERDICT line. Exit 0 only on ok.
// A source that cannot be read stops the build (VERDICT full-read, exit 1) and one row goes to the git common folder's
// kit-guard-open.log. A source that is absent (no locks file, no closeout, no hook log yet) is a null or an empty list.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { openAgents } from './warm.mjs';

const RECORD_NAME = 'lead-state.json';
const PASS_NAME = 'kit-lead-state-ok';
const HOOK_LOG = 'kit-guard-open.log';
const HOOK = 'lead-state';
const RECORD_VERSION = 1;
const FIELDS = ['version', 'plan', 'planSha', 'locksSha', 'phase', 'head', 'merged', 'next', 'owed', 'questions', 'hookErrors', 'closeout', 'sources'];

// A source that cannot be read, or a line that is not what the kit writes: the record is not built.
class FullRead extends Error {
	constructor(file, cause) {
		super(cause);
		this.file = file;
	}
}

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
const filled = (v) => typeof v === 'string' && v.trim() !== '';
const say = (msg) => process.stdout.write(`${msg}\n`);
const verdict = (text, code) => {
	say(`VERDICT: ${text}`);
	return code;
};

// JSON with sorted keys: the same fields give the same bytes whatever order they were built in.
function canon(v) {
	return JSON.stringify(v, (k, val) => (val && typeof val === 'object' && !Array.isArray(val) ? Object.fromEntries(Object.keys(val).sort().map((key) => [key, val[key]])) : val));
}

// git in a folder, launched as flow-check.mjs launches it: from node's own folder, with the git.exe lookup switched off.
function gitOut(folder, args) {
	const r = spawnSync('git', ['-C', folder, '-c', 'core.fsmonitor=false', ...args], {
		encoding: 'utf8',
		timeout: 60000,
		windowsHide: true,
		cwd: path.dirname(process.execPath),
		env: { ...process.env, NoDefaultCurrentDirectoryInExePath: '1' },
	});
	if (r.status !== 0) throw new FullRead(folder, `git ${args.join(' ')} failed in ${folder}`);
	return r.stdout.trim();
}

// The bytes of a file the record needs: any read failure is a full read.
function readReq(file) {
	try {
		return fs.readFileSync(file);
	} catch (e) {
		throw new FullRead(file, `cannot read ${file}: ${e.code || e.message}`);
	}
}

// The bytes of a file the record may lack: null when absent; any other read failure is a full read.
function readOpt(file) {
	try {
		return fs.readFileSync(file);
	} catch (e) {
		if (e.code === 'ENOENT') return null;
		throw new FullRead(file, `cannot read ${file}: ${e.code || e.message}`);
	}
}

// One JSON object per non-blank line; a line that is not one makes the file unreadable.
function jsonLines(buf, file) {
	return buf.toString('utf8').split(/\r?\n/).flatMap((raw, i) => {
		if (!raw.trim()) return [];
		let o;
		try {
			o = JSON.parse(raw);
		} catch {
			throw new FullRead(file, `${file} line ${i + 1} is not JSON`);
		}
		if (o === null || typeof o !== 'object' || Array.isArray(o)) throw new FullRead(file, `${file} line ${i + 1} is not an object`);
		return [o];
	});
}

// The open warm agents of the lead's session, read from the subagents folder beside its transcript (the folder call-cap.cjs
// meters from); none when no transcript is named. A folder that cannot be read is a full read.
function agentsOf(transcript) {
	if (transcript === null) return [];
	const dir = path.join(transcript.replace(/\.jsonl$/, ''), 'subagents');
	try {
		return openAgents(dir).map(({ id, role, lane, tokens }) => ({ id, role, lane, tokens }));
	} catch (e) {
		throw new FullRead(dir, `cannot read the open agents in ${dir}: ${e.code || e.message}`);
	}
}

// The record's fields from the live sources, without the sha; throws FullRead when a source cannot be read.
function build(planArg, transcript = null) {
	const plan = path.resolve(planArg);
	const planDir = path.dirname(plan);
	const top = gitOut(planDir, ['rev-parse', '--show-toplevel']);
	const common = path.resolve(planDir, gitOut(planDir, ['rev-parse', '--git-common-dir']));
	const head = gitOut(planDir, ['rev-parse', 'HEAD']);
	const label = (file) => path.relative(top, file).split(path.sep).join('/');

	const planBuf = readReq(plan);
	const locksFile = `${plan}.locks.json`;
	const locksBuf = readOpt(locksFile);
	const flowFile = path.join(planDir, 'flow.jsonl');
	const flowBuf = readReq(flowFile);
	const checklistFile = path.join(planDir, 'lead-checklist.jsonl');
	const checklistBuf = readReq(checklistFile);
	const hookFile = path.join(common, HOOK_LOG);
	const hookBuf = readOpt(hookFile);
	const versionFile = path.join(top, 'VERSION');
	const versionBuf = readOpt(versionFile);
	const version = versionBuf === null ? '' : versionBuf.toString('utf8').trim();
	const closeoutFile = path.join(top, 'docs', 'builds', `${version}.closeout.json`);
	const closeoutBuf = version ? readOpt(closeoutFile) : null;

	const sources = [
		[plan, planBuf],
		[locksFile, locksBuf],
		[flowFile, flowBuf],
		[checklistFile, checklistBuf],
		[hookFile, hookBuf],
		[versionFile, versionBuf],
		[closeoutFile, closeoutBuf],
	]
		.filter(([, buf]) => buf !== null)
		.map(([file, buf]) => ({ file: label(file), sha: sha256(buf) }));

	const flow = jsonLines(flowBuf, flowFile);
	const merged = [];
	const reported = new Set();
	for (const e of flow) {
		if (e.kind === 'hook-report') {
			if (filled(e.error) && filled(e.cause) && filled(e.fix)) reported.add(e.error.trim());
			continue;
		}
		if (e.step === 'merged' && filled(e.unit) && !merged.includes(e.unit.trim())) merged.push(e.unit.trim());
	}

	const hookErrors = hookBuf === null
		? []
		: jsonLines(hookBuf, hookFile)
				.filter((e) => e.kind === 'hook-error' && filled(e.id) && !reported.has(e.id.trim()))
				.map((e) => ({ id: e.id.trim(), hook: e.hook ?? null, cause: e.cause ?? null, at: e.at ?? null }));

	const steps = jsonLines(checklistBuf, checklistFile).filter((e) => !('kind' in e) || filled(e.item));
	for (const e of steps) if (!filled(e.item)) throw new FullRead(checklistFile, `${checklistFile} has a line with no item`);
	const undone = steps.filter((e) => e.done !== true);
	const owed = undone.map((e) => e.item);

	return {
		version: RECORD_VERSION,
		plan: label(plan),
		planSha: sha256(planBuf),
		locksSha: locksBuf === null ? null : sha256(locksBuf),
		phase: undone.length && typeof undone[0].phase === 'string' ? undone[0].phase : null,
		head,
		merged,
		next: owed.length ? owed[0] : null,
		owed,
		questions: undone.filter((e) => e.question === true).map((e) => e.item),
		hookErrors,
		closeout: closeoutBuf === null ? null : sha256(closeoutBuf),
		sources,
		agents: agentsOf(transcript),
	};
}

// The record with its sha: the sha of the record's fields, sorted, so a hand edit of any field breaks it.
function seal(rec) {
	return { ...rec, sha: sha256(canon(rec)) };
}

// The fail-closed answer: one row {at, hook, cause} in the git common folder's kit-guard-open.log, then the full-read verdict.
function fullRead(planArg, e) {
	try {
		const planDir = path.dirname(path.resolve(planArg));
		const common = path.resolve(planDir, gitOut(planDir, ['rev-parse', '--git-common-dir']));
		fs.appendFileSync(path.join(common, HOOK_LOG), `${JSON.stringify({ at: new Date().toISOString(), hook: HOOK, cause: e.message })}\n`);
	} catch {
		// No git folder or no write to it: the verdict still stands; only the log row is lost.
	}
	return verdict(`full-read (${e.file})`, 1);
}

function write(planArg, transcript) {
	let rec;
	try {
		rec = build(planArg, transcript);
	} catch (e) {
		if (e instanceof FullRead) return fullRead(planArg, e);
		throw e;
	}
	const file = path.join(path.dirname(path.resolve(planArg)), RECORD_NAME);
	fs.writeFileSync(file, `${JSON.stringify(seal(rec), null, 2)}\n`);
	say(`lead-state: wrote ${file}`);
	return 0;
}

// The pass a session earns with a check that says ok: {session, sha, at}, in the git common folder, read by agent-model.cjs.
function writePass(planDir, session, sha) {
	const common = path.resolve(planDir, gitOut(planDir, ['rev-parse', '--git-common-dir']));
	fs.writeFileSync(path.join(common, PASS_NAME), `${JSON.stringify({ session, sha, at: new Date().toISOString() })}\n`);
}

function check(planArg, session) {
	const planDir = path.dirname(path.resolve(planArg));
	const file = path.join(planDir, RECORD_NAME);
	let text;
	try {
		text = fs.readFileSync(file, 'utf8');
	} catch (e) {
		if (e.code === 'ENOENT') return verdict('missing (run lead-state write <plan>)', 1);
		return verdict('refused (record unreadable)', 1);
	}
	let stored;
	try {
		stored = JSON.parse(text);
	} catch {
		stored = null;
	}
	if (stored === null || typeof stored !== 'object' || Array.isArray(stored) || typeof stored.sha !== 'string') {
		return verdict('refused (record edited by hand)', 1);
	}
	const { sha, ...rest } = stored;
	if (sha256(canon(rest)) !== sha) return verdict('refused (record edited by hand)', 1);

	let live;
	try {
		live = build(planArg);
	} catch (e) {
		if (e instanceof FullRead) return fullRead(planArg, e);
		throw e;
	}
	const changed = [];
	for (const f of FIELDS) {
		const same = canon(stored[f]) === canon(live[f]);
		if (!same) changed.push(f);
		say(`${f}: ${same ? 'same' : 'CHANGED'}`);
	}
	if (changed.length) return verdict(`stale (${changed.join(', ')})`, 1);
	if (session === null) return verdict('ok', 0);
	try {
		writePass(planDir, session, stored.sha);
	} catch (e) {
		return verdict(`refused (pass not written: ${e.code || e.message})`, 1);
	}
	return verdict('ok', 0);
}

function main(argv) {
	const [cmd, plan, ...extra] = argv;
	// write takes the lead's transcript (--transcript <file>) to list its open warm agents; check takes the session it passes
	// for (--session <id>), and only an ok check writes that session's pass. No flag is none.
	const flag = cmd === 'write' ? '--transcript' : '--session';
	const value = extra.length === 2 && extra[0] === flag && extra[1] !== '' ? extra[1] : null;
	if ((extra.length && value === null) || plan === undefined || (cmd !== 'write' && cmd !== 'check')) {
		process.stderr.write('usage: lead-state.mjs write <plan.md> [--transcript <file>] | check <plan.md> [--session <id>]\n');
		return 2;
	}
	return cmd === 'write' ? write(plan, value) : check(plan, value);
}

process.exitCode = main(process.argv.slice(2));
