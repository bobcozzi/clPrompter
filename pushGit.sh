#!/bin/bash

# Check for a commit message
if [ -z "$1" ]; then
  echo "Usage: $0 \"commit message\""
  exit 1
fi

# Pull latest changes first (using merge strategy)
echo "Pulling latest changes..."
git pull --no-rebase origin main || exit 1

# Git commit/push
git add .
git commit -m "$1"
git push origin main

echo "✅ Pushed to GitHub!"
