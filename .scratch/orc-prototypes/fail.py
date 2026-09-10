import json, glob, os, datetime, collections, re

BASE = os.path.expanduser('~/.pi/agent/sessions')
rows = []
for p in glob.glob(os.path.join(BASE, '*', 'subagent-artifacts', '*_meta.json')):
    d = datetime.datetime.fromtimestamp(os.path.getmtime(p))
    if d.date() != datetime.date(2026, 9, 9):
        continue
    try:
        m = json.load(open(p))
    except Exception:
        continue
    m['_p'] = p
    m['_end'] = d
    m['_proj'] = os.path.basename(os.path.dirname(os.path.dirname(p))).strip('-').replace('Users-jakubszwajka-', '')
    rows.append(m)
rows.sort(key=lambda r: r['_end'])


def bucket(msg):
    m = (msg or '').lower()
    if 'timed out after' in m:
        return 'run timeout'
    if 'exceeded its timeout' in m:
        return 'tool timeout'
    if 'file-only output was not produced' in m:
        return 'output contract: file-only'
    if 'structured' in m:
        return 'output contract: structured'
    if 'failed to load extension' in m:
        return 'extension load'
    if 'credentials' in m:
        return 'provider auth'
    if 'rate_limit' in m or '429' in m:
        return 'provider 429'
    if 'unavailable child tools' in m:
        return 'tool capability mismatch'
    if 'stopped by user' in m:
        return 'stopped by user'
    return 'other: ' + (msg or '')[:60].replace('\n', ' ')


# attempt-level view
att_rows = []
for r in rows:
    for i, a in enumerate(r.get('modelAttempts') or []):
        att_rows.append((r, i, a))
print('runs:', len(rows), ' attempts:', len(att_rows))
fails = [(r, i, a) for r, i, a in att_rows if not a.get('success')]
print('failed attempts:', len(fails), f'({len(fails)/len(att_rows)*100:.0f}%)')
print()
c = collections.Counter()
detail = collections.defaultdict(list)
for r, i, a in fails:
    msg = a.get('error') or a.get('failureReason') or r.get('error') or ''
    if isinstance(msg, dict):
        msg = json.dumps(msg)
    b = bucket(str(msg))
    c[b] += 1
    detail[b].append((r['_end'].strftime('%H:%M'), r.get('agent'), r['_proj'][:22], str(msg)[:110].replace('\n', ' ')))
for k, v in c.most_common():
    print(f'{v:3d}  {k}')
    for d in detail[k][:6]:
        print('       ', d)
print()

# how long did failures burn
print('--- wasted time by failure bucket (durationMs of failed runs)')
w = collections.Counter()
for r in rows:
    if r.get('exitCode') == 0:
        continue
    msg = str(r.get('error') or '')
    mm = re.search(r'timed out after (\d+)ms', msg)
    dur = int(mm.group(1)) / 60000 if mm else (r.get('durationMs') or 0) / 60000
    w[bucket(msg)] += dur
for k, v in w.most_common():
    print(f'  {v:7.1f} min  {k}')
print(f'  TOTAL {sum(w.values()):.0f} min burned on failed children')
print()
print('--- retried runs (attempts > 1)')
for r in rows:
    a = r.get('modelAttempts') or []
    if len(a) > 1:
        print(r['_end'].strftime('%H:%M'), r.get('agent'), r['_proj'][:20],
              [(x.get('model'), x.get('success'), str(x.get('error'))[:70].replace('\n', ' ')) for x in a])
