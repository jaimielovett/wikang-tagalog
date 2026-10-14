// IndexedDB avoids the small localStorage limit for long lessons and generated audio.
const open = () => new Promise<IDBDatabase>((resolve,reject) => {
 const request=indexedDB.open('wikang-tagalog',1);
 request.onupgradeneeded=()=>request.result.createObjectStore('snapshots');
 request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
});
export async function readSnapshot<T>(key:string):Promise<T|undefined> {
 const db=await open();try{return await new Promise((resolve,reject)=>{const tx=db.transaction('snapshots','readonly');const req=tx.objectStore('snapshots').get(key);req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});}finally{db.close();}
}
export async function writeSnapshot(key:string,value:unknown) {
 const db=await open();try{await new Promise<void>((resolve,reject)=>{const tx=db.transaction('snapshots','readwrite');tx.objectStore('snapshots').put(value,key);tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error ?? new Error('Could not save your learning data.'));});}finally{db.close();}
}
export async function deleteSnapshot(key:string) {
 const db=await open();try{await new Promise<void>((resolve,reject)=>{const tx=db.transaction('snapshots','readwrite');tx.objectStore('snapshots').delete(key);tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);});}finally{db.close();}
}
