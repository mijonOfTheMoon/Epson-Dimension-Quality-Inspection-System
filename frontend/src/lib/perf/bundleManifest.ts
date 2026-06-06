import { gzipSync } from 'node:zlib';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

export interface ManifestEntry {
  file: string;
  name?: string;
  src?: string;
  isEntry?: boolean;
  isDynamicEntry?: boolean;
  imports?: string[];
  dynamicImports?: string[];
  css?: string[];
  assets?: string[];
}

export type ViteManifest = Record<string, ManifestEntry>;

export function resolveDistDir(): string {
  return path.resolve(__dirname, '../../../dist');
}

export function manifestPath(distDir: string = resolveDistDir()): string {
  return path.join(distDir, '.vite', 'manifest.json');
}

export function manifestExists(distDir: string = resolveDistDir()): boolean {
  return existsSync(manifestPath(distDir));
}

export function loadManifest(distDir: string = resolveDistDir()): ViteManifest {
  const raw = readFileSync(manifestPath(distDir), 'utf8');
  return JSON.parse(raw) as ViteManifest;
}

export function findEntry(manifest: ViteManifest): ManifestEntry {
  const entries = Object.values(manifest).filter((e) => e.isEntry);
  if (entries.length !== 1) {
    throw new Error(`expected exactly one entry chunk, found ${entries.length}`);
  }
  return entries[0];
}

export function findDynamicEntries(manifest: ViteManifest): ManifestEntry[] {
  return Object.values(manifest).filter((e) => e.isDynamicEntry);
}

export function gzipBytesOf(relFile: string, distDir: string = resolveDistDir()): number {
  const abs = path.join(distDir, relFile);
  const buf = readFileSync(abs);
  return gzipSync(buf).length;
}

export function findApexchartsChunkFile(manifest: ViteManifest, distDir: string = resolveDistDir()): string | null {
  for (const entry of Object.values(manifest)) {
    if (!entry.file.endsWith('.js')) continue;
    const abs = path.join(distDir, entry.file);
    if (!existsSync(abs)) continue;
    const content = readFileSync(abs, 'utf8');
    if (content.toLowerCase().includes('apexcharts')) {
      return entry.file;
    }
  }
  return null;
}

const BYTES_PER_KB = 1024;

export function bytesToKb(bytes: number): number {
  return bytes / BYTES_PER_KB;
}
