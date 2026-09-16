/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return */
/**
 * Lightweight markdown → safe HTML renderer for ComfyUI note bodies.
 *
 * Scope (just enough to make z_image_int8's `Note: Model Links` look right):
 *   - ## ### #### headings (h2 / h3 / h4)
 *   - fenced ``` blocks  → <pre><code>
 *   - inline `code`      → <code>
 *   - **bold**, *italic*, __under__
 *   - [text](url)        → <a href="…" target="_blank" rel="noreferrer">
 *   - - / * list items   → consecutive <li>, wrapped in <ul>
 *   - > blockquotes      → <blockquote>
 *   - horizontal rule --- / ***
 *   - GFM-style tables   → <table><thead>...<tbody>... — detected when a
 *     | ... | header line is followed by a | --- | --- | separator line.
 *   - whitelisted inline HTML: <br>, <b>, <strong>, <i>, <em>, <u>, <s>,
 *     <del>, <mark>, <small>, <sub>, <sup>, <kbd>.  Anything else (e.g.
 *     <script>, <iframe>, <a href="javascript:…">) stays escaped.
 *
 * Out of scope: images, footnotes, html passthrough, sub-lists, table
 * alignment via `:---:` / `---:` / `:---` (we always left-align).
 *
 * Output is XSS-safe: the entire input is HTML-escaped first, then we
 * splice in only the tags we generated (markdown + the whitelisted HTML
 * set).  Anchor hrefs are matched against an allow-list of URL schemes
 * (`http://`, `https://`, `mailto:`, `absolute-path or relative`).
 */

const HTML_ESCAPE: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

/** Escape any text destined for HTML output. */
function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (char) => HTML_ESCAPE[char] ?? char);
}

/** Validate a URL before emitting an <a href="…">.  Disallows javascript:
 *  and other executable schemes. */
function safeHref(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  // Allowed: http(s), mailto, relative/absolute paths
  if (/^(https?:|mailto:|\/|#)/i.test(trimmed)) return trimmed;
  // Bare hostname without scheme → treat as https
  if (/^[\w-]+(\.[\w-]+)+/.test(trimmed) && !/[\s"'<>]/.test(trimmed))
    return "https://" + trimmed;
  return null;
}

/** Render a single block of markdown text to sanitised HTML. */
export function markdownToHtml(text: string): string {
  if (!text) return "";
  const lines = text.replace(/\r\n?/g, "\n").split("\n");

  const out: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i]!;

    // Fenced code block (``` … ```)
    const fence = /^```/.exec(line);
    if (fence) {
      const code: string[] = [];
      i++;
      while (i < lines.length && !lines[i]!.startsWith("```")) {
        code.push(lines[i]!);
        i++;
      }
      i++; // skip closing ```
      out.push(
        `<pre style="background:var(--color-md-code-bg);border:1px solid var(--color-md-border);border-radius:4px;padding:6px 8px;margin:6px 0;overflow-x:auto;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:10.5px;line-height:1.45;"><code>${escapeHtml(
          code.join("\n"),
        )}</code></pre>`,
      );
      continue;
    }

    // Heading (#### h4, ### h3, ## h2)
    const heading = /^(#{1,4})\s+(.+?)\s*$/.exec(line);
    if (heading) {
      const level = heading[1]!.length;
      const txt = renderInline(escapeHtml(heading[2]!));
      const sizes = ["18px", "16px", "14px", "12.5px"];
      out.push(
        `<h${level + 1} style="font-weight:700;margin:8px 0 4px;font-size:${sizes[level - 1]!};color:var(--color-ink-bright);">${txt}</h${level + 1}>`,
      );
      i++;
      continue;
    }

    // Horizontal rule
    if (/^(\*\*\*|---|___)\s*$/.test(line)) {
      out.push(
        '<hr style="border:none;border-top:1px solid var(--color-md-border);margin:8px 0;">',
      );
      i++;
      continue;
    }

    // Blockquote: gather consecutive `> …` lines
    if (/^>\s?/.test(line)) {
      const body: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i]!)) {
        body.push(lines[i]!.replace(/^>\s?/, ""));
        i++;
      }
      out.push(
        `<blockquote style="border-left:3px solid var(--color-md-quote-border);padding:2px 0 2px 8px;margin:6px 0;color:var(--color-ink-soft);">${renderInline(
          escapeHtml(body.join("\n")),
        )}</blockquote>`,
      );
      continue;
    }

    // GFM table: a header row `| a | b | … |` immediately followed by a
    //  separator row `| --- | :--- | ---: | … |`.  We accept any line
    //  that contains at least one `|` and whose next line is a separator;
    //  the row before that line (if it also starts with `|`) is the
    //  header.  Body rows keep coming until a blank / non-pipe line.
    if (
      line.includes("|") &&
      i + 1 < lines.length &&
      isTableSeparator(lines[i + 1]!)
    ) {
      // Walk back to capture the header line, in case the caller's parser
      //  fed us a chunk that started mid-table.
      let headerIdx = i;
      while (
        headerIdx > 0 &&
        lines[headerIdx - 1]!.includes("|") &&
        !isTableSeparator(lines[headerIdx - 1]!)
      ) {
        headerIdx--;
      }
      const headerCells = splitRow(lines[headerIdx]!);
      const sepCells = splitRow(lines[headerIdx + 1]!);
      const bodyRows: string[][] = [];
      let j = headerIdx + 2;
      while (
        j < lines.length &&
        lines[j]!.includes("|") &&
        !isTableSeparator(lines[j]!)
      ) {
        bodyRows.push(splitRow(lines[j]!));
        j++;
      }
      out.push(renderTable(headerCells, bodyRows, sepCells));
      i = j;
      continue;
    }

    // Unordered list: gather consecutive `-` / `*` lines
    if (/^[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*]\s+/.test(lines[i]!)) {
        items.push(lines[i]!.replace(/^[-*]\s+/, ""));
        i++;
      }
      out.push(
        `<ul style="margin:4px 0 4px 18px;padding:0;list-style-type:disc;">${items
          .map(
            (it) =>
              `<li style="margin:2px 0;">${renderInline(escapeHtml(it))}</li>`,
          )
          .join("")}</ul>`,
      );
      continue;
    }

    // Empty line → paragraph break
    if (line.trim() === "") {
      i++;
      continue;
    }

    // Default paragraph — gather contiguous lines and inline-render
    const para: string[] = [];
    while (
      i < lines.length &&
      lines[i]!.trim() !== "" &&
      !/^(#{1,4}\s|```|>\s?|\*\*\*|---|___|[-*]\s+)/.test(lines[i]!) &&
      !(
        lines[i]!.includes("|") &&
        i + 1 < lines.length &&
        isTableSeparator(lines[i + 1]!)
      )
    ) {
      para.push(lines[i]!);
      i++;
    }
    out.push(
      `<p style="margin:4px 0;line-height:1.5;">${renderInline(escapeHtml(para.join("\n")))}</p>`,
    );
  }

  return out.join("");
}

/** Apply inline replacements (bold, italic, code, link, safe HTML) to an
 *  already escaped string.  Run AFTER escapeHtml so user input is XSS-safe;
 *  here we only recognise escaped markers of markdown / safe HTML that we
 *  know how to convert. */
function renderInline(escapedText: string): string {
  // 1) Inline code: `…` — 先整段替换掉，正文暂存进 `codeStash`，字面量里只留
  //   一个「数字 id」。这里的**关键前提是：本条替换是 `renderInline` 的第一步**，
  //   下面的安全 HTML / 链接 / 粗体 / 斜体 / 下划线都跑在它之后，因此它们那几组
  //   正则面对的是一份**已经没有反引号**的文本 —— 正文自己带的 `*` `_` `[` `&lt;`
  //   不会再被二次解释，这正是「` `<br>` ` 渲染成字面量 `<br>` 而不是真的换行」
  //   的成因。判据一句话：**「接下来跑的正则能不能看到代码正文」**。
  //
  //   历史上这里用 NUL（`\0`）把 id 包成 `\0CODE<n>\0`，理由是「没有别的正则
  //   会碰 NUL」。这理由站不住、代价却很大：源码里嵌一个真的 NUL 字节会让整个
  //   文件被 git / diff / grep / 大多数编辑器判成**二进制文件** —— `git diff`
  //   只回一句「Binary files differ」，评审看不到改动，`grep -rn` 直接跳过不搜。
  //   按「规则要机器可判」的口径，`<数字 id>` 与 NUL 是**同构**的：id 串里既没有
  //   反引号、也没有 `*` `_` `[` `&lt;`，上面那几组正则一个都命中不了。
  //   论证与门禁见 docs/standards/12-代码组织与文件结构.md §12.11。
  const codeStash: string[] = [];
  let text = escapedText.replace(/`([^`]+?)`/g, (_, c) => {
    const idx = codeStash.length;
    codeStash.push(
      `<code style="background:var(--color-md-inline-code-bg);border:1px solid var(--color-md-border);padding:0 3px;border-radius:3px;font-size:10px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;">${c}</code>`,
    );
    return `<${idx}>`;
  });

  // 2) Whitelisted inline HTML — runs only against the non-code text, so
  //   <br> typed in a note body becomes a real line break, while <br>
  //   captured inside backticks is untouched (it stays escaped).
  text = renderSafeInlineHtml(text);
  // 3) Links [text](url) — text in escaped form already has & etc.
  text = text.replace(/\[([^\]]+?)\]\(([^)\s]+)\)/g, (_, txt, url) => {
    const safe = safeHref(url);
    if (!safe) return txt;
    return `<a href="${escapeHtml(safe)}" target="_blank" rel="noreferrer" style="color:var(--color-md-link);text-decoration:underline;text-decoration-thickness:1px;text-underline-offset:2px;">${txt}</a>`;
  });
  // 4) Bold **…**  → <strong>
  text = text.replace(/\*\*([^*]+?)\*\*/g, "<strong>$1</strong>");
  // 5) Italic *…*  → <em>  (must not swallow pairs already consumed by bold)
  text = text.replace(/(^|[^*])\*([^*\n]+?)\*(?!\*)/g, "$1<em>$2</em>");
  // 6) Underline __…__
  text = text.replace(/__([^_]+?)__/g, "<u>$1</u>");
  // 7) Restore the stashed code spans.
  text = text.replace(/<(\d+)>/g, (_, idx) => codeStash[Number(idx)]!);
  return text;
}

/** Whitelisted inline-HTML elements we are willing to un-escape.
 *  Everything else (including <script>, <iframe>, <a>, <style>, on*=
 *  attributes, etc.) stays escaped.  Keys are the canonical tag name in
 *  lower-case; values are [openTag, closeTag] for wrapping tags, or a
 *  single-string sentinel for self-closing void elements. */
const SAFE_INLINE_HTML: Record<string, readonly [string, string] | string> = {
  br: "<br />", // void element — <br>, <br/>, <br /> all → <br />
  b: ["<b>", "</b>"],
  strong: ["<strong>", "</strong>"],
  i: ["<i>", "</i>"],
  em: ["<em>", "</em>"],
  u: ["<u>", "</u>"],
  s: ["<s>", "</s>"],
  del: ["<del>", "</del>"],
  mark: ["<mark>", "</mark>"],
  small: ["<small>", "</small>"],
  sub: ["<sub>", "</sub>"],
  sup: ["<sup>", "</sup>"],
  kbd: ["<kbd>", "</kbd>"],
};

/** Convert escaped (&lt;…&gt;) representations of whitelisted inline HTML
 *  back to real tags.  Runs AFTER escapeHtml, so the input contains
 *  `&lt;br&gt;` etc., not raw `<br>`.  Anything that isn't on the
 *  allow-list remains escaped, keeping the output XSS-safe. */
function renderSafeInlineHtml(escapedText: string): string {
  // Self-closing void elements first.  Match `<br>`, `<br/>`, `<br />`,

  //  and their uppercase variants — but only for tags in the allow-list.

  let text = escapedText.replace(
    /&lt;\s*([A-Za-z][A-Za-z0-9]*)\s*\/?\s*&gt;/g,

    (whole, tag) => {
      const key = tag.toLowerCase();

      const entry = SAFE_INLINE_HTML[key];

      if (typeof entry === "string") return entry; // self-closing

      return whole; // wrapping tag — handled by the next pass
    },
  );

  // Wrapping tags: <b>…</b>, <strong>…</strong>, <em>…</em>, etc.

  text = text.replace(
    /&lt;\s*(\/?)\s*([A-Za-z][A-Za-z0-9]*)\s*&gt;/g,

    (whole, slash, tag) => {
      const key = tag.toLowerCase();

      const entry = SAFE_INLINE_HTML[key];

      if (typeof entry !== "object") return whole; // not a wrapping tag we know

      return slash ? entry[1] : entry[0];
    },
  );

  return text;
}

/** Quick helper for callers: render as a string suitable for
 *  `dangerouslySetInnerHTML`. */
export function renderMarkdown(text: string): string {
  return markdownToHtml(text);
}

/* ──────────────────────────────────────────────────────────────────────
 * GFM table helpers
 * ────────────────────────────────────────────────────────────────────── */

/** A table separator line is `| --- | :--- | ---: | :---: | …` —
 *  one or more cells of dashes/colons separated by `|`.  We deliberately
 *  allow leading/trailing whitespace and arbitrary cell widths. */
function isTableSeparator(line: string): boolean {
  if (!line?.includes("|")) return false;
  const cells = splitRow(line);
  if (cells.length === 0) return false;
  return cells.every((cell) => /^:?-{3,}:?$/.test(cell.trim()));
}

/** Split a `| a | b | c |` row into cells.  Leading/trailing empty cells
 *  caused by surrounding pipes are dropped — this matches GFM behaviour
 *  (`|a|b|` → 2 cells, not 4). */
function splitRow(line: string): string[] {
  let trimmed = line.trim();
  // Strip a single leading and a single trailing pipe so the cell split
  //  doesn't yield phantom empty cells.
  if (trimmed.startsWith("|")) trimmed = trimmed.slice(1);
  if (trimmed.endsWith("|")) trimmed = trimmed.slice(0, -1);
  if (!trimmed) return [];
  return trimmed.split("|").map((col) => col.trim());
}

/** Render a parsed table to HTML.  Cell content still goes through
 *  `renderInline` so **bold**, `code`, [links] etc. work inside cells.
 *  We always left-align — alignment colons in the separator line are
 *  accepted for parsing compatibility but not honoured visually. */
function renderTable(
  headerCells: string[],
  bodyRows: string[][],
  sepCells: string[],
): string {
  const colCount = Math.max(
    headerCells.length,
    sepCells.length,
    ...bodyRows.map((bodyRow) => bodyRow.length),
  );
  const padCell = (c: string | undefined) => c ?? "";
  const head = headerCells
    .map(
      (headerCell) =>
        `<th style="padding:4px 8px;border:1px solid var(--color-md-border);background:var(--color-md-inline-code-bg);font-weight:600;color:var(--color-ink-bright);text-align:left;vertical-align:top;">${renderInline(escapeHtml(padCell(headerCell)))}</th>`,
    )
    .join("");
  const rows = bodyRows
    .map((row) => {
      const cells: string[] = [];
      for (let k = 0; k < colCount; k++) {
        cells.push(
          `<td style="padding:4px 8px;border:1px solid var(--color-md-border);color:var(--color-ink-subtle);text-align:left;vertical-align:top;">${renderInline(
            escapeHtml(padCell(row[k])),
          )}</td>`,
        );
      }
      return `<tr>${cells.join("")}</tr>`;
    })
    .join("");
  return (
    `<table style="border-collapse:collapse;margin:6px 0;width:100%;font-size:11px;line-height:1.45;">` +
    `<thead><tr>${head}</tr></thead>` +
    `<tbody>${rows}</tbody>` +
    `</table>`
  );
}
