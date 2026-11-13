import { fileURLToPath } from "node:url";

/** Directory of the hand-written fixture lake for a scenario. */
export function fixtureDir(scenario: string): string {
  return fileURLToPath(new URL(`./__fixtures__/${scenario}`, import.meta.url));
}
