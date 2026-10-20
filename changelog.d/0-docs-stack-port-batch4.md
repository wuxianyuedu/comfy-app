## Fixed

- **主规范 §1 的技术栈表与开发端口那两句**（这一族的查法：把文档里 `库名 + 版本号`
  的写法全抽出来，对 `package.json` 的声明与**实际解析到的版本**逐条复算）。
  - 「ORM | Drizzle ORM + better-sqlite3」—— 生产链路 import 的是 `@libsql/client`
    （`src/server/db.ts` / `src/server/workshop/db.ts` / `src/lib/comfyui/host-runtime.ts`），
    `better-sqlite3` 在 **devDependencies**、全仓唯一 import 点是 `tests/helpers/test-db.ts`。
    与根 README 那条是同一处病，改法同：驱动名删掉，写「服务端驱动以 `src/server/db.ts`
    的 import 为准」，**不换成新的硬编码**。
  - 「认证 | better-auth **1.3**」—— 声明 `^1.7.7`、装出来的也是 1.7.7。这张表其余各行的
    口径是**大版本**（`Next.js 16.3` / `tRPC 11` / `Tailwind CSS 4` / `@xyflow/react 12` /
    `zod 4` / `zustand 5` / `Tauri 2`），所以这里不补一个新的具体数，改成「版本以
    `package.json` 为准」。
  - 命令块里那句「`pnpm dev # 开发（Turbopack localhost:3100）`」删掉了端口 ——
    `pnpm dev` 监听的口由 `scripts/app-port.mjs` 按 `.env` 的 `COMFYAPP_PORT` → 检出路径
    推导，Node / PowerShell / Python / Rust 四侧同一套判据。
  - ⚠️ **「**开发端口**：dev server `localhost:3100`」这一行**不能删**，我先按
    AGENTS 那句「文档里不要写死 3100」把它改成不写数字，`tests/check-doc-references.test.ts`
    的「主规范『开发端口』行（comfyui.port 第二引用点）」当场红 —— 它逐字要求
    `dev server \`localhost:3100\`` 与 `:{{comfyui.port}}` 两个串都在。所以这是一处
    **刻意的例外**（保留静态链直观值 + 用占位符引第二处 ComfyUI 口），已恢复原句并在其后
    写清「这一行钉在哪条用例、`pnpm dev` 真正听的是推导口」。**口径**：AGENTS 的通则与
    一条钉死具体写法的用例同时存在时，改文前先跑那条用例，别按通则去删它钉的内容。
- ⚠️ **改的过程中撤掉一处我自己写错的修法**：先把静态链那句写成占位符 `{{dev.port}}`
  （看着最合规），但 `scripts/doc-facts.cjs` 的 FACTS 有**两种 kind**：
  `placeholder` 的会被 `render-doc-placeholders` 替换（`comfyui.port` 就是，生成态里
  它变成了 `:8188`），而 `dev.port` 的 kind 是 **`verify`** —— **只用来验裸值、不参与替换**，
  所以那个 `{{dev.port}}` 原样留在**读者看的那份产物**里。更阴的是这件事**没有判据会红**：
  `render-doc-placeholders --check` 比的是「生成态 == 源 + banner」，源里留着花括号、
  产物里也留着花括号 ⇒ 照样 `[ok]`。已退回成中文指路（写登记行在哪，不抄那个数）。
  **口径**：往 `docs/**` 里加占位符之前先确认那条 FACT 的 `kind` 是不是 `placeholder`；
  `pnpm doc:check` 绿不等于占位符会被替。
- **同批复算的负结果**（免得下一条以为这些格判过）：
  - 「语言 | TypeScript **7**（strict）」看着可疑 —— `package.json` 把 `typescript`
    映射成 `npm:@typescript/typescript6@^6.0.2`，名字里带 6。但**跑一下工具**：
    `pnpm exec tsc --version` = **7.0.2** ⇒ 那一行是对的，按包名别名去「修」它反而写错。
    钉死项与解析结果的配对由 `tests/turbopack-tracing-excludes.test.ts` 判。
  - `Next 16.3.2` / `Next 16.3.5`（现声明 `^16.3.8`）全部带「逐条实测」语境，是取样条件，
    **保留原数**；`pnpm 11 起不再剥离 --`、`React 18+ 不再告警`、`Tauri 2.11 起的 ACL`
    都是**阈值陈述**（「从某版起」），不是现状声明；`README` 里那句
    「`devUrl`（`localhost:3100`）只是编译期兜底、不参与主导航」用的是静态链 ⇒ 正确。
  - `docs/standards/11` / `12` 里的 `:3100` 是跨源机制与 `curl` 复现样例的**夹具值**，
    不是「开发服听哪个口」的陈述，没动。
- 遵循：AGENTS「强制先读」表的「跨平台行为 / 端口与文档」行（**在文档/README 里写具体
  端口号**是点名范围）、硬规则 2（钉死项以实测解析结果为准，不凭包名）、§12.12
  与 `docs/reference-facts.md` §1.1（含值事实只登记一处）。
- 复算：`pnpm doc:render` 后 `docs/generated/**` 与源同批（`render-doc-placeholders --check`
  ✓）、`check-doc-references.cjs` 退 0、`check-changelog-fragments` ✓、
  `tests/check-doc-references.test.ts` + `tests/docs-candidate-hygiene.test.ts` **全绿**
  （前者就是钉住「开发端口」那一行与 `:{{comfyui.port}}` 第二引用点的那份用例 —— 我第一版
  把它改红过，恢复后才绿）；`grep -c "{{dev.port}}"` 在源与生成态都是 **0**
  （这条是自证：上一版我引入的那个没被替换的占位符确实清掉了）。
