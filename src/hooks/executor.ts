import type {
  AggregatedHookResult,
  HookEvent,
  HookPayloadByEvent,
  HookResult
} from "./events.js";

export type HookHandler<E extends HookEvent = HookEvent> = (
  payload: HookPayloadByEvent[E],
  event: E
) => HookResult | void | Promise<HookResult | void>;

export interface HookExecutor {
  execute<E extends HookEvent>(
    event: E,
    payload: HookPayloadByEvent[E]
  ): AggregatedHookResult | Promise<AggregatedHookResult>;
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

  public async execute<E extends HookEvent>(
    event: E,
    payload: HookPayloadByEvent[E]
  ): Promise<AggregatedHookResult> {
    const results: HookResult[] = [];
    const handlers = (this.handlers.get(event) ?? []) as HookHandler<E>[];

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
