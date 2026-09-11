#!/usr/bin/env bash

# Exit immediately if a command exits with a non-zero status
set -e

echo "🔍 Step 1: Running TypeScript verification across full dependency graph..."
if npx tsc --noEmit; then
  echo "✅ Type check passed with 0 errors."
else
  echo "❌ TypeScript compilation failed. Deployment aborted."
  exit 1
fi

echo "🧪 Step 2: Running Linter..."
if npm run lint --if-present; then
  echo "✅ Lint checks passed."
else
  echo "❌ Linting failed. Deployment aborted."
  exit 1
fi

# Step 3: Git Commit & Push
COMMIT_MSG="${1:-feat: add min credit ratio filter to targeted scan config}"

echo "📦 Step 3: Staging changes..."
git add .

if git diff-index --quiet HEAD --; then
  echo "⚠️ No changes detected to commit. Checking remote status..."
else
  echo "💬 Committing with message: \"$COMMIT_MSG\""
  git commit -m "$COMMIT_MSG"
fi

echo "🚀 Step 4: Pushing to GitHub (Triggers Vercel Build)..."
git push origin main

echo "🎉 Deployment pipeline triggered successfully!"