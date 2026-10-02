## Fixed

- 提交门槛的 C 组「红但不是用例红」：清单是位置参数，长度随改动面线性增长，而
  `pnpm exec <bin>` 在 Windows 上经 `.cmd` shim —— cmd.exe 的命令行上限是 8191 字符。
  实测一次改 22 个文件的提交算出 229 个用例 / 10840 字符，vitest 根本没启动，
  stdout 只有一行 GBK 乱码（「文件名或扩展名太长」），钩子的表现是「组 C 失败」
  而看不见任何用例名。改动面越大的提交越容易撞上。
- 启动那一步交给新脚本 `scripts/run-affected-tests.mjs`：`spawnSync(process.execPath,
[vitest 的 ESM 入口, …])` 直接起，不经 cmd 层（上限回到 Win32 `CreateProcess` 的 32767），
  并按 24000 字符预算分块 —— **宁可多起一次 vite 也不许丢用例**（「少跑几条」的表现
  正是这一条事故本身）。vitest 入口走 `require.resolve("vitest/package.json")` +
  `bin.vitest` 解析，不写死 `node_modules/vitest/…`（pnpm 布局下顶层只是链接）。
  `--maxWorkers=4` 这个钩子档常数一起搬进脚本，钩子那行 shell 不再拼清单。

## Added

- `tests/hook-affected-launch.test.ts`（固定守护清单 19 → 20）：分块后**并集等于输入且
  顺序不变**、每块都在命令行长预算内（单条路径就超预算时点名红，不许静默跳过）、
  启动器没有 `shell: true` 也不出现 `pnpm exec vitest` / `npx vitest` 形态、
  `.githooks/pre-commit` 的 C 组确实指向这个入口。配合成旧写法的反证与
  「空清单必须被阻断」（空参数会让 `vitest run` 跑成全量）。
  C 组那条是**按 `run_group C … sh -c '<body>'` 解析实调用体**再断言，不是
  `toContain(文件名)`：机制说明里也写着同一个文件名，注掉执行行的话 `toContain` 照样命中 ——
  口径来自同批落地的 `tests/doc-check-hook-wiring.test.ts`（规范 §13.5.8「在场判据要解析」）。
  钩子里那句「D(N 个判据脚本)」由那份判据核与实际步骤数一致，本次改写 C 组注释时原样保留。

## Docs

- 台账新开 **E10**（门禁自己静默失效这一族：与本仓库反复记的「绿 ≠ 跑过」是同一族的
  两面 —— **红也 ≠ 跑过**）；规范 §13.5 的 C 组命令行与 §13.5.8 的并发/启动面段落同步。
