#!/usr/bin/env bash
# =============================================================
# Did that edit invent a design value, or drift off the kit?
#
# Fires after every Edit or Write. If the file touched is one of the
# screens built from a UI kit in docs/source, both guards run and any
# failure is handed straight back rather than found a week later in a
# screenshot.
#
# From the business, after the analytics hub was rebuilt three times:
#
#   Your permission has been removed now to vibecode and do your own
#   thing ... I DESIGN FIRST THEN HAND IT TO YOU AND YOU PORT IT IN
#
# check:kit    the kit file is present, and the extract matches it
# check:invention  no design value is written by hand
#
# Exit 2 is the code Claude Code treats as "blocked, read stderr".
# =============================================================
set -u

payload=$(cat)
path=$(printf '%s' "$payload" | python3 -c \
  'import json,sys;d=json.load(sys.stdin);print(d.get("tool_input",{}).get("file_path",""))' 2>/dev/null)

case "$path" in
  *AnalyticsHub.tsx|*components/analytics/*|*ReportsHub.tsx|*kit-tokens.css|*kit.generated.ts) ;;
  *) exit 0 ;;
esac

cd "$(dirname "$0")/../.." || exit 0

fail=0
report=""

for guard in check:invention check:kit; do
  out=$(npm run --silent "$guard" 2>&1)
  if [ $? -ne 0 ]; then
    fail=1
    report="${report}
--- ${guard} ---
${out}
"
  fi
done

if [ "$fail" -ne 0 ]; then
  {
    echo "Blocked after editing $path."
    echo "$report"
    echo "docs/source/STCUIAnalytics.html is the source of truth."
    echo "Values come from lib/analytics/kit.generated.ts, which"
    echo "\`npm run kit:extract\` reads out of that file."
    echo
    echo "Do not adjust the check to agree with the code, and do not"
    echo "choose a value because it looks better. If the kit does not"
    echo "say it, it is not permitted."
  } >&2
  exit 2
fi
exit 0
