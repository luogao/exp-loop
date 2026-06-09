export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: number | string;
  method: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number | string;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

export interface JsonRpcNotification {
  jsonrpc: "2.0";
  method: string;
  params: Record<string, unknown>;
}

export type Emitter = (method: string, params: Record<string, unknown>) => void;

export type MethodHandler = (
  params: Record<string, unknown>,
  emit: Emitter,
) => Promise<unknown>;

export class ApiServer {
  private methods = new Map<string, MethodHandler>();
  private emitFn: ((notification: JsonRpcNotification) => void) | null = null;

  register(method: string, handler: MethodHandler): void {
    this.methods.set(method, handler);
  }

  setEmitter(fn: (notification: JsonRpcNotification) => void): void {
    this.emitFn = fn;
  }

  async handleRequest(request: JsonRpcRequest): Promise<JsonRpcResponse> {
    const handler = this.methods.get(request.method);
    if (!handler) {
      return {
        jsonrpc: "2.0",
        id: request.id,
        error: { code: -32601, message: `Method not found: ${request.method}` },
      };
    }

    const emit: Emitter = (method, params) => {
      this.emitFn?.({ jsonrpc: "2.0", method, params });
    };

    try {
      const result = await handler(request.params ?? {}, emit);
      return { jsonrpc: "2.0", id: request.id, result };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        jsonrpc: "2.0",
        id: request.id,
        error: { code: -32000, message },
      };
    }
  }

  listMethods(): string[] {
    return [...this.methods.keys()];
  }
}

export function createApiServer(): ApiServer {
  return new ApiServer();
}
