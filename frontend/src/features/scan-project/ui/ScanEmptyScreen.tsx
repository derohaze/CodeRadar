import { useState } from "react";
import { Search } from "lucide-react";
import { Loader } from "@/shared/ui/Loader";

interface Props {
  onStartScan: () => void;
}

export function ScanEmptyScreen({ onStartScan }: Props) {
  const [loading, setLoading] = useState(false);

  const handleClick = () => {
    setLoading(true);
    setTimeout(() => {
      onStartScan();
    }, 600);
  };

  return (
    <div className="flex flex-1 flex-col items-center justify-center bg-surface px-8">
      <div className="mb-5 flex items-center justify-center">
        <Search size={28} className="text-txt-secondary" strokeWidth={1.9} />
      </div>

      <h2 className="mb-2 text-xl font-semibold text-txt-primary">Review your code for security issues</h2>
      <p className="mb-8 max-w-md text-center text-sm leading-relaxed text-txt-secondary">
        Choose a real file or folder, then let CodeRadar run the connected code review flow
      </p>

      <button
        onClick={handleClick}
        disabled={loading}
        className="flex items-center gap-2 rounded-md border bg-primary px-5 py-2 text-sm font-medium text-primary-foreground disabled:opacity-80"
      >
        {loading && <Loader variant="spin" className="size-4 text-primary-foreground" />}
        {loading ? "Opening…" : "Open review setup"}
      </button>
    </div>
  );
}
