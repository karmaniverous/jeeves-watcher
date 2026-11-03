# AGENTS.md

Standing rules for every agent (human or AI) opening a pull request in this repository. They apply to every PR of the 0.21.0 release and stay until replaced. [CONTRIBUTING.md](CONTRIBUTING.md) covers setup, tests and conventions; these rules sit on top of it.

## Source of truth

- The locked product spec for the current release (its "Next Version" section and decisions) is the source of truth. Do not change the spec from a PR. Owner decisions are constraints: never reverse one in code. If real code contradicts the spec, or a decision looks wrong, stop and report it.

## Gates (before every push)

Run from the repo root. Every gate must pass with **zero errors and zero warnings**:

```bash
npm run typecheck
npm run lint
npm test
npm run build
npm run docs
npm run knip
```

- CI must be green on the pushed head, including the `windows-latest` job (`.github/workflows/windows.yml`).
- **Never** add `eslint-disable` comments, `@ts-ignore`/`@ts-expect-error`, lint `ignores`, or any weakening of a lint, typecheck, knip or coverage rule. Fix the code.
- No test is skipped silently. A skip must be explicit in code (`it.skipIf(...)`/`it.runIf(...)` with a comment giving the reason) and justified in the PR body.

## Tests

- Every behaviour change ships with tests that would fail without it. No trivial tests (asserting a constant, a mock or a type).
- Check coverage of every touched source file before and after the change (`npx vitest run <dirs> --coverage --coverage.include=<glob>` in the package). Coverage of a touched file must not fall; target 90% branches or state the reason in the PR body.
- Run a mutation check on new error paths (break the condition, confirm a test fails, restore).

## Design

- Review the diff for SOLID and DRY before calling it done: one responsibility per module, shared logic in one place, no copy-paste between packages.
- Never bump `package.json` versions or the internal ranges between workspace packages, and never change release configuration beyond what the PR's issue asks for. Put needed releases, release order and range changes in the PR body.

## Docs

- Update the docs the change affects in the same PR, in the repo's own pattern: the README, the package guides (`packages/*/guides/`), `CONTRIBUTING.md`, and the published skill (`packages/core/skills/`, then regenerate `skill.generated.ts`).

## Git and PRs

- Branch names follow `.lefthook/pre-commit/branch-naming-policy` (`feature/`, `bugfix/`, `chore/`, `docs/`, `hotfix/`; no dots).
- Conventional Commits. Commit in logical steps, and **push after every commit**.
- Immediately before **every** push, run `gh pr list --head <branch> --state all --json number,state`. If the newest PR on the branch is `MERGED` or `CLOSED`, stop and report; do not push.
- Open PRs with `--reviewer karmaniverous`. Keep a PR in draft until the gates, the finishing review and CI are all green.
- **Never merge a PR, publish, tag or release.** Those are the owner's.
