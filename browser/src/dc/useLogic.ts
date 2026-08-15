import { useRef, useSyncExternalStore } from 'react';
import type { DCLogic } from './DCLogic.js';

// Binds a DCLogic instance's state into React via useSyncExternalStore, so
// every setState() call the ported logic makes triggers a re-render with
// the new state snapshot.
export function useLogic<S, P>(instance: DCLogic<S, P>): S {
  return useSyncExternalStore(
    (onStoreChange) => instance.subscribe(onStoreChange),
    () => instance.state,
  );
}

// Lazily creates (and memoises across renders) a singleton DCLogic
// instance for a given Logic class + props, so the same instance survives
// re-renders of the component that owns it.
export function useLogicInstance<L extends DCLogic<any, any>, P>(
  Logic: new (props: P) => L,
  props: P,
): L {
  const ref = useRef<L | null>(null);
  if (ref.current === null) {
    ref.current = new Logic(props);
  }
  return ref.current;
}
