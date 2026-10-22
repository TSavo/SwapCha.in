import type { CharacterKey } from "./characters";

export interface ChainFacts {
  chain: string;
  launched: string;
  consensus: string;
  token: string;
  knownFor: string;
}

export interface Bio {
  key: CharacterKey;
  /** One-line role shown under her name. */
  role: string;
  intro: string;
  personality: string;
  look: string;
  catchphrase: string;
  likes: string[];
  dislikes: string[];
  /** How she gets along with Swap-chan. */
  withSwapchan: string;
  /** Notes about the rest of the cast. */
  friends: { who: CharacterKey; note: string }[];
  facts: ChainFacts;
  /** "final" art, or a recolored stand-in until her own art lands. */
  art: "final" | "coming-soon";
}

export const BIOS: Record<CharacterKey, Bio> = {
  bitcoin: {
    key: "bitcoin",
    role: "The original, keeper of the hardest money",
    intro:
      "Bitcoin-chan was here first and she will remind you. She doesn't do smart contracts, but Swap-chan bridges her BTC straight to your wallet from any chain through Relay and LI.FI.",
    personality:
      "Calm, proud and stubborn as a block header. Speaks slowly, verifies everything twice, and has never once panicked during a dip.",
    look: "Long wavy orange twin-tails with gold ₿ coin hair ornaments, a black-and-orange bomber jacket with a ₿ emblem, a black pleated skirt and black-and-gold platform boots.",
    catchphrase: "Don't trust. Verify.",
    likes: ["Cold storage", "Ten-minute blocks", "Low time preference", "Running her own node"],
    dislikes: ["Altcoin pitches", "Custodians", "People who say 'blockchain not Bitcoin'"],
    withSwapchan:
      "Swap-chan treats her like a respected elder and always finds her the cheapest way home. Bitcoin-chan pretends not to care but checks every route.",
    friends: [
      {
        who: "ethereum",
        note: "Her oldest rival. They argue about everything and still show up to each other's birthdays.",
      },
      {
        who: "tron",
        note: "Thinks Tron-chan moves too many stablecoins, but borrows her for fast transfers.",
      },
    ],
    facts: {
      chain: "Bitcoin (live on SwapChan via Relay and LI.FI)",
      launched: "2009",
      consensus: "Proof of Work",
      token: "BTC",
      knownFor: "The first cryptocurrency, a fixed 21 million supply, and being digital gold",
    },
    art: "final",
  },
  tron: {
    key: "tron",
    role: "Queen of stablecoin transfers",
    intro:
      "Tron-chan carries more USDT than almost anyone. Swap-chan routes her through Relay and LI.FI, so USDT on Tron is one click from any EVM chain.",
    personality:
      "Energetic, flashy and very good with money. Always busy, always moving, and always cheaper than you expected.",
    look: "Long straight red side ponytail with a triangle hair clip, a black-and-red techwear jacket, red shorts, black thigh-highs and chunky red platform boots.",
    catchphrase: "Stablecoins? Leave it to me!",
    likes: ["USDT", "Fast settlement", "Red triangles", "Remittances"],
    dislikes: ["Energy bills", "Slow banks", "People who forget to buy energy"],
    withSwapchan:
      "Swap-chan's go-to for moving stablecoins cheaply. They trade USDT back and forth like friendship bracelets.",
    friends: [
      { who: "bnb", note: "Shopping buddy. Both love a low fee." },
      { who: "bitcoin", note: "Respects her elder, still sends her stablecoins anyway." },
    ],
    facts: {
      chain: "Tron (live on SwapChan via Relay and LI.FI)",
      launched: "2018 (mainnet)",
      consensus: "Delegated Proof of Stake",
      token: "TRX",
      knownFor: "Carrying a huge share of the world's USDT transfers",
    },
    art: "final",
  },
  swapchan: {
    key: "swapchan",
    role: "Route-finder, team captain, professional bargain hunter",
    intro:
      "Swap-chan is the heart of SwapChan. Every time you ask for a swap she sprints off to ask every aggregator and bridge she knows, then comes back with the best route and a very smug grin.",
    personality:
      "Hyper, loyal and allergic to bad prices. She treats every quote like a treasure hunt and every saved cent like a personal victory. Secretly a spreadsheet nerd.",
    look: "Split gold-and-violet hair in a side ponytail with a swap-arrows hair clip, an oversized white hoodie with gold hexagon patches, chain belts, thigh-high socks and glowing gold platform boots.",
    catchphrase: "I'll find you the best route, senpai!",
    likes: [
      "Tight spreads",
      "Comparing six quotes at once",
      "Gold hexagons",
      "A clean fill on the first try",
    ],
    dislikes: [
      "Hidden fees",
      "Slippage surprises",
      "Being told 'just use one DEX'",
      "Stuck bridges",
    ],
    withSwapchan:
      "She is Swap-chan. She refers to herself in the third person when she's excited, which is always.",
    friends: [
      {
        who: "ethereum",
        note: "Her big-sister figure. Swap-chan visits mainnet when she wants to feel important.",
      },
      { who: "base", note: "Her best friend and partner in cheap cross-chain hijinks." },
      { who: "bnb", note: "Her gold-loving rival in the 'who sparkles more' contest." },
    ],
    facts: {
      chain: "Every chain (she's an aggregator)",
      launched: "2026",
      consensus: "Best price wins",
      token: "None. She charges a tiny 0.1% fee, shown upfront",
      knownFor:
        "Comparing LI.FI, CoW, Velora, Across, Relay and 0x on every swap, same-chain or cross-chain",
    },
    art: "final",
  },
  ethereum: {
    key: "ethereum",
    role: "Elder shrine maiden of mainnet",
    intro:
      "Eth-chan is the oldest and most respected of the cast. Half of the others literally settle their homework with her, so she has a lot of patience and a lot of paperwork.",
    personality:
      "Calm, wise and a little regal, with a dry sense of humor. She changed her whole way of life in 2022 and never lets anyone forget how much greener it made her.",
    look: "Long silver-lavender hair under a crystal diamond tiara, a deep indigo robe-coat covered in octahedron gems, and a translucent crystal cape.",
    catchphrase: "Everything settles here eventually.",
    likes: [
      "Decentralization",
      "Long research threads",
      "Her rollup kids doing well",
      "Tea during a quiet block",
    ],
    dislikes: [
      "Gas spikes during NFT mints",
      "Being called 'slow'",
      "People forgetting about blobs",
    ],
    withSwapchan:
      "Like an older sister. Eth-chan grumbles about Swap-chan's energy, but quietly takes pride whenever Swap-chan finds a route that saves someone a mainnet gas bill.",
    friends: [
      { who: "arbitrum", note: "One of her rollup kids. Polite, efficient, posts proofs on time." },
      {
        who: "optimism",
        note: "Another rollup kid. Eth-chan worries about how optimistic she is.",
      },
      {
        who: "solana",
        note: "Friendly rival. They argue about speed vs. decentralization at every party.",
      },
    ],
    facts: {
      chain: "Ethereum mainnet (chain id 1)",
      launched: "2015",
      consensus: "Proof of Stake (since The Merge, Sept 2022)",
      token: "ETH",
      knownFor: "Smart contracts, DeFi, NFTs, and being the settlement layer for most rollups",
    },
    art: "final",
  },
  solana: {
    key: "solana",
    role: "Speed demon of the 400 ms slot",
    intro:
      "Sol-chan runs everywhere. She doesn't speak EVM, but Swap-chan found her bridges through Relay and LI.FI, so now she sprints SOL and USDC to and from every other chain.",
    personality:
      "Loud, fast, chaotic and endlessly upbeat. Gets bored if a block takes more than half a second.",
    look: "Purple twin-tail hair with neon green streaks, a black crop jacket with purple straps, lightning-green energy trails and chunky purple-and-gold platform boots.",
    catchphrase: "Already done. What's next?",
    likes: ["400-millisecond slots", "Memecoins", "Tiny fees", "Running laps around everyone"],
    dislikes: ["Waiting", "Being asked about uptime", "Seven-day withdrawal windows"],
    withSwapchan:
      "Swap-chan's chaotic new friend. Now that the bridge is built they hang out constantly, mostly racing USDC from Base to Solana.",
    friends: [
      { who: "ethereum", note: "Friendly rival who keeps telling her to slow down." },
      { who: "avalanche", note: "Her racing buddy. They time each other's finality for fun." },
    ],
    facts: {
      chain: "Solana (live on SwapChan via Relay and LI.FI)",
      launched: "2020 (mainnet beta)",
      consensus: "Proof of Stake with Proof of History",
      token: "SOL",
      knownFor: "Very fast blocks, low fees, and a busy memecoin scene",
    },
    art: "final",
  },
  base: {
    key: "base",
    role: "Cheap, cheerful and always online",
    intro:
      "Base-chan is the friendly face of onchain. She was raised by a big exchange, grew up on the OP Stack, and now spends her days onboarding newcomers with a smile.",
    personality:
      "Sunny, approachable and relentlessly helpful. Says 'gm' to everyone, including bots.",
    look: "Wavy sky-blue hair with a blue circle hair clip, an oversized white jacket over a blue dress, a blue circle pendant, and chunky blue-white sneakers.",
    catchphrase: "Come onchain, it's cozy here!",
    likes: ["Onboarding friends", "Cheap transactions", "Blue circles", "Building in public"],
    dislikes: ["Gatekeeping", "High gas", "People asking when her token is"],
    withSwapchan:
      "Swap-chan's best friend. They do most of their cross-chain adventures together, usually Ethereum to Base with a USDC snack.",
    friends: [
      { who: "optimism", note: "Her Superchain sister. Same OP Stack, different outfit." },
      { who: "arbitrum", note: "Friendly L2 rival in the 'who's cheapest today' race." },
    ],
    facts: {
      chain: "Base (chain id 8453)",
      launched: "2023",
      consensus: "Optimistic rollup on Ethereum (OP Stack), incubated by Coinbase",
      token: "None of her own; gas is paid in ETH",
      knownFor: "Easy onboarding, low fees and a big consumer app scene",
    },
    art: "final",
  },
  arbitrum: {
    key: "arbitrum",
    role: "Rollup ronin with lightning reflexes",
    intro:
      "Arb-chan is the cool, quiet one. She rolls up thousands of transactions, files them with Eth-chan, and dares anyone to prove her wrong.",
    personality:
      "Stoic, disciplined and quietly competitive. A tactician who loves a good dispute because she always wins.",
    look: "Short navy hair with a tech headset, a dark navy bodysuit with glowing cyan circuit lines, and a long translucent blue cape.",
    catchphrase: "Challenge me. I'll wait.",
    likes: ["Fraud proofs", "DeFi power users", "Orbit chains", "Efficient code"],
    dislikes: ["Sloppy transactions", "Sequencer downtime", "Being mistaken for Base-chan"],
    withSwapchan:
      "A reliable teammate. Swap-chan sends her the serious DeFi trades because Arb-chan never flinches.",
    friends: [
      { who: "ethereum", note: "Her mentor. Arb-chan posts every batch to mainnet like homework." },
      {
        who: "optimism",
        note: "Her oldest rival. Both optimistic rollups, very different philosophies.",
      },
    ],
    facts: {
      chain: "Arbitrum One (chain id 42161)",
      launched: "2021",
      consensus: "Optimistic rollup on Ethereum with interactive fraud proofs",
      token: "ARB (governance); gas is paid in ETH",
      knownFor: "The biggest DeFi ecosystem among Ethereum rollups",
    },
    art: "final",
  },
  optimism: {
    key: "optimism",
    role: "Optimistic to a fault (with a 7-day memory)",
    intro:
      "OP-chan believes in everyone. She assumes every transaction is honest, gives everybody seven days to object, and funds public goods with whatever's left in her pockets.",
    personality:
      "Bubbly, generous and idealistic. A natural community organizer who turns every party into a Superchain.",
    look: "Bright red twin-tails with swap-arrows hair clips, a red and white jacket with target patches, a red skirt, and red-and-white high-tops.",
    catchphrase: "Assume the best! (Then wait 7 days.)",
    likes: ["Public goods funding", "The OP Stack", "Sunny forecasts", "Group projects"],
    dislikes: ["Cynics", "People who withdraw without bridging fast", "Fraud"],
    withSwapchan:
      "Swap-chan's cheerleader. OP-chan loves that bridges like Across and Relay let her friends skip her 7-day wait.",
    friends: [
      { who: "base", note: "Her Superchain little sister, and her proudest recruit." },
      {
        who: "arbitrum",
        note: "Her rival in the optimistic rollup wars. They're secretly friends.",
      },
    ],
    facts: {
      chain: "OP Mainnet (chain id 10)",
      launched: "2021",
      consensus: "Optimistic rollup on Ethereum with a 7-day challenge window",
      token: "OP (governance); gas is paid in ETH",
      knownFor: "The OP Stack, the Superchain and retroactive public goods funding",
    },
    art: "final",
  },
  polygon: {
    key: "polygon",
    role: "Shapeshifting mage of the many sidechains",
    intro:
      "Poly-chan has reinvented herself more times than anyone can count: plasma, sidechain, zk, aggregation layer. Her latest trick was changing her own name tag from MATIC to POL.",
    personality:
      "Ambitious, clever and restless. Always studying a new spell, always connecting more chains together.",
    look: "Long violet ponytail, a faceted purple armor suit with geometric crystal plates, and a sharp polygonal cape.",
    catchphrase: "One more upgrade and it's perfect!",
    likes: [
      "Zero-knowledge magic",
      "Payments and stablecoins",
      "Geometric shapes",
      "Big-brand partnerships",
    ],
    dislikes: ["Being called 'just a sidechain'", "Reorgs", "Sitting still"],
    withSwapchan:
      "A study buddy. Poly-chan swaps spellbooks with Swap-chan and keeps her stablecoin pouch full.",
    friends: [
      { who: "ethereum", note: "Her teacher. Poly-chan checkpoints to her regularly." },
      { who: "linea", note: "Fellow zk enthusiast. They nerd out over proof systems." },
    ],
    facts: {
      chain: "Polygon PoS (chain id 137)",
      launched: "2020",
      consensus: "Proof of Stake sidechain with checkpoints to Ethereum",
      token: "POL (formerly MATIC, migrated in 2024)",
      knownFor: "Cheap payments, stablecoins, and zk tech like the AggLayer",
    },
    art: "final",
  },
  bnb: {
    key: "bnb",
    role: "Golden guardian of the Smart Chain",
    intro:
      "BNB-chan guards a huge, busy marketplace and runs it like clockwork. She carries a glowing BNB orb everywhere and polishes it between blocks.",
    personality:
      "Confident, practical and a little flashy. She cares about getting things done fast and cheap, and about her outfit being on point.",
    look: "Long golden ponytail, a black and gold jacket with diamond patterns, gold-trimmed shorts and straps, tall black-and-gold boots, and a glowing BNB orb in one hand.",
    catchphrase: "Fast, cheap and golden.",
    likes: ["Gold", "Tiny fees", "Busy trading days", "Her token burns"],
    dislikes: ["Congestion", "Rug pulls", "People who don't tip their validators"],
    withSwapchan:
      "Swap-chan's sparkly rival. They argue over who wears gold better, then bridge USDT together like nothing happened.",
    friends: [
      { who: "swapchan", note: "Rivals in gold, best friends in trading." },
      {
        who: "avalanche",
        note: "Both launched in September 2020. They throw a joint birthday party.",
      },
    ],
    facts: {
      chain: "BNB Smart Chain (chain id 56)",
      launched: "2020",
      consensus: "Proof of Staked Authority with a small validator set",
      token: "BNB",
      knownFor: "Very low fees, fast blocks, and a huge retail user base",
    },
    art: "final",
  },
  avalanche: {
    key: "avalanche",
    role: "Snow-fast subnet samurai",
    intro:
      "Avax-chan arrives like a snowstorm: sudden, cold and over in under a second. She commands a whole dojo of her own L1s.",
    personality:
      "Serious, honorable and very fast. A disciplined samurai who warms up only around close friends.",
    look: "Long white hair with red streaks in a high ponytail and a snowflake clip, a white jacket with red AVAX-triangle chevrons, a red pleated skirt trimmed with snowy mountain peaks, a katana at her hip, and red-and-white boots.",
    catchphrase: "Finalized. Next.",
    likes: ["Sub-second finality", "Snow", "Building custom L1s", "Clean sword strikes"],
    dislikes: ["Waiting for confirmations", "Hot weather", "Being called a copycat"],
    withSwapchan:
      "A trusted ally. Swap-chan routes to her when someone needs an answer before they can blink.",
    friends: [
      { who: "solana", note: "Her racing buddy." },
      { who: "bnb", note: "Shares a September 2020 birthday with her." },
    ],
    facts: {
      chain: "Avalanche C-Chain (chain id 43114)",
      launched: "2020",
      consensus: "Avalanche (Snowman) consensus, Proof of Stake",
      token: "AVAX",
      knownFor: "Sub-second finality and custom Avalanche L1s (formerly subnets)",
    },
    art: "final",
  },
  linea: {
    key: "linea",
    role: "zk-sharp, straight as a line",
    intro:
      "Linea-chan proves everything. She won't tell you something is true until she has a zero-knowledge proof to back it up, and then she'll show you the proof anyway.",
    personality:
      "Precise, earnest and a little perfectionist. Draws straight lines with a ruler for fun.",
    look: "A sleek black bob with one teal streak, a crisp white jacket with straight black line trim over a black turtleneck, black shorts, and a glowing teal ruler in hand.",
    catchphrase: "Proven, not promised.",
    likes: ["Validity proofs", "Straight lines", "MetaMask", "Burning ETH"],
    dislikes: ["Hand-waving", "Crooked rulers", "Seven-day waits"],
    withSwapchan:
      "A careful friend. She double-checks Swap-chan's math, which Swap-chan pretends to hate.",
    friends: [
      { who: "scroll", note: "Her fellow zk scholar." },
      { who: "polygon", note: "They nerd out over proof systems." },
    ],
    facts: {
      chain: "Linea (chain id 59144)",
      launched: "2023",
      consensus: "zkEVM rollup on Ethereum, built by Consensys",
      token: "LINEA (launched 2025); gas is paid in ETH",
      knownFor: "zk proofs, the MetaMask family, and burning ETH and LINEA",
    },
    art: "final",
  },
  scroll: {
    key: "scroll",
    role: "Keeper of the zk scrolls",
    intro:
      "Scroll-chan is the cast's librarian. She keeps every transaction written down, rolled up and sealed with a proof, and she can read Ethereum bytecode as easily as a bedtime story.",
    personality: "Gentle, studious and quietly stubborn about doing things the right way.",
    look: "Long orange hair in a ponytail, round glasses, a parchment-cream long coat with orange scroll motifs, a satchel full of notes, and an unrolled scroll she's always reading from.",
    catchphrase: "It's all written down.",
    likes: ["Libraries", "Open-source research", "EVM equivalence", "Parchment"],
    dislikes: ["Shortcuts", "Lost receipts", "Loud parties (except Sol-chan's)"],
    withSwapchan:
      "Swap-chan's tutor. Scroll-chan keeps notes on every route Swap-chan has ever found.",
    friends: [
      { who: "linea", note: "Her fellow zk scholar." },
      { who: "ethereum", note: "Her hero. Scroll-chan wants to be exactly like her." },
    ],
    facts: {
      chain: "Scroll (chain id 534352)",
      launched: "2023",
      consensus: "zkEVM rollup on Ethereum",
      token: "SCR (governance); gas is paid in ETH",
      knownFor: "A bytecode-compatible zkEVM built in the open",
    },
    art: "final",
  },
};

export const castOrder: CharacterKey[] = [
  "swapchan",
  "ethereum",
  "base",
  "arbitrum",
  "optimism",
  "polygon",
  "bnb",
  "avalanche",
  "linea",
  "scroll",
  "solana",
  "bitcoin",
  "tron",
];

export const castHref = (key: CharacterKey): string => `/cast/${key}`;
export const fullArtSrc = (key: CharacterKey): string => `/characters/full/${key}.webp`;
export const ogSrc = (key: CharacterKey): string => `/characters/og/${key}.png`;
