#!/usr/bin/env bash

set -e

COMMIT_MSG="${1:-update}"

# 1. Stage and Commit
echo "📦 Staging changes..."
git add .

if git diff-index --quiet HEAD --; then
  echo "⚠️ No changes to commit."
else
  echo "💬 Committing: \"$COMMIT_MSG\""
  git commit -m "$COMMIT_MSG"
fi

# 2. Push current branch dynamically
BRANCH=$(git rev-parse --abbrev-ref HEAD)
echo "🚀 Pushing branch '$BRANCH' to remote..."
git push origin "$BRANCH"

SHA=$(git rev-parse HEAD)
echo "⏳ Commit ${SHA:0:7} pushed. Waiting 10s for Vercel build initialization..."
sleep 10

# 3. Poll Vercel status via GitHub API
echo "🔍 Monitoring Vercel build status..."

MAX_ATTEMPTS=60  # 5 minute timeout threshold
ATTEMPT=0

while [ $ATTEMPT -lt $MAX_ATTEMPTS ]; do
  ATTEMPT=$((ATTEMPT + 1))

  # Use GitHub CLI if authenticated, otherwise fallback to curl
  if command -v gh &> /dev/null; then
    RESPONSE=$(gh api "repos/:owner/:repo/commits/$SHA/check-runs" 2>/dev/null || true)
  else
    RESPONSE=$(curl -s "https://api.github.com/repos/deannetharmon/trade-edge/commits/$SHA/check-runs")
  fi

  STATUS=$(echo "$RESPONSE" | grep -o '"status": "[^"]*"' | head -1 | cut -d'"' -f4)
  CONCLUSION=$(echo "$RESPONSE" | grep -o '"conclusion": "[^"]*"' | head -1 | cut -d'"' -f4)

  if [ "$STATUS" = "completed" ]; then
    if [ "$CONCLUSION" = "success" ]; then
      echo -e "\n✅ Vercel build deployment successful!"
      break
    else
      echo -e "\n❌ Vercel build failed with conclusion: $CONCLUSION"
      exit 1
    fi
  fi

  printf "."
  sleep 5
done

# 4. Beep 3 times on completion
echo -e "\n🔔 Alerting..."
for i in {1..3}; do
  osascript -e 'beep' 2>/dev/null || printf '\a'
  sleep 0.3
done

echo "🎉 Deployment complete!"
