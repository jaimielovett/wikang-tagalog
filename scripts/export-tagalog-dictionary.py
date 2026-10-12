"""Export the bundled Wiktionary dictionary without changing upstream sources."""
import gzip,json,sqlite3,tempfile,os
from pathlib import Path
with tempfile.NamedTemporaryFile(delete=False) as f:
    f.write(gzip.open('src-tauri/resources/dicts/tl.db.gz','rb').read()); name=f.name
try:
    conn=sqlite3.connect(name)
    entries={}; forms={}
    for k,word,pos,ipa,gloss,rank in conn.execute('select k,word,pos,ipa,gloss,rank from entries order by rank'):
        rows=entries.setdefault(k,[])
        match=next((r for r in rows if r['word']==word and r['pos']==pos and r['ipa']==ipa),None)
        if match: match['glosses'].extend(g.rstrip('.') for g in gloss.split('\u241e'))
        else: rows.append(dict(word=word,pos=pos,ipa=ipa,glosses=[g.rstrip('.') for g in gloss.split('\u241e')]))
    for k,lemma,note in conn.execute('select k,lemma,note from forms'):
        forms.setdefault(k,[]).append(dict(lemma=lemma,note=note))
    Path('public').mkdir(exist_ok=True)
    with gzip.open('public/tagalog-dictionary.json.gz','wt',encoding='utf8') as out:
        json.dump(dict(entries=entries,forms=forms),out,ensure_ascii=False,separators=(',',':'))
    print(f'Exported {len(entries)} headwords and {len(forms)} inflected forms.')
finally:
    os.unlink(name)
