// K315 (build 24): the template slots a fresh install leaves unfilled. One list, read by both users: install prints each
// slot a project file still holds (scripts/kit.mjs), and the sweep brief writer refuses a rules block that holds one
// (approve.mjs). Only these two count; a format example such as a branch name or a date is never a slot.
export const SLOTS = Object.freeze(['<PROJECT NAME>', '<fill in>', '<data boundary>', '<secret files>', '<safe logger>', '<scanner>']);

// Case and runs of whitespace are folded, so <Data Boundary> and <data  boundary> are the slot too.
const fold = (text) => String(text).replace(/\s+/g, ' ').toLowerCase();

// The slots a text holds, in list order, each once.
export function slotsIn(text) {
	const folded = fold(text);
  return SLOTS.filter((slot) => folded.includes(fold(slot)));
}
