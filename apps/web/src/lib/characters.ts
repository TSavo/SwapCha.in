export type CharacterKey =
  | "swapchan"
  | "ethereum"
  | "solana"
  | "base"
  | "arbitrum"
  | "optimism"
  | "polygon"
  | "bnb"
  | "avalanche"
  | "linea"
  | "scroll"
  | "bitcoin"
  | "tron";

export interface Character {
  key: CharacterKey;
  name: string;
  color: string;
  tagline: string;
  /** Chain id (non-EVM ids follow Relay), or null for Swap-chan herself. */
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
  bnb: {
    key: "bnb",
    name: "BNB-chan",
    color: "#f0b90b",
    tagline: "Golden guardian of the Smart Chain.",
    chainId: 56,
  },
  avalanche: {
    key: "avalanche",
    name: "Avax-chan",
    color: "#e84142",
    tagline: "Snow-fast subnet samurai.",
    chainId: 43114,
  },
  linea: {
    key: "linea",
    name: "Linea-chan",
    color: "#61dfff",
    tagline: "zk-sharp, straight as a line.",
    chainId: 59144,
  },
  scroll: {
    key: "scroll",
    name: "Scroll-chan",
    color: "#ffdbb0",
    tagline: "Keeper of the zk scrolls.",
    chainId: 534352,
  },
  solana: {
    key: "solana",
    name: "Sol-chan",
    color: "#14f195",
    tagline: "Speed demon. Already done.",
    chainId: 792703809,
  },
  bitcoin: {
    key: "bitcoin",
    name: "Bitcoin-chan",
    color: "#f7931a",
    tagline: "The original. Don't trust, verify.",
    chainId: 8253038,
  },
  tron: {
    key: "tron",
    name: "Tron-chan",
    color: "#ff060a",
    tagline: "Queen of stablecoin transfers.",
    chainId: 728126428,
  },
};

export const characterForChain = (chainId: number): Character =>
  Object.values(CHARACTERS).find((c) => c.chainId === chainId) ?? CHARACTERS.swapchan;

export const characterSrc = (key: CharacterKey): string => `/characters/${key}.png`;
