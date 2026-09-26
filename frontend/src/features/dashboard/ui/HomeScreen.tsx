import { File01Icon, Folder01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Play, Search } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TextMorph } from "@/components/core/text-morph";
import { basename } from "@/features/dashboard/model/home-screen.utils";
import { useHomeScreen } from "@/features/dashboard/model/useHomeScreen";
import type { StartScanPayload } from "@/shared/api";
import { Loader } from "@/shared/ui/Loader";

interface HomeScreenProps {
  onStartScan: (payload: StartScanPayload) => void | Promise<void>;
  defaultPreset?: "safe" | "balanced" | "aggressive";
  defaultScanMode?: "fast" | "deep";
}

export function HomeScreen({ onStartScan, defaultPreset, defaultScanMode }: HomeScreenProps) {
  const {
    canBrowse,
    clearRecentSources,
    inferredWorkspace,
    loading,
    pickPath,
    pickingPath,
    preset,
    recentSources,
    scanMode,
    scanPresets,
    selectedPreset,
    selectedTargetName,
    setPreset,
    setScanMode,
    setTargetPath,
    setTargetType,
    targetPath,
    targetType,
  } = useHomeScreen({
    preset: defaultPreset ?? "balanced",
    scanMode: defaultScanMode ?? "deep",
  });

  const handleStart = () => {
    if (loading || !targetPath) return;
    const payload: StartScanPayload = {
      sourcePath: targetPath,
      targetType,
      preset,
      scanMode,
      interactive: false,
    };
    void Promise.resolve(onStartScan(payload));
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-[#121212] px-6 py-6">
      <div className="mx-auto flex w-full max-w-[640px] flex-1 flex-col justify-center gap-5">
        {/* Header — compact */}
        <div>
          <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.14em] text-white/35">
            <Search size={12} className="text-white/25" />
            Review setup
          </div>
          <h2 className="mt-2 text-[22px] font-semibold leading-none tracking-[-0.02em] text-white">Start a code review</h2>
          <p className="mt-1.5 text-[12.5px] leading-5 text-white/55">Pick a folder or file, choose a preset, and run the review</p>
        </div>

        {/* Main card — no scroll, compact */}
        <div className="rounded-[16px] border border-white/[0.06] bg-[#1e1e1e] p-4">
          {/* Row 1: Workspace + Preset */}
          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <p className="text-[11px] font-medium tracking-wide text-white/50">Workspace</p>
              <div className="mt-1.5 flex h-8 items-center rounded-lg border border-white/10 bg-[#232323] px-3 text-[12.5px] text-white/80">
                <span className="truncate">{inferredWorkspace}</span>
              </div>
            </div>
            <div>
              <p className="text-[11px] font-medium tracking-wide text-white/50">Preset</p>
              <Select value={preset} onValueChange={(v) => setPreset(v as typeof preset)}>
                <SelectTrigger className="mt-1.5 h-8 rounded-lg border border-white/10 bg-[#232323] text-[12.5px] text-white focus:ring-0">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="rounded-lg border border-white/10 bg-[#232323] text-white">
                  {scanPresets.map((item) => (
                    <SelectItem key={item.id} value={item.id} className="rounded-md text-[12.5px] focus:bg-white/[0.06]">
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="mt-1 text-[11px] leading-4 text-white/35">{selectedPreset.description}</p>
            </div>
          </div>

          {/* Row 2: Mode + Target toggle */}
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <div>
              <p className="text-[11px] font-medium tracking-wide text-white/50">Review mode</p>
              <Select value={scanMode} onValueChange={(v) => setScanMode(v as "fast" | "deep")}>
                <SelectTrigger className="mt-1.5 h-8 rounded-full border border-white/10 bg-[#232323] text-[12.5px] text-white transition-all duration-500 ease-[cubic-bezier(0.4,0,0.2,1)] focus:ring-0">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="rounded-xl border border-white/10 bg-[#232323] text-white shadow-[0_16px_32px_rgba(0,0,0,0.5)]">
                  <SelectItem value="deep" className="rounded-full text-[12.5px] focus:bg-white/[0.06] data-[state=checked]:bg-white data-[state=checked]:text-black">Deep review</SelectItem>
                  <SelectItem value="fast" className="rounded-full text-[12.5px] focus:bg-white/[0.06] data-[state=checked]:bg-white data-[state=checked]:text-black">Fast review</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <p className="text-[11px] font-medium tracking-wide text-white/50">Target</p>
              {/* Premium pill toggle: sliding indicator + 500ms cubic-bezier */}
              <div className="relative mt-1.5 inline-flex rounded-full border border-white/10 bg-[#232323] p-0.5">
                <div
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-y-0.5 left-0.5 w-[calc(50%-2px)] rounded-full bg-white shadow-sm transition-all duration-500 ease-[cubic-bezier(0.4,0,0.2,1)] will-change-transform"
                  style={{
                    transform: targetType === "folder" ? "translateX(0)" : "translateX(calc(100% + 4px))",
                  }}
                />
                {[
                  { id: "folder", label: "Folder", icon: Folder01Icon },
                  { id: "file", label: "File", icon: File01Icon },
                ].map((opt) => {
                  const active = targetType === opt.id;
                  return (
                    <button
                      key={opt.id}
                      onClick={() => {
                        setTargetType(opt.id as "folder" | "file");
                        setTargetPath("");
                      }}
                      className={`relative z-10 inline-flex min-w-[84px] items-center justify-center gap-1.5 rounded-full px-4 py-1.5 text-[12px] font-medium transition-all duration-500 ease-[cubic-bezier(0.4,0,0.2,1)] ${
                        active ? "text-black" : "text-white/60 hover:text-white"
                      }`}
                    >
                      <HugeiconsIcon
                        icon={opt.icon}
                        size={12}
                        strokeWidth={1.7}
                        color="currentColor"
                        className={`transition-all duration-500 ease-[cubic-bezier(0.4,0,0.2,1)] ${active ? "translate-y-0 opacity-100" : "translate-y-0 opacity-70"}`}
                      />
                      <span className="transition-all duration-500 ease-[cubic-bezier(0.4,0,0.2,1)]">{opt.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Row 3: Source picker — TextMorph button (fixed width, text morph) */}
          <div className="mt-4">
            <div className="flex items-center gap-2">
              <button
                onClick={pickPath}
                disabled={pickingPath || !canBrowse}
                className="inline-flex h-8 w-[140px] shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-full bg-white px-4 text-[12.5px] font-medium text-black shadow-sm transition-colors hover:bg-zinc-100 disabled:opacity-50"
              >
                {pickingPath ? (
                  <Loader variant="spin" className="size-3.5 shrink-0" />
                ) : (
                  <HugeiconsIcon icon={targetType === "folder" ? Folder01Icon : File01Icon} size={12} strokeWidth={1.7} className="shrink-0" />
                )}
                <TextMorph className="text-[12.5px] font-medium">
                  {pickingPath ? "Opening…" : targetType === "folder" ? "Choose folder" : "Choose file"}
                </TextMorph>
              </button>
              <span className="truncate text-[12px] text-white/50 transition-all duration-500 ease-[cubic-bezier(0.4,0,0.2,1)]" title={selectedTargetName}>
                {selectedTargetName}
              </span>
            </div>
            {!canBrowse && <p className="mt-1.5 text-[11px] text-white/35">Restart with <span className="font-medium text-white/60">bun run electron:dev</span> for file picker</p>}
            <div className="mt-2 flex items-center gap-2 rounded-lg border border-white/10 bg-[#232323] px-3 py-2">
              <span className="text-[11px] font-medium tracking-wide text-white/40">PATH</span>
              <span className="truncate font-mono text-[11px] text-white/60" title={targetPath || "No source selected"}>
                {targetPath || "No source selected"}
              </span>
            </div>
          </div>

          {/* Start */}
          <button
            onClick={handleStart}
            disabled={loading || !targetPath}
            className="mt-4 inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-lg bg-white px-4 text-[13px] font-medium text-black hover:bg-white/90 disabled:opacity-50"
          >
            {loading ? <Loader variant="spin" className="size-4" /> : <Play size={14} />}
            {loading ? "Starting…" : targetPath ? "Run review" : "Choose a source first"}
          </button>
        </div>

        {/* Recent — compact horizontal, not a big card */}
        {recentSources.length > 0 && (
          <div className="flex items-center gap-2 overflow-x-auto">
            <span className="shrink-0 text-[11px] font-medium tracking-wide text-white/30">Recent</span>
            <div className="flex gap-1.5">
              {recentSources.slice(0, 3).map((item) => (
                <button
                  key={`${item.type}:${item.path}`}
                  onClick={() => setTargetPath(item.path)}
                  className="inline-flex max-w-[160px] items-center gap-1.5 truncate rounded-full border border-white/10 bg-[#1e1e1e] px-3 py-1 text-[12px] text-white/70 hover:bg-[#232323] hover:text-white"
                  title={item.path}
                >
                  <span className="truncate">{basename(item.path)}</span>
                </button>
              ))}
            </div>
            <button onClick={() => clearRecentSources(targetType)} className="ml-auto shrink-0 text-[11px] text-white/30 hover:text-white/60">
              Clear
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
