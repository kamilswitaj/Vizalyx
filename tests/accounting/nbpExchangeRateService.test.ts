import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NbpExchangeRateService } from '../../src/accounting/fx/nbpExchangeRateService';

// In-memory mock storage
class MockStorage implements Storage {
  private store = new Map<string, string>();
  get length() {
    return this.store.size;
  }
  clear() {
    this.store.clear();
  }
  getItem(key: string) {
    return this.store.get(key) ?? null;
  }
  key(index: number) {
    return Array.from(this.store.keys())[index] ?? null;
  }
  removeItem(key: string) {
    this.store.delete(key);
  }
  setItem(key: string, value: string) {
    this.store.set(key, value);
  }
}

describe('NbpExchangeRateService', () => {
  let mockStorage: MockStorage;

  beforeEach(() => {
    mockStorage = new MockStorage();
  });

  const mockNbpResponse = {
    table: 'A',
    currency: 'dolar amerykański',
    code: 'USD',
    rates: [
      {
        no: '063/A/NBP/2026',
        effectiveDate: '2026-03-31',
        mid: 3.9854,
      },
    ],
  };

  it('fetches exchange rate from NBP Table A on clean cache', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockNbpResponse,
    } as unknown as Response);

    const service = new NbpExchangeRateService(mockStorage, mockFetch as unknown as typeof fetch);
    const result = await service.getUsdPlnRate();

    expect(result).not.toBeNull();
    expect(result?.rate).toBe(3.9854);
    expect(result?.effectiveDate).toBe('2026-03-31');
    expect(result?.baseCurrency).toBe('USD');
    expect(result?.quoteCurrency).toBe('PLN');
    expect(result?.source).toBe('NBP');
    expect(result?.isStale).toBeFalsy();
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('serves rate from local cache on subsequent calls within same day', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockNbpResponse,
    } as unknown as Response);

    const service = new NbpExchangeRateService(mockStorage, mockFetch as unknown as typeof fetch);

    // First call fetches
    await service.getUsdPlnRate();
    expect(mockFetch).toHaveBeenCalledTimes(1);

    // Second call reads from cache
    const secondResult = await service.getUsdPlnRate();
    expect(secondResult?.rate).toBe(3.9854);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('falls back to stale cached rate if NBP network request fails', async () => {
    // Prime cache with previous day rate
    const d = new Date();
    d.setDate(d.getDate() - 1);
    const yesterday = d.toISOString().slice(0, 10);

    mockStorage.setItem(
      'vizalyx_nbp_usd_pln_cache',
      JSON.stringify({
        rate: {
          baseCurrency: 'USD',
          quoteCurrency: 'PLN',
          rate: 3.95,
          effectiveDate: yesterday,
          source: 'NBP',
        },
        fetchedAtLocalDate: yesterday,
      })
    );

    // Network fails
    const mockFetch = vi.fn().mockRejectedValue(new Error('Network offline'));
    const service = new NbpExchangeRateService(mockStorage, mockFetch as unknown as typeof fetch);

    const result = await service.getUsdPlnRate();
    expect(result).not.toBeNull();
    expect(result?.rate).toBe(3.95);
    expect(result?.effectiveDate).toBe(yesterday);
    expect(result?.isStale).toBe(true);
  });

  it('returns null gracefully without throwing when both network and cache fail', async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error('Network offline'));
    const service = new NbpExchangeRateService(mockStorage, mockFetch as unknown as typeof fetch);

    const result = await service.getUsdPlnRate();
    expect(result).toBeNull();
  });

  it('respects forceRefresh option', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockNbpResponse,
    } as unknown as Response);

    const service = new NbpExchangeRateService(mockStorage, mockFetch as unknown as typeof fetch);

    await service.getUsdPlnRate();
    expect(mockFetch).toHaveBeenCalledTimes(1);

    await service.getUsdPlnRate({ forceRefresh: true });
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('handles corrupted storage data without throwing', async () => {
    mockStorage.setItem('vizalyx_nbp_usd_pln_cache', 'corrupted-not-json');

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockNbpResponse,
    } as unknown as Response);

    const service = new NbpExchangeRateService(mockStorage, mockFetch as unknown as typeof fetch);
    const result = await service.getUsdPlnRate();

    expect(result?.rate).toBe(3.9854);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});
