import { timingSafeEqual } from "node:crypto";

import type { McpHttpAuthOptions } from "@invokta/mcp";

import { readMcpAuthToken } from "./config.js";

const expected = Buffer.from(readMcpAuthToken(), "utf8");

function matches(candidate: string): boolean {
  const supplied = Buffer.from(candidate, "utf8");
  if (supplied.length !== expected.length) return false;
  return timingSafeEqual(supplied, expected);
}

export const httpAuth = {
  mode: "required",
  authenticate(request) {
    const header = request.headers.get("authorization");
    if (header === null) return null;

    const match = /^Bearer ([^\s]+)$/iu.exec(header);
    const token = match?.[1];
    if (token === undefined || !matches(token)) return null;

    return { id: "deuxorders:partner" };
  },
} satisfies McpHttpAuthOptions;
