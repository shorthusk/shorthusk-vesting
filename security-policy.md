# Security Policy for Token Vesting Program

## Introduction
The $SHORTHUSK Vesting Program is a Solana-based smart contract for managing linear token vesting schedules, supporting multiple mints, admin controls, and features like pausing, revoking, and emergency recovery. We value the security community’s efforts to keep our program secure and welcome responsible vulnerability reports.

## Reporting a Vulnerability
Please contact us via our X account: [@shorthusk](https://x.com/shorthusk) using direct messages (DMs). Include:
- A detailed description of the vulnerability.
- Steps to reproduce the issue.
- Potential impact (e.g., unauthorized token transfers).
- The program ID: VestF59gEqPp83UV8JKn85zXsEn1SuLq8mdz8QxxKzY (if deployed).

We aim to acknowledge reports within 48 hours and resolve critical issues within 30 days.

## Scope
**In Scope:**
- The $SHORTHUSK Vesting Program smart contract (Program ID: VestF59gEqPp83UV8JKn85zXsEn1SuLq8mdz8QxxKzY).
- Vulnerabilities affecting token transfers, vesting schedules, admin controls, or account initialization.

**Out of Scope:**
- Solana’s core protocol or SPL Token program.
- Third-party dependencies (e.g., Anchor, SPL Token).
- Front-end applications or off-chain components.
- Social engineering or phishing attacks.

## Safe Harbor
We will not pursue legal action against researchers who test our program responsibly, report vulnerabilities promptly, and follow this policy.

## Testing Guidelines
- Test only on Solana’s Devnet or Testnet to avoid disrupting Mainnet users.
- Do not exploit vulnerabilities beyond proof-of-concept (e.g., do not transfer tokens from Mainnet accounts).
- Avoid denial-of-service (DoS) attacks or excessive transaction spam.
- Do not access or modify user data without permission.

## Rewards
At this time, we do not offer monetary bounties. However, we will publicly acknowledge valid reports (with your permission) on our website or in the program’s `security.txt` acknowledgements.

## Disclosure
We follow a responsible disclosure process:
- Please allow 90 days for us to address vulnerabilities before public disclosure.
- We’ll work with you to coordinate disclosure and credit you (if desired) unless you prefer anonymity.

## Acknowledgements
Researchers who submit valid vulnerabilities will be recognized on our website or in our program’s `security.txt`, unless they request anonymity.

Last updated: May 7, 2025