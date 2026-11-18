/**
 * `ci-mirror-recipe.mjs` 的用例（ISSUE #4300）。
 *
 * 配方格是「CNB ⇄ GA 判同一棵树」的当场凭证：这里钉三件事 ——
 * ① 配方行的**字段词表**（base / head / merge_tree / 检出tree）与 CNB 侧镜像日志
 *    （`计划：HEAD … · tree … · base …`）及 payload 键名（`client_payload.merge_tree`）
 *    同词，漂移当场红；
 * ② 核对三态：有指纹且相等 ⇒ verified（0）；没指纹 ⇒ skipped（0，增量契约）；
 *    有指纹不等 / 本地 tree 取不到 ⇒ mismatch（1，fail-closed）；
 * ③ `main` 的 env 接线：pr-gate.yml 的配方 step 只喂 `MIRROR_*` 三个环境变量。
 */
import { describe, expect, it } from "vitest";

import {
  CODE,
  localTreeSha,
  main,
  renderRecipe,
  shortSha,
  verifyTree,
} from "../scripts/ci/ci-mirror-recipe.mjs";

const SHA = "26a3c3ed06deb679974200d68005ff583178d63f";
/* 两个互不相同的 40 位十六进制树指纹（必须是合法 hex，过 SHA_RE 那把尺）。 */
const TREE = `1234abcd${"0".repeat(32)}`;
const OTHER_TREE = `5678ef90${"0".repeat(32)}`;

describe("配方渲染", () => {
  it("shortSha：40 位取前 8 位；空缺席；其余原样", () => {
    expect(shortSha(SHA)).toBe(SHA.slice(0, 8));
    expect(shortSha("")).toBe("缺席");
    expect(shortSha(undefined)).toBe("缺席");
    expect(shortSha("  ")).toBe("缺席");
    /* 非 40 位（被人手误截断的值）原样念出来，不假装它是 sha。 */
    expect(shortSha("abc123")).toBe("abc123");
  });

  it("renderRecipe：四段字段齐全，缺席段念「缺席」，不编造 sha", () => {
    expect(renderRecipe({ baseSha: SHA, headSha: SHA, mergeTree: TREE, localTree: TREE })).toBe(
      `CI 配方：base=${SHA.slice(0, 8)} · head=${SHA.slice(0, 8)} · merge_tree=${TREE.slice(0, 8)} · 检出tree=${TREE.slice(0, 8)}`,
    );
    const bare = renderRecipe({});
    expect(bare).toBe("CI 配方：base=缺席 · head=缺席 · merge_tree=缺席 · 检出tree=缺席");
  });

  it("词表对账：字段名与 payload 键 / CNB 镜像日志同词（merge_tree / base / head）", () => {
    const line = renderRecipe({ baseSha: SHA, headSha: SHA, mergeTree: TREE, localTree: TREE });
    /* `merge_tree` 与 payload 的 `client_payload.merge_tree` 键名逐字同词；
     * CNB 侧「计划」行打 `tree <短sha>`，两边按同一批字段对账。 */
    expect(line).toContain("base=");
    expect(line).toContain("head=");
    expect(line).toContain("merge_tree=");
    expect(line).toContain("检出tree=");
    expect(line).not.toContain("\n");
  });
});

describe("树核对三态", () => {
  it("有指纹且相等 ⇒ verified（与 CNB 侧同树）", () => {
    expect(verifyTree({ mergeTree: TREE, localTree: TREE })).toEqual({
      mode: "verified",
      note: `树一致（${TREE.slice(0, 8)}）⇒ 与 CNB 侧判的是同一棵树`,
    });
  });

  it("payload 没带指纹 ⇒ skipped：只打印配方不核对（老 payload / 手动档，增量契约）", () => {
    const got = verifyTree({ mergeTree: "", localTree: TREE });
    expect(got.mode).toBe("skipped");
    expect(got.note).toContain("不核对");
  });

  it("有指纹但检出树不同 ⇒ mismatch：这跑判的不是 CNB 那棵树（fail-closed）", () => {
    const got = verifyTree({ mergeTree: TREE, localTree: OTHER_TREE });
    expect(got.mode).toBe("mismatch");
    expect(got.note).toContain("树不一致");
    expect(got.note).toContain(TREE.slice(0, 8));
    expect(got.note).toContain(OTHER_TREE.slice(0, 8));
  });

  it("有指纹但本地 tree 取不到 ⇒ mismatch：检出失败不许冒充「配方对上了」", () => {
    expect(verifyTree({ mergeTree: TREE, localTree: "" }).mode).toBe("mismatch");
  });
});

describe("main（env 接线 + 两态退码）", () => {
  it("payload 指纹 == 检出树 ⇒ 退 0，日志有配方与「树一致」", () => {
    const heard: Array<string> = [];
    const code = main({
      env: { MIRROR_BASE_SHA: SHA, MIRROR_HEAD_SHA: SHA, MIRROR_MERGE_TREE: TREE },
      git: fakeTreeGit(TREE),
      log: (line) => heard.push(line),
    });
    expect(code).toBe(CODE.OK);
    expect(heard[0]).toContain("CI 配方：");
    expect(heard.join("\n")).toContain("树一致");
  });

  it("payload 指纹 != 检出树 ⇒ 退 1（含 head_sha 缺失时 checkout 回落镜像 master 的那类跑）", () => {
    const heard: Array<string> = [];
    const code = main({
      env: { MIRROR_BASE_SHA: SHA, MIRROR_HEAD_SHA: "", MIRROR_MERGE_TREE: TREE },
      git: fakeTreeGit(OTHER_TREE),
      log: (line) => heard.push(line),
    });
    expect(code).toBe(CODE.MISMATCH);
    expect(heard.join("\n")).toContain("树不一致");
  });

  it("payload 没带指纹 ⇒ 退 0（只打印配方），日志明说「不核对」", () => {
    const heard: Array<string> = [];
    const code = main({
      env: { MIRROR_BASE_SHA: SHA, MIRROR_HEAD_SHA: SHA },
      git: fakeTreeGit(TREE),
      log: (line) => heard.push(line),
    });
    expect(code).toBe(CODE.OK);
    expect(heard.join("\n")).toContain("不核对");
  });

  it("本地 git 取不到 tree ⇒ 退 1（不冒充同树）", () => {
    const code = main({
      env: { MIRROR_MERGE_TREE: TREE },
      git: () => ({ code: 128, stdout: "", stderr: "fatal: not a repo" }),
      log: () => undefined,
    });
    expect(code).toBe(CODE.MISMATCH);
  });
});

describe("localTreeSha", () => {
  it("rev-parse HEAD^{tree} 成功 ⇒ 40 位 sha；失败 ⇒ 空串", () => {
    expect(localTreeSha(fakeTreeGit(TREE))).toBe(TREE);
    expect(localTreeSha(() => ({ code: 128, stdout: "", stderr: "fatal" }))).toBe("");
    /* 回话不是 40 位（比如空仓 / 异常输出）也当取不到。 */
    expect(localTreeSha(() => ({ code: 0, stdout: "HEAD\n", stderr: "" }))).toBe("");
  });
});

/** @param {string} tree 假 git 对 `rev-parse HEAD^{tree}` 的回话 */
function fakeTreeGit(tree: string) {
  return (args: Array<string>) =>
    args[0] === "rev-parse" && args[1] === "HEAD^{tree}"
      ? { code: 0, stdout: `${tree}\n`, stderr: "" }
      : { code: 1, stdout: "", stderr: "unexpected call" };
}
