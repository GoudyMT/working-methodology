# Live Checks - 1.4.0 (kit stays local, first push gate)

Run 2026-10-29 in scratch git projects, each installed from the kit source, pushing to a local bare repository
standing in for the host.

| Run | What it tried | Result |
|---|---|---|
| 1 Clean | Course-shaped project: `src/`, a README, a growth file force-added, school folder ignored | PASS: `git status` showed only the project after install; check cleared; push went; the remote held exactly the four wanted files |
| 2 Slip in history | A kit file and a school file committed, then removed in the next commit | PASS: check failed naming both and the commit that added them; the push was blocked |
| 3 Agent slip | `git add -A` plus a force-added kit file, on the first commit | PASS: the commit check blocked it naming the file. Found: its unstage hint (`git restore --staged`) fails before the first commit; changed to `git rm --cached` |
| 4 Host-made README | The remote was created with a README and fetched before the first push | PASS: the gate stayed on; the push was blocked until the check cleared the commit; then the push went and the remote held only the wanted files plus the host's README |

The review's merge-commit, folder-style never entry, already-pushed project, tag and ignored-but-wanted cases are
covered by tests (tests/kit.test.mjs), each written to fail first.
