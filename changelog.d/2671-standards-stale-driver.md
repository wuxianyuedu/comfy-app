## Fixed

- **新成员速读表把 dev-only 测试基建写成了运行时组件**（ISSUE #2671，P2）：
  `docs/standards/15-附录.md` 的技术栈表那格写着「数据层 | Drizzle ORM + better-sqlite3」。
  实测 `package.json`：`@libsql/client` 与 `drizzle-orm` 在 `dependencies`，
  `better-sqlite3`（连同 `@types/better-sqlite3`）在 **`devDependencies`** ——
  那格把一个只在跑测试的进程里被加载的包写成了运行时。
  现在改成「Drizzle ORM + `@libsql/client`（本地 `file:`）」，并按该表自己的口径补一句
  「驱动以 `src/server/db.ts` 的 import 为准」（这一形态不是新造的：旧版总规范 §2 那格
  早就是这么写的，只有附录这张表走偏了）。
- **两处「装依赖失败」排障条目教的是已经不存在的构建脚本**：`15-附录.md` §15.6 与
  旧版总规范 §11.3 都写着「`pnpm install` 走 `node-gyp rebuild` 编译 better-sqlite3，
  构建机缺 make/gcc/g++ 就失败 ⇒ 先 `apt-get install build-essential`」。
  与本仓自己的权威读数逐字互斥：规范 §6.1 记着 v13 删掉了
  `install: prebuild-install || node-gyp rebuild`、改成随包附带八个平台的 `prebuilds/*.node`，
  于是 `allowBuilds` 对它从 `true` 改成**显式 `false`** ⇒ **install 阶段没有可跑的构建脚本**；
  `docs/guides/sync-after-pull.md` 的 `allowBuilds` 那一行也写着同一句。
  两条都改成**今天真的会红的两族**：① `ERR_PNPM_IGNORED_BUILDS`（有包带构建脚本而
  `allowBuilds` 漏答 ⇒ 非交互 exit 1；修法是加条目，判据 `scripts/check-allow-builds.cjs`，
  口径 §13.5.15）；② `EPERM rename …@libsql/win32-x64-msvc/index.node`
  （dev server 还开着时补依赖，锁的是**运行时那份原生件**，出口 `pnpm deps:guard` /
  硬规则 9）。彻底重装的触发条件与命令**不重抄第二份**，只指向
  `docs/guides/sync-after-pull.md`。
  ⚠️ 没有把旧条目改写成「历史上曾经…」保留下来 —— 那正是 #2580 里被否掉的那类叙述：
  留着它，下一个人还是会照做并去装用不上的工具链。
- **扫过其余同类条目**（这两份文档里 `node-gyp` / `build-essential` / `base-devel` /
  编译工具链 的全部命中现在只剩「讲明别用它」的形状；全仓文档里剩下的 `node-gyp rebuild`
  两处分别是 `allowBuilds` 条目的正当说明与规范 §6.1 的读数本身）。
- **登记的回答**：`docs/reference-facts.md` §3.8 末尾补一段，回答「文档 ⇄ 文档互斥的说法
  要不要做成判据」—— 默认**不新写**，并把边界写成读数：把 #2580 那条判据放宽到认名字，
  当场把 `AGENTS.md` 硬规则 9 里那句「`better-sqlite3` 早已退成 dev-only 测试基建」念成红。
  要真做需要的是登记制（一个主题只许一份关键句出处，其余写引用）而不是扫描制，
  动手前得先量「现有文档里这种互斥命中多少、真违规占多少」（AGENTS 硬规则 24 末句 / 27 末段）。
  本单里 `doc:check` 与 `tests/check-doc-references.test.ts` 都绿 ——
  这两份文档互相矛盾而账面全绿，正是那条边界**已知不管**的那一半，不是「已经有人守着」。
  三份编辑文档的生成态镜像同批 `doc:render -- --only` 重渲染（没用全量档，
  免得一顺带代改别人留在 HEAD 上的陈旧镜像，#2527 那条口径）。
