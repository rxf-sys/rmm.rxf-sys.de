import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MockWebSocket } from '../../test/mockWebSocket';
import { useJobStream } from '../useJobStream';

vi.mock('../../api/client', () => ({
  openJobSocket: (jobId: number) => new MockWebSocket(`ws://test/api/jobs/${jobId}/ws`),
}));

describe('useJobStream', () => {
  beforeEach(() => {
    MockWebSocket.reset();
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });
  afterEach(() => vi.useRealTimers());

  it('applies the snapshot and appends streamed output', () => {
    const { result } = renderHook(() => useJobStream(7));
    act(() => {
      MockWebSocket.last!.open();
      MockWebSocket.last!.emit({ type: 'snapshot', job: { output: 'a', status: 'running' } });
      MockWebSocket.last!.emit({ type: 'output', chunk: 'b' });
      MockWebSocket.last!.emit({ type: 'output', chunk: 'c' });
    });
    expect(result.current.output).toBe('abc');
    expect(result.current.status).toBe('running');
    expect(result.current.connected).toBe(true);
  });

  it('clears state immediately when the job id changes', () => {
    const { result, rerender } = renderHook(({ id }) => useJobStream(id), {
      initialProps: { id: 1 },
    });
    act(() => MockWebSocket.last!.emit({ type: 'snapshot', job: { output: 'alt', status: 'done' } }));
    expect(result.current.output).toBe('alt');

    rerender({ id: 2 });
    // No stale frame: the previous job's output is gone before the new socket
    // has said anything.
    expect(result.current.output).toBe('');
    expect(result.current.status).toBeNull();
  });

  it('reconnects after the socket drops on a running job', async () => {
    renderHook(() => useJobStream(9));
    act(() => {
      MockWebSocket.last!.open();
      MockWebSocket.last!.emit({ type: 'snapshot', job: { output: '', status: 'running' } });
    });
    expect(MockWebSocket.instances).toHaveLength(1);

    act(() => MockWebSocket.last!.drop());
    await act(async () => {
      vi.advanceTimersByTime(1_000);
    });
    await waitFor(() => expect(MockWebSocket.instances).toHaveLength(2));
  });

  it('does not reconnect once the job is finished', async () => {
    renderHook(() => useJobStream(11));
    act(() => {
      MockWebSocket.last!.open();
      MockWebSocket.last!.emit({ type: 'done', status: 'done', exit_code: 0 });
    });
    act(() => MockWebSocket.last!.drop());
    await act(async () => {
      vi.advanceTimersByTime(30_000);
    });
    expect(MockWebSocket.instances).toHaveLength(1);
  });

  it('reports the disconnect so the UI can show it', () => {
    const { result } = renderHook(() => useJobStream(3));
    act(() => {
      MockWebSocket.last!.open();
      MockWebSocket.last!.emit({ type: 'snapshot', job: { output: '', status: 'running' } });
    });
    expect(result.current.connected).toBe(true);
    act(() => MockWebSocket.last!.drop());
    expect(result.current.connected).toBe(false);
  });
});
