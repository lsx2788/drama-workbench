import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ChatMarkdown } from "../src/components/chat-markdown";

const render = (text: string) =>
  renderToStaticMarkup(createElement(ChatMarkdown, { text }));

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
