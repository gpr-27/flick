import { describe, expect, it } from 'vitest';
import { MetadataExtractor, parseHtml } from '../src/parser.js';
import { HTML } from './fixture.js';

// Invisible/bidi characters are built from code points so this file stays
// free of literal Trojan-Source characters.
const [RLO, PDF, ZWSP, BEL] = [0x202e, 0x202c, 0x200b, 0x07].map((c) => String.fromCodePoint(c));

const page = new URL('https://news.example.com/articles/42?ref=x');

describe('parseHtml', () => {
  it('prefers og:* over twitter:* over plain tags', () => {
    const p = parseHtml(
      HTML(`
        <title>Plain title</title>
        <meta name="description" content="Plain description">
        <meta name="twitter:title" content="Twitter title">
        <meta name="twitter:description" content="Twitter description">
        <meta name="twitter:image" content="/tw.png">
        <meta property="og:title" content="OG title">
        <meta property="og:description" content="OG description">
        <meta property="og:site_name" content="Example News">
        <meta property="og:image" content="https://cdn.example.com/og.png">
      `),
      page,
    );
    expect(p).toEqual({
      url: page.href,
      title: 'OG title',
      description: 'OG description',
      siteName: 'Example News',
      imageUrl: 'https://cdn.example.com/og.png',
    });
  });

  it('falls back to twitter:* then <title> / meta description', () => {
    const tw = parseHtml(
      HTML(
        '<title>T</title><meta name="twitter:title" content="TW"><meta name="twitter:image:src" content="img/a.jpg">',
      ),
      page,
    );
    expect(tw.title).toBe('TW');
    expect(tw.imageUrl).toBe('https://news.example.com/articles/img/a.jpg');

    const plain = parseHtml(
      HTML('<title> Just  a\n title </title><meta name="description" content="Desc">'),
      page,
    );
    expect(plain.title).toBe('Just a title');
    expect(plain.description).toBe('Desc');
    expect(plain.siteName).toBeNull();
    expect(plain.imageUrl).toBeNull();
  });

  it('resolves relative image URLs against the page and <base href>', () => {
    expect(
      parseHtml(HTML('<meta property="og:image" content="/static/x.png">'), page).imageUrl,
    ).toBe('https://news.example.com/static/x.png');
    expect(
      parseHtml(HTML('<meta property="og:image" content="//img.example.net/y.png">'), page)
        .imageUrl,
    ).toBe('https://img.example.net/y.png');
    expect(
      parseHtml(
        HTML(
          '<base href="https://static.example.com/assets/"><meta property="og:image" content="z.png">',
        ),
        page,
      ).imageUrl,
    ).toBe('https://static.example.com/assets/z.png');
  });

  it.each([
    'javascript:alert(1)',
    'data:image/png;base64,AAAA',
    'http://127.0.0.1/x.png',
    'https://user:pw@cdn.example.com/x.png',
  ])('drops unsafe image URL %s', (src) => {
    expect(
      parseHtml(HTML(`<meta property="og:image" content="${src}">`), page).imageUrl,
    ).toBeNull();
  });

  it('uses a same-site canonical URL but ignores a foreign one', () => {
    expect(
      parseHtml(HTML('<title>x</title><link rel="canonical" href="/articles/42">'), page).url,
    ).toBe('https://news.example.com/articles/42');
    expect(
      parseHtml(
        HTML('<title>x</title><link rel="canonical" href="https://www.news.example.com/a">'),
        page,
      ).url,
    ).toBe('https://www.news.example.com/a');
    expect(
      parseHtml(
        HTML('<title>x</title><link rel="canonical" href="https://bank.example.org/login">'),
        page,
      ).url,
    ).toBe(page.href);
    expect(
      parseHtml(
        HTML('<title>x</title><meta property="og:url" content="https://news.example.com/og">'),
        page,
      ).url,
    ).toBe('https://news.example.com/og');
  });

  it('decodes entities and strips tags, controls and bidi/zero-width characters', () => {
    const p = parseHtml(
      HTML(
        `<meta property="og:title" content="Tom &amp; Jerry &lt;b&gt;bold&lt;/b&gt; ${RLO}gnp.exe${PDF}${ZWSP}${BEL} ok">`,
      ),
      page,
    );
    expect(p.title).toBe('Tom & Jerry bold gnp.exe ok');
  });

  it('streams: reports done at </head> and handles chunk boundaries inside tags', () => {
    const ex = new MetadataExtractor('utf-8');
    const doc = HTML('<meta property="og:title" content="Split across chunks"><title>t</title>');
    for (let i = 0; i < doc.length; i += 7) {
      ex.write(Buffer.from(doc.slice(i, i + 7)));
      if (ex.done) break;
    }
    expect(ex.done).toBe(true);
    expect(ex.finish(page).title).toBe('Split across chunks');
  });
});
