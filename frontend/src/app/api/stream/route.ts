import { NextRequest } from "next/server";

export async function GET(request: NextRequest) {
  const backendUrl = process.env.BACKEND_INTERNAL_URL || "http://127.0.0.1:4103";
  const url = new URL(request.url);
  const target = `${backendUrl}/api/stream${url.search}`;

  const range = request.headers.get("range");
  const headers: Record<string, string> = {};
  if (range) {
    headers["range"] = range;
  }

  const res = await fetch(target, { headers });

  return new Response(res.body, {
    status: res.status,
    statusText: res.statusText,
    headers: res.headers,
  });
}
