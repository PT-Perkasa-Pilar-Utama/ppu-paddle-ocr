---
name: release-version-bump
description: Workflow command scaffold for release-version-bump in ppu-paddle-ocr.
allowed_tools: ["Bash", "Read", "Write", "Grep", "Glob"]
---

# /release-version-bump

Use this workflow when working on **release-version-bump** in `ppu-paddle-ocr`.

## Goal

Prepares and publishes a new release version by updating version numbers and changelogs.

## Common Files

- `CHANGELOG.md`
- `jsr.json`
- `package.json`
- `apps/serve/package.json`

## Suggested Sequence

1. Understand the current state and failure mode before editing.
2. Make the smallest coherent change that satisfies the workflow goal.
3. Run the most relevant verification for touched files.
4. Summarize what changed and what still needs review.

## Typical Commit Signals

- Update CHANGELOG.md with release notes
- Update jsr.json and package.json with new version
- Optionally bump version in sub-package (e.g., apps/serve/package.json)

## Notes

- Treat this as a scaffold, not a hard-coded script.
- Update the command if the workflow evolves materially.