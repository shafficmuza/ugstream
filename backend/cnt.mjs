import fs from 'fs';
import { S3Client, ListObjectsV2Command } from '@aws-sdk/client-s3';
const env=Object.fromEntries(fs.readFileSync('.env','utf8').split('\n').filter(l=>l.includes('=')&&!l.trim().startsWith('#')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const s3=new S3Client({region:'auto',endpoint:`https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,credentials:{accessKeyId:env.R2_ACCESS_KEY_ID,secretAccessKey:env.R2_SECRET_ACCESS_KEY}});
let token,n=0;
do{const r=await s3.send(new ListObjectsV2Command({Bucket:env.R2_BUCKET,Prefix:'hls/ep-26/',ContinuationToken:token}));n+=(r.Contents??[]).length;token=r.IsTruncated?r.NextContinuationToken:undefined;}while(token);
console.log('objects in hls/ep-26/:',n,'of 1046');
