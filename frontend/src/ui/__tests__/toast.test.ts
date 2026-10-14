import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Job } from '../../types';
import { resetJobResults, trackJob, trackJobs, useJobResults } from '../toast';

const { jobMock } = vi.hoisted(() => ({ jobMock: vi.fn<(id: number) => Promise<{ job: Job }>>() }));
vi.mock('../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../api/client')>('../../api/client');
  return { ...actual, api: { job: (id: number) => jobMock(id) } };
});

const job = (status: Job['status']): Job => ({
  id: 5,
  device_id: 1,
  kind: 'shell',
  command: 'uptime',
  shell: 'bash',
  script_id: null,
  script_name: '',
  status,
  exit_code: status === 'done' ? 0 : null,
  created_by: 'robin',
  created_at: 0,
  started_at: null,
  finished_at: null,
});

describe('job results', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('records a finished job for the notification centre', async () => {
    jobMock.mockResolvedValue({ job: job('done') });
    const { result } = renderHook(() => useJobResults());
    trackJob(job('running'), { deviceName: 'nas', label: 'Neustart' });
    await act(() => vi.advanceTimersByTimeAsync(2_100));
    expect(result.current.map((r) => r.jobId)).toEqual([5]);
    act(() => resetJobResults());
    expect(result.current).toEqual([]);
  });

  it('drops bulk results that arrive after the session ended', async () => {
    // A poll sent before "Abmelden" can answer 200 after it; the next
    // account in this tab must not find the previous one's jobs.
    const pending: ((r: { job: Job }) => void)[] = [];
    jobMock.mockImplementation(() => new Promise((resolve) => pending.push(resolve)));
    const { result } = renderHook(() => useJobResults());
    trackJobs(
      [
        { job: { ...job('running'), id: 7, device_id: 1 }, deviceName: 'chef-laptop' },
        { job: { ...job('running'), id: 8, device_id: 2 }, deviceName: 'buchhaltung-pc' },
      ],
      'Neustart',
    );
    await act(() => vi.advanceTimersByTimeAsync(3_100));
    expect(pending).toHaveLength(2);
    act(() => resetJobResults());
    await act(async () => {
      pending[0]!({ job: { ...job('done'), id: 7, device_id: 1 } });
      pending[1]!({ job: { ...job('done'), id: 8, device_id: 2 } });
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current).toEqual([]);
  });

  it('stops following jobs of a session that has ended', async () => {
    jobMock.mockResolvedValue({ job: job('running') });
    trackJob(job('running'), { deviceName: 'nas', label: 'Neustart' });
    resetJobResults();
    await act(() => vi.advanceTimersByTimeAsync(10_000));
    expect(jobMock).not.toHaveBeenCalled();
  });
});
