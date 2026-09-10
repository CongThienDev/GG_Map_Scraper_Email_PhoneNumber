#!/bin/sh
# Run on a Linux VPS host, not inside the application container.
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
APP_DIR=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)
DATA_DIR="$APP_DIR/data"
OUTPUT="$DATA_DIR/system-metrics.json"
STATE="$DATA_DIR/.system-metrics-state"

if [ "$(uname -s)" != "Linux" ]; then
  echo "This collector only runs on a Linux VPS host." >&2
  exit 1
fi

mkdir -p "$DATA_DIR"

read_cpu() {
  awk '/^cpu / { idle=$5+$6; total=0; for (i=2; i<=NF; i++) total+=$i; print total, idle; exit }' /proc/stat
}

set -- $(read_cpu)
CPU_TOTAL=$1
CPU_IDLE=$2
CPU_PERCENT=null
if [ -r "$STATE" ]; then
  read -r PREV_TOTAL PREV_IDLE < "$STATE" || true
  if [ "${PREV_TOTAL:-0}" -gt 0 ] && [ "$CPU_TOTAL" -gt "$PREV_TOTAL" ]; then
    CPU_PERCENT=$(awk -v total="$CPU_TOTAL" -v idle="$CPU_IDLE" -v prev_total="$PREV_TOTAL" -v prev_idle="$PREV_IDLE" 'BEGIN { printf "%.2f", (1 - ((idle-prev_idle)/(total-prev_total))) * 100 }')
  fi
fi
printf '%s %s\n' "$CPU_TOTAL" "$CPU_IDLE" > "$STATE"
chmod 600 "$STATE"

MEM_TOTAL=$(awk '/^MemTotal:/ { print $2 * 1024; exit }' /proc/meminfo)
MEM_AVAILABLE=$(awk '/^MemAvailable:/ { print $2 * 1024; exit }' /proc/meminfo)
MEM_USED=$((MEM_TOTAL - MEM_AVAILABLE))
UPTIME_SECONDS=$(awk '{ printf "%.0f", $1 }' /proc/uptime)
LOAD_1=$(awk '{ print $1 }' /proc/loadavg)

set -- $(df -Pk "$APP_DIR" | awk 'NR == 2 { print $2 * 1024, $4 * 1024 }')
DISK_TOTAL=$1
DISK_AVAILABLE=$2

pressure_avg10() {
  [ -r "$1" ] || { printf 'null'; return; }
  awk '/^some / { for (i=1; i<=NF; i++) if ($i ~ /^avg10=/) { sub(/^avg10=/, "", $i); print $i; exit } }' "$1"
}

CPU_PRESSURE=$(pressure_avg10 /proc/pressure/cpu)
MEMORY_PRESSURE=$(pressure_avg10 /proc/pressure/memory)
IO_PRESSURE=$(pressure_avg10 /proc/pressure/io)
COLLECTED_AT=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
TMP_OUTPUT=$(mktemp "$DATA_DIR/.system-metrics.XXXXXX")

cat > "$TMP_OUTPUT" <<EOF
{"schemaVersion":1,"collectedAt":"$COLLECTED_AT","scope":"vps","cpuPercent":$CPU_PERCENT,"cpuCores":$(getconf _NPROCESSORS_ONLN),"memory":{"totalBytes":$MEM_TOTAL,"availableBytes":$MEM_AVAILABLE,"usedBytes":$MEM_USED},"disk":{"totalBytes":$DISK_TOTAL,"availableBytes":$DISK_AVAILABLE},"uptimeSeconds":$UPTIME_SECONDS,"load1":$LOAD_1,"pressure":{"cpuSomeAvg10":$CPU_PRESSURE,"memorySomeAvg10":$MEMORY_PRESSURE,"ioSomeAvg10":$IO_PRESSURE}}
EOF

chmod 644 "$TMP_OUTPUT"
mv "$TMP_OUTPUT" "$OUTPUT"
