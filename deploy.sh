#!/usr/bin/env bash
set -e

COMMIT_MSG="${1:-feat: add min credit ratio filter to scan modal}"

git add .
if ! git diff-index --quiet HEAD --; then
  git commit -m "$COMMIT_MSG"
fi

BRANCH=$(git rev-parse --abbrev-ref HEAD)
git push origin "$BRANCH"

SHA=$(git rev-parse HEAD)
echo "⏳ Push complete (${SHA:0:7}). Polling Vercel build status..."
sleep 8

while true; do
  STATUS=$(curl -s "https://api.github.com/repos/deannetharmon/trade-edge/commits/$SHA/check-runs" | grep -o '"status": "[^"]*"' | head -1 | cut -d'"' -f4)
  CONCLUSION=$(curl -s "https://api.github.com/repos/deannetharmon/trade-edge/commits/$SHA/check-runs" | grep -o '"conclusion": "[^"]*"' | head -1 | cut -d'"' -f4)

  if [ "$STATUS" = "completed" ]; then
    if [ "$CONCLUSION" = "success" ]; then
      echo "✅ Vercel build complete!"
      break
    else
      echo "❌ Vercel build failed ($CONCLUSION)"
      exit 1
    fi
  fi
  sleep 4
done

for i in {1..3}; do
  osascript -e 'beep' 2>/dev/null || printf '\a'
  sleep 0.2
done
