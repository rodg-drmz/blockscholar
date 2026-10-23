import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {act,create,type ReactTestRenderer} from 'react-test-renderer';
import {FieldNoteReward} from '../packages/spaces-studio/src/field-note-reward.jsx';
import {StrikeMission} from '../packages/spaces-studio/src/strike-mission.jsx';
import {loginWalletProvider} from '../packages/spaces-studio/src/login-wallet.mjs';
import {StrikeWalletSetup} from '../packages/spaces-studio/src/strike-wallet-setup.jsx';
import {BlockscholarProgram} from '../packages/spaces-studio/src/blockscholar-program.jsx';
import {rememberStrikeTabSession,strikeTabSession,clearStrikeTabSessions} from '../packages/spaces-studio/src/strike-tab-session.mjs';
import {emptyPractice} from '../lib/spaces/learning-practice.mjs';

test('field note claims once without wallet approval and shows completion only after confirmation', async t => {
 const descriptors=['window','document','fetch'].map(name=>[name,Object.getOwnPropertyDescriptor(globalThis,name)] as const);
 t.after(()=>{for(const [name,descriptor] of descriptors){if(descriptor)Object.defineProperty(globalThis,name,descriptor);else Reflect.deleteProperty(globalThis,name);}});
 Object.defineProperty(globalThis,'window',{configurable:true,value:{addEventListener(){},removeEventListener(){}}});
 Object.defineProperty(globalThis,'document',{configurable:true,value:{visibilityState:'visible'}});
 let current:any={record:{claim:{status:'confirmed'},blockscholar:{reflection:{learning:'saved'}}},reward:{configured:true}};
 const actions:string[]=[];let renderer:ReactTestRenderer;
 const render=(dirty=false)=>React.createElement(FieldNoteReward,{mission:current,dirty,onChange:(next:any)=>{current=next;renderer.update(render());},onMission(){}});
 globalThis.fetch=async(_url,init)=>{
  const action=JSON.parse(String(init?.body)).type;actions.push(action);
  return Response.json({...current,record:{...current.record,fieldNoteClaim:{txHash:'saved-receipt',status:action==='field-note-claim'?'submitted':'confirmed'}}});
 };
 await act(async()=>{renderer=create(render(true));});
 try{
  assert.equal(renderer!.root.findByType('button').props.disabled,true);
  await act(async()=>{renderer.update(render());});
  await act(async()=>{await renderer.root.findByType('button').props.onClick();});
  assert.match(JSON.stringify(renderer!.toJSON()),/Payment submitted/);
  assert.doesNotMatch(JSON.stringify(renderer!.toJSON()),/Activity complete/);
  await act(async()=>{await renderer.root.findByType('button').props.onClick();});
  assert.match(JSON.stringify(renderer!.toJSON()),/Activity complete/);
  assert.match(JSON.stringify(renderer!.toJSON()),/5 test ADA earned/);
  assert.equal(renderer!.root.findAllByType('button').length,0);
  assert.deepEqual(actions,['field-note-claim','field-note-receipt']);
 }finally{act(()=>renderer!.unmount());}
});

test('sections unlock after reflection without locking the final Program step or fetching locked sections',async(t)=>{
 const descriptors=['window','document','fetch'].map(name=>[name,Object.getOwnPropertyDescriptor(globalThis,name)] as const);
 t.after(()=>{for(const [name,descriptor] of descriptors){if(descriptor)Object.defineProperty(globalThis,name,descriptor);else Reflect.deleteProperty(globalThis,name);}});
 Object.defineProperty(globalThis,'window',{configurable:true,value:{addEventListener(){},removeEventListener(){}}});
 Object.defineProperty(globalThis,'document',{configurable:true,value:{visibilityState:'visible',addEventListener(){},removeEventListener(){}}});
 const reads:string[]=[];const mission={enabled:true,authenticated:true,record:{completedAt:1,blockscholar:{enrolledAt:1}},questions:[],reward:{}};
 globalThis.fetch=async(url,init)=>{
  const body=init?.body?JSON.parse(String(init.body)):{};
  if(body.type==='program-reflection') return Response.json({...mission,record:{...mission.record,blockscholar:{enrolledAt:1,reflection:{...body,savedAt:2}}}});
  reads.push(String(url));
  return Response.json({mission,viewer:'synthetic',practice:{...emptyPractice(),prepScore:8}});
 };
 let renderer:ReactTestRenderer|undefined;
 try{
  for(const initialView of ['practice','fund']){
   await act(async()=>{renderer=create(React.createElement(BlockscholarProgram,{standalone:true,initialView}));});
   const nav=renderer!.root.findByProps({'aria-label':'Blockscholar sections'});
   assert.deepEqual(nav.findAllByType('button').map(b=>b.props.disabled),[false,true,true,true]);
   assert.equal(nav.findAllByType('button')[0].props['aria-pressed'],true);
   assert.equal(renderer!.root.findAllByType(StrikeMission).length,0);
   if(initialView==='practice'){act(()=>renderer!.unmount());renderer=undefined;}
  }
  assert.deepEqual(reads,['/api/learn/blockscholar','/api/learn/blockscholar']);
  const path=renderer!.root.findByProps({'aria-label':'Your program path'});
  await act(async()=>{await path.findAllByType('button')[2].props.onClick();});
  assert.equal(renderer!.root.findByProps({'aria-label':'My work and evidence'}).props.hidden,false);
  await act(async()=>{for(const field of renderer!.root.findAllByType('textarea')) field.props.onChange({target:{value:'I verified my test order and recorded the resulting evidence.'}});});
  await act(async()=>{renderer!.root.findByProps({className:'sm-card bs-notes'}).findByType('form').props.onSubmit({preventDefault(){}});});
  const nav=renderer!.root.findByProps({'aria-label':'Blockscholar sections'});
  assert.deepEqual(nav.findAllByType('button').map(b=>b.props.disabled),[false,false,false,false]);
  assert.match(JSON.stringify(renderer!.toJSON()),/All learning milestones saved/);
 }finally{if(renderer)act(()=>renderer!.unmount());}
});

test('program steps retain enrollment and saved preparation without the resume card',async(t)=>{
 const descriptors=['window','document','fetch'].map(name=>[name,Object.getOwnPropertyDescriptor(globalThis,name)] as const);
 t.after(()=>{for(const [name,descriptor] of descriptors){if(descriptor)Object.defineProperty(globalThis,name,descriptor);else Reflect.deleteProperty(globalThis,name);}});
 Object.defineProperty(globalThis,'window',{configurable:true,value:{addEventListener(){},removeEventListener(){}}});
 Object.defineProperty(globalThis,'document',{configurable:true,value:{visibilityState:'visible',addEventListener(){},removeEventListener(){}}});
 let enrolled=0; const views:string[]=[];
 const mission={enabled:true,authenticated:true,record:{},questions:[],reward:{}};
 globalThis.fetch=async(_url,init)=>{
  const body=init?.body?JSON.parse(String(init.body)):{};
  if(body.type==='program-enroll'){enrolled++;return Response.json({...mission,record:{blockscholar:{enrolledAt:1}}});}
  return Response.json({mission,viewer:'synthetic',practice:{...emptyPractice(),prepScore:8}});
 };
 let renderer:ReactTestRenderer|undefined;
 try{
  await act(async()=>{renderer=create(React.createElement(BlockscholarProgram,{standalone:true,onViewChange:(v:string)=>views.push(v)}));});
  assert.equal(enrolled,0);
  assert.equal(renderer!.root.findAll(n=>n.props.className==='sm-card bs-resume').length,0);
  const path=renderer!.root.findByProps({'aria-label':'Your program path'});
  assert.equal(path.findAllByType('li').length,3);
  await act(async()=>{await path.findAllByType('button')[0].props.onClick();});
  assert.equal(enrolled,1);assert.equal(views.at(-1),'learn');
  assert.match(JSON.stringify(renderer!.toJSON()),/Ready for the workshop/);
  const nav=renderer!.root.findByProps({'aria-label':'Blockscholar sections'});
  await act(async()=>nav.findAllByType('button')[0].props.onClick());
  await act(async()=>{await path.findAllByType('button')[0].props.onClick();});
  assert.equal(enrolled,1);
 }finally{act(()=>renderer?.unmount());}
});

test('available trading balance does not present a pending deposit as verified; settled receipt updates the display',()=>{
 const deposit={status:'registered',chainConfirmedAt:123,settlementStatus:'pending_settlement',usdValue:'21.34'};
 const props={data:{record:{accountId:'practice',wallet:'addr_test1example',deposit}},funding:{accountId:'practice',funded:true,availableBalance:'21.343071'},checkState:{checkedAt:Date.now()},busy:null,connected:false,walletControls:null,act(){},deposit(){},signDeposit(){},reconnect(){}};
 let renderer:ReactTestRenderer|undefined;
 try{
  act(()=>{renderer=create(React.createElement(StrikeWalletSetup,props));});
  const text=JSON.stringify(renderer!.toJSON());
  assert.match(text,/Strike is settling your deposit/);
  assert.match(text,/pending settlement/);
  assert.match(text,/21.343071/);
  assert.doesNotMatch(text,/Waiting for Cardano confirmation|Continue to practice/);
  assert.equal(renderer!.root.findAllByType('li')[2].props.className,'');
  act(()=>renderer!.update(React.createElement(StrikeWalletSetup,{...props,data:{record:{...props.data.record,deposit:{...deposit,status:'verified',creditedUsd:'21.343071'}}}})));
  assert.match(JSON.stringify(renderer!.toJSON()),/Ready to practice/);
  assert.equal(renderer!.root.findAllByType('li')[2].props.className,'sm-done');
 }finally{act(()=>renderer?.unmount());}
});

test('wallet selection uses the signed-in provider, never an unrelated chain or first available wallet',()=>{
 const wallets=[{id:'lace',name:'Lace'},{id:'vespr',name:'VESPR'}];
 assert.equal(loginWalletProvider(wallets,{chain:'cardano',walletName:'VESPR'}),wallets[1]);
 assert.equal(loginWalletProvider(wallets,{chain:'solana',walletName:'VESPR'}),null);
 assert.equal(loginWalletProvider(wallets,{chain:'cardano',walletName:'missing'}),null);
});

test('signed-in Cardano API goes straight to explicit Strike authorization without reconnecting or auto-signing',async(t)=>{
 const descriptors=['window','document','fetch'].map(name=>[name,Object.getOwnPropertyDescriptor(globalThis,name)] as const);
 t.after(()=>{for(const [name,descriptor] of descriptors){if(descriptor)Object.defineProperty(globalThis,name,descriptor);else Reflect.deleteProperty(globalThis,name);}});
 let enabled=0,signed=0,publicKey='';const actions:string[]=[];
 const api={getNetworkId:async()=>0,getChangeAddress:async()=>'addr_test1example',signData:async()=>{signed++;return{key:'test',signature:'test'};}};
 Object.defineProperty(globalThis,'window',{configurable:true,value:{cardano:{vespr:{name:'VESPR',enable:async()=>{enabled++;return api;}}},addEventListener(){},removeEventListener(){}}});
 Object.defineProperty(globalThis,'document',{configurable:true,value:{visibilityState:'visible',addEventListener(){},removeEventListener(){}}});
 const base={enabled:true,authenticated:true,builderConfigured:true,record:{},questions:[],reward:{}};
 globalThis.fetch=async(_url,init)=>{
  const body=init?.body?JSON.parse(String(init.body)):{};if(body.type)actions.push(body.type);
  if(body.type==='builder-challenge'){publicKey=body.publicKey;return Response.json({...base,challenge:{addressHex:'00',hex:'00'}});}
  if(['builder-connect','account-check'].includes(body.type))return Response.json({...base,record:{accountId:'practice-account',wallet:'addr_test1example',apiPublicKey:publicKey}});
  return Response.json(base);
 };
 let renderer:ReactTestRenderer|undefined;
 try{
  await act(async()=>{renderer=create(React.createElement(StrikeMission,{embedded:true,walletConnection:{chain:'cardano',walletName:'VESPR',address:'addr_test1example',api}}));});
  assert.equal(enabled,0);assert.equal(signed,0);assert.deepEqual(actions,['builder-challenge']);
  assert.match(JSON.stringify(renderer!.toJSON()),/Your DeFi Workspace/);
  assert.equal(renderer!.root.findAllByType('select').length,0);
  const approve=renderer!.root.findAllByType('button').find(button=>button.props.children==='Authorize Strike practice');assert.ok(approve);
  await act(async()=>{await approve.props.onClick();});
  assert.equal(enabled,0);assert.equal(signed,1);
  assert.deepEqual(actions,['builder-challenge','builder-connect','account-check']);
  assert.match(JSON.stringify(renderer!.toJSON()),/Fund your practice wallet/);
 }finally{act(()=>renderer?.unmount());}
});

test('funded workshop keeps progress and places pending/error feedback beside the failed action',async(t)=>{
 const descriptors=['window','document','fetch'].map(name=>[name,Object.getOwnPropertyDescriptor(globalThis,name)] as const);
 t.after(()=>{for(const [name,descriptor] of descriptors){if(descriptor)Object.defineProperty(globalThis,name,descriptor);else Reflect.deleteProperty(globalThis,name);}});
 Object.defineProperty(globalThis,'window',{configurable:true,value:{addEventListener(){},removeEventListener(){}}});
 Object.defineProperty(globalThis,'document',{configurable:true,value:{visibilityState:'visible',addEventListener(){},removeEventListener(){}}});
 const record={accountId:'practice-account',wallet:'addr_test1example',apiPublicKey:'test-key',lessonAt:1,deposit:{status:'verified',creditedUsd:'21.343071'},practiceGrant:{status:'confirmed'}};
 const base={enabled:true,authenticated:true,builderConfigured:true,record,questions:[],reward:{}};
 const actions:string[]=[]; let failRequest:((response:Response)=>void)|undefined;
 globalThis.fetch=async(_url,init)=>{
  const body=init?.body?JSON.parse(String(init.body)):{};if(body.type)actions.push(body.type);
  if(body.type==='account-check')return Response.json({...base,funding:{accountId:record.accountId,funded:true,availableBalance:'21.343071'}});
  if(body.type==='order-prepare')return new Promise<Response>(resolve=>{failRequest=resolve;});
  return Response.json(base);
 };
 let renderer:ReactTestRenderer|undefined;
 try{
  await act(async()=>{renderer=create(React.createElement(StrikeMission,{embedded:true}));});
  const button=(label:string)=>renderer!.root.findAllByType('button').find(b=>b.props.children===label)!;
  await act(async()=>{await button('Check balance').props.onClick();});
  assert.match(JSON.stringify(renderer!.toJSON()),/Your practice account is funded/);
  assert.equal(renderer!.root.findAllByType(StrikeWalletSetup).length,0);
  let action:Promise<void>|undefined;
  await act(async()=>{action=button('Prepare practice order').props.onClick();});
  let feedback=renderer!.root.findByProps({'data-feedback-area':'order'});
  assert.equal(feedback.parent?.props.className,'sm-trade');
  assert.match(feedback.findByProps({role:'status'}).props.children,/Reading current testnet market rules/);
  await act(async()=>{failRequest!(Response.json({error:'Strike account check unavailable'},{status:503}));await action;});
  feedback=renderer!.root.findByProps({'data-feedback-area':'order'});
  assert.equal(feedback.parent?.props.className,'sm-trade');
  assert.equal(feedback.findByProps({role:'alert'}).findByType('p').props.children,'Strike account check unavailable');
  assert.match(JSON.stringify(renderer!.toJSON()),/21.34 test USD/);
  assert.deepEqual(actions,['account-check','order-prepare']);
  assert.equal(renderer!.root.findAllByProps({role:'alert'}).length,1);
 }finally{act(()=>renderer?.unmount());}
});


test('approved Strike permission survives workspace remounts but never crosses accounts or sign-out',async(t)=>{
 const descriptors=['window','document','fetch'].map(name=>[name,Object.getOwnPropertyDescriptor(globalThis,name)] as const);
 t.after(()=>{clearStrikeTabSessions();for(const [name,descriptor] of descriptors){if(descriptor)Object.defineProperty(globalThis,name,descriptor);else Reflect.deleteProperty(globalThis,name);}});
 let enables=0;const actions:string[]=[];
 Object.defineProperty(globalThis,'window',{configurable:true,value:{cardano:{vespr:{name:'VESPR',enable:async()=>{enables++;},isEnabled:async()=>true}},addEventListener(){},removeEventListener(){}}});
 Object.defineProperty(globalThis,'document',{configurable:true,value:{visibilityState:'visible',addEventListener(){},removeEventListener(){}}});
 const record={id:'mission-one',accountId:'account-one',wallet:'addr_test1example',apiPublicKey:'approved-key',lessonAt:1,practiceExistingAt:1,order:{id:'123'},trade:{status:'sent',clientId:'order-one'}};
 record.order=Object.assign(record.order,{clientId:'order-one'});
 const session={publicKey:'approved-key',privateKey:new Uint8Array(32)};
 rememberStrikeTabSession(record,record,session);
 assert.equal(strikeTabSession({...record,id:'another-mission'}),null);
 assert.equal(strikeTabSession({...record,accountId:'another-account'}),null);
 assert.equal(strikeTabSession({...record,apiPublicKey:'rotated-key'}),null);
 globalThis.fetch=async(_url,init)=>{if(init?.body)actions.push(JSON.parse(String(init.body)).type);return Response.json({enabled:true,authenticated:true,builderConfigured:true,record,questions:[],reward:{}});};
 let renderer:ReactTestRenderer|undefined;
 try{
  for(let mount=0;mount<2;mount++){
   await act(async()=>{renderer=create(React.createElement(StrikeMission,{embedded:true,walletConnection:{chain:'cardano',walletName:'VESPR'}}));});
   const cancel=renderer!.root.findAllByType('button').find(b=>b.props.children==='Cancel this testnet order');
   assert.equal(cancel?.props.disabled,false);
   assert.match(JSON.stringify(renderer!.root.findByProps({className:'sm-open-order-receipt'}).findByProps({role:'status'}).props.children.map((child:any)=>child.props.children)),/Order confirmed open/);
   assert.equal(renderer!.root.findByProps({className:'sm-open-order-receipt'}).findByType('a').props.href,'https://testnet.strikefinance.org/');
   assert.equal(renderer!.root.findAllByProps({className:'sm-reconnect'}).length,0);
   act(()=>renderer!.unmount());renderer=undefined;
  }
  assert.equal(enables,0);assert.deepEqual(actions,['order-check','order-check']);
  clearStrikeTabSessions();assert.equal(strikeTabSession(record),null);
 }finally{act(()=>renderer?.unmount());}
});

test('verified Preprod wallet claims directly without a second ownership or Strike authorization prompt',async(t)=>{
 const descriptors=['window','document','fetch'].map(name=>[name,Object.getOwnPropertyDescriptor(globalThis,name)] as const);
 t.after(()=>{for(const [name,descriptor] of descriptors){if(descriptor)Object.defineProperty(globalThis,name,descriptor);else Reflect.deleteProperty(globalThis,name);}});
 let enables=0;const actions:string[]=[];
 Object.defineProperty(globalThis,'window',{configurable:true,value:{cardano:{vespr:{name:'VESPR',enable:async()=>{enables++;},isEnabled:async()=>true}},addEventListener(){},removeEventListener(){}}});
 Object.defineProperty(globalThis,'document',{configurable:true,value:{visibilityState:'visible',addEventListener(){},removeEventListener(){}}});
 const address='addr_test1verified';const base={enabled:true,authenticated:true,builderConfigured:true,record:{id:'mission',wallet:address,accountId:'account',lessonAt:1,completedAt:2},questions:[],reward:{configured:true,linkedAddress:address}};
 globalThis.fetch=async(_url,init)=>{const a=init?.body?JSON.parse(String(init.body)):{};if(a.type)actions.push(a.type);return Response.json(a.type==='claim'?{...base,record:{...base.record,rewardAddress:address,claim:{status:'confirmed',txHash:'test-receipt'}}}:base);};
 let renderer:ReactTestRenderer|undefined;
 try{
  await act(async()=>{renderer=create(React.createElement(StrikeMission,{embedded:true,walletConnection:{chain:'cardano',walletName:'VESPR'}}));});
  assert.equal(renderer!.root.findAllByType('button').filter(b=>b.props.children==='Set Preprod reward wallet').length,0);
  const claim=renderer!.root.findAllByType('button').find(b=>b.props.children==='Claim 2 test ADA')!;assert.equal(claim.props.disabled,false);
  await act(async()=>{await claim.props.onClick();});
  assert.deepEqual(actions,['claim']);assert.equal(enables,0);
  assert.match(JSON.stringify(renderer!.toJSON()),/Payment confirmed on Cardano Preprod/);
 }finally{act(()=>renderer?.unmount());}
});
