export interface RequestOptions {
  readonly userAgent: string;
}

export function buildHeaders(options: RequestOptions): Record<string, string> {
  return { "User-Agent": options.userAgent };
}
