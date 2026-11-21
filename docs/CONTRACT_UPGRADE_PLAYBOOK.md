# Contract Upgrade Playbook

This playbook describes the verified, repeatable procedure for upgrading live Soroban
contracts (including `contracts/explorer`) that hold user funds. Follow every step in
order. Do not skip the hash-identity verification or the testnet migration run.

> **Golden rule:** never upgrade Mainnet with a WASM blob that has not been deployed and
> exercised on Testnet, and whose SHA-256 hash does not match the local build byte-for-byte.

---

## 0. Preconditions

- [ ] The upgrade change is merged and reviewed on `main`.
- [ ] You have the multi-sig admin keys available (threshold signers on standby).
- [ ] You have `stellar` CLI, `cargo`, `sha256sum` (or `shasum -a 256`), and `wasm-opt` installed.
- [ ] You have a funded Testnet identity and access to the Mainnet admin account.
- [ ] A rollback plan is written down (see [Rollback & Abort](#rollback--abort-contingencies)).

Record the following for the change ticket:

```
CONTRACT_ID   = <C... explorer contract id>
NETWORK       = testnet | mainnet
GIT_COMMIT    = <commit sha of the release>
```

---

## 1. Build optimized WASM and compute SHA-256 hash

Build reproducibly from the exact release commit:

```bash
git checkout <GIT_COMMIT>

# Build the contract to optimized WASM
stellar contract build
# or, if building the workspace member directly:
cargo build --target wasm32-unknown-unknown --release -p explorer

# Optimize the artifact (deterministic size/section layout)
wasm-opt -Oz \
  target/wasm32-unknown-unknown/release/explorer.wasm \
  -o explorer.optimized.wasm
```

Compute and record the hash of the **optimized** artifact:

```bash
sha256sum explorer.optimized.wasm | tee explorer.optimized.wasm.sha256
```

- [ ] Hash recorded in the change ticket.
- [ ] Artifact archived (attach `explorer.optimized.wasm` + `.sha256` to the ticket).

---

## 2. Deploy WASM to Stellar Testnet and run migration tests

Deploy the optimized WASM to Testnet and install it against the Testnet contract:

```bash
# Upload the WASM and capture the returned wasm hash
stellar contract upload \
  --wasm explorer.optimized.wasm \
  --source <testnet-identity> \
  --network testnet

# Invoke the admin upgrade entrypoint on the Testnet contract
stellar contract invoke \
  --id <TESTNET_CONTRACT_ID> \
  --source <testnet-admin> \
  --network testnet \
  -- upgrade \
  --new_wasm_hash <WASM_HASH_FROM_UPLOAD>
```

Run the automated migration tests against the upgraded Testnet contract:

```bash
# Point the test suite at the upgraded Testnet contract
EXPLORER_CONTRACT_ID=<TESTNET_CONTRACT_ID> \
STELLAR_NETWORK=testnet \
  cargo test --test migration
```

- [ ] Upload succeeded and returned a WASM hash.
- [ ] Upgrade invocation succeeded on Testnet.
- [ ] Migration tests pass against the upgraded Testnet contract.
- [ ] Smoke-test the explorer read paths (event indexing, queries) on Testnet.

---

## 3. Verify byte-for-byte hash identity

Before touching Mainnet, confirm the WASM you will deploy is identical to the one you
built and tested.

```bash
# Recompute the local hash
sha256sum explorer.optimized.wasm

# Fetch the deployed WASM from Testnet and hash it
stellar contract fetch \
  --id <TESTNET_CONTRACT_ID> \
  --network testnet \
  --out deployed.wasm
sha256sum deployed.wasm
```

- [ ] Local hash == Testnet-deployed hash == hash recorded in the ticket.
- [ ] If any hash differs, **STOP** and go to [Abort](#rollback--abort-contingencies).
  Do not proceed to Mainnet.

---

## 4. Execute multi-sig admin upgrade on Stellar Mainnet

Only proceed once Step 3 passes. The upgrade must be authorized by the multi-sig admin
threshold.

```bash
# Upload the verified WASM to Mainnet
stellar contract upload \
  --wasm explorer.optimized.wasm \
  --source <mainnet-admin> \
  --network mainnet

# Collect multi-sig signatures and submit the upgrade
stellar contract invoke \
  --id <MAINNET_CONTRACT_ID> \
  --source <mainnet-admin> \
  --network mainnet \
  -- upgrade \
  --new_wasm_hash <WASM_HASH_FROM_UPLOAD>
```

- [ ] Multi-sig threshold signatures collected and recorded.
- [ ] Upload + upgrade transaction confirmed on Mainnet.
- [ ] Re-run the hash identity check against the Mainnet contract (Step 3, `--network mainnet`).

---

## 5. Verify event indexing resumes

After the upgrade, confirm the explorer resumes indexing events from the new contract code.

- [ ] Indexer process is running and caught up to the latest ledger.
- [ ] New events emitted by the upgraded contract are ingested and queryable.
- [ ] No gaps in the event stream around the upgrade ledger.
- [ ] Dashboard / API health checks are green.

If indexing does not resume within the expected window, treat it as a failed upgrade and
go to [Rollback](#rollback--abort-contingencies).

---

## Rollback & Abort Contingencies

### Abort before Mainnet

If any Testnet step or hash-identity check fails:

1. **Do not** upload or invoke on Mainnet.
2. Record the failure and the observed hashes in the change ticket.
3. Fix the build (ensure reproducible build / correct commit) and restart from Step 1.

### Rollback after a Mainnet upgrade

Soroban upgrades replace the contract WASM; rollback means re-deploying the **previous**
known-good WASM hash via the same multi-sig admin path.

1. Retrieve the previous known-good WASM hash from the release archive / ticket history.
2. Collect multi-sig signatures for the rollback upgrade.
3. Invoke the upgrade entrypoint with the previous WASM hash:

   ```bash
   stellar contract invoke \
     --id <MAINNET_CONTRACT_ID> \
     --source <mainnet-admin> \
     --network mainnet \
     -- upgrade \
     --new_wasm_hash <PREVIOUS_KNOWN_GOOD_WASM_HASH>
   ```

4. Re-run the hash identity check (Step 3) against the restored WASM.
5. Verify event indexing resumes (Step 5).
6. Post-incident: document root cause and update this playbook if needed.

### Escalation

- If the multi-sig threshold cannot be reached, escalate to the on-call maintainers
  immediately and freeze further Mainnet operations until resolved.
