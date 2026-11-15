import React from 'react';
import {Tabs} from 'radix-ui';
import './detail-tabs.css';

// Halo demos contribute the composed surface and single selection, not a new
// state store or animation engine. Radix owns focus, roving keys and ARIA links.
export function DetailTabs({children,...props}:React.ComponentProps<typeof Tabs.Root>){
  return <Tabs.Root {...props} asChild>{children}</Tabs.Root>;
}

export function DetailTabsList(){
  return <Tabs.List className="wb-inspector-tabs wb-halo-tabs" aria-label="详情栏目">
    {(['content','source','relations','evolution'] as const).map((value,index)=><Tabs.Trigger key={value} type="button" value={value}>
      {['内容','来源','关联','演变'][index]}
    </Tabs.Trigger>)}
  </Tabs.List>;
}

export function DetailTabsPanel({children,...props}:React.ComponentProps<typeof Tabs.Content>){
  return <Tabs.Content {...props} className="wb-inspector-scroll">{children}</Tabs.Content>;
}
