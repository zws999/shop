import { cryptoMethods, decimalUnits, formatUnits } from './payment-policy.js';

const solanaMainnet = '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d';
const fetchOptions = () => ({ redirect: 'error', signal: AbortSignal.timeout(6500) });

export function chainLookupReady(method, config) {
  if (method === 'btc' || method === 'ltc') return config.CHAIN_LOOKUP_BLOCKCYPHER === 'true' || Boolean(config.BLOCKCYPHER_TOKEN);
  if (!['eth', 'sol'].includes(method)) return false;
  try {
    const url = new URL(config[method === 'eth' ? 'ETHEREUM_RPC_URL' : 'SOLANA_RPC_URL']);
    return url.protocol === 'https:' && !url.username && !url.password && !url.hash;
  } catch {
    return false;
  }
}

async function rpc(url, method, params) {
  const response = await fetch(url, {
    ...fetchOptions(), method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params })
  });
  if (!response.ok) throw new Error('Chain lookup failed.');
  const data = await response.json();
  if (data.error || data.id !== 1) throw new Error('Chain lookup failed.');
  return data.result;
}

function addressEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  return /^(bc1|ltc1|0x)/i.test(b) ? a.toLowerCase() === b.toLowerCase() : a === b;
}

function sum(outputs, value) {
  return outputs.reduce((total, output) => {
    const units = value(output);
    if (!Number.isSafeInteger(units) || units < 0) throw new Error('Invalid chain amount.');
    return total + BigInt(units);
  }, 0n);
}

async function blockcypher(order, reference, config) {
  const url = new URL('https://api.blockcypher.com/v1/' + order.method_id + '/main/txs/' + reference);
  url.searchParams.set('limit', '200');
  if (config.BLOCKCYPHER_TOKEN) url.searchParams.set('token', config.BLOCKCYPHER_TOKEN);
  const response = await fetch(url, fetchOptions());
  if (response.status === 404) return null;
  if (!response.ok) throw new Error('Chain lookup failed.');
  const tx = await response.json();
  if (tx.hash !== reference || tx.double_spend || !Array.isArray(tx.outputs) ||
      tx.vout_sz !== tx.outputs.length || !Number.isSafeInteger(tx.confirmations)) {
    throw new Error('Incomplete transaction evidence.');
  }
  const outputs = tx.outputs.filter(output => output.addresses?.length === 1 && addressEqual(output.addresses[0], order.destination));
  return { units: sum(outputs, output => output.value), confirmations: tx.confirmations, timestamp: Date.parse(tx.confirmed) };
}

const hex = value => typeof value === 'string' && /^0x[0-9a-f]+$/i.test(value) ? BigInt(value) : null;

async function ethereum(order, reference, config) {
  const call = (name, params = []) => rpc(config.ETHEREUM_RPC_URL, name, params);
  const [chain, tx, receipt, tip] = await Promise.all([
    call('eth_chainId'), call('eth_getTransactionByHash', [reference]),
    call('eth_getTransactionReceipt', [reference]), call('eth_blockNumber')
  ]);
  if (hex(chain) !== 1n) throw new Error('Ethereum RPC is not Mainnet.');
  if (!tx || !receipt) return null;
  if (tx.hash !== reference || receipt.transactionHash !== reference || tx.blockHash !== receipt.blockHash ||
      receipt.status !== '0x1') throw new Error('Transaction receipt is unavailable or unsuccessful.');
  const [current, mined, value] = [tip, receipt.blockNumber, tx.value].map(hex);
  if (current === null || mined === null || current < mined || value === null) throw new Error('Incomplete transaction evidence.');
  const block = await call('eth_getBlockByNumber', [receipt.blockNumber, false]);
  if (block?.hash !== receipt.blockHash) throw new Error('Transaction is not in the canonical block.');
  return {
    units: addressEqual(tx.to, order.destination) ? value : 0n,
    confirmations: Number(current - mined + 1n), timestamp: Number(hex(block.timestamp)) * 1000
  };
}

async function solana(order, reference, config) {
  const call = (name, params = []) => rpc(config.SOLANA_RPC_URL, name, params);
  const [chain, tx, tip] = await Promise.all([
    call('getGenesisHash'),
    call('getTransaction', [reference, { commitment: 'finalized', encoding: 'jsonParsed', maxSupportedTransactionVersion: 0 }]),
    call('getSlot', [{ commitment: 'confirmed' }])
  ]);
  if (chain !== solanaMainnet) throw new Error('Solana RPC is not Mainnet.');
  if (!tx) return null;
  if (tx.meta?.err !== null || tx.transaction?.signatures?.[0] !== reference ||
      !Number.isSafeInteger(tx.slot) || !Number.isSafeInteger(tip) || tip < tx.slot) {
    throw new Error('Incomplete transaction evidence.');
  }
  const transfers = (tx.transaction.message?.instructions ?? []).filter(instruction =>
    instruction.program === 'system' && instruction.parsed?.type === 'transfer' &&
    instruction.parsed.info?.destination === order.destination);
  return {
    units: sum(transfers, transfer => transfer.parsed.info.lamports),
    confirmations: tip - tx.slot + 1, timestamp: tx.blockTime * 1000
  };
}

export async function chainEvidence(order, reference, config) {
  const method = order.method_id;
  const read = method === 'eth' ? ethereum : method === 'sol' ? solana : blockcypher;
  const evidence = await read(order, reference, config);
  if (!evidence) return { found: false, reference, network: order.network };
  const precision = cryptoMethods[method].precision;
  const expected = decimalUnits(order.crypto_amount, precision);
  const { units, confirmations, timestamp } = evidence;
  const observedAt = Number.isFinite(timestamp) && timestamp > 0 ? new Date(timestamp) : null;
  return {
    found: true, reference, network: order.network,
    receivedAmount: formatUnits(units, precision),
    amountCheck: units === 0n ? 'destination_mismatch' : units < expected ? 'underpaid' : units > expected ? 'overpaid' : 'exact',
    confirmations, meetsThreshold: confirmations >= order.confirmation_threshold,
    observedAt, predatesInvoice: observedAt && observedAt.getTime() < new Date(order.created_at).getTime() - 120_000,
    afterExpiry: observedAt && observedAt > new Date(order.expires_at)
  };
}
