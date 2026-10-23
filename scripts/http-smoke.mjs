// Uses an ephemeral, unfunded synthetic EVM identity. Never supplies a real user's key.
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {privateKeyToAccount} from 'viem/accounts';
import curriculum from '../lib/spaces/blockchain-curriculum.json' with {type:'json'};
const origin=process.argv[2];if(!origin)throw Error('Pass the deployment origin');
const account=privateKeyToAccount('0x'+randomBytes(32).toString('hex'));let cookie='';
async function req(path,body,overrides={}){const r=await fetch(origin+path,{method:body?'POST':'GET',headers:{Origin:origin,...(body?{'Content-Type':'application/json'}:{}),...(cookie?{Cookie:cookie}:{}),...overrides},...(body?{body:JSON.stringify(body)}:{})});let data=await r.json();return{r,data};}
async function login(){const {data}=await req('/api/auth/wallet/challenge',{chain:'ethereum',address:account.address,walletName:'Synthetic deployment check'});assert.ok(data.challenge);const payload={challengeId:data.challenge.id,proof:{chain:'ethereum',signature:await account.signMessage({message:data.challenge.message})}};const verified=await req('/api/auth/wallet/verify',payload);assert.equal(verified.r.status,200,JSON.stringify(verified.data));cookie=verified.r.headers.get('set-cookie').split(';')[0];assert.equal((await req('/api/auth/wallet/verify',payload)).r.status,401);return verified.data.identity.id;}
assert.equal((await req('/api/spaces/practice')).r.status,401);
assert.equal((await req('/api/auth/wallet/challenge',{chain:'ethereum',address:account.address},{Origin:'https://untrusted.example'})).r.status,403);
const id=await login();const saved=await req('/api/spaces/practice',{type:'prep',answers:curriculum.prep.map(q=>q.correct)});assert.equal(saved.r.status,200,JSON.stringify(saved.data));assert.equal(saved.data.state.prepScore,8);
assert.equal((await req('/api/learn/strike-mission',{type:'claim'})).r.status>=400,true,'An unverified learner cannot claim a bounty');
assert.equal((await req('/api/auth/sign-out',{})).r.status,200);cookie='';assert.equal((await req('/api/auth/session')).r.status,401);
assert.equal(await login(),id);const restored=await req('/api/spaces/practice');assert.equal(restored.data.state.prepScore,8);assert.equal((await req('/api/learn/blockscholar')).data.practice.prepScore,8);
console.log(JSON.stringify({origin,syntheticWalletLogin:'passed',signatureReplay:'rejected',crossSiteMutation:'rejected',savedProgressAfterSignOutAndLogin:'8/8 restored',unverifiedBountyClaim:'rejected'}));
