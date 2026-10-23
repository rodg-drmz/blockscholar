import './init-sponsors.mjs';
import {spawn} from 'node:child_process';
import fs from 'node:fs';
if(!process.env.DRMZ_APP_SESSION_SECRET || process.env.DRMZ_APP_SESSION_SECRET.length<32)throw new Error('Configure a 32+ character session secret before starting');
const standalone=fs.existsSync('server.js');
const child=spawn(process.execPath,standalone?['server.js']:['node_modules/next/dist/bin/next','start','-H','0.0.0.0','-p',process.env.PORT||'3000'],{stdio:'inherit',env:{...process.env,HOSTNAME:'0.0.0.0'}});
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>child.kill(signal));
child.on('exit',code=>process.exit(code??1));
