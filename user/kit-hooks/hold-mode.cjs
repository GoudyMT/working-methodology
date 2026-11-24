'use strict';
// E36/U9 (build 24): the mode of a hold, "log" or "enforce". user/kit-hooks/holds.json lists every hold beside this file:
// {"holds":[{"id","hook","mode"}]}. A hook asks mode(id) and acts on the answer: log only records, enforce acts. Anything
// but a clean "log" reads as enforce (an unknown id, a missing or unreadable file, a wrong shape, a mode that is neither
// log nor enforce), so a damaged list can only make a hold stricter. It never throws. It needs nothing beside it but
// holds.json, so a test can copy it alone.
const fs = require('fs');
const path = require('path');

const HOLDS = path.join(__dirname, 'holds.json');

function mode(id) {
  try {
    const data = JSON.parse(fs.readFileSync(HOLDS, 'utf8'));
    if (!data || typeof data !== 'object' || !Array.isArray(data.holds)) return 'enforce';
    const modes = data.holds
      .filter((h) => h && typeof h === 'object' && typeof h.id === 'string' && h.id === id)
      .map((h) => h.mode);
    return modes.length > 0 && modes.every((m) => m === 'log') ? 'log' : 'enforce';
  } catch {
    return 'enforce';
  }
}

// The tier of a hook: "security", "high" or "small", read from the hold's own entry. Only an exact spelling counts, so a
// missing, unknown or damaged entry reads as high: a damaged list can only make a hook stricter, never looser.
const TIERS = new Set(['security', 'high', 'small']);

function tier(id) {
  try {
    const data = JSON.parse(fs.readFileSync(HOLDS, 'utf8'));
    if (!data || typeof data !== 'object' || !Array.isArray(data.holds)) return 'high';
    const tiers = data.holds
      .filter((h) => h && typeof h === 'object' && typeof h.id === 'string' && h.id === id)
      .map((h) => h.tier);
    return tiers.length === 1 && TIERS.has(tiers[0]) ? tiers[0] : 'high';
  } catch {
    return 'high';
  }
}

module.exports = { mode, tier };
