import { createHash, randomUUID } from "node:crypto";
import type { MarketObservation } from "./market-intelligence.js";
import { parseMarketCsv } from "./market-sources.js";

export function marketPriceStorageEnabled(){return Boolean(process.env.SUPABASE_URL&&(process.env.SUPABASE_SECRET_KEY||process.env.SUPABASE_SERVICE_ROLE_KEY));}
function config(){
  const url=process.env.SUPABASE_URL?.replace(/\/$/,"");
  const secretKey=process.env.SUPABASE_SECRET_KEY??process.env.SUPABASE_SERVICE_ROLE_KEY;
  if(!url||!secretKey)throw new Error("Supabase market-price storage is not configured");
  return {url,secretKey};
}
async function request<T>(path:string,init:RequestInit={}):Promise<T>{
  const c=config();
  const response=await fetch(`${c.url}/rest/v1/${path}`,{...init,headers:{apikey:c.secretKey,Authorization:`Bearer ${c.secretKey}`,"Content-Type":"application/json",...(init.headers??{})}});
  const text=await response.text();
  if(!response.ok)throw new Error(`Supabase ${response.status}: ${text}`);
  return text?JSON.parse(text) as T:undefined as T;
}
const sha=(value:string)=>createHash("sha256").update(value).digest("hex");
const fingerprint=(o:MarketObservation)=>sha([o.sourceName,o.sourceUrl,o.id,o.normalizedProduct,o.kind,o.value,o.currency,o.unit,o.country,o.region??"",o.city??"",o.observedAt??"",o.publishedAt??""].join("|"));

export async function importMarketCsv(userId:string,csv:string,fileName?:string){
  const observations=parseMarketCsv(csv);
  if(!observations.length)throw new Error("Le CSV ne contient aucune observation.");
  const fileSha=sha(csv);
  const sourceName=[...new Set(observations.map(o=>o.sourceName))].join(", ").slice(0,240);
  const batches=await request<Array<{id:string}>>("market_price_import_batches?select=id",{method:"POST",headers:{Prefer:"return=representation"},body:JSON.stringify({created_by:userId,source_name:sourceName,file_name:fileName??null,file_sha256:fileSha,row_count:observations.length,status:"received"})});
  const batchId=batches[0]?.id;
  if(!batchId)throw new Error("Impossible de créer le lot d'import.");
  try{
    const rows=observations.map(o=>({
      created_by:userId,batch_id:batchId,source_observation_id:o.id,fingerprint:fingerprint(o),
      product:o.product,normalized_product:o.normalizedProduct,kind:o.kind,value:o.value,currency:o.currency,unit:o.unit,
      country:o.country,region:o.region??null,city:o.city??null,source_name:o.sourceName,source_url:o.sourceUrl,
      source_class:o.sourceClass,published_at:o.publishedAt??null,observed_at:o.observedAt??null,
      retrieved_at:o.retrievedAt,valid_until:o.validUntil??null,notes:o.notes??null,
      product_category:o.productCategory??null,strain:o.strain??null,vaccination_status:o.vaccinationStatus??null,
      minimum_quantity:o.minimumQuantity??null,pack_size:o.packSize??null,delivery_fee:o.deliveryFee??null,availability_date:o.availabilityDate??null
    }));
    const inserted=await request<Array<{id:string}>>("market_price_observations?on_conflict=created_by,fingerprint&select=id",{method:"POST",headers:{Prefer:"resolution=ignore-duplicates,return=representation"},body:JSON.stringify(rows)});
    const duplicateCount=observations.length-inserted.length;
    await request(`market_price_import_batches?id=eq.${batchId}`,{method:"PATCH",headers:{Prefer:"return=minimal"},body:JSON.stringify({inserted_count:inserted.length,duplicate_count:duplicateCount,status:"completed",completed_at:new Date().toISOString()})});
    return {batchId,total:observations.length,inserted:inserted.length,duplicates:duplicateCount,status:"completed"};
  }catch(error){
    await request(`market_price_import_batches?id=eq.${batchId}`,{method:"PATCH",headers:{Prefer:"return=minimal"},body:JSON.stringify({status:"failed",error_message:error instanceof Error?error.message:String(error),completed_at:new Date().toISOString()})});
    throw error;
  }
}

export async function listMarketPrices(userId:string,filters:Record<string,string|undefined>={}){
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(userId))throw new Error("Identifiant utilisateur invalide.");
  const params=new URLSearchParams({select:"*",created_by:`eq.${userId}`,order:"observed_at.desc.nullslast,retrieved_at.desc",limit:"500"});
  for(const key of ["normalized_product","kind","country","region","city"] as const){
    const value=filters[key]?.trim();
    if(value){
      if(value.length>160 || /[,()\\r\\n]/.test(value))throw new Error(`Filtre invalide : ${key}.`);
      params.set(key,`eq.${value}`);
    }
  }
  return request<Array<Record<string,unknown>>>(`market_price_observations_current?${params.toString()}`);
}
export async function getMarketPriceHistory(userId:string,id:string){
  const rows=await request<Array<Record<string,unknown>>>(`market_price_observations?select=*&created_by=eq.${userId}&id=eq.${encodeURIComponent(id)}&limit=1`);
  if(!rows[0])return null;
  let root=rows[0];
  // Resolve the complete chain from its first immutable observation.
  for(;;){
    const parentId=root.supersedes_id;
    if(typeof parentId!=="string")break;
    const parent=await request<Array<Record<string,unknown>>>(`market_price_observations?select=*&created_by=eq.${userId}&id=eq.${encodeURIComponent(parentId)}&limit=1`);
    if(!parent[0])break;
    root=parent[0];
  }
  const history=[root];
  let currentId=String(root.id);
  for(;;){
    const next=await request<Array<Record<string,unknown>>>(`market_price_observations?select=*&created_by=eq.${userId}&supersedes_id=eq.${encodeURIComponent(currentId)}&limit=1`);
    if(!next[0])break;
    history.push(next[0]);
    currentId=String(next[0].id);
  }
  return {observation:root,history};
}
export async function correctMarketPrice(userId:string,input:{id:string;value:number;reason:string;publishedAt?:string;observedAt?:string;retrievedAt?:string;validUntil?:string;notes?:string}){
  if(!Number.isFinite(input.value)||input.value<0)throw new Error("La nouvelle valeur doit être positive ou nulle.");
  if(input.reason.trim().length<8)throw new Error("Le motif de correction doit comporter au moins 8 caractères.");
  const rows=await request<Array<Record<string,any>>>(`market_price_observations?select=*&created_by=eq.${userId}&id=eq.${encodeURIComponent(input.id)}&limit=1`);
  const old=rows[0];if(!old)throw new Error("Cotation introuvable ou accès refusé.");
  const latest=await request<Array<{id:string}>>(`market_price_observations?select=id&created_by=eq.${userId}&supersedes_id=eq.${encodeURIComponent(input.id)}&limit=1`);
  if(latest.length)throw new Error("Cette cotation a déjà été corrigée. Il faut corriger sa version la plus récente.");
  const correctionId=randomUUID(),retrievedAt=input.retrievedAt??new Date().toISOString(),publishedAt=input.publishedAt??old.published_at??undefined;
  if(!Number.isFinite(Date.parse(retrievedAt)))throw new Error("Date de collecte invalide.");
  if(input.observedAt&&!Number.isFinite(Date.parse(input.observedAt)))throw new Error("Date d'observation invalide.");
  if(input.validUntil&&!Number.isFinite(Date.parse(input.validUntil)))throw new Error("Date de validité invalide.");
  if(input.validUntil&&input.observedAt&&Date.parse(input.validUntil)<Date.parse(input.observedAt))throw new Error("La date de validité ne peut pas précéder l'observation.");
  const fp=sha([old.source_name,old.source_url,old.source_observation_id??old.id,old.normalized_product,old.kind,input.value,old.currency,old.unit,old.country,old.region??"",old.city??"",publishedAt??"",retrievedAt,correctionId].join("|"));
  const inserted=await request<Array<{id:string}>>("market_price_observations?select=id",{method:"POST",headers:{Prefer:"return=representation"},body:JSON.stringify({
    id:correctionId,created_by:userId,batch_id:old.batch_id,source_observation_id:old.source_observation_id,
    fingerprint:fp,product:old.product,normalized_product:old.normalized_product,kind:old.kind,value:input.value,
    currency:old.currency,unit:old.unit,country:old.country,region:old.region,city:old.city,
    source_name:old.source_name,source_url:old.source_url,source_class:old.source_class,
    published_at:publishedAt,observed_at:input.observedAt??old.observed_at,
    retrieved_at:retrievedAt,valid_until:input.validUntil??old.valid_until,
    notes:input.notes??old.notes,product_category:old.product_category,strain:old.strain,
    vaccination_status:old.vaccination_status,minimum_quantity:old.minimum_quantity,pack_size:old.pack_size,
    delivery_fee:old.delivery_fee,availability_date:old.availability_date,
    supersedes_id:old.id,correction_reason:input.reason.trim()
  })});
  return inserted[0]??{id:correctionId};
}
