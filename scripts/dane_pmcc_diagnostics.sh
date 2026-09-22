#!/usr/bin/env bash

set -u

workspace="${1:-$PWD}"

if [[ ! -d "$workspace" ]]; then
  echo "ERROR: repository directory not found: $workspace" >&2
  exit 1
fi

cd "$workspace" || exit 1

if [[ ! -f package.json || ! -d .git ]]; then
  echo "ERROR: $workspace does not look like the TradeEdge repository root." >&2
  echo "Run this script from the repository root or pass the repository path as its first argument." >&2
  exit 1
fi

echo "TradeEdge PMCC diagnostic"
echo "Workspace: $workspace"
echo

echo "Runtime"
command -v node || true
node --version 2>/dev/null || true
command -v npm || true
npm --version 2>/dev/null || true
command -v rg || true
echo

echo "Git state (read-only)"
git branch --show-current 2>/dev/null || true
git status --short 2>/dev/null || true
git remote -v 2>/dev/null || true
echo

echo "Repository guidance"
if command -v rg >/dev/null 2>&1; then
  rg --files -g 'AGENTS.md' -g '!node_modules' || true
else
  find . -name AGENTS.md -not -path './node_modules/*' -print 2>/dev/null || true
fi
echo

echo "PMCC implementation files"
if command -v rg >/dev/null 2>&1; then
  rg --files app features lib docs \
    | rg '(^|/)(pmcc|Pmcc|PMCC)|PMCC' \
    | sort
else
  find app features lib docs -type f 2>/dev/null \
    | grep -Ei '(^|/)(pmcc|PMCC)' \
    | sort
fi
echo

echo "Available npm scripts"
npm run 2>/dev/null || true
echo

echo "Dependency state"
if [[ -d node_modules ]]; then
  echo "node_modules: present"
else
  echo "node_modules: missing"
fi

if [[ -f package-lock.json ]]; then
  echo "package-lock.json: present"
else
  echo "package-lock.json: missing"
fi

echo
echo "Diagnostic complete. This script does not modify the repository."
