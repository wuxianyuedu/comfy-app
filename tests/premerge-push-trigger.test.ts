/**
 * 「合并前的固定动作」挂到 push 上之后的四条边界（规范 §13.6.2.1）。
 *
 * 立案现场：`pnpm check:premerge` 三段复算此前唯一的执行者是「合并前记得敲一次」——
 * 平台侧 squash 合并不跑本地钩子、#623 之后又没有 CI 兜底，而纪律的三种漏法都不报错。
 * 这一族最坏的回潮形态不是「没人跑」，而是**接了线却没人守那条线**：
 * 所以这里既判决策本身，也判「钩子真的调它」这件事在位（同
 * `tests/doc-check-hook-wiring.test.ts` / `tests/daily-tracks.test.ts` 的先例）。
 *
 * 为什么并进 `scripts/affected-tests.mjs` 的 FIXED_STRUCTURAL_TESTS：改 `.githooks/**`
 * 会让增量层**放弃收窄、只跑固定清单**，这条用例守的正是那次改动本身，留在按路径
 * 引用的那份里就等于「本该拦住它的那一次一条都不跑」。
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  decidePremergePush,
  mergeCandidates,
  parseRefLines,
  readProof,
  shouldRecordProof,
  writeProof,
} from "../scripts/premerge-proof.mjs";

const HEAD = "a".repeat(40);
const UPSTREAM = "b".repeat(40);

/** @param {string} sha @param {string} [remoteSha] */
function refLine(localSha = HEAD, remoteSha = UPSTREAM) {
  return `refs/heads/feat/x\t${localSha}\trefs/heads/feat/x\t${remoteSha}`;
}

describe("ref 行解析与候选筛选（§13.6.2.1）", () => {
  it("一行四列都读出来，空行与半截行不算", () => {
    const refs = parseRefLines(`${refLine()}\n\nrefs/heads/y\tdeadbeef\n`);
    expect(refs).toHaveLength(1);
    expect(refs[0]?.localSha).toBe(HEAD);
    expect(refs[0]?.remoteRef).toBe("refs/heads/feat/x");
  });

  it("master 本身、tag、以及删除（local 全零）都不是候选", () => {
    const refs = parseRefLines(
      [
        "refs/heads/master\t" + HEAD + "\trefs/heads/master\t" + UPSTREAM,
        "refs/tags/v1\t" + HEAD + "\trefs/tags/v1\t" + "0".repeat(40),
        "(delete)\t" + "0".repeat(40) + "\trefs/heads/feat/gone\t" + HEAD,
        refLine(),
      ].join("\n"),
    );
    const candidates = mergeCandidates(refs);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.remoteRef).toBe("refs/heads/feat/x");
  });
});

describe("过期判定：什么时候才值得花那 336 秒", () => {
  it("HEAD 与上游都没动 ⇒ 不跑，且给得出理由", () => {
    const verdict = decidePremergePush({
      candidates: mergeCandidates(parseRefLines(refLine())),
      headSha: HEAD,
      upstreamSha: UPSTREAM,
      proof: {
        headSha: HEAD,
        upstreamSha: UPSTREAM,
        verifiedAt: "2026-01-01T00:00:00.000Z",
      },
    });
    expect(verdict.run).toBe(false);
  });

  it("本机从没复算过 ⇒ 跑", () => {
    const verdict = decidePremergePush({
      candidates: mergeCandidates(parseRefLines(refLine())),
      headSha: HEAD,
      upstreamSha: UPSTREAM,
      proof: null,
    });
    expect(verdict.run).toBe(true);
    expect(verdict.reasons.join("；")).toContain("没有过合并前复算的记录");
  });

  it("提交动了（HEAD 变了）⇒ 跑，且理由里带上两颗 sha 供人核对", () => {
    const verdict = decidePremergePush({
      candidates: mergeCandidates(parseRefLines(refLine())),
      headSha: HEAD,
      upstreamSha: UPSTREAM,
      proof: {
        headSha: "c".repeat(40),
        upstreamSha: UPSTREAM,
        verifiedAt: "2026-01-01T00:00:00.000Z",
      },
    });
    expect(verdict.run).toBe(true);
    expect(verdict.reasons.join("；")).toContain(HEAD.slice(0, 8));
  });

  it("上游前移了 ⇒ 跑 —— 这一条才是「把红带进 master」真正的入口", () => {
    const verdict = decidePremergePush({
      candidates: mergeCandidates(parseRefLines(refLine())),
      headSha: HEAD,
      upstreamSha: UPSTREAM,
      proof: {
        headSha: HEAD,
        upstreamSha: "d".repeat(40),
        verifiedAt: "2026-01-01T00:00:00.000Z",
      },
    });
    expect(verdict.run).toBe(true);
    expect(verdict.reasons.join("；")).toContain("上游");
  });

  it("一次推多条分支时，证明只覆盖当前 HEAD ⇒ 不许免检", () => {
    const refs = parseRefLines([refLine(), refLine("e".repeat(40))].join("\n"));
    const verdict = decidePremergePush({
      candidates: mergeCandidates(refs),
      headSha: HEAD,
      upstreamSha: UPSTREAM,
      proof: {
        headSha: HEAD,
        upstreamSha: UPSTREAM,
        verifiedAt: "2026-01-01T00:00:00.000Z",
      },
    });
    expect(verdict.run).toBe(true);
    expect(verdict.reasons.join("；")).toContain("不在当前 HEAD 上");
  });

  it("没有目标分支 ref ⇒ 不跑也不拦（推 tag 不该被这一跳卡住）", () => {
    const verdict = decidePremergePush({
      candidates: mergeCandidates(
        parseRefLines("refs/tags/v1\t" + HEAD + "\trefs/tags/v1\t" + HEAD),
      ),
      headSha: HEAD,
      upstreamSha: UPSTREAM,
      proof: null,
    });
    expect(verdict.run).toBe(false);
    expect(verdict.reasons[0]).toContain("没有要合进 master 的分支");
  });

  it("取不到上游引用 ⇒ 不许读成「没必要跑」（那会让没 fetch 过的检出静默免检）", () => {
    const verdict = decidePremergePush({
      candidates: mergeCandidates(parseRefLines(refLine())),
      headSha: HEAD,
      upstreamSha: null,
      proof: null,
    });
    expect(verdict.run).toBe(false);
    expect(verdict.reasons[0]).toMatch(/^取不到/);
  });
});

describe("证明的读写（本机、不入库；红着不许记）", () => {
  it("只有全绿才写 —— 1 / 2 / null 都不算「复算过」", () => {
    expect(shouldRecordProof(0)).toBe(true);
    expect(shouldRecordProof(1)).toBe(false);
    expect(shouldRecordProof(2)).toBe(false);
    expect(shouldRecordProof(null)).toBe(false);
  });

  it("写入后能原样读回，并带上时间与命令", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "comfy-premerge-proof-"));
    try {
      writeProof(dir, { headSha: HEAD, upstreamSha: UPSTREAM, who: "tester" });
      const proof = readProof(dir);
      expect(proof?.headSha).toBe(HEAD);
      expect(proof?.upstreamSha).toBe(UPSTREAM);
      expect(typeof proof?.verifiedAt).toBe("string");
      expect(String(proof?.how ?? proof?.verifiedAt)).toBeTruthy();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("没有记录 / 半截 JSON 都读成 null（代价是多跑一次，不是少跑一次）", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "comfy-premerge-proof-"));
    try {
      expect(readProof(dir)).toBeNull();
      writeFileSync(
        path.join(dir, "comfy-premerge-proof.json"),
        '{"headSha":',
        "utf8",
      );
      expect(readProof(dir)).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("接线在位（判据要有人跑，也要有人守那条线）", () => {
  const hook = readFileSync(".githooks/pre-push", "utf8");

  it("钩子真的调用这份脚本（注释里的同名字样不算调用）", () => {
    // 锚定行首：把那一行前面加 `# ` 注掉之后，`toContain` 仍然命中，只有这里会红。
    expect(hook).toMatch(/^node scripts\/premerge-proof\.mjs <"\$refs_in"/m);
  });

  it("stdin 只读一次、再分喂两处 —— 少一处就会有一方拿到空输入且不报错", () => {
    expect(hook).toMatch(/^cat >"\$refs_in" \|\| exit 1$/m);
    expect(hook).toMatch(
      /^git lfs pre-push "\$@" <"\$refs_in" \|\| exit \$\?$/m,
    );
    expect(hook).toMatch(
      /^node scripts\/premerge-proof\.mjs <"\$refs_in" \|\| exit \$\?$/m,
    );
  });

  it("LFS 那一跳没有被这次接线挤掉", () => {
    expect(hook).toContain("git lfs pre-push");
    expect(hook).toMatch(/command -v git-lfs/);
  });

  it("台账认得 pre-push 这个执行者来源（否则接线会被读成「没人跑」）", () => {
    const ledger = readFileSync("scripts/check-gate-executors.cjs", "utf8");
    expect(ledger).toContain('".githooks/pre-push"');
  });

  it("复算本体只有一处实现 —— 钩子里不许长出第二套编排（§12.12）", () => {
    expect(hook).not.toMatch(
      /base-check|check-commit-claims|check-merged-side-loss/,
    );
    expect(hook).toContain("premerge-proof.mjs");
  });
});
