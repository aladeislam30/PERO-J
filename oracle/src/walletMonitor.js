'use strict';

/**
 * Hot-wallet balance monitoring and automated minimum floor alerting
 */
async function checkHotWalletBalance(server, publicKey, minFloorXlm = 50.0) {
  const account = await server.loadAccount(publicKey);
  const nativeBalance = account.balances.find(b => b.asset_type === 'native');
  const balance = nativeBalance ? parseFloat(nativeBalance.balance) : 0.0;
  return {
    balance,
    minFloor: minFloorXlm,
    isLow: balance < minFloorXlm
  };
}

module.exports = { checkHotWalletBalance };
