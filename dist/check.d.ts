/**
 * Follow a URL's redirects one hop at a time (so every hop is observable) and
 * analyse the chain. Network in `followRedirects`, pure analysis in `analyse`.
 */
export interface Hop {
    url: string;
    status: number;
    /** Resolved absolute Location, or null when the hop was not a redirect. */
    location: string | null;
    latencyMs: number;
}
export type FindingCode = 'chain' | 'loop' | 'too-many-hops' | 'https-to-http' | 'http-to-https' | 'temporary-redirect' | 'meta-refresh' | 'redirect-to-error' | 'fetch-error';
export interface Finding {
    code: FindingCode;
    message: string;
}
export interface RedirectReport {
    url: string;
    hops: Hop[];
    finalUrl: string;
    /** Status of the last response, or null when a request failed. */
    finalStatus: number | null;
    fetchError: string | null;
    /** Number of redirects followed (hops with a Location). */
    redirectCount: number;
    findings: Finding[];
}
export interface FollowOptions {
    maxHops: number;
    timeoutMs: number;
    userAgent: string;
    /** Injected for tests. */
    fetch?: typeof fetch;
}
export declare const DEFAULT_FOLLOW_OPTIONS: FollowOptions;
export declare const ALL_FINDING_CODES: readonly FindingCode[];
/** Findings that fail a CI run unless --fail-on says otherwise. http-to-https and temporary-redirect are advisories. */
export declare const DEFAULT_FAIL_ON: readonly FindingCode[];
interface Followed {
    hops: Hop[];
    finalStatus: number | null;
    fetchError: string | null;
    /** First 4 KB of a final 200 HTML body, for the meta-refresh check. */
    bodyHead: string | null;
    loopAt: string | null;
    tooManyHops: boolean;
}
export declare function followRedirects(url: string, opts?: FollowOptions): Promise<Followed>;
/** Pure: derive findings from what followRedirects observed. */
export declare function analyse(url: string, f: Followed): RedirectReport;
/** Follow + analyse in one call. */
export declare function checkRedirects(url: string, opts?: FollowOptions): Promise<RedirectReport>;
export {};
