#!/usr/bin/env bash

# Exit immediately if a command fails
set -e

COMMIT_MSG="${1:-feat: update codebase and trigger vercel build}"

echo "📦 Step 1: Staging all local changes..."
git add .

if git diff-index --quiet HEAD --; then
  echo "⚠️ No changes detected to commit."
else
  echo "💬 Step 2: Committing with message: \"$COMMIT_MSG\""
  git commit -m "$COMMIT_MSG"
fi

echo "🚀 Step 3: Pushing to GitHub (Vercel build triggered)..."
git push

echo "🔔 Step 4: Deployment triggered. Alerting..."
for i in {1..3}; do
  osascript -e 'beep' 2>/dev/null || printf '\a'
  sleep 0.3
done

echo "🎉 All changes pushed to remote!"