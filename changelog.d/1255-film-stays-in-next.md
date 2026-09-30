## Changed

- **成片编排迁进执行宿主这一格判为「不搬」并收口**（ISSUE #1255，P3 §5 ADR §11 那句「Phase 5 之后再评估」到此为止）。这条不是缺陷单，买的是「监看/合成跟着 Next 一起死」这个结构性限制本身；这次逐格复核之后前提不成立，两条实测：
  - 桌包里 server 退 ⇒ 宿主被整树收走。入口 `scripts/standalone-runtime.mjs` 把 server 与宿主作为同父兄弟各起一棵树，`server.on("exit")` 直接调 `close()`，而 `close()` 对宿主那棵树调 `reapTree(host.pid)`。所以「编排在宿主里 ⇒ Next 死了还能继续出片」在安装包里不成立。
  - 反向不对称，搬过去是**加**脆性：宿主自己退出时入口只打一行 `host exited`，**不降级、不重启**（那是 §17 的签字口径，理由是降级会让已写成 host 归属的行没人领）。影片推进交给宿主之后，宿主一退就没人继续推它，而界面照常活着 —— 今天「应用开着就一定活的那一个」是 Next。
  - dev 那一格（扛过一次重启）已经由 5-A 的 `resumeStalledFilms()` 补上，代价 = 一个重启间隔内不推进。

## Docs

- 上面那两条随后**补了真机读数**（载荷 = 检出外的安装目录形态，其中入口与宿主两份脚本与 master `cmp` 逐字节相同）：只杀 server 那棵树 ⇒ 入口打 `closing (server exited code=1)` 并紧跟 `reap pid=<宿主> taskkill …（exit 0）`，三个 pid 全没、入口随之退出；只杀宿主 ⇒ 入口只打一行 `host exited …（server 继续在跑…）`，`host pid=` 全程只出现 1 次（不重启），server 仍在服务、`/api/health` 回 `db:"up"`。ADR §23 里另记了一条**取数形状的坑**：先用 `Start-Process app.exe -WorkingDirectory <安装目录>` 起过一次，那份 `COMFY_EXECUTOR` 没传到壳、入口判成 `executor mode=inline`，所以改用载荷自己的 `node.exe` 直接起 `standalone-runtime.mjs`；「从桌面图标进去能不能把开关带进壳」那一格仍归 §3-D 的 env 继承口径，不由这次读数背书。
- ADR **§23** 记这次收口：两条实测的代码落点、**没做的事逐格留档**（film/production 仓储仍是 `import "server-only"` 的单例、宿主仍只有 task 一张片八条 seam、`tests/lib-server-imports.test.ts` 的 `REGISTERED` 仍是空清单、`db-schema-ready` 哨兵仍只判 `task`、ffmpeg 回收归属没动、跨进程触发契约没动 —— 最后这条最要紧，§14 D1 刚把派发收敛成一条 pull，影片搬过去就得再造第二条通道）、以及**什么条件下重开**（三条任一条成立才重估，别凭「ADR Phase 5 那行字面还没做」重开）。
- 顺带把 ADR 里那句「之后会搬」的旧口径改掉三处：文件头的范围行、§7 的 Phase 5 那一格、§11.1 与 §12 里「留到 Phase 5 film 侧再抽 relational→select/where 映射」那两格（film 侧不进宿主 ⇒ 那张映射表不再排期）。
- 订正一句上一刀的现状描述：§22 与 1257 碎片里写的「`--strict` 只剩工坊线 `workflow.ts`（944 行）超限」已经过时 —— 那条由工坊线自己的 `23bc80da` 收掉了，现在 `node scripts/check-file-structure.cjs --strict` 是 **[structure] OK**（零超限文件）。本刀没有为任何文件放宽判据或动基线。
