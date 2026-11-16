## Fixed

- **后台 schema 同步自 #4111 起静默断链**（ISSUE #4144）：`spawnSchemaSync` 查找的仍是
  归家前的旧路径 `scripts/db-sync.mjs`，而脚本实际在 `scripts/db/db-sync.mjs` ——
  每次启动都打「找不到 scripts/db/db-sync.mjs」的 WARN，后台同步从未真正跑过，
  「拉了含 schema 变更的代码后不必记得跑 `pnpm db:push`」这条保证失效。
  根因是 #3958 归家靠兼容垫片维持旧路径可用，#4111 删垫片时漏了这处运行期
  路径拼接（`scripts/README.md` 点名的「分参 join 最容易被机器扫描漏掉」形态）。
  现已指向域目录新路径，并补两条 temp workspace 行为测试（有脚本 → started:true、
  没有 → started:false）钉住解析行为；桌包侧 `RUNTIME_SCRIPTS` 不含 db-sync
  （standalone 由 standalone-runtime 首启建表），行为不变。
