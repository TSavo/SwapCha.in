export type CharacterKey =
  | "swapchan"
  | "ethereum"
  | "solana"
  | "base"
  | "arbitrum"
  | "optimism"
  | "polygon";

export interface Character {
  key: CharacterKey;
  name: string;
  color: string;
  tagline: string;
  /** EVM chain id, or null when the chain isn't live yet. */
  chainId: number | null;
}

export const CHARACTERS: Record<CharacterKey, Character> = {
  swapchan: {
    key: "swapchan",
    name: "Swap-chan",
    color: "#f5b700",
    tagline: "I'll find you the best route, senpai!",
    chainId: null,
  },
  ethereum: {
    key: "ethereum",
    name: "Eth-chan",
    color: "#627eea",
    tagline: "The elder shrine maiden of mainnet.",
    chainId: 1,
  },
  base: {
    key: "base",
    name: "Base-chan",
    color: "#0052ff",
    tagline: "Cheap, cheerful and always online.",
    chainId: 8453,
  },
  arbitrum: {
    key: "arbitrum",
    name: "Arb-chan",
    color: "#28a0f0",
    tagline: "Rollup ronin with lightning reflexes.",
    chainId: 42161,
  },
  optimism: {
    key: "optimism",
    name: "OP-chan",
    color: "#ff0420",
    tagline: "Optimistic to a fault (with a 7-day memory).",
    chainId: 10,
  },
  polygon: {
    key: "polygon",
    name: "Poly-chan",
    color: "#8247e5",
    tagline: "Shapeshifting mage of the many sidechains.",
    chainId: 137,
  },
  solana: {
    key: "solana",
    name: "Sol-chan",
    color: "#14f195",
    tagline: "Speed demon. Arriving soon.",
    chainId: null,
  },
};

export const characterForChain = (chainId: number): Character =>
  Object.values(CHARACTERS).find((c) => c.chainId === chainId) ?? CHARACTERS.swapchan;

export const characterSrc = (key: CharacterKey): string => `/characters/${key}.png`;
