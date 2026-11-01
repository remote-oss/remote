/**
 * @fileoverview family-icon: draws the family icon, a rounded-square tile in one flat colour with a white `>_` (issue
 * #82). The geometry is written here once, in a 256-unit square, and both the SVG and the PNG come from it, so they
 * cannot differ. The PNG is rasterised here (4×4 supersampling) and encoded with node:zlib.
 *
 * `node tools/family-icon.ts` writes the draft options under resources/family-icon-drafts/.
 */

import {mkdirSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {crc32, deflateSync} from 'node:zlib';
import {isMainModule, REPOSITORY_ROOT} from './repository.ts';

/** The side of the square the geometry is written in. */
const UNIT = 256;

/** The number of samples along each side of a pixel. */
const SAMPLES = 4;

const WHITE = 255;

type Point = readonly [number, number];

/** One option for the icon: the tile's colour and corner radius, and the mark's proportions. */
export interface IconDesign {
  name: string;
  /** The tile's colour, `#rrggbb`. */
  colour: string;
  /** The tile's corner radius, in units. */
  radius: number;
  /** The stroke width of the chevron and of the bar, in units. */
  stroke: number;
  /** The chevron's tip and its two ends. */
  chevron: readonly [Point, Point, Point];
  /** The bar's two ends. */
  bar: readonly [Point, Point];
}

/** The draft options: they differ in the tile's colour and corner radius and in the mark's proportions only. */
export const DRAFTS: readonly IconDesign[] = [
  {
    name: 'a-teal',
    colour: '#0e7c7b',
    radius: 56,
    stroke: 22,
    chevron: [
      [128, 128],
      [74, 82],
      [74, 174],
    ],
    bar: [
      [140, 174],
      [196, 174],
    ],
  },
  {
    name: 'b-violet',
    colour: '#6b3fc4',
    radius: 40,
    stroke: 18,
    chevron: [
      [124, 128],
      [66, 78],
      [66, 178],
    ],
    bar: [
      [136, 178],
      [200, 178],
    ],
  },
  {
    name: 'c-orange',
    colour: '#d4470c',
    radius: 76,
    stroke: 28,
    chevron: [
      [132, 124],
      [80, 82],
      [80, 166],
    ],
    bar: [
      [144, 170],
      [186, 170],
    ],
  },
];

/** The chevron as the two segments from its ends to its tip, and the bar, as the segments the mark is drawn with. */
function segmentsOf(design: IconDesign): Array<readonly [Point, Point]> {
  const [tip, upper, lower] = design.chevron;
  return [[upper, tip], [tip, lower], design.bar];
}

/** The SVG of the design: the tile and the mark, both stroked with round ends and joins. */
export function svgOf(design: IconDesign): string {
  const [tip, upper, lower] = design.chevron;
  const [barStart, barEnd] = design.bar;
  const mark = `fill="none" stroke="#ffffff" stroke-width="${design.stroke}" stroke-linecap="round" stroke-linejoin="round"`;
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${UNIT}" height="${UNIT}" viewBox="0 0 ${UNIT} ${UNIT}">`,
    `  <rect width="${UNIT}" height="${UNIT}" rx="${design.radius}" fill="${design.colour}"/>`,
    `  <path d="M${upper[0]} ${upper[1]}L${tip[0]} ${tip[1]}L${lower[0]} ${lower[1]}" ${mark}/>`,
    `  <path d="M${barStart[0]} ${barStart[1]}L${barEnd[0]} ${barEnd[1]}" ${mark}/>`,
    '</svg>',
    '',
  ].join('\n');
}

/** The distance from `point` to the segment between `start` and `end`. */
function distanceToSegment(point: Point, start: Point, end: Point): number {
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const along = Math.max(
    0,
    Math.min(
      1,
      ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) /
        (dx * dx + dy * dy),
    ),
  );
  return Math.hypot(
    point[0] - (start[0] + along * dx),
    point[1] - (start[1] + along * dy),
  );
}

/** Whether `point` is inside the tile: the square with corners of radius `radius`. */
function inTile(point: Point, radius: number): boolean {
  const cornerX = Math.min(point[0], UNIT - point[0]);
  const cornerY = Math.min(point[1], UNIT - point[1]);
  if (cornerX >= radius || cornerY >= radius) {
    return (
      point[0] >= 0 && point[0] <= UNIT && point[1] >= 0 && point[1] <= UNIT
    );
  }
  return Math.hypot(radius - cornerX, radius - cornerY) <= radius;
}

/** The colour of `colour` (`#rrggbb`) as its three channels. */
function channelsOf(colour: string): [number, number, number] {
  return [1, 3, 5].map(start =>
    Number.parseInt(colour.slice(start, start + 2), 16),
  ) as [number, number, number];
}

/** The RGBA pixels of the design at `size` pixels a side, row by row. */
export function pixelsOf(design: IconDesign, size: number): Uint8Array {
  const pixels = new Uint8Array(size * size * 4);
  const scale = UNIT / size;
  const segments = segmentsOf(design);
  const tile = channelsOf(design.colour);
  for (let row = 0; row < size; row += 1) {
    for (let column = 0; column < size; column += 1) {
      let tileHits = 0;
      let markHits = 0;
      for (let down = 0; down < SAMPLES; down += 1) {
        for (let across = 0; across < SAMPLES; across += 1) {
          const point: Point = [
            (column + (across + 0.5) / SAMPLES) * scale,
            (row + (down + 0.5) / SAMPLES) * scale,
          ];
          if (inTile(point, design.radius)) {
            tileHits += 1;
            if (
              segments.some(
                ([start, end]) =>
                  distanceToSegment(point, start, end) <= design.stroke / 2,
              )
            ) {
              markHits += 1;
            }
          }
        }
      }
      const offset = (row * size + column) * 4;
      if (tileHits > 0) {
        const tileOnly = tileHits - markHits;
        for (let channel = 0; channel < 3; channel += 1) {
          pixels[offset + channel] = Math.round(
            ((tile[channel] ?? 0) * tileOnly + WHITE * markHits) / tileHits,
          );
        }
        pixels[offset + 3] = Math.round(
          (WHITE * tileHits) / (SAMPLES * SAMPLES),
        );
      }
    }
  }
  return pixels;
}

/** A PNG chunk: its length, its type, its data and the CRC of the type and the data. */
function chunkOf(type: string, data: Uint8Array): Buffer {
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const chunk = Buffer.alloc(body.length + 8);
  chunk.writeUInt32BE(data.length, 0);
  body.copy(chunk, 4);
  chunk.writeUInt32BE(crc32(body), body.length + 4);
  return chunk;
}

/** The PNG file of the design at `size` pixels a side: 8-bit RGBA, no interlace, filter 0. */
export function pngOf(design: IconDesign, size: number): Buffer {
  const pixels = pixelsOf(design, size);
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header.set([8, 6, 0, 0, 0], 8);
  const rowLength = size * 4;
  const raw = Buffer.alloc(size * (rowLength + 1));
  for (let row = 0; row < size; row += 1) {
    raw.set(
      pixels.subarray(row * rowLength, (row + 1) * rowLength),
      row * (rowLength + 1) + 1,
    );
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunkOf('IHDR', header),
    chunkOf('IDAT', deflateSync(raw, {level: 9})),
    chunkOf('IEND', new Uint8Array()),
  ]);
}

/** Writes each draft's SVG and its 256 px PNG preview into `directory`. */
export function writeDrafts(directory: string): string[] {
  mkdirSync(directory, {recursive: true});
  return DRAFTS.flatMap(design => {
    const svg = path.join(directory, `family-icon-${design.name}.svg`);
    const png = path.join(directory, `family-icon-${design.name}.png`);
    writeFileSync(svg, svgOf(design));
    writeFileSync(png, pngOf(design, UNIT));
    return [svg, png];
  });
}

if (isMainModule(import.meta.url)) {
  const written = writeDrafts(
    path.join(REPOSITORY_ROOT, 'resources', 'family-icon-drafts'),
  );
  console.log(
    written.map(file => path.relative(REPOSITORY_ROOT, file)).join('\n'),
  );
}
