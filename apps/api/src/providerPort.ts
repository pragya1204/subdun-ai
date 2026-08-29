import type { ProviderPort } from "./simulator/port.js";
import { simulatorAdapter } from "./simulator/index.js";
import { razorpayAdapter } from "./razorpay/adapter.js";

/**
 * The bound provider-boundary implementation, chosen once at process start.
 *
 *   PROVIDER=razorpay  -> real Razorpay test mode (apps/api/src/razorpay/)
 *   anything else       -> in-process Simulator (default; used by `pnpm test`)
 *
 * Both razorpay/config.ts and the Razorpay client are lazy, so importing
 * razorpayAdapter here does no I/O and reads no env until a method is called.
 */
export const provider: ProviderPort =
  process.env.PROVIDER === "razorpay" ? razorpayAdapter : simulatorAdapter;
