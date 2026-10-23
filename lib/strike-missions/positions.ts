import {createHash,randomUUID} from 'node:crypto';
import {ed25519} from '@noble/curves/ed25519';
import {z} from 'zod';
import {MissionError,workshopRecord,actionSchema,type Direction,type PositionMission,type PositionRequest} from './model';
import {getRecord,acquirePosition,saveSetup,releaseSetup} from './store';
import {accountFor,accountFunding,orderForClient} from './strike';
import {testnetRequest} from './trading';

const scenarios={
  long:{title:'Practice a long',story:'ETH is trading at 2,400 test USD. You expect it to rise, but want to understand both outcomes before opening a small practice position.',questions:[
    {prompt:'You buy 0.005 ETH of exposure at 2,400. It falls to 2,300. What is the P&L before fees and funding?',choices:['A 0.50 test-USD loss','A 0.50 test-USD gain','No loss until you cancel the order'],answer:0},
    {prompt:'Your long has filled. How do you exit without opening a short?',choices:['Cancel the already filled buy','Submit a reduce-only sell for the open size','Buy the same amount again'],answer:1},
  ]},
  short:{title:'Practice a short',story:'You expect ETH to fall. A short gains from a falling price, but loses when the price rises. This exercise uses test credits, not a forecast.',questions:[
    {prompt:'You short 0.005 ETH at 2,400. It rises to 2,500. What is the P&L before fees and funding?',choices:['A 0.50 test-USD gain','A 0.50 test-USD loss','Your loss is always limited to the trading fee'],answer:1},
    {prompt:'How do you close the filled short without opening a long?',choices:['Submit another sell','Cancel its original filled order','Submit a reduce-only buy for the open size'],answer:2},
  ]},
};
export const positionScenarios=Object.fromEntries(Object.entries(scenarios).map(([key,s])=>[key,{...s,questions:s.questions.map(({answer,...q})=>q)}]));
const SCALE=100_000_000n;
export function units(value:string) {
  if(!/^-?\d+(\.\d+)?$/.test(value)) throw new MissionError('Strike returned an invalid position amount.',503);
  const negative=value.startsWith('-'),[whole,fraction='']=value.replace(/^-/,'').split('.');
  if(/[1-9]/.test(fraction.slice(8))) throw new MissionError('Strike returned unsupported quantity precision.',503);
  const n=BigInt(whole)*SCALE+BigInt(fraction.slice(0,8).padEnd(8,'0'));return negative ? -n:n;
}
const fmt=(n:bigint)=>`${n/SCALE}.${String(n%SCALE).padStart(8,'0')}`.replace(/\.?0+$/,'');
const abs=(n:bigint)=>n<0n?-n:n;
const terminal=new Set(['filled','canceled','expired','rejected']);
const signed=z.string().regex(/^-?\d+(\.\d+)?$/);
const positionsSchema=z.object({count:z.number().int().nonnegative(),positions:z.array(z.object({symbol:z.string(),size:signed,entry_price:signed}))});
const ordersSchema=z.object({count:z.number().int().nonnegative(),orders:z.array(z.object({AccountID:z.string(),Symbol:z.string()}))});
async function snapshot(wallet:string,accountId:string) {
  if(await accountFor(wallet)!==accountId) throw new MissionError('Strike account no longer matches the connected wallet.',409);
  const query=new URLSearchParams({account_id:accountId,symbol:'ETH-USD'});
  const [p,o]=await Promise.all([testnetRequest(`/v2/positions?${query}`),testnetRequest(`/v2/openOrders?${query}`)]);
  const positions=positionsSchema.safeParse(p.data), orders=ordersSchema.safeParse(o.data);
  if(!p.ok || !o.ok || !positions.success || !orders.success || positions.data.count!==positions.data.positions.length || orders.data.count!==orders.data.orders.length) throw new MissionError('Could not verify the full position and order state. Retry the check.',503);
  if(positions.data.positions.some(p=>p.symbol!=='ETH-USD') || orders.data.orders.some(o=>o.AccountID!==accountId || o.Symbol!=='ETH-USD') || positions.data.positions.length>1) throw new MissionError('Strike returned an unexpected account snapshot.',503);
  return {position:positions.data.positions[0],size:units(positions.data.positions[0]?.size || '0'),openOrders:orders.data.count};
}
export function positionPlan(m:Record<string,any>,direction:Direction,available:string):PositionRequest {
  const mark=units(m.mark_price),step=units(m.order_market_step_size),min=units(m.order_market_min_size),max=units(m.order_market_max_size),notional=units(m.order_min_notional);
  if(m.status!=='trading' || m.reduce_only || mark<=0n || step<=0n || min<=0n || notional<=0n) throw new MissionError('ETH testnet market is not ready for this exercise.',503);
  // The entry is covered by available test credits, with a cushion for fees.
  const need=(notional*110n*SCALE+mark*100n-1n)/(mark*100n);
  const size=need<=min?min:min+(need-min+step-1n)/step*step;
  const estimate=size*mark/SCALE;
  if(size>max || estimate>15n*SCALE || estimate*105n/100n>units(available)) throw new MissionError('This exercise needs enough available test credits for a small position and fees (maximum 15 test USD). No new deposit was submitted.');
  const clientId=`drmz-${direction}-${randomUUID()}`;
  return {clientId,size:fmt(size),estimate:fmt(estimate),expires:Date.now()+60_000,status:'draft',body:JSON.stringify({symbol:'ETH-USD',side:direction==='long'?'buy':'sell',type:'market',size:fmt(size),slippage:'0.01',reduce_only:false,time_in_force:'IOC',client_order_id:clientId})};
}
const orderSchema=z.object({ID:z.union([z.string().regex(/^[1-9]\d*$/),z.number().int().safe().positive()]).transform(String),AccountID:z.string(),ClientOrderID:z.string(),Symbol:z.literal('ETH-USD'),Type:z.literal('market'),Side:z.enum(['buy','sell']),CloseReason:z.string().max(256).optional(),Status:z.enum(['pending','open','filled','canceled','rejected','expired']),Size:signed,Filled:signed,ReduceOnly:z.boolean(),CreateTimestamp:z.number().int(),EventTimestamp:z.number().int()});
export function verifyPositionOrder(raw:unknown,p:PositionMission,request:PositionRequest,exit:boolean) {
  const parsed=orderSchema.safeParse(raw);if(!parsed.success) throw new MissionError('Strike has not returned matching mission order evidence yet.',409);
  const o=parsed.data,side=p.direction==='long'?'buy':'sell';
  if(o.AccountID!==p.accountId || o.ClientOrderID!==request.clientId || o.Side!==(exit ? side==='buy'?'sell':'buy':side) || o.ReduceOnly!==exit || units(o.Size)!==units(request.size) || units(o.Filled)<0n || units(o.Filled)>units(request.size) || !request.sentAt || o.CreateTimestamp<request.sentAt-30_000 || o.CreateTimestamp<p.scenarioAt || o.CreateTimestamp>Date.now()+30_000 || o.EventTimestamp<o.CreateTimestamp || o.EventTimestamp>Date.now()+30_000 || (o.Status==='filled' && units(o.Filled)!==units(o.Size))) throw new MissionError('The order does not match this account, direction, size, or mission request.',409);
  return o;
}
const depthSchema=z.object({bids:z.array(z.tuple([signed,signed])),asks:z.array(z.tuple([signed,signed]))});
async function readDepth() {
  const response=await testnetRequest('/price/v2/depth?symbol=ETH-USD&limit=20');
  const book=depthSchema.safeParse(response.data);
  if(!response.ok || !book.success) throw new MissionError('Could not check Strike’s testnet liquidity. No trade was submitted. Try checking again.',503);
  return book.data;
}
async function closeBook(direction:Direction) {
  const book=await readDepth();
  const levels=(direction==='long'?book.bids:book.asks).filter(([price,size])=>units(price)>0n && units(size)>0n);
  return {checkedAt:Date.now(),size:fmt(levels.reduce((total,[,size])=>total+units(size),0n)),bestPrice:levels[0]?.[0]};
}
async function entryLiquidity(size:string):Promise<NonNullable<PositionMission['entryLiquidity']>> {
  const base={checkedAt:Date.now(),size};
  try {
    const [book,market]=await Promise.all([readDepth(),testnetRequest('/v2/markets')]);
    const m=market.data.markets?.['ETH-USD'];
    if(!market.ok || !m || m.status!=='trading' || m.reduce_only) throw new Error('Market unavailable');
    const bids=book.bids.filter(([price,qty])=>units(price)>0n && units(qty)>0n),asks=book.asks.filter(([price,qty])=>units(price)>0n && units(qty)>0n);
    if(!bids.length || !asks.length) return {...base,status:'paused',reason:'ETH testnet needs both buyers and sellers before this exercise can open a position.'};
    const bid=units(bids[0][0]),ask=units(asks[0][0]),mid=(bid+ask)/2n,mark=units(m.mark_price),bound=units(m.order_market_price_bound);
    if(bid>=ask || mark<=0n || bound<=0n || bound>=SCALE) throw new Error('Invalid market data');
    // Check enough depth for the full practice size in BOTH directions, within our 1% protection
    // and Strike's market bound. This is a snapshot, never a promise of future exit liquidity.
    const low=(mid*99n+99n)/100n,high=mid*101n/100n;
    const floor=(mark*(SCALE-bound)+SCALE-1n)/SCALE,cap=mark*(SCALE+bound)/SCALE;
    const bidSize=bids.reduce((n,[price,qty])=>n+(units(price)>=low && units(price)>=floor?units(qty):0n),0n);
    const askSize=asks.reduce((n,[price,qty])=>n+(units(price)<=high && units(price)<=cap?units(qty):0n),0n);
    if(bidSize<units(size) || askSize<units(size)) return {...base,status:'paused',reason:`Not enough nearby buyers and sellers for ${size} ETH within the exercise’s price protection.`};
    return {...base,status:'ready'};
  } catch {return {...base,status:'unavailable',reason:'Strike’s liquidity could not be verified. No new entry will be sent until a fresh check succeeds.'};}
}
function requireEntryLiquidity(p:PositionMission) {
  if(p.entryLiquidity?.status!=='ready') throw new MissionError(`Mission paused. ${p.entryLiquidity?.reason || 'Check liquidity again before opening.'} Your saved progress is unchanged.`,409);
}
function requireCloseLiquidity(p:PositionMission) {
  if(!p.closeBook) throw new MissionError('Could not check Strike’s testnet liquidity. No close was submitted. Check again.',503);
  if(units(p.closeBook.size)===0n) throw new MissionError(`Strike testnet has no ${p.direction==='long'?'buyers':'sellers'} for ETH right now. Your ${p.direction} remains open. No new close was sent. Check liquidity again when other traders or market makers return.`,409);
}
async function checked(p:PositionMission) {
  const next=structuredClone(p);
  for(const request of [next.entry,...next.exits]) {
    if(!request?.sentAt || request.outcome==='request-rejected') continue;
    const o=verifyPositionOrder(await orderForClient(p.wallet,request.clientId),p,request,request!==next.entry);
    request.orderId=o.ID;request.filled=o.Filled;request.outcome=o.Status;request.closeReason=o.CloseReason;
    request.status=terminal.has(o.Status)?'terminal':'sent';
  }
  const state=await snapshot(p.wallet,p.accountId);
  if(!next.entry || next.entry.status==='draft' || next.entry.status==='terminal' && units(next.entry.filled || '0')===0n) {
    const size=next.entry?.size || next.entryLiquidity?.size;
    if(size) next.entryLiquidity=await entryLiquidity(size);
    return {mission:next,state};
  }
  if(next.entry.status!=='terminal') return {mission:next,state};
  const entered=units(next.entry.filled || '0'),exited=next.exits.reduce((n,r)=>n+units(r.filled || '0'),0n),remaining=entered-exited;
  if(remaining<0n || (state.size!==0n && (p.direction==='long' ? state.size<0n:state.size>0n)) || abs(state.size)!==remaining) throw new MissionError('The live position differs from this mission’s fills. Check again after Strike settles; if you traded elsewhere, review the ETH position in Strike before continuing.',409);
  if(entered>0n && !next.open && remaining>0n) next.open={size:fmt(entered),entryPrice:state.position!.entry_price,observedAt:Date.now()};
  if(next.open && remaining>0n) {
    // Liquidity failure must not prevent saving confirmed fills. Preparation/submission fail closed.
    try {next.closeBook=await closeBook(p.direction);} catch {delete next.closeBook;}
  }
  if(entered>0n && next.open && remaining===0n && next.exits.length>0 && next.exits.every(r=>r.status==='terminal') && state.openOrders===0) {
    next.completedAt ??= Date.now();
    next.receipt ??= createHash('sha256').update(JSON.stringify({version:1,direction:p.direction,account:p.accountId,entry:next.entry,exits:next.exits,open:next.open,completedAt:next.completedAt})).digest('hex');
  }
  return {mission:next,state};
}
type Action=Extract<z.infer<typeof actionSchema>,{type:'position-scenario'|'position-prepare'|'position-submit'|'position-check'}>;
export async function positionAction(actor:string,a:Action) {
  const lease=acquirePosition(actor);
  try {
    const r=workshopRecord(getRecord(actor));
    if(!r.completedAt || !r.accountId || !r.wallet?.startsWith('addr_test1')) throw new MissionError('Complete the cancellation workshop using your funded Preprod wallet first. Your saved bounty stays unchanged.');
    const save=(p:PositionMission)=>saveSetup(actor,lease,latest=>{
      if(workshopRecord(latest).accountId!==r.accountId) throw new MissionError('The mission account changed. Reconnect the same wallet.',409);
      latest.positions ??={};latest.positions[a.direction]=p;
    });
    let p=r.positions?.[a.direction];
    if(p && (p.accountId!==r.accountId || p.wallet!==r.wallet)) throw new MissionError('Resume the wallet saved for this mission.',409);
    if(a.type==='position-scenario') {
      if(a.answers.some((answer,i)=>answer!==scenarios[a.direction].questions[i].answer)) throw new MissionError('Review the scenario: multiply the price change by 0.005 ETH, and use a reduce-only order to close a filled position. Try again.');
      if(!p) save({version:1,direction:a.direction,accountId:r.accountId,wallet:r.wallet,scenarioAt:Date.now(),exits:[]});
      return {};
    }
    if(!p) throw new MissionError('Complete this mission’s scenario first.');
    if(p.completedAt) return {};
    const other=r.positions?.[a.direction==='long'?'short':'long'];
    if(other?.entry?.sentAt && !other.completedAt) throw new MissionError('Close and verify your other position mission first.',409);
    if(a.type==='position-check') {const result=await checked(p);save(result.mission);return {};}
    if(a.type==='position-prepare') {
      if(a.operation==='entry') {
        if(p.entry?.sentAt && !(p.entry.status==='terminal' && units(p.entry.filled || '0')===0n)) throw new MissionError('An entry was already sent. Check its status before trying again.',409);
        const state=await snapshot(p.wallet,p.accountId);
        if(state.size!==0n || state.openOrders) throw new MissionError('Start with no ETH position or open ETH orders in this Strike account. Review them in Strike first.');
        const [funding,market]=await Promise.all([accountFunding(p.wallet,p.accountId),testnetRequest('/v2/markets')]);
        if(!market.ok || !market.data.markets?.['ETH-USD']) throw new MissionError('Strike market data is unavailable.',503);
        const entry=positionPlan(market.data.markets['ETH-USD'],a.direction,funding.availableBalance);
        p.entryLiquidity=await entryLiquidity(entry.size);save(p);requireEntryLiquidity(p);
        if(p.entry?.sentAt) (p.retired ??=[]).push(p.entry);
        p.entry=entry;save(p);
      } else {
        const result=await checked(p);p=result.mission;save(p);
        if(p.completedAt) return {};
        if(!p.open || !p.entry || p.entry.status!=='terminal' || result.state.size===0n || result.state.openOrders) throw new MissionError('Check the filled entry and position before preparing the close.');
        requireCloseLiquidity(p);
        if(p.exits.some(e=>e.status==='sent')) throw new MissionError('The close request is still settling. Check it instead of sending another.',409);
        const clientId=`drmz-close-${randomUUID()}`,size=fmt(abs(result.state.size));
        // Replace only unsigned reviews; preserve all sent close attempts for reconciliation.
        p.exits=p.exits.filter(e=>e.status!=='draft');
        p.exits.push({clientId,size,estimate:'0',expires:Date.now()+60_000,status:'draft',body:JSON.stringify({symbol:'ETH-USD',side:a.direction==='long'?'sell':'buy',type:'market',size,slippage:'0.01',reduce_only:true,time_in_force:'IOC',client_order_id:clientId})});save(p);
      }
      return {};
    }
    const request=a.operation==='entry'?p.entry:p.exits.at(-1);
    if(!request || request.clientId!==a.clientId || request.status!=='draft') throw new MissionError('This request was already sent or replaced. Check the saved status.',409);
    if(request.expires<=Date.now()) throw new MissionError('This review expired. Prepare it again before signing.',409);
    if(!r.apiPublicKey || a.headers['X-API-Wallet-Public-Key']!==r.apiPublicKey) throw new MissionError('Reconnect the same Strike wallet in this tab. Your progress is saved.');
    const timestamp=Number(a.headers['X-API-Wallet-Timestamp'])*1000;
    if(Math.abs(Date.now()-timestamp)>60_000) throw new MissionError('This signature expired. Review again.');
    const message=`POST:/v2/order:${a.headers['X-API-Wallet-Timestamp']}:${a.headers['X-API-Wallet-Nonce']}:${createHash('sha256').update(request.body).digest('hex')}`;
    if(!ed25519.verify(Buffer.from(a.headers['X-API-Wallet-Signature'],'hex'),Buffer.from(message),Buffer.from(r.apiPublicKey,'hex'))) throw new MissionError('The signature does not match this reviewed order.');
    if(a.operation==='entry') {
      const s=await snapshot(p.wallet,p.accountId);if(s.size!==0n || s.openOrders) throw new MissionError('The ETH account changed since review. Check it before placing this entry.',409);
      const funding=await accountFunding(p.wallet,p.accountId);
      if(units(funding.availableBalance)<units(request.estimate)*105n/100n) throw new MissionError('Available test credits changed. Prepare a fresh review.');
      p.entryLiquidity=await entryLiquidity(request.size);save(p);requireEntryLiquidity(p);
    } else {
      const result=await checked(p);save(result.mission);requireCloseLiquidity(result.mission);if(result.state.openOrders || abs(result.state.size)!==units(request.size) || result.mission.exits.some(e=>e.status==='sent')) throw new MissionError('The position changed since review. Check and prepare its close again.',409);
    }
    // Persist before network I/O. Ambiguous responses never authorize a duplicate order.
    request.status='sent';request.sentAt=Date.now();save(p);
    let response;
    try {response=await testnetRequest('/v2/order',{method:'POST',headers:{...a.headers,'content-type':'application/json','X-Builder-Fee-Bps':'0'},body:request.body});}
    catch {throw new MissionError('Strike’s response was interrupted. Use Check status to reconcile the saved request; do not place another order.',503);}
    if(!response.ok) {
      if([400,401,403,404,422,429].includes(response.status)) {request.status='terminal';request.filled='0';request.outcome='request-rejected';save(p);}
      throw new MissionError('Strike did not accept this request. Reconnect if authorization expired; check the saved status before preparing another review.',409);
    }
    return {notice:'Request sent. Checking Strike for the actual fills and position.'};
  } finally {releaseSetup(lease);}
}
