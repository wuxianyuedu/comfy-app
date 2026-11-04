## Fixed

- **测试面 `no-unnecessary-condition` 收口（批次②：`tests/**` + `e2e/**`，158 处 / 37 份 → 0）**：
  取数口径同批次①（单规则临时配置 `--type-aware`，仓库判决配置在测试档不启用该规则会少报）。
  命中按来源分两类，改完按新行号重扫确认 0。

  1. **机械族直接改（16 处诊断 / 16 个代码站点）**：`expect(...)?.toContain(...)` 的 `?.`
     （`expect` 恒返回断言对象）、`result?.abort`（本仓 mock 返回恒为对象）、
     `String(track.subject ?? "")` / `duty.outputs ?? []` / `.map(([k]) => k ?? "")`
     （注册表与 Map 键均为非空 string）、`toContain(tail ?? "")`，
     以及 `l.includes(a) ?? l.includes(b)` 里永不可达的右支（删掉与保留行为一致）。
  2. **保留防御并落台账（142 处诊断 / 91 行禁用，逐行带理由）**：
     - `spawnSync` 出参（`stdout` / `stderr` / `status`）：失败路径实测为 undefined/null，
       `@types/node` 按泛型标成非空 —— 测试诊断信息全靠这层兜底；
     - Playwright `evaluate` 里的 DOM `textContent`（lib.dom 为 `string|null`，规则未建模）；
     - `RegExp.exec` 无匹配返回 null；
     - `JSON.parse` / `as` 断言后的外部形状（CI 读数、prereqs、axe 回包、
       `runtimeExitRecord` 对 `who=shell` 的 null 返回、`expect.poll` 闭包里赋值的 `box`）；
     - 回调第二参在部分调用点省略（`which` 的 options、`write` 的 stdio）。

  配置层与 CI 判据未改，未新增其它规则的禁用。

  验证：单规则复扫 `tests` + `e2e` 该规则 **158 → 0**（387 份文件）；
  `tsc --noEmit` 0 错；`vitest run tests` 322 份 / 5749 条 ⇒ 4 份 5 条失败，
  经 `base-check` 复算在 `origin/master`（`0a54bb7b6`）上**同样失败**（`baseline-red`，
  与本批改动无关：`conditional-skip-registry` / `eslint-cache-fingerprint` /
  `merged-side-loss-git` / `a11y-effective-config.coverage` ×2）；`pnpm check:premerge` 通过。
  另修掉批次① 留下的 `src/server/db.ts` 非 ASCII 回归（该文件受 AGENTS 硬规则 15 约束，
  禁用理由改写为纯 ASCII）。
