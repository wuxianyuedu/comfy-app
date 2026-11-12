/**
 * 产品需求总表的两个计数（ISSUE #3649）：功能域数 / 编号化需求条数。
 *
 * 这一族数字从前只以**手抄**形式写在两份索引文档里（`docs/README.md` /
 * `docs/product/README.md`），抄错了没有任何判据会发现 —— 现场是两边一个写
 * 「14 个功能域 76 条」、另一个写「17 个功能域」。本文件钉住三件事：
 *   ① 权威源（`feature-catalog.md` 的分域总表）本身的结构不变量；
 *   ② 两份索引文档写的数字 == 现场计数，且两处口径一致；
 *   ③ **正控**：把索引文档里的数字改坏后 `pnpm doc:check` 必须当场变红 ——
 *      判据「存在」不等于判据「会红」，后者才是这次改动的交付物。
 *
 * 计数一律**从现场推导**（本文件自己解析总表），不写死任何数字 —— 写死就又
 * 变成第二份手抄值，下次加需求时同样没人知道要改哪儿。
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createProbeTree } from "./helpers/probe-worktree.ts";

const ROOT = process.cwd();
/** 权威源：产品功能需求清单（分域总表在这里）。 */
const CATALOG = "docs/product/feature-catalog.md";
/** 两份索引文档：两个计数各写一次，判据逐处核对。 */
const INDEX_DOCS = ["docs/README.md", "docs/product/README.md"];

/** 文档里那句计数表述的形态（数字 + 量词）；与 `scripts/doc-facts.cjs` 的事实同形。 */
const DOMAINS_PATTERN = /(?<count>\d+)\s*个功能域/g;
const REQUIREMENTS_PATTERN = /(?<count>\d+)\s*条编号化需求/g;

/** 外来值（动态 import 的模块 / 子进程抛出的对象）一律先落 `unknown`，过守卫再收窄。 */
function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

/** 文档里写的计数（可能一处都不写；一处写多个值就都收上来）。 */
function statedCounts(text: string, pattern: RegExp): Array<number> {
  return [...text.matchAll(pattern)].map((m) => Number(m.groups?.count));
}

/** 从总表现场推导出的三样东西：域小节标题、表内出现的域缩写、需求编号。 */
type CatalogFacts = {
  domainHeadings: Array<string>;
  domainsFromRows: Array<string>;
  requirementIds: Array<string>;
};

function readCatalog(): CatalogFacts {
  const lines = readFileSync(join(ROOT, CATALOG), "utf8").split(/\r?\n/);
  const domainHeadings = lines
    .filter((line) => /^###\s+2\.\d+\s/.test(line))
    .map((line) => /（(?<abbr>FR-[A-Z]+)）/.exec(line)?.groups?.abbr ?? "");
  const requirementIds = lines
    .filter((line) => /^\|\s*FR-[A-Z]+-\d+/.test(line))
    .map((line) => /^\|\s*(?<id>FR-[A-Z]+-\d+)/.exec(line)?.groups?.id ?? "");
  const domainsFromRows = [...new Set(requirementIds.map((id) => id.replace(/-\d+$/, "")))];
  return { domainHeadings, domainsFromRows, requirementIds };
}

/** 跑一次判据：返回退出码与全部输出（红时 stdout/stderr 一并收上来）。 */
function runCheck(checkScript: string, cwd: string): { code: number; output: string } {
  try {
    const output = execFileSync(process.execPath, [checkScript], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { code: 0, output };
  } catch (error) {
    const fields = isRecord(error) ? error : null;
    const status = fields?.status;
    const stdout = fields?.stdout;
    const stderr = fields?.stderr;
    return {
      code: typeof status === "number" ? status : 1,
      output: `${typeof stdout === "string" ? stdout : ""}${typeof stderr === "string" ? stderr : ""}`,
    };
  }
}

describe("产品需求总表的计数（权威源的结构不变量）", () => {
  it("域小节与表内域缩写一一对应（每个域至少有一条需求）", () => {
    const catalog = readCatalog();
    expect(catalog.domainHeadings.length, "总表里一个域小节都没数到 —— 结构变了？").toBeGreaterThan(
      0,
    );
    expect(
      catalog.domainHeadings.filter((abbr) => abbr === ""),
      "有域小节没写域缩写",
    ).toEqual([]);
    // 标题里的域缩写集合 == 表里出现过的域缩写集合：少一个说明某域没有需求行，
    // 多一个说明某域小节是空壳 —— 两种都会让「功能域数」失去意义。
    expect([...catalog.domainHeadings].sort()).toEqual([...catalog.domainsFromRows].sort());
  });

  it("需求编号不重复（编号一经分配不回收，见 catalog §1）", () => {
    const catalog = readCatalog();
    expect(catalog.requirementIds.length).toBeGreaterThan(0);
    expect(new Set(catalog.requirementIds).size).toBe(catalog.requirementIds.length);
  });
});

describe("两份索引文档的计数（ISSUE #3649 的落点）", () => {
  it("两处写的两个计数都等于现场计数", () => {
    const catalog = readCatalog();
    const liveDomains = catalog.domainHeadings.length;
    const liveRequirements = catalog.requirementIds.length;
    for (const doc of INDEX_DOCS) {
      const text = readFileSync(join(ROOT, doc), "utf8");
      const domains = statedCounts(text, DOMAINS_PATTERN);
      const requirements = statedCounts(text, REQUIREMENTS_PATTERN);
      expect(domains.length, `${doc} 里没写功能域数`).toBeGreaterThan(0);
      expect(requirements.length, `${doc} 里没写需求条数`).toBeGreaterThan(0);
      expect(new Set(domains), `${doc} 的功能域数与现场不一致`).toEqual(new Set([liveDomains]));
      expect(new Set(requirements), `${doc} 的需求条数与现场不一致`).toEqual(
        new Set([liveRequirements]),
      );
    }
  });

  it("两处口径统一（两份文档写的数字完全一样）", () => {
    const [first, second] = INDEX_DOCS;
    if (!first || !second) {
      throw new Error("INDEX_DOCS 应当是两份");
    }
    const a = readFileSync(join(ROOT, first), "utf8");
    const b = readFileSync(join(ROOT, second), "utf8");
    expect(statedCounts(a, DOMAINS_PATTERN)).toEqual(statedCounts(b, DOMAINS_PATTERN));
    expect(statedCounts(a, REQUIREMENTS_PATTERN)).toEqual(statedCounts(b, REQUIREMENTS_PATTERN));
  });
});

describe("计数判据的正控（判据存在 ≠ 判据会红）", () => {
  it("把索引文档里的数字改坏后 doc:check 当场变红并点名事实", () => {
    // 探针要改入库文档 ⇒ 落进一次性克隆，真实工作树一次不被写（ISSUE #2665）。
    const probe = createProbeTree(ROOT);
    try {
      const check = join(probe.dir, "scripts", "check-doc-references.cjs");
      const docAbs = join(probe.dir, "docs", "README.md");
      const original = readFileSync(docAbs, "utf8");

      // 负控：原样跑必须绿（判据在当前仓库上是通的，不是恒红）。
      expect(runCheck(check, probe.dir).code, "原样跑 doc:check 应当通过").toBe(0);

      // 正控：把两个计数都改坏（改成「现场 + 1」，不是写死某个数）⇒ 必须红。
      const statedDomains = statedCounts(original, DOMAINS_PATTERN)[0] ?? 0;
      const statedRequirements = statedCounts(original, REQUIREMENTS_PATTERN)[0] ?? 0;
      const broken = original
        .replace(`${statedDomains} 个功能域`, `${statedDomains + 1} 个功能域`)
        .replace(`${statedRequirements} 条编号化需求`, `${statedRequirements + 1} 条编号化需求`);
      expect(broken, "没改成 —— 文档里的计数表述变了？正控就没意义了").not.toBe(original);
      writeFileSync(docAbs, broken, "utf8");

      const result = runCheck(check, probe.dir);
      expect(result.code, "数字改坏了 doc:check 仍然放行 ⇒ 这条判据是空转的").not.toBe(0);
      expect(result.output).toContain("product.domains.count");
      expect(result.output).toContain("product.requirements.count");
    } finally {
      probe.dispose();
    }
  });
});
