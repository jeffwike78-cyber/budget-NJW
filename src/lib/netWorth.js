import { signedBalance, isLiability } from './budgetMath';

// Net worth = everything you own minus everything you owe. Sources:
//  - linked + manual accounts (checking, savings, investments count as assets;
//    credit cards and loans count as liabilities) — balances from Plaid
//  - properties: a manual/estimated value with an optional mortgage/lien
//  - other assets: vehicles, valuables, etc. (manual estimates)
// Property/asset data lives under budget.netWorth so it never touches envelope
// amounts or the budget schedule.

export function accountsAssets(accounts = []) {
  return accounts.filter((a) => !isLiability(a)).reduce((s, a) => s + signedBalance(a), 0);
}
export function accountsLiabilities(accounts = []) {
  return accounts.filter(isLiability).reduce((s, a) => s + Math.abs(signedBalance(a)), 0);
}

export function propertyEquity(p) {
  return Number(p?.value || 0) - Number(p?.lien || 0);
}

export function computeNetWorth(state = {}) {
  const accounts = state.accounts || [];
  const nw = state.netWorth || {};
  const properties = nw.properties || [];
  const otherAssets = nw.otherAssets || [];

  const acctAssets = accountsAssets(accounts);
  const acctLiabilities = accountsLiabilities(accounts);
  const propertyValue = properties.reduce((s, p) => s + Number(p.value || 0), 0);
  const propertyLiens = properties.reduce((s, p) => s + Number(p.lien || 0), 0);
  const otherAssetsValue = otherAssets.reduce((s, a) => s + Number(a.value || 0), 0);

  const assets = acctAssets + propertyValue + otherAssetsValue;
  const liabilities = acctLiabilities + propertyLiens;

  return {
    assets,
    liabilities,
    total: assets - liabilities,
    acctAssets,
    acctLiabilities,
    propertyValue,
    propertyLiens,
    propertyEquity: propertyValue - propertyLiens,
    otherAssetsValue,
    properties,
    otherAssets,
  };
}
