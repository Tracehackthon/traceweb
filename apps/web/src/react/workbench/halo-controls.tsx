import React, {createContext, forwardRef, useContext, useId, useRef} from 'react';
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
export const HaloTextarea = forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(function HaloTextarea(props,ref) {
  const field = useContext(FieldContext);
  return <span className="wb-halo-control" data-disabled={props.disabled||undefined} data-invalid={field?.invalid || props['aria-invalid'] || undefined}><textarea {...props} ref={ref} id={props.id || field?.id} aria-describedby={[field?.description,props['aria-describedby']].filter(Boolean).join(' ') || undefined} aria-invalid={props['aria-invalid'] ?? field?.invalid} /></span>;
});

// Keep the platform picker, its keyboard behavior and form serialization.
// Only the closed control uses the shared material; no custom listbox owner.
export const HaloSelect = forwardRef<HTMLSelectElement,React.SelectHTMLAttributes<HTMLSelectElement>>(function HaloSelect(props,ref){
  const field=useContext(FieldContext);
  return <span className="wb-halo-control wb-halo-select" data-disabled={props.disabled||undefined} data-invalid={field?.invalid||props['aria-invalid']||undefined}><select {...props} ref={ref} id={props.id||field?.id} aria-describedby={[field?.description,props['aria-describedby']].filter(Boolean).join(' ')||undefined} aria-invalid={props['aria-invalid']??field?.invalid}/><TraceIcon name="down" size={16}/></span>;
});

// Local, synchronous search: do not invent a waiting state or delay input/deletion.
export function HaloSearchInput({value,onValueChange,label,autoFocus,onKeyDown,placeholder}:{value:string;onValueChange:(value:string)=>void;label:string;autoFocus?:boolean;onKeyDown?:React.KeyboardEventHandler<HTMLInputElement>;placeholder?:string}) {
  const input=useRef<HTMLInputElement>(null);
  return <div className="wb-halo-search"><TraceIcon name="search"/><input ref={input} type="text" autoComplete="off" autoFocus={autoFocus} aria-label={label} value={value} onChange={e=>onValueChange(e.target.value)} onKeyDown={onKeyDown} placeholder={placeholder}/>{value && <button type="button" aria-label={'清除'+label} onClick={()=>{onValueChange('');input.current?.focus();}}><TraceIcon name="close" size={16}/></button>}</div>;
}
