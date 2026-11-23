// The overwatch checklist: the build lead logs each unit's steps as JSON lines, and this reads them against the plan.
// A unit that is merged needs its tests, review and build steps before its merged step; a unit whose files hit a
// guard path (GUARD_PATHS in tester-model.mjs) needs a check step before it too. Lines are read in the order the log
// gives them, and a unit's at times must not go backwards; equal times are fine. The steps may carry extra fields
// (a record, a by). Pure: flow-check.mjs reads the two files and prints the result.

import { GUARD_PATHS } from './tester-model.mjs';
import { filesOf } from './test-budget.mjs';

export const STEPS = ['tests', 'review', 'build', 'check', 'fix', 'retest', 'merged'];
const REQUIRED = ['tests', 'review', 'build'];
const RETEST_LINE = /^retest:/;

// An input that cannot be read as a plan or a log. flow-check.mjs turns it into exit 2.
export class InputError extends Error {}

// A Tests cell names a planned retest when one of its <br>-separated lines starts "retest:": the unit changes a locked test.
export function hasRetestLine(testsCell) {
	return testsCell.split(/<br\s*\/?>/i).some((l) => RETEST_LINE.test(l.trim()));
}

// The units of a plan's Units table: [{ id, files }], the files being the backticked paths of the Files cell.
export function planUnits(text) {
	const lines = text.replace(/\r\n/g, '\n').split('\n');
	const at = lines.findIndex((l) => /^## Units\b/.test(l));
	if (at < 0) throw new InputError('the plan has no ## Units table');
	let head = null;
	const units = [];
	for (const l of lines.slice(at + 1)) {
		if (/^#{1,6} /.test(l)) break;
		if (!/^\s*\|/.test(l)) {
			if (head) break;
			continue;
		}
		const cells = l.trim().split(/(?<!\\)\|/).slice(1, -1).map((c) => c.trim());
		if (!head) {
			head = cells.map((c) => c.toLowerCase());
			continue;
		}
		if (cells.every((c) => /^:?-+:?$/.test(c))) continue;
		const id = (cells[head.findIndex((h) => h.startsWith('id'))] || '').replace(/[*_`]/g, '').trim();
		if (!id) continue;
		const cell = (key) => cells[head.findIndex((h) => h.startsWith(key))] || '';
		units.push({ id, files: filesOf(cell('files')), risk: cell('risk').trim().toLowerCase(), category: cell('category').trim().toLowerCase(), retest: hasRetestLine(cell('tests')) });
	}
	if (!head) throw new InputError('the plan has no ## Units table');
	return units;
}

// The same match tester-model.mjs makes: a folder entry ("kit-hooks/") holds the file, a glob ("guard*.cjs") matches
// the file name, and any other entry is a file name.
const escapeRe = (s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
function guarded(file) {
	const p = file.replace(/\\/g, '/');
	const base = p.split('/').pop();
	return GUARD_PATHS.some((g) => {
		if (g.endsWith('/')) return `/${p}`.includes(`/${g}`);
		if (g.includes('*')) return new RegExp(`^${g.split('*').map(escapeRe).join('.*')}$`).test(base);
		return base === g;
	});
}

// The plan's checklist: one line per unit (its last step, or "not started") and the faults: a step naming a unit the
// plan does not hold, an unknown step, a time that goes backwards within a unit, a merged unit missing a required step
// before its merged line, and a guard-path unit merged with no check before it.
// hookText, when given, is the hook log: each hook-error line needs a hook-report line in the checklist log that names its id
// with a cause and a fix. A hook-report line is the lead's note, not a unit step.
export function checklist(planText, logText, hookText = null) {
	const units = planUnits(planText);
	const known = new Set(units.map((u) => u.id));
	const logs = new Map(units.map((u) => [u.id, []]));
	const faults = [];
	const reported = new Set();
	logText.split(/\r?\n/).forEach((raw, i) => {
		if (!raw.trim()) return;
		const n = i + 1;
		let e;
		try {
			e = JSON.parse(raw);
		} catch {
			throw new InputError(`log line ${n} is not JSON`);
		}
		if (e === null || typeof e !== 'object' || Array.isArray(e)) throw new InputError(`log line ${n} is not an object`);
		if (e.kind === 'hook-report') {
			const filled = (v) => typeof v === 'string' && v.trim() !== '';
			if (typeof e.error === 'string' && filled(e.cause) && filled(e.fix)) reported.add(e.error.trim());
			return;
		}
		if (typeof e.unit !== 'string' || !e.unit.trim()) throw new InputError(`log line ${n} has no unit`);
		if (typeof e.step !== 'string') throw new InputError(`log line ${n} has no step`);
		const ms = typeof e.at === 'string' ? Date.parse(e.at) : NaN;
		if (Number.isNaN(ms)) throw new InputError(`log line ${n} has an at that is not a time`);
		const unit = e.unit.trim();
		if (!known.has(unit)) faults.push(`log line ${n} names unit ${unit}, which the plan does not hold`);
		else logs.get(unit).push({ n, ms, step: e.step });
	});
	if (hookText !== null) {
		hookText.split(/\r?\n/).forEach((raw, i) => {
			if (!raw.trim()) return;
			const n = i + 1;
			let e;
			try {
				e = JSON.parse(raw);
			} catch {
				throw new InputError(`hook log line ${n} is not JSON`);
			}
			if (e === null || typeof e !== 'object' || Array.isArray(e)) throw new InputError(`hook log line ${n} is not an object`);
			if (e.kind !== 'hook-error') return;
			const id = typeof e.id === 'string' ? e.id.trim() : '';
			if (!id) {
				faults.push(`hook log line ${n} is a hook error with no id, so no lead report can name it`);
				return;
			}
			if (!reported.has(id)) faults.push(`hook error ${id} has no lead report: add {"kind":"hook-report","error":"${id}","cause":"...","fix":"..."} to the checklist log`);
		});
	}
	const lines = [];
	for (const u of units) {
		const log = logs.get(u.id);
		if (!log.length) {
			lines.push(`${u.id}: not started`);
			continue;
		}
		lines.push(`${u.id}: ${log[log.length - 1].step}`);
		log.forEach((s, k) => {
			if (!STEPS.includes(s.step)) faults.push(`${u.id}: log line ${s.n} has step ${s.step}, which is not a known step (use ${STEPS.join(', ')})`);
			if (k > 0 && s.ms < log[k - 1].ms) faults.push(`${u.id}: log line ${s.n} has an at earlier than the line before it`);
			if (s.step === 'retest' && !u.retest) faults.push(`${u.id}: log line ${s.n} is a retest step, but no Tests line of ${u.id} starts "retest:"`);
		});
		const m = log.findIndex((s) => s.step === 'merged');
		if (m < 0) continue;
		const before = log.slice(0, m).map((s) => s.step);
		for (const need of REQUIRED) {
			if (!before.includes(need)) faults.push(`${u.id} is merged with no ${need} step before it`);
		}
		if (u.retest && !before.includes('retest')) faults.push(`${u.id} is a retest unit (a Tests line starts "retest:") and is merged with no retest step before it`);
		const guard = u.files.some(guarded) || u.risk === 'high' || u.category === 'guard';
		if (guard && !before.includes('check')) faults.push(`${u.id} is a guard unit (a guard path, Risk high or Category guard) and is merged with no check step before it`);
	}
	return { lines, faults };
}
