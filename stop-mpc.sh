#!/bin/bash
# Stop all MPC cosigner servers

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOGS_DIR="$SCRIPT_DIR/logs"

echo "🛑 Stopping MPC cosigner servers..."

if [ -f "$LOGS_DIR/cosigner1.pid" ]; then
    PID=$(cat "$LOGS_DIR/cosigner1.pid")
    if kill -0 $PID 2>/dev/null; then
        kill $PID
        echo "✅ Stopped cosigner 1 (PID: $PID)"
    else
        echo "⚠️  Cosigner 1 not running"
    fi
    rm "$LOGS_DIR/cosigner1.pid"
fi

if [ -f "$LOGS_DIR/cosigner2.pid" ]; then
    PID=$(cat "$LOGS_DIR/cosigner2.pid")
    if kill -0 $PID 2>/dev/null; then
        kill $PID
        echo "✅ Stopped cosigner 2 (PID: $PID)"
    else
        echo "⚠️  Cosigner 2 not running"
    fi
    rm "$LOGS_DIR/cosigner2.pid"
fi

echo ""
echo "Cosigners stopped. Logs preserved in $LOGS_DIR/"
