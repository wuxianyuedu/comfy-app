#!/usr/bin/env python3
"""
parse_custom_nodes.py — Read-only AST parser for ComfyUI custom node packages.

Scans one or more directories of ComfyUI custom_nodes packages and extracts each
node class's interface (INPUT_TYPES / RETURN_TYPES / RETURN_NAMES / CATEGORY /
FUNCTION / OUTPUT_NODE / DESCRIPTION) using the Python `ast` module ONLY.

STRICT READ-ONLY GUARANTEE
  - This script NEVER imports, executes, or modifies any .py file under the
    scanned paths. It only reads source text and writes the resulting manifest
    to a SEPARATE output file (default: src/generated/customNodes.manifest.json).
  - It refuses to write the manifest inside any scanned source directory.
  - The custom_node source tree is treated as immutable input.

Usage:
  python3 scripts/parse_custom_nodes.py [--paths DIR1,DIR2] [--out PATH]
  python3 scripts/parse_custom_nodes.py --discover-parent DIR  (list subpackages)
  python3 scripts/parse_custom_nodes.py --only-pkgs A,B        (parse specific packages)
If --paths is omitted, the CUSTOM_NODES_PATH environment variable is used.
"""
import ast
import json
import os
import sys
import argparse
import datetime
import hashlib


# Directories that are never worth scanning (speeds up large custom_nodes trees
# and avoids scanning vendored submodules / git internals / AI-tooling scaffolding).
#
# `.agents` is the cross-tool 2026 convention (Claude / Cursor / Aider / Trae /
# Continue / Cody) for storing agent/test scripts. Files there can contain
# non-Python syntax (e.g. JavaScript inside Python triple-quoted strings used as
# pseudo-documentation) that the AST parser rightly rejects as SyntaxError. We
# never treat AI-tooling scaffolding as part of a custom node package, so it is
# always skipped — even if a project's AGENTS.md / .agents/ sit beside __init__.py.
SKIP_DIRS = {
    ".git", "__pycache__", "node_modules", ".venv", "venv", "env", ".env",
    "dist", "build", ".idea", ".vscode", ".github", "site-packages",
    # AI-tooling / agent scaffolding (not package source). These dirs are owned
    # by the developer's AI tool, not by the custom_node itself.
    ".agents", ".claude", ".trae", ".aider", ".continue", ".cody",
}


def log(msg):
    """Emit a progress line, flushed immediately (for live streaming).

    On Windows Python defaults the text-stream encoding to cp1252, so non-Latin
    characters get auto-escaped into raw codepoint form like the literal
    backslash-U sequence. We instead write UTF-8 bytes straight to stdout to
    avoid that rewrite and keep emoji / CJK readable in the live log.
    """
    sys.stdout.buffer.write((str(msg) + "\n").encode("utf-8", errors="replace"))
    sys.stdout.buffer.flush()


def log_stderr(msg):
    """Like log() but goes to stderr — also UTF-8 byte-mode so emoji survive."""
    sys.stderr.buffer.write((str(msg) + "\n").encode("utf-8", errors="replace"))
    sys.stderr.buffer.flush()


# Data types that map to an editable widget (vs. a pure connection port).
WIDGET_MAP = {
    "FLOAT": "number",
    "INT": "number",
    "STRING": "text",
    "BOOLEAN": "toggle",
    "COMBO": "select",
}


def eval_node(node, env):
    """Safely evaluate a limited subset of Python AST to literals/constants."""
    if node is None:
        return None
    if isinstance(node, ast.Constant):
        return node.value
    if isinstance(node, ast.Tuple):
        return tuple(eval_node(e, env) for e in node.elts)
    if isinstance(node, ast.List):
        return [eval_node(e, env) for e in node.elts]
    if isinstance(node, ast.Dict):
        keys = [eval_node(k, env) for k in node.keys]
        vals = [eval_node(v, env) for v in node.values]
        return dict(zip(keys, vals))
    if isinstance(node, ast.Name):
        return env.get(node.id)
    if isinstance(node, ast.Attribute):
        # e.g. cls.FOO or module.CONST -> try attribute name in env
        return env.get(node.attr)
    if isinstance(node, ast.BinOp) and isinstance(node.op, ast.Add):
        left = eval_node(node.left, env)
        right = eval_node(node.right, env)
        try:
            return left + right
        except TypeError:
            return None
    if isinstance(node, ast.UnaryOp) and isinstance(node.op, ast.USub):
        try:
            return -eval_node(node.operand, env)
        except TypeError:
            return None
    if isinstance(node, ast.Subscript):
        base = eval_node(node.value, env)
        sl = node.slice
        if isinstance(base, (list, tuple, dict)) and isinstance(sl, ast.Constant):
            try:
                return base[sl.value]
            except (KeyError, IndexError):
                return None
        return None
    # Unsupported node type — cannot statically evaluate.
    raise ValueError("unsupported ast node: %s" % type(node).__name__)


def module_env(tree):
    """Collect module-level simple constant assignments into an env dict."""
    env = {}
    for node in tree.body:
        if isinstance(node, ast.Assign) and len(node.targets) == 1 and isinstance(node.targets[0], ast.Name):
            try:
                env[node.targets[0].id] = eval_node(node.value, env)
            except Exception:
                pass
    return env


def class_env(classdef, mod_env):
    env = dict(mod_env)
    for node in classdef.body:
        if isinstance(node, ast.Assign) and len(node.targets) == 1 and isinstance(node.targets[0], ast.Name):
            try:
                env[node.targets[0].id] = eval_node(node.value, env)
            except Exception:
                pass
    return env


def find_input_types_method(classdef):
    for node in classdef.body:
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name == "INPUT_TYPES":
            return node
    return None


def extract_inputs(method, env):
    """Return list of {name, type, widget, options, default, required}.

    `method` is the INPUT_TYPES FunctionDef. We eval its return value ONCE via
    eval_node (which yields plain Python data), then process that data directly
    — it is no longer an AST node.
    """
    inputs = []
    if method is None:
        return inputs
    ret = None
    for stmt in method.body:
        if isinstance(stmt, ast.Return):
            ret = stmt.value
            break
    if ret is None:
        return inputs

    try:
        sections = eval_node(ret, env)
    except Exception:
        return inputs

    ordered = []
    if isinstance(sections, dict):
        for sec in ("required", "optional"):
            if sec in sections and isinstance(sections[sec], dict):
                ordered.append((sec == "required", sections[sec]))
        for k, v in sections.items():
            if k not in ("required", "optional") and isinstance(v, dict):
                ordered.append((False, v))
    elif isinstance(sections, (tuple, list)) and len(sections) >= 2:
        for idx, sec in enumerate(sections[:2]):
            if isinstance(sec, dict):
                ordered.append((idx == 0, sec))

    for required, secdict in ordered:
        if not isinstance(secdict, dict):
            continue
        for name, spec in secdict.items():
            # `spec` is already plain data (tuple/list), not an AST node.
            if isinstance(spec, (tuple, list)) and len(spec) >= 1:
                type_item = spec[0]
                params = spec[1] if len(spec) > 1 and isinstance(spec[1], dict) else {}
                if isinstance(type_item, (list, tuple)):
                    ctype = "COMBO"
                    options = list(type_item)
                else:
                    ctype = str(type_item)
                    options = None
                widget = WIDGET_MAP.get(ctype)
                default = params.get("default") if isinstance(params, dict) else None
            else:
                ctype, options, widget, default = "UNKNOWN", None, None, None
            inputs.append({
                "name": name,
                "type": ctype,
                "widget": widget,
                "options": options,
                "default": default,
                "required": required,
            })
    return inputs


def extract_outputs(classdef, env):
    outputs = []
    rts = env.get("RETURN_TYPES")
    rns = env.get("RETURN_NAMES")
    if isinstance(rts, (tuple, list)):
        for i, t in enumerate(rts):
            name = None
            if isinstance(rns, (tuple, list)) and i < len(rns):
                name = rns[i]
            if name is None:
                name = str(t)
            outputs.append({"type": str(t), "name": str(name)})
    return outputs


def parse_file(path, package_name=None):
    with open(path, "r", encoding="utf-8") as f:
        src = f.read()
    tree = ast.parse(src, filename=path)
    mod_env = module_env(tree)

    class_map = {}
    display_map = {}
    for node in tree.body:
        if not (isinstance(node, ast.Assign) and len(node.targets) == 1 and isinstance(node.targets[0], ast.Name)):
            continue
        tgt = node.targets[0].id
        if tgt == "NODE_DISPLAY_NAME_MAPPINGS":
            try:
                val = eval_node(node.value, mod_env)
                if isinstance(val, dict):
                    for k, v in val.items():
                        display_map[str(k)] = str(v)
            except Exception:
                pass
        elif tgt == "NODE_CLASS_MAPPINGS":
            # Values are class references (Name nodes), not strings.
            if isinstance(node.value, ast.Dict):
                for k, v in zip(node.value.keys, node.value.values):
                    if not isinstance(k, ast.Constant):
                        continue
                    if isinstance(v, ast.Name):
                        class_map[str(k.value)] = v.id
                    else:
                        try:
                            ev = eval_node(v, mod_env)
                            if isinstance(ev, str):
                                class_map[str(k.value)] = ev
                        except Exception:
                            pass

    classes = {n.name: n for n in tree.body if isinstance(n, ast.ClassDef)}
    results = {}

    def build_entry(class_type, classdef):
        cenv = class_env(classdef, mod_env)
        method = find_input_types_method(classdef)
        inputs = extract_inputs(method, cenv)
        outputs = extract_outputs(classdef, cenv)
        category = cenv.get("CATEGORY")
        if isinstance(category, str):
            category = category.split("/")[-1]
        description = cenv.get("DESCRIPTION")
        return {
            "classType": class_type,
            "displayName": display_map.get(class_type, class_type),
            "category": category or "custom",
            "outputNode": bool(cenv.get("OUTPUT_NODE", False)),
            # 纯前端节点（如 rgthree Bookmark）：properties.frontend_only === True，
            # 后端不执行。与 OUTPUT_NODE（终端节点，后端仍执行）是**两个不同概念**，
            # 切勿混为一谈（见 customNodes.ts 的 frontendOnly 字段）。
            "frontend_only": bool((cenv.get("properties") or {}).get("frontend_only", False)),
            "function": cenv.get("FUNCTION") if isinstance(cenv.get("FUNCTION"), str) else None,
            "description": description if isinstance(description, str) else None,
            "inputs": inputs,
            "outputs": outputs,
            "source": path,
            "package": package_name,
        }

    if class_map:
        for class_type, cls_name in class_map.items():
            if isinstance(cls_name, str) and cls_name in classes:
                results[class_type] = build_entry(class_type, classes[cls_name])
    else:
        for cname, cdef in classes.items():
            if find_input_types_method(cdef):
                results[cname] = build_entry(cname, cdef)

    return results


def write_manifest(manifest, out_path):
    out_abs = os.path.abspath(out_path)
    os.makedirs(os.path.dirname(out_abs), exist_ok=True)
    with open(out_abs, "w", encoding="utf-8") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=2)
    log("💾 已写入清单：%s" % out_abs)


def _walk_py_files(parent):
    """Yield (path, relpath) for every .py under `parent`, skipping junk dirs."""
    for root, dirs, files in os.walk(parent):
        dirs[:] = [x for x in dirs if x not in SKIP_DIRS]
        for fn in files:
            if fn.endswith(".py"):
                fp = os.path.join(root, fn)
                yield fp, os.path.relpath(fp, parent)


def _compute_content_hash(directory):
    """Stable short hash of a directory's Python source tree, used to detect
    on-disk changes between parses.

    The signature = sha256 over sorted lines of:
        `<relpath>\\t<mtime_ns>\\t<size>\\n`
    for every .py under the directory (skip_dirs excluded). Both `discover`
    and `_parse_directories` reuse this so the value they emit is comparable
    field-for-field.
    """
    h = hashlib.sha256()
    files = []
    try:
        for fp, rel in _walk_py_files(directory):
            try:
                st = os.stat(fp)
                files.append((rel, st.st_mtime_ns, st.st_size))
            except OSError:
                continue
    except (OSError, UnicodeError):
        return ""
    files.sort()
    for rel, mtime_ns, size in files:
        h.update(("%s\t%d\t%d\n" % (rel.replace("\\", "/"), mtime_ns, size)).encode("utf-8"))
    return h.hexdigest()[:16]


def _file_has_node_class_mappings(path):
    """Fast AST check: does this .py define NODE_CLASS_MAPPINGS at module level?"""
    import warnings
    try:
        with warnings.catch_warnings():
            # Suppress SyntaxWarnings from third-party packages so they don't
            # pollute the streamed log channel.
            warnings.simplefilter("ignore")
            with open(path, "r", encoding="utf-8") as f:
                tree = ast.parse(f.read(), filename=path)
    except (SyntaxError, UnicodeDecodeError, OSError):
        return False
    for node in tree.body:
        if isinstance(node, ast.Assign) and len(node.targets) == 1:
            tgt = node.targets[0]
            if isinstance(tgt, ast.Name) and tgt.id == "NODE_CLASS_MAPPINGS":
                return True
        if isinstance(node, ast.AnnAssign):
            tgt = node.target
            if isinstance(tgt, ast.Name) and tgt.id == "NODE_CLASS_MAPPINGS":
                return True
    return False


def discover_packages(parent_dirs):
    """For each parent directory, walk it and return a flat list of subpackages.

    A "subpackage" = a top-level subdirectory under the parent (immediate
    child only). We aggregate ALL Python files (recursively) under that child
    and report them under its name, so a package with internal subfolders
    (e.g. ``ComfyUI-DaSiWa-Nodes/nodes``) shows up ONCE under its top-level
    name, not as a separate entry per internal directory.

    Reads source files only — does not parse INPUT_TYPES, just a structural check.

    Emits progress lines (stdout) so the streaming API can forward them to the
    UI as a live progress bar. The two-phase model the UI cares about is
    packages, NOT a per-file count (scanned .py files have no upper bound
    until the walk ends, and that's not the info the user wants anyway):

      Phase 1 — SCAN: walk every .py under `parent`, group by top-level subdir.
        We don't know M (total subpackages) until the walk finishes. Each new
        subdir we discover emits `|discovered=N`; the UI counts up "已发现 N".
        The UI renders this phase as an indeterminate progress bar (CSS
        animation) since M is still unknown.

      Phase 2 — HASH: walk each discovered subdir and compute its content hash.
        M is now known. We emit `|done=K|total=M` per package so the UI can
        render a determined K/M bar and "🔎 正在处理 K/M · <name>".

    PROGRESS:: line format (parsed by the Next.js route):
      PROGRESS::scan|msg=...|discovered=N
      PROGRESS::scan|msg=...|total=M              ← end of file walk, announces M
      PROGRESS::hash|msg=...|done=K|total=M       ← per-package hash tick
      PROGRESS::hash|msg=...|done=M|total=M       ← all done
    """
    results = []
    for parent in parent_dirs:
        if not parent.strip():
            continue
        if not os.path.isdir(parent):
            results.append({"path": parent, "name": os.path.basename(parent) or parent, "parent": parent, "exists": False, "fileCount": 0, "packageFileCount": 0, "sizeBytes": 0, "contentHash": "", "status": "missing"})
            continue
        parent_abs = os.path.abspath(parent)
        log("PROGRESS::scan|📂 开始扫描 %s" % parent)

        # Walk all .py files recursively, but tag every file with its TOP-LEVEL
        # subdirectory under the parent — that's the unit of "subpackage" the UI shows.
        # Files in the parent root (not in any subdir) belong to a "__root__" bucket,
        # which we'll fall back to only if the parent itself is a package.
        by_topdir = {}  # key -> bucket
        py_total = 0
        for fp, _rel in _walk_py_files(parent):
            py_total += 1
            try:
                size_total = os.path.getsize(fp)
            except OSError:
                size_total = 0
            fp_abs = os.path.abspath(fp)
            fp_dir = os.path.dirname(fp_abs)

            # Determine the "top-level subdir" this file belongs to.
            rel = os.path.relpath(fp_dir, parent_abs)
            parts = rel.split(os.sep)
            if rel == "." or rel == "":
                # File is directly in the parent dir
                top_name = ""
            elif parts[0] in ("__pycache__",):
                continue
            else:
                top_name = parts[0]

            if top_name == "":
                key = "__root__"
                bucket = by_topdir.get(key)
                if bucket is None:
                    bucket = {"fileCount": 0, "packageFileCount": 0, "sizeBytes": 0, "path": parent_abs, "name": os.path.basename(parent_abs) or parent_abs}
                    by_topdir[key] = bucket
            else:
                top_abs = os.path.abspath(os.path.join(parent_abs, top_name))
                key = top_abs
                bucket = by_topdir.get(key)
                if bucket is None:
                    bucket = {"fileCount": 0, "packageFileCount": 0, "sizeBytes": 0, "path": top_abs, "name": top_name}
                    by_topdir[key] = bucket
                    # NEW subdir just discovered — emit the scan-phase tick so the
                    # UI can count up "已发现 N 个节点包". `py_total` is omitted from
                    # the message because it's the *cumulative* file walk count,
                    # which the user explicitly said they don't want to focus on.
                    log("PROGRESS::scan|msg=📦 发现 %s|discovered=%d" % (top_name, len(by_topdir)))

            is_pkg = _file_has_node_class_mappings(fp)
            bucket["fileCount"] += 1
            bucket["packageFileCount"] += 1 if is_pkg else 0
            bucket["sizeBytes"] += size_total

        # File walk done — announce the total M so the UI can switch to the
        # determined K/M bar in hash phase.
        total_discovered = len(by_topdir)
        log("PROGRESS::scan|msg=📐 共发现 %d 个节点包，准备逐个处理…|total=%d" % (total_discovered, total_discovered))

        # Emit one entry per top-level subdir (not the parent itself, not
        # internal subdirs of a package).
        # If the user-pointed parent IS itself a package (its root has NODE_CLASS_MAPPINGS,
        # like a repo cloned directly), fall back to emitting the parent.
        root_pkg = by_topdir.pop("__root__", None) if "__root__" in by_topdir else None
        if by_topdir:
            total = len(by_topdir)
            for i, (top_abs, info) in enumerate(sorted(by_topdir.items()), 1):
                # Per-package hash tick — drives the determined K/M bar.
                log("PROGRESS::hash|msg=🔎 正在处理 %d/%d · %s|done=%d|total=%d" % (i, total, info["name"], i, total))
                results.append({
                    "path": info["path"],
                    "name": info["name"],
                    "parent": parent_abs,
                    "exists": True,
                    "isLeaf": False,
                    "fileCount": info["fileCount"],
                    "packageFileCount": info["packageFileCount"],
                    "sizeBytes": info["sizeBytes"],
                    "contentHash": _compute_content_hash(info["path"]),
                    "status": "ok",
                })
        elif root_pkg and root_pkg["packageFileCount"] > 0:
            # The parent directory itself is a package (its root .py defines NODE_CLASS_MAPPINGS)
            log("PROGRESS::hash|msg=🔎 正在处理 1/1 · %s（叶子包）|done=1|total=1" % (os.path.basename(parent_abs) or parent_abs))
            results.append({
                "path": parent_abs,
                "name": os.path.basename(parent_abs) or parent_abs,
                "parent": parent_abs,
                "exists": True,
                "isLeaf": True,
                "fileCount": root_pkg["fileCount"],
                "packageFileCount": root_pkg["packageFileCount"],
                "sizeBytes": root_pkg["sizeBytes"],
                "contentHash": _compute_content_hash(parent_abs),
                "status": "ok",
            })
        else:
            results.append({
                "path": parent_abs,
                "name": os.path.basename(os.path.normpath(parent)) or parent,
                "parent": parent_abs,
                "exists": True,
                "isLeaf": True,
                "fileCount": py_total,
                "packageFileCount": 0,
                "sizeBytes": 0,
                "contentHash": "",
                "status": "empty",
            })
        # Final "all done for this parent" tick — caps the bar at 100%.
        log("PROGRESS::hash|msg=✔ %s 扫描完成：%d 个子包|done=%d|total=%d" % (os.path.basename(parent) or parent, len(results), len(results), len(results)))
    return results


def main():
    # Force UTF-8 on both streams so emoji / CJK characters survive streaming
    # without being repr()-escaped to "\Uxxxxxxxx" on Windows cp1252 stdout.
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, OSError):
        pass

    parser = argparse.ArgumentParser(description="Parse ComfyUI custom node packages (read-only AST).")
    parser.add_argument("--paths", help="Comma-separated directories to scan (full parse)")
    parser.add_argument("--only-pkgs", help="Comma-separated subpackage directory paths (subset parse, merge into existing manifest)")
    parser.add_argument("--out", default="src/generated/customNodes.manifest.json", help="Output manifest JSON path")
    parser.add_argument("--report-json", action="store_true", help="Print a structured per-package JSON report to stdout")
    parser.add_argument("--report-out", help="Also write the structured report JSON to this path")
    parser.add_argument("--discover-parent", action="append", default=[], help="List subpackages of this parent dir (may be passed multiple times)")
    args = parser.parse_args()

    # Mode 1: discover-only (no parse, no manifest write)
    if args.discover_parent:
        result = discover_packages(args.discover_parent)
        print(json.dumps({"ok": True, "mode": "discover", "packages": result}, ensure_ascii=False))
        return

    out_abs = os.path.abspath(args.out)

    # Mode 2: subset-parse (merge into existing manifest) — runs without --paths/env
    if args.only_pkgs:
        subset_dirs = [p.strip() for p in args.only_pkgs.split(",") if p.strip()]
        for d in subset_dirs:
            d_abs = os.path.abspath(d)
            if out_abs == d_abs or out_abs.startswith(d_abs + os.sep):
                log("[parse_custom_nodes] ERROR: refuse to write manifest inside scanned source dir: %s" % d)
                sys.exit(2)
        log("🔍 增量解析 %d 个指定包" % len(subset_dirs))
        nodes_added, errors_added, pkg_entries = _parse_directories(subset_dirs, label="子包")

        existing = {"sources": [], "packages": {}, "nodes": {}, "parseErrors": []}
        if os.path.exists(args.out):
            try:
                with open(args.out, "r", encoding="utf-8") as f:
                    existing = json.load(f)
            except Exception:
                pass
        # Drop nodes that re-belong to an updated package
        updated_keys = set(nodes_added.keys())
        existing["nodes"] = {k: v for k, v in (existing.get("nodes") or {}).items() if k not in updated_keys}
        existing_err_files = set(e.get("file") for e in errors_added)
        existing["parseErrors"] = [e for e in (existing.get("parseErrors") or []) if e.get("file") not in existing_err_files]
        existing["nodes"].update(nodes_added)
        existing["parseErrors"].extend(errors_added)
        existing_pkgs = existing.get("packages") or {}
        updated_paths = {os.path.abspath(d) for d in subset_dirs}
        for pn, pe in list(existing_pkgs.items()):
            if os.path.abspath(pe.get("path", "")) in updated_paths:
                del existing_pkgs[pn]
        existing_pkgs.update(pkg_entries)
        existing["packages"] = existing_pkgs
        existing["generatedAt"] = datetime.datetime.now().isoformat(timespec="seconds")
        # If subset dirs don't yet appear in `sources`, union them in
        src_set = set(existing.get("sources") or [])
        for d in subset_dirs:
            src_set.add(os.path.abspath(d))
        existing["sources"] = sorted(src_set)
        write_manifest(existing, args.out)
        report = {
            "generatedAt": existing["generatedAt"],
            "mode": "subset",
            "totalNodes": len(existing["nodes"]),
            "addedNodes": len(nodes_added),
            "errorCount": len(existing["parseErrors"]),
            "pathCount": len(subset_dirs),
            "packages": list(pkg_entries.values()),
        }
        if args.report_out:
            with open(args.report_out, "w", encoding="utf-8") as rf:
                json.dump(report, rf, ensure_ascii=False, indent=2)
        if args.report_json:
            print(json.dumps(report, ensure_ascii=False))
        log("✔ 子包解析完成：新增 %d 个节点类型，合计 %d 个" % (len(nodes_added), len(existing["nodes"])))
        return

    # Mode 3: full parse (clear, rebuild) — requires --paths or env
    raw_paths = args.paths or os.environ.get("CUSTOM_NODES_PATH", "")
    if not raw_paths.strip():
        print("[parse_custom_nodes] No --paths and no CUSTOM_NODES_PATH set; writing empty manifest.", file=sys.stderr)
        write_manifest({"generatedAt": "", "sources": [], "nodes": {}, "packages": {}, "parseErrors": []}, args.out)
        return

    scan_dirs = [p.strip() for p in raw_paths.split(",") if p.strip()]

    # READ-ONLY GUARD: never write the manifest inside a scanned source dir.
    for d in scan_dirs:
        d_abs = os.path.abspath(d)
        if out_abs == d_abs or out_abs.startswith(d_abs + os.sep):
            log("[parse_custom_nodes] ERROR: refuse to write manifest inside scanned source dir: %s" % d)
            sys.exit(2)

    start = datetime.datetime.now()
    log("🔍 开始解析，共 %d 个配置目录" % len(scan_dirs))

    # Discover subpackages under each parent first, then parse each top-level
    # subpackage as its own manifest entry. This keeps the manifest's `packages`
    # map at the same granularity as the UI's "discover" output, so hash
    # comparison (and "loaded / outdated / unimported" status) is per-package.
    pkg_paths = []
    for parent in scan_dirs:
        disc = discover_packages([parent])
        for d in disc:
            if d["status"] == "ok":
                pkg_paths.append(d["path"])
    pkg_paths = list(dict.fromkeys(pkg_paths))  # dedupe, preserve order
    log("📐 发现 %d 个顶层子包目录，准备逐个解析" % len(pkg_paths))
    added, errs, pkg_entries = _parse_directories(pkg_paths, label="子包")
    elapsed = (datetime.datetime.now() - start).total_seconds()
    manifest = {
        "generatedAt": datetime.datetime.now().isoformat(timespec="seconds"),
        "sources": scan_dirs,
        "packages": pkg_entries,
        "nodes": added,
        "parseErrors": errs,
    }
    write_manifest(manifest, args.out)
    log("✔ 解析完成：共 %d 个节点类型，耗时 %.1fs" % (len(added), elapsed))

    report = {
        "generatedAt": manifest["generatedAt"],
        "totalNodes": len(added),
        "pathCount": len(scan_dirs),
        "errorCount": len(errs),
        "packages": list(pkg_entries.values()),
        "parseErrors": errs,
    }
    if args.report_out:
        with open(args.report_out, "w", encoding="utf-8") as rf:
            json.dump(report, rf, ensure_ascii=False, indent=2)
    if args.report_json:
        print(json.dumps(report, ensure_ascii=False))


def _parse_directories(dirs, label="包"):
    """Parse a set of directory paths (each either a root or a leaf package).
    Returns (nodes_dict, errors_list, packages_dict)."""
    nodes = {}
    errors = []
    packages = {}
    for d in dirs:
        d = d.strip()
        if not d:
            continue
        if not os.path.isdir(d):
            log("⚠️ 目录不存在（已跳过）：%s" % d)
            packages[os.path.basename(os.path.normpath(d)) or d] = {
                "name": os.path.basename(os.path.normpath(d)) or d,
                "path": d,
                "nodeCount": 0,
                "nodeTypes": [],
                "status": "missing",
                "contentHash": "",
                "parsedAt": datetime.datetime.now().isoformat(timespec="seconds"),
            }
            continue
        pkg_name = os.path.basename(os.path.normpath(d)) or d
        pr = {"name": pkg_name, "path": d, "nodeCount": 0, "nodeTypes": [], "status": "ok", "errors": []}

        py_files = []
        for fp, _rel in _walk_py_files(d):
            py_files.append(fp)
        total = len(py_files)
        log("📦 %s：%s  (%s) — 发现 %d 个 .py 文件" % (label, pkg_name, d, total))

        for idx, fp in enumerate(py_files, 1):
            rel = os.path.relpath(fp, d)
            try:
                res = parse_file(fp, pkg_name)
                found = list(res.keys())
                for ct in found:
                    if ct in nodes:
                        log("  · 跳过重复 class_type：%s（保留首个）" % ct)
                        continue
                    nodes[ct] = res[ct]
                    pr["nodeCount"] += 1
                    pr["nodeTypes"].append(ct)
                suffix = ("  → " + ", ".join(found)) if found else ""
                log("· [%d/%d] %s%s" % (idx, total, rel, suffix))
            except SyntaxError as e:
                err = {"file": fp, "error": "SyntaxError: %s" % e, "package": pkg_name}
                errors.append(err)
                pr["errors"].append(err)
                # Errors go to stderr so the streaming API can mark them with
                # level="error" and the live console in the dialog renders them
                # in red instead of the default green info color.
                log_stderr("✗ [%d/%d] %s  SyntaxError: %s" % (idx, total, rel, e))
            except Exception as e:
                err = {"file": fp, "error": str(e), "package": pkg_name}
                errors.append(err)
                pr["errors"].append(err)
                log_stderr("✗ [%d/%d] %s  %s: %s" % (idx, total, rel, type(e).__name__, e))
        if pr["errors"]:
            pr["status"] = "error"
        log("  → %s %s 完成：%d 个节点类型" % (label, pkg_name, pr["nodeCount"]))
        # Stamp a content hash so the UI can detect later on-disk edits and
        # prompt the user to re-parse. Both `discover` and parse use the same
        # hash definition, so the values are directly comparable.
        pr["contentHash"] = _compute_content_hash(d)
        pr["parsedAt"] = datetime.datetime.now().isoformat(timespec="seconds")
        pr["parsedFileCount"] = total
        packages[pkg_name] = pr
    return nodes, errors, packages


if __name__ == "__main__":
    main()
