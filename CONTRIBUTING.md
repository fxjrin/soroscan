# Contributing to Soroscan

Thanks for your interest. This document keeps contributions smooth for everyone.

## Ground rules

- English only in code, comments, commits, branches, issues, and PRs.
- Be respectful; see [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
- Security vulnerabilities go through [private vulnerability reporting](https://github.com/fxjrin/soroscan/security/advisories/new), never public issues.

## Issues

- Use the issue forms (bug report or feature request).
- For bugs, always include the entity involved (tx hash, account, contract ID) and the network (mainnet or testnet); explorer bugs are almost always data-shape bugs, and the exact entity is the reproduction.
- Open an issue before starting any non-trivial PR so the approach can be agreed first.

## Pull requests

1. Fork (external contributors) or branch from `main` (maintainers).
2. Branch naming: `feat/<short-name>`, `fix/<short-name>`, `chore/<short-name>`.
3. Commits follow [Conventional Commits](https://www.conventionalcommits.org/): `feat:`, `fix:`, `chore:`, `docs:`, `refactor:`, `test:`.
4. Keep PRs focused and small; one concern per PR.
5. PRs are squash-merged; the PR title becomes the commit message, so give it a proper Conventional Commit title.
6. CI must pass. Direct pushes to `main` are blocked; everything lands through a PR.

## Code style

- Formatting and linting are CI-enforced; run the project format task before pushing.
- Comments explain why, never what. No TODO comments in committed code, no dead code.
- All on-chain data is untrusted input: user-facing rendering must go through the shared untrusted-text components; never bypass them.
- Keep u64/i128 chain values as strings; JavaScript numbers corrupt them.
