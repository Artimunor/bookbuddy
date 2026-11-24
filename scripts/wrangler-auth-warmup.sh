#!/bin/sh
# D1 can reject a freshly refreshed OAuth token with 403 (7403).
# Capture the token and debug output without logging either, and wait only after a refresh.
set +x
if ! output=$(WRANGLER_LOG=debug WRANGLER_WRITE_LOGS=false WRANGLER_SEND_METRICS=false \
  bunx --no-install wrangler auth token 2>&1); then
  echo 'Wrangler auth warm-up failed. Set up or re-authenticate the bookbuddy profile.' >&2
  exit 1
fi
case $output in
  *'grant_type=refresh_token'*) sleep 3 ;;
esac
