"use client";
import {useState,useEffect} from 'react';
import {BlockscholarProgram} from '@/packages/spaces-studio/src/blockscholar-program.jsx';
import {Access} from './Access';
import '@/packages/spaces-studio/src/strike-mission.css';
import '@/packages/spaces-studio/src/blockscholar.css';
export function Program({initialView='program'}:{initialView?:string}) {
 const [session,setSession]=useState<any>(null);
 useEffect(()=>{fetch('/api/auth/session',{cache:'no-store'}).then(r=>r.json()).then(s=>setSession(s.verified?s:null)).catch(()=>{});},[]);
 return <main className="program-shell"><nav className="site-tools"><a href="https://drmz.tech/learn">← DRMZ Learn</a><span>TESTNET PILOT</span>{session&&<button onClick={async()=>{const r=await fetch('/api/auth/sign-out',{method:'POST'});if(r.ok)location.reload();}}>Sign out</button>}</nav><BlockscholarProgram initialView={initialView} signIn={<Access/>}/></main>;
}
