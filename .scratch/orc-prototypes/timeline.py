import json, glob, os, collections, datetime

BASE = os.path.expanduser('~/.pi/agent/sessions')

def t(s):
    return datetime.datetime.fromisoformat(s.replace('Z', '+00:00'))

rowsall = []
for f in sorted(glob.glob(os.path.join(BASE, '*', '2026-09-09T*.jsonl'))):
    evs = [json.loads(l) for l in open(f) if l.strip()]
    msgs = [d for d in evs if d.get('type') == 'message']
    if not msgs:
        continue
    calls = {}
    seq = []
    for d in msgs:
        m = d['message']
        ts = t(d['timestamp'])
        if m.get('role') == 'assistant':
            for c in m.get('content', []):
                if c.get('type') == 'toolCall':
                    calls[c['id']] = dict(name=c['name'], args=c.get('arguments') or {}, start=ts, end=None, res='')
                    seq.append(c['id'])
        elif m.get('role') == 'toolResult':
            cid = m.get('toolCallId')
            if cid in calls:
                calls[cid]['end'] = ts
                calls[cid]['res'] = ''.join(c.get('text', '') for c in m.get('content', []) if c.get('type') == 'text')
    cs = [calls[i] for i in seq if i in calls]
    if not cs:
        continue
    start = t(msgs[0]['timestamp'])
    end = t(msgs[-1]['timestamp'])
    wall = (end - start).total_seconds()
    human = sum((c['end'] - c['start']).total_seconds() for c in cs if c['end'] and c['name'] == 'ask_user_question')
    tool = sum((c['end'] - c['start']).total_seconds() for c in cs if c['end'] and c['name'] != 'ask_user_question')
    model = wall - human - tool
    rowsall.append(dict(
        proj=os.path.basename(os.path.dirname(f)).strip('-'),
        file=os.path.basename(f)[:24],
        wall=wall, human=human, tool=tool, model=model,
        calls=len(cs),
        sub=sum(1 for c in cs if c['name'] == 'subagent'),
    ))

print(f"{'project':44s} {'wall_m':>7s} {'human_m':>8s} {'tool_m':>7s} {'model_m':>8s} {'calls':>6s} {'sub':>4s}")
for r in sorted(rowsall, key=lambda r: -r['wall']):
    print(f"{r['proj'][:44]:44s} {r['wall']/60:7.0f} {r['human']/60:8.0f} {r['tool']/60:7.0f} {r['model']/60:8.0f} {r['calls']:6d} {r['sub']:4d}")
tw = sum(r['wall'] for r in rowsall)
th = sum(r['human'] for r in rowsall)
tt = sum(r['tool'] for r in rowsall)
print(f"\nTOTAL wall {tw/3600:.1f}h  human-wait {th/3600:.1f}h ({th/tw*100:.0f}%)  tool {tt/3600:.1f}h ({tt/tw*100:.0f}%)  model+idle {(tw-th-tt)/3600:.1f}h ({(tw-th-tt)/tw*100:.0f}%)")
