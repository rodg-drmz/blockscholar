import {DatabaseSync} from 'node:sqlite';
import {mkdirSync} from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
export async function readAuthJson(req:Request){
 const reader=req.body?.getReader();if(!reader)throw new Error('Missing JSON body');let size=0;const chunks:Uint8Array[]=[];
 while(true){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>24000){await reader.cancel();throw new Error('Request too large');}chunks.push(value);}
 return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
/** Persistent limits across restarts; store only hashed buckets, never raw addresses. */
export function allowAuthRequest(kind:string,subject:string,limit:number,windowMs:number,now=Date.now()){
 const root=process.env.DRMZ_LEARN_DATA_DIR||path.join(process.cwd(),'data');mkdirSync(root,{recursive:true,mode:0o700});
 const db=new DatabaseSync(path.join(root,'auth-limits.sqlite3'));
 try{db.exec('PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS limits (key TEXT PRIMARY KEY, until INTEGER NOT NULL, count INTEGER NOT NULL)');
 const key=createHash('sha256').update(kind+':'+subject).digest('hex');
 db.exec('BEGIN IMMEDIATE');db.prepare('DELETE FROM limits WHERE until <= ?').run(now);
 const row=db.prepare('SELECT count FROM limits WHERE key = ?').get(key) as {count:number}|undefined;
 if((row?.count||0)>=limit){db.exec('COMMIT');return false;}
 db.prepare('INSERT INTO limits(key,until,count) VALUES(?,?,1) ON CONFLICT(key) DO UPDATE SET count=count+1').run(key,now+windowMs);db.exec('COMMIT');return true;
 }finally{db.close();}
}
