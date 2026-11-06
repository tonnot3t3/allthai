#!/usr/bin/env python3
"""Build the two connected sites from src/ (no dependencies beyond Python 3).

    python3 scripts/build.py [--share-url URL] [--site-url URL]

dist/play     เว็บเล่นเกม     → deploy as one Vercel project
dist/admin    เว็บใส่ข้อมูล   → deploy as a second Vercel project
dist/pages    both sites for GitHub Pages: game at the site root, team site at /admin/ (built when a site URL is known)
dist/preview  both sites in one page (#admin), demo mode only — for trying the flow without a server

config/site.json (optional): {"siteUrl", "supabaseUrl", "supabaseKey", "googleSiteVerification"}
  supabase values go into every config.js except the preview; siteUrl/googleSiteVerification drive dist/pages.
config/play.config.js, config/admin.config.js (optional) override dist/<site>/config.js as-is.
supabase/seed.sql is regenerated from data/*.json (questions arrive as drafts).
"""
import argparse, datetime, html, json, os, shutil

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DIST = os.path.join(ROOT, 'dist')


def read(rel):
    with open(os.path.join(ROOT, rel), encoding='utf-8') as f:
        return f.read()


def fill(tpl, parts):
    for marker, value in parts.items():
        assert marker in tpl, 'missing placeholder ' + marker
        assert '</script' not in value.lower() or marker.startswith('<!--'), marker + ' contains </script>'
        tpl = tpl.replace(marker, value)
    return tpl


CONFIG_JS = """// ออลไทย · ตั้งค่าการเชื่อมต่อ (แก้ไฟล์นี้ได้เลย ไม่ต้อง build ใหม่)
// ปล่อย supabaseUrl/supabaseKey ว่าง = โหมดสาธิต: ข้อมูลอยู่ในเบราว์เซอร์ที่เปิดเท่านั้น
window.ALLTHAI_CONFIG = {
  supabaseUrl: %(url)s,   // Supabase → Project Settings → Data API → Project URL เช่น https://abcd1234.supabase.co
  supabaseKey: %(key)s,   // Supabase → Project Settings → API Keys → Publishable key (sb_publishable_…) ห้ามใช้ secret key
  playUrl: %(play)s,      // ที่อยู่เว็บเล่นเกม (ปุ่ม “เปิดเว็บเล่นเกม” ในเว็บใส่ข้อมูล)
  shareUrl: %(share)s     // ลิงก์ท้ายข้อความแชร์ผล (ว่าง = ใช้ที่อยู่ของหน้าเว็บ)
};
"""

PREVIEW_CSS = """
/* preview only: a bar to switch between the two sites */
.pv-bar { position: fixed; left: 0; right: 0; top: 0; height: calc(40px + env(safe-area-inset-top)); padding: env(safe-area-inset-top) 10px 0; z-index: 90; display: flex; align-items: center; justify-content: center; gap: 10px; background: #211E1A; color: #E9E2D4; font-family: var(--font-body); font-size: 13px; }
.pv-bar span { opacity: .8; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.pv-bar nav { display: flex; gap: 2px; background: #3A352E; border-radius: 999px; padding: 3px; flex: none; }
.pv-bar a { color: #E9E2D4; text-decoration: none; padding: 3px 12px; border-radius: 999px; white-space: nowrap; }
.pv-bar a.on { background: #fff; color: #211E1A; font-weight: 600; }
.pv-bar a:focus-visible { outline: 2px solid var(--amber); outline-offset: 1px; }
body.pv #app { height: calc(100% - 40px - env(safe-area-inset-top)); margin-top: calc(40px + env(safe-area-inset-top)); }
body.pv #app .screen { padding-top: 20px; }
body.pv #admin-app { top: calc(40px + env(safe-area-inset-top)); }
@media (max-width: 520px) { .pv-bar span { display: none; } }
"""

PREVIEW_BODY = """<div class="pv-bar"><span>ตัวอย่างระบบ 2 เว็บ · โหมดสาธิต ข้อมูลอยู่ในเบราว์เซอร์นี้</span>
<nav aria-label="สลับเว็บ"><a href="#" id="pv-play">เว็บเล่นเกม</a><a href="#admin" id="pv-admin">เว็บใส่ข้อมูล</a></nav></div>
"""

PREVIEW_ROUTER = """<script>
(function () {
  document.body.classList.add('pv');
  function route() {
    var admin = location.hash === '#admin';
    document.getElementById('app').hidden = admin;
    document.getElementById('admin-app').hidden = !admin;
    document.getElementById('pv-play').classList.toggle('on', !admin);
    document.getElementById('pv-admin').classList.toggle('on', admin);
    if (admin) AllThaiAdmin.mount(); else if (window.AllThaiPlay) AllThaiPlay.refresh();
  }
  window.addEventListener('hashchange', route);
  route();
})();
</script>"""

VERCEL_PLAY = {"headers": [{"source": "/img/(.*)", "headers": [{"key": "Cache-Control", "value": "public, max-age=604800"}]}]}
VERCEL_ADMIN = {"headers": [{"source": "/(.*)", "headers": [
    {"key": "X-Robots-Tag", "value": "noindex, nofollow"},
    {"key": "X-Frame-Options", "value": "DENY"},
    {"key": "Referrer-Policy", "value": "same-origin"}]}]}


def copy_assets(out, data_files, with_vendor, with_img=True):
    os.makedirs(os.path.join(out, 'data'), exist_ok=True)
    for name in data_files:
        shutil.copy2(os.path.join(ROOT, 'data', name), os.path.join(out, 'data', name))
    if with_img:
        shutil.copytree(os.path.join(ROOT, 'img'), os.path.join(out, 'img'))
    if with_vendor:
        os.makedirs(os.path.join(out, 'vendor'), exist_ok=True)
        for name in ('supabase.js', 'supabase-js.LICENSE'):
            shutil.copy2(os.path.join(ROOT, 'vendor', name), os.path.join(out, 'vendor', name))


def write(path, text):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'w', encoding='utf-8') as f:
        f.write(text)


SITE = {}


def config(site, play='', share=''):
    """config/<site>.config.js wins when it exists, so a rebuild never wipes real connection settings."""
    own = os.path.join(ROOT, 'config', site + '.config.js')
    if site != 'preview' and os.path.exists(own):
        return read(os.path.relpath(own, ROOT))
    live = site != 'preview'
    return CONFIG_JS % {'url': json.dumps(SITE.get('supabaseUrl', '') if live else ''), 'key': json.dumps(SITE.get('supabaseKey', '') if live else ''),
                        'play': json.dumps(play), 'share': json.dumps(share)}


DESCRIPTION = 'เกมทายสถานที่ท่องเที่ยวทั่วไทยจากภาพและเบาะแส ตอบถึงระดับอำเภอบนแผนที่ 928 อำเภอและเขต ยิ่งใกล้ยิ่งได้คะแนน เล่นฟรีวันละ 5 ข้อ หรือเล่นต่อแบบไม่จำกัด'
ICONS = ['favicon.svg', 'favicon-48.png', 'apple-touch-icon.png', 'icon-512.png', 'og-image.png']


def seo_head(site_url='', google_verify=''):
    e = lambda v: html.escape(v, quote=True)
    tags = ['<meta name="description" content="%s">' % e(DESCRIPTION),
            '<meta name="theme-color" content="#2F6B3B">',
            '<link rel="icon" href="favicon.svg" type="image/svg+xml">',
            '<link rel="icon" href="favicon-48.png" sizes="48x48" type="image/png">',
            '<link rel="apple-touch-icon" href="apple-touch-icon.png">']
    if site_url:
        title = 'ออลไทย — เกมทายที่เที่ยวทั่วไทย ระดับอำเภอ'
        tags += ['<link rel="canonical" href="%s">' % e(site_url),
                 '<meta property="og:type" content="website">',
                 '<meta property="og:site_name" content="ออลไทย">',
                 '<meta property="og:locale" content="th_TH">',
                 '<meta property="og:title" content="%s">' % e(title),
                 '<meta property="og:description" content="%s">' % e(DESCRIPTION),
                 '<meta property="og:url" content="%s">' % e(site_url),
                 '<meta property="og:image" content="%s">' % e(site_url + 'og-image.png'),
                 '<meta property="og:image:width" content="1200">',
                 '<meta property="og:image:height" content="630">',
                 '<meta property="og:image:alt" content="ออลไทย ทายที่เที่ยวทั่วไทย ระดับอำเภอ">',
                 '<meta name="twitter:card" content="summary_large_image">',
                 '<script type="application/ld+json">%s</script>' % json.dumps({
                     '@context': 'https://schema.org', '@type': 'WebSite', 'name': 'ออลไทย', 'alternateName': 'All Thai',
                     'url': site_url, 'inLanguage': 'th', 'description': DESCRIPTION}, ensure_ascii=False)]
    if google_verify:
        tags.append('<meta name="google-site-verification" content="%s">' % e(google_verify))
    return '\n'.join(tags)


def districts_json():
    m = json.loads(read('data/map.json'))
    return json.dumps({'districts': [{k: d[k] for k in ('id', 'p', 'n', 'en', 'll')} for d in m['districts']]}, ensure_ascii=False, separators=(',', ':'))


def copy_icons(out, names=ICONS):
    for name in names:
        shutil.copy2(os.path.join(ROOT, 'assets', name), os.path.join(out, name))


def seed_sql():
    q = json.loads(read('data/questions.json'))
    p = json.loads(read('data/provinces.json'))
    def lit(obj):
        s = json.dumps(obj, ensure_ascii=False, separators=(',', ':'))
        assert '$j$' not in s
        return '$j$' + s + '$j$::jsonb'
    def sq(s):
        return "'" + s.replace("'", "''") + "'"
    out = ['-- ออลไทย · ข้อมูลตั้งต้น (สร้างจาก data/*.json โดย scripts/build.py)',
           '-- รันหลัง schema.sql · รันซ้ำได้ ไม่เขียนทับข้อมูลที่มีอยู่',
           '-- คำถามเข้ามาเป็น "ร่าง" (draft) ตามกฎห้ามเผยแพร่ข้อมูลที่ยังไม่ได้ตรวจ: เปิดเว็บใส่ข้อมูล ตรวจแต่ละข้อ แล้วกดเผยแพร่',
           '', 'insert into public.provinces (id, data, verified) values']
    rows = ['  (%s, %s, %s)' % (sq(x['id']), lit(x), 'true' if x.get('verified') else 'false') for x in p['provinces']]
    out.append(',\n'.join(rows))
    out += ['on conflict (id) do nothing;', '', 'insert into public.questions (id, category, status, data) values']
    rows = []
    for x in q['questions']:
        d = dict(x, status='draft', published_at=None)
        rows.append('  (%s, %s, %s, %s)' % (sq(d['id']), sq(d['category']), "'draft'", lit(d)))
    out.append(',\n'.join(rows))
    out += ['on conflict (id) do nothing;', '']
    return '\n'.join(out), len(p['provinces']), len(q['questions'])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--share-url', default='', help='link appended to shared results in the preview build')
    ap.add_argument('--site-url', default='', help='public URL of the GitHub Pages site (overrides config/site.json)')
    args = ap.parse_args()
    site_file = os.path.join(ROOT, 'config', 'site.json')
    if os.path.exists(site_file):
        SITE.update(json.loads(read('config/site.json')))
    site_url = args.site_url or SITE.get('siteUrl', '')
    if site_url and not site_url.endswith('/'):
        site_url += '/'
    live = bool(SITE.get('supabaseUrl') and SITE.get('supabaseKey'))

    scoring, backend = read('src/shared/scoring.js'), read('src/shared/backend.js')
    play_css, play_js, play_tpl = read('src/play/style.css'), read('src/play/app.js'), read('src/play/template.src.html')
    admin_css, admin_js, admin_tpl, admin_body = read('src/admin/style.css'), read('src/admin/app.js'), read('src/admin/template.src.html'), read('src/admin/body.html')
    assert "const SHARE_URL_BUILD = '';" in play_js

    if os.path.exists(DIST):
        shutil.rmtree(DIST)

    # เว็บเล่นเกม
    play_parts = {'/*@@STYLE@@*/': play_css, '/*@@SCORING@@*/': scoring, '/*@@BACKEND@@*/': backend, '/*@@APP@@*/': play_js}
    play_html = fill(play_tpl, dict(play_parts, **{'<!--@@HEAD@@-->': seo_head()}))
    out = os.path.join(DIST, 'play')
    write(os.path.join(out, 'index.html'), play_html)
    write(os.path.join(out, 'config.js'), config('play'))
    write(os.path.join(out, 'vercel.json'), json.dumps(VERCEL_PLAY, indent=2) + '\n')
    copy_assets(out, ['questions.json', 'provinces.json', 'map.json'], with_vendor=True)
    copy_icons(out)

    # เว็บใส่ข้อมูล
    admin_html = fill(admin_tpl, {'/*@@STYLE@@*/': admin_css, '<!--@@BODY@@-->': admin_body, '/*@@SCORING@@*/': scoring, '/*@@BACKEND@@*/': backend, '/*@@APP@@*/': admin_js})
    out = os.path.join(DIST, 'admin')
    write(os.path.join(out, 'index.html'), admin_html)
    write(os.path.join(out, 'config.js'), config('admin', play='../play/'))
    write(os.path.join(out, 'vercel.json'), json.dumps(VERCEL_ADMIN, indent=2) + '\n')
    copy_assets(out, ['questions.json', 'provinces.json'], with_vendor=True)
    write(os.path.join(out, 'data', 'districts.json'), districts_json())
    copy_icons(out, ['favicon.svg'])

    # GitHub Pages: game at the root, team site at /admin/ (same Supabase project)
    if site_url:
        out = os.path.join(DIST, 'pages')
        pg_js = play_js.replace("const SHARE_URL_BUILD = '';", 'const SHARE_URL_BUILD = ' + json.dumps(site_url) + ';')
        write(os.path.join(out, 'index.html'), fill(play_tpl, dict(play_parts, **{'/*@@APP@@*/': pg_js, '<!--@@HEAD@@-->': seo_head(site_url, SITE.get('googleSiteVerification', ''))})))
        write(os.path.join(out, 'config.js'), config('play', share=site_url))
        # with a live database the game never reads the bundled draft questions, so they are not shipped with it
        copy_assets(out, (['provinces.json', 'map.json'] if live else ['questions.json', 'provinces.json', 'map.json']), with_vendor=live)
        copy_icons(out)
        write(os.path.join(out, 'sitemap.xml'), '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
              '  <url><loc>%s</loc><lastmod>%s</lastmod></url>\n</urlset>\n' % (html.escape(site_url), datetime.date.today().isoformat()))
        write(os.path.join(out, '.nojekyll'), '')
        adm = os.path.join(out, 'admin')
        write(os.path.join(adm, 'index.html'), admin_html)
        write(os.path.join(adm, 'config.js'), config('admin', play='../'))
        copy_assets(adm, ['questions.json', 'provinces.json'], with_vendor=live)
        write(os.path.join(adm, 'data', 'districts.json'), districts_json())
        copy_icons(adm, ['favicon.svg'])

    # ตัวอย่างรวม 2 เว็บ (โหมดสาธิต)
    pv_js = play_js.replace("const SHARE_URL_BUILD = '';", 'const SHARE_URL_BUILD = ' + json.dumps(args.share_url) + ';')
    pv = fill(play_tpl, {'/*@@STYLE@@*/': play_css + '\n' + admin_css + '\n' + PREVIEW_CSS, '/*@@SCORING@@*/': scoring, '/*@@BACKEND@@*/': backend, '/*@@APP@@*/': pv_js, '<!--@@HEAD@@-->': ''})
    pv = pv.replace('<div id="app">', PREVIEW_BODY + '<div id="app">', 1)
    pv = pv.replace('<script src="config.js"></script>', admin_body + '\n<script src="config.js"></script>', 1)
    pv = pv.replace('</body>', '<script>\n' + admin_js + '\n</script>\n' + PREVIEW_ROUTER + '\n</body>', 1)
    out = os.path.join(DIST, 'preview')
    write(os.path.join(out, 'index.html'), pv)
    write(os.path.join(out, 'config.js'), config('preview', play='#', share=args.share_url))
    copy_assets(out, ['questions.json', 'provinces.json', 'map.json'], with_vendor=False)
    write(os.path.join(out, 'data', 'districts.json'), districts_json())

    sql, n_prov, n_q = seed_sql()
    write(os.path.join(ROOT, 'supabase', 'seed.sql'), sql)

    for site in ('play', 'admin', 'pages', 'preview'):
        d = os.path.join(DIST, site)
        if not os.path.isdir(d):
            continue
        total = sum(os.path.getsize(os.path.join(dp, f)) for dp, _, fs in os.walk(d) for f in fs)
        print('%-8s index.html %4d KB · folder %5d KB' % (site, os.path.getsize(os.path.join(d, 'index.html')) // 1024, total // 1024))
    print('seed.sql  %d provinces + %d questions (draft)' % (n_prov, n_q))
    print('database  %s · pages %s' % ('Supabase ' + SITE['supabaseUrl'] if live else 'demo mode (no config/site.json keys)', site_url or '(not built: no site URL)'))


if __name__ == '__main__':
    main()
