#!/usr/bin/env bash
# taskrouter is a library + CLI, not a server. "Start" = run the tests, refresh
# the leaderboard snapshot into ~/.taskrouter, then print the ranking table.
set -euo pipefail
cd "$(dirname "$0")"
[ -d node_modules ] || npm install --no-audit --no-fund
npm test
node src/cli/main.ts refresh
node src/cli/main.ts matrix
