const kind=item=>String(item?.type||'Series').toLowerCase()==='film'?'film':String(item?.type||'').toLowerCase()==='game'?'game':'series';
const title=value=>String(value||'').toLowerCase().normalize('NFKD').replace(/\p{M}/gu,'').replace(/&/g,' and ').replace(/[^\p{L}\p{N}]+/gu,' ').trim();
const imdb=item=>String(item.imdbId||'').trim().toLowerCase();
const maze=item=>kind(item)==='series'?String(item.tvmazeShowId||'').trim():'';
const year=item=>String(item.releaseYear||'').match(/\b(?:19|20)\d{2}\b/)?.[0]||String(item.filmReleaseDate||'').match(/^(?:19|20)\d{2}/)?.[0]||'';
export function sameTitleIdentity(a,b){
 if(!a?.title||!b?.title||kind(a)!==kind(b))return false;
 const ai=imdb(a),bi=imdb(b),am=maze(a),bm=maze(b);
 if(ai&&bi&&ai===bi||am&&bm&&am===bm)return true;
 if(ai&&bi||am&&bm)return false;
 return title(a.title)===title(b.title)&&!(year(a)&&year(b)&&year(a)!==year(b));
}
export function mayChangeTitleIdentity(changes){
 const fields=new Set(['title','type','imdbId','tvmazeShowId','releaseYear','filmReleaseDate']);
 return changes.some(change=>change.create||Object.keys(change.set||{}).some(key=>fields.has(key))||(change.unset||[]).some(key=>fields.has(key)));
}
export function introducedDuplicate(items,changes){
 const identityFields=new Set(['title','type','imdbId','tvmazeShowId','releaseYear','filmReleaseDate']);
 const candidates=new Set(),rows=new Map((items||[]).map(item=>[String(item.id),item]));
 for(const change of changes){
  const id=String(change.id);
  if(change.delete===true||change.delete==='true'){rows.delete(id);candidates.delete(id);continue;}
  const existing=rows.get(id);
  if(change.create&&typeof change.create==='object'&&!Array.isArray(change.create)){
   rows.set(id,change.create);candidates.add(id);
  }else if(existing){
   const value={...existing,...(change.set||{})};for(const key of change.unset||[])delete value[key];rows.set(id,value);
   if(Object.keys(change.set||{}).some(key=>identityFields.has(key))||(change.unset||[]).some(key=>identityFields.has(key)))candidates.add(id);
  }
 }
 for(const id of candidates){const item=rows.get(id);if(!item)continue;
  for(const [otherId,other] of rows)if(otherId!==id&&sameTitleIdentity(item,other))return {id,duplicateId:otherId,title:other.title};
 }
 return null;
}
