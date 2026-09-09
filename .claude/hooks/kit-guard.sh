#!/usr/bin/env bash
# =============================================================
# Did that edit drift off the kit?
#
# Fires after every Edit or Write. If the file touched is one of the
# screens built from a UI kit in docs/source, the fidelity check runs
# and a failure is handed straight back rather than discovered a week
# later in a screenshot.
#
# On a clock this would be a timer. On tool events it is stricter:
# every single edit, not every ten seconds.
#
# Exit 2 is the code Claude Code treats as "blocked, read stderr".
# =============================================================
set -u

payload=$(cat)
path=$(printf '%s' "$payload" | python3 -c \
  'import json,sys;d=json.load(sys.stdin);print(d.get("tool_input",{}).get("file_path",""))' 2>/dev/null)

case "$path" in
  *AnalyticsHub.tsx|*components/analytics/*|*ReportsHub.tsx|*kit-tokens.css) ;;
  *) exit 0 ;;
esac

cd "$(dirname "$0")/../.." || exit 0

out=$(npm run --silent check:kit 2>&1)
if [ $? -ne 0 ]; then
  {
    echo "The kit guard failed after editing $path."
    echo
    echo "$out"
    echo
    echo "docs/source/STCUIAnalytics.html is the source of truth. Read the"
    echo "relevant part of it before changing this file again, rather than"
    echo "adjusting the check to agree with the code."
  } >&2
  exit 2
fi
exit 0
