# Contributing to SplitForge

Thanks for helping! A few things to know first.

- **Bugs:** open an issue. If a model splits badly, attach the STL (or a small one that shows the same problem) and the axis, position and connector settings you used.
- **Branches:** open pull requests against `development`. `main` only gets tested releases.
- **Checks:** `npm test` must pass, and every file in `src/` must pass `node --check`. CI runs both. See [BUILDING.md](BUILDING.md).
- **Geometry changes** need a test. Every part must stay watertight, and the existing tests must not be loosened to make a change pass.
- **No build step and no dependencies:** SplitForge is plain scripts that run straight from the folder. Please don't add a bundler or npm packages.
- **Stays in the browser:** no uploads, analytics or external requests.
- **Licence:** contributions are accepted under the project's licence (AGPL-3.0-or-later). Third-party code must be AGPL-compatible.
- **Security issues:** please report them privately, see [SECURITY.md](SECURITY.md).
