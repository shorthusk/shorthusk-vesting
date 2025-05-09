use anchor_lang::{prelude::*, AccountDeserialize, AccountSerialize};
use anchor_spl::token::{self, Token, TokenAccount, Transfer, Mint};
use solana_security_txt::security_txt;

declare_id!("VestF59gEqPp83UV8JKn85zXsEn1SuLq8mdz8QxxKzY");

// A Solana program for managing token vesting with linear schedules, cliff periods, and admin controls.
// Supports mint-specific vaults and vesting accounts, allowing multiple tokens to be managed independently.

#[cfg(not(feature = "no-entrypoint"))]
security_txt! {
    name: "$SHORTHUSK Vesting Program",
    project_url: "https://github.com/shorthusk/shorthusk-vesting",
    contacts: "link:https://x.com/shorthusk",
    policy: "https://raw.githubusercontent.com/shorthusk/shorthusk-vesting/refs/heads/master/security-policy.md",
    preferred_languages: "en",
    auditors: "None"
}

#[program]
pub mod shorthusk_vesting {
    use super::*;

    /// Initializes the vault, setting up the admin and global state for a specific mint.
    pub fn initialize_vault(ctx: Context<InitializeVault>) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        vault.bump = ctx.bumps.vault;
        vault.admin = ctx.accounts.payer.key();
        vault.paused = false;
        vault.initialized = true;
        emit!(VaultInitializedEvent {
            vault: vault.key(),
            admin: vault.admin,
            mint: ctx.accounts.mint.key(),
        });
        Ok(())
    }

    /// Initializes a vesting account with a linear token release schedule.
    pub fn initialize_vesting(
        ctx: Context<InitializeVesting>,
        start_time: i64,
        cliff_period: i64,
        duration: i64,
        total_amount: u64,
    ) -> Result<()> {
        require!(
            ctx.accounts.vault.initialized,
            VestingError::VaultNotInitialized
        );
        require_keys_eq!(
            ctx.accounts.admin.key(),
            ctx.accounts.vault.admin,
            VestingError::Unauthorized
        );
        require!(duration > 0, VestingError::InvalidDuration);
        require!(
            cliff_period >= 0 && cliff_period <= duration,
            VestingError::InvalidCliffPeriod
        );
        require!(total_amount > 0, VestingError::InvalidAmount);
        let vesting_account = &mut ctx.accounts.vesting_account;
        require!(
            !vesting_account.initialized,
            VestingError::AlreadyInitialized
        );
        vesting_account.beneficiary = ctx.accounts.beneficiary.key();
        vesting_account.mint = ctx.accounts.mint.key(); // Store mint
        vesting_account.start_time = start_time;
        vesting_account.cliff_period = cliff_period;
        vesting_account.duration = duration;
        vesting_account.total_amount = total_amount;
        vesting_account.claimed_amount = 0;
        vesting_account.paused = false;
        vesting_account.initialized = true;
        vesting_account.revoked = false;
        vesting_account.bump = ctx.bumps.vesting_account;
        emit!(VestingInitializedEvent {
            vesting_account: vesting_account.key(),
            beneficiary: vesting_account.beneficiary,
            mint: ctx.accounts.mint.key(),
            total_amount,
        });
        Ok(())
    }

    /// Claims vested tokens for a beneficiary based on the vesting schedule.
    pub fn claim(ctx: Context<Claim>) -> Result<()> {
        let vesting_account = &mut ctx.accounts.vesting_account;
        let clock = Clock::get()?;

        require!(vesting_account.initialized, VestingError::NotInitialized);
        require!(!vesting_account.revoked, VestingError::VestingRevoked);
        require!(!vesting_account.paused, VestingError::Paused);
        require!(!ctx.accounts.vault.paused, VestingError::VaultPaused);

        let elapsed = clock.unix_timestamp - vesting_account.start_time;
        require!(elapsed >= 0, VestingError::InvalidTimestamp);
        require!(
            elapsed > vesting_account.cliff_period,
            VestingError::CliffNotReached
        );

        let vested_amount = if elapsed >= vesting_account.duration {
            vesting_account.total_amount
        } else {
            vesting_account
                .total_amount
                .checked_mul(elapsed as u64)
                .unwrap()
                .checked_div(vesting_account.duration as u64)
                .unwrap()
        };

        let claimable = vested_amount
            .checked_sub(vesting_account.claimed_amount)
            .unwrap();

        require!(claimable > 0, VestingError::NothingToClaim);

        let new_claimed = vesting_account.claimed_amount.checked_add(claimable)
            .ok_or(VestingError::InvalidAmount)?;
        require!(
            new_claimed <= vesting_account.total_amount,
            VestingError::InvalidAmount
        );

        vesting_account.claimed_amount = new_claimed;

        let mint_key = ctx.accounts.mint.key();
        let seeds = &[b"vault", mint_key.as_ref(), &[ctx.accounts.vault.bump]];
        let signer = &[&seeds[..]];

        let cpi_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.vault_token_account.to_account_info(),
                to: ctx.accounts.beneficiary_token_account.to_account_info(),
                authority: ctx.accounts.vault.to_account_info(),
            },
            signer,
        );
        token::transfer(cpi_ctx, claimable)?;
        emit!(ClaimEvent {
            vesting_account: vesting_account.key(),
            beneficiary: ctx.accounts.beneficiary.key(),
            amount: claimable,
            mint: ctx.accounts.mint.key(),
        });

        Ok(())
    }
    
    /// Allows the admin to claim tokens on behalf of a beneficiary.
    pub fn admin_claim(ctx: Context<AdminClaim>) -> Result<()> {
        let vesting_account = &mut ctx.accounts.vesting_account;
        let clock = Clock::get()?;

        require_keys_eq!(
            ctx.accounts.admin.key(),
            ctx.accounts.vault.admin,
            VestingError::Unauthorized
        );
        require!(vesting_account.initialized, VestingError::NotInitialized);
        require!(!vesting_account.revoked, VestingError::VestingRevoked);
        require!(!vesting_account.paused, VestingError::Paused);
        require!(!ctx.accounts.vault.paused, VestingError::VaultPaused);

        let current_time = clock.unix_timestamp as i64;
        let elapsed = current_time - vesting_account.start_time;
        msg!("Current Time: {}, Start Time: {}, Elapsed: {}", current_time, vesting_account.start_time, elapsed);
        let elapsed = if elapsed < 0 {
            if elapsed < -60 {
                return Err(VestingError::InvalidTimestamp.into());
            }
            0
        } else {
            elapsed
        };

        let claimable = if elapsed <= vesting_account.cliff_period {
            0
        } else if elapsed >= vesting_account.duration {
            vesting_account.total_amount
                .checked_sub(vesting_account.claimed_amount)
                .ok_or(VestingError::InvalidAmount)?
        } else {
            let vested_amount = vesting_account
                .total_amount
                .checked_mul(elapsed as u64)
                .ok_or(VestingError::InvalidAmount)?
                .checked_div(vesting_account.duration as u64)
                .ok_or(VestingError::InvalidAmount)?;
            vested_amount
                .checked_sub(vesting_account.claimed_amount)
                .ok_or(VestingError::InvalidAmount)?
        };

        let new_claimed = vesting_account.claimed_amount.checked_add(claimable)
            .ok_or(VestingError::InvalidAmount)?;
        require!(
            new_claimed <= vesting_account.total_amount,
            VestingError::InvalidAmount
        );

        if claimable == 0 {
            return Ok(());
        }

        vesting_account.claimed_amount = new_claimed;

        let mint_key = ctx.accounts.mint.key();
        let seeds = &[b"vault", mint_key.as_ref(), &[ctx.accounts.vault.bump]];
        let signer = &[&seeds[..]];

        let cpi_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.vault_token_account.to_account_info(),
                to: ctx.accounts.beneficiary_token_account.to_account_info(),
                authority: ctx.accounts.vault.to_account_info(),
            },
            signer,
        );
        token::transfer(cpi_ctx, claimable)?;
        emit!(ClaimEvent {
            vesting_account: vesting_account.key(),
            beneficiary: vesting_account.beneficiary,
            amount: claimable,
            mint: ctx.accounts.mint.key(),
        });

        Ok(())
    }

    /// Pauses a vesting account, preventing claims until unpaused. Only callable by the admin.
    pub fn pause(ctx: Context<PauseOrUnpause>) -> Result<()> {
        require_keys_eq!(
            ctx.accounts.admin.key(),
            ctx.accounts.vault.admin,
            VestingError::Unauthorized
        );
        ctx.accounts.vesting_account.paused = true;
        emit!(PauseEvent {
            vesting_account: ctx.accounts.vesting_account.key(),
            admin: ctx.accounts.admin.key(),
            mint: ctx.accounts.mint.key(),
        });
        Ok(())
    }

    /// Unpauses a vesting account, allowing claims to resume. Only callable by the admin.
    pub fn unpause(ctx: Context<PauseOrUnpause>) -> Result<()> {
        require_keys_eq!(
            ctx.accounts.admin.key(),
            ctx.accounts.vault.admin,
            VestingError::Unauthorized
        );
        ctx.accounts.vesting_account.paused = false;
        emit!(UnpauseEvent {
            vesting_account: ctx.accounts.vesting_account.key(),
            admin: ctx.accounts.admin.key(),
            mint: ctx.accounts.mint.key(),
        });
        Ok(())
    }

    /// Pauses the entire vault, preventing all claims. Only callable by the admin.
    pub fn pause_vault(ctx: Context<PauseVault>) -> Result<()> {
        require_keys_eq!(ctx.accounts.admin.key(), ctx.accounts.vault.admin);
        ctx.accounts.vault.paused = true;
        emit!(PauseVaultEvent {
            vault: ctx.accounts.vault.key(),
            admin: ctx.accounts.admin.key(),
            mint: ctx.accounts.mint.key(),
        });
        Ok(())
    }

    /// Unpauses the entire vault, allowing claims to resume. Only callable by the admin.
    pub fn unpause_vault(ctx: Context<PauseVault>) -> Result<()> {
        require_keys_eq!(ctx.accounts.admin.key(), ctx.accounts.vault.admin);
        ctx.accounts.vault.paused = false;
        emit!(UnpauseVaultEvent {
            vault: ctx.accounts.vault.key(),
            admin: ctx.accounts.admin.key(),
            mint: ctx.accounts.mint.key(),
        });
        Ok(())
    }

    /// Revokes a vesting account, transferring remaining tokens to a recovery destination. Only callable by the admin.
    pub fn revoke_vesting(ctx: Context<RevokeVesting>) -> Result<()> {
        require_keys_eq!(
            ctx.accounts.admin.key(),
            ctx.accounts.vault.admin,
            VestingError::Unauthorized
        );
        let vesting_account = &mut ctx.accounts.vesting_account;
        let remaining = vesting_account
            .total_amount
            .checked_sub(vesting_account.claimed_amount)
            .unwrap();

        let mint_key = ctx.accounts.mint.key();
        let seeds = &[b"vault", mint_key.as_ref(), &[ctx.accounts.vault.bump]];
        let signer = &[&seeds[..]];

        let cpi_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.vault_token_account.to_account_info(),
                to: ctx.accounts.recovery_destination.to_account_info(),
                authority: ctx.accounts.vault.to_account_info(),
            },
            signer,
        );
        token::transfer(cpi_ctx, remaining)?;
        vesting_account.total_amount = vesting_account.claimed_amount;
        vesting_account.revoked = true;
        emit!(RevokeVestingEvent {
            vesting_account: vesting_account.key(),
            admin: ctx.accounts.admin.key(),
            remaining_amount: remaining,
            mint: ctx.accounts.mint.key(),
        });
        Ok(())
    }

    /// Instantly unlocks all remaining tokens in a vesting account, transferring them to the beneficiary. Only callable by the admin.
    pub fn instant_unlock(ctx: Context<InstantUnlock>) -> Result<()> {
        require_keys_eq!(
            ctx.accounts.admin.key(),
            ctx.accounts.vault.admin,
            VestingError::Unauthorized
        );
        let vesting_account = &mut ctx.accounts.vesting_account;

        require!(vesting_account.initialized, VestingError::NotInitialized);
        require!(!vesting_account.revoked, VestingError::VestingRevoked);
        require!(!vesting_account.paused, VestingError::Paused);
        require!(!ctx.accounts.vault.paused, VestingError::VaultPaused);

        let remaining = vesting_account
            .total_amount
            .checked_sub(vesting_account.claimed_amount)
            .unwrap();
        require!(remaining > 0, VestingError::NothingToClaim);

        let new_claimed = vesting_account.claimed_amount.checked_add(remaining)
            .ok_or(VestingError::InvalidAmount)?;
        require!(
            new_claimed <= vesting_account.total_amount,
            VestingError::InvalidAmount
        );

        let mint_key = ctx.accounts.mint.key();
        let seeds = &[b"vault", mint_key.as_ref(), &[ctx.accounts.vault.bump]];
        let signer = &[&seeds[..]];

        let cpi_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.vault_token_account.to_account_info(),
                to: ctx.accounts.beneficiary_token_account.to_account_info(),
                authority: ctx.accounts.vault.to_account_info(),
            },
            signer,
        );
        token::transfer(cpi_ctx, remaining)?;

        vesting_account.claimed_amount = vesting_account.total_amount;
        emit!(InstantUnlockEvent {
            vesting_account: vesting_account.key(),
            beneficiary: vesting_account.beneficiary,
            admin: ctx.accounts.admin.key(),
            amount: remaining,
            mint: ctx.accounts.mint.key(),
        });
        Ok(())
    }

    /// Returns the amount of tokens currently claimable from a vesting account based on the vesting schedule.
    pub fn get_claimable(ctx: Context<GetClaimable>) -> Result<u64> {
        let vesting_account = &ctx.accounts.vesting_account;
        let clock = Clock::get()?;

        require!(vesting_account.initialized, VestingError::NotInitialized);
        require!(!vesting_account.revoked, VestingError::VestingRevoked);
        require!(!vesting_account.paused, VestingError::Paused);
        require!(!ctx.accounts.vault.paused, VestingError::VaultPaused);

        let elapsed = clock.unix_timestamp - vesting_account.start_time;
        require!(elapsed >= 0, VestingError::InvalidTimestamp);

        if elapsed <= vesting_account.cliff_period {
            return Ok(0); // Nothing claimable before the cliff
        }

        let vested_amount = if elapsed >= vesting_account.duration {
            vesting_account.total_amount
        } else {
            vesting_account
                .total_amount
                .checked_mul(elapsed as u64)
                .unwrap()
                .checked_div(vesting_account.duration as u64)
                .unwrap()
        };

        let claimable = vested_amount
            .checked_sub(vesting_account.claimed_amount)
            .unwrap_or(0);

        Ok(claimable)
    }

    /// Recovers all tokens from the vault to a recovery destination in an emergency. Only callable by the admin.
    pub fn emergency_recover(ctx: Context<EmergencyRecover>) -> Result<()> {
        require_keys_eq!(
            ctx.accounts.admin.key(),
            ctx.accounts.vault.admin,
            VestingError::Unauthorized
        );
        let amount = ctx.accounts.vault_token_account.amount;
        require!(amount > 0, VestingError::NothingToClaim);

        let mint_key = ctx.accounts.mint.key();
        let seeds = &[b"vault", mint_key.as_ref(), &[ctx.accounts.vault.bump]];
        let signer = &[&seeds[..]];

        let cpi_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.vault_token_account.to_account_info(),
                to: ctx.accounts.recovery_destination.to_account_info(),
                authority: ctx.accounts.vault.to_account_info(),
            },
            signer,
        );
        token::transfer(cpi_ctx, amount)?;
        emit!(EmergencyRecoverEvent {
            vault: ctx.accounts.vault.key(),
            admin: ctx.accounts.admin.key(),
            amount,
            mint: ctx.accounts.mint.key(),
        });
        Ok(())
    }

    /// Funds the vault with existing tokens from the admin's token account. Only callable by the admin.
    pub fn fund_vault_existing(ctx: Context<FundVaultExisting>, amount: u64) -> Result<()> {
        require!(amount > 0, VestingError::InvalidAmount);
        require_keys_eq!(
            ctx.accounts.admin.key(),
            ctx.accounts.vault.admin,
            VestingError::Unauthorized
        );
        let source = &ctx.accounts.source_token_account;
        let payer = &ctx.accounts.payer;
        require_keys_eq!(source.owner, payer.key(), VestingError::Unauthorized);
        let cpi_ctx = CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: source.to_account_info(),
                to: ctx.accounts.vault_token_account.to_account_info(),
                authority: payer.to_account_info(),
            },
        );
        token::transfer(cpi_ctx, amount)?;
        emit!(FundVaultExistingEvent {
            vault: ctx.accounts.vault.key(),
            admin: ctx.accounts.admin.key(),
            amount,
            mint: ctx.accounts.mint.key(),
        });
        Ok(())
    }

    /// Batch initializes multiple vesting accounts in a single transaction. Only callable by the admin.
    pub fn batch_initialize_vesting<'info>(
        ctx: Context<'_, '_, '_, 'info, BatchInitializeVesting<'info>>,
        args: Vec<BatchVestingArgs>,
    ) -> Result<()> {
        require!(
            ctx.accounts.vault.initialized,
            VestingError::VaultNotInitialized
        );
        require_keys_eq!(ctx.accounts.admin.key(), ctx.accounts.vault.admin);
        require!(args.len() <= 3, VestingError::TooManyAccounts);

        // Validate that all args use the same mint
        for arg in &args {
            require_keys_eq!(
                arg.mint,
                ctx.accounts.mint.key(),
                VestingError::InvalidAccount // Reuse existing error
            );
        }

        let admin = ctx.accounts.admin.to_account_info();
        let system_program = ctx.accounts.system_program.to_account_info();
        let vault = ctx.accounts.vault.key();

        let mut successful_inits = 0;
        for (i, arg) in args.iter().enumerate() {
            match process_single_vesting_account(
                i,
                arg,
                vault,
                ctx.program_id,
                &admin,
                &system_program,
                &ctx.remaining_accounts,
            ) {
                Ok(vesting_account_key) => {
                    successful_inits += 1;
                    emit!(BatchInitializeVestingEvent {
                        vault,
                        admin: admin.key(),
                        num_accounts: 1,
                        vesting_account: vesting_account_key,
                        mint: ctx.accounts.mint.key(),
                    });
                }
                Err(e) => {
                    msg!("Failed to initialize vesting account {}: {:?}", i, e);
                    return Err(e);
                }
            }
        }

        if successful_inits == 0 {
            return Err(VestingError::NotEnoughAccounts.into());
        }

        Ok(())
    }

    /// Batch initializes multiple vesting accounts (v2) in a single transaction using remaining accounts.
    /// Only callable by the admin. Supports up to 3 vesting accounts.
    pub fn batch_initialize_vesting_v2<'info>(
        ctx: Context<'_, '_, '_, 'info, BatchInitializeVesting<'info>>,
        args: Vec<BatchVestingArgs>,
    ) -> Result<()> {
        require!(
            ctx.accounts.vault.initialized,
            VestingError::VaultNotInitialized
        );
        require_keys_eq!(
            ctx.accounts.admin.key(),
            ctx.accounts.vault.admin,
            VestingError::Unauthorized
        );
        require!(!args.is_empty(), VestingError::NotEnoughAccounts);
        require!(args.len() <= 3, VestingError::TooManyAccounts);
        require!(
            ctx.remaining_accounts.len() == args.len() * 2,
            VestingError::InvalidAccountCount
        );

        // Validate that all args use the same mint
        for arg in &args {
            require_keys_eq!(
                arg.mint,
                ctx.accounts.mint.key(),
                VestingError::InvalidAccount
            );
        }

        let admin = ctx.accounts.admin.to_account_info();
        let system_program = ctx.accounts.system_program.to_account_info();
        let vault = ctx.accounts.vault.key();

        for (i, arg) in args.iter().enumerate() {
            let vesting_account_idx = i * 2;
            let beneficiary_idx = i * 2 + 1;

            let vesting_account_info = ctx.remaining_accounts
                .get(vesting_account_idx)
                .ok_or(VestingError::NotEnoughAccounts)?;
            let beneficiary_info = ctx.remaining_accounts
                .get(beneficiary_idx)
                .ok_or(VestingError::NotEnoughAccounts)?;

            require_keys_eq!(
                beneficiary_info.key(),
                arg.beneficiary,
                VestingError::InvalidAccount
            );

            let mint_key = ctx.accounts.mint.key();
            let (expected_pda, bump) = Pubkey::find_program_address(
                &[b"vesting", vault.as_ref(), mint_key.as_ref(), arg.beneficiary.as_ref()],
                ctx.program_id,
            );
            require_keys_eq!(
                vesting_account_info.key(),
                expected_pda,
                VestingError::InvalidAccount
            );

            let account_info = vesting_account_info;
            let is_initialized = {
                let account_data = account_info.try_borrow_data()?;
                if account_data.len() > 0 {
                    let mut data_slice: &[u8] = &account_data;
                    if let Ok(existing) = VestingAccount::try_deserialize(&mut data_slice) {
                        existing.initialized
                    } else {
                        false
                    }
                } else {
                    false
                }
            };

            require!(
                !is_initialized,
                VestingError::AlreadyInitialized
            );

            require_eq!(
                account_info.owner,
                &System::id(),
                VestingError::InvalidAccountOwner
            );

            let space = 8 + VestingAccount::LEN;
            let rent = Rent::get()?.minimum_balance(space);

            let ix = anchor_lang::solana_program::system_instruction::create_account(
                admin.key,
                account_info.key,
                rent,
                space as u64,
                ctx.program_id,
            );

            let seeds = &[
                b"vesting".as_ref(),
                vault.as_ref(),
                mint_key.as_ref(),
                arg.beneficiary.as_ref(),
                &[bump],
            ];
            let signer_seeds = &[&seeds[..]];

            anchor_lang::solana_program::program::invoke_signed(
                &ix,
                &[
                    admin.clone(),
                    account_info.clone(),
                    system_program.clone(),
                ],
                signer_seeds,
            )?;

            let vesting_account = VestingAccount {
                beneficiary: arg.beneficiary,
                mint: mint_key,
                start_time: arg.start_time,
                cliff_period: arg.cliff_period,
                duration: arg.duration,
                total_amount: arg.total_amount,
                claimed_amount: 0,
                paused: false,
                initialized: true,
                revoked: false,
                bump,
            };

            require!(arg.duration > 0, VestingError::InvalidDuration);
            require!(
                arg.cliff_period >= 0 && arg.cliff_period <= arg.duration,
                VestingError::InvalidCliffPeriod
            );
            require!(arg.total_amount > 0, VestingError::InvalidAmount);

            vesting_account.try_serialize(&mut &mut account_info.data.borrow_mut()[..])?;

            emit!(BatchInitializeVestingEvent {
                vault,
                admin: admin.key(),
                num_accounts: 1,
                vesting_account: account_info.key(),
                mint: ctx.accounts.mint.key(),
            });
        }

        Ok(())
    }

    /// Updates the admin of the vault to a new address. Only callable by the admin.
    pub fn update_admin(ctx: Context<UpdateAdmin>, new_admin: Pubkey) -> Result<()> {
        require_keys_eq!(
            ctx.accounts.admin.key(),
            ctx.accounts.vault.admin,
            VestingError::Unauthorized
        );
        let old_admin = ctx.accounts.vault.admin;
        ctx.accounts.vault.admin = new_admin;
        emit!(UpdateAdminEvent {
            vault: ctx.accounts.vault.key(),
            old_admin,
            new_admin,
            mint: ctx.accounts.mint.key(),
        });
        Ok(())
    }

    /// Attempts to re-initialize a vesting account (for testing purposes).
    pub fn reinitialize_vesting(
        ctx: Context<ReinitializeVesting>,
        start_time: i64,
        cliff_period: i64,
        duration: i64,
        total_amount: u64,
    ) -> Result<()> {
        require_keys_eq!(
            ctx.accounts.admin.key(),
            ctx.accounts.vault.admin,
            VestingError::Unauthorized
        );
        let vesting_account = &mut ctx.accounts.vesting_account;

        require!(vesting_account.revoked, VestingError::NotRevoked);

        vesting_account.start_time = start_time;
        vesting_account.cliff_period = cliff_period;
        vesting_account.duration = duration;
        vesting_account.total_amount = total_amount;
        vesting_account.claimed_amount = 0;
        vesting_account.paused = false;
        vesting_account.revoked = false;
        vesting_account.initialized = true;
        vesting_account.mint = ctx.accounts.mint.key(); // Ensure mint is set

        emit!(VestingReinitializedEvent {
            vesting_account: vesting_account.key(),
            beneficiary: vesting_account.beneficiary,
            mint: ctx.accounts.mint.key(),
            total_amount,
        });
        Ok(())
    }
}

/// Helper function to process a single vesting account during batch initialization.
pub fn process_single_vesting_account<'info>(
    index: usize,
    arg: &BatchVestingArgs,
    vault_key: Pubkey,
    program_id: &Pubkey,
    admin_info: &AccountInfo<'info>,
    system_program_info: &AccountInfo<'info>,
    remaining_accounts: &[AccountInfo<'info>],
) -> Result<Pubkey> {
    require!(arg.duration > 0, VestingError::InvalidDuration);
    require!(
        arg.cliff_period >= 0 && arg.cliff_period <= arg.duration,
        VestingError::InvalidCliffPeriod
    );
    require!(arg.total_amount > 0, VestingError::InvalidAmount);

    let account_info = remaining_accounts
        .get(index)
        .ok_or(VestingError::NotEnoughAccounts)?;

    let (expected_pda, bump) = Pubkey::find_program_address(
        &[b"vesting", vault_key.as_ref(), arg.mint.as_ref(), arg.beneficiary.as_ref()],
        program_id,
    );

    require_keys_eq!(
        account_info.key(),
        expected_pda,
        VestingError::InvalidAccount
    );

    require_eq!(
        account_info.owner,
        &System::id(),
        VestingError::InvalidAccountOwner
    );

    let space = 8 + VestingAccount::LEN;
    let rent = Rent::get()?.minimum_balance(space);

    let ix = anchor_lang::solana_program::system_instruction::create_account(
        admin_info.key,
        account_info.key,
        rent,
        space as u64,
        program_id,
    );

    let seeds = &[
        b"vesting".as_ref(),
        vault_key.as_ref(),
        arg.mint.as_ref(),
        arg.beneficiary.as_ref(),
        &[bump],
    ];
    let signer_seeds = &[&seeds[..]];

    anchor_lang::solana_program::program::invoke_signed(
        &ix,
        &[
            admin_info.clone(),
            account_info.clone(),
            system_program_info.clone(),
        ],
        signer_seeds,
    )?;

    let vesting_data = VestingAccount {
        beneficiary: arg.beneficiary,
        mint: arg.mint,
        start_time: arg.start_time,
        cliff_period: arg.cliff_period,
        duration: arg.duration,
        total_amount: arg.total_amount,
        claimed_amount: 0,
        paused: false,
        initialized: true,
        revoked: false,
        bump,
    };

    vesting_data.try_serialize(&mut &mut account_info.data.borrow_mut()[..])?;

    Ok(*account_info.key)
}

/// Emitted when tokens are claimed from a vesting account.
#[event]
pub struct ClaimEvent {
    pub vesting_account: Pubkey,
    pub beneficiary: Pubkey,
    pub amount: u64,
    pub mint: Pubkey,
}

#[event]
pub struct PauseEvent {
    pub vesting_account: Pubkey,
    pub admin: Pubkey,
    pub mint: Pubkey,
}

#[event]
pub struct UnpauseEvent {
    pub vesting_account: Pubkey,
    pub admin: Pubkey,
    pub mint: Pubkey,
}

#[event]
pub struct RevokeVestingEvent {
    pub vesting_account: Pubkey,
    pub admin: Pubkey,
    pub remaining_amount: u64,
    pub mint: Pubkey,
}

#[event]
pub struct InstantUnlockEvent {
    pub vesting_account: Pubkey,
    pub beneficiary: Pubkey,
    pub admin: Pubkey,
    pub amount: u64,
    pub mint: Pubkey,
}

#[event]
pub struct EmergencyRecoverEvent {
    pub vault: Pubkey,
    pub admin: Pubkey,
    pub amount: u64,
    pub mint: Pubkey,
}

#[event]
pub struct FundVaultExistingEvent {
    pub vault: Pubkey,
    pub admin: Pubkey,
    pub amount: u64,
    pub mint: Pubkey,
}

#[event]
pub struct UpdateAdminEvent {
    pub vault: Pubkey,
    pub old_admin: Pubkey,
    pub new_admin: Pubkey,
    pub mint: Pubkey,
}

#[event]
pub struct PauseVaultEvent {
    pub vault: Pubkey,
    pub admin: Pubkey,
    pub mint: Pubkey,
}

#[event]
pub struct UnpauseVaultEvent {
    pub vault: Pubkey,
    pub admin: Pubkey,
    pub mint: Pubkey,
}

#[event]
pub struct BatchInitializeVestingEvent {
    pub vault: Pubkey,
    pub admin: Pubkey,
    pub num_accounts: u64,
    pub vesting_account: Pubkey,
    pub mint: Pubkey,
}

#[event]
pub struct VaultInitializedEvent {
    pub vault: Pubkey,
    pub admin: Pubkey,
    pub mint: Pubkey,
}

#[event]
pub struct VestingInitializedEvent {
    pub vesting_account: Pubkey,
    pub beneficiary: Pubkey,
    pub mint: Pubkey,
    pub total_amount: u64,
}

#[event]
pub struct VestingReinitializedEvent {
    pub vesting_account: Pubkey,
    pub beneficiary: Pubkey,
    pub mint: Pubkey,
    pub total_amount: u64,
}

#[derive(Accounts)]
pub struct InitializeVault<'info> {
    #[account(init, payer = payer, seeds = [b"vault", mint.key().as_ref()], bump, space = 8 + Vault::LEN)]
    pub vault: Account<'info, Vault>,
    pub mint: Account<'info, Mint>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ReinitializeVesting<'info> {
    #[account(
        mut,
        seeds = [b"vesting", vault.key().as_ref(), mint.key().as_ref(), beneficiary.key().as_ref()],
        bump = vesting_account.bump,
        has_one = mint
    )]
    pub vesting_account: Account<'info, VestingAccount>,
    #[account(
        seeds = [b"vault", mint.key().as_ref()],
        bump = vault.bump
    )]
    pub vault: Account<'info, Vault>,
    pub mint: Account<'info, Mint>,
    pub beneficiary: SystemAccount<'info>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub admin: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UpdateAdmin<'info> {
    #[account(
        mut,
        seeds = [b"vault", mint.key().as_ref()],
        bump = vault.bump
    )]
    pub vault: Account<'info, Vault>,
    pub mint: Account<'info, Mint>,
    pub admin: Signer<'info>,
}

#[derive(Accounts)]
pub struct InitializeVesting<'info> {
    #[account(
        init,
        payer = payer,
        space = 8 + VestingAccount::LEN,
        seeds = [b"vesting", vault.key().as_ref(), mint.key().as_ref(), beneficiary.key().as_ref()],
        bump
    )]
    pub vesting_account: Account<'info, VestingAccount>,
    #[account(seeds = [b"vault", mint.key().as_ref()], bump = vault.bump)]   
    pub vault: Account<'info, Vault>,
    pub mint: Account<'info, Mint>,
    pub beneficiary: SystemAccount<'info>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub admin: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Claim<'info> {
    #[account(mut,
        seeds = [b"vesting", vault.key().as_ref(), mint.key().as_ref(), beneficiary.key().as_ref()],
        bump = vesting_account.bump,
        has_one = beneficiary,
        has_one = mint
    )]
    pub vesting_account: Account<'info, VestingAccount>,
    #[account(
        seeds = [b"vault", mint.key().as_ref()],
        bump = vault.bump
    )]
    pub vault: Account<'info, Vault>,
    #[account(mut,
        constraint = vault_token_account.mint == mint.key(),
        constraint = vault_token_account.owner == vault.key()
    )]
    pub vault_token_account: Account<'info, TokenAccount>,   
    #[account(mut,
        constraint = beneficiary_token_account.mint == mint.key()
    )]
    pub beneficiary_token_account: Account<'info, TokenAccount>,
    pub mint: Account<'info, Mint>,
    pub beneficiary: Signer<'info>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct AdminClaim<'info> {
    #[account(
        mut,
        seeds = [b"vesting", vault.key().as_ref(), mint.key().as_ref(), vesting_account.beneficiary.key().as_ref()],
        bump = vesting_account.bump,
        has_one = mint
    )]
    pub vesting_account: Account<'info, VestingAccount>,
    #[account(
        seeds = [b"vault", mint.key().as_ref()],
        bump = vault.bump
    )]
    pub vault: Account<'info, Vault>,
    #[account(
        mut,
        constraint = vault_token_account.mint == mint.key(),
        constraint = vault_token_account.owner == vault.key()
    )]
    pub vault_token_account: Account<'info, TokenAccount>,
    #[account(
        mut,
        constraint = beneficiary_token_account.mint == mint.key()
    )]
    pub beneficiary_token_account: Account<'info, TokenAccount>,
    pub mint: Account<'info, Mint>,
    pub token_program: Program<'info, Token>,
    pub admin: Signer<'info>,
}

#[derive(Accounts)]
pub struct GetClaimable<'info> {
    #[account(
        seeds = [b"vesting", vault.key().as_ref(), mint.key().as_ref(), beneficiary.key().as_ref()],
        bump = vesting_account.bump,
        has_one = beneficiary,
        has_one = mint
    )]
    pub vesting_account: Account<'info, VestingAccount>,
    #[account(
        seeds = [b"vault", mint.key().as_ref()],
        bump = vault.bump
    )]
    pub vault: Account<'info, Vault>,
    pub mint: Account<'info, Mint>,
    pub beneficiary: SystemAccount<'info>,
}

#[derive(Accounts)]
pub struct PauseOrUnpause<'info> {
    #[account(
        mut,
        seeds = [b"vesting", vault.key().as_ref(), mint.key().as_ref(), vesting_account.beneficiary.key().as_ref()],
        bump = vesting_account.bump,
        has_one = mint
    )]
    pub vesting_account: Account<'info, VestingAccount>,
    #[account(
        seeds = [b"vault", mint.key().as_ref()],
        bump = vault.bump
    )]
    pub vault: Account<'info, Vault>,
    pub mint: Account<'info, Mint>,
    pub admin: Signer<'info>,
}

#[derive(Accounts)]
pub struct RevokeVesting<'info> {
    #[account(
        mut,
        seeds = [b"vesting", vault.key().as_ref(), mint.key().as_ref(), vesting_account.beneficiary.key().as_ref()],
        bump = vesting_account.bump,
        has_one = mint
    )]
    pub vesting_account: Account<'info, VestingAccount>,
    #[account(
        seeds = [b"vault", mint.key().as_ref()],
        bump = vault.bump
    )]
    pub vault: Account<'info, Vault>,
    #[account(
        mut,
        constraint = vault_token_account.mint == mint.key(),
        constraint = vault_token_account.owner == vault.key()
    )]
    pub vault_token_account: Account<'info, TokenAccount>,
    #[account(
        mut,
        constraint = recovery_destination.mint == mint.key()
    )]
    pub recovery_destination: Account<'info, TokenAccount>,
    pub mint: Account<'info, Mint>,
    pub token_program: Program<'info, Token>,
    pub admin: Signer<'info>,
}

#[derive(Accounts)]
pub struct InstantUnlock<'info> {
    #[account(
        mut,
        seeds = [b"vesting", vault.key().as_ref(), mint.key().as_ref(), vesting_account.beneficiary.key().as_ref()],
        bump = vesting_account.bump,
        has_one = mint
    )]
    pub vesting_account: Account<'info, VestingAccount>,
    #[account(
        seeds = [b"vault", mint.key().as_ref()],
        bump = vault.bump
    )]
    pub vault: Account<'info, Vault>,
    #[account(
        mut,
        constraint = vault_token_account.mint == mint.key(),
        constraint = vault_token_account.owner == vault.key()
    )]
    pub vault_token_account: Account<'info, TokenAccount>,
    #[account(
        mut,
        constraint = beneficiary_token_account.mint == mint.key()
    )]
    pub beneficiary_token_account: Account<'info, TokenAccount>,
    pub mint: Account<'info, Mint>,
    pub token_program: Program<'info, Token>,
    pub admin: Signer<'info>,
}

#[derive(Accounts)]
pub struct EmergencyRecover<'info> {
    #[account(
        seeds = [b"vault", mint.key().as_ref()],
        bump = vault.bump
    )]
    pub vault: Account<'info, Vault>,
    #[account(
        mut,
        constraint = vault_token_account.mint == mint.key(),
        constraint = vault_token_account.owner == vault.key()
    )]
    pub vault_token_account: Account<'info, TokenAccount>,
    #[account(
        mut,
        constraint = recovery_destination.mint == mint.key()
    )]
    pub recovery_destination: Account<'info, TokenAccount>,
    pub mint: Account<'info, Mint>,
    pub token_program: Program<'info, Token>,
    pub admin: Signer<'info>,
}

#[derive(Accounts)]
pub struct BatchInitializeVesting<'info> {
    #[account(seeds = [b"vault", mint.key().as_ref()], bump = vault.bump)]
    pub vault: Account<'info, Vault>,
    pub mint: Account<'info, Mint>,
    #[account(mut)]
    pub admin: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct PauseVault<'info> {
    #[account(
        mut,
        seeds = [b"vault", mint.key().as_ref()],
        bump = vault.bump
    )]
    pub vault: Account<'info, Vault>,
    pub mint: Account<'info, Mint>,
    pub admin: Signer<'info>,
}

#[derive(Accounts)]
pub struct FundVaultExisting<'info> {
    #[account(
        mut,
        seeds = [b"vault", mint.key().as_ref()],
        bump = vault.bump
    )]
    pub vault: Account<'info, Vault>,
    #[account(
        mut,
        constraint = source_token_account.mint == mint.key(),
        constraint = source_token_account.owner == payer.key()
    )]
    pub source_token_account: Account<'info, TokenAccount>,
    #[account(
        mut,
        constraint = vault_token_account.mint == mint.key(),
        constraint = vault_token_account.owner == vault.key()
    )]
    pub vault_token_account: Account<'info, TokenAccount>,
    pub mint: Account<'info, Mint>,
    pub admin: Signer<'info>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub token_program: Program<'info, Token>,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct BatchVestingArgs {
    pub beneficiary: Pubkey,
    pub mint: Pubkey, // Add mint
    pub start_time: i64,
    pub cliff_period: i64,
    pub duration: i64,
    pub total_amount: u64,
}

impl VestingAccount {
    pub const LEN: usize = 32 + // beneficiary (Pubkey)
        32 + // Mint (Pubkey)
        8 +  // start_time (i64)
        8 +  // cliff_period (i64)
        8 +  // duration (i64)
        8 +  // total_amount (u64)
        8 +  // claimed_amount (u64)
        1 +  // paused (bool)
        1 +  // initialized (bool)
        1 +  // revoked (bool)
        1; // bump (u8)
}

impl Vault {
    pub const LEN: usize = 1 +  // bump (u8)
        32 + // admin (Pubkey)
        1 +  // paused (bool)
        1; // initialized (bool)
}

#[account]
pub struct Vault {
    pub bump: u8,
    pub admin: Pubkey,
    pub paused: bool,
    pub initialized: bool,
}

#[account]
pub struct VestingAccount {
    pub beneficiary: Pubkey,
    pub mint: Pubkey,
    pub start_time: i64,
    pub cliff_period: i64,
    pub duration: i64,
    pub total_amount: u64,
    pub claimed_amount: u64,
    pub paused: bool,
    pub initialized: bool,
    pub revoked: bool,
    pub bump: u8,
}

#[error_code]
pub enum VestingError {
    #[msg("Cliff period not yet reached.")]
    CliffNotReached,
    #[msg("No tokens available to claim.")]
    NothingToClaim,
    #[msg("Vesting not initialized.")]
    NotInitialized,
    #[msg("Vesting is currently paused.")]
    Paused,
    #[msg("Vault is currently paused.")]
    VaultPaused,
    #[msg("Too few vesting accounts provided.")]
    NotEnoughAccounts,
    #[msg("Vesting already initialized.")]
    AlreadyInitialized,
    #[msg("Invalid account owner.")]
    InvalidAccountOwner,
    #[msg("Unauthorized admin.")]
    Unauthorized,
    #[msg("Invalid timestamp: current time is before start time.")]
    InvalidTimestamp,
    #[msg("Duration must be positive.")]
    InvalidDuration,
    #[msg("Cliff period must be non-negative and less than or equal to duration.")]
    InvalidCliffPeriod,
    #[msg("Total amount must be positive.")]
    InvalidAmount,
    #[msg("Too many accounts to process in one transaction.")]
    TooManyAccounts,
    #[msg("Vault not initialized.")]
    VaultNotInitialized,
    #[msg("Vesting account has been revoked.")]
    VestingRevoked,
    #[msg("Invalid vesting account PDA.")]
    InvalidAccount,
    #[msg("Vesting account is not revoked.")]
    NotRevoked,
    #[msg("Invalid number of accounts provided.")]
    InvalidAccountCount,
}