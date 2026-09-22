export async function downloadResourcePackage(
  projectId: string,
  shotIds: string[],
  version: number,
) {
  const response = await fetch("/api/studio/export", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ projectId, shotIds, version }),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || "导出失败，请检查网络后重试");
  }
  if (!response.headers.get("content-type")?.includes("application/zip"))
    throw new Error("未收到资源包，请检查登录状态后重试");
  const blob = await response.blob();
  const filename = response.headers
    .get("content-disposition")
    ?.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  const url = URL.createObjectURL(blob),
    anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename
    ? decodeURIComponent(filename)
    : "视频制作资源.zip";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
