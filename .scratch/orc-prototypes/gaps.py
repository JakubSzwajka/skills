import json, glob, os, datetime, collections

BASE = os.path.expanduser('~/.pi/agent/sessions')
rows = []
for p in glob.glob(os.path.join(BASE, '*', 'subagent-artifacts', '*_transcript.jsonl')):
    d = datetime.datetime.fromtimestamp(os.path.getmtime(p))
    if d.date() != datetime.date(2026, 9, 9):
        continue
    rows.append(p)

def T(s):
    return datetime.datetime.fromisoformat(s.replace('Z', '+00:00'))

big = []
total_wall = 0.0
total_gap = 0.0
tool_wait = collections.Counter()
tool_n = collections.Counter()
for p in rows:
    evs = [json.loads(l) for l in open(p) if l.strip()]
    if len(evs) < 2:
        continue
    total_wall += (T(evs[-1]['timestamp']) - T(evs[0]['timestamp'])).total_seconds()
    prev = None
    pending = {}
    for d in evs:
        ts = T(d['timestamp'])
        if prev:
            g = (ts - prev[0]).total_seconds()
            if g > 90:
                big.append((g, os.path.basename(p)[:8], prev[1], prev[2][:150]))
            total_gap += g
        lbl = d.get('sourceEventType') or (d.get('message') or {}).get('role')
        desc = ''
        m = d.get('message') or {}
        if m.get('role') == 'assistant':
            for c in m.get('content', []):
                if c.get('type') == 'toolCall':
                    desc = c['name'] + ' ' + json.dumps(c.get('arguments'))[:200].replace('\n', ' ')
                    pending[c['id']] = (ts, c['name'])
        if m.get('role') == 'toolResult':
            cid = m.get('toolCallId')
            if cid in pending:
                st, nm = pending.pop(cid)
                tool_wait[nm] += (ts - st).total_seconds()
                tool_n[nm] += 1
        prev = (ts, lbl, desc)

print('transcripts:', len(rows), ' summed child wall:', round(total_wall / 3600, 1), 'h')
print()
print('--- stalls > 90s inside children (top 30)')
big.sort(reverse=True)
for g, f, lbl, desc in big[:30]:
    print(f'{g:8.1f}s  {f}  after[{lbl}]  {desc[:120]}')
print(f'\ncount of stalls >90s: {len(big)}, summed {sum(g for g,_,_,_ in big)/60:.0f} min')
buckets = collections.Counter()
for g, *_ in big:
    if g < 180: buckets['90-180s'] += 1
    elif g < 300: buckets['3-5m'] += 1
    elif g < 600: buckets['5-10m'] += 1
    else: buckets['>10m'] += 1
print(buckets)
print()
print('--- child tool time by tool')
for k in sorted(tool_wait, key=lambda k: -tool_wait[k])[:14]:
    print(f'  {k:12s} n={tool_n[k]:4d} total={tool_wait[k]/60:7.1f}m avg={tool_wait[k]/tool_n[k]:6.1f}s')
