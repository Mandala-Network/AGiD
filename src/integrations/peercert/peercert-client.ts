/**
 * PeerCert Client
 *
 * Thin wrapper around PeerCert for issuing, receiving, and managing
 * BRC-52 identity certificates. Follows the X402Client/MandalaClient pattern.
 */

import { PeerCert } from 'peercert';
import { Utils } from '@bsv/sdk';
import type { BRC100Wallet } from '../../types/index.js';

/** AGIdentity certificate type — base64 of 'agidentity.identity' */
export const AGID_CERT_TYPE = Utils.toBase64(Utils.toArray('agidentity.identity', 'utf8'));

export interface PeerCertClientConfig {
  trustedCertifiers?: string[];
  messageBoxHost?: string;
}

export class PeerCertClient {
  private peerCert: PeerCert;
  private trustedCertifiers: Set<string>;

  constructor(wallet: BRC100Wallet, config?: PeerCertClientConfig) {
    // `as any` — bundled SDK type mismatch (curvepoint vs top-level @bsv/sdk)
    this.peerCert = new PeerCert(wallet.asWalletInterface() as any, {
      messageBoxHost: config?.messageBoxHost,
    });
    this.trustedCertifiers = new Set(config?.trustedCertifiers ?? []);
  }

  getPeerCert(): PeerCert {
    return this.peerCert;
  }

  isTrusted(certifier: string): boolean {
    return this.trustedCertifiers.has(certifier);
  }

  addTrustedCertifier(certifier: string): void {
    this.trustedCertifiers.add(certifier);
  }

  getTrustedCertifiers(): string[] {
    return Array.from(this.trustedCertifiers);
  }
}
