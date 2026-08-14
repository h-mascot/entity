export type ServiceRegistryState = 'refreshing' | 'ready' | 'error';

export interface ServiceRegistryStatus {
  label: string;
  message: string | null;
  tone: 'progress' | 'ready' | 'error';
}

export function getServiceRegistryStatus(
  state: ServiceRegistryState | undefined,
  partial: boolean | undefined,
  refreshError?: string,
): ServiceRegistryStatus {
  if (state === 'error') {
    return {
      label: 'Discovery failed',
      message: refreshError || 'The full services registry could not be refreshed.',
      tone: 'error',
    };
  }

  if (state === 'refreshing' || partial) {
    return {
      label: 'Discovery in progress',
      message: 'Showing the fast internal-service snapshot while full host discovery finishes.',
      tone: 'progress',
    };
  }

  return {
    label: 'Discovery complete',
    message: null,
    tone: 'ready',
  };
}
