# City map

The isometric map is more than a repo grid. Lot **addresses are sticky**:
index `0` is always the same plot. New repos append to the next free slot
around Central Park. Feature corridors (park, freeway, tram, river) are
reserved from the first lot so growing the city never shuffles buildings.

## Layout

```
        ← east–west freeway (reserved row) →
   river   lots   CENTRAL PARK   tram boulevard   lots
           lots   CENTRAL PARK   tram boulevard   lots
```

- **Central Park** — 2×2 slot hole at the origin. Trees, pond, benches, humans.
- **Freeway** — reserved slot row north of the park. Paved length grows with
  the developed bounding box as repos are added (not as a user pans).
- **Tram** — reserved north–south boulevard east of the park, with rails,
  stations, and a gliding car. Extends with city height.
- **River** — western watercourse, same growth rule.
- **Vacant plots** — undeveloped lots inside the bbox (grass, dirt, trees,
  pocket plazas) so the map reads as a city, not a 9×6 sheet of repos.

Wilderness tiles continue **infinitely** in every direction via a repeating
iso-grass pattern plus sparse client-side trees. Panning does **not** invent
parks or freeways.

## Buildings

Every repo building is one of **three sizes** from stars:

| Band | Stars | Pad width |
| --- | --- | --- |
| S | < 5k | 112px |
| M | 5k–20k | 138px |
| L | ≥ 20k | 168px |

A newly plotted lot plays an **under-construction** animation (crane,
scaffold, cones) for 45 seconds of map time (`CONSTRUCTION_MS`).

## Occupants

Two sprite classes:

- **Human** — recent human activity. Hardhat crew + walk cycles on the yard.
- **Robot** — bot/agent authors. Quad dogs, rovers, cranes, cargo drones.

Drones also fly over high-PR yards (AI pressure) even when the sidewalk is
human. Quiet lots have no crew.

## Multiplayer

Everyone who opens the city sees the **same lot addresses**. There is no
chat and cameras are not synced. A new repo (GitHub `repository.created`,
or any first-seen webhook for that name, or `POST /api/city/lots`) is
appended to `data/city-map.json` and broadcast on `GET /api/city/stream`
so open pages grow a construction site on the shared plot.

Canonical JSON: `GET /api/city`.
