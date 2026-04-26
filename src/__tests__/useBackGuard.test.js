// useBackGuard — unit tests for the browser-back-button intercept hook.
//
// Drives the hook through happy-path + cleanup transitions using
// jsdom's history + popstate. We spy on history.pushState and dispatch
// real popstate events to mimic what the browser does on a back press.

import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useBackGuard } from '../useBackGuard';

let pushSpy;

beforeEach(() => {
  pushSpy = vi.spyOn(window.history, 'pushState');
});

afterEach(() => {
  pushSpy.mockRestore();
});

describe('useBackGuard', () => {
  it('does nothing while inactive', () => {
    const onBack = vi.fn();
    renderHook(({ active }) => useBackGuard(active, onBack), {
      initialProps: { active: false },
    });
    expect(pushSpy).not.toHaveBeenCalled();
    window.dispatchEvent(new PopStateEvent('popstate'));
    expect(onBack).not.toHaveBeenCalled();
  });

  it('pushes a sentinel history entry when activated and calls onBack on popstate', () => {
    const onBack = vi.fn();
    renderHook(() => useBackGuard(true, onBack));
    expect(pushSpy).toHaveBeenCalledTimes(1);
    expect(pushSpy.mock.calls[0][0]).toMatchObject({ vxBackGuard: true });

    // Simulate the user pressing back.
    window.dispatchEvent(new PopStateEvent('popstate'));
    expect(onBack).toHaveBeenCalledTimes(1);
    // Re-pushed sentinel so the next back press is also intercepted.
    expect(pushSpy).toHaveBeenCalledTimes(2);
  });

  it('intercepts repeated back presses (continuous protection)', () => {
    const onBack = vi.fn();
    renderHook(() => useBackGuard(true, onBack));
    window.dispatchEvent(new PopStateEvent('popstate'));
    window.dispatchEvent(new PopStateEvent('popstate'));
    window.dispatchEvent(new PopStateEvent('popstate'));
    expect(onBack).toHaveBeenCalledTimes(3);
  });

  it('removes its popstate listener on unmount so back leaves naturally afterwards', () => {
    const onBack = vi.fn();
    const { unmount } = renderHook(() => useBackGuard(true, onBack));
    unmount();
    window.dispatchEvent(new PopStateEvent('popstate'));
    expect(onBack).not.toHaveBeenCalled();
  });

  it('removes its listener when active flips false', () => {
    const onBack = vi.fn();
    const { rerender } = renderHook(
      ({ active }) => useBackGuard(active, onBack),
      { initialProps: { active: true } },
    );
    rerender({ active: false });
    window.dispatchEvent(new PopStateEvent('popstate'));
    expect(onBack).not.toHaveBeenCalled();
  });

  it('reads the latest onBack via ref, not the closure-at-mount version', () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = renderHook(
      ({ cb }) => useBackGuard(true, cb),
      { initialProps: { cb: first } },
    );
    rerender({ cb: second });
    window.dispatchEvent(new PopStateEvent('popstate'));
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('survives an onBack that throws (still re-arms the sentinel)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const onBack = vi.fn(() => {
      throw new Error('boom');
    });
    renderHook(() => useBackGuard(true, onBack));
    pushSpy.mockClear();
    window.dispatchEvent(new PopStateEvent('popstate'));
    expect(onBack).toHaveBeenCalledTimes(1);
    // Still re-pushed the sentinel after the throw was swallowed.
    expect(pushSpy).toHaveBeenCalledTimes(1);
    expect(pushSpy.mock.calls[0][0]).toMatchObject({ vxBackGuard: true });
    warn.mockRestore();
  });
});
