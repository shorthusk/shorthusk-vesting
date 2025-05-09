// lib/derive.ts
import { PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddress } from "@solana/spl-token";
import { PROGRAM_ID } from "./constants";
/**
 * Derives the vault PDA.
 */
export const getVaultPda = (mint: PublicKey): [PublicKey, number] => {
  return PublicKey.findProgramAddressSync([Buffer.from("vault"), mint.toBuffer()], PROGRAM_ID);
};

/**
 * Derives the ATA for the vault to hold SPL tokens.
 */
export const getVaultTokenAccount = async (mint: PublicKey): Promise<PublicKey> => {
  const [vaultPda] = getVaultPda(mint);
  return await getAssociatedTokenAddress(mint, vaultPda, true);
};

/**
 * Derives the ATA for a given beneficiary wallet to receive SPL tokens.
 */
export const getBeneficiaryTokenAccount = async (
  beneficiary: PublicKey,
  mint: PublicKey
): Promise<PublicKey> => {
  return await getAssociatedTokenAddress(mint, beneficiary);
};


/**
 * Derives the PDA for a vesting account.
 * This is used to fetch the vesting account details.
 */
export const getVestingPda = (vault: PublicKey, mint: PublicKey, beneficiary: PublicKey): [PublicKey, number] => {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("vesting"), vault.toBuffer(), mint.toBuffer(), beneficiary.toBuffer()],
    PROGRAM_ID // your program ID
  );
};
