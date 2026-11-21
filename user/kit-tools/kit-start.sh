#!/bin/sh
# R7.2 (the owner's pick, 2026-11-21): starts the kit's guard launcher for every tool call. A launcher that could not
# start (node missing) or started slowly left Claude Code blocking each call with only "exit 127" or "timed out". Here
# the call's input is read once, the launcher runs with a 4 second limit, and a slow start or a crash gets one fresh
# try (node missing gets none). Only the launcher's own exit 0 lets its answer through, and it resets the count. Two
# misses deny the call with the cause named, and a count in the Claude folder says when to stop retrying.
# Usage (settings.json, written by install user):
#   NODE_OPTIONS= /bin/sh '<home>/kit-tools/kit-start.sh' '<node>' '<launcher>' || printf '%s' '<deny>'
# The commit security review: the tools this script runs (timeout, cat, mkdir, dirname) come from the system's own
# folders, never from the session's PATH, so a planted one cannot answer for the launcher. node is an absolute path.
# K250 (1.49.0): Git for Windows keeps no git in /usr/bin or /bin, so the guards could not ask git anything and a
# worktree-config project had every call held. The launcher gets the system folders plus Git for Windows' own /cmd
# (part of the install this shell runs from), never the session's PATH, so a planted git cannot answer either. A Mac
# or Linux git kept outside them (Homebrew, a source build) is found in /usr/local/bin or /opt/homebrew/bin, after the
# system folders, so the system's own git answers first where there is one (the build 23a sweep).
PATH=/usr/bin:/bin
export PATH
run_path="$PATH:/usr/local/bin:/opt/homebrew/bin"
if [ -x /cmd/git.exe ]; then run_path="/cmd:$PATH"; fi
node="$1"
launcher="$2"
count="$(dirname "$0")/../kit-guard/start-fails"
input="$(cat)"
# macOS ships no timeout: there the launcher runs unlimited, and Claude Code's own 10 second hook limit still holds.
if command -v timeout >/dev/null 2>&1; then
	try() { printf '%s' "$input" | PATH="$run_path" NODE_OPTIONS= timeout 4 "$node" "$launcher"; }
else
	try() { printf '%s' "$input" | PATH="$run_path" NODE_OPTIONS= "$node" "$launcher"; }
fi
out="$(try)"; rc=$?
case "$rc" in
	0|126|127) ;;
	*) out="$(try)"; rc=$? ;;
esac
if [ "$rc" -eq 0 ]; then
	mkdir -p "$(dirname "$count")" 2>/dev/null && printf '0' > "$count" 2>/dev/null
	printf '%s' "$out"
	exit 0
fi
n=$(cat "$count" 2>/dev/null)
case "$n" in ''|*[!0-9]*) n=0 ;; esac
n=$((n + 1))
mkdir -p "$(dirname "$count")" 2>/dev/null && printf '%s' "$n" > "$count" 2>/dev/null
case "$rc" in
	124) cause='the kit guard launcher did not answer within 4 seconds, twice' ;;
	126|127) cause='node could not be started for the kit guard launcher (missing or not runnable)' ;;
	*) cause="the kit guard launcher stopped with exit $rc, twice" ;;
esac
# The held session cannot run kit.mjs itself (this same deny holds it), so the repair is the owner's. No retry
# happens for 126 and 127, so they never offer one.
if [ "$n" -ge 3 ] || [ "$rc" -eq 126 ] || [ "$rc" -eq 127 ]; then
	next='Stop retrying and ask the owner to run kit.mjs status in the kit folder, then kit.mjs install user from the release copy.'
else
	next="Try once more ($n of 3)."
fi
printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"Held: %s, so no guard could check this call. %s"}}' "$cause" "$next"
exit 0
