#!/usr/bin/env bash
# End-to-end run with real agents (guide T12: not part of the gate; it costs model usage and needs hc).
# Usage: scripts/e2e.sh <claude|codex|pi> "<request as the owner would type it>"
# EXPECT_TASKS=n waits for n tasks to finish (default 1), then for the Captain's report after the last one.
# Each run gets a fresh repo, config, state folder and worktrees under ~/.local/state/herdr-brigade-e2e: outside any
# repo, so no agent picks up another project's AGENTS.md or package.json, and kept across restarts (unlike /tmp).
# It starts the Coordinator, sends the request, waits for the worker's finish (or question) and the Captain's
# report, then prints the event log. It stops at the first error and leaves the agents running for a look.
set -euo pipefail

HARNESS=${1:?harness: claude, codex or pi}
REQUEST=${2:?request text}
APP=$(cd "$(dirname "$0")/.." && pwd)
RUN="${BRIGADE_E2E_DIR:-$HOME/.local/state/herdr-brigade-e2e}/run-$HARNESS-$(date +%Y%m%d-%H%M%S)"
WAIT_SECONDS=${WAIT_SECONDS:-540}
EXPECT_TASKS=${EXPECT_TASKS:-1}

case $HARNESS in
  claude) SPEC='{"harness":"claude","model":"claude-sonnet-5-5","effort":"low"}' ;;
  codex) SPEC='{"harness":"codex","model":"gpt-6.1-terra","effort":"low"}' ;;
  pi) SPEC='{"harness":"pi","model":"openai/gpt-6.1-sol","effort":"low"}' ;;
  *) echo "harness must be claude, codex or pi" >&2; exit 2 ;;
esac

# Never touch a real brigade: refuse to run while any brigade agent is live. An hc failure stops the script here.
running=$(hc ls --json --label brigade=main \
  | python3 -I -c 'import json,sys; d=json.load(sys.stdin); t=d["terminals"] if isinstance(d,dict) else d; print(len(t))')
if [ "$running" != 0 ]; then
  echo "brigade agents are already running; remove them first (hc ls --label brigade=main)" >&2
  exit 1
fi

mkdir -p "$RUN/repo" "$RUN/state" "$RUN/worktrees"
git -C "$RUN/repo" init -q -b main
echo "# demo" > "$RUN/repo/README.md"
git -C "$RUN/repo" add README.md
git -C "$RUN/repo" -c user.name=Test -c user.email=test@example.invalid commit -qm init
cat > "$RUN/config.json" <<EOF
{ "owner": "Kamran",
  "roles": { "coordinator": $SPEC, "captain": $SPEC, "worker": $SPEC },
  "projects": [{ "name": "demo", "repo": "$RUN/repo", "baseBranch": "main" }] }
EOF

export BRIGADE_CONFIG="$RUN/config.json" BRIGADE_STATE="$RUN/state" BRIGADE_WORKTREES="$RUN/worktrees"
cd "$APP"
started=$(node src/entrypoints/cli.ts start)
echo "$started"
case $started in
  Started*) ;;
  *) echo "expected a new Coordinator, not one that was already running" >&2; exit 1 ;;
esac
# The Coordinator this run started, from this run's own event log: never one found by a shared label.
COORD=$(python3 -I -c '
import json,sys
events=[json.loads(l) for l in open(sys.argv[1]) if l.strip()]
print(next(e["terminal"] for e in events if e["kind"]=="agent_started" and e["role"]=="coordinator"))
' "$RUN/state/events.jsonl")
echo "run: $RUN"
echo "coordinator: $COORD"

sent=no
for _ in $(seq 1 30); do
  if hc send "$COORD" "$REQUEST" >/dev/null 2>&1; then sent=yes; break; fi
  timeout 1 tail -f /dev/null || true
done
[ "$sent" = yes ] || { echo "could not send the request to $COORD" >&2; exit 1; }

# An agent that just started can take the pasted text but drop the Enter (seen with pi). Press it again if no turn
# has started within 20 seconds.
turn() { hc get "$COORD" --json | python3 -I -c 'import json,sys; print(json.load(sys.stdin).get("turn") or 0)'; }
for _ in $(seq 1 10); do
  [ "$(turn)" -ge 1 ] && break
  timeout 2 tail -f /dev/null || true
done
if [ "$(turn)" -lt 1 ]; then
  echo "no turn started; pressing Enter again"
  hc keys "$COORD" enter >/dev/null
fi

EVENTS="$RUN/state/events.jsonl"
end=$((SECONDS + WAIT_SECONDS))
finished=no
while [ $SECONDS -lt $end ]; do
  # Done when enough tasks finished, the Captain reported after the last one, and the log has been quiet for
  # 10 seconds, so a second report that follows soon is recorded too.
  if [ -f "$EVENTS" ] && python3 -I -c '
import json,sys
events=[json.loads(l) for l in open(sys.argv[1]) if l.strip()]
done=[e for e in events if e["kind"] in ("task_finished","task_asked")]
last=max((e["at"] for e in done), default=None)
reported=any(e["kind"]=="message_sent" and e.get("to")=="coordinator" and last and e["at"]>=last for e in events)
sys.exit(0 if len({e["task"] for e in done})>=int(sys.argv[2]) and reported else 1)
' "$EVENTS" "$EXPECT_TASKS" && [ $(( $(date +%s) - $(stat -c %Y "$EVENTS") )) -ge 10 ]; then finished=yes; break; fi
  hc wait "$COORD" --timeout 15 >/dev/null 2>&1 || true
  timeout 3 tail -f /dev/null || true
done
echo "waited ${SECONDS}s"
python3 -I -c '
import json,sys
for l in open(sys.argv[1]):
  e=json.loads(l)
  text=e.get("summary") or e.get("question") or e.get("text") or e.get("message") or ""
  print(e["at"][11:19], e["kind"], e.get("terminal",""), e.get("sha",""), text[:160])
' "$EVENTS"
if [ "$finished" != yes ]; then
  echo "timed out after ${WAIT_SECONDS}s: the tasks did not all finish and get reported" >&2
  exit 1
fi
