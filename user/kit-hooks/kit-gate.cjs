// The kit gate (rule:kit-standards item 13). A missing kit is a full stop (the owner, 2026-10-31): the kit flow is how
// all work here is done, so a session in a folder without the kit refuses every prompt until the kit is installed.
//
// UserPromptSubmit, wired by `kit.mjs install user` into the Claude config folder's settings.json, so it runs in every
// folder - even one with no kit files to carry a hook. A prompt goes through when: the project has a kit install
// record (.kit/kit-version.json; its own hook checks the rest), the folder is the kit itself, the folder opted out
// with .kit/no-kit, or the prompt is the fix (it names methodology-kit or kit.mjs). Anything unexpected lets the
// prompt through.
const fs = require('fs');
const path = require('path');
const safeSpawn = require('./safe-spawn.cjs');

// K375 (U10): a crash in this hook obeys its tier. hook-error.cjs decides (small: the prompt goes through and the row is
// logged); with the helper missing the call is refused and one row is written, found with fs reads only (no child
// process). callCwd is the prompt's cwd, set once the input is read; the process cwd stands in for an unread input.
const HOOK = 'kit-gate';
let callCwd = process.cwd();

// The git common dir of `from`, from fs reads only: a folder's .git is the common dir; a "gitdir:" file names a worktree's
// folder, whose commondir file names the common one. Null when `from` is in no repo.
function commonDirFs(from) {
	let dir = path.resolve(String(from));
	for (;;) {
		const dotGit = path.join(dir, '.git');
		if (fs.existsSync(dotGit)) {
			if (fs.statSync(dotGit).isDirectory()) return dotGit;
			const m = /^gitdir:\s*(.+)$/m.exec(fs.readFileSync(dotGit, 'utf8'));
			if (!m) return null;
			const gitdir = path.resolve(dir, m[1].trim());
			try { return path.resolve(gitdir, fs.readFileSync(path.join(gitdir, 'commondir'), 'utf8').trim()); } catch { return gitdir; }
		}
		const up = path.dirname(dir);
		if (up === dir) return null;
		dir = up;
	}
}

// The refusal for stderr when this hook's crash is a deny, or null when its tier lets the prompt through.
function failed(error) {
	let helper = null;
	try { helper = require('./hook-error.cjs'); } catch { helper = null; }
	if (helper) {
		const answer = helper.onError(HOOK, error, callCwd);
		return answer ? answer.hookSpecificOutput.permissionDecisionReason : null;
	}
	try {
		const dir = commonDirFs(callCwd);
		if (dir) fs.appendFileSync(path.join(dir, 'kit-guard-open.log'), `${JSON.stringify({ kind: 'hook-error', id: 'hook-error', hook: `${HOOK}.cjs`, error: `hook-error.cjs is missing: ${String((error && error.message) || error).split('\n')[0]}`, at: new Date().toISOString() })}\n`);
	} catch { /* the refusal stands without its row */ }
	return 'hook error: lead review: hook-error.cjs is missing';
}

/**
 * Whether the guard launcher the user settings run is missing or cannot load (V3, 1.25.1). Its entry blocks on
 * failure (the owner's pick, 2026-11-11: a broken guard never lets a call through), so every tool call in every folder
 * stops; this says why, and what to run, before the session finds out one refused call at a time.
 */
function launcherBroken(home) {
	let s;
	try { s = JSON.parse(fs.readFileSync(path.join(home, 'settings.json'), 'utf8')); } catch { return ''; }
	if (!JSON.stringify((s && s.hooks && s.hooks.PreToolUse) || '').includes('kit-launch.cjs')) return '';
	const f = path.join(home, 'kit-tools', 'kit-launch.cjs');
	if (!fs.existsSync(f)) return 'missing';
	try { new (require('vm').Script)(fs.readFileSync(f, 'utf8'), { filename: f }); } catch { return 'broken (it does not load)'; }
	// Its entry names node by the path install user recorded (B14): a node moved or upgraded since fails every call.
	let node = null;
	try { node = JSON.parse(fs.readFileSync(path.join(home, 'kit-install.json'), 'utf8')).node || null; } catch { /* none */ }
	if (node && !fs.existsSync(node)) return `started by a node that is no longer there (${String(node).split(path.sep).join('/')}; moved or upgraded since install user)`;
	return '';
}

// The phase card (K374 S2 to S4): the first prompt of each session in a repo that holds a lead state record prints one
// line with the phase, the next step, the owed count and the VERDICT of lead-state check. It never blocks a prompt.
const LEAD_STATE = path.join(__dirname, '..', 'kit-tools', 'lead-state.mjs');
const CARD_DIR = 'kit-phase-card';

// The newest plans/<folder>/lead-state.json of the repo, or null when there is none.
function recordOf(root) {
	let best = null;
	let names = [];
	try { names = fs.readdirSync(path.join(root, 'plans')); } catch { return null; }
	for (const n of names) {
		const file = path.join(root, 'plans', n, 'lead-state.json');
		let mtime;
		try { mtime = fs.statSync(file).mtimeMs; } catch { continue; }
		if (!best || mtime > best.mtime) best = { file, mtime };
	}
	return best ? best.file : null;
}

// One row {at, hook, cause} in the git common folder's kit-guard-open.log; a failure to write it is swallowed.
function logRow(common, cause) {
	try {
		fs.appendFileSync(path.join(common, 'kit-guard-open.log'), `${JSON.stringify({ at: new Date().toISOString(), hook: 'kit-gate', cause: String(cause).slice(0, 120) })}\n`);
	} catch { /* the row is lost; the card line still prints */ }
}

// The card for this session's first prompt, or '' when there is nothing to show (no record, a later prompt, no session id).
function phaseCard(root, input) {
	const file = recordOf(root);
	const sid = String(input.session_id || '');
	if (!file || !sid) return '';
	const g = safeSpawn.gitRead(root, ['rev-parse', '--path-format=absolute', '--git-common-dir'], { encoding: 'utf8' });
	if (g.status !== 0) return '';
	const common = g.stdout.trim();
	const marker = path.join(common, CARD_DIR, sid.replace(/[^\w.-]/g, '_'));
	if (fs.existsSync(marker)) return '';
	try { fs.mkdirSync(path.dirname(marker), { recursive: true }); fs.writeFileSync(marker, ''); } catch { /* a repeat card is the worst case */ }
	let rec;
	try {
		rec = JSON.parse(fs.readFileSync(file, 'utf8'));
		if (!rec || !Array.isArray(rec.owed) || typeof rec.plan !== 'string') throw new Error('the record has no owed list or plan');
	} catch (e) {
		logRow(common, e.message);
		return 'lead state unreadable: run lead-state check';
	}
	const r = require('child_process').spawnSync(process.execPath, [LEAD_STATE, 'check', path.join(root, rec.plan)], { encoding: 'utf8', timeout: 60000, windowsHide: true });
	const verdict = /^VERDICT: .*$/m.exec(String(r.stdout || ''));
	return `lead state: phase ${rec.phase || 'none'}; next: ${rec.next || 'none'}; owed: ${rec.owed.length}; ${verdict ? verdict[0] : 'VERDICT: unknown'}`;
}

function main() {
	const input = JSON.parse(fs.readFileSync(0, 'utf8') || '{}');
	callCwd = input.cwd || callCwd;
	const gateHome = process.env.KIT_CLAUDE_HOME || path.dirname(__dirname);
	const broken = launcherBroken(gateHome);
	if (broken) {
		let kit = null;
		try { kit = JSON.parse(fs.readFileSync(path.join(gateHome, 'kit-install.json'), 'utf8')).kitDir || null; } catch { /* none */ }
		const where = path.join(gateHome, 'kit-tools', 'kit-launch.cjs').split(path.sep).join('/');
		process.stdout.write(JSON.stringify({
			decision: 'block',
			reason: `The kit guard launcher (${where}) is ${broken}, so Claude Code blocks every tool call in every folder: a broken guard never lets a call through. Repair it in a terminal from the release copy: node "${kit || '<kit folder>'}/scripts/kit.mjs" install user`,
		}));
		return;
	}
	if (/methodology-kit|kit\.mjs/i.test(String(input.prompt || ''))) return;
	const cwd = input.cwd || process.cwd();
	// git from node's own folder, never the folder of the prompt (build 23).
	const top = safeSpawn.gitRead(cwd, ['rev-parse', '--show-toplevel'], { encoding: 'utf8' });
	const root = top.status === 0 ? top.stdout.trim() : cwd;
	const has = (f) => fs.existsSync(path.join(root, f));
	const card = phaseCard(root, input);
	if (card) process.stdout.write(`${card}\n`);
	if (has('.kit/kit-version.json') || has('.kit/no-kit') || (has('scripts/kit.mjs') && has('rules'))) return;
	const where = root.split(path.sep).join('/');
	// The kit folder, from this config folder's install record (this file sits in <config folder>/kit-hooks/).
	const home = process.env.KIT_CLAUDE_HOME || path.dirname(__dirname);
	let kitDir = null;
	try { kitDir = JSON.parse(fs.readFileSync(path.join(home, 'kit-install.json'), 'utf8')).kitDir || null; } catch { /* none */ }
	// A pull moves the kit folder off its release tag, and install then refuses it, so the step names the tag.
	const pull = kitDir ? `git -C "${kitDir}" fetch --tags, then check out the newest release tag (git -C "${kitDir}" tag --sort=-v:refname lists it first)`
		: 'in your kit folder, git fetch --tags, then check out the newest release tag';
	// K175: under the plugin the skill carries the plugin's prefix.
	const skill = process.env.CLAUDE_PLUGIN_ROOT ? '/kit:methodology-kit' : '/methodology-kit';
	process.stdout.write(JSON.stringify({
		decision: 'block',
		reason: `Full stop: this folder (${where}) has no methodology kit. To install the latest: (1) in a terminal, ${pull}; (2) send ${skill} existing here (or ${skill} new for a fresh project), and Claude installs it. To work here without the kit, create .kit/no-kit in this folder.`,
	}));
}

// A crash obeys the tier: small lets the prompt through (the row is logged); a tier that denies writes exit 2 and the reason.
try {
	main();
} catch (error) {
	const reason = failed(error);
	if (reason) {
		process.stderr.write(`${reason}\n`);
		process.exitCode = 2;
	}
}
