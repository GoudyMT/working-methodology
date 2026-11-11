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
const { spawnSync } = require('child_process');

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
	return '';
}

function main() {
	const input = JSON.parse(fs.readFileSync(0, 'utf8') || '{}');
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
	const top = spawnSync('git', ['-C', cwd, 'rev-parse', '--show-toplevel'], { encoding: 'utf8' });
	const root = top.status === 0 ? top.stdout.trim() : cwd;
	const has = (f) => fs.existsSync(path.join(root, f));
	if (has('.kit/kit-version.json') || has('.kit/no-kit') || (has('scripts/kit.mjs') && has('rules'))) return;
	const where = root.split(path.sep).join('/');
	// The kit folder, from this config folder's install record (this file sits in <config folder>/kit-hooks/).
	const home = process.env.KIT_CLAUDE_HOME || path.dirname(__dirname);
	let kitDir = null;
	try { kitDir = JSON.parse(fs.readFileSync(path.join(home, 'kit-install.json'), 'utf8')).kitDir || null; } catch { /* none */ }
	// A pull moves the kit folder off its release tag, and install then refuses it, so the step names the tag.
	const pull = kitDir ? `git -C "${kitDir}" fetch --tags, then check out the newest release tag (git -C "${kitDir}" tag --sort=-v:refname lists it first)`
		: 'in your kit folder, git fetch --tags, then check out the newest release tag';
	process.stdout.write(JSON.stringify({
		decision: 'block',
		reason: `Full stop: this folder (${where}) has no methodology kit. To install the latest: (1) in a terminal, ${pull}; (2) send /methodology-kit existing here (or /methodology-kit new for a fresh project), and Claude installs it. To work here without the kit, create .kit/no-kit in this folder.`,
	}));
}

try { main(); } catch { /* fail open: a broken gate must not lock every session */ }
