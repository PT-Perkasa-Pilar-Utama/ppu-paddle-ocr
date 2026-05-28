---
name: update-web-and-processor-service-methods-and-docs
description: Workflow command scaffold for update-web-and-processor-service-methods-and-docs in ppu-paddle-ocr.
allowed_tools: ["Bash", "Read", "Write", "Grep", "Glob"]
---

# /update-web-and-processor-service-methods-and-docs

Use this workflow when working on **update-web-and-processor-service-methods-and-docs** in `ppu-paddle-ocr`.

## Goal

Keeps web and processor service files in sync and updates their documentation, often to improve symbol coverage or clarify constructors.

## Common Files

- `src/processor/detection.service.ts`
- `src/processor/recognition.service.ts`
- `src/processor/paddle-ocr.service.ts`
- `src/web/detection.service.web.ts`
- `src/web/recognition.service.web.ts`
- `src/web/paddle-ocr.service.web.ts`

## Suggested Sequence

1. Understand the current state and failure mode before editing.
2. Make the smallest coherent change that satisfies the workflow goal.
3. Run the most relevant verification for touched files.
4. Summarize what changed and what still needs review.

## Typical Commit Signals

- Edit service implementation files in src/processor (e.g., detection.service.ts, recognition.service.ts, paddle-ocr.service.ts)
- Edit corresponding service files in src/web (e.g., detection.service.web.ts, recognition.service.web.ts, paddle-ocr.service.web.ts)
- Update documentation/comments in those files
- Update CHANGELOG.md to record the changes

## Notes

- Treat this as a scaffold, not a hard-coded script.
- Update the command if the workflow evolves materially.