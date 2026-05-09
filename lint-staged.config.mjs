// Formatting and lint autofix already ran over the whole repo in
// `.husky/pre-commit` (via `bun run fmt:fix` + `bun run lint:fix`).
// This config only enforces the *strict* post-fix checks:
//   - lint (fail on any rule violation that couldn't be autofixed)
//   - type-check (fail on any TS error)
//
// Using `() => "..."` makes lint-staged run each command once without
// appending filenames, so both commands operate on the whole project
// exactly like CI does. That way the pre-commit guardrail has the same
// strictness as the `.github/workflows/ci.yml` gate.
export default {
  "*.{js,jsx,ts,tsx,mjs,cjs}": () => "bun run lint",
  "*.{ts,tsx}": () => "bun run type-check",
};
