import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { crc32 } from "node:zlib";
import { Store } from "../src/server/db";
import { createProjectWithCoordinator } from "../src/server/project-bootstrap";
import { importStory, storyFile } from "../src/server/story-service";
import { readDocument } from "../src/server/document-reader";

function zip(files: Record<string, string>) {
  const local: Buffer[] = [],
    central: Buffer[] = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const n = Buffer.from(name),
      b = Buffer.from(text),
      c = crc32(b);
    const h = Buffer.alloc(30);
    h.writeUInt32LE(0x04034b50);
    h.writeUInt16LE(20, 4);
    h.writeUInt32LE(c, 14);
    h.writeUInt32LE(b.length, 18);
    h.writeUInt32LE(b.length, 22);
    h.writeUInt16LE(n.length, 26);
    const d = Buffer.alloc(46);
    d.writeUInt32LE(0x02014b50);
    d.writeUInt16LE(20, 4);
    d.writeUInt16LE(20, 6);
    d.writeUInt32LE(c, 16);
    d.writeUInt32LE(b.length, 20);
    d.writeUInt32LE(b.length, 24);
    d.writeUInt16LE(n.length, 28);
    d.writeUInt32LE(offset, 42);
    local.push(h, n, b);
    central.push(d, n);
    offset += h.length + n.length + b.length;
  }
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(Buffer.concat(central).length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, ...central, end]);
}
function pdf() {
  const stream = "BT /F1 12 Tf 20 40 Td (Hello PDF story) Tj ET";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  ];
  let out = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((obj, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${obj}\nendobj\n`;
  });
  const start = out.length;
  out += `xref\n0 6\n0000000000 65535 f \n${offsets
    .slice(1)
    .map((n) => String(n).padStart(10, "0") + " 00000 n \n")
    .join("")}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${start}\n%%EOF`;
  return Buffer.from(out);
}
test("document extraction is explicit, range-bounded, project-scoped and never rewrites original PDF/DOCX", async (t) => {
  const root = mkdtempSync(path.join(tmpdir(), "drama-doc-")),
    s = new Store(root);
  t.after(() => {
    s.close();
    assert.ok(path.resolve(root).startsWith(path.resolve(tmpdir()) + path.sep));
    rmSync(root, { recursive: true, force: true });
  });
  const p = String(createProjectWithCoordinator(s, { name: "文档" }).id),
    other = String(createProjectWithCoordinator(s, { name: "另一项目" }).id);
  const docx = zip({
    "[Content_Types].xml":
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    "word/document.xml":
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>青禾与云笙在渡口相遇。</w:t></w:r></w:p></w:body></w:document>',
  });
  for (const [name, bytes] of [
    ["story.docx", docx],
    ["story.pdf", pdf()],
  ] as const) {
    const source = importStory(
      s,
      { source: "file", name, bytes, importKey: randomUUID() },
      p,
    ).story;
    const result = await readDocument(s, p, String(source.id), {
      start: 0,
      length: 5,
    });
    assert.equal(result.text.length, 5);
    assert.equal(result.hasMore, true);
    assert.equal(result.text, name.endsWith("docx") ? "青禾与云笙" : "Hello");
    assert.deepEqual(storyFile(s, p, String(source.id)).bytes, bytes);
    await assert.rejects(readDocument(s, other, String(source.id), {}));
    await assert.rejects(readDocument(s, p, String(source.id), { page: 2 }));
    await assert.rejects(
      readDocument(s, p, String(source.id), { length: 24001 }),
    );
  }
});
