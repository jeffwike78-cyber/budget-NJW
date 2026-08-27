// Config per linkable institution. 'id' here is also the plaid_items.id and
// the string the frontend passes as `target` when starting a Link flow.
export const PLAID_TARGETS = {
  chase: {
    institutionName: 'Chase',
    accountType: 'depository',
    accountId: 'chase-checking',
    products: ['transactions'],
  },
  schwab: {
    institutionName: 'Schwab',
    accountType: 'investment',
    accountId: 'schwab',
    products: ['investments'],
  },
  marcus: {
    institutionName: 'Marcus by Goldman Sachs',
    accountType: 'depository',
    accountId: 'marcus-savings',
    products: ['transactions'],
  },
};

export function targetConfig(target) {
  const config = PLAID_TARGETS[target];
  if (!config) throw new Error(`Unknown Plaid target: ${target}`);
  return config;
}
