/**
 * Temporary probe — deleted immediately after checking which arbitrary-value
 * syntaxes Tailwind actually emits in this project.
 */
export function ClsProbe() {
  return (
    <div
      className="bg-[var(--cr-workspace)] text-[var(--cr-text-primary)] border-[var(--cr-border)] bg-(--cr-card) bg-[hsl(var(--cr-tile))] text-[hsl(var(--cr-text-secondary))]"
      data-probe="1"
    />
  );
}
