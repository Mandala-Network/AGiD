#!/bin/bash
# AGIdentity Full MPC Deployment Script

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MPC_DIR="$SCRIPT_DIR/MPC-DEV/mpc-test-app/cosigner-servers"
LOGS_DIR="$SCRIPT_DIR/logs"

echo "╔═══════════════════════════════════════════════════════════╗"
echo "║        AGIdentity Full MPC Deployment                      ║"
echo "║    Agent + 2 Cosigners (2-of-3 Threshold Wallet)           ║"
echo "╚═══════════════════════════════════════════════════════════╝"
echo ""

# Create logs directory
mkdir -p "$LOGS_DIR"

# Step 1: Build cosigner servers
echo "📦 Building cosigner servers..."
cd "$MPC_DIR"
npm install
npm run build
echo "✅ Cosigner servers built"
echo ""

# Step 2: Create cosigner configs
echo "🔧 Creating cosigner configurations..."

# Cosigner 1 (Party ID 2, Port 3001)
cat > "$MPC_DIR/.env.cosigner1" << 'EOF'
PARTY_ID=2
PORT=3001
JWT_SECRET=test-cosigner-secret-change-in-production
LOG_LEVEL=info
EOF

# Cosigner 2 (Party ID 3, Port 3002)
cat > "$MPC_DIR/.env.cosigner2" << 'EOF'
PARTY_ID=3
PORT=3002
JWT_SECRET=test-cosigner-secret-change-in-production
LOG_LEVEL=info
EOF

echo "✅ Cosigner configs created"
echo ""

# Step 3: Start cosigner servers in background
echo "🚀 Starting cosigner servers..."

# Start cosigner 1
cd "$MPC_DIR"
PORT=3001 PARTY_ID=2 JWT_SECRET=test-cosigner-secret node dist/server.js > "$LOGS_DIR/cosigner1.log" 2>&1 &
COSIGNER1_PID=$!
echo "✅ Cosigner 1 started (PID: $COSIGNER1_PID, Port: 3001)"

# Start cosigner 2
PORT=3002 PARTY_ID=3 JWT_SECRET=test-cosigner-secret node dist/server.js > "$LOGS_DIR/cosigner2.log" 2>&1 &
COSIGNER2_PID=$!
echo "✅ Cosigner 2 started (PID: $COSIGNER2_PID, Port: 3002)"

# Save PIDs for cleanup
echo "$COSIGNER1_PID" > "$LOGS_DIR/cosigner1.pid"
echo "$COSIGNER2_PID" > "$LOGS_DIR/cosigner2.pid"

echo ""
echo "Waiting for cosigners to start..."
sleep 3

# Test cosigner health
echo "🏥 Testing cosigner health..."
curl -s http://localhost:3001/api/v1/health | grep -q "ok" && echo "✅ Cosigner 1 healthy" || echo "❌ Cosigner 1 failed"
curl -s http://localhost:3002/api/v1/health | grep -q "ok" && echo "✅ Cosigner 2 healthy" || echo "❌ Cosigner 2 failed"
echo ""

# Step 4: Configure AGIdentity for MPC
echo "🔧 Configuring AGIdentity for MPC mode..."
cd "$SCRIPT_DIR"

cat > .env << 'EOF'
# ============================================
# AGIdentity Gateway - FULL MPC MODE
# ============================================

# MPC WALLET (2-of-3 threshold)
# Agent is Party 1, Cosigners are Party 2 and 3
MPC_COSIGNER_ENDPOINTS=http://localhost:3001,http://localhost:3002
MPC_SHARE_SECRET=development-secret-change-in-production-use-openssl-rand-hex-32
MPC_SHARE_PATH=./agent-mpc-share.json

# NETWORK
AGID_NETWORK=testnet

# IDENTITY (use your own CA pubkey or leave empty for testing)
TRUSTED_CERTIFIERS=

# OPENCLAW
OPENCLAW_GATEWAY_URL=ws://127.0.0.1:18789
OPENCLAW_AUTH_TOKEN=test-token-123

# AUTH SERVER
AUTH_SERVER_PORT=3000

# MESSAGEBOX
MESSAGEBOX_URL=https://messagebox.babbage.systems
EOF

echo "✅ AGIdentity configured for MPC"
echo ""

# Step 5: Build AGIdentity
echo "📦 Building AGIdentity..."
npm install
npm run build
echo "✅ AGIdentity built"
echo ""

echo "╔═══════════════════════════════════════════════════════════╗"
echo "║                    🎉 Deployment Complete!                 ║"
echo "╚═══════════════════════════════════════════════════════════╝"
echo ""
echo "Next steps:"
echo ""
echo "1. Start AGIdentity Gateway:"
echo "   npm run gateway"
echo ""
echo "2. On first run, DKG will execute automatically to generate distributed key"
echo ""
echo "3. Get your agent's address and fund it:"
echo "   curl http://localhost:3000/wallet/address"
echo "   # Send testnet BSV from: https://faucet.bitcoincloud.net/"
echo ""
echo "4. Start OpenClaw (in another terminal)"
echo ""
echo "5. Test MessageBox communication!"
echo ""
echo "Logs:"
echo "  - Cosigner 1: $LOGS_DIR/cosigner1.log"
echo "  - Cosigner 2: $LOGS_DIR/cosigner2.log"
echo "  - AGIdentity: (stdout when you run 'npm run gateway')"
echo ""
echo "To stop cosigners:"
echo "  kill $(cat $LOGS_DIR/cosigner1.pid)"
echo "  kill $(cat $LOGS_DIR/cosigner2.pid)"
echo ""
