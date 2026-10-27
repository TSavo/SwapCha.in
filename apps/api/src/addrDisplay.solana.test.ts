import { base58 } from "@scure/base";
import { describe, expect, it } from "vitest";
import { solanaArchaeology } from "./intel.js";
import { solanaStake } from "./recover.js";
import { MARINADE_STATE } from "./solrecover.js";
import { kaminoObligations, marinadeTickets } from "./solstake.js";

// Full base58 addresses in every text output: lookalike accounts copy the first and last characters.
const OWNER = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
const STAKE_ACCT = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";
const TICKET = "4Nd1mBQtrMJVYVfKf2PJy9NZUZdTAsp7D4xWLs4gDB4T";
const MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const ATA = "3emsAVdmGKERbHjmGfQ6oZ1e35dkf5iYcS6U4CPKFVaa";
const PROG = "JUP6LkbZbjS1jKKwapdHNy74zcZ3tQUnvq8HfKXp6Kq";
const OBLIG = "HyhQzYqUCP4wnDcbFvYJgRaS7HuGRXLrmXsfbgXDsiAS";

type Rpc = Record<string, (params: unknown[]) => unknown>;
const mockFetch = (rpc: Rpc, other: (url: string) => unknown = () => ({})) =>
  (async (url: string | URL, init?: RequestInit) => {
    const u = String(url);
    let body: unknown;
    if (init?.body) {
      const { method, params } = JSON.parse(String(init.body)) as {
        method: string;
        params: unknown[];
      };
      body = method in rpc ? { result: rpc[method]!(params) } : { error: { message: "nope" } };
    } else body = other(u);
    return new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });
  }) as typeof fetch;

const texts = (xs: object[]) => JSON.stringify(xs);
const noShort = (s: string, a: string) => {
  expect(s).toContain(a);
  expect(s).not.toContain(`${a.slice(0, 6)}…`);
  expect(s).not.toContain(`${a.slice(0, 8)}…`);
};

describe("Solana outputs show full base58 addresses", () => {
  it("stake withdraw (recover.ts)", async () => {
    const f = mockFetch({
      getProgramAccounts: () => [
        { pubkey: STAKE_ACCT, account: { lamports: 2e9, data: { parsed: { info: {} } } } },
      ],
      getEpochInfo: () => ({ epoch: 500 }),
    });
    const r = await solanaStake(f, {}, OWNER);
    expect(r).toHaveLength(1);
    const x = r[0] as { what: string; claimTx?: { description: string } };
    expect(x.what.startsWith(`${STAKE_ACCT}: `)).toBe(true);
    expect(x.claimTx?.description).toBe(`StakeProgram.Withdraw(2.0000 SOL) from ${STAKE_ACCT}`);
    noShort(texts(r), STAKE_ACCT);
  });

  it("Marinade ticket and Kamino obligation (solstake.ts)", async () => {
    const b = Buffer.alloc(88);
    Buffer.from(base58.decode(MARINADE_STATE)).copy(b, 8);
    b.writeBigUInt64LE(1_500_000_000n, 72);
    b.writeBigUInt64LE(10n, 80);
    const f = mockFetch({
      getProgramAccounts: () => [
        { pubkey: TICKET, account: { data: [b.toString("base64"), "base64"] } },
      ],
      getEpochInfo: () => ({ epoch: 500 }),
    });
    const t = await marinadeTickets(f, {}, OWNER);
    expect(t).toHaveLength(1);
    const x = t[0] as { what: string; claimTx?: { description: string } };
    expect(x.what.startsWith(`${TICKET}: `)).toBe(true);
    expect(x.claimTx?.description).toBe(`Marinade claim(1.5000 SOL) from ticket ${TICKET}`);
    noShort(texts(t), TICKET);

    const k = await kaminoObligations(
      mockFetch({}, () => [
        { obligationAddress: OBLIG, refreshedStats: { userTotalDeposit: 10, userTotalBorrow: 0 } },
      ]),
      OWNER,
    );
    expect(k).toHaveLength(1);
    expect(k[0]!.what.startsWith(`obligation ${OBLIG}: `)).toBe(true);
    noShort(texts(k), OBLIG);
  });

  it("SPL token, ATA and program (intel.ts solanaArchaeology)", async () => {
    const f = mockFetch({
      getTokenAccountsByOwner: () => ({
        value: [
          {
            pubkey: ATA,
            account: {
              lamports: 2039280,
              owner: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
              data: {
                program: "spl-token",
                parsed: {
                  type: "account",
                  info: {
                    mint: MINT,
                    tokenAmount: { uiAmount: 5, decimals: 6, amount: "5000000" },
                  },
                },
              },
            },
          },
        ],
      }),
      getSignaturesForAddress: () => [{ signature: "sig1" }],
      getTransaction: () => ({
        transaction: {
          message: { accountKeys: [OWNER, PROG], instructions: [{ programIdIndex: 1 }] },
        },
      }),
    });
    const r = await solanaArchaeology(f, {}, OWNER);
    const spl = r.find((x) => x.protocol.startsWith("SPL token"))!;
    expect(spl.protocol).toBe(`SPL token ${MINT}`);
    expect(spl.what).toBe(`5 tokens (mint ${MINT}) in ATA ${ATA}`);
    const prog = r.find((x) => x.protocol.startsWith("Solana program"))!;
    expect(prog.protocol).toBe(`Solana program ${PROG}`);
    for (const a of [MINT, ATA, PROG]) noShort(texts(r), a);
  });
});
