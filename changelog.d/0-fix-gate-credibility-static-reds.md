## Fixed

- **修掉四条「与环境无关、任何机器都红」的门禁/测试漂移，让 `pnpm check:all` 的绿灯重新可信**：
  1. `tests/ps1-consistency.test.ts` 仍要求 `--max-warnings` 字面串出现在 `quality-gate.ps1` / `.mjs` 里，但 lint 的参数早已按防漂移原则收进 `package.json` 的 `lint` 脚本、两侧门禁脚本只是 `pnpm run lint` 的委托方——改为核对委托命令一致，并把 `--max-warnings` 的生效校验挪到它真正所在的 `package.json`。
  2. `tests/win-job.test.ts` 头注把 Win32 API 名单用「 / 」断行，使 `AssignProcessToJobObject / …` 那行不含任何中文而被注释语言门禁判成英文行——分隔符改用中文顿号「、」（专有名词保留英文、排版也更规范）。
  3. `src/lib/core/errors.test.ts` 把 `ValidationError` 误列进「已删除、应零调用方」清单，但它实为活跃契约（`request-body.ts` 用作 §10.9 的 `errorResponse` 形态）——改归到「在用类必须有调用点」一侧。
  4. `src/components/ui/number-field.tsx` 的左对齐改动（提交 `8272024d`）漏更 `TrainingStudio` 快照导致渲染 diff 恒红——按当前源重生成快照。
