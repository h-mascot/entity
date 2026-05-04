import type {
  SwarmProvider,
  BuildJobPayload,
  DispatchResult,
  RunStatus,
  ProofBundle,
  ProviderHealth,
} from './interface';

export class CcpProvider implements SwarmProvider {
  readonly name = 'ccp';
  readonly label = 'CCP (delivery control plane)';
  readonly meta = {
    category: 'delivery-control-plane' as const,
    executionMode: 'hybrid' as const,
    acceptsDispatch: false,
    description: 'Ticket-to-PR-to-CI delivery control plane adapter.',
    capabilities: ['ticket-router', 'ci-remediation', 'delivery-loop'],
  };

  async healthCheck(): Promise<ProviderHealth> {
    return {
      available: false,
      message: 'CCP (delivery control plane) adapter not configured yet — registry slot is ready for implementation.',
    };
  }

  async dispatch(job: BuildJobPayload): Promise<DispatchResult> {
    throw new Error('CCP (delivery control plane) dispatch is not implemented yet for job ' + job.jobId);
  }

  async status(_runHandle: string): Promise<RunStatus> {
    return { state: 'queued', progress: 'CCP (delivery control plane) adapter pending implementation' };
  }

  async cancel(_runHandle: string): Promise<void> {
    return;
  }

  async collectProof(_runHandle: string): Promise<ProofBundle> {
    return { buildLog: 'CCP (delivery control plane) proof collection pending implementation' };
  }
}
