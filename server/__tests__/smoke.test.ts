import { describe, it, expect } from 'vitest';

describe('server test harness smoke', () => {
  it('runs inside workerd', () => {
    expect(1 + 1).toBe(2);
  });

  it('has access to Worker runtime globals', () => {
    expect(typeof Request).toBe('function');
    expect(typeof Response).toBe('function');
    expect(typeof fetch).toBe('function');
  });
});
