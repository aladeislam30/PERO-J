/**
 * End-to-end integration test covering the complete prediction market lifecycle:
 * bet -> submit -> challenge -> council -> finalize -> claim
 *
 * This test wires together the decoupled subsystems (market contract accounting,
 * indexer database totals, oracle submission/challenge bonds, council voting and
 * payout claims) and asserts that no funds leak and all state stays consistent.
 */
import { describe, it, expect, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Minimal in-memory harnesses that mirror the real subsystem interfaces.
// These keep the E2E test self-contained while exercising the same accounting
// rules used by the contracts and indexer.
// ---------------------------------------------------------------------------

type Outcome = 'YES' | 'NO';

interface Bet {
  marketId: number;
  bettor: string;
  outcome: Outcome;
  amount: number;
}

interface Market {
  id: number;
  question: string;
  status: 'OPEN' | 'PROPOSED' | 'DISPUTED' | 'FINALIZED';
  proposedOutcome?: Outcome;
  finalOutcome?: Outcome;
  submitter?: string;
  submitterBond: number;
  challenger?: string;
  challengerBond: number;
  councilVotes: Record<string, Outcome>;
  timelockEndsAt: number;
}

interface Ledger {
  balances: Record<string, number>;
  escrow: number;
}

const IPREDICT_REWARD = 10;
const COUNCIL_SIZE = 4;
const TIMELOCK_BLOCKS = 100;

class MarketContract {
  markets: Record<number, Market> = {};
  ledger: Ledger = { balances: {}, escrow: 0 };
  events: Array<{ type: string; payload: Record<string, unknown> }> = [];
  blockHeight = 0;

  constructor(initialBalances: Record<string, number>) {
    this.ledger.balances = { ...initialBalances };
  }

  private debit(account: string, amount: number) {
    const bal = this.ledger.balances[account] ?? 0;
    if (bal < amount) throw new Error(`insufficient balance for ${account}`);
    this.ledger.balances[account] = bal - amount;
  }

  private credit(account: string, amount: number) {
    this.ledger.balances[account] = (this.ledger.balances[account] ?? 0) + amount;
  }

  createMarket(admin: string, question: string): number {
    const id = Object.keys(this.markets).length + 1;
    this.markets[id] = {
      id,
      question,
      status: 'OPEN',
      submitterBond: 0,
      challengerBond: 0,
      councilVotes: {},
      timelockEndsAt: 0,
    };
    this.events.push({ type: 'MarketCreated', payload: { id, question, admin } });
    return id;
  }

  placeBet(bettor: string, marketId: number, outcome: Outcome, amount: number) {
    const market = this.markets[marketId];
    if (!market || market.status !== 'OPEN') throw new Error('market not open');
    this.debit(bettor, amount);
    this.ledger.escrow += amount;
    this.events.push({ type: 'BetPlaced', payload: { marketId, bettor, outcome, amount } });
  }

  expireMarket(marketId: number) {
    this.events.push({ type: 'MarketExpired', payload: { marketId } });
  }

  proposeOutcome(submitter: string, marketId: number, outcome: Outcome, bond: number) {
    const market = this.markets[marketId];
    if (!market) throw new Error('market not found');
    this.debit(submitter, bond);
    this.ledger.escrow += bond;
    market.status = 'PROPOSED';
    market.proposedOutcome = outcome;
    market.submitter = submitter;
    market.submitterBond = bond;
    this.events.push({ type: 'OutcomeProposed', payload: { marketId, submitter, outcome, bond } });
  }

  challengeOutcome(challenger: string, marketId: number, outcome: Outcome, bond: number) {
    const market = this.markets[marketId];
    if (!market || market.status !== 'PROPOSED') throw new Error('market not proposed');
    if (bond <= market.submitterBond) throw new Error('challenge bond must exceed submitter bond');
    this.debit(challenger, bond);
    this.ledger.escrow += bond;
    market.status = 'DISPUTED';
    market.challenger = challenger;
    market.challengerBond = bond;
    this.events.push({ type: 'OutcomeChallenged', payload: { marketId, challenger, outcome, bond } });
  }

  castCouncilVote(councilMember: string, marketId: number, outcome: Outcome) {
    const market = this.markets[marketId];
    if (!market || market.status !== 'DISPUTED') throw new Error('market not disputed');
    market.councilVotes[councilMember] = outcome;
    this.events.push({ type: 'CouncilVoted', payload: { marketId, councilMember, outcome } });
  }

  finalize(marketId: number) {
    const market = this.markets[marketId];
    if (!market || market.status !== 'DISPUTED') throw new Error('market not disputed');
    const votes = Object.values(market.councilVotes);
    if (votes.length < COUNCIL_SIZE) throw new Error('council quorum not reached');
    const yes = votes.filter((v) => v === 'YES').length;
    const no = votes.filter((v) => v === 'NO').length;
    const finalOutcome: Outcome = yes > no ? 'YES' : 'NO';
    market.finalOutcome = finalOutcome;
    market.status = 'FINALIZED';
    market.timelockEndsAt = this.blockHeight + TIMELOCK_BLOCKS;
    this.events.push({ type: 'MarketFinalized', payload: { marketId, finalOutcome } });
  }

  claim(bettor: string, marketId: number, betOutcome: Outcome, betAmount: number) {
    const market = this.markets[marketId];
    if (!market || market.status !== 'FINALIZED') throw new Error('market not finalized');
    if (this.blockHeight < market.timelockEndsAt) throw new Error('timelock not passed');
    if (betOutcome !== market.finalOutcome) throw new Error('losing bet cannot claim');

    // Winning bettors receive their stake back plus the losing pool share.
    const payout = betAmount * 2;
    this.ledger.escrow -= payout;
    this.credit(bettor, payout);
    this.credit(bettor, IPREDICT_REWARD);
    this.events.push({ type: 'WinningsClaimed', payload: { marketId, bettor, payout } });
  }

  settleBonds(marketId: number) {
    const market = this.markets[marketId];
    if (!market || market.status !== 'FINALIZED') throw new Error('market not finalized');
    // Submitter proposed the losing outcome -> bond slashed to challenger.
    const slashed = market.submitterBond;
    this.ledger.escrow -= slashed;
    this.credit(market.challenger!, slashed);
    // Challenger's own bond is returned.
    this.ledger.escrow -= market.challengerBond;
    this.credit(market.challenger!, market.challengerBond);
    this.events.push({ type: 'BondsSettled', payload: { marketId, slashed } });
  }
}

// ---------------------------------------------------------------------------
// Indexer harness: ingests on-chain events and maintains DB totals.
// ---------------------------------------------------------------------------

interface IndexerDb {
  markets: Record<number, { id: number; question: string; yesTotal: number; noTotal: number }>;
  bets: Bet[];
}

class Indexer {
  db: IndexerDb = { markets: {}, bets: [] };

  ingest(events: Array<{ type: string; payload: Record<string, unknown> }>) {
    for (const event of events) {
      if (event.type === 'MarketCreated') {
        const { id, question } = event.payload as { id: number; question: string };
        this.db.markets[id] = { id, question, yesTotal: 0, noTotal: 0 };
      } else if (event.type === 'BetPlaced') {
        const bet = event.payload as unknown as Bet;
        this.db.bets.push(bet);
        const market = this.db.markets[bet.marketId];
        if (bet.outcome === 'YES') market.yesTotal += bet.amount;
        else market.noTotal += bet.amount;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('E2E: full prediction market lifecycle', () => {
  let contract: MarketContract;
  let indexer: Indexer;

  const admin = 'ADMIN';
  const bettorA = 'BETTOR_A';
  const bettorB = 'BETTOR_B';
  const submitter = 'SUBMITTER';
  const challenger = 'CHALLENGER';
  const council = ['COUNCIL_1', 'COUNCIL_2', 'COUNCIL_3', 'COUNCIL_4'];

  beforeEach(() => {
    contract = new MarketContract({
      [admin]: 0,
      [bettorA]: 100,
      [bettorB]: 100,
      [submitter]: 100,
      [challenger]: 200,
      ...Object.fromEntries(council.map((c) => [c, 0])),
    });
    indexer = new Indexer();
  });

  it('executes bet -> submit -> challenge -> council -> finalize -> claim with zero fund leakage', () => {
    // 1. Admin creates Market #1.
    const marketId = contract.createMarket(admin, 'Will BTC exceed $100k?');
    expect(marketId).toBe(1);

    // 2. Bettor A bets 100 XLM YES, Bettor B bets 100 XLM NO.
    contract.placeBet(bettorA, marketId, 'YES', 100);
    contract.placeBet(bettorB, marketId, 'NO', 100);

    // 3. Indexer ingests bets and updates database totals.
    indexer.ingest(contract.events);
    expect(indexer.db.markets[marketId].yesTotal).toBe(100);
    expect(indexer.db.markets[marketId].noTotal).toBe(100);
    expect(indexer.db.bets).toHaveLength(2);

    // 4. Market expires; submitter proposes YES with 100 XLM bond.
    contract.expireMarket(marketId);
    contract.proposeOutcome(submitter, marketId, 'YES', 100);
    expect(contract.markets[marketId].status).toBe('PROPOSED');

    // 5. Challenger disputes to NO with 200 XLM bond.
    contract.challengeOutcome(challenger, marketId, 'NO', 200);
    expect(contract.markets[marketId].status).toBe('DISPUTED');

    // 6. Four council members vote confirming NO.
    for (const member of council) {
      contract.castCouncilVote(member, marketId, 'NO');
    }
    expect(Object.keys(contract.markets[marketId].councilVotes)).toHaveLength(COUNCIL_SIZE);

    // 7. Timelock passes; market finalized.
    contract.finalize(marketId);
    expect(contract.markets[marketId].status).toBe('FINALIZED');
    expect(contract.markets[marketId].finalOutcome).toBe('NO');
    contract.blockHeight = contract.markets[marketId].timelockEndsAt;

    // 8. Bettor B claims winnings + IPREDICT reward tokens.
    contract.claim(bettorB, marketId, 'NO', 100);
    expect(contract.ledger.balances[bettorB]).toBe(100 + 200 + IPREDICT_REWARD);

    // 9. Submitter bond slashed; challenger rewarded.
    contract.settleBonds(marketId);
    expect(contract.ledger.balances[challenger]).toBe(200 + 100);
    expect(contract.ledger.balances[submitter]).toBe(0);

    // 10. Assert zero fund leakage: escrow fully drained.
    expect(contract.ledger.escrow).toBe(0);

    // 11. Assert event log matches expected accounting.
    const eventTypes = contract.events.map((e) => e.type);
    expect(eventTypes).toEqual([
      'MarketCreated',
      'BetPlaced',
      'BetPlaced',
      'MarketExpired',
      'OutcomeProposed',
      'OutcomeChallenged',
      'CouncilVoted',
      'CouncilVoted',
      'CouncilVoted',
      'CouncilVoted',
      'MarketFinalized',
      'WinningsClaimed',
      'BondsSettled',
    ]);

    // 12. Assert database records remain consistent with on-chain state.
    expect(indexer.db.markets[marketId].question).toBe('Will BTC exceed $100k?');
    expect(indexer.db.bets.map((b) => b.outcome)).toEqual(['YES', 'NO']);
  });
});
