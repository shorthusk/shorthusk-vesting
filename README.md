# 🎁 Shorthusk Vesting Program

A fully-featured Solana program built with [Anchor 0.31.1](https://docs.rs/anchor-lang/0.31.1/anchor_lang/) that manages SPL token vesting schedules. Supports linear release with cliff periods, batch initialization, administrative actions, emergency recovery, and pause/unpause mechanisms.

---

## 📦 Installation

Make sure you have the [Solana CLI](https://docs.solana.com/cli/install-solana-cli-tools), [Anchor CLI](https://www.anchor-lang.com/docs/installation), and [Rust toolchain](https://rustup.rs/) installed.

Then, to build the program:

```bash
anchor build
```

To deploy to a local validator:

```bash
anchor deploy
```

> ⚠️ Note: A new program ID is generated if `Anchor.toml` does not specify a keypair via `programs.localnet`. After deployment, update your frontend/test environment with the new program ID shown in the `anchor deploy` output.

---

## 📁 Project Structure

```
shorthusk-vesting/
├── Anchor.toml
├── Cargo.toml
├── programs/
│   └── shorthusk-vesting/
│       └── src/
│           └── lib.rs         # Anchor program logic
├── tests/
│   └── shorthusk-vesting.ts  # Anchor-integrated TypeScript tests
├── target/                    # Anchor build artifacts
│   └── idl/shorthusk_vesting.json    # Auto-generated IDL (Interface Definition Language)
└── migrations/               # Anchor deployment configs
```

---

## 🔧 Features

- **Vault Initialization**: Create vault accounts per SPL mint
- **Linear Vesting**: Custom cliff period, duration, and total amount
- **Batch Initialization**: Up to 3 vesting accounts at once (`v1` and `v2`)
- **Claiming**:
  - Beneficiaries can claim unlocked tokens
  - Admin can claim on their behalf
- **Pausing & Unpausing**:
  - Pause per-vesting or entire vault
- **Revocation**:
  - Cancel vesting and recover unclaimed tokens
- **Instant Unlock**:
  - Immediately release remaining tokens to beneficiary
- **Emergency Recovery**:
  - Admin can drain all vault funds
- **Admin Update**:
  - Transfer admin rights to a new wallet
- **View Function**:
  - `get_claimable()` returns claimable token amount

---

## 🔑 Instruction Reference

### Initialization

| Instruction | Description |
|------------|-------------|
| `initialize_vault` | Sets up a vault for a specific SPL mint |
| `initialize_vesting` | Creates a vesting account with cliff/duration |

### Claiming

| Instruction | Description |
|------------|-------------|
| `claim` | Beneficiary claims unlocked tokens |
| `admin_claim` | Admin claims on behalf of beneficiary |
| `get_claimable` | Returns claimable amount (view function) |

### Batch Operations

| Instruction | Description |
|------------|-------------|
| `batch_initialize_vesting` | Batch initializes vesting (account array) |
| `batch_initialize_vesting_v2` | Batch initializes via `remaining_accounts` |

### Admin Tools

| Instruction | Description |
|------------|-------------|
| `pause` / `unpause` | Temporarily disable vesting |
| `pause_vault` / `unpause_vault` | Freeze/unfreeze entire vault |
| `revoke_vesting` | Cancel and recover unclaimed funds |
| `instant_unlock` | Unlock all remaining tokens immediately |
| `emergency_recover` | Drain all vault tokens to recovery destination |
| `update_admin` | Assign new admin to the vault |

---

## 🧪 Running Tests

All integration tests are located in the `tests/` directory using TypeScript.

```bash
anchor test
```

These tests validate:

- PDA initialization and bumps
- Vault and vesting lifecycle
- Batch vesting behavior
- Admin controls (pause, revoke, recover, etc.)
- Token transfers and access restrictions

---

## 📄 IDL Highlights

Auto-generated at `shorthusk_vesting.json` after running `anchor build`.

### Key Accounts

- `Vault` – One per mint; tracks admin, pause state
- `VestingAccount` – Tracks vesting terms per beneficiary

### Structs

- `BatchVestingArgs` – Used in batch initialization
- `VaultInitializedEvent`, `VestingInitializedEvent`, etc. – Emitted on state changes

### Common Errors

| Code | Name | Meaning |
|------|------|---------|
| 6000 | `CliffNotReached` | Claim before cliff |
| 6001 | `NothingToClaim` | No unlocked tokens |
| 6003 | `Paused` | Vesting paused |
| 6004 | `VaultPaused` | Vault paused |
| 6006 | `AlreadyInitialized` | Vesting exists |
| 6008 | `Unauthorized` | Caller not admin |
| 6010 | `InvalidDuration` | Non-positive |
| 6011 | `InvalidCliffPeriod` | Exceeds duration |
| 6015 | `VestingRevoked` | Account canceled |

(See full list in `shorthusk_vesting.json`)

---

## 🔐 Security Practices

- Uses **PDAs** with deterministic seed generation
- Admin checks enforced on all critical ops
- SPL token transfers use `anchor-spl`
- Optional [`solana-security-txt`](https://github.com/solana-labs/security-txt) support

---

## 🔗 Integration Notes

- Program ID will differ in each deployment unless locked via a keypair
- Use the IDL with `@coral-xyz/anchor` or CLI tooling
- Frontend can simulate `getClaimable()` and fallback if `.view()` fails

---

## 👥 Contributors

- [@shorthusk](https://github.com/shorthusk) - creator and maintainer

---

## 📝 License

MIT

---