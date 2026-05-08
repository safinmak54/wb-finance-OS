import "server-only";

export type AdminApiErrorKind =
  | "config"
  | "auth"
  | "forbidden"
  | "rate_limited"
  | "network"
  | "shape"
  | "server";

export class AdminApiError extends Error {
  readonly kind: AdminApiErrorKind;
  readonly status: number | null;
  readonly bodySnippet: string | null;
  readonly userMessage: string;

  constructor(args: {
    kind: AdminApiErrorKind;
    message: string;
    userMessage?: string;
    status?: number | null;
    bodySnippet?: string | null;
  }) {
    super(args.message);
    this.name = "AdminApiError";
    this.kind = args.kind;
    this.status = args.status ?? null;
    this.bodySnippet = args.bodySnippet ?? null;
    this.userMessage = args.userMessage ?? args.message;
  }
}
