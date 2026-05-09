// Strict checks only; formatting + lint autofix already ran in .husky/pre-commit.
export default {
  "*.{js,jsx,ts,tsx,mjs,cjs}": () => "bun run lint",
  "*.{ts,tsx}": () => "bun run type-check",
};
