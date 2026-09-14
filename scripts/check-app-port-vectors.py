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

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import app_port  # noqa: E402


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
    if diffs:
        print("FAIL Python 侧与共享向量不一致：")
        for d in diffs:
            print("  - " + d)
        return 1
    print(f"OK Python 侧与共享向量一致（{len(vectors)} 条）")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
