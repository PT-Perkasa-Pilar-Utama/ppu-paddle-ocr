# anti-slop (vendored)

Oxlint rules from [dmmulroy/anti-slop](https://github.com/dmmulroy/anti-slop),
copied here rather than depended on, which is how upstream intends them to be
used: the rules encode a team's standards, so they are meant to be read and
adapted, not pinned.

Wired up in `.oxlintrc.json` under `jsPlugins`. This directory is excluded from
linting and formatting so the project's own rules do not rewrite it.

Upstream commit: see git history for the copy date. Re-vendoring means copying
`skills/install-anti-slop/assets/anti-slop/` again and re-reading the diff.
The Effect rule group is not vendored; this project does not use Effect.

MIT, see LICENSE.
