'use strict';
// Test-side only (K14): loaded with --require into a guard process a timing test starts, it writes the CPU time that
// process used, in ms, to the file the test names. No shipped guard file reads this variable or loads this file.
const fs = require('fs');

process.on('exit', () => {
	const u = process.cpuUsage();
	try { fs.writeFileSync(process.env.KIT_TEST_CPU_FILE, String(Math.round((u.user + u.system) / 1000))); } catch { /* the test reports the missing file */ }
});
