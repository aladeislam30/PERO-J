#![no_std]
use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, panic_with_error, vec, Address, Env,
    IntoVal, String, Symbol,
};

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    AlreadyInitialised = 1,
    NotInitialised = 2,
    Unauthorized = 3,
    ContractPaused = 4,
    InvalidAmount = 5,
    InvalidState = 6,
    TitleTooLong = 7,
    DescriptionTooLong = 8,
    InvalidUrl = 9,
}

/// Maximum allowed length (in bytes) for a market title.
pub const MAX_TITLE_LEN: u32 = 160;
/// Maximum allowed length (in bytes) for a market description.
pub const MAX_DESCRIPTION_LEN: u32 = 1000;

/// Single-field market state replacing the separate
/// `resolved` / `cancelled` / `outcome` / `disputed` flags.
#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum MarketStatus {
    Open,
    ResolvedYes,
    ResolvedNo,
    Disputed,
    Cancelled,
}

#[contracttype]
#[derive(Clone)]
pub struct Market {
    pub status: MarketStatus,
    pub yes_pool: i128,
    pub no_pool: i128,
}

/// Pre-packing layout, kept so existing active markets still deserialize.
#[contracttype]
#[derive(Clone)]
pub struct LegacyMarket {
    pub resolved: bool,
    pub cancelled: bool,
    pub outcome: bool,
    pub disputed: bool,
    pub yes_pool: i128,
    pub no_pool: i128,
}

#[contracttype]
pub enum DataKey {
    Admin,
    Token,
    Registry,
    IsPaused,
    Market,
    LegacyMarket,
    HasBet(Address),
}

#[contract]
pub struct MarketContract;

fn admin(env: &Env) -> Address {
    env.storage()
        .instance()
        .get(&DataKey::Admin)
        .unwrap_or_else(|| panic_with_error!(env, Error::NotInitialised))
}

/// Requires the caller to be the admin account.
///
/// The admin is expected to be a Stellar multi-signature account configured
/// with a 3-of-5 signer set and `high` threshold. `require_auth` on the admin
/// address forces the Stellar ledger to satisfy that account's signer weights
/// and thresholds before this contract entry point can execute, so a single
/// key cannot authorize privileged operations on its own.
fn require_admin(env: &Env, caller: &Address) {
    caller.require_auth();
    if *caller != admin(env) {
        panic_with_error!(env, Error::Unauthorized);
    }
}

fn require_not_paused(env: &Env) {
    if env.storage().instance().get(&DataKey::IsPaused).unwrap_or(false) {
        panic_with_error!(env, Error::ContractPaused);
    }
}

/// Rejects market titles longer than [`MAX_TITLE_LEN`] bytes.
pub fn validate_title(env: &Env, title: &String) {
    if title.len() > MAX_TITLE_LEN {
        panic_with_error!(env, Error::TitleTooLong);
    }
}

/// Rejects market descriptions longer than [`MAX_DESCRIPTION_LEN`] bytes.
pub fn validate_description(env: &Env, description: &String) {
    if description.len() > MAX_DESCRIPTION_LEN {
        panic_with_error!(env, Error::DescriptionTooLong);
    }
}

/// Rejects external evidence/source URLs that are not well-formed `http(s)` URLs.
pub fn validate_url(env: &Env, url: &String) {
    let len = url.len();
    if len == 0 {
        panic_with_error!(env, Error::InvalidUrl);
    }
    let bytes = url.to_bytes();
    let scheme_len: u32 = if starts_with(&bytes, b"https://") {
        8
    } else if starts_with(&bytes, b"http://") {
        7
    } else {
        panic_with_error!(env, Error::InvalidUrl);
    };
    // Require at least one host character after the scheme.
    if len <= scheme_len {
        panic_with_error!(env, Error::InvalidUrl);
    }
    // Reject whitespace and control characters anywhere in the URL.
    let mut i: u32 = 0;
    while i < len {
        let b = bytes.get_unchecked(i);
        if b <= 0x20 || b == 0x7f {
            panic_with_error!(env, Error::InvalidUrl);
        }
        i += 1;
    }
}

fn starts_with(bytes: &soroban_sdk::Bytes, prefix: &[u8]) -> bool {
    if bytes.len() < prefix.len() as u32 {
        return false;
    }
    let mut i: u32 = 0;
    while i < prefix.len() as u32 {
        if bytes.get_unchecked(i) != prefix[i as usize] {
            return false;
        }
        i += 1;
    }
    true
}

fn load_market(env: &Env) -> Market {
    if let Some(m) = env.storage().persistent().get::<_, Market>(&DataKey::Market) {
        return m;
    }
    let l: LegacyMarket = env
        .storage()
        .persistent()
        .get(&DataKey::LegacyMarket)
        .unwrap_or_else(|| panic_with_error!(env, Error::NotInitialised));
    from_legacy(&l)
}

fn from_legacy(l: &LegacyMarket) -> Market {
    let status = if l.cancelled {
        MarketStatus::Cancelled
    } else if l.disputed {
        MarketStatus::Disputed
    } else if l.resolved {
        if l.outcome { MarketStatus::ResolvedYes } else { MarketStatus::ResolvedNo }
    } else {
        MarketStatus::Open
    };
    Market { status, yes_pool: l.yes_pool, no_pool: l.no_pool }
}

#[contractimpl]
impl MarketContract {
    pub fn init(env: Env, admin: Address, token: Address, registry: Option<Address>) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic_with_error!(&env, Error::AlreadyInitialised);
        }
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::Token, &token);
        if let Some(r) = registry {
            env.storage().instance().set(&DataKey::Registry, &r);
        }
        env.storage().instance().set(&DataKey::IsPaused, &false);
        env.storage().persistent().set(
            &DataKey::Market,
            &Market { status: MarketStatus::Open, yes_pool: 0, no_pool: 0 },
        );
    }

    /// Validates market content (title, description, source URL) against the
    /// contract's length limits and URL format rules. Reverts on invalid input.
    pub fn validate_content(env: Env, title: String, description: String, source_url: String) {
        validate_title(&env, &title);
        validate_description(&env, &description);
        validate_url(&env, &source_url);
    }

    pub fn pause(env: Env, admin: Address) {
        require_admin(&env, &admin);
        env.storage().instance().set(&DataKey::IsPaused, &true);
    }

    pub fn unpause(env: Env, admin: Address) {
        require_admin(&env, &admin);
        env.storage().instance().set(&DataKey::IsPaused, &false);
    }

    pub fn is_paused(env: Env) -> bool {
        env.storage().instance().get(&DataKey::IsPaused).unwrap_or(false)
    }

    /// Rewrites a legacy flag-based market into the packed status form.
    pub fn migrate(env: Env, admin: Address) {
        require_admin(&env, &admin);
        let l: LegacyMarket = env
            .storage()
            .persistent()
            .get(&DataKey::LegacyMarket)
            .unwrap_or_else(|| panic_with_error!(&env, Error::InvalidState));
        env.storage().persistent().set(&DataKey::Market, &from_legacy(&l));
        env.storage().persistent().remove(&DataKey::LegacyMarket);
    }

    pub fn place_bet(env: Env, bettor: Address, yes: bool, amount: i128) {
        require_not_paused(&env);
        bettor.require_auth();
        if amount <= 0 {
            panic_with_error!(&env, Error::InvalidAmount);
        }
        let mut m = load_market(&env);
        if m.status != MarketStatus::Open {
            panic_with_error!(&env, Error::InvalidState);
        }
        let token: Address = env.storage().instance().get(&DataKey::Token).unwrap();
        env.invoke_contract::<()>(
            &token,
            &Symbol::new(&env, "transfer"),
            vec![&env, bettor.to_val(), env.current_contract_address().to_val(), amount.into_val(&env)],
        );
        if yes { m.yes_pool += amount } else { m.no_pool += amount }
        env.storage().persistent().set(&DataKey::Market, &m);

        let first = !env.storage().persistent().has(&DataKey::HasBet(bettor.clone()));
        if first {
            env.storage().persistent().set(&DataKey::HasBet(bettor.clone()), &true);
            if let Some(reg) = env.storage().instance().get::<_, Address>(&DataKey::Registry) {
                env.invoke_contract::<()>(
                    &reg,
                    &Symbol::new(&env, "record_first_bet"),
                    vec![&env, env.current_contract_address().to_val(), bettor.to_val()],
                );
            }
        }
    }

    pub fn submit_outcome(env: Env, admin: Address, yes: bool) {
        require_not_paused(&env);
        require_admin(&env, &admin);
        let mut m = load_market(&env);
        if m.status != MarketStatus::Open {
            panic_with_error!(&env, Error::InvalidState);
        }
        m.status = if yes { MarketStatus::ResolvedYes } else { MarketStatus::ResolvedNo };
        env.storage().persistent().set(&DataKey::Market, &m);
    }

    pub fn challenge_outcome(env: Env, challenger: Address) {
        require_not_paused(&env);
        challenger.require_auth();
        let mut m = load_market(&env);
        if m.status != MarketStatus::ResolvedYes && m.status != MarketStatus::ResolvedNo {
            panic_with_error!(&env, Error::InvalidState);
        }
        m.status = MarketStatus::Disputed;
        env.storage().persistent().set(&DataKey::Market, &m);
    }

    pub fn get_market(env: Env) -> Market {
        load_market(&env)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::testutils::Address as _;

    fn setup() -> (Env, MarketContractClient<'static>, Address) {
        let env = Env::default();
        env.mock_all_auths();
        let id = env.register_contract(None, MarketContract);
        let c = MarketContractClient::new(&env, &id);
        let admin = Address::generate(&env);
        c.init(&admin, &Address::generate(&env), &None);
        (env, c, admin)
    }

    #[test]
    fn pause_blocks_mutations_not_reads() {
        let (env, c, admin) = setup();
        c.pause(&admin);
        assert!(c.is_paused());
        assert_eq!(c.try_submit_outcome(&admin, &true), Err(Ok(soroban_sdk::Error::from_contract_error(Error::ContractPaused as u32))));
        assert_eq!(c.try_challenge_outcome(&Address::generate(&env)), Err(Ok(soroban_sdk::Error::from_contract_error(Error::ContractPaused as u32))));
        assert_eq!(
            c.try_place_bet(&Address::generate(&env), &true, &1),
            Err(Ok(soroban_sdk::Error::from_contract_error(Error::ContractPaused as u32)))
        );
    }

    #[test]
    fn validate_content_accepts_valid_input() {
        let (env, c, _admin) = setup();
        let title = String::from_str(&env, "Will BTC close above $100k?");
        let desc = String::from_str(&env, "Resolves YES if BTC/USD closes above 100000 on 2025-12-31.");
        let url = String::from_str(&env, "https://example.com/evidence");
        c.validate_content(&title, &desc, &url);
    }

    #[test]
    fn validate_content_rejects_oversized_title() {
        let (env, c, _admin) = setup();
        let long = "a".repeat((MAX_TITLE_LEN + 1) as usize);
        let title = String::from_str(&env, &long);
        let desc = String::from_str(&env, "ok");
        let url = String::from_str(&env, "https://example.com");
        assert_eq!(
            c.try_validate_content(&title, &desc, &url),
            Err(Ok(soroban_sdk::Error::from_contract_error(Error::TitleTooLong as u32)))
        );
    }

    #[test]
    fn validate_content_rejects_oversized_description() {
        let (env, c, _admin) = setup();
        let title = String::from_str(&env, "ok");
        let long = "a".repeat((MAX_DESCRIPTION_LEN + 1) as usize);
        let desc = String::from_str(&env, &long);
        let url = String::from_str(&env, "https://example.com");
        assert_eq!(
            c.try_validate_content(&title, &desc, &url),
            Err(Ok(soroban_sdk::Error::from_contract_error(Error::DescriptionTooLong as u32)))
        );
    }

    #[test]
    fn validate_content_rejects_bad_url() {
        let (env, c, _admin) = setup();
        let title = String::from_str(&env, "ok");
        let desc = String::from_str(&env, "ok");
        let url = String::from_str(&env, "javascript:alert(1)");
        assert_eq!(
            c.try_validate_content(&title, &desc, &url),
            Err(Ok(soroban_sdk::Error::from_contract_error(Error::InvalidUrl as u32)))
        );
    }
}
