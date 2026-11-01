// Paragraphs are review units, not inferred facts. The original answer stays intact.
export function resultItems(answer) {
  const parts=answer.split(/\n\s*\n/).filter(x=>x.trim());
  let cursor=0;
  return parts.slice(0,63).concat(parts.length>63?[parts.slice(63).join('\n\n')]:[]).map((text,index)=>{
    const start=answer.indexOf(text,cursor);
    if(start>=0){cursor=start+text.length;return {id:'paragraph-'+(index+1),text,start,end:cursor};}
    // An old merged tail may normalize separators. Do not invent an exact
    // full-answer offset for it; the complete original remains available.
    return {id:'paragraph-'+(index+1),text,start:null,end:null};
  });
}
