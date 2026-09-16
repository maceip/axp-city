import Phaser from "phaser";
import { pathLength, pointAlong, type AmbientActor } from "../../src/game/ambient.js";
import type { ActorBehaviour, AnimStamp } from "../../src/game/plan.js";
import { overlaps, type Rect } from "../../src/game/visibility.js";
import { project } from "../../src/render/iso.js";
import type { AssetLoader } from "./assets.js";
import { spritePool, type ObjectPool } from "./pool.js";

/** Frame geometry for textures the preloader generates instead of fetching. */
export const GENERATED_FRAMES: Record<string, { cellW: number; frames: number; fps: number }> = {
  humanWalk: { cellW: 24, frames: 4, fps: 5 },
  humanWork: { cellW: 24, frames: 4, fps: 4 },
  humanCarry: { cellW: 24, frames: 4, fps: 5 },
  humanWave: { cellW: 24, frames: 4, fps: 3 },
  car: { cellW: 48, frames: 1, fps: 1 },
  tram: { cellW: 96, frames: 1, fps: 1 },
};

interface ActorState {
  id: string;
  anim: string;
  behaviour: ActorBehaviour;
  cellW: number;
  frames: number;
  fps: number;
  targetW: number;
  base: { sx: number; sy: number };
  pace?: { dx: number; dy: number; legs: number };
  bob?: number;
  phase: number;
  depthBias: number;
  /** Scene clock (ms) at which this actor's private timeline started. */
  born: number;
  repo?: string;
  tint?: number;
  faces: boolean;
  ambient?: {
    def: AmbientActor;
    length: number;
    distance: number;
    dir: 1 | -1;
    dwellUntil: number;
    lastStop: number;
  };
  sprite?: Phaser.GameObjects.Sprite;
  /** Last computed screen position (for following and diagnostics). */
  sx: number;
  sy: number;
}

export interface ActorPose {
  sx: number;
  sy: number;
  frame: number;
  flip: boolean;
  depth: number;
}

/**
 * Owns every moving thing in the city. Actor state (timeline, route
 * progress, behaviour) lives here and persists whether or not a sprite is
 * currently drawing it, so scrolling away and back never restarts activity.
 * Sprites are pooled and only attached while the actor is near the viewport.
 */
export class ActorSystem {
  private actors = new Map<string, ActorState>();
  private byLot = new Map<string, string[]>();
  private pool: ObjectPool<Phaser.GameObjects.Sprite>;
  private clock = 0;
  reducedMotion = false;
  constructor(
    private readonly scene: Phaser.Scene,
    private readonly assets: AssetLoader,
  ) {
    this.pool = spritePool(scene, 800);
  }

  get count(): number {
    return this.actors.size;
  }
  get drawn(): number {
    return this.pool.live;
  }
  get parked(): number {
    return this.pool.parked;
  }

  /** Replace the actors for one lot, keeping timelines of actors that still exist. */
  setLotActors(repo: string, anims: AnimStamp[]): void {
    const keep = new Set(anims.map((a) => a.actorId));
    for (const id of this.byLot.get(repo) ?? []) if (!keep.has(id)) this.remove(id);
    const ids: string[] = [];
    for (const stamp of anims) {
      ids.push(stamp.actorId);
      const existing = this.actors.get(stamp.actorId);
      const generated = GENERATED_FRAMES[stamp.anim];
      const cellW = generated ? generated.cellW : stamp.sheet.width / stamp.sheet.cols;
      const frames = generated ? generated.frames : stamp.sheet.frames;
      const fps = generated ? generated.fps : stamp.sheet.fps;
      if (existing) {
        Object.assign(existing, {
          anim: stamp.anim,
          behaviour: stamp.behaviour,
          cellW,
          frames,
          fps,
          targetW: stamp.targetW,
          base: { sx: stamp.sx, sy: stamp.sy },
          pace: stamp.pace,
          bob: stamp.bob,
          phase: stamp.phase,
          depthBias: stamp.anim === "cargoDrone" ? 1000 : 0,
        });
        continue;
      }
      this.actors.set(stamp.actorId, {
        id: stamp.actorId,
        anim: stamp.anim,
        behaviour: stamp.behaviour,
        cellW,
        frames,
        fps,
        targetW: stamp.targetW,
        base: { sx: stamp.sx, sy: stamp.sy },
        pace: stamp.pace,
        bob: stamp.bob,
        phase: stamp.phase,
        depthBias: stamp.anim === "cargoDrone" ? 1000 : 0,
        born: this.clock,
        repo,
        faces: true,
        sx: stamp.sx,
        sy: stamp.sy,
      });
    }
    this.byLot.set(repo, ids);
  }

  removeLot(repo: string): void {
    for (const id of this.byLot.get(repo) ?? []) this.remove(id);
    this.byLot.delete(repo);
  }

  /** Replace ambient actors (called when the plan's features change). */
  setAmbient(defs: AmbientActor[]): void {
    const keep = new Set(defs.map((d) => `ambient:${d.id}`));
    for (const [id, actor] of this.actors)
      if (actor.ambient && !keep.has(id)) this.remove(id);
    for (const def of defs) {
      const id = `ambient:${def.id}`;
      const length = pathLength(def.path);
      const existing = this.actors.get(id);
      const generated = GENERATED_FRAMES[def.anim];
      if (existing?.ambient) {
        existing.ambient.def = def;
        existing.ambient.length = length;
        existing.ambient.distance = Math.min(existing.ambient.distance, length);
        continue;
      }
      const start = pointAlong(def.path, def.offset);
      const p = project(start.x, start.y);
      this.actors.set(id, {
        id,
        anim: def.anim,
        behaviour: def.kind === "pedestrian" ? (def.anim === "humanWave" ? "wave" : def.anim === "humanWork" ? "work" : "walk") : "drive",
        cellW: generated?.cellW ?? 24,
        frames: generated?.frames ?? 1,
        fps: generated?.fps ?? 1,
        targetW: def.width,
        base: { sx: p.sx, sy: p.sy },
        phase: def.offset * 3,
        depthBias: 0,
        born: this.clock,
        tint: def.tint,
        faces: def.faces,
        ambient: {
          def,
          length,
          distance: def.offset * length,
          dir: 1,
          dwellUntil: 0,
          lastStop: -1,
        },
        sx: p.sx,
        sy: p.sy,
      });
    }
  }

  private remove(id: string): void {
    const actor = this.actors.get(id);
    if (!actor) return;
    if (actor.sprite) this.pool.release(actor.sprite);
    this.actors.delete(id);
  }

  /** Advance every timeline; only ambient routes need per-step integration. */
  step(dt: number): void {
    if (this.reducedMotion) return;
    this.clock += dt;
    const now = this.clock;
    for (const actor of this.actors.values()) {
      const a = actor.ambient;
      if (!a || a.def.motion === "stand" || now < a.dwellUntil) continue;
      const before = a.distance / a.length;
      a.distance += (a.def.speed * a.dir * dt) / 1000;
      if (a.def.motion === "wrap") {
        if (a.distance >= a.length) {
          a.distance -= a.length;
          a.lastStop = -1;
        }
      } else if (a.distance >= a.length || a.distance <= 0) {
        a.distance = Math.max(0, Math.min(a.length, a.distance));
        a.dir = a.dir === 1 ? -1 : 1;
        a.lastStop = -1;
      }
      const after = a.distance / a.length;
      const stops = a.def.stops;
      if (stops)
        stops.at.forEach((t, index) => {
          const crossed = a.dir === 1 ? before < t && after >= t : before > t && after <= t;
          if (crossed && a.lastStop !== index) {
            a.lastStop = index;
            a.dwellUntil = now + stops.dwellMs;
          }
        });
    }
  }

  pose(actor: ActorState): ActorPose {
    const t = this.clock - actor.born;
    const loopMs = (actor.frames / actor.fps) * 1000;
    const frame =
      actor.frames > 1
        ? Math.floor((((t / 1000 + actor.phase) * actor.fps) % actor.frames + actor.frames) % actor.frames)
        : 0;
    if (actor.ambient) {
      const a = actor.ambient;
      const at = pointAlong(a.def.path, a.length ? a.distance / a.length : 0);
      const p = project(at.x, at.y);
      const screenDx = (at.dx - at.dy) * a.dir;
      const lift = a.def.lift ?? 0;
      const idle = a.def.motion === "stand" || this.clock < a.dwellUntil;
      const bob = actor.behaviour === "walk" && !idle ? Math.abs(Math.sin((t / loopMs) * Math.PI * 2)) * 1.5 : 0;
      return {
        sx: p.sx,
        sy: p.sy - lift - bob,
        frame: idle && actor.behaviour === "walk" ? 0 : frame,
        flip: actor.faces && screenDx < -0.001,
        depth: p.sy + actor.depthBias,
      };
    }
    let sx = actor.base.sx,
      sy = actor.base.sy,
      flip = false;
    if (actor.pace) {
      const legMs = actor.pace.legs * loopMs;
      const u = ((t / legMs) % 2 + 2) % 2;
      const k = u < 1 ? u : 2 - u;
      sx += actor.pace.dx * k;
      sy += actor.pace.dy * k;
      flip = u >= 1;
    }
    if (actor.bob) sy -= actor.bob * (0.5 + 0.5 * Math.sin((t / (loopMs / 2)) * Math.PI * 2));
    return { sx, sy, frame, flip, depth: sy + actor.depthBias };
  }

  /** Attach sprites to actors near the view and detach the rest. */
  sync(view: Rect): void {
    const padded = { x: view.x - 200, y: view.y - 260, width: view.width + 400, height: view.height + 460 };
    for (const actor of this.actors.values()) {
      const reach = actor.ambient ? 0 : Math.abs(actor.pace?.dx ?? 0) + 8;
      const near = actor.ambient
        ? (() => {
            const pose = this.pose(actor);
            actor.sx = pose.sx;
            actor.sy = pose.sy;
            return padded.x <= pose.sx && pose.sx <= padded.x + padded.width && padded.y <= pose.sy && pose.sy <= padded.y + padded.height;
          })()
        : overlaps(padded, {
            x: actor.base.sx - reach - actor.targetW,
            y: actor.base.sy - 120,
            width: (reach + actor.targetW) * 2,
            height: 140,
          });
      if (!near) {
        if (actor.sprite) {
          this.pool.release(actor.sprite);
          actor.sprite = undefined;
        }
        continue;
      }
      if (!actor.sprite) {
        if (!this.assets.ready(actor.anim)) continue;
        actor.sprite = this.pool.acquire();
        actor.sprite.setTexture(actor.anim, 0);
        if (actor.tint !== undefined) actor.sprite.setTint(actor.tint);
        else actor.sprite.clearTint();
        actor.sprite.setScale(actor.targetW / actor.cellW);
        actor.sprite.setData("actor", actor.id);
      } else if (actor.sprite.texture.key !== actor.anim) {
        if (!this.assets.ready(actor.anim)) continue;
        actor.sprite.setTexture(actor.anim, 0);
        actor.sprite.setScale(actor.targetW / actor.cellW);
      }
      this.apply(actor);
    }
  }

  private apply(actor: ActorState): void {
    const pose = this.pose(actor);
    actor.sx = pose.sx;
    actor.sy = pose.sy;
    const s = actor.sprite!;
    s.setPosition(pose.sx, pose.sy);
    s.setDepth(pose.depth);
    s.setFlipX(pose.flip);
    if (actor.frames > 1 && s.frame.name !== String(pose.frame)) s.setFrame(pose.frame);
  }

  /** Per-frame: move only the actors that currently have a sprite. */
  update(): void {
    for (const actor of this.actors.values()) if (actor.sprite) this.apply(actor);
  }

  /** The actor a visitor follows on a lot: its drone if it has one, else its first walker. */
  primaryActor(repo: string): string | undefined {
    const ids = this.byLot.get(repo) ?? [];
    const actors = ids.map((id) => this.actors.get(id)!).filter(Boolean);
    return (
      actors.find((a) => a.behaviour === "fly")?.id ??
      actors.find((a) => a.behaviour === "walk")?.id ??
      actors.find((a) => a.behaviour === "carry")?.id ??
      actors[0]?.id
    );
  }

  position(id: string): { sx: number; sy: number } | undefined {
    const actor = this.actors.get(id);
    if (!actor) return undefined;
    const pose = this.pose(actor);
    return { sx: pose.sx, sy: pose.sy };
  }

  describe(id: string): { anim: string; behaviour: ActorBehaviour; repo?: string } | undefined {
    const actor = this.actors.get(id);
    return actor ? { anim: actor.anim, behaviour: actor.behaviour, repo: actor.repo } : undefined;
  }

  /** Diagnostics for tests: timelines must survive detach/attach cycles. */
  timeline(id: string): number | undefined {
    const actor = this.actors.get(id);
    return actor ? this.clock - actor.born : undefined;
  }

  ambientSnapshot(): Array<{ id: string; sx: number; sy: number; drawn: boolean }> {
    const out = [];
    for (const actor of this.actors.values())
      if (actor.ambient) {
        const pose = this.pose(actor);
        out.push({ id: actor.id, sx: pose.sx, sy: pose.sy, drawn: Boolean(actor.sprite) });
      }
    return out;
  }

  destroy(): void {
    for (const actor of this.actors.values()) if (actor.sprite) this.pool.release(actor.sprite);
    this.actors.clear();
    this.byLot.clear();
    this.pool.destroy();
  }
}
