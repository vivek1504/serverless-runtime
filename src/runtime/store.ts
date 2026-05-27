import type { RuntimeFunction } from "../types/types.js";

export const runtimeStore = {
  functions: new Map<string, RuntimeFunction>(),
};
