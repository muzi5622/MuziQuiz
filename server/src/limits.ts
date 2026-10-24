// A fixed-window IP/global limit with bounded storage, shared across transports.
export class WindowLimit {
  private entries = new Map<string, { count: number; until: number }>();
  private global = { count: 0, until: 0 };
  constructor(private perKey: number, private total: number, private windowMs = 60_000) {}
  take(key: string, now = Date.now()) {
    if (this.global.until <= now) {
      this.global = { count: 0, until: now + this.windowMs };
      this.entries.clear();
    }
    const value = this.entries.get(key) ?? { count: 0, until: this.global.until };
    if (value.count >= this.perKey || this.global.count >= this.total) return false;
    value.count++; this.global.count++; this.entries.set(key, value);
    return true;
  }
}
