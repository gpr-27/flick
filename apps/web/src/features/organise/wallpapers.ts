// Chat wallpapers. The per-chat pref (and the global default) is just an id string. Built-in
// wallpapers are drawn with CSS gradients and tiny inline SVG data URIs (no network, no image
// files). An id that starts with "custom:" is a picture from this device's gallery (see
// customWallpapers.ts). An unknown id (from a newer client) shows the normal background.
import type { CSSProperties } from 'react';

export type WallpaperCategory =
  'solids' | 'gradients' | 'aurora' | 'patterns' | 'nature' | 'dark' | 'seasonal';

export interface Wallpaper {
  id: string;
  label: string;
  category: WallpaperCategory;
  style: CSSProperties;
}

export const CATEGORIES: readonly { id: WallpaperCategory; label: string }[] = [
  { id: 'solids', label: 'Minimal' },
  { id: 'gradients', label: 'Gradients' },
  { id: 'aurora', label: 'Aurora & mesh' },
  { id: 'patterns', label: 'Patterns' },
  { id: 'nature', label: 'Nature' },
  { id: 'dark', label: 'Dark & AMOLED' },
  { id: 'seasonal', label: 'Seasonal' },
];

export const CUSTOM_PREFIX = 'custom:';
export const isCustomId = (id: string | null | undefined): id is string =>
  typeof id === 'string' && id.startsWith(CUSTOM_PREFIX);

// ---- building blocks -------------------------------------------------------------------------

const svgUrl = (body: string, w: number, h: number, extra = ''): string =>
  `url("data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' width='${w}' height='${h}' viewBox='0 0 ${w} ${h}'${extra}>${body}</svg>`,
  )}")`;

/** A repeating SVG tile on a flat colour. */
const tile = (bg: string, size: number, body: string): CSSProperties => ({
  backgroundColor: bg,
  backgroundImage: svgUrl(body, size, size),
  backgroundSize: `${size}px ${size}px`,
});

/** A layered scene (sky gradient + hills) that covers the screen and sits on the bottom edge. */
const scene = (sky: [string, string], layers: [string, string][], extra = ''): CSSProperties => {
  const defs = `<defs><linearGradient id='s' x1='0' y1='0' x2='0' y2='1'><stop offset='0' stop-color='${sky[0]}'/><stop offset='1' stop-color='${sky[1]}'/></linearGradient></defs><rect width='400' height='800' fill='url(#s)'/>`;
  const shapes = layers.map(([fill, d]) => `<path d='${d}' fill='${fill}'/>`).join('');
  return {
    backgroundColor: sky[0],
    backgroundImage: svgUrl(
      defs + extra + shapes,
      400,
      800,
      " preserveAspectRatio='xMidYMax slice'",
    ),
    backgroundSize: 'cover',
    backgroundPosition: 'center bottom',
    backgroundRepeat: 'no-repeat',
  };
};

const mesh = (base: string, blobs: [string, string, number][]): CSSProperties => ({
  backgroundColor: base,
  backgroundImage: blobs
    .map(
      ([color, at, size]) => `radial-gradient(circle at ${at}, ${color} 0, transparent ${size}%)`,
    )
    .join(', '),
});

const dots = (color: string, bg: string): CSSProperties => ({
  backgroundColor: bg,
  backgroundImage: `radial-gradient(${color} 1.5px, transparent 1.5px)`,
  backgroundSize: '22px 22px',
});

const grid = (color: string, bg: string): CSSProperties => ({
  backgroundColor: bg,
  backgroundImage: `linear-gradient(${color} 1px, transparent 1px), linear-gradient(90deg, ${color} 1px, transparent 1px)`,
  backgroundSize: '28px 28px',
});

const solid = (c: string): CSSProperties => ({ backgroundColor: c });
const linear = (angle: number, ...stops: string[]): CSSProperties => ({
  backgroundImage: `linear-gradient(${angle}deg, ${stops.join(', ')})`,
});

const hex = (stroke: string, bg: string): CSSProperties =>
  tile(
    bg,
    56,
    `<path d='M28 2 L52 16 V44 L28 58 L4 44 V16 Z' fill='none' stroke='${stroke}' stroke-width='1.2'/>`,
  );

const topo = (stroke: string, bg: string): CSSProperties =>
  tile(
    bg,
    160,
    [26, 44, 62, 80]
      .map(
        (r, i) =>
          `<ellipse cx='${80 + i * 3}' cy='${80 - i * 2}' rx='${r}' ry='${r * 0.7}' fill='none' stroke='${stroke}' stroke-width='1.2' transform='rotate(${i * 12} 80 80)'/>`,
      )
      .join(''),
  );

const diagonal = (stroke: string, bg: string): CSSProperties => ({
  backgroundColor: bg,
  backgroundImage: `repeating-linear-gradient(45deg, ${stroke} 0 1.5px, transparent 1.5px 16px)`,
});

const triangles = (a: string, b: string, bg: string): CSSProperties =>
  tile(
    bg,
    72,
    `<path d='M0 72 L36 0 L72 72 Z' fill='${a}'/><path d='M36 72 L54 36 L72 72 Z' fill='${b}'/>`,
  );

const confetti = (colors: string[], bg: string): CSSProperties => {
  const bits = [
    [12, 14, 0],
    [52, 8, 40],
    [88, 30, 110],
    [30, 58, 70],
    [74, 70, 150],
    [104, 100, 20],
    [14, 96, 120],
    [60, 112, 90],
  ];
  return tile(
    bg,
    120,
    bits
      .map(([x = 0, y = 0, r = 0], i) =>
        i % 2
          ? `<circle cx='${x}' cy='${y}' r='3' fill='${colors[i % colors.length] ?? '#fff'}'/>`
          : `<rect x='${x}' y='${y}' width='9' height='3.5' rx='1.5' fill='${colors[i % colors.length] ?? '#fff'}' transform='rotate(${r} ${x} ${y})'/>`,
      )
      .join(''),
  );
};

const doodles = (stroke: string, bg: string): CSSProperties =>
  tile(
    bg,
    140,
    `<g fill='none' stroke='${stroke}' stroke-width='1.6' stroke-linecap='round' stroke-linejoin='round'>` +
      `<path d='M20 24 q6 -10 12 0 t12 0'/><circle cx='100' cy='26' r='8'/>` +
      `<path d='M70 62 l8 -14 l8 14 z'/><path d='M22 78 l12 12 m0 -12 l-12 12'/>` +
      `<path d='M104 74 c0 -8 12 -8 12 0 c0 8 -12 8 -12 16 c0 -8 12 -8 12 0' transform='translate(-6 4)'/>` +
      `<path d='M60 112 h22 M71 101 v22'/><circle cx='20' cy='122' r='3'/></g>`,
  );

const plus = (stroke: string, bg: string): CSSProperties =>
  tile(
    bg,
    40,
    `<path d='M20 14 v12 M14 20 h12' stroke='${stroke}' stroke-width='1.6' stroke-linecap='round'/>`,
  );

const stars = (bg: string): CSSProperties =>
  tile(
    bg,
    150,
    `<g fill='#fff'><circle cx='20' cy='30' r='1.2' opacity='.8'/><circle cx='90' cy='18' r='0.9' opacity='.5'/><circle cx='128' cy='70' r='1.4' opacity='.9'/><circle cx='56' cy='96' r='0.8' opacity='.5'/><circle cx='16' cy='132' r='1' opacity='.6'/><circle cx='104' cy='128' r='1.1' opacity='.7'/></g>`,
  );

const waveLines = (stroke: string, bg: string): CSSProperties =>
  tile(
    bg,
    120,
    [10, 40, 70, 100]
      .map(
        (y) =>
          `<path d='M0 ${y} q15 -12 30 0 t30 0 t30 0 t30 0' fill='none' stroke='${stroke}' stroke-width='1.3'/>`,
      )
      .join(''),
  );

// ---- the catalogue ---------------------------------------------------------------------------

const W = (
  id: string,
  label: string,
  category: WallpaperCategory,
  style: CSSProperties,
): Wallpaper => ({
  id,
  label,
  category,
  style,
});

export const WALLPAPERS: readonly Wallpaper[] = [
  // Minimal solids
  W('sand', 'Sand', 'solids', solid('#efe6d8')),
  W('mint', 'Mint', 'solids', solid('#d9efe3')),
  W('sky', 'Sky', 'solids', solid('#d8e8f8')),
  W('rose', 'Rose', 'solids', solid('#f6dce2')),
  W('paper', 'Paper', 'solids', solid('#f6f3ed')),
  W('slate', 'Slate', 'solids', solid('#cfd6e0')),
  W('lavender', 'Lavender', 'solids', solid('#e6dcf5')),
  W('peach', 'Peach', 'solids', solid('#fbdcc8')),
  W('sage', 'Sage', 'solids', solid('#d2dfca')),

  // Gradients
  W('waves', 'Waves', 'gradients', linear(135, '#cfe3ff 0%', '#e8d9ff 50%', '#ffe1ec 100%')),
  W('sunrise', 'Sunrise', 'gradients', linear(160, '#ffe7c2', '#ffc6b0', '#f3a6c0')),
  W('lagoon', 'Lagoon', 'gradients', linear(150, '#c9f1ee', '#a9d8f2', '#b8c6f5')),
  W('cotton', 'Cotton candy', 'gradients', linear(135, '#ffd6ec', '#e3d4ff', '#cdeaff')),
  W('citrus', 'Citrus', 'gradients', linear(165, '#fff5b8', '#d9f2a6', '#a6e3b8')),
  W('orchid', 'Orchid', 'gradients', linear(145, '#e9c8f7', '#c7b6f5', '#a9c3f7')),

  // Aurora and mesh
  W(
    'aurora',
    'Aurora',
    'aurora',
    mesh('#0f2a3d', [
      ['rgba(64,224,170,.65)', '15% 20%', 45],
      ['rgba(90,140,255,.6)', '85% 35%', 50],
      ['rgba(190,100,255,.5)', '40% 90%', 50],
    ]),
  ),
  W(
    'nebula',
    'Nebula',
    'aurora',
    mesh('#1c1238', [
      ['rgba(255,90,170,.55)', '80% 15%', 45],
      ['rgba(110,90,255,.6)', '20% 40%', 55],
      ['rgba(60,200,255,.4)', '70% 95%', 45],
    ]),
  ),
  W(
    'mesh-pastel',
    'Pastel mesh',
    'aurora',
    mesh('#f7f1ff', [
      ['rgba(255,196,224,.9)', '10% 10%', 50],
      ['rgba(190,220,255,.9)', '90% 20%', 50],
      ['rgba(200,255,225,.85)', '30% 95%', 50],
      ['rgba(255,236,190,.8)', '95% 90%', 45],
    ]),
  ),
  W(
    'mesh-warm',
    'Warm mesh',
    'aurora',
    mesh('#fff1e6', [
      ['rgba(255,170,140,.8)', '0% 0%', 55],
      ['rgba(255,214,140,.8)', '100% 25%', 50],
      ['rgba(245,160,200,.7)', '40% 100%', 55],
    ]),
  ),
  W(
    'northern',
    'Northern lights',
    'aurora',
    mesh('#0b1f33', [
      ['rgba(80,250,190,.5)', '50% 0%', 55],
      ['rgba(60,150,255,.45)', '0% 60%', 50],
      ['rgba(150,90,255,.4)', '100% 70%', 50],
    ]),
  ),

  // Patterns
  W('dots', 'Dots', 'patterns', dots('rgba(80,90,120,0.25)', '#eef0f6')),
  W('grid', 'Grid', 'patterns', grid('rgba(80,90,120,0.14)', '#f4f1ea')),
  W('doodles', 'Doodles', 'patterns', doodles('rgba(90,100,130,.28)', '#f1f4f8')),
  W('hex', 'Hexagons', 'patterns', hex('rgba(70,110,120,.22)', '#e9f3f2')),
  W('topo', 'Topography', 'patterns', topo('rgba(120,100,70,.22)', '#f3eee3')),
  W('diagonal', 'Diagonal lines', 'patterns', diagonal('rgba(90,90,140,.14)', '#f1f0f8')),
  W('triangles', 'Triangles', 'patterns', triangles('#e7e3f6', '#d9d3f0', '#efecf9')),
  W(
    'confetti',
    'Confetti',
    'patterns',
    confetti(['#f4a3b8', '#8ec5f0', '#f5cf7a', '#9fdcb4'], '#faf7f2'),
  ),
  W('plus', 'Plus signs', 'patterns', plus('rgba(60,80,120,.25)', '#eaf0f7')),
  W('wave-lines', 'Wave lines', 'patterns', waveLines('rgba(60,120,160,.22)', '#e8f2f8')),

  // Nature
  W(
    'dunes',
    'Dunes',
    'nature',
    scene(
      ['#fbe3c4', '#f5c79a'],
      [
        ['#eab27c', 'M0 520 Q120 440 260 500 T400 470 V800 H0Z'],
        ['#dc9a62', 'M0 610 Q140 540 280 600 T400 580 V800 H0Z'],
        ['#c98250', 'M0 700 Q100 650 220 690 T400 680 V800 H0Z'],
      ],
      "<circle cx='300' cy='200' r='46' fill='#fff3d6' opacity='.85'/>",
    ),
  ),
  W(
    'hills',
    'Green hills',
    'nature',
    scene(
      ['#d6efff', '#f2fbff'],
      [
        ['#b9e0a8', 'M0 480 Q100 400 220 470 T400 440 V800 H0Z'],
        ['#8fcb86', 'M0 580 Q150 500 280 570 T400 540 V800 H0Z'],
        ['#69b46a', 'M0 690 Q120 630 250 680 T400 660 V800 H0Z'],
      ],
    ),
  ),
  W(
    'ocean',
    'Ocean',
    'nature',
    scene(
      ['#bfe6f7', '#5aa9d6'],
      [
        ['#4a9bcb', 'M0 500 Q60 480 120 500 T240 500 T360 500 T480 500 V800 H0Z'],
        ['#3a86b8', 'M0 580 Q70 555 140 580 T280 580 T420 580 V800 H0Z'],
        ['#2a6f9f', 'M0 670 Q80 645 160 670 T320 670 T480 670 V800 H0Z'],
      ],
    ),
  ),
  W(
    'forest',
    'Forest',
    'nature',
    scene(
      ['#dcefd9', '#b4d9b0'],
      [
        [
          '#8fbf8a',
          'M0 520 L40 440 L80 520 L130 420 L180 520 L240 430 L290 520 L340 450 L400 520 V800 H0Z',
        ],
        [
          '#5f9e66',
          'M0 620 L50 520 L100 620 L160 500 L220 620 L280 530 L340 620 L400 540 V800 H0Z',
        ],
        ['#3f7d4f', 'M0 720 L60 620 L120 720 L190 610 L250 720 L320 630 L400 720 V800 H0Z'],
      ],
    ),
  ),
  W(
    'sunset',
    'Sunset',
    'nature',
    scene(
      ['#ffb88a', '#8f6bc4'],
      [
        ['#6a4fa8', 'M0 560 Q120 500 240 550 T400 520 V800 H0Z'],
        ['#4a3688', 'M0 660 Q140 600 270 650 T400 630 V800 H0Z'],
      ],
      "<circle cx='200' cy='470' r='70' fill='#ffe2a8' opacity='.9'/>",
    ),
  ),
  W(
    'mountains',
    'Mountains',
    'nature',
    scene(
      ['#e3ecf7', '#f8fbff'],
      [
        ['#b7c6dc', 'M0 520 L90 380 L170 500 L250 360 L340 500 L400 430 V800 H0Z'],
        ['#8ea3c2', 'M0 620 L70 520 L150 620 L240 500 L330 620 L400 560 V800 H0Z'],
        ['#667fa6', 'M0 720 L100 640 L200 720 L300 650 L400 720 V800 H0Z'],
      ],
    ),
  ),

  // Dark and AMOLED
  W('night', 'Night', 'dark', solid('#1d2433')),
  W('midnight', 'Midnight', 'dark', linear(160, '#161b33', '#0d1022')),
  W('amoled', 'AMOLED black', 'dark', solid('#000000')),
  W('ember', 'Ember', 'dark', linear(160, '#2a1620', '#150a12')),
  W('dark-hex', 'Dark hexagons', 'dark', hex('rgba(160,190,255,.12)', '#10141f')),
  W('starfield', 'Starfield', 'dark', stars('#0a0d1a')),

  // Seasonal
  W(
    'spring',
    'Spring',
    'seasonal',
    tile(
      '#f3faee',
      110,
      "<g fill='#f7b6cf'><circle cx='24' cy='26' r='5'/><circle cx='34' cy='26' r='5'/><circle cx='29' cy='18' r='5'/><circle cx='29' cy='34' r='5'/></g><circle cx='29' cy='26' r='3' fill='#ffe08a'/><g fill='#b5dfa6'><ellipse cx='84' cy='80' rx='9' ry='4' transform='rotate(-30 84 80)'/><ellipse cx='92' cy='88' rx='9' ry='4' transform='rotate(30 92 88)'/></g>",
    ),
  ),
  W('summer', 'Summer', 'seasonal', linear(170, '#fff0a8', '#ffc98a', '#ff9db0')),
  W(
    'autumn',
    'Autumn',
    'seasonal',
    tile(
      '#f8ecdc',
      120,
      "<path d='M30 20 q14 -12 28 0 q-4 18 -14 26 q-10 -8 -14 -26z' fill='#e0a064' opacity='.7'/><path d='M80 78 q12 -10 24 0 q-4 16 -12 22 q-8 -6 -12 -22z' fill='#c9744a' opacity='.6'/>",
    ),
  ),
  W(
    'winter',
    'Winter',
    'seasonal',
    tile(
      '#e4eefa',
      100,
      "<g stroke='#fff' stroke-width='1.6' stroke-linecap='round' opacity='.95'><path d='M28 18 v16 M20 26 h16 M22 20 l12 12 M34 20 l-12 12'/><path d='M74 66 v12 M68 72 h12 M70 68 l8 8 M78 68 l-8 8'/></g>",
    ),
  ),
  W(
    'festive',
    'Festive',
    'seasonal',
    confetti(['#e5535b', '#f2c14e', '#4fa571', '#fff'], '#2a3a4f'),
  ),
];

const BY_ID = new Map(WALLPAPERS.map((w) => [w.id, w]));

export const findWallpaper = (id: string | null | undefined): Wallpaper | null =>
  (id ? BY_ID.get(id) : undefined) ?? null;

/** The CSS for a built-in wallpaper id; null for none, unknown or custom ids. */
export const wallpaperStyle = (id: string | null): CSSProperties | null =>
  findWallpaper(id)?.style ?? null;

/** The CSS for a picture from the gallery, given its object URL. */
export const customWallpaperStyle = (url: string): CSSProperties => ({
  backgroundColor: '#222',
  backgroundImage: `url("${url}")`,
  backgroundSize: 'cover',
  backgroundPosition: 'center',
  backgroundRepeat: 'no-repeat',
});
