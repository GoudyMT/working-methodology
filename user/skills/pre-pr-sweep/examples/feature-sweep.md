# Pre-PR Deep Sweep - Journal lock with an optional PIN (2026-05-14)

- **Scope:** `feature/journal-lock-pin` at `4be71c09` (diff base `a03d5e12`, main merged; 118 files). The owner approved
  the Swarm Contract on 2026-05-14 18:10 UTC ("go ahead"): S1-S7 as drafted plus S8 (an attacker holding the phone; the
  novel-lens slot), each Opus and read-only, ~400K budget, 60 calls, at most 8 findings. The Parking Lot triage
  (2026-05-14 19:30 UTC) was added to the "already decided" list first.
- **Run:** all 8 roles ran this session, each in its own throwaway worktree reset to `4be71c09`, on ports 31421-31428.
  The one high (S8.1) was re-checked refute-by-default by a ninth Opus agent.
- **Alignment verdict (S6): YES.** No dependency or third-party runtime was added (the lockfile has no diff;
  `package.json` changes only size limits). The renamed key-derivation worker is rebuilt from repo source
  (`check:kdf-vendor`: "OK: worker 8d31f0a2b97c4e15 matches its source"). Erase stays reachable while locked. The
  unlocked mode is unchanged. The five "does not cover" lines are policy-tested (Success Charter 2). The findings are
  defects and wording, not scope drift.
- **Dimensions:**

  | Dimension | Result |
  |---|---|
  | 1 Privacy | S3: no new sink. Two low findings (a stale notice; a search kept in memory) |
  | 2 Supply chain + bundle | PASS (S6); size limits raised by the owner's call (`71c2e0a4`, `4be71c09`) |
  | 3 Legal | PASS (S6): no new content source; licences unchanged |
  | 4 Security swarm | S1, S2, S4 and S8 below |
  | 5 Gaps, scaling, test value | S5 below; scaling PASS (S6: two fixed rows, one storage write per 5 s while a wait runs) |
  | 6 Alignment | YES |

- **Yield per role** (findings / tool calls; token figures are from the agent result lines - the overseer measures spend):

  | Role | Findings | Calls |
  |---|---|---|
  | S1 | 2 | 61 |
  | S2 | 1 | 64 |
  | S3 | 2 | 63 |
  | S4 | 4 | 58 |
  | S5 | 5 + per-file lines | 88 |
  | S6 | 5 | 62 |
  | S7 | 4 | 53 |
  | S8 | 2 | 49 |

  (Calls as the roles reported them.) The meter's model-call counts: S1 57, S2 56, S3 58, S4 54, S5 79, S6 59, S7 50, S8 43 -
  so by the meter only S5 passed the 60-call ceiling (by 19); the roles' own counts of tool uses run higher. All stayed under
  ~200K tokens of their 400K. Sweep spend (meter): $23.90 for S1-S8, $0.44 for the re-check.

## Roots and dispositions

Every finding below was re-read in the code by the lead (G1). The owner approved every recommendation on 2026-05-14 21:05
UTC ("go with your recommendation and continue"): all 11 roots fixed in this PR, C1 (a), G1 (a), the W2 wait id.
**Final dispositions:** W1 FIXED `b2e81c07`; W2 FIXED `5d93a1f6`; W3 FIXED `e07c4b19` (+ the fix check's test `9a1d6e20`);
U1 FIXED `3f6a0b85`; N1 FIXED `c18e72d4`; F1 FIXED `6ab90e13`; A1 FIXED `d42f8c71`; Q1 FIXED `81e3b5a0` (no test: no seam
shows it, the fix check agreed); D1 FIXED `0c7d2e9`; T1 FIXED `fa31b6c`, `27e9d0a4`; X1 FIXED `e95b13c`; C1 ACCEPTED as a
named residual `4d0a7e2` (docs "does not cover"); G1 ACCEPTED and documented `b81f3c6`. No high or critical finding
stands (S8.1 was re-graded to medium by the refute re-check and is C1).

| Root | Findings | Truth (G1) | Proposed |
|---|---|---|---|
| W1 (medium) A wait that ran out while away comes back in full on a press within 5 s of return | S2.1 | `wait-countdown.ts:74-86`: `run(0)` makes a clock that writes zero only after 5 s; `lock-store.ts:109` decides the press from the stored row | FIX: the clock writes its remainder at once when it starts after a return (compare-and-set, only lowers) |
| U1 (medium) An unlock ignores what happened to the page during its derive: an idle relock does not stop its keys (S4.1); a hide leaves the entries decrypted in a hidden page (S4.2) | S4.1, S4.2 | `PinUnlock.svelte:188,207-208`: `setSession` then `unlockStores()` with no relock watch | FIX: the watch the lock row already uses (`LockRow.svelte:204-215`, its precedent) around the derive, and a hygiene relock after the load when the page is hidden |
| D1 (low) A PIN row with no `kdf` or no `salt` counts as a wrong try instead of damage | S1.1 | `pin-derive.ts:86` reads `params.kdf` and `params.salt.length` before checking that they exist (a TypeError, which the check counts) | FIX: a missing field reads as `KeystoreMismatchError`, like a wrong tuple |
| C1 (medium, by the re-check; S8 claimed high) The phone asleep, then the wall clock set back to just after the hide, skips the 15-minute relock | S8.1, S4.4 | `app-init.ts:461-464` applies the design's own formula (item 7). Re-check: stands at medium. It needs the phone's unlock code, a tab not discarded, no Lock, a monotonic clock that stops in sleep (unproven on a real phone) and one timing guess | **The owner decides** (a design gap, not a code deviation): (a) name it a residual in the docs' "does not cover" list (recommended; no copy change); (b) drop the keys on `freeze` (more PIN asks after long switches); (c) relock when the wall delta is below the perf delta (weak) |
| Rejected | S5.2 (cut `lock-copy-policy.test.ts`) | - | KEEP: Success Charter 2 requires "the copy states each 'does not cover' line (policy test)" |
| Recorded, not fixed here | S1.2 (the extractable-key lint misses a computed name; no such call exists, and a runtime check covers keys); S7 doubt: Show PIN's fixed 5 s vs WCAG 2.2.1 (screen reader at the Op-Test) | - | Plan Parking Lot |

(9 more root rows of the same shape: W2, W3, N1, F1, A1, Q1, T1, X1, G1.)

## Fixes, fix check, re-sweep

- **Lead:** X1, C1, G1 (docs), D1 and the restore test row, each red first (or red on the mutant for a test of existing
  code) and break-checked.
- **Builders** (Sonnet, own worktrees on `fa31b6c2`; picked one commit at a time through the hook under the machine lock;
  every file blob-equal to its builder's head; the lead re-ran one break check for W2 and one for W3, both red):
  BU (U1, A1, the PinUnlock cut), BW (W1, W2, then W3 on the integrated head), BF (N1, Q1, F1, the T1 rows).
- **Integration notes:** three hook runs failed with no code cause (a lint spawn failure, a 5-minute hang, one node
  crash); each was retried once alone and landed. One lead slip: after a failed retry the same command ran the next pick,
  which committed two roots together; it was undone at once (local reset of that one commit) and re-committed as two.
- **Fix check** (one Opus checker, 22 mutants): 15 of 16 PASS; one FIX (low): W3's new mount guard
  (`PinUnlock.svelte:124`) had no test (its mutant survived 176 rows) -> `9a1d6e20` adds the row, red on that mutant.

## Re-sweep (the short one, 3 roles, the owner's go 2026-05-14 21:05 UTC; head `9a1d6e20`)

| Role | Question | Calls | Findings |
|---|---|---|---|
| R1 the wait and tries | can the wait still be skipped, lowered or lost after W1-W3, D1? | 40 (meter) | R1.1 medium, R1.2 low |
| R2 unlock, relock, privacy | does any way back keep or show what it must drop after U1, N1, Q1, A1? | 41 | R2.1 low, R2.2 low |
| R3 focus and announcements | does every closed control hand focus on; every line announced once? | 45 | R3.1 low (= R2.1) |

All three inside the 60-call ceiling. Findings (each re-read in the code by the lead):

- **R1.1 (medium) - W1 half done.** `wait-countdown.ts:63-68`: when the on-screen count reaches zero it writes nothing; the
  stored wait reaches zero only at the clock's next 5 s write. A press in that gap (up to 5 s) is refused and restarts the
  count from the stale remainder. Proposed: at zero, call the clock's `writeNow()` (the same compare-and-set, only lowers)
  + the probe as a red test.
- **R2.1 / R3.1 (low) - N1 half done.** `PinUnlock.svelte:226-229`: a Lock that lands during `await unlockStores()` still
  calls `onunlocked`, so the tries notice shows above the locked card.
- **R2.2 (low) - a side effect of U1.** A good PIN that a lock drops has already reset the tries row, so its "N wrong PIN
  tries" notice is never shown. Proposed with R2.1 as one root ("a dropped unlock loses or misplaces its notice").
- **R1.2 (low)** - two comments still describe the per-screen count (`LockRow.svelte:136-137`, `BackupCard.svelte:244`).
- Doubts recorded: a restore that lands during the derive relocks as hygiene (not caught by the watch; the load then fails
  closed).

Per the cadence (two passes only), the re-sweep's findings go to the owner: fix in this PR (recommended: three small roots,
then the gate; no third sweep) or carry to a follow-up.

## Post-run yield check

Findings per role, main sweep: S1 2, S2 1, S3 2, S4 4, S5 5, S6 5, S7 4, S8 2 (+ the novel lens's plant analysis). Every
role yielded. The fix check found one gap; the re-sweep found three roots, two of them halves of a fix (W1, N1) and one a
fix's own side effect (U1) - the fix check's per-fix mutants did not ask "what does this fix newly allow".
