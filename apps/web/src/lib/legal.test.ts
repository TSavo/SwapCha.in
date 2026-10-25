import { describe, expect, it } from "vitest";
import { FEE_RECIPIENT, LEGAL_PLACEHOLDERS, PRIVACY, TERMS } from "./legal";

const all = (d: typeof TERMS) => [d.intro, ...d.sections.flatMap((s) => [s.h, ...s.p])].join("\n");

describe("legal pages", () => {
  it("never claims SwapChan never broadcasts and never mentions blocktools", () => {
    for (const d of [TERMS, PRIVACY]) {
      expect(all(d)).not.toMatch(/never broadcast/i);
      expect(all(d)).not.toMatch(/blocktools/i);
    }
  });
  it("discloses the swap-only fee and its recipient", () => {
    expect(all(TERMS)).toContain(FEE_RECIPIENT);
    expect(all(TERMS)).toMatch(/10 bps/);
  });
  it("names the operator, law, date and contact; no placeholders left", () => {
    expect(LEGAL_PLACEHOLDERS).toEqual([]);
    expect(all(TERMS)).toContain("evilgenius@nefariousplan.com");
    expect(all(PRIVACY)).toContain("evilgenius@nefariousplan.com");
    expect(all(TERMS)).toContain("T Savo, doing business as EvilGenius and NefariousPlan.com");
    expect(all(TERMS)).toContain("State of California, USA");
    expect(all(TERMS)).toContain("state and federal courts located in California");
    expect(TERMS.updated).toBe("October 25, 2026");
    expect(PRIVACY.updated).toBe("October 25, 2026");
  });
  it("only uses listed placeholders", () => {
    const used = new Set(
      [all(TERMS), all(PRIVACY), TERMS.updated].join("\n").match(/\[[A-Z ]+\]/g),
    );
    for (const u of used) expect(LEGAL_PLACEHOLDERS as readonly string[]).toContain(u);
  });
  it("states the exact retention periods", () => {
    const t = all(PRIVACY);
    expect(t).toMatch(/not clicked for 12 months is deleted/);
    expect(t).toMatch(/12 months after it was created/);
    expect(t).toMatch(/After 24 months the taker address is deleted/);
    expect(t).toMatch(/kept up to 6 hours/);
    expect(t).not.toMatch(/no set expiry/);
  });
});
