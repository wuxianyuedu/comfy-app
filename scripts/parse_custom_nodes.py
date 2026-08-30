#!/usr/bin/env python3
"""ComfyUI custom_nodes 只读解析器(供 /api/custom-nodes 调用)。

两种模式:

  发现模式(路由 L161/L220):
    python -u parse_custom_nodes.py --discover-parent <dir> [--discover-parent <dir2> ...]
    stdout: 每行 `PROGRESS::{...json}` 进度事件,最后一行 JSON:
      {"packages": [{"name": "<dirname>", "path": "<abspath>"}, ...]}
    「包」= 直接子目录且(直接或一层深处)含 .py 文件。

  解析模式(路由 L328):
    python -u parse_custom_nodes.py --out <manifest.json> --report-out <report.json>
                                    [--paths <dir,dir,...>] [--only-pkgs <a,b>]
    对 --paths 下每个包做只读解析:枚举 .py 文件、提取 NODE_CLASS_MAPPINGS 的
    节点类型名、逐文件 sha1 内容哈希;写 manifest(packages 为 name→info 映射)
    与 report(逐文件明细)。任何读取错误进 errors,不中断整体。

只读:绝不写包目录本身;manifest/report 只写路由指定的 --out/--report-out。
"""
import argparse
import hashlib
import json
import os
import re
import sys

SKIP_DIRS = {".git", "__pycache__", ".github", "node_modules", "venv", ".venv",
             "docs", "examples", "example", "tests", "web", "js", "ui"}



def datetime_now_iso():
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


NOW = datetime_now_iso


def emit_progress(**fields):
    """PROGRESS:: 行(ndjson 进度事件,路由逐行转发给 SSE)。"""
    payload = dict(fields)
    payload["type"] = "progress"
    sys.stdout.write("PROGRESS::" + json.dumps(payload, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def iter_py_files(root, depth_limit=2):
    """收集包内 .py 文件(跳过噪音目录;最多两层深,避免巨包拖慢)。"""
    out = []
    for entry in sorted(os.listdir(root)):
        full = os.path.join(root, entry)
        if os.path.isfile(full) and entry.lower().endswith(".py"):
            out.append(full)
        elif os.path.isdir(full) and entry not in SKIP_DIRS:
            try:
                for sub in sorted(os.listdir(full)):
                    sub_full = os.path.join(full, sub)
                    if os.path.isfile(sub_full) and sub.lower().endswith(".py"):
                        out.append(sub_full)
            except OSError:
                pass
    return out


def sha16(text):
    return hashlib.sha1(text.encode("utf-8", "replace")).hexdigest()[:16]


def extract_node_types(text):
    """从源码提取节点类型名:NODE_CLASS_MAPPINGS 字典的键(ComfyUI 惯例);
    无映射时回退 class 定义名。仅做行级正则,不 import(安全只读)。"""
    types = []
    in_mapping = False
    for line in text.splitlines():
        if re.search(r"NODE_CLASS_MAPPINGS\s*[:=]", line):
            in_mapping = True
            continue
        if in_mapping:
            if re.match(r"^\s*[}\]]?\s*$", line):
                in_mapping = False
                continue
            m = re.match(r"^\s*[\"']([^\"']+)[\"']\s*:", line)
            if m:
                types.append(m.group(1))
            continue
        m = re.match(r"^class\s+([A-Za-z_][A-Za-z0-9_]*)\s*[(:]", line)
        if m and not m.group(1).startswith("_"):
            types.append(m.group(1))
    return types


def discover_parent(parent):
    if not os.path.isdir(parent):
        emit_progress(parent=parent, phase="scan", msg="路径不存在", done=0, total=0)
        print(json.dumps({"packages": []}, ensure_ascii=False))
        return
    entries = sorted(e for e in os.listdir(parent)
                     if os.path.isdir(os.path.join(parent, e)) and e not in SKIP_DIRS)
    total = len(entries)
    packages = []
    for i, entry in enumerate(entries):
        full = os.path.join(parent, entry)
        has_py = any(f.lower().endswith(".py") for f in os.listdir(full)
                     if os.path.isfile(os.path.join(full, f)))
        emit_progress(parent=parent, phase="scan", msg=entry,
                      discovered=len(packages), done=i + 1, total=total)
        if has_py:
            packages.append({"name": entry, "path": full})
    emit_progress(parent=parent, phase="hash", msg="完成", done=total, total=total)
    print(json.dumps({"packages": packages}, ensure_ascii=False))
    sys.stdout.flush()


def parse_mode(out_path, report_path, paths, only_pkgs):
    only = {p.strip() for p in str(only_pkgs or "").split(",") if p.strip()} or None
    packages = {}
    report = {"generatedAt": NOW(), "paths": paths, "packages": []}
    for root in paths:
        if not os.path.isdir(root):
            emit_progress(phase="scan", msg="路径不存在:" + root, done=0, total=0)
            continue
        entries = sorted(e for e in os.listdir(root)
                         if os.path.isdir(os.path.join(root, e)) and e not in SKIP_DIRS)
        for i, entry in enumerate(entries):
            full = os.path.join(root, entry)
            if only and entry not in only:
                continue
            emit_progress(phase="scan", msg=entry, discovered=len(packages),
                          done=i + 1, total=len(entries))
            files = iter_py_files(full)
            if not files:
                continue
            node_types, errors, combined = [], [], []
            for f in files:
                try:
                    with open(f, "r", encoding="utf-8", errors="replace") as fh:
                        text = fh.read()
                except OSError as exc:
                    errors.append(str(exc))
                    continue
                combined.append(text)
                for t in extract_node_types(text):
                    if t not in node_types:
                        node_types.append(t)
            name = entry
            packages[name] = {
                "path": full,
                "nodeCount": len(node_types),
                "nodeTypes": node_types,
                "status": "errors" if errors else ("ok" if node_types else "empty"),
                "errors": errors,
                "contentHash": sha16("\n".join(combined)),
                "parsedAt": NOW(),
                "parsedFileCount": len(files),
            }
            report["packages"].append({
                "name": name, "path": full, "files": [os.path.basename(f) for f in files],
                "nodeCount": len(node_types), "errors": errors,
            })
    manifest = {"generatedAt": NOW(), "sources": paths, "packages": packages}
    os.makedirs(os.path.dirname(os.path.abspath(out_path)), exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as fh:
        json.dump(manifest, fh, ensure_ascii=False, indent=2)
    if report_path:
        os.makedirs(os.path.dirname(os.path.abspath(report_path)), exist_ok=True)
        with open(report_path, "w", encoding="utf-8") as fh:
            json.dump(report, fh, ensure_ascii=False, indent=2)
    print(json.dumps({"ok": True, "packages": sorted(packages.keys()),
                      "out": out_path}, ensure_ascii=False))
    sys.stdout.flush()


def main():
    ap = argparse.ArgumentParser(description="ComfyUI custom_nodes 只读解析器")
    ap.add_argument("--discover-parent", action="append", default=[])
    ap.add_argument("--out", default=None)
    ap.add_argument("--report-out", default=None)
    ap.add_argument("--paths", default="")
    ap.add_argument("--only-pkgs", default="")
    args = ap.parse_args()

    if args.discover_parent:
        for parent in args.discover_parent:
            discover_parent(parent)
        return
    if args.out:
        parse_mode(args.out, args.report_out,
                   [p for p in args.paths.split(",") if p.strip()], args.only_pkgs)
        return
    ap.print_help()


if __name__ == "__main__":
    main()
