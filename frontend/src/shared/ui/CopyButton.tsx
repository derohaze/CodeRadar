import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { cn } from "@/lib/utils";

interface CopyButtonProps {
  value: string;
  label?: string;
  copiedLabel?: string;
  className?: string;
  size?: "sm" | "md";
}

export function CopyButton({
  value,
  label = "Copy",
  copiedLabel = "Copied",
  className,
  size = "sm",
}: CopyButtonProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(value);
    } finally {
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    }
  };

  const sizeClasses = size === "md" ? "gap-2 px-4 py-2 text-sm" : "gap-1.5 px-3.5 py-1.5 text-xs";

  return (
    <button
      type="button"
      onClick={() => void handleCopy()}
      className={cn(
        "inline-flex items-center rounded-lg border bg-card font-medium text-txt-primary transition-colors hover:bg-muted",
        sizeClasses,
        className,
      )}
      style={{ borderColor: "hsl(var(--border-primary))" }}
    >
      {copied ? <Check size={14} className="text-status-success" /> : <Copy size={14} className="text-txt-secondary" />}
      {copied ? copiedLabel : label}
    </button>
  );
}
