#!/bin/bash
# Quick test script for AGIdentity agent

echo "Testing AGIdentity Agent..."
echo ""

# Test 1: Check balance
echo "1. Testing wallet balance..."
curl -X GET http://localhost:3000/wallet/balance
echo ""
echo ""

# Test 2: Store a memory
echo "2. Testing memory storage..."
curl -X POST http://localhost:3000/memory/store \
  -H "Content-Type: application/json" \
  -d '{
    "path": "test-memory.md",
    "content": "This is my first memory! I am an AI agent with an identity."
  }'
echo ""
echo ""

# Test 3: Search memories
echo "3. Testing memory recall..."
curl -X POST http://localhost:3000/memory/search \
  -H "Content-Type: application/json" \
  -d '{
    "query": "identity",
    "limit": 3
  }'
echo ""
echo ""

echo "Tests complete!"
