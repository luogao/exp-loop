import { describe, it, expect, vi } from "vitest";
import { createApiServer } from "../src/server.js";

describe("ApiServer", () => {
  it("dispatches to registered method handlers", async () => {
    const server = createApiServer();
    server.register("echo", async (params) => params);

    const response = await server.handleRequest({
      jsonrpc: "2.0",
      id: 1,
      method: "echo",
      params: { hello: "world" },
    });

    expect(response).toEqual({
      jsonrpc: "2.0",
      id: 1,
      result: { hello: "world" },
    });
  });

  it("returns method not found for unregistered methods", async () => {
    const server = createApiServer();

    const response = await server.handleRequest({
      jsonrpc: "2.0",
      id: 1,
      method: "nonexistent",
    });

    expect(response.error).toBeDefined();
    expect(response.error!.code).toBe(-32601);
    expect(response.error!.message).toContain("nonexistent");
  });

  it("catches handler errors and returns error response", async () => {
    const server = createApiServer();
    server.register("failing", async () => {
      throw new Error("intentional failure");
    });

    const response = await server.handleRequest({
      jsonrpc: "2.0",
      id: 1,
      method: "failing",
    });

    expect(response.error).toBeDefined();
    expect(response.error!.code).toBe(-32000);
    expect(response.error!.message).toBe("intentional failure");
  });

  it("passes emit function to handlers", async () => {
    const server = createApiServer();
    const notifications: unknown[] = [];

    server.setEmitter((notification) => {
      notifications.push(notification);
    });

    server.register("notify-test", async (_params, emit) => {
      emit("progress", { step: 1 });
      emit("progress", { step: 2 });
      return "done";
    });

    const response = await server.handleRequest({
      jsonrpc: "2.0",
      id: 1,
      method: "notify-test",
    });

    expect(response.result).toBe("done");
    expect(notifications).toHaveLength(2);
    expect(notifications[0]).toEqual({
      jsonrpc: "2.0",
      method: "progress",
      params: { step: 1 },
    });
  });

  it("defaults params to empty object when missing", async () => {
    const server = createApiServer();
    server.register("no-params", async (params) => {
      return { received: params };
    });

    const response = await server.handleRequest({
      jsonrpc: "2.0",
      id: 1,
      method: "no-params",
    });

    expect(response.result).toEqual({ received: {} });
  });

  it("lists registered methods", () => {
    const server = createApiServer();
    server.register("a.method", async () => null);
    server.register("b.method", async () => null);

    const methods = server.listMethods();
    expect(methods).toContain("a.method");
    expect(methods).toContain("b.method");
    expect(methods).toHaveLength(2);
  });

  it("preserves request id in response", async () => {
    const server = createApiServer();
    server.register("test", async () => "ok");

    const r1 = await server.handleRequest({ jsonrpc: "2.0", id: 42, method: "test" });
    expect(r1.id).toBe(42);

    const r2 = await server.handleRequest({ jsonrpc: "2.0", id: "abc", method: "test" });
    expect(r2.id).toBe("abc");
  });
});
