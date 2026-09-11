#!/usr/bin/env bash

COMMIT_MSG="${1:-feat: update codebase}"

git add .
if ! git diff-index --quiet HEAD --; then
  git commit -m "$COMMIT_MSG"
fi

BRANCH=$(git rev-parse --abbrev-ref HEAD)
git push origin "$BRANCH"

SHA=$(git rev-parse HEAD)
echo "🚀 Pushed ${SHA:0:7}. Waiting for Vercel build trigger..."
sleep 8

while true; do
  RESULT=$(curl -s "https://api.github.com/repos/deannetharmon/trade-edge/commits/$SHA/check-runs" | python3 -c '
import sys, json
try:
    data = json.load(sys.stdin)
    runs = data.get("check_runs", [])
    if not runs:
        print("initializing")
    else:
        statuses = [r.get("status") for r in runs]
        conclusions = [r.get("conclusion") for r in runs]
        if all(s == "completed" for s in statuses):
            if all(c == "success" for c in conclusions):
                print("success")
            else:
                print("failure")
        else:
            print("building")
except Exception:
    print("error")
')

  if [ "$RESULT" = "success" ]; then
    echo -e "\n✅ Vercel build complete & live!"
    break
  elif [ "$RESULT" = "failure" ]; then
    echo -e "\n❌ Vercel build failed."
    exit 1
  elif [ "$RESULT" = "initializing" ]; then
    printf "i"
  else
    printf "."
  fi

  sleep 5
done

# Alert 3 times only after verified Vercel completion
for i in {1..3}; do
  osascript -e 'beep' 2>/dev/null || printf '\a'
  sleep 0.2
done
