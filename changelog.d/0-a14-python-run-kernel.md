## Fixed

- **台账 A14 收口：`/api/custom-nodes` 不再自写 Python 候选表，抽出一份可注入平台的内核
  `src/lib/process/python-run.ts`**（§18.4 三选一取 `import "server-only"`）。原状是三处字面量
  `["python3","python","py"]`（`runDiscover` / `runDiscoverStreaming` / `streamParse`）绕开了
  `python-candidates.ts` 那份判据，后果两条都落在 Windows 上：**顺序错**（判据给 Windows 的是
  `python → py → python3`）与**裸起 `py`**（不带 `-3` 的 `py` 语义是「列出已装版本」，
  不是「跑这个脚本」）。用户侧表现是设置页「扫描自定义节点」显示 0 个而界面一句原因都没有。
  内核收走三件跨调用点同形的事：`pythonAttempts()`（顺序 + 每候选 argv，转调判据）、
  `isInterpreterMiss()`（`ENOENT` 与退出码 127 **同因**）、`forEachOutputLine()`（两处孪生的
  按行切分合一，顺带把探测口缺的「`end` 时补发不足一行」补上 —— 解析器只在末尾打一次、
  不带换行的那行结果 JSON 过去会留在缓冲区里永远不解析）。
- **动手时照出两条比「顺序错」更硬的同族缺陷，都配了正面用例**：
  - **`error`(ENOENT) 之后真机还会再发一次 `close`**，而两个 `close` 分支原本没有「本档已交接」
    这一层：那个**压根没起来的进程**的 `close` 会先把「0 个节点」定成答案并置终态标志，
    后面**真跑成的那个候选被丢掉**。旧夹具在只给 `error` 时不发 `close`，所以这一形
    从来没有执行者（这才是 Windows 上「扫到 0 个」最直接的那条路径）。现在两条链各有一层
    `handedOff`，各有一条用例排的是 `error` + `closeCode: null` 那个真形状。
  - **解析口的退避边界写成 `i < length - 1`**（最后一个候选轮不到，那句「未找到 Python 解释器」
    因此不可达），且 `closed = true` 压在退避判断**之前**（一旦换档，下一档的 `close` 会在
    第一行守卫处返回，`done` 发不出来、流一直挂着）。现在数字边界整类消失：链的长度就是
    边界，越界由 `attempts.at(i)` 兜住；收尾标志只在「本次真要收尾」那一支里置。
- **判据的分层（这批的口径产出，登记进 13 章那份「唯一出处」清单）**：平台字面量只住在
  `python-run.test.ts` —— `platform` 是形参，所以 Windows 的「`python → py → python3`、
  只有 `py` 带 `-3`」与 POSIX 的「没有 `py` 也就多不出 `-3`」都能被正面断言（真机只有一个
  平台，靠默认值就只剩一半判据在跑）；调用点的用例一律取 `pythonCandidates()` 当期望，
  不抄第二份名字表 —— 路由与用例同时写死同一串字面量时，两边一起错也一起绿，
  那正是 A14 的成因本身。
- **变异四处，每处都有用例当场红**（打完逐字节还原，`md5sum -c` 自证）：路由退回自写候选表
  → 解析口四条含 `-3` 那条全红；`pythonProbeArgs` 去掉 `-3` → 内核与 `python-resolve`
  那侧共五条红；退避边界写回 `length - 1` → 「每个候选都起过」那条红；摘掉 `handedOff`
  守卫 → 两条 `error→close` 用例红。
- 顺带一处形状统一：探测口的 `stderr` 现在也按行切，一次多行警告不再挤成一条带换行的事件。
- 复算入口：`grep -c '"python3", "python", "py"' src/app/api/custom-nodes/route.ts` → 0、
  `grep -c pythonAttempts src/app/api/custom-nodes/route.ts` → 4；覆盖
  `pnpm exec vitest run --coverage --coverage.include='src/app/api/custom-nodes/route.ts' src/app/api/custom-nodes/route.test.ts`。
