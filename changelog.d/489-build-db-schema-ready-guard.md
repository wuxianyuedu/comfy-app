## Fixed

- **`next build` 在干净检出 / CI 上必挂的前置根因被堵住**：ComfyUI 孤儿任务回收（`src/lib/comfyui/reaper.ts`）是**模块级副作用**（`enqueue.ts` 用裸 `import "./reaper"` 挂到启动路径），它会随模块图在 `next build` 的 collect-page-data / prerender 阶段被加载——而干净检出的 `db.sqlite` 还没建（`pnpm db:push` 尚未执行），于是 build 期读库抛 `no such table: task` / `no such table: user`，Next 把它聚合进 collect-page-data 阶段错误，报错行号落在与该库无关的路由文件上，`pnpm build` 门禁长期红且把人引向错误方向。现在新增 `src/lib/db-schema-ready.ts`（只读探 `sqlite_master` 里哨兵表，结果三态 ready/missing/unknown 且同进程只探一次），reaper 在表未就绪时整轮跳过——回收是幂等且每 30s 重跑的，跳过只推迟一轮，不丢任何回收；「表存在但查询失败」这类真故障不在守卫内被吞，仍照原路径暴露。

## Security

- 无。

## 备注

- 本次只堵「读库把进程带崩」这一条。构建期还有两条独立缺陷未在本次处理（见 ISSUE #489 讨论）：`src/app/api/dev/build-id/route.ts` 与 `src/app/api/update-check/route.ts` 的 dynamic filesystem access 触发 Turbopack「追溯整个项目」告警（4 条），以及 `middleware` 文件约定在 Next 16 已废弃的迁移提示。
