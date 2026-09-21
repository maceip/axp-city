# Repository atlas

The atlas adds three navigation levels to the core workshop: programming-language
continents, repository-topic regions, and read-only districts with one building
per repository. The local workshop remains editable and retains its existing
`axp-core-world-v1` save format.

## Source and grouping

`game/src/atlas/public-repositories.json` is a versioned, explicitly labeled
**Public repository sample**, captured from the public GitHub REST repository
endpoint. It contains 40 repositories with stable GitHub IDs, URLs, measured
primary languages and actual topics. It is a bundled snapshot, not a live index.
Capture time and source are recorded in the document. No browser API requests,
credentials, integration workers or databases are needed.

The primary-language field is preserved even when surprising: a repository name
is not evidence of its current language. Nine language groups form invented
continents. A deterministic topic priority chooses one region per repository;
remaining topics stay visible on its building card. Each continent shows up to
four regions, with an explicit Other topics group when needed. Unmeasured
metadata is distinct from a measured empty topic list.

Geography is presentation data. Continent outlines are deterministic and regions
partition them without overlap. The model emits standard GeoJSON winding; the
renderer reverses rings at the D3 spherical tessellation boundary so continents
do not become the complement of the intended landmass.

Districts reuse the core integer-grid world, validated placement, road graph and
simulation. The current 64×64 layout supports up to 63 repositories per district;
larger catalogs need subdivision before using that builder. Repository identity
is a separate building-ID association. No old fractional lots or SQLite data are
imported or migrated.

## View ownership

`AtlasHost` loads Globe.gl only when World is requested. Globe owns its spherical
camera, continent picking, touch rotation/pinch and labels; Phaser owns flat city
picking and its camera. The globe starts without buildings. Animated camera
flight reveals tag regions, then a 460ms crossfade hands off to the city. Zooming
out past the city's minimum returns to the atlas. Reduced-motion preferences
remove the globe flights and crossfade.

Only the visible view receives input. The hidden globe pauses its animation loop;
Phaser suspends city rendering/presentation and input while its current world
continues fixed-step simulation. Opening a repository district retains the local
town in memory without advancing it; My town resumes that exact local state,
including unsaved edits, undo, camera and selected building. Browser saves remain
untouched by atlas navigation. Background tabs keep the existing pause policy.

Repository districts cannot edit or save over the workshop. A building card shows
its real GitHub link and all supplied tags. Returning to My town restores the
original workshop controls. Context recovery preserves the city's view ownership
and district/local associations. Globe graphics failure exposes a return-to-town
action rather than changing saves.

## Assets and validation

Language icons are vendored from [Devicon](https://github.com/devicons/devicon)
under its MIT license, retained at `game/src/atlas/icons/LICENSE` and linked from
the built application. The Globe.gl notice is also included in the browser build.
The app makes no CDN/image/font requests at runtime.

Pure model tests check identity preservation, grouping order independence,
geometry containment, road connectivity and district capacity. The manual atlas
journey is in `e2e/test_atlas.py`; it exercises the production build and CSP using
actual pointer/wheel/touch input. Browser tests remain manual, outside automatic
CI. Screenshots need visual inspection; passing geometry or browser assertions
alone does not establish visual quality or physical-phone performance.
