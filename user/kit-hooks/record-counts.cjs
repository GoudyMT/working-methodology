// The record check of a reviewer's hand-back (kit-tools/handoff.mjs), run in its own program from node's own folder, as
// handoff-gate.cjs does. A report with a RECORD: line counts as the report: its role line, its findings and its notChecked
// line stand for the ROLE, finding and "Not checked:" lines. Null when the record is refused for its own fault. When the
// checker cannot run, the record still counts as one notChecked, so a hand-back is never refused for the checker.
const fs = require('fs');
const path = require('path');
const safeSpawn = require('./safe-spawn.cjs');

// The checker's own refusals name the record's lines; anything else from it (a crash, a load error) is the checker's fault.
const RECORD_FAULT = /^(line \d+: |no RECORD: line|two records:|the record is empty)/;

function recordCounts(report) {
	if (!String(report).split(/\r?\n/).some((l) => l.trim() === 'RECORD:')) return null;
	const checker = path.join(__dirname, '..', 'kit-tools', 'handoff.mjs');
	const open = { findings: 0, notChecked: 1 };
	if (!fs.existsSync(checker)) return open;
	const r = safeSpawn.tool(process.execPath, [checker, 'check', '-'], { input: String(report), encoding: 'utf8' });
	if (r.status === 0) {
		const m = /^ok: (\d+) findings, (\d+) notChecked/m.exec(String(r.stdout));
		return m ? { findings: Number(m[1]), notChecked: Number(m[2]) } : null;
	}
	if (r.status === 1) {
		const errs = String(r.stderr).split(/\r?\n/).filter(Boolean);
		if (errs.length && errs.every((l) => RECORD_FAULT.test(l))) return null;
	}
	return open;
}

module.exports = { recordCounts };
