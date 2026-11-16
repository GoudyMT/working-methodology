// The methodology kit's hooks, so the kit check cannot be missed by mistake.
// Usage (settings.json): command "node", args [<this file>, "session-start" | "prompt" | "pre-compact"].
//   session-start: tells Claude (as context) when the kit has newer rules, and which skills apply to the cases this
//                  project turned on; the same text is shown to the owner.
//   prompt:        on each message, says once per new kit version that the kit was released while this session
//                  ran (another project folded a rule back); silent otherwise, and silent on any failure, since
//                  session start already reported those.
//   pre-compact:   runs fold-back in report mode and shows the owner how many rule changes wait for the kit.
// It finds the kit through ~/.claude/kit-install.json ("kitDir"). Any failure is a warning: a hook that
// errors must never stop a session or a compact.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');

const MODE = process.argv[2];
// The Claude config folder: CLAUDE_CONFIG_DIR when a second one is in use, else ~/.claude.
const HOME = process.env.KIT_CLAUDE_HOME || process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
const PROJECT = process.env.CLAUDE_PROJECT_DIR || process.cwd();
// The hook input, read once: stdin can be read only once.
const INPUT = (() => { try { return JSON.parse(fs.readFileSync(0, 'utf8') || '{}'); } catch { return {}; } })();

function emit(text) {
	const out = { systemMessage: text };
	if (MODE === 'session-start') out.hookSpecificOutput = { hookEventName: 'SessionStart', additionalContext: text };
	if (MODE === 'prompt') out.hookSpecificOutput = { hookEventName: 'UserPromptSubmit', additionalContext: text };
	process.stdout.write(JSON.stringify(out));
}

// The resume packet is written first, in its own try and before the kit is looked up: a compact must leave a packet
// that matches the files even when the kit is missing or a later step throws (T3).
function writePacket() {
	try {
		const session = String(INPUT.session_id || '');
		const script = path.join(PROJECT, '.claude', 'resume-packet.mjs');
		if (!fs.existsSync(script)) return 'resume packet: .claude/resume-packet.mjs is missing (install project).';
		const r = require('child_process').spawnSync(process.execPath, [script, 'write', '--session', session], { cwd: PROJECT, encoding: 'utf8', timeout: 15000 });
		return (r.stdout || '').trim() || `resume packet not written (exit ${r.status})`;
	} catch (e) { return `resume packet not written: ${e.message}`; }
}

// Loop mode's state machine (rule:loop-workflow-mode), held by the loop driver: any owner message but the phrase
// halts an armed loop, and session start and a compact turn it off. Only the phrase's presence is handed on. The
// prompt and session start hooks also record the session, the one whose answers the driver reads: Claude Code hands
// it to the hook, where the caller's environment could name another (the build 12 sweep). Short time-outs, so the
// hook's own 10 seconds still leave room for the rest.
function loopMode() {
	try {
		const script = path.join(PROJECT, '.claude', 'loop.mjs');
		if (!fs.existsSync(script)) return;
		const { spawnSync } = require('child_process');
		const sid = String(INPUT.session_id || '');
		if (MODE !== 'pre-compact' && /^[0-9a-f-]{36}$/i.test(sid)) {
			const git = spawnSync('git', ['-C', PROJECT, 'rev-parse', '--path-format=absolute', '--git-common-dir'], { encoding: 'utf8', timeout: 3000 });
			if (git.status === 0) fs.writeFileSync(path.join(git.stdout.trim(), 'kit-loop-session'), sid);
		}
		const args = MODE === 'prompt' ? ['prompt', '--text', String(INPUT.prompt || '').trim() === 'begin loop workflow' ? 'begin loop workflow' : 'another message']
			: ['off', '--why', MODE === 'pre-compact' ? 'compact' : 'session start'];
		spawnSync(process.execPath, [script, 'mode', ...args], { cwd: PROJECT, encoding: 'utf8', timeout: 3000 });
	} catch { /* a hook that errors must never stop a session */ }
}

async function main() {
	// First, so a missing kit never leaves an armed loop on; its two calls are cut at 3 seconds each, inside the hook's 10.
	loopMode();
	const packet = MODE === 'pre-compact' ? writePacket() : '';
	const stampPath = path.join(HOME, 'kit-install.json');
	let kit = null;
	try { kit = JSON.parse(fs.readFileSync(stampPath, 'utf8')).kitDir || null; } catch { /* no stamp, or not JSON: the full stop below */ }
	if (!kit || !fs.existsSync(path.join(kit, 'scripts', 'kit.mjs'))) {
		// A missing kit is a full stop (the owner, 2026-10-31): every prompt is refused with the fix, except a prompt
		// that installs it.
		if (MODE === 'prompt') {
			const prompt = String(INPUT.prompt || '');
			if (/methodology-kit|kit\.mjs/i.test(prompt)) return;
			const where = HOME.split(path.sep).join('/');
			// The kit folder, from this project's install record.
			let kitDir = null;
			try { kitDir = JSON.parse(fs.readFileSync(path.join(PROJECT, '.kit', 'kit-version.json'), 'utf8')).kitDir || null; } catch { /* none */ }
			const steps = kitDir
				? `(1) git -C "${kitDir}" fetch --tags, then check out the newest release tag (git -C "${kitDir}" tag --sort=-v:refname lists it first); (2) in PowerShell: $env:CLAUDE_CONFIG_DIR='${where}'; node "${kitDir}/scripts/kit.mjs" install user`
				: `(1) in your kit folder, git fetch --tags, then check out the newest release tag; (2) with CLAUDE_CONFIG_DIR set to ${where}, run node <kit folder>/scripts/kit.mjs install user`;
			process.stdout.write(JSON.stringify({ decision: 'block', reason: `Full stop: the methodology kit is not installed in the Claude config folder ${where}. Install the latest in a terminal: ${steps}. Then start a fresh session.` }));
			return;
		}
		emit(`${packet ? `${packet}\n` : ''}Methodology kit not found in the Claude config folder ${HOME.split(path.sep).join('/')} (no kitDir in its kit-install.json). Run "node <kit>/scripts/kit.mjs install user" with CLAUDE_CONFIG_DIR set to that folder.`);
		return;
	}
	const lib = await import(pathToFileURL(path.join(kit, 'scripts', 'kit.mjs')).href);
	// Claude Code passes the hook input on stdin; for SessionStart, source is startup, resume, clear or compact.
	const ctx = { kit, home: HOME, projectDir: PROJECT, source: INPUT.source };
	if (MODE === 'session-start') {
		const text = lib.sessionStartReport(ctx);
		if (text) emit(text);
	} else if (MODE === 'prompt') {
		const text = lib.promptCheckReport(ctx);
		if (text) emit(text);
	} else if (MODE === 'pre-compact') {
		emit(`${packet}\n${lib.preCompactReport(ctx)}`);
	}
}

main().catch((e) => { if (MODE !== 'prompt') emit(`Methodology kit hook skipped: ${e.message}`); }).finally(() => { process.exitCode = 0; });
