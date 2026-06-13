export interface FallbackAbortSignal {
  readonly signal: AbortSignal;
  readonly timedOut: { value: boolean };
  readonly cleanup: () => void;
}

export function createFallbackAbortSignal(
  timeoutMs: number,
  signal: AbortSignal | undefined = undefined
): FallbackAbortSignal {
  const controller = new AbortController();
  const timedOut = { value: false };
  const timeout = setTimeout(() => {
    timedOut.value = true;
    controller.abort();
  }, timeoutMs);
  const relayAbort = () => {
    controller.abort();
  };

  if (signal?.aborted === true) {
    controller.abort();
  } else {
    signal?.addEventListener("abort", relayAbort, { once: true });
  }

  return {
    signal: controller.signal,
    timedOut,
    cleanup() {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", relayAbort);
    }
  };
}

export function throwIfAbortedOrTimedOut(
  runtime: FallbackAbortSignal,
  createAbortError: (timedOut: boolean) => Error
): void {
  if (!runtime.signal.aborted) {
    return;
  }

  throw createAbortError(runtime.timedOut.value);
}

export async function waitForFallbackOperation<T>(
  operation: Promise<T>,
  runtime: FallbackAbortSignal,
  createAbortError: (timedOut: boolean) => Error
): Promise<T> {
  throwIfAbortedOrTimedOut(runtime, createAbortError);

  return await new Promise<T>((resolve, reject) => {
    const abort = () => {
      reject(createAbortError(runtime.timedOut.value));
    };

    runtime.signal.addEventListener("abort", abort, { once: true });
    operation
      .then(resolve, reject)
      .finally(() => {
        runtime.signal.removeEventListener("abort", abort);
      });
  });
}
