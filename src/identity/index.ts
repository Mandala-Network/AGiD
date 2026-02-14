/**
 * Identity Module
 *
 * BRC-52/53 compliant certificate issuance and verification
 * for enterprise identity management.
 */

export {
  CertificateAuthority,
  type CertificateAuthorityConfig,
  type CertificateType,
  type EmployeeCertificateFields,
  type CertificateIssuanceRequest,
  type IssuedCertificate,
  type CertificateVerificationResult,
} from './certificate-authority.js';

export {
  CertificateVerifier,
  type CertificateVerifierConfig,
} from './certificate-verifier.js';

export {
  IdentityGate,
  LocalCertificateIssuer,
  LocalRevocationChecker,
  gatedOperation,
  gatedOperationByKey,
  type IdentityGateConfig,
  type IdentityVerificationResult,
  type CertificateIssuer,
  type RevocationChecker,
} from './identity-gate.js';
