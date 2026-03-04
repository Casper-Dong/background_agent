import { Queue, Worker, Job as BullJob } from "bullmq";
import { config } from "./config";

const redisOpts = {
  host: config.REDIS_HOST,
  port: config.REDIS_PORT,
  maxRetriesPerRequest: null,
};

export const JOB_QUEUE_NAME = "agent-jobs";

export const jobQueue = new Queue(JOB_QUEUE_NAME, {
  connection: redisOpts,
  defaultJobOptions: {
    attempts: 1,         // Don't auto-retry agent jobs
    removeOnComplete: { count: 200 },
    removeOnFail: { count: 200 },
  },
});

export interface JobPayload {
  jobId: string;
}

export function createWorker(
  processor: (job: BullJob<JobPayload>) => Promise<void>
): Worker<JobPayload> {
  const worker = new Worker<JobPayload>(JOB_QUEUE_NAME, processor, {
    connection: redisOpts,
    concurrency: 2,
    limiter: {
      max: 2,
      duration: 1000,
    },
  });

  worker.on("failed", (job, err) => {
    console.error(`[queue] Job ${job?.id} failed:`, err.message);
  });

  worker.on("completed", (job) => {
    console.log(`[queue] Job ${job.id} completed`);
  });

  return worker;
}
