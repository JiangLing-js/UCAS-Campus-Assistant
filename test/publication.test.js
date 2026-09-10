import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync,spawnSync} from 'node:child_process';

const checker=fileURLToPath(new URL('../scripts/check-public.js',import.meta.url));
const icon=fs.readFileSync(new URL('../extension/icon.png',import.meta.url));
function isolatedRepo(run){
 const parent=path.resolve(os.tmpdir()),root=fs.mkdtempSync(path.join(parent,'ucas-publication-test-'));
 const git=(...args)=>execFileSync('git',args,{cwd:root,stdio:'pipe',windowsHide:true});
 const write=(file,content)=>{const target=path.join(root,file);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,content);};
 const check=staged=>spawnSync(process.execPath,[checker,...(staged?['--staged']:[])],{cwd:root,encoding:'utf8',windowsHide:true});
 try{git('init','--quiet');run({root,git,write,check});}
 finally{assert.equal(path.dirname(path.resolve(root)),parent);assert.ok(path.basename(root).startsWith('ucas-publication-test-'));fs.rmSync(root,{recursive:true,force:true});}
}

test('publication permits only the reviewed image bytes and checks staged content independently',()=>isolatedRepo(({git,write,check})=>{
 write('extension/icon.png',icon);git('add','--','extension/icon.png');
 assert.equal(check(false).status,0);assert.equal(check(true).status,0);
 write('extension/icon.png',Buffer.concat([icon,Buffer.from('unreviewed metadata')]));
 assert.equal(check(false).status,1);assert.equal(check(true).status,0);
 git('add','--','extension/icon.png');assert.equal(check(true).status,1);
 write('extension/icon.png',icon);write('profile.png',icon);git('add','--','extension/icon.png','profile.png');
 const result=check(true);assert.equal(result.status,1);assert.match(result.stderr,/profile\.png.*private runtime/);
}));

test('publication blocks runtime data and tokens without printing sensitive values',()=>isolatedRepo(({git,write,check})=>{
 const secret='sk-'+'x'.repeat(32);
 write('config.js',`export const key='${secret}';\n`);write('data/private.txt','private fixture');
 git('add','--','config.js','data/private.txt');
 const result=check(true);assert.equal(result.status,1);assert.match(result.stderr,/possible API token/);assert.match(result.stderr,/data\/private\.txt/);
 assert.equal((result.stdout+result.stderr).includes(secret),false);
}));

test('publication check inspects staged bytes and never prints matched secret values',t=>{
 const base=path.resolve(os.tmpdir()),dir=fs.mkdtempSync(path.join(base,'ucas-publish-test-'));
 t.after(()=>{if(path.dirname(path.resolve(dir))!==base||!path.basename(dir).startsWith('ucas-publish-test-'))throw new Error('Unsafe cleanup path');fs.rmSync(dir,{recursive:true,force:true});});
 const git=args=>execFileSync('git',args,{cwd:dir,stdio:'pipe'});
 const checker=fileURLToPath(new URL('../scripts/check-public.js',import.meta.url));
 const run=()=>spawnSync(process.execPath,[checker,'--staged'],{cwd:dir,encoding:'utf8',windowsHide:true});
 git(['init','--quiet']);
 const dummyToken=['sk','z'.repeat(32)].join('-');
 fs.writeFileSync(path.join(dir,'example.js'),`export const value = '${dummyToken}';\n`);git(['add','example.js']);
 fs.writeFileSync(path.join(dir,'example.js'),'export const value = null;\n');
 const failed=run();assert.equal(failed.status,1);assert.match(failed.stderr,/possible API token/);assert.ok(!failed.stderr.includes(dummyToken));
 git(['add','example.js']);assert.equal(run().status,0);
 fs.mkdirSync(path.join(dir,'data'));fs.writeFileSync(path.join(dir,'data','capture.json'),'{}');git(['add','data']);
 const privateFile=run();assert.equal(privateFile.status,1);assert.match(privateFile.stderr,/private runtime/);
});
