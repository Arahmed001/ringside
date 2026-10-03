import type { Instrumentation } from "next";

/** Every server error, as one JSON line on stderr (see lib/error-log.ts for what is and is not in it). */
export const onRequestError: Instrumentation.onRequestError = async (err, request, context) => {
  const { errorLine } = await import("./lib/error-log");
  console.error(errorLine(err, request, context));
};

/**
 * Runs once when the server starts. Production waits for the world to be built before accepting requests, so no visitor
 * pays for it; `next dev` builds in the background so editing is not slowed (a request that arrives meanwhile shares the build).
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { warmWorld, scheduleDailyWarm } = await import("./lib/warm");
  if (process.env.NODE_ENV === "production") await warmWorld();
  else void warmWorld();
  scheduleDailyWarm();
}
