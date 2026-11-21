#!/bin/sh
# R7.2 (the owner's pick, 2026-11-21): starts the kit's guard launcher for every tool call. A launcher that could not
# start (node missing) or started slowly left Claude Code blocking each call with only "exit 127" or "timed out". Here
# the call's input is read once, the launcher runs with a 4 second limit, and a slow start or a crash gets one fresh
# try (node missing gets none). Only the launcher's own exit 0 lets its answer through, and it resets the count. Two
# misses deny the call with the cause named, and a count in the Claude folder says when to stop retrying.
# Usage (settings.json, written by install user):
#   NODE_OPTIONS= sh '<home>/kit-tools/kit-start.sh' '<node>' '<launcher>' || printf '%s' '<deny>'
# The commit security review: the tools this script runs (timeout, cat, mkdir, dirname) come from the system's own
# folders, never from the session's PATH, so a planted one cannot answer for the launcher. node is an absolute path.
PATH=/usr/bin:/bin
export PATH
node="$1"
launcher="$2"
count="$(dirname "$0")/../kit-guard/start-fails"
input="$(cat)"
# macOS ships no timeout: there the launcher runs unlimited, and Claude Code's own 10 second hook limit still holds.
if command -v timeout >/dev/null 2>&1; then
	try() { printf '%s' "$input" | NODE_OPTIONS= timeout 4 "$node" "$launcher"; }
else
	try() { printf '%s' "$input" | NODE_OPTIONS= "$node" "$launcher"; }
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
if [ "$n" -ge 3 ]; then
	next='Stop retrying: run kit.mjs status in the kit folder, then repair with kit.mjs install user from the release copy.'
else
	next="Try once more ($n of 3)."
fi
printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"Held: %s, so no guard could check this call. %s"}}' "$cause" "$next"
exit 0
