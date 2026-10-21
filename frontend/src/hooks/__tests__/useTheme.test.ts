import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { useTheme } from '../useTheme';

afterEach(() => {
  localStorage.clear();
  delete document.documentElement.dataset.theme;
});

describe('useTheme', () => {
  it('follows the system when nothing was chosen', () => {
    const { result } = renderHook(() => useTheme());
    expect(result.current.preference).toBe('system');
    // jsdom has no matchMedia: the fallback is dark.
    expect(result.current.resolved).toBe('dark');
    expect(document.documentElement.dataset.theme).toBeUndefined();
  });

  it('ignores the theme older builds stored on every load', () => {
    localStorage.setItem('vulpexa-theme', 'dark');
    const { result } = renderHook(() => useTheme());
    expect(result.current.preference).toBe('system');
  });

  it('applies and persists an explicit choice', () => {
    localStorage.setItem('ryntra-theme', 'dark');
    const { result } = renderHook(() => useTheme());
    act(() => result.current.setPreference('light'));
    expect(result.current.resolved).toBe('light');
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(localStorage.getItem('vulpexa-theme-pref')).toBe('light');
    expect(localStorage.getItem('ryntra-theme')).toBeNull();
  });

  it('forgets the choice when going back to system', () => {
    localStorage.setItem('vulpexa-theme-pref', 'dark');
    const { result } = renderHook(() => useTheme());
    expect(document.documentElement.dataset.theme).toBe('dark');
    act(() => result.current.setPreference('system'));
    expect(localStorage.getItem('vulpexa-theme-pref')).toBeNull();
    expect(document.documentElement.dataset.theme).toBeUndefined();
  });

  it('toggles from what is on screen', () => {
    const { result } = renderHook(() => useTheme());
    act(() => result.current.toggle());
    expect(result.current.preference).toBe('light');
  });
});
