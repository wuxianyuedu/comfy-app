## Fixed

- **16 章那张 token 表里「`--sidebar*` 零引用」是错的，而且是会伤人的那种错**：
  `src/components/ui/sidebar.tsx` 在 `hover:bg-sidebar-accent` / `active:bg-sidebar-accent` /
  `text-sidebar-accent-foreground` 上**就在用这一档**，同文件 546 行还登记着 ISSUE #1291
  「此前悬停与选中**共用同一档底色**（`--sidebar-accent`）」——它不但有消费点，还是被专门
  拆开的那一档。`--sidebar` 基色同样由该文件的 `bg-sidebar` 一族 utility 消费。
  照「零引用」去动它 = 静默改坏侧栏按钮的悬停与选中态。两行都改成点名调用处 + 给复算入口
  （`grep -c "bg-sidebar\b" src/components/ui/sidebar.tsx`）。
- **`~/lib/reentrancy-lock.ts` 这个路径不存在**：`EXEMPT_FILES.P66` 那条豁免的 `re`
  逐字写的是 `^src/components/ui/use-reentrancy-lock\.ts$`（表在
  `scripts/ui-primitives-exempt-files.cjs`，由 `check-ui-primitives.cjs` 读）。文档把落点
  放进了 `lib/`，照那句话去 lib 找会一无所获。改成真实路径并点名那张表。
- **`setBodyEl` 这个符号在树上 0 命中，而它所在那段把它当现行口径写**。现状是虚拟化那轮
  （07 §7.28）把这一层重写进 `use-log-panel-pin.ts`：该文件文件头两处明写「这里只读写 ref，
  不用 state」，元素由父组件持有的 `bodyRef` 给出、`el.clientHeight` 在取到元素的时刻现取
  现量；进 state 的只有**滚动位置**（那里的理由与本条同源：「滚动位置是渲染输入，只读 ref
  会出现滚了但不重渲染」）。⇒ 口径改写成「量测必须发生在拿到元素的那一刻」，并明写
  「复算这一层别去找 `setBodyEl`」。
- **两处存量计数换成复算入口**：`scroll-area` 那行的「全库 54 个文件在用
  `overflow-y-auto`/`overflow-auto`」「5 个组件另加自绘滚动条」实测是 **68** 与 **15**
  （2026-10-21），且后半句「这 5 处全部持有滚动容器的 ref」跟着改成「那几处」——
  计数留在文档里就是第二个会脱钩的事实来源，同 §7.20 那批一个成因。
- **6191 那句「底层 `@base-ui/react` 已导出 `Form`（`onFormSubmit`、`validationMode`）与
  `Field` 原语」补一条边界**：它讲的是**库里有什么**，而且经查是真的 ——
  `node_modules/@base-ui/react@1.8.0` 的 `form/Form.d.ts` 里 `onFormSubmit` 与
  `validationMode` 都在、同级有 `field/` 目录；**但本仓那份 `form-rhf.tsx` 一个都没用**
  （全部 import 只有 `react` / `react-hook-form` / `cn` / `~/components/ui/label`）。
  这与批 9 修的 6196 那条 checklist 是同一个错的两半：一处把库能力写成本仓事实，
  一处让人去文件里找 base-ui 的 import。
- **判为不是缺陷、没动的零命中**（同一条探针扫出来的，记下来免得下次再查一遍）：
  `computePos` / `ModalDialog` / `fmtBytes` / `formatSize` / `use-training-studio` 都在
  删除线或「已删掉过一次」的语境里（历史形态本身就是内容）；`TREE_GROUPS`（`SETTINGS_SECTION_GROUPS`
  改名后在场）、`SCROLLBAR_VISIBLE_CLASSES`、`INLINE_*`、`LogStoreScene`、`EXEMPT_FILES`
  逐个对上了；`readAsBinaryString` / `popstate` / `window.confirm` 是浏览器 API；
  `Radio.Root` 是 base-ui 的公开名（仓内以 `Radio as RadioPrimitive` 别名 import）。
  §16 里还剩 `getClassList()` 一处**指向本仓没有的能力**，但它写成「要不要为它立判据」的
  开放问题、没承诺现状，留在原位。
- 复算：`pnpm doc:check` 退 0、`pnpm doc:render` 后生成物与源同批；表格行按竖线数复量，
  16 章的 mismatch 从本批一度多出的 1 行（单元格里写 `grep` 的交替竖线）改成**不含竖线的写法**，
  最终 12 条与主干基线同集合同条数（那些是单元格内含竖线的既有形态，不是断行）；
  三条 grep 与一条 `ls node_modules/@base-ui/react/field` 全部实跑过。
