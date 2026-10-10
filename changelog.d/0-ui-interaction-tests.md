## Added

- **`ui/dialog` / `ui/select` / `ui/tabs` 三份同名单测**（`src/components/ui/*.test.tsx`，共 29 条）。
  这是上一轮读数订正里写进契约的那格缺口 —— `docs/DESIGN.md` 的 Known Gaps 说「故事面全覆盖、
  缺口挪到了单元层」，而**故事不比断言**：这三件是「开合 / 定位 / 键盘」语义最重的浮层族基元，
  它们的正确形态此前只可能在 Storybook 里被眼睛看见。
  - `dialog`（12 条）：**自绘关闭却不传 `showCloseButton={false}` ⇒ 两枚 ✕ 重叠**（内置那枚
    带绝对定位、DOM 靠后，吃掉点击；两枚之间的间隙成了「点了没反应」的死区）；关闭与 Esc
    分别回传 `reason = "close-press" / "escape-key"`；`aria-labelledby → DialogTitle`、
    `aria-describedby → DialogDescription` 的关联（不是「凑巧 getByRole 找到了」）；
    内容在 body 的 Portal 里、打开时触发器被移出无障碍树；`sm:max-w-sm` 不许长回来（ISSUE #720
    的成因是它带变体、连调用处的宽度一起压）；`popupClassName` 与 `className` 同族时后者取胜。
  - `select`（8 条）：**层级必须给在 Positioner 上**（默认 `z-popup isolate`，
    `positionerClassName` 是**替换**而非并存 —— 两条 `z-*` 并存等于谁赢看产序）；
    `alignItemWithTrigger` 默认 `false`（base-ui 的原生默认 `true` 会让弹层随选中项漂出视口）；
    `SelectValue` 显示的是 **value 本身**而不是选项 children 的文案。
  - `tabs`（9 条）：`data-slot` 四枚与 `data-orientation` / `data-variant` 两根轴在位
    （下游样式与 `prefers-reduced-motion` 降级块都按这些名字找元素）；键盘是
    **manual activation**（方向键只移焦点、Enter 才换选中）；**非活动面板被卸载**
    （所以调用处不能把表单状态放在面板里）；两档形态互斥（`default` 药丸底 / `line` 透明底）。

## Fixed

- **`ui/dialog` 文件头那句「遮罩由基元的 Backdrop 负责」会被读成「本体自带遮罩」，实测不是**：
  `DialogContent` 只渲染 Portal + Popup，仓里**没有任何调用点**渲染 `DialogOverlay`
  （只有它的 story），所以弹窗背后那层变暗的遮罩今天**不存在**；关掉背景页面靠的是基元对
  「点到 Popup 之外」的判定（`reason = "outside-press"`）。同族的 `SheetContent` 恰恰自带
  `<SheetOverlay />` —— 两件同族、行为不同，靠读注释判不出来。本轮**不改渲染**（补遮罩会
  连带改掉 `top-title-bar` 让位那一组判据的适用面，属改外观、要另拍），只把现状钉进用例并
  写进 `docs/DESIGN.md`。

## 契约同步

- `docs/DESIGN.md` 的 Known Gaps：「55 个组件没有同名 `.test.tsx`」→ 实测 **52**，
  并把这三份用例各自钉住的、读源码看不出来的那几条写成一节。

## 验证

| 项 | 结果 |
| --- | --- |
| 三份新用例 | 29 passed（`vitest run` 逐份与合跑都是绿） |
| **变异复核**（四处） | 把 `alignItemWithTrigger` 默认改回 true / 把 `sm:max-w-sm` 加回来 / 把 `showCloseButton` 默认改成 false / 把 `tabs-trigger` 改名 ⇒ 各自让**对应那条**当场变红，改完 `git checkout` 还原、源码树干净 |
| 未被变异覆盖的断言 | `SelectValue` 显示 value、manual activation、面板卸载、本体无 Backdrop —— 这四条是**实测读回来的现状**，证明「今天长这样」，不证明「有人守着他不变」 |
| `tests/design-md-contract-sync.test.ts` | 13 passed |
| `pnpm doc:check` | ✓ |
| `tsc --noEmit` / `eslint` / `prettier --check` | 0 error / 0 warning / 干净（只点名本次三份新文件） |
| `.githooks/pre-commit` | 见下方提交 |

**边界**：本轮**没有**给其余 52 个组件补用例，也没新增判据或动棘轮基线。jsdom 不做布局，
所以「弹层有没有被顶出视口」「宽度实际是多少 px」这类结论仍只能由 e2e/像素那层给
（`e2e/visual/overlay.visual.spec.ts` 量的就是这两档宽度）。
