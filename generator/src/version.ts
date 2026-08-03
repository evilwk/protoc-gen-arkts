import { readFileSync } from 'node:fs';

interface PackageMetadata {
  version?: unknown;
}

const metadata: PackageMetadata = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8')
) as PackageMetadata;

if (typeof metadata.version !== 'string' || metadata.version.length === 0) {
  throw new Error('package.json must contain a non-empty version');
}

export const PLUGIN_VERSION: string = metadata.version;
