#!/usr/bin/env bash

COMMIT_MSG="${1:-feat: fix state hook and vercel deploy audio}"

git add .
if ! git diff-index --quiet HEAD --; then
  git commit -m "$COMMIT_MSG"
fi

BRANCH=$(git rev-parse --abbrev-ref HEAD)
git push origin "$BRANCH"

SHA=$(git rev-parse HEAD)
echo "🚀 Pushed ${SHA:0:7}. Waiting for Vercel build to initialize..."

play_success() {
  for i in {1..3}; do
    osascript -e 'beep' 2>/dev/null || printf '\a'
    sleep 0.2
  done
}

play_failure() {
  osascript -e 'say "Deployment failed"' 2>/dev/null || printf '\a'
}

# Wait 15 seconds to ensure Vercel hook registers on GitHub
sleep 15

while true; do
  RESULT=$(curl -s "https://api.github.com/repos/deannetharmon/trade-edge/commits/$SHA/check-runs" | python3 -c '
import sys, json
try:
    data = json.load(sys.stdin)
    runs = [r for r in data.get("check_runs", []) if r.get("app", {}).get("slug") == "vercel"]
    if not runs:
        print("waiting")
    else:
        status = runs[0].get("status")
        conclusion = runs[0].get("conclusion")
        if status == "completed":
            print("success" if conclusion == "success" else "failure")
        else:
            print("building")
except Exception:
    print("error")
')

  if [ "$RESULT" = "success" ]; then
    echo -e "\n✅ Vercel build complete & live!"
    play_success
    break
  elif [ "$RESULT" = "failure" ]; then
    echo -e "\n❌ Vercel build failed."
    play_failure
    exit 1
  fi

  printf "."
  sleep 5
done
