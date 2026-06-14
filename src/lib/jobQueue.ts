export class QueueFullError extends Error {
  constructor() {
    super("The converter is busy. Please try again in a moment.");
    this.name = "QueueFullError";
  }
}

const maxConcurrentJobs = Math.max(1, Number(process.env.STICKER_MAX_CONCURRENCY ?? 1));
const maxQueuedJobs = Math.max(0, Number(process.env.STICKER_MAX_QUEUE ?? 4));

let activeJobs = 0;
const waitingJobs: Array<() => void> = [];

async function acquireSlot() {
  if (activeJobs < maxConcurrentJobs) {
    activeJobs += 1;
    return;
  }

  if (waitingJobs.length >= maxQueuedJobs) {
    throw new QueueFullError();
  }

  await new Promise<void>((resolve) => {
    waitingJobs.push(resolve);
  });

  activeJobs += 1;
}

function releaseSlot() {
  activeJobs = Math.max(0, activeJobs - 1);
  waitingJobs.shift()?.();
}

export async function runStickerJob<T>(job: () => Promise<T>) {
  await acquireSlot();

  try {
    return await job();
  } finally {
    releaseSlot();
  }
}
