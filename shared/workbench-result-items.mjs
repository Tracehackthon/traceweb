// Paragraphs are review units, not inferred facts. The original answer stays intact.
export function resultItems(answer) {
  const parts=answer.split(/\n\s*\n/).filter(x=>x.trim());
  return parts.slice(0,63).concat(parts.length>63?[parts.slice(63).join('\n\n')]:[]).map((text,index)=>({id:'paragraph-'+(index+1),text}));
}
