import './globals.css';
export const metadata = { title: 'Blockscholar · Strike Foundations', description: 'Learn, practice and verify a Strike testnet mission. Supported by DRMZ Dream Fund.' };
export const viewport = {width:'device-width',initialScale:1,themeColor:'#05030c'};
export default function Layout({children}:{children:React.ReactNode}) { return <html lang="en"><body>{children}</body></html>; }
