// K315 (build 24, unit U12): a fresh install leaves template slots unfilled (`<PROJECT NAME>`, `<fill in>`). Install
// prints each one it left, with its file, and the sweep brief writer refuses a rules block that still holds one. Only the
// named slot list counts: format examples such as `<feature branch>` or `<YYYY-MM-DD>` are never slots. Install runs as a
// child process in a fixture kit and project in temp folders, with HOME, USERPROFILE and the Claude folder pointed at temp
// dirs; the brief writer runs through the sweep fixtures in tests/kit-helpers.mjs, as tests/kit-sweep.test.mjs does.
import { test } from './harness.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import kitTemp from '../project/.claude/kit-temp.cjs';
import { approveRun, copyKitCli, featureContract, makeKit, makeTemp, sweepRepo } from './kit-helpers.mjs';

kitTemp.sessionRoot();

// A fixture kit with the CLI and the given project files (relative to the kit's project/ folder), unreleased, with its
// own temp Claude folder and home. Nothing installs into this repo or the owner's home.
function slotKit(files = {}) {
	const ctx = makeKit();
	copyKitCli(ctx.kit);
	for (const [rel, body] of Object.entries(files)) {
		const p = path.join(ctx.kit, 'project', rel);
		fs.mkdirSync(path.dirname(p), { recursive: true });
		fs.writeFileSync(p, body);
	}
	const fakeHome = makeTemp('slots-home-');
	const env = { ...process.env, HOME: fakeHome, USERPROFILE: fakeHome, CLAUDE_CONFIG_DIR: ctx.home, KIT_CLAUDE_HOME: ctx.home };
	delete env.CLAUDE_CODE_REMOTE;
	return { ...ctx, env };
}

const installProject = (ctx) =>
	spawnSync(process.execPath, [path.join(ctx.kit, 'scripts/kit.mjs'), 'install', 'project', ctx.proj, '--unreleased'], { encoding: 'utf8', env: ctx.env });

// The rules block the brief writer reads: a heading, a fence, and the Confirmation phrase line that ends it. `slotLine`
// goes inside the block; `above` is prose placed before the block.
const rulesText = (slotLine, above = 0) => [
	...Array.from({ length: above }, (_, i) => `prose line ${i + 1} above the block`),
	'8. **Rules every brief carries** (one home):',
	'   ```',
	'   RULES',
	slotLine,
	'   Confirmation (rule:agent-canary): see the Confirmation phrase: line below.',
	'   Confirmation phrase: open your first message with: Word Word',
	'   ```',
	'9. more',
	'',
].join('\n');

// A sweep repo whose project rules file holds `text`, untracked and excluded so it is read from the checkout.
function briefRepo(text) {
	const dir = sweepRepo();
	fs.mkdirSync(path.join(dir, 'standards'));
	fs.writeFileSync(path.join(dir, 'standards', 'agent-teams.md'), text);
	fs.appendFileSync(path.join(dir, '.git', 'info', 'exclude'), 'standards/\n');
	return dir;
}

const briefFile = (dir) => path.join(dir, 'sweeps', 'contract-brief-1.md');

// why: catches an install that leaves a template slot unnamed, so an unfilled project looks finished
test('install project prints one line per unfilled slot, naming the file and the slot', () => {
	const ctx = slotKit({ 'AGENTS.md': '# Agents\nProject: <PROJECT NAME>\nOwner notes: <fill in>\n' });
	const r = installProject(ctx);
	assert.equal(r.status, 0, r.stderr);
	const out = (r.stdout + r.stderr).split(/\r?\n/);
	assert.ok(out.some((l) => /AGENTS\.md/.test(l) && l.includes('<PROJECT NAME>')), 'no line names AGENTS.md and <PROJECT NAME>');
	assert.ok(out.some((l) => /AGENTS\.md/.test(l) && l.includes('<fill in>')), 'no line names AGENTS.md and <fill in>');
	assert.ok(!(r.stdout + r.stderr).includes(ctx.proj), 'a slot line names the absolute project folder, not the file');
});

// why: catches a format example such as <feature branch> reported as an unfilled slot, so every install shouts
test('install project never reports a format example as a slot', () => {
	const ctx = slotKit({ 'standards/examples.md': 'Branch: <feature branch>\nDate: <YYYY-MM-DD>\n' });
	const r = installProject(ctx);
	assert.equal(r.status, 0, r.stderr);
	assert.ok(!(r.stdout + r.stderr).includes('examples.md'), 'a format example was reported as an unfilled slot');
});

// why: catches a slot list wider than the two named slots, so kit prose with angle brackets gets reported
test('install project reports only the two named slots, not other angle-bracket text', () => {
	const ctx = slotKit({ 'AGENTS.md': 'Owner: <Owner name>\nTeam: <TBD>\n' });
	const r = installProject(ctx);
	assert.equal(r.status, 0, r.stderr);
	assert.ok(!(r.stdout + r.stderr).includes('AGENTS.md'), 'a non-named bracket text was reported as an unfilled slot');
});

// why: catches a filled project still reported as holding unfilled slots, so the owner learns to ignore the line
test('install project prints no slot line when every slot is filled', () => {
	const ctx = slotKit({ 'AGENTS.md': '# Agents\nProject: Ledger App\n' });
	const r = installProject(ctx);
	assert.equal(r.status, 0, r.stderr);
	assert.ok(!/<PROJECT NAME>|<fill in>/.test(r.stdout + r.stderr), 'a slot line printed for a filled project');
});

// why: catches a brief written with an unfilled <fill in> slot, so a reviewer reads a placeholder as a rule
test('the brief writer refuses a rules block that still holds <fill in>, naming the slot', () => {
	const dir = briefRepo(rulesText('   Owner: <fill in>'));
	const r = approveRun(featureContract(), dir);
	assert.notEqual(r.status, 0, 'a block with <fill in> wrote a brief');
	assert.match(r.stdout + r.stderr, /<fill in>/, 'the refusal does not name the slot');
	assert.ok(!fs.existsSync(briefFile(dir)), 'a brief file was written');
});

// why: catches a brief written with <PROJECT NAME> still in the block, so the project name reaches reviewers blank
test('the brief writer refuses a rules block that still holds <PROJECT NAME>, naming the slot', () => {
	const dir = briefRepo(rulesText('   Project: <PROJECT NAME>'));
	const r = approveRun(featureContract(), dir);
	assert.notEqual(r.status, 0, 'a block with <PROJECT NAME> wrote a brief');
	assert.match(r.stdout + r.stderr, /<PROJECT NAME>/, 'the refusal does not name the slot');
	assert.ok(!fs.existsSync(briefFile(dir)), 'a brief file was written');
});

// why: catches a format example in the block refused as a slot, so a filled block with a branch example never sweeps
test('the brief writer does not refuse a rules block that holds only <feature branch>', () => {
	const dir = briefRepo(rulesText('   Branch example: <feature branch>'));
	const r = approveRun(featureContract(), dir);
	assert.equal(r.status, 0, `refused: ${r.stdout} ${r.stderr}`);
	assert.ok(fs.existsSync(briefFile(dir)), 'no brief was written');
});

// why: catches a slot check that reads a fixed line offset, so extra prose above the block misses a slot inside it
test('the brief writer finds a slot in the block when prose lines sit above it', () => {
	const dir = briefRepo(rulesText('   Owner: <fill in>', 40));
	const r = approveRun(featureContract(), dir);
	assert.notEqual(r.status, 0, 'a slot below 40 added lines was missed');
	assert.match(r.stdout + r.stderr, /<fill in>/, 'the refusal does not name the slot');
});

// why: catches a clean block refused because it sits below extra prose, so a fixed offset would fail a filled project
test('the brief writer reads a filled block below extra prose lines and writes the brief', () => {
	const dir = briefRepo(rulesText('   Owner: Pat', 40));
	const r = approveRun(featureContract(), dir);
	assert.equal(r.status, 0, `refused: ${r.stdout} ${r.stderr}`);
	assert.ok(fs.existsSync(briefFile(dir)), 'no brief was written');
});

// why: catches a block with a named slot written to a brief because the check runs only on the first slot it finds
test('the brief writer refuses a block holding <fill in> after a format example, naming the slot', () => {
	const dir = briefRepo(rulesText('   Branch: <feature branch> and Owner: <fill in>'));
	const r = approveRun(featureContract(), dir);
	assert.notEqual(r.status, 0, 'a block with a named slot after an example wrote a brief');
	assert.match(r.stdout + r.stderr, /<fill in>/, 'the refusal does not name the slot');
});
