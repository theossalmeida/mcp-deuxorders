import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { readBackendConfig, readMcpAuthToken } from "../src/config.js";

const saved = { ...process.env };

beforeEach(() => {
  process.env["BACKEND_SERVICE_EMAIL"] = "mcp@deuxorders.test";
  process.env["BACKEND_SERVICE_PASSWORD"] = "placeholder";
  process.env["MCP_AUTH_TOKEN"] = "x".repeat(40);
});

afterEach(() => {
  process.env = { ...saved };
});

describe("backend configuration", () => {
  it("accepts the published address, which already carries the /api/v1 prefix", () => {
    process.env["BACKEND_URL"] = "https://deux-erp.deuxcerie.com.br/api/v1";
    expect(readBackendConfig().baseUrl).toBe("https://deux-erp.deuxcerie.com.br");
  });

  it("accepts the bare origin just the same", () => {
    process.env["BACKEND_URL"] = "https://deux-erp.deuxcerie.com.br/";
    expect(readBackendConfig().baseUrl).toBe("https://deux-erp.deuxcerie.com.br");
  });

  it("refuses an address that is not an absolute http url", () => {
    process.env["BACKEND_URL"] = "deux-erp.deuxcerie.com.br";
    expect(() => readBackendConfig()).toThrow(/absolute URL/u);
  });

  it("refuses to start without the backend credential", () => {
    process.env["BACKEND_URL"] = "https://deux-erp.deuxcerie.com.br";
    delete process.env["BACKEND_SERVICE_PASSWORD"];
    expect(() => readBackendConfig()).toThrow(/BACKEND_SERVICE_PASSWORD/u);
  });
});

describe("MCP auth token", () => {
  it("accepts a token long enough to be a real secret", () => {
    process.env["MCP_AUTH_TOKEN"] = "y".repeat(48);
    expect(readMcpAuthToken()).toHaveLength(48);
  });

  it("refuses a short token rather than serving with it", () => {
    process.env["MCP_AUTH_TOKEN"] = "too-short";
    expect(() => readMcpAuthToken()).toThrow(/at least 32 characters/u);
  });

  it("refuses an absent token", () => {
    delete process.env["MCP_AUTH_TOKEN"];
    expect(() => readMcpAuthToken()).toThrow(/MCP_AUTH_TOKEN/u);
  });
});
