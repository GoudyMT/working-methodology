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
const HOME = process.env.KIT_CLAUDE_HOME || path.join(os.homedir(), '.claude');
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
		if (MODE === 'prompt') return;
		emit('Methodology kit not found (no kitDir in ~/.claude/kit-install.json). Run "node <kit>/scripts/kit.mjs install user".');
		return;
	}
	const lib = await import(pathToFileURL(path.join(kit, 'scripts', 'kit.mjs')).href);
	const ctx = { kit, home: HOME, projectDir: PROJECT };
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
