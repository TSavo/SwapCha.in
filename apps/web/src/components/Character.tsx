import Image from "next/image";
import { CHARACTERS, type CharacterKey, characterSrc } from "@/lib/characters";

export type Mood = "idle" | "bounce" | "think" | "cheer" | "sad" | "run";

const moodClass: Record<Mood, string> = {
  idle: "animate-float",
  bounce: "animate-bounce",
  think: "animate-wiggle",
  cheer: "animate-cheer",
  sad: "grayscale-[60%] rotate-[-6deg]",
  run: "animate-run",
};

export function Character({
  who,
  size = 96,
  mood = "idle",
  label = false,
  className = "",
}: {
  who: CharacterKey;
  size?: number;
  mood?: Mood;
  label?: boolean;
  className?: string;
}) {
  const c = CHARACTERS[who];
  return (
    <figure className={`flex flex-col items-center ${className}`}>
      <Image
        src={characterSrc(who)}
        alt={c.name}
        width={size}
        height={size}
        className={`drop-shadow-[0_0_14px_var(--glow)] ${moodClass[mood]}`}
        style={{ ["--glow" as string]: `${c.color}aa` }}
      />
      {label && (
        <figcaption className="mt-1 text-xs font-bold" style={{ color: c.color }}>
          {c.name}
        </figcaption>
      )}
    </figure>
  );
}

export function SpeechBubble({ who, children }: { who: CharacterKey; children: React.ReactNode }) {
  return (
    <div className="flex items-end gap-3">
      <Character who={who} size={64} mood="bounce" />
      <div className="relative rounded-2xl rounded-bl-none border-2 border-violet-400/50 bg-violet-950/80 px-4 py-2 text-sm text-violet-100">
        {children}
      </div>
    </div>
  );
}
