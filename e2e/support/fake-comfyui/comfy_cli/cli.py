"""假 comfy-cli 的实现：解析 `run` 子命令，回放事件序列（说明见 `__init__.py`）。"""

import json
import os
import sys
import time
import urllib.error
import urllib.request

# 事件之间的小停顿：让「提交中 → 执行中 → 完成」分段可见，也让用例的中点
# 断言（RUNNING）有落脚的窗口。整体仍远小于任何超时。
STEP_DELAY_S = float(os.environ.get("E2E_FAKE_CLI_STEP_DELAY", "0.05"))
# 每个工作流轮次发出的节点数（progress 条的分子/分母都取它）。
NODE_COUNT = int(os.environ.get("E2E_FAKE_CLI_NODES", "3"))
# 失败模式的**触发面**：把本任务标记为「应失败」。取值不看具体字符串，
# 只看有没有 —— 用例传的就是自己造的哨兵词，这样「判据真的在判」可以
# 用一条变异（把哨兵从工作流里删掉 → 用例必须绿）来反证。
FAIL_SENTINEL = os.environ.get("E2E_FAKE_CLI_FAIL_SENTINEL", "")


def _emit(payload):
    """写一行 JSON 到 stdout 并立刻 flush。

    flush 是承重的：本应用给子进程设了 `PYTHONUNBUFFERED=1`，但那是在
    `executor-cli.ts` 里显式传给 Python 的**运行时**开关，替身不该依赖它
    而活着 —— 自己 flush 一次，行缓冲与块缓冲两种情形都对。
    """
    sys.stdout.write(json.dumps(payload, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def _parse_args(argv):
    """只认 `run` 子命令与它用到的那几个选项（其余原样忽略）。

    真 comfy-cli 的参数远比这多（`--where` / `--no-notify` / `--timeout` …），
    本应用传什么就得吃什么，所以**不校验未知参数**：多认一个名字就多一处
    与真件的契约漂移，而漂移在这条链路上的表现是「用例红了但看不出为什么」。
    """
    opts = {"workflow": None, "host": "127.0.0.1", "port": "8188"}
    i = 0
    while i < len(argv):
        arg = argv[i]
        for key, flag in (
            ("workflow", "--workflow"),
            ("host", "--host"),
            ("port", "--port"),
        ):
            if arg == flag and i + 1 < len(argv):
                opts[key] = argv[i + 1]
                i += 1
        i += 1
    return opts


def _read_workflow(path):
    """读工作流文件；没有文件时按空字串处理（失败模式要能在无图时也走通）。"""
    if not path:
        return ""
    try:
        with open(path, "r", encoding="utf-8") as handle:
            return handle.read()
    except OSError as err:
        print(f"[fake-comfy-cli] 读取工作流失败：{err}", file=sys.stderr)
        return ""


def _node_ids(workflow_text):
    """从图里取节点 id 列表，取不到就退回 1..N。

    真 comfy-cli 的进度是**按真节点**报的，替身照做：本应用拿 `progress` 事件里的
    node 去 `classTypeForNode(patched, nodeId)` 认类名，节点 id 对不上时那一格
    只是缺个类名、不影响收口 —— 所以这里尽力而为，不做硬校验。
    """
    try:
        graph = json.loads(workflow_text)
    except (ValueError, TypeError):
        return [str(n) for n in range(1, NODE_COUNT + 1)]
    nodes = graph.get("nodes") if isinstance(graph, dict) else None
    if isinstance(nodes, dict):
        ids = [str(k) for k in nodes.keys()]
    elif isinstance(nodes, list):
        ids = [str(n.get("id")) for n in nodes if isinstance(n, dict) and n.get("id") is not None]
    else:
        ids = []
    return ids or [str(n) for n in range(1, NODE_COUNT + 1)]


def _submit(prompt_id, host, port, workflow_text):
    """把提交动作打到假 ComfyUI 的 `/prompt`（真 comfy-cli 也走这个口）。

    打不通**不算失败**：本替身的存在意义是驱动本应用的执行器状态机，而那台
    HTTP 服务只负责让 `/history` 与 `/api/view` 有东西可回。少了这一步，
    链路照样能走完；把网络抖动升级成任务失败，只会让用例变成 flaky 的那一侧。
    """
    body = json.dumps({"prompt": workflow_text, "client_id": "e2e-fake-cli"}).encode("utf-8")
    req = urllib.request.Request(
        f"http://{host}:{port}/prompt",
        data=body,
        headers={"content-type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=5) as resp:
            resp.read()
    except (urllib.error.URLError, OSError):
        prompt_id = prompt_id  # 忽略：见上


def _run_success(prompt_id, node_ids):
    """成功序列：converted → queued → executing/progress → execution_success → executed → envelope。"""
    _emit({"type": "converted", "node_count": len(node_ids)})
    time.sleep(STEP_DELAY_S)
    _emit({"type": "queued", "prompt_id": prompt_id})
    time.sleep(STEP_DELAY_S)
    for index, node_id in enumerate(node_ids):
        _emit({"type": "executing", "node": node_id, "prompt_id": prompt_id})
        # 每个节点报两拍进度，让进度条真的动起来（客户端按 completed/total 算百分比）。
        for step in (1, 3):
            _emit(
                {
                    "type": "progress",
                    "node": node_id,
                    "prompt_id": prompt_id,
                    "value": step,
                    "max": 3,
                    "completed": step,
                    "total": 3,
                }
            )
            time.sleep(STEP_DELAY_S / 4)
        _emit({"type": "execution_success", "node": node_id, "prompt_id": prompt_id})
        time.sleep(STEP_DELAY_S / 4)
        if index == 0:
            # 首个节点就写 history：本应用收到 `envelope` 后立刻轮询
            # `/history/{prompt_id}`（HISTORY_RETRIES 次、固定间隔），产物必须先于
            # 收口信号就位 —— 否则就是「先广播完成、后写 history」那个真现象，
            # 替身里重现它只会让用例白等几轮。
            _record_history(prompt_id, node_id)
    _emit({"type": "executed", "prompt_id": prompt_id, "node": node_ids[-1]})
    time.sleep(STEP_DELAY_S)
    _emit({"type": "envelope", "ok": True, "prompt_id": prompt_id})
    time.sleep(STEP_DELAY_S)


def _record_history(prompt_id, node_id):
    """把产物登记到假 ComfyUI 的 history 里（HTTP 打不通就跳过，理由同 `_submit`）。"""
    host = os.environ.get("E2E_FAKE_COMFY_HOST", "127.0.0.1")
    port = os.environ.get("E2E_FAKE_COMFY_PORT", "8188")
    body = json.dumps(
        {
            "prompt_id": prompt_id,
            "node_id": node_id,
            "filename": f"e2e-{prompt_id}.png",
        }
    ).encode("utf-8")
    req = urllib.request.Request(
        f"http://{host}:{port}/e2e/record-history",
        data=body,
        headers={"content-type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=5) as resp:
            resp.read()
    except (urllib.error.URLError, OSError):
        pass


def _run_failure(prompt_id, message):
    """失败序列：queued 之后就报错，再由 envelope 收口（ok:false）。

    两条都发：`error` 事件在服务端只落一行 warn（`dispatchEvent` 的分支），
    真正把任务判成 FAILED 的是 **envelope.ok === false**。只发 error 不发
    envelope 的话，进程正常退出会被判成「未收到 envelope」—— 报错文案指向的是
    我们的进程，而不是失败原因，那正是验收标准 3 要避免的。
    """
    _emit({"type": "converted", "node_count": 1})
    time.sleep(STEP_DELAY_S)
    _emit({"type": "queued", "prompt_id": prompt_id})
    time.sleep(STEP_DELAY_S)
    _emit({"type": "error", "message": message, "prompt_id": prompt_id})
    time.sleep(STEP_DELAY_S)
    _emit({"type": "envelope", "ok": False, "error": {"message": message}})
    time.sleep(STEP_DELAY_S)


def main(argv):
    opts = _parse_args(argv)
    workflow_text = _read_workflow(opts["workflow"])
    # promptId 由替身生成（真 comfy-cli 从 /prompt 的响应里取）。取成 uuid 形状，
    # 让「谁生成的」在日志里一眼可辨。
    prompt_id = os.environ.get("E2E_FAKE_CLI_PROMPT_ID") or f"e2e-{os.getpid()}-{int(time.time() * 1000)}"

    _submit(prompt_id, opts["host"], opts["port"], workflow_text)

    if FAIL_SENTINEL and FAIL_SENTINEL in workflow_text:
        _run_failure(prompt_id, f"e2e 假 comfy-cli 按哨兵判定失败：{FAIL_SENTINEL}")
        return 0

    _run_success(prompt_id, _node_ids(workflow_text))
    return 0
