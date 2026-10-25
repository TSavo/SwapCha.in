/* tslint:disable */
/* eslint-disable */
/**
 * Known but unverified chains (NOT supported by the other calls): same shape, verified:false.
 */
export function unverifiedChains(): string;
/**
 * Same hash, re-encoded for `to`; throws `ambiguous_address` when candidates disagree on the script type.
 */
export function convertAddress(addr: string, to: string): string;
/**
 * Library version (semver string, same as the `blocktools` crate).
 */
export function version(): string;
/**
 * Watch-only addresses from an account-level xpub: JSON [{chain,kind,path,address}].
 */
export function addressesFromXpub(xpub_str: string, chain: string, kinds: string[], branches: Uint32Array, indices: Uint32Array): string;
/**
 * Chains this build knows: JSON array of names.
 */
export function listChains(): string;
/**
 * Fail-closed tx check, JSON in / JSON out; never throws. See EXPORTS.md for the schema.
 */
export function checkTx(input_json: string): string;
/**
 * `derive --explain` for the given derive flags: JSON [{chain,kind,template,path,count}]. No keys.
 */
export function explainPlan(args: string[]): string;
/**
 * Every verified chain (and `zec`) on which `addr` is valid: JSON [{chain,kind}]. Collisions
 * (DGB/DOGE, VIA/VTC, version 50/0 ...) return all candidates; an empty list = unrecognised.
 */
export function detectAddress(addr: string): string;
/**
 * Verified (supported) chains: JSON [{name,ticker,title,slip44,verified:true,sources:[{name,url,api,checked}]}].
 */
export function supportedChains(): string;
/**
 * Unsigned sweep of all `utxos` (JSON lines {txid,vout,amount,address[,prev_tx]}) to `to`:
 * JSON {chain,tx_format,psbt,unsigned_tx,inputs,amount,fee}. Legacy and forkid formats only.
 */
export function buildUnsignedSweep(chain: string, utxos: string, to: string, fee_rate: number): string;
/**
 * `derive::from_xpub(chain, xpub, path, index)`: JSON [{chain,kind,path,address}] for every script kind.
 */
export function deriveFromXpub(chain: string, xpub_str: string, path: string, index: number): string;
/**
 * tx-verify: JSON {ok, failures, warnings}. `max_fee` is a decimal string (sats or wei) or "".
 */
export function verifyTx(input: string, chain: string, expect_to: string[], change: string[], chain_id: number | null | undefined, max_fee: string, allow_warnings: boolean): string;
/**
 * As convertAddress with the source chain stated.
 */
export function convertAddressFrom(from: string, addr: string, to: string): string;
/**
 * Address kind ("P2pkh", "SegwitV0", "Eth", ...) if `address` is valid for `chain`; throws otherwise.
 */
export function validateAddress(chain: string, address: string): string;
/**
 * `address::validate(chain, addr)`: address kind string; throws on invalid / unverified chain.
 */
export function addressValidate(chain: string, addr: string): string;
/**
 * Decode a transaction (hex/base64 raw, PSBT, EVM RLP, or a JSON line): JSON array of the tx-decode lines.
 */
export function decodeTx(input: string, chain: string): string;
/**
 * Plain-text summary of a transaction (what tx-decode --text prints).
 */
export function describeTx(input: string, chain: string): string;
/**
 * Full parameter table: JSON [{name,ticker,title,slip44,verified,p2pkh[],p2sh[],hrp,wif,checksum,decimals,forkid,tx_format,sweep_build,sources}].
 */
export function chainParams(): string;
