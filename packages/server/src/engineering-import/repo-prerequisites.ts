import { execFileSync } from 'child_process';
import type { PrerequisiteAssessment } from './dry-run';

interface Probe {
  sourceLine: number;
  state: PrerequisiteAssessment['state'];
  files: Array<{ path: string; markers: string[] }>;
  evidence: string;
}

const PROBES: Probe[] = [
  {
    sourceLine: 28,
    state: 'already_implemented',
    files: [
      {
        path: 'packages/server/src/routes/operational-status.ts',
        markers: ['AGENT FOCUS', 'AGENT_FOCUS_FILE_EXTENSIONS'],
      },
      {
        path: 'packages/app/src/App.tsx',
        markers: ['/api/agents/focus', 'Poll agent focus'],
      },
    ],
    evidence: 'Agent-focus endpoint and sidebar polling are present on origin/main',
  },
  {
    sourceLine: 31,
    state: 'already_implemented',
    files: [
      {
        path: 'packages/app/src/App.tsx',
        markers: ['splitMode', 'rightPaneFile', 'handleRightPaneFileSelect'],
      },
    ],
    evidence: 'Split-mode state, right-pane loading, and pane selection are present on origin/main',
  },
  {
    sourceLine: 34,
    state: 'already_implemented',
    files: [
      {
        path: 'packages/app/src/hooks/useWatchModeAutoFollow.ts',
        markers: ['useWatchModeAutoFollow', 'resolveLatestFileEdit'],
      },
      {
        path: 'packages/app/src/App.tsx',
        markers: ['useWatchModeAutoFollow', 'watchModeFollowEvent'],
      },
    ],
    evidence: 'Watch-mode auto-follow hook and app wiring are present on origin/main',
  },
  {
    sourceLine: 39,
    state: 'already_implemented',
    files: [
      {
        path: '.github/workflows/main.yml',
        markers: ['Deploy Handoff', 'gateway deployer will pull tracked branch'],
      },
      {
        path: 'scripts/entity-gateway-pull-deploy.mjs',
        markers: ['entity-gateway-pull-deploy', 'GITHUB_TOKEN'],
      },
    ],
    evidence: 'CI deploy handoff and on-network pull deployer are present on origin/main',
  },
  {
    sourceLine: 90,
    state: 'blocked',
    files: [
      {
        path: 'packages/server/package.json',
        markers: ['dist/server/src/index.js', '"build": "tsc"'],
      },
      {
        path: 'package.json',
        markers: ['npm --prefix packages/server run build'],
      },
    ],
    evidence:
      'Production entry/build wiring exists, but the mapping prerequisite requires a separately recorded successful current build',
  },
  {
    sourceLine: 92,
    state: 'ready',
    files: [
      {
        path: 'packages/app/src/components/ActivityStream.tsx',
        markers: ['groupActivities', 'ActivityGroup'],
      },
      {
        path: 'packages/app/scripts/visual-smoke.cjs',
        markers: ['playwright'],
      },
    ],
    evidence: 'Activity grouping exists and the repository has a stable Playwright visual-smoke fixture',
  },
  {
    sourceLine: 96,
    state: 'blocked',
    files: [
      {
        path: 'packages/server/src/routes/tasks.ts',
        markers: ['/:id/subtasks/auto', 'deriveSubtaskBreakdown'],
      },
      {
        path: 'packages/app/src/components/mission-control/TaskDetailPanel.tsx',
        markers: ['Auto-generate subtasks', 'autoGenerateSubtasks'],
      },
    ],
    evidence:
      'Auto-subtask API/UI exist, but the mapped Workplanes slice 1 prerequisite is not present on origin/main',
  },
];

function readFileAtRef(repoRoot: string, sourceRef: string, filePath: string): string | null {
  try {
    return execFileSync('git', ['show', `${sourceRef}:${filePath}`], {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    return null;
  }
}

function probeMatches(repoRoot: string, sourceRef: string, probe: Probe): boolean {
  return probe.files.every((file) => {
    const content = readFileAtRef(repoRoot, sourceRef, file.path);
    return content !== null && file.markers.every((marker) => content.includes(marker));
  });
}

export function assessRepositoryPrerequisites(
  repoRoot: string,
  options: { serverBuildPassed?: boolean; sourceRef?: string } = {},
): PrerequisiteAssessment[] {
  const sourceRef = options.sourceRef ?? 'origin/main';
  return PROBES.map((probe) => {
    const matched = probeMatches(repoRoot, sourceRef, probe);
    if (probe.sourceLine === 90 && matched && options.serverBuildPassed) {
      return {
        sourceLine: probe.sourceLine,
        state: 'already_implemented',
        evidence: [
          `${sourceRef} packages/server TypeScript build completed successfully during this dry run`,
          ...probe.files.map((file) => `${sourceRef}:${file.path}: ${file.markers.join(' + ')}`),
        ],
      };
    }
    return {
      sourceLine: probe.sourceLine,
      state: matched ? probe.state : 'unknown',
      evidence: matched
        ? [
            probe.evidence,
            ...probe.files.map((file) => `${sourceRef}:${file.path}: ${file.markers.join(' + ')}`),
          ]
        : [`Expected ${sourceRef} markers are absent for source line ${probe.sourceLine}`],
    };
  });
}
