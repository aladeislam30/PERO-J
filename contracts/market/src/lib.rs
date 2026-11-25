#![no_std]
use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, panic_with_error, vec, Address, Env,
    IntoVal, Symbol,
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
    SlippageExceeded = 7,
}

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

/// Current implied odds (in basis points, 0..=10_000) for the given side.
///
/// Odds are the share of the total pool backing the chosen side. An empty
/// pool yields 5_000 (50%) so the first bettor is not blocked by slippage.
fn current_odds(m: &Market, yes: bool) -> u32 {
    let total = m.yes_pool + m.no_pool;
    if total <= 0 {
        return 5_000;
    }
    let side = if yes { m.yes_pool } else { m.no_pool };
    ((side * 10_000) / total) as u32
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

    /// Places a bet with slippage protection.
    ///
    /// `min_acceptable_odds` is the minimum implied odds (basis points, 0..=10_000)
    /// the bettor will accept for the chosen side. If the odds have shifted below
    /// this threshold (e.g. due to a sandwiching bet), the transaction reverts.
    pub fn place_bet(
        env: Env,
        bettor: Address,
        yes: bool,
        amount: i128,
        min_acceptable_odds: u32,
    ) {
        require_not_paused(&env);
        bettor.require_auth();
        if amount <= 0 {
            panic_with_error!(&env, Error::InvalidAmount);
        }
        let mut m = load_market(&env);
        if m.status != MarketStatus::Open {
            panic_with_error!(&env, Error::InvalidState);
        }
        if current_odds(&m, yes) < min_acceptable_odds {
            panic_with_error!(&env, Error::SlippageExceeded);
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
            c.try_place_bet(&Address::generate(&env), &true, &1, &0),
            Err(Ok(soroban_sdk::Error::from_contract_error(Error::ContractPaused as u32)))
        );
        assert_eq!(c.get_market().status, MarketStatus::Open);
        c.unpause(&admin);
        c.submit_outcome(&admin, &true);
        assert_eq!(c.get_market().status, MarketStatus::ResolvedYes);
    }

    #[test]
    fn legacy_market_migrates() {
        let (env, c, admin) = setup();
        env.as_contract(&c.address, || {
            env.storage().persistent().set(
                &DataKey::LegacyMarket,
                &LegacyMarket {
                    resolved: true,
                    cancelled: false,
                    outcome: true,
                    disputed: false,
                    yes_pool: 10,
                    no_pool: 5,
                },
            );
            env.storage().persistent().remove(&DataKey::Market);
        });
        c.migrate(&admin);
        let m = c.get_market();
        assert_eq!(m.status, MarketStatus::ResolvedYes);
        assert_eq!(m.yes_pool, 10);
        assert_eq!(m.no_pool, 5);
    }

    #[test]
    fn place_bet_reverts_when_odds_below_threshold() {
        let (env, c, _admin) = setup();
        // Seed the pool so yes odds are 50% (5_000 bps).
        c.place_bet(&Address::generate(&env), &true, &100, &0);
        c.place_bet(&Address::generate(&env), &false, &100, &0);
        // Requiring 60% odds must revert since current odds are 50%.
        assert_eq!(
            c.try_place_bet(&Address::generate(&env), &true, &10, &6_000),
            Err(Ok(soroban_sdk::Error::from_contract_error(Error::SlippageExceeded as u32)))
        );
        // Requiring 50% odds succeeds.
        c.place_bet(&Address::generate(&env), &true, &10, &5_000);
    }
}
