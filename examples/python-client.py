"""
Python Agent Example

How to give ANY Python AI agent AGIdentity capabilities.
Works with: LangChain, AutoGPT, custom agents, etc.
"""

import requests
import json

AGID_API = "http://localhost:3000"

class AGIdentityClient:
    """
    Universal AGIdentity client for Python agents.

    Usage:
        client = AGIdentityClient()
        identity = client.get_identity()
        signature = client.sign("Hello World")
        encrypted = client.encrypt("Secret data")
    """

    def __init__(self, api_url=AGID_API):
        self.api_url = api_url

    def get_identity(self):
        """Get agent's cryptographic identity"""
        response = requests.get(f"{self.api_url}/api/identity")
        return response.json()

    def sign(self, message, protocol="agent message"):
        """Sign a message with agent's private key"""
        response = requests.post(
            f"{self.api_url}/api/sign",
            json={"message": message, "protocol": protocol}
        )
        return response.json()

    def encrypt(self, data, protocol="agent memory", key_id="default", counterparty="self"):
        """Encrypt data for secure storage"""
        response = requests.post(
            f"{self.api_url}/api/encrypt",
            json={
                "data": data,
                "protocol": protocol,
                "keyId": key_id,
                "counterparty": counterparty
            }
        )
        return response.json()

    def decrypt(self, ciphertext, protocol="agent memory", key_id="default", counterparty="self"):
        """Decrypt previously encrypted data"""
        response = requests.post(
            f"{self.api_url}/api/decrypt",
            json={
                "ciphertext": ciphertext,
                "protocol": protocol,
                "keyId": key_id,
                "counterparty": counterparty
            }
        )
        return response.json()

    def check_balance(self):
        """Check BSV wallet balance"""
        response = requests.get(f"{self.api_url}/api/balance")
        return response.json()


# Example usage
if __name__ == "__main__":
    agent = AGIdentityClient()

    print("🤖 Python Agent with AGIdentity\n")

    # Get identity
    identity = agent.get_identity()
    print(f"✅ Identity: {identity['publicKey'][:32]}...")

    # Sign message
    sig = agent.sign("I am a Python agent with onchain identity")
    print(f"✅ Signed: {sig['signature'][:64]}...")

    # Encrypt secret
    encrypted = agent.encrypt("My secret memory")
    print(f"✅ Encrypted: {encrypted['ciphertext'][:64]}...")

    # Decrypt
    decrypted = agent.decrypt(encrypted['ciphertext'], key_id="default")
    print(f"✅ Decrypted: {decrypted['plaintext']}")

    # Check balance
    balance = agent.check_balance()
    print(f"✅ Balance: {balance['balance']} satoshis\n")

    print("🔌 Universal plugin working with Python!")
