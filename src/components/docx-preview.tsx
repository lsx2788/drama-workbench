"use client";
import { useEffect, useState } from "react";

/** Read-only, on-demand browser preview. Never writes extracted content to storage. */
export function DocxPreview({ url }: { url: string }) {
  const [html, setHtml] = useState<string>();
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    setHtml(undefined);
    setError("");
    async function load() {
      const [response, { default: mammoth }, { default: purify }] =
        await Promise.all([
          fetch(url, { signal: controller.signal }),
          import("mammoth"),
          import("dompurify"),
        ]);
      if (!response.ok) throw new Error("原文读取失败，请稍后重新打开。");
      const arrayBuffer = await response.arrayBuffer();
      if (controller.signal.aborted) return;
      const result = await mammoth.convertToHtml(
        { arrayBuffer },
        {
          externalFileAccess: false,
          includeEmbeddedStyleMap: false,
          convertImage: mammoth.images.imgElement(async (image) => {
            if (!/^image\/(png|jpeg|gif|webp)$/.test(image.contentType))
              return { src: "" };
            return {
              src: `data:${image.contentType};base64,${await image.readAsBase64String()}`,
            };
          }),
        },
      );
      if (controller.signal.aborted) return;
      // DOCX-generated HTML is untrusted: retain reading structure only, no
      // scripts, links, styles, IDs or external resources from the document.
      const fragment = purify.sanitize(result.value, {
        ALLOWED_TAGS: [
          "p",
          "br",
          "h1",
          "h2",
          "h3",
          "h4",
          "h5",
          "h6",
          "strong",
          "b",
          "em",
          "i",
          "u",
          "s",
          "sup",
          "sub",
          "ul",
          "ol",
          "li",
          "blockquote",
          "pre",
          "code",
          "hr",
          "table",
          "thead",
          "tbody",
          "tfoot",
          "tr",
          "td",
          "th",
          "img",
        ],
        ALLOWED_ATTR: ["src", "alt", "colspan", "rowspan", "start"],
        ALLOW_DATA_ATTR: false,
        ALLOW_ARIA_ATTR: false,
        RETURN_DOM_FRAGMENT: true,
      });
      for (const image of fragment.querySelectorAll("img")) {
        if (
          !/^data:image\/(png|jpeg|gif|webp);base64,[a-z0-9+/=\s]+$/i.test(
            image.getAttribute("src") || "",
          )
        ) {
          image.replaceWith(document.createTextNode("[此图片请下载原文查看]"));
        }
      }
      const container = document.createElement("div");
      container.append(fragment);
      setHtml(container.innerHTML);
    }
    load().catch((e) => {
      if (!controller.signal.aborted)
        setError(
          e instanceof Error && e.message.startsWith("原文读取")
            ? e.message
            : "暂时无法预览此 Word 文件，可下载原文查看，或重新上传有效的 DOCX 文件。",
        );
    });
    return () => controller.abort();
  }, [url]);

  if (error)
    return (
      <p className="error" role="alert">
        {error}
      </p>
    );
  if (html === undefined)
    return (
      <p className="muted" role="status">
        正在加载 Word 文档…
      </p>
    );
  if (!html.trim())
    return <p className="muted">文档没有可预览的正文，可下载原文查看。</p>;
  return (
    <>
      <p className="story-document-note">阅读预览，原始排版请下载查看。</p>
      <div
        className="story-document-content"
        aria-label="Word 文档正文"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </>
  );
}
