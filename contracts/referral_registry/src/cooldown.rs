// Referral registration cooldown and Sybil resistance guards
pub const REFERRAL_REGISTRATION_COOLDOWN_LEDGERS: u32 = 17280; // ~24h at 5s/ledger

pub fn check_registration_cooldown(last_registration_ledger: u32, current_ledger: u32) -> bool {
    current_ledger >= last_registration_ledger.saturating_add(REFERRAL_REGISTRATION_COOLDOWN_LEDGERS)
}
