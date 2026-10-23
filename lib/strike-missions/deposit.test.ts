import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as CSL from '@emurgo/cardano-serialization-lib-nodejs';
import { validateQuote, validateDepositTx, addDepositWitness, depositAction, checkDeposit, verifiedWalletUtxos } from './deposit';
import { chain } from './bounty';
import { fundPractice, practiceSponsorFile, requirePracticeWallet } from './practice-funding';
import { getRecord, updateRecord, acquireSetup, releaseSetup } from './store';
import { DEPOSIT_AMOUNT, MISSION, publicRecord, type MissionRecord } from './model';
import { missionAction } from './service';
import { newStrikeSession, signDepositRequest } from '../../packages/spaces-studio/src/strike-session.mjs';

// Synthetic addresses model the observed quote/build mismatch without user transaction data.
const STRIKE_PREPROD_BATCHER = CSL.EnterpriseAddress.new(0, CSL.Credential.from_keyhash(CSL.Ed25519KeyHash.from_hex('d'.repeat(56)))).to_address().to_bech32();
const STRIKE_PREPROD_VAULT = CSL.EnterpriseAddress.new(0, CSL.Credential.from_keyhash(CSL.Ed25519KeyHash.from_hex('e'.repeat(56)))).to_address().to_bech32();
const account = '019a0c2e-1111-7000-8000-000000000001';
const wallet = (network=0) => { const secret = CSL.PrivateKey.generate_ed25519(); return {secret, address:CSL.EnterpriseAddress.new(network,CSL.Credential.from_keyhash(secret.to_public().hash())).to_address()}; };
const alice = wallet(), vault = wallet(), foreign = wallet(), session = newStrikeSession();
const inputs = [{tx_hash:'a'.repeat(64),output_index:0,amount:[{unit:'lovelace',quantity:'104000000'}]}];
const base:MissionRecord = {id:MISSION,startedAt:Date.now(),updatedAt:Date.now(),wallet:alice.address.to_bech32(),walletKey:alice.secret.to_public().hash().to_hex(),accountId:account,apiPublicKey:session.publicKey};
function quote(overrides={}) { return {request_id:'test-deposit-request',deposit_address:vault.address.to_bech32(),confirmations_required:2,quote:{account_id:account,blockchain:'cardano',asset_symbol:'ADA',asset_amount:DEPOSIT_AMOUNT,usd_value:'25.5',expiration_at:Date.now()+300_000},...overrides}; }
function unsigned(destination=vault.address.to_bech32(), change=alice.address.to_bech32(), amount='100000000', fee='170000') {
  const ins=CSL.TransactionInputs.new();ins.add(CSL.TransactionInput.new(CSL.TransactionHash.from_hex(inputs[0].tx_hash),0));
  const outs=CSL.TransactionOutputs.new();outs.add(CSL.TransactionOutput.new(CSL.Address.from_bech32(destination),CSL.Value.new(CSL.BigNum.from_str(amount))));outs.add(CSL.TransactionOutput.new(CSL.Address.from_bech32(change),CSL.Value.new(CSL.BigNum.from_str(String(104000000n-BigInt(amount)-BigInt(fee))))));
  const body=CSL.TransactionBody.new_tx_body(ins,outs,CSL.BigNum.from_str(fee));body.set_ttl(CSL.BigNum.from_str('2800'));
  return CSL.Transaction.new(body,CSL.TransactionWitnessSet.new()).to_hex();
}
function batched(d:ReturnType<typeof validateQuote>, overrides: {requestId?:string;accountId?:string;key?:string;expiry?:number;destination?:string;amount?:string}={}) {
  const tx=CSL.Transaction.from_hex(unsigned(overrides.destination || STRIKE_PREPROD_BATCHER,undefined,overrides.amount || '102000000'));
  const body=tx.body(), outputs=body.outputs(), first=outputs.get(0), fields=CSL.PlutusList.new();
  for(const value of [Buffer.from(overrides.requestId ?? d.requestId),Buffer.from(overrides.accountId ?? d.accountId),Buffer.from(overrides.key ?? base.walletKey!,'hex')])fields.add(CSL.PlutusData.new_bytes(value));
  fields.add(CSL.PlutusData.new_integer(CSL.BigInt.from_str(String(overrides.expiry ?? Date.now()+3600000))));
  first.set_plutus_data(CSL.PlutusData.new_constr_plutus_data(CSL.ConstrPlutusData.new(CSL.BigNum.from_str('0'),fields)));
  const replaced=CSL.TransactionOutputs.new();replaced.add(first);replaced.add(outputs.get(1));
  const b=CSL.TransactionBody.new_tx_body(body.inputs(),replaced,body.fee());b.set_ttl(CSL.BigNum.from_str('2800'));
  return CSL.Transaction.new(b,tx.witness_set()).to_hex();
}

function setup(t:test.TestContext) {
  const env={...process.env}, original=global.fetch, dir=fs.mkdtempSync(path.join(os.tmpdir(),'strike-deposit-test-'));
  process.env.STRIKE_MISSIONS_DATA_DIR=dir;process.env.STRIKE_MISSIONS_ENABLED='true';process.env.STRIKE_MISSIONS_BLOCKFROST_PREPROD='preprod-synthetic-never-live';
  t.after(()=>{process.env=env;global.fetch=original;fs.rmSync(dir,{recursive:true,force:true});});
  updateRecord('alice',r=>Object.assign(r,base)); return dir;
}
function witness(hex:string, w=alice) { const set=CSL.TransactionWitnessSet.new(),keys=CSL.Vkeywitnesses.new();keys.add(CSL.make_vkey_witness(CSL.FixedTransaction.from_hex(hex).transaction_hash(),w.secret));set.set_vkeys(keys);return set.to_hex(); }

test('wallet-selected funds include other derived addresses and tokens, with Preprod verifying their values',async t=>{
  setup(t);
  const stake=CSL.PrivateKey.generate_ed25519().to_public().hash();
  const address=(key:CSL.PrivateKey,network=0,s=stake)=>CSL.BaseAddress.new(network,CSL.Credential.from_keyhash(key.to_public().hash()),CSL.Credential.from_keyhash(s)).to_address();
  const linked=address(alice.secret), derived=address(foreign.secret);
  const policy=CSL.ScriptHash.from_hex('b'.repeat(56)), name=CSL.AssetName.new(Buffer.from('TEST'));
  const value=CSL.Value.new(CSL.BigNum.from_str('8000000000')), multi=CSL.MultiAsset.new();
  multi.set_asset(policy,name,CSL.BigNum.from_str('7'));value.set_multiasset(multi);
  const encode=(a=derived)=>CSL.TransactionUnspentOutput.new(CSL.TransactionInput.new(CSL.TransactionHash.from_hex(inputs[0].tx_hash),0),CSL.TransactionOutput.new(a,value)).to_hex();
  const row={...inputs[0],amount:[{unit:'lovelace',quantity:'8000000000'},{unit:policy.to_hex()+Buffer.from(name.name()).toString('hex'),quantity:'7'}]};
  global.fetch=async input=>{assert.ok(String(input).includes(derived.to_bech32()));return Response.json([row]);};
  const verified=await verifiedWalletUtxos([encode()],linked.to_bech32());
  assert.equal(verified[0].address,derived.to_bech32());assert.deepEqual(verified[0].amount,row.amount);
  await assert.rejects(verifiedWalletUtxos([encode(address(foreign.secret,1))],linked.to_bech32()),/do not match/);
  await assert.rejects(verifiedWalletUtxos([encode(address(foreign.secret,0,foreign.secret.to_public().hash()))],linked.to_bech32()),/do not match/);
  await assert.rejects(verifiedWalletUtxos([encode(),encode()],linked.to_bech32()),/duplicate/);
  global.fetch=async()=>Response.json([{...row,amount:[{unit:'lovelace',quantity:'1'}]}]);
  await assert.rejects(verifiedWalletUtxos([encode()],linked.to_bech32()),/unavailable/);
  global.fetch=async()=>Response.json([]);
  await assert.rejects(verifiedWalletUtxos([encode()],linked.to_bech32()),/unavailable/);
});

test('token-bearing deposits return every token and require the actual input signing keys',()=>{
  const policy=CSL.ScriptHash.from_hex('b'.repeat(56)),name=CSL.AssetName.new(Buffer.from('TEST'));
  const tokenUnit=policy.to_hex()+Buffer.from(name.name()).toString('hex');
  const selected=[{...inputs[0],address:foreign.address.to_bech32(),amount:[...inputs[0].amount,{unit:tokenUnit,quantity:'7'}]}];
  const tx=CSL.Transaction.from_hex(unsigned()),outs=tx.body().outputs(),change=outs.get(1),value=change.amount(),multi=CSL.MultiAsset.new();
  multi.set_asset(policy,name,CSL.BigNum.from_str('7'));value.set_multiasset(multi);
  const outputs=CSL.TransactionOutputs.new();outputs.add(outs.get(0));outputs.add(CSL.TransactionOutput.new(change.address(),value));
  const body=CSL.TransactionBody.new_tx_body(tx.body().inputs(),outputs,tx.body().fee());body.set_ttl(CSL.BigNum.from_str('2800'));
  const hex=CSL.Transaction.new(body,tx.witness_set()).to_hex(),q=validateQuote(quote(),base);
  const checked=validateDepositTx(hex,q,base.wallet!,selected,1000),d={...q,...checked,unsignedTx:hex};
  assert.deepEqual(checked.inputKeys,[foreign.secret.to_public().hash().to_hex()]);
  assert.doesNotThrow(()=>addDepositWitness(d,base.walletKey!,witness(hex,foreign)));
  assert.throws(()=>addDepositWitness(d,base.walletKey!,witness(hex)),/signature/);
  assert.throws(()=>validateDepositTx(unsigned(),q,base.wallet!,selected,1000),/balance/);
  const required=CSL.Ed25519KeyHashes.new();required.add(alice.secret.to_public().hash());body.set_required_signers(required);
  const bothHex=CSL.Transaction.new(body,tx.witness_set()).to_hex(),both={...q,...validateDepositTx(bothHex,q,base.wallet!,selected,1000),unsignedTx:bothHex};
  assert.throws(()=>addDepositWitness(both,base.walletKey!,witness(bothHex,foreign)),/signature/);
  const set=CSL.TransactionWitnessSet.new(),keys=CSL.Vkeywitnesses.new();
  for(const w of [alice,foreign]) keys.add(CSL.make_vkey_witness(CSL.FixedTransaction.from_hex(bothHex).transaction_hash(),w.secret));
  set.set_vkeys(keys);assert.doesNotThrow(()=>addDepositWitness(both,base.walletKey!,set.to_hex()));
});

test('quote and transaction enforce testnet, exact amount, account, destination, change, input ownership and fee cap',()=>{
  const d=validateQuote(quote(),base), hex=unsigned();
  assert.equal(validateDepositTx(hex,d,base.wallet!,inputs,1000).fee,170000);
  for(const q of [quote({deposit_address:wallet(1).address.to_bech32()}),quote({quote:{...quote().quote,account_id:'other'}}),quote({quote:{...quote().quote,asset_amount:'100'}}),quote({quote:{...quote().quote,expiration_at:Date.now()-1}})]) assert.throws(()=>validateQuote(q,base));
  for(const tx of [unsigned(foreign.address.to_bech32()),unsigned(undefined,foreign.address.to_bech32()),unsigned(undefined,undefined,'99000000'),unsigned(undefined,undefined,undefined,'600000')]) assert.throws(()=>validateDepositTx(tx,d,base.wallet!,inputs,1000));
  assert.throws(()=>validateDepositTx(hex,d,base.wallet!,[],1000));
  assert.throws(()=>validateDepositTx(hex,d,base.wallet!,inputs,3000));
  const changed=CSL.Transaction.from_hex(hex),body=changed.body();body.set_donation(CSL.BigNum.from_str('1'));
  assert.throws(()=>validateDepositTx(CSL.Transaction.new(body,changed.witness_set()).to_hex(),d,base.wallet!,inputs,1000));
  assert.throws(()=>requirePracticeWallet({...base,wallet:wallet(1).address.to_bech32()}));
});

test('only official API builds may select rotating batchers, with strict datum/fee/network checks',()=>{
  const d=validateQuote(quote({deposit_address:STRIKE_PREPROD_VAULT}),base);
  assert.throws(()=>validateDepositTx(batched(d),d,base.wallet!,inputs,1000),/needs verified routing information/);
  for(const destination of [STRIKE_PREPROD_BATCHER,foreign.address.to_bech32()]) {
    const checked=validateDepositTx(batched(d,{destination}),d,base.wallet!,inputs,1000,'strike-testnet-api');
    assert.equal(checked.paymentAddress,destination);assert.equal(checked.paymentAmount,'102000000');assert.equal(checked.batcherFee,2000000);assert.equal(checked.routeAuthority,'strike-testnet-api');
  }
  for(const bad of [{requestId:'other'},{accountId:'other'},{key:foreign.secret.to_public().hash().to_hex()},{expiry:Date.now()-1},{expiry:Date.now()+86400000},{amount:'103000000'},{destination:wallet(1).address.to_bech32()}])assert.throws(()=>validateDepositTx(batched(d,bad),d,base.wallet!,inputs,1000,'strike-testnet-api'));
  assert.throws(()=>validateDepositTx(unsigned(STRIKE_PREPROD_BATCHER,undefined,'102000000'),d,base.wallet!,inputs,1000,'strike-testnet-api'));
  assert.throws(()=>validateDepositTx(batched(d),d,base.wallet!,[],1000,'strike-testnet-api'));
  assert.equal(publicRecord({...base,deposit:{...d,...validateDepositTx(batched(d),d,base.wallet!,inputs,1000,'strike-testnet-api')}}).deposit?.batcherFee,2000000);
});

test('deposit signatures bind the saved transaction to the linked wallet; private outboxes stay server-side',()=>{
  const hex=unsigned(), d={...validateQuote(quote(),base),...validateDepositTx(hex,validateQuote(quote(),base),base.wallet!,inputs,1000),unsignedTx:hex};
  const signed=addDepositWitness(d,base.walletKey!,witness(hex));
  assert.equal(CSL.FixedTransaction.from_hex(signed).transaction_hash().to_hex(),d.txHash);
  assert.throws(()=>addDepositWitness(d,base.walletKey!,witness(hex,foreign)));
  assert.throws(()=>addDepositWitness(d,base.walletKey!,witness(unsigned(undefined,undefined,'99000000'))));
  const safe=publicRecord({...base,deposit:{...d,signedTx:signed},practiceGrant:{status:'submitted',signedTx:signed,txHash:d.txHash,fee:170000,expiresSlot:2800}});
  assert.equal(safe.deposit?.signedTx,undefined);assert.equal(safe.practiceGrant?.signedTx,undefined);assert.equal(safe.walletKey,undefined);
});

test('sponsored grant survives ambiguous submission, pays once, and preserves lessons and bounty',async t=>{
  setup(t);const sponsor=wallet();fs.writeFileSync(practiceSponsorFile(),JSON.stringify({purpose:'blockscholar-practice-v1',network:'preprod',key:sponsor.secret.to_hex()}),{mode:0o600});
  const legacyMainnet=wallet(1).address.to_bech32();
  updateRecord('alice',r=>{r.practiceConnection={wallet:base.wallet!,walletKey:base.walletKey!,accountId:account,apiPublicKey:session.publicKey};r.wallet=legacyMainnet;r.accountId='019a0c2e-1111-7000-8000-000000000007';r.lessonAt=123;r.claim={id:'existing-bounty',status:'reserved'};r.blockscholar={enrolledAt:100,reflection:{learning:'saved',application:'saved',artifactUrl:'',savedAt:100}};});
  let accepted=false;const broadcasts:string[]=[];
  global.fetch=async(input,init)=>{
    const u=new URL(String(input));
    if(u.hostname==='api-v2-testnet.strikefinance.org')return Response.json({account_id:account,blockchain:'cardano',blockchain_address:base.wallet});
    assert.equal(u.hostname,'cardano-preprod.blockfrost.io');
    if(u.pathname.endsWith('/tx/submit')){broadcasts.push(Buffer.from(init!.body as Uint8Array).toString('hex'));accepted=true;throw new Error('timeout after acceptance');}
    if(u.pathname.includes('/addresses/'))return Response.json([{...inputs[0],amount:[{unit:'lovelace',quantity:'500000000'}]}]);
    if(u.pathname.endsWith('/parameters'))return Response.json({min_fee_a:44,min_fee_b:155381,coins_per_utxo_size:'4310',pool_deposit:'500000000',key_deposit:'2000000',max_val_size:'5000',max_tx_size:16384});
    if(u.pathname.endsWith('/blocks/latest'))return Response.json({slot:1000,height:10});
    if(u.pathname.endsWith('/utxos'))return Response.json({outputs:[{address:base.wallet,amount:[{unit:'lovelace',quantity:'104000000'}]}]});
    return accepted?Response.json({hash:getRecord('alice').practiceGrant!.txHash,valid_contract:true,block_height:9}):new Response('',{status:404});
  };
  await assert.rejects(fundPractice('alice',false));
  assert.equal(getRecord('alice').practiceGrant?.status,'submitted');assert.equal(broadcasts.length,1);
  updateRecord('bob',r=>Object.assign(r,base,{accountId:'other',wallet:foreign.address.to_bech32(),walletKey:foreign.secret.to_public().hash().to_hex()}));
  await assert.rejects(fundPractice('bob',false),/Another practice grant/);
  await fundPractice('alice',true);await fundPractice('alice',false);
  const r=getRecord('alice');assert.equal(r.practiceGrant?.status,'confirmed');assert.equal(r.wallet,legacyMainnet);assert.equal(CSL.Transaction.from_hex(broadcasts[0]).body().outputs().get(0).address().to_bech32(),base.wallet);assert.equal(broadcasts.length,1);assert.equal(r.lessonAt,123);assert.equal(r.claim?.id,'existing-bounty');assert.equal(r.blockscholar?.reflection?.learning,'saved');
  const lease=acquireSetup('alice',true);assert.throws(()=>acquireSetup('alice',true),/already running/);releaseSetup(lease);
});

test('older 102 ADA grant receipts still reconcile after the grant budget changes',async t=>{
  setup(t);const old={status:'submitted' as const,txHash:'c'.repeat(64),fee:170000,expiresSlot:2800};
  updateRecord('alice',r=>{r.practiceGrant=old;});
  global.fetch=async input=>{const path=new URL(String(input)).pathname;
    if(path.endsWith('/blocks/latest'))return Response.json({height:20,slot:1000});
    if(path.endsWith('/utxos'))return Response.json({outputs:[{address:base.wallet,amount:[{unit:'lovelace',quantity:'102000000'}]}]});
    return Response.json({hash:old.txHash,valid_contract:true,block_height:19});
  };
  await fundPractice('alice',true);assert.equal(getRecord('alice').practiceGrant?.status,'confirmed');
});

test('quote → reviewed wallet signature → durable submit → Strike credit; pending and wrong-account history cannot complete it',async t=>{
  setup(t);let accepted=false,history='pending', depositCalls=0;const depositQuote=quote({deposit_address:STRIKE_PREPROD_VAULT});const hex=batched(validateQuote(depositQuote,base));
  global.fetch=async(input,init)=>{
    const u=new URL(String(input));
    if(u.hostname==='cardano-preprod.blockfrost.io'){
      if(u.pathname.includes('/addresses/'))return Response.json(inputs);
      if(u.pathname.endsWith('/blocks/latest'))return Response.json({slot:1000,height:20});
      if(u.pathname.endsWith('/tx/submit')){depositCalls++;accepted=true;throw new Error('synthetic lost acknowledgement');}
      if(u.pathname.endsWith('/utxos'))return Response.json({outputs:[{address:STRIKE_PREPROD_BATCHER,amount:[{unit:'lovelace',quantity:'102000000'}]}]});
      return accepted?Response.json({hash:getRecord('alice').deposit?.txHash,valid_contract:true,block_height:19}):new Response('',{status:404});
    }
    assert.equal(u.hostname,'api-v2-testnet.strikefinance.org');
    if(u.pathname==='/v2/time')return Response.json({serverTime:Date.now()});
    if(u.pathname==='/v2/account')return Response.json({account_id:account,blockchain:'cardano',blockchain_address:base.wallet,available_balance:'25.5'});
    if(u.pathname==='/v2/deposit/quote'){assert.deepEqual(JSON.parse(String(init?.body)),{blockchain:'cardano',asset_symbol:'ADA',asset_amount:DEPOSIT_AMOUNT});return Response.json(depositQuote);}
    if(u.pathname==='/v2/deposit/build-tx'){const body=JSON.parse(String(init?.body));assert.equal(body.user_address,base.wallet);assert.equal(body.utxos.length,1);return Response.json({blockchain:'cardano',format:'cardano_cbor',unsigned_tx:hex});}
    if(u.pathname==='/v2/deposit'){const body=JSON.parse(String(init?.body));return Response.json({...body,status:'pending'});}
    assert.equal(u.pathname,'/v2/history/transaction');assert.equal(u.searchParams.get('account_id'),account);assert.equal(u.searchParams.has('scope'),false);
    return Response.json({transactions:[{request_id:history==='wrong-request'?'other':'test-deposit-request',account_id:history==='foreign'?'other':account,blockchain:'cardano',blockchain_address:base.wallet,tx_hash:history==='wrong-tx'?'f'.repeat(64):getRecord('alice').deposit?.txHash,status:history==='pending'?'pending':history==='interim'?'completed':'settled',amount:'25.50000000',asset_symbol:'ADA',asset_amount:history==='wrong-asset-amount'?'1':DEPOSIT_AMOUNT}]});
  };
  async function request(operation:'quote'|'build'|'confirm') {
    const planned=await depositAction('alice',{type:'deposit-plan',operation});const p=planned.depositPlan!;
    const result=await depositAction('alice',{type:'deposit-request',id:p.id,headers:signDepositRequest(session,p)});
    await assert.rejects(depositAction('alice',{type:'deposit-request',id:p.id,headers:signDepositRequest(session,p)}),/expired/);return result;
  }
  const bad=await depositAction('alice',{type:'deposit-plan',operation:'quote'});
  await assert.rejects(depositAction('alice',{type:'deposit-request',id:bad.depositPlan!.id,headers:signDepositRequest(session,{...bad.depositPlan!,body:'{}'})}),/signature/);
  await request('quote');await request('build');const d=getRecord('alice').deposit!;
  await assert.rejects(depositAction('alice',{type:'deposit-submit',txHash:d.txHash!,witnesses:witness(hex)}));
  assert.equal(getRecord('alice').deposit?.status,'submitted');assert.ok(getRecord('alice').deposit?.signedTx);
  await assert.rejects(depositAction('alice',{type:'deposit-plan',operation:'quote'}),/another deposit/);
  await request('confirm');await depositAction('alice',{type:'deposit-check'});assert.equal(getRecord('alice').deposit?.status,'registered');
  for(const wrong of ['foreign','wrong-request','wrong-tx','wrong-asset-amount','interim']){history=wrong;assert.equal(await checkDeposit(getRecord('alice')),false);}
  history='completed';await depositAction('alice',{type:'deposit-check'});assert.equal(getRecord('alice').deposit?.status,'verified');assert.equal(getRecord('alice').deposit?.creditedUsd,'25.50000000');assert.equal(depositCalls,1);
  await depositAction('alice',{type:'deposit-check'});assert.equal(depositCalls,1);
});

test('batched receipt follows the original output, payment-key identity and actual settled credit',async t=>{
  setup(t);
  const d=validateQuote(quote(),base),hex=batched(d),checked=validateDepositTx(hex,d,base.wallet!,inputs,1000,'strike-testnet-api');
  const record={...base,deposit:{...d,...checked,unsignedTx:hex,signedTx:addDepositWitness({...d,...checked,unsignedTx:hex},base.walletKey!,witness(hex)),status:'registered' as const}};
  const batchHash='b'.repeat(64);let fault='pending';
  global.fetch=async input=>{
    const u=new URL(String(input));
    if(u.hostname==='cardano-preprod.blockfrost.io') {
      if(u.pathname.endsWith('/blocks/latest'))return Response.json({slot:1000,height:20});
      if(u.pathname.endsWith('/utxos'))return u.pathname.includes(batchHash)?Response.json({inputs:[{tx_hash:fault==='foreign-tx'?'f'.repeat(64):checked.txHash,output_index:fault==='wrong-input-index'?1:0,address:STRIKE_PREPROD_BATCHER,collateral:fault==='collateral'}],outputs:[{output_index:fault==='missing-output'?1:0}]}):Response.json({outputs:[{address:STRIKE_PREPROD_BATCHER,amount:[{unit:'lovelace',quantity:'102000000'}]}]});
      return Response.json({hash:u.pathname.split('/').at(-1),valid_contract:fault!=='invalid-chain',block_height:fault==='unconfirmed'?20:19});
    }
    if(u.pathname==='/v2/account')return Response.json({account_id:account,blockchain:'cardano',blockchain_address:base.wallet});
    return Response.json({transactions:[{type:'deposit',request_id:fault==='wrong-request'?'unrelated':d.requestId,account_id:account,blockchain:'cardano',blockchain_address:fault==='foreign-wallet'?foreign.secret.to_public().hash().to_hex():base.walletKey,tx_hash:batchHash+'#0',status:fault==='pending'?'pending_settlement':fault==='interim'?'completed':'settled',asset_symbol:'ADA',asset_amount:DEPOSIT_AMOUNT,amount:'25.123400000000000000'}]});
  };
  const progress:Record<string,unknown>={};assert.equal(await checkDeposit(record,v=>Object.assign(progress,v)),false);
  assert.ok(progress.chainConfirmedAt);assert.equal(progress.settlementStatus,'pending_settlement');
  for(fault of ['foreign-tx','wrong-input-index','collateral','missing-output','foreign-wallet','wrong-request','interim','unconfirmed'])assert.equal(await checkDeposit(record),false,fault);
  fault='settled';assert.deepEqual(await checkDeposit(record),{creditedUsd:'25.123400000000000000'});
  // Missing authority cannot turn a different hash/credit into successful verification.
  assert.equal(await checkDeposit({...record,deposit:{...record.deposit,routeAuthority:'quoted-vault'}}),false);
  assert.equal(record.deposit.status,'registered'); // Read-only checks do not mutate saved progress.
});

test('direct-vault receipt still requires the original transaction and exact quoted credit',async t=>{
  setup(t);const d=validateQuote(quote(),base),hex=unsigned(),checked=validateDepositTx(hex,d,base.wallet!,inputs,1000);
  const record={...base,deposit:{...d,...checked,unsignedTx:hex,signedTx:addDepositWitness({...d,...checked,unsignedTx:hex},base.walletKey!,witness(hex)),status:'registered' as const}};
  let amount='25.4';
  global.fetch=async input=>{const u=new URL(String(input));
    if(u.hostname==='cardano-preprod.blockfrost.io'){
      if(u.pathname.endsWith('/blocks/latest'))return Response.json({height:20,slot:1000});
      if(u.pathname.endsWith('/utxos'))return Response.json({outputs:[{address:d.address,amount:[{unit:'lovelace',quantity:DEPOSIT_AMOUNT}]}]});
      return Response.json({hash:checked.txHash,valid_contract:true,block_height:19});
    }
    if(u.pathname==='/v2/account')return Response.json({account_id:account,blockchain:'cardano',blockchain_address:base.wallet});
    return Response.json({transactions:[{request_id:d.requestId,account_id:account,tx_hash:checked.txHash,blockchain:'cardano',blockchain_address:base.wallet,status:'completed',amount}]});
  };
  assert.equal(await checkDeposit(record),false);amount='25.50000';assert.deepEqual(await checkDeposit(record),{creditedUsd:amount});
});

test('existing balance opt-in is distinct from deposit verification and cannot fabricate a bounty',async t=>{
  setup(t);global.fetch=async()=>Response.json({account_id:account,blockchain:'cardano',blockchain_address:base.wallet,available_balance:'20'});
  await missionAction('alice',{type:'practice-existing'},'http://localhost:3000');const r=getRecord('alice');assert.ok(r.practiceExistingAt);assert.equal(r.deposit,undefined);assert.equal(r.completedAt,undefined);assert.equal(r.claim,undefined);
  global.fetch=async()=>Response.json({account_id:account,blockchain:'cardano',blockchain_address:base.wallet,available_balance:'0'});
  await assert.rejects(missionAction('alice',{type:'practice-existing'},'http://localhost:3000'),/balance/);
});

test('deposit plans use the isolated practice account and key while legacy completion stays unchanged',async t=>{
  setup(t);const legacyWallet=wallet(1),legacyAccount='019a0c2e-1111-7000-8000-000000000008';
  updateRecord('alice',r=>{
    r.practiceConnection={wallet:base.wallet!,walletKey:base.walletKey!,accountId:account,apiPublicKey:session.publicKey};
    r.wallet=legacyWallet.address.to_bech32();r.walletKey=legacyWallet.secret.to_public().hash().to_hex();r.accountId=legacyAccount;r.apiPublicKey='b'.repeat(64);r.completedAt=123;
  });
  global.fetch=async input=>{const u=new URL(String(input));assert.equal(u.origin,'https://api-v2-testnet.strikefinance.org');return Response.json(u.pathname==='/v2/time'?{serverTime:Date.now()}:quote());};
  const result=await depositAction('alice',{type:'deposit-plan',operation:'quote'});const plan=result.depositPlan!;
  assert.equal(plan.publicKey,session.publicKey);
  await depositAction('alice',{type:'deposit-request',id:plan.id,headers:signDepositRequest(session,plan)});
  const r=getRecord('alice');assert.equal(r.deposit?.accountId,account);assert.equal(r.accountId,legacyAccount);assert.equal(r.wallet,legacyWallet.address.to_bech32());assert.equal(r.completedAt,123);
});


test('Preprod credential and quota errors are distinct from ambiguous transaction submission',async t=>{
  setup(t);
  for(const status of [401,403]) {
    global.fetch=async()=>Response.json({message:'provider detail must not be exposed'}, {status});
    await assert.rejects(chain('/blocks/latest'),error=>error instanceof Error && /key is invalid/.test(error.message) && !/provider detail/.test(error.message));
    await assert.rejects(chain('/tx/submit',{method:'POST'}),/key is invalid/);
  }
  for(const status of [402,429]) {
    global.fetch=async()=>new Response('',{status});
    await assert.rejects(chain('/blocks/latest'),/request limit/);
  }
  global.fetch=async()=>{throw new Error('synthetic network timeout');};
  await assert.rejects(chain('/blocks/latest'),/could not read/);
  await assert.rejects(chain('/tx/submit',{method:'POST'}),/saved transaction/);
  assert.equal(getRecord('alice').deposit,undefined);
});
