import { Program } from '@/app/components/Program';
export default async function Page({searchParams}:{searchParams:Promise<{view?:string}>}) { const {view}=await searchParams; return <Program initialView={['program','practice','learn','mission','work','fund'].includes(view || '') ? view : 'program'}/>; }
