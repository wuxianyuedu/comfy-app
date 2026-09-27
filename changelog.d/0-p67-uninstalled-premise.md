## Fixed

- **P67 的「基元未装」旧前置全部作废并改正**（`check-ui-primitives.cjs`、
  `tests/check-ui-primitives.test.ts`）：`ui/empty.tsx` 与 `ui/field.tsx` 早就装上且被业务
  多处消费（`ComfyuiSection` / `ExitSection` / `UpdateCheckSection` / `RunControlBar` …），
  但注释与**给用户看的改法提示**还写着「Empty / Field 基元当前未装 →
  `pnpm dlx shadcn@latest add empty|field` 后再二次封装」。照做的人会白装一遍、
  或者以为这条判据还有「起点」可冻 —— 而 P67 现在已是硬闸、须为 0。
  提示改成指真出口：空态走 `ui/empty` 的 `<Empty>` 系（已成块的走 `ui/empty-state` 的
  `<EmptyState>`，那是 P75 的账），表单行走 `ui/field` 的 `<Field>` + FieldLabel /
  FieldDescription / FieldError，或直接用已经收好 ARIA 关联的 `ui/form-field`。
- **顺手钉掉一个错误的判据来源**：那句「未装」的依据是「`components.json` 里没有 empty」，
  而 `components.json` 只有 `aliases` / `registries` 这类**配置键，从不记录装过哪些组件** ——
  拿它当安装判据从写下那天起就不成立。判据改成看磁盘：`src/components/ui/<名字>.tsx`
  在不在。这类「凭一个不承载该语义的文件下结论」的形态，在提示文案与两处注释里都写明了。
