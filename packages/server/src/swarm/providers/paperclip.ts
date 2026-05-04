import type {
  SwarmProvider,
  BuildJobPayload,
  DispatchResult,
  RunStatus,
  ProofBundle,
  ProviderHealth,
} from './interface';

export class PaperclipProvider implements SwarmProvider {
  readonly name = 'paperclip';
  readonly label = 'Paperclip (business control plane)';
  readonly meta = {
    category: 'business-control-plane' as const,
    executionMode: 'hybrid' as const,
    acceptsDispatch: false,
    description: 'Business-level governance and autonomous org control plane adapter.',
    capabilities: ['budgets', 'governance', 'org-control'],
  };

  async healthCheck(): Promise<ProviderHealth> {
    return {
      available: false,
      message: 'Paperclip (business control plane) adapter not configured yet — registry slot is ready for implementation.',
    };
  }

  async dispatch(job: BuildJobPayload): Promise<DispatchResult> {
    throw new Error('Paperclip (business control plane) dispatch is not implemented yet for job ' + job.jobId);
  }

  async status(_runHandle: string): Promise<RunStatus> {
    return { state: 'queued', progress: 'Paperclip (business control plane) adapter pending implementation' };
  }

  async cancel(_runHandle: string): Promise<void> {
    return;
  }

  async collectProof(_runHandle: string): Promise<ProofBundle> {
    return { buildLog: 'Paperclip (business control plane) proof collection pending implementation' };
  }
}
