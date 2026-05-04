#!/bin/bash
# Commit script for context restructure
# Moves context from .context/ to memory/projects/entity/

cd /home/henrymascot/Code/entity

echo "🗑️  Removing .context/ directory (temp Codex working dir)..."
rm -rf .context/

echo "📦 Staging changes..."
git add -A memory/projects/entity/ docs/ README.md scripts/update-context.sh

echo "📋 Git status:"
git status --short

echo ""
echo "💾 Committing..."
git commit -m "docs: restructure context files

- Move canonical context from .context/ to memory/projects/entity/
- .context/ was temp Codex working directory (deleted)
- Update scripts/update-context.sh to use new location
- Copy context to docs/ for web access
- Update README.md with current team and features
- Reflects Feb 14-17 work: Task Master, DocHub, ANE, UI polish"

echo ""
echo "✅ Done! Context restructure committed."
