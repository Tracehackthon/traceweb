// Use the actual disclosure after choosing an existing external collection.
// Never force a hidden input or change production state from the test harness.
module.exports=async page=>{
  const preparation=page.locator('.wb-task-preparer');
  if(await preparation.count()&&await preparation.getAttribute('open')===null)await preparation.locator(':scope>summary').click();
};
