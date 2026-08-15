// Base class for ported design logic. The design runtime constructs a
// `Component extends DCLogic` where the SUBCLASS field initialiser
// (`state = {...}`) runs AFTER this base constructor returns — so this
// class must never assume `this.state` already exists, and every method
// here treats an undefined state as `{}`.
export abstract class DCLogic<S = any, P = any> {
  // Declared but intentionally NOT assigned here: assigning `state = {} as S`
  // in this base class would run before the subclass's own field
  // initialiser and then be clobbered by it in class-field declaration
  // order, which is harmless for `state` itself but this keeps the
  // contract explicit — read access always goes through the guarded getter
  // behaviour in `setState`, and callers should treat `state` as possibly
  // undefined only across the constructor boundary.
  state!: S;
  readonly props: P;

  private listeners = new Set<() => void>();
  // Re-entrancy guard: a listener that calls setState() again while we are
  // still notifying must not re-enter the notify loop (which would recurse
  // and could notify listeners out of order); instead the re-entrant call
  // is queued and drained by the in-flight notify loop.
  private notifying = false;
  private pendingNotify = false;

  constructor(props: P) {
    this.props = props;
  }

  setState(patch: Partial<S>): void {
    const current = this.state ?? ({} as S);
    this.state = { ...current, ...patch };
    this.notify();
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  private notify(): void {
    if (this.notifying) {
      // Already inside a notify pass (re-entrant setState from a listener):
      // mark that another pass is needed and let the in-flight loop below
      // pick it up once it finishes the current one.
      this.pendingNotify = true;
      return;
    }
    this.notifying = true;
    try {
      do {
        this.pendingNotify = false;
        for (const fn of this.listeners) {
          fn();
        }
      } while (this.pendingNotify);
    } finally {
      this.notifying = false;
    }
  }
}
