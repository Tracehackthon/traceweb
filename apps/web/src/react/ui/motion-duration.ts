// CSS optimizers may express the same <time> in seconds or milliseconds.
// WAAPI always consumes milliseconds; never parseFloat a CSS time directly.
export function motionDuration(style:CSSStyleDeclaration,token:string,fallback:number){
  const value=style.getPropertyValue(token).trim();
  const match=/^([0-9]*\.?[0-9]+)(ms|s)$/.exec(value);
  return match?Number(match[1])*(match[2]==='s'?1000:1):fallback;
}
