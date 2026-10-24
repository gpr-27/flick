// A tiny layout engine for jsdom, so virtualised lists draw rows. Rows of `data-index` are ROW px
// tall, the element with data-testid="message-scroller" is VIEW px tall, and scrollTop is clamped
// to the content height like a browser. Call installListLayout() in beforeAll and the returned
// function in afterAll.
export const ROW = 50;
export const VIEW = 500;
export const SCROLLER = 'message-scroller';

export function installListLayout(): () => void {
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

  const hadObserver = 'ResizeObserver' in globalThis;
  if (!hadObserver) {
    class FakeResizeObserver {
      constructor(private readonly callback: ResizeObserverCallback) {}
      observe(target: Element): void {
        const rect = target.getBoundingClientRect();
        this.callback(
          [
            {
              target,
              contentRect: rect,
              borderBoxSize: [],
              contentBoxSize: [],
              devicePixelContentBoxSize: [],
            },
          ],
          this,
        );
      }
      unobserve(): void {}
      disconnect(): void {}
    }
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver = FakeResizeObserver;
  }

  return () => {
    for (const { proto, key, desc } of saved.reverse()) {
      if (desc) Object.defineProperty(proto, key, desc);
      else Reflect.deleteProperty(proto, key);
    }
    if (!hadObserver) Reflect.deleteProperty(globalThis, 'ResizeObserver');
  };
}
