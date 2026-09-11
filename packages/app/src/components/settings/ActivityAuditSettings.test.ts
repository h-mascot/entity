import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { AuditTrailPager, listRangeLabel } from './ActivityAuditSettings.tsx';

test('listRangeLabel renders the visible window of a paged list', () => {
  assert.equal(listRangeLabel(0, 50, 120), '1–50 of 120');
  assert.equal(listRangeLabel(50, 50, 120), '51–100 of 120');
  assert.equal(listRangeLabel(100, 20, 120), '101–120 of 120');
});

test('listRangeLabel handles boundaries: empty, single row, clamped overshoot', () => {
  assert.equal(listRangeLabel(0, 0, 0), '');
  assert.equal(listRangeLabel(0, 0, 5), '');
  assert.equal(listRangeLabel(0, 5, 0), '');
  assert.equal(listRangeLabel(0, 1, 1), '1–1 of 1');
  // A count larger than the remaining total clamps to the total.
  assert.equal(listRangeLabel(0, 150, 120), '1–120 of 120');
});

function renderPager(props: Partial<Parameters<typeof AuditTrailPager>[0]> = {}) {
  return renderToStaticMarkup(
    React.createElement(AuditTrailPager, {
      offset: 0,
      pageSize: 100,
      count: 100,
      total: 250,
      loading: false,
      onPrevPage: () => {},
      onNextPage: () => {},
      ...props,
    })
  );
}

function buttonStates(markup: string): { prevDisabled: boolean; nextDisabled: boolean } {
  const buttons = markup.match(/<button[^>]*>/g) ?? [];
  assert.equal(buttons.length, 2, `expected Prev/Next buttons: ${markup}`);
  // Match the rendered attribute, not the substring: the Tailwind class
  // `disabled:opacity-50` also contains the word "disabled".
  const isDisabled = (tag: string) => tag.includes('disabled=""') || /\sdisabled\s/.test(tag);
  return {
    prevDisabled: isDisabled(buttons[0]),
    nextDisabled: isDisabled(buttons[1]),
  };
}

test('audit pager exposes the truncation cue on the first page of many', () => {
  const markup = renderPager({ offset: 0, count: 100, total: 250 });
  assert.ok(markup.includes('Events 1–100 of 250'), markup);
  const states = buttonStates(markup);
  assert.equal(states.prevDisabled, true);
  assert.equal(states.nextDisabled, false);
});

test('audit pager disables Next on the final page and shows the true tail window', () => {
  const markup = renderPager({ offset: 200, count: 50, total: 250 });
  assert.ok(markup.includes('Events 201–250 of 250'), markup);
  const states = buttonStates(markup);
  assert.equal(states.prevDisabled, false);
  assert.equal(states.nextDisabled, true);
});

test('audit pager renders an empty cue instead of a bogus range when there are no events', () => {
  const markup = renderPager({ offset: 0, count: 0, total: 0 });
  assert.ok(!markup.includes('Events 1–'), markup);
  const states = buttonStates(markup);
  assert.equal(states.prevDisabled, true);
  assert.equal(states.nextDisabled, true);
});
