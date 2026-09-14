import { handleApi } from "@/server/api";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ segments: string[] }> };
async function handler(request: Request, context: Context) {
  return handleApi(request, (await context.params).segments);
}
export { handler as GET, handler as POST, handler as PATCH };
