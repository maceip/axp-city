# AXP City working contract

- This repository is `maceip/axp-city`. Verify `pwd`, Git remotes, status, and branch before edits. Fetch the target remote before choosing a base; local `main` may be stale. Preserve untracked artwork and the `ai-game-studio` symlink (a separate project).
- Phaser 4 is the only live city renderer. The decision is implemented. Do not build new city features in SVG or reintroduce a separate static city page.
- Node serves the built Phaser application and its JSON/SSE APIs from one origin. Keep one repository and one canonical city model. Repository rules must affect the parser and rendered result, not just tests or documentation.
- Preserve persisted lot order and addresses. Keep server credentials out of the browser. Missing auth must deny mutations; live failures must not silently use fixtures.
- Rendering work requires real browser interaction and screenshot inspection. Run `npm test`, `npm run typecheck`, `npm run build`, and the production browser harness in `e2e/` for integration changes. Test reconnect/restart and two browsers when changing live data.
- A compile, screenshot, or passing unit suite alone is not end-to-end completion. Report the tested commit, actual deployment state, and remaining limitations accurately. Follow `docs/DEPLOY.md` for the live site; preserve its data directory and unrelated Caddy sites.
