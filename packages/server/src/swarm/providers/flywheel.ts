import type {
  SwarmProvider,
  BuildJobPayload,
  DispatchResult,
  RunStatus,
  ProofBundle,
  ProviderHealth,
} from './interface';

export class FlywheelProvider implements SwarmProvider {
  readonly name = 'flywheel';
  readonly label = 'Flywheel (agent environment)';
  readonly meta = {
    category: 'environment' as const,
    executionMode: 'push' as const,
    acceptsDispatch: false,
    description: 'Agent workstation and environment bootstrap adapter.',
    capabilities: ['workstation', 'parallel-agents', 'operator-ergonomics'],
  };

  async healthCheck(): Promise<ProviderHealth> {
    return {
      available: false,
      message: 'Flywheel (agent environment) adapter not configured yet — registry slot is ready for implementation.',
    };
  }

  async dispatch(job: BuildJobPayload): Promise<DispatchResult> {
    throw new Error('Flywheel (agent environment) dispatch is not implemented yet for job ' + job.jobId);
  }

  async status(_runHandle: string): Promise<RunStatus> {
    return { state: 'queued', progress: 'Flywheel (agent environment) adapter pending implementation' };
  }

  async cancel(_runHandle: string): Promise<void> {
    return;
  }

  async collectProof(_runHandle: string): Promise<ProofBundle> {
    return { buildLog: 'Flywheel (agent environment) proof collection pending implementation' };
  }
}
