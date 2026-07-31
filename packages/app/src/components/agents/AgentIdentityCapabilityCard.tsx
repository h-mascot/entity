import {
  buildAgentIdentityCapabilityCard,
  completenessLabel,
  presenceToneClass,
  type AgentIdentityCapabilityCard as CardModel,
  type IdentityCapabilityInviteSource,
  type IdentityCapabilityPresenceSource,
  type IdentityCapabilityRuntimeSource,
} from '../../lib/agentIdentityCapabilityCard';

export interface AgentIdentityCapabilityCardProps {
  invite?: IdentityCapabilityInviteSource | null;
  presence?: IdentityCapabilityPresenceSource | null;
  runtime?: IdentityCapabilityRuntimeSource | null;
  /** Optional prebuilt card; when omitted, built from invite/presence/runtime. */
  card?: CardModel | null;
  className?: string;
  title?: string;
}

function ChipList({
  labels,
  empty,
  testId,
}: {
  labels: string[];
  empty: string;
  testId: string;
}) {
  if (labels.length === 0) {
    return (
      <div className="text-xs text-[var(--text-muted)]" data-testid={testId}>
        {empty}
      </div>
    );
  }
  return (
    <div className="flex flex-wrap gap-1.5" data-testid={testId}>
      {labels.map((label) => (
        <span
          key={label}
          className="entity-ops-chip px-2 py-0.5 text-[11px] text-[var(--text-secondary)]"
        >
          {label}
        </span>
      ))}
    </div>
  );
}

/**
 * WP2-B-01 UI smoke card — identity, capabilities, runtime/model, heartbeat, current work.
 * Heartbeat stays explicit missing until WP2-B-02.
 */
export default function AgentIdentityCapabilityCard({
  invite = null,
  presence = null,
  runtime = null,
  card: cardProp = null,
  className = '',
  title = 'Identity / capability card',
}: AgentIdentityCapabilityCardProps) {
  const card = cardProp ?? buildAgentIdentityCapabilityCard({ invite, presence, runtime });

  return (
    <section
      className={`rounded border border-[var(--border-primary)] bg-[var(--bg-primary)]/40 px-3 py-3 ${className}`}
      data-testid="agent-identity-capability-card"
      data-card-completeness={card.cardCompleteness}
      data-presence-status={card.presenceStatus}
      data-invite-id={card.inviteId ?? ''}
      data-agent-id={card.agentId ?? ''}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="entity-ops-section-title">{title}</div>
          <div
            className="mt-1 text-sm font-semibold text-[var(--text-primary)]"
            data-testid="identity-card-agent-name"
          >
            {card.agentName}
          </div>
          <div className="mt-0.5 text-xs text-[var(--text-secondary)]" data-testid="identity-card-role">
            {card.identityLabel ?? `${card.role}`}
          </div>
        </div>
        <span
          className="entity-ops-chip px-2 py-1 text-[11px]"
          data-testid="identity-card-completeness"
        >
          {completenessLabel(card.cardCompleteness)}
        </span>
      </div>

      <dl className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
        <div>
          <dt className="text-[var(--text-muted)]">Invite</dt>
          <dd className="text-[var(--text-primary)]" data-testid="identity-card-invite-status">
            {card.inviteStatus ?? '—'}
            {card.inviteId ? (
              <span className="mt-0.5 block font-mono text-[11px] text-[var(--text-muted)]">
                {card.inviteId}
              </span>
            ) : null}
          </dd>
        </div>
        <div>
          <dt className="text-[var(--text-muted)]">Heartbeat</dt>
          <dd
            className={presenceToneClass(card.presenceStatus)}
            data-testid="identity-card-heartbeat"
          >
            {card.heartbeatFreshnessLabel}
          </dd>
        </div>
        <div>
          <dt className="text-[var(--text-muted)]">Runtime / model</dt>
          <dd className="text-[var(--text-primary)]" data-testid="identity-card-runtime">
            {card.runtimeLabel ?? 'Runtime unbound'}
            {card.modelLabel || card.providerProfileId ? (
              <span className="mt-0.5 block text-[var(--text-secondary)]">
                {card.modelLabel ?? 'model unbound'}
                {card.providerProfileId ? ` · ${card.providerProfileId}` : ''}
              </span>
            ) : (
              <span className="mt-0.5 block text-[var(--text-muted)]">Model unbound</span>
            )}
          </dd>
        </div>
        <div>
          <dt className="text-[var(--text-muted)]">Current work</dt>
          <dd className="text-[var(--text-primary)]" data-testid="identity-card-current-work">
            {card.currentWorkLabel}
          </dd>
        </div>
        <div>
          <dt className="text-[var(--text-muted)]">Owner</dt>
          <dd className="text-[var(--text-primary)]">{card.ownerLabel ?? 'Entity'}</dd>
        </div>
        <div>
          <dt className="text-[var(--text-muted)]">Verification</dt>
          <dd className="text-[var(--text-primary)]" data-testid="identity-card-verification">
            {card.verificationLabel ?? 'Verification pending'}
          </dd>
        </div>
      </dl>

      <div className="mt-3 space-y-2">
        <div>
          <div className="mb-1 text-[11px] uppercase tracking-wide text-[var(--text-muted)]">
            Capabilities
          </div>
          <ChipList
            labels={card.capabilityLabels}
            empty="No capabilities declared."
            testId="identity-card-capabilities"
          />
        </div>
        <div>
          <div className="mb-1 text-[11px] uppercase tracking-wide text-[var(--text-muted)]">
            Permissions
          </div>
          <ChipList
            labels={card.permissionLabels}
            empty="No permissions declared."
            testId="identity-card-permissions"
          />
        </div>
      </div>

      {card.degradedReasons.length > 0 && (
        <div
          className="mt-3 rounded border border-[var(--border-primary)] px-2 py-1.5 text-[11px] text-[var(--text-secondary)]"
          data-testid="identity-card-degraded"
          role="status"
        >
          Degraded: {card.degradedReasons.join(', ')}
        </div>
      )}
    </section>
  );
}
