// Step 15 — JoinScreen unit tests.
//
// Pure presentational coverage: autofocus logic, character filtering + paste
// extraction for the room code, displayName validation, submit-button
// gating, onSubmit/onCancel callbacks.

import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import JoinScreen from '../JoinScreen.jsx';

afterEach(cleanup);

describe('JoinScreen — autofocus', () => {
  it('focuses the code input when no defaultCode is provided', () => {
    render(<JoinScreen onSubmit={() => {}} />);
    expect(document.activeElement).toBe(screen.getByLabelText('Room code'));
  });

  it('focuses the name input when a valid defaultCode is provided', () => {
    render(<JoinScreen defaultCode="ABCDE" onSubmit={() => {}} />);
    // Name input is the first <input type="text"> inside a <label> labelled "Your name"
    const name = screen.getByRole('textbox', { name: /your name/i });
    expect(document.activeElement).toBe(name);
  });
});

describe('JoinScreen — code input filtering', () => {
  it('uppercases lowercase input', async () => {
    const user = userEvent.setup();
    render(<JoinScreen onSubmit={() => {}} />);
    const code = screen.getByLabelText('Room code');
    await user.type(code, 'abcde');
    expect(code.value).toBe('ABCDE');
  });

  it('strips characters outside the alphabet', async () => {
    const user = userEvent.setup();
    render(<JoinScreen onSubmit={() => {}} />);
    const code = screen.getByLabelText('Room code');
    // "0" and "I" and "O" are NOT in the alphabet; "A","B" and digits 2,3 are.
    await user.type(code, 'A0B1I2OB3');
    expect(code.value).toBe('AB2B3');
  });

  it('clamps to 5 characters', async () => {
    const user = userEvent.setup();
    render(<JoinScreen onSubmit={() => {}} />);
    const code = screen.getByLabelText('Room code');
    await user.type(code, 'ABCDEFGH');
    expect(code.value).toBe('ABCDE');
  });
});

describe('JoinScreen — URL paste extraction', () => {
  it('extracts the code from a pasted share link', async () => {
    const user = userEvent.setup();
    render(<JoinScreen onSubmit={() => {}} />);
    const code = screen.getByLabelText('Room code');
    code.focus();
    await user.paste('https://example.com/VectorX/#/r/Q7K4N');
    expect(code.value).toBe('Q7K4N');
  });

  it('extracts a 5-char token buried in arbitrary text', async () => {
    const user = userEvent.setup();
    render(<JoinScreen onSubmit={() => {}} />);
    const code = screen.getByLabelText('Room code');
    code.focus();
    await user.paste('hey come join me: H7J3Q yeah that one');
    expect(code.value).toBe('H7J3Q');
  });
});

describe('JoinScreen — submit gating', () => {
  it('disables Join until code is 5 valid chars AND name is non-empty', async () => {
    const user = userEvent.setup();
    render(<JoinScreen onSubmit={() => {}} />);
    const submit = screen.getByRole('button', { name: /join/i });
    expect(submit).toBeDisabled();

    await user.type(screen.getByLabelText('Room code'), 'ABCDE');
    expect(submit).toBeDisabled(); // still no name

    await user.type(screen.getByRole('textbox', { name: /your name/i }), 'Alice');
    expect(submit).not.toBeDisabled();
  });

  it('rejects a whitespace-only displayName', async () => {
    const user = userEvent.setup();
    render(<JoinScreen onSubmit={() => {}} />);
    await user.type(screen.getByLabelText('Room code'), 'ABCDE');
    await user.type(screen.getByRole('textbox', { name: /your name/i }), '   ');
    expect(screen.getByRole('button', { name: /join/i })).toBeDisabled();
  });
});

describe('JoinScreen — callbacks', () => {
  it('onSubmit is called with { code, displayName } (trimmed) on click', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<JoinScreen onSubmit={onSubmit} />);
    await user.type(screen.getByLabelText('Room code'), 'Q7K4N');
    await user.type(screen.getByRole('textbox', { name: /your name/i }), '  Alice  ');
    await user.click(screen.getByRole('button', { name: /join/i }));
    expect(onSubmit).toHaveBeenCalledWith({ code: 'Q7K4N', displayName: 'Alice' });
  });

  it('onCancel button appears and fires when provided', async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    render(<JoinScreen onSubmit={() => {}} onCancel={onCancel} />);
    await user.click(screen.getByRole('button', { name: /cancel/i }));
    expect(onCancel).toHaveBeenCalled();
  });

  it('omits Cancel button when onCancel is not provided', () => {
    render(<JoinScreen onSubmit={() => {}} />);
    expect(screen.queryByRole('button', { name: /cancel/i })).toBeNull();
  });
});
