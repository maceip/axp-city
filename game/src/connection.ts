import type { CityMutation, CitySnapshot } from "../../src/live/protocol.js";
export class CityConnection {
  private stream?: EventSource;
  private offline = () => {
    this.stream?.close();
    this.status("Reconnecting…");
  };
  private online = () => this.connect();
  constructor(
    private snapshot: (value: CitySnapshot) => void,
    private mutation: (value: CityMutation) => void,
    private status: (value: string) => void,
  ) {}
  async initial(): Promise<CitySnapshot> {
    const response = await fetch("/api/city", {
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok)
      throw new Error(`City server returned ${response.status}`);
    const value = (await response.json()) as CitySnapshot;
    if (value.version !== 1 || !Array.isArray(value.plan?.placements))
      throw new Error("Unsupported city data");
    return value;
  }
  connect(): void {
    this.close();
    window.addEventListener("offline", this.offline);
    window.addEventListener("online", this.online);
    if (!navigator.onLine) {
      this.status("Reconnecting…");
      return;
    }
    const stream = (this.stream = new EventSource("/api/city/stream"));
    stream.addEventListener("snapshot", (event) => {
      try {
        this.snapshot(JSON.parse((event as MessageEvent).data));
        this.status("Connected");
      } catch {
        this.status("City data unavailable");
      }
    });
    for (const type of ["lot_added", "lot_updated"])
      stream.addEventListener(type, (event) => {
        try {
          this.mutation(JSON.parse((event as MessageEvent).data));
        } catch {
          this.status("Resynchronizing");
          this.connect();
        }
      });
    stream.onerror = () => this.status("Reconnecting…");
  }
  close(): void {
    this.stream?.close();
    window.removeEventListener("offline", this.offline);
    window.removeEventListener("online", this.online);
  }
}
