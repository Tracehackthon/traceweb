import React, {createContext, forwardRef, useContext, useId, useRef, useState} from 'react';
import {Select} from 'radix-ui';
import {useAnchoredMotion} from '../ui/anchored-motion';
import {TraceIcon} from '../ui/icon';
import './halo-controls.css';

const FieldContext = createContext<{id:string;description?:string;invalid:boolean} | null>(null);
export function HaloField({label, hint, error, children}:{label:string;hint?:string;error?:string;children:React.ReactNode}) {
  const id = 'halo-' + useId().replace(/:/g, '');
  const description = [hint && id+'-hint', error && id+'-error'].filter(Boolean).join(' ') || undefined;
  return <FieldContext.Provider value={{id,description,invalid:Boolean(error)}}><div className="wb-halo-field">
    <label htmlFor={id}>{label}</label>{children}
    {hint && <p id={id+'-hint'} className="wb-halo-hint">{hint}</p>}
    {error && <p id={id+'-error'} className="wb-halo-error" role="alert">{error}</p>}
  </div></FieldContext.Provider>;
}
export const HaloInput = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(function HaloInput(props,ref) {
  const field = useContext(FieldContext);
  return <span className="wb-halo-control" data-disabled={props.disabled||undefined} data-invalid={field?.invalid || props['aria-invalid'] || undefined}><input {...props} ref={ref} id={props.id || field?.id} aria-describedby={[field?.description,props['aria-describedby']].filter(Boolean).join(' ') || undefined} aria-invalid={props['aria-invalid'] ?? field?.invalid} /></span>;
});
export const HaloTextarea = forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>&{surfaceClassName?:string}>(function HaloTextarea({surfaceClassName,...props},ref) {
  const field = useContext(FieldContext);
  return <span className={'wb-halo-control '+(surfaceClassName||'')} data-disabled={props.disabled||undefined} data-invalid={field?.invalid || props['aria-invalid'] || undefined}><textarea {...props} ref={ref} id={props.id || field?.id} aria-describedby={[field?.description,props['aria-describedby']].filter(Boolean).join(' ') || undefined} aria-invalid={props['aria-invalid'] ?? field?.invalid} /></span>;
});

// Radix owns popup focus, typeahead, Escape and the hidden form control.
// The existing controlled values and explicit setters remain the data owner.
type HaloSelectProps={children:React.ReactNode;value?:string|number;defaultValue?:string|number;onValueChange?:(value:string)=>void;name?:string;disabled?:boolean;required?:boolean;id?:string;'aria-label'?:string;'aria-describedby'?:string;'aria-invalid'?:React.AriaAttributes['aria-invalid']};
export function HaloSelect(props:HaloSelectProps){
  const field=useContext(FieldContext),generated=useId(),trigger=useRef<HTMLButtonElement>(null),[container,setContainer]=useState<HTMLElement|null>(null),[open,setOpen]=useState(false);
  const popupMotion=useAnchoredMotion(open);
  const options:{value:string;label:string;disabled:boolean}[]=[];
  const label=(x:React.ReactNode):string=>React.Children.toArray(x).map(n=>React.isValidElement<{children?:React.ReactNode}>(n)?label(n.props.children):String(n)).join('');
  const collect=(nodes:React.ReactNode)=>React.Children.forEach(nodes,node=>{if(!React.isValidElement<{children?:React.ReactNode;value?:string|number;disabled?:boolean}>(node))return;if(node.type==='option')options.push({value:String(node.props.value??label(node.props.children)),label:label(node.props.children),disabled:Boolean(node.props.disabled)});else collect(node.props.children);});collect(props.children);
  const invalid=props['aria-invalid']??field?.invalid,value=props.value===undefined?undefined:String(props.value);
  return <span className="wb-halo-control wb-halo-select" data-disabled={props.disabled||undefined} data-invalid={invalid||undefined}><Select.Root value={value} defaultValue={props.defaultValue===undefined?undefined:String(props.defaultValue)} name={props.name} disabled={props.disabled} required={props.required} onValueChange={props.onValueChange} open={open} onOpenChange={next=>{if(next)setContainer(trigger.current?.closest('dialog')||document.body);setOpen(next);}}><Select.Trigger ref={trigger} type="button" className="wb-select-trigger" id={props.id||field?.id||generated} aria-label={props['aria-label']} aria-invalid={invalid} aria-describedby={[field?.description,props['aria-describedby']].filter(Boolean).join(' ')||undefined} data-selected-value={value}><Select.Value className="wb-select-value" placeholder="请选择"/><Select.Icon className="wb-control-icon"><TraceIcon name="down" size={16}/></Select.Icon></Select.Trigger><Select.Portal container={container}><Select.Content ref={popupMotion} data-motion-exit="immediate" className="trace-ui wb-select-content wb-motion-popover" position="popper" sideOffset={6} collisionPadding={12}><Select.ScrollUpButton className="wb-select-scroll"><TraceIcon name="down" size={16} className="wb-select-scroll-up"/></Select.ScrollUpButton><Select.Viewport className="wb-select-viewport">{options.filter(o=>o.value!=='').map(o=><Select.Item key={o.value} value={o.value} disabled={o.disabled} className="wb-select-option" data-halo-value={o.value}><Select.ItemText>{o.label}</Select.ItemText><span className="wb-control-icon"><Select.ItemIndicator><TraceIcon name="check" size={16}/></Select.ItemIndicator></span></Select.Item>)}</Select.Viewport><Select.ScrollDownButton className="wb-select-scroll"><TraceIcon name="down" size={16}/></Select.ScrollDownButton></Select.Content></Select.Portal></Select.Root></span>;
}

// Local, synchronous search: do not invent a waiting state or delay input/deletion.
export function HaloSearchInput({value,onValueChange,label,autoFocus,onKeyDown,placeholder}:{value:string;onValueChange:(value:string)=>void;label:string;autoFocus?:boolean;onKeyDown?:React.KeyboardEventHandler<HTMLInputElement>;placeholder?:string}) {
  const input=useRef<HTMLInputElement>(null);
  return <div className="wb-halo-search"><TraceIcon name="search"/><input ref={input} type="text" autoComplete="off" autoFocus={autoFocus} aria-label={label} value={value} onChange={e=>onValueChange(e.target.value)} onKeyDown={onKeyDown} placeholder={placeholder}/>{value && <button type="button" aria-label={'清除'+label} onClick={()=>{onValueChange('');input.current?.focus();}}><TraceIcon name="close" size={16}/></button>}</div>;
}
