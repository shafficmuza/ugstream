import fs from 'fs';
import path from 'path';
import { S3Client, PutObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
const env=Object.fromEntries(fs.readFileSync('.env','utf8').split('\n').filter(l=>l.includes('=')&&!l.trim().startsWith('#')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()];}));
// Short timeouts so a stalled socket fails fast and is retried, instead of
// hanging the whole run (a previous attempt froze at 519/1046).
const s3=new S3Client({region:'auto',endpoint:`https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials:{accessKeyId:env.R2_ACCESS_KEY_ID,secretAccessKey:env.R2_SECRET_ACCESS_KEY},
  maxAttempts:3, requestHandler:{requestTimeout:45000, connectionTimeout:10000}});
const ROOT='/root/ugstream/work/hls72', PREFIX='hls/ep-26/';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function walk(d,base=''){let o=[];for(const e of fs.readdirSync(d,{withFileTypes:true})){const rel=base?`${base}/${e.name}`:e.name;e.isDirectory()?o.push(...walk(path.join(d,e.name),rel)):o.push(rel);}return o;}
const done=new Set(); let token;
do{const r=await s3.send(new ListObjectsV2Command({Bucket:env.R2_BUCKET,Prefix:PREFIX,ContinuationToken:token}));
   for(const o of (r.Contents??[])) done.add(o.Key.slice(PREFIX.length));
   token=r.IsTruncated?r.NextContinuationToken:undefined;}while(token);
const all=walk(ROOT); const todo=all.filter(f=>!done.has(f));
console.log(`total ${all.length}, already uploaded ${done.size}, remaining ${todo.length}`);
let i=0, ok=0;
async function worker(){
  while(i<todo.length){
    const rel=todo[i++];
    const ct=rel.endsWith('.m3u8')?'application/vnd.apple.mpegurl':'video/mp2t';
    for(let a=1;;a++){
      try{
        await s3.send(new PutObjectCommand({Bucket:env.R2_BUCKET,Key:PREFIX+rel,Body:fs.readFileSync(path.join(ROOT,rel)),ContentType:ct}));
        if(++ok%100===0) console.log('progress',ok,'/',todo.length);
        break;
      }catch(e){ if(a>=8){console.log('FAILED',rel,e.message);throw e;} await sleep(800*a); }
    }
  }
}
await Promise.all(Array.from({length:5},worker));
console.log('UPLOAD_DONE',ok);
