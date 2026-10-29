type Status = { running: boolean };
type Dependencies = {
  takePending: () => Promise<boolean>;
  readStatus: () => Promise<Status | null>;
  setRunning: (running: boolean) => Promise<Status>;
};

/** The OS gesture owns the action, rather than a Dashboard component lifetime. */
export function createGatewayIntentDrain(dependencies: Dependencies) {
  let tail: Promise<unknown> = Promise.resolve();
  return () => {
    const operation = tail.then(async () => {
      if (!await dependencies.takePending()) return null;
      const current = await dependencies.readStatus();
      if (!current) throw new Error('Local gateway state is unavailable.');
      return dependencies.setRunning(!current.running);
    });
    // A failed gesture must not poison later gestures. An uncertain toggle is
    // never automatically replayed; the next gesture reads authoritative state.
    tail = operation.catch(() => undefined);
    return operation;
  };
}
