// oxfmt runs on the staged files only (lint-staged re-stages its output), then
// lint and type-check gate the commit. Nothing here touches unstaged files.
export default {
  "*.{js,jsx,ts,tsx,mjs,cjs}": ["oxfmt", () => "bun run lint"],
  "*.{ts,tsx}": () => "bun run type-check",
};
