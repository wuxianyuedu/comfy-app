## Changed

- **平台侧「单元测试」一步**临时停用**（`COMFYAPP_CI_DISABLED_GATES`，ISSUE #1959）**：
  宿主侧测试环境还没就绪（Windows 自托管节点上 Python 只进了 `yuedu` 会话、构建用的
  `NT AUTHORITY\SYSTEM` 账号够不着；另有一批真起子进程的用例在慢宿主上超预算），
  先把它摘掉让流水线能往下走，**等测试流程好了再加回来**。

  停用这件事有两半，**两半都不报错**（`.gates` 里把条目注释掉是 YAML 注释、从
  `COMFYAPP_CI_GATES` 摘名只是数组少一项）—— 于是「临时停用」与「永久删除」在配置里
  长得一模一样。所以补了第三个执行者 `env.COMFYAPP_CI_DISABLED_GATES`：被停用的
  stage 名清单。判据据此把三件事分开（都在 `tests/no-platform-ci-config.test.ts`）：

  | 形态 | 判据 |
  | --- | --- |
  | 不在 `GATES`、也不在 `DISABLED_GATES` | **删除**，当场点名（要拦的静默形态） |
  | 不在 `GATES`、但在 `DISABLED_GATES` | **停用**，放行；并要求 `.gates` 里留着它的**注释原文**（恢复有原文可依） |
  | 同时在两处 | 既跑又停，清单自相矛盾，当场点名 |

  跟着 stage 走的两条判据（顺序、`timeout` 预算）也按停用清单让步：条目不在
  `GATES` 里时不要求「排在 `Python 可用性` 之后」也不要求有预算；**恢复动作是把名字
  挪回 `GATES`、从 `DISABLED_GATES` 删掉**，那两条要求自动回来（不需要有人记得改判据）。

  **本地那一层一条都不动**：`.githooks/pre-commit` 与 `pnpm test` 照常跑单元测试 ——
  停用的只是自托管节点上的那一档，它是**环境**缺口（宿主没配好），不是判据有问题。
  两处新加的解析器（`registeredDisabledGates` / `stageKeptAsComment`）都带反向复算，
  把「停用 ≠ 删除」这条话变成能红的用例，而不是注释里的一句承诺。
