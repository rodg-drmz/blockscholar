import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as CSL from '@emurgo/cardano-serialization-lib-nodejs';
import {missionAction,status} from './service';
import {getRecord,updateRecord,switchPracticeAttempt,acquirePosition,releaseSetup} from './store';
import {positionPlan,units,verifyPositionOrder} from './positions';
import {type Direction} from './model';
import {newStrikeSession,signTestOrder} from '../../packages/spaces-studio/src/strike-session.mjs';

const account='019a0c2e-1111-7000-8000-000000000001';
const wallet=CSL.EnterpriseAddress.new(0,CSL.Credential.from_keyhash(CSL.PrivateKey.generate_ed25519().to_public().hash())).to_address().to_bech32();
const market={status:'trading',reduce_only:false,mark_price:'2400',order_market_price_bound:'0.05',order_market_step_size:'0.001',order_market_min_size:'0.001',order_market_max_size:'100',order_min_notional:'10'};
function setup(t:test.TestContext) {
  const env={...process.env},fetch=global.fetch,dir=fs.mkdtempSync(path.join(os.tmpdir(),'strike-positions-'));
  process.env.STRIKE_MISSIONS_DATA_DIR=dir;process.env.STRIKE_MISSIONS_ENABLED='true';process.env.STRIKE_MISSIONS_BUILDER_CODE='test-builder';
  t.after(()=>{process.env=env;global.fetch=fetch;fs.rmSync(dir,{recursive:true,force:true});});
  const session=newStrikeSession();
  updateRecord('alice',r=>Object.assign(r,{accountId:account,wallet,apiPublicKey:session.publicKey,lessonAt:100,completedAt:200,receipt:'original-receipt',claim:{id:'old-claim',status:'confirmed',txHash:'old-tx'},blockscholar:{enrolledAt:100,reflection:{learning:'saved',application:'saved',artifactUrl:'',savedAt:100}}}));
  let liquidity=true,depth:any=null,depthFailure=false;
  let size='0', openOrders=0, fail=false, reject=false, pending=false;
  const orders=new Map<string,any>(),writes:any[]=[];
  global.fetch=async(input,init)=>{
    const u=new URL(String(input));assert.equal(u.origin,'https://api-v2-testnet.strikefinance.org');
    if(u.pathname==='/v2/account')return Response.json({account_id:account,blockchain:'cardano',blockchain_address:wallet,available_balance:'21.15'});
    if(u.pathname==='/price/v2/depth')return depthFailure?Response.json({error:'unavailable'},{status:503}):Response.json(depth || {bids:liquidity?[['2399','1']]:[],asks:liquidity?[['2401','1']]:[]});
    if(u.pathname==='/v2/markets')return Response.json({markets:{'ETH-USD':market}});
    if(u.pathname==='/v2/positions') {assert.equal(u.searchParams.get('account_id'),account);return Response.json({count:Number(size)!==0?1:0,positions:Number(size)!==0?[{symbol:'ETH-USD',size,entry_price:'2400'}]:[]});}
    if(u.pathname==='/v2/openOrders') return Response.json({count:openOrders,orders:openOrders?[{AccountID:account,Symbol:'ETH-USD'}]:[]});
    if(u.pathname==='/v2/order' && init?.method==='POST') {
      const body=JSON.parse(String(init.body));writes.push(body);
      if(reject)return Response.json({error:'rejected'},{status:401});
      const o={ID:String(100+writes.length),AccountID:account,ClientOrderID:body.client_order_id,Symbol:body.symbol,Type:body.type,Side:body.side,Status:pending?'pending':'filled',Size:body.size,Filled:pending?'0':body.size,ReduceOnly:body.reduce_only,CreateTimestamp:Date.now(),EventTimestamp:Date.now()};
      orders.set(body.client_order_id,o);
      if(!pending)size=body.reduce_only?'0':body.side==='buy'?body.size:'-'+body.size;
      if(fail)throw new Error('lost acknowledgement after accepted');
      return Response.json({client_order_id:body.client_order_id},{status:201});
    }
    if(u.pathname==='/v2/order')return Response.json(orders.get(u.searchParams.get('client_order_id')!) || {error:'not indexed'},{status:orders.has(u.searchParams.get('client_order_id')!)?200:404});
    throw new Error('Unexpected path '+u.pathname);
  };
  const act=(a:any)=>missionAction('alice',a,'http://localhost:3000');
  const scenario=(direction:Direction='long')=>act({type:'position-scenario',direction,answers:direction==='long'?[0,1]:[1,2]});
  const prepare=(direction:Direction,operation='entry')=>act({type:'position-prepare',direction,operation});
  const send=(direction:Direction,operation='entry',bodyOverride?:string)=>{
    const p=getRecord('alice').positions![direction]!,request=operation==='entry'?p.entry!:p.exits.at(-1)!;
    return act({type:'position-submit',direction,operation,clientId:request.clientId,headers:signTestOrder(session,'place',bodyOverride || request.body,Date.now())});
  };
  return {act,scenario,prepare,send,orders,writes,setLiquidity:(v:boolean)=>liquidity=v,setDepth:(v:any)=>depth=v,setDepthFailure:(v:boolean)=>depthFailure=v,setSize:(v:string)=>size=v,setOpen:(v:number)=>openOrders=v,setFail:(v:boolean)=>fail=v,setReject:(v:boolean)=>reject=v,setPending:(v:boolean)=>pending=v};
}

for(const direction of ['long','short'] as const)test(`${direction}: scenario → actual fill → reduce-only close → verified receipt; old progress and bounty preserved`,async t=>{
  const x=setup(t);await x.scenario(direction);await x.prepare(direction);
  const planned=getRecord('alice').positions![direction]!.entry!;
  assert.equal(planned.size,'0.005');assert.equal(planned.estimate,'12');
  await x.send(direction);assert.equal(getRecord('alice').positions![direction]!.completedAt,undefined);
  await x.act({type:'position-check',direction});assert.ok(getRecord('alice').positions![direction]!.open);
  await x.prepare(direction,'exit');await x.send(direction,'exit');await x.act({type:'position-check',direction});
  const r=getRecord('alice'),p=r.positions![direction]!;
  assert.ok(p.completedAt);assert.match(p.receipt!,/^[a-f0-9]{64}$/);assert.equal(p.accountId,account);
  assert.equal(x.writes[0].side,direction==='long'?'buy':'sell');assert.equal(x.writes[1].side,direction==='long'?'sell':'buy');assert.equal(x.writes[1].reduce_only,true);assert.equal(x.writes[0].slippage,'0.01');
  assert.equal(r.receipt,'original-receipt');assert.equal(r.claim?.txHash,'old-tx');assert.equal(r.blockscholar?.reflection?.learning,'saved');assert.equal(r.lessonAt,100);
  const receipt=p.receipt;await x.act({type:'position-check',direction});assert.equal(getRecord('alice').positions![direction]!.receipt,receipt);assert.equal(x.writes.length,2);
  assert.equal(status('alice').record?.positions?.[direction]?.completedAt,p.completedAt);assert.equal(status('bob').record?.positions,undefined);
});

test('wrong answers, unsupported markets, insufficient balance, and spoofed signatures cannot place an entry',async t=>{
  const x=setup(t);await assert.rejects(x.act({type:'position-scenario',direction:'long',answers:[1,1]}),/scenario/);
  await assert.rejects(x.prepare('long'),/scenario/);assert.equal(getRecord('alice').positions,undefined);
  assert.throws(()=>positionPlan({...market,order_min_notional:'20'},'long','100'),/maximum 15/);
  assert.throws(()=>positionPlan(market,'long','5'),/test credits/);
  assert.throws(()=>positionPlan({...market,reduce_only:true},'long','100'),/not ready/);
  await x.scenario();await x.prepare('long');await assert.rejects(x.send('long','entry','{}'),/signature/);assert.equal(x.writes.length,0);
  x.setOpen(1);await assert.rejects(x.send('long'),/changed/);assert.equal(x.writes.length,0);
});

test('ambiguous submission is saved before broadcast and cannot create duplicate entries or switch accounts',async t=>{
  const x=setup(t);await x.scenario();await x.prepare('long');x.setFail(true);
  await assert.rejects(x.send('long'),/interrupted/);assert.equal(x.writes.length,1);
  await assert.rejects(x.send('long'),/already sent/);await assert.rejects(x.prepare('long'),/already sent/);
  assert.throws(()=>switchPracticeAttempt('alice',getRecord('alice').updatedAt),/long or short/);
  await x.act({type:'position-check',direction:'long'});assert.ok(getRecord('alice').positions!.long!.open);
  await x.scenario('short');await assert.rejects(x.prepare('short'),/other position/);
  updateRecord('bob',r=>Object.assign(r,{accountId:account,wallet,completedAt:200}));
  await assert.rejects(missionAction('bob',{type:'position-scenario',direction:'long',answers:[0,1]},'http://localhost:3000'),/another saved practice/);
});

test('pending, wrong-account, wrong-side, unrelated, and externally changed positions do not complete',async t=>{
  const x=setup(t);await x.scenario();await x.prepare('long');x.setPending(true);await x.send('long');
  await x.act({type:'position-check',direction:'long'});assert.equal(getRecord('alice').positions!.long!.open,undefined);
  await assert.rejects(x.prepare('long','exit'),/filled entry/);
  const p=getRecord('alice').positions!.long!,o=x.orders.get(p.entry!.clientId);
  for(const changed of [{AccountID:'other'},{Side:'sell'},{ClientOrderID:'foreign'},{ReduceOnly:true},{Size:'1'},{CreateTimestamp:1},{Filled:'1'}])assert.throws(()=>verifyPositionOrder({...o,...changed},p,p.entry!,false));
  o.Status='filled';o.Filled=o.Size;x.setSize('-0.005');await assert.rejects(x.act({type:'position-check',direction:'long'}),/differs/);
  x.setSize('0.005');await x.act({type:'position-check',direction:'long'});
  x.setSize('0');await assert.rejects(x.act({type:'position-check',direction:'long'}),/differs/);assert.equal(getRecord('alice').positions!.long!.completedAt,undefined);
});

test('partial entries and partial closes reconcile exact residuals without prematurely completing',async t=>{
  const x=setup(t);await x.scenario();await x.prepare('long');await x.send('long');
  let p=getRecord('alice').positions!.long!,o=x.orders.get(p.entry!.clientId);o.Status='canceled';o.Filled='0.003000000000000000';x.setSize('0.003');
  await x.act({type:'position-check',direction:'long'});await x.prepare('long','exit');assert.equal(getRecord('alice').positions!.long!.exits[0].size,'0.003');
  await x.send('long','exit');p=getRecord('alice').positions!.long!;o=x.orders.get(p.exits[0].clientId);o.Status='expired';o.Filled='0.002';x.setSize('0.001');
  await x.act({type:'position-check',direction:'long'});assert.equal(getRecord('alice').positions!.long!.completedAt,undefined);
  await x.prepare('long','exit');assert.equal(getRecord('alice').positions!.long!.exits[1].size,'0.001');await x.send('long','exit');await x.act({type:'position-check',direction:'long'});
  assert.ok(getRecord('alice').positions!.long!.completedAt);assert.equal(x.writes.length,3);
});

test('request rejection permits a fresh review; lease prevents concurrent account activity',async t=>{
  const x=setup(t);await x.scenario();await x.prepare('long');x.setReject(true);await assert.rejects(x.send('long'),/did not accept/);
  await x.prepare('long');assert.equal(getRecord('alice').positions!.long!.retired?.length,1);
  const lease=acquirePosition('alice');assert.throws(()=>acquirePosition('alice'),/running/);assert.throws(()=>switchPracticeAttempt('alice',getRecord('alice').updatedAt),/running/);releaseSetup(lease);
  assert.equal(units('0.003000000000000000'),300000n);assert.throws(()=>units('0.000000001'),/precision/);
  assert.equal('answer' in status('alice').positionScenarios.long.questions[0],false);
});

for(const direction of ['long','short'] as const)test(`${direction}: no liquidity blocks close retries without losing order evidence or progress`,async t=>{
  const x=setup(t);await x.scenario(direction);await x.prepare(direction);await x.send(direction);
  await x.act({type:'position-check',direction});await x.prepare(direction,'exit');await x.send(direction,'exit');
  const p=getRecord('alice').positions![direction]!,close=x.orders.get(p.exits[0].clientId);
  close.Status='canceled';close.Filled='0';close.CloseReason='market_order_exceeded_slippage';
  x.setSize(direction==='long'?'0.005':'-0.005');x.setLiquidity(false);
  await x.act({type:'position-check',direction});
  let saved=getRecord('alice').positions![direction]!;
  assert.equal(saved.exits[0].closeReason,'market_order_exceeded_slippage');assert.equal(saved.closeBook?.size,'0');assert.equal(saved.completedAt,undefined);
  await assert.rejects(x.prepare(direction,'exit'),/no buyers|no sellers/);assert.equal(x.writes.length,2);
  x.setLiquidity(true);await x.prepare(direction,'exit');
  // Liquidity disappearing after review must also block a signed request before broadcast.
  x.setLiquidity(false);await assert.rejects(x.send(direction,'exit'),/no buyers|no sellers/);assert.equal(x.writes.length,2);
  assert.equal(getRecord('alice').positions![direction]!.exits.at(-1)!.status,'draft');
  x.setLiquidity(true);await x.send(direction,'exit');await x.act({type:'position-check',direction});
  saved=getRecord('alice').positions![direction]!;assert.ok(saved.completedAt);assert.equal(saved.exits.length,2);assert.equal(x.writes.length,3);
  assert.equal(getRecord('alice').claim?.txHash,'old-tx');
});

for(const direction of ['long','short'] as const)test(`${direction}: both-sided depth gates entry preparation and submission; paused progress resumes`,async t=>{
  const x=setup(t);await x.scenario(direction);
  for(const depth of [
    {bids:[],asks:[['2401','1']]},
    {bids:[['2399','1']],asks:[]},
    {bids:[['2399','0.001']],asks:[['2401','1']]},
    {bids:[['2399','1']],asks:[['2401','0.001']]},
    {bids:[['2300','1']],asks:[['2500','1']]},
    {bids:[['2999','1']],asks:[['3001','1']]},
  ]) {
    x.setDepth(depth);await assert.rejects(x.prepare(direction),/Mission paused/);
    const p=getRecord('alice').positions![direction]!;
    assert.equal(p.entry,undefined);assert.equal(p.entryLiquidity?.status,'paused');assert.ok(p.scenarioAt);
    assert.equal(x.writes.length,0);
  }
  x.setDepth(null);x.setDepthFailure(true);await assert.rejects(x.prepare(direction),/could not be verified/);
  assert.equal(getRecord('alice').positions![direction]!.entryLiquidity?.status,'unavailable');
  x.setDepthFailure(false);await x.act({type:'position-check',direction});
  assert.equal(getRecord('alice').positions![direction]!.entryLiquidity?.status,'ready');
  await x.prepare(direction);const draft=getRecord('alice').positions![direction]!.entry!;
  x.setLiquidity(false);await assert.rejects(x.send(direction),/Mission paused/);
  assert.equal(x.writes.length,0);assert.equal(getRecord('alice').positions![direction]!.entry!.status,'draft');
  assert.equal(getRecord('alice').positions![direction]!.entry!.clientId,draft.clientId);
  x.setLiquidity(true);await x.send(direction);await x.act({type:'position-check',direction});
  assert.ok(getRecord('alice').positions![direction]!.open);assert.equal(x.writes.length,1);
  assert.equal(getRecord('alice').claim?.txHash,'old-tx');assert.equal(getRecord('alice').receipt,'original-receipt');
});
