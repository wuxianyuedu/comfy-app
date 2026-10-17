## Added

- **「宿主是 Linux 容器」这条链路的跑法清单**（ISSUE #1993；规范
  `launch-and-build.md` 新增第 10 章）：用户在 #1993 里把前提纠正为「宿主机是 Windows，
  用 Docker 的 Linux 容器跑这条链路」。§9 只回答「宿主机直接就是 Linux」，而容器形态
  多出来的是**两个文件系统 / 两套网络 / 两套信任源** —— 那些坑一个都不在 §9 里。

  记下的五处闸门（每一条都对应一个会静默失败的形状）：`pnpm dev` 不带 `-H`
  而 `pnpm start` / 桌包链硬钉 `127.0.0.1`；端口按**检出路径**推导（容器与宿主的绝对
  路径不同 ⇒ 端口不同）；`allowedDevOrigins` 只放两个回环名（跨源访问时页面会自己
  反复整页重载）；`/api/console/run` 的回环闸（非回环 403 `remote-request`）；
  宿主侧 `localhost` 先解析成 `::1`。另记「数据库与 `data/` 按 `process.cwd()` 解析，
  必须同挂一个卷」，否则容器重建后是「页面 200、接口全 500」。

  同批写明两条**不成立**的期待：Linux 原生 Node 不会让门禁变快（墙钟是进程数 ×
  小文件数，见 §13.5.3.10），以及壳 / 打包**不能**容器化（产物是平台独占的）。

  判据 `tests/linux-container-runbook.test.ts` 读源码复算清单里的每一条断言
  （`dev.mjs` 的 `-H` 形态、`start` 回环、`app-port.mjs` 的推导、`next.config.js` 的
  `allowedDevOrigins` 白名单、四条自测命令真的在 `package.json` 与盘上）。

- **§10.2 补一笔「平台侧今天到底跑在哪台机上」的实况读数**：`pull_request` 事件的
  `pipelines[].labels` 是 `cpus=16, memory=31` + `ip: orange-connector`（自托管），
  而 `push` / `issue.comment@npc` 一类事件是 `ARCH=amd64, cpus=8, memory=16`（计费平台池）
  —— 同一份配置、两种机器，只有 `labels` 那一格能区分。
