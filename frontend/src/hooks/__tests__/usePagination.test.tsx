import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { usePagination } from '../usePagination';

const items = (n: number) => Array.from({ length: n }, (_, i) => i + 1);

describe('usePagination', () => {
  beforeEach(() => localStorage.clear());

  it('shows the first 25 rows by default and reports the range', () => {
    const { result } = renderHook(() => usePagination(items(137), 'test'));
    expect(result.current.items).toHaveLength(25);
    expect(result.current.items[0]).toBe(1);
    expect(result.current.pageCount).toBe(6);
    expect(result.current.from).toBe(1);
    expect(result.current.to).toBe(25);
  });

  it('reports an empty range for an empty list', () => {
    const { result } = renderHook(() => usePagination([], 'test'));
    expect(result.current.from).toBe(0);
    expect(result.current.to).toBe(0);
    expect(result.current.pageCount).toBe(1);
  });

  it('slices the requested page and leaves a short last page short', () => {
    const { result } = renderHook(() => usePagination(items(137), 'test'));
    act(() => result.current.setPage(6));
    expect(result.current.items).toEqual([126, 127, 128, 129, 130, 131, 132, 133, 134, 135, 136, 137]);
    expect(result.current.to).toBe(137);
  });

  it("renders everything for 'alle'", () => {
    const { result } = renderHook(() => usePagination(items(137), 'test'));
    act(() => result.current.setPageSize('alle'));
    expect(result.current.items).toHaveLength(137);
    expect(result.current.pageCount).toBe(1);
  });

  it('remembers the page size per list, not globally', () => {
    const first = renderHook(() => usePagination(items(200), 'devices'));
    act(() => first.result.current.setPageSize(100));
    first.unmount();

    const again = renderHook(() => usePagination(items(200), 'devices'));
    expect(again.result.current.pageSize).toBe(100);

    const other = renderHook(() => usePagination(items(200), 'scripts'));
    expect(other.result.current.pageSize).toBe(25);
  });

  it('returns to page 1 when the filter behind the list changes', () => {
    const { result, rerender } = renderHook(
      ({ key }: { key: string }) => usePagination(items(137), 'test', key),
      { initialProps: { key: 'alle' } },
    );
    act(() => result.current.setPage(4));
    expect(result.current.page).toBe(4);
    rerender({ key: 'offline' });
    // Page 4 of a result set the user just replaced is an arbitrary middle
    // of it — or nothing at all.
    expect(result.current.page).toBe(1);
  });

  it('clamps the page when the list shrinks under a running poll', () => {
    const { result, rerender } = renderHook(({ n }: { n: number }) => usePagination(items(n), 'test'), {
      initialProps: { n: 137 },
    });
    act(() => result.current.setPage(6));
    rerender({ n: 30 });
    expect(result.current.page).toBe(2);
    expect(result.current.items).toEqual([26, 27, 28, 29, 30]);
  });

  it('falls back to the default when storage holds nonsense', () => {
    localStorage.setItem('vulpexa-pagesize-test', 'siebzehn');
    const { result } = renderHook(() => usePagination(items(60), 'test'));
    expect(result.current.pageSize).toBe(25);
  });
});
