import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { VirtualMessageList } from './VirtualMessageList';

// ── a tiny layout engine for jsdom ─────────────────────────────────────────
// jsdom does no layout, so we give rows and the scroller real geometry: every
// row is ROW px tall, the viewport is VIEW px, and scrollTop is clamped to the
// content height like a browser would.
const ROW = 50;
const VIEW = 500;
const PADDING = 16 * 2;
const SCROLLER = 'message-scroller';

const scrollTops = new WeakMap<Element, number>();
const isScroller = (el: Element): boolean =>
  el instanceof HTMLElement && el.dataset.testid === SCROLLER;
const contentHeight = (el: HTMLElement): number => {
  const inner = el.firstElementChild;
  return inner instanceof HTMLElement ? parseFloat(inner.style.height) || 0 : 0;
};
const maxScroll = (el: HTMLElement): number => Math.max(0, contentHeight(el) - VIEW);

const saved: { proto: object; key: string; desc: PropertyDescriptor | undefined }[] = [];
const override = (proto: object, key: string, desc: PropertyDescriptor): void => {
  saved.push({ proto, key, desc: Object.getOwnPropertyDescriptor(proto, key) });
  Object.defineProperty(proto, key, { configurable: true, ...desc });
};

beforeAll(() => {
  override(Element.prototype, 'getBoundingClientRect', {
    value(this: Element) {
      const height = isScroller(this)
        ? VIEW
        : this instanceof HTMLElement && this.dataset.index
          ? ROW
          : 0;
      return {
        x: 0,
        y: 0,
        top: 0,
        left: 0,
        bottom: height,
        right: 320,
        width: 320,
        height,
        toJSON: () => ({}),
      };
    },
  });
  override(HTMLElement.prototype, 'offsetHeight', {
    get(this: HTMLElement) {
      return isScroller(this) ? VIEW : this.dataset.index ? ROW : 0;
    },
  });
  override(HTMLElement.prototype, 'offsetWidth', { get: () => 320 });
  override(Element.prototype, 'clientHeight', {
    get(this: Element) {
      return isScroller(this) ? VIEW : 0;
    },
  });
  override(Element.prototype, 'scrollHeight', {
    get(this: Element) {
      return isScroller(this) && this instanceof HTMLElement
        ? Math.max(VIEW, contentHeight(this))
        : 0;
    },
  });
  override(Element.prototype, 'scrollTop', {
    get(this: Element) {
      return scrollTops.get(this) ?? 0;
    },
    set(this: Element, v: number) {
      const clamped =
        isScroller(this) && this instanceof HTMLElement
          ? Math.min(Math.max(0, v), maxScroll(this))
          : v;
      scrollTops.set(this, clamped);
    },
  });
  override(Element.prototype, 'scrollTo', {
    value(this: Element, opts: ScrollToOptions | number, y?: number) {
      const top = typeof opts === 'number' ? (y ?? 0) : (opts.top ?? this.scrollTop);
      this.scrollTop = top;
      this.dispatchEvent(new Event('scroll'));
    },
  });
});

afterAll(() => {
  for (const { proto, key, desc } of saved.reverse()) {
    if (desc) Object.defineProperty(proto, key, desc);
    else Reflect.deleteProperty(proto, key);
  }
});

// ── harness ────────────────────────────────────────────────────────────────

interface Item {
  id: string;
}
const items = (from: number, to: number): Item[] =>
  Array.from({ length: to - from }, (_, i) => ({ id: `m${from + i}` }));

const List = ({
  data,
  onLoadOlder = () => undefined,
  hasOlder = true,
}: {
  data: Item[];
  onLoadOlder?: () => void;
  hasOlder?: boolean;
}) => (
  <div style={{ height: VIEW }}>
    <VirtualMessageList
      items={data}
      getKey={(item) => item.id}
      estimateSize={() => ROW}
      renderItem={(item) => <div>{item.id}</div>}
      hasOlder={hasOlder}
      isLoadingOlder={false}
      onLoadOlder={onLoadOlder}
      label="Messages"
      initialRect={{ width: 320, height: VIEW }}
    />
  </div>
);

const scroller = (): HTMLElement => screen.getByTestId(SCROLLER);
const scrollTo = (top: number): void => {
  act(() => {
    scroller().scrollTop = top;
    fireEvent.scroll(scroller());
  });
};
const flush = async (): Promise<void> => {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 30));
  });
};
const total = (n: number): number => n * ROW + PADDING;

describe('VirtualMessageList scroll behaviour', () => {
  it('opens at the newest message and renders only a window of rows', async () => {
    render(<List data={items(0, 200)} />);
    await flush();
    expect(scroller().scrollTop).toBe(total(200) - VIEW);
    expect(screen.getByText('m199')).toBeInTheDocument();
    expect(screen.queryByText('m0')).not.toBeInTheDocument();
  });

  it("keeps the reader's position when an older page is prepended", async () => {
    const { rerender } = render(<List data={items(100, 200)} />);
    await flush();
    scrollTo(1000);
    await flush();
    const before = scroller().scrollTop;

    rerender(<List data={items(50, 200)} />); // 50 older rows prepended
    await flush();

    expect(scroller().scrollTop).toBe(before + 50 * ROW);
  });

  it('sticks to the bottom on new messages when already at the bottom', async () => {
    const { rerender } = render(<List data={items(0, 100)} />);
    await flush();
    expect(scroller().scrollTop).toBe(total(100) - VIEW);

    rerender(<List data={items(0, 101)} />);
    await flush();
    expect(scroller().scrollTop).toBe(total(101) - VIEW);
    expect(screen.getByText('m100')).toBeInTheDocument();
  });

  it('does not move the view on new messages when the reader has scrolled up', async () => {
    const { rerender } = render(<List data={items(0, 100)} />);
    await flush();
    scrollTo(1200);
    await flush();

    rerender(<List data={items(0, 103)} />);
    await flush();
    expect(scroller().scrollTop).toBe(1200);
    expect(screen.getByRole('button', { name: 'Jump to latest message' })).toBeInTheDocument();
  });

  it('asks for the previous page when scrolled near the top', async () => {
    const onLoadOlder = vi.fn();
    render(<List data={items(0, 100)} onLoadOlder={onLoadOlder} />);
    await flush();
    onLoadOlder.mockClear();
    scrollTo(100);
    expect(onLoadOlder).toHaveBeenCalled();
  });

  it('does not ask for older pages when there are none', async () => {
    const onLoadOlder = vi.fn();
    render(<List data={items(0, 100)} onLoadOlder={onLoadOlder} hasOlder={false} />);
    await flush();
    scrollTo(0);
    expect(onLoadOlder).not.toHaveBeenCalled();
  });
});
