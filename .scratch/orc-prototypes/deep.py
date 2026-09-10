import json, glob, os, datetime, collections

BASE = os.path.expanduser('~/.pi/agent/sessions')

def metas():
    out = []
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
        out.append(m)
    return sorted(out, key=lambda r: r['_end'])

def tr(p):
    tp = p.replace('_meta.json', '_transcript.jsonl')
    if not os.path.exists(tp):
        return []
    return [json.loads(l) for l in open(tp) if l.strip()]

def calls_of(evs):
    out = []
    for d in evs:
        m = d.get('message') or {}
        if m.get('role') == 'assistant':
            for c in m.get('content', []):
                if c.get('type') == 'toolCall':
                    out.append((d.get('timestamp', ''), c.get('name'), json.dumps(c.get('arguments'))[:160].replace('\n', ' ')))
    return out

rows = metas()
mode = os.environ.get('MODE', 'timeout')

if mode == 'timeout':
    for r in rows:
        if 'timed out' not in str(r.get('error') or ''):
            continue
        evs = tr(r['_p'])
        cs = calls_of(evs)
        cnt = collections.Counter(c[1] for c in cs)
        first = evs[0]['timestamp'][11:19] if evs else '?'
        last = evs[-1]['timestamp'][11:19] if evs else '?'
        print('=' * 100)
        print(f"{r['_end'].strftime('%H:%M')} {r.get('agent')} {r['_proj'][:24]} | {str(r.get('error')).splitlines()[0]}")
        print(f"   window {first} -> {last} | turns {(r.get('usage') or {}).get('turns')} | tools {dict(cnt)}")
        # find longest single tool gap
        gaps = []
        prev = None
        for d in evs:
            ts = datetime.datetime.fromisoformat(d['timestamp'].replace('Z', '+00:00'))
            if prev:
                gaps.append(((ts - prev[0]).total_seconds(), prev[1], prev[2]))
            lbl = (d.get('message') or {}).get('role', d.get('sourceEventType'))
            txt = ''
            m = d.get('message') or {}
            if m.get('role') == 'assistant':
                for c in m.get('content', []):
                    if c.get('type') == 'toolCall':
                        txt = c['name'] + ' ' + json.dumps(c.get('arguments'))[:120].replace('\n', ' ')
            prev = (ts, lbl, txt)
        gaps.sort(key=lambda g: -g[0])
        for g in gaps[:5]:
            print(f'   gap {g[0]:7.1f}s after [{g[1]}] {g[2][:130]}')
        for c in cs[-5:]:
            print('   last>', c[0][11:19], c[1], c[2][:120])
elif mode == 'shape':
    # per run: wall from transcript, tool count, and whether it wrote files
    print(f"{'time':6s} {'agent':10s} {'proj':20s} {'wall_m':>7s} {'turns':>5s} {'tools':>6s} {'writes':>6s} {'bash':>5s} {'reads':>5s} {'cost':>6s} ok")
    agg = collections.Counter()
    for r in rows:
        evs = tr(r['_p'])
        if not evs:
            continue
        a = datetime.datetime.fromisoformat(evs[0]['timestamp'].replace('Z', '+00:00'))
        b = datetime.datetime.fromisoformat(evs[-1]['timestamp'].replace('Z', '+00:00'))
        cs = calls_of(evs)
        cnt = collections.Counter(c[1] for c in cs)
        wall = (b - a).total_seconds() / 60
        agg['wall'] += wall
        u = r.get('usage') or {}
        print(f"{r['_end'].strftime('%H:%M')} {r.get('agent','')[:10]:10s} {r['_proj'][:20]:20s} {wall:7.1f} {u.get('turns') or 0:5d} {len(cs):6d} {cnt.get('write',0)+cnt.get('edit',0):6d} {cnt.get('bash',0):5d} {cnt.get('read',0):5d} {u.get('cost') or 0:6.2f} {'ok' if r.get('exitCode')==0 else 'FAIL'}")
    print('total child wall (sum, overlapping):', round(agg['wall']), 'min')
