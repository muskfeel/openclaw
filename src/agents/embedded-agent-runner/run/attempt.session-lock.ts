export class EmbeddedAttemptSessionTakeoverError extends Error {
  constructor(sessionFile: string) {
    super(`Session transcript was modified during embedded attempt cleanup: ${sessionFile}`);
    this.name = "EmbeddedAttemptSessionTakeoverError";
  }
}
