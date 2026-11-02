import { NextRequest } from "next/server";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const backendUrl = process.env.BACKEND_INTERNAL_URL || "http://127.0.0.1:4103";
  const { path } = await params;
  const target = `${backendUrl}/stream/subs/${path.join("/")}`;

  const res = await fetch(target);
  return new Response(res.body, {
    status: res.status,
    headers: {
      "Content-Type": "text/vtt; charset=utf-8",
    },
  });
}
