// lib/tradeLookup/types.ts

// TRADE-LOOKUP-0001: shared types for the pasted-post parser and the expiration resolver.
// Pure data shapes only. No React, no network, no broker calls.

export type OptionRight = 'P' | 'C';

/** CSP = short put, CC = covered call. Nothing else is in v1 scope. */
export type LookupStrategy = 'CSP' | 'CC';

/** A calendar date with no time zone attached: 'YYYY-MM-DD'. */
export type IsoDate = string;

export interface DateParts {
  year: number;
  month: number;
  day: number;
}

/** The expiration as written in the post. `year` is null when the post gave none. */
export interface PostedExpiry {
  month: number;
  day: number;
  year: number | null;
}

export interface ParsedContract {
  kind: 'contract';
  strategy: LookupStrategy;
  ticker: string;
  right: OptionRight;
  strike: number;
  expiry: PostedExpiry;
  /** The credit the group quoted. Null when the post gave no price. */
  postedPrice: number | null;
  /** Date from a pasted Discord timestamp, used only as the reference date for the year. */
  postedAt: DateParts | null;
  /** True when the post body talks about exiting the current position or rolling. */
  isRollLike: boolean;
}

export interface ParsedExit {
  kind: 'exit';
  tickers: string[];
}

export interface ParseFailure {
  kind: 'unreadable';
  reason: string;
}

export type ParseResult = ParsedContract | ParsedExit | ParseFailure;

export type ExpiryResolution =
  | { status: 'ok'; date: IsoDate; daysOut: number }
  | { status: 'confirm_far'; date: IsoDate; daysOut: number }
  | { status: 'expired'; date: IsoDate; daysOut: number }
  | { status: 'not_listed'; date: IsoDate; daysOut: number; reason: 'weekend' | 'not_in_chain' }
  | { status: 'invalid_date'; reason: string };
