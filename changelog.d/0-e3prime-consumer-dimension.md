## Fixed

- **工坊的「风格卡」常年空态：它请求的 `/api/skills` 在这个仓库里不存在**（台账 E3′ 装机时照出来的第一条）。
  `src/components/workshop/hooks/use-workshop-pipeline-effects.ts` 首挂载的三路拉取里，这一路发的是
  `fetch("/api/skills")`，而 `src/app/api/skills/` 在基线迁移那次提交就没带过来（`git log --diff-filter=D` 可查）。
  失败形态不是报错而是**静默**：404 → 404 的 HTML → `res.json()` 抛 → 调用点一句 `catch {}` 吞成「没有技能」，
  于是风格卡下拉永远空、`pnpm test` 与 `pnpm check:all` 一路全绿。实测（本机 `next start` 起产物）：
  `GET /api/skills` → **404**，而同一条链上 `GET /api/trpc/project.list` → 200。
  - 修法 = 改吃**已经活着的那扇门**：新增 `fetchWorkshopStyles()`（`src/lib/workshop/generation-client.ts`），
    走 tRPC 的 `skill.list` —— 与成片工作室同一个入口，内置技能种子因此只有一份（`~/lib/skills-seed`，
    由 `skillRepository.ensureBuiltIns` 落库），不再在视图侧手拼查询串。
  - 顺带一条口径：畸形行**丢掉**而不是抛错。抛出去会被调用点吞成空列表，等于把「少一张卡」升级成
    「整块面板空白」，而那正是旧代码的失败形态。

## Removed

- **两条只有测试在调、界面从不引用的 tRPC 门收口到有人走的那一侧**（台账 E3′，§12.12 / §12.14）：
  - `src/server/api/routers/material.ts`（`material.list` / `save` / `delete` 三条 + 它那份 18 条用例）整块删除。
    素材库面板自始至终走 REST 的 `/api/materials`（`src/lib/media/materials-client.ts` 用 `fetch`），
    归属判据本来就在 `src/lib/media/materials.ts` 一处，REST 那 18 条（含「`mkdir`/`writeFile`/`unlink`
    一次都没发生」）继续判着同一套口径 —— **判据一条不减，面从两扇门收成一条**。
    `vitest.config.ts` 里素材那组从三条登记减成两条，注释留着「为什么少一条」。
  - `llm.complete` 删除：`/api/llm` 是活的 LLM 门（还多带流式与 tools），它身上那条
    「垃圾 `provider` 静默按 local 误路由」的枚举闸改由 `llm.configSave` 判住，并补一条
    `temperatureByTask` 非法键 → `BAD_REQUEST` 且不落库（反向验过：合法五键必须过、写入恰好一次）。
  - **收口当天覆盖率掉了一格，这条记下来不是因为修好了**：门删掉后 `src/lib/media/materials.ts`
    的分支覆盖从 80 → **78.43**（`check:all` 红在门槛上）。那些清洗与包含分支此前只被那扇门
    的用例顺带走过，而活着的 REST 门送进来的全是合法入参。补的是**判据层自己的用例**
    （`src/lib/media/materials.test.ts`）+ REST 一条「素材库根读不出来」，分支回到 100，
    门槛按实测抬上去（95/90/85/80 → 100/95/98/100）。

## Tests

- `tests/trpc-surface-executors.test.ts` 加了**第二个维度：消费方**，与执行者维度共用一份挂载面
  （`scanSurface()`，两处各扫各的会漂移成「两个维度认的不是同一张表」）。口径三条：
  ① 消费面 = `src/**` 的非测试代码且**先过 `stripComments`** —— 只有测试在调 = 零消费方（`material.*` 正是这个形状），
  注释里提一句也不算用它；② 认三种点名形态（`api.ns.proc`、`api.ns["proc"]`、`RouterInputs["ns"]["proc"]`），
  定义这条口的文件闭包不算它自己的消费方；③ `ZERO_CONSUMER` 登记表要求**双向不陈旧**
  （口没了登记还在 = 红；消费方接上了登记还在 = 红）、每条必须有像样的原因、长度进棘轮（只许降）。
  反向验证做过：摘掉 `train.detail` 的登记 → 主断言报 `['project.get', 'train.detail']`；
  把登记键改成不存在的 `project.gone` → 陈旧断言报「已经不存在，登记该删掉」。
- 登记在案的四条（**功能未接，不是判据缺失**）：`project.get` / `project.patch` / `skill.create` / `train.detail`，
  每条写明「谁将来接它」。
- `src/lib/workshop/generation-client.styles.test.ts`（5 条）：走的是 `skill.list`、字段收窄、
  `null` 与缺字段都归成 `undefined`、畸形行丢掉、口坏掉时把错误留给调用点。
  变异核过：把 `negativePrompt` 的收窄改成原样透传 → 恰好「null 归成 undefined」这一条红。
- `src/lib/media/materials.test.ts`（18 条，新增）+ `/api/materials` 补一条：清洗判据本身的
  每一种被拒形状（空 / 空白 / 129 字符 / `a/b` / `..\` / `..` / 点号）、`folderDir` 面对
  绕过上游校验的 `..` 必须判掉、目录列举里隐藏文件与子目录跳过、单条 stat 失败不拖垮整批、
  归属三态（`mine` / `foreign` / `unclaimed`）与跨项目聚合的「别人的一条都不出现」。
  每条用例一个独立临时根（第一版共用一份根，被 `listScopes()` 枚举到别人的目录坑过一次）。
  变异核过三条：去掉 scope 长度上限 → 恰好那条红；摘掉 `folderDir` 的包含断言 → 恰好 `..` 那条红；
  去掉隐藏文件跳过 → 恰好排序那组红（其余 36 条全绿）。

## Docs

- `src/server/api/root.ts` 的文件头从「登记即欠一个执行者」改成「登记即欠两样东西」（执行者 + 消费方），
  并把「别再为素材库补第二扇 tRPC 门」写在删除理由旁边。
- 台账 `docs/guides/PRODUCTION-GAPS.md`：E3′ 关闭（三类处置 + 反向验证），新开 **E3‴「客户端写的 REST 地址
  有 3 条真请求没有落点」**（实测 404；另有 1 条只是 URL 形状的 sessionStorage 键，真实请求走 tRPC）——
  `/api/skills` 已随批接上，`/api/images`、`/api/file/<name>` 两条代理 ComfyUI 媒体的地址仍是实测 404
  （同一族的修法与判据写在条目里）；A9 那条素材项的「判据」与「证据」两处引用同步改成一门。
- 规范 §11.2.1 新增一条口径「有执行者 ≠ 有消费方，同一份挂载面要判两维」；§16 那张 `normalizeNeedle`
  收口表里素材那行去掉已删除的 tRPC 文件；`docs/guides/TESTING.md` 的 router 段改成两维表述
  （13 个 router → 12，`material` 注明去哪了）。该清单开头那句「配套的九条」改成不带数字的说法 ——
  数字本身会漂（同族缺陷见 #1349 那条 `nav-items` 计数）。
