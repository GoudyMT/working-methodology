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

function emit(text) {
	const out = { systemMessage: text };
	if (MODE === 'session-start') out.hookSpecificOutput = { hookEventName: 'SessionStart', additionalContext: text };
	if (MODE === 'prompt') out.hookSpecificOutput = { hookEventName: 'UserPromptSubmit', additionalContext: text };
	process.stdout.write(JSON.stringify(out));
}

async function main() {
	const stampPath = path.join(HOME, 'kit-install.json');
	const kit = fs.existsSync(stampPath) ? JSON.parse(fs.readFileSync(stampPath, 'utf8')).kitDir : null;
	if (!kit || !fs.existsSync(path.join(kit, 'scripts', 'kit.mjs'))) {
		// A missing kit is a full stop (the owner, 2026-10-31): every prompt is refused with the fix, except a prompt
		// that installs it.
		if (MODE === 'prompt') {
			let prompt = '';
			try { prompt = String(JSON.parse(fs.readFileSync(0, 'utf8') || '{}').prompt || ''); } catch { /* none */ }
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
		emit(`Methodology kit not found in the Claude config folder ${HOME.split(path.sep).join('/')} (no kitDir in its kit-install.json). Run "node <kit>/scripts/kit.mjs install user" with CLAUDE_CONFIG_DIR set to that folder.`);
		return;
	}
	const lib = await import(pathToFileURL(path.join(kit, 'scripts', 'kit.mjs')).href);
	// Claude Code passes the hook input on stdin; for SessionStart, source is startup, resume, clear or compact.
	let source;
	try { source = JSON.parse(fs.readFileSync(0, 'utf8') || '{}').source; } catch { source = undefined; }
	const ctx = { kit, home: HOME, projectDir: PROJECT, source };
	if (MODE === 'session-start') {
		const text = lib.sessionStartReport(ctx);
		if (text) emit(text);
	} else if (MODE === 'prompt') {
		const text = lib.promptCheckReport(ctx);
		if (text) emit(text);
	} else if (MODE === 'pre-compact') {
		emit(lib.preCompactReport(ctx));
	}
}

main().catch((e) => { if (MODE !== 'prompt') emit(`Methodology kit hook skipped: ${e.message}`); }).finally(() => { process.exitCode = 0; });
