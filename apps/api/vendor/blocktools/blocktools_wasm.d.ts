/* tslint:disable */
/* eslint-disable */
/**
 * Address kind ("P2pkh", "SegwitV0", "Eth", ...) if `address` is valid for `chain`; throws otherwise.
 */
export function validateAddress(chain: string, address: string): string;
/**
 * Chains this build knows: JSON array of names.
 */
export function listChains(): string;
/**
 * Watch-only addresses from an account-level xpub: JSON [{chain,kind,path,address}].
 */
export function addressesFromXpub(xpub_str: string, chain: string, kinds: string[], branches: Uint32Array, indices: Uint32Array): string;
/**
 * `derive --explain` for the given derive flags: JSON [{chain,kind,template,path,count}]. No keys.
 */
export function explainPlan(args: string[]): string;
/**
 * Decode a transaction (hex/base64 raw, PSBT, EVM RLP, or a JSON line): JSON array of the tx-decode lines.
 */
export function decodeTx(input: string, chain: string): string;
/**
 * Plain-text summary of a transaction (what tx-decode --text prints).
 */
export function describeTx(input: string, chain: string): string;
/**
 * tx-verify: JSON {ok, failures, warnings}. `max_fee` is a decimal string (sats or wei) or "".
 */
export function verifyTx(input: string, chain: string, expect_to: string[], change: string[], chain_id: number | null | undefined, max_fee: string, allow_warnings: boolean): string;
/**
 * Library version (semver string, same as the `blocktools` crate).
 */
export function version(): string;
/**
 * Verified (supported) chains: JSON [{name,ticker,title,slip44,verified:true,sources:[{name,url,api,checked}]}].
 */
export function supportedChains(): string;
/**
 * Known but unverified chains (NOT supported by the other calls): same shape, verified:false.
 */
export function unverifiedChains(): string;
/**
 * `derive::from_xpub(chain, xpub, path, index)`: JSON [{chain,kind,path,address}] for every script kind.
 */
export function deriveFromXpub(chain: string, xpub_str: string, path: string, index: number): string;
/**
 * `address::validate(chain, addr)`: address kind string; throws on invalid / unverified chain.
 */
export function addressValidate(chain: string, addr: string): string;
/**
 * Fail-closed tx check, JSON in / JSON out; never throws. See EXPORTS.md for the schema.
 */
export function checkTx(input_json: string): string;
/**
 * Every verified chain (and `zec`) on which `addr` is valid: JSON [{chain,kind}]. Collisions
 * (DGB/DOGE, VIA/VTC, version 50/0 ...) return all candidates; an empty list = unrecognised.
 */
export function detectAddress(addr: string): string;
/**
 * Additive to detectAddress (whose shape is unchanged): JSON {candidates:[{chain,kind}], ambiguous, kinds_agree}.
 * `ambiguous` = more than one chain; `kinds_agree` = every candidate has the same script kind.
 */
export function detectAddressInfo(addr: string): string;
/**
 * Same hash, re-encoded for `to`; throws `ambiguous_address` when candidates disagree on the script type.
 */
export function convertAddress(addr: string, to: string): string;
/**
 * As convertAddress with the source chain stated.
 */
export function convertAddressFrom(from: string, addr: string, to: string): string;
/**
 * Full parameter table: JSON [{name,ticker,title,slip44,verified,p2pkh[],p2sh[],hrp,wif,checksum,decimals,forkid,tx_format,sweep_build,sources}].
 */
export function chainParams(): string;
/**
 * Unsigned sweep of all `utxos` (JSON lines {txid,vout,amount,address[,prev_tx]}) to `to`:
 * JSON {chain,tx_format,psbt,unsigned_tx,inputs,amount,fee}. Legacy, legacy-sha256 and forkid
 * formats; pos-ntime chains need `buildUnsignedSweepAt` (a tx timestamp).
 */
export function buildUnsignedSweep(chain: string, utxos: string, to: string, fee_rate: number): string;
/**
 * As `buildUnsignedSweep` with tx timestamp `time` (unix seconds). For pos-ntime chains
 * (ppc/nvc/clam/rdd) returns {chain,tx_format:"pos-ntime",unsigned_tx,time,pos_prevouts,inputs,amount,fee}
 * (no PSBT exists for that format); other chains ignore `time`.
 */
export function buildUnsignedSweepAt(chain: string, utxos: string, to: string, fee_rate: number, time: number): string;
/**
 * BLAKE2b of hex `data_hex` with `out_len` bytes (1..64) and a UTF-8 personalization (<= 16 bytes, "" for none). Returns hex.
 */
export function blake2b(data_hex: string, out_len: number, personal: string): string;
/**
 * Substrate twox_128 of UTF-8 `text`. Returns hex.
 */
export function twox128(text: string): string;
/**
 * SS58 address from a 32-byte account id (hex) and prefix (0 Polkadot, 2 Kusama, 42 generic; up to 16383).
 */
export function ss58Encode(account_hex: string, prefix: number): string;
/**
 * JSON {prefix, account} (account id hex) for an SS58 address; throws bad_base58/bad_prefix/bad_length/bad_checksum.
 */
export function ss58Decode(addr: string): string;
/**
 * System.Account storage key (hex, no 0x) for an SS58 address or a 32-byte account id hex.
 */
export function polkadotAccountStorageKey(account: string): string;
/**
 * SCALE AccountInfo (80 bytes hex, as returned by state_getStorage) -> JSON {nonce,consumers,providers,sufficients,data:{free,reserved,frozen,flags}}; u128 as decimal strings.
 */
export function decodeAccountInfo(hex: string): string;
