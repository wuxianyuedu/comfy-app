/**
 * lock-diff.mjs 的类型声明（实现是 .mjs，供 TS 侧 import 时拿到类型）。
 * 只声明对外 API；JSDoc 的完整语义见 lock-diff.mjs。
 */
export interface DepEntry {
  specifier: string;
  version: string;
}

export interface LockSection {
  keys: Map<string, string[]>;
  raw: string[];
}

export interface ParsedLockfile {
  sections: Map<string, LockSection>;
  importer: Map<string, Map<string, Map<string, DepEntry>>>;
  duplicates: string[];
  lockfileVersion: string;
}

export interface FieldChange {
  key: string;
  value?: string;
  from?: string;
  to?: string;
}

export interface DepChange {
  name: string;
  value?: DepEntry;
  specifier?: string;
  fromSpecifier?: string;
  from?: string;
  to?: string;
}

export interface FlatDiff {
  added: FieldChange[];
  removed: FieldChange[];
  changed: FieldChange[];
}

export interface GroupDiff {
  added: DepChange[];
  removed: DepChange[];
  changed: DepChange[];
}

export interface EntryDiff {
  added: string[];
  removed: string[];
}

export interface LockDiff {
  lockfileVersion: string;
  duplicates: { old: string[]; new: string[] };
  settings: FlatDiff;
  overrides: FlatDiff;
  importers: Record<string, Record<string, GroupDiff>>;
  packages: EntryDiff;
  snapshots: EntryDiff;
}

export function stripBundledSection(text: string): string;
export function splitTopSections(text: string): { sections: Map<string, string[]>; duplicates: string[] };
export function splitTopKeys(lines: string[]): Map<string, string[]>;
export function flatEntries(lines: string[]): Map<string, string>;
export function importerGroups(lines: string[]): Map<string, string[]>;
export function parseDependencyTable(lines: string[]): Map<string, DepEntry>;
export function parseLockfile(text: string): ParsedLockfile;
export function diffLockfiles(oldText: string, newText: string): LockDiff;
export function isEmptyDiff(d: LockDiff): boolean;
export function sectionFingerprint(sectionLines: string[]): string;
