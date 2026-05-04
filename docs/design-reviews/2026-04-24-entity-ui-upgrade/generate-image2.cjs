const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname);
const ACTUAL_DIR = path.join(ROOT, 'actual');
const PROMPTS_DIR = path.join(ROOT, 'prompts');
const METADATA_DIR = path.join(ROOT, 'metadata');
const API_URL = 'https://api.openai.com/v1/images/edits';
const MODEL = 'gpt-image-2';
const SIZE = process.env.ENTITY_IMAGE2_SIZE || '1536x1024';
const QUALITY = process.env.ENTITY_IMAGE2_QUALITY || 'medium';

const VIEWS = [
  { id: '01-files', name: 'Files', actual: '01-files.png', role: 'browse, open, preview, edit, share, deep-link, and search documents/files' },
  { id: '02-agents', name: 'Agents', actual: '02-agents.png', role: 'monitor agent state, registry, activity, focus, health, queue, and work output' },
  { id: '03-tasks', name: 'Tasks', actual: '03-tasks.png', role: 'kanban and operational execution across backlog, todo, doing, review, and done' },
  { id: '04-services', name: 'Services', actual: '04-services.png', role: 'operational service registry, plugin status, runtime links, and health checks' },
  { id: '05-chat', name: 'Chat', actual: '05-chat.png', role: 'workspace chat with local/cloud/offline context and agent collaboration' },
  { id: '06-admin', name: 'Admin', actual: '06-admin.png', role: 'configuration, login state, themes, mission control, integrations, plugins, and OpenClaw admin' },
  { id: '07-docs-view', name: 'Docs View', actual: '07-docs-view.png', role: 'readable markdown docs with audio, share, breadcrumbs, and navigation back to Entity' },
  { id: '08-agent-detail', name: 'Agent Detail View', actual: '08-agent-detail.png', role: 'single-agent focus view showing status, activity, output, health, and task queue' },
  { id: '09-task-detail', name: 'Task Detail View', actual: '09-task-detail.png', role: 'task drill-down with status, assignee, priority, projects, output links, activity, logs, comments, and controls' },
];

const SETS = {
  'set-1': {
    label: 'Polished Evolution',
    direction:
      'Preserve the current Entity shell and workflows. Improve hierarchy, spacing, legibility, density, action grouping, icon clarity, and scan speed without changing the mental model. Keep a restrained dark operational console, not a marketing page.',
  },
  'set-2': {
    label: 'Alternate IA Direction',
    direction:
      'Explore a stronger information architecture with clearer left navigation, a more structured command/context bar, and sharper separation between overview, work area, and audit/detail zones. Keep the same operational density and professional console feel.',
  },
};

function usage() {
  console.error('Usage: node generate-image2.cjs --view 01-files --set set-1');
  console.error('       node generate-image2.cjs --all');
  process.exit(2);
}

function parseArgs() {
  const args = process.argv.slice(2);
  const result = { all: false, view: null, set: null, force: false };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--all') result.all = true;
    else if (arg === '--force') result.force = true;
    else if (arg === '--view') result.view = args[++index];
    else if (arg === '--set') result.set = args[++index];
    else usage();
  }
  if (!result.all && (!result.view || !result.set)) usage();
  return result;
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function compactList(items, limit) {
  if (!Array.isArray(items)) return '';
  return items.filter(Boolean).slice(0, limit).join(', ');
}

function buildPrompt(view, setKey) {
  const set = SETS[setKey];
  const meta = readJson(path.join(METADATA_DIR, `${view.id}.json`));
  const currentText = meta?.text ? String(meta.text).slice(0, 1600) : '';
  const headings = compactList(meta?.headings, 18);
  const controls = compactList(meta?.controls, 36);
  const prompt = [
    `Edit the provided Entity ${view.name} screenshot into a high-fidelity desktop UI redesign concept.`,
    `Design set: ${set.label}.`,
    `Direction: ${set.direction}`,
    `Product context: Entity is a local operational workspace and execution surface for files, agents, tasks, services, chat, admin, agent-native editing, activity, notifications, and plugins.`,
    `This view's job: ${view.role}.`,
    'Visual constraints: keep the first viewport as an actual usable app screen, dense but organized, dark mode, restrained color, strong contrast, no landing page, no hero section, no decorative gradient orbs, no nested cards, no oversized marketing typography, no beige/purple-dominant one-note palette.',
    'UX constraints: make the page easier to scan, group related controls, clarify primary actions, preserve workflows visible in the screenshot, and only add controls that fit this view context. Prefer fewer duplicated controls and clearer state indicators over more decoration.',
    'Rendering constraints: produce one realistic desktop application screenshot, 1536x1024 landscape, crisp text-like UI labels, consistent grid alignment, professional SaaS/ops console polish.',
    headings ? `Current headings: ${headings}` : '',
    controls ? `Current visible controls: ${controls}` : '',
    currentText ? `Current screen content summary: ${currentText}` : '',
  ].filter(Boolean).join('\n\n');
  fs.mkdirSync(PROMPTS_DIR, { recursive: true });
  fs.writeFileSync(path.join(PROMPTS_DIR, `${setKey}-${view.id}.txt`), prompt);
  return prompt;
}

async function createBlob(filePath) {
  const bytes = fs.readFileSync(filePath);
  return new Blob([bytes], { type: 'image/png' });
}

async function generateOne(view, setKey, options = {}) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is not set.');
  }
  if (!SETS[setKey]) {
    throw new Error(`Unknown set: ${setKey}`);
  }
  const actualPath = path.join(ACTUAL_DIR, view.actual);
  if (!fs.existsSync(actualPath)) {
    throw new Error(`Missing actual screenshot: ${actualPath}`);
  }

  const prompt = buildPrompt(view, setKey);
  const outDir = path.join(ROOT, setKey);
  fs.mkdirSync(outDir, { recursive: true });
  const outputPath = path.join(outDir, `${view.id}.png`);
  if (!options.force && fs.existsSync(outputPath) && fs.statSync(outputPath).size > 0) {
    console.log(`${setKey}/${view.id} already exists, skipping`);
    return;
  }

  const form = new FormData();
  form.append('model', MODEL);
  form.append('image[]', await createBlob(actualPath), view.actual);
  form.append('prompt', prompt);
  form.append('size', SIZE);
  form.append('quality', QUALITY);
  form.append('output_format', 'png');

  const startedAt = new Date().toISOString();
  const response = await fetch(API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    body: form,
  });
  const requestId = response.headers.get('x-request-id');
  const text = await response.text();
  let payload = null;
  try {
    payload = JSON.parse(text);
  } catch {
    payload = { raw: text.slice(0, 2000) };
  }

  const metadata = {
    model: MODEL,
    endpoint: API_URL,
    set: setKey,
    view: view.id,
    viewName: view.name,
    size: SIZE,
    quality: QUALITY,
    startedAt,
    completedAt: new Date().toISOString(),
    status: response.status,
    ok: response.ok,
    requestId,
  };

  fs.mkdirSync(METADATA_DIR, { recursive: true });
  const metadataPath = path.join(METADATA_DIR, `${setKey}-${view.id}-image2.json`);

  if (!response.ok) {
    fs.writeFileSync(metadataPath, JSON.stringify({ ...metadata, error: payload }, null, 2));
    const message = payload?.error?.message || `Image API request failed with status ${response.status}`;
    throw new Error(`${MODEL} rejected or failed for ${setKey}/${view.id}: ${message}`);
  }

  const imageBase64 = payload?.data?.[0]?.b64_json;
  if (!imageBase64) {
    fs.writeFileSync(metadataPath, JSON.stringify({ ...metadata, error: payload }, null, 2));
    throw new Error(`Image API response for ${setKey}/${view.id} did not include data[0].b64_json.`);
  }

  fs.writeFileSync(outputPath, Buffer.from(imageBase64, 'base64'));
  fs.writeFileSync(metadataPath, JSON.stringify({ ...metadata, outputPath: path.relative(ROOT, outputPath) }, null, 2));
  console.log(`${setKey}/${view.id} -> ${outputPath}`);
}

(async () => {
  const args = parseArgs();
  const jobs = args.all
    ? Object.keys(SETS).flatMap((setKey) => VIEWS.map((view) => ({ view, setKey })))
    : [{ view: VIEWS.find((view) => view.id === args.view), setKey: args.set }];

  for (const job of jobs) {
    if (!job.view) {
      throw new Error(`Unknown view: ${args.view}`);
    }
    await generateOne(job.view, job.setKey, { force: args.force });
  }
})().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
