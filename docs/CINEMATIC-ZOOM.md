# Cinematic atlas camera

The repository atlas selectively integrates camera code from [Makio64/threejs-cinematic-world-zoom](https://github.com/Makio64/threejs-cinematic-world-zoom), pinned to commit [`a15c683fb30671a44115c30e6ef045938c5a4167`](https://github.com/Makio64/threejs-cinematic-world-zoom/commit/a15c683fb30671a44115c30e6ef045938c5a4167). The upstream commit is dated August 11, 2026. Its source is MIT licensed, copyright 2026 David Ronai (@makio64).

## Exact source and application adaptation

| File                                                                                                                                     | Role in AXP City                                                                                                                                                                                                              |
| ---------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [easing.js](../vendor/cinematic-world-zoom/src/camera/easing.js)                                                                         | Byte-exact upstream source. The TypeScript camera adapter directly imports `cinematic`, `clamp01`, `mixLog` and `smootherstep`. It does not import the retained `damp` helper.                                                |
| [shots.js](../vendor/cinematic-world-zoom/src/camera/shots.js)                                                                           | Byte-exact upstream source. The adapter imports `SHOTS` and uses the authored Descent and Dive channel curves. The retained file also contains the other three presets and Earth-specific shot construction/settling helpers. |
| [Rig.js](../vendor/cinematic-world-zoom/src/camera/Rig.js)                                                                               | Byte-exact reference source. Its analytic camera-basis method informs the sphere adapter; this file is not imported into the application.                                                                                     |
| [CinematicCamera.ts](../game/src/atlas/CinematicCamera.ts)                                                                               | Application-owned TypeScript adaptation for Globe.gl's radius-100 sphere, camera ownership and interactive journeys.                                                                                                          |
| [easing.d.ts](../vendor/cinematic-world-zoom/src/camera/easing.d.ts), [shots.d.ts](../vendor/cinematic-world-zoom/src/camera/shots.d.ts) | Locally authored declarations for the retained JavaScript exports. These are additions, not upstream files.                                                                                                                   |

[UPSTREAM.json](../vendor/cinematic-world-zoom/UPSTREAM.json) records the full source commit, commit timestamp, original Git blob IDs, byte counts and SHA-256 hashes. The three JavaScript files and [LICENSE](../vendor/cinematic-world-zoom/LICENSE) are unchanged. Keep that distinction when updating the adapter: retained source, directly reused curves and adapted camera geometry are separate parts of the integration.

The camera adapter uses Descent for flights between atlas levels and Dive for the approach to a repository district. It scales the authored pitch, azimuth, roll and lens channels into short interactive journeys of roughly one to two seconds, with shorter button zooms. Upstream's five film presets have original durations of 22–32 seconds; those timings and Earth-scale distances are retained upstream values, not AXP flight settings. The adapter does not call upstream `createShot`, whose default starts twenty million metres away and enforces at least a tenfold distance span.

The adapter interpolates geographic altitude in log space with `mixLog`, then analytically solves the eye-to-surface distance so each oblique camera pose remains at that altitude above the sphere. This differs from directly interpolating upstream's eye-to-aim distance in Earth metres. The camera basis uses a local east/north/up frame and explicit right/up/back axes, avoiding a `lookAt` singularity on a straight-down approach. The Phaser district still has its own integer-grid coordinates and simulation.

`sampleFlight` is a pure, seekable function of the starting pose, destination, normalized time, flight kind and globe radius. A retargeted flight starts at the currently displayed position, orientation and field of view. Completed flights end in a globe-center-facing, north-up pose with Y-up camera convention and a 50-degree vertical field of view, allowing OrbitControls to take over without changing the completed pose.

The camera wrapper schedules at most one camera `requestAnimationFrame` callback at a time; Globe.gl retains its separate rendering loop. Pausing the camera clock preserves the flight's elapsed time and resets its time origin on resume, so a hidden browser tab does not advance the flight. Hiding the atlas or losing its graphics context cancels the flight and pending district entry. Reduced motion applies the final pose and completes synchronously.

Cancellation preserves the displayed camera position but immediately returns orientation and field of view to the OrbitControls-compatible pose. It does not claim to preserve a banked, surface-facing gaze through that handoff. Restrained pitch, roll and lens changes limit the visible adjustment while giving a new drag or wheel gesture control immediately.

## Dependencies and boundaries

`easing.js` has no imports. `shots.js` imports `three` and its sibling easing module. `Rig.js` imports `three` plus upstream `../geo.js` and requires an ellipsoid with cartographic-position, normal and elevation methods. That geographic helper is deliberately outside this source subset; `Rig.js` alone is therefore not a runnable package.

AXP City uses its existing Three dependency (`0.186.0` at integration). Upstream pins `0.185.1` for its atmosphere renderer's depth-texture behavior; the atmosphere pipeline is outside this integration. Vendoring this subset does not add a dependency manifest or installation scripts.

The application retains synthetic language continents and locally bundled repository metadata. The integration excludes upstream Earth imagery, Google/Cesium tile access and authentication, solar lighting calculations, Takram atmosphere/cloud effects and binary assets, exposure metering, MP4/WebCodecs recording, landmarks and upstream UI. The upstream application was inspected as source; it was not installed or run, and no upstream asset script or remote tile service was invoked.

## Verification scope

Vendoring verification compares each retained source/license file byte for byte with its pinned Git object and checks the recorded SHA-256 digest. This proves source fidelity, not camera behavior. Application type checks, camera tests and desktop/touch visual acceptance validate the separate TypeScript adaptation and its integration with Globe.gl and Phaser. Keep those results tied to the tested application revision.

To verify the retained files locally without executing upstream code:

```sh
python3 - <<'PY'
from pathlib import Path
import hashlib, json
root = Path('vendor/cinematic-world-zoom')
manifest = json.loads((root / 'UPSTREAM.json').read_text())
for name, record in manifest['files'].items():
    data = (root / name).read_bytes()
    assert len(data) == record['bytes'], name
    assert hashlib.sha256(data).hexdigest() == record['sha256'], name
print('Pinned camera source and license verified')
PY
```
