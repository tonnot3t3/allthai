// V2 map: 928 districts (อำเภอ/เขต) + 77 province outlines + neighbouring countries, projected to one SVG viewBox.
//
// Inputs (run from a folder that has them, with `npm i d3-geo polylabel`):
//   districts_s.geojson   COD-AB ADM2 (Royal Thai Survey Department via OCHA/HDX, CC BY-IGO), simplified with
//                         mapshaper -simplify 1.8% weighted keep-shapes -clean
//   provinces_s.geojson   the same layer after -dissolve ADM1_PCODE (so province borders match district borders)
//   neighbors.geojson     Natural Earth 1:50m admin-0 for MMR LAO KHM MYS VNM CHN (public domain)
//   geothai_districts.json [[code, name_th, name_en], …] from @geothai/core (DOPA names, CC BY 4.0) — fixes names
//                         that COD-AB truncates at 48 bytes (e.g. เมืองประจวบคีรีข → เมืองประจวบคีรีขันธ์)
//   provinces.json        the game's province list (slug ids, Thai names, ISO codes)
// Output: map.json  { version: 2, viewBox, provinces[], districts[], neighbors[], attribution }
//
//   node build_map_v2.mjs <provinces.json> <out map.json>
import fs from 'fs';
import { geoMercator, geoPath, geoArea } from 'd3-geo';
import polylabel from 'polylabel';

const [provFile = 'provinces.json', outFile = 'map.json'] = process.argv.slice(2);
const W = 600, H = 1080, PAD = 14;
const read = f => JSON.parse(fs.readFileSync(f, 'utf8'));
const dist = read('districts_s.geojson'), prov = read('provinces_s.geojson'), nbr = read('neighbors.geojson');
const names = Object.fromEntries(read('geothai_districts.json').map(([c, th, en]) => [c, { th: th.replace(/^เขต/, ''), en }]));
const game = read(provFile).provinces;
const slugByIso = Object.fromEntries(game.map(p => ['TH' + p.iso.slice(3), p]));

// d3-geo wants clockwise exterior rings; flip any feature whose spherical area exceeds a hemisphere
function rewind(fc) {
  for (const f of fc.features) {
    if (geoArea(f) > 2 * Math.PI) {
      const g = f.geometry;
      for (const poly of g.type === 'Polygon' ? [g.coordinates] : g.coordinates) for (const ring of poly) ring.reverse();
    }
  }
}
[dist, prov, nbr].forEach(rewind);

const proj = geoMercator().fitExtent([[PAD, PAD], [W - PAD, H - PAD]], prov);
const path = geoPath(proj).digits(1);
const r1 = v => Math.round(v * 10) / 10;
const r4 = v => Math.round(v * 1e4) / 1e4;

// label anchor = pole of inaccessibility of the largest polygon, in projected units
function anchor(f) {
  const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
  let best = null, bestA = -1;
  for (const p of polys) {
    const a = path.area({ type: 'Polygon', coordinates: p });
    if (a > bestA) { bestA = a; best = p; }
  }
  return polylabel(best.map(ring => ring.map(pt => proj(pt))), 0.2);
}

const provinces = prov.features.map(f => {
  const g = slugByIso[f.properties.ADM1_PCODE];
  if (!g) throw new Error('unknown province ' + f.properties.ADM1_PCODE);
  const a = anchor(f), b = path.bounds(f);
  return { id: g.id, pcode: f.properties.ADM1_PCODE, d: path(f), label: [r1(a[0]), r1(a[1])], bbox: b.flat().map(r1) };
}).sort((a, b) => a.pcode.localeCompare(b.pcode));

const districts = dist.features.map(f => {
  const code = f.properties.ADM2_PCODE, nm = names[code.slice(2)];
  if (!nm) throw new Error('no name for ' + code);
  const g = slugByIso[f.properties.ADM1_PCODE];
  const a = anchor(f), b = path.bounds(f), ll = proj.invert(a);
  return { id: code, p: g.id, n: nm.th, en: nm.en, d: path(f), label: [r1(a[0]), r1(a[1])], bbox: b.flat().map(r1), ll: [r4(ll[1]), r4(ll[0])] };
}).sort((a, b) => a.id.localeCompare(b.id));

const neighbors = nbr.features.map(f => ({ name: f.properties.NAME_TH || f.properties.NAME, iso3: f.properties.ADM0_A3, d: path(f) })).filter(n => n.d);

const out = {
  version: 2,
  attribution: {
    districts: 'ขอบเขตอำเภอ/เขตและจังหวัด: กรมแผนที่ทหาร (Royal Thai Survey Department) ผ่าน OCHA / HDX “Thailand – Subnational Administrative Boundaries” (CC BY-IGO) · ปรับให้เรียบและฉายแผนที่โดยออลไทย',
    names: 'ชื่ออำเภอ/เขต: กรมการปกครอง ผ่าน GeoThai/data (CC BY 4.0)',
    neighbors: 'ประเทศเพื่อนบ้าน: Natural Earth 1:50m (public domain)'
  },
  projection: 'Mercator fitExtent [[14,14],[586,1066]] on the 77 dissolved provinces',
  viewBox: [0, 0, W, H],
  provinces, districts, neighbors
};
fs.writeFileSync(outFile, JSON.stringify(out));
const kb = Math.round(fs.statSync(outFile).size / 1024);
const bkk = districts.filter(d => d.p === 'bangkok');
console.log('districts', districts.length, 'provinces', provinces.length, 'neighbors', neighbors.length, kb + ' KB',
  '| smallest bbox', districts.map(d => [d.n, Math.max(d.bbox[2] - d.bbox[0], d.bbox[3] - d.bbox[1])]).sort((a, b) => a[1] - b[1]).slice(0, 4).map(x => x[0] + ' ' + x[1].toFixed(1)).join(', '),
  '| bangkok khets', bkk.length);
