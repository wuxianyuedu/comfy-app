## Added

- 新增 P82 判据（棘轮）：**视图层 `<Button>` 用原生 `title=`**（应走 `~/components/ui/tooltip` 的 `<Tooltip>` + `<TooltipTrigger render={<Button …/>}>`）· shadcn `composition.md`。原生 `title=` 的三个短板：① 屏幕阅读器多数浏览器只读一次、且不参与 aria 关系（Chrome / Firefox 长期不一致，Safari VoiceOver 直接忽略）；② 显示延迟不可控、移动端不显示；③ 样式不能主题化（浏览器原生 tooltip 灰底、脱离设计 token 系统）。合规出口走 Base UI render prop 形态的 `<TooltipTrigger render={<Button … />}>`（项目已装 `ui/tooltip.tsx`）。
- 判据按形态取：`<Button(?=[\s/>])([^>]*)>` 抓开括号、里面命中 `\btitle\s*=` 即计一处。属性段用「不含 `>` 的连续字符」粗锚——`onClick={() => a > b}` 里那个 `>` 会让本判据早停、把该 Button 判为「没 title=」；这种漏计是安全的（棘轮只降不升、少计不假红、治理时人工复核覆盖到），比写平衡扫描更省心。
- 视图层实测 78 处 / 48 文件（跨 `components/studio/**` · `components/workshop/**` · `app/(main)/settings/**` 等，SelectedToolbar 单文件 7 处最集中）→ `--update` 冻结基线 78、只许降。
- 新增 4 处差分回归（`P82 单行 <Button title="x">` / `P82 多行 <Button\n title="…"\n>` / `P82 不误伤 <Tooltip render={<Button/>}>` / `P82 不误伤 <ButtonLink>`），总用例 307 → 311。

后续治理批次需要：① `<Button title="x">…</Button>` → `<Tooltip><TooltipTrigger render={<Button …/>}><x /></TooltipTrigger><TooltipContent>x</TooltipContent></Tooltip>`；② 若同族工具条反复出现该形态（`SelectedToolbar` / 画布节点工具栏 / 顶部工具条等），抽 `ToolbarButton` 或 `<IconButtonWithTooltip>` 做单一出口再谈升硬闸。
