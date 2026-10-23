'use client';
import { useCallback, useEffect, useState } from 'react';
import { BlockscholarProgram } from '@/packages/spaces-studio/src/blockscholar-program.jsx';
import '@/packages/spaces-studio/src/strike-mission.css';
import '@/packages/spaces-studio/src/blockscholar.css';
import { Access as BlockscholarAccess } from './Access';
import { clearStrikeTabSessions } from '@/packages/spaces-studio/src/strike-tab-session.mjs';

export function Program({ initialView = 'program' }: { initialView?: string }) {
  const [view, setView] = useState(initialView);
  const [walletConnection, setWalletConnection] = useState<any>(null);
  const [revision, setRevision] = useState(0);
  const [signingOut, setSigningOut] = useState(false);
  const [accountError, setAccountError] = useState('');
  const [sessionReady, setSessionReady] = useState(false);
  useEffect(() => { let active=true; fetch('/api/auth/session',{cache:'no-store',credentials:'include'}).then(r=>r.json()).then(s=>{if(active && s.verified){setAuthenticated(true);setWalletConnection((previous:any) => s.user?.wallet ? {...s.user.wallet, ...(previous?.address === s.user.wallet.address && previous?.chain === s.user.wallet.chain ? {api:previous.api} : {})} : null);}}).catch(()=>{}).finally(()=>{if(active)setSessionReady(true);}); return()=>{active=false;}; }, [revision]);
  const signedIn = (connection:any) => { setWalletConnection(connection);setAuthenticated(true);rememberView('program');setRevision(n=>n+1); };
  const signOut = async () => {
    setSigningOut(true);setAccountError('');
    try { const r=await fetch('/api/auth/sign-out',{method:'POST',credentials:'include'});if(!r.ok)throw new Error('Sign-out failed. Please retry.');clearStrikeTabSessions();setWalletConnection(null);setAuthenticated(false);rememberView('program');setRevision(n=>n+1); }
    catch(e:any){setAccountError(e.message || 'Sign-out failed. Please retry.');}
    finally{setSigningOut(false);}
  };
  const rememberView = useCallback((view: string) => {
    setView(view);
    const path = view === 'program' ? '/learn/blockscholar' : `/learn/blockscholar?view=${encodeURIComponent(view)}`;
    if (window.location.pathname + window.location.search !== path) window.history.replaceState(window.history.state, '', path);
  }, []);
  const [authenticated, setAuthenticated] = useState(false);
  if (!sessionReady) return <main className="strike-mission bs-suite"><p role="status">Opening Blockscholar…</p></main>;
  if (!authenticated) return <main className="strike-mission bs-suite bs-landing"><BlockscholarAccess onAuthenticated={signedIn}/></main>;
  return <main><div className="bs-account-bar"><span>{walletConnection?.walletName || 'Wallet'} signed in</span><button type="button" disabled={signingOut} onClick={signOut}>{signingOut ? 'Signing out…' : 'Sign out / change wallet'}</button></div>{accountError && <p role="alert">{accountError}</p>}<BlockscholarProgram key={revision} initialView={view} standalone walletConnection={walletConnection} onViewChange={rememberView} onSessionChange={setAuthenticated} signIn={<BlockscholarAccess onAuthenticated={signedIn}/>}/></main>;
}