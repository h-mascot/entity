// Coordinate mutations handled by this server process. A process-wide guard
// covers differently configured physical aliases without stale path lock keys.
let activeCreations = 0;
let moveActive = false;

export class FileMutationConflictError extends Error {
  constructor() {
    super('A file move conflicts with an active file mutation. Retry the request.');
  }
}

/** Creations may overlap; a move excludes all creations and other moves. */
export function acquireFileMutationGuard(operation: 'create' | 'move'): () => void {
  if (moveActive || (operation === 'move' && activeCreations > 0)) {
    throw new FileMutationConflictError();
  }
  if (operation === 'move') moveActive = true;
  else activeCreations += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (operation === 'move') moveActive = false;
    else activeCreations -= 1;
  };
}
