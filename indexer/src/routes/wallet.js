const express = require('express');
const router = express.Router();
const { pool } = require('../db');

// Validates Stellar Ed25519 public keys (G...) and contract IDs (C...).
// Strkey: 1 version byte + 32 payload bytes + 2 CRC16 bytes = 56 chars, base32.
const STRKEY_BASE32 = /^[A-Z2-7]+$/;

function isValidStellarAddress(address) {
  if (typeof address !== 'string' || address.length !== 56) {
    return false;
  }

  const version = address[0];
  if (version !== 'G' && version !== 'C') {
    return false;
  }

  return STRKEY_BASE32.test(address);
}

/**
 * @openapi
 * /api/wallet/{address}:
 *   get:
 *     summary: Get wallet by Stellar address
 *     description: >
 *       Retrieves the wallet record for the given Stellar address.
 *       The address must be a valid Stellar Strkey: 1 version byte
 *       (`G` for Ed25519 public keys, `C` for contract IDs) followed by
 *       32 payload bytes and 2 CRC16 bytes, encoded in base32 for a total
 *       of 56 characters (e.g. `G...` or `C...`).
 *     tags:
 *       - Wallet
 *     parameters:
 *       - in: path
 *         name: address
 *         required: true
 *         description: >
 *           Stellar Strkey address. Must be 56 characters, start with `G`
 *           (Ed25519 public key) or `C` (contract ID), and use base32
 *           characters `A-Z` and `2-7`.
 *         schema:
 *           type: string
 *           pattern: '^[GC][A-Z2-7]{55}$'
 *           minLength: 56
 *           maxLength: 56
 *           example: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF'
 *     responses:
 *       200:
 *         description: Wallet found.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 address:
 *                   type: string
 *                   description: The Stellar address of the wallet.
 *                   example: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF'
 *               additionalProperties: true
 *       400:
 *         description: Invalid Stellar address.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   example: Invalid Stellar address
 *       404:
 *         description: Wallet not found.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   example: Wallet not found
 *       500:
 *         description: Internal server error.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   example: Internal server error
 */
/**
 * @openapi
 * /api/wallet/{address}/bonds:
 *   get:
 *     summary: Get oracle bond positions for a wallet
 *     description: >
 *       Returns the submitter and challenger bond positions posted by the
 *       given Stellar address, including escrowed, returned and slashed
 *       bonds. The address must be a valid Stellar Strkey: 1 version byte
 *       (`G` for Ed25519 public keys, `C` for contract IDs) followed by
 *       32 payload bytes and 2 CRC16 bytes, encoded in base32 for a total
 *       of 56 characters (e.g. `G...` or `C...`).
 *     tags:
 *       - Wallet
 *     parameters:
 *       - in: path
 *         name: address
 *         required: true
 *         description: >
 *           Stellar Strkey address. Must be 56 characters, start with `G`
 *           (Ed25519 public key) or `C` (contract ID), and use base32
 *           characters `A-Z` and `2-7`.
 *         schema:
 *           type: string
 *           pattern: '^[GC][A-Z2-7]{55}$'
 *           minLength: 56
 *           maxLength: 56
 *           example: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF'
 *     responses:
 *       200:
 *         description: Bond positions for the wallet.
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   market_id:
 *                     type: string
 *                     description: Identifier of the market the bond was posted on.
 *                   market_title:
 *                     type: string
 *                     description: Human readable market title.
 *                   role:
 *                     type: string
 *                     enum: [submitter, challenger]
 *                     description: Role the bond was posted under.
 *                   amount:
 *                     type: string
 *                     description: Bond amount in XLM.
 *                   status:
 *                     type: string
 *                     enum: [escrowed, returned, slashed]
 *                     description: Current status of the bond position.
 *                   tx_hash:
 *                     type: string
 *                     description: Stellar transaction hash for the bond.
 *                   created_at:
 *                     type: string
 *                     format: date-time
 *                     description: When the bond was posted.
 *       400:
 *         description: Invalid Stellar address.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   example: Invalid Stellar address
 *       500:
 *         description: Internal server error.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   example: Internal server error
 */
// GET /api/wallet/:address/bonds
router.get('/:address/bonds', async (req, res) => {
  const { address } = req.params;

  if (!isValidStellarAddress(address)) {
    return res.status(400).json({ error: 'Invalid Stellar address' });
  }

  try {
    const result = await pool.query(
      `SELECT
         b.market_id,
         m.title AS market_title,
         b.role,
         b.amount,
         b.status,
         b.tx_hash,
         b.created_at
       FROM bonds b
       LEFT JOIN markets m ON m.id = b.market_id
       WHERE b.address = $1
       ORDER BY b.created_at DESC`,
      [address]
    );

    return res.json(result.rows);
  } catch (err) {
    console.error('Error fetching wallet bonds:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/wallet/:address
router.get('/:address', async (req, res) => {
  const { address } = req.params;

  if (!isValidStellarAddress(address)) {
    return res.status(400).json({ error: 'Invalid Stellar address' });
  }

  try {
    const result = await pool.query(
      'SELECT * FROM wallets WHERE address = $1',
      [address]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Wallet not found' });
    }

    return res.json(result.rows[0]);
  } catch (err) {
    console.error('Error fetching wallet:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;