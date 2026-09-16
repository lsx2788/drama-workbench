import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ChatMarkdown } from "../src/components/chat-markdown";

const render = (text: string) =>
  renderToStaticMarkup(createElement(ChatMarkdown, { text }));

test("multiple mentions retain their exact sentence positions, spacing, punctuation and repetitions", () => {
  const text = "先请@原作 AI 看看，再让@编剧 AI 整理，最后@原作 AI 核对。";
  const html = renderToStaticMarkup(
    createElement(ChatMarkdown, {
      text,
      mentionedNames: ["原作 AI", "编剧 AI"],
    }),
  );
  assert.match(
    html,
    /<p>先请<strong>@原作 AI<\/strong> 看看，再让<strong>@编剧 AI<\/strong> 整理，最后<strong>@原作 AI<\/strong> 核对。<\/p>/,
  );
  assert.equal(html.match(/@原作 AI/g)?.length, 2);
  const adjacent = renderToStaticMarkup(
    createElement(ChatMarkdown, {
      text: "请（＠原作 AI），@编剧 AI@原作 AI 一起看。",
      mentionedNames: ["原作 AI", "编剧 AI"],
    }),
  );
  assert.match(
    adjacent,
    /请（<strong>＠原作 AI<\/strong>），<strong>@编剧 AI<\/strong><strong>@原作 AI<\/strong> 一起看。/,
  );
});

test("verified group mentions appear bold inline once, without implicit recipient labels", () => {
  const message = "@原作分析 AI 请先分析这个故事。";
  const renderMention = (text: string, mentionedNames: string[]) =>
    renderToStaticMarkup(createElement(ChatMarkdown, { text, mentionedNames }));
  const explicit = renderMention(message, ["原作分析 AI"]);
  assert.match(explicit, /<strong>@原作分析 AI<\/strong> 请先分析这个故事。/);
  assert.equal(explicit.match(/@原作分析 AI/g)?.length, 1);
  assert.equal(message, "@原作分析 AI 请先分析这个故事。");
  const delegated = renderMention("请先分析这个故事。", [
    "原作分析 AI",
    "原作分析 AI",
  ]);
  assert.match(
    delegated,
    /<p><strong>@原作分析 AI<\/strong> 请先分析这个故事。<\/p>/,
  );
  assert.doesNotMatch(render("下一步是什么？"), /@|发给总控|回复你|AI 协作/);
  const formatted = renderMention("**@原作分析 AI** 请分析。", ["原作分析 AI"]);
  assert.equal(formatted.match(/@原作分析 AI/g)?.length, 1);
  assert.doesNotMatch(formatted, /<strong><strong>/);
  const code = renderMention("`@原作分析 AI`\n\n### 请分析", ["原作分析 AI"]);
  assert.match(code, /<code>@原作分析 AI<\/code>/);
  assert.match(code, /<h3>请分析<\/h3>/);
  const unsafeName = renderMention("内容", ["<script>alert(1)</script>"]);
  assert.doesNotMatch(unsafeName, /<script>/);
  assert.match(unsafeName, /&lt;script&gt;/);
});

test("chat renders model markdown as structured headings, lists, tables and literal code", () => {
  const html = render(
    "### 已知条件\n\n- **风格**：真人影像\n- 竖屏 9:16\n\n| 集数 | 时长 |\n| --- | --- |\n| 1 | 30秒 |\n\n```html\n<script>example()</script>\n```\n\n[参考](https://example.com)",
  );
  assert.match(html, /<h3>已知条件<\/h3>/);
  assert.match(html, /<strong>风格<\/strong>/);
  assert.match(html, /<ul>/);
  assert.match(html, /<table>/);
  assert.match(html, /&lt;script&gt;example\(\)&lt;\/script&gt;/);
  assert.match(html, /rel="noopener noreferrer"/);
});

test("untrusted chat cannot inject HTML, script URLs, frames or automatically fetch markdown images", () => {
  const html = render(
    '<script>alert(1)</script>\n\n<iframe src="https://example.com"></iframe>\n\n[恶意](javascript:alert%281%29)\n\n![图片](https://example.com/tracker.png)\n\n<img src=x onerror=alert(1)>',
  );
  assert.doesNotMatch(html, /<script|<iframe|<img|href="javascript:/i);
  assert.match(html, /href="https:\/\/example.com\/tracker.png"/);
  assert.match(html, /&lt;script&gt;/);
});

test("Chinese bold ending in punctuation renders without adding spaces or changing code literals", () => {
  const html = render("- **原作内容：**云澜召剑起飞。\n\n`**原作内容：**云澜`");
  assert.match(html, /<strong>原作内容：<\/strong>云澜召剑起飞。/);
  assert.match(html, /<code>\*\*原作内容：\*\*云澜<\/code>/);
});
