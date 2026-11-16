// Real user selection for current Radix and historical native controls.
async function selectValue(locator,value){
 if(await locator.evaluate(e=>e.tagName)==='SELECT')return locator.selectOption(value);
 await locator.click();await locator.page().locator('.wb-select-content [data-halo-value='+JSON.stringify(String(value))+']').click();
 const id=await locator.getAttribute('id');await locator.page().waitForFunction(({id,value})=>document.getElementById(id)?.getAttribute('data-selected-value')===value,{id,value:String(value)});
}
async function selectedValue(locator){return locator.evaluate(e=>e.tagName==='SELECT'?e.value:e.getAttribute('data-selected-value'));}
module.exports={selectValue,selectedValue};
