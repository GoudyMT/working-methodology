---
name: human-factor
description: The human-factor check for any feature that touches UI/UX - a lock, a code, a confirm, a required step, a form, an error message, an onboarding flow. Use while designing the feature, before recommending an option, and when reviewing a UI/UX design or build. Weighs what a hurdle protects against what a real person can remember, repeat and recover from.
---

# The Human Factor

Design for the person who will use the feature every day, tired, distracted and on a small screen - not for the
ideal user and not for the worst attacker. A hurdle stronger than the value it guards, or one people cannot
remember, gets written down, bypassed or abandoned. A hurdle people quit is a feature that failed.

This is a mindset first and a checklist second. Run it at design time, inside every option list for a UI/UX
feature, before you recommend. Run it again when you review the build.

## When it applies

Any feature that asks something of a person:
- a hurdle: a lock, a PIN, a passphrase, a code, a confirm step, a required field, a re-authentication;
- an exact entry: a key, a recovery phrase, a code typed from another screen;
- a failure moment: an error message, a refused input, an empty or offline state;
- a first-time moment: onboarding, a setup step, a permission prompt.

## The check (answer each before you recommend)

1. **What does it protect, and what is that worth?** Name the data or action and its value to a stranger, now
   and with the features already planned. Low-value data does not need a high wall.
2. **What is the realistic threat?** Name the likely one (a phone picked up, a shared screen, a mistyped tap),
   not the worst one. Say plainly which threats the design does not cover.
3. **What can a person remember and repeat every day?** Count what you ask them to hold in their head and how
   often. Prefer what they already know or already carry.
4. **How does a person who forgets recover?** Every hurdle has a planned way back. If losing the secret means
   losing data, say so before they choose, and offer the recovery path (a backup, an export) at that moment.
5. **Can they see and fix their own mistake?** Any entry a person must get exactly right lets them see what they
   entered and points at the one wrong part ("Word 3 is not on the list", not "Invalid"). Retyping blind is not
   recovery; repeated blind failures make people quit. Weigh the reveal against the leak risk and pick one that
   keeps the guards (shown as page text, never copyable, hidden again on lock).
6. **What does the copy promise?** The words on screen say what the feature does and what it does not do, in
   plain language. No security theater: never imply a protection the design does not give.

Then **pick the lightest hurdle that covers the realistic threat**, and make the stronger option available to
the person who wants it, rather than forcing it on everyone.

## How it shows up in an option list

Each UI/UX option carries one line for the human factor beside its effort and its rules fit, for example:

- **A: optional 4-6 digit PIN, off by default.** Guards the realistic threat (a phone picked up). Easy to
  remember. The copy says it does not guard a copied device. Recovery: the backup file.
- **B: six random words.** Strong against every threat. Most people will not remember it past a minute, so
  they write it down or never turn it on.

The recommendation names which answer above decided it.

## Review checklist (for a checker or a sweep)

- [ ] The design records answers to all six questions, or says why one does not apply.
- [ ] The chosen hurdle is the lightest that covers the named realistic threat.
- [ ] A forgotten secret has a recovery path, offered before the person can lose data.
- [ ] Exact-entry fields reveal safely and name the wrong part.
- [ ] Error and refusal messages say what happened and what to do next, in plain words.
- [ ] The copy claims no protection the design does not give.
- [ ] It was tried at the smallest screen the project supports, with real-length text.

## Where it comes from

The owner's rule: a human can only hold so many passwords, so weigh the human factor whenever a feature adds a
hurdle. A design that chose maximum strength on paper (six random words) was replaced, on this check, by an
optional short PIN with honest copy and a backup as recovery. An earlier rule from the same owner: when a person
cannot see whether they typed the right thing and keeps failing, they stop and never try again.

Related standards: "Design for Human Error" and "Visual Design Collaboration" in the project's
`_Working Standards.md`.
