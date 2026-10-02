const fs=require('node:fs/promises');
const path=require('node:path');
const {MANIFESTS}=require('./hentoid-import.cjs');

async function checkedDirectory(book,root){
  if(!root||root.id!==book.root)throw new Error('Book storage location is unavailable.');
  const [directory,base,stat]=await Promise.all([fs.realpath(book.path),fs.realpath(root.path),fs.lstat(book.path)]);
  const relative=path.relative(base,directory);
  if(!stat.isDirectory()||stat.isSymbolicLink()||!relative||relative==='..'||relative.startsWith('..'+path.sep)||path.isAbsolute(relative)){
    throw new Error('Cannot delete a library root, linked folder, or a folder outside the library.');
  }
  const entries=await fs.readdir(directory,{withFileTypes:true});
  if(!entries.some(entry=>entry.isFile()&&!entry.isSymbolicLink()&&MANIFESTS.includes(entry.name.toLowerCase())))throw new Error('Cannot delete a folder without book metadata.');
  return {directory,base};
}

// Caller must obtain the deletion confirmation, including permanent fallback.
async function deleteBookFolder(book,root,trashItem){
  const checked=await checkedDirectory(book,root);
  try{await trashItem(checked.directory);return 'recycled';}
  catch{
    // A failed shell operation can take time. Revalidate before recursive removal
    // so a reconnected drive or replaced junction cannot redirect the deletion.
    const retry=await checkedDirectory(book,root);
    if(retry.directory!==checked.directory||retry.base!==checked.base)throw new Error('The book storage location changed. Please refresh the library.');
    await fs.rm(retry.directory,{recursive:true});
    return 'deleted';
  }
}
module.exports={deleteBookFolder};
