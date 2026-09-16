import {
  MUTATION_TYPES,
  SNAPSHOT_SCHEMA,
  type CityFreshness,
  type CityMutation,
  type CitySnapshot,
  type CityStatusEvent,
} from "../../src/live/protocol.js";

export type ConnectionState =
  | "connecting"
  | "connected"
  | "reconnecting"
  | "resynchronizing"
  | "unavailable"
  | "offline-package";

export interface ConnectionHandlers {
  snapshot(value: CitySnapshot): void;
  mutation(value: CityMutation): void;
  status(value: CityFreshness): void;
  connection(state: ConnectionState, detail?: string): void;
}

/** An offline package declares its saved city here; the client then never opens a stream. */
export function offlinePackageUrl(): string | null {
  const meta = document.querySelector<HTMLMetaElement>('meta[name="city-offline"]');
  return meta?.content || null;
}

export function validateSnapshot(value: unknown): CitySnapshot {
  const v = value as Partial<CitySnapshot> | null;
  if (!v || v.version !== 1 || !Array.isArray(v.plan?.placements))
    throw new Error("Unsupported city data");
  if (v.schema && v.schema.snapshot > SNAPSHOT_SCHEMA)
    throw new Error(`City schema ${v.schema.snapshot} is newer than this client (${SNAPSHOT_SCHEMA}). Reload to update.`);
  for (const p of v.plan!.placements)
    if (!p?.lot?.fullName || typeof p.x !== "number" || typeof p.y !== "number")
      throw new Error("City data contains an invalid lot");
  if (!v.plan!.features || !v.plan!.bounds || !v.plan!.slotBounds)
    throw new Error("City data is missing its plan geometry");
  if (!v.city) v.city = { name: "AXP City", kind: "standard" };
  if (!v.plan!.labels) v.plan!.labels = [];
  return v as CitySnapshot;
}

export class CityConnection {
  private stream?: EventSource;
  private retryTimer?: ReturnType<typeof setTimeout>;
  private attempts = 0;
  readonly offlinePackage = offlinePackageUrl();
  private offline = () => {
    this.stream?.close();
    this.stream = undefined;
    this.handlers.connection("reconnecting", "Browser is offline");
  };
  private online = () => this.connect();
  constructor(private readonly handlers: ConnectionHandlers) {}

  async initial(): Promise<CitySnapshot> {
    const url = this.offlinePackage ?? "/api/city";
    const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw new Error(`City server returned ${response.status}`);
    return validateSnapshot(await response.json());
  }

  connect(): void {
    this.close();
    if (this.offlinePackage) {
      this.handlers.connection("offline-package", "Saved city package");
      return;
    }
    window.addEventListener("offline", this.offline);
    window.addEventListener("online", this.online);
    if (!navigator.onLine) {
      this.handlers.connection("reconnecting", "Browser is offline");
      return;
    }
    this.handlers.connection(this.attempts ? "reconnecting" : "connecting");
    const stream = (this.stream = new EventSource("/api/city/stream"));
    stream.addEventListener("snapshot", (event) => {
      try {
        this.handlers.snapshot(validateSnapshot(JSON.parse((event as MessageEvent).data)));
        this.attempts = 0;
        this.handlers.connection("connected");
      } catch (error) {
        this.handlers.connection("unavailable", error instanceof Error ? error.message : "City data unavailable");
      }
    });
    for (const type of MUTATION_TYPES)
      stream.addEventListener(type, (event) => {
        try {
          this.handlers.mutation(JSON.parse((event as MessageEvent).data));
        } catch {
          this.resync();
        }
      });
    stream.addEventListener("status", (event) => {
      try {
        const status = JSON.parse((event as MessageEvent).data) as CityStatusEvent;
        this.handlers.status(status.freshness);
      } catch {
        // A malformed status event is not worth dropping the stream for.
      }
    });
    stream.onerror = () => {
      this.handlers.connection("reconnecting");
      // EventSource retries on its own; escalate to a full reconnect if it stays closed.
      if (stream.readyState === EventSource.CLOSED) this.scheduleReconnect();
    };
  }

  /** A gap in revisions: drop the stream and take a fresh snapshot. */
  resync(): void {
    this.handlers.connection("resynchronizing");
    this.attempts++;
    this.connect();
  }

  private scheduleReconnect(): void {
    clearTimeout(this.retryTimer);
    const delay = Math.min(30_000, 1000 * 2 ** Math.min(this.attempts++, 5));
    this.retryTimer = setTimeout(() => this.connect(), delay);
  }

  close(): void {
    clearTimeout(this.retryTimer);
    this.stream?.close();
    this.stream = undefined;
    window.removeEventListener("offline", this.offline);
    window.removeEventListener("online", this.online);
  }
}
