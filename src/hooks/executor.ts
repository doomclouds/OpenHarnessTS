import type {
  AggregatedHookResult,
  HookEvent,
  HookExecuteArgs,
  HookPayload,
  HookPayloadByEvent,
  HookResult
} from "./events.js";

export type HookHandler<E extends HookEvent = HookEvent> = (
  payload: HookPayloadByEvent[E],
  event: E
) => HookResult | void | Promise<HookResult | void>;

export interface HookExecutor {
  execute(payload: HookPayload): AggregatedHookResult | Promise<AggregatedHookResult>;
  execute(...args: HookExecuteArgs): AggregatedHookResult | Promise<AggregatedHookResult>;
}

export function createAggregatedHookResult(
  results: readonly HookResult[] = []
): AggregatedHookResult {
  const blockingResult = results.find((result) => result.blocked === true);

  return {
    results: [...results],
    blocked: blockingResult !== undefined,
    reason: blockingResult?.reason ?? blockingResult?.output ?? ""
  };
}

export class InMemoryHookExecutor implements HookExecutor {
  private readonly handlers = new Map<HookEvent, HookHandler[]>();

  public register<E extends HookEvent>(event: E, handler: HookHandler<E>): void {
    const handlers = this.handlers.get(event) ?? [];
    handlers.push(handler as HookHandler);
    this.handlers.set(event, handlers);
  }

  public async execute(payload: HookPayload): Promise<AggregatedHookResult>;
  public async execute(...args: HookExecuteArgs): Promise<AggregatedHookResult>;
  public async execute(
    ...args: [payload: HookPayload] | HookExecuteArgs
  ): Promise<AggregatedHookResult> {
    const [event, payload]: [HookEvent, HookPayload] =
      args.length === 1 ? [args[0].event, args[0]] : args;
    const results: HookResult[] = [];
    const handlers = this.handlers.get(event) ?? [];

    for (const handler of handlers) {
      try {
        const result = await handler(payload, event);
        results.push(
          result ?? {
            hookType: "in_memory",
            success: true
          }
        );
      } catch (error) {
        results.push({
          hookType: "in_memory",
          success: false,
          output: getErrorMessage(error)
        });
      }
    }

    return createAggregatedHookResult(results);
  }
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
