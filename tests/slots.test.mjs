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

// A refusal says what it refused and why, with no stack trace or raw error prefix on stderr.
const assertCleanRefusal = (r) => {
	assert.doesNotMatch(r.stderr, /\n\s+at /, 'the refusal printed a stack frame');
	assert.doesNotMatch(r.stderr, /^Error:/m, 'the refusal printed a raw Error: prefix');
};

// why: catches an install that leaves a template slot unnamed, so an unfilled project looks finished
test('install project prints one line per unfilled slot, naming the file and the slot', () => {
	const ctx = slotKit({ 'AGENTS.md': '# Agents\nProject: <PROJECT NAME>\nOwner notes: <fill in>\n' });
	const r = installProject(ctx);
	assert.equal(r.status, 0, r.stderr);
	const out = (r.stdout + r.stderr).split(/\r?\n/);
	assert.ok(out.some((l) => /AGENTS\.md/.test(l) && l.includes('<PROJECT NAME>')), 'no line names AGENTS.md and <PROJECT NAME>');
	assert.ok(out.some((l) => /AGENTS\.md/.test(l) && l.includes('<fill in>')), 'no line names AGENTS.md and <fill in>');
	const slotLines = out.filter((l) => l.includes('<PROJECT NAME>') || l.includes('<fill in>'));
	assert.ok(slotLines.every((l) => !l.includes(ctx.proj)), 'a slot line names the absolute project folder, not the file');
	// A filled project prints no slot line, so the owner does not learn to ignore the line.
	const filled = slotKit({ 'AGENTS.md': '# Agents\nProject: Ledger App\n' });
	const f = installProject(filled);
	assert.equal(f.status, 0, f.stderr);
	assert.ok(!/<PROJECT NAME>|<fill in>/.test(f.stdout + f.stderr), 'a slot line printed for a filled project');
	assert.ok(!(f.stdout + f.stderr).split(/\r?\n/).some((l) => /AGENTS\.md/.test(l)), 'a line names AGENTS.md for a filled project');
});

// why: catches two slots in two files reported as one line, or a nested file's line naming the wrong path
test('install project prints exactly one line per slot across two files, the nested one by its relative path', () => {
	const ctx = slotKit({ 'AGENTS.md': 'Project: <PROJECT NAME>\n', 'standards/x.md': 'Owner: <fill in>\n', 'notes/other.md': 'Owner: <Owner name>\nTeam: <TBD>\n' });
	const r = installProject(ctx);
	assert.equal(r.status, 0, r.stderr);
	const out = (r.stdout + r.stderr).split(/\r?\n/);
	const agents = out.filter((l) => l.includes('<PROJECT NAME>'));
	const nested = out.filter((l) => l.includes('<fill in>'));
	assert.equal(agents.length, 1, `lines for <PROJECT NAME>: ${agents.length}`);
	assert.equal(nested.length, 1, `lines for <fill in>: ${nested.length}`);
	assert.match(nested[0], /standards[\\/]x\.md/, 'the nested line does not name standards/x.md');
	assert.ok(!nested[0].includes(ctx.proj), 'the nested line names the absolute project folder');
	// Angle-bracket text that is not a named slot is never reported.
	assert.ok(!(r.stdout + r.stderr).includes('other.md'), 'a non-named bracket text was reported as an unfilled slot');
});

// why: catches a file with a format example and one real slot printing a line per token, so the example is reported
test('install project prints one line for a file holding two examples and one slot, naming only the slot', () => {
	const ctx = slotKit({ 'standards/mixed.md': 'Branch: <feature branch>\nDate: <YYYY-MM-DD>\nOwner: <fill in>\n', 'standards/examples.md': 'Branch: <feature branch>\nDate: <YYYY-MM-DD>\n' });
	const r = installProject(ctx);
	assert.equal(r.status, 0, r.stderr);
	const out = (r.stdout + r.stderr).split(/\r?\n/).filter((l) => /mixed\.md/.test(l));
	assert.equal(out.length, 1, `lines naming mixed.md: ${out.length}`);
	assert.ok(out[0].includes('<fill in>'), 'the one line does not name <fill in>');
	assert.ok(!/<feature branch>|<YYYY-MM-DD>/.test(out[0]), 'the line names a format example');
	// A file holding only format examples is never reported as an unfilled slot.
	assert.ok(!(r.stdout + r.stderr).includes('examples.md'), 'a format example was reported as an unfilled slot');
});

// why: guards rule:kit-standards (slot list copied into a second file that drifts)
test('the named slot list lives in one non-test script that approve.mjs reads rather than copies', () => {
	const roots = ['scripts', 'user/skills'].map((d) => path.resolve(d));
	const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => {
		const p = path.join(d, e.name);
		return e.isDirectory() ? walk(p) : [p];
	});
	const holders = roots.flatMap(walk)
		.filter((f) => /\.(mjs|cjs)$/.test(f) && !/\.test\.(mjs|cjs)$/.test(f))
		.filter((f) => fs.readFileSync(f, 'utf8').includes('<PROJECT NAME>'));
	assert.equal(holders.length, 1, `files holding the literal: ${holders.map((f) => path.relative(process.cwd(), f)).join(', ')}`);
	const approve = path.resolve('user/skills/pre-pr-sweep/approve.mjs');
	assert.notEqual(holders[0], approve, 'the slot list is written in approve.mjs itself');
	const base = path.basename(holders[0]);
	assert.ok(fs.readFileSync(approve, 'utf8').includes(base), `approve.mjs does not import or read ${base}`);
});

// why: catches a brief written with an unfilled <fill in> slot, so a reviewer reads a placeholder as a rule
test('the brief writer refuses a rules block that still holds <fill in>, naming the slot', () => {
	const dir = briefRepo(rulesText('   Owner: <fill in>'));
	const r = approveRun(featureContract(), dir);
	assert.notEqual(r.status, 0, 'a block with <fill in> wrote a brief');
	assert.match(r.stdout + r.stderr, /<fill in>/, 'the refusal does not name the slot');
	assertCleanRefusal(r);
	assert.ok(!fs.existsSync(briefFile(dir)), 'a brief file was written');
	// Slot-like text in prose above a clean block is not a slot, so the filled block still writes a brief.
	const clean = briefRepo(`Prose note: leave <fill in> for later.\n${rulesText('   Owner: Pat')}`);
	const c = approveRun(featureContract(), clean);
	assert.equal(c.status, 0, `refused: ${c.stdout} ${c.stderr}`);
	assert.ok(fs.existsSync(briefFile(clean)), 'no brief was written');
});

// why: catches a brief written with <PROJECT NAME> still in the block, so the project name reaches reviewers blank
test('the brief writer refuses a rules block that still holds <PROJECT NAME>, naming the slot', () => {
	const dir = briefRepo(rulesText('   Project: <PROJECT NAME>'));
	const r = approveRun(featureContract(), dir);
	assert.notEqual(r.status, 0, 'a block with <PROJECT NAME> wrote a brief');
	assert.match(r.stdout + r.stderr, /<PROJECT NAME>/, 'the refusal does not name the slot');
	assertCleanRefusal(r);
	assert.ok(!fs.existsSync(briefFile(dir)), 'a brief file was written');
	// A format example alone in a block is not a slot, and a slot after a clean block's last line is outside the block.
	const example = briefRepo(rulesText('   Branch example: <feature branch>'));
	const e = approveRun(featureContract(), example);
	assert.equal(e.status, 0, `refused: ${e.stdout} ${e.stderr}`);
	assert.ok(fs.existsSync(briefFile(example)), 'no brief was written');
	const trailing = briefRepo(`${rulesText('   Owner: Pat')}Trailing note: <PROJECT NAME>\n`);
	const t = approveRun(featureContract(), trailing);
	assert.equal(t.status, 0, `refused: ${t.stdout} ${t.stderr}`);
	assert.ok(fs.existsSync(briefFile(trailing)), 'no brief was written');
});

// why: catches a brief written with a privacy or scanner slot still unfilled, so reviewers read a placeholder as a rule.
test('the brief writer refuses a rules block still holding <data boundary>, <secret files>, <safe logger> or <scanner>', () => {
	for (const slot of ['<data boundary>', '<secret files>', '<safe logger>', '<scanner>']) {
		const dir = briefRepo(rulesText(`   Privacy: ${slot}`));
		const r = approveRun(featureContract(), dir);
		assert.notEqual(r.status, 0, `a block with ${slot} wrote a brief`);
		assert.ok((r.stdout + r.stderr).includes(slot), `the refusal does not name ${slot}`);
		assertCleanRefusal(r);
		assert.ok(!fs.existsSync(briefFile(dir)), `a brief file was written for ${slot}`);
	}
	// Control: the same block with a plain value in place of the slot writes a brief.
	const filled = briefRepo(rulesText('   Privacy: Pat, the pilot data only'));
	const f = approveRun(featureContract(), filled);
	assert.equal(f.status, 0, `refused: ${f.stdout} ${f.stderr}`);
	assert.ok(fs.existsSync(briefFile(filled)), 'no brief was written for the filled block');
});

// why: catches a slot check that reads a fixed line offset, so extra prose above the block misses a slot inside it
test('the brief writer finds a slot in the block when prose lines sit above it', () => {
	const dir = briefRepo(rulesText('   Owner: <fill in>', 40));
	const r = approveRun(featureContract(), dir);
	assert.notEqual(r.status, 0, 'a slot below 40 added lines was missed');
	assert.match(r.stdout + r.stderr, /<fill in>/, 'the refusal does not name the slot');
	assertCleanRefusal(r);
	// A filled block below the same extra prose is read as filled, so it writes the brief.
	const filled = briefRepo(rulesText('   Owner: Pat', 40));
	const f = approveRun(featureContract(), filled);
	assert.equal(f.status, 0, `refused: ${f.stdout} ${f.stderr}`);
	assert.ok(fs.existsSync(briefFile(filled)), 'no brief was written');
});

// why: catches a block with a named slot written to a brief because the check runs only on the first slot it finds
test('the brief writer refuses a block holding <fill in> after a format example, naming the slot', () => {
	const dir = briefRepo(rulesText('   Branch: <feature branch> and Owner: <fill in>'));
	const r = approveRun(featureContract(), dir);
	assert.notEqual(r.status, 0, 'a block with a named slot after an example wrote a brief');
	assert.match(r.stdout + r.stderr, /<fill in>/, 'the refusal does not name the slot');
	assertCleanRefusal(r);
});
