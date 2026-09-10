import json, glob, os, collections, datetime, re, sys

BASE = os.path.expanduser('~/.pi/agent/sessions')

def parse(f):
    evs = []
    for line in open(f):
        try:
            evs.append(json.loads(line))
        except Exception:
            pass
    return evs

def t(s):
    return datetime.datetime.fromisoformat(s.replace('Z', '+00:00'))

def walk(f):
    evs = parse(f)
    calls = {}   # id -> dict
    order = []
    for d in evs:
        if d.get('type') != 'message':
            continue
        m = d['message']
        ts = t(d['timestamp'])
        if m.get('role') == 'assistant':
            for c in m.get('content', []):
                if c.get('type') == 'toolCall':
                    calls[c['id']] = dict(name=c.get('name'), args=c.get('arguments'), start=ts, end=None, result=None)
                    order.append(c['id'])
        elif m.get('role') == 'toolResult':
            cid = m.get('toolCallId')
            txt = ''
            for c in m.get('content', []):
                if c.get('type') == 'text':
                    txt += c.get('text') or ''
            if cid in calls:
                calls[cid]['end'] = ts
                calls[cid]['result'] = txt
    return evs, [calls[i] for i in order if i in calls]

ERR_PAT = re.compile(r'(?i)\b(error|failed|failure|timed? ?out|timeout|refus|denied|rejected|not found|cannot|exception|blocked)\b')

def classify(c):
    r = (c.get('result') or '')[:4000]
    head = r[:300]
    if ERR_PAT.search(head):
        return head.replace('\n', ' ')[:200]
    return None

def main():
    files = sorted(glob.glob(os.path.join(BASE, '*', '2026-09-09T*.jsonl')))
    grand = collections.Counter()
    for f in files:
        evs, cs = walk(f)
        proj = os.path.basename(os.path.dirname(f))
        name = os.path.basename(f)
        if not cs:
            continue
        span = (cs[-1]['start'] - cs[0]['start']).total_seconds() / 60
        print('=' * 100)
        print(f'{proj}\n  {name}  calls={len(cs)} span={span:.0f}m')
        by = collections.Counter(c['name'] for c in cs)
        print('  tools:', dict(by.most_common()))
        # slowest
        durs = [(c, (c['end'] - c['start']).total_seconds()) for c in cs if c['end']]
        durs.sort(key=lambda x: -x[1])
        print('  --- slowest calls')
        for c, s in durs[:8]:
            a = json.dumps(c['args'])[:160].replace('\n', ' ')
            print(f'   {s:8.1f}s {c["name"]:12s} {a}')
        tot = sum(s for _, s in durs)
        sub = sum(s for c, s in durs if c['name'] == 'subagent')
        print(f'  tool time total={tot/60:.1f}m subagent={sub/60:.1f}m')
        print('  --- suspected errors')
        n = 0
        for c in cs:
            e = classify(c)
            if e:
                n += 1
                grand[c['name']] += 1
                if n <= 15:
                    print(f'   [{c["name"]}] {e}')
        print(f'  error-ish results: {n}/{len(cs)}')
    print('=' * 100)
    print('grand error-ish by tool:', dict(grand))

main()
