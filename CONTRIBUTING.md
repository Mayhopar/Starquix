# Contributing to Starquix

Thanks for helping. Bug fixes, features, docs and tests are all welcome. Questions go to [Discord](https://discord.gg/Fpuwzbd48V) or an issue.

By opening a pull request you agree that your contribution is licensed under the project's [MIT License](LICENSE).

## Reporting bugs and asking for features

- **Bugs:** open an issue with the [bug report form](https://github.com/Mayhopar/Starquix/issues/new?template=bug_report.yml). Include the steps to reproduce, your Starquix version (shown at the bottom of the Projects page) and your operating system.
- **Ideas:** use the [feature request form](https://github.com/Mayhopar/Starquix/issues/new?template=feature_request.yml), or open a pull request directly.
- **Security issues:** never in a public issue. See [SECURITY.md](SECURITY.md).

## Set up

Requires Node.js 22+ and npm 10. Install and run the app as described in the [README](README.md#development).

These help before changing code: [docs/architecture.md](docs/architecture.md) shows how the editor, the desktop shell, the preview bridge and the MCP relay fit together, and [docs/rules.md](docs/rules.md) lists the patterns to follow and the mistakes to avoid. [docs/decisions.md](docs/decisions.md) explains why things are built the way they are; `docs/data-flows/` and `docs/how-to/` cover specific areas.

## Making a change

1. Branch from `main`: `feat/<topic>` for features, `fix/<topic>` for bug fixes. CI runs on both.
2. Keep each pull request to **one change**. Unrelated fixes go in their own pull request.
3. **Bug fixes need a regression test** that fails without the fix and passes with it.
4. **New editor commands and bridge handlers need tests.** `lint:test-coverage` fails when a new command in `commands.ts` or a new `IFrameBridge.prototype.handleX` has none.
5. After changing the bridge (`app/src/bridge/parts/`) or `preview-template/`, run `npm run build:snapshot` and commit the updated snapshot.
6. Follow the existing patterns: search for an existing helper before adding one, and change editor state only through commands (see [docs/rules.md](docs/rules.md)). UI follows the design system in `.claude/skills/design-system/`.
7. Update the docs in `docs/` when you change how something works.

## Testing

Run these before you open the pull request:

```bash
cd app && npm run test:run       # editor unit tests + lint gates
cd desktop && npm test           # desktop unit tests
cd mcp && npm run test:run       # only if you changed mcp/
```

The desktop end-to-end tests drive the real Electron app: `cd desktop && npm run test:electron`. Run them when you change the desktop app, file writes or the canvas.

The `lefthook` pre-push hook runs the snapshot check and the editor tests on every push. Don't skip it with `--no-verify`; if it fails, fix the cause.

## Commits

Write the subject as `Area: what changed`, for example `Desktop: child runners exit when main left before they started` or `CI: ship only installers that installed and ran`. Use the body to explain why, when it isn't obvious.

## Pull requests

- Fill in the pull request template: what changed, why, and how you tested it.
- Add a screenshot or a short recording for visible UI changes.
- CI must pass. Windows and Linux installers are built and tested on `main` and on release tags.
- A maintainer reviews every pull request; reply to review comments in the thread.

## AI-assisted contributions

You may use AI tools. You're responsible for what you submit: review the diff yourself, test it, and be able to say what it changes and why. Keep AI-generated changes as small and focused as any other pull request.

## Releases

Maintainers release by tagging `main`; see [desktop/RELEASE.md](desktop/RELEASE.md).
