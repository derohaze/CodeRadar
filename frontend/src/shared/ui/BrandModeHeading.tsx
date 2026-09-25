import { DecryptedText } from "./DecryptedText";
import type { WorkspaceMode } from "@/shared/types/app";

export function BrandModeHeading({ mode = "security" }: { mode?: WorkspaceMode }) {
  const text = mode === "builder" ? "Archive" : "";

  return (
    <h1 className="inline-flex items-baseline whitespace-nowrap font-brand text-[22px] font-normal tracking-[-0.01em] text-txt-primary">
      <span>CodeRadar</span>
      {text ? (
        <span className="inline-grid min-w-[8ch] pl-2 text-left" aria-live="polite">
          <span className="col-start-1 row-start-1 inline-block">
            <DecryptedText
              text={text}
              speed={38}
              characters="ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#*@%&!+=?/~$<>[]{}^"
              className="text-txt-primary"
              encryptedClassName="text-[#9f9587]"
            />
          </span>
        </span>
      ) : null}
    </h1>
  );
}
