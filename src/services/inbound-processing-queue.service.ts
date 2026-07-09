let inboundProcessingChain: Promise<void> = Promise.resolve();

export function scheduleInboundProcessing(task: () => Promise<void>): void {
  inboundProcessingChain = inboundProcessingChain
    .then(task)
    .catch(() => {
      // Errors are logged inside the task — keep the chain alive for later messages.
    });
}

export async function flushInboundProcessingForTests(): Promise<void> {
  await inboundProcessingChain;
}
