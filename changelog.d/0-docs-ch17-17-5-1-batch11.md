## Fixed

- **16 章「同一件事有几份实现」表里唯一没打删除线的那一行，写的其实是收口之前的账**：
  加载态那一行在 **「现状」** 列里写「`ui/skeleton.tsx` / `ui/progress.tsx`（均零引用）+
  17 个文件自写 spinner」，而第四列明写 ✅ **P3 判据清零** —— 同表其它已完成条目都用
  `~~删除线~~` 标着，只这一行漏了，于是它读起来像「这两个基元还欠接」。复算：
  `grep -rl "components/ui/skeleton\"" src` 有消费点、`progress` 也有、
  自写 spinner 现在只剩零星几处 `animate-spin`。改成删除线 + 一句「别当现状读」并留复算入口。
- **17 章 §17.5.1 那张「层 / 产物」表里两件已经不存在**：`ApiChannelSettings.tsx`（③ 视图）与
  `hooks/use-api-channel-settings.ts`（② 逻辑）都在 2026-09-14 随组件一起删除
  （`git show --stat 33c92af3` 两份都在里面），这一族现在只剩 ① 配置
  （`api-channel-settings-config.ts`）与 ② 网络（`lib/workshop/api-channel-client.ts`）。
  复算它俩的消费点：`grep -rl "api-channel-settings-config" src` **空**；
  `grep -rl "api-channel-client" src tests e2e` 只命中那份自己的测试。
  ⇒ 小节头加一条「这是**手法样板**，不是还有东西住着的落点」（`errorMessage` 第 6 份重复实现
  那两条教训仍然成立，所以整节留着）。
- **顺手把「§12.16 那道零消费硬闸为什么没拦下这两件」写进同一节**（口径逐字取自
  `scripts/check-dead-exports.cjs` 的头注，两张表都是判据本身）：`USAGE_ROOTS` =
  `src`/`scripts`/`e2e`（零引用即死）、`TEST_CONSUMER_EXT` = **与声明处同目录**的 `.test.ts`
  也算消费方 —— 所以 `api-channel-client.ts` 是靠自己的同目录测试过得去；而扫描面只覆盖
  `src/lib` 与 `src/trpc`，`src/components/**` **不在判据里** —— 那件 config 不是
  「判过了算活的」，是没被判。这条区分重要：「闸是绿的」与「这没人看」不是一回事。
- **17 章「关键路径提示」里 P3 那个文件名是归位之前的**：`useCustomNodesSettings.ts` 现在叫
  `workflow-library/CustomNodesSettings/hooks/use-custom-nodes-settings.ts`（`CustomNodesSettingsController`
  只在后者的同目录里活着）；`canvas-store.ts` 那半句对得上（`src/lib/project-canvas/canvas-store.ts`），
  没动。
- **判为不是缺陷、没动的**（同一条收紧后的探针扫出来的 364 条高信号命中里的一批）：
  `<feature>/<Name>.tsx` 那类尖括号占位形态；`hooks/use-training-studio.ts` 与 `use-studio.ts`
  两处句子自己就说「均已删」/「没有强行抽公共」；03 章「这 24 颗在 `src/**` 里的字面名提及 = 0 处」
  带着「把 `globals.css` 真编译一次实测」的日期语境，是当时那次测量的内容本身；
  16 章 1649 那行「七个文件各写一份」在 **「此前」** 列里；`docs/audits/**` 与
  `docs/superpowers/specs/**` 是带日期的过程文档，旧名字是它们的记录对象。
- 复算：`pnpm doc:check` 退 0、`pnpm doc:render` 后两份生成物与源同批；表格列数复量
  16 章 12 条 / 17 章 3 条 mismatch **与主干同集合同条数**（是单元格内含竖线的既有形态）。
  ⚠️ 本批自证一次：机械改 1248 那行时把行尾两列**复制了一份**（8 条竖线），是按
  「事后数竖线」这一步抓出来的，改回单行后为 5 条 = 4 列，与表头一致。
