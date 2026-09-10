import json, glob, os, datetime, collections, re

BASE = os.path.expanduser('~/.pi/agent/sessions')

def load_meta():
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
        out.append(m)
    return sorted(out, key=lambda r: r['_end'])

rows = load_meta()

def transcript(p):
    tp = p.replace('_meta.json', '_transcript.jsonl')
    if not os.path.exists(tp):
        return []
    return [json.loads(l) for l in open(tp) if l.strip()]

print('=== timed-out / failed runs: what were they doing?')
for r in rows:
    err = str(r.get('error') or '')
    if 'timed out' not in err:
        continue
    evs = transcript(r['_p'])
    calls = []
    for d in evs:
        if d.get('type') == 'message' and d['message'].get('role') == 'assistant':
            for c in d['message'].get('content', []):
                if c.get('type') == 'toolCall':
                    calls.append((d.get('timestamp', '')[11:19], c['name'], json.dumps(c.get('arguments'))[:110].replace('\n', ' ')))
    cnt = collections.Counter(c[1] for c in calls)
    print('-' * 90)
    print(r['_end'].strftime('%H:%M'), r.get('agent'), '|', err.split('\n')[0], '| tools:', dict(cnt), '| turns', (r.get('usage') or {}).get('turns'))
    print('   task:', str(r.get('task'))[:200].replace('\n', ' '))
    for c in calls[-6:]:
        print('   last>', c)
