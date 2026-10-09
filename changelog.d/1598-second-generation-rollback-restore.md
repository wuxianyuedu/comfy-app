## Fixed

- **回退的第二代：`ad81a912` 之外还有一批 master 内容被取错一侧，此前没有任何判据会响**。
  上一条（#1592）找回的是「门禁与用例当场报出来」的部分，这一轮把范围重新扫了一遍
  —— 判据从「谁改过这个文件」换成「master 有过的内容现在还在不在」：

  - **57 份文件仍是回退版**，其中最重的是**判据本体**被退：
    `scripts/check-ps1-consistency.mjs` 少了 239 行（README 入口清单的「表 ⇄ 磁盘 ⇄
    `package.json`」三向判据整段）、`tests/ps1-consistency.test.ts` 少 138 行、
    `README.md` / `tools/README.md` 的对应承诺同批 —— 而它**少了半张靶子之后仍然报 OK**；
    `scripts/check-pnpm-available.mjs` 少 42 行（#1568 那批：不再点名 tsc / eslint / vitest、
    也不再与启动器共用同一份 `checkNodeModules`），`tests/dev-launcher-toolchain-gate.test.ts`
    少 62 行；`check-annotate-consumer.cjs` / `check-task-meta-consumer.cjs` 少「台账缺失 /
    解析失败一律抛」那两条；`quality-gate.mjs` / `.ps1` 的 `depsFreshness` 档；
    `tests/daily-tracks.test.ts`、`src/lib/core/repository.test.ts`（185 行）、
    `src/lib/browser-storage.test.ts`（105 行）、`tests/annotate-consumer-gate.test.ts` /
    `tests/task-meta-consumer-gate.test.ts`（退回手搓临时仓库，共享 fixture 那次收口被退）。
  - **typography 收口被退了两次**：`9be1fe0e`（#1582）的 62 处 `text-[13px]` → `text-sm`
    在 `bdabd26f` 那次合并里又被取掉一遍（这一批文件保留了分支侧的 a11y 增补，所以不能
    整份取一侧）。按原提交重放，字面字号棘轮回到 **140**（= 回退前实测值，逐值分布核对过）。
  - **`VideoTaskRow` 导出类型**（`695438b2` 加的 zod 推理类型）：`1f629434` 找回了 schema
    与 `parseVideoRows` 却漏了它。零消费、且 `check-dead-exports` 只计值导出（type 豁免），
    所以只有对着回退前逐符号比才看得见。

  第二代的根因与第一代同形：真实合并 `998d33d6`（base `16268e99`、master 侧 `ad81a912`）
  对着 41 份文件**整份取了分支侧**。因为没有判据会因为「判据自己消失」而响，
  这一类缺失只能靠对着上游逐文件/逐符号比出来（ISSUE #1498）。
