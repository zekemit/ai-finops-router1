#!/usr/bin/env bash
# init.sh — install dependencies, run all checks, and boot the dashboard.
#
# Usage:
#   ./init.sh            install -> test -> typecheck -> start dashboard dev server
#   ./init.sh --no-dev   install -> test -> typecheck, then exit (CI / verification)
#
# Exits non-zero on the first failing step; the dashboard only boots if everything is green.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")"

START_DEV=1
for arg in "$@"; do
  case "$arg" in
    --no-dev) START_DEV=0 ;;
    -h|--help) sed -n '2,8p' "$0"; exit 0 ;;
    *) echo "unknown argument: $arg" >&2; exit 2 ;;
  esac
done

step() { printf '\n==> %s\n' "$1"; }

command -v node >/dev/null || { echo "node is required (>=20)" >&2; exit 1; }
command -v npm  >/dev/null || { echo "npm is required" >&2; exit 1; }

step "Installing dependencies (npm workspaces)"
npm install --no-audit --no-fund

step "Running unit tests"
npm test

step "Typechecking all workspaces"
npm run typecheck

if [ "$START_DEV" -eq 1 ]; then
  step "Booting dashboard at http://localhost:3000"
  exec npm run dev --workspace @ai-finops/dashboard
fi

step "All checks passed (dashboard not started: --no-dev)"
