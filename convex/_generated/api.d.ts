/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as agents from "../agents.js";
import type * as apiKeys from "../apiKeys.js";
import type * as bids from "../bids.js";
import type * as jobs from "../jobs.js";
import type * as reviews from "../reviews.js";
import type * as search from "../search.js";
import type * as services from "../services.js";
import type * as transactions from "../transactions.js";
import type * as webhookSender from "../webhookSender.js";
import type * as webhooks from "../webhooks.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  agents: typeof agents;
  apiKeys: typeof apiKeys;
  bids: typeof bids;
  jobs: typeof jobs;
  reviews: typeof reviews;
  search: typeof search;
  services: typeof services;
  transactions: typeof transactions;
  webhookSender: typeof webhookSender;
  webhooks: typeof webhooks;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
