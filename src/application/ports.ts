export type QueryValue = string | number | boolean | undefined | null;

export interface BackendRequest {
  readonly method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  readonly path: string;
  readonly query?: Readonly<Record<string, QueryValue>>;
  readonly body?: unknown;
  readonly form?: Readonly<Record<string, QueryValue>>;
}

export interface BackendFile {
  readonly fileName: string;
  readonly contentType: string;
  readonly base64: string;
}

export interface BackendGateway {
  send<Result>(
    request: BackendRequest,
    options: { readonly signal: AbortSignal },
  ): Promise<Result>;

  download(
    request: BackendRequest,
    options: { readonly signal: AbortSignal },
  ): Promise<BackendFile>;
}
