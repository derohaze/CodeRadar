/** Fixture: intentionally buggy. Review input for the engine's own tests. */

import { execSync } from "node:child_process";

export function archiveDirectory(directory: string): string {
  return execSync(`tar -czf archive.tar.gz ${directory}`).toString();
}
