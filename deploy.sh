#!/usr/bin/env bash

COMMIT_MSG="${1:-fix: bind credit ratio modal state to tCreditRatioMin}"

git add .
if ! git diff-index --quiet HEAD --; then
  git commit -m "$COMMIT_MSG"
fi

BRANCH=$(git rev-parse --abbrev-ref HEAD)
git push origin "$BRANCH"

SHA=$(git rev-parse HEAD)
echo "🚀 Commit ${SHA:0:7} pushed to $BRANCH."
echo "⏳ Waiting 15s for Vercel to queue build..."
sleep 15

# Sound functions
play_success() {
  for i in {1..3}; do
    osascript -e 'beep' 2>/dev/null || printf '\a'
    sleep 0.25
  done
}

play_failure() {
  osascript -e 'say "Deployment failed"' 2>/dev/null || printf '\a'
}

echo "🔍 Monitoring Vercel deployment status..."

while true; do
  # Poll GitHub Check Runs specifically filtering for Vercel
  RESULT=$(curl -s "https://api.github.com/repos/deannetharmon/trade-edge/commits/$SHA/check-runs" | python3 -c '
import sys, json
try:
    data = json.load(sys.stdin)
    runs = [r for r in data.get("check_runs", []) if "vercel" in r.get("app", {}).get("slug", "").lower() or "vercel" in r.get("name", "").lower()]
    if not runs:
        print("waiting")
    else:
        run = runs[0]
        status = run.get("status")
        conclusion = run.get("conclusion")
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
  elif [ "$RESULT" = "building" ]; then
    printf "."
  else
    printf "w"
  fi

  sleep 5
done
