export interface ToolResult {
  readonly output: string;
  readonly isError: boolean;
  readonly metadata: Readonly<Record<string, unknown>>;
}

export function createToolResult(args: {
  readonly output: string;
  readonly isError?: boolean;
  readonly metadata?: Readonly<Record<string, unknown>>;
}): ToolResult {
  return {
    output: args.output,
    isError: args.isError ?? false,
    metadata: { ...(args.metadata ?? {}) }
  };
}

export function createToolErrorResult(
  output: string,
  metadata?: Readonly<Record<string, unknown>>
): ToolResult {
  if (metadata === undefined) {
    return createToolResult({
      output,
      isError: true
    });
  }

  return createToolResult({
    output,
    isError: true,
    metadata
  });
}

export function normalizeToolResult(result: ToolResult): ToolResult {
  return createToolResult(result);
}
