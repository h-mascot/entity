const fs = require('fs');
const path = 'packages/db/src/index.ts';
let code = fs.readFileSync(path, 'utf8');

if (!code.includes('ALTER TABLE tasks ADD COLUMN brief')) {
  code = code.replace(
    '  if (!hasColumn(db, \'tasks\', \'due_date\')) {',
    '  if (!hasColumn(db, \'tasks\', \'brief\')) {\n    db.exec(\'ALTER TABLE tasks ADD COLUMN brief TEXT\');\n  }\n\n  if (!hasColumn(db, \'tasks\', \'origin_channel\')) {\n    db.exec(\'ALTER TABLE tasks ADD COLUMN origin_channel TEXT\');\n  }\n\n  if (!hasColumn(db, \'tasks\', \'due_date\')) {'
  );
  fs.writeFileSync(path, code);
}
