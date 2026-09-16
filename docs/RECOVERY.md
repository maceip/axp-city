# Phaser recovery — September 16, 2026

The recovery starts from `c3bf6b07cb7bc7da6e690203f5769e1a5192413a` (merged SVG city/HUD work) and merges the history of `8ceef63348b87f54427c4c4a8dc98c539bf21552` (the unmerged Phaser client). The local checkout was at `3a3f36a` before this recovery. Backup refs retain all three starting points. Untracked artwork and the separate `ai-game-studio` symlink are preserved.

The Phaser bootstrap, atlas frames, and lot sprite planning are reused. Current civic geography, parser, authentication, and persistence work are retained and integrated. The old four-column layout, SVG renderer, SVG picking, inline SVG browser script, and generated SVG city page are removed.

The original gaps are addressed in the running path: repository rule files affect parsing; a signed delivery fetches actual metrics and rules; existing lots update; snapshot/revision-based JSON replaces SVG fragments; reconnects recover missed changes; atomic persisted order preserves addresses across restarts. Live failures do not silently replace the city with fixtures.

The normal development command starts one server with Vite middleware; the production command serves its Phaser build and APIs together. The deploy script switches the existing city URL to that application while preserving live data and unrelated services.

Verification commands and browser artifacts are documented in `e2e/README.md`. The browser suite uses the compiled application and includes a full 45-second construction transition. The 1,000-lot benchmark records active objects and frame intervals on its actual test machine. Mobile input is tested with Chromium touch emulation; this is not a claim of physical-device coverage.

Do not declare this change deployed from this document alone: verify the merged commit against the live `/healthz` response and inspect the public browser URL. GitHub Actions runs the unit, type, build, and browser checks for the recovery PR and subsequent main commits.

Visual review also found pre-existing atlas errors: first-row roofs were clipped at y=62, the last large-building row joined neighboring sprites, and width-only scaling made thin towers excessively tall. The recovery corrects frame metadata, bounds width and height, and aligns the pad stamp to its canonical footprint without modifying the PNGs.
