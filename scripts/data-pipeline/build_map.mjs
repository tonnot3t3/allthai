import fs from 'fs';
import { geoMercator, geoPath, geoBounds, geoArea } from 'd3-geo';
import polylabel from 'polylabel';
const SIMPLIFIED = process.argv[2] || 'prov_10%.geojson';
const master = fs.readFileSync('provinces_master.tsv','utf8').trim().split('\n').slice(1).map(l => { const [iso,id,name_th,name_en,region] = l.split('\t'); return {iso,id,name_th,name_en,region}; });
const byIso = Object.fromEntries(master.map(m => [m.iso, m]));
const prov = JSON.parse(fs.readFileSync(SIMPLIFIED,'utf8'));
const nbr = JSON.parse(fs.readFileSync('neighbors.geojson','utf8'));
// d3-geo expects clockwise exterior rings; reverse any feature whose spherical area > hemisphere
function rewind(fc) { let n = 0; for (const f of fc.features) { if (geoArea(f) > 2 * Math.PI) { n++; const g = f.geometry; const polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates; for (const p of polys) for (const ring of p) ring.reverse(); } } return n; }
console.log('rewound provinces', rewind(prov), 'neighbors', rewind(nbr));
const W = 600, H = 1080, PAD = 14;
const proj = geoMercator().fitExtent([[PAD, PAD], [W - PAD, H - PAD]], prov);
const path = geoPath(proj).digits(1);
const r1 = v => Math.round(v * 10) / 10;
const provinces = prov.features.map(f => {
  const m = byIso[f.properties.shapeISO];
  if (!m) throw new Error('unknown ' + f.properties.shapeISO);
  const d = path(f);
  const b = path.bounds(f);
  // label anchor = pole of inaccessibility of the largest polygon (projected)
  const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
  let best = null, bestA = -1;
  for (const p of polys) { const g = {type:'Polygon', coordinates:p}; const a = path.area(g); if (a > bestA) { bestA = a; best = p; } }
  const projected = best.map(ring => ring.map(pt => proj(pt)));
  const lab = polylabel(projected, 0.5);
  return { id: m.id, iso: m.iso, d, label: [r1(lab[0]), r1(lab[1])], bbox: b.flat().map(r1), area: Math.round(path.area(f)) };
}).sort((a, b) => a.iso.localeCompare(b.iso));
const neighbors = nbr.features.map(f => ({ name: f.properties.NAME_TH || f.properties.NAME, iso3: f.properties.ADM0_A3, d: path(f) })).filter(n => n.d);
const adjacency = JSON.parse(fs.readFileSync('adjacency.json','utf8'));
const isoToId = Object.fromEntries(master.map(m => [m.iso, m.id]));
const adj = Object.fromEntries(Object.entries(adjacency).map(([k, v]) => [isoToId[k], v.map(x => isoToId[x])]));
const out = {
  attribution: {
    provinces: 'ขอบเขตจังหวัด © OpenStreetMap contributors (ODbL 1.0) ผ่าน geoBoundaries (wmgeolab, THA-ADM1 2017, build Dec 2023) · ปรับให้เรียบโดยออลไทย ไฟล์นี้เผยแพร่ภายใต้ ODbL 1.0',
    neighbors: 'ประเทศเพื่อนบ้าน: Natural Earth 1:50m (public domain)'
  },
  projection: 'Mercator fitExtent [[14,14],[586,1066]] on Thailand ADM1',
  viewBox: [0, 0, W, H],
  provinces, neighbors, adjacency: adj
};
fs.writeFileSync(process.argv[3] || new URL('../../data/map.json', import.meta.url).pathname, JSON.stringify(out));
const size = fs.statSync(process.argv[3] || new URL('../../data/map.json', import.meta.url).pathname).size;
const tiny = provinces.slice().sort((a,b)=>a.area-b.area).slice(0,6).map(p=>p.id+':'+p.area);
console.log('provinces', provinces.length, 'neighbors', neighbors.length, 'bytes', size, 'smallest', tiny.join(' '));
