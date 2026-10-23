import {useId} from 'react';

/** Code-native companion to the Academy illustration, with readable HTML labels. */
export function BlockscholarHeroGraphic() {
  const id = useId().replace(/:/g, '');
  return <figure className="bs-learning-graphic">
    <svg viewBox="0 0 680 260" role="img" aria-labelledby={`${id}-title ${id}-desc`}>
      <title id={`${id}-title`}>Learn DeFi, demonstrate skills, claim a learning bounty</title>
      <desc id={`${id}-desc`}>A practice trading screen connects to an open learning book and verified-work badge, then to a wallet holding a learning bounty. The pathway connects DeFi learning with work-based skills.</desc>
      <defs>
        <linearGradient id={`${id}-panel`} x1="0" y1="0" x2="1" y2="1"><stop stopColor="#291442"/><stop offset="1" stopColor="#0d0817"/></linearGradient>
        <linearGradient id={`${id}-violet`} x1="0" y1="0" x2="1" y2="1"><stop stopColor="#7c3aed"/><stop offset="1" stopColor="#d8b4fe"/></linearGradient>
        <radialGradient id={`${id}-glow`}><stop stopColor="#8b5cf6" stopOpacity=".26"/><stop offset="1" stopColor="#8b5cf6" stopOpacity="0"/></radialGradient>
        <pattern id={`${id}-grid`} width="24" height="24" patternUnits="userSpaceOnUse"><path d="M24 0H0V24" fill="none" stroke="#c4b5fd" strokeOpacity=".06"/></pattern>
      </defs>
      <ellipse cx="340" cy="136" rx="330" ry="124" fill={`url(#${id}-glow)`}/>
      <rect x="12" y="12" width="656" height="236" fill={`url(#${id}-grid)`}/>
      <g fill="none" stroke="#a78bfa" strokeWidth="1.5">
        <path d="M196 132H254M426 132H484" strokeDasharray="4 6" opacity=".65"/>
        <path d="m242 127 7 5-7 5M472 127l7 5-7 5"/>
        <path d="M114 220Q340 270 566 220" strokeOpacity=".18"/>
      </g>
      {/* A bounded practice screen: mixed candles, not a promised profit curve. */}
      <g transform="translate(30 54)">
        <rect width="166" height="152" rx="14" fill={`url(#${id}-panel)`} stroke="#a78bfa" strokeOpacity=".5"/>
        <circle cx="16" cy="17" r="3" fill="#a78bfa"/><circle cx="27" cy="17" r="3" fill="#a78bfa" opacity=".4"/>
        <path d="M12 32h142" stroke="#c4b5fd" strokeOpacity=".15"/>
        <g stroke="#c4b5fd" strokeOpacity=".12"><path d="M19 60h128M19 84h128M19 108h128"/></g>
        <g strokeLinecap="round" strokeWidth="2">
          <path d="M36 64v43M65 48v49M94 59v54M123 47v48" stroke="#c4b5fd"/>
          <path d="M36 79v16M65 59v23M123 60v20" stroke="#a78bfa" strokeWidth="9"/>
          <path d="M94 72v25" stroke="#f0abfc" strokeWidth="9"/>
        </g>
        <rect x="16" y="126" width="60" height="12" rx="6" fill="#7c3aed" fillOpacity=".35"/>
        <rect x="84" y="126" width="66" height="12" rx="6" fill="#c4b5fd" fillOpacity=".12"/>
      </g>
      {/* Learning and evidence are the center of the experience. */}
      <g transform="translate(340 130)">
        <path d="M0-110 86-60v116L0 106-86 56V-60Z" fill={`url(#${id}-panel)`} stroke="#a78bfa" strokeOpacity=".6"/>
        <path d="M0-95 73-52v100L0 91-73 48V-52Z" fill={`url(#${id}-violet)`} fillOpacity=".07" stroke="#a78bfa" strokeOpacity=".18"/>
        <path d="m-49-52 49-23 49 23-49 23Z" fill="#7c3aed" stroke="#d8b4fe" strokeWidth="1.5"/>
        <path d="M-29-41v15q29 21 58 0v-15M49-52v30" fill="none" stroke="#c4b5fd" strokeWidth="2"/>
        <circle cx="49" cy="-19" r="3" fill="#e9d5ff"/>
        <path d="M0-5Q-23-19-52-13v61Q-23 43 0 57q23-14 52-9v-61Q23-19 0-5Z" fill="#1b102d" stroke="#c4b5fd" strokeWidth="2" strokeLinejoin="round"/>
        <path d="M0-5v62M-40 1l25 4M-40 14l25 4M-40 27l18 3M15 5l25-4M15 18l25-4" stroke="#a78bfa" strokeWidth="2" strokeLinecap="round"/>
        <circle cx="36" cy="48" r="21" fill="#1c1134" stroke="#c4b5fd" strokeWidth="2"/>
        <path d="m26 48 7 7 13-15" fill="none" stroke="#ddd6fe" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/>
      </g>
      {/* Bounty wallet and workplace artifact, distinct from trading gains. */}
      <g transform="translate(484 54)">
        <rect width="166" height="152" rx="14" fill={`url(#${id}-panel)`} stroke="#a78bfa" strokeOpacity=".5"/>
        <rect x="25" y="25" width="66" height="81" rx="7" fill="#1b102d" stroke="#a78bfa"/>
        <path d="M39 42h37M39 54h29M39 66h22" stroke="#c4b5fd" strokeWidth="2" strokeLinecap="round"/>
        <path d="m39 82 5 5 10-12" fill="none" stroke="#6ee7b7" strokeWidth="2"/>
        <circle cx="116" cy="54" r="23" fill="#33204c" stroke="#c4b5fd" strokeWidth="2"/>
        <path d="m116 40 4 9 10 1-8 7 2 10-8-5-8 5 2-10-8-7 10-1Z" fill="#c4b5fd"/>
        <rect x="52" y="83" width="91" height="52" rx="9" fill="#25133d" stroke="#a78bfa" strokeWidth="2"/>
        <path d="M53 95h88" stroke="#c4b5fd" strokeOpacity=".25"/>
        <rect x="119" y="100" width="29" height="22" rx="5" fill="#43226a" stroke="#c4b5fd"/>
        <circle cx="130" cy="111" r="3" fill="#e9d5ff"/>
      </g>
    </svg>
    <figcaption>
      <div className="bs-learning-labels"><span>Learn DeFi</span><span>Verify your skills</span><span>Claim a bounty</span></div>
    </figcaption>
  </figure>;
}
