const fs = require('fs');
const path = 'packages/app/src/components/mission-control/MCTaskCard.tsx';
let code = fs.readFileSync(path, 'utf8');

// Remove getLatestActivityText function
code = code.replace(/function getLatestActivityText[\s\S]*?\}\n\n/, '');

// Remove latestActivity computation
code = code.replace(/  const latestActivity = task\.activity\?\.\[0\] \?\? null;\n/, '');

// Remove workingAgentName computation
code = code.replace(/  const workingAgentName = latestActivity\?\.agent_name \|\| latestActivity\?\.user \|\| 'Entity';\n/, '');

// Remove the rendering block for working-status
code = code.replace(/      \{\!blockedReason && isWorking && latestActivity \? \([\s\S]*?      \) : null\}\n\n/, '');

// Also let's clean up the imports, specifically getLatestActivityText isn't an import, it's defined in the file.
// Check if we need to remove 'getTimeAgo' from imports
code = code.replace(/  getTimeAgo,\n/, '');

fs.writeFileSync(path, code);
console.log('Patched MCTaskCard.tsx');
