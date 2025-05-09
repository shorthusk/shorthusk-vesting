import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { ShorthuskVesting } from "../target/types/shorthusk_vesting";
import {
  TOKEN_PROGRAM_ID,
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  getAccount,
  getAssociatedTokenAddress
} from "@solana/spl-token";
import * as assert from "assert";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import { getVaultPda, getVestingPda } from "../frontend/derive"; // Import derive functions
import { Init } from "v8";

describe("shorthusk-vesting (tests)", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.ShorthuskVesting as Program<ShorthuskVesting>;

  let mint: PublicKey;
  let admin = provider.wallet;
  let newAdmin: Keypair = Keypair.generate();
  let vaultPda: PublicKey;
  let vaultBump: number;
  let vaultTokenAccount: PublicKey;
  const beneficiary1 = Keypair.generate();
  const beneficiary2 = Keypair.generate();
  const beneficiary3 = Keypair.generate();
  const beneficiary4 = Keypair.generate();
  const beneficiary5 = Keypair.generate();
  const beneficiary6 = Keypair.generate();
  let beneficiaryTokenAccount1: PublicKey;
  let beneficiaryTokenAccount2: PublicKey;
  let beneficiaryTokenAccount3: PublicKey;
  let beneficiaryTokenAccount4: PublicKey;
  let beneficiaryTokenAccount5: PublicKey;
  let beneficiaryTokenAccount6: PublicKey;

  // Use PDAs instead of Keypairs for vesting accounts
  let vestingPda1: PublicKey;
  let vestingPda2: PublicKey;
  let vestingPda3: PublicKey;
  let vestingPda4: PublicKey;
  let vestingPda5: PublicKey;
  let vestingPda6: PublicKey;

  let recoveryDestination: PublicKey;

  // Variables for batch tests
  let batchVestingPdas: PublicKey[];
  let batchBeneficiaries: Keypair[];

  // Reinitialize the vault and fund newAdmin before each test run
  before(async () => {
    // Create a mint for the vault
    mint = await createMint(
      provider.connection,
      admin.payer,
      admin.publicKey,
      null,
      9
    );

    [vaultPda, vaultBump] = getVaultPda(mint);

    await program.methods
      .initializeVault()
      .accounts({
        vault: vaultPda,
        mint,
        payer: admin.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    // Fund newAdmin with SOL
    const signature = await provider.connection.requestAirdrop(
      newAdmin.publicKey,
      5_000_000_000 // 5 SOL to cover account creation
    );
    await provider.connection.confirmTransaction(signature);

    const vaultAccount = await program.account.vault.fetch(vaultPda);
    assert.strictEqual(
      vaultAccount.admin.toBase58(),
      admin.publicKey.toBase58(),
      "Vault admin should be set to admin.publicKey at the start"
    );
    assert.strictEqual(
      vaultAccount.paused,
      false,
      "Vault should not be paused"
    );
  });

  it("Funds newAdmin with SOL", async () => {
    const balance = await provider.connection.getBalance(newAdmin.publicKey);
    assert.ok(balance >= 5_000_000_000, "Failed to fund newAdmin with SOL");
  });

  it("Funds the vault with existing tokens", async () => {
    const sourceTokenAccount = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      admin.payer,
      mint,
      admin.publicKey
    );

    const freshVaultTokenAccount = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      admin.payer,
      mint,
      vaultPda,
      true
    );

    await mintTo(
      provider.connection,
      admin.payer,
      mint,
      sourceTokenAccount.address,
      admin.publicKey,
      1_000_000_000
    );

    const preVault = await getAccount(
      provider.connection,
      freshVaultTokenAccount.address
    );

    await program.methods
      .fundVaultExisting(new anchor.BN(500_000_000))
      .accounts({
        vault: vaultPda,
        mint,
        sourceTokenAccount: sourceTokenAccount.address,
        vaultTokenAccount: freshVaultTokenAccount.address,
        admin: admin.publicKey,
        payer: admin.publicKey, // Explicitly add payer
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();

    const postVault = await getAccount(
      provider.connection,
      freshVaultTokenAccount.address
    );

    console.log(
      "Vault token balance increased by:",
      Number(postVault.amount - preVault.amount) / 1e9,
      "tokens"
    );

    assert.strictEqual(Number(postVault.amount - preVault.amount), 500_000_000);
  });

  it("Creates mint, vault token account, and funds it", async () => {
    const vaultToken = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      admin.payer,
      mint,
      vaultPda,
      true
    );
    vaultTokenAccount = vaultToken.address;

    await mintTo(
      provider.connection,
      admin.payer,
      mint,
      vaultTokenAccount,
      admin.publicKey,
      500_000_000
    );

    console.log("Vault token account funded.");
  });

  it("Creates beneficiary token accounts and recovery account", async () => {
    const ben1 = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      admin.payer,
      mint,
      beneficiary1.publicKey
    );
    beneficiaryTokenAccount1 = ben1.address;

    const ben2 = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      admin.payer,
      mint,
      beneficiary2.publicKey
    );
    beneficiaryTokenAccount2 = ben2.address;

    const ben3 = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      admin.payer,
      mint,
      beneficiary3.publicKey
    );
    beneficiaryTokenAccount3 = ben3.address;

    const ben4 = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      admin.payer,
      mint,
      beneficiary4.publicKey
    );
    beneficiaryTokenAccount4 = ben4.address;

    const ben5 = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      admin.payer,
      mint,
      beneficiary5.publicKey
    );
    beneficiaryTokenAccount5 = ben5.address;

    const ben6 = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      admin.payer,
      mint,
      beneficiary6.publicKey
    );
    beneficiaryTokenAccount6 = ben6.address;

    const recovery = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      admin.payer,
      mint,
      admin.publicKey
    );
    recoveryDestination = recovery.address;

    console.log("Beneficiary and recovery token accounts created.");
  });

  it("Initializes two vesting accounts individually", async () => {
      const now = Math.floor(Date.now() / 1000);

      [vestingPda1] = getVestingPda(vaultPda, mint, beneficiary1.publicKey);
      [vestingPda2] = getVestingPda(vaultPda, mint, beneficiary2.publicKey);

      await program.methods
        .initializeVesting(
          new anchor.BN(now),
          new anchor.BN(30),
          new anchor.BN(300),
          new anchor.BN(250_000_000)
        )
        .accounts({
          vestingAccount: vestingPda1,
          vault: vaultPda,
          mint,
          beneficiary: beneficiary1.publicKey,
          payer: admin.publicKey,
          admin: admin.publicKey, // Add admin account
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      await program.methods
        .initializeVesting(
          new anchor.BN(now),
          new anchor.BN(30),
          new anchor.BN(300),
          new anchor.BN(250_000_000)
        )
        .accounts({
          vestingAccount: vestingPda2,
          vault: vaultPda,
          mint,
          beneficiary: beneficiary2.publicKey,
          payer: admin.publicKey,
          admin: admin.publicKey, // Add admin account
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      console.log("Initialized vesting accounts for both beneficiaries.");
  });

  it("Fails to re-initialize a vesting account", async () => {
    const now = Math.floor(Date.now() / 1000);
    const [vestingPda] = getVestingPda(vaultPda, mint, beneficiary1.publicKey);

    try {
      await program.methods
        .reinitializeVesting(
          new anchor.BN(now),
          new anchor.BN(30),
          new anchor.BN(300),
          new anchor.BN(250_000_000)
        )
        .accounts({
          vestingAccount: vestingPda,
          vault: vaultPda,
          mint,
          beneficiary: beneficiary1.publicKey,
          payer: admin.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
      assert.fail("Should have failed with NotRevoked");
    } catch (err) {
      console.log("Expected failure on re-initialize:", err.toString());
      assert.match(err.toString(), /NotRevoked/);
    }
  });

  it("Fails to claim before cliff", async () => {
    try {
      await program.methods
        .claim()
        .accounts({
          vestingAccount: vestingPda1,
          vault: vaultPda,
          vaultTokenAccount,
          mint,
          beneficiaryTokenAccount: beneficiaryTokenAccount1,
          beneficiary: beneficiary1.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([beneficiary1])
        .rpc();
    } catch (err) {
      console.log("Expected failure before cliff:", err.toString());
    }
  });

  it("Fails to admin claim before cliff", async () => {
    const initialBalance = await getAccount(
      provider.connection,
      beneficiaryTokenAccount1
    );

    await program.methods
      .adminClaim()
      .accounts({
        vestingAccount: vestingPda1,
        vault: vaultPda,
        vaultTokenAccount,
        mint,
        beneficiaryTokenAccount: beneficiaryTokenAccount1,
        admin: admin.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();

    const finalBalance = await getAccount(
      provider.connection,
      beneficiaryTokenAccount1
    );
    assert.strictEqual(
      Number(finalBalance.amount),
      Number(initialBalance.amount),
      "No tokens should be claimed before the cliff period"
    );

    console.log(
      "Admin claim before cliff succeeded but claimed 0 tokens, as expected."
    );
  });

  it("Fails to claim with invalid timestamp", async () => {
      const futureTime = Math.floor(Date.now() / 1000) + 3600;
      const [futureVestingPda] = getVestingPda(vaultPda, mint, beneficiary3.publicKey);

      await program.methods
        .initializeVesting(
          new anchor.BN(futureTime),
          new anchor.BN(30),
          new anchor.BN(300),
          new anchor.BN(250_000_000)
        )
        .accounts({
          vestingAccount: futureVestingPda,
          vault: vaultPda,
          mint,
          beneficiary: beneficiary3.publicKey,
          payer: admin.publicKey,
          admin: admin.publicKey, // Add admin account
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      vestingPda3 = futureVestingPda;

      try {
        await program.methods
          .claim()
          .accounts({
            vestingAccount: vestingPda3,
            vault: vaultPda,
            vaultTokenAccount,
            mint,
            beneficiaryTokenAccount: beneficiaryTokenAccount3,
            beneficiary: beneficiary3.publicKey,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .signers([beneficiary3])
          .rpc();
        assert.fail("Should have failed with invalid timestamp");
      } catch (err) {
        assert.match(err.toString(), /InvalidTimestamp/);
      }
  });

  it("Fails to admin claim with invalid timestamp", async () => {
    try {
      await program.methods
        .adminClaim()
        .accounts({
          vestingAccount: vestingPda3,
          vault: vaultPda,
          vaultTokenAccount,
          mint,
          beneficiaryTokenAccount: beneficiaryTokenAccount3,
          admin: admin.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc();
      assert.fail("Should have failed with invalid timestamp for admin claim");
    } catch (err) {
      console.log(
        "Expected failure for admin claim with invalid timestamp:",
        err.toString()
      );
      assert.match(err.toString(), /InvalidTimestamp/);
    }
  });

  it("Waits and claims after cliff", async () => {
    console.log("Waiting 40 seconds...");
    await new Promise((resolve) => setTimeout(resolve, 40000));

    await program.methods
      .claim()
      .accounts({
        vestingAccount: vestingPda1,
        vault: vaultPda,
        vaultTokenAccount,
        mint,
        beneficiaryTokenAccount: beneficiaryTokenAccount1,
        beneficiary: beneficiary1.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([beneficiary1])
      .rpc();

    const acc = await getAccount(provider.connection, beneficiaryTokenAccount1);
    console.log("Claimed tokens:", Number(acc.amount) / 1e9);
  });

  it("Waits and admin claims after cliff", async () => {
    console.log("Waiting 40 seconds...");
    await new Promise((resolve) => setTimeout(resolve, 40000));

    const initialBalance = await getAccount(
      provider.connection,
      beneficiaryTokenAccount2
    );

    const vestingAccount = await program.account.vestingAccount.fetch(
      vestingPda2
    );
    const currentTs = Math.floor(Date.now() / 1000);
    const elapsed = currentTs - vestingAccount.startTime.toNumber();
    let expectedClaimable = 0;
    if (elapsed > vestingAccount.cliffPeriod.toNumber()) {
      expectedClaimable =
        Math.floor(
          (vestingAccount.totalAmount.toNumber() * elapsed) /
            vestingAccount.duration.toNumber()
        ) - vestingAccount.claimedAmount.toNumber();
    }

    await program.methods
      .adminClaim()
      .accounts({
        vestingAccount: vestingPda2,
        vault: vaultPda,
        vaultTokenAccount,
        mint,
        beneficiaryTokenAccount: beneficiaryTokenAccount2,
        admin: admin.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();

    const finalBalance = await getAccount(
      provider.connection,
      beneficiaryTokenAccount2
    );
    const claimedAmount =
      Number(finalBalance.amount) - Number(initialBalance.amount);
    assert.ok(
      Math.abs(claimedAmount - expectedClaimable) <= 3_000_000,
      `Expected to claim ~${expectedClaimable}, but claimed ${claimedAmount}`
    );

    const updatedVestingAccount = await program.account.vestingAccount.fetch(
      vestingPda2
    );
    assert.strictEqual(
      updatedVestingAccount.claimedAmount.toNumber(),
      claimedAmount,
      "Claimed amount in vesting account should match the transferred amount"
    );

    console.log("Admin claimed tokens:", claimedAmount / 1e9);
  });

  it("Pauses and prevents claiming", async () => {
    await program.methods
      .pause()
      .accounts({
        vestingAccount: vestingPda2,
        vault: vaultPda,
        mint,
        admin: admin.publicKey,
      })
      .rpc();

    try {
      await program.methods
        .claim()
        .accounts({
          vestingAccount: vestingPda2,
          vault: vaultPda,
          vaultTokenAccount,
          mint,
          beneficiaryTokenAccount: beneficiaryTokenAccount2,
          beneficiary: beneficiary2.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([beneficiary2])
        .rpc();
      assert.fail("Should have failed while paused");
    } catch (err) {
      console.log("Expected failure while paused:", err.toString());
      assert.match(err.toString(), /Paused/);
    }
  });

  it("Pauses and prevents admin claiming", async () => {
    try {
      await program.methods
        .adminClaim()
        .accounts({
          vestingAccount: vestingPda2,
          vault: vaultPda,
          vaultTokenAccount,
          mint,
          beneficiaryTokenAccount: beneficiaryTokenAccount2,
          admin: admin.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc();
      assert.fail("Should have failed while paused for admin claim");
    } catch (err) {
      console.log(
        "Expected failure while paused for admin claim:",
        err.toString()
      );
      assert.match(err.toString(), /Paused/);
    }
  });

  it("Unpauses and allows claim", async () => {
    await program.methods
      .unpause()
      .accounts({
        vestingAccount: vestingPda2,
        vault: vaultPda,
        mint,
        admin: admin.publicKey,
      })
      .rpc();
  
    console.log("Waiting 40 seconds to allow more tokens to vest...");
    await new Promise((resolve) => setTimeout(resolve, 40000));
  
    const initialBalance = await getAccount(provider.connection, beneficiaryTokenAccount2);
    const vestingAccount = await program.account.vestingAccount.fetch(vestingPda2);
    const currentTs = Math.floor(Date.now() / 1000);
    const elapsed = currentTs - vestingAccount.startTime.toNumber();
    console.log("Elapsed time:", elapsed);
  
    let expectedClaimable = 0;
    if (elapsed > vestingAccount.cliffPeriod.toNumber()) {
      expectedClaimable =
        Math.floor(
          (vestingAccount.totalAmount.toNumber() * elapsed) /
            vestingAccount.duration.toNumber()
        ) - vestingAccount.claimedAmount.toNumber();
    }
  
    await program.methods
      .claim()
      .accounts({
        vestingAccount: vestingPda2,
        vault: vaultPda,
        vaultTokenAccount,
        mint,
        beneficiaryTokenAccount: beneficiaryTokenAccount2,
        beneficiary: beneficiary2.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([beneficiary2])
      .rpc();
  
    const finalBalance = await getAccount(provider.connection, beneficiaryTokenAccount2);
    const claimedAmount = Number(finalBalance.amount) - Number(initialBalance.amount);
    assert.ok(
      Math.abs(claimedAmount - expectedClaimable) <= 3_000_000,
      `Expected to claim ~${expectedClaimable}, but claimed ${claimedAmount}`
    );
  
    console.log("Claimed after unpause:", claimedAmount / 1e9);
  });

  it("Pauses the vault and prevents admin claim", async () => {
    await program.methods
      .pauseVault()
      .accounts({
        vault: vaultPda,
        mint,
        admin: admin.publicKey,
      })
      .rpc();

    const vaultState = await program.account.vault.fetch(vaultPda);
    assert.strictEqual(vaultState.paused, true, "Vault should be paused");

    try {
      await program.methods
        .adminClaim()
        .accounts({
          vestingAccount: vestingPda2,
          vault: vaultPda,
          vaultTokenAccount,
          mint,
          beneficiaryTokenAccount: beneficiaryTokenAccount2,
          admin: admin.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc();
      assert.fail("Should have failed while vault is paused for admin claim");
    } catch (err) {
      console.log(
        "Expected failure while vault paused for admin claim:",
        err.toString()
      );
      assert.match(err.toString(), /VaultPaused/);
    }

    await program.methods
      .unpauseVault()
      .accounts({
        vault: vaultPda,
        mint,
        admin: admin.publicKey,
      })
      .rpc();
  });

  it("Revokes a vesting account", async () => {
    await program.methods
      .revokeVesting()
      .accounts({
        vestingAccount: vestingPda2,
        vault: vaultPda,
        vaultTokenAccount,
        mint,
        recoveryDestination,
        admin: admin.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();

    const acc = await getAccount(provider.connection, recoveryDestination);
    console.log(
      "Recovered tokens from revoked vesting:",
      Number(acc.amount) / 1e9
    );
  });

  it("Fails to admin claim from a revoked vesting account", async () => {
    try {
      await program.methods
        .adminClaim()
        .accounts({
          vestingAccount: vestingPda2,
          vault: vaultPda,
          vaultTokenAccount,
          mint,
          beneficiaryTokenAccount: beneficiaryTokenAccount2,
          admin: admin.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc();
      assert.fail(
        "Should have failed because vesting account is revoked for admin claim"
      );
    } catch (err) {
      console.log(
        "Expected failure on admin claim from revoked account:",
        err.toString()
      );
      assert.match(err.toString(), /VestingRevoked/);
    }
  });

  it("Fails to claim from a revoked vesting account", async () => {
    const now = Math.floor(Date.now() / 1000);
    const [newVestingPda] = getVestingPda(vaultPda, mint, beneficiary4.publicKey);

    await program.methods
      .initializeVesting(
        new anchor.BN(now),
        new anchor.BN(30),
        new anchor.BN(300),
        new anchor.BN(250_000_000)
      )
      .accounts({
        vestingAccount: newVestingPda,
        vault: vaultPda,
        mint,
        beneficiary: beneficiary4.publicKey,
        payer: admin.publicKey,
        admin: admin.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    vestingPda4 = newVestingPda;

    const sourceTokenAccount = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      admin.payer,
      mint,
      admin.publicKey
    );

    await mintTo(
      provider.connection,
      admin.payer,
      mint,
      sourceTokenAccount.address,
      admin.publicKey,
      1_000_000_000
    );

    await program.methods
      .fundVaultExisting(new anchor.BN(500_000_000))
      .accounts({
        vault: vaultPda,
        mint,
        sourceTokenAccount: sourceTokenAccount.address,
        vaultTokenAccount,
        admin: admin.publicKey,
        payer: admin.publicKey, // Explicitly add payer
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();

    await program.methods
      .revokeVesting()
      .accounts({
        vestingAccount: vestingPda4,
        vault: vaultPda,
        vaultTokenAccount,
        mint,
        recoveryDestination,
        admin: admin.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();

    console.log("Waiting 40 seconds to pass cliff period...");
    await new Promise((resolve) => setTimeout(resolve, 40000));

    try {
      await program.methods
        .claim()
        .accounts({
          vestingAccount: vestingPda4,
          vault: vaultPda,
          vaultTokenAccount,
          mint,
          beneficiaryTokenAccount: beneficiaryTokenAccount4,
          beneficiary: beneficiary4.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([beneficiary4])
        .rpc();
      assert.fail("Should have failed because vesting account is revoked");
    } catch (err) {
      console.log(
        "Expected failure on claim from revoked account:",
        err.toString()
      );
      assert.match(err.toString(), /VestingRevoked/);
    }
  });

  it("Instantly unlocks a vesting account", async () => {
    const now = Math.floor(Date.now() / 1000);
    const [newVestingPda] = getVestingPda(vaultPda, mint, beneficiary5.publicKey);

    await program.methods
      .initializeVesting(
        new anchor.BN(now),
        new anchor.BN(30),
        new anchor.BN(300),
        new anchor.BN(250_000_000)
      )
      .accounts({
        vestingAccount: newVestingPda,
        vault: vaultPda,
        mint,
        beneficiary: beneficiary5.publicKey,
        payer: admin.publicKey,
        admin: admin.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    vestingPda5 = newVestingPda;

    const sourceTokenAccount = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      admin.payer,
      mint,
      admin.publicKey
    );

    await mintTo(
      provider.connection,
      admin.payer,
      mint,
      sourceTokenAccount.address,
      admin.publicKey,
      1_000_000_000
    );

    await program.methods
      .fundVaultExisting(new anchor.BN(500_000_000))
      .accounts({
        vault: vaultPda,
        mint,
        sourceTokenAccount: sourceTokenAccount.address,
        vaultTokenAccount,
        admin: admin.publicKey,
        payer: admin.publicKey, // Explicitly add payer
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();

    const initialBeneficiaryBalance = await getAccount(
      provider.connection,
      beneficiaryTokenAccount5
    );

    const listener = program.addEventListener(
      "instantUnlockEvent",
      (event, slot) => {
        assert.strictEqual(
          event.vestingAccount.toBase58(),
          newVestingPda.toBase58()
        );
        assert.strictEqual(
          event.beneficiary.toBase58(),
          beneficiary5.publicKey.toBase58()
        );
        assert.strictEqual(event.mint.toBase58(), mint.toBase58());
        assert.strictEqual(event.amount.toNumber(), 250_000_000);
      }
    );

    try {
      await program.methods
        .instantUnlock()
        .accounts({
          vestingAccount: vestingPda5,
          vault: vaultPda,
          vaultTokenAccount,
          mint,
          beneficiaryTokenAccount: beneficiaryTokenAccount5,
          admin: admin.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc();

      const finalBeneficiaryBalance = await getAccount(
        provider.connection,
        beneficiaryTokenAccount5
      );
      const expectedBalance =
        Number(initialBeneficiaryBalance.amount) + 250_000_000;
      assert.strictEqual(
        Number(finalBeneficiaryBalance.amount),
        expectedBalance,
        "Beneficiary should have received all remaining tokens"
      );

      const vestingAccount = await program.account.vestingAccount.fetch(
        newVestingPda
      );
      assert.strictEqual(
        vestingAccount.claimedAmount.toNumber(),
        vestingAccount.totalAmount.toNumber(),
        "All tokens should be marked as claimed"
      );
    } finally {
      await program.removeEventListener(listener);
    }
  });

  it("Emergency recovers vault", async () => {
    await program.methods
      .emergencyRecover()
      .accounts({
        vault: vaultPda,
        vaultTokenAccount,
        mint,
        recoveryDestination,
        admin: admin.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();

    const acc = await getAccount(provider.connection, recoveryDestination);
    console.log("Emergency recovered vault balance:", Number(acc.amount) / 1e9);
  });

  it("Gets the claimable amount for a vesting account", async () => {
      const now = Math.floor(Date.now() / 1000);
      const [newVestingPda] = getVestingPda(vaultPda, mint, beneficiary6.publicKey);

      await program.methods
        .initializeVesting(
          new anchor.BN(now),
          new anchor.BN(30),
          new anchor.BN(300),
          new anchor.BN(300_000_000)
        )
        .accounts({
          vestingAccount: newVestingPda,
          vault: vaultPda,
          mint,
          beneficiary: beneficiary6.publicKey,
          payer: admin.publicKey,
          admin: admin.publicKey, // Add admin account
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      vestingPda6 = newVestingPda;

      console.log("Waiting 40 seconds to pass cliff period...");
      await new Promise((resolve) => setTimeout(resolve, 40000));

      const vestingAccount = await program.account.vestingAccount.fetch(
        newVestingPda
      );
      const currentTs = Math.floor(Date.now() / 1000);
      const elapsed = currentTs - vestingAccount.startTime.toNumber();
      console.log("Elapsed time:", elapsed);

      let expectedClaimable = 0;
      if (elapsed > 30) {
        expectedClaimable =
          Math.floor((300_000_000 * elapsed) / 300) -
          vestingAccount.claimedAmount.toNumber();
      }

      const claimable = await program.methods
        .getClaimable()
        .accounts({
          vestingAccount: newVestingPda,
          vault: vaultPda,
          mint,
          beneficiary: beneficiary6.publicKey,
        })
        .view();

      assert.ok(
        Math.abs(claimable.toNumber() - expectedClaimable) <= 3_000_000,
        `Expected ~${expectedClaimable}, but got ${claimable.toNumber()}`
      );
  });

  it("Pauses and unpauses the entire vault", async () => {
    const pauseListener = program.addEventListener(
      "pauseVaultEvent",
      (event, slot) => {
        assert.strictEqual(event.vault.toBase58(), vaultPda.toBase58());
        assert.strictEqual(event.mint.toBase58(), mint.toBase58());
        assert.strictEqual(event.admin.toBase58(), admin.publicKey.toBase58());
      }
    );

    const unpauseListener = program.addEventListener(
      "unpauseVaultEvent",
      (event, slot) => {
        assert.strictEqual(event.vault.toBase58(), vaultPda.toBase58());
        assert.strictEqual(event.mint.toBase58(), mint.toBase58());
        assert.strictEqual(event.admin.toBase58(), admin.publicKey.toBase58());
      }
    );

    try {
      await program.methods
        .pauseVault()
        .accounts({
          vault: vaultPda,
          mint,
          admin: admin.publicKey,
        })
        .rpc();

      let vaultState = await program.account.vault.fetch(vaultPda);
      assert.strictEqual(vaultState.paused, true);

      await program.methods
        .unpauseVault()
        .accounts({
          vault: vaultPda,
          mint,
          admin: admin.publicKey,
        })
        .rpc();

      vaultState = await program.account.vault.fetch(vaultPda);
      assert.strictEqual(vaultState.paused, false);
    } finally {
      await program.removeEventListener(pauseListener);
      await program.removeEventListener(unpauseListener);
    }
  });

  it("Updates the admin", async () => {
    const listener = program.addEventListener(
      "updateAdminEvent",
      (event, slot) => {
        assert.strictEqual(event.vault.toBase58(), vaultPda.toBase58());
        assert.strictEqual(event.mint.toBase58(), mint.toBase58());
        assert.strictEqual(
          event.oldAdmin.toBase58(),
          admin.publicKey.toBase58()
        );
        assert.strictEqual(
          event.newAdmin.toBase58(),
          newAdmin.publicKey.toBase58()
        );
      }
    );

    try {
      await program.methods
        .updateAdmin(newAdmin.publicKey)
        .accounts({
          vault: vaultPda,
          mint,
          admin: admin.publicKey,
        })
        .rpc();

      const vaultState = await program.account.vault.fetch(vaultPda);
      console.log("Vault admin after update:", vaultState.admin.toBase58());
      console.log("newAdmin.publicKey:", newAdmin.publicKey.toBase58());
      assert.strictEqual(
        vaultState.admin.toBase58(),
        newAdmin.publicKey.toBase58()
      );
    } finally {
      await program.removeEventListener(listener);
    }
  });

  it("Verifies vault admin after update", async () => {
    const vaultState = await program.account.vault.fetch(vaultPda);
    console.log("Vault admin post-update:", vaultState.admin.toBase58());
    console.log("newAdmin.publicKey:", newAdmin.publicKey.toBase58());
    assert.strictEqual(
      vaultState.admin.toBase58(),
      newAdmin.publicKey.toBase58(),
      "Vault admin should be newAdmin.publicKey after update"
    );
  });

  it("Fails to update admin with unauthorized admin", async () => {
    const fakeAdmin = Keypair.generate();
    try {
      await program.methods
        .updateAdmin(fakeAdmin.publicKey)
        .accounts({
          vault: vaultPda,
          mint,
          admin: fakeAdmin.publicKey,
        })
        .signers([fakeAdmin])
        .rpc();
      assert.fail("Should have failed with unauthorized admin");
    } catch (err) {
      assert.match(err.toString(), /Unauthorized/);
    }
  });

  it("Fails to initialize vesting with unauthorized admin", async () => {
      const now = Math.floor(Date.now() / 1000);
      const unauthorizedAdmin = Keypair.generate();
      const newBeneficiary = Keypair.generate();
      const [newVestingPda] = getVestingPda(
        vaultPda,
        mint,
        newBeneficiary.publicKey
      );

      // Fund the unauthorized admin with SOL to cover transaction fees
      const signature = await provider.connection.requestAirdrop(
        unauthorizedAdmin.publicKey,
        1_000_000_000 // 1 SOL
      );
      await provider.connection.confirmTransaction(signature);

      try {
        await program.methods
          .initializeVesting(
            new anchor.BN(now),
            new anchor.BN(30),
            new anchor.BN(300),
            new anchor.BN(100_000_000)
          )
          .accounts({
            vestingAccount: newVestingPda,
            vault: vaultPda,
            mint,
            beneficiary: newBeneficiary.publicKey,
            payer: unauthorizedAdmin.publicKey,
            admin: unauthorizedAdmin.publicKey,
            systemProgram: SystemProgram.programId,
          })
          .signers([unauthorizedAdmin])
          .rpc();
        assert.fail("Should have failed with unauthorized admin");
      } catch (err) {
        console.log("Expected failure with unauthorized admin:", err.toString());
        assert.match(
          err.toString(),
          /Unauthorized/,
          "Expected Unauthorized error"
        );
      }
  });

  it("Initializes vesting with non-admin payer", async () => {
    const now = Math.floor(Date.now() / 1000);
    const nonAdminPayer = Keypair.generate();
    const newBeneficiary = Keypair.generate();
    const [newVestingPda] = getVestingPda(
      vaultPda,
      mint,
      newBeneficiary.publicKey
    );

    // Fund the non-admin payer with SOL to cover account creation
    const signature = await provider.connection.requestAirdrop(
      nonAdminPayer.publicKey,
      1_000_000_000 // 1 SOL
    );
    await provider.connection.confirmTransaction(signature);

    await program.methods
      .initializeVesting(
        new anchor.BN(now),
        new anchor.BN(30),
        new anchor.BN(300),
        new anchor.BN(100_000_000)
      )
      .accounts({
        vestingAccount: newVestingPda,
        vault: vaultPda,
        mint,
        beneficiary: newBeneficiary.publicKey,
        payer: nonAdminPayer.publicKey,
        admin: newAdmin.publicKey, // Use the current vault admin
        systemProgram: SystemProgram.programId,
      })
      .signers([nonAdminPayer, newAdmin])
      .rpc();

    const vestingAccount = await program.account.vestingAccount.fetch(newVestingPda);
    assert.strictEqual(
      vestingAccount.beneficiary.toBase58(),
      newBeneficiary.publicKey.toBase58(),
      "Beneficiary should match"
    );
    assert.strictEqual(
      vestingAccount.totalAmount.toNumber(),
      100_000_000,
      "Total amount should match"
    );
    assert.strictEqual(
      vestingAccount.initialized,
      true,
      "Vesting account should be initialized"
    );

    console.log("Successfully initialized vesting with non-admin payer");
});

  it("Batch initializes multiple vesting accounts", async () => {
    const now = Math.floor(Date.now() / 1000);
    batchBeneficiaries = [Keypair.generate(), Keypair.generate()];
    batchVestingPdas = batchBeneficiaries.map(
      (ben) => getVestingPda(vaultPda, mint, ben.publicKey)[0]
    );

    const args = batchBeneficiaries.map((ben) => ({
      beneficiary: ben.publicKey,
      mint,
      startTime: new anchor.BN(now),
      cliffPeriod: new anchor.BN(60),
      duration: new anchor.BN(600),
      totalAmount: new anchor.BN(100_000_000),
    }));

    try {
      const tx = await program.methods
        .batchInitializeVesting(args)
        .accounts({
          vault: vaultPda,
          mint,
          admin: newAdmin.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .remainingAccounts(
          batchVestingPdas.map((pda) => ({
            pubkey: pda,
            isWritable: true,
            isSigner: false,
          }))
        )
        .signers([newAdmin])
        .rpc({ commitment: "confirmed" });

      const txDetails = await provider.connection.getTransaction(tx, {
        commitment: "confirmed",
      });
      console.log("Compute units used:", txDetails.meta.computeUnitsConsumed);

      console.log("✅ Batch vesting setup complete!");

      for (let i = 0; i < batchVestingPdas.length; i++) {
        const vestingAccount = await program.account.vestingAccount.fetch(
          batchVestingPdas[i]
        );
        assert.strictEqual(
          vestingAccount.beneficiary.toBase58(),
          batchBeneficiaries[i].publicKey.toBase58()
        );
        assert.strictEqual(
          vestingAccount.mint.toBase58(),
          mint.toBase58()
        );
        assert.strictEqual(vestingAccount.initialized, true);
        assert.strictEqual(vestingAccount.totalAmount.toNumber(), 100_000_000);
      }
    } catch (err) {
      console.error("Batch initialize error:", err);
      throw err;
    }
  });

  it("Fails to pause with unauthorized admin", async () => {
    const fakeAdmin = Keypair.generate();
    try {
      await program.methods
        .pause()
        .accounts({
          vestingAccount: vestingPda2,
          vault: vaultPda,
          mint,
          admin: fakeAdmin.publicKey,
        })
        .signers([fakeAdmin])
        .rpc();
      assert.fail("Should have failed with unauthorized admin");
    } catch (err) {
      assert.match(err.toString(), /Unauthorized/);
    }
  });

  it("Fails to admin claim with unauthorized admin", async () => {
    const fakeAdmin = Keypair.generate();

    const signature = await provider.connection.requestAirdrop(
      fakeAdmin.publicKey,
      1_000_000_000
    );
    await provider.connection.confirmTransaction(signature);

    try {
      await program.methods
        .adminClaim()
        .accounts({
          vestingAccount: vestingPda2,
          vault: vaultPda,
          vaultTokenAccount,
          mint,
          beneficiaryTokenAccount: beneficiaryTokenAccount2,
          admin: fakeAdmin.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([fakeAdmin])
        .rpc();
      assert.fail("Should have failed with unauthorized admin for admin claim");
    } catch (err) {
      console.log(
        "Expected failure for admin claim with unauthorized admin:",
        err.toString()
      );
      assert.match(err.toString(), /Unauthorized/);
    }
  });

  it("Fails to unpause with unauthorized admin", async () => {
    const fakeAdmin = Keypair.generate();
    try {
      await program.methods
        .unpause()
        .accounts({
          vestingAccount: vestingPda2,
          vault: vaultPda,
          mint,
          admin: fakeAdmin.publicKey,
        })
        .signers([fakeAdmin])
        .rpc();
      assert.fail("Should have failed with unauthorized admin");
    } catch (err) {
      assert.match(err.toString(), /Unauthorized/);
    }
  });

  it("Fails to revoke vesting with unauthorized admin", async () => {
    const fakeAdmin = Keypair.generate();
    try {
      await program.methods
        .revokeVesting()
        .accounts({
          vestingAccount: vestingPda2,
          vault: vaultPda,
          vaultTokenAccount,
          mint,
          recoveryDestination,
          admin: fakeAdmin.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([fakeAdmin])
        .rpc();
      assert.fail("Should have failed with unauthorized admin");
    } catch (err) {
      assert.match(err.toString(), /Unauthorized/);
    }
  });

  it("Fails to emergency recover with unauthorized admin", async () => {
    const fakeAdmin = Keypair.generate();
    try {
      await program.methods
        .emergencyRecover()
        .accounts({
          vault: vaultPda,
          vaultTokenAccount,
          mint,
          recoveryDestination,
          admin: fakeAdmin.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([fakeAdmin])
        .rpc();
      assert.fail("Should have failed with unauthorized admin");
    } catch (err) {
      assert.match(err.toString(), /Unauthorized/);
    }
  });

  it("Fails to fund vault with unauthorized admin", async () => {
    const fakeAdmin = Keypair.generate();
    const sourceTokenAccount = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      admin.payer,
      mint,
      fakeAdmin.publicKey
    );

    // Fund fakeAdmin with SOL to cover transaction fees
    const signature = await provider.connection.requestAirdrop(
      fakeAdmin.publicKey,
      1_000_000_000 // 1 SOL
    );
    await provider.connection.confirmTransaction(signature);

    // Mint tokens to sourceTokenAccount to avoid insufficient funds error
    await mintTo(
      provider.connection,
      admin.payer,
      mint,
      sourceTokenAccount.address,
      admin.publicKey, // Mint authority
      1_000_000_000 // Mint 1 billion tokens (same as other tests)
    );

    try {
      await program.methods
        .fundVaultExisting(new anchor.BN(100_000))
        .accounts({
          vault: vaultPda,
          mint,
          sourceTokenAccount: sourceTokenAccount.address,
          vaultTokenAccount,
          admin: fakeAdmin.publicKey,
          payer: fakeAdmin.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([fakeAdmin])
        .rpc();
      assert.fail("Should have failed with unauthorized admin");
    } catch (err) {
      assert.match(err.toString(), /Unauthorized/);
    }
  });

  it("Fails to batch initialize with too many accounts", async () => {
    const now = Math.floor(Date.now() / 1000);
    const maxAccounts = 4; // Reduced to avoid transaction size limit
    const beneficiaries = Array(maxAccounts + 1)
      .fill(0)
      .map(() => Keypair.generate());
    const vestingPdas = beneficiaries.map(
      (ben) => getVestingPda(vaultPda, mint, ben.publicKey)[0]
    );
  
    const args = beneficiaries.map((ben) => ({
      beneficiary: ben.publicKey,
      mint,
      startTime: new anchor.BN(now),
      cliffPeriod: new anchor.BN(60),
      duration: new anchor.BN(600),
      totalAmount: new anchor.BN(100_000_000),
    }));
  
    const remainingAccounts = [];
    for (let i = 0; i < beneficiaries.length; i++) {
      remainingAccounts.push({
        pubkey: vestingPdas[i],
        isWritable: true,
        isSigner: false,
      });
      remainingAccounts.push({
        pubkey: await getAssociatedTokenAddress(mint, beneficiaries[i].publicKey),
        isWritable: true,
        isSigner: false,
      });
    }
  
    try {
      await program.methods
        .batchInitializeVesting(args)
        .accounts({
          vault: vaultPda,
          vaultToken: await getAssociatedTokenAddress(mint, vaultPda, true),
          mint,
          admin: newAdmin.publicKey,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .remainingAccounts(remainingAccounts)
        .signers([newAdmin])
        .rpc();
      assert.fail("Should have failed with too many accounts");
    } catch (err) {
      console.log("Expected failure with too many accounts:", err.toString());
      assert.match(err.toString(), /TooManyAccounts/, "Expected TooManyAccounts error");
    }
  });

  it("Emits PauseEvent when pausing", async () => {
    const listener = program.addEventListener("pauseEvent", (event, slot) => {
      assert.strictEqual(
        event.vestingAccount.toBase58(),
        vestingPda2.toBase58()
      );
      assert.strictEqual(event.mint.toBase58(), mint.toBase58());
      assert.strictEqual(event.admin.toBase58(), newAdmin.publicKey.toBase58());
    });

    try {
      await program.methods
        .pause()
        .accounts({
          vestingAccount: vestingPda2,
          vault: vaultPda,
          mint,
          admin: newAdmin.publicKey,
        })
        .signers([newAdmin])
        .rpc();
    } finally {
      await program.removeEventListener(listener);
    }
  });

  it("Emits ClaimEvent when admin claims", async () => {
    const sourceTokenAccount = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      admin.payer,
      mint,
      newAdmin.publicKey
    );

    await mintTo(
      provider.connection,
      admin.payer,
      mint,
      sourceTokenAccount.address,
      admin.publicKey,
      1_000_000_000
    );

    await program.methods
      .fundVaultExisting(new anchor.BN(500_000_000))
      .accounts({
        vault: vaultPda,
        mint,
        sourceTokenAccount: sourceTokenAccount.address,
        vaultTokenAccount,
        admin: newAdmin.publicKey,
        payer: newAdmin.publicKey, // Explicitly add payer
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([newAdmin])
      .rpc();

    const listener = program.addEventListener("claimEvent", (event, slot) => {
      assert.strictEqual(
        event.vestingAccount.toBase58(),
        vestingPda1.toBase58()
      );
      assert.strictEqual(
        event.beneficiary.toBase58(),
        beneficiary1.publicKey.toBase58()
      );
      assert.ok(
        event.amount.toNumber() > 0,
        "Claimed amount should be greater than 0"
      );
    });

    try {
      await program.methods
        .adminClaim()
        .accounts({
          vestingAccount: vestingPda1,
          vault: vaultPda,
          vaultTokenAccount,
          mint,
          beneficiaryTokenAccount: beneficiaryTokenAccount1,
          admin: newAdmin.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([newAdmin])
        .rpc();
    } finally {
      await program.removeEventListener(listener);
    }
  });

  it("Fails to initialize vesting before vault initialization", async () => {
      const [newVaultPda] = getVaultPda(new PublicKey("11111111111111111111111111111111"));
      const now = Math.floor(Date.now() / 1000);
      const [newVestingPda] = getVestingPda(newVaultPda, mint, beneficiary1.publicKey);

      try {
        await program.methods
          .initializeVesting(
            new anchor.BN(now),
            new anchor.BN(30),
            new anchor.BN(300),
            new anchor.BN(250_000_000)
          )
          .accounts({
            vestingAccount: newVestingPda,
            vault: newVaultPda,
            mint,
            beneficiary: beneficiary1.publicKey,
            payer: admin.publicKey,
            admin: admin.publicKey,
            systemProgram: SystemProgram.programId,
          })
          .rpc();
        assert.fail("Should have failed because vault is not initialized");
      } catch (err) {
        console.log("Expected failure:", err.toString());
        assert.match(err.toString(), /AccountNotInitialized/);
      }
  });

  it("Batch initializes 5 vesting accounts", async () => {
    const now = Math.floor(Date.now() / 1000);
    const beneficiaries = Array(3) // Reduced to 3 to avoid TooManyAccounts
      .fill(0)
      .map(() => Keypair.generate());
    const vestingPdas = beneficiaries.map(
      (ben) => getVestingPda(vaultPda, mint, ben.publicKey)[0]
    );
  
    const args = beneficiaries.map((ben) => ({
      beneficiary: ben.publicKey,
      mint,
      startTime: new anchor.BN(now),
      cliffPeriod: new anchor.BN(60),
      duration: new anchor.BN(600),
      totalAmount: new anchor.BN(100_000_000),
    }));
  
    const remainingAccounts = vestingPdas.map((pda) => ({
      pubkey: pda,
      isWritable: true,
      isSigner: false,
    }));
  
    console.log("Remaining accounts count:", remainingAccounts.length);
    console.log("Vesting PDAs:", vestingPdas.map(pda => pda.toBase58()));
  
    try {
      const tx = await program.methods
        .batchInitializeVesting(args)
        .accounts({
          vault: vaultPda,
          mint,
          admin: newAdmin.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .remainingAccounts(remainingAccounts)
        .signers([newAdmin])
        .rpc({ commitment: "confirmed" });
  
      const txDetails = await provider.connection.getTransaction(tx, {
        commitment: "confirmed",
      });
      console.log(
        "Compute units used for 3 accounts:",
        txDetails.meta.computeUnitsConsumed
      );
  
      console.log("✅ Batch vesting setup complete for 3 accounts!");
  
      for (let i = 0; i < vestingPdas.length; i++) {
        const vestingAccount = await program.account.vestingAccount.fetch(
          vestingPdas[i]
        );
        assert.strictEqual(
          vestingAccount.beneficiary.toBase58(),
          beneficiaries[i].publicKey.toBase58()
        );
        assert.strictEqual(
          vestingAccount.mint.toBase58(),
          mint.toBase58()
        );
        assert.strictEqual(vestingAccount.initialized, true);
        assert.strictEqual(vestingAccount.totalAmount.toNumber(), 100_000_000);
      }
    } catch (err) {
      console.error("Batch initialize error:", err);
      throw err;
    }
  });

  it("Batch initializes 1 vesting account with v2 instruction", async () => {
    const now = Math.floor(Date.now() / 1000);
    console.log("Testing batchInitializeVestingV2 with 1 account");
  
    const beneficiaries = [Keypair.generate()];
    const vestingPdas = beneficiaries.map(
      (ben) => getVestingPda(vaultPda, mint, ben.publicKey)[0]
    );
  
    const args = beneficiaries.map((ben) => ({
      beneficiary: ben.publicKey,
      mint,
      startTime: new anchor.BN(now),
      cliffPeriod: new anchor.BN(60),
      duration: new anchor.BN(600),
      totalAmount: new anchor.BN(100_000_000),
    }));
  
    const remainingAccounts = [];
    for (let i = 0; i < beneficiaries.length; i++) {
      remainingAccounts.push({
        pubkey: vestingPdas[i],
        isWritable: true,
        isSigner: false,
      });
      remainingAccounts.push({
        pubkey: beneficiaries[i].publicKey,
        isWritable: false,
        isSigner: false,
      });
    }
  
    console.log("Remaining accounts count:", remainingAccounts.length);
    console.log("Vesting PDAs:", vestingPdas.map(pda => pda.toBase58()));
  
    const emittedVestingAccounts: PublicKey[] = [];
    const listener = program.addEventListener(
      "batchInitializeVestingEvent",
      (event, slot) => {
        assert.strictEqual(event.vault.toBase58(), vaultPda.toBase58());
        assert.strictEqual(event.mint.toBase58(), mint.toBase58());
        assert.strictEqual(
          event.admin.toBase58(),
          newAdmin.publicKey.toBase58()
        );
        assert.strictEqual(event.numAccounts.toNumber(), 1);
        emittedVestingAccounts.push(event.vestingAccount);
      }
    );
  
    try {
      const tx = await program.methods
        .batchInitializeVestingV2(args)
        .accounts({
          vault: vaultPda,
          mint,
          admin: newAdmin.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .remainingAccounts(remainingAccounts)
        .signers([newAdmin])
        .rpc({ commitment: "confirmed" });
  
      const txDetails = await provider.connection.getTransaction(tx, {
        commitment: "confirmed",
      });
      console.log(
        "Compute units used for 1 account:",
        txDetails.meta.computeUnitsConsumed
      );
  
      const vestingAccount = await program.account.vestingAccount.fetch(
        vestingPdas[0]
      );
      assert.strictEqual(
        vestingAccount.beneficiary.toBase58(),
        beneficiaries[0].publicKey.toBase58(),
        "Beneficiary mismatch"
      );
      assert.strictEqual(
        vestingAccount.mint.toBase58(),
        mint.toBase58(),
        "Mint mismatch"
      );
      assert.strictEqual(
        vestingAccount.totalAmount.toNumber(),
        100_000_000,
        "Total amount mismatch"
      );
      assert.strictEqual(
        vestingAccount.startTime.toNumber(),
        now,
        "Start time mismatch"
      );
      assert.strictEqual(
        vestingAccount.cliffPeriod.toNumber(),
        60,
        "Cliff period mismatch"
      );
      assert.strictEqual(
        vestingAccount.duration.toNumber(),
        600,
        "Duration mismatch"
      );
      assert.strictEqual(
        vestingAccount.initialized,
        true,
        "Initialized flag mismatch"
      );
      assert.strictEqual(
        vestingAccount.revoked,
        false,
        "Revoked flag mismatch"
      );
      assert.strictEqual(vestingAccount.paused, false, "Paused flag mismatch");
  
      assert.strictEqual(
        emittedVestingAccounts.length,
        1,
        "Expected 1 BatchInitializeVestingEvent emission"
      );
      assert.strictEqual(
        emittedVestingAccounts[0].toBase58(),
        vestingPdas[0].toBase58(),
        "Event vesting account mismatch"
      );
  
      console.log("✅ Batch vesting v2 setup complete for 1 account!");
    } catch (err) {
      console.error("Batch initialize v2 error for 1 account:", err);
      throw err;
    } finally {
      await program.removeEventListener(listener);
    }
  });
  
  it("Batch initializes 2 vesting accounts with v2 instruction", async () => {
    const now = Math.floor(Date.now() / 1000);
    console.log("Testing batchInitializeVestingV2 with 2 accounts");

    const beneficiaries = [Keypair.generate(), Keypair.generate()];
    const vestingPdas = beneficiaries.map(
      (ben) => getVestingPda(vaultPda, mint, ben.publicKey)[0]
    );

    const args = beneficiaries.map((ben) => ({
      beneficiary: ben.publicKey,
      mint,
      startTime: new anchor.BN(now),
      cliffPeriod: new anchor.BN(60),
      duration: new anchor.BN(600),
      totalAmount: new anchor.BN(100_000_000),
    }));

    const remainingAccounts = [];
    for (let i = 0; i < vestingPdas.length; i++) {
      remainingAccounts.push({
        pubkey: vestingPdas[i],
        isWritable: true,
        isSigner: false,
      });
      remainingAccounts.push({
        pubkey: beneficiaries[i].publicKey,
        isWritable: false,
        isSigner: false,
      });
    }

    const emittedVestingAccounts: PublicKey[] = [];
    const listener = program.addEventListener(
      "batchInitializeVestingEvent",
      (event, slot) => {
        assert.strictEqual(event.vault.toBase58(), vaultPda.toBase58());
        assert.strictEqual(event.mint.toBase58(), mint.toBase58());
        assert.strictEqual(
          event.admin.toBase58(),
          newAdmin.publicKey.toBase58()
        );
        assert.strictEqual(event.numAccounts.toNumber(), 1);
        emittedVestingAccounts.push(event.vestingAccount);
      }
    );

    try {
      const tx = await program.methods
        .batchInitializeVestingV2(args)
        .accounts({
          vault: vaultPda,
          mint,
          admin: newAdmin.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .remainingAccounts(remainingAccounts)
        .signers([newAdmin])
        .rpc({ commitment: "confirmed" });

      const txDetails = await provider.connection.getTransaction(tx, {
        commitment: "confirmed",
      });
      console.log(
        "Compute units used for 2 accounts:",
        txDetails.meta.computeUnitsConsumed
      );

      for (let i = 0; i < 2; i++) {
        const vestingAccount = await program.account.vestingAccount.fetch(
          vestingPdas[i]
        );
        assert.strictEqual(
          vestingAccount.beneficiary.toBase58(),
          beneficiaries[i].publicKey.toBase58(),
          `Beneficiary ${i} mismatch`
        );
        assert.strictEqual(
          vestingAccount.mint.toBase58(),
          mint.toBase58(),
          `Mint ${i} mismatch`
        );
        assert.strictEqual(
          vestingAccount.totalAmount.toNumber(),
          100_000_000,
          `Total amount mismatch for beneficiary ${i}`
        );
        assert.strictEqual(
          vestingAccount.startTime.toNumber(),
          now,
          `Start time mismatch for beneficiary ${i}`
        );
        assert.strictEqual(
          vestingAccount.cliffPeriod.toNumber(),
          60,
          `Cliff period mismatch for beneficiary ${i}`
        );
        assert.strictEqual(
          vestingAccount.duration.toNumber(),
          600,
          `Duration mismatch for beneficiary ${i}`
        );
        assert.strictEqual(
          vestingAccount.initialized,
          true,
          `Initialized flag mismatch for beneficiary ${i}`
        );
        assert.strictEqual(
          vestingAccount.revoked,
          false,
          `Revoked flag mismatch for beneficiary ${i}`
        );
        assert.strictEqual(
          vestingAccount.paused,
          false,
          `Paused flag mismatch for beneficiary ${i}`
        );
      }

      assert.strictEqual(
        emittedVestingAccounts.length,
        2,
        "Expected 2 BatchInitializeVestingEvent emissions"
      );
      for (let i = 0; i < 2; i++) {
        assert.strictEqual(
          emittedVestingAccounts[i].toBase58(),
          vestingPdas[i].toBase58(),
          `Event ${i} vesting account mismatch`
        );
      }

      console.log("✅ Batch vesting v2 setup complete for 2 accounts!");
    } catch (err) {
      console.error("Batch initialize v2 error for 2 accounts:", err);
      throw err;
    } finally {
      await program.removeEventListener(listener);
    }
  });

  it("Batch initializes 3 vesting accounts with v2 instruction", async () => {
    const now = Math.floor(Date.now() / 1000);
    console.log("Testing batchInitializeVestingV2 with 3 accounts");

    const beneficiaries = [
      Keypair.generate(),
      Keypair.generate(),
      Keypair.generate(),
    ];
    const vestingPdas = beneficiaries.map(
      (ben) => getVestingPda(vaultPda, mint, ben.publicKey)[0]
    );

    const args = beneficiaries.map((ben) => ({
      beneficiary: ben.publicKey,
      mint,
      startTime: new anchor.BN(now),
      cliffPeriod: new anchor.BN(60),
      duration: new anchor.BN(600),
      totalAmount: new anchor.BN(100_000_000),
    }));

    const remainingAccounts = [];
    for (let i = 0; i < vestingPdas.length; i++) {
      remainingAccounts.push({
        pubkey: vestingPdas[i],
        isWritable: true,
        isSigner: false,
      });
      remainingAccounts.push({
        pubkey: beneficiaries[i].publicKey,
        isWritable: false,
        isSigner: false,
      });
    }

    const emittedVestingAccounts: PublicKey[] = [];
    const listener = program.addEventListener(
      "batchInitializeVestingEvent",
      (event, slot) => {
        assert.strictEqual(event.vault.toBase58(), vaultPda.toBase58());
        assert.strictEqual(event.mint.toBase58(), mint.toBase58());
        assert.strictEqual(
          event.admin.toBase58(),
          newAdmin.publicKey.toBase58()
        );
        assert.strictEqual(event.numAccounts.toNumber(), 1);
        emittedVestingAccounts.push(event.vestingAccount);
      }
    );

    try {
      const tx = await program.methods
        .batchInitializeVestingV2(args)
        .accounts({
          vault: vaultPda,
          mint,
          admin: newAdmin.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .remainingAccounts(remainingAccounts)
        .signers([newAdmin])
        .rpc({ commitment: "confirmed" });

      const txDetails = await provider.connection.getTransaction(tx, {
        commitment: "confirmed",
      });
      console.log(
        "Compute units used for 3 accounts:",
        txDetails.meta.computeUnitsConsumed
      );

      for (let i = 0; i < 3; i++) {
        const vestingAccount = await program.account.vestingAccount.fetch(
          vestingPdas[i]
        );
        assert.strictEqual(
          vestingAccount.beneficiary.toBase58(),
          beneficiaries[i].publicKey.toBase58(),
          `Beneficiary ${i} mismatch`
        );
        assert.strictEqual(
          vestingAccount.mint.toBase58(),
          mint.toBase58(),
          `Mint ${i} mismatch`
        );
        assert.strictEqual(
          vestingAccount.totalAmount.toNumber(),
          100_000_000,
          `Total amount mismatch for beneficiary ${i}`
        );
        assert.strictEqual(
          vestingAccount.startTime.toNumber(),
          now,
          `Start time mismatch for beneficiary ${i}`
        );
        assert.strictEqual(
          vestingAccount.cliffPeriod.toNumber(),
          60,
          `Cliff period mismatch for beneficiary ${i}`
        );
        assert.strictEqual(
          vestingAccount.duration.toNumber(),
          600,
          `Duration mismatch for beneficiary ${i}`
        );
        assert.strictEqual(
          vestingAccount.initialized,
          true,
          `Initialized flag mismatch for beneficiary ${i}`
        );
        assert.strictEqual(
          vestingAccount.revoked,
          false,
          `Revoked flag mismatch for beneficiary ${i}`
        );
        assert.strictEqual(
          vestingAccount.paused,
          false,
          `Paused flag mismatch for beneficiary ${i}`
        );
      }

      assert.strictEqual(
        emittedVestingAccounts.length,
        3,
        "Expected 3 BatchInitializeVestingEvent emissions"
      );
      for (let i = 0; i < 3; i++) {
        assert.strictEqual(
          emittedVestingAccounts[i].toBase58(),
          vestingPdas[i].toBase58(),
          `Event ${i} vesting account mismatch`
        );
      }

      console.log("✅ Batch vesting v2 setup complete for 3 accounts!");
    } catch (err) {
      console.error("Batch initialize v2 error for 3 accounts:", err);
      throw err;
    } finally {
      await program.removeEventListener(listener);
    }
  });

  it("Fails to batch initialize v2 with too many accounts", async () => {
    const now = Math.floor(Date.now() / 1000);
    const maxAccounts = 4; // Reduced to avoid transaction size limit
    const beneficiaries = Array(maxAccounts + 1)
      .fill(0)
      .map(() => Keypair.generate());
    const vestingPdas = beneficiaries.map(
      (ben) => getVestingPda(vaultPda, mint, ben.publicKey)[0]
    );
  
    const args = beneficiaries.map((ben) => ({
      beneficiary: ben.publicKey,
      mint,
      startTime: new anchor.BN(now),
      cliffPeriod: new anchor.BN(60),
      duration: new anchor.BN(600),
      totalAmount: new anchor.BN(100_000_000),
    }));
  
    const remainingAccounts = [];
    for (let i = 0; i < beneficiaries.length; i++) {
      remainingAccounts.push({
        pubkey: vaultTokenAccount, // Add vaultToken as required
        isWritable: true,
        isSigner: false,
      });
      remainingAccounts.push({
        pubkey: vestingPdas[i],
        isWritable: true,
        isSigner: false,
      });
      remainingAccounts.push({
        pubkey: await getAssociatedTokenAddress(mint, beneficiaries[i].publicKey),
        isWritable: true,
        isSigner: false,
      });
    }
  
    try {
      await program.methods
        .batchInitializeVestingV2(args)
        .accounts({
          vault: vaultPda,
          vaultToken: vaultTokenAccount,
          mint,
          admin: newAdmin.publicKey,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .remainingAccounts(remainingAccounts)
        .signers([newAdmin])
        .rpc();
      assert.fail("Should have failed with too many accounts");
    } catch (err) {
      console.log("Expected failure with too many accounts:", err.toString());
      assert.match(err.toString(), /TooManyAccounts/, "Expected TooManyAccounts error");
    }
  });
  
  it("Fails to batch initialize v2 with uninitialized vault", async () => {
    const now = Math.floor(Date.now() / 1000);
    const [uninitializedVaultPda] = getVaultPda(new PublicKey("11111111111111111111111111111111"));
    const beneficiaries = [Keypair.generate()];
    const vestingPdas = beneficiaries.map(
      (ben) => getVestingPda(uninitializedVaultPda, mint, ben.publicKey)[0]
    );

    const args = beneficiaries.map((ben) => ({
      beneficiary: ben.publicKey,
      mint,
      startTime: new anchor.BN(now),
      cliffPeriod: new anchor.BN(60),
      duration: new anchor.BN(600),
      totalAmount: new anchor.BN(100_000_000),
    }));

    const remainingAccounts = [];
    for (let i = 0; i < vestingPdas.length; i++) {
      remainingAccounts.push({
        pubkey: vestingPdas[i],
        isWritable: true,
        isSigner: false,
      });
      remainingAccounts.push({
        pubkey: beneficiaries[i].publicKey,
        isWritable: false,
        isSigner: false,
      });
    }

    try {
      await program.methods
        .batchInitializeVestingV2(args)
        .accounts({
          vault: uninitializedVaultPda,
          mint,
          admin: newAdmin.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .remainingAccounts(remainingAccounts)
        .signers([newAdmin])
        .rpc();
      assert.fail("Should have failed with uninitialized vault");
    } catch (err) {
      console.log("Expected failure with uninitialized vault:", err.toString());
      assert.match(err.toString(), /AccountNotInitialized/);
    }
  });

  it("Fails to batch initialize v2 with unauthorized admin", async () => {
    const now = Math.floor(Date.now() / 1000);
    const fakeAdmin = Keypair.generate();
    const beneficiaries = [Keypair.generate()];
    const vestingPdas = beneficiaries.map(
      (ben) => getVestingPda(vaultPda, mint, ben.publicKey)[0]
    );

    const args = beneficiaries.map((ben) => ({
      beneficiary: ben.publicKey,
      mint,
      startTime: new anchor.BN(now),
      cliffPeriod: new anchor.BN(60),
      duration: new anchor.BN(600),
      totalAmount: new anchor.BN(100_000_000),
    }));

    const remainingAccounts = [];
    for (let i = 0; i < vestingPdas.length; i++) {
      remainingAccounts.push({
        pubkey: vestingPdas[i],
        isWritable: true,
        isSigner: false,
      });
      remainingAccounts.push({
        pubkey: beneficiaries[i].publicKey,
        isWritable: false,
        isSigner: false,
      });
    }

    const signature = await provider.connection.requestAirdrop(
      fakeAdmin.publicKey,
      1_000_000_000
    );
    await provider.connection.confirmTransaction(signature);

    try {
      await program.methods
        .batchInitializeVestingV2(args)
        .accounts({
          vault: vaultPda,
          mint,
          admin: fakeAdmin.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .remainingAccounts(remainingAccounts)
        .signers([fakeAdmin])
        .rpc();
      assert.fail("Should have failed with unauthorized admin");
    } catch (err) {
      console.log("Expected failure with unauthorized admin:", err.toString());
      assert.match(err.toString(), /Unauthorized/);
    }
  });

  it("Emits PauseVaultEvent when pausing the vault", async () => {
    const listener = program.addEventListener(
      "pauseVaultEvent",
      (event, slot) => {
        assert.strictEqual(event.vault.toBase58(), vaultPda.toBase58());
        assert.strictEqual(event.mint.toBase58(), mint.toBase58());
        assert.strictEqual(
          event.admin.toBase58(),
          newAdmin.publicKey.toBase58()
        );
      }
    );

    try {
      await program.methods
        .pauseVault()
        .accounts({
          vault: vaultPda,
          mint,
          admin: newAdmin.publicKey,
        })
        .signers([newAdmin])
        .rpc();

      let vaultState = await program.account.vault.fetch(vaultPda);
      assert.strictEqual(vaultState.paused, true);
    } finally {
      await program.removeEventListener(listener);
    }
  });

  it("Emits UnpauseVaultEvent when unpausing the vault", async () => {
    const listener = program.addEventListener(
      "unpauseVaultEvent",
      (event, slot) => {
        assert.strictEqual(event.vault.toBase58(), vaultPda.toBase58());
        assert.strictEqual(event.mint.toBase58(), mint.toBase58());
        assert.strictEqual(
          event.admin.toBase58(),
          newAdmin.publicKey.toBase58()
        );
      }
    );

    try {
      await program.methods
        .unpauseVault()
        .accounts({
          vault: vaultPda,
          mint,
          admin: newAdmin.publicKey,
        })
        .signers([newAdmin])
        .rpc();

      let vaultState = await program.account.vault.fetch(vaultPda);
      assert.strictEqual(vaultState.paused, false);
    } finally {
      await program.removeEventListener(listener);
    }
  });

  it("Reinitializes a revoked vesting account", async () => {
    const now = Math.floor(Date.now() / 1000);
    const beneficiary = Keypair.generate();
    const [vestingPda] = getVestingPda(vaultPda, mint, beneficiary.publicKey);

    await program.methods
      .initializeVesting(
        new anchor.BN(now),
        new anchor.BN(30),
        new anchor.BN(300),
        new anchor.BN(123_000_000)
      )
      .accounts({
        vestingAccount: vestingPda,
        vault: vaultPda,
        mint,
        beneficiary: beneficiary.publicKey,
        payer: newAdmin.publicKey,
        admin: newAdmin.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([newAdmin])
      .rpc();

    const sourceTokenAccount = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      admin.payer,
      mint,
      newAdmin.publicKey
    );

    await mintTo(
      provider.connection,
      admin.payer,
      mint,
      sourceTokenAccount.address,
      admin.publicKey,
      1_000_000_000
    );

    await program.methods
      .fundVaultExisting(new anchor.BN(500_000_000))
      .accounts({
        vault: vaultPda,
        mint,
        sourceTokenAccount: sourceTokenAccount.address,
        vaultTokenAccount,
        admin: newAdmin.publicKey,
        payer: newAdmin.publicKey, // Explicitly add payer
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([newAdmin])
      .rpc();

    await program.methods
      .revokeVesting()
      .accounts({
        vestingAccount: vestingPda,
        vault: vaultPda,
        vaultTokenAccount,
        mint,
        recoveryDestination,
        admin: newAdmin.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([newAdmin])
      .rpc();

    const revokedAccount = await program.account.vestingAccount.fetch(
      vestingPda
    );
    assert.strictEqual(revokedAccount.revoked, true);
    assert.strictEqual(revokedAccount.mint.toBase58(), mint.toBase58());

    const reinitTime = now + 500;
    await program.methods
      .reinitializeVesting(
        new anchor.BN(reinitTime),
        new anchor.BN(10),
        new anchor.BN(100),
        new anchor.BN(456_000_000)
      )
      .accounts({
        vestingAccount: vestingPda,
        vault: vaultPda,
        mint,
        beneficiary: beneficiary.publicKey,
        payer: newAdmin.publicKey,
        admin: newAdmin.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([newAdmin])
      .rpc();

    const reinitialized = await program.account.vestingAccount.fetch(
      vestingPda
    );
    assert.strictEqual(reinitialized.revoked, false);
    assert.strictEqual(reinitialized.paused, false);
    assert.strictEqual(reinitialized.claimedAmount.toNumber(), 0);
    assert.strictEqual(reinitialized.totalAmount.toNumber(), 456_000_000);
    assert.strictEqual(reinitialized.startTime.toNumber(), reinitTime);
    assert.strictEqual(reinitialized.cliffPeriod.toNumber(), 10);
    assert.strictEqual(reinitialized.duration.toNumber(), 100);
    assert.strictEqual(reinitialized.mint.toBase58(), mint.toBase58());
    assert.strictEqual(
      reinitialized.beneficiary.toBase58(),
      beneficiary.publicKey.toBase58()
    );

    console.log("✅ Reinitialized vesting account successfully");
  });

  it("Reinitializes a revoked vesting account with non-admin payer", async () => {
    const now = Math.floor(Date.now() / 1000);
    const nonAdminPayer = Keypair.generate();
    const beneficiary = Keypair.generate();
    const [vestingPda] = getVestingPda(vaultPda, mint, beneficiary.publicKey);

    // Fund the non-admin payer with SOL
    const signature = await provider.connection.requestAirdrop(
      nonAdminPayer.publicKey,
      1_000_000_000 // 1 SOL
    );
    await provider.connection.confirmTransaction(signature);

    await program.methods
      .initializeVesting(
        new anchor.BN(now),
        new anchor.BN(30),
        new anchor.BN(300),
        new anchor.BN(123_000_000)
      )
      .accounts({
        vestingAccount: vestingPda,
        vault: vaultPda,
        mint,
        beneficiary: beneficiary.publicKey,
        payer: newAdmin.publicKey,
        admin: newAdmin.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([newAdmin])
      .rpc();

    const sourceTokenAccount = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      admin.payer,
      mint,
      newAdmin.publicKey
    );

    await mintTo(
      provider.connection,
      admin.payer,
      mint,
      sourceTokenAccount.address,
      admin.publicKey,
      1_000_000_000
    );

    await program.methods
      .fundVaultExisting(new anchor.BN(500_000_000))
      .accounts({
        vault: vaultPda,
        mint,
        sourceTokenAccount: sourceTokenAccount.address,
        vaultTokenAccount,
        admin: newAdmin.publicKey,
        payer: newAdmin.publicKey, // Explicitly add payer
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([newAdmin])
      .rpc();

    await program.methods
      .revokeVesting()
      .accounts({
        vestingAccount: vestingPda,
        vault: vaultPda,
        vaultTokenAccount,
        mint,
        recoveryDestination,
        admin: newAdmin.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([newAdmin])
      .rpc();

    const revokedAccount = await program.account.vestingAccount.fetch(
      vestingPda
    );
    assert.strictEqual(revokedAccount.revoked, true);

    const reinitTime = now + 500;
    await program.methods
      .reinitializeVesting(
        new anchor.BN(reinitTime),
        new anchor.BN(10),
        new anchor.BN(100),
        new anchor.BN(456_000_000)
      )
      .accounts({
        vestingAccount: vestingPda,
        vault: vaultPda,
        mint,
        beneficiary: beneficiary.publicKey,
        payer: nonAdminPayer.publicKey,
        admin: newAdmin.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([nonAdminPayer, newAdmin])
      .rpc();

    const reinitialized = await program.account.vestingAccount.fetch(
      vestingPda
    );
    assert.strictEqual(reinitialized.revoked, false);
    assert.strictEqual(reinitialized.paused, false);
    assert.strictEqual(reinitialized.claimedAmount.toNumber(), 0);
    assert.strictEqual(reinitialized.totalAmount.toNumber(), 456_000_000);
    assert.strictEqual(reinitialized.startTime.toNumber(), reinitTime);
    assert.strictEqual(reinitialized.cliffPeriod.toNumber(), 10);
    assert.strictEqual(reinitialized.duration.toNumber(), 100);
    assert.strictEqual(reinitialized.mint.toBase58(), mint.toBase58());
    assert.strictEqual(
      reinitialized.beneficiary.toBase58(),
      beneficiary.publicKey.toBase58()
    );

    console.log("✅ Reinitialized vesting account with non-admin payer successfully");
  });

  it("Fails to reinitialize if vesting is not revoked", async () => {
      const now = Math.floor(Date.now() / 1000);
      const beneficiary = Keypair.generate();
      const [vestingPda] = getVestingPda(vaultPda, mint, beneficiary.publicKey);

      await program.methods
        .initializeVesting(
          new anchor.BN(now),
          new anchor.BN(30),
          new anchor.BN(300),
          new anchor.BN(100_000_000)
        )
        .accounts({
          vestingAccount: vestingPda,
          vault: vaultPda,
          mint,
          beneficiary: beneficiary.publicKey,
          payer: newAdmin.publicKey,
          admin: newAdmin.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([newAdmin])
        .rpc();

      try {
        await program.methods
          .reinitializeVesting(
            new anchor.BN(now + 500),
            new anchor.BN(10),
            new anchor.BN(100),
            new anchor.BN(999_000_000)
          )
          .accounts({
            vestingAccount: vestingPda,
            vault: vaultPda,
            mint,
            beneficiary: beneficiary.publicKey,
            payer: newAdmin.publicKey,
            admin: newAdmin.publicKey, // Add admin account
            systemProgram: SystemProgram.programId,
          })
          .signers([newAdmin])
          .rpc();
        assert.fail("Should have failed due to NotRevoked");
      } catch (err) {
        console.log("Expected failure due to NotRevoked:", err.toString());
        assert.match(err.toString(), /NotRevoked/);
      }
  });

  it("Fails to reinitialize vesting with unauthorized admin", async () => {
      const now = Math.floor(Date.now() / 1000);
      const unauthorizedAdmin = Keypair.generate();
      const beneficiary = Keypair.generate();
      const [vestingPda] = getVestingPda(vaultPda, mint, beneficiary.publicKey);

      // Fund the unauthorized admin with SOL
      const signature = await provider.connection.requestAirdrop(
        unauthorizedAdmin.publicKey,
        1_000_000_000 // 1 SOL
      );
      await provider.connection.confirmTransaction(signature);

      await program.methods
        .initializeVesting(
          new anchor.BN(now),
          new anchor.BN(30),
          new anchor.BN(300),
          new anchor.BN(100_000_000)
        )
        .accounts({
          vestingAccount: vestingPda,
          vault: vaultPda,
          mint,
          beneficiary: beneficiary.publicKey,
          payer: newAdmin.publicKey,
          admin: newAdmin.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([newAdmin])
        .rpc();

      await program.methods
        .revokeVesting()
        .accounts({
          vestingAccount: vestingPda,
          vault: vaultPda,
          vaultTokenAccount,
          mint,
          recoveryDestination,
          admin: newAdmin.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([newAdmin])
        .rpc();

      try {
        await program.methods
          .reinitializeVesting(
            new anchor.BN(now + 500),
            new anchor.BN(10),
            new anchor.BN(100),
            new anchor.BN(999_000_000)
          )
          .accounts({
            vestingAccount: vestingPda,
            vault: vaultPda,
            mint,
            beneficiary: beneficiary.publicKey,
            payer: unauthorizedAdmin.publicKey,
            admin: unauthorizedAdmin.publicKey,
            systemProgram: SystemProgram.programId,
          })
          .signers([unauthorizedAdmin])
          .rpc();
        assert.fail("Should have failed with unauthorized admin");
      } catch (err) {
        console.log("Expected failure with unauthorized admin:", err.toString());
        assert.match(err.toString(), /Unauthorized/);
      }
  });

  it("Initializes and interacts with multiple mint-specific vaults", async () => {
    const now = Math.floor(Date.now() / 1000);

    // Create two mints
    const mint1 = await createMint(
      provider.connection,
      admin.payer,
      admin.publicKey,
      null,
      9
    );
    const mint2 = await createMint(
      provider.connection,
      admin.payer,
      admin.publicKey,
      null,
      9
    );

    // Initialize two vaults
    const [vaultPda1] = getVaultPda(mint1);
    const [vaultPda2] = getVaultPda(mint2);

    await program.methods
      .initializeVault()
      .accounts({
        vault: vaultPda1,
        mint: mint1,
        payer: admin.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    await program.methods
      .initializeVault()
      .accounts({
        vault: vaultPda2,
        mint: mint2,
        payer: admin.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    // Fund vaults
    const vaultTokenAccount1 = (await getOrCreateAssociatedTokenAccount(
      provider.connection,
      admin.payer,
      mint1,
      vaultPda1,
      true
    )).address;
    const vaultTokenAccount2 = (await getOrCreateAssociatedTokenAccount(
      provider.connection,
      admin.payer,
      mint2,
      vaultPda2,
      true
    )).address;

    const sourceTokenAccount1 = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      admin.payer,
      mint1,
      admin.publicKey
    );
    const sourceTokenAccount2 = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      admin.payer,
      mint2,
      admin.publicKey
    );

    await mintTo(
      provider.connection,
      admin.payer,
      mint1,
      sourceTokenAccount1.address,
      admin.publicKey,
      1_000_000_000
    );
    await mintTo(
      provider.connection,
      admin.payer,
      mint2,
      sourceTokenAccount2.address,
      admin.publicKey,
      1_000_000_000
    );

    await program.methods
      .fundVaultExisting(new anchor.BN(500_000_000))
      .accounts({
        vault: vaultPda1,
        mint: mint1,
        sourceTokenAccount: sourceTokenAccount1.address,
        vaultTokenAccount: vaultTokenAccount1,
        admin: admin.publicKey,
        payer: admin.publicKey, // Explicitly add payer
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();

    await program.methods
      .fundVaultExisting(new anchor.BN(500_000_000))
      .accounts({
        vault: vaultPda2,
        mint: mint2,
        sourceTokenAccount: sourceTokenAccount2.address,
        vaultTokenAccount: vaultTokenAccount2,
        admin: admin.publicKey,
        payer: admin.publicKey, // Explicitly add payer
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();

    // Create vesting accounts
    const beneficiary = Keypair.generate();
    const [vestingPda1] = getVestingPda(vaultPda1, mint1, beneficiary.publicKey);
    const [vestingPda2] = getVestingPda(vaultPda2, mint2, beneficiary.publicKey);

    await program.methods
      .initializeVesting(
        new anchor.BN(now),
        new anchor.BN(30),
        new anchor.BN(300),
        new anchor.BN(100_000_000)
      )
      .accounts({
        vestingAccount: vestingPda1,
        vault: vaultPda1,
        mint: mint1,
        beneficiary: beneficiary.publicKey,
        payer: admin.publicKey,
        admin: admin.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    await program.methods
      .initializeVesting(
        new anchor.BN(now),
        new anchor.BN(30),
        new anchor.BN(300),
        new anchor.BN(100_000_000)
      )
      .accounts({
        vestingAccount: vestingPda2,
        vault: vaultPda2,
        mint: mint2,
        beneficiary: beneficiary.publicKey,
        payer: admin.publicKey,
        admin: admin.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const beneficiaryTokenAccount1 = (await getOrCreateAssociatedTokenAccount(
      provider.connection,
      admin.payer,
      mint1,
      beneficiary.publicKey
    )).address;
    const beneficiaryTokenAccount2 = (await getOrCreateAssociatedTokenAccount(
      provider.connection,
      admin.payer,
      mint2,
      beneficiary.publicKey
    )).address;

    // Wait and claim from mint1
    console.log("Waiting 40 seconds to pass cliff period...");
    await new Promise((resolve) => setTimeout(resolve, 40000));

    await program.methods
      .claim()
      .accounts({
        vestingAccount: vestingPda1,
        vault: vaultPda1,
        vaultTokenAccount: vaultTokenAccount1,
        mint: mint1,
        beneficiaryTokenAccount: beneficiaryTokenAccount1,
        beneficiary: beneficiary.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([beneficiary])
      .rpc();

    const balance1 = await getAccount(provider.connection, beneficiaryTokenAccount1);
    assert.ok(
      Number(balance1.amount) > 0,
      "Should have claimed tokens for mint1"
    );

    // Verify mint2 vesting account unaffected
    const vestingAccount2 = await program.account.vestingAccount.fetch(vestingPda2);
    assert.strictEqual(
      vestingAccount2.claimedAmount.toNumber(),
      0,
      "Mint2 vesting account should have no claimed tokens"
    );
    assert.strictEqual(
      vestingAccount2.mint.toBase58(),
      mint2.toBase58(),
      "Mint2 vesting account should reference mint2"
    );

    // Revoke mint1 vesting account
    const recoveryTokenAccount1 = (await getOrCreateAssociatedTokenAccount(
      provider.connection,
      admin.payer,
      mint1,
      admin.publicKey
    )).address;

    await program.methods
      .revokeVesting()
      .accounts({
        vestingAccount: vestingPda1,
        vault: vaultPda1,
        vaultTokenAccount: vaultTokenAccount1,
        mint: mint1,
        recoveryDestination: recoveryTokenAccount1,
        admin: admin.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();

    const revokedAccount = await program.account.vestingAccount.fetch(vestingPda1);
    assert.strictEqual(revokedAccount.revoked, true);
    assert.strictEqual(revokedAccount.mint.toBase58(), mint1.toBase58());

    // Verify mint2 vault unaffected
    const vaultState2 = await program.account.vault.fetch(vaultPda2);
    assert.strictEqual(vaultState2.paused, false);
    assert.strictEqual(
      vaultState2.admin.toBase58(),
      admin.publicKey.toBase58()
    );

    console.log("✅ Successfully tested multiple mint-specific vaults");
  });

  it("Batch initializes vesting accounts with different mints", async () => {
    const now = Math.floor(Date.now() / 1000);
  
    console.log("admin publicKey:", admin.publicKey.toBase58());
    console.log("admin balance:", await provider.connection.getBalance(admin.publicKey));
  
    const mint1 = await createMint(
      provider.connection,
      admin.payer,
      admin.publicKey,
      null,
      9
    );
    const mint2 = await createMint(
      provider.connection,
      admin.payer,
      admin.publicKey,
      null,
      9
    );
  
    const [vaultPda1] = getVaultPda(mint1);
    const [vaultPda2] = getVaultPda(mint2);
    const vaultToken1 = await getAssociatedTokenAddress(mint1, vaultPda1, true);
    const vaultToken2 = await getAssociatedTokenAddress(mint2, vaultPda2, true);
  
    await program.methods
      .initializeVault()
      .accounts({
        vault: vaultPda1,
        mint: mint1,
        payer: admin.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([admin.payer])
      .rpc({ commitment: "confirmed" });
  
    await program.methods
      .initializeVault()
      .accounts({
        vault: vaultPda2,
        mint: mint2,
        payer: admin.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([admin.payer])
      .rpc({ commitment: "confirmed" });
  
    const beneficiaries1 = [Keypair.generate()];
    const beneficiaries2 = [Keypair.generate()];
    const vestingPdas1 = beneficiaries1.map(
      (ben) => getVestingPda(vaultPda1, mint1, ben.publicKey)[0]
    );
    const vestingPdas2 = beneficiaries2.map(
      (ben) => getVestingPda(vaultPda2, mint2, ben.publicKey)[0]
    );
  
    const args1 = beneficiaries1.map((ben) => ({
      beneficiary: ben.publicKey,
      mint: mint1,
      startTime: new anchor.BN(now),
      cliffPeriod: new anchor.BN(60),
      duration: new anchor.BN(600),
      totalAmount: new anchor.BN(100_000_000),
    }));
  
    const args2 = beneficiaries2.map((ben) => ({
      beneficiary: ben.publicKey,
      mint: mint2,
      startTime: new anchor.BN(now),
      cliffPeriod: new anchor.BN(60),
      duration: new anchor.BN(600),
      totalAmount: new anchor.BN(100_000_000),
    }));
  
    const remainingAccounts1 = [];
    for (let i = 0; i < beneficiaries1.length; i++) {
      remainingAccounts1.push({
        pubkey: vestingPdas1[i],
        isWritable: true,
        isSigner: false,
      });
      remainingAccounts1.push({
        pubkey: beneficiaries1[i].publicKey,
        isWritable: false,
        isSigner: false,
      });
    }
  
    const remainingAccounts2 = [];
    for (let i = 0; i < beneficiaries2.length; i++) {
      remainingAccounts2.push({
        pubkey: vestingPdas2[i],
        isWritable: true,
        isSigner: false,
      });
      remainingAccounts2.push({
        pubkey: beneficiaries2[i].publicKey,
        isWritable: false,
        isSigner: false,
      });
    }
  
    console.log("Vesting PDAs for mint1:", vestingPdas1.map(pda => pda.toBase58()));
    console.log("Vesting PDAs for mint2:", vestingPdas2.map(pda => pda.toBase58()));
  
    const emittedVestingAccounts: { vault: PublicKey; vestingAccount: PublicKey }[] = [];
    const listener = program.addEventListener(
      "batchInitializeVestingEvent",
      (event, slot) => {
        if (event.vault.toBase58() === vaultPda1.toBase58()) {
          assert.strictEqual(event.mint.toBase58(), mint1.toBase58());
          assert.strictEqual(
            event.admin.toBase58(),
            admin.publicKey.toBase58()
          );
          assert.strictEqual(event.numAccounts.toNumber(), 1);
          emittedVestingAccounts.push({
            vault: event.vault,
            vestingAccount: event.vestingAccount,
          });
        } else if (event.vault.toBase58() === vaultPda2.toBase58()) {
          assert.strictEqual(event.mint.toBase58(), mint2.toBase58());
          assert.strictEqual(
            event.admin.toBase58(),
            admin.publicKey.toBase58()
          );
          assert.strictEqual(event.numAccounts.toNumber(), 1);
          emittedVestingAccounts.push({
            vault: event.vault,
            vestingAccount: event.vestingAccount,
          });
        }
      }
    );
  
    try {
      // Initialize vesting for mint1
      console.log("admin balance before mint1 vesting:", await provider.connection.getBalance(admin.publicKey));
      await program.methods
        .batchInitializeVestingV2(args1)
        .accounts({
          vault: vaultPda1,
          mint: mint1,
          admin: admin.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .remainingAccounts(remainingAccounts1)
        .signers([admin.payer])
        .rpc({ commitment: "confirmed" });
  
      // Initialize vesting for mint2
      console.log("admin balance before mint2 vesting:", await provider.connection.getBalance(admin.publicKey));
      await program.methods
        .batchInitializeVestingV2(args2)
        .accounts({
          vault: vaultPda2,
          mint: mint2,
          admin: admin.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .remainingAccounts(remainingAccounts2)
        .signers([admin.payer])
        .rpc({ commitment: "confirmed" });
  
      const vestingAccount1 = await program.account.vestingAccount.fetch(
        vestingPdas1[0]
      );
      assert.strictEqual(
        vestingAccount1.beneficiary.toBase58(),
        beneficiaries1[0].publicKey.toBase58()
      );
      assert.strictEqual(vestingAccount1.mint.toBase58(), mint1.toBase58());
      assert.strictEqual(vestingAccount1.initialized, true);
      assert.strictEqual(vestingAccount1.totalAmount.toNumber(), 100_000_000);
  
      const vestingAccount2 = await program.account.vestingAccount.fetch(
        vestingPdas2[0]
      );
      assert.strictEqual(
        vestingAccount2.beneficiary.toBase58(),
        beneficiaries2[0].publicKey.toBase58()
      );
      assert.strictEqual(vestingAccount2.mint.toBase58(), mint2.toBase58());
      assert.strictEqual(vestingAccount2.initialized, true);
      assert.strictEqual(vestingAccount2.totalAmount.toNumber(), 100_000_000);
  
      assert.strictEqual(
        emittedVestingAccounts.length,
        2,
        "Expected 2 events for mint1 and mint2"
      );
      assert.strictEqual(
        emittedVestingAccounts.find((e) => e.vault.toBase58() === vaultPda1.toBase58())?.vestingAccount.toBase58(),
        vestingPdas1[0].toBase58()
      );
      assert.strictEqual(
        emittedVestingAccounts.find((e) => e.vault.toBase58() === vaultPda2.toBase58())?.vestingAccount.toBase58(),
        vestingPdas2[0].toBase58()
      );
  
      console.log("✅ Batch vesting with different mints complete!");
    } catch (err) {
      console.error("Batch initialize with different mints error:", err);
      throw err;
    } finally {
      await program.removeEventListener(listener);
    }
  });
});
