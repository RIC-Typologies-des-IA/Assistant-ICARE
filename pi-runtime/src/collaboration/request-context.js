import { AsyncLocalStorage } from "node:async_hooks";

// Request-scoped authenticated participant context. Never store tokens here.
export const requestContext = new AsyncLocalStorage();
