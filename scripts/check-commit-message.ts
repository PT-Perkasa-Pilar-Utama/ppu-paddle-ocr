// SPDX-License-Identifier: MIT
// Copyright (c) 2026 PT Perkasa Pilar Utama

// commit-msg hook: `type: description`, no scope, one of the listed types,
// subject at most 80 characters.

const TYPES = ["feat", "fix", "chore", "refactor", "test", "docs", "perf", "ci", "cli"];
const MAX_SUBJECT_LENGTH = 80;

const file = process.argv[2];
if (!file) {
  console.error("Usage: check-commit-message.ts <commit-message-file>");
  process.exit(2);
}

const subject = (await Bun.file(file).text()).split("\n")[0] ?? "";
const pattern = new RegExp(`^(${TYPES.join("|")})!?: .+$`);

if (!pattern.test(subject)) {
  console.error("Error: Invalid commit format.");
  console.error("Expected: type: description");
  console.error(`Types: ${TYPES.join(", ")}`);
  process.exit(1);
}

if (subject.length > MAX_SUBJECT_LENGTH) {
  console.error(
    `Error: Commit subject is ${subject.length} characters (max ${MAX_SUBJECT_LENGTH}).`
  );
  process.exit(1);
}
