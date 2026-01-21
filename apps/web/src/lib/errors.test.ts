import { describe, expect, it } from 'vitest';
import { errorText } from './errors';

describe('errorText', () => {
  it('handles Error', () => {
    expect(errorText(new Error('nope'))).toBe('nope');
  });

  it('handles string', () => {
    expect(errorText('x')).toBe('x');
  });

  it('handles Supabase-like error shape', () => {
    expect(errorText({ message: 'm' })).toBe('m');
    expect(errorText({ error_description: 'd' })).toBe('d');
    expect(errorText({ details: 'det' })).toBe('det');
  });

  it('falls back to Unknown error', () => {
    expect(errorText(null)).toBe('Unknown error');
  });
});
