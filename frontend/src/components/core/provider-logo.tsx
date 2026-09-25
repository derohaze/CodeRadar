import { cn } from "@/lib/utils";

type ProviderId = string;

const LOGO_SRC: Record<string, string> = {
  openai: "/logos/openai.svg",
  anthropic: "/logos/anthropic.svg",
  deepseek: "/logos/deepseek.svg",
  gemini: "/logos/gemini.svg",
  grok: "/logos/grok.svg",
  nvidia: "/logos/nvidia.svg",
};

interface ProviderLogoProps {
  providerId: ProviderId;
  providerName?: string;
  size?: number;
  className?: string;
  active?: boolean;
}

export function ProviderLogo({ providerId, providerName, size = 18, className, active }: ProviderLogoProps) {
  const src = LOGO_SRC[providerId];

  if (providerId === "custom" || !src) {
    const initials = (providerName || providerId || "??").slice(0, 2).toUpperCase();
    return (
      <span className={cn("flex items-center justify-center text-[10px] font-semibold tracking-wide text-white/70", className)} style={{ width: size, height: size }}>
        {initials}
      </span>
    );
  }

  const needsInvert = providerId === "openai" || providerId === "anthropic" || providerId === "grok";

  return (
    <span className={cn("inline-flex shrink-0 items-center justify-center", className)} style={{ width: size, height: size }}>
      <img
        src={src}
        alt={providerName || providerId}
        width={size}
        height={size}
        className={cn("h-full w-full object-contain", needsInvert && "invert brightness-0", active ? "opacity-100" : "opacity-95")}
        loading="lazy"
        draggable={false}
      />
    </span>
  );
}

// Free logo — no circle, original brand colors from local files
export function ProviderBadge({ providerId, providerName, active }: { providerId: string; providerName: string; active?: boolean }) {
  return <ProviderLogo providerId={providerId} providerName={providerName} size={18} active={active} />;
}
