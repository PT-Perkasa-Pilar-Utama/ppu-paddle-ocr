```markdown
# ppu-paddle-ocr Development Patterns

> Auto-generated skill from repository analysis

## Overview

This skill teaches the core development patterns and workflows used in the `ppu-paddle-ocr` TypeScript codebase. You'll learn the project's coding conventions, how to keep service layers in sync, how to prepare releases, and how to write and organize tests. The repository focuses on OCR (Optical Character Recognition) processing, with clear separation between processor and web service layers, and maintains a strong emphasis on documentation and versioning.

## Coding Conventions

### File Naming

- Use **camelCase** for file names.
  - Example: `detection.service.ts`, `paddleOcrUtils.ts`

### Imports

- Use **relative imports** for internal modules.
  - Example:
    ```typescript
    import { detectText } from './detection.service';
    ```

### Exports

- Use **named exports**.
  - Example:
    ```typescript
    export function recognizeImage(image: Buffer): string { ... }
    ```

### Commit Messages

- Use **Conventional Commits** with prefixes like `chore`, `fix`, `docs`.
  - Example: `fix: correct symbol coverage in recognition service`

## Workflows

### Update Web and Processor Service Methods and Docs

**Trigger:** When you need to update or document service methods across both processor and web layers.

**Command:** `/update-service-docs`

1. Edit service implementation files in `src/processor` (e.g., `detection.service.ts`, `recognition.service.ts`, `paddle-ocr.service.ts`).
2. Edit corresponding service files in `src/web` (e.g., `detection.service.web.ts`, `recognition.service.web.ts`, `paddle-ocr.service.web.ts`).
3. Update documentation/comments in those files to clarify constructors, improve symbol coverage, or explain new features.
4. Update `CHANGELOG.md` to record the changes.

**Example:**
```typescript
// src/processor/detection.service.ts
/**
 * Detects text regions in the provided image buffer.
 * @param image - The image buffer to process.
 * @returns Array of bounding boxes.
 */
export function detectText(image: Buffer): BoundingBox[] { ... }
```

### Release Version Bump

**Trigger:** When you want to prepare and publish a new release version.

**Command:** `/release`

1. Update `CHANGELOG.md` with release notes describing new features, fixes, and changes.
2. Update `jsr.json` and `package.json` with the new version number.
3. Optionally, bump the version in sub-packages (e.g., `apps/serve/package.json`).
4. Commit with a conventional message (e.g., `chore: release v1.2.0`).

**Example:**
```json
// package.json
{
  "version": "1.2.0"
}
```

## Testing Patterns

- Test files follow the pattern `*.test.*` (e.g., `detection.service.test.ts`).
- The testing framework is **undetermined**, but tests are colocated with source files or in a parallel structure.
- Example test file:
  ```typescript
  // detection.service.test.ts
  import { detectText } from './detection.service';

  describe('detectText', () => {
    it('should return bounding boxes for text regions', () => {
      const image = ...; // mock image buffer
      const result = detectText(image);
      expect(result).toBeInstanceOf(Array);
    });
  });
  ```

## Commands

| Command               | Purpose                                                        |
|-----------------------|----------------------------------------------------------------|
| /update-service-docs  | Sync and document processor and web service methods            |
| /release              | Prepare and publish a new release version                      |
```
