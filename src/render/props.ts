import { box, path, project } from "./iso.js";

function robot(x: number, y: number, hue: "white" | "olive"): string {
  const body = hue === "white" ? "#e8edf2" : "#6d7a55";
  const mid = hue === "white" ? "#c5ced6" : "#556244";
  const dark = hue === "white" ? "#9aa6b0" : "#3f4a32";
  const visor = hue === "white" ? "#5aa7d4" : "#c4d46a";
  return (
    box(x, y, 0, 0.28, 0.24, 6, { top: mid, left: mid, right: dark }) +
    box(x - 0.03, y + 0.02, 6, 0.34, 0.22, 11, { top: body, left: mid, right: dark }) +
    box(x + 0.04, y + 0.04, 17, 0.22, 0.18, 6, { top: body, left: mid, right: dark }) +
    box(x + 0.07, y + 0.07, 21, 0.16, 0.12, 1.8, {
      top: visor,
      left: visor,
      right: visor,
    }) +
    box(x + 0.28, y + 0.04, 10, 0.1, 0.1, 7, { top: mid, left: dark, right: dark }) +
    box(x - 0.08, y + 0.1, 10, 0.1, 0.1, 7, { top: mid, left: dark, right: dark })
  );
}

function table(x: number, y: number): string {
  const top = box(x, y, 9, 0.85, 0.58, 1.4, {
    top: "#3d6fa6",
    left: "#2f5780",
    right: "#244462",
  });
  const grid = path(
    [
      project(x + 0.08, y + 0.08, 10.4),
      project(x + 0.62, y + 0.08, 10.4),
      project(x + 0.62, y + 0.4, 10.4),
      project(x + 0.08, y + 0.4, 10.4),
    ],
    "#5b8ec4",
  );
  const legs =
    box(x + 0.04, y + 0.04, 0, 0.08, 0.08, 9, {
      top: "#8b9096",
      left: "#6d7278",
      right: "#555a60",
    }) +
    box(x + 0.58, y + 0.04, 0, 0.08, 0.08, 9, {
      top: "#8b9096",
      left: "#6d7278",
      right: "#555a60",
    }) +
    box(x + 0.04, y + 0.36, 0, 0.08, 0.08, 9, {
      top: "#8b9096",
      left: "#6d7278",
      right: "#555a60",
    }) +
    box(x + 0.58, y + 0.36, 0, 0.08, 0.08, 9, {
      top: "#8b9096",
      left: "#6d7278",
      right: "#555a60",
    });
  return legs + top + grid;
}

function blueprint(x: number, y: number, small = false): string {
  const w = small ? 0.42 : 0.62;
  const d = small ? 0.32 : 0.48;
  const sheet = path(
    [
      project(x, y, 0.8),
      project(x + w, y, 0.8),
      project(x + w, y + d, 0.8),
      project(x, y + d, 0.8),
    ],
    "#3d7ec4",
    "rgba(20,40,70,0.25)",
  );
  const inset = path(
    [
      project(x + w * 0.12, y + d * 0.15, 1.1),
      project(x + w * 0.88, y + d * 0.15, 1.1),
      project(x + w * 0.88, y + d * 0.85, 1.1),
      project(x + w * 0.12, y + d * 0.85, 1.1),
    ],
    "#5a9ad6",
  );
  return sheet + inset;
}

function brickStack(x: number, y: number): string {
  return (
    box(x, y, 0, 0.42, 0.32, 6, { top: "#c45b4a", left: "#a3493b", right: "#83392e" }) +
    box(x + 0.05, y + 0.04, 6, 0.32, 0.24, 5, {
      top: "#d46b58",
      left: "#b45342",
      right: "#8f4033",
    })
  );
}

function pallet(x: number, y: number): string {
  return (
    box(x, y, 0, 0.5, 0.34, 2.2, { top: "#c4a06a", left: "#a88452", right: "#8a6b42" }) +
    box(x + 0.04, y + 0.04, 2.2, 0.42, 0.26, 5, {
      top: "#d8b27a",
      left: "#b8945e",
      right: "#967848",
    })
  );
}

function pipes(x: number, y: number): string {
  return (
    box(x, y, 0, 0.55, 0.12, 4, { top: "#6d7580", left: "#555c66", right: "#434950" }) +
    box(x, y + 0.14, 0, 0.55, 0.12, 4, {
      top: "#7a828c",
      left: "#5d646e",
      right: "#484e56",
    }) +
    box(x, y + 0.28, 0, 0.55, 0.12, 4, {
      top: "#6d7580",
      left: "#555c66",
      right: "#434950",
    })
  );
}

function sandPile(x: number, y: number): string {
  return path(
    [
      project(x, y + 0.18, 0.4),
      project(x + 0.22, y, 0.4),
      project(x + 0.44, y + 0.18, 0.4),
      project(x + 0.22, y + 0.36, 0.4),
    ],
    "#e2c48a",
    "rgba(90,70,40,0.2)",
  ) +
    path(
      [
        project(x + 0.1, y + 0.16, 4),
        project(x + 0.22, y + 0.08, 4),
        project(x + 0.34, y + 0.16, 4),
        project(x + 0.22, y + 0.24, 4),
      ],
      "#edd7a4",
    );
}

function drone(x: number, y: number, z: number): string {
  const body = box(x, y, z, 0.4, 0.3, 5, {
    top: "#eef2f6",
    left: "#c5ced6",
    right: "#9aa6b0",
  });
  const eye = box(x + 0.14, y + 0.08, z + 5, 0.14, 0.14, 2, {
    top: "#5aa7d4",
    left: "#3d86b0",
    right: "#2f6a8c",
  });
  const arms =
    box(x - 0.22, y + 0.1, z + 3.5, 0.22, 0.08, 1.6, {
      top: "#c5ced6",
      left: "#9aa6b0",
      right: "#7a858e",
    }) +
    box(x + 0.4, y + 0.1, z + 3.5, 0.22, 0.08, 1.6, {
      top: "#c5ced6",
      left: "#9aa6b0",
      right: "#7a858e",
    });
  const rotors =
    box(x - 0.28, y + 0.04, z + 5.2, 0.22, 0.22, 1.1, {
      top: "#4a5158",
      left: "#3a4046",
      right: "#2c3136",
    }) +
    box(x + 0.46, y + 0.04, z + 5.2, 0.22, 0.22, 1.1, {
      top: "#4a5158",
      left: "#3a4046",
      right: "#2c3136",
    });
  return `<g class="drone">${body}${eye}${arms}${rotors}</g>`;
}

export interface YardFlags {
  showBlueprint: boolean;
  showDraftingTable: boolean;
  showMaterials: boolean;
  showCrew: boolean;
  showDrone: boolean;
}

export function renderYardProps(originX: number, originY: number, flags: YardFlags): string {
  const yx = originX + 2.2;
  const yy = originY + 0.2;
  let s = "";
  if (flags.showDraftingTable) {
    s += table(yx + 0.2, yy + 0.7);
  }
  if (flags.showBlueprint) {
    s += blueprint(yx + 0.95, yy + 0.12, flags.showMaterials);
  }
  if (flags.showMaterials) {
    s += brickStack(yx + 0.08, yy + 0.08);
    s += pallet(yx + 0.55, yy + 1.2);
    s += pipes(yx + 1.15, yy + 0.95);
    s += sandPile(yx + 1.25, yy + 0.12);
  }
  if (flags.showCrew) {
    s += robot(yx + 1.5, yy + 0.55, "white");
    s += robot(yx + 0.75, yy + 1.35, "olive");
  }
  if (flags.showDrone) {
    s += drone(yx + 1.25, yy - 0.2, 42);
  }
  return `<g class="yard-props">${s}</g>`;
}

export function tree(x: number, y: number, kind: "round" | "pine" = "round"): string {
  const trunk = box(x + 0.08, y + 0.08, 0, 0.1, 0.1, 8, {
    top: "#8a6a40",
    left: "#6e5533",
    right: "#544028",
  });
  if (kind === "pine") {
    return (
      trunk +
      box(x - 0.02, y - 0.02, 6, 0.3, 0.3, 6, {
        top: "#4f8a45",
        left: "#3f7038",
        right: "#325a2c",
      }) +
      box(x + 0.02, y + 0.02, 12, 0.22, 0.22, 6, {
        top: "#5a9a4e",
        left: "#467a3d",
        right: "#386230",
      })
    );
  }
  return (
    trunk +
    box(x - 0.06, y - 0.06, 7, 0.38, 0.38, 10, {
      top: "#6aaa55",
      left: "#548a44",
      right: "#416c36",
    })
  );
}

export function lamp(x: number, y: number): string {
  return (
    box(x + 0.06, y + 0.06, 0, 0.08, 0.08, 16, {
      top: "#6d737a",
      left: "#555b62",
      right: "#3f444a",
    }) +
    box(x + 0.02, y + 0.02, 16, 0.16, 0.16, 3, {
      top: "#f0e3a8",
      left: "#d4c47a",
      right: "#b8a85e",
    })
  );
}

export function bench(x: number, y: number): string {
  return (
    box(x, y, 4, 0.55, 0.16, 2, {
      top: "#8b5a32",
      left: "#6e4628",
      right: "#55361e",
    }) +
    box(x + 0.04, y + 0.02, 0, 0.08, 0.12, 4, {
      top: "#4a4e54",
      left: "#3a3e44",
      right: "#2c3036",
    }) +
    box(x + 0.42, y + 0.02, 0, 0.08, 0.12, 4, {
      top: "#4a4e54",
      left: "#3a3e44",
      right: "#2c3036",
    })
  );
}
