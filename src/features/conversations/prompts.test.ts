import { describe, it, expect } from 'vitest';
import {
  allPrompts,
  BUILTIN_PROMPTS,
  extractVariables,
  fillTemplate,
  filterPrompts,
  missingVariables,
  validatePrompt,
} from './prompts';
import type { PromptItem } from './types';

describe('extractVariables / fillTemplate / missingVariables', () => {
  it('extracts variables in order, deduplicated, trimmed', () => {
    expect(
      extractVariables('Hello {{ name }} and {{name}} plus {{ topic }}!'),
    ).toEqual(['name', 'topic']);
  });

  it('returns no variables for plain text', () => {
    expect(extractVariables('no vars here')).toEqual([]);
  });

  it('fills provided variables and leaves unfilled ones literal', () => {
    expect(fillTemplate('Hi {{name}}, go {{where}}.', { name: 'Jo' })).toBe(
      'Hi Jo, go {{where}}.',
    );
  });

  it('reports missing variables', () => {
    expect(missingVariables('{{a}} {{b}}', { a: 'x' })).toEqual(['b']);
    expect(missingVariables('{{a}}', { a: '   ' })).toEqual(['a']);
  });
});

describe('validatePrompt', () => {
  it('rejects empty title / body and over-long titles', () => {
    expect(validatePrompt('', 'body')).toBe('Give the prompt a title.');
    expect(validatePrompt('t', '')).toBe('Prompt body cannot be empty.');
    expect(validatePrompt('x'.repeat(121), 'body')).toContain('too long');
    expect(validatePrompt('OK', 'body')).toBeNull();
  });
});

describe('filterPrompts / allPrompts', () => {
  const custom: PromptItem[] = [
    {
      id: 'c1',
      title: 'Zebra prompt',
      body: 'about zebras',
      favourite: true,
      builtin: false,
      created_at: 1,
      updated_at: 1,
    },
  ];

  it('merges built-ins with favourite flags and customs', () => {
    const merged = allPrompts(custom, ['builtin-summarize']);
    const summarize = merged.find((p) => p.id === 'builtin-summarize');
    expect(summarize?.favourite).toBe(true);
    expect(merged.some((p) => p.id === 'c1')).toBe(true);
    expect(merged.length).toBe(BUILTIN_PROMPTS.length + 1);
  });

  it('filters by query and favourites-only, favourites first', () => {
    const favs = filterPrompts(allPrompts(custom, []), '', true);
    expect(favs).toHaveLength(1);
    expect(favs[0]?.id).toBe('c1');
    const byQuery = filterPrompts(allPrompts(custom, []), 'zebra', false);
    expect(byQuery).toHaveLength(1);
  });
});
