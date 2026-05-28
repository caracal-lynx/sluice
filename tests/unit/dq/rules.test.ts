import { describe, expect, it } from 'vitest';

import type { CheckConfig } from '../../../src/config/types.js';
import {
  AllowedValuesRule,
  EmailRule,
  MaxLengthRule,
  MaxRule,
  MinRule,
  NotNullRule,
  PatternRule,
  UkPostcodeRule,
  UniqueRule,
} from '../../../src/dq/rules/index.js';
import { DQError } from '../../../src/utils/errors.js';

function cfg(type: CheckConfig['type'], overrides: Partial<CheckConfig> = {}): CheckConfig {
  return { type, severity: 'critical', ...overrides } as CheckConfig;
}

describe('NotNullRule', () => {
  const rule = new NotNullRule();

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['empty string', ''],
    ['whitespace-only', '   '],
    ['tab+newline', '\t\n'],
  ])('flags %s', (_name, value) => {
    const v = rule.validate(value, cfg('notNull'), 7, 'CUST_CODE');
    expect(v).not.toBeNull();
    expect(v!.rule).toBe('notNull');
    expect(v!.severity).toBe('critical');
    expect(v!.rowIndex).toBe(7);
    expect(v!.field).toBe('CUST_CODE');
  });

  it.each([['x'], ['0'], ['  a  ']])('passes %s', (value) => {
    expect(rule.validate(value, cfg('notNull'), 0, 'f')).toBeNull();
  });
});

describe('UniqueRule (marker only; engine emits violations)', () => {
  it('validate() always returns null', () => {
    const rule = new UniqueRule();
    expect(rule.validate('anything', cfg('unique'), 0, 'f')).toBeNull();
    expect(rule.validate(null, cfg('unique'), 0, 'f')).toBeNull();
  });
});

describe('PatternRule', () => {
  const rule = new PatternRule();

  it('passes matching strings', () => {
    expect(
      rule.validate('ABC123', cfg('pattern', { value: '^[A-Z0-9]+$' }), 0, 'f'),
    ).toBeNull();
  });

  it('flags non-matching strings', () => {
    const v = rule.validate('abc', cfg('pattern', { value: '^[A-Z0-9]+$' }), 0, 'f');
    expect(v).not.toBeNull();
  });

  it('skips null/undefined/empty (let notNull handle)', () => {
    expect(rule.validate(null, cfg('pattern', { value: '.*' }), 0, 'f')).toBeNull();
    expect(rule.validate('', cfg('pattern', { value: '.*' }), 0, 'f')).toBeNull();
  });

  it('throws DQError on invalid regex', () => {
    expect(() => rule.validate('x', cfg('pattern', { value: '[unclosed' }), 0, 'f')).toThrow(
      DQError,
    );
  });

  it('throws DQError when config.value is missing', () => {
    expect(() => rule.validate('x', cfg('pattern'), 0, 'f')).toThrow(DQError);
  });

  it('missing-value error names the `value:` key and shows a regex example', () => {
    try {
      rule.validate('x', cfg('pattern'), 0, 'CUST_CODE');
      expect.fail('expected DQError to be thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(DQError);
      const msg = (err as DQError).message;
      expect(msg).toContain('CUST_CODE');
      expect(msg).toContain('`value:`');
      expect(msg).toMatch(/value: "\^/);
    }
  });
});

describe('EmailRule', () => {
  const rule = new EmailRule();

  it.each(['foo@example.com', 'a.b+c@sub.example.co.uk', 'name@x.io'])('passes %s', (addr) => {
    expect(rule.validate(addr, cfg('email'), 0, 'f')).toBeNull();
  });

  it.each(['no-at', 'bad@', '@bad', 'bad@.com', 'bad@bad.', 'a@b'])('flags %s', (addr) => {
    const v = rule.validate(addr, cfg('email'), 0, 'f');
    expect(v).not.toBeNull();
  });

  it('skips null/empty', () => {
    expect(rule.validate(null, cfg('email'), 0, 'f')).toBeNull();
    expect(rule.validate('', cfg('email'), 0, 'f')).toBeNull();
  });
});

describe('UkPostcodeRule', () => {
  const rule = new UkPostcodeRule();

  it.each([
    'SW1A 1AA',
    'sw1a 1aa', // case-insensitive
    'M1 1AA',
    'EC1A 1BB',
    'W1A 0AX',
    'EH38EQ', // no space
    'GIR 0AA', // edge case — actually invalid per our regex; expect flag
  ])('evaluates %s', (pc) => {
    // We just check the rule doesn't throw; specific pass/fail covered below
    rule.validate(pc, cfg('ukPostcode'), 0, 'f');
  });

  it('accepts real postcodes', () => {
    expect(rule.validate('SW1A 1AA', cfg('ukPostcode'), 0, 'f')).toBeNull();
    expect(rule.validate('eh3 8eq', cfg('ukPostcode'), 0, 'f')).toBeNull();
    expect(rule.validate('EH38EQ', cfg('ukPostcode'), 0, 'f')).toBeNull();
  });

  it('flags obvious non-postcodes', () => {
    expect(rule.validate('nonsense', cfg('ukPostcode'), 0, 'f')).not.toBeNull();
    expect(rule.validate('12345', cfg('ukPostcode'), 0, 'f')).not.toBeNull();
    expect(rule.validate('ABC', cfg('ukPostcode'), 0, 'f')).not.toBeNull();
  });

  it('skips null/empty', () => {
    expect(rule.validate(null, cfg('ukPostcode'), 0, 'f')).toBeNull();
    expect(rule.validate('', cfg('ukPostcode'), 0, 'f')).toBeNull();
  });
});

describe('MaxLengthRule', () => {
  const rule = new MaxLengthRule();

  it('passes at-or-below limit', () => {
    expect(rule.validate('abc', cfg('maxLength', { value: 5 }), 0, 'f')).toBeNull();
    expect(rule.validate('abcde', cfg('maxLength', { value: 5 }), 0, 'f')).toBeNull();
  });

  it('flags over-limit', () => {
    const v = rule.validate('abcdef', cfg('maxLength', { value: 5 }), 0, 'f');
    expect(v).not.toBeNull();
    expect(v!.message).toContain('5');
  });

  it('skips null/undefined', () => {
    expect(rule.validate(null, cfg('maxLength', { value: 5 }), 0, 'f')).toBeNull();
  });

  it('throws DQError when value is not a number', () => {
    expect(() => rule.validate('x', cfg('maxLength'), 0, 'f')).toThrow(DQError);
  });
});

describe('MinRule / MaxRule', () => {
  it('MinRule passes at-or-above', () => {
    const rule = new MinRule();
    expect(rule.validate(5, cfg('min', { value: 0 }), 0, 'f')).toBeNull();
    expect(rule.validate('5', cfg('min', { value: 0 }), 0, 'f')).toBeNull();
  });

  it('MinRule flags below minimum', () => {
    const rule = new MinRule();
    expect(rule.validate(-1, cfg('min', { value: 0 }), 0, 'f')).not.toBeNull();
    expect(rule.validate('-1', cfg('min', { value: 0 }), 0, 'f')).not.toBeNull();
  });

  it('MaxRule passes at-or-below', () => {
    const rule = new MaxRule();
    expect(rule.validate(100, cfg('max', { value: 500 }), 0, 'f')).toBeNull();
  });

  it('MaxRule flags above max', () => {
    const rule = new MaxRule();
    expect(rule.validate(600, cfg('max', { value: 500 }), 0, 'f')).not.toBeNull();
  });

  it('skips unparseable values', () => {
    const rule = new MinRule();
    expect(rule.validate('not-a-number', cfg('min', { value: 0 }), 0, 'f')).toBeNull();
    expect(rule.validate(null, cfg('min', { value: 0 }), 0, 'f')).toBeNull();
  });
});

describe('AllowedValuesRule (case-sensitive)', () => {
  const rule = new AllowedValuesRule();

  it('passes exact matches', () => {
    expect(
      rule.validate('GB', cfg('allowedValues', { value: ['GB', 'IE', 'US'] }), 0, 'f'),
    ).toBeNull();
  });

  it('is case-sensitive', () => {
    const v = rule.validate('gb', cfg('allowedValues', { value: ['GB', 'IE'] }), 0, 'f');
    expect(v).not.toBeNull();
    expect(v!.message).toContain('gb');
  });

  it('throws DQError when value is not an array', () => {
    expect(() => rule.validate('x', cfg('allowedValues'), 0, 'f')).toThrow(DQError);
  });
});
