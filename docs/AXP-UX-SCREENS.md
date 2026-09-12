# AXP UX Screens & SimCity City Map — Design Record

**Date:** 2026-09-10 → 2026-09-11  
**Purpose:** Single record of every product screen discussed and the detailed SimCity-style language for representing repositories and repo state.  
**Related code:** Origin `rootworks/tmp-9c9361bfac6116d7` (`src/parser/`, `docs/PARSER.md`, `src/render/`, `out/city.*`)  
**Art assets:** `~/AXP-city-sprites/` on the Mac (building sheets, yards, robots, drones, environment tiles)

This document is descriptive, not a ticket list. It freezes decisions and vocabulary so implementation does not re-litigate the hours of design.

---

## 0. Product frame (what this UI is for)

**AXP (Agent Exchange Protocol)** is about **community**: relationships with repositories, showing **what you support**, and surfacing **projects that need support** — especially as repos get buried under agentic issue solvers and PR pushers.

The city / SimCity map is a **public system map** of repos on the platform: developers’ land (buildings) and donated bots (visiting labor). It is **not** primarily a personal file picker or a prettier `gh repo list`.

Work still happens in familiar surfaces (chat, diff, agent runs). The map is for **orientation, support, and relationship** — flyover glance, then click into normal session UI.

---

## 1. Screen inventory (everything discussed)

### 1.1 Agent workspace — Chat (“Stage, not feed”)

Cursor-shaped agent chat inspired by Muse (Meta personal agent): airy, soft peach user bubbles, mist/gray agent bubbles, neo-chibi / presence at top, generous negative space, choice cards with a hard selected edge.

**Layout intent**
- Wide transcript column with large side gutters (stage), not a cramped DM feed.
- Agent presence anchors top-center or a slim rail (character as presence, not mascot spam).
- Soft peach user bubbles; cool mist agent bubbles.
- Technical inserts (choice cards, stop control) nest in the soft chrome without hardening the whole UI.
- Optional thin “turn bar” under the composer (tokens / model / stop) — RPG-adjacent strip, not a health bar.

**Aesthetic constraints**
- Grown-up kawaii / neo-chibi; anime-influenced but not a kids’ game.
- Soft radii, airy padding; avoid wood, grass, speech-tail chrome in the *IDE chrome*.
- Balance: kawaii components + high-technical treatments + negative space.

### 1.2 Agent workspace — Diff (“Spell book, not terminal”)

Most kawaii UIs die on diffs. Keep monospace ruthless.

**Layout intent**
- Warm charcoal canvas for the diff pane only (so code pops).
- Soft mint / coral pills for +/- (not loud “damage numbers”).
- File tree as a quiet left “quest log” with soft section chips.
- Active hunk as a floating focus card with soft glow; everything else dimmed.
- Chibi stays out of the gutter; optional tiny status orb (“reviewing”).

### 1.3 Agent workspace — Agents (“Party select”)

**Layout intent**
- Grid or horizontal party row of neo-chibi / agent tiles.
- Each card: name, status pill, last action; lots of empty pad.
- Selecting an agent soft-focus zooms into that agent’s chat (not a hard jarring route).
- Cloud / away agents as “on a run” with subtle progress (technical, not game HP).

### 1.4 AXP Hunter Exchange (contribution workspace home)

Earlier AXP workspace (sage/cream contribution cards) evolved toward a **Hunt** board:

**Layout intent**
- Left rail: nav (Hunt active, Contributions, People, Activity).
- Center: **Hunt** field — contribution *runs* as party-quest cards (status pill, mono issue id, title, blurb, tiny agent glyph, dashed session graph).
- Right rail: **Party** — connected ACP agents as tiles (needs you / on a run / idle seat).
- Soft-zoom from a selected run into Chat + Diff.
- Sage + peach accents; mono IDs; dashed session graphs for technical bite.
- HTML mock existed at `~/AXP-hunter-board-mock.html`.

**Job of Hunt vs City**
- Hunt = operator board for *your* sessions/contributions in the exchange.
- City = landscape of *repos* (support / need / donated labor) at platform or community scale.

### 1.5 Email-agent / AAMP overlay (mailbox protocol UI)

Email-only agent collaboration (AAMP / mailbox lane; `wire.emaiil` link was 404 — treat as AAMP-class email agent UX).

**Surface:** web overlay shelf (pointer-magic energy), not another full IDE.

**Pieces discussed**
1. Empty-state / pitch tiles (wire-card / blueprint grammar): dispatch by email · help_needed in-thread · result as auditable mail.
2. Guided magic-link widget when a link hits the mailbox.
3. Password / OTP capsule — soft field, confirm before agent pastes into the focused page (never silent).
4. Progress ribbon of protocol pills: `dispatch → ack → help_needed → result`.

### 1.6 Project garden (Animal Crossing–style) — explored, then superseded for the system map

An isometric “project garden” / village was workshopped (walkable houses → chat). Takes included Quiet Paths, Postcard Diorama, Cutaway Workshop.

**Hard lesson recorded:** usefulness is not rendering quality. For AXP’s community job, the **SimCity city grid** became the better primary metaphor for the *system map*. Garden language may remain as marketing/onboarding flavor, but the detailed state language below is **city / construction site**.

### 1.7 AXP SimCity City Map (primary detailed screen)

**This is the screen that received the most design detail.** See §2–§5.

---

## 2. SimCity city map — mental model

### 2.1 What each repo is

Every repository is a **lot** with **two adjacent plots**:

| Plot | Meaning |
| --- | --- |
| **Building pad** | The project itself (mass, age/patina, silhouette). |
| **Receiving yard** | Inbound work seeking entry (issues / PRs / help). |

Sticky geography: lots keep addresses; activity **lights** them; it does not reshuffle the map every week (muscle memory / flyover atlas).

### 2.2 Populations on the map

| Who | Visual | Zone |
| --- | --- | --- |
| **Human / recent activity crew** | Biped humanoid robots (Unitree G1–like silver + blue visor; Sprout-like sage + yellow joints). Evolved *from* high-vis vest humans — same *role*, robot form. | **Ground / bottom half** of the lot, moving only when there is **recent** activity on issues or PRs. |
| **Donated agents / bots** | Flying drones (small quads; industrial hexa/octo facade cleaners; cargo drones); optional wheeled/tracked construction bots for heavier yards. | **Air / top half** of building height (even on small sheds — short tether). |
| **Maintainers / humans (living signs)** | Earlier idea: lit windows, gardens, laundry as “people live here” vs agent swarm — still valid as secondary signal if needed; activity crew is the primary motion signal. | Building facade / porch. |

**Critical rule:** High-vis / biped crew appear **only if there has been recent activity** on issues **or** PRs. They are a **motion signal**, not a contributor headcount. Quiet backlog can show props with an empty sidewalk.

### 2.3 What we deliberately do *not* use

- Gift-wrap **presents** for backlog (rejected).
- Broken windows, pigeons, blight, leaning towers (say “failed/abandoned,” not “please support”).
- Resizing the **plot footprint** by agent count (destroys 1000-repo readability).
- Dynamic reshuffle of lot positions by recency (kills geography).

---

## 3. Building pad — encoding the repo

### 3.1 Size → building mass (fixed tile)

**Do not grow the lot.** Change the **building silhouette** on a fixed pad.

| Band | Typical driver | Catalog | Silhouette family |
| --- | --- | --- | --- |
| **Small** | Fewer stars / smaller project | IDs **01–17** | Sheds, shops, cottages, small offices, garage, chapel, etc. |
| **Medium** | Mid stars / mid project | IDs **18–34** | Mid-rise offices, civic, L-shapes, courtyard, parking podium, etc. |
| **Large** | High stars / large project | IDs **35–50** | Towers, twins, twist, hangar, eco terraces, brutalist, gem tower, etc. |

**Implemented parser cut (code):** stars → S `< 5000`, M `5000–19999`, L `≥ 20000`. `buildingId` = stable hash of `owner/name` within band (with uniquify on collision). `sizeKb` / LOC can remain display-only or alternate drivers later.

Alternate drivers discussed (valid if swapped with documented thresholds): commits, LOC, language bytes — still map to the same S/M/L silhouette families.

### 3.2 Age → patina (sticky, not position)

| Age | Look |
| --- | --- |
| New | Fresh lumber / bright roof / still-framed feel |
| Old | Weathered wood, ivy, settled foundation |

Old + busy = ancient *and* under construction. Do not exile old repos to a “history district.”

### 3.3 Architecture variety

Fifty numbered isometric buildings across styles (wood, brick, glass, concrete, metal, Hangar, pagoda-ish, hospital, school, etc.) so the flyover is a **legend of what people build**, not identical cubes. Environment tile set: grass, dirt, concrete, roads (straight/corner/T/curve), dual-plot pads, water/sand/snow, trees, curb, lamp, cone, bench.

---

## 4. Receiving yard — encoding repo state

### 4.1 Props language (locked)

| Signal | Yard props |
| --- | --- |
| **Open / unmerged issues** | **Construction planning:** drafting table + **blue blueprint** (also ground blueprint + pencil/triangle). |
| **Open / unmerged PRs** | **Raw materials:** brick pallets, cinder blocks, lumber, pipes, sand, gravel, rebar, cement bags, mixer, etc. — “stuff ready to build in.” |
| **Fully dormant** | Empty yard (dirt/concrete), quiet building or bare foundation energy — no tables, no materials, no crew, no drones. |

**Presents are out.** Materials = PR backlog; blueprints = issue backlog.

### 4.2 Activity overlays (locked)

| State | Yard | Crew (biped robots) | Agents (drones) |
| --- | --- | --- | --- |
| **Fully dormant** | Empty | None | None |
| **Open issues · quiet** | Drafting table + blue plans | **None** | None |
| **Open issues · active** | Same blueprints | Movers at the table | Optional |
| **Open PRs · quiet** | Material stacks | **None** (empty sidewalk) | Optional / rare |
| **Open PRs · active** | Materials | Movers hauling/stacking | Drones up top when agent/bot signal |

**Healthy churn (earlier metaphor, still useful):** yard in *motion* — materials ferrying into the dock, floor not eternally piled. **Needs support:** neat stacks waiting (materials or plans), inviting help — not blight.

**Both issues and PRs:** prefer PR yard as primary; may show materials **and** a small blueprint. Documented precedence: **open PRs beat open issues**.

### 4.3 “Recent activity” clock

**N = 14 days** (parser): recent if `pushed_at` within window **or** recent default-branch commits in window. That flips quiet ↔ active for crew.

### 4.4 Drones / donated agents

- Default small quads in upper air when agent/bot labor is present.
- **High PR pressure or bot authors:** drones on PR yards (`openPrs ≥ 15` or known bot logins: dependabot, renovate, weblate, etc.).
- Variants in art kit: industrial facade-cleaning hexa/octo (spray + hose), cargo drones, tracked arm bots, flat haulers — scale with lot intensity / building height without changing plot size.

### 4.5 Agent count without resizing lots

Equal plot footprints. Encode swarm as **activity silhouette / weather**: thin smoke / one worker vs dense crane/dust / many drones — not a skyscraper footprint for “100 agents.”

---

## 5. Flyover, scale, and interaction

### 5.1 Jobs of the map

1. **Orientation pass:** of my/the platform’s world, what stirred? (heat/glow/motion)
2. **Support vs drowning:** heavy materials + few movers, or packed drones vs empty yards.
3. **Relationship:** who donated bots to whose land (visiting labor on sticky plots).
4. **Click-through:** enter lot → familiar chat / session / Hunt surface — house/lot is not the work surface.

### 5.2 Zoom levels

World flyover (many dim lots, few lit) → district / neighborhood → single lot porch (sessions/crew visible) → chat/diff.

### 5.3 Stable atlas rules

- Home / personal workshop can be a fixed anchor if personal view exists.
- User-shaped districts (work / side / theme) sticky if personal atlas.
- Platform view: sticky lot positions; fog/far cold lots still present.
- Heat = lanterns, crew motion, material piles, blueprint tables — never teleporting buildings.

---

## 6. Parser → render contract (implementation mirror)

So design and code stay aligned:

```
repos.txt → ingest/ (GitHub metrics + fixtures)
         → parser/ (pure: RepoMetrics → CityLot)   ← city logic lives here
         → render/ (SVG/HTML isometric city)
         → out/city.html + out/city.png
```

**Non-negotiable:** ingest never paints; render never special-cases by repo name; parser owns yard kind, band, crew, drones.

Key files: `src/parser/thresholds.ts`, `src/parser/parseLot.ts`, `docs/PARSER.md`.

Demo repos exercised through the pipeline included: LegadoTeam/legado, maxrave-dev/SimpMusic, gkd-kit/gkd, RikkaApps/Shizuku, bmax121/APatch, JunkFood02/Seal, 2dust/v2rayNG, ReVanced/revanced-manager, ankidroid/Anki-Android, libre-tube/LibreTube, tharunbirla/LibreCuts, caillette/Oak (dormant control).

---

## 7. Aesthetic stack (cross-cutting)

| Layer | Direction |
| --- | --- |
| Chat / Muse-like surfaces | Light, airy, soft peach, neo-chibi presence, negative space |
| Diff | Warm charcoal, mono, soft +/- |
| Hunt | Soft sage/cream, party rail, quest cards |
| City map | Clean isometric construction / SimCity vector (buildings, yards, robots, drones); Kairosoft-style pixel kit also generated earlier as an alternate art pass |
| Email overlay | Soft shelf + wire/blueprint marketing grammar |

Overall product tone: **grown-up kawaii where chat lives**; **readable construction city where community/repos live** — game-adjacent without making the work surfaces into Animal Crossing HUD.

---

## 8. Asset inventory (where the pictures live)

Consolidated source of truth in this repo: `assets/city-sprites/` (18 PNGs, copied from `~/AXP-city-sprites/` on 2026-09-11).

Exact file list:
- `buildings-small-01-17.png`, `buildings-medium-18-34.png`, `buildings-large-35-50.png` — 50 buildings, S/M/L bands
- `environment-tiles.png` — grass, roads, dual-plot pads, props
- `v2-raw-materials.png` — PR yard materials
- `v2-planning-issues.png` — drafting tables / blueprints
- `v2-lot-states.png`, `v2-lot-states-activity.png` — state examples
- `v3-robot-crew.png` — biped activity crew
- `v3-agent-drones.png`, `v4-facade-drones.png`, `v4-ground-construction-bots.png` — agents
- `v3-lot-states-robots.png` — lots with robot crew
- `01-buildings.png`, `02-actors-humans-drones.png`, `03-yards-parcels.png`, `04-ground-tiles.png`, `05-lot-examples.png` — earlier pixel pass (Kairosoft-style, superseded for look)
- Hunter board mock: `docs/hunter-board-mock.html` (was `~/AXP-hunter-board-mock.html`)

Note: the older hashed files directly under `assets/*.png` duplicate 6 of these sheets (small/medium/large buildings, environment, v2-lot-states-activity, v3-lot-states-robots). Prefer the descriptively named copies under `assets/city-sprites/`; the renderer still draws SVG silhouettes and does not stamp these PNGs yet (see §10).

Player-owned repo lots: `assets/city-sprites/player-repo/` (15 files, added 2026-09-11) — eco/garden S/M/L building trios + two craft-building grids for the personal atlas / home workshop, plus a 20-pose human crew sheet (non-iso). See its README; original filenames kept.

---

## 9. Decision log (short)

1. City grid over walkable AC garden for the **system map**.
2. Two-plot lots: building + receiving yard.
3. Issues = blueprints; PRs = raw materials; no presents.
4. Crew only on **recent** issue/PR activity; quiet backlog can be prop-only.
5. Crew form: biped robots (not required to stay organic humans).
6. Agents = aerial drones (+ heavy ground bots as intensity variants).
7. Fixed plot size; variable building mass; sticky geography; heat overlays.
8. Parser owns semantics; no per-repo-name art switches.
9. Chat/Diff/Agents/Hunt/Email remain the work & exchange surfaces; city is the landscape.

---

## 10. Open threads (explicitly not closed)

- Exact personal-atlas districts vs pure platform grid.
- Whether lit-windows “human living” signal stays beside robot crew.
- Facade-cleaner drones as default on tall L-band buildings vs only high-PR.
- Email overlay fidelity vs city (separate ship track).
- Art pipeline: commit sprite atlases into Origin and wire renderer to real PNGs vs SVG silhouettes.

---

*End of single-document record. All screens and SimCity state language from the 2026-09-10/11 design session are intended to be captured above.*
