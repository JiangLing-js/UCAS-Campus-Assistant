import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync,spawnSync} from 'node:child_process';

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
