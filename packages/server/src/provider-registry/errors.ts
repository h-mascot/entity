import {
  PROVIDER_ERROR_MESSAGES,
  type ProviderErrorCode,
  type SafeProviderErrorDto,
} from './types';

export class ProviderRegistryError extends Error {
  readonly code: ProviderErrorCode;
  readonly requestId?: string;
  readonly httpStatus: number;

  constructor(
    code: ProviderErrorCode,
    options?: {
      message?: string;
      requestId?: string;
      httpStatus?: number;
      cause?: unknown;
    },
  ) {
    super(options?.message ?? PROVIDER_ERROR_MESSAGES[code]);
    this.name = 'ProviderRegistryError';
    this.code = code;
    this.requestId = options?.requestId;
    this.httpStatus = options?.httpStatus ?? defaultHttpStatus(code);
    if (options?.cause !== undefined) {
      (this as Error & { cause?: unknown }).cause = options.cause;
    }
  }

  toSafeDto(): SafeProviderErrorDto {
    return {
      code: this.code,
      message: this.message,
      ...(this.requestId ? { requestId: this.requestId } : {}),
    };
  }
}

function defaultHttpStatus(code: ProviderErrorCode): number {
  switch (code) {
    case 'PROVIDER_REQUEST_INVALID':
    case 'PROVIDER_CONFIGURATION_INVALID':
    case 'PROVIDER_MODEL_INVALID':
    case 'PROVIDER_SECRET_MISSING':
    case 'PROVIDER_ENDPOINT_BLOCKED':
    case 'PROVIDER_CAPABILITY_UNSUPPORTED':
      return 422;
    case 'PROVIDER_NAME_EXISTS':
    case 'PROVIDER_VERSION_CONFLICT':
    case 'PROVIDER_IN_USE':
      return 409;
    case 'PROVIDER_NOT_FOUND':
    case 'PROVIDER_MODEL_NOT_FOUND':
      return 404;
    case 'PROVIDER_HEALTH_TEST_RATE_LIMITED':
    case 'PROVIDER_RATE_LIMITED':
      return 429;
    default:
      return 500;
  }
}

export function toSafeProviderError(
  error: unknown,
  requestId?: string,
): SafeProviderErrorDto {
  if (error instanceof ProviderRegistryError) {
    const dto = error.toSafeDto();
    if (requestId && !dto.requestId) {
      return { ...dto, requestId };
    }
    return dto;
  }

  return {
    code: 'PROVIDER_UNKNOWN_ERROR',
    message: PROVIDER_ERROR_MESSAGES.PROVIDER_UNKNOWN_ERROR,
    ...(requestId ? { requestId } : {}),
  };
}

/** Strip credential-like substrings from free-form messages before persistence/logs. */
export function redactUnsafeMessage(raw: string): string {
  return raw
    .replace(/(Bearer\s+)[A-Za-z0-9._\-+=/]+/gi, '$1[REDACTED]')
    .replace(/(api[_-]?key\s*[:=]\s*)["']?[^"'\\\s]+["']?/gi, '$1[REDACTED]')
    .replace(/(sk-[A-Za-z0-9]{8,})/g, '[REDACTED]')
    .replace(/(AIza[A-Za-z0-9_\-]{10,})/g, '[REDACTED]')
    .replace(/(xai-[A-Za-z0-9]{8,})/g, '[REDACTED]');
}
