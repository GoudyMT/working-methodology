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

function main() {
	const input = JSON.parse(fs.readFileSync(0, 'utf8') || '{}');
	if (/methodology-kit|kit\.mjs/i.test(String(input.prompt || ''))) return;
	const cwd = input.cwd || process.cwd();
	const top = spawnSync('git', ['-C', cwd, 'rev-parse', '--show-toplevel'], { encoding: 'utf8' });
	const root = top.status === 0 ? top.stdout.trim() : cwd;
	const has = (f) => fs.existsSync(path.join(root, f));
	if (has('.kit/kit-version.json') || has('.kit/no-kit') || (has('scripts/kit.mjs') && has('rules'))) return;
	const where = root.split(path.sep).join('/');
	process.stdout.write(JSON.stringify({
		decision: 'block',
		reason: `Full stop: this folder (${where}) has no methodology kit. Install the latest first: git pull in the kit folder, then /methodology-kit existing (or /methodology-kit new for a fresh project). To work here without the kit, create .kit/no-kit in this folder.`,
	}));
}

try { main(); } catch { /* fail open: a broken gate must not lock every session */ }
