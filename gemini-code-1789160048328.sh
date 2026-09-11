#!/usr/bin/env bash

COMMIT_MSG="${1:-update}"

git add .
git commit -m "$COMMIT_MSG"
git push

for i in {1..3}; do
  osascript -e 'beep' 2>/dev/null || printf '\a'
  sleep 0.3
done