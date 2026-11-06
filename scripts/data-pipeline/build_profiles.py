import csv, json, os, sys
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(os.path.dirname(HERE))
master = list(csv.DictReader(open(os.path.join(HERE, 'provinces_master.tsv'), encoding='utf-8'), delimiter='\t'))
mp = json.load(open(os.path.join(ROOT, 'data', 'map.json'), encoding='utf-8'))
adj = mp['adjacency']
region_of = {m['id']: m['region'] for m in master}
# region adjacency derived from province land borders (map.json adjacency)
radj = {}
for a, ns in adj.items():
    for b in ns:
        ra, rb = region_of[a], region_of[b]
        if ra != rb:
            radj.setdefault(ra, set()).add(rb); radj.setdefault(rb, set()).add(ra)
radj = {k: sorted(v) for k, v in radj.items()}

COASTAL = set('trat chanthaburi rayong chonburi chachoengsao samut-prakan bangkok samut-sakhon samut-songkhram phetchaburi prachuap-khiri-khan chumphon surat-thani nakhon-si-thammarat songkhla pattani narathiwat ranong phang-nga phuket krabi trang satun'.split())
MUSLIM_MAJORITY = {'pattani', 'yala', 'narathiwat', 'satun'}
MALAY = {'pattani', 'yala', 'narathiwat'}
MOUNTAIN = set('''chiang-mai chiang-rai lampang lamphun mae-hong-son nan phayao phrae uttaradit
tak kanchanaburi ratchaburi phetchaburi prachuap-khiri-khan
loei chaiyaphum nakhon-ratchasima sakon-nakhon
phetchabun uthai-thani kamphaeng-phet phitsanulok nakhon-nayok saraburi sukhothai
chanthaburi trat prachinburi
ranong chumphon surat-thani nakhon-si-thammarat krabi phang-nga phuket trang phatthalung yala narathiwat satun songkhla'''.split())
PLAIN = set('''bangkok nonthaburi pathum-thani ayutthaya ang-thong sing-buri chai-nat suphanburi nakhon-pathom samut-sakhon samut-songkhram samut-prakan lopburi saraburi nakhon-sawan phichit phitsanulok sukhothai kamphaeng-phet uthai-thani nakhon-nayok
khon-kaen maha-sarakham roi-et yasothon ubon-ratchathani sisaket surin buriram udon-thani nong-khai bueng-kan nong-bua-lamphu kalasin mukdahan nakhon-phanom amnat-charoen sakon-nakhon nakhon-ratchasima chaiyaphum
chachoengsao chonburi sa-kaeo prachinburi pattani phatthalung songkhla nakhon-si-thammarat'''.split())
OCC = {  # primary first (draft)
 'bangkok':['บริการ','ท่องเที่ยว'],'nonthaburi':['บริการ'],'pathum-thani':['อุตสาหกรรม'],'samut-prakan':['อุตสาหกรรม'],
 'samut-sakhon':['อุตสาหกรรม','ประมง'],'samut-songkhram':['เกษตร','ประมง'],'ayutthaya':['อุตสาหกรรม','ท่องเที่ยว'],
 'saraburi':['อุตสาหกรรม'],'nakhon-nayok':['เกษตร','ท่องเที่ยว'],'nakhon-pathom':['เกษตร','อุตสาหกรรม'],
 'sukhothai':['เกษตร','ท่องเที่ยว'],'phitsanulok':['เกษตร','บริการ'],
 'chonburi':['อุตสาหกรรม','ท่องเที่ยว'],'rayong':['อุตสาหกรรม'],'chachoengsao':['อุตสาหกรรม','เกษตร'],'prachinburi':['อุตสาหกรรม','เกษตร'],
 'trat':['เกษตร','ท่องเที่ยว'],'kanchanaburi':['เกษตร','ท่องเที่ยว'],'ratchaburi':['เกษตร','อุตสาหกรรม'],
 'phetchaburi':['เกษตร','ท่องเที่ยว'],'prachuap-khiri-khan':['เกษตร','ท่องเที่ยว'],
 'chiang-mai':['เกษตร','ท่องเที่ยว'],'lamphun':['อุตสาหกรรม','เกษตร'],'mae-hong-son':['เกษตร','ท่องเที่ยว'],
 'khon-kaen':['เกษตร','บริการ'],'nakhon-ratchasima':['เกษตร','อุตสาหกรรม'],
 'phuket':['ท่องเที่ยว'],'krabi':['ท่องเที่ยว','เกษตร'],'phang-nga':['เกษตร','ท่องเที่ยว'],'surat-thani':['เกษตร','ท่องเที่ยว'],
 'songkhla':['เกษตร','ประมง'],'pattani':['ประมง','เกษตร'],'satun':['เกษตร','ประมง'],'ranong':['ประมง','เกษตร'],
}
NOTES = {
 'tak':'ภาษาถิ่นตาก/แม่สอด มีลักษณะผสม ต้องตรวจว่าเป็นถิ่นเหนือหรือกลาง',
 'nakhon-ratchasima':'ภาษาโคราช (ไทเบิ้ง) ใกล้ภาษากลาง และมีผู้พูดอีสาน ต้องตรวจ',
 'surin':'มีผู้พูดภาษาเขมรถิ่นไทยจำนวนมาก อาจใช้ค่า "อื่น ๆ"',
 'buriram':'มีผู้พูดภาษาเขมรถิ่นไทยบางส่วน',
 'sisaket':'มีผู้พูดภาษาเขมรถิ่นไทย/กูย บางส่วน',
 'phetchabun':'อำเภอตอนบน (หล่มสัก หล่มเก่า) พูดภาษาถิ่นคล้ายเลย ต้องตรวจ',
 'satun':'ประชากรส่วนใหญ่นับถืออิสลาม แต่ส่วนมากพูดภาษาไทยถิ่นใต้',
 'phatthalung':'ติดทะเลสาบสงขลา ไม่นับเป็นจังหวัดชายฝั่งทะเล',
}
rows = []
for m in master:
    pid = m['id']; r = m['region']
    dialect = {'เหนือ':'เหนือ','อีสาน':'อีสาน','ใต้':'ใต้'}.get(r, 'กลาง')
    if pid in MALAY: dialect = 'มลายูถิ่น'
    terrain = []
    if pid in COASTAL: terrain.append('ติดทะเล')
    if pid in MOUNTAIN: terrain.append('ภูเขา')
    if pid in PLAIN: terrain.append('ที่ราบ')
    if not terrain: terrain = ['ที่ราบ']
    rows.append({
        'id': pid, 'iso': m['iso'], 'name_th': m['name_th'], 'name_en': m['name_en'],
        'region': r, 'adjacent_regions': radj.get(r, []),
        'dialect': dialect,
        'religion_culture': 'อิสลาม' if pid in MUSLIM_MAJORITY else 'พุทธ',
        'terrain': terrain,
        'main_occupation': OCC.get(pid, ['เกษตร']),
        'neighbors': adj.get(pid, []),
        'verified': False,
        **({'note': NOTES[pid]} if pid in NOTES else {}),
    })
out = {
  'status': 'ร่าง — ค่าป้ายทุกจังหวัดยังไม่ได้ตรวจกับแหล่งข้อมูล (verified=false) ห้ามถือเป็นข้อมูลจริงจนกว่าทีมตรวจ',
  'rules': {
    'region': 'แบ่ง 6 ภาคตามคณะกรรมการภูมิศาสตร์แห่งชาติ (ครม. เห็นชอบ 2520) · ภาคติดกัน = มีจังหวัดในสองภาคที่มีพรมแดนทางบกติดกัน (คำนวณจาก map.json)',
    'multi_value_match': {'terrain': 'any — มีค่าร่วมกันอย่างน้อย 1 ค่า', 'main_occupation': 'primary — ค่าแรก (อาชีพหลักอันดับ 1) ตรงกัน'},
    'neighbors': 'จังหวัดที่มีพรมแดนทางบกติดกัน คำนวณจาก topology ของ map.json (ภูเก็ตไม่มี เพราะเป็นเกาะ)'
  },
  'region_adjacency': radj,
  'sources_to_check': [
    'ภาค: ราชบัณฑิตยสภา / คณะกรรมการภูมิศาสตร์แห่งชาติ (2520)',
    'ติดทะเล 23 จังหวัด: กรมทรัพยากรทางทะเลและชายฝั่ง (รายงานฐานข้อมูลการกัดเซาะชายฝั่ง 23 จังหวัด, 2558) และกฎกระทรวงกำหนดเขตทะเลชายฝั่ง 23 จังหวัด',
    'ศาสนา: สำนักงานสถิติแห่งชาติ (สำมะโนประชากร)',
    'ภาษาถิ่น: แผนที่ภาษาของกลุ่มชาติพันธุ์ต่าง ๆ ในประเทศไทย (สุวิไล เปรมศรีรัตน์ และคณะ, 2547)',
    'อาชีพหลัก: ผลิตภัณฑ์มวลรวมจังหวัด (GPP) รายสาขา — สศช.'
  ],
  'provinces': rows
}
json.dump(out, open(os.path.join(ROOT, 'data', 'provinces.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print('region adjacency:', json.dumps(radj, ensure_ascii=False))
import collections
print('dialects', collections.Counter(r['dialect'] for r in rows))
print('coastal', sum('ติดทะเล' in r['terrain'] for r in rows), 'muslim', sum(r['religion_culture']=='อิสลาม' for r in rows))
print(json.dumps([r for r in rows if r['id'] in ('chonburi','phetchaburi')], ensure_ascii=False))
