import { readFileSync, lstatSync } from 'node:fs';
import { join, isAbsolute } from 'node:path';
import { createHash } from 'node:crypto';
const evidence = JSON.parse(readFileSync(new URL('./TESTED-SOURCE.json', import.meta.url), 'utf8'));
export const brokerRoot = process.env.BROKER_REFERENCE_DIR;
export const agyRoot = process.env.ANTIGRAVITY_ADAPTER_DIR;
export const piRoot = process.env.PI_TEST_INSTALL;
export function verifySources() {
  const roots = { broker: brokerRoot, antigravity: agyRoot, pi: piRoot };
  if (process.version !== evidence.node) throw new Error('Use the exact Node runtime recorded in TESTED-SOURCE.json.');
  for (const [group, root] of Object.entries(roots)) {
    if (!root || !isAbsolute(root)) throw new Error(`Set the documented absolute ${group} source directory.`);
    for (const [file, expected] of Object.entries(evidence.files[group])) {
      const path = join(root, file);
      if (!lstatSync(path).isFile() || createHash('sha256').update(readFileSync(path)).digest('hex') !== expected) {
        throw new Error(`Pinned ${group} source bytes do not match; review before rerunning this probe.`);
      }
    }
  }
}
