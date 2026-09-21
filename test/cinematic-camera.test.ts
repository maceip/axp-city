import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PerspectiveCamera, Vector3 } from "three";
import {
  BASE_FOV,
  CinematicCamera,
  sampleFlight,
  type CameraPose,
  type GlobePov,
} from "../game/src/atlas/CinematicCamera.js";

const RADIUS = 100;
function position(pov: GlobePov): Vector3 {
  const lat = (pov.lat * Math.PI) / 180;
  const lng = (pov.lng * Math.PI) / 180;
  return new Vector3(
    Math.cos(lat) * Math.sin(lng),
    Math.sin(lat),
    Math.cos(lat) * Math.cos(lng),
  ).multiplyScalar(RADIUS * (1 + pov.altitude));
}
function cameraAt(pov: GlobePov): PerspectiveCamera {
  const camera = new PerspectiveCamera(BASE_FOV, 1.6, 0.1, 10000);
  camera.position.copy(position(pov));
  camera.lookAt(0, 0, 0);
  return camera;
}
function captured(camera: PerspectiveCamera): CameraPose {
  return {
    position: camera.position.clone(),
    quaternion: camera.quaternion.clone(),
    fov: camera.fov,
  };
}
function expectPose(camera: PerspectiveCamera, pose: CameraPose): void {
  expect(
    camera.position.distanceTo(
      new Vector3(pose.position.x, pose.position.y, pose.position.z),
    ),
  ).toBeLessThan(1e-8);
  const dot = Math.abs(
    camera.quaternion.x * pose.quaternion.x +
      camera.quaternion.y * pose.quaternion.y +
      camera.quaternion.z * pose.quaternion.z +
      camera.quaternion.w * pose.quaternion.w,
  );
  expect(dot).toBeCloseTo(1, 10);
  expect(camera.fov).toBeCloseTo(pose.fov, 10);
}

describe("cinematic globe trajectory", () => {
  it("starts at the captured camera and ends at the requested geographic view", () => {
    const camera = cameraAt({ lat: 20, lng: -20, altitude: 2.25 });
    camera.rotateX(0.18);
    camera.rotateZ(-0.12);
    camera.fov = 62;
    const from = captured(camera);
    const to = { lat: -31, lng: 130, altitude: 0.18 };
    const start = sampleFlight(from, to, 0, "dive", RADIUS);
    expect(start.position.toArray()).toEqual(camera.position.toArray());
    expect(start.quaternion.toArray()).toEqual(camera.quaternion.toArray());
    expect(start.fov).toBe(62);
    const end = sampleFlight(from, to, 1, "dive", RADIUS);
    expect(end.position.distanceTo(position(to))).toBeLessThan(1e-8);
    expect(end.quaternion.angleTo(cameraAt(to).quaternion)).toBeLessThan(1e-7);
    expect(end.fov).toBe(BASE_FOV);
    const forward = new Vector3(0, 0, -1).applyQuaternion(end.quaternion);
    expect(forward.dot(end.position.clone().normalize().negate())).toBeCloseTo(
      1,
      10,
    );
    expect(end.progress).toBe(1);
  });

  it.each([
    [
      { lat: 90, lng: 15, altitude: 0.15 },
      { lat: -90, lng: -130, altitude: 0.2 },
    ],
    [
      { lat: 0, lng: 0, altitude: 0.13 },
      { lat: 0, lng: 180, altitude: 0.18 },
    ],
    [
      { lat: 89.9999, lng: 179.999, altitude: 3 },
      { lat: -89.9999, lng: -179.999, altitude: 0.13 },
    ],
    [
      { lat: -21, lng: 58, altitude: 0.13 },
      { lat: -21, lng: 58, altitude: 0.13 },
    ],
  ])(
    "keeps poles, antipodes and coincident targets finite and outside the globe (%j → %j)",
    (origin, to) => {
      const from = captured(cameraAt(origin));
      for (const kind of ["descent", "dive", "return", "zoom"] as const) {
        for (let i = 0; i <= 100; i++) {
          const pose = sampleFlight(from, to, i / 100, kind, RADIUS);
          const values = [
            ...pose.position.toArray(),
            ...pose.quaternion.toArray(),
            ...pose.up.toArray(),
            pose.fov,
            pose.altitude,
            pose.pitch,
            pose.roll,
          ];
          expect(values.every(Number.isFinite)).toBe(true);
          expect(pose.position.length()).toBeGreaterThan(RADIUS);
          expect(pose.quaternion.length()).toBeCloseTo(1, 8);
          expect(pose.fov).toBeGreaterThan(1);
          expect(pose.fov).toBeLessThan(179);
        }
      }
    },
  );

  it("crosses the antimeridian by the short arc", () => {
    const from = captured(cameraAt({ lat: 12, lng: 179, altitude: 2 }));
    const to = { lat: 12, lng: -179, altitude: 0.3 };
    for (let i = 0; i <= 40; i++) {
      const pose = sampleFlight(from, to, i / 40, "descent", RADIUS);
      const longitude =
        (Math.atan2(pose.position.x, pose.position.z) * 180) / Math.PI;
      expect(Math.abs(longitude)).toBeGreaterThan(170);
    }
  });

  it("crosses an antipodal pole without an orientation flip", () => {
    const from = captured(cameraAt({ lat: 0, lng: 0, altitude: 2 }));
    const to = { lat: 0, lng: 180, altitude: 0.18 };
    let previous = sampleFlight(from, to, 0, "descent", RADIUS);
    for (let i = 1; i <= 400; i++) {
      const current = sampleFlight(from, to, i / 400, "descent", RADIUS);
      // A small time step must not produce a geographic-north 180° flip.
      expect(previous.quaternion.angleTo(current.quaternion)).toBeLessThan(0.1);
      previous = current;
    }
  });

  it("can retarget a midflight pose without moving or rotating its first frame", () => {
    const first = captured(cameraAt({ lat: 20, lng: -20, altitude: 2.25 }));
    const mid = sampleFlight(
      first,
      { lat: -25, lng: 70, altitude: 0.18 },
      0.43,
      "dive",
      RADIUS,
    );
    const retargeted = sampleFlight(
      mid,
      { lat: 60, lng: -90, altitude: 1 },
      0,
      "return",
      RADIUS,
    );
    expect(retargeted.position.toArray()).toEqual(mid.position.toArray());
    expect(retargeted.quaternion.toArray()).toEqual(mid.quaternion.toArray());
    expect(retargeted.fov).toBe(mid.fov);
  });
});

describe("cinematic flight lifecycle", () => {
  let now: number;
  let nextId: number;
  let frames: Map<number, (time: number) => void>;
  const target = { lat: -30, lng: 48, altitude: 0.18 };

  beforeEach(() => {
    now = 0;
    nextId = 0;
    frames = new Map();
    vi.spyOn(performance, "now").mockImplementation(() => now);
    vi.stubGlobal(
      "requestAnimationFrame",
      (callback: (time: number) => void) => {
        frames.set(++nextId, callback);
        return nextId;
      },
    );
    vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });
  function frame(time: number): void {
    now = time;
    const callbacks = [...frames.values()];
    frames.clear();
    for (const callback of callbacks) callback(time);
  }

  it("completes only when the final rendered pose arrives, exactly once", () => {
    const camera = cameraAt({ lat: 20, lng: -20, altitude: 2.25 });
    const onComplete = vi.fn(() => {
      expect(camera.position.distanceTo(position(target))).toBeLessThan(1e-8);
      expect(camera.fov).toBe(BASE_FOV);
    });
    const flight = new CinematicCamera(camera, RADIUS, () => {}, false);
    flight.flyTo(target, { kind: "dive", durationMs: 1600, onComplete });
    frame(1599);
    expect(flight.active).toBe(true);
    expect(onComplete).not.toHaveBeenCalled();
    frame(1600);
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(flight.active).toBe(false);
    expect(frames.size).toBe(0);
    frame(5000);
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it("cancels pending completion even if an already queued callback arrives late", () => {
    const camera = cameraAt({ lat: 20, lng: -20, altitude: 2.25 });
    const onComplete = vi.fn();
    const flight = new CinematicCamera(camera, RADIUS, () => {}, false);
    flight.flyTo(target, { kind: "dive", durationMs: 1600, onComplete });
    frame(400);
    const atCancel = camera.position.clone();
    const queued = [...frames.values()];
    flight.cancel();
    expect(flight.active).toBe(false);
    expect(camera.position.distanceTo(atCancel)).toBeLessThan(1e-8);
    for (const callback of queued) callback(5000);
    frame(5000);
    expect(onComplete).not.toHaveBeenCalled();
    expect(frames.size).toBe(0);
  });

  it("retargets the current camera continuously and completes only the new destination", () => {
    const camera = cameraAt({ lat: 20, lng: -20, altitude: 2.25 });
    const firstComplete = vi.fn(),
      secondComplete = vi.fn();
    const flight = new CinematicCamera(camera, RADIUS, () => {}, false);
    flight.flyTo(target, {
      kind: "dive",
      durationMs: 1600,
      onComplete: firstComplete,
    });
    frame(600);
    const previous = captured(camera);
    const next = { lat: 50, lng: -110, altitude: 1.3 };
    flight.flyTo(next, {
      kind: "return",
      durationMs: 900,
      onComplete: secondComplete,
    });
    expectPose(camera, previous);
    frame(600);
    expectPose(camera, previous);
    frame(1500);
    expect(camera.position.distanceTo(position(next))).toBeLessThan(1e-8);
    expect(firstComplete).not.toHaveBeenCalled();
    expect(secondComplete).toHaveBeenCalledTimes(1);
  });

  it("does not spend the remaining flight duration while its view is inactive", () => {
    const camera = cameraAt({ lat: 20, lng: -20, altitude: 2.25 });
    const onComplete = vi.fn();
    const flight = new CinematicCamera(camera, RADIUS, () => {}, false);
    flight.flyTo(target, { kind: "dive", durationMs: 1000, onComplete });
    frame(200);
    flight.setActive(false);
    const paused = captured(camera);
    frame(10000);
    expectPose(camera, paused);
    expect(flight.active).toBe(true);
    expect(onComplete).not.toHaveBeenCalled();
    flight.setActive(true);
    frame(10000);
    expectPose(camera, paused);
    frame(10799);
    expect(onComplete).not.toHaveBeenCalled();
    frame(10800);
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it("honors reduced motion without scheduling intermediate frames", () => {
    const camera = cameraAt({ lat: 20, lng: -20, altitude: 2.25 });
    const onComplete = vi.fn();
    const flight = new CinematicCamera(camera, RADIUS, () => {}, true);
    flight.flyTo(target, { kind: "dive", durationMs: 1600, onComplete });
    expect(camera.position.distanceTo(position(target))).toBeLessThan(1e-8);
    expect(flight.active).toBe(false);
    expect(frames.size).toBe(0);
    expect(onComplete).toHaveBeenCalledTimes(1);
    flight.destroy();
    frame(5000);
    expect(onComplete).toHaveBeenCalledTimes(1);
  });
});
