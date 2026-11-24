// K387 (patch 1.51.4, unit U23): a format example file is never an unfilled slot. Install prints one line per slot a project
// file still holds (scripts/kit.mjs unfilledSlotLines, unchanged), so a shipped -example file that holds a slot is reported
// as if the owner had left it unfilled. The first test installs the shipped project-map example into a fresh project and
// reads install's output. The second scans every git-tracked -example file under project/ and user/ for a slot from the
// slots.mjs list, so a new example with a slot fails CI.
import { test } from './harness.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import kitTemp from '../project/.claude/kit-temp.cjs';
import { copyKitCli, makeKit } from './kit-helpers.mjs';
import { slotsIn } from '../user/skills/pre-pr-sweep/slots.mjs';

// why: catches install project on a fresh project prints no unfilled-slot line naming a file whose name holds -example (K387 S1)
test('install project on a fresh project prints no unfilled-slot line naming a file whose name holds -example', () => {
	// A fixture kit with the CLI and the shipped project-map example, installed into a fresh project in temp folders.
	const ctx = makeKit();
	copyKitCli(ctx.kit);
	const example = fs.readFileSync(path.resolve('project/.claude/kit/project-map-example.json'), 'utf8');
	fs.mkdirSync(path.join(ctx.kit, 'project/.claude/kit'), { recursive: true });
	fs.writeFileSync(path.join(ctx.kit, 'project/.claude/kit/project-map-example.json'), example);
	const fakeHome = kitTemp.makeTemp('slot-examples-home-');
	const env = { ...process.env, HOME: fakeHome, USERPROFILE: fakeHome, CLAUDE_CONFIG_DIR: ctx.home, KIT_CLAUDE_HOME: ctx.home };
	delete env.CLAUDE_CODE_REMOTE;
	const r = spawnSync(process.execPath, [path.join(ctx.kit, 'scripts/kit.mjs'), 'install', 'project', ctx.proj, '--unreleased'], { encoding: 'utf8', env });
	assert.equal(r.status, 0, r.stderr);
	// The example must reach the fresh project, or an install that copies nothing would pass the check below.
	assert.ok(fs.existsSync(path.join(ctx.proj, '.claude/kit/project-map-example.json')), 'install did not copy project-map-example.json into the project');
	const slotLines = (r.stdout + r.stderr).split(/\r?\n/).filter((l) => l.includes('unfilled slot in'));
	const naming = slotLines.filter((l) => l.includes('-example'));
	assert.equal(naming.length, 0, `install named an -example file as an unfilled slot: ${naming.join(' | ')}`);
});

// why: catches every shipped file whose name holds -example holds no slot from the slots.mjs list (K387 S2)
test('every shipped file whose name holds -example holds no slot from the slots.mjs list', () => {
	const tracked = spawnSync('git', ['ls-files', 'project', 'user'], { encoding: 'utf8' });
	assert.equal(tracked.status, 0, tracked.stderr);
	const examples = tracked.stdout.split(/\r?\n/).filter((f) => f && path.basename(f).includes('-example'));
	// The scan must see the shipped examples, or an empty list would pass without proving anything.
	assert.ok(examples.includes('project/.claude/kit/project-map-example.json'), `the scan missed project-map-example.json: ${examples.join(', ')}`);
	assert.ok(examples.includes('project/.claude/kit/improvement-report-example.md'), `the scan missed improvement-report-example.md: ${examples.join(', ')}`);
	const withSlots = examples
		.map((f) => [f, slotsIn(fs.readFileSync(path.resolve(f), 'utf8'))])
		.filter(([, found]) => found.length > 0);
	assert.deepEqual(withSlots, [], `tracked -example files holding a slot: ${withSlots.map(([f, s]) => `${f} (${s.join(', ')})`).join('; ')}`);
});
