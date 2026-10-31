# Persona walks

Used in step 4. rule:craft-floor asks for 2-3 people to walk the screen: a first-timer, someone who relies on
accessibility, and a distracted phone user. Each walk tries to finish the screen's main task from a cold start
and names the element where it failed. A walk is not a checklist run; it is one person trying to get something
done.

If the walks run as agents, they are a swarm: the Swarm Contract comes first (rule:swarm-contract), each walk is
one role with its own distinct question, and the context per role is the task, the build's URL and the prompts
below. Never three clones of "review this screen".

## The result line (every walk ends with one)

`<persona> | task: <the task> | COMPLETED in <n> steps | STUCK at <element> because <what they saw>`

Plus each candidate finding: the element, what happened, the heuristic or WCAG criterion it breaks.

## 1. The first-timer

No prior context, no saved data, has not read any docs.

- Land on the screen. Within five seconds, can you say what it is for and what to do first?
- Find the main action without being told where it is. Note each place you looked first.
- Meet every empty state. Does each tell you what will appear and how to start?
- Hit one error on purpose (a wrong value, a skipped field). Can you recover from the message alone?
- Do the words match yours? Note any term you would not use or search for.
- Did anything happen that you did not expect (a jump, a redirect, a lost input)?

## 2. The person who relies on accessibility

Run these as separate passes; each catches what the others cannot.

- **Keyboard only.** Tab from the top. Is every control reachable, in an order that follows the screen? Is the
  focus always visible and never hidden under a sticky bar? Do Enter and Space work on every control, arrow keys
  inside composite widgets (tabs, menus, radio groups), Escape on every overlay? When an overlay closes, does
  focus return to what opened it? Is there any place you cannot Tab out of?
- **Screen reader** (NVDA or the platform's reader; TalkBack on Android): what is announced for each control?
  Does every icon button say its action, not its icon? Are status changes and errors announced? Does a select
  or group announce its own options as its name (a label wrapping the field with no `for`)?
- **Zoom and reflow:** 200% text zoom and a 320 CSS px width. Does anything clip, overlap or need sideways scroll?
- **Forced colors and both themes:** are state marks (selected, error, focus) still visible? Does dark mode keep
  the contrast light mode has?
- **Reduced motion:** with the system setting on, is non-essential motion gone and essential motion replaced by
  a static cue?

Automated scans find only part of these issues (one source puts it near 30%); the passes above are the rest.

## 3. The distracted phone user

At the project's narrowest width, one thumb, half attention.

- Can the main action be reached with the thumb (lower part of the screen) and hit on the first try (targets
  sizes in wcag-22-aa.md)?
- Get interrupted mid-task: switch apps, lock the phone, reload, lose the network, press Back. Is the input still
  there? Does the screen say what happened when you return?
- Tap twice fast on the submit. Does it act twice?
- Rotate, or open the on-screen keyboard. Does the field you are typing in stay visible?
- Scan, do not read. Can you finish with only the headings, labels and buttons?

## What the walks do not replace

- The break-it testers of rule:pre-push-op-test (input order, rapid taps, date edges, offline, locks), which run
  on the production build before push.
- A real device: emulation cannot prove a device's fonts, keyboard or screen reader. Where the stakes call for a
  device, rule:preview-test says who tests it.
