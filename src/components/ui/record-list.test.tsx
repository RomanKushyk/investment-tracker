// @vitest-environment jsdom
// The 360 records (tables.md § Signed, R2): one glass card (r24, 6 px padding) holds them, each
// nested at r18 (24 − 6) with 16 px padding, every second one at `ink` 3 %, the anatomy held.
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { Fact, RecordCard, RecordList } from './RecordCard';

afterEach(cleanup);

const classes = (el: Element) => el.getAttribute('class')?.split(/\s+/) ?? [];

function list() {
  return render(
    <RecordList>
      {['A', 'B', 'C'].map((name, i) => (
        <RecordCard
          key={name}
          index={i}
          title={name}
          tag={<span data-tag>{`tag ${name}`}</span>}
          footer={
            <>
              <button>edit</button>
              <button>delete</button>
            </>
          }
        >
          <Fact label="Вкладено">1</Fact>
          <Fact label="Вартість зараз">2</Fact>
        </RecordCard>
      ))}
    </RecordList>,
  ).container;
}

describe('RecordList', () => {
  it('is one glass card at r24 with 6 px padding', () => {
    const root = list();
    expect(root.querySelectorAll('.glass')).toHaveLength(1);
    const card = root.firstElementChild!;
    expect(classes(card)).toEqual(expect.arrayContaining(['glass', 'rounded-3xl', 'p-1.5']));
    // It enters as the records do (*Interaction rules*), rather than popping in under them.
    expect(classes(card)).toEqual(expect.arrayContaining(['animate-in', 'fade-in']));
  });

  it('nests each record at r18 with 16 px padding, every second one at ink 3 %', () => {
    const records = [...list().firstElementChild!.children];
    expect(records).toHaveLength(3);
    for (const record of records) {
      expect(classes(record)).toEqual(
        expect.arrayContaining(['rounded-[18px]', 'p-4', 'even:bg-ink/3']),
      );
      expect(classes(record)).not.toContain('glass');
    }
  });

  it('holds the anatomy: a title line with the tag, then a 2-column dl', () => {
    for (const record of list().firstElementChild!.children) {
      expect(record.querySelector('h3')).not.toBeNull();
      expect(record.querySelector('[data-tag]')).not.toBeNull();
      const dl = record.querySelector('dl')!;
      expect(classes(dl)).toEqual(expect.arrayContaining(['grid', 'grid-cols-2']));
      expect([...dl.querySelectorAll('dt')].map((dt) => dt.textContent)).toEqual([
        'Вкладено',
        'Вартість зараз',
      ]);
    }
  });

  // tables.md: the actions are "pushed there by `ml-auto`", so a footer that is not an action, the
  // short-ledger chip, keeps its place at the left.
  it('pushes the footer actions to the right with ml-auto, still bare in the wrapping row', () => {
    for (const record of list().firstElementChild!.children) {
      const button = record.querySelector('button')!;
      const row = button.parentElement!;
      expect(classes(row)).toEqual(
        expect.arrayContaining(['flex', 'flex-wrap', '[&>button:first-of-type]:ml-auto']),
      );
      expect(classes(row)).not.toContain('justify-end');
      expect(row.querySelectorAll(':scope > button')).toHaveLength(2);
    }
  });

  // A sum, not a record, as the desktop total is: its 2 px rule and never the zebra, whatever
  // place an odd or even count of records gives it.
  it('rules the total and leaves it out of the zebra', () => {
    const root = render(
      <RecordList>
        {['A', 'B', 'C'].map((name) => (
          <RecordCard key={name} title={name}>
            <Fact label="Вкладено">1</Fact>
          </RecordCard>
        ))}
        <RecordCard title="Разом" ruled>
          <Fact label="Вкладено">3</Fact>
        </RecordCard>
      </RecordList>,
    ).container;
    const total = root.firstElementChild!.lastElementChild!;
    expect(total.querySelector(':scope > [data-rule]')).not.toBeNull();
    expect(classes(total)).not.toContain('even:bg-ink/3');
  });
});

describe('an empty RecordList', () => {
  it('draws no card', () => {
    expect(render(<RecordList>{[]}</RecordList>).container.innerHTML).toBe('');
  });
});

describe('a RecordCard outside a list', () => {
  it('stays its own glass card at r24', () => {
    const card = render(<RecordCard title="t">x</RecordCard>).container.firstElementChild!;
    expect(classes(card)).toEqual(expect.arrayContaining(['glass', 'rounded-3xl', 'p-[22px]']));
  });
});
