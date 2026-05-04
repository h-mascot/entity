const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname);
const CHROME_PATH = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const REQUIRED_ACTUAL = [
  '01-files.png',
  '02-agents.png',
  '03-tasks.png',
  '04-services.png',
  '05-chat.png',
  '06-admin.png',
  '07-docs-view.png',
  '08-agent-detail.png',
  '09-task-detail.png',
];
const REQUIRED_GENERATED = [
  'set-1/01-files.png',
  'set-1/02-agents.png',
  'set-1/03-tasks.png',
  'set-1/04-services.png',
  'set-1/05-chat.png',
  'set-1/06-admin.png',
  'set-1/07-docs-view.png',
  'set-1/08-agent-detail.png',
  'set-1/09-task-detail.png',
  'set-2/01-files.png',
  'set-2/02-agents.png',
  'set-2/03-tasks.png',
  'set-2/04-services.png',
  'set-2/05-chat.png',
  'set-2/06-admin.png',
  'set-2/07-docs-view.png',
  'set-2/08-agent-detail.png',
  'set-2/09-task-detail.png',
];

function parseArgs() {
  const rawArgs = process.argv.slice(2);
  const args = new Set(rawArgs);
  const fileIndex = rawArgs.indexOf('--file');
  return {
    includeGenerated: args.has('--include-generated'),
    file: fileIndex >= 0 ? rawArgs[fileIndex + 1] : null,
  };
}

function expectedFiles(includeGenerated) {
  const actual = REQUIRED_ACTUAL.map((file) => path.join(ROOT, 'actual', file));
  if (!includeGenerated) return actual;
  return actual.concat(REQUIRED_GENERATED.map((file) => path.join(ROOT, file)));
}

async function inspectPng(page, imagePath) {
  const imageUrl = `data:image/png;base64,${fs.readFileSync(imagePath).toString('base64')}`;
  return page.evaluate(async (src) => {
    const img = new Image();
    img.decoding = 'sync';
    img.src = src;
    await img.decode();

    const width = img.naturalWidth;
    const height = img.naturalHeight;
    const canvas = document.createElement('canvas');
    const sampleWidth = Math.min(width, 320);
    const sampleHeight = Math.min(height, 220);
    canvas.width = sampleWidth;
    canvas.height = sampleHeight;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('Could not create canvas context.');
    ctx.drawImage(img, 0, 0, sampleWidth, sampleHeight);
    const data = ctx.getImageData(0, 0, sampleWidth, sampleHeight).data;
    let min = 255;
    let max = 0;
    let nonTransparent = 0;
    const colors = new Set();
    for (let index = 0; index < data.length; index += 16) {
      const r = data[index];
      const g = data[index + 1];
      const b = data[index + 2];
      const a = data[index + 3];
      if (a > 5) nonTransparent += 1;
      const lum = Math.round((r + g + b) / 3);
      min = Math.min(min, lum);
      max = Math.max(max, lum);
      colors.add(`${r >> 4},${g >> 4},${b >> 4},${a >> 6}`);
    }

    return {
      width,
      height,
      luminanceRange: max - min,
      colorBuckets: colors.size,
      nonTransparent,
    };
  }, imageUrl);
}

(async () => {
  const { includeGenerated, file } = parseArgs();
  const files = file ? [path.join(ROOT, file)] : expectedFiles(includeGenerated);
  const browser = await chromium.launch({
    headless: true,
    executablePath: fs.existsSync(CHROME_PATH) ? CHROME_PATH : undefined,
  });
  const page = await browser.newPage();
  const results = [];
  const failures = [];

  try {
    for (const file of files) {
      const relative = path.relative(ROOT, file);
      if (!fs.existsSync(file)) {
        failures.push(`${relative}: missing`);
        continue;
      }
      const size = fs.statSync(file).size;
      if (size <= 0) {
        failures.push(`${relative}: empty`);
        continue;
      }
      try {
        const metrics = await inspectPng(page, file);
        const okDimensions = metrics.width >= 900 && metrics.height >= 600;
        const okVisual = metrics.luminanceRange >= 12 && metrics.colorBuckets >= 8 && metrics.nonTransparent > 1000;
        results.push({ file: relative, size, ...metrics, okDimensions, okVisual });
        if (!okDimensions) {
          failures.push(`${relative}: dimensions too small (${metrics.width}x${metrics.height})`);
        }
        if (!okVisual) {
          failures.push(`${relative}: visually blank or too uniform`);
        }
      } catch (error) {
        failures.push(`${relative}: decode failed (${error instanceof Error ? error.message : String(error)})`);
      }
    }
  } finally {
    await browser.close();
  }

  const outputPath = path.join(ROOT, 'metadata', includeGenerated ? 'visual-validation-all.json' : 'visual-validation-actual.json');
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify({ includeGenerated, results, failures }, null, 2));

  if (failures.length > 0) {
    console.error(failures.join('\n'));
    process.exit(1);
  }

  console.log(`Validated ${results.length} PNG artifact(s).`);
})();
