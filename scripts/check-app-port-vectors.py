#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""端口推导的跨语言一致性自检（ISSUE #489 缺陷 4）。

读 `tests/fixtures/app-port-vectors.json`（与 Node / PowerShell / Rust 侧读
**同一份**），断言 Python 侧实现（scripts/app_port.py）对同一批 input→port
与其余三侧一致。任一侧漂移即退出码非 0。

用法：
    python3 scripts/check-app-port-vectors.py [向量文件路径]

被 Node 侧测试 `tests/app-port-cross-language.test.ts` 拉起，也可在 CI 直接跑。
"""

from __future__ import annotations

import json
import os
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import app_port  # noqa: E402

# `.env` 向量要在**临时目录**里造一份 .env 再读（走与生产同一条 read_env_port），
# 不能就地读仓库根的 .env —— 用例的可通过性只能取决于用例自己造的东西。
_TMP_ENV_DIR = tempfile.mkdtemp(prefix="app-port-env-")
_TMP_ENV_FILE = os.path.join(_TMP_ENV_DIR, ".env")


def main(argv: "list[str]") -> int:
    here = os.path.dirname(os.path.abspath(__file__))
    default_path = os.path.join(
        os.path.dirname(here), "tests", "fixtures", "app-port-vectors.json"
    )
    path = argv[1] if len(argv) > 1 else default_path
    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)
    vectors = data.get("vectors") or []
    if len(vectors) < 5:
        print(f"FAIL 向量不足（{len(vectors)} < 5）—— 防止误删后自检静默全绿")
        return 1
    diffs: "list[str]" = []
    for v in vectors:
        inp = v.get("input", "")
        norm = app_port.normalize_root_for_port(inp)
        if norm != v.get("normalized"):
            diffs.append(f"规范化 {inp!r}: {norm!r} != {v.get('normalized')!r}")
        fnv = app_port.fnv1a32(norm.encode("utf-8"))
        if fnv != v.get("fnv1a32"):
            diffs.append(f"FNV {inp!r}: {fnv} != {v.get('fnv1a32')}")
        port = app_port.derive_app_port(inp)
        if port != v.get("port"):
            diffs.append(f"端口 {inp!r}: {port} != {v.get('port')}")
    # `.env` 单值解析（ISSUE #821）：四侧对同一份 .env 必须得出同一个值。
    # 只测端口算法是不够的 —— 「壳必须自己读 .env」这条承诺落地在解析形态上，
    # 任一侧对「带引号 / 行尾注释 / 注释行」的理解不一致，用户写死的端口就只对
    # 一部分进程可见，剩下的按路径推导去等另一个端口。
    env_vectors = data.get("envVectors") or []
    if len(env_vectors) < 4:
        print(f"FAIL envVectors 不足（{len(env_vectors)} < 4）—— 防止误删后自检静默全绿")
        return 1
    for v in env_vectors:
        content = v.get("content", "")
        want = v.get("port")
        # 复用真实的 read_env_port：写一份临时 .env，走与生产同一条读取路径。
        with open(_TMP_ENV_FILE, "w", encoding="utf-8") as f:
            f.write(content)
        got = app_port.read_env_port(_TMP_ENV_DIR)
        if got != want:
            diffs.append(f".env 解析 {content!r}: {got} != {want}（{v.get('note', '')}）")

    if diffs:
        print("FAIL Python 侧与共享向量不一致：")
        for d in diffs:
            print("  - " + d)
        return 1
    print(f"OK Python 侧与共享向量一致（{len(vectors)} 条 + {len(env_vectors)} 条 .env 向量）")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
