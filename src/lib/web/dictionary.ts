import type { DictEntry, DictResult } from '../types';
import { normalize } from '../tokenize';
type Dictionary = {entries:Record<string,DictEntry[]>;forms:Record<string,{lemma:string;note:string}[]>};
let pending: Promise<Dictionary> | undefined;
export function dictionary() {
  if (!pending) pending = (async () => {
    const response = await fetch('/tagalog-dictionary.json.gz');
    if (!response.ok) throw new Error('Could not load the Tagalog dictionary. Please retry.');
    const bytes = await response.arrayBuffer();
    const data = new Uint8Array(bytes);
    // Hosting may send Content-Encoding:gzip, which fetch decompresses automatically.
    if (data[0] !== 31 || data[1] !== 139) return JSON.parse(new TextDecoder().decode(data)) as Dictionary;
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
    return await new Response(stream).json() as Dictionary;
  })().catch(error => {pending=undefined;throw error;});
  return pending;
}
export async function lookup(word: string): Promise<DictResult> {
  const d=await dictionary();const k=normalize(word,'tl');const entries=d.entries[k] ?? [];
  if (entries.length) return {entries};
  const form=d.forms[k]?.[0];
  return {entries: form ? d.entries[form.lemma] ?? [] : [],lemma:form?.lemma,form_note:form?.note};
}
