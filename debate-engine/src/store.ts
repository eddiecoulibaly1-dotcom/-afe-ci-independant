import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { Debate } from "./types.js";
import { getDebateFromSupabase, listDebatesFromSupabase, saveDebateToSupabase, supabasePersistenceEnabled } from "./supabase-store.js";

const DB_FILE=resolve(process.env.DEBATE_STORE_FILE??"./data/debates.json");
export async function saveDebate(debate:Debate):Promise<void>{
  if(supabasePersistenceEnabled()){await saveDebateToSupabase(debate);return;}
  await mkdir(dirname(DB_FILE),{recursive:true}); const all=await listDebates(); const index=all.findIndex(d=>d.id===debate.id); if(index>=0) all[index]=debate; else all.push(debate); await writeFile(DB_FILE,JSON.stringify(all,null,2),"utf8");
}
export async function listDebates(userId?:string):Promise<Debate[]>{
  if(supabasePersistenceEnabled()){if(!userId) return []; return listDebatesFromSupabase(userId);}
  try{return JSON.parse(await readFile(DB_FILE,"utf8")) as Debate[];}catch{return []}
}
export async function getDebate(id:string,userId?:string):Promise<Debate|null>{
  if(supabasePersistenceEnabled()){if(!userId) return null; return getDebateFromSupabase(id,userId);}
  const debates=await listDebates(userId); return debates.find(d=>d.id===id)??null;
}
