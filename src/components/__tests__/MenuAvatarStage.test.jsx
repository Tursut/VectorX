// MenuAvatarStage — window-capture click listener.
//
// Tests confirm that:
//   - Clicking a button / link is never stolen (passthrough selector).
//   - Clicking an element with data-bubble-blocker is ignored.
//   - Clicking outside all bubble rects is a no-op.
//   - Clicking inside a visible bubble rect calls playPush once.
//   - With prefers-reduced-motion the component renders nothing and no
//     listener is attached.

import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../game/sounds', () => ({ playPush: vi.fn() }));

vi.mock('framer-motion', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    useReducedMotion: () => mockReducedMotion,
  };
});

let mockReducedMotion = false;

import MenuAvatarStage from '../MenuAvatarStage.jsx';
import * as sounds from '../../game/sounds';

beforeEach(() => {
  mockReducedMotion = false;
  vi.useFakeTimers();
  vi.clearAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

function renderStage() {
  return render(<MenuAvatarStage />);
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('MenuAvatarStage — prefers-reduced-motion', () => {
  it('renders nothing when reduced motion is preferred', () => {
    mockReducedMotion = true;
    const { container } = renderStage();
    expect(container.firstChild).toBeNull();
  });

  it('does not attach a window listener when reduced motion is preferred', () => {
    mockReducedMotion = true;
    renderStage();

    fireEvent.click(document.body, { clientX: 145, clientY: 145 });
    expect(sounds.playPush).not.toHaveBeenCalled();
  });
});

describe('MenuAvatarStage — UI passthrough', () => {
  it('ignores clicks on a button', () => {
    const { container } = render(
      <div>
        <MenuAvatarStage />
        <button type="button">click me</button>
      </div>,
    );

    fireEvent.click(container.querySelector('button'), { clientX: 50, clientY: 50 });
    expect(sounds.playPush).not.toHaveBeenCalled();
  });

  it('ignores clicks on an anchor', () => {
    const { container } = render(
      <div>
        <MenuAvatarStage />
        <a href="#">link</a>
      </div>,
    );

    fireEvent.click(container.querySelector('a'), { clientX: 50, clientY: 50 });
    expect(sounds.playPush).not.toHaveBeenCalled();
  });

  it('ignores clicks on an element with data-bubble-blocker', () => {
    const { container } = render(
      <div>
        <MenuAvatarStage />
        <div data-bubble-blocker>card background</div>
      </div>,
    );

    fireEvent.click(container.querySelector('[data-bubble-blocker]'), { clientX: 50, clientY: 50 });
    expect(sounds.playPush).not.toHaveBeenCalled();
  });

  it('ignores clicks on a child of data-bubble-blocker', () => {
    const { container } = render(
      <div>
        <MenuAvatarStage />
        <div data-bubble-blocker>
          <p>inner text</p>
        </div>
      </div>,
    );

    fireEvent.click(container.querySelector('p'), { clientX: 50, clientY: 50 });
    expect(sounds.playPush).not.toHaveBeenCalled();
  });
});

describe('MenuAvatarStage — hit test', () => {
  it('does nothing when clicking outside all bubble rects', () => {
    renderStage();

    // jsdom returns all-zero rects (width/height 0, centre at 0,0).
    // A click at a non-zero coord has dist > 0 = r, so no bubble is hit.
    fireEvent.click(document.body, { clientX: 500, clientY: 500 });
    expect(sounds.playPush).not.toHaveBeenCalled();
  });

  it('calls playPush when clicking inside a bubble rect', () => {
    // Bubbles are always rendered (no AnimatePresence), so all four
    // wrappers exist in the DOM immediately after render.
    renderStage();

    const wrappers = document.querySelectorAll('.menu-avatar-bubble-wrapper');
    expect(wrappers.length).toBe(4);

    // Place bubble 0 at (100, 100) 90×90 via mock.
    vi.spyOn(wrappers[0], 'getBoundingClientRect').mockReturnValue({
      left: 100, top: 100, width: 90, height: 90,
      right: 190, bottom: 190, x: 100, y: 100,
      toJSON() { return {}; },
    });

    // Click at the centre of that rect.
    fireEvent.click(document.body, { clientX: 145, clientY: 145 });
    expect(sounds.playPush).toHaveBeenCalledOnce();
  });

  it('calls playPush at most once per click even if all bubbles overlap', () => {
    renderStage();

    const wrappers = document.querySelectorAll('.menu-avatar-bubble-wrapper');
    expect(wrappers.length).toBe(4);

    wrappers.forEach((el) => {
      vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({
        left: 100, top: 100, width: 90, height: 90,
        right: 190, bottom: 190, x: 100, y: 100,
        toJSON() { return {}; },
      });
    });

    fireEvent.click(document.body, { clientX: 145, clientY: 145 });
    // Only the first matching bubble should trigger the sound.
    expect(sounds.playPush).toHaveBeenCalledTimes(1);
  });
});
