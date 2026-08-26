export function isMissingPathError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  if (code === 'ENOENT') {
    return true;
  }

  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  const normalized = message.trim().toLowerCase();
  return (
    normalized.includes('enoent') ||
    normalized.includes('no such file') ||
    normalized.includes('does not exist') ||
    normalized.includes('not found') ||
    /(?:^|\D)404(?:\D|$)/.test(normalized)
  );
}

export class SourceTextUnsupportedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SourceTextUnsupportedError';
  }
}

export const CONNECTOR_NOT_IMPLEMENTED = 'CONNECTOR_NOT_IMPLEMENTED';

/**
 * Thrown by placeholder adapters (github/s3/custom) whose connector has no
 * implementation in this build. Routes must map this to a typed 501 response
 * instead of a generic 500 so clients can show truthful unavailability.
 */
export class ConnectorNotImplementedError extends Error {
  readonly code: string = CONNECTOR_NOT_IMPLEMENTED;
  readonly connectorType: string;

  constructor(connectorType: string, message?: string) {
    super(
      message ??
        `${connectorType} sources are not implemented in this build. Configuration is saved, but file operations and connectivity checks stay unavailable until the ${connectorType} adapter ships.`
    );
    this.name = 'ConnectorNotImplementedError';
    this.connectorType = connectorType;
  }
}
