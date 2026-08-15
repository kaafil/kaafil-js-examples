import assert from 'node:assert/strict';
import { test } from 'node:test';
import { s, sx } from './style.js';

test('parses multiple declarations', () => {
  const out = s('display:flex;padding:8px;color:#191919');
  assert.deepEqual(out, {
    display: 'flex',
    padding: '8px',
    color: '#191919',
  });
});

test('splits only on the first colon so colons inside values survive', () => {
  const out = s('background:url(a:b)');
  assert.deepEqual(out, { background: 'url(a:b)' });
});

test('handles multiple colon-bearing values, e.g. transition timings', () => {
  const out = s('transition:color 0.2s ease, background 0.2s ease;background:url(http://x/y:z)');
  assert.deepEqual(out, {
    transition: 'color 0.2s ease, background 0.2s ease',
    background: 'url(http://x/y:z)',
  });
});

test('kebab-case properties convert to camelCase', () => {
  const out = s('background-color:red;border-top-left-radius:4px');
  assert.deepEqual(out, {
    backgroundColor: 'red',
    borderTopLeftRadius: '4px',
  });
});

test('custom properties (--x) pass through unchanged', () => {
  const out = s('--my-token:8px;padding:var(--my-token)');
  assert.deepEqual(out, {
    '--my-token': '8px',
    padding: 'var(--my-token)',
  });
});

test('empty and whitespace-only entries are skipped, trailing ; tolerated', () => {
  const out = s('display:flex;;   ;color:red;');
  assert.deepEqual(out, { display: 'flex', color: 'red' });
});

test('empty string produces an empty object', () => {
  const out = s('');
  assert.deepEqual(out, {});
});

test('returns the identical object reference for the same input string', () => {
  const a = s('display:flex;color:red');
  const b = s('display:flex;color:red');
  assert.equal(a, b);
});

test('the cached object is frozen', () => {
  const out = s('display:flex') as Record<string, unknown>;
  assert.throws(() => {
    'use strict';
    out['display'] = 'block';
  });
});

test('sx joins truthy parts and drops falsy ones', () => {
  const out = sx('display:flex', false, null, undefined, 'color:red');
  assert.deepEqual(out, { display: 'flex', color: 'red' });
});

test('sx with no truthy parts parses like an empty string', () => {
  const out = sx(false, null, undefined);
  assert.deepEqual(out, {});
});
