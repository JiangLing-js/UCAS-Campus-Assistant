import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
import {ROOT,DATA} from '../src/paths.js';
const port=Number(process.env.PORT||3210);if(!Number.isInteger(port)||port<1024||port>65535)throw new Error('PORT 必须是 1024–65535 之间的整数');
const url=`http://127.0.0.1:${port}`;
async function health(){try{const response=await fetch(url+'/api/health',{signal:AbortSignal.timeout(1000)});return (await response.json()).service==='ucas-companion';}catch{return false;}}
if(process.argv.includes('--stop')){
 if(!await health()){console.log('校园助手没有运行。');process.exit(0);}
 const page=await fetch(url);const cookie=page.headers.get('set-cookie')?.split(';')[0];
 const response=await fetch(url+'/api/shutdown',{method:'POST',headers:{cookie,'Content-Type':'application/json'},body:'{}'});if(!response.ok)throw new Error('无法停止服务');console.log('校园助手已停止。');
}else{
 if(!await health()){
  const out=fs.openSync(path.join(DATA,'server.log'),'a'),err=fs.openSync(path.join(DATA,'server-error.log'),'a');
  const child=spawn(process.execPath,[path.join(ROOT,'src/server.js')],{cwd:ROOT,detached:true,windowsHide:true,stdio:['ignore',out,err]});child.unref();fs.closeSync(out);fs.closeSync(err);fs.writeFileSync(path.join(DATA,'server.pid'),String(child.pid));
  for(let i=0;i<30&&!await health();i++)await delay(300);
  if(!await health())throw new Error('启动失败，请查看 data/server-error.log。');
 }
 console.log(`校园助手已运行：${url}`);
 // Opening the workbench is the only visible window created by the launcher.
 if(!process.argv.includes('--no-open')){const opener=spawn('powershell.exe',['-NoProfile','-NonInteractive','-Command',`Start-Process '${url}'`],{windowsHide:true,stdio:'ignore'});opener.unref();}
}
