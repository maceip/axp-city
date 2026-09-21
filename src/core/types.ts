/** Version 1 is a flat, bounded, integer-grid city. Screen coordinates never enter this model. */
export const WORLD_VERSION = 1 as const;
export const WORLD_SIZE = 64;
export const TICK_MS = 100;
export const EDGE_TICKS = 10;
export type Terrain = "grass" | "dirt" | "water";
export type Heading = "n" | "e" | "s" | "w";
export type BuildingKind = "cottage" | "shop" | "workshop";
export type Tool = "inspect" | "road" | "bulldoze" | BuildingKind;
export interface Point {
  x: number;
  y: number;
}
export interface Cell {
  terrain: Terrain;
  elevation: 0;
  road: boolean;
  occupant: string | null;
}
export interface Building extends Point {
  id: string;
  kind: BuildingKind;
}
export interface Vehicle extends Point {
  id: string;
  heading: Heading;
  to: Point | null;
  progress: number;
  /** Remaining adjacent road cells after the currently reserved edge. */
  route: Point[];
  goal: Point | null;
  trips: number;
}
export interface WorldState {
  version: typeof WORLD_VERSION;
  seed: number;
  width: number;
  height: number;
  minX: number;
  minY: number;
  tick: number;
  revision: number;
  accumulatorMs: number;
  cells: Cell[];
  buildings: Building[];
  vehicles: Vehicle[];
  nextId: number;
}
export type Command =
  | { type: "road" | "bulldoze"; x: number; y: number }
  | { type: "building"; kind: BuildingKind; x: number; y: number };
export interface CommandResult {
  ok: boolean;
  message: string;
}
export interface BuildingDefinition {
  name: string;
  width: number;
  depth: number;
  /** Door occupies this south-edge tile; access is the road immediately south. */
  entry: Point;
  access: Point;
}
export const BUILDINGS: Record<BuildingKind, BuildingDefinition> = {
  cottage: {
    name: "Cottage",
    width: 2,
    depth: 2,
    entry: { x: 0, y: 1 },
    access: { x: 0, y: 2 },
  },
  shop: {
    name: "Shop",
    width: 3,
    depth: 2,
    entry: { x: 1, y: 1 },
    access: { x: 1, y: 2 },
  },
  workshop: {
    name: "Workshop",
    width: 3,
    depth: 3,
    entry: { x: 1, y: 2 },
    access: { x: 1, y: 3 },
  },
};
export const DIRECTIONS: ReadonlyArray<
  Point & { bit: number; heading: Heading }
> = [
  { x: 0, y: -1, bit: 1, heading: "n" },
  { x: 1, y: 0, bit: 2, heading: "e" },
  { x: 0, y: 1, bit: 4, heading: "s" },
  { x: -1, y: 0, bit: 8, heading: "w" },
];
