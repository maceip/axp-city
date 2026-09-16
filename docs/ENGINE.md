# Phaser 4 engine

AXP City uses **Phaser 4.2.1** for its live city. This decision is implemented, not a proposal for a future renderer.

The application stays in `maceip/axp-city`. Node handles GitHub access, rules, persistence, and HTTP. Phaser runs in the browser and renders the shared world. Vite is a development/build tool; production serves its output through the same Node process as the API.

`CityLot` is the domain contract. `planCity` assigns stable addresses from persisted order, reserving civic corridors. The client receives canonical placements. Neither the renderer nor HUD assigns repository addresses.

`planLot` reuses the existing measured sprite atlas and creates objects only for visible lots. Eight-by-eight world-cell chunks bake the background into textures. Chunks outside the viewport margin are destroyed, including their textures. Crew and yard detail are omitted at flyover zoom. Buildings use measured frames and foot-position depth ordering. The source atlas remains unchanged.

HUD controls and accessible repository cards are ordinary HTML. The city is a Phaser WebGL canvas. There is no SVG map, SVG hit-testing code, or SVG transport in the live application.

Camera gestures use Phaser world coordinates: drag, wheel, keyboard, touch pan/pinch, search, lot jumps, and follow. Browser tests exercise input against the production build, including mobile emulation. Performance evidence is recorded against a 1,000-repository fixture; it is not a claim about millions of animated objects or every mobile GPU.

Primary engine documentation: [Phaser cameras](https://docs.phaser.io/phaser/concepts/cameras) and [Phaser 4 rendering](https://phaser.io/tutorials/phaser-4-rendering-concepts).
