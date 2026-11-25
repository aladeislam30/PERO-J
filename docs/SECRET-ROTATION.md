# Secret Rotation Runbook

This runbook describes how to rotate database credentials, API keys, and hot
wallet keys for PERO-J without service downtime. All commands are run from
`backend/scripts`.

## Prerequisites

- Node.js >= 20 and `tsx` available (`npm install` in `backend/scripts`).
- Admin database credentials exported as `PGADMIN_USER` / `PGADMIN_PASSWORD`.
- Access to the secret store used by the application.

## PostgreSQL credentials (zero-downtime, dual-user)

The application connects through a rotating login role (`pero_app_blue` /
`pero_app_green`). Rotation always targets the inactive role, so the active
role keeps serving traffic.

1. Check current state:

   ```sh
   npm run rotate:status
   ```

2. Rotate the inactive role:

   ```sh
   npm run rotate:db
   ```

   The script creates or updates the inactive role with a fresh password and
   grants it the application privileges.

3. Update the secret store with the new password and flip `PG_ACTIVE_ROLE` to
   the newly rotated role. The application picks up the change on its next
   reconnect.

4. Verify the application is healthy on the new role, then repeat on the next
   cycle to retire the old role.

## API keys (staged)

1. Issue a new key alongside the current one:

   ```sh
   npm run rotate:api-key
   ```

2. Propagate `API_KEY_NEXT` to all consumers. Both keys are accepted during
   this window.

3. Once all consumers use the new key, finalize:

   ```sh
   API_KEY_PREVIOUS=<old key> npm run rotate:api-key:finalize
   ```

4. Promote `API_KEY_NEXT` to `API_KEY` in the secret store and remove the old
   key.

## Hot wallet keys (staged)

1. Generate a new keypair:

   ```sh
   npm run rotate:hot-wallet
   ```

2. Fund the new account and migrate treasury funds to the new public key.

3. Finalize once the new key is live:

   ```sh
   HOT_WALLET_PREVIOUS_PUBLIC_KEY=<old public key> npm run rotate:hot-wallet:finalize
   ```

4. Promote `HOT_WALLET_SECRET` to the active secret and remove the old key.

## Verification in staging

Before applying to production, run the full sequence in staging and confirm:

- The application stays healthy throughout the database rotation.
- API consumers continue to authenticate during the propagation window.
- Treasury operations succeed with the new hot wallet key.
