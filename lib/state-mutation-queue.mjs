// Each task begins after the preceding task has settled. A rejected mutation
// never poisons the queue or causes later operations to be skipped.
export function createMutationQueue() {
  let tail = Promise.resolve();
  return function enqueue(task) {
    const run = tail.then(task);
    tail = run.then(() => undefined, () => undefined);
    return run;
  };
}
