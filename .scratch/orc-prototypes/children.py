import json, glob, os, datetime, collections

BASE = os.path.expanduser('~/.pi/agent/sessions')
rows = []
for p in glob.glob(os.path.join(BASE, '*', 'subagent-artifacts', '*_meta.json')):
    st = os.path.getmtime(p)
    d = datetime.datetime.fromtimestamp(st)
    if d.date() != datetime.date(2026, 9, 9):
        continue
    try:
        m = json.load(open(p))
    except Exception:
        continue
    m['_proj'] = os.path.basename(os.path.dirname(os.path.dirname(p))).strip('-').replace('Users-jakubszwajka-', '')
    m['_end'] = d
    m['_file'] = os.path.basename(p)
    rows.append(m)

rows.sort(key=lambda r: r['_end'])
print('children today:', len(rows))
tot = 0
cost = 0
print()
hdr = f"{'end':8s} {'agent':10s} {'dur_m':>6s} {'turns':>5s} {'tools':>5s} {'cost$':>6s} {'exit':>4s} {'model':28s} {'attempts'}"
print(hdr)
for r in rows:
    u = r.get('usage') or {}
    dur = (r.get('durationMs') or 0) / 60000
    tot += dur
    cost += u.get('cost') or 0
    att = len(r.get('modelAttempts') or [])
    fails = sum(1 for a in (r.get('modelAttempts') or []) if not a.get('success'))
    mark = '  <-- RETRY' if att > 1 else ''
    err = (r.get('error') or r.get('failureReason') or '')
    print(f"{r['_end'].strftime('%H:%M:%S')} {r.get('agent',''):10s} {dur:6.1f} {(u.get('turns') or 0):5d} {r.get('toolCount') or 0:5d} {u.get('cost') or 0:6.2f} {str(r.get('exitCode')):>4s} {str(r.get('model'))[:28]:28s} {att}/{fails}f{mark} {str(err)[:80]}")
print(f"\nTOTAL child compute {tot:.0f} min  cost ${cost:.2f}")
print()
by = collections.defaultdict(lambda: [0, 0.0, 0.0])
for r in rows:
    k = r.get('agent')
    by[k][0] += 1
    by[k][1] += (r.get('durationMs') or 0) / 60000
    by[k][2] += (r.get('usage') or {}).get('cost') or 0
for k, v in sorted(by.items(), key=lambda kv: -kv[1][1]):
    print(f"{k:12s} n={v[0]:3d} total={v[1]:6.0f}m avg={v[1]/v[0]:5.1f}m cost=${v[2]:6.2f}")
print()
print('models used:', collections.Counter(r.get('model') for r in rows))
print('exit codes:', collections.Counter(r.get('exitCode') for r in rows))
print('signals:', collections.Counter(r.get('processSignal') for r in rows))
