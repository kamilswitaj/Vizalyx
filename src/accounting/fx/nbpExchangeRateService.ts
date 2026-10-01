export interface ExchangeRate {
  readonly baseCurrency: 'USD';
  readonly quoteCurrency: 'PLN';
  readonly rate: number;
  readonly effectiveDate: string; // e.g. "2026-03-31"
  readonly source: 'NBP';
  readonly isStale?: boolean;
}

interface CachedRateRecord {
  readonly rate: ExchangeRate;
  readonly fetchedAtLocalDate: string; // "YYYY-MM-DD"
}

const STORAGE_KEY = 'vizalyx_nbp_usd_pln_cache';
const NBP_API_URL = 'https://api.nbp.pl/api/exchangerates/rates/a/usd/?format=json';

export class NbpExchangeRateService {
  private storage: Storage | null;
  private fetchFn: typeof fetch;

  constructor(customStorage?: Storage | null, customFetch?: typeof fetch) {
    this.storage =
      customStorage !== undefined
        ? customStorage
        : typeof window !== 'undefined' && window.localStorage
          ? window.localStorage
          : null;
    this.fetchFn = customFetch ?? (typeof globalThis.fetch === 'function' ? globalThis.fetch.bind(globalThis) : fetch);
  }

  private inFlightPromise: Promise<ExchangeRate | null> | null = null;

  private getTodayLocalDateString(): string {
    const d = new Date();
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  /**
   * Synchronously reads the cached rate from local storage.
   * If the rate is from a prior calendar day, it is returned marked as stale.
   * Never blocks or makes network calls.
   */
  public getCachedRate(): ExchangeRate | null {
    if (!this.storage) return null;
    try {
      const raw = this.storage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as CachedRateRecord;
      if (parsed?.rate?.rate && parsed?.rate?.effectiveDate) {
        const today = this.getTodayLocalDateString();
        const isStale = parsed.fetchedAtLocalDate !== today || Boolean(parsed.rate.isStale);
        return {
          ...parsed.rate,
          isStale,
        };
      }
    } catch {
      // Ignore corrupted storage
    }
    return null;
  }

  /**
   * Prefetches the latest NBP rate in the background without blocking.
   * Deduplicates concurrent background requests.
   */
  public prefetch(): void {
    if (this.inFlightPromise) return;
    this.inFlightPromise = this.getUsdPlnRate().finally(() => {
      this.inFlightPromise = null;
    });
  }

  private getCachedRecord(): CachedRateRecord | null {
    if (!this.storage) return null;
    try {
      const raw = this.storage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as CachedRateRecord;
      if (parsed?.rate?.rate && parsed?.rate?.effectiveDate && parsed?.fetchedAtLocalDate) {
        return parsed;
      }
    } catch {
      // Ignore corrupted storage
    }
    return null;
  }

  private setCachedRecord(rate: ExchangeRate, fetchedAtLocalDate: string): void {
    if (!this.storage) return;
    try {
      const record: CachedRateRecord = { rate, fetchedAtLocalDate };
      this.storage.setItem(STORAGE_KEY, JSON.stringify(record));
    } catch {
      // Ignore storage write errors (e.g. quota/privacy mode)
    }
  }

  /**
   * Retrieves the current average USD/PLN rate from NBP Table A.
   * Fetches at most once per local day; caches successfully fetched rate.
   * If NBP is temporarily unavailable, returns last cached rate marked as stale.
   * If neither is available, returns null without throwing.
   */
  public async getUsdPlnRate(options?: {
    forceRefresh?: boolean;
    timeoutMs?: number;
  }): Promise<ExchangeRate | null> {
    const today = this.getTodayLocalDateString();
    const cachedRecord = this.getCachedRecord();

    // 1. If cached today and not forced, return cached rate immediately
    if (!options?.forceRefresh && cachedRecord && cachedRecord.fetchedAtLocalDate === today && !cachedRecord.rate.isStale) {
      return cachedRecord.rate;
    }

    // 2. Fetch latest from NBP API
    const timeoutMs = options?.timeoutMs ?? 5000;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await this.fetchFn(NBP_API_URL, {
        headers: {
          Accept: 'application/json',
        },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`NBP API returned HTTP ${response.status}`);
      }

      const json = await response.json();
      const mid = json?.rates?.[0]?.mid;
      const effectiveDate = json?.rates?.[0]?.effectiveDate;

      if (typeof mid !== 'number' || mid <= 0 || !effectiveDate) {
        throw new Error('NBP API returned invalid rate payload');
      }

      const rate: ExchangeRate = {
        baseCurrency: 'USD',
        quoteCurrency: 'PLN',
        rate: mid,
        effectiveDate,
        source: 'NBP',
        isStale: false,
      };

      this.setCachedRecord(rate, today);
      return rate;
    } catch {
      clearTimeout(timeoutId);
      // Fallback: If NBP is temporarily unavailable, return last cached rate marked as stale
      if (cachedRecord?.rate) {
        return {
          ...cachedRecord.rate,
          isStale: true,
        };
      }
      return null;
    }
  }
}

export const nbpExchangeRateService = new NbpExchangeRateService();
