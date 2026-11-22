// U22 (T-B4): the three fixed rows a guard unit's Tests cell carries. plan-check.mjs calls guardRowFaults for each unit whose
// category (test-budget.mjs's budget: the higher of the computed and the given Category) is guard. A row is recognised by
// its tag word at the start of a Tests line (the lines split by <br>): bypass:, repeat:, fail-closed: or fail-open:. A fail
// row must also say "logged". A wiring: line is accepted beside them and never stands in for one. Whether a bypass line is
// a real variant proof is for the tester and the reviewer, not this check.

const FAIL = /^fail-(closed|open):/;

/**
 * The faults of a guard unit's Tests lines.
 *
 * Args:
 *     id: the unit's id, for the message.
 *     lines: the unit's Tests lines, trimmed, one per test.
 *
 * Returns:
 *     The fault lines: a missing bypass: or repeat: row, no fail-closed: or fail-open: row, or a fail row that does not say logged.
 */
export function guardRowFaults(id, lines) {
	const found = [];
	for (const tag of ['bypass:', 'repeat:']) {
		if (!lines.some((l) => l.startsWith(tag))) found.push(`unit ${id} is a guard unit with no ${tag} row (a Tests line that starts with ${tag})`);
	}
	const fails = lines.filter((l) => FAIL.test(l));
	if (fails.length === 0) found.push(`unit ${id} is a guard unit with no fail-closed: or fail-open: row`);
	// A denial ("not logged", "never logged", "nothing logged", "no ... logged") is no logging; "unlogged" has no word boundary before "logged", so it fails the first test.
	for (const l of fails) {
		if (/\b(not|never|nothing|no)\b[^,;]*\blogged\b/.test(l)) found.push(`unit ${id} has a guard fail row that says the outcome is not logged: ${l}`);
		else if (!/\blogged\b/.test(l)) found.push(`unit ${id} has a guard fail row that does not say logged: ${l}`);
	}
	return found;
}
