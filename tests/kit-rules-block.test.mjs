// The "Rules every brief carries" block (K359): a kit sweep's briefs point at the block the rule index names for
// rule:agent-team-adapter, and the sweep brief writer refuses a block that still holds a template slot. The kit
// repo's own block must be filled, while the shipped template keeps its slots for installs to fill.
import { test } from './harness.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHIPPED = 'rules/agent-teams.md';
const { slotsIn } = await import(pathToFileURL(path.join(ROOT, 'user/skills/pre-pr-sweep/slots.mjs')).href);

// The block as approve.mjs reads it: from its heading line to the confirmation phrase line.
function blockOf(rel) {
	const lines = fs.readFileSync(path.join(ROOT, rel), 'utf8').split(/\r?\n/);
	const start = lines.findIndex((l) => /\*\*Rules every brief carries\*\*/.test(l));
	const end = start < 0 ? -1 : lines.findIndex((l, i) => i > start && /^\s*Confirmation phrase: .* with: \S/.test(l));
	assert.ok(end > start, `${rel} holds the block, from its heading to the confirmation phrase line`);
	return lines.slice(start, end + 1).join('\n');
}

// The file the index row for rule:agent-team-adapter names, as approve.mjs finds it.
function adapterFile() {
	const index = path.join(ROOT, 'standards/INDEX.md');
	assert.ok(fs.existsSync(index), 'standards/INDEX.md exists, so the kit repo names its own block');
	const row = fs.readFileSync(index, 'utf8').match(/^\|\s*agent-team-adapter\s*\|[^|\n]*\|\s*`([^`]+)`/m);
	assert.ok(row, 'the index has an agent-team-adapter row');
	assert.ok(fs.existsSync(path.resolve(ROOT, row[1])), `the index row names ${row[1]}, which exists`);
	return row[1];
}

// why: doc claim: the kit repo's rules block, as approve.mjs resolves it, holds no slot from slots.mjs (K359 S1)
test("the kit repo's rules block, as approve.mjs resolves it, holds no slot from slots.mjs", () => {
	const file = adapterFile();
	assert.deepEqual(slotsIn(blockOf(file)), [], `${file} still holds a template slot`);
});

// why: doc claim: the shipped rules/agent-teams.md block still holds its template slot, so installs keep the reminder (K359 S2)
test('the shipped rules/agent-teams.md block still holds its template slot, so installs keep the reminder', () => {
	assert.ok(slotsIn(blockOf(SHIPPED)).includes('<PROJECT NAME>'), 'the shipped block keeps <PROJECT NAME>');
	// The kit's own block is a different file, so filling it never empties the template.
	assert.notEqual(path.resolve(ROOT, adapterFile()), path.resolve(ROOT, SHIPPED),'the kit repo names a block of its own, not the shipped template');
});
