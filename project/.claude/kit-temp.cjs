'use strict';
// The one way kit code makes temp folders. A killed test run once filled the Cowork VM's session disk with
// 633,663 inodes of test folders and stopped every shell, so every temp folder here:
// - lands under one run root named for its owner pid (kit-tests-<pid>-XXXXXX), removed on exit and on a signal;
// - is swept by the next run when its owner is dead, because a SIGKILL or a timeout runs no handler at all;
// - says so on stderr when it cannot be removed, instead of passing silently.
// A run refuses to start when the temp disk is above 80% of its inodes used.
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT_PREFIX = 'kit-tests-';
const WARN_PCT = 50;
const REFUSE_PCT = 80;
// A live pid past a day is a reused pid, not a run; an old-style root (no pid in its name) is a run of an older kit.
const LIVE_MAX_MS = 24 * 3600e3;
const LEGACY_MAX_MS = 3600e3;
const OWNED = new RegExp(`^${ROOT_PREFIX}(\\d+)-[A-Za-z0-9]{6}$`);
const LEGACY = new RegExp(`^${ROOT_PREFIX}[A-Za-z0-9]{6}$`);

let current = null;

function removeTemp(dir) {
	try {
		fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
		return true;
	} catch (e) {
		process.stderr.write(`kit-temp: could not remove ${dir}: ${e.message}\n`);
		return false;
	}
}

function makeTemp(prefix) {
	return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function withTemp(prefix, fn) {
	const dir = makeTemp(prefix);
	try {
		return fn(dir);
	} finally {
		removeTemp(dir);
	}
}

function alive(pid) {
	try {
		process.kill(pid, 0);
		return true;
	} catch (e) {
		return e.code === 'EPERM';
	}
}

/**
 * Remove the run roots in a temp folder whose run is over.
 *
 * Args:
 *     dir: the temp folder to sweep (default os.tmpdir())
 *     now: the time to judge ages by, in ms
 *
 * Returns:
 *     The paths removed.
 */
function sweepStale(dir = os.tmpdir(), now = Date.now()) {
	let names;
	try { names = fs.readdirSync(dir); } catch (e) {
		process.stderr.write(`kit-temp: could not read ${dir}: ${e.message}\n`);
		return [];
	}
	const removed = [];
	for (const name of names) {
		const owned = OWNED.exec(name);
		if (!owned && !LEGACY.test(name)) continue;
		const p = path.join(dir, name);
		if (p === current) continue;
		let st;
		try { st = fs.lstatSync(p); } catch { continue; } // gone between the listing and here: nothing to sweep
		if (!st.isDirectory()) continue;
		const age = now - st.mtimeMs;
		const stale = owned ? (!alive(Number(owned[1])) || age > LIVE_MAX_MS) : age > LEGACY_MAX_MS;
		if (stale && removeTemp(p)) removed.push(p);
	}
	return removed;
}

function inodeLevel(s) {
	if (!s || !s.files) return { level: 'unknown', pct: null };
	const pct = Math.round(((s.files - s.ffree) / s.files) * 100);
	return { level: pct > REFUSE_PCT ? 'refuse' : pct > WARN_PCT ? 'warn' : 'ok', pct };
}

// Windows reports no inode count (files 0), so the level there is unknown and nothing is refused.
function inodeUse(dir) {
	let s = null;
	try { s = fs.statfsSync(dir); } catch (e) {
		process.stderr.write(`kit-temp: could not read the disk under ${dir}: ${e.message}\n`);
	}
	const r = inodeLevel(s);
	const text = r.pct === null ? `inode use unknown on ${dir}` : `${r.pct}% of inodes used on ${dir}`;
	return { ...r, dir, text };
}

/**
 * Make this process's run root and point TMPDIR, TEMP and TMP at it, so os.tmpdir() and child processes use it.
 * Refuses (throws) above 80% of inodes used, sweeps finished runs' roots first, and removes the root on exit,
 * SIGINT, SIGTERM and SIGHUP.
 *
 * Returns:
 *     The root's path.
 */
function sessionRoot() {
	if (current) return current;
	const base = os.tmpdir();
	const use = inodeUse(base);
	if (use.level === 'refuse') throw new Error(`kit-temp: ${use.text}: refuse to run above ${REFUSE_PCT}%. Clear old temp folders first.`);
	if (use.level === 'warn') process.stderr.write(`kit-temp: warning, ${use.text} (refuses above ${REFUSE_PCT}%)\n`);
	sweepStale(base);
	current = fs.mkdtempSync(path.join(base, `${ROOT_PREFIX}${process.pid}-`));
	process.env.TMPDIR = process.env.TEMP = process.env.TMP = current;
	const root = current;
	process.on('exit', () => removeTemp(root));
	for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
		process.on(sig, () => {
			removeTemp(root);
			process.exit(128 + os.constants.signals[sig]);
		});
	}
	return current;
}

module.exports = { ROOT_PREFIX, WARN_PCT, REFUSE_PCT, sessionRoot, makeTemp, withTemp, removeTemp, sweepStale, inodeUse, inodeLevel };
