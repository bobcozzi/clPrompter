#!/bin/bash

# Check for a commit message
if [ -z "$1" ]; then
  echo "Usage: $0 \"commit message\""
  exit 1
fi

# Updating ELEMEMENTS
npm update @vscode-elements/elements
# Update all dependencies
npm update
npm ins
# Compile the extension
npm run compile || exit 1

# Package with dependencies
npx vsce package || exit 1

# Git commit/push
git add .
git commit -m "$1"
git push origin main || exit 1

# Publish to Microsoft Marketplace
vsce publish || exit 1

# Publish to Open VSX
npx ovsx publish || exit 1

echo "✅ Published to both marketplaces!"