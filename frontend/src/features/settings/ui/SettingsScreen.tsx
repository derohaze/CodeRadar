import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import {
  ArrowLeft01Icon,
  BalanceScaleIcon,
  Settings01Icon,
  Shield01Icon,
  ZapIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Monitor, Moon, Sun } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/components/ui/sonner";
import type { RuntimeSettings, UpdateRuntimeSettingsPayload } from "@/shared/api/security";
import { listProviders, listProviderModels, testProvider } from "@/shared/api/security";
import type { ProviderInfo } from "@/shared/api/security";
import { toAnalystCopy } from "@/shared/lib/analyst-copy";

interface SettingsScreenProps {
  onBack: () => void;
  settings: RuntimeSettings;
  isSaving: boolean;
  onPatchSettings: (patch: UpdateRuntimeSettingsPayload) => void | Promise<void>;
  isSidebarCollapsed?: boolean;
}

type SettingsTab = "general" | "providers";

const sections: Array<{ id: SettingsTab; label: string; icon: typeof Settings01Icon }> = [
  { id: "general", label: "General", icon: Settings01Icon },
  { id: "providers", label: "Providers", icon: Settings01Icon },
];

const scanModes = [
  { value: "deep", label: "Deep review" },
  { value: "fast", label: "Fast review" },
] as const;
const themeOptions = [
  { value: "system", label: "System", icon: Monitor },
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
] as const;

const scanPresets = [
  {
    id: "safe",
    label: "Safe mode",
    description: "Prioritize high-confidence findings and calmer defaults for steady review flows",
    icon: Shield01Icon,
    defaultMode: "deep",
  },
  {
    id: "balanced",
    label: "Balanced",
    description: "Keep security coverage broad without turning every review run into a noisy sweep",
    icon: BalanceScaleIcon,
    defaultMode: "deep",
  },
  {
    id: "aggressive",
    label: "Aggressive",
    description: "Push deeper heuristics and stricter checks to surface more risky edges earlier",
    icon: ZapIcon,
    defaultMode: "fast",
  },
] as const;



export function SettingsScreen({ onBack, settings, onPatchSettings, isSaving, isSidebarCollapsed = false }: SettingsScreenProps) {
  const [activeTab, setActiveTab] = useState<SettingsTab>("general");

  return (
    <div className="flex min-h-0 flex-1 overflow-hidden bg-[#171717]">
      {/* Left nav — collapsible like workspace sidebar, Codex warm dark */}
      <div
        className="relative shrink-0 overflow-hidden transition-[width] duration-500 ease-[cubic-bezier(0.4,0,0.2,1)]"
        style={{ width: isSidebarCollapsed ? 0 : 240 }}
        aria-hidden={isSidebarCollapsed}
      >
        <div
          className="absolute inset-y-0 left-0 flex w-[240px] min-h-0 flex-col overflow-hidden bg-[#171717] transition-[transform,opacity] duration-500 ease-[cubic-bezier(0.4,0,0.2,1)] will-change-transform"
          style={{ transform: isSidebarCollapsed ? "translateX(-16px)" : "translateX(0)", opacity: isSidebarCollapsed ? 0 : 1 }}
        >
          <div
            className={`flex h-[44px] items-center px-3 transition-all duration-500 ease-[cubic-bezier(0.4,0,0.2,1)] ${isSidebarCollapsed ? "translate-y-4 opacity-0" : "translate-y-0 opacity-100"}`}
            style={{ transitionDelay: isSidebarCollapsed ? "0ms" : "0ms" }}
          >
            <button
              onClick={onBack}
              className="app-no-drag inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[12.5px] font-normal text-white/60 transition-colors hover:bg-white/[0.06] hover:text-white/85"
            >
              <HugeiconsIcon icon={ArrowLeft01Icon} size={14} strokeWidth={1.7} color="currentColor" />
              <span>Back to app</span>
            </button>
          </div>

          <div className="space-y-0.5 px-2 py-3">
            {sections.map((section, index) => {
              const active = activeTab === section.id;
              return (
                <button
                  key={section.id}
                  onClick={() => setActiveTab(section.id)}
                  className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[12.5px] font-medium transition-all duration-500 ease-[cubic-bezier(0.4,0,0.2,1)] ${
                    active ? "bg-white/[0.08] text-white" : "text-white/60 hover:bg-white/[0.04] hover:text-white/85"
                  } ${isSidebarCollapsed ? "translate-y-4 opacity-0" : "translate-y-0 opacity-100"}`}
                  style={{ transitionDelay: isSidebarCollapsed ? "0ms" : `${75 + index * 75}ms` }}
                >
                  <HugeiconsIcon icon={section.icon} size={14} strokeWidth={1.7} color="currentColor" className={active ? "text-white/70" : "text-white/40"} />
                  <span>{section.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Right content — pure white curve */}
      <div
        className={`flex min-h-0 flex-1 flex-col overflow-hidden border-b border-l border-r border-border-soft bg-[#171717] shadow-sm transition-[border-radius] duration-500 ease-[cubic-bezier(0.4,0,0.2,1)] ${
          isSidebarCollapsed ? "rounded-t-[16px]" : "rounded-tl-[16px]"
        }`}
      >
        <div className="hide-scrollbar flex min-h-0 flex-1 flex-col overflow-y-auto bg-[#121212]">
          <div className="mx-auto flex w-full max-w-[820px] flex-col gap-4 px-7 py-6">
            {activeTab === "general" ? (
              <GeneralTab settings={settings} onPatchSettings={onPatchSettings} isSaving={isSaving} />
            ) : (
              <ProvidersTab settings={settings} onPatchSettings={onPatchSettings} onBack={onBack} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function GeneralTab({ settings, onPatchSettings }: { settings: RuntimeSettings; onPatchSettings: SettingsScreenProps["onPatchSettings"]; isSaving: boolean }) {
  return (
    <>
      <div className="flex items-center justify-between gap-6">
        <div>
          <h2 className="text-[20px] font-semibold tracking-[-0.02em] text-white">General</h2>
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-white/[0.06] bg-[#1e1e1e]">
        <div className="border-b border-white/[0.06] px-3.5 py-3.5">
          <div className="mb-2.5">
            <p className="text-[12.5px] font-medium text-white">Review preset</p>
            <p className="mt-0.5 text-[12px] leading-5 text-white/55">Choose the default posture for new review sessions</p>
          </div>

          <div className="grid gap-2 md:grid-cols-3">
            {scanPresets.map((preset) => {
              const active = settings.defaultPreset === preset.id;
              return (
                <button
                  key={preset.id}
                  onClick={() => {
                    void onPatchSettings({
                      defaultPreset: preset.id,
                      defaultScanMode: preset.defaultMode,
                    });
                  }}
                  className={`group rounded-xl border px-3 py-3 text-left transition-colors ${
                    active
                      ? "bg-[#2a241e] border-[#c9a86a]/25 shadow-[0_0_0_1px_rgba(201,168,106,0.12)]"
                      : "bg-[#232323] border-white/[0.06] hover:bg-[#262626] hover:border-white/[0.08]"
                  }`}
                >
                  <div className="flex items-center gap-2 text-white">
                    <div className={`flex h-6 w-6 items-center justify-center rounded-md ${active ? "bg-white/[0.08] text-white" : "bg-white/[0.06] text-white/70"}`}>
                      <HugeiconsIcon icon={preset.icon} size={12} strokeWidth={1.7} color="currentColor" />
                    </div>
                    <span className="text-[12px] font-medium">{preset.label}</span>
                  </div>
                  <p className="mt-2 text-[11.5px] leading-4 text-white/55">{preset.description}</p>
                </button>
              );
            })}
          </div>
        </div>

        <SettingsRow
          title="Default review mode"
          description="Set how new code review sessions start"
          control={
            <Select
              value={settings.defaultScanMode}
              onValueChange={(value) => void onPatchSettings({ defaultScanMode: value as RuntimeSettings["defaultScanMode"] })}
            >
              <SelectTrigger className={selectClassName}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent className={selectContentClassName}>
                {scanModes.map((mode) => (
                  <SelectItem key={mode.value} value={mode.value} className={selectItemClassName}>
                    {mode.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          }
        />

        <SettingsRow
          title="Auto-open results"
          description="Open findings automatically after review completion"
          control={<Switch checked={settings.autoOpenResults} onCheckedChange={(checked) => void onPatchSettings({ autoOpenResults: checked })} />}
        />

        <SettingsRow
          title="Sidebar behavior"
          description="Remember the last open or collapsed state"
          control={<Switch checked={settings.rememberSidebarState} onCheckedChange={(checked) => void onPatchSettings({ rememberSidebarState: checked })} />}
          border={false}
        />
      </div>

      <div className="overflow-hidden rounded-xl border border-white/[0.06] bg-[#1e1e1e]">
        <div className="px-3.5 py-3.5">
          <div className="mb-2.5">
            <p className="text-[12.5px] font-medium text-white">Appearance</p>
            <p className="mt-0.5 text-[12px] leading-5 text-white/55">Choose a look for the app — System follows your device</p>
          </div>

          <div className="grid grid-cols-3 gap-2">
            {themeOptions.map((option) => {
              const active = settings.theme === option.value;
              return (
                <button
                  key={option.value}
                  onClick={() => void onPatchSettings({ theme: option.value })}
                  className={`group flex flex-col items-center gap-1.5 rounded-xl border px-3 py-3 transition-colors ${
                    active
                      ? "bg-[#2a241e] border-[#c9a86a]/25 shadow-[0_0_0_1px_rgba(201,168,106,0.12)]"
                      : "bg-[#232323] border-white/[0.06] hover:bg-[#262626] hover:border-white/[0.08]"
                  }`}
                >
                  <div className={`flex h-6 w-6 items-center justify-center rounded-md ${active ? "bg-white/[0.08] text-white" : "bg-white/[0.06] text-white/70"}`}>
                    <option.icon size={13} strokeWidth={1.7} />
                  </div>
                  <span className="text-[12px] font-medium text-white">{option.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </>
  );
}

const FALLBACK_PROVIDERS: ProviderInfo[] = [
  { id: "openai", name: "OpenAI", defaultBaseUrl: "https://api.openai.com/v1", docsUrl: "https://platform.openai.com/docs" },
  { id: "anthropic", name: "Anthropic", defaultBaseUrl: "https://api.anthropic.com/v1", docsUrl: "https://docs.anthropic.com" },
  { id: "deepseek", name: "DeepSeek", defaultBaseUrl: "https://api.deepseek.com/v1", docsUrl: "https://api-docs.deepseek.com" },
  { id: "gemini", name: "Gemini", defaultBaseUrl: "https://generativelanguage.googleapis.com/v1beta", docsUrl: "https://ai.google.dev" },
  { id: "grok", name: "Grok (xAI)", defaultBaseUrl: "https://api.x.ai/v1", docsUrl: "https://docs.x.ai" },
  { id: "nvidia", name: "NVIDIA", defaultBaseUrl: "https://integrate.api.nvidia.com/v1", docsUrl: "https://docs.api.nvidia.com" },
  { id: "custom", name: "Custom", defaultBaseUrl: null, docsUrl: null },
];

function ProvidersTab({ settings, onPatchSettings, onBack }: { settings: RuntimeSettings; onPatchSettings: SettingsScreenProps["onPatchSettings"]; onBack: () => void }) {
  const [providers, setProviders] = useState<ProviderInfo[]>(FALLBACK_PROVIDERS);
  const [selected, setSelected] = useState<string>(settings.aiProvider || "openai");
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState(settings.aiBaseUrl || "");
  const [customName, setCustomName] = useState("");
  const [model, setModel] = useState(settings.aiModel || "");
  const [models, setModels] = useState<Array<{ id: string; name: string }>>([]);
  const [modelQuery, setModelQuery] = useState("");
  const [testState, setTestState] = useState<{ ok: boolean | null; message: string; loading: boolean }>({ ok: null, message: "", loading: false });
  const [saveLoading, setSaveLoading] = useState(false);

  useEffect(() => {
    void listProviders()
      .then((list) => {
        if (list.length > 0) setProviders(list);
      })
      .catch(() => {
        // keep fallback — no fake data, just static list, live test still goes to real provider
      });
  }, []);

  useEffect(() => {
    // Sync with stored settings when provider changes or settings load
    if (settings.aiProvider) setSelected(settings.aiProvider);
    if (settings.aiModel) setModel(settings.aiModel);
    if (settings.aiBaseUrl) setBaseUrl(settings.aiBaseUrl);
  }, [settings.aiProvider, settings.aiModel, settings.aiBaseUrl]);

  const currentProvider = providers.find((p) => p.id === selected);
  const isCustom = selected === "custom";

  const handleTest = async () => {
    const trimmedKey = apiKey.trim();
    const canUseStored = !trimmedKey && settings.aiHasKey && settings.aiProvider === selected;
    if (!trimmedKey && !canUseStored) {
      toast.error("Please enter an API key first");
      return;
    }
    const keyToTest = trimmedKey || undefined;
    setTestState({ ok: null, message: "", loading: true });
    setModels([]);
    try {
      const result = await testProvider({ provider: selected, apiKey: keyToTest as string, baseUrl: baseUrl || undefined, model: model || undefined });
      setTestState({ ok: result.ok, message: result.message, loading: false });
      if (result.ok) {
        toast.success(result.message);
        try {
          const fetched = await listProviderModels({ provider: selected, apiKey: keyToTest as string, baseUrl: baseUrl || undefined });
          setModels(fetched);
          if (fetched.length > 0) toast.success(`Found ${fetched.length} models`);
        } catch {
          // ignore
        }
      } else {
        toast.error(result.message);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Test failed";
      setTestState({ ok: false, message: msg, loading: false });
      toast.error(msg);
    }
  };

  const handleFetchModels = async () => {
    const trimmedKey = apiKey.trim();
    const canUseStored = !trimmedKey && settings.aiHasKey && settings.aiProvider === selected;
    if (!trimmedKey && !canUseStored) {
      toast.error("Please enter an API key first");
      return;
    }
    setTestState({ ok: null, message: "", loading: true });
    try {
      const fetched = await listProviderModels({ provider: selected, apiKey: trimmedKey || undefined as unknown as string, baseUrl: baseUrl || undefined });
      setModels(fetched);
      setTestState({ ok: true, message: `Found ${fetched.length} models`, loading: false });
      toast.success(`Found ${fetched.length} models`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to list models";
      setTestState({ ok: false, message: msg, loading: false });
      toast.error(msg);
    }
  };

  const handleDisconnect = async () => {
    setSaveLoading(true);
    try {
      await onPatchSettings({ aiProvider: null as unknown as string, aiModel: null as unknown as string, aiBaseUrl: null as unknown as string, aiApiKey: "" } as UpdateRuntimeSettingsPayload);
      toast.success("Provider disconnected — you can now connect another one");
      setApiKey("");
      setModel("");
      setBaseUrl("");
      setModels([]);
    } catch (e) {
      toast.error(toAnalystCopy(e instanceof Error ? e.message : "Failed to disconnect"));
    } finally {
      setSaveLoading(false);
    }
  };

  const filteredModels = useMemo(
    () => {
      const q = modelQuery.trim().toLowerCase();
      if (!q) return models;
      return models.filter((m) => m.id.toLowerCase().includes(q) || m.name.toLowerCase().includes(q));
    },
    [models, modelQuery],
  );

  const handleSave = async () => {
    const trimmedKey = apiKey.trim();
    const trimmedBaseUrl = baseUrl.trim();
    const trimmedModel = model.trim();
    if (!trimmedKey && !settings.aiHasKey) {
      toast.error("API key is required");
      return;
    }
    if (isCustom && !trimmedBaseUrl) {
      toast.error("Base URL is required for custom provider");
      return;
    }
    if (trimmedBaseUrl && !/^https?:\/\//i.test(trimmedBaseUrl)) {
      toast.error("Base URL must start with http:// or https://");
      return;
    }
    if (!trimmedModel) {
      toast.error("Select or enter a model");
      return;
    }
    setSaveLoading(true);
    try {
      await onPatchSettings({
        aiProvider: selected,
        aiApiKey: trimmedKey || undefined,
        aiBaseUrl: trimmedBaseUrl || null,
        aiModel: trimmedModel,
      } as UpdateRuntimeSettingsPayload);
      toast.success(`Connected to ${currentProvider?.name || selected} — ${trimmedModel}`);
      setApiKey("");
      onBack();
    } catch (e) {
      toast.error(toAnalystCopy(e instanceof Error ? e.message : "Failed to save provider"));
    } finally {
      setSaveLoading(false);
    }
  };

  return (
    <>
      <div>
        <h2 className="text-[20px] font-semibold tracking-[-0.02em] text-white">Providers</h2>
        <p className="mt-1 text-[12px] leading-5 text-white/55">
          Pick a provider, paste your key, test the connection, then choose a model
        </p>
        {settings.aiProvider && (
          <p className="mt-2 text-[11.5px] text-white/40">
            Active: <span className="text-white/80">{settings.aiProvider}</span> {settings.aiModel && <>· <span className="text-white/80">{settings.aiModel}</span></>} {settings.aiApiKeyMasked && <>· <span className="text-white/40">{settings.aiApiKeyMasked}</span></>}
          </p>
        )}
      </div>

      <div className="overflow-hidden rounded-xl border border-white/[0.06] bg-[#1e1e1e]">
        {(providers.length > 0 ? providers : FALLBACK_PROVIDERS).map((p) => {
          const active = selected === p.id;
          const isStoredActive = settings.aiProvider === p.id;
          return (
            <button
              key={p.id}
              onClick={() => {
                setSelected(p.id);
                setTestState({ ok: null, message: "", loading: false });
                setModels([]);
                if (p.id !== "custom") setBaseUrl("");
              }}
              className={`flex w-full items-center gap-2.5 border-b border-white/[0.06] px-3 py-2 text-left transition-colors last:border-b-0 ${
                active ? "bg-[#2a241e] border-l-2 border-l-[#c9a86a] pl-[10px]" : "hover:bg-white/[0.03]"
              }`}
            >
              <div className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md ${active ? "bg-white/[0.08] text-white" : "bg-white/[0.06] text-white/50"}`}>
                <span className="text-[9.5px] font-semibold tracking-wide">{p.name.slice(0, 2).toUpperCase()}</span>
              </div>
              <p className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-white">{p.name}</p>
              <div className="flex shrink-0 items-center gap-2">
                {isStoredActive && <span className="rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-[9.5px] font-medium text-emerald-400">Active</span>}
                {active && <span className="text-[11px] text-amber-400">✓</span>}
                <span className="text-[13px] text-white/20">›</span>
              </div>
            </button>
          );
        })}
      </div>

      <div className="overflow-hidden rounded-xl border border-white/[0.06] bg-[#1e1e1e]">
        <div className="border-b border-white/[0.06] px-3.5 py-2.5">
          <p className="text-[12.5px] font-medium text-white">{currentProvider?.name || "Custom"} settings</p>
          <p className="mt-0.5 text-[11.5px] text-white/50">Paste your key, test, then choose a model — keys are encrypted before storage</p>
        </div>

        <div className="space-y-2.5 p-3.5">
          {isCustom && (
            <div>
              <label className="text-[11px] font-medium tracking-wide text-white/60">Company / Provider Name</label>
              <input
                value={customName}
                onChange={(e) => setCustomName(e.target.value)}
                placeholder="e.g. MyCompany, Acme AI"
                className="mt-1 w-full rounded-lg border border-white/10 bg-[#2a2a2a] px-2.5 py-1.5 text-[12px] text-white placeholder:text-white/30 focus:border-white/20 focus:outline-none"
              />
              <p className="mt-1 text-[11px] text-white/35">Name for your custom OpenAI-compatible provider</p>
            </div>
          )}
          <div>
            <label className="text-[11px] font-medium tracking-wide text-white/60">API Key</label>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={settings.aiHasKey && settings.aiProvider === selected ? `Stored: ${settings.aiApiKeyMasked} — enter new to replace` : "sk-... or your provider key"}
              className="mt-1 w-full rounded-lg border border-white/10 bg-[#2a2a2a] px-2.5 py-1.5 text-[12px] text-white placeholder:text-white/30 focus:border-white/20 focus:outline-none"
            />
          </div>

          <div>
            <label className="text-[11px] font-medium tracking-wide text-white/60">
              {isCustom ? "Base URL (required)" : "Base URL (optional)"}
            </label>
            <input
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder={currentProvider?.defaultBaseUrl || "https://api.example.com/v1"}
              className="mt-1 w-full rounded-lg border border-white/10 bg-[#2a2a2a] px-2.5 py-1.5 text-[12px] text-white placeholder:text-white/30 focus:border-white/20 focus:outline-none"
            />
            {isCustom && <p className="mt-1 text-[11px] text-white/35">Custom OpenAI-compatible endpoint, e.g. https://your-proxy.com/v1</p>}
          </div>

          <div>
            <label className="text-[11px] font-medium tracking-wide text-white/60">Model</label>
            <div className="mt-1 flex gap-1.5">
              <input
                value={model}
                onChange={(e) => setModel(e.target.value)}
                placeholder={isCustom ? "model-id e.g. my-model-1" : "Select or type model id"}
                className="flex-1 rounded-lg border border-white/10 bg-[#2a2a2a] px-2.5 py-1.5 text-[12px] text-white placeholder:text-white/30 focus:border-white/20 focus:outline-none"
              />
              <button
                onClick={handleFetchModels}
                className="shrink-0 rounded-lg border border-white/10 bg-[#2a2a2a] px-2.5 py-1.5 text-[11.5px] font-medium text-white/80 hover:bg-[#303030] hover:text-white"
              >
                List
              </button>
            </div>
            {models.length > 0 && (
              <div className="mt-1.5 overflow-hidden rounded-lg border border-white/10 bg-[#232323]">
                <input
                  value={modelQuery}
                  onChange={(e) => setModelQuery(e.target.value)}
                  placeholder="Type to filter models…"
                  autoComplete="off"
                  className="w-full border-b border-white/10 bg-transparent px-2.5 py-1.5 text-[12px] text-white placeholder:text-white/30 focus:outline-none"
                />
                {filteredModels.length > 0 ? (
                  <div className="max-h-[180px] overflow-y-auto p-1">
                    {filteredModels.map((m) => (
                      <button
                        key={m.id}
                        onClick={() => { setModel(m.id); setModelQuery(""); }}
                        title={m.id}
                        className={`flex w-full items-center justify-between rounded-md px-2 py-1 text-left text-[11.5px] ${model === m.id ? "bg-white/[0.08] text-white" : "text-white/70 hover:bg-white/[0.04] hover:text-white"}`}
                      >
                        <span className="truncate">{m.id}</span>
                        {m.name !== m.id ? <span className="ml-2 shrink-0 text-[10.5px] text-white/30">{m.name.slice(0, 20)}</span> : null}
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="px-2.5 py-1.5 text-[11.5px] text-white/40">No models match “{modelQuery.trim()}”</div>
                )}
              </div>
            )}
          </div>

          {testState.message && (
            <div className={`rounded-lg border px-2.5 py-1.5 text-[11.5px] ${testState.ok ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-300" : testState.ok === false ? "border-red-500/20 bg-red-500/10 text-red-300" : "border-white/10 bg-white/[0.04] text-white/60"}`}>
              {testState.message}
            </div>
          )}

          <div className="flex gap-1.5 pt-0.5">
            <button
              onClick={handleTest}
              disabled={testState.loading}
              className="flex-1 rounded-lg border border-white/10 bg-[#2a2a2a] px-3 py-1.5 text-[12px] font-medium text-white hover:bg-[#303030] disabled:opacity-50"
            >
              {testState.loading ? "Testing…" : "Test connection"}
            </button>
            <button
              onClick={handleSave}
              disabled={saveLoading}
              className="flex-1 rounded-lg bg-white px-3 py-1.5 text-[12px] font-medium text-black hover:bg-white/90 disabled:opacity-50"
            >
              {saveLoading ? "Saving…" : "Save provider"}
            </button>
          </div>
          {settings.aiHasKey && (
            <button onClick={handleDisconnect} disabled={saveLoading} className="w-full rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-1.5 text-[12px] font-medium text-red-300 hover:bg-red-500/15 disabled:opacity-50">
              Disconnect provider
            </button>
          )}

          <p className="text-[11px] leading-4 text-white/30">
            Test runs a live call to the selected provider — no fake data, and the key is encrypted with Fernet before storage
          </p>
        </div>
      </div>
    </>
  );
}

function SettingsRow({
  title,
  description,
  control,
  border = true,
}: {
  title: string;
  description: string;
  control: ReactNode;
  border?: boolean;
}) {
  return (
    <div className={`flex items-center justify-between gap-6 px-3.5 py-3 ${border ? "border-b border-white/[0.06]" : ""}`}>
      <div className="min-w-0 pr-4">
        <p className="text-[12.5px] font-medium leading-none text-white">{title}</p>
        <p className="mt-1 text-[12px] leading-5 text-white/55">{description}</p>
      </div>
      <div className="shrink-0">{control}</div>
    </div>
  );
}

const selectClassName =
  "h-7 w-[140px] rounded-lg border border-white/10 bg-[#2a2a2a] text-[12px] font-medium text-white hover:bg-[#303030] focus:ring-0 focus:ring-offset-0 data-[placeholder]:text-white/60";

const selectContentClassName = "rounded-xl border border-white/10 bg-[#232323] text-white shadow-[0_16px_32px_rgba(0,0,0,0.5)]";

const selectItemClassName = "rounded-md text-[12px] focus:bg-white/[0.06] focus:text-white";
