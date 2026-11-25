// Council governance and bet limit events
pub struct CouncilVoteCastEvent {
    pub proposal_id: u64,
    pub voter: soroban_sdk::Address,
    pub support: bool,
}

pub struct CouncilThresholdReachedEvent {
    pub proposal_id: u64,
    pub outcome: u32,
}

pub struct BetLimitExceededEvent {
    pub user: soroban_sdk::Address,
    pub attempted_amount: i128,
    pub max_limit: i128,
}
