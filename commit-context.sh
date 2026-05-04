#!/bin/bash
cd /home/henrymascot/Code/entity
git add -A .context/ docs/ memory/ README.md scripts/update-context.sh
git status
git commit -m "docs: comprehensive context update reflecting Feb 14-17 work"
echo "Done!"
