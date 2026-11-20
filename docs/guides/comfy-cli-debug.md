# comfy-cli 执行排障指南（v1.24+ 用法）

> 面向「工作流执行出错，要找原因」的场景。项目内的 comfy-cli 由
> `scripts/devtools/setup-comfy-cli-venv.mjs` 负责安装与升级（项目不 pin 版本，
> 默认每 24h 联网查一次最新版，`--force` 立即检查；环境前提与幂等口径见
> 启动与构建规范 §1.2）；执行链在 `src/lib/comfyui/executor-cli.ts`。

## 0. 先确认版本与升级状态

```bash
node scripts/devtools/setup-comfy-cli-venv.mjs          # 需要立即检查加 --force
```

- 读数位置：`run/comfy-cli-upgrade-check.json`（上次检查时刻 + 已装/最新版号）、
  `run/comfy-cli-setup.json`（本次进度相位）、`log/current/tools/comfy-cli-setup.log`
  （逐条日志）。
- 成功 / 跳过时控制台常无输出，结论以日志文件为准。

## 1. 应用内提交带了什么

每次经应用执行工作流，comfy-cli 的调用形如（完整命令行会打进任务执行日志）：

```text
<venv python> -m comfy_cli run --workflow <临时工作流文件> --json --wait
  --where local --host <host> --port <port> [--output-node-ids <id>]...
  --no-notify --timeout 600
```

- **不带 `--client-id`**（ISSUE #4599）：comfy-cli 1.26.0 起它按「借用的 client id」
  处理——本次运行的事件会定向给那个 client，`--wait` 下 cli 自己的 watcher socket
  收不到事件（静默挂到超时），因此 cli 拒绝两者同用（`client_id_rejected`）。
  ComfyUI 侧对账用 cli 在 `queued` 事件里回报的它自生成的 `client_id`：提交成功的
  日志行是「✓ comfy-cli 已提交（prompt_id: …，ComfyUI 侧 client_id: …）」，拿它比对
  `/queue`、`/history` 条目里的 client_id（extra_data）或服务端日志。
- **`--output-node-ids`**（v1.24.0，可重复）：部分执行——只跑指定输出节点及其
  依赖子图。工作流库「实际使用」页签的「调试：只跑到指定输出」勾选后由应用自动
  带上；勾选的是 comfy-cli **展开子图后**的节点 id（子图内部条目为
  `宿主id:内部id`，见 `workflow-io.ts` 的 `cliOutputNodeId`）。

## 2. 建议的排查顺序（针对「执行出错找原因费劲」）

1. **先静态校验**：`comfy validate --workflow wf.json` —— 先排结构 / 节点 /
   连线问题。v1.24/v1.25 已把大量不可达节点合并成一条 warning、并减少动态 combo
   陈旧连线的误报，输出比旧版聚焦。
2. **再二分执行**：`comfy run --workflow wf.json --output-node-ids <可疑输出>`
   只跑问题分支，逐步缩到最小可复现子图。注意：id 必须存在于工作流且是输出节点，
   否则提交前报 `invalid_output_node_ids`；云端 `--allow-spend` 仍按整张提交的图
   计费（服务端若忽略 targets 会跑全图）。
3. **看任务真实终态**：拿 prompt_id 用 `comfy jobs status|wait|watch` 判定是否
   完成、是否「完成但无可解析输出」（v1.24 起提示明确，不再笼统等待）。
   `state_file: null` 不代表提交失败——那是「本地 job-state 文件没写成」，以
   prompt_id 为准跟踪；可用 `LOG_LEVEL=DEBUG` 看写失败原因。
4. **要与会话对齐时**：拿任务日志「✓ comfy-cli 已提交」行里的 `ComfyUI 侧 client_id`
   与 `/queue`、`/history` 比对；手动复现时可自定 `comfy run --client-id <id>`（但
   1.26.0 起它不能与 `--wait` 同用，见上）。

## 3. 应用内的对应入口

- 工作流库 → 详情 →「实际使用」页签：勾「调试：只跑到指定输出」后点
  「▶ 用此工作流生成」。任务日志会多一行
  「部分执行：只跑输出节点 … 及其依赖子图（--output-node-ids）」。
- 执行日志（运行日志弹窗 / 「查看完整输出」）里有完整命令行与 comfy-cli 原始
  事件。出现 `partial_execution_targets_ignored` 事件说明服务端忽略了目标、按
  全图执行（云侧计费与耗时都按全图走），应用会以 warn 落出一行提醒。
- 排障时按「症状 → 已知根因」定位的入口仍是启动与构建规范 §5 排障手册；本指南
  只覆盖 comfy-cli 这一条执行链的用法。
