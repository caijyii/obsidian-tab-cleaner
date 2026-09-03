type Subscribe<S, R> = (source: S, callback: () => void) => R;
type Unsubscribe<S, R> = (source: S, ref: R) => void;

export class SourceEventRegistry<S, R> {
  private readonly refs = new Map<S, R>();
  private readonly subscribe: Subscribe<S, R>;
  private readonly unsubscribe: Unsubscribe<S, R>;

  constructor(subscribe: Subscribe<S, R>, unsubscribe: Unsubscribe<S, R>) {
    this.subscribe = subscribe;
    this.unsubscribe = unsubscribe;
  }

  sync(sources: Iterable<S>, callback: () => void): void {
    const current = new Set(sources);

    for (const [source, ref] of this.refs) {
      if (current.has(source)) continue;
      this.unsubscribe(source, ref);
      this.refs.delete(source);
    }

    for (const source of current) {
      if (this.refs.has(source)) continue;
      this.refs.set(source, this.subscribe(source, callback));
    }
  }

  clear(): void {
    for (const [source, ref] of this.refs) this.unsubscribe(source, ref);
    this.refs.clear();
  }
}
