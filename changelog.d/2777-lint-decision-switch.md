## Changed

- **lint 判决主体切到 oxlint（#2777 PR-B，仍不删依赖）**：`lint` 命令名与继承关系不变，
  内部改为 `pnpm run lint:oxlint && pnpm run lint:policy` —— oxlint 先判，eslint 只兜
  oxlint 没有等价实现的 16 条（两条 `no-restricted-syntax` 策略、`no-restricted-imports`、
  12 条 `react-hooks/*`、`react/no-deprecated`、`@next/next/no-location-assign-relative-destination`）。
- `eslint.config.js` 瘦成**策略配置**：不再展开 `eslint-config-next` 的规则面，不再挂
  `@eslint/js` / tseslint 预设 / unicorn / boundaries / unused-imports；`files` 只匹配 TS
  源码面（保留 `.storybook/**` 与 `*.config.ts` 两个显式盲区）。
- 64 处 lint 抑制指令迁移到 oxlint 等价写法（`react-hooks/*` → `react/*`、
  `@typescript-eslint/*` → `typescript/*`、`jsx-a11y/*` → `jsx_a11y/*`）；6 处属保留集
  的仍留在 eslint 侧，逐条列在 `log/tools/eslint-oxlint-parity.md` §10。
- 依赖点：`check-a11y-rules` 的生效表改读 oxlint 判决配置、`check-eslint-exemptions` 的
  台账来源改读 oxlint、canary 改起 oxlint 并按阳性对照重写、`check-comment-language` /
  `check-file-structure` 同时认 `oxlint-disable`。其余依赖点保持命令名「自动跟随」，
  逐条处置见台账 §11。
- 切换前后命中数：eslint 225 条规则 / oxlint 133 条 / eslint 策略 16 条，三者全仓命中均为 0；
  已知缺口（oxlint `unicorn/no-useless-length-check` 空实现、a11y options 未镜像）登记在台账 §13。
