#!/usr/bin/env bash
# Best-effort pre-warm of the production service to reduce free-tier cold-start
# latency on an imminent deploy or rollback. This runs only on genuine CI events
# (promotion, rollback, merge to main), never on a fixed schedule, so it reads
# as organic traffic rather than an anti-hibernation keep-alive cron.
#
# Never fails its caller: a hibernating or briefly-unavailable service is exactly
# the state we are trying to wake, so a non-200 is expected and tolerated.
#
# Env:
#   PRODUCTION_HEALTH_URL - health endpoint to ping (falls back to the Render URL).
set -u

HEALTH_URL="${PRODUCTION_HEALTH_URL:-https://alt-text-generator-zhsb.onrender.com/api/health}"

echo "Pre-warming ${HEALTH_URL} (best-effort) ..."

# --retry with --retry-all-errors lets the first request wake a hibernating
# instance and a later retry observe it healthy once it has spun up.
if curl -fsS \
  --max-time 45 \
  --retry 4 \
  --retry-delay 5 \
  --retry-all-errors \
  "${HEALTH_URL}" > /dev/null; then
  echo "Service responded healthy; already warm."
else
  echo "Pre-warm ping did not get a healthy response (expected if the service was asleep); continuing."
fi

exit 0
