/**
 * lock-diff.mjs 的类型声明（实现是 .mjs，供 TS 侧 import 时拿到类型）。
 * 只声明对外 API；JSDoc 的完整语义见 lock-diff.mjs。
 */
export interface DepEntry {
  specifier: string;
  version: string;
}

export interface LockSection {
  keys: Map<string, Array<string>>;
  raw: Array<string>;
}

export interface ParsedLockfile {
  duplicates: Array<string>;
  importer: Map<string, Map<string, Map<string, DepEntry>>>;
  lockfileVersion: string;
  sections: Map<string, LockSection>;
}

export interface FieldChange {
  from?: string;
  key: string;
  to?: string;
  value?: string;
}

export interface DepChange {
  from?: string;
  fromSpecifier?: string;
  name: string;
  specifier?: string;
  to?: string;
  value?: DepEntry;
}

export interface FlatDiff {
  added: Array<FieldChange>;
  changed: Array<FieldChange>;
  removed: Array<FieldChange>;
}

export interface GroupDiff {
  added: Array<DepChange>;
  changed: Array<DepChange>;
  removed: Array<DepChange>;
}

export interface EntryDiff {
  added: Array<string>;
  removed: Array<string>;
}

export interface LockDiff {
  duplicates: { new: Array<string>; old: Array<string>; };
  importers: Record<string, Record<string, GroupDiff>>;
  lockfileVersion: string;
  overrides: FlatDiff;
  packages: EntryDiff;
  settings: FlatDiff;
  snapshots: EntryDiff;
}

export function stripBundledSection(text: string): string;
export function splitTopSections(text: string): {
  duplicates: Array<string>;
  sections: Map<string, Array<string>>;
};
export function splitTopKeys(lines: Array<string>): Map<string, Array<string>>;
export function flatEntries(lines: Array<string>): Map<string, string>;
export function importerGroups(lines: Array<string>): Map<string, Array<string>>;
export function parseDependencyTable(lines: Array<string>): Map<string, DepEntry>;
export function parseLockfile(text: string): ParsedLockfile;
export function diffLockfiles(oldText: string, newText: string): LockDiff;
export function isEmptyDiff(d: LockDiff): boolean;
export function sectionFingerprint(sectionLines: Array<string>): string;
