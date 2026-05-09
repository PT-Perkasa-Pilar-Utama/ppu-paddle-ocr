export default {
  "*.{js,ts,tsx,json,css,md}": "oxfmt --no-error-on-unmatched-pattern",
  "*.{js,jsx,ts,tsx,mjs,cjs}": "bun run lint",
  "*.{ts,tsx}": () => "bun run type-check",
};
