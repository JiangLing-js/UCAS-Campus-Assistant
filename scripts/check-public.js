import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';

const staged=process.argv.includes('--staged');
const root=execFileSync('git',['rev-parse','--show-toplevel'],{encoding:'utf8'}).trim();
const tracked=execFileSync('git',['ls-files','--stage','-z'],{cwd:root,encoding:'utf8'}).split('\0').filter(Boolean);
const errors=[];
// Only this reviewed, generated icon is allowed; other images and changed bytes stay blocked.
const reviewedAssets=new Map([['extension/icon.png','2fc2fc1a54cb8bf0184ed8e23063e61f3a213c09c4a96dfc6f516b15a579a205']]);
const fail=(file,line,rule)=>errors.push({file,line,rule});
const publicTypes=/\.(?:js|mjs|cjs|json|html|css|svg|md|yml|yaml|cmd|txt)$/i;
const blockedPath=/(?:^|\/)(?:data|node_modules|test-output|screenshots|captures|downloads|backups|tmp|temp|coverage|playwright-report|\.codex|\.vscode|\.idea|chrome-profile|browser-profile)(?:\/|$)|(?:^|\/)mcp-config\.json$|\.(?:dpapi|sqlite(?:3)?(?:-wal|-shm)?|db(?:-wal|-shm)?|log(?:\..*)?|pid|pem|key|p12|pfx|har|zip|7z|xlsx|xls|csv|png|jpe?g|webp)$/i;
const privateRecord=/(?:^|\/)(?:computer-control-diagnosis|integration-verification|login-verification|verification)\.md$/;
const secretData=/(?:cookies|credentials|secrets|snapshot|storage[-_.]?state).*\.(?:json|html)$/i;
const tokenPattern=/\b(?:sk-[a-zA-Z0-9_-]{16,}|gh[pousr]_[a-zA-Z0-9]{20,}|github_pat_[a-zA-Z0-9_]{20,}|AKIA[A-Z0-9]{16})\b|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/;
const userDirectory=/(?:[A-Z]:[\\/]+Users[\\/]+|\/(?:Users|home)\/)[^\s"'<>\\/]+/i;
const localDrive=/(?<![A-Za-z])[A-Za-z]:[\\/]+(?:projects|APPDAT|AppData|AIData|node_js)(?:[\\/]|\b)/i;
const emailPattern=/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/ig;
const sessionPattern=/[?&](?:sid|ticket|token|access_token|sessionid|auth)=([^\s'"<>]+)/ig;
const fixtureSessions=new Set(['private#secret','hidden','secret','fixture-only']);

for(const entry of tracked){
 const match=/^(\d+) ([a-f0-9]+) (\d)\t([\s\S]+)$/.exec(entry);
 if(!match){fail('(index)',0,'unrecognized index entry');continue;}
 const [,mode,,stage,file]=match;
 if(!['100644','100755'].includes(mode)||stage!=='0'){fail(file,0,'symlink, submodule or unresolved merge');continue;}
 if((blockedPath.test(file)&&!reviewedAssets.has(file))||privateRecord.test(file)||secretData.test(file)||(/(?:^|\/)\.env(?:\.|$)/.test(file)&&!file.endsWith('.env.example'))){fail(file,0,'private runtime/configuration/data file');continue;}
 if(!publicTypes.test(file)&&!reviewedAssets.has(file)&&!['.gitignore','.gitattributes','.env.example','LICENSE'].includes(file)){fail(file,0,'file type needs explicit publication review');continue;}
 let bytes;
 try{bytes=staged?execFileSync('git',['show',':'+file],{cwd:root,maxBuffer:8*1024*1024}):fs.readFileSync(path.join(root,file));}catch{fail(file,0,'cannot read tracked file');continue;}
 if(reviewedAssets.has(file)){if(createHash('sha256').update(bytes).digest('hex')!==reviewedAssets.get(file))fail(file,0,'reviewed asset has changed and needs a new privacy review');continue;}
 if(bytes.includes(0)||!Buffer.from(bytes.toString('utf8')).equals(bytes)){fail(file,0,'binary or non-UTF-8 content');continue;}
 const lines=bytes.toString('utf8').split(/\r?\n/);
 for(let i=0;i<lines.length;i++){
  const line=lines[i];
  if(tokenPattern.test(line))fail(file,i+1,'possible API token or private key');
  if(userDirectory.test(line)||localDrive.test(line))fail(file,i+1,'machine-specific absolute path');
  for(const m of line.matchAll(emailPattern)){
   const email=m[0].toLowerCase();
   const dummy=/@example\.(?:test|com|org|net)$/.test(email)||email.endsWith('@users.noreply.github.com');
   const rejectedUrlFixture=file==='test/core.test.js'&&email===['p','sep.ucas.ac.cn'].join('@');
   if(!dummy&&!rejectedUrlFixture)fail(file,i+1,'non-example email address');
  }
  for(const m of line.matchAll(sessionPattern)){
   const syntheticMailSession=file==='test/campus-sync.test.js'&&m[1]==='synthetic-session';
   if(!(file.startsWith('test/')&&fixtureSessions.has(m[1]))&&!syntheticMailSession)fail(file,i+1,'URL with a session/authorization parameter');
  }
 }
}
if(!tracked.length)fail('(index)',0,'no tracked files; stage the intended public files first');
if(errors.length){for(const e of errors)console.error(`${e.file}:${e.line} ${e.rule}`);console.error(`Public-file check failed: ${errors.length} finding(s). Values were not printed.`);process.exitCode=1;}
else console.log(`Public-file check passed: ${tracked.length} ${staged?'staged':'tracked'} files; no blocked files, unreviewed assets or matching secret patterns.`);
