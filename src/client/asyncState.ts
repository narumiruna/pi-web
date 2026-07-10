export function createSingleFlight<T>(): {
  run: (task: () => Promise<T>) => Promise<T>;
} {
  let pending: Promise<T> | undefined;
  return {
    run(task) {
      if (pending) return pending;
      let operation: Promise<T>;
      try {
        operation = task();
      } catch (error) {
        operation = Promise.reject(error);
      }
      const tracked = operation.finally(() => {
        if (pending === tracked) pending = undefined;
      });
      pending = tracked;
      return tracked;
    },
  };
}

export function createLatestRequestGate(): {
  next: () => number;
  invalidate: () => void;
  isCurrent: (token: number) => boolean;
} {
  let latest = 0;
  return {
    next: () => (latest += 1),
    invalidate: () => {
      latest += 1;
    },
    isCurrent: (token) => token === latest,
  };
}

export function isCurrentSelection(
  requestedId: string,
  selectedId?: string,
): boolean {
  return requestedId === selectedId;
}
